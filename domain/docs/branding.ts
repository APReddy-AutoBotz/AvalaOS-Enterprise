// How a company's documents look: organisation name, font, accent colour, logo, and optionally the
// styles of the company's own Word template. Set once per workspace by an admin; applied to the
// Word download and to the document on screen. Nothing here changes what a document says.
import { openZip, attr } from '../ingest/zip.ts';
import type { DocType } from './tree.ts';

export interface WordTemplate {
  /** File name as uploaded. */
  name: string;
  /** word/styles.xml of the template: its fonts, colours, heading and table styles. */
  stylesXml: string;
  /** The template's own headings, in order, for matching sections (the structure step). */
  headings: { level: number; text: string }[];
}

export interface Branding {
  organisation: string;
  font: string;
  /** Hex colour, six digits, no #. */
  accent: string;
  /** A PNG or JPEG data URL. */
  logo: string | null;
  template: WordTemplate | null;
}

/** Per document type: section titles renamed or hidden, top-level order, and the company's own sections. */
export interface DocLayout {
  sections: Record<string, { title?: string; hidden?: boolean }>;
  order?: string[];
  custom: { id: string; after: string; title: string; text: string }[];
}

export interface DocumentSettings {
  branding: Branding;
  layouts: Partial<Record<DocType, DocLayout>>;
}

export const DEFAULT_BRANDING: Branding = { organisation: '', font: 'Calibri', accent: '002C4B', logo: null, template: null };
export const DEFAULT_DOCUMENT_SETTINGS: DocumentSettings = { branding: DEFAULT_BRANDING, layouts: {} };
export const FONTS = ['Calibri', 'Aptos', 'Arial', 'Segoe UI', 'Helvetica', 'Verdana', 'Georgia', 'Cambria', 'Times New Roman'];
export const LIMITS = { logoChars: 400_000, stylesChars: 600_000, organisation: 120, font: 60 } as const;

export class BrandingError extends Error {}
const HEX = /^[0-9A-Fa-f]{6}$/;
const LOGO = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Checks branding before saving; throws BrandingError naming the problem. */
export function validateBranding(b: Branding): Branding {
  const organisation = b.organisation.trim();
  const font = b.font.trim();
  if (organisation.length > LIMITS.organisation) throw new BrandingError(`Keep the organisation name under ${LIMITS.organisation} characters.`);
  if (!font || font.length > LIMITS.font || /[<>"]/.test(font)) throw new BrandingError('Choose a font.');
  const accent = b.accent.replace(/^#/, '');
  if (!HEX.test(accent)) throw new BrandingError('The colour must be six hex digits, like 002C4B.');
  if (b.logo && (b.logo.length > LIMITS.logoChars || !LOGO.test(b.logo))) throw new BrandingError('The logo must be a PNG or JPEG under 300 KB.');
  if (b.template && b.template.stylesXml.length > LIMITS.stylesChars) throw new BrandingError('The template styles are too large.');
  return { organisation, font, accent: accent.toUpperCase(), logo: b.logo, template: b.template };
}

/** Stored settings (possibly partial or from an older version) over the defaults; anything invalid falls back. */
export function documentSettingsFrom(stored: unknown): DocumentSettings {
  const s = (stored && typeof stored === 'object' ? stored : {}) as Partial<DocumentSettings>;
  let branding = DEFAULT_BRANDING;
  try { if (s.branding) branding = validateBranding({ ...DEFAULT_BRANDING, ...s.branding }); } catch { branding = DEFAULT_BRANDING; }
  const layouts = s.layouts && typeof s.layouts === 'object' ? s.layouts : {};
  return { branding, layouts };
}

/** Width and height of a PNG or JPEG data URL, read from its header. */
export function imageSize(dataUrl: string): { width: number; height: number; type: 'png' | 'jpg' } | null {
  const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2].slice(0, 120_000));
  const b = (i: number) => bin.charCodeAt(i);
  if (m[1] === 'png') return { width: (b(16) << 24) | (b(17) << 16) | (b(18) << 8) | b(19), height: (b(20) << 24) | (b(21) << 16) | (b(22) << 8) | b(23), type: 'png' };
  for (let i = 2; i < bin.length - 9;) {
    if (b(i) !== 0xff) return null;
    const marker = b(i + 1), len = (b(i + 2) << 8) | b(i + 3);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (b(i + 5) << 8) | b(i + 6), width: (b(i + 7) << 8) | b(i + 8), type: 'jpg' };
    i += 2 + len;
  }
  return null;
}

const text = (xml: string) => (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();

/**
 * Reads a company Word template (.docx or .dotx): its styles, the font and heading colour they set,
 * and its headings in order. Throws BrandingError when the file is not a Word document.
 */
export async function readWordTemplate(name: string, bytes: Uint8Array): Promise<{ template: WordTemplate; font: string | null; accent: string | null }> {
  let zip;
  try { zip = openZip(bytes); } catch { throw new BrandingError('That file is not a Word document (.docx or .dotx).'); }
  const styles = await zip.readText('word/styles.xml');
  const doc = await zip.readText('word/document.xml');
  if (!styles || !doc) throw new BrandingError('That file is not a Word document (.docx or .dotx).');
  if (styles.length > LIMITS.stylesChars) throw new BrandingError('The template styles are too large to use.');

  // Heading style ids: the built-in Heading1..9, or any style named "heading N".
  const level = new Map<string, number>();
  for (const m of styles.matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(m[0].slice(0, m[0].indexOf('>') + 1), 'w:styleId');
    const nameTag = /<w:name\b[^>]*\/>/.exec(m[1])?.[0];
    const styleName = (nameTag ? attr(nameTag, 'w:val') : '') ?? '';
    const n = /^heading\s*(\d)$/i.exec(styleName)?.[1] ?? /^Heading(\d)$/.exec(id ?? '')?.[1];
    if (id && n) level.set(id, Number(n));
  }
  const headings: WordTemplate['headings'] = [];
  for (const p of doc.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    const style = /<w:pStyle\b[^>]*\/>/.exec(p[0])?.[0];
    const id = style ? attr(style, 'w:val') : undefined;
    const lv = id ? level.get(id) : undefined;
    if (!lv || lv > 3) continue;
    const t = text(p[0]);
    if (t) headings.push({ level: lv, text: t.slice(0, 200) });
  }

  const defaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(styles)?.[0] ?? '';
  const fontsTag = /<w:rFonts\b[^>]*\/>/.exec(defaults)?.[0];
  let font = fontsTag ? attr(fontsTag, 'w:ascii') ?? null : null;
  if (!font && fontsTag && /minorHAnsi|minorAscii/.test(fontsTag)) {
    const theme = await zip.readText('word/theme/theme1.xml');
    const minor = theme ? /<a:minorFont>[\s\S]*?<a:latin\b[^>]*typeface="([^"]+)"/.exec(theme)?.[1] : undefined;
    font = minor ?? null;
  }
  const h1 = /<w:style\b[^>]*w:styleId="Heading1"[^>]*>[\s\S]*?<\/w:style>/.exec(styles)?.[0] ?? '';
  const colorTag = /<w:color\b[^>]*\/>/.exec(h1)?.[0];
  const color = colorTag ? attr(colorTag, 'w:val') : undefined;
  return { template: { name, stylesXml: styles, headings }, font, accent: color && HEX.test(color) ? color.toUpperCase() : null };
}
