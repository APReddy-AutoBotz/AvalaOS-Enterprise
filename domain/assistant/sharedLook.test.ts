import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addQuestion } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import type { Suggestion } from './suggest.ts';
import { AUTO_LOOK, toLookUp, waitingUntil } from './sourceLook.ts';
import { answerStep, commitStep, dismissStep, handOverStep, sendStep, Skip, stoppedStep, type LookServer, type SharedLook, type StoredLook } from './sharedLook.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
function many(): ProcessModel {
  let m = gold();
  for (let n = 1; n <= 40; n++) m = addQuestion(m, { target: { kind: 'meta' }, question: `Question number ${n} about topic ${'abcdefghijklmnopqrstuvwxyz'[n % 26]}${n} of the process?` }).model;
  return m;
}
const answer = (itemKey: string, display = 'x'): Suggestion => ({
  key: `answer:${itemKey}:${display}`, kind: 'answer', title: 't', why: 'w', quote: { text: 'q', source: 's' }, willDo: 'd', needs: 'edit_process',
  target: { kind: 'answer', itemKey, proposal: { itemKey, question: 'q', display, quote: 'q', certainty: 'stated', answer: { text: display } }, source: 's' },
});

/** The server as the table behaves: a copy and a count of writes; a write read at an older count is refused. */
function fakeServer(start: StoredLook | null = null) {
  let row: StoredLook | null = start ? structuredClone(start) : null;
  const writes: SharedLook[] = [];
  const server: LookServer & { row: () => StoredLook | null; writes: SharedLook[] } = {
    async get() { return row ? structuredClone(row) : null; },
    async save(next, version) {
      if ((row?.version ?? null) !== version) return null;
      row = { ...structuredClone(next), version: (row?.version ?? 0) + 1 };
      writes.push(structuredClone(next));
      return row.version;
    },
    row: () => row,
    writes,
  };
  return server;
}

test('two pages adding to the same look at once lose nothing: the later one adds its step to the newer copy', async () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = 'a,b';
  const [b1, b2] = toLookUp(t, null, key, AUTO_LOOK, 0, true);
  const server = fakeServer();
  // Page A reads the empty copy; before it saves, page B saves its answers.
  const stale = await server.get();
  await commitStep(server, answerStep(key, { items: b2, found: [answer(b2[0].key, 'from B')], passages: 5, tokens: 300 }));
  // A's save from the old copy is refused...
  assert.equal(await server.save({ look: null, dismissed: [] }, stale?.version ?? null), null);
  // ...so A applies its step again, to the copy B left.
  const saved = await commitStep(server, answerStep(key, { items: b1, found: [answer(b1[0].key, 'from A')], passages: 4, tokens: 200 }));
  assert.notEqual(saved, Skip);
  const look = server.row()!.look!;
  assert.deepEqual(look.found.map(f => f.target.kind === 'answer' && f.target.proposal.display).sort(), ['from A', 'from B']);
  assert.equal(look.calls, 2);
  assert.equal(look.tokens, 500);
  assert.ok([...b1, ...b2].every(i => look.looked.includes(i.key)));
  // Both answers are kept, one per question.
  assert.equal(look.found.length, 2);
});

test('a page reads the server\'s copy before it sends: within another page\'s wait it sends nothing, and the wait holds across pages', async () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = 'a,b';
  const t0 = Date.parse('2026-11-16T08:22:00Z');
  const server = fakeServer();
  // Browser 1 notes its first batch on the server, then is closed before the answer.
  const first = toLookUp(t, null, key, AUTO_LOOK, t0)[0];
  assert.notEqual(await commitStep(server, sendStep(key, first, t0)), Skip);
  // Browser 2, 78 seconds later, reads the server's copy: nothing to send, and it knows when to try again.
  const copy = (await server.get())!;
  assert.deepEqual(toLookUp(t, copy.look, key, AUTO_LOOK, t0 + 78_000), []);
  assert.equal(waitingUntil(copy.look, key, t0 + 78_000), t0 + AUTO_LOOK.waitMs);
  // Had browser 2 decided before browser 1's note reached the server, its own note gives up on the newer copy.
  assert.equal(await commitStep(server, sendStep(key, first, t0 + 1_000)), Skip);
  // After the wait the lost questions go once more, first.
  const after = (await server.get())!;
  assert.deepEqual(toLookUp(t, after.look, key, AUTO_LOOK, t0 + AUTO_LOOK.waitMs + 3_000)[0].map(i => i.key), first.map(i => i.key));
  // A person's "Look in the sources" is never held, even within the wait.
  assert.notEqual(await commitStep(server, sendStep(key, first, t0 + 2_000, true)), Skip);
});

test('a different set of sources starts afresh; the allowance stop and "Not right" are shared', async () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const [b1] = toLookUp(t, null, 'a,b', AUTO_LOOK, 0);
  const server = fakeServer();
  await commitStep(server, answerStep('a,b', { items: b1, found: [answer(b1[0].key)], passages: 3, tokens: 100 }));
  await commitStep(server, answerStep('a,b,c', { items: b1.slice(0, 2), found: [], passages: 1, tokens: 10 }));
  const look = server.row()!.look!;
  assert.equal(look.sources, 'a,b,c');
  assert.equal(look.calls, 1);
  assert.equal(look.found.length, 0);
  assert.equal(toLookUp(t, look, 'a,b,c', AUTO_LOOK, 0).flat().length, AUTO_LOOK.perBatch * AUTO_LOOK.batches);
  await commitStep(server, stoppedStep('a,b,c', 5));
  assert.equal(server.row()!.look!.stopped, 5);
  // "Not right" by one editor holds for everyone; another's set-aside stays when one is brought back.
  await commitStep(server, dismissStep(['answer:q1:x']));
  await commitStep(server, dismissStep(['answer:q2:y']));
  await commitStep(server, dismissStep([], ['answer:q1:x']));
  assert.deepEqual(server.row()!.dismissed, ['answer:q2:y']);
});

test('after the release a browser hands its own look to the server once, only when the server has none for the same sources', async () => {
  const local: SharedLook = { look: { sources: 'a,b', looked: ['q1'], found: [answer('q1')], questions: 1, passages: 2, tokens: 50, calls: 1 }, dismissed: ['answer:q9:z'] };
  const server = fakeServer();
  const handed = await commitStep(server, handOverStep(local, 'a,b'));
  assert.notEqual(handed, Skip);
  assert.equal(server.row()!.look!.calls, 1);
  assert.deepEqual(server.row()!.dismissed, ['answer:q9:z']);
  // The server now has it: a second browser's older copy does not replace it.
  const other: SharedLook = { look: { ...local.look!, calls: 7 }, dismissed: [] };
  assert.equal(await commitStep(server, handOverStep(other, 'a,b')), Skip);
  assert.equal(server.row()!.look!.calls, 1);
  // A browser holding a look of other sources hands over nothing.
  assert.equal(await commitStep(fakeServer(), handOverStep({ ...local, look: { ...local.look!, sources: 'x' } }, 'a,b')), Skip);
});

test('a save refused again and again gives up after a few tries, so a page is never stuck', async () => {
  const stubborn: LookServer = { async get() { return { look: null, dismissed: [], version: 3 }; }, async save() { return null; } };
  assert.equal(await commitStep(stubborn, dismissStep(['k']), 3), null);
});
