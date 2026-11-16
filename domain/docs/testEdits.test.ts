import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { buildTests, testPack } from './tests.ts';
import { applyTestEdits, caseHash, fieldsOf, makeTestEdit, packAsRun, TestEditError } from './testEdits.ts';
import { toMarkdown } from './markdown.ts';
import type { DocInput } from './common.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const inputOf = (m: ProcessModel): DocInput => {
  const a = assessProcess(m);
  return { model: m, assessment: a, decisions: emptyDecisions(), sources: [], requirements: reconcile(deriveRequirements(m, a), []).requirements, revision: { label: 'r', state: 'approved', date: 'd' } };
};

test('a tester changes a case, sets one aside and adds one; the document and the run follow', () => {
  const pack = testPack(inputOf(gold));
  const [a, b] = pack.cases.filter(c => c.expected);
  const e1 = makeTestEdit(a, { ...fieldsOf(a), data: 'Invoice 4711 from Kaveri Metals' });
  assert.deepEqual(Object.keys(e1.fields), ['data'], 'only real changes are kept');
  const e2 = makeTestEdit(b, {}, { setAside: true });
  const e3 = makeTestEdit(null, { title: 'Duplicate invoice is stopped', requirement: a.requirement, do: 'enter the same invoice twice', expected: 'the second entry is refused' }, { caseCode: 'added:00000000-0000-4000-8000-000000000001', requirements: pack.cases.map(c => c.requirement) });
  const cases = applyTestEdits(pack, [e1, e2, e3]);
  const ca = cases.find(c => c.code === a.code)!;
  assert.equal(ca.state, 'edited');
  assert.deepEqual(ca.data, ['Invoice 4711 from Kaveri Metals']);
  assert.equal(cases.find(c => c.code === b.code)!.state, 'set_aside');
  const added = cases.find(c => c.state === 'added')!;
  assert.equal(added.requirement, a.requirement);
  assert.equal(added.expected, 'The second entry is refused.');
  assert.ok(cases.indexOf(added) > cases.indexOf(ca), 'added after its requirement\'s cases');
  const run = packAsRun(pack, [e1, e2, e3]);
  assert.equal(run.cases.length, pack.cases.length, 'one set aside, one added');
  const md = toMarkdown(buildTests(inputOf(gold), [e1, e2, e3]));
  assert.match(md, /Kaveri Metals/);
  assert.match(md, /Duplicate invoice is stopped/);
});

test('when the requirement changes the case, the edit needs review; a case whose criterion is gone is marked', () => {
  const pack = testPack(inputOf(gold));
  const a = pack.cases.find(c => c.expected)!;
  const e = { ...makeTestEdit(a, { data: 'Invoice 4711' }), baseHash: 'stale' };
  assert.equal(applyTestEdits(pack, [e]).find(c => c.code === a.code)!.state, 'needs_review');
  assert.notEqual(caseHash(a), 'stale');
  const gone = applyTestEdits(pack, [{ caseCode: 'FR-999.1', fields: { title: 'Old' }, setAside: false, baseHash: 'x' }]);
  assert.equal(gone.at(-1)!.state, 'source_removed');
  assert.equal(packAsRun(pack, [{ caseCode: 'FR-999.1', fields: {}, setAside: false, baseHash: 'x' }]).cases.length, pack.cases.length);
});

test('an added case needs a title and a requirement of the pack', () => {
  assert.throws(() => makeTestEdit(null, { requirement: 'FR-001' }, { requirements: ['FR-001'] }), TestEditError);
  assert.throws(() => makeTestEdit(null, { title: 'x', requirement: 'FR-777' }, { requirements: ['FR-001'] }), TestEditError);
});
