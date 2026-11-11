// Minimal ZIP reader for .docx and .xlsx. Uses DecompressionStream('deflate-raw'), which browsers
// and Node 18+ provide, so no library is needed. Reads the central directory, so data descriptors
// and entry order do not matter. Zip64 and encryption are not supported.

export interface ZipArchive {
  names: string[];
  /** The entry's bytes, or null when it is not in the archive. */
  read(name: string): Promise<Uint8Array | null>;
  readText(name: string): Promise<string | null>;
}

export class ZipError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Expanded entries larger than this are refused, to stop zip bombs. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_ENTRY_BYTES || total > expected + 1024) {
      await reader.cancel();
      throw new ZipError('Archive entry is larger than it declares.');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

export function openZip(bytes: Uint8Array): ZipArchive {
  let eocd = bytes.length - 22;
  const stop = Math.max(0, bytes.length - 22 - 65535);
  while (eocd >= stop && u32(bytes, eocd) !== 0x06054b50) eocd--;
  if (eocd < stop) throw new ZipError('Not a ZIP archive.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map<string, { method: number; compressed: number; size: number; local: number; flags: number }>();
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new ZipError('Damaged ZIP directory.');
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const compressed = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compressed, size, local, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }

  const read = async (name: string): Promise<Uint8Array | null> => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new ZipError('Encrypted archives are not supported.');
    if (e.size > MAX_ENTRY_BYTES) throw new ZipError('Archive entry is too large.');
    if (u32(bytes, e.local) !== 0x04034b50) throw new ZipError('Damaged ZIP entry.');
    const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28);
    const data = bytes.subarray(start, start + e.compressed);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRaw(data, e.size);
    throw new ZipError(`Unsupported compression method ${e.method}.`);
  };

  return {
    names: [...entries.keys()],
    read,
    readText: async name => {
      const b = await read(name);
      return b === null ? null : new TextDecoder('utf-8').decode(b);
    },
  };
}

/** Decodes the five XML entities and numeric character references. */
export function xmlUnescape(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e as 'amp']!;
  });
}

/** The value of attribute `name` (with or without a namespace prefix) in a start tag. */
export function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s(?:\\w+:)?${name}="([^"]*)"`).exec(tag);
  return m ? xmlUnescape(m[1]) : undefined;
}
