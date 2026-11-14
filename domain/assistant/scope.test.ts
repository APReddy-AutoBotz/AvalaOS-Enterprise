// What Ask Avala answers about follows where the person is; a process picked in the panel wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askable, askScope } from './scope.ts';

test('on a process it asks about that process; elsewhere it asks which one; a pick wins', () => {
  const id = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(askScope({ page: 'process', processId: id, stage: 'assessment' }), { kind: 'process', processId: id });
  for (const route of [{ page: 'work' }, { page: 'processes' }, { page: 'board' }, { page: 'settings', section: 'people' }] as const) {
    assert.deepEqual(askScope(route), { kind: 'choose' }, route.page);
  }
  assert.deepEqual(askScope({ page: 'processes' }, other), { kind: 'process', processId: other });
  assert.deepEqual(askScope({ page: 'process', processId: id, stage: 'process' }, other), { kind: 'process', processId: other });
});

test('a process can be asked about once it has steps', () => {
  assert.equal(askable(null), false);
  assert.equal(askable({ steps: [] }), false);
  assert.equal(askable({ steps: [{}] }), true);
});
