import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextQuestion, submitQuestion, waitingNote } from './queue.ts';

test('a question asked while the record is still being read is kept and asked when the panel is ready, in order', () => {
  // Still reading: kept, not lost.
  let s = { ready: false, busy: false, waiting: [] as string[] };
  let r = submitQuestion(s, 'Who owns this process?');
  assert.deepEqual(r, { ask: null, waiting: ['Who owns this process?'] });
  s = { ...s, waiting: r.waiting };
  r = submitQuestion(s, 'Which steps stay with people?');
  s = { ...s, waiting: r.waiting };
  assert.equal(nextQuestion(s).ask, null, 'nothing is asked before the record is read');
  // Ready: the first kept question goes, then the next once its answer is in.
  s = { ...s, ready: true };
  r = nextQuestion(s);
  assert.deepEqual(r, { ask: 'Who owns this process?', waiting: ['Which steps stay with people?'] });
  s = { ...s, busy: true, waiting: r.waiting };
  assert.equal(nextQuestion(s).ask, null);
  // A question typed while an answer is coming waits behind the one already kept.
  r = submitQuestion(s, 'What is still unknown?');
  assert.deepEqual(r.waiting, ['Which steps stay with people?', 'What is still unknown?']);
  s = { ...s, busy: false, waiting: r.waiting };
  assert.equal(nextQuestion(s).ask, 'Which steps stay with people?');
  // When the panel is free and nothing waits, a question goes at once.
  assert.deepEqual(submitQuestion({ ready: true, busy: false, waiting: [] }, 'Why?'), { ask: 'Why?', waiting: [] });
  // What a kept question says, never nothing.
  assert.match(waitingNote({ ready: false, failed: false }), /still reading the record/);
  assert.match(waitingNote({ ready: true, failed: false }), /asked next/);
  assert.match(waitingNote({ ready: false, failed: true }), /^Not asked/);
});
