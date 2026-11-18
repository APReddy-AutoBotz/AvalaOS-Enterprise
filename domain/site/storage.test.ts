import test from 'node:test';
import assert from 'node:assert/strict';
import { keysToForget } from './storage.ts';

test('sign-out removes what was found in the sources and which processes were opened, never preferences', () => {
  const held = ['avala:source-look:p1', 'avala:dismissed:p1', 'avala:map-shape:p2', 'avala.journey.workspace', 'avala.journey.processes.view', 'avala:map-across', 'sb-abc-auth-token', 'other'];
  assert.deepEqual(keysToForget(held), ['avala:source-look:p1', 'avala:dismissed:p1', 'avala:map-shape:p2', 'avala.journey.workspace']);
  assert.deepEqual(keysToForget([]), []);
});
