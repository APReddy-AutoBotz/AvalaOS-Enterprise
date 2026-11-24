// Package B, pull request 1 (plan section 12, change c): a draft that holds what a discovery session adds
// (`meta.wanted`, and `raisedBy` on questions) is opened, checked and edited by the code the released site
// and its server functions run, and the new keys survive every edit; nothing the site builds from a model
// changes because of them. Proved on 23 November 2026 against `main` at `0c93807` with a throwaway script;
// kept here so the code that follows keeps it true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { validateModel } from '../processModel/validate.ts';
import { hashModel } from '../processModel/hash.ts';
import { applyPatch } from '../processModel/jsonPatch.ts';
import {
  addQuestion, addStep, answerQuestion, closeQuestions, confirmBrief, deferQuestion, dropWanted, keepWanted, raiseConflict, removeStep, reopenQuestions,
  resolveConflict, setBriefFact, setProcessMetric, setPurpose, setStepTrait, setSystemApi, updateFact, type OpResult,
} from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { planQuestions } from '../questions/firstList.ts';
import { firstListCounts } from '../questions/counts.ts';
import { buildAnswer, record } from '../questions/answer.ts';
import { buildPacks, packDocument } from '../questions/packs.ts';
import { digestFacts } from '../work/digest.ts';
import { askFacts } from '../assistant/ask.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildBrd } from '../docs/brd.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { applyChanges, proposeChanges } from '../extract/rebase.ts';
import { emptyModel } from '../processModel/empty.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const at = '2026-11-23T10:00:00.000Z';
const WANTED = 'The system should block entries over the limit';

/** The sample with what a session adds: one wanted statement, one question raised from a source, one left with Priya raised from an answer. */
function withSession(): ProcessModel {
  let m = keepWanted(gold, { statement: WANTED, sources: [{ sourceId: 'own-1', locator: { lineStart: 4 }, excerpt: 'The system should block entries over the limit.' }] }).model;
  const q = m.openQuestions.find(x => x.id === 'q-gl-coding')!;
  m = JSON.parse(JSON.stringify(m));
  m.openQuestions.find(x => x.id === q.id)!.raisedBy = { excerpt: 'we code those by hand', sourceId: 'call-1', locator: { timestamp: '00:03:10', speaker: 'Meera Iyer' } };
  m = deferQuestion(m, { questionIds: [], owner: 'Priya', gap: { target: { kind: 'step', id: 's-match', field: 'roleIds' }, question: 'Who does the three-way match when the buyer is away?', raisedBy: { excerpt: 'someone covers for them', answerTo: 'Who does "Three-way match"?' } } }).model;
  return m;
}
const strip = (m: ProcessModel): ProcessModel => {
  const c: ProcessModel = JSON.parse(JSON.stringify(m));
  delete c.meta.wanted;
  for (const q of c.openQuestions) delete q.raisedBy;
  return c;
};
const keysKept = (m: ProcessModel) => {
  assert.equal(m.meta.wanted?.[0]?.statement, WANTED);
  assert.equal(m.openQuestions.find(q => q.id === 'q-gl-coding')!.raisedBy!.excerpt, 'we code those by hand');
  assert.equal(m.openQuestions.find(q => q.owner === 'Priya')!.raisedBy!.answerTo, 'Who does "Three-way match"?');
};

test('it validates, with no error and no warning more than the sample, and hashes', () => {
  const m = withSession();
  const v = validateModel(m), g = validateModel(gold);
  assert.ok(v.valid);
  assert.deepEqual(v.issues.map(i => i.code), validateModel(deferQuestion(gold, { questionIds: [], owner: 'Priya', gap: { target: { kind: 'step', id: 's-match', field: 'roleIds' }, question: 'Who does the three-way match when the buyer is away?' } }).model).issues.map(i => i.code));
  assert.ok(g.valid);
  assert.notEqual(hashModel(m), hashModel(gold));
});

test('the shape of both is checked', () => {
  const bad = (edit: (m: any) => void) => { const m: any = withSession(); edit(m); return validateModel(m).issues.filter(i => i.severity === 'error').map(i => i.code); };
  assert.deepEqual(bad(m => { m.meta.wanted = 'x'; }), ['WANTED']);
  assert.deepEqual(bad(m => { m.meta.wanted[0].statement = ' '; }), ['WANTED']);
  assert.deepEqual(bad(m => { m.meta.wanted[0].status = 'inferred'; }), ['WANTED']);
  assert.deepEqual(bad(m => { m.meta.wanted[0].sources = []; }), ['UNSOURCED']);
  assert.deepEqual(bad(m => { m.meta.wanted.push({ ...m.meta.wanted[0] }); }), ['DUPLICATE_ID']);
  assert.deepEqual(bad(m => { m.openQuestions[0].raisedBy = { excerpt: 'words' }; }), ['RAISED_BY']);
  assert.deepEqual(bad(m => { m.openQuestions[0].raisedBy = { excerpt: '', sourceId: 'own-1' }; }), ['RAISED_BY']);
  assert.deepEqual(bad(m => { m.openQuestions[0].raisedBy = { excerpt: 'w', sourceId: 'own-1', locator: 'line 3' }; }), ['RAISED_BY']);
});

test('fifteen kinds of edit a released tab makes keep both keys; no patch touches them, and each replays to the same model', () => {
  const m = withSession();
  const step = m.steps[0]!;
  const edits: [string, (x: ProcessModel) => OpResult][] = [
    ['updateFact', x => updateFact(x, { target: { kind: 'meta', field: 'objective' }, value: 'Pay suppliers on time.' })],
    ['setBriefFact', x => setBriefFact(x, { fact: 'doneToday', value: 'yes' })],
    ['setPurpose', x => setPurpose(x, { value: 'assess', by: 'u1', at })],
    ['addStep', x => addStep(x, { step: { name: 'File the invoice', taskType: 'manual' } })],
    ['removeStep', x => removeStep(x, { stepId: step.id })],
    ['setStepTrait', x => setStepTrait(x, { stepId: step.id, trait: 'judgment', value: true })],
    ['setSystemApi', x => setSystemApi(x, { systemId: 'sys-servicenow', access: 'confirmed' })],
    ['setProcessMetric', x => setProcessMetric(x, { kind: 'volume', value: 1200, period: 'month' })],
    ['addQuestion', x => addQuestion(x, { target: { kind: 'meta', field: 'owner' }, question: 'Who owns the process?' })],
    ['deferQuestion', x => deferQuestion(x, { questionIds: ['q-gl-coding'], owner: 'AP lead' })],
    ['reopenQuestions', x => reopenQuestions(x, { questionIds: [x.openQuestions.find(q => q.owner === 'Priya')!.id] })],
    ['closeQuestions', x => closeQuestions(x, { questionIds: ['q-gl-coding'], answer: 'From the vendor category.' })],
    ['answerQuestion', x => answerQuestion(x, { questionId: x.openQuestions.find(q => q.owner === 'Priya')!.id, answer: 'The AP lead.' })],
    ['confirmBrief', x => confirmBrief(setBriefFact(x, { fact: 'doneToday', value: 'partly' }).model)],
    ['resolveConflict', x => resolveConflict(x, { conflictId: x.conflicts[0]!.id, chosen: x.conflicts[0]!.values[0]!.value, by: 'Lena', byId: 'u1', reason: 'The SOP is current.' })],
  ];
  assert.equal(edits.length, 15);
  for (const [name, edit] of edits) {
    const r = edit(m);
    keysKept(r.model);
    assert.ok(!r.patch.some(p => /\/meta\/wanted|\/raisedBy/.test(p.path)), `${name} sends no change to the new keys`);
    // What the database does with the patch gives exactly the same model (confirmBrief is two edits: compared whole).
    if (name !== 'confirmBrief') assert.deepEqual(applyPatch(m, r.patch), r.model, name);
  }
});

test('an answer through Closing the gaps or the interview keeps them; record carries the words that raised a new question', () => {
  const m = withSession();
  const item = triage(m, assessProcess(m)).items.find(i => i.questionIds.includes('q-gl-coding'))!;
  keysKept(buildAnswer(item, m, { text: 'From the vendor category.' })!.op(m).model);
  const gap = triage(m, assessProcess(m)).items.find(i => i.questionIds.length === 0)!;
  const r = record(gap, 'Answered in discovery.', 'answered', { excerpt: 'it is the AP lead', answerTo: gap.question })(m);
  const q = r.model.openQuestions.at(-1)!;
  assert.deepEqual(q.raisedBy, { excerpt: 'it is the AP lead', answerTo: gap.question });
  assert.equal(q.status, 'answered');
  keysKept(r.model);
});

test('a reading again keeps both; a first reading keeps what is wanted', () => {
  const m = withSession();
  const again = applyChanges(m, gold, new Set(proposeChanges(m, gold).changes.filter(c => c.defaultSelected).map(c => c.id)));
  keysKept(again);
  const before = keepWanted(emptyModel('Project time writing'), { statement: WANTED }).model;
  const first = applyChanges(before, gold, new Set());
  assert.equal(first.meta.wanted?.[0]?.statement, WANTED);
  assert.equal(first.steps.length, gold.steps.length);
});

test('nothing the site builds from a model changes because of them', () => {
  const m = withSession(), bare = strip(m);
  const a = assessProcess(m), b = assessProcess(bare);
  assert.deepEqual(a, b);
  assert.deepEqual(triage(m, a), triage(bare, b));
  assert.deepEqual(planQuestions(triage(m, a), m), planQuestions(triage(bare, b), bare));
  assert.deepEqual(firstListCounts(m), firstListCounts(bare));
  const row = { status: 'draft' as const, openQuestions: 3, proposalsWaiting: 0, analystId: null, architectId: null, approverId: null };
  assert.deepEqual(digestFacts({ ...row, model: m } as never), digestFacts({ ...row, model: bare } as never));
  const packs = (x: ProcessModel, y: typeof a) => buildPacks(triage(x, y), x).map(p => packDocument(p, x.meta.name, '23 Nov 2026'));
  assert.deepEqual(packs(m, a), packs(bare, b));
  assert.deepEqual(askFacts('Who does the three-way match?', { model: m, assessment: a }), askFacts('Who does the three-way match?', { model: bare, assessment: b }));
  const input = (x: ProcessModel, y: typeof a) => ({ model: x, assessment: y, decisions: emptyDecisions(), sources: [], revision: { label: 'r', state: 'working' as const, date: 'd' } });
  assert.deepEqual(buildPdd(input(m, a)), buildPdd(input(bare, b)));
  assert.deepEqual(buildBrd(input(m, a)), buildBrd(input(bare, b)));
  // And the statement shows nowhere the site builds: not in the documents, the question files or Ask Avala's facts.
  const built = JSON.stringify([buildPdd(input(m, a)), buildBrd(input(m, a)), packs(m, a), askFacts('What should change?', { model: m, assessment: a })]);
  assert.ok(!built.includes('block entries over the limit'));
  assert.ok(!built.includes('we code those by hand'));
});

test('kept, edited, removed; a conflict needs words on each side', () => {
  let m = keepWanted(gold, { statement: 'Invoices should be read automatically.', sources: [{ sourceId: 'own-1', locator: {}, excerpt: 'Invoices should be read automatically' }] });
  assert.equal(m.model.meta.wanted![0]!.status, 'stated');
  const id = m.wantedId;
  m = keepWanted(m.model, { id, statement: 'Invoices should be read and coded automatically.' });
  assert.equal(m.model.meta.wanted![0]!.status, 'user-confirmed');
  assert.equal(m.model.meta.wanted![0]!.sources.length, 1, 'the quote stays');
  assert.equal(keepWanted(m.model, { statement: 'A person\'s own words' }).model.meta.wanted![1]!.status, 'user-confirmed');
  assert.equal(dropWanted(m.model, { id }).model.meta.wanted!.length, 0);
  assert.throws(() => keepWanted(gold, { statement: '  ' }), /Write what should change/);
  assert.throws(() => dropWanted(gold, { id: 'w-9' }), /No wanted statement/);
  const src = { sourceId: 'own-1', locator: {}, excerpt: 'x' };
  assert.throws(() => raiseConflict(gold, { target: { kind: 'meta', field: 'owner' }, summary: 's', values: [{ value: 'A', sources: [src] }, { value: 'B', sources: [] }] }), /cites its words/);
  assert.throws(() => raiseConflict(gold, { target: { kind: 'meta', field: 'owner' }, summary: 's', values: [{ value: 'A', sources: [src] }] }), /at least two/);
  const c = raiseConflict(gold, { target: { kind: 'meta', field: 'owner' }, summary: 'Process owner differs', values: [{ value: 'A', sources: [src] }, { value: 'B', sources: [src] }] });
  assert.equal(c.model.conflicts.find(x => x.id === c.conflictId)!.resolution, null);
  assert.equal(c.model.meta.owner.value, gold.meta.owner.value);
});
