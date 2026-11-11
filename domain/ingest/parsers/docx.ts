// Word .docx: paragraphs in document order with heading levels, list numbers as Word shows them
// (from numbering.xml, including styles that carry numbering), and tables row by row.
// Deleted tracked changes, field codes and comments are not text and are left out.
import { attr, openZip, xmlUnescape } from '../zip.ts';
import { leadingSection, SegmentBuilder, type IngestSegment } from '../segment.ts';
import type { SourceLocator } from '../../processModel/types.ts';

interface StyleInfo { name: string; basedOn?: string; numId?: string; ilvl?: number; outline?: number }
interface Level { start: number; fmt: string; text: string }

/** Visible text of a paragraph or cell fragment. */
function runText(xml: string): string {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>|<w:noBreakHyphen\/>/g;
  for (const m of xml.matchAll(re)) {
    if (m[1] !== undefined) out += xmlUnescape(m[1]);
    else if (m[0] === '<w:tab/>') out += '\t';
    else if (m[0] === '<w:noBreakHyphen/>') out += '-';
    else out += '\n';
  }
  return out;
}

function parseStyles(xml: string | null): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  for (const m of xml.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/g)) {
    const id = attr(m[1], 'styleId');
    if (!id) continue;
    const body = m[2];
    const info: StyleInfo = { name: attr(/<w:name\b[^>]*>/.exec(body)?.[0] ?? '', 'val') ?? id };
    const based = /<w:basedOn\b[^>]*>/.exec(body);
    if (based) info.basedOn = attr(based[0], 'val');
    const numId = /<w:numId\b[^>]*>/.exec(body);
    if (numId) info.numId = attr(numId[0], 'val');
    const ilvl = /<w:ilvl\b[^>]*>/.exec(body);
    if (ilvl) info.ilvl = Number(attr(ilvl[0], 'val'));
    const outline = /<w:outlineLvl\b[^>]*>/.exec(body);
    if (outline) info.outline = Number(attr(outline[0], 'val'));
    styles.set(id, info);
  }
  return styles;
}

function parseNumbering(xml: string | null) {
  const abstract = new Map<string, Map<number, Level>>();
  const nums = new Map<string, { abstractId: string; startOverride: Map<number, number> }>();
  if (!xml) return { abstract, nums };
  for (const m of xml.matchAll(/<w:abstractNum\b([^>]*)>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map<number, Level>();
    for (const l of m[2].matchAll(/<w:lvl\b([^>]*)>([\s\S]*?)<\/w:lvl>/g)) {
      const ilvl = Number(attr(l[1], 'ilvl'));
      const start = Number(attr(/<w:start\b[^>]*>/.exec(l[2])?.[0] ?? '', 'val') ?? 1);
      const fmt = attr(/<w:numFmt\b[^>]*>/.exec(l[2])?.[0] ?? '', 'val') ?? 'decimal';
      const text = attr(/<w:lvlText\b[^>]*>/.exec(l[2])?.[0] ?? '', 'val') ?? '';
      levels.set(ilvl, { start: Number.isFinite(start) ? start : 1, fmt, text });
    }
    abstract.set(attr(m[1], 'abstractNumId') ?? '', levels);
  }
  for (const m of xml.matchAll(/<w:num\b([^>]*)>([\s\S]*?)<\/w:num>/g)) {
    const startOverride = new Map<number, number>();
    for (const o of m[2].matchAll(/<w:lvlOverride\b([^>]*)>([\s\S]*?)<\/w:lvlOverride>/g)) {
      const s = /<w:startOverride\b[^>]*>/.exec(o[2]);
      if (s) startOverride.set(Number(attr(o[1], 'ilvl')), Number(attr(s[0], 'val')));
    }
    nums.set(attr(m[1], 'numId') ?? '', { abstractId: attr(/<w:abstractNumId\b[^>]*>/.exec(m[2])?.[0] ?? '', 'val') ?? '', startOverride });
  }
  return { abstract, nums };
}

function roman(n: number): string {
  const table: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of table) while (n >= v) { out += s; n -= v; }
  return out;
}
function letters(n: number): string {
  let out = '';
  while (n > 0) { n--; out = String.fromCharCode(97 + (n % 26)) + out; n = Math.floor(n / 26); }
  return out;
}
function formatNumber(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter': return letters(n);
    case 'upperLetter': return letters(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}

export async function parseDocx(bytes: Uint8Array, sourceId: string): Promise<IngestSegment[]> {
  const zip = openZip(bytes);
  const doc = await zip.readText('word/document.xml');
  if (doc === null) throw new Error('This file has no Word document body.');
  const styles = parseStyles(await zip.readText('word/styles.xml'));
  const { abstract, nums } = parseNumbering(await zip.readText('word/numbering.xml'));

  const resolve = (styleId: string | undefined): { headingLevel?: number; numId?: string; ilvl?: number; name?: string } => {
    const out: { headingLevel?: number; numId?: string; ilvl?: number; name?: string } = {};
    for (let id = styleId, guard = 0; id && guard < 20; guard++) {
      const s = styles.get(id);
      if (!s) break;
      out.name ??= s.name;
      const h = /^heading (\d)$/i.exec(s.name);
      if (out.headingLevel === undefined && h) out.headingLevel = Number(h[1]);
      if (out.headingLevel === undefined && s.outline !== undefined && s.outline < 9) out.headingLevel = s.outline + 1;
      if (/^title$/i.test(s.name) && out.headingLevel === undefined) out.headingLevel = 0;
      out.numId ??= s.numId;
      out.ilvl ??= s.ilvl;
      id = s.basedOn;
    }
    return out;
  };

  // counters[numId][ilvl]
  const counters = new Map<string, number[]>();
  const listLabel = (numId: string, ilvl: number): string | null => {
    const num = nums.get(numId);
    if (!num || numId === '0') return null;
    const levels = abstract.get(num.abstractId);
    const lvl = levels?.get(ilvl);
    if (!levels || !lvl) return null;
    const startOf = (i: number) => num.startOverride.get(i) ?? levels.get(i)?.start ?? 1;
    const c = counters.get(numId) ?? [];
    for (let i = 0; i < ilvl; i++) if (c[i] === undefined) c[i] = startOf(i);
    c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl] + 1;
    c.length = ilvl + 1; // deeper levels restart
    counters.set(numId, c);
    if (lvl.fmt === 'bullet' || lvl.fmt === 'none') return '';
    return lvl.text.replace(/%(\d)/g, (_, d: string) => {
      const i = Number(d) - 1;
      return formatNumber(c[i] ?? startOf(i), levels.get(i)?.fmt ?? 'decimal');
    });
  };

  const b = new SegmentBuilder(sourceId);
  let section: string | undefined;
  let heading: string | undefined;
  let paragraphNo = 0;
  let tableNo = 0;
  const loc = (): SourceLocator => {
    const l: SourceLocator = { lineStart: paragraphNo, lineEnd: paragraphNo };
    if (section) l.section = section;
    if (heading) l.heading = heading;
    return l;
  };

  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(doc)?.[1] ?? doc;
  for (const block of body.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const xml = block[0];
    if (xml.startsWith('<w:tbl')) {
      tableNo++;
      let rowNo = 0;
      for (const row of xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        rowNo++;
        const cells = [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)]
          .map(c => c[1].split(/<\/w:p>/).map(runText).map(t => t.trim()).filter(Boolean).join(' '));
        paragraphNo++;
        const l = loc();
        l.cell = `Table ${tableNo}, row ${rowNo}`;
        b.add('table_row', cells.join(' | '), l);
      }
      continue;
    }
    paragraphNo++;
    const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? '';
    const style = resolve(attr(/<w:pStyle\b[^>]*>/.exec(pPr)?.[0] ?? '', 'val'));
    const ownNum = /<w:numPr>([\s\S]*?)<\/w:numPr>/.exec(pPr)?.[1];
    const numId = ownNum ? attr(/<w:numId\b[^>]*>/.exec(ownNum)?.[0] ?? '', 'val') : style.numId;
    const ilvl = Number((ownNum ? attr(/<w:ilvl\b[^>]*>/.exec(ownNum)?.[0] ?? '', 'val') : undefined) ?? style.ilvl ?? 0);
    const text = runText(xml.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, '')).trim();
    if (!text) continue;

    const label = numId ? listLabel(numId, ilvl) : null;
    const full = label ? `${label} ${text}` : text;
    if (style.headingLevel !== undefined) {
      heading = full;
      section = leadingSection(full) ?? section;
      b.add('heading', full, loc(), style.headingLevel);
    } else if (label !== null) {
      const s = leadingSection(full);
      if (s) section = s;
      b.add('list_item', full, loc(), ilvl);
    } else {
      const s = leadingSection(full);
      if (s) section = s;
      b.add('paragraph', full, loc());
    }
  }
  return b.segments;
}
