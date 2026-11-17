import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addFlow, addRole, addStep, setBriefFact, setPurpose } from '../processModel/patch.ts';
import { emptyModel } from '../processModel/empty.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { buildPdd } from '../docs/pdd.ts';
import { triage } from '../questions/triage.ts';
import { planQuestions } from '../questions/firstList.ts';
import { firstListCounts } from '../questions/counts.ts';
import { digestFacts } from '../work/digest.ts';
import { needsFor, type ProcessFacts } from '../work/home.ts';
import { applyChanges } from '../extract/rebase.ts';
import { asksQuestion, documentsNote, offersDocument, offersPurpose, purposeOf, purposeOffMessage, stagesForProcess, whatFollows } from './purpose.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const asIs = (m: ProcessModel) => setPurpose(m, { value: 'as_is', by: 'u1', at: '2026-11-16T12:00:00Z' }).model;
/** The sample, told that nothing of it is done today and that the office scanner is what is being built. */
function intended(): ProcessModel {
  let m = gold();
  const sn = m.systems.find(s => /Office scanner/.test(s.name))!;
  m = setBriefFact(m, { fact: 'doneToday', value: 'no' }).model;
  m = setBriefFact(m, { fact: 'kind', value: 'tool' }).model;
  m = setBriefFact(m, { fact: 'building', value: sn.id }).model;
  return m;
}
/** Three steps done by hand by one role, with no application at all. */
function threeSteps(): ProcessModel {
  let m = emptyModel('Visitor sign-in');
  const r = addRole(m, { name: 'Receptionist', kind: 'person_role' }); m = r.model;
  const ids: string[] = [];
  for (const name of ['Greet the visitor', 'Check the visitor list', 'Hand over a badge']) {
    const s = addStep(m, { step: { name, taskType: 'manual', roleIds: [r.roleId] } }); m = s.model; ids.push(s.stepId);
  }
  m = addFlow(m, { from: ids[0]!, to: ids[1]! }).model;
  m = addFlow(m, { from: ids[1]!, to: ids[2]! }).model;
  return m;
}
const FIXTURES: [string, () => ProcessModel][] = [['the sample', gold], ['a process not done today', intended], ['three steps and no applications', threeSteps]];
const input = (m: ProcessModel) => ({ model: m, assessment: assessProcess(m), decisions: emptyDecisions(), sources: [{ key: 'S1', title: 'SOP' }], revision: { label: 'r', state: 'working' as const, date: 'd' } });

/** Words of a change, an assessment or automation: none may appear in a process documented as it is. */
const FORBIDDEN = /automat|robot|\bagents?\b|recommend|\bscor(?:e|es|ing)\b|hours saved|saving|to-be|\brpa\b|\bapis?\b|delivery model|in scope for|out of scope for|prerequisite|solution|future mode/i;
const LEFT_OUT = ['Minimum prerequisites for automation', 'To-Be process', 'To-Be process map', 'Delivery model', 'Detailed To-Be steps', 'In scope for automation', 'Out of scope for automation', 'Application error handling'];

/** Every piece of text the document carries, less what the process's own record says (its names, descriptions, rules). */
function ourText(doc: ReturnType<typeof buildPdd>, m: ProcessModel): string[] {
  const own = new Set<string>();
  const walk = (x: unknown) => { if (typeof x === 'string') own.add(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  walk({ ...m, meta: { ...m.meta, purpose: undefined } });
  const out: string[] = [];
  const pick = (x: unknown) => {
    if (typeof x === 'string') { if (!own.has(x) && !x.startsWith('<svg') && ![...own].some(o => o.length > 3 && x.includes(o) && x.replace(o, '').match(FORBIDDEN) === null)) out.push(x); }
    else if (Array.isArray(x)) x.forEach(pick);
    else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) if (k !== 'svg' && k !== 'mermaid') pick(v);
  };
  pick(doc);
  return out;
}

test('the rule: nobody has answered, the process is assessed and documented as before', () => {
  const m = gold();
  assert.equal(purposeOf(m), 'assess');
  const w = whatFollows(m);
  assert.deepEqual([w.assessed, w.future, w.asksInMind, w.plansWork, w.documents, w.hiddenStages], [true, true, true, true, null, []]);
  assert.deepEqual(stagesForProcess(undefined, m), ['sources', 'process', 'assessment', 'documents', 'flows', 'work-items']);
  assert.equal(documentsNote(m), null);
  assert.equal(purposeOffMessage('assessment', m), null);
  for (const t of ['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests', 'evidence'] as const) assert.ok(offersDocument(m, t));
});

test('the rule: documented as it is, only the process document, its map and the evidence pack', () => {
  const m = asIs(gold());
  assert.equal(purposeOf(m), 'as_is');
  const w = whatFollows(m);
  assert.deepEqual([w.assessed, w.future, w.asksInMind, w.plansWork], [false, false, false, false]);
  assert.deepEqual(stagesForProcess(undefined, m), ['sources', 'process', 'documents', 'flows']);
  assert.deepEqual(stagesForProcess(['assess', 'documents'], m), ['sources', 'process', 'documents', 'flows']);
  assert.deepEqual(['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests', 'evidence'].filter(t => offersDocument(m, t as never)), ['pdd', 'evidence']);
  assert.match(purposeOffMessage('assessment', m)!, /documented as it is.*The brief/);
  assert.match(purposeOffMessage('work-items', m)!, /^Work items is not part of this process/);
  assert.equal(purposeOffMessage('flows', m), null);
  assert.match(documentsNote(m)!, /process document and the evidence pack/);
});

test('an organisation without the documents is not offered the question, and its processes stay assessed', () => {
  assert.equal(offersPurpose(['assess']), false);
  assert.equal(offersPurpose(['assess', 'documents']), true);
  assert.equal(offersPurpose(undefined), true);
  assert.deepEqual(stagesForProcess(['assess'], asIs(gold())), ['sources', 'process', 'assessment']);
});

test('questions: documented as it is, nothing that serves an assessment is asked, and nothing changes a recommendation', () => {
  for (const [name, make] of FIXTURES) {
    const before = make();
    const m = asIs(before);
    const all = triage(before, assessProcess(before)).items;
    const asked = triage(m, assessProcess(m));
    assert.equal(asked.purpose, 'as_is', name);
    for (const i of asked.items) {
      assert.notEqual(i.group, 'decides', `${name}: ${i.question}`);
      assert.ok(!(i.target.kind === 'system' && i.target.field === 'access'), `${name}: ${i.question}`);
      assert.ok(!i.affects.some(a => a.startsWith('Assessment')), `${name}: ${i.question}`);
    }
    // Every question kept is one the full list has, and what is left out is only what serves an assessment.
    for (const i of all.filter(x => !asked.items.some(y => y.key === x.key))) {
      assert.ok((i.target.kind === 'system' && i.target.field === 'access') || i.target.kind === 'metric' || (i.target.kind === 'meta' && !i.target.field), `${name}: ${i.question} was left out`);
    }
    // Nothing is closed: the stored questions are as they were.
    assert.deepEqual(m.openQuestions, before.openQuestions);
  }
  const m = asIs(gold());
  assert.equal(asksQuestion(m, { target: { kind: 'system', id: m.systems[0]!.id, field: 'access' }, question: '' }), false);
  assert.equal(asksQuestion(m, { target: { kind: 'step', id: m.steps[0]!.id, field: 'roleIds' }, question: '' }), true);
  assert.equal(asksQuestion(m, { target: { kind: 'meta' }, question: 'How many invoices per month are handled?' }), false);
  assert.equal(asksQuestion(m, { target: { kind: 'meta' }, question: 'Who signs off a credit note?' }), true);
  assert.equal(asksQuestion(gold(), { target: { kind: 'system', id: m.systems[0]!.id, field: 'access' }, question: '' }), true);
});

test('the process document, documented as it is, on three processes: nothing about a change, numbers without gaps', () => {
  for (const [name, make] of FIXTURES) {
    const m = asIs(make());
    const doc = buildPdd(input(m));
    const titles = doc.sections.map(s => s.title);
    for (const t of LEFT_OUT) assert.ok(!titles.includes(t), `${name}: ${t}`);
    for (const t of ['Introduction', 'Objectives of the process', 'Key contacts', 'Applications used', 'Decision points and business rules', 'Input data', 'Pain points and current-state gaps', 'Business exception handling', 'Reporting and audit', 'Other observations', 'Sources', 'Open gaps and deferred items']) assert.ok(titles.includes(t), `${name}: ${t}`);
    for (const x of ourText(doc, m)) assert.doesNotMatch(x, FORBIDDEN, `${name}: "${x}"`);
    // Numbers run 1, 1.1, 1.2 … 2, 2.1 … without a gap.
    let top = 0, sub = 0;
    for (const s of doc.sections) {
      const [a, z] = s.number.split('.').map(Number);
      if (z === undefined) { top += 1; sub = 0; assert.equal(a, top, `${name}: ${s.number} ${s.title}`); }
      else { sub += 1; assert.deepEqual([a, z], [top, sub], `${name}: ${s.number} ${s.title}`); }
    }
    // The map is the process's own map: one figure, never a To-Be map.
    assert.equal(doc.sections.flatMap(s => s.blocks).filter(b => b.kind === 'figure').length, m.steps.length ? 1 : 0, name);
  }
  // A process not done today keeps its words.
  assert.ok(buildPdd(input(asIs(intended()))).sections.some(s => s.title === 'Intended process'));
});

test('figures: kept with their source when the record holds them, never asked for or "Not provided"', () => {
  const m = asIs(gold());
  const doc = buildPdd(input(m));
  const overview = doc.sections.find(s => s.title === 'Process overview')!;
  const rows = overview.blocks.flatMap(b => (b.kind === 'keyValue' ? b.rows : []));
  const volume = rows.find(r => r.key === 'Cases handled');
  if (gold().meta.metrics.some(x => x.kind === 'volume' && x.value !== null)) assert.match(volume!.value.text, /source:/);
  const bare = asIs(threeSteps());
  const rows3 = buildPdd(input(bare)).sections.find(s => s.title === 'Process overview')!.blocks.flatMap(b => (b.kind === 'keyValue' ? b.rows : []));
  for (const k of ['Cases handled', 'Hands-on time per case', 'People doing the work', 'Cases that leave the standard path']) assert.ok(!rows3.some(r => r.key === k), k);
  const open = buildPdd(input(bare)).openItems.map(o => o.text).join(' ');
  assert.doesNotMatch(open, /volume|handling time|per case|exception rate|FTE|accessed/i);
});

test('the question count is the same from every place that shows it', () => {
  for (const [name, make] of FIXTURES) for (const m of [make(), asIs(make())]) {
    const t = triage(m, assessProcess(m));
    const p = planQuestions(t, m);
    const counts = firstListCounts(m)!;
    assert.deepEqual(counts, { now: p.now.length, found: p.found.length, wait: p.wait.length }, name);
    const row = { id: 'p', name: 'P', analystId: 'u1', architectId: 'u1', approverId: null, status: 'draft' as const, openQuestions: 99, proposalsWaiting: 3, model: m };
    const email = digestFacts(row);
    assert.deepEqual(email.questions, counts, name);
    const screen: ProcessFacts = { ...row, questions: counts, ...(purposeOf(m) === 'as_is' ? { purpose: 'as_is' as const } : {}) };
    const me = { userId: 'u1', role: 'editor' as const, job: null, canApprove: false };
    assert.deepEqual(needsFor(me as never, [email]), needsFor(me as never, [screen]), name);
  }
});

test('a process documented as it is plans no work: proposals kept from before are not a need', () => {
  const me = { userId: 'u1', role: 'editor' as const, job: null, canApprove: false };
  const base = { id: 'p', name: 'P', analystId: null, architectId: 'u1', approverId: null, status: 'approved' as const, openQuestions: 0, proposalsWaiting: 2 };
  assert.ok(needsFor(me as never, [base]).some(n => n.stage === 'work-items'));
  assert.ok(!needsFor(me as never, [{ ...base, purpose: 'as_is' }]).some(n => n.stage === 'work-items'));
  assert.equal(digestFacts({ ...base, model: asIs(gold()) }).purpose, 'as_is');
  assert.equal(digestFacts({ ...base, model: gold() }).purpose, undefined);
});

test('switched there and back, the process is as it was apart from the answer itself', () => {
  for (const [name, make] of FIXTURES) {
    const before = make();
    const there = asIs(before);
    const back = setPurpose(there, { value: 'assess', by: 'u2', at: '2026-11-16T13:00:00Z' }).model;
    const { purpose, ...meta } = back.meta;
    assert.deepEqual({ ...back, meta }, before, name);
    assert.deepEqual(purpose, { value: 'assess', by: 'u2', at: '2026-11-16T13:00:00Z' }, name);
    // And everything built from it is as before.
    assert.deepEqual(buildPdd(input(back)).sections, buildPdd(input(before)).sections, name);
  }
});

test('a document follows the answer of the record it is built from (an approved revision keeps its own)', () => {
  const approvedAssessed = gold();
  const workingAsIs = asIs(gold());
  assert.ok(buildPdd(input(approvedAssessed)).sections.some(s => s.title === 'To-Be process'));
  assert.ok(!buildPdd(input(workingAsIs)).sections.some(s => s.title === 'To-Be process'));
  // And the other way: an approved as-is revision stays as-is when the working draft is assessed again.
  const approvedAsIs = asIs(gold());
  const workingAssessed = setPurpose(approvedAsIs, { value: 'assess', by: 'u1', at: 'x' }).model;
  assert.ok(!buildPdd(input(approvedAsIs)).sections.some(s => s.title === 'To-Be process'));
  assert.ok(buildPdd(input(workingAssessed)).sections.some(s => s.title === 'To-Be process'));
});

test('the first reading of the sources keeps the answer given before it', () => {
  const start = asIs(emptyModel('Supplier invoices'));
  const next = applyChanges(start, gold(), new Set());
  assert.equal(purposeOf(next), 'as_is');
  assert.deepEqual(next.meta.purpose, start.meta.purpose);
});

test('the answer is checked: only the two answers, with who and when', () => {
  assert.throws(() => setPurpose(gold(), { value: 'maybe' as never, by: null, at: 'x' }));
  const m = setPurpose(gold(), { value: 'as_is', by: null, at: '2026-11-16' }).model;
  assert.equal(m.meta.purpose!.by, null);
});

test('the evidence pack of a process documented as it is: the process and its sources, no requirements, work or tests', async () => {
  const { buildEvidence } = await import('../docs/evidence.ts');
  for (const [name, make] of FIXTURES) {
    const m = asIs(make());
    const doc = buildEvidence({ ...input(m), revisions: [{ revNo: 1, state: 'working', createdAt: '2026-11-16T10:00:00Z', approvedAt: null, approvedBy: null }], revNo: 1,
      allSources: [{ key: 'S1', title: 'SOP', kind: 'Word document', createdAt: '2026-11-16T09:00:00Z', passages: 4, archived: false }], proposals: [], boardStatus: {}, testEdits: [], comments: [], names: {} });
    assert.deepEqual(doc.sections.filter(s => s.level === 1).map(s => s.title), ['What this pack covers', 'The sources', 'The process and where each part came from', 'Review comments', 'What is not evidenced'], name);
    for (const x of ourText(doc as never, m)) assert.doesNotMatch(x, FORBIDDEN, `${name}: "${x}"`);
    const rows = doc.sections.find(s => s.title === 'The process and where each part came from')!.blocks.flatMap(b => (b.kind === 'table' ? b.rows : []));
    assert.equal(rows.filter(r => /^Step /.test(r[0]!.text)).length, m.steps.length, name);
  }
});

test('the note after an edit or a delete names only the process document', async () => {
  const { changeImpact } = await import('../docs/impact.ts');
  const before = asIs(gold());
  const after = structuredClone(before);
  after.steps[0]!.name = `${after.steps[0]!.name} (checked)`;
  const ctx = { decisions: emptyDecisions(), requirements: [], proposals: [] };
  const i = changeImpact(before, after, ctx);
  assert.deepEqual([i.verdict, i.steps, i.requirements, i.workItems], [null, [], [], []]);
  assert.deepEqual(i.documents.map(d => d.type), ['pdd']);
  // Assessed, the same edit reaches the other documents too.
  const j = changeImpact(gold(), { ...structuredClone(gold()), steps: after.steps }, ctx);
  assert.ok(j.documents.length > 1 || j.requirements.length > 0);
});

test('the delivery plan of a process documented as it is: one document, and why', async () => {
  const { deliveryPlan, briefLines } = await import('./delivery.ts');
  const m = asIs(gold());
  const p = deliveryPlan(m, assessProcess(m));
  assert.deepEqual(p.docs.map(d => [d.doc, d.planned]), [['pdd', true]]);
  assert.match(p.why, /documented as it is/);
  assert.equal(p.expectation, null);
  assert.ok(!briefLines(m).some(l => l.key === 'inMind' || l.key === 'documents'));
  assert.ok(briefLines(gold()).some(l => l.key === 'inMind'));
});

test('Ask Avala on a process documented as it is: no score, ranking or recommendation is sent at all', async () => {
  const { askFacts } = await import('../assistant/ask.ts');
  const m = asIs(gold());
  const a = assessProcess(m);
  const facts = askFacts('Why is this the recommended approach?', { model: m, assessment: a, requirements: [{ code: 'FR-001', statement: 'x' }], overrides: [{ stepId: m.steps[0]!.id, approach: 'rpa', rationale: 'because' }] });
  assert.ok(!facts.some(f => f.id.startsWith('a:') || f.id.startsWith('r:')), 'no assessment, override or requirement fact');
  assert.ok(facts.some(f => f.id === 'f:purpose' && /not assessed/.test(f.text)));
  assert.ok(facts.some(f => f.id === 'h:purpose'));
  const own = askFacts('x', { model: gold(), assessment: assessProcess(gold()) });
  assert.ok(own.some(f => f.id === 'a:verdict') && !own.some(f => f.id === 'f:purpose'));
});

test('Ask Avala on the workspace: a process documented as it is is summed up with no score or place', async () => {
  const { workspaceFacts } = await import('../assistant/workspace.ts');
  const facts = workspaceFacts('Where does each process stand?', {
    workspace: { name: 'W' }, processesInUse: true, portfolio: null, applications: [], people: [], boards: [], today: '2026-11-16',
    processes: [{ id: 'p1', name: 'Visitor sign-in', status: 'Working draft', openQuestions: 1, proposalsWaiting: 2, named: { analyst: null, architect: null, approver: null }, card: null, systems: [], purpose: 'as_is' }],
  } as never);
  const p = facts.find(f => f.id.endsWith('p:p1'))!;
  assert.match(p.text, /documented as it is, not assessed/);
  assert.doesNotMatch(p.text, /proposal|leads|portfolio|hours/);
});

test('documented as it is: a question in free words about automation is not asked, counted or printed; it stays on the record', async () => {
  const { aboutAutomation } = await import('./purpose.ts');
  const { addQuestion } = await import('../processModel/patch.ts');
  // Whole words only, and when unsure the question is kept.
  for (const t of ['Where should automation be applied, if at all?', 'Can a bot read the invoices?', 'Is RPA allowed on SAP?', 'Should an AI agent route the exceptions?', 'Will the supplier API be exposed for the integration?']) assert.equal(aboutAutomation(t), true, t);
  for (const t of ['Are both teams involved in the approval?', 'What can SAP and IT enable for the process?', 'Which API does the portal use today?', 'Who runs the robotics lab?']) assert.equal(aboutAutomation(t), false, t);
  let m = gold();
  for (const question of ['Where should automation be applied, if at all?', 'Are both teams involved in the approval?', 'What can SAP and IT enable for the process?']) m = addQuestion(m, { target: { kind: 'meta' }, question }).model;
  const asked = asIs(m);
  const items = triage(asked, assessProcess(asked)).items.map(i => i.question);
  assert.ok(!items.includes('Where should automation be applied, if at all?'));
  assert.ok(items.includes('Are both teams involved in the approval?') && items.includes('What can SAP and IT enable for the process?'));
  const open = buildPdd(input(asked)).openItems.map(o => o.text);
  assert.ok(!open.includes('Where should automation be applied, if at all?'));
  assert.ok(open.includes('Are both teams involved in the approval?'));
  // Kept on the record, and asked again once the process is assessed.
  assert.ok(asked.openQuestions.some(q => q.question === 'Where should automation be applied, if at all?' && q.status === 'open'));
  assert.ok(triage(m, assessProcess(m)).items.some(i => i.question === 'Where should automation be applied, if at all?'));
  // A question tied to a fact is never touched by the words.
  assert.equal(asksQuestion(asked, { target: { kind: 'step', id: asked.steps[0]!.id, field: 'roleIds' }, question: 'Who does "Automate the posting"?' }), true);
});
