// How it will be built is already decided (docs/next-plan.md, package 9): one approach for the whole
// process, with the order of precedence for each step, "cannot" kept apart from "not known yet", the
// questions that settle a step leading the first list, the documents written for the approach, and the
// decision removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { decideApproach, removeDecidedApproach, setPurpose, setSystemApi, setStepTrait } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { assessProcess } from './process.ts';
import { emptyDecisions, type Decisions } from './decisions.ts';
import { decidedLine, decidedSummary } from './decided.ts';
import { triage } from '../questions/triage.ts';
import { planQuestions } from '../questions/firstList.ts';
import { buildBrd } from '../docs/brd.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildFrd } from '../docs/frd.ts';
import { buildSdd } from '../docs/sdd.ts';
import { buildAgent } from '../docs/agent.ts';
import { buildTests } from '../docs/tests.ts';
import { buildEvidence } from '../docs/evidence.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { askFacts } from '../assistant/ask.ts';
import { purposeOf, stagesForProcess, whatFollows } from '../plan/purpose.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const AT = '2026-11-16T15:00:00Z';
const decide = (m: ProcessModel, approach: 'rpa' | 'api' | 'ai_assist' | 'agent') => decideApproach(m, { approach, reason: 'The client runs this platform for every process', by: 'u1', at: AT }).model;
/** The sample with no application's API confirmed: every API answer taken back to unknown. */
function noApiConfirmed(): ProcessModel {
  let m = gold();
  for (const s of m.systems) if (s.access.some(a => a.method === 'api')) m = setSystemApi(m, { systemId: s.id, access: 'unknown' }).model;
  return m;
}
const docInput = (m: ProcessModel, decisions: Decisions = emptyDecisions()) => {
  const a = assessProcess(m, { decisions });
  return { model: m, assessment: a, decisions, sources: [], revision: { label: 'r', state: 'working' as const, date: 'd' }, requirements: reconcile(deriveRequirements(m, a), []).requirements, names: { u1: 'Asha Rao' } };
};
const text = (doc: { sections: { blocks: unknown[] }[] }) => JSON.stringify(doc.sections.map(s => ({ ...s, blocks: s.blocks.map(b => ((b as { kind: string }).kind === 'figure' ? {} : b)) })));

test('the answer and its approach are kept together, by id, and checked', () => {
  const m = decide(gold(), 'rpa');
  assert.equal(purposeOf(m), 'decided');
  assert.deepEqual(m.meta.decidedApproach, { approach: 'rpa', reason: 'The client runs this platform for every process', by: 'u1', at: AT });
  // "Decided" with no approach is refused by the record's check; so is a missing reason or an email address.
  const bare = structuredClone(m); delete bare.meta.decidedApproach;
  assert.equal(validateModel(bare).valid, false);
  assert.throws(() => decideApproach(gold(), { approach: 'rpa', reason: '  ', by: 'u1', at: AT }));
  const mail = structuredClone(m); mail.meta.decidedApproach!.by = 'someone@example.test';
  assert.equal(validateModel(mail).valid, false);
  // No Assessment page; every document; work planned.
  const w = whatFollows(m);
  assert.deepEqual([w.assessed, w.documents, w.plansWork], [false, null, true]);
  assert.deepEqual(stagesForProcess(undefined, m), ['sources', 'process', 'documents', 'flows', 'work-items']);
});

test('the order for a step: a person\'s own choice; else the decided approach where it can; else a person, with the reason', () => {
  const m = decide(gold(), 'rpa');
  const a = assessProcess(m);
  const s = decidedSummary(m, a)!;
  assert.ok(s.can.length > 0 && s.cannot.length > 0);
  for (const x of a.steps.filter(y => y.decided?.status === 'can')) assert.equal(x.winner, 'rpa');
  for (const x of a.steps.filter(y => y.decided?.status === 'cannot' || y.decided?.status === 'unknown')) assert.equal(x.winner, 'human');
  // Never a different technology from the one named.
  assert.ok(a.steps.every(x => x.alreadyAutomated || ['rpa', 'human'].includes(x.winner)));
  // A step the approach cannot do says why, in the rules' own words.
  const robots = a.steps.find(x => x.decided?.status === 'cannot' && /Robots are not allowed/.test(x.reason));
  assert.ok(robots, 'the sample\'s SAP screens are closed to robots');
  assert.match(robots!.reason, /^Rule-based RPA cannot do this step: robots are not allowed on the screens of SAP/i);
  // A person's own choice for that step comes first.
  const decisions: Decisions = { ...emptyDecisions(), overrides: { [robots!.stepId]: { stepId: robots!.stepId, approach: 'api', rationale: 'An API exists for this', by: 'u1', at: AT } } };
  const b = assessProcess(m, { decisions });
  const step = b.steps.find(x => x.stepId === robots!.stepId)!;
  assert.equal(step.winner, 'api');
  assert.equal(step.decided?.person, true);
  assert.equal(decidedSummary(m, b)!.person.length, 1);
});

test('"cannot" is kept apart from "not known yet": API integration decided and no application\'s API confirmed', () => {
  const m = decide(noApiConfirmed(), 'api');
  const a = assessProcess(m);
  const s = decidedSummary(m, a)!;
  assert.ok(s.unknown.length > 0, 'steps whose API is not confirmed are not settled');
  assert.ok(s.unknown.every(x => x.questions.length > 0));
  assert.ok(s.questions.some(q => q.question.target.kind === 'api' && /have an API that covers/.test(q.question.question)));
  // A step that uses no application to integrate with cannot be done by an API, whatever is answered.
  const none = a.steps.find(x => /no system to integrate with/.test(x.reason));
  if (none) assert.equal(none.decided?.status, 'cannot');
  const line = decidedLine(s, { u1: 'Asha Rao' });
  assert.match(line, /^API integration, decided by Asha Rao on 16 November 2026/);
  assert.match(line, /not known yet/);
  // The questions that settle those steps lead the first list, as questions that change the recommendation do.
  const t = triage(m, a);
  const plan = planQuestions(t, m);
  const lead = plan.now.filter(i => i.target.kind === 'system' && i.target.field === 'access');
  assert.ok(lead.length > 0);
  assert.ok(plan.now.slice(0, lead.length + 2).some(i => i.affects[0]?.startsWith('Settles whether API integration can do')));
  for (const i of t.items) if (i.group === 'decides') assert.match(i.affects[0]!, /^Settles whether/);
  // Answering one settles it: confirming the API moves its steps out of "not known yet".
  const q = s.questions.find(x => x.question.target.kind === 'api')!;
  const confirmed = setSystemApi(m, { systemId: (q.question.target as { systemId: string }).systemId, access: 'confirmed' }).model;
  assert.ok(decidedSummary(confirmed, assessProcess(confirmed))!.unknown.length < s.unknown.length);
});

test('a step fact not known yet is named as its question, and answering it settles the step', () => {
  const m = decide(gold(), 'rpa');
  const s = decidedSummary(m, assessProcess(m))!;
  const step = s.unknown[0];
  if (!step) return;
  const q = step.questions.find(x => x.target.kind === 'trait')!;
  assert.ok(q);
  const t = q.target as { stepId: string; trait: string };
  const answered = setStepTrait(m, { stepId: t.stepId, trait: t.trait as never, value: t.trait === 'input' ? 'structured' : t.trait === 'judgment' || t.trait === 'physical' ? false : true }).model;
  const after = decidedSummary(answered, assessProcess(answered))!;
  assert.ok(!after.unknown.some(x => x.stepId === step.stepId && x.questions.some(y => y.key === q.key)));
});

test('no document of a decided process says "recommended"; they say who decided, when and why', () => {
  for (const approach of ['rpa', 'api', 'ai_assist', 'agent'] as const) {
    const input = docInput(decide(gold(), approach));
    for (const doc of [buildBrd(input), buildPdd(input), buildFrd(input), buildSdd(input), buildAgent(input), buildTests(input, [])]) {
      assert.doesNotMatch(text(doc), /recommend/i, `${approach}: ${doc.type}`);
    }
    assert.match(text(buildPdd(input)), /was decided for the whole process by Asha Rao on 16 November 2026, because: \\"The client runs this platform/);
  }
});

test('the evidence pack lists the decision among the decisions people made', () => {
  const input = docInput(decide(gold(), 'rpa'));
  const doc = buildEvidence({ ...input, revisions: [{ revNo: 1, state: 'working', createdAt: AT, approvedAt: null, approvedBy: null }], revNo: 1, allSources: [], proposals: [], boardStatus: {}, testEdits: [], comments: [], names: { u1: 'Asha Rao' } });
  const t = text(doc);
  assert.match(t, /The approach decided for the whole process/);
  assert.match(t, /Rule-based RPA/);
  assert.match(t, /Asha Rao/);
  assert.doesNotMatch(t, /recommend/i);
});

test('removing the decision returns each step to the scoring\'s answer; while decided, the answer goes back to assess', () => {
  const before = gold();
  const m = decide(before, 'rpa');
  const back = removeDecidedApproach(m, { by: 'u1', at: AT }).model;
  assert.equal(purposeOf(back), 'assess');
  assert.equal(back.meta.decidedApproach, undefined);
  assert.equal(validateModel(back).valid, true);
  assert.deepEqual(assessProcess(back).steps.map(s => [s.stepId, s.winner, s.recommended]), assessProcess(before).steps.map(s => [s.stepId, s.winner, s.recommended]));
  // Switched to "assess" without removing it, the decided approach stays in effect, and the scoring's own answer is beside it.
  const kept = setPurpose(m, { value: 'assess', by: 'u1', at: AT }).model;
  const a = assessProcess(kept);
  assert.ok(a.steps.some(s => s.recommended && s.decided));
  assert.deepEqual(assessProcess(kept, { scoringAlone: true }).steps.map(s => s.winner), assessProcess(before).steps.map(s => s.winner));
  // Removed from "assess", the answer stays "assess".
  assert.equal(purposeOf(removeDecidedApproach(kept, { by: 'u1', at: AT }).model), 'assess');
});

test('Ask Avala on a decided process: the approach and what it can do, no score or ranking', () => {
  const m = decide(gold(), 'rpa');
  const facts = askFacts('Which steps stay with people?', { model: m, assessment: assessProcess(m) });
  assert.ok(facts.some(f => f.id === 'f:decided' && /Rule-based RPA was decided/.test(f.text)));
  assert.ok(!facts.some(f => f.id.startsWith('a:')));
  assert.ok(facts.some(f => f.id === 'h:step-by-step' && /The brief/.test(f.text)));
  assert.ok(!facts.some(f => /no single setting/.test(f.text)));
});

test('a step fact that settles the decided approach leads the first list, and its answer there settles the step', async () => {
  const { buildAnswer } = await import('../questions/answer.ts');
  const { firstListCounts } = await import('../questions/counts.ts');
  const m = decide(gold(), 'rpa');
  const a = assessProcess(m);
  const unknownSteps = decidedSummary(m, a)!.unknown.length;
  assert.ok(unknownSteps > 0);
  const plan = planQuestions(triage(m, a), m);
  const lead = plan.now.find(i => i.kind === 'choice');
  assert.ok(lead, 'a step fact is in the first list');
  assert.match(lead!.affects[0]!, /^Settles whether Rule-based RPA can do/);
  assert.equal(firstListCounts(m)!.now, plan.now.length, 'the email counts what the screens count');
  const yes = lead!.choices!.find(c => ['true', 'structured'].includes(c[0]))![0];
  const answered = buildAnswer(lead!, m, { pick: lead!.target.field === 'traits.judgment' || lead!.target.field === 'traits.physical' ? 'false' : yes })!.op(m).model;
  assert.ok(!planQuestions(triage(answered, assessProcess(answered)), answered).now.some(i => i.key === lead!.key));
});

test('the line is amber when the decided approach can do fewer than half the steps; the label beside the name', async () => {
  const { decidedFallsShort, purposeTag } = await import('./decided.ts');
  const m = decide(gold(), 'rpa');
  const s = decidedSummary(m, assessProcess(m))!;
  assert.equal(decidedFallsShort(s), s.can.length * 2 < s.can.length + s.unknown.length + s.cannot.length + s.person.length);
  assert.equal(decidedFallsShort({ ...s, can: s.can.slice(0, 1), unknown: [], cannot: s.can.slice(1, 3), person: [] }), true);
  assert.equal(decidedFallsShort({ ...s, can: s.can.slice(0, 2), unknown: [], cannot: s.can.slice(2, 4), person: [] }), false, 'exactly half is not short');
  assert.equal(decidedFallsShort({ ...s, can: [], unknown: [], cannot: [], person: [] }), false);
  assert.equal(purposeTag('as_is', null), 'Documented as it is');
  assert.equal(purposeTag('decided', { approach: 'rpa' }), 'Approach decided: Rule-based RPA');
  assert.equal(purposeTag('assess', { approach: 'rpa' }), null);
});
