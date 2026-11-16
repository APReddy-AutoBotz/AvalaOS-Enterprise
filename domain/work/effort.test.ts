import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { answerOrigin, durationText, effortLines, effortOf, effortTotals, NOT_RECORDED } from './effort.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const withQuestions = (m: ProcessModel, answers: (string | null)[]): ProcessModel => ({
  ...m, openQuestions: answers.map((a, i) => ({ id: `q${i}`, target: { kind: 'meta' as const, field: 'objective' }, question: `Q${i}`, whyItMatters: '', owner: null, status: a === null ? 'open' as const : a === 'deferred' ? 'deferred' as const : 'answered' as const, ...(a && a !== 'deferred' ? { answer: a } : {}) })),
});

test('where an answer came from: a source document, or a person (their words, their notes, a pack reply)', () => {
  assert.equal(answerOrigin('Vendor Master Data (from S2: "Vendor Master Data owns the master")'), 'source');
  assert.equal(answerOrigin('Yes (in their words: "we always call back")'), 'person');
  assert.equal(answerOrigin('Daily (from ans-1: "we run it every day")'), 'person');
  assert.equal(answerOrigin('Yes (from own-1: "it is daily")'), 'person');
  assert.equal(answerOrigin('Yes'), 'person');
});

test('read from the sources: time to the first draft, how it came, and every question counted by how it ended', () => {
  const m = withQuestions(gold(), ['A (from S1: "a")', 'B (in their words: "b")', 'deferred', null, null]);
  const e = effortOf({
    sources: [{ key: 'S2', createdAt: '2026-11-15T09:05:00Z' }, { key: 'S1', createdAt: '2026-11-15T09:00:00Z' }],
    edits: [{ origin: 'user', summary: 'Renamed a step', createdAt: '2026-11-15T10:00:00Z' }, { origin: 'extraction', summary: 'Model extracted from sources', createdAt: '2026-11-15T09:42:00Z' }],
    firstRevisionAt: '2026-11-15T09:40:00Z', model: m, plan: { now: 2, found: 1, wait: 9 }, documents: ['Process definition (PDD)', 'Solution design (SDD)'],
  });
  assert.equal(e.startedAt, '2026-11-15T09:00:00Z');
  assert.equal(e.minutesToDraft, 42);
  assert.equal(e.draftFrom, 'sources');
  // With the first list known, what is open is counted the way the screens count it, and the lines add up.
  assert.deepEqual([e.raised, e.answeredFromSources, e.answeredByPeople, e.deferred, e.stillOpen], [15, 1, 1, 1, 12]);
  assert.equal(e.raised, e.answeredFromSources + e.answeredByPeople + e.stillOpen + e.deferred);
  assert.equal(e.stillOpen, e.onlyPeopleNow! + e.foundToConfirm! + e.canWait!);
  // Without it, the same sums hold over the recorded questions alone.
  const bare = effortOf({ sources: [], edits: [], firstRevisionAt: null, model: m, documents: [] });
  assert.deepEqual([bare.raised, bare.answeredFromSources, bare.answeredByPeople, bare.deferred, bare.stillOpen], [5, 1, 1, 1, 2]);
  const lines = Object.fromEntries(effortLines(e).map(l => [l.key, l.value]));
  assert.equal(lines.draft, '42 minutes');
  assert.equal(lines.now, '2');
  assert.equal(lines.docs, 'Process definition (PDD), Solution design (SDD)');
});

test('other starts: own words, a typical process, by hand; nothing guessed when a record is missing', () => {
  const m = gold();
  assert.equal(effortOf({ sources: [{ key: 'own-1', createdAt: '2026-11-15T09:00:00Z' }], edits: [{ origin: 'extraction', summary: 'Model extracted from sources', createdAt: '2026-11-15T09:03:00Z' }], firstRevisionAt: null, model: m, documents: [] }).draftFrom, 'own_words');
  const t = effortOf({ sources: [], edits: [{ origin: 'user', summary: 'Started from a typical supplier invoice process (every item marked Typical until confirmed)', createdAt: '2026-11-15T09:01:00Z' }], firstRevisionAt: '2026-11-15T09:00:00Z', model: m, documents: [] });
  assert.equal(t.draftFrom, 'typical');
  assert.equal(t.minutesToDraft, 1);
  assert.equal(effortOf({ sources: [], edits: [{ origin: 'user', summary: 'Added a step', createdAt: '2026-11-15T09:01:00Z' }], firstRevisionAt: null, model: m, documents: [] }).draftFrom, 'by_hand');
  // A process from before history was kept: no times, no first list: said, not guessed.
  const old = effortOf({ sources: [], edits: [], firstRevisionAt: null, model: m, documents: ['PDD'] });
  const lines = Object.fromEntries(effortLines(old).map(l => [l.key, l.value]));
  assert.equal(lines.draft, 'No draft yet');
  assert.equal(lines.now, NOT_RECORDED);
  // A process with no steps has no documents ready.
  assert.deepEqual(effortOf({ sources: [], edits: [], firstRevisionAt: null, model: { ...m, steps: [] }, documents: ['PDD'] }).documents, []);
});

test('durations in words, and totals across processes with the middle time to a first draft', () => {
  assert.deepEqual([durationText(0), durationText(1), durationText(65), durationText(120), durationText(1500), durationText(2880)], ['under a minute', '1 minute', '1 hour 5 minutes', '2 hours', '1 day 1 hour', '2 days']);
  const base = { startedAt: null, draftAt: 'x', draftFrom: 'sources' as const, raised: 10, answeredByPeople: 2, answeredFromSources: 3, deferred: 0, stillOpen: 5, onlyPeopleNow: null, foundToConfirm: null, canWait: null, documents: ['PDD'] };
  const t = effortTotals([{ ...base, minutesToDraft: 10 }, { ...base, minutesToDraft: 30 }, { ...base, minutesToDraft: null, draftAt: null }, { ...base, minutesToDraft: 20 }]);
  assert.equal(t.medianMinutesToDraft, 20);
  assert.deepEqual([t.processes, t.withDraft, t.raised, t.answeredFromSources, t.documents], [4, 3, 40, 12, 4]);
});
