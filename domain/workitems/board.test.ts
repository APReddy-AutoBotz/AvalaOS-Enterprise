import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, criterionParts, joinStory, lanesOf, planningFacts, planningLine, splitStory, type WorkItem, upstreamChanges, validateEdit, validateProjectName } from './board.ts';

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

test('lanes: epics head lanes and are not cards; work sits under its epic (through a parent story too); the rest goes last', () => {
  const mk = (id: string, type: WorkItem['type'], parentId: string | null, status: WorkItem['status'] = 'todo'): WorkItem => ({ ...item, id, type, parentId, status });
  const lanes = lanesOf([mk('e1', 'epic', null), mk('s1', 'story', 'e1', 'done'), mk('t1', 'subtask', 's1'), mk('e2', 'epic', null), mk('x', 'task', null), mk('y', 'task', 'gone')]);
  assert.deepEqual(lanes.map(l => [l.epic?.id ?? null, l.items.map(i => i.id), l.done]), [['e1', ['s1', 't1'], 1], ['e2', [], 0], [null, ['x', 'y'], 0]]);
  assert.equal(lanesOf([mk('e1', 'epic', null)]).length, 1);
});

test('the story line is split from the rest of a description and joined back unchanged', () => {
  const d = 'As the AP Clerk, I want the solution to log invoice, so that suppliers are paid on time.\n\nToday: keyed by hand.\nTarget: logged.';
  const { story, rest } = splitStory(d);
  assert.equal(story, 'As the AP Clerk, I want the solution to log invoice, so that suppliers are paid on time.');
  assert.equal(rest, 'Today: keyed by hand.\nTarget: logged.');
  assert.equal(joinStory(story, rest), d);
  assert.deepEqual(splitStory('Ask the SAP team.'), { story: null, rest: 'Ask the SAP team.' });
  assert.equal(joinStory(story, ''), story);
});

test('a card shows only what the team has set; a criterion is split at Given, when, then', () => {
  assert.deepEqual(planningFacts(item), { estimate: null, date: null });
  assert.deepEqual(planningFacts({ estimateHours: 8, startDate: null, dueDate: '2026-12-01' }), { estimate: '8 h', date: 'Due 1 Dec' });
  assert.deepEqual(criterionParts('Given a case, when it is posted, then the PDF is attached.')?.map(p => p.word), ['Given', 'when', 'then']);
  assert.equal(criterionParts('Every story in this epic meets its acceptance criteria.'), null);
});
