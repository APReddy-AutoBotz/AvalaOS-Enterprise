import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, startedReading, type SessionState } from './session.ts';
import { unreadAnswers, unreadLine, updateReads, type SourceFacts } from './unread.ts';
import { ANSWERS_KIND } from './answers.ts';

const STARTED = '2026-11-26T10:00:00.000Z';
const src = (id: string, over: Partial<SourceFacts> = {}): SourceFacts => ({ id, kind: ANSWERS_KIND, createdAt: '2026-11-26T11:00:00.000Z', archived: false, segmentCount: 2, ...over });
const apply = (s: SessionState, ...steps: ((x: SessionState) => SessionState)[]) => steps.reduce((x, f) => f(x), s);

test('answers saved but not read: written since the session started, read by none of its readings', () => {
  const sources = [
    src('file', { kind: 'Meeting transcript' }),
    src('before', { createdAt: '2026-11-26T09:00:00.000Z' }),
    src('read'),
    src('gone', { archived: true }),
    src('unread', { segmentCount: 3 }),
  ];
  const s = apply(emptyState(), startedReading('run-1', ['file', 'read']));
  assert.deepEqual(unreadAnswers(s, STARTED, sources), { ids: ['unread'], answers: 3 });
  // Once a reading of the session has read it, it is no longer unread.
  assert.deepEqual(unreadAnswers(apply(s, startedReading('run-2', ['file', 'read', 'unread'])), STARTED, sources), { ids: [], answers: 0 });
  // No open session, nothing to say.
  assert.deepEqual(unreadAnswers(s, null, sources), { ids: [], answers: 0 });
});

test('the line says it plainly, and an update reads the unread answers with the new ones, newest last, each once', () => {
  assert.equal(unreadLine(1), '1 answer is saved but not read into the draft yet: the reading did not start. Update the draft to read it.');
  assert.equal(unreadLine(3), '3 answers are saved but not read into the draft yet: the reading did not start. Update the draft to read them.');
  assert.deepEqual(updateReads(['file', 'own-1'], ['ans-1'], ['ans-2']), ['file', 'own-1', 'ans-1', 'ans-2']);
  assert.deepEqual(updateReads(['file', 'ans-1'], ['ans-1'], []), ['file', 'ans-1']);
  assert.deepEqual(updateReads(['file'], [], ['ans-2']), ['file', 'ans-2']);
});
