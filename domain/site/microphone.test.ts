import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneProblem } from './microphone.ts';

test('a refused or missing microphone is said in plain words, and typing is always offered', () => {
  assert.match(microphoneProblem('NotAllowedError'), /not letting this page use the microphone/);
  assert.match(microphoneProblem('NotFoundError'), /No microphone was found/);
  for (const n of ['NotAllowedError', 'SecurityError', 'NotFoundError', 'NotReadableError', 'AbortError', undefined, 'Odd']) assert.match(microphoneProblem(n), /type the answer/i);
});
