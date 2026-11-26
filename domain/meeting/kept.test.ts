// Package C, pull request C1: a running call as it is kept on the device (revision 2), and the call's cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keysToForget } from '../site/storage.ts';
import { addNote, CALL_KEY_PREFIX, CALL_LIMITS, callAgeDays, callKey, continueCall, editNote, mergeCalls, newCall, notesFile, notesFileName, readCall, removeNote, STALE_DAYS, unfinishedLine, type CallState } from './kept.ts';
import { afterCallUse, CALL_CAP, capReachedDuringCall, roomAtEnd, roomDuringCall } from './limits.ts';

const at = (min: number) => new Date(Date.UTC(2026, 10, 26, 14, 2 + min)).toISOString();
const start = () => newCall({ processId: 'p-1', at: at(0), attendees: [{ kind: 'business', name: 'Priya' }], minutes: 30 });
const add = (s: CallState, id: string, min: number, text: string, speaker?: string): CallState => {
  const r = addNote(s, { id, at: at(min), text, ...(speaker ? { speaker } : {}) });
  assert.equal(typeof r, 'object');
  return r as CallState;
};

test('one key per process, with a prefix sign-out can remove', () => {
  assert.equal(callKey('p-1'), 'avala:call:p-1');
  assert.ok(callKey('p-1').startsWith(CALL_KEY_PREFIX));
  // The prefix joins SIGN_OUT_FORGETS with the screens (C3); until then sign-out does not know it.
  assert.deepEqual(keysToForget([callKey('p-1')]), []);
});

test('a call survives being written out and read back; anything else is not a call', () => {
  let s = add(start(), 'n1', 1, 'Invoices arrive by email.', 'Priya');
  s = add(s, 'n2', 2, 'About 1,200 a month.');
  assert.deepEqual(readCall(JSON.stringify(s), 'p-1'), s);
  assert.equal(readCall(JSON.stringify(s), 'p-2'), null, 'another process');
  assert.equal(readCall('{not json', 'p-1'), null);
  assert.equal(readCall({ ...s, version: 2 }, 'p-1'), null);
  assert.equal(readCall(null, 'p-1'), null);
  // Entries without the known shape are left out; the rest is kept.
  const junk = { ...s, notes: [...s.notes, { id: 3 }, { id: 'n3', at: 'yesterday', text: 'x' }], found: [{ itemKey: 'k' }], attendees: [{ kind: 'boss', name: ' Ann ' }], minutes: 90 };
  const r = readCall(JSON.stringify(junk), 'p-1')!;
  assert.deepEqual(r.notes.map(n => n.id), ['n1', 'n2']);
  assert.deepEqual(r.found, []);
  assert.deepEqual(r.attendees, [{ kind: 'business', name: 'Ann' }]);
  assert.equal(r.minutes, 30);
});

test('notes: empty refused, the call full at 300 notes or 20,000 characters, an edit or a removal drops what was found in it', () => {
  const s = start();
  assert.equal(addNote(s, { id: 'x', at: at(1), text: '  \n ' }), 'empty');
  let full = s;
  for (let i = 0; i < CALL_LIMITS.notes; i++) full = add(full, `n${i}`, 1, 'a');
  assert.equal(addNote(full, { id: 'more', at: at(2), text: 'b' }), 'full');
  let long = s;
  for (let i = 0; i < 10; i++) long = add(long, `l${i}`, 1, 'x'.repeat(CALL_LIMITS.noteChars));
  assert.equal(addNote(long, { id: 'over', at: at(2), text: 'y' }), 'full');
  // Blank lines inside a note are tidied away.
  assert.equal((addNote(s, { id: 't', at: at(1), text: 'one\n\n\ntwo' }) as CallState).notes[0]!.text, 'one\ntwo');

  let c = add(add(s, 'n1', 1, 'The buyer does the match.'), 'n2', 2, 'Checks in SAP.');
  c = { ...c, read: ['n1', 'n2'], found: [{ itemKey: 'k', question: 'q', display: 'd', quote: 'The buyer', certainty: 'stated', answer: { text: 'd' }, noteId: 'n1', readAt: at(3) }] };
  const edited = editNote(c, 'n1', 'The clerk does the match.', at(4)) as CallState;
  assert.equal(edited.notes[0]!.text, 'The clerk does the match.');
  assert.deepEqual(edited.read, ['n2'], 'an edited note is read again');
  assert.deepEqual(edited.found, []);
  const removed = removeNote(c, 'n1', at(4));
  assert.deepEqual(removed.notes.map(n => n.id), ['n2']);
  assert.deepEqual(removed.removed, ['n1']);
  assert.deepEqual(removed.found, []);
});

test('two tabs on one call: merged by note id, a removed note stays removed, the AI used never undercounted', () => {
  const base = add(start(), 'n1', 1, 'Invoices arrive by email.');
  const a = { ...add(base, 'a1', 2, 'From tab A.'), use: { tokens: 9000, calls: 4 } };
  const b = { ...removeNote(add(base, 'b1', 3, 'From tab B.'), 'n1', at(3)), use: { tokens: 5000, calls: 6 } };
  const m = mergeCalls(a, b);
  assert.deepEqual(m.notes.map(n => n.id), ['a1', 'b1']);
  assert.deepEqual(m.use, { tokens: 9000, calls: 6 });
  assert.deepEqual(mergeCalls(b, a).notes.map(n => n.id), ['a1', 'b1'], 'the same either way');
  const e1 = editNote(a, 'n1', 'Invoices arrive by email and post.', at(5)) as CallState;
  assert.equal(mergeCalls(e1, a).notes.find(n => n.id === 'n1')!.text, 'Invoices arrive by email and post.', 'the later edit wins');
});

test('an unfinished call: its line, its age, and after 7 days its list is built again', () => {
  const s = add(start(), 'n1', 1, 'x');
  assert.equal(unfinishedLine(s, at(60), 'UTC'), 'A call from 26 November 2026 at 14:02 was not finished.');
  const later = new Date(Date.parse(s.changedAt) + 9 * 86_400_000).toISOString();
  assert.equal(callAgeDays(s, later), 9);
  assert.equal(unfinishedLine(s, later, 'UTC'), 'A call from 26 November 2026 at 14:02 was not finished, 9 days ago. Its notes are still on this device.');
  const arranged = { ...s, arranged: { order: ['a', 'b'], leftOut: ['c'] }, own: [{ key: 'o', question: 'Mine?' }] };
  assert.equal(continueCall(arranged, at(90)), arranged, 'a recent call continues as it was');
  const old = continueCall(arranged, new Date(Date.parse(s.changedAt) + STALE_DAYS * 86_400_000).toISOString());
  assert.deepEqual(old.arranged, { order: [], leftOut: [] });
  assert.deepEqual(old.own, arranged.own, 'their own questions stay');
  assert.deepEqual(old.notes, arranged.notes, 'the notes stay');
  assert.ok(old.rebuiltAt);
});

test('"Download my notes": one line per note, nothing else', () => {
  let s = add(start(), 'n1', 1, 'Invoices arrive by email.', 'Priya');
  s = add(s, 'n2', 7, 'Two clerks key them in.\nSometimes three.');
  s = { ...s, found: [{ itemKey: 'k', question: 'Secret question?', display: 'd', quote: 'Invoices', certainty: 'stated', answer: { text: 'd' }, noteId: 'n1', readAt: at(8) }] };
  assert.equal(notesFile(s, 'UTC'), '14:03 · Priya: Invoices arrive by email.\n14:09 · Two clerks key them in. Sometimes three.\n');
  assert.ok(!notesFile(s, 'UTC').includes('Secret question'));
  assert.equal(notesFileName('AP: invoices/claims', s, 'UTC'), 'Call notes, AP invoices claims, 26 November 2026.txt');
  assert.equal(notesFile(start()), '');
});

test('the cap: 150,000 tokens and 50 calls, with 20,000 tokens and 3 calls kept for the end reading', () => {
  assert.deepEqual(CALL_CAP, { tokens: 150_000, calls: 50, keptForEnd: { tokens: 20_000, calls: 3 } });
  assert.ok(roomDuringCall({ tokens: 129_999, calls: 45 }, 2));
  assert.ok(!roomDuringCall({ tokens: 130_000, calls: 0 }, 2), 'readings stop at 130,000 tokens');
  assert.ok(!roomDuringCall({ tokens: 0, calls: 46 }, 2), 'or when a reading would take the calls past 47');
  assert.ok(capReachedDuringCall({ tokens: 130_000, calls: 0 }));
  assert.ok(roomAtEnd({ tokens: 130_000, calls: 47 }, 2), 'the end reading still runs');
  assert.ok(!roomAtEnd({ tokens: 150_000, calls: 0 }, 1));
  assert.ok(!roomAtEnd({ tokens: 0, calls: 49 }, 2));
  assert.deepEqual(afterCallUse({ tokens: 10, calls: 1 }, { input: 100, output: 20 }), { tokens: 130, calls: 2 });
  assert.deepEqual(afterCallUse({ tokens: 10, calls: 1 }, null), { tokens: 10, calls: 2 }, 'a call with no usage still counts as a call');
});
