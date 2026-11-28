import test from 'node:test';
import assert from 'node:assert/strict';
import { keysToForget, NAME_LINE_CLOSED } from './storage.ts';

test('sign-out removes what was found in the sources and which processes were opened, never preferences', () => {
  const held = ['avala:source-look:p1', 'avala:dismissed:p1', 'avala:map-shape:p2', 'avala.journey.workspace', 'avala:call:p3', 'avala:name-line-closed', 'avala.journey.processes.view', 'avala:map-across', 'sb-abc-auth-token', 'other'];
  assert.deepEqual(keysToForget(held), ['avala:source-look:p1', 'avala:dismissed:p1', 'avala:map-shape:p2', 'avala.journey.workspace', 'avala:call:p3', 'avala:name-line-closed'], 'a call kept on the device goes too, and "Set your name" closed');
  assert.deepEqual(keysToForget([]), []);
});

test('"Set your name" closed holds no account id, and goes at sign-out', () => {
  assert.equal(NAME_LINE_CLOSED, 'avala:name-line-closed');
  assert.doesNotMatch(NAME_LINE_CLOSED, /[0-9a-f]{8}-[0-9a-f]{4}/);
  assert.deepEqual(keysToForget([NAME_LINE_CLOSED]), [NAME_LINE_CLOSED]);
});
