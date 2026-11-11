// Sources of a process: short keys that quotes cite, readable labels, and a quote shown in context.
import type { IngestSegment, SourceFormat } from '../ingest/segment.ts';
import type { SourceRef } from '../processModel/types.ts';
import { comparable } from '../ai/gateway.ts';

export type StoredFormat = SourceFormat | 'image';

const PREFIX: Record<StoredFormat, string> = {
  vtt: 'call', srt: 'call', transcript_txt: 'call', txt: 'doc', md: 'doc', docx: 'doc', pdf: 'doc', xlsx: 'sheet', drawio: 'flow', bpmn: 'flow', image: 'flow',
};

/** The next free key for a source of this format, such as call-2 or doc-1. Keys are never reused. */
export function sourceKey(format: StoredFormat, taken: Iterable<string>): string {
  const used = new Set(taken);
  for (let n = 1; ; n++) { const k = `${PREFIX[format]}-${n}`; if (!used.has(k)) return k; }
}

/** Before parsing the format is not known; the extension gives the likely prefix. */
export function formatFromName(name: string): StoredFormat {
  const e = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  const map: Record<string, StoredFormat> = {
    vtt: 'vtt', srt: 'srt', md: 'md', markdown: 'md', docx: 'docx', docm: 'docx', pdf: 'pdf', xlsx: 'xlsx', xlsm: 'xlsx',
    drawio: 'drawio', bpmn: 'bpmn', png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image',
  };
  return map[e] ?? 'txt';
}

export const FORMAT_LABEL: Record<StoredFormat, string> = {
  vtt: 'Meeting transcript', srt: 'Meeting transcript', transcript_txt: 'Meeting transcript', txt: 'Text', md: 'Text',
  docx: 'Word document', pdf: 'PDF', xlsx: 'Spreadsheet', drawio: 'Flowchart (draw.io)', bpmn: 'Flowchart (BPMN)', image: 'Flowchart image',
};

/** A plain title from a file name: "04-SOP-FIN-AP-004 vendor_invoice.docx" -> "04 SOP FIN AP 004 vendor invoice". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled source';
}

export interface QuoteInContext {
  segment: IngestSegment;
  before?: IngestSegment;
  after?: IngestSegment;
  /** Where the quote is inside segment.text, when found. */
  range?: [number, number];
}

/** Finds the segment a quote comes from (by locator, then by text) with its neighbours. */
export function quoteInContext(segments: IngestSegment[], ref: SourceRef): QuoteInContext | null {
  const wanted = comparable(ref.excerpt).norm;
  if (!wanted) return null;
  const sameLocator = (s: IngestSegment) => Object.entries(ref.locator).every(([k, v]) => v === undefined || (s.locator as Record<string, unknown>)[k] === v);
  const candidates = [...segments.filter(sameLocator), ...segments];
  for (const seg of candidates) {
    const c = comparable(seg.text);
    const i = c.norm.indexOf(wanted);
    if (i < 0) continue;
    const idx = segments.indexOf(seg);
    const start = c.at[i], end = c.at[i + wanted.length - 1] + 1;
    return { segment: seg, before: segments[idx - 1], after: segments[idx + 1], range: [start, end] };
  }
  return null;
}
