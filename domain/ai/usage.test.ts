import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage, tokenWords, workOf, type UsageRow } from './usage.ts';
import { TASKS } from './tasks.ts';
import { EXTRACTION_TASKS } from '../extract/tasks.ts';

const row = (at: string, task: string, tokens: number, extra: Partial<UsageRow> = {}): UsageRow =>
  ({ createdAt: at, task, userId: 'u1', inputTokens: tokens - 10, outputTokens: 10, status: 'ok', keySource: 'platform', ...extra });
const now = new Date('2026-11-14T09:30:00Z');

test('only this calendar month (UTC) counts; platform and own-key work are kept apart', () => {
  const s = summarizeUsage([
    row('2026-10-31T23:59:59Z', 'source_facts', 99_999),
    row('2026-11-01T00:00:00Z', 'source_facts', 1000),
    row('2026-11-13T12:00:00Z', 'stepTraits', 500, { keySource: 'workspace' }),
    row('2026-11-14T08:00:00Z', 'transcribe', 50, { status: 'provider_error' }),
  ], now, null);
  assert.deepEqual(s.platform, { tokens: 1050, calls: 2 });
  assert.deepEqual(s.own, { tokens: 500, calls: 1 });
  assert.equal(s.failed, 1);
  assert.equal(s.from, '2026-11-01T00:00:00.000Z');
  assert.equal(s.resetsOn, '2026-12-01T00:00:00.000Z');
  assert.equal(s.allowance, null);
});

test('the allowance counts only the platform key, prefers the server\'s own count, and warns near and at the limit', () => {
  const rows = [row('2026-11-02T00:00:00Z', 'source_steps', 1_500_000), row('2026-11-03T00:00:00Z', 'stepTraits', 900_000, { keySource: 'workspace' })];
  const s = summarizeUsage(rows, now, { budget: 2_000_000, used: null });
  assert.deepEqual(s.allowance, { budget: 2_000_000, used: 1_500_000, left: 500_000, share: 0.75, state: 'ok' });
  assert.equal(summarizeUsage(rows, now, { budget: 2_000_000, used: 1_700_000 }).allowance?.state, 'near');
  const over = summarizeUsage(rows, now, { budget: 2_000_000, used: 2_100_000 }).allowance!;
  assert.deepEqual([over.state, over.left], ['reached', 0]);
  assert.equal(summarizeUsage(rows, now, { budget: null, used: null }).allowance, null, 'own key: no allowance');
});

test('work is grouped in plain words and ordered by size; every day of the month so far is listed', () => {
  const s = summarizeUsage([
    row('2026-11-02T10:00:00Z', 'source_facts', 300), row('2026-11-02T11:00:00Z', 'merge_flow', 200),
    row('2026-11-05T10:00:00Z', 'stepTraits', 900), row('2026-11-05T10:00:00Z', 'mystery', 10, { userId: null }),
  ], now, null);
  assert.deepEqual(s.byWork, [
    { work: 'Finding facts for the assessment', tokens: 900, calls: 1 },
    { work: 'Reading sources', tokens: 500, calls: 2 },
    { work: 'Other AI work', tokens: 10, calls: 1 },
  ]);
  assert.equal(s.byDay.length, 14);
  assert.deepEqual(s.byDay[1], { day: '2026-11-02', tokens: 500 });
  assert.deepEqual(s.byDay[13], { day: '2026-11-14', tokens: 0 });
  assert.deepEqual(s.byPerson, [{ userId: 'u1', tokens: 1400, calls: 3 }, { userId: null, tokens: 10, calls: 1 }]);
});

test('every registered task has a name in plain words', () => {
  for (const id of [...Object.keys(TASKS), ...Object.values(EXTRACTION_TASKS).map(t => t.id), 'transcribe']) assert.notEqual(workOf(id), 'Other AI work', id);
});

test('token counts read at a glance', () => {
  assert.deepEqual([0, 950, 1000, 12_400, 151_000, 1_500_000, 2_000_000, 24_000_000].map(tokenWords),
    ['0', '950', '1 thousand', '12 thousand', '151 thousand', '1.5 million', '2 million', '24 million']);
});
