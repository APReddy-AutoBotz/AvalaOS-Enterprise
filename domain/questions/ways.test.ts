// An application with no way in recorded (plan `claude/no-way-in-answer-plan-23-nov.md`, approved by the owner
// on 23 November 2026 with four additions): asked as a choice of ways in; "No way in" says what happens to the
// steps; words alone record nothing; an earlier worded answer is shown; the counts drop only when a way in is
// recorded; and what is written is the existing shape, which the released site already opens and edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { validateModel } from '../processModel/validate.ts';
import { applyPatch } from '../processModel/jsonPatch.ts';
import { addWayIn, setSystemApi, updateFact, addStep, addSystem, removeStep } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { triage, type TriageItem } from './triage.ts';
import { buildAnswer, record } from './answer.ts';
import { notesSegments, proposalsFrom } from './notes.ts';
import { buildPacks, packDocument } from './packs.ts';
import { followUpFor } from './interview.ts';
import { assessmentLine, meetingResult } from './result.ts';
import { firstListCounts } from './counts.ts';
import { digestFacts } from '../work/digest.ts';
import { earlierAnswers, NO_WAY_IN, waysRecordLine, WAYS } from './ways.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const demo: ProcessModel = (JSON.parse(readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8')) as { revisions: { state: string; model: ProcessModel }[] }).revisions.find(r => r.state === 'approved')!.model;
const items = (m: ProcessModel) => triage(m, assessProcess(m)).items;
const scanner = (m: ProcessModel) => items(m).find(i => i.key === 'system:sys-scanner') as TriageItem;
const save = (m: ProcessModel, a: Parameters<typeof buildAnswer>[2]) => buildAnswer(scanner(m), m, a)!.op(m).model;

test('an application with no way in recorded is asked as the six ways in, with its words unchanged', () => {
  const item = scanner(gold);
  assert.equal(item.kind, 'ways');
  assert.equal(item.question, 'How can Office scanner (Pune) be accessed by the automation (API, screens, file)?');
  assert.deepEqual(item.interfaces!.map(x => x.label), ['API', 'Screens', 'File', 'Database', 'Event', 'Email']);
  assert.ok(item.interfaces!.every(x => x.access === 'unknown'));
  // An application with ways in still unknown keeps its own interfaces; one with none at all is the only `ways`.
  assert.equal(items(gold).find(i => i.key === 'system:sys-servicenow')!.kind, 'access');
  assert.equal(items(gold).filter(i => i.kind === 'ways').length, 1);
});

test('"No way in" closes it: the line goes from 3 to 2, and the meeting\'s result counts it closed', () => {
  assert.equal(assessmentLine(gold, assessProcess(gold))!.n, 3);
  const after = save(gold, { pick: NO_WAY_IN });
  assert.equal(scanner(after), undefined);
  assert.equal(assessmentLine(after, assessProcess(after))!.n, 2);
  assert.equal(meetingResult(gold, after).text, `1 of ${items(gold).filter(i => !i.deferred).length} open questions closed`);
  const sys = after.systems.find(s => s.id === 'sys-scanner')!;
  assert.deepEqual(sys.access.map(a => [a.method, a.access, a.status]), [['api', 'confirmed_absent', 'user-confirmed'], ['ui', 'confirmed_absent', 'user-confirmed']]);
  assert.equal(sys.uiAllowed!.value, false);
  const q = after.openQuestions.at(-1)!;
  assert.equal(q.status, 'answered');
  assert.equal(q.answer, 'No way in: a person does this.');
});

test('one way in chosen closes it; words alone record nothing and leave no answered question behind an open one', () => {
  const after = save(gold, { statuses: { 2: 'confirmed' } });
  assert.equal(scanner(after), undefined);
  assert.deepEqual(after.systems.find(s => s.id === 'sys-scanner')!.access.map(a => [a.method, a.access]), [['file', 'confirmed']]);
  assert.equal(after.openQuestions.at(-1)!.answer, 'Ways in: File can be used.');
  assert.equal(buildAnswer(scanner(gold), gold, { text: 'The scanner drops PDFs into a folder.' }), null);
  assert.equal(buildAnswer(scanner(gold), gold, { statuses: { 0: 'unknown' } }), null);
  // Words with a choice are kept with it.
  assert.equal(save(gold, { statuses: { 2: 'confirmed' }, text: 'It drops PDFs into a shared folder.' }).openQuestions.at(-1)!.answer, 'Ways in: File can be used. It drops PDFs into a shared folder.');
});

test('"This will record: …" before Save, and for "No way in" what happens to the steps done in the application', () => {
  const item = scanner(gold);
  assert.equal(waysRecordLine(gold, item, {}), null);
  assert.equal(waysRecordLine(gold, item, { statuses: { 0: 'confirmed_absent', 2: 'confirmed' } }), 'This will record for Office scanner (Pune): API not available; File can be used.');
  const none = waysRecordLine(gold, item, { pick: NO_WAY_IN })!;
  assert.match(none, /^This will record: no way in to Office scanner \(Pune\); a person does the work in it\. /);
  // The scanner is a device the assessment does not route through, so its step keeps its recommendation, said by name.
  assert.match(none, /"Scan paper invoice" is still recommended for .+, which does not need a way into Office scanner \(Pune\)\.$/);
  // For an application the assessment does score, the steps that then stay with a person are named.
  const portal = addSystem(gold, { name: 'Vendor portal', kind: 'portal' });
  const added = addStep(portal.model, { step: { name: 'Download the remittance', taskType: 'user', systemIds: [portal.systemId], roleIds: [gold.roles[0]!.id] } });
  const item2 = items(added.model).find(i => i.key === `system:${portal.systemId}`)!;
  assert.equal(item2.kind, 'ways');
  assert.equal(assessProcess(added.model).steps.find(x => x.stepId === added.stepId)!.winner, 'rpa', 'before: robots on its screens');
  assert.equal(waysRecordLine(added.model, item2, { pick: NO_WAY_IN }), 'This will record: no way in to Vendor portal; a person does the work in it. The step done in it then stays with a person: "Download the remittance".');
  const after = buildAnswer(item2, added.model, { pick: NO_WAY_IN })!.op(added.model).model;
  assert.equal(assessProcess(after).steps.find(x => x.stepId === added.stepId)!.winner, 'human', 'and the assessment says the same once saved');
});

test('an earlier worded answer to the same question is shown on the card', () => {
  assert.deepEqual(earlierAnswers(gold, scanner(gold)), []);
  // The way it was answered before this change: a free answer recorded, the question still open.
  const before = record(scanner(gold), 'The scanner drops PDFs into a shared folder.')(gold).model;
  assert.equal(scanner(before).kind, 'ways', 'still open: the answer recorded no way in');
  assert.deepEqual(earlierAnswers(before, scanner(before)), ['The scanner drops PDFs into a shared folder.']);
  assert.deepEqual(earlierAnswers(before, items(before).find(i => i.key === 'system:sys-sap')!), []);
});

test('words are read into the ways as an application\'s interfaces are, from a quote; the question files say how to answer', () => {
  const item = scanner(gold);
  const { segments, ids } = notesSegments(gold, [item], 'The scanner just drops PDFs into a shared folder; there is no API.');
  assert.match(segments[0]!.text, /^Question 1 \(access\): How can Office scanner/);
  assert.match(segments[0]!.text, /Interface 2: File/);
  const [p] = proposalsFrom(gold, [item], ids, [
    { questionId: '1', value: 'confirmed', interface: '2', certainty: 'stated', segmentId: 'n:1', excerpt: 'drops PDFs into a shared folder' },
    { questionId: '1', value: 'confirmed_absent', interface: '0', certainty: 'stated', segmentId: 'n:1', excerpt: 'there is no API' },
  ]);
  assert.equal(p!.display, 'API: not available; File: can be used');
  const after = buildAnswer(item, gold, p!.answer)!.op(gold).model;
  assert.equal(scanner(after), undefined);
  assert.match(followUpFor(item, gold), /^I could not tell how the automation can reach it from that\. .* Or is there no way in at all\?$/);
  const pack = buildPacks(triage(gold, assessProcess(gold)), gold).find(x => x.items.some(i => i.item.key === 'system:sys-scanner'))!;
  assert.match(JSON.stringify(packDocument(pack, gold.meta.name, '23 Nov 2026')), /For each way in \(API, screens, file, database, event, email\)/);
});

test('the counts: the weekday email\'s and My work\'s are unchanged before any answer, and drop by exactly one after "No way in"', () => {
  const row = (m: ProcessModel) => digestFacts({ status: 'draft', openQuestions: 0, proposalsWaiting: 0, analystId: null, architectId: null, approverId: null, model: m, look: null, dismissed: [] } as never).questions;
  assert.deepEqual(row(gold), { now: 3, found: 0, wait: 9 });
  assert.deepEqual(firstListCounts(gold), { now: 3, found: 0, wait: 9 });
  const after = save(gold, { pick: NO_WAY_IN });
  assert.deepEqual(row(after), { now: 2, found: 0, wait: 9 });
  // Words alone, recorded the old way, change nothing.
  assert.deepEqual(row(record(scanner(gold), 'Some words.')(gold).model), { now: 3, found: 0, wait: 9 });
  // The demo's sample: its scanner, if still with no way in, is asked the same way; its counts are what the guard of package 16 pins.
  assert.deepEqual(row(demo), digestFacts({ status: 'draft', openQuestions: 0, proposalsWaiting: 0, analystId: null, architectId: null, approverId: null, model: demo, look: null, dismissed: [] } as never).questions);
});

test('what is written is the existing shape: as setSystemApi writes for the API, valid, and edited by every operation as before', () => {
  const viaApi = setSystemApi(gold, { systemId: 'sys-scanner', access: 'confirmed_absent' });
  const viaWay = addWayIn(gold, { systemId: 'sys-scanner', method: 'api', access: 'confirmed_absent' });
  assert.deepEqual(viaWay.model, viaApi.model);
  assert.deepEqual(viaWay.patch, viaApi.patch);
  assert.throws(() => addWayIn(gold, { systemId: 'sys-scanner', method: 'file', access: 'unknown' }), /Say whether the way in/);
  for (const a of [{ pick: NO_WAY_IN }, { statuses: { 1: 'reported' as const, 5: 'confirmed' as const } }]) {
    const r = buildAnswer(scanner(gold), gold, a)!.op(gold);
    assert.ok(validateModel(r.model).valid);
    assert.deepEqual(applyPatch(gold, r.patch), r.model, 'the patch the database applies gives the same model');
    for (const e of r.model.systems.find(s => s.id === 'sys-scanner')!.access) {
      assert.deepEqual(Object.keys(e).sort(), ['access', 'method', 'operations', 'sources', 'status']);
      assert.ok(WAYS.some(w => w.method === e.method));
    }
    // A released tab's own edits go on as before on a process answered this way.
    const m = r.model;
    for (const next of [updateFact(m, { target: { kind: 'meta', field: 'objective' }, value: 'Pay on time.' }), removeStep(m, { stepId: m.steps[0]!.id }), setSystemApi(m, { systemId: 'sys-scanner', access: 'reported' })]) {
      assert.ok(validateModel(next.model).valid);
      assert.deepEqual(applyPatch(m, next.patch), next.model);
    }
  }
});
