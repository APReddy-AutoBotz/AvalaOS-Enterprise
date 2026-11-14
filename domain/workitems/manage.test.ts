// The board on its own: items a person adds, moves under another item, and deletes (as in Jira).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, allowedParents, deleteEffect, descendantsOf, MANUAL_TYPES, validateEdit, validateNewItem, type WorkItem } from './board.ts';

const mk = (id: string, type: WorkItem['type'], parentId: string | null = null, sortOrder = 0): WorkItem => ({
  id, projectId: 'p', parentId, type, title: id, description: '', acceptance: [], status: 'todo', priority: null, ownerId: null,
  estimateHours: null, startDate: null, dueDate: null, processId: null, stepIds: [], requirements: [], snapshot: {}, updatedAt: '', sortOrder,
});
const board = [mk('E1', 'epic', null, 1), mk('S1', 'story', 'E1', 2), mk('T1', 'task', 'S1', 3), mk('ST1', 'subtask', 'T1', 4), mk('B1', 'bug', null, 7), mk('E2', 'epic', null, 5)];

test('a person adds an epic, story, task, bug or sub-task; it starts in To do, last on the board', () => {
  assert.deepEqual([...MANUAL_TYPES], ['epic', 'story', 'task', 'bug', 'subtask']);
  const v = validateNewItem({ type: 'bug', title: '  Totals do not match  ', priority: 'high' }, board);
  assert.deepEqual(v, { type: 'bug', title: 'Totals do not match', description: '', parentId: null, ownerId: null, priority: 'high', estimateHours: null, startDate: null, dueDate: null, status: 'todo', sortOrder: 8 });
  assert.equal(validateNewItem({ type: 'story', title: 'Post invoice', parentId: 'E1', estimateHours: 3, startDate: '2026-11-16', dueDate: '2026-11-20' }, board).parentId, 'E1');
  assert.equal(validateNewItem({ type: 'epic', title: 'First epic' }, []).sortOrder, 1);
});

test('an item is checked before it is added', () => {
  const bad: [Parameters<typeof validateNewItem>[0], RegExp][] = [
    [{ type: 'task', title: '   ' }, /title/],
    [{ type: 'task', title: 'x'.repeat(301) }, /too long/],
    [{ type: 'spike' as any, title: 'x' }, /what kind/],
    [{ type: 'subtask', title: 'Check' }, /belongs to/],
    [{ type: 'subtask', title: 'Check', parentId: 'E1' }, /A sub-task cannot sit under an epic\./],
    [{ type: 'epic', title: 'x', parentId: 'E2' }, /epic cannot sit under/],
    [{ type: 'story', title: 'x', parentId: 'gone' }, /not on this board/],
    [{ type: 'task', title: 'x', estimateHours: -1 }, /hours/],
    [{ type: 'task', title: 'x', startDate: '2026-11-20', dueDate: '2026-11-16' }, /before the start/],
  ];
  for (const [n, msg] of bad) assert.throws(() => validateNewItem(n, board), (e: unknown) => e instanceof BoardError && msg.test(e.message), JSON.stringify(n));
});

test('where an item may sit follows Jira: epics on top, sub-tasks under work, never under itself', () => {
  assert.deepEqual(allowedParents('epic', board).map(i => i.id), []);
  assert.deepEqual(allowedParents('story', board).map(i => i.id), ['E1', 'E2']);
  assert.deepEqual(allowedParents('task', board).map(i => i.id), ['E1', 'S1', 'E2']);
  assert.deepEqual(allowedParents('subtask', board).map(i => i.id), ['S1', 'T1', 'B1']);
  assert.deepEqual([...descendantsOf('S1', board)].sort(), ['ST1', 'T1']);
  // A task cannot move under the story it holds up, if that story were under it.
  const loop = [mk('S9', 'story', null), mk('T9', 'task', 'S9')];
  assert.deepEqual(allowedParents('task', loop, 'T9').map(i => i.id), ['S9']);
});

test('moving an item under another is checked the same way; leaving it without a parent is fine except for sub-tasks', () => {
  const task = board.find(i => i.id === 'T1')!;
  assert.deepEqual(validateEdit(task, { parentId: 'E2' }, board), { parentId: 'E2' });
  assert.deepEqual(validateEdit(task, { parentId: '' }, board), { parentId: null });
  assert.throws(() => validateEdit(task, { parentId: 'ST1' }, board), BoardError);
  const sub = board.find(i => i.id === 'ST1')!;
  assert.throws(() => validateEdit(sub, { parentId: null }, board), /belongs to/);
  assert.throws(() => validateEdit(board[0], { parentId: 'E2' }, board), /epic cannot sit under/);
  // Edits that do not touch the parent need no board.
  assert.deepEqual(validateEdit(task, { title: ' New ' }), { title: 'New' });
});

test('deleting says what happens to the work under it', () => {
  assert.equal(deleteEffect(board.find(i => i.id === 'B1')!, board), 'Delete this bug? This cannot be undone.');
  assert.equal(deleteEffect(board[0], board), 'Delete this epic? This cannot be undone. The item directly under it stays on the board without a parent.');
  const two = [...board, mk('S2', 'story', 'E1')];
  assert.match(deleteEffect(two[0], two), /The 2 items directly under it stay on the board without a parent\./);
});
