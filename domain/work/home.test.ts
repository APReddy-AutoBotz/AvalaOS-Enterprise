import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../workitems/board.ts';
import { dutyOf, homeSummary, itemsFor, namedOn, needsByProcess, needsFor, openOn, processesFor, type Person, type ProcessFacts } from './home.ts';

const ba: Person = { userId: 'ba', access: 'editor', canApprove: false, job: 'business_analyst' };
const sa: Person = { userId: 'sa', access: 'editor', canApprove: false, job: 'solution_architect' };
const dev: Person = { userId: 'dev', access: 'editor', canApprove: false, job: 'developer' };
const approver: Person = { userId: 'ap', access: 'viewer', canApprove: true, job: 'approver' };
const viewer: Person = { userId: 'vw', access: 'viewer', canApprove: false, job: null };
const admin: Person = { userId: 'ad', access: 'admin', canApprove: true, job: null };

const proc = (more: Partial<ProcessFacts> = {}): ProcessFacts => ({ id: 'p1', name: 'Vendor invoices', analystId: null, architectId: null, approverId: null, status: 'draft', openQuestions: 3, proposalsWaiting: 5, ...more });

test('a named person gets only their own duty; others do not, even with the matching job', () => {
  const p = proc({ analystId: 'ba', architectId: 'sa', approverId: 'ap' });
  assert.deepEqual(needsFor(ba, [p]).map(n => n.duty), ['analyst']);
  assert.deepEqual(needsFor(sa, [p]).map(n => n.duty), ['architect']);
  assert.deepEqual(needsFor(approver, [p]).map(n => n.duty), ['approver']);
  assert.deepEqual(needsFor({ ...ba, userId: 'other-ba' }, [p]), []);
  assert.equal(needsFor(ba, [p])[0]!.unassigned, false);
});

test('a duty nobody holds shows to everyone with the matching role, marked unassigned', () => {
  const p = proc();
  assert.deepEqual(needsFor(ba, [p]).map(n => [n.duty, n.unassigned]), [['analyst', true]]);
  assert.deepEqual(needsFor(sa, [p]).map(n => [n.duty, n.unassigned]), [['architect', true]]);
  assert.deepEqual(needsFor(approver, [p]).map(n => [n.duty, n.unassigned]), [['approver', true]]);
  assert.deepEqual(needsFor(admin, [p]).map(n => n.duty), ['analyst', 'architect', 'approver']);
  assert.deepEqual(needsFor(dev, [p]), []);
  assert.deepEqual(needsFor(viewer, [p]), []);
});

test('entries come from the process state and vanish when it is done', () => {
  const texts = (p: ProcessFacts) => needsFor(admin, [p]).map(n => n.text);
  assert.deepEqual(texts(proc({ status: 'none', openQuestions: 0, proposalsWaiting: 0 })), ['Add sources and start the process model']);
  assert.deepEqual(texts(proc({ status: 'approved', openQuestions: 1, proposalsWaiting: 1 })), ['1 open question to answer', '1 work item waiting to be confirmed to the board']);
  assert.deepEqual(texts(proc({ status: 'approved', openQuestions: 0, proposalsWaiting: 0 })), []);
  assert.deepEqual(texts(proc({ status: 'changed', openQuestions: 0, proposalsWaiting: 0 })), ['Changes since the approved revision are waiting for approval']);
});

test('an entry opens the stage where the work is done', () => {
  assert.deepEqual(needsFor(admin, [proc()]).map(n => n.stage), ['documents', 'work-items', 'process']);
});

test('a named approver without approval rights is not given the duty', () => {
  assert.equal(dutyOf(viewer, { analystId: null, architectId: null, approverId: viewer.userId }, 'approver'), 'named');
  assert.equal(dutyOf(viewer, { analystId: null, architectId: null, approverId: null }, 'approver'), null);
});

test('processes: mine are those I am named on; unnamed ones are listed for editors and admins only', () => {
  const ps = [proc({ id: 'a', analystId: 'ba' }), proc({ id: 'b' }), proc({ id: 'c', architectId: 'sa' })];
  assert.deepEqual(processesFor(ba, ps).mine.map(p => p.id), ['a']);
  assert.deepEqual(processesFor(ba, ps).unassigned.map(p => p.id), ['b']);
  assert.deepEqual(processesFor(viewer, ps).unassigned, []);
});

const item = (id: string, more: Partial<WorkItem>): WorkItem => ({ id, projectId: 'p', parentId: null, type: 'task', title: id, description: '', acceptance: [], status: 'todo', priority: null, ownerId: 'dev', estimateHours: null, startDate: null, dueDate: null, processId: null, stepIds: [], requirements: [], snapshot: {}, updatedAt: '', ...more });

test('my items: only mine, open, not epics; overdue first, then soonest due, then priority', () => {
  const items = [
    item('later', { dueDate: '2026-12-20' }), item('overdue', { dueDate: '2026-11-01' }), item('soon-low', { dueDate: '2026-11-20', priority: 'low' }), item('soon-high', { dueDate: '2026-11-20', priority: 'high' }),
    item('undated', {}), item('done', { status: 'done' }), item('theirs', { ownerId: 'x' }), item('epic', { type: 'epic' }),
  ];
  const out = itemsFor('dev', items, '2026-11-13');
  assert.deepEqual(out.map(o => o.item.id), ['overdue', 'soon-high', 'soon-low', 'later', 'undated']);
  assert.deepEqual(out.map(o => o.overdue), [true, false, false, false, false]);
});

test('needs are grouped by process, in the order the processes appear', () => {
  const needs = needsFor(admin, [proc(), proc({ id: 'p2', name: 'Refunds', status: 'none', openQuestions: 0, proposalsWaiting: 0 })]);
  const groups = needsByProcess(needs);
  assert.deepEqual(groups.map(g => [g.processName, g.needs.length]), [['Vendor invoices', 3], ['Refunds', 1]]);
});

test('the summary counts what the page lists, and says so when nothing waits', () => {
  const two = needsFor(admin, [proc(), proc({ id: 'p2', name: 'Refunds', status: 'none', openQuestions: 0, proposalsWaiting: 0 })]);
  assert.equal(homeSummary(two, []), '4 things need you across 2 processes.');
  const one = needsFor(admin, [proc({ status: 'approved', proposalsWaiting: 0 })]);
  assert.equal(homeSummary(one, [{ overdue: true }, { overdue: false }]), '1 thing needs you on Vendor invoices. 2 board items are yours, 1 overdue.');
  assert.equal(homeSummary([], [{ overdue: false }]), '1 board item is yours.');
  assert.equal(homeSummary([], []), 'Nothing needs you right now.');
});

test('a process row says what is open, from counts only', () => {
  assert.deepEqual(openOn(proc()), ['3 open questions', '5 work items to confirm']);
  assert.deepEqual(openOn(proc({ status: 'none', openQuestions: 0, proposalsWaiting: 0 })), ['No sources yet']);
  assert.deepEqual(openOn(proc({ status: 'approved', openQuestions: 1, proposalsWaiting: 0 })), ['1 open question']);
  assert.deepEqual(openOn(proc({ status: 'approved', openQuestions: 0, proposalsWaiting: 0 })), []);
});

test('the people named on a process: each once, with every duty they hold', () => {
  assert.deepEqual(namedOn(proc({ analystId: 'ba', architectId: 'sa', approverId: 'ba' })), [{ userId: 'ba', duties: ['analyst', 'approver'] }, { userId: 'sa', duties: ['architect'] }]);
  assert.deepEqual(namedOn(proc()), []);
});
