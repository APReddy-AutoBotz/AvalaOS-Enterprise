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
