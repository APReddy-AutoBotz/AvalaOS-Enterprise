// Sprints as in Jira's Scrum boards: planned, one active at a time, completed with the open work moved on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, validateEdit, type WorkItem } from './board.ts';
import { closeEffect, daysLeft, daysLeftText, defaultView, inView, moveTargets, nextSprintName, sprintChoices, sprintOrder, sprintSummary, startProblem, validateSprint, type Sprint } from './sprints.ts';

const sp = (id: string, state: Sprint['state'], extra: Partial<Sprint> = {}): Sprint =>
  ({ id, projectId: 'p', name: id, goal: '', startsOn: null, endsOn: null, state, startedAt: null, closedAt: null, ...extra });
const it = (id: string, sprintId: string | null, status: WorkItem['status'] = 'todo', type: WorkItem['type'] = 'story') =>
  ({ id, type, status, sprintId } as WorkItem);

test('a sprint has a name, an optional goal and dates that run forwards', () => {
  assert.deepEqual(validateSprint({ name: '  Sprint 1 ', goal: ' Card payments ', startsOn: '2026-11-16', endsOn: '2026-11-27' }), { name: 'Sprint 1', goal: 'Card payments', startsOn: '2026-11-16', endsOn: '2026-11-27' });
  assert.deepEqual(validateSprint({ name: 'S', startsOn: '' }), { name: 'S', goal: '', startsOn: null, endsOn: null });
  assert.throws(() => validateSprint({ name: ' ' }), /name/);
  assert.throws(() => validateSprint({ name: 'x'.repeat(121) }), /too long/);
  assert.throws(() => validateSprint({ name: 'S', startsOn: '2026-11-27', endsOn: '2026-11-16' }), /ends before it starts/);
});

test('new sprints are numbered on from the last; the list shows the running one first', () => {
  assert.equal(nextSprintName([]), 'Sprint 1');
  assert.equal(nextSprintName([{ name: 'Sprint 3' }, { name: 'Launch' }]), 'Sprint 4');
  assert.equal(nextSprintName([{ name: 'Alpha' }, { name: 'Beta' }]), 'Sprint 3');
  const list = [sp('old', 'closed', { closedAt: '2026-10-01' }), sp('p1', 'planned'), sp('run', 'active'), sp('older', 'closed', { closedAt: '2026-09-01' }), sp('p2', 'planned')];
  assert.deepEqual(sprintOrder(list).map(s => s.id), ['run', 'p1', 'p2', 'old', 'older']);
  assert.equal(defaultView(list), 'run');
  assert.equal(defaultView([sp('p1', 'planned')]), 'all');
});

test('one sprint runs at a time; a completed one does not start again', () => {
  const list = [sp('run', 'active', { name: 'Sprint 1' }), sp('next', 'planned')];
  assert.equal(startProblem(list[1]!, list), 'Complete Sprint 1 first: one sprint runs at a time on a board.');
  assert.equal(startProblem(sp('next', 'planned'), [sp('next', 'planned')]), null);
  assert.match(startProblem(sp('x', 'closed'), [])!, /cannot start again/);
  assert.match(startProblem(list[0]!, list)!, /already running/);
});

test('completing a sprint says what happens to its work', () => {
  const s1 = sp('s1', 'active', { name: 'Sprint 1' }), s2 = sp('s2', 'planned', { name: 'Sprint 2' });
  const items = [it('a', 's1', 'done'), it('b', 's1'), it('c', 's1', 'blocked'), it('d', null), it('e', 's2')];
  assert.deepEqual(sprintSummary(s1, items), { done: 1, open: 2, total: 3 });
  assert.deepEqual(moveTargets(s1, [s1, s2, sp('s0', 'closed')]).map(s => s.id), ['s2']);
  assert.equal(closeEffect(s1, items, s2), 'Complete Sprint 1? 2 unfinished items will move to Sprint 2. 1 done item stays with Sprint 1.');
  assert.equal(closeEffect(s1, items, null), 'Complete Sprint 1? 2 unfinished items will go back to the backlog. 1 done item stays with Sprint 1.');
  assert.equal(closeEffect(s1, [it('a', 's1', 'done')], null), 'Complete Sprint 1? 1 done item stays with Sprint 1.');
  assert.equal(closeEffect(s1, [], null), 'Complete Sprint 1? It has no work in it.');
});

test('the board shows everything, the backlog or one sprint; epics are not put in sprints', () => {
  assert.equal(inView(it('a', 's1'), 'all'), true);
  assert.equal(inView(it('a', null), 'backlog'), true);
  assert.equal(inView(it('a', 's1'), 'backlog'), false);
  assert.equal(inView(it('a', 's1'), 's1'), true);
  assert.equal(inView(it('a', 's2'), 's1'), false);
  const list = [sp('c', 'closed'), sp('p', 'planned'), sp('a', 'active')];
  assert.deepEqual(sprintChoices({ type: 'story' }, list).map(s => s.id), ['a', 'p']);
  assert.deepEqual(sprintChoices({ type: 'epic' }, list), []);
  const epic = { id: 'E', type: 'epic', startDate: null, dueDate: null } as unknown as WorkItem;
  assert.throws(() => validateEdit(epic, { sprintId: 'a' }), (e: unknown) => e instanceof BoardError && /epic is not put in a sprint/.test(e.message));
  assert.equal(validateEdit(epic, { sprintId: '' }).sprintId, null);
});

test('days left in the running sprint', () => {
  const s = (endsOn: string | null, state: Sprint['state'] = 'active') => ({ endsOn, state });
  assert.equal(daysLeft(s('2026-11-27'), '2026-11-14'), 13);
  assert.equal(daysLeft(s(null), '2026-11-14'), null);
  assert.equal(daysLeft(s('2026-11-27', 'planned'), '2026-11-14'), null);
  assert.deepEqual([13, 1, 0, -1, -3].map(daysLeftText), ['13 days left', '1 day left', 'Ends today', 'Ended 1 day ago', 'Ended 3 days ago']);
  assert.equal(daysLeftText(null), null);
});
