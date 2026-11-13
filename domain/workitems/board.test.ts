import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, planningLine, upstreamChanges, validateEdit, validateProjectName, type WorkItem } from './board.ts';

const item: WorkItem = { id: 'w1', projectId: 'p', parentId: null, type: 'story', title: 'Post invoice', description: '', acceptance: ['a', 'b'], status: 'todo', priority: null, ownerId: null, estimateHours: null, startDate: null, dueDate: null, processId: 'pr', stepIds: ['s2'], requirements: ['FR-002', 'FR-003'], snapshot: { 'FR-002': 'The solution shall post invoice in SAP.', 'FR-003': 'The solution shall check totals.' }, updatedAt: '' };

test('upstream changed: a changed or removed requirement is shown with before and after; unchanged ones are not', () => {
  const ch = upstreamChanges(item, [{ code: 'FR-002', statement: 'The solution shall post the invoice in SAP with the PDF.', state: 'active' }, { code: 'FR-003', statement: 'The solution shall check totals.', state: 'active' }]);
  assert.deepEqual(ch, [{ code: 'FR-002', before: 'The solution shall post invoice in SAP.', after: 'The solution shall post the invoice in SAP with the PDF.' }]);
  assert.deepEqual(upstreamChanges(item, [{ code: 'FR-003', statement: 'The solution shall check totals.', state: 'active' }]).map(c => [c.code, c.after]), [['FR-002', null]]);
  assert.deepEqual(upstreamChanges({ ...item, snapshot: {} }, []), []);
});

test('edits: owner, estimate and dates may stay empty; dates in order; a title is required', () => {
  assert.equal(planningLine(item), 'Unassigned · Not estimated · No date');
  assert.equal(planningLine({ ...item, ownerId: 'u', estimateHours: 8, dueDate: '2026-12-01' }, 'Priya'), 'Priya · 8 h · Due 2026-12-01');
  assert.throws(() => validateEdit(item, { title: ' ' }), BoardError);
  assert.throws(() => validateEdit(item, { startDate: '2026-12-02', dueDate: '2026-12-01' }), BoardError);
  assert.throws(() => validateEdit(item, { status: 'nowhere' as any }), BoardError);
  assert.deepEqual(validateEdit(item, { status: 'in_progress', estimateHours: null }), { status: 'in_progress', estimateHours: null });
  assert.equal(validateProjectName('  AP automation '), 'AP automation');
});
