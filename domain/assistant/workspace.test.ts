// Ask Avala on the whole workspace: one summary per process, the portfolio, the applications list, the
// people by name and each board in short, all by rule; a process's own record only when the question names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askWorkspace, namedProcess, workspaceFacts, type WorkspaceContext, type WorkspaceProcess } from './workspace.ts';
import { askProcess, type Fact } from './ask.ts';
import { TASKS } from '../ai/tasks.ts';
import { WORK_OF_TASK } from '../ai/usage.ts';
import { answerAction, followUps, placeOf } from './present.ts';
import type { Application } from '../workspace/applications.ts';
import type { Portfolio } from '../assess/portfolio.ts';

const proc = (o: Partial<WorkspaceProcess> & { id: string; name: string }): WorkspaceProcess => ({
  status: 'Working draft', openQuestions: 0, proposalsWaiting: 0, named: { analyst: null, architect: null, approver: null }, card: null, systems: [], ...o,
});
const app = (o: Partial<Application> & { id: string; name: string }): Application => ({ aliases: [], kind: 'erp', access: [], uiAllowed: null, remote: null, notes: '', ...o } as Application);

const vendor = proc({
  id: 'p1', name: 'Vendor invoice processing (India, company code 1000)', status: 'Approved revision 2', openQuestions: 3, proposalsWaiting: 2,
  named: { analyst: 'Meera Iyer', architect: null, approver: 'Rahul Deshpande' },
  card: { lead: 'rpa', fit: 0.75, hours: 2400, exact: false, steps: 20, split: { rules: 15, ai: 1, people: 4 } }, systems: ['SAP S/4HANA', 'ServiceNow'],
});
const onboarding = proc({ id: 'p2', name: 'Supplier onboarding', named: { analyst: 'Meera Iyer', architect: 'Arjun Rao', approver: null } });
const portfolio: Portfolio = {
  rows: [{ id: 'p1', name: vendor.name, rank: 1, lead: 'rpa', verdict: '', fit: 0.75, ease: 70, hours: 2400, exact: false, quadrant: 'quick_win', possible: ['quick_win'], readiness: 'ready', inputsKnown: 1, payback: null } as never],
  assessed: 1, totalHours: 2400, pareto: { ids: [], share: 0, of: 1 },
};
const ctx = (o: Partial<WorkspaceContext> = {}): WorkspaceContext => ({
  workspace: { name: 'Kaveri Foods' }, processesInUse: true, processes: [vendor, onboarding], portfolio,
  applications: [app({ id: 'a1', name: 'SAP S/4HANA', aliases: ['SAP'], uiAllowed: true })],
  people: [{ name: 'Rahul Deshpande', role: 'admin' }, { name: 'Meera Iyer', role: 'editor' }, { name: 'Guest Reader', role: 'viewer' }],
  boards: [{ id: 'b1', name: 'Invoice automation', items: [] }], today: '2026-11-14', ...o,
});
const text = (facts: Fact[], id: string) => facts.find(f => f.id === id)?.text ?? '';

test('the processes are summed up by rule: how many, where they stand, the split of steps, the portfolio and hours', () => {
  const f = workspaceFacts('Which processes are quick wins?', ctx());
  assert.equal(text(f, 'ws:processes'), 'The workspace "Kaveri Foods" has 2 processes: "Vendor invoice processing (India, company code 1000)", "Supplier onboarding". Where they stand: 1 approved revision 2, 1 working draft. 1 of them has steps to assess.');
  assert.equal(text(f, 'ws:split'), 'Across the 1 assessed process, people do 20 steps today: 15 would be done by rules (RPA or an API), 1 with AI and 4 would stay with people, following the approach in effect for each step.');
  assert.equal(text(f, 'ws:portfolio'), 'In the portfolio, ordered by placement then hours: 1. "Vendor invoice processing (India, company code 1000)" (quick win).');
  assert.match(text(f, 'ws:hours'), /up to 2,400 hours a year/);
  assert.equal(text(f, 'ws:pareto'), '', 'no 80/20 with only one valued process');
});

test('each process says where it stands, who is named, what is open, the assessment and its applications', () => {
  const f = workspaceFacts('x', ctx());
  const v = f.find(x => x.id === 'ws:p:p1')!;
  assert.equal(v.text, 'Process "Vendor invoice processing (India, company code 1000)": where it stands: Approved revision 2; analyst Meera Iyer, no architect named, approver Rahul Deshpande; 3 open questions; 2 work-item proposals waiting for review; Rule-based RPA leads; of 20 steps people do today, 15 by rules (RPA or an API), 1 with AI, 4 stay with people; automation could take up to 2,400 hours a year; in the portfolio 1 of 1, quick win; applications: SAP S/4HANA, ServiceNow.');
  assert.deepEqual(v.target, { kind: 'open-process', processId: 'p1' });
  assert.match(f.find(x => x.id === 'ws:p:p2')!.text, /no steps to assess yet/);
  assert.equal(text(f, 'ws:no-approver'), 'Processes with no approver named: "Supplier onboarding".');
  assert.equal(text(f, 'ws:no-analyst'), 'Every process has an analyst named.');
  assert.equal(text(f, 'ws:open'), '3 open questions across 1 process: "Vendor invoice processing (India, company code 1000)" 3.');
});

test('applications, people by name and access, and each board in short; never an email address', () => {
  const f = workspaceFacts('x', ctx());
  assert.equal(text(f, 'ws:apps'), 'The applications list has 1 application: "SAP S/4HANA".');
  assert.match(text(f, 'ws:app:a1'), /^Application "SAP S\/4HANA" \(also called SAP\): robots may use its screens\. Used by "Vendor invoice processing/);
  assert.equal(text(f, 'ws:people'), 'The workspace has 3 people. Admins: Rahul Deshpande. Can edit: Meera Iyer. Can view only: Guest Reader.');
  assert.equal(text(f, 'ws:b:b1:summary'), 'The board "Invoice automation" has no items yet.');
  assert.equal(text(f, 'ws:b:b1:blocked'), 'On the board "Invoice automation": no item on the board is blocked.');
  for (const x of f) assert.doesNotMatch(x.text, /@|undefined|null\b/, x.id);
  assert.deepEqual(f.find(x => x.id === 'ws:people')!.target, { kind: 'people' });
});

test('where processes are not in use, none are listed; with no board it says so', () => {
  const f = workspaceFacts('x', ctx({ processesInUse: false, boards: [] }));
  assert.ok(!f.some(x => x.id.startsWith('ws:p') && x.id !== 'ws:people'));
  assert.equal(text(f, 'ws:boards'), 'The workspace has no Delivery board yet.');
});

test('a process is named only when the question names it, once, and its record opens inside that process', () => {
  const ps = [vendor, onboarding];
  assert.equal(namedProcess('What is still unknown about vendor invoice processing?', ps), 'p1');
  assert.equal(namedProcess('What about the vendor invoice process?', ps), 'p1', 'process for processing');
  assert.equal(namedProcess('Which processes are quick wins?', ps), null);
  assert.equal(namedProcess('Tell me about invoices', ps), null);
  assert.equal(namedProcess('Who approves supplier onboarding?', ps), 'p2');
  assert.equal(namedProcess('Compare supplier onboarding with vendor invoice processing', ps), null, 'two named: neither');
  const own: Fact[] = [{ id: 'f:step:s1', text: 'Step 1 "Log invoice".', label: 'Step', target: { kind: 'step', stepId: 's1' } }, { id: 'h:as-is', text: 'How', label: 'How', target: { kind: 'platform', stage: 'flows' } }];
  const f = workspaceFacts('steps of vendor invoice processing?', ctx(), { processId: 'p1', facts: own });
  const step = f.find(x => x.id === 'f:step:s1')!;
  assert.deepEqual(step.target, { kind: 'within', processId: 'p1', target: { kind: 'step', stepId: 's1' } });
  assert.equal(placeOf(step.target), 'process');
  assert.equal(f.filter(x => x.id === 'h:as-is').length, 1, 'the platform facts once');
});

test('the workspace task is registered, named in AI use, and keeps the process task\'s rules with its own line on the facts', () => {
  assert.equal(TASKS[askWorkspace.id], askWorkspace);
  assert.equal(WORK_OF_TASK[askWorkspace.id], 'Ask Avala');
  assert.deepEqual(askWorkspace.schema, askProcess.schema);
  assert.equal(askWorkspace.instructions.split('\n').length, askProcess.instructions.split('\n').length);
  assert.match(askWorkspace.instructions, /"ws:" are facts about this workspace/);
  assert.match(askWorkspace.instructions, /assessment was computed by fixed scoring tables/);
  assert.match(askWorkspace.instructions, /"context:"/);
  assert.doesNotMatch(askWorkspace.instructions, /this process's record/);
});

test('answers about the workspace lead to its pages, and follow-ups fit the workspace', () => {
  const f = workspaceFacts('x', ctx());
  const s = (id: string) => ({ text: 't', quote: 'q', fact: f.find(x => x.id === id)!, group: '' });
  assert.deepEqual(answerAction({ lead: null, missing: '', sentences: [s('ws:p:p1')] }, ['process']), { label: 'Open the process', target: { kind: 'open-process', processId: 'p1' } });
  assert.deepEqual(answerAction({ lead: null, missing: '', sentences: [s('ws:apps')] }, []), { label: 'Open the applications list', target: { kind: 'applications' } });
  const next = followUps({ lead: null, missing: '', sentences: [s('ws:people')] }, ['Who are the admins of this workspace?'], ['process'], 2, 'workspace');
  assert.deepEqual(next, ['Which processes have no analyst named?', 'Which processes are quick wins?']);
  for (const q of followUps({ lead: null, missing: '', sentences: [] }, [], ['process'], 3, 'board')) assert.doesNotMatch(q, /this process/);
});

test('a large workspace keeps every count and sums up the processes the question names first', () => {
  const many = Array.from({ length: 70 }, (_, i) => proc({ id: `x${i}`, name: `Routine process ${i}` }));
  many.push(proc({ id: 'pay', name: 'Payroll run' }));
  const f = workspaceFacts('Who is named on payroll run?', ctx({ processes: many, portfolio: null }));
  assert.match(text(f, 'ws:processes'), /has 71 processes/);
  assert.equal(f.filter(x => x.id.startsWith('ws:p:')).length, 60);
  assert.ok(f.some(x => x.id === 'ws:p:pay'), 'the process the question names is kept');
  assert.equal(text(f, 'ws:more-processes'), '11 more processes are in the workspace and not summed up here.');
});
