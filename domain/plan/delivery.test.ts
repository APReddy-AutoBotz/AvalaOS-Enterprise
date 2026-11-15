import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { adoptBrief, confirmBrief, ModelOpError, setBriefFact } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { assessProcess } from '../assess/process.ts';
import { briefConfirmed, briefLines, deliveryPlan, expectation, hasBrief, notDoneToday } from './delivery.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const ref = (excerpt: string) => [{ sourceId: 'call-1', locator: {}, excerpt }];

test('the brief: read lines keep their passage, a person\'s line is never replaced by a later reading, confirm keeps the passages', () => {
  let m = gold();
  assert.equal(hasBrief(m), false);
  m = adoptBrief(m, {
    summary: { value: 'Vendor invoices are received, checked and posted in SAP.', status: 'stated', sources: ref('we receive about 5,000 invoices') },
    doneToday: { value: 'yes', status: 'stated', sources: ref('the team posts them by hand today') },
    kind: { value: null, status: 'unknown', sources: [] },
  }).model;
  assert.equal(validateModel(m).valid, true);
  assert.equal(hasBrief(m), true);
  assert.equal(briefConfirmed(m), false);
  const lines = briefLines(m);
  assert.deepEqual(lines.map(l => l.key), ['summary', 'doneToday', 'kind', 'applications', 'inMind', 'documents']);
  assert.deepEqual(lines.map(l => l.state), ['read', 'read', 'unknown', 'read', 'unknown', 'unknown']);
  assert.match(lines.find(l => l.key === 'applications')!.text!, /SAP/);

  m = setBriefFact(m, { fact: 'kind', value: 'existing_process' }).model;
  m = setBriefFact(m, { fact: 'doneToday', value: 'partly' }).model;
  // A later reading never overwrites what a person gave.
  m = adoptBrief(m, { doneToday: { value: 'no', status: 'stated', sources: ref('x') }, kind: { value: 'tool', status: 'stated', sources: ref('x') } }).model;
  assert.deepEqual([m.meta.brief!.doneToday!.value, m.meta.brief!.kind!.value], ['partly', 'existing_process']);
  m = confirmBrief(m).model;
  assert.equal(m.meta.brief!.summary!.status, 'user-confirmed');
  assert.equal(m.meta.brief!.summary!.sources.length, 1, 'the passage stays');
  assert.equal(briefConfirmed(m), true);
});

test('the brief only takes known values; a stated line needs its passage', () => {
  const m = gold();
  assert.throws(() => setBriefFact(m, { fact: 'kind', value: 'robot' as never }), ModelOpError);
  assert.throws(() => setBriefFact(m, { fact: 'inMind', value: ['rpa', 'rpa'] }), ModelOpError);
  assert.throws(() => adoptBrief(m, { doneToday: { value: 'no', status: 'stated', sources: [] } }), ModelOpError);
  assert.equal(setBriefFact(m, { fact: 'summary', value: null }).model.meta.brief!.summary!.status, 'unknown');
});

test('the delivery plan by its table: existing work, AI or agent, and work not done today', () => {
  const m = gold();
  const a = assessProcess(m);
  const existing = deliveryPlan(m, a);
  assert.equal(existing.track, 'existing');
  assert.deepEqual(existing.docs.filter(d => d.planned).map(d => d.doc), ['pdd', 'sdd']);
  assert.deepEqual(existing.docs.filter(d => !d.planned).map(d => d.doc), ['brd', 'frd'], 'BRD and FRD one click away');
  assert.equal(existing.unknowns.length, 2, 'not known whether done today, nor what kind');
  assert.match(existing.why, /^Nobody has said yet whether the work is done today, so it is treated as done today and the assessment leads with/);
  const yes = setBriefFact(m, { fact: 'doneToday', value: 'yes' }).model;
  assert.match(deliveryPlan(yes, assessProcess(yes)).why, /^The work is done today \(confirmed by a person\) and the assessment leads with/);

  const tool = setBriefFact(setBriefFact(m, { fact: 'doneToday', value: 'no' }).model, { fact: 'kind', value: 'tool' }).model;
  const t = deliveryPlan(tool, assessProcess(tool));
  assert.equal(t.track, 'new');
  assert.deepEqual(t.docs.filter(d => d.planned).map(d => d.doc), ['brd', 'frd', 'sdd']);
  assert.match(t.why, /not done today \(confirmed by a person\)/);
  assert.equal(t.unknowns.length, 0);
  assert.equal(notDoneToday(tool), true);

  const agent = setBriefFact(m, { fact: 'kind', value: 'agent' }).model;
  const g = deliveryPlan(agent, assessProcess(agent));
  assert.equal(g.track, 'ai');
  assert.deepEqual(g.docs.filter(d => d.planned).map(d => d.doc), ['pdd', 'agent', 'sdd']);
  assert.equal(g.docs.find(d => d.doc === 'agent')!.available, false, 'the agent document comes with part E');

  // The assessment alone can make it an AI track.
  assert.equal(deliveryPlan(m, { ...a, lead: 'agent' }).track, 'ai');
  assert.equal(deliveryPlan(m, { ...a, lead: 'ai_assist' }).track, 'ai');
});

test('documents a person chose replace the table\'s, and the table\'s own choice is still said', () => {
  const m = setBriefFact(gold(), { fact: 'documents', value: ['brd', 'pdd', 'sdd'] }).model;
  const p = deliveryPlan(m, assessProcess(m));
  assert.deepEqual(p.docs.filter(d => d.planned).map(d => d.doc), ['brd', 'pdd', 'sdd']);
  assert.deepEqual(p.ruleWouldPlan, ['pdd', 'sdd']);
  assert.match(p.docs[0].reason, /^Wanted \(confirmed by a person\)/);
  // Documents read from the sources (not confirmed) are added to the table's, never replace them.
  const read = adoptBrief(gold(), { documents: { value: ['brd'], status: 'stated', sources: ref('Summary of Business Requirements') } }).model;
  const r = deliveryPlan(read, assessProcess(read));
  assert.deepEqual(r.docs.filter(d => d.planned).map(d => d.doc), ['brd', 'pdd', 'sdd']);
  assert.match(r.docs.find(d => d.doc === 'brd')!.reason, /^Asked for in the sources; confirm or change it in the brief/);
  assert.equal(r.ruleWouldPlan, null);
  const same = setBriefFact(gold(), { fact: 'documents', value: ['sdd', 'pdd'] }).model;
  assert.equal(deliveryPlan(same, assessProcess(same)).ruleWouldPlan, null);
});

test('what the team had in mind is compared with the assessment, never used as the decision', () => {
  const m = gold();
  const a = assessProcess(m);
  assert.equal(expectation([], a), null);
  assert.equal(expectation(['open'], a), null);
  const agent = expectation(['agent'], a)!;
  assert.match(agent, /^An AI agent was expected; the assessment leads with .* instead \(of \d+ steps scored, \d+ steps are plain rules \(RPA or API\)/);
  assert.match(agent, /The assessment decides/);
  assert.match(expectation(['rpa'], { ...a, lead: 'rpa' })!, /^As expected: the assessment leads with Rule-based RPA \(of \d+ steps scored/);
  assert.match(expectation(['agent'], null)!, /no steps to compare it with yet/);
  assert.match(expectation(['api', 'agent'], null)!, /^API integration and an AI agent were expected/);
  const withMind = setBriefFact(m, { fact: 'inMind', value: ['agent'] }).model;
  const p = deliveryPlan(withMind, assessProcess(withMind));
  assert.equal(p.track, deliveryPlan(m, a).track, 'the expectation does not change the track');
  assert.ok(p.docs.some(d => d.doc === 'agent' && !d.planned), 'the agent document is offered when an agent was in mind');
});

test('a start with no documents: the form writes only what the person gave, as given by a person', async () => {
  const { applicationNames, ownWordsEdits } = await import('./start.ts');
  const { emptyModel } = await import('../processModel/empty.ts');
  assert.deepEqual(applicationNames(' SAP, outlook;\nSharePoint , sap ,, '), ['SAP', 'outlook', 'SharePoint']);
  let m = emptyModel('Supplier onboarding');
  for (const op of ownWordsEdits({ doneToday: 'no', inMind: ['agent'], apps: ['SAP', 'Coupa'] })) m = op(m).model;
  assert.equal(validateModel(m).valid, true);
  assert.deepEqual([m.meta.brief!.doneToday!.value, m.meta.brief!.doneToday!.status], ['no', 'user-confirmed']);
  assert.deepEqual(m.meta.brief!.inMind!.value, ['agent']);
  assert.deepEqual(m.systems.map(s => [s.name, s.status]), [['SAP', 'user-confirmed'], ['Coupa', 'user-confirmed']]);
  assert.equal(m.meta.brief!.kind, undefined, 'nothing the person did not give');
  assert.equal(ownWordsEdits({ doneToday: '', inMind: [], apps: [] }).length, 0);
  // An application already there is not added twice.
  for (const op of ownWordsEdits({ doneToday: '', inMind: [], apps: ['sap'] })) m = op(m).model;
  assert.equal(m.systems.length, 2);
});
