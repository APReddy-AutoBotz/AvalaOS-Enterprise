import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { buildPdd } from './pdd.ts';
import { buildBrd } from './brd.ts';
import { toMarkdown } from './markdown.ts';
import { applyLayout, LayoutError, outlineOf, suggestLayout, validateLayout } from './layout.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const input = { model: gold, assessment: assessProcess(gold), decisions: emptyDecisions(), sources: [], revision: { label: 'Working draft', state: 'working' as const, date: '12 November 2026' } };
const pdd = buildPdd(input);

test('no layout leaves the document as built', () => {
  assert.equal(applyLayout(pdd, undefined), pdd);
  assert.equal(applyLayout(pdd, { sections: {}, custom: [] }), pdd);
});

test('rename, hide, reorder and add: sections renumber, content is unchanged, open items keep their place', () => {
  const d = applyLayout(pdd, {
    sections: { '1.4': { hidden: true }, '2.4': { title: 'Current procedure' }, '4': { hidden: true } },
    order: ['2', '1'],
    custom: [{ id: 'x', after: '2.4', title: 'Controls owned by Internal Audit', text: 'Para one.\n\nPara two.' }, { id: 'y', after: 'start', title: 'Document approval', text: '' }],
  });
  const titles = d.sections.map(s => `${s.number} ${s.title}`);
  assert.equal(titles[0], '1 Document approval');
  assert.equal(titles[1], '2 As-Is process');
  assert.ok(titles.includes('2.4 Current procedure'));
  assert.ok(titles.includes('2.5 Controls owned by Internal Audit'));
  assert.ok(!titles.some(t => /Minimum prerequisites|Other observations/.test(t)));
  // The steps table is the same as before.
  const before = pdd.sections.find(s => s.number === '2.4')!.blocks;
  assert.deepEqual(d.sections.find(s => s.title === 'Current procedure')!.blocks, before);
  // Every open item is still listed at the end, with new or blank section numbers.
  assert.equal(d.openItems.length, pdd.openItems.length);
  const closing = d.sections.at(-1)!;
  assert.match(closing.title, /^Open gaps/);
  const raised = (closing.blocks.find(b => b.kind === 'table') as any).rows.map((r: any) => r.at(-1).text);
  const allowed = new Set(['', ...d.sections.map(s => s.number)]);
  assert.ok(raised.every((n: string) => allowed.has(n)));
  assert.match(toMarkdown(d), /Para two\./);
  assert.match(toMarkdown(d), /Document approval[\s\S]*Not provided/);
});

test('validation: the open-items list cannot be hidden; unknown sections are dropped; custom sections need a title and a real place', () => {
  const o = outlineOf(pdd);
  assert.throws(() => validateLayout({ sections: { '6': { hidden: true } }, custom: [] }, o), LayoutError);
  assert.deepEqual(validateLayout({ sections: { '99': { hidden: true }, '2.4': { title: 'Detailed As-Is steps' } }, custom: [] }, o).sections, {});
  assert.throws(() => validateLayout({ sections: {}, custom: [{ id: 'a', after: '2.4', title: ' ', text: '' }] }, o), LayoutError);
  assert.throws(() => validateLayout({ sections: {}, custom: [{ id: 'a', after: '9.9', title: 'X', text: '' }] }, o), LayoutError);
  assert.deepEqual(validateLayout({ sections: {}, order: ['2'], custom: [] }, o).order, ['2', '1', '3', '4', '5', '6']);
});

test('a company template\'s headings are matched to sections; unmatched headings become empty sections of the company\'s own', () => {
  const headings = [
    { level: 1, text: '1. Introduction' }, { level: 2, text: 'Process objectives' }, { level: 2, text: 'Stakeholders' },
    { level: 1, text: 'Current state process' }, { level: 2, text: 'Systems in use' }, { level: 2, text: 'Detailed current state steps' },
    { level: 1, text: 'Future state process' }, { level: 2, text: 'Exception handling' },
    { level: 1, text: 'Sign-off' }, { level: 1, text: 'Open questions' },
  ];
  const s = suggestLayout(outlineOf(pdd), headings);
  const to = (h: string) => s.matches.find(m => m.heading.endsWith(h))!.number;
  assert.equal(to('Process objectives'), '1.2');
  assert.equal(to('Stakeholders'), '1.3');
  assert.equal(to('Systems in use'), '2.2');
  assert.equal(to('Detailed current state steps'), '2.4');
  assert.equal(to('Open questions'), '6');
  assert.equal(to('Sign-off'), null);
  assert.ok(s.layout.custom.some(c => c.title === 'Sign-off'));
  assert.equal(s.layout.sections['2.2'].title, 'Systems in use');
  // Nothing the model knows is dropped: unmatched sections are still in the document.
  const d = applyLayout(pdd, validateLayout(s.layout, outlineOf(pdd)));
  assert.equal(d.sections.filter(x => x.title !== 'Sign-off').length, pdd.sections.length);
});

test('the BRD points to the PDD by section title, so a renumbered PDD keeps the link right', () => {
  assert.match(toMarkdown(buildBrd(input)), /PDD section "Detailed As-Is steps"/);
});

test('UiPath pack: the PDD takes the UiPath template headings, our own sections keep their names', async () => {
  const { UIPATH_PDD, applyPack } = await import('./packs.ts');
  const outline = outlineOf(pdd);
  // Every heading the pack names is a section the PDD has.
  const titles = new Set(outline.map(o => o.title));
  for (const t of Object.keys(UIPATH_PDD.titles)) assert.ok(titles.has(t), `the PDD has no section "${t}"`);
  const start = { sections: { '4': { hidden: true } }, order: ['2', '1'], custom: [{ id: 'x', after: '2.4', title: 'Controls', text: '' }] };
  const { layout, renamed } = applyPack(UIPATH_PDD, outline, start);
  assert.equal(renamed, Object.keys(UIPATH_PDD.titles).length);
  const d = applyLayout(pdd, validateLayout(layout, outline));
  const out = d.sections.map(s => s.title);
  for (const t of ['As-Is Process Description', 'Applications Used in the Process', 'In Scope for RPA', 'Out of Scope for RPA', 'Business Exceptions Handling', 'Additional Sources of Process Documentation']) assert.ok(out.includes(t), t);
  // Kept: hidden section, order, own section, sections UiPath has no heading for, the open items.
  assert.ok(!out.includes('Other Observations'));
  assert.equal(d.sections[0].title, 'As-Is Process Description');
  assert.ok(out.includes('Controls'));
  for (const t of ['Decision points and business rules', 'Delivery model', 'Open gaps and deferred items']) assert.ok(out.includes(t), t);
  // Applying it twice changes nothing more.
  assert.deepEqual(applyPack(UIPATH_PDD, outline, layout).layout, layout);
});
