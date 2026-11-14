// What Ask Avala answers about follows where the person is; what is picked in the panel wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askable, askScope, pickOf } from './scope.ts';

const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';

test('on a process it asks about that process, on the board about that board; elsewhere it asks which', () => {
  assert.deepEqual(askScope({ page: 'process', processId: id, stage: 'assessment' }), { kind: 'process', processId: id });
  assert.deepEqual(askScope({ page: 'board', projectId: id }), { kind: 'board', projectId: id });
  assert.deepEqual(askScope({ page: 'board' }), { kind: 'board', projectId: null });
  for (const route of [{ page: 'work' }, { page: 'processes' }, { page: 'settings', section: 'people' }] as const) {
    assert.deepEqual(askScope(route), { kind: 'choose' }, route.page);
  }
});

test('a pick wins, for a process or a board, and round-trips through the picker', () => {
  assert.deepEqual(askScope({ page: 'processes' }, `p:${other}`), { kind: 'process', processId: other });
  assert.deepEqual(askScope({ page: 'process', processId: id, stage: 'process' }, `b:${other}`), { kind: 'board', projectId: other });
  for (const s of [{ kind: 'process' as const, processId: id }, { kind: 'board' as const, projectId: other }]) assert.deepEqual(askScope({ page: 'work' }, pickOf(s)), s);
  assert.equal(pickOf({ kind: 'board', projectId: null }), '');
  assert.equal(pickOf({ kind: 'choose' }), '');
});

test('a process can be asked about once it has steps', () => {
  assert.equal(askable(null), false);
  assert.equal(askable({ steps: [] }), false);
  assert.equal(askable({ steps: [{}] }), true);
});
