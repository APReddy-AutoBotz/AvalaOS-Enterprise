// Excel .xlsx: one segment per non-empty row of each visible sheet, cells joined with " | ".
// Values are the stored results; formulas are not evaluated and macros are never read.
import { attr, openZip, xmlUnescape } from '../zip.ts';
import { SegmentBuilder, type IngestSegment } from '../segment.ts';

export const MAX_ROWS_PER_SHEET = 5000;

const colNumber = (letters: string) => [...letters].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);
const colLetters = (n: number) => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

const inlineText = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m => xmlUnescape(m[1])).join('');

export async function parseXlsx(bytes: Uint8Array, sourceId: string): Promise<{ segments: IngestSegment[]; warnings: string[] }> {
  const zip = openZip(bytes);
  const workbook = await zip.readText('xl/workbook.xml');
  if (workbook === null) throw new Error('This file has no Excel workbook.');
  const rels = (await zip.readText('xl/_rels/workbook.xml.rels')) ?? '';
  const target = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const t = attr(m[0], 'Target');
    if (id && t) target.set(id, t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
  }
  const shared = [...((await zip.readText('xl/sharedStrings.xml')) ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => inlineText(m[1]));

  const b = new SegmentBuilder(sourceId);
  const warnings: string[] = [];
  for (const sheet of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = attr(sheet[0], 'name') ?? 'Sheet';
    if ((attr(sheet[0], 'state') ?? 'visible') !== 'visible') { warnings.push(`Hidden sheet "${name}" was not read.`); continue; }
    const path = target.get(attr(sheet[0], 'id') ?? '');
    const xml = path ? await zip.readText(path) : null;
    if (!xml) continue;
    let rows = 0;
    for (const row of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      if (rows >= MAX_ROWS_PER_SHEET) { warnings.push(`Sheet "${name}" has more than ${MAX_ROWS_PER_SHEET} rows; the rest were not read.`); break; }
      const rowNo = Number(attr(` ${row[1]}`, 'r'));
      const values: { col: number; text: string }[] = [];
      for (const c of row[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(` ${c[1]}`, 'r') ?? '';
        const type = attr(` ${c[1]}`, 't');
        const inner = c[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let text = '';
        if (type === 's' && v !== undefined) text = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') text = inlineText(inner);
        else if (type === 'b' && v !== undefined) text = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) text = xmlUnescape(v);
        text = text.trim();
        if (text) values.push({ col: colNumber(/^[A-Z]+/.exec(ref)?.[0] ?? 'A'), text });
      }
      if (!values.length) continue;
      rows++;
      const first = colLetters(values[0].col);
      const last = colLetters(values[values.length - 1].col);
      const cell = `${name}!${first}${rowNo}${last !== first ? `:${last}${rowNo}` : ''}`;
      b.add('table_row', values.map(v => v.text).join(' | '), { cell });
    }
  }
  return { segments: b.segments, warnings };
}
