// Package B, pull request 1: the cap on one session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterCall, afterReading, canReadWords, canUpdateDraft, capReached, NO_USE, SESSION_CAP } from './limits.ts';

test('the cap: 250,000 tokens, 60 calls of the panel\'s own, three readings, whichever comes first', () => {
  assert.deepEqual(SESSION_CAP, { tokens: 250_000, calls: 60, readings: 3 });
  let u = NO_USE;
  u = afterCall(u, { input: 1191, output: 137 });
  u = afterCall(u, null);
  assert.deepEqual(u, { tokens: 1328, calls: 2, readings: 0 });
  assert.equal(capReached(u), null);
  assert.ok(canReadWords(u) && canUpdateDraft(u));
  // Calls: words stop, the draft may still be updated.
  let calls = NO_USE;
  for (let i = 0; i < 60; i++) calls = afterCall(calls, { input: 10, output: 10 });
  assert.equal(capReached(calls), 'calls');
  assert.equal(canReadWords(calls), false);
  assert.equal(canUpdateDraft(calls), true);
  // Readings: the first and two updates.
  const reads = afterReading(afterReading(afterReading(NO_USE, 30_000), 40_000), 40_000);
  assert.equal(capReached(reads), 'readings');
  assert.equal(canUpdateDraft(reads), false);
  // Tokens: everything that reads stops.
  const tokens = afterReading(NO_USE, 250_000);
  assert.equal(capReached(tokens), 'tokens');
  assert.equal(canReadWords(tokens) || canUpdateDraft(tokens), false);
  // A reply with negative figures counts nothing off.
  assert.equal(afterCall(NO_USE, { input: -5, output: -5 }).tokens, 0);
});
