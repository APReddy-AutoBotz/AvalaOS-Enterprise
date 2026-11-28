import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IN_PROGRESS_LINE, perHourMessage, READING_LIMIT, readingRefusal, readStartAnswer, runUnderWay, startRefused, type RunFacts } from './startLimit.ts';
import { STALL_MS } from './failure.ts';

const RUN = '11111111-2222-4333-8444-555555555555';
const NOW = Date.parse('2026-11-26T12:00:00Z');
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const run = (over: Partial<RunFacts>): RunFacts => ({ id: RUN, processId: 'p1', createdBy: 'ana', status: 'done', createdAt: at(30), updatedAt: at(28), ...over });

test('the figures: 6 an hour per person, and a reading under way is one that moved within the stall time', () => {
  assert.equal(READING_LIMIT.perPersonHour, 6);
  assert.equal(READING_LIMIT.stallSeconds * 1000, STALL_MS);
});

test("the database's answer is read strictly; anything else is an error, never an admission", () => {
  assert.deepEqual(readStartAnswer({ admitted: true, run_id: RUN }), { admitted: true, runId: RUN });
  assert.deepEqual(readStartAnswer({ admitted: false, reason: 'in_progress', run_id: RUN }), { admitted: false, reason: 'in_progress', runId: RUN });
  assert.deepEqual(readStartAnswer({ admitted: false, reason: 'per_hour', retry_after: 600 }), { admitted: false, reason: 'per_hour', retryAfterSeconds: 600 });
  for (const bad of [null, {}, { admitted: true }, { admitted: true, run_id: 'x' }, { admitted: false, reason: 'per_hour', retry_after: 0 }, { admitted: false, reason: 'other' }, 'yes']) {
    assert.throws(() => readStartAnswer(bad), /extraction_start answered/);
  }
});

test('a refusal is answered in plain words: 409 with the reading to follow, or 429 with when to try again', () => {
  assert.equal(readingRefusal({ admitted: true, runId: RUN }), null);
  assert.deepEqual(readingRefusal({ admitted: false, reason: 'in_progress', runId: RUN }), { status: 409, code: 'READING_IN_PROGRESS', message: IN_PROGRESS_LINE, runId: RUN });
  assert.deepEqual(readingRefusal({ admitted: false, reason: 'per_hour', retryAfterSeconds: 600 }), {
    status: 429, code: 'READINGS_PER_HOUR', message: 'You have started 6 readings in the last hour. You can start the next one in 10 minutes.', retryAfterSeconds: 600,
  });
  assert.equal(perHourMessage(1), 'You have started 6 readings in the last hour. You can start the next one in 1 minute.');
  assert.equal(perHourMessage(61), 'You have started 6 readings in the last hour. You can start the next one in 2 minutes.');
  assert.equal(IN_PROGRESS_LINE, 'A reading of this process was already under way. Its result shows here when it is done.');
});

test('the page follows the reading a refusal names, and only for that refusal', () => {
  assert.equal(runUnderWay({ code: 'READING_IN_PROGRESS', runId: RUN }), RUN);
  assert.equal(runUnderWay({ code: 'READINGS_PER_HOUR', runId: RUN }), null);
  assert.equal(runUnderWay({ code: 'READING_IN_PROGRESS' }), null);
  assert.equal(runUnderWay({ code: 'READING_IN_PROGRESS', runId: 'not-an-id' }), null);
  assert.equal(runUnderWay(null), null);
});

test('in the browser, the same two rules in the same order as the database', () => {
  // Nothing under way and under the hour's limit: a start may go.
  assert.equal(startRefused([run({})], 'p1', 'ana', NOW), null);
  // A reading of the process under way blocks anyone, and the newest is named; done, failed and stopped do not block.
  const other = '99999999-2222-4333-8444-555555555555';
  const runs = [run({ status: 'done' }), run({ status: 'failed' }), run({ id: other, status: 'merging', createdAt: at(12), updatedAt: at(8) })];
  assert.equal(startRefused(runs, 'p1', 'ben', NOW), null, 'not moved for 8 minutes: stopped from outside');
  runs.push(run({ status: 'reviewing', createdAt: at(3), updatedAt: at(1), createdBy: 'ben' }));
  assert.deepEqual(startRefused(runs, 'p1', 'ana', NOW), { admitted: false, reason: 'in_progress', runId: RUN });
  assert.equal(startRefused(runs, 'p2', 'ana', NOW), null, 'another process is not held back');
  // Six in the last hour, in any process: the seventh waits until the oldest leaves the hour.
  const hour = [61, 50, 40, 30, 20, 10, 5].map((m, i) => run({ id: `${i}`, processId: `q${i}`, createdAt: at(m), updatedAt: at(m - 1) }));
  assert.deepEqual(startRefused(hour, 'p1', 'ana', NOW), { admitted: false, reason: 'per_hour', retryAfterSeconds: 600 });
  assert.equal(startRefused(hour, 'p1', 'ben', NOW), null, 'another person is not held back');
  assert.equal(startRefused(hour, 'p1', 'ana', NOW, 7), null);
});
