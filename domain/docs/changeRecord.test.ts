import test from 'node:test';
import assert from 'node:assert/strict';
import { changeEntry, changeLine, itemsText, KIND_WORDS, keptAsRevisionLine, sectionLabel, whoText, type ChangeRow } from './changeRecord.ts';

const row = (over: Partial<ChangeRow>): ChangeRow => ({ processId: 'p', kind: 'section_edit', change: 'changed', origin: 'person', items: ['pdd:s-2-1'], itemCount: 1, actor: 'u1', createdAt: '2026-11-23T14:02:00Z', ...over });
const ctx = { names: { u1: 'Priya Shah', u2: 'lee@example.com' }, stepLabel: (id: string) => (id === 'st-4' ? 'step 4, Post invoice in SAP' : null) };

test('every kind the database records has its approved words', () => {
  assert.deepEqual(Object.keys(KIND_WORDS).sort(), ['assessment_settings', 'choice', 'costs', 'layout', 'look', 'map_shape', 'rate', 'requirement', 'section_edit', 'source', 'test_edit']);
  assert.equal(KIND_WORDS.map_shape, 'Shape of the maps');
  assert.equal(KIND_WORDS.look, 'How documents look');
});

test('a line names what changed, how and which items, by their names in the product', () => {
  assert.equal(changeLine(row({}), ctx), 'Section edit changed: PDD, section 2.1');
  assert.equal(changeLine(row({ change: 'removed', items: ['tests:s-3'] }), ctx), 'Section edit removed: Test pack, section 3');
  assert.equal(changeLine(row({ kind: 'choice', items: ['st-4'] }), ctx), 'Choice of approach changed: step 4, Post invoice in SAP');
  assert.equal(changeLine(row({ kind: 'choice', items: ['st-9'] }), ctx), 'Choice of approach changed: a step no longer in the record (st-9)');
  assert.equal(changeLine(row({ kind: 'requirement', items: ['FR-003'] }), ctx), 'Requirement wording changed: FR-003');
  assert.equal(changeLine(row({ kind: 'source', change: 'added', items: ['sop-1'] }), ctx), 'Source added: sop-1');
  assert.equal(changeLine(row({ kind: 'rate', items: [null] }), ctx), 'Hourly cost changed');
  assert.equal(sectionLabel('pdd:c-intro'), 'PDD, section c-intro', 'a company section keeps its key');
  assert.equal(changeLine(row({ items: ['pdd:s-1', 'brd:s-2'], itemCount: 2 }), ctx), 'Section edit changed: PDD, section 1; BRD, section 2');
});

test('a change for the whole workspace says so; a row that followed another change says so, a person\'s never', () => {
  assert.equal(changeLine(row({ processId: null, kind: 'look', items: [null] }), ctx), 'How documents look changed (whole workspace)');
  assert.equal(changeLine(row({ processId: null, kind: 'assessment_settings', items: [null] }), ctx), 'Assessment settings changed (whole workspace)');
  assert.equal(changeLine(row({ kind: 'requirement', origin: 'follows', items: ['FR-003', 'FR-004'], itemCount: 2 }), ctx), 'Requirements followed another change: FR-003, FR-004');
  assert.doesNotMatch(changeLine(row({ kind: 'requirement' }), ctx), /followed/);
});

test('after five items, "and N more", counting what the record did not list', () => {
  const codes = ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005', 'FR-006', 'FR-007'];
  assert.equal(itemsText({ kind: 'requirement', items: codes, itemCount: 7 }, ctx), 'FR-001, FR-002, FR-003, FR-004, FR-005 and 2 more');
  assert.equal(itemsText({ kind: 'requirement', items: codes.slice(0, 5), itemCount: 60 }, ctx), 'FR-001, FR-002, FR-003, FR-004, FR-005 and 55 more');
});

test('who is a name, never an email address, and "Not recorded" otherwise', () => {
  assert.equal(whoText('u1', ctx.names), 'Priya Shah');
  assert.equal(whoText('u2', ctx.names), 'Not recorded');
  assert.equal(whoText(null, ctx.names), 'Not recorded');
  assert.equal(whoText('gone', ctx.names), 'Not recorded');
  const e = changeEntry(row({ createdAt: '' }), ctx, () => 'x');
  assert.equal(e.when, 'Not recorded');
});

test('a revision kept as a version says which', () => {
  assert.equal(keptAsRevisionLine(1, false), 'Kept as approved version 1');
  assert.equal(keptAsRevisionLine(2, true), 'Kept as approved version 2, after approval');
});
