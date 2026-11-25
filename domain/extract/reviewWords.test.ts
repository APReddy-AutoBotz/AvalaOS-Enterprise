import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingWhen, REVIEW_WORDS } from './reviewWords.ts';

test('the review says when it was read in the product\'s own form, with the 24-hour clock', () => {
  assert.equal(readingWhen('2026-11-25T15:40:00.000Z', 'Asia/Kolkata'), '25 November 2026 at 21:10');
  assert.equal(readingWhen('2026-11-25T09:05:00.000Z', 'UTC'), '25 November 2026 at 09:05');
  assert.equal(readingWhen('not a date'), '');
});

test('the review\'s lines: no "extraction", no "model"; Discovery\'s says it read the answers', () => {
  const at = readingWhen('2026-11-25T15:40:00.000Z', 'Asia/Kolkata');
  assert.equal(REVIEW_WORDS.again(at, 4, true), 'Read again with your answers on 25 November 2026 at 21:10. It differs from the draft in 4 places: choose what to take.');
  assert.equal(REVIEW_WORDS.again(at, 1), 'Read again on 25 November 2026 at 21:10. It differs from the draft in 1 place: choose what to take.');
  assert.equal(REVIEW_WORDS.first(at, 12, 1, 3), 'Read on 25 November 2026 at 21:10: 12 steps, 1 role and 3 applications.');
  for (const line of [REVIEW_WORDS.heading, REVIEW_WORDS.comparing, REVIEW_WORDS.matches, REVIEW_WORDS.again(at, 2, true), REVIEW_WORDS.first(at, 2, 2, 2)]) {
    assert.equal(/extraction|model/i.test(line), false, line);
  }
});
