// Working together on a board item: comments, history in plain words, labels (as in Jira).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, boardLabels, parseLabels, validateEdit, validateNewItem, type WorkItem } from './board.ts';
import { commentRights, describeEvent, historyOrder, validateComment, type ItemEvent } from './collab.ts';

const names = {
  person: (id: string) => ({ u1: 'Ana Rao', u2: 'Ben Iyer' } as Record<string, string>)[id],
  item: (id: string) => (id === 'E1' ? { title: 'Checkout' } : undefined),
  sprint: (id: string) => (id === 'S1' ? 'Sprint 1' : undefined),
};
const ev = (field: ItemEvent['field'], oldValue: string | null, newValue: string | null, actorId: string | null = 'u1', id = '1', createdAt = '2026-11-14T10:00:00Z'): ItemEvent =>
  ({ id, workItemId: 'I', actorId, kind: field ? 'changed' : 'created', field, oldValue, newValue, createdAt });

test('a comment has text, within the limit; only its author edits it, the author or an admin deletes it', () => {
  assert.equal(validateComment('  Which cards?  '), 'Which cards?');
  assert.throws(() => validateComment('   '), BoardError);
  assert.throws(() => validateComment('x'.repeat(10001)), /too long/);
  assert.deepEqual(commentRights({ authorId: 'u1' }, 'u1', false), { edit: true, remove: true });
  assert.deepEqual(commentRights({ authorId: 'u1' }, 'u2', false), { edit: false, remove: false });
  assert.deepEqual(commentRights({ authorId: 'u1' }, 'u2', true), { edit: false, remove: true });
  assert.deepEqual(commentRights({ authorId: null }, 'u2', false), { edit: false, remove: false });
});

test('history reads as plain sentences, with names, never ids', () => {
  const d = (e: ItemEvent) => { const r = describeEvent(e, names); return `${r.who} ${r.text}`; };
  assert.equal(d(ev(null, null, null)), 'Ana Rao created this item');
  assert.equal(d(ev('status', 'todo', 'in_progress')), 'Ana Rao changed the status from To do to In progress');
  assert.equal(d(ev('owner', null, 'u2')), 'Ana Rao set the owner to Ben Iyer');
  assert.equal(d(ev('owner', 'u2', null)), 'Ana Rao unassigned Ben Iyer');
  assert.equal(d(ev('owner', 'gone', 'u2', 'u2')), 'Ben Iyer changed the owner from a former member to Ben Iyer');
  assert.equal(d(ev('parent', 'gone', 'E1')), 'Ana Rao changed the parent from a deleted item to Checkout');
  assert.equal(d(ev('sprint', null, 'S1')), 'Ana Rao set the sprint to Sprint 1');
  assert.equal(d(ev('priority', 'high', null)), 'Ana Rao cleared the priority (was High)');
  assert.equal(d(ev('type', 'task', 'bug')), 'Ana Rao changed the kind from Task to Bug');
  assert.equal(d(ev('estimate', '3.00', '4.50')), 'Ana Rao changed the estimate from 3 h to 4.5 h');
  assert.equal(d(ev('labels', null, 'payments q4')), 'Ana Rao set the labels to payments, q4');
  assert.equal(d(ev('description', null, null)), 'Ana Rao changed the description');
  assert.equal(d(ev('status', 'todo', 'done', null)), 'Avala OS changed the status from To do to Done');
  assert.equal(d(ev('status', 'todo', 'done', 'left')), 'A former member changed the status from To do to Done');
});

test('history is newest first; changes saved together keep their order', () => {
  const list = [ev('status', 'todo', 'done', 'u1', '5', '2026-11-14T10:00:00Z'), ev('owner', null, 'u1', 'u1', '6', '2026-11-14T10:00:00Z'), ev(null, null, null, 'u1', '2', '2026-11-13T09:00:00Z'), ev('title', 'a', 'b', 'u1', '9', '2026-11-15T09:00:00Z')];
  assert.deepEqual(historyOrder(list).map(e => e.id), ['9', '5', '6', '2']);
});

test('labels as in Jira: separated by spaces or commas, repeats dropped, limits kept', () => {
  assert.deepEqual(parseLabels(' payments, Q4-release  payments\tq4-RELEASE ,'), ['payments', 'Q4-release']);
  assert.deepEqual(parseLabels(['a b', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(parseLabels(''), []);
  assert.throws(() => parseLabels('x'.repeat(41)), /at most 40 characters/);
  assert.throws(() => parseLabels(Array.from({ length: 21 }, (_, i) => `l${i}`)), /at most 20 labels/);
  const mk = (labels: string[]) => ({ labels }) as Pick<WorkItem, 'labels'>;
  assert.deepEqual(boardLabels([mk(['b', 'a']), mk(['a']), mk([]), {} as Pick<WorkItem, 'labels'>]), ['a', 'b']);
  const item = { id: 'I', type: 'task', startDate: null, dueDate: null } as unknown as WorkItem;
  assert.deepEqual(validateEdit(item, { labels: ['ui', 'UI', 'api'] }).labels, ['ui', 'api']);
  assert.deepEqual(validateNewItem({ type: 'task', title: 't', labels: ['x,y'] }, []).labels, ['x', 'y']);
});

test('the in-browser store records the same history rows as the database', async () => {
  const { changedFields } = await import('./collab.ts');
  const a = { id: 'I', projectId: 'p', parentId: null, type: 'task', title: 'T', description: 'd', acceptance: [], status: 'todo', priority: null, ownerId: null,
    estimateHours: null, startDate: null, dueDate: null, processId: null, stepIds: [], requirements: [], snapshot: {}, updatedAt: '', sortOrder: 1, labels: [] } as WorkItem;
  assert.deepEqual(changedFields(a, { ...a, sortOrder: 4, updatedAt: 'x' }), []);
  assert.deepEqual(changedFields(a, { ...a, status: 'done', ownerId: 'u1', description: 'long', labels: ['ui'], estimateHours: 2 }), [
    { field: 'status', oldValue: 'todo', newValue: 'done' },
    { field: 'owner', oldValue: null, newValue: 'u1' },
    { field: 'estimate', oldValue: null, newValue: '2' },
    { field: 'labels', oldValue: '', newValue: 'ui' },
    { field: 'description', oldValue: null, newValue: null },
  ]);
});
