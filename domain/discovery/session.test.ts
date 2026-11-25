import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSY_LINE, commitSessionStep, dropLater, keysBeingWritten, laterFor, sourcesRead, takingInto, waitingAgainst, emptyState, FULL_LINE, IN_USE_MS, keepAnswer, keepLater, markRead, readState, sessionInUse, skip,
  startedLine, STATE_LIMIT, countedReading, countSaved, readingsReviewed, readingsStarted, reviewedReading, savedCount, startedReading, stateTextLength, tookIntoSource, usedCall, type KeptAnswer, type SaveAnswer, type SessionServer, type SessionState, type StoredSession,
} from './session.ts';
import { answersSource } from './answers.ts';

/** A server holding one open session, as the database keeps it: a write must name the version it read. */
function server(initial: SessionState = emptyState()) {
  let row: StoredSession = { id: 's1', processId: 'p1', status: 'open', state: structuredClone(initial), version: 1, startedBy: 'u1', startedAt: '2026-11-24T08:00:00Z', updatedAt: '2026-11-24T08:00:00Z' };
  const writes: number[] = [];
  const srv: SessionServer & { row(): StoredSession; writes: number[]; finish(): void; writeBetween?: () => void } = {
    async get() { const r = structuredClone(row); srv.writeBetween?.(); srv.writeBetween = undefined; return r; },
    async save(id, next, version): Promise<SaveAnswer> {
      if (id !== row.id) return 'stale';
      if (row.status === 'finished') return 'finished';
      if (version !== row.version) return 'stale';
      if (stateTextLength(next) > STATE_LIMIT) return 'full';
      row = { ...row, state: structuredClone(next), version: row.version + 1 };
      writes.push(row.version);
      return { version: row.version };
    },
    row: () => structuredClone(row),
    writes,
    finish() { row = { ...row, status: 'finished' }; },
  };
  return srv;
}

const answer = (key: string, words: string, at = '2026-11-24T08:01:00Z'): KeptAnswer => ({ key, words, question: `Question ${key}?`, at });

// Review, 24 November 2026: the version check bites only when the write names the version, so every write does.
test('two copies read at the same version: the second write is refused, applied again to the newer copy, and nothing is lost', async () => {
  const srv = server();
  const first = srv.row();
  const second = srv.row();
  assert.equal(first.version, second.version);
  // The first page saves.
  assert.deepEqual(await srv.save(first.id, keepAnswer(answer('a', 'By email'))(readState(first.state)), first.version), { version: 2 });
  // The second page's copy is older: its write is refused as it stands…
  assert.equal(await srv.save(second.id, keepAnswer(answer('b', 'On Mondays'))(readState(second.state)), second.version), 'stale');
  assert.equal(srv.row().state.waiting.length, 1);
  // …and the step, committed, is applied to the newer copy.
  const r = await commitSessionStep(srv, keepAnswer(answer('b', 'On Mondays')));
  assert.equal(r.kind, 'saved');
  assert.deepEqual(srv.row().state.waiting.map(w => [w.key, w.words]), [['a', 'By email'], ['b', 'On Mondays']]);
  assert.equal(srv.row().version, 3);
});

test('a step committed while another page writes in between is applied to the newer copy, never over it', async () => {
  const srv = server();
  // Another page keeps an answer just after this page read.
  srv.writeBetween = () => { void srv.save('s1', keepAnswer(answer('other', 'From the other page'))(readState(srv.row().state)), srv.row().version); };
  const r = await commitSessionStep(srv, keepAnswer(answer('mine', 'From this page')));
  assert.equal(r.kind, 'saved');
  assert.deepEqual(srv.row().state.waiting.map(w => w.key).sort(), ['mine', 'other']);
  assert.deepEqual(srv.writes, [2, 3]);
});

test('refused every time: after five tries the step says others are writing, and nothing was written over', async () => {
  const srv = server();
  const busy: SessionServer = { get: srv.get, save: async () => 'stale' };
  assert.deepEqual(await commitSessionStep(busy, skip('x')), { kind: 'busy' });
  assert.deepEqual(srv.row().state, emptyState());
  assert.match(BUSY_LINE, /Your answer is still in the box/);
});

test('a finished session takes no step', async () => {
  const srv = server();
  srv.finish();
  assert.deepEqual(await commitSessionStep(srv, skip('x')), { kind: 'gone' });
  const raced: SessionServer = { get: async () => ({ ...srv.row(), status: 'open' }), save: async () => 'finished' };
  assert.deepEqual(await commitSessionStep(raced, skip('x')), { kind: 'gone' });
});

// Review, 24 November 2026: a full session says what to do, never a database error.
test('a step that would take the state past 256 KB writes nothing and says what to do', async () => {
  const big = 'x'.repeat(140_000);
  const srv = server(keepAnswer(answer('a', big))(emptyState()));
  const before = srv.row();
  assert.deepEqual(await commitSessionStep(srv, keepAnswer(answer('b', big))), { kind: 'full' });
  assert.deepEqual(srv.row(), before);
  assert.equal(FULL_LINE, 'This session is full: it holds as many answers as it can keep. Update the draft from your answers, or finish the session, then carry on.');
  // The database's own refusal is read the same way.
  const refusing: SessionServer = { get: srv.get, save: async () => 'full' };
  assert.deepEqual(await commitSessionStep(refusing, skip('x')), { kind: 'full' });
});

test('the size is counted as the database writes the state out, never less', () => {
  // jsonb's text: '{"a": [1, 2], "b": "x"}'
  assert.equal(stateTextLength({ a: [1, 2], b: 'x' }), '{"a": [1, 2], "b": "x"}'.length);
  assert.equal(stateTextLength({}), 2);
  assert.equal(stateTextLength([]), 2);
  assert.equal(stateTextLength({ s: 'line\nquote"' }), '{"s": "line\\nquote\\""}'.length);
  const s = keepAnswer(answer('k', 'Some words'))(emptyState());
  assert.ok(stateTextLength(s) >= JSON.stringify(s).length);
});

// Review, 24 November 2026: a person's words are never kept twice.
test('waiting answers written into a "Discovery answers" source leave the session in the same step; one kept meanwhile stays', async () => {
  const srv = server();
  await commitSessionStep(srv, keepAnswer(answer('a', 'By email')));
  await commitSessionStep(srv, keepAnswer(answer('b', 'On Mondays')));
  const taken = srv.row().state.waiting;
  const source = answersSource(taken, [], '24 Nov 2026')!;
  assert.deepEqual(source.segments.map(s => s.text), ['By email', 'On Mondays']);
  // Meanwhile another editor keeps one more answer, and changes answer "b".
  await commitSessionStep(srv, keepAnswer(answer('c', 'The AP clerk')));
  await commitSessionStep(srv, keepAnswer(answer('b', 'On Mondays and Thursdays', '2026-11-24T08:05:00Z')));
  const r = await commitSessionStep(srv, tookIntoSource(taken));
  assert.equal(r.kind, 'saved');
  // "a" went into the source and left; "c" and the changed "b" were not in the source and stay.
  assert.deepEqual(srv.row().state.waiting.map(w => [w.key, w.words]), [['c', 'The AP clerk'], ['b', 'On Mondays and Thursdays']]);
  // Taken again, nothing more leaves: the step does only its own part.
  await commitSessionStep(srv, tookIntoSource(taken));
  assert.equal(srv.row().state.waiting.length, 2);
});

test('keeping an answer replaces an earlier one to the same card and takes it off the skipped and later lists', () => {
  let s = emptyState();
  s = skip('a')(s);
  s = keepLater({ key: 'a', question: 'Q?', words: 'later', at: 't' })(s);
  s = keepAnswer(answer('a', 'first'))(s);
  s = keepAnswer(answer('a', 'second'))(s);
  assert.deepEqual(s.waiting.map(w => w.words), ['second']);
  assert.deepEqual(s.skipped, []);
  assert.deepEqual(s.later, []);
});

test('use and passages read are counted in the session, so the cap survives a reload', () => {
  let s = emptyState();
  s = usedCall({ input: 1200, output: 300 })(s);
  s = usedCall(null)(s);
  s = markRead(['n:1', 'n:2'])(markRead(['n:1'])(s));
  const again = readState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(again.use, { tokens: 1500, calls: 2, readings: 0 });
  assert.deepEqual(again.read, ['n:1', 'n:2']);
});

test('a state read from the server keeps what a later release added, and leaves out what has not the known shape', () => {
  const s = readState({ waiting: [answer('a', 'ok'), { key: 'b', words: '   ' }, 'junk', { words: 'no key' }], raised: [{ quote: 'kept' }], use: { tokens: -5, calls: 'x' } });
  assert.deepEqual(s.waiting.map(w => w.key), ['a']);
  assert.deepEqual(s.raised, [{ quote: 'kept' }]);
  assert.deepEqual(s.use, { tokens: 0, calls: 0, readings: 0 });
  // A step keeps the other keys.
  assert.deepEqual(skip('z')(s).raised, [{ quote: 'kept' }]);
  assert.deepEqual(readState(null), emptyState());
  assert.deepEqual(readState([1, 2]), emptyState());
});

// Review, 24 November 2026: an abandoned session blocks nothing.
test('an open session holds the look back only while in use: written in the last 30 minutes, or open here', () => {
  const at = Date.parse('2026-11-24T08:00:00Z');
  const s = { status: 'open' as const, updatedAt: '2026-11-24T08:00:00Z' };
  assert.equal(sessionInUse(s, at + 5 * 60_000), true);
  assert.equal(sessionInUse(s, at + IN_USE_MS - 1), true);
  // Left idle: it no longer holds the look back…
  assert.equal(sessionInUse(s, at + IN_USE_MS), false);
  assert.equal(sessionInUse(s, at + 3 * 24 * 3600_000), false);
  // …unless the Discovery tab is open on it in this browser.
  assert.equal(sessionInUse(s, at + 3 * 24 * 3600_000, true), true);
  assert.equal(sessionInUse({ status: 'finished', updatedAt: '2026-11-24T08:00:00Z' }, at, true), false);
  assert.equal(sessionInUse(null, at, true), false);
  assert.equal(sessionInUse({ status: 'open', updatedAt: 'not a time' }, at), false);
});

test('who started a session is said by name, never an email address', () => {
  assert.equal(startedLine('Priya', '24 Nov 2026'), 'Started by Priya on 24 Nov 2026');
  assert.equal(startedLine('priya@example.com', '24 Nov 2026'), 'Started on 24 Nov 2026');
  assert.equal(startedLine(null, '24 Nov 2026'), 'Started on 24 Nov 2026');
  assert.equal(startedLine('  ', '24 Nov 2026'), 'Started on 24 Nov 2026');
});

test('a reading is counted once against the cap, however often its end is seen; updates started and reviewed are remembered', () => {
  let s = emptyState();
  s = startedReading('r1')(s);
  s = countedReading('r1', 30_000)(s);
  s = countedReading('r1', 30_000)(s);
  assert.deepEqual(s.use, { tokens: 30_000, calls: 0, readings: 1 });
  assert.deepEqual(readingsStarted(s), ['r1']);
  assert.deepEqual(readingsReviewed(reviewedReading('r1')(s)), ['r1']);
  assert.equal(savedCount(countSaved(countSaved(s))), 2);
  // All of it survives the server's copy.
  const again = readState(JSON.parse(JSON.stringify(countSaved(s))));
  assert.equal(savedCount(again), 1);
  assert.deepEqual(readingsStarted(again), ['r1']);
});

test('answers stay waiting until their source is saved; a source already saved is never written again', () => {
  const a = { key: 'shape:end', words: 'Posted and filed.', question: 'When is a case finished?', at: '2026-11-24T10:00:00.000Z' };
  const b = { key: 'shape:start', words: 'An invoice arrives.', question: 'What starts the work?', at: '2026-11-24T10:01:00.000Z' };
  let s = keepAnswer(b)(keepAnswer(a)(emptyState()));
  s = takingInto(s.waiting, 'ans-1')(s);
  // Marked, still waiting, and the mark survives being read back from the server.
  s = readState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(s.waiting.map(w => w.into), ['ans-1', 'ans-1']);
  assert.deepEqual(keysBeingWritten(s), ['ans-1']);
  // The tab closed before the source was saved: nothing is done, both are pending again.
  assert.deepEqual(waitingAgainst(s, ['own-1']).done, []);
  assert.equal(waitingAgainst(s, ['own-1']).pending.length, 2);
  // The tab closed after the source was saved, before the answers were taken out: they are done, not written twice.
  const after = waitingAgainst(s, ['own-1', 'ans-1']);
  assert.deepEqual({ done: after.done.length, pending: after.pending.length, keys: after.doneKeys }, { done: 2, pending: 0, keys: ['ans-1'] });
  assert.deepEqual(tookIntoSource(after.done)(s).waiting, []);
  // A new answer given meanwhile is not marked and stays pending.
  const c = { key: 'item:x', words: 'The AP lead.', question: 'Who approves?', at: '2026-11-24T10:05:00.000Z' };
  assert.deepEqual(waitingAgainst(keepAnswer(c)(s), ['ans-1']).pending.map(w => w.key), ['item:x']);
});

test('each reading the session starts keeps the sources it read; a reading started elsewhere has none', () => {
  let s = startedReading('run-1', ['src-a'])(emptyState());
  s = startedReading('run-2', ['src-a', 'src-b'])(s);
  s = readState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(sourcesRead(s, 'run-1'), ['src-a']);
  assert.deepEqual(sourcesRead(s, 'run-2'), ['src-a', 'src-b']);
  assert.deepEqual(sourcesRead(s, 'run-elsewhere'), []);
  assert.deepEqual(readingsStarted(s), ['run-1', 'run-2']);
});

test('words kept to read later are found again for their card, and cleared', () => {
  const w = { key: 'item:x', question: 'Who approves?', words: 'The AP lead.', at: '2026-11-24T10:00:00.000Z' };
  const s = keepLater(w)(emptyState());
  assert.deepEqual(laterFor(s, 'item:x'), w);
  assert.equal(laterFor(dropLater('item:x')(s), 'item:x'), undefined);
});
