import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastChanged } from './changed.ts';

test('an edit to the working draft moves "Changed … ago", though the process row did not change', () => {
  const process = '2026-11-13T09:00:00Z';
  const revisions = [{ state: 'working' as const, createdAt: '2026-11-13T09:00:00Z', updatedAt: '2026-11-17T10:58:00Z' }];
  assert.equal(lastChanged(process, revisions), '2026-11-17T10:58:00Z');
});

test('a change to the process itself after the last edit counts, and an approval counts by when the revision was made', () => {
  assert.equal(lastChanged('2026-11-17T12:00:00Z', [{ state: 'working', createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-16T00:00:00Z' }]), '2026-11-17T12:00:00Z');
  assert.equal(lastChanged('2026-11-01T00:00:00Z', [{ state: 'approved', createdAt: '2026-11-05T00:00:00Z' }]), '2026-11-05T00:00:00Z');
  assert.equal(lastChanged('2026-11-01T00:00:00Z', []), '2026-11-01T00:00:00Z');
  assert.equal(lastChanged(null, []), null);
});
