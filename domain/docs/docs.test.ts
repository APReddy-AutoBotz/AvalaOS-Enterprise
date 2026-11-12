import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { emptyModel } from '../processModel/empty.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions, withOverride } from '../assess/decisions.ts';
import { buildPdd } from './pdd.ts';
import { buildBrd } from './brd.ts';
import { toMarkdown } from './markdown.ts';
import type { DocTree } from './tree.ts';
import type { DocInput } from './common.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const input = (model: ProcessModel, decisions = emptyDecisions()): DocInput => ({
  model, assessment: assessProcess(model), decisions, sources: [{ key: 'call-1', title: 'Discovery call' }],
  revision: { label: 'Working draft', state: 'working', date: '12 November 2026' },
});
const section = (d: DocTree, n: string) => d.sections.find(s => s.number === n)!;
const table = (d: DocTree, n: string, caption: string) => section(d, n).blocks.find(b => b.kind === 'table' && b.caption === caption) as Extract<DocTree['sections'][number]['blocks'][number], { kind: 'table' }>;
const FILLER = /\b(TBD|lorem|placeholder|to be decided|N\/A|etc\.)/i;

test('PDD: one row per step in 2.4 and in the delivery model, in process order', () => {
  const d = buildPdd(input(gold));
  const steps = orderedSteps(gold);
  assert.equal(table(d, '2.4', 'Detailed As-Is steps').rows.length, steps.length);
  assert.deepEqual(table(d, '2.4', 'Detailed As-Is steps').rows.map(r => r[1].text), steps.map(s => s.name));
  assert.equal(table(d, '3.2', 'Delivery model').rows.length, steps.length);
  assert.equal(table(d, '2.2', 'Applications used').rows.length, gold.systems.length);
  assert.ok(d.sections.length >= 25);
});

test('PDD: an override shows in the delivery model with who set it', () => {
  const i = input(gold);
  const s = i.assessment.steps.find(x => !x.alreadyAutomated && x.winner !== 'human')!;
  const d = buildPdd({ ...i, decisions: withOverride(emptyDecisions(), s, { approach: 'human', rationale: 'Audit requires it.', by: 'lead@example.test' }) });
  const row = table(d, '3.2', 'Delivery model').rows.find(r => r[1].text === gold.steps.find(x => x.id === s.stepId)!.name)!;
  assert.match(row[3].text, /Keep with a person \(set by lead@example.test\)/);
  assert.match(row[5].text, /Overridden: Audit requires it./);
});

test('an empty model renders "Not provided" and open items, never filler', () => {
  const m = emptyModel('Claims intake');
  for (const d of [buildPdd(input(m)), buildBrd(input(m))]) {
    const md = toMarkdown(d);
    assert.doesNotMatch(md, FILLER);
    assert.match(md, /Not provided/);
    assert.ok(d.openItems.some(o => /objective/i.test(o.text)));
    assert.ok(d.openItems.some(o => /owner|owns/i.test(o.text)));
    const last = d.sections.at(-1)!;
    const closing = last.blocks.find(b => b.kind === 'table') as any;
    assert.equal(closing.rows.length, d.openItems.length, 'every open item is listed at the end');
  }
});

test('BRD summarises and links rather than repeating the step table; benefit only from entered figures', () => {
  const d = buildBrd(input(gold));
  assert.match(toMarkdown(d), /PDD, section 2.4/);
  assert.equal(d.sections.some(s => s.blocks.some(b => b.kind === 'table' && b.caption === 'Detailed As-Is steps')), false);
  const benefits = section(d, '11').blocks[0] as any;
  assert.equal(benefits.rows.find((r: any) => r.key === 'Value a year').value.missing, true);
  assert.equal(benefits.rows.find((r: any) => r.key === 'Build cost').value.text, 'Not estimated');
  assert.equal(table(d, '8', 'Business rules').rows.length, gold.rules.length);
});

test('the same model gives the same documents', () => {
  assert.equal(toMarkdown(buildPdd(input(gold))), toMarkdown(buildPdd(input(JSON.parse(JSON.stringify(gold))))));
  assert.equal(toMarkdown(buildBrd(input(gold))), toMarkdown(buildBrd(input(JSON.parse(JSON.stringify(gold))))));
});

test('PDD applications: one summary line per application, every interface in its own table, robots from the recorded ban', () => {
  const d = buildPdd(input(gold));
  const apps = table(d, '2.2', 'Applications used');
  const sap = apps.rows.find(r => /SAP/.test(r[0].text))!;
  assert.ok(sap[3].text.length < 120, sap[3].text);
  assert.match(sap[3].text, /^Screens: .*API: /);
  assert.match(sap[4].text, /^No \(SAP GUI scripting: not available\)/);
  const ifaces = table(d, '2.2', 'Interfaces and transactions');
  assert.equal(ifaces.rows.length, gold.systems.reduce((t, s) => t + s.access.length, 0));
});

test('a figure given as a range is not reported as unknown', () => {
  const d = buildPdd(input(gold));
  assert.equal(d.openItems.some(o => /Monthly invoice volume is unknown/i.test(o.text)), false);
});

/** The text of one entry of a zip file (Word files are zip archives). */
async function zipEntry(buf: Buffer, name: string): Promise<string> {
  const { inflateRawSync } = await import('node:zlib');
  for (let i = 0; i < buf.length - 30; i++) {
    if (buf.readUInt32LE(i) !== 0x04034b50) continue;
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const entry = buf.toString('utf8', i + 30, i + 30 + nameLen);
    const start = i + 30 + nameLen + extra;
    if (entry === name) { const data = buf.subarray(start, start + size); return (method === 8 ? inflateRawSync(data) : data).toString('utf8'); }
  }
  throw new Error(`${name} not found`);
}

test('Word export: cover and control, contents, numbered headings, every table row, draft marking, branding', async () => {
  const { docxDocument } = await import('./docx.ts');
  const { Packer } = await import('docx');
  const d = buildPdd(input(gold));
  const buf = await Packer.toBuffer(docxDocument(d, { draft: true, style: { font: 'Arial', accent: '7A1F5C', organisation: 'Acme Corp' } }));
  const xml = await zipEntry(buf, 'word/document.xml');
  const text = xml.replace(/<[^>]+>/g, ' ');
  assert.match(text, /Process Definition Document/);
  assert.match(text, /DRAFT: not approved/);
  assert.match(xml, /TOC [^<]*1-2/, 'a contents field');
  for (const sec of d.sections) assert.ok(text.includes(`${sec.number}  ${sec.title}`.replace(/&/g, '&amp;')), `heading ${sec.number}`);
  for (const s of orderedSteps(gold)) assert.ok(text.includes(s.name.replace(/&/g, '&amp;')), s.name);
  assert.match(xml, /w:tblHeader/, 'table header rows repeat across pages');
  const styles = await zipEntry(buf, 'word/styles.xml');
  assert.match(styles, /Arial/);
  assert.match(styles, /7A1F5C/i);
  const header = await zipEntry(buf, 'word/header1.xml').catch(() => zipEntry(buf, 'word/header2.xml'));
  assert.match(header, /Acme Corp/);
  const approved = await zipEntry(await Packer.toBuffer(docxDocument(d, { draft: false })), 'word/document.xml');
  assert.doesNotMatch(approved, /DRAFT/);
});
