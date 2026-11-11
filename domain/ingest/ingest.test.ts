import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFile } from './parsers/index.ts';
import { parsePlainText } from './parsers/text.ts';
import { locatorLabel, MAX_SEGMENT_CHARS, SegmentBuilder, toGatewaySegments, type IngestSegment, type ParseResult } from './segment.ts';
import { validateRequest } from '../ai/gateway.ts';
import { TASKS } from '../ai/tasks.ts';

const pdfjs = () => import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<any>;
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const corpus = (name: string) => new Uint8Array(readFileSync(new URL(`../../eval/corpus/ap-invoice/sources/${name}`, import.meta.url)));
const parse = (name: string, bytes: Uint8Array, sourceId = 'src') => parseFile({ name, bytes, sourceId }, { pdfjs });
async function ok(r: Promise<ParseResult>): Promise<IngestSegment[]> {
  const res = await r;
  assert.equal(res.status, 'ok', 'message' in res ? res.message : '');
  return res.status === 'ok' ? res.segments : [];
}

const CALL1 = '01-discovery-call-2026-10-06.vtt';
const CALL2 = '02-exceptions-deep-dive-2026-10-09.srt';
const CALL3 = '03-sap-integration-call-2026-10-14.txt';
const SOP = '04-SOP-FIN-AP-004-vendor-invoice-processing.docx';

test('docx: list numbers follow the numbering definitions, including style numbering and restarts', async () => {
  const segs = await ok(parse('numbered-sop.docx', fixture('numbered-sop.docx')));
  const items = segs.filter(s => s.kind === 'list_item').map(s => [s.text, s.level]);
  assert.deepEqual(items, [
    ['1. Receive the invoice in the shared mailbox.', 0],
    ['2. Check mandatory fields.', 0],
    ['2.1 Legal name and GSTIN.', 1],
    ['2.2 Invoice number & date.', 1],
    ['3. Validate the vendor in SAP.', 0],
    ['3.1 Bank details match.', 1],
    ['(a) If not, raise a ServiceNow request.', 2],
    ['4. Post the invoice.', 0],
    ['Step IV: Escalate to the AP Team Lead.', 0],
    ['Step V: Escalate to the Finance Controller.', 0],
    ['7. Restarted first item.', 0],
  ]);
  assert.deepEqual(segs.filter(s => s.kind === 'heading').map(s => [s.text, s.level]), [['Vendor Invoice Procedure', 0], ['Procedure', 1], ['Approval limits', 2]]);
  assert.ok(segs.some(s => s.text === 'Kept inserted after tab'), 'deleted text and field codes are not text');
  assert.deepEqual(segs.filter(s => s.kind === 'table_row').map(s => [s.text, s.locator.cell, s.locator.heading]), [
    ['Amount (INR) | Approver', 'Table 1, row 1', 'Approval limits'],
    ['Up to 50,000 | Cost Centre Owner (email)', 'Table 1, row 2', 'Approval limits'],
  ]);
  assert.equal(segs.find(s => s.text.startsWith('3.1'))!.locator.section, '3.1');
  assert.ok(segs.every(s => s.text.trim().length > 0));
});

test('docx: the AP SOP keeps the twelve procedure steps in order with their section numbers', async () => {
  const segs = await ok(parse(SOP, corpus(SOP), 'sop'));
  const steps = segs.filter(s => /^6\.\d+ /.test(s.text)).map(s => [s.text, s.locator.section]);
  assert.deepEqual(steps.map(s => s[1]), ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8', '6.9', '6.10', '6.11', '6.12']);
  assert.deepEqual(steps.map(s => s[0]), steps.map(s => s[0]).slice().sort((a, b) => Number(String(a).split(' ')[0].split('.')[1]) - Number(String(b).split(' ')[0].split('.')[1])));
  const body = segs[segs.findIndex(s => s.text === '6.3 Check mandatory fields') + 1];
  assert.equal(body.locator.section, '6.3');
  assert.match(body.text, /^Confirm the invoice shows/);
  const doa = segs.filter(s => s.locator.cell?.startsWith('Table 4'));
  assert.deepEqual(doa.map(s => s.text.split(' | ')[0]), ['Gross invoice amount (INR)', 'Up to 2,00,000', 'Above 2,00,000 up to 10,00,000', 'Above 10,00,000']);
});

test('transcripts: VTT voices, SRT speaker prefixes and text exports give timestamp and speaker', async () => {
  const vtt = await ok(parse(CALL1, corpus(CALL1)));
  const meera = vtt.find(s => s.locator.timestamp === '00:00:32')!;
  assert.equal(meera.locator.speaker, 'Meera Iyer');
  assert.match(meera.text, /^Sure\. So I manage accounts payable/);
  assert.ok(vtt.every(s => s.kind === 'cue' && /^\d{2}:\d{2}:\d{2}$/.test(s.locator.timestamp!)));
  assert.ok(!vtt.some(s => /WEBVTT|Microsoft Teams|<v /.test(s.text)), 'header, notes and voice tags are not text');

  const srt = await ok(parse(CALL2, corpus(CALL2)));
  assert.deepEqual([srt[3].locator.timestamp, srt[3].locator.speaker], ['00:00:26', 'Karthik Raman']);
  assert.match(srt[3].text, /^From the tracker/);

  const txt = await parseFile({ name: CALL3, bytes: corpus(CALL3), sourceId: 'c3' });
  assert.equal(txt.status === 'ok' && txt.format, 'transcript_txt');
  const segs = txt.status === 'ok' ? txt.segments : [];
  assert.match(segs[2].text, /^Attendees: Rahul Deshpande/);
  const vikram = segs.find(s => s.locator.timestamp === '00:00:51')!;
  assert.deepEqual([vikram.locator.speaker, vikram.locator.lineStart], ['Vikram Shah', 12]);
});

test('every transcript and SOP excerpt in the AP gold model resolves to a segment at the right place', async () => {
  const files: Record<string, string> = { 'call-1': CALL1, 'call-2': CALL2, 'call-3': CALL3, sop: SOP };
  const norm = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().toLowerCase();
  const segs: Record<string, IngestSegment[]> = {};
  for (const [id, f] of Object.entries(files)) segs[id] = await ok(parse(f, corpus(f), id));
  const refs: { sourceId: string; excerpt: string; locator: Record<string, string> }[] = [];
  JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'), (_k, v) => {
    if (v && typeof v === 'object' && typeof v.excerpt === 'string' && segs[v.sourceId]) refs.push(v);
    return v;
  });
  assert.ok(refs.length >= 120, `only ${refs.length} references checked`);
  const misses = refs.filter(r => !segs[r.sourceId].some(s =>
    norm(s.text).includes(norm(r.excerpt))
    && (!r.locator.timestamp || s.locator.timestamp === r.locator.timestamp)
    && (!r.locator.speaker || s.locator.speaker === r.locator.speaker)
    && (!r.locator.section || s.locator.section === r.locator.section)));
  assert.deepEqual(misses.map(m => `${m.sourceId} ${JSON.stringify(m.locator)} ${m.excerpt}`), []);
});

test('pdf: lines group into paragraphs with page and line numbers; a scanned PDF needs OCR', async () => {
  const segs = await ok(parse('text-sop.pdf', fixture('text-sop.pdf')));
  const page2 = segs.filter(s => s.locator.page === 2);
  assert.deepEqual(page2.map(s => s.locator.section), ['6', '6.1', '6.2', '6.3']);
  const step63 = page2[3];
  assert.equal(step63.text, '6.3 Check mandatory fields: legal name and GSTIN, invoice number and date, PO number, HSN/SAC codes and the tax breakup.');
  assert.deepEqual([step63.locator.lineStart, step63.locator.lineEnd], [4, 5]);
  assert.equal(segs[1].text, 'This procedure defines how vendor invoices are recorded, validated and posted in SAP S/4HANA.');

  const scanned = await parse('scanned.pdf', fixture('scanned.pdf'));
  assert.equal(scanned.status, 'needs_ocr');
});

test('xlsx: visible rows with cell ranges; hidden sheets and uncached formulas are not read', async () => {
  const r = await parse('tracker.xlsx', fixture('tracker.xlsx'));
  assert.equal(r.status, 'ok');
  if (r.status !== 'ok') return;
  assert.deepEqual(r.segments.map(s => [s.locator.cell, s.text]), [
    ['Tracker!A1:E1', 'Vendor | Invoice no | Amount | Status | Posted'],
    ['Tracker!A2:E2', 'Shree Castings | SC/2026/0412 | 184500 | Waiting GR | FALSE'],
    ['Tracker!A4:G4', 'Deccan Logistics | DL-7781 | 52000.5 | Posted | TRUE | note & check'],
  ]);
  assert.deepEqual(r.warnings, ['Hidden sheet "Rates" was not read.']);
  assert.ok(!r.segments.some(s => s.text.includes('secret')));
});

test('markdown and plain text: headings, lists, paragraphs, sections and line numbers', () => {
  const md = '# 5. Policy rules\n\n5.1 Price tolerance applies to\nevery PO invoice.\n\n- Duplicates are blocked.\n  - Same vendor and number.\n\n```\ncode block\n```\n';
  const segs = parsePlainText(md, 'md', true);
  assert.deepEqual(segs.map(s => [s.kind, s.text, s.locator.section, s.locator.lineStart, s.locator.lineEnd]), [
    ['heading', '5. Policy rules', '5', 1, 1],
    ['paragraph', '5.1 Price tolerance applies to every PO invoice.', '5.1', 3, 4],
    ['list_item', 'Duplicates are blocked.', '5.1', 6, 6],
    ['list_item', 'Same vendor and number.', '5.1', 7, 7],
    ['paragraph', 'code block', '5.1', 10, 10],
  ]);
  assert.equal(segs[3].level, 1);
});

test('unsupported, empty, damaged and binary files return a clear state instead of throwing', async () => {
  assert.equal((await parse('old.doc', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).status, 'unsupported');
  assert.equal((await parse('empty.txt', new Uint8Array())).status, 'empty');
  assert.equal((await parse('blank.txt', new TextEncoder().encode('   \n\n  '))).status, 'empty');
  assert.equal((await parse('flow.png', corpus('06-AP-Invoice-AsIs.png'))).status, 'unsupported');
  assert.equal((await parse('x.bin', new Uint8Array([65, 0, 66, 0]))).status, 'unsupported');
  const broken = fixture('numbered-sop.docx').slice(0, 900);
  const r = await parse('broken.docx', broken);
  assert.equal(r.status, 'error');
  assert.equal((await parseFile({ name: 'a.pdf', bytes: fixture('text-sop.pdf'), sourceId: 's' })).status, 'error', 'PDF without pdf.js says so');
});

test('segments: long text is split, ids are stable and the gateway accepts the parsed SOP', async () => {
  const b = new SegmentBuilder('long');
  b.add('paragraph', 'Sentence one. '.repeat(1000), { lineStart: 1 });
  assert.ok(b.segments.length > 1 && b.segments.every(s => s.text.length <= MAX_SEGMENT_CHARS));
  assert.deepEqual(b.segments.map(s => s.id), b.segments.map((_, i) => `long:${i + 1}`));
  assert.throws(() => new SegmentBuilder('bad id!'));

  const segs = await ok(parse(SOP, corpus(SOP), 'sop'));
  const v = validateRequest({ action: 'run', workspaceId: '6f1c2b8e-4a3d-4e5f-9a1b-2c3d4e5f6a7b', task: 'participants', segments: toGatewaySegments(segs) }, TASKS);
  assert.equal(v.ok, true, 'message' in v ? v.message : '');
  assert.equal(locatorLabel({ timestamp: '00:04:34', speaker: 'Meera Iyer' }), '00:04:34, Meera Iyer');
  assert.equal(locatorLabel({ page: 2, lineStart: 4, lineEnd: 5, section: '6.3' }), 'p. 2, section 6.3, lines 4-5');
});
