import { test } from 'node:test';
import assert from 'node:assert/strict';
import { releaseDates, releaseDatesReport } from './releaseDates.ts';

test('the four dates a release sets, by name and place', () => {
  assert.deepEqual(releaseDates().map(d => d.where), ['UPDATED.privacy in domain/site/trust.ts', 'UPDATED.terms in domain/site/trust.ts', 'UPDATED.security in domain/site/trust.ts', 'COVERAGE_RULE.since in domain/assess/coverage.ts', 'EVIDENCE_KEPT_SINCE in domain/docs/versions.ts']);
});

test('every date set: the check passes and lists them', () => {
  const r = releaseDatesReport(releaseDates().map(d => ({ ...d, value: '22 November 2026' })));
  assert.equal(r.ok, true);
  assert.equal(r.lines[0], 'Release dates set: every date the release sets is filled in.');
  assert.equal(r.lines.length, 6);
});

test('a date left empty: the check fails and says which one and where, in plain words', () => {
  const dates = releaseDates().map(d => ({ ...d, value: d.where.startsWith('UPDATED.privacy') ? null : '22 November 2026' }));
  const r = releaseDatesReport(dates);
  assert.equal(r.ok, false);
  assert.deepEqual(r.lines, [
    'Release dates not set: 1 of 5 still shows "[release date]".',
    '- the privacy page\'s "Last updated" date is empty. Set UPDATED.privacy in domain/site/trust.ts to the release date.',
    'Set them in the release\'s own commit (docs/next-plan.md, "Before the release").',
  ]);
  const all = releaseDatesReport(releaseDates().map(d => ({ ...d, value: null })));
  assert.equal(all.lines[0], 'Release dates not set: 5 of 5 still show "[release date]".');
  assert.equal(all.lines.length, 7);
});
