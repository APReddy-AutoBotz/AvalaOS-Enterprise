import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { addQuestion } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from '../questions/triage.ts';
import { decisive, planQuestions } from '../questions/firstList.ts';
import type { Suggestion } from './suggest.ts';
import { addLook, allowanceStopped, allowanceUsedUp, AUTO_LOOK, foundFor, foundKeys, lookSummary, noteSent, noteStopped, sourcesKey, toLookUp, waitingUntil, type SourceLook } from './sourceLook.ts';
import { StoreError } from '../../journey/store/types.ts';

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

test('a look stays within its limit and asks about the decisive questions first', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = sourcesKey([{ id: 'b' }, { id: 'a' }, { id: 'c', archived: true }]);
  assert.equal(key, 'a,b');
  const batches = toLookUp(t, null, key);
  assert.ok(batches.length <= AUTO_LOOK.batches && batches.every(b => b.length <= AUTO_LOOK.perBatch));
  assert.equal(batches.flat().length, Math.min(t.items.filter(i => !i.deferred).length, AUTO_LOOK.perBatch * AUTO_LOOK.batches));
  const flat = batches.flat();
  const firstOther = flat.findIndex(i => !decisive(i));
  if (firstOther >= 0) assert.ok(flat.slice(firstOther).every(i => !decisive(i)), 'decisive questions come before the rest');
});

test('a question is looked up once per set of sources; a new source looks again', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = 'a,b';
  let look = null;
  for (const items of toLookUp(t, null, key)) look = addLook(look, key, { items, found: [], passages: 40, tokens: 15000 });
  assert.equal(look!.calls, Math.min(AUTO_LOOK.batches, Math.ceil(t.items.length / AUTO_LOOK.perBatch)));
  const left = t.items.length - look!.looked.length;
  // The next look takes the questions not yet looked up; answering one question starts none.
  assert.equal(toLookUp(t, look, key).flat().length, Math.min(left, AUTO_LOOK.perBatch * AUTO_LOOK.batches));
  const all = { ...look!, looked: t.items.map(i => i.key) };
  assert.equal(toLookUp(t, all, key).length, 0);
  assert.ok(toLookUp(t, all, 'a,b,c').length > 0, 'a new source: look again');
  assert.match(lookSummary(look, 0)!, /looked for \d+ answers in your sources \(\d+ passages read with AI, about \d+ thousand tokens\) and found 0/);
  assert.equal(lookSummary(null, 0), null);
});

test('answers found are offered while their question is open and not dismissed, and take it out of the first list', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const [a, b] = t.items;
  let look = addLook(null, 'k', { items: [a, b], found: [answer(a.key), answer(b.key)], passages: 10, tokens: 0 });
  assert.deepEqual(foundFor(look, t).map(s => s.target.kind === 'answer' && s.target.itemKey), [a.key, b.key]);
  assert.deepEqual(foundFor(look, t, [answer(b.key).key]).length, 1, 'dismissed');
  const gone = triage({ ...m, openQuestions: m.openQuestions.filter(q => !a.questionIds.includes(q.id)) }, assessProcess(m));
  assert.ok(!foundFor(look, gone).some(s => s.target.kind === 'answer' && s.target.itemKey === a.key), 'answered: no longer offered');
  const plan = planQuestions(t, m, { found: foundKeys(foundFor(look, t)) });
  assert.deepEqual(plan.found.map(i => i.key).sort(), [a.key, b.key].sort());
  // Looking at the same question again replaces its earlier answer; other sources start afresh.
  look = addLook(look, 'k', { items: [a], found: [answer(a.key, 'y')], passages: 5, tokens: 0 });
  assert.deepEqual(look.found.map(s => s.key).sort(), [answer(a.key, 'y').key, answer(b.key).key].sort());
  assert.equal(addLook(look, 'other', { items: [], found: [], passages: 0, tokens: 0 }).found.length, 0);
});

test('a passage that leaves the matter open, or an answer that repeats the question, is not offered; a flow question is not looked up', async () => {
  const { answersIt } = await import('./suggest.ts');
  let m = many();
  for (const q of ['Which functional owners should validate the proposed answers?', 'What is the intended environment for the access request?', 'What are the technical feasibility and effort?'])
    m = addQuestion(m, { target: { kind: 'meta' }, question: q }).model;
  const t = triage(m, assessProcess(m));
  const item = (re: RegExp) => t.items.find(i => re.test(i.question))!;
  const p = (it: { key: string; question: string }, display: string, quote = display) => ({ itemKey: it.key, question: it.question, display, quote, certainty: 'stated' as const, answer: { text: display } });
  const owners = item(/functional owners/), env = item(/intended environment/), eff = item(/technical feasibility/);
  assert.equal(answersIt(p(owners, 'Relevant functional owners should validate the proposed answers.'), owners), false, 'repeats the question');
  assert.equal(answersIt(p(owners, 'The finance and procurement process owners validate them.'), owners), true);
  assert.equal(answersIt(p(env, 'The existing access request needs to be reviewed to confirm the intended environment.'), env), false);
  assert.equal(answersIt(p(eff, 'Technical feasibility and effort will be assessed once these details are established.'), eff), false);
  assert.equal(answersIt(p(eff, 'These requirements need further analysis and agreement before being included.'), eff), false);
  assert.equal(answersIt(p(eff, 'No walkthrough of how the template is filled was given.'), eff), false);
  assert.equal(answersIt(p(env, 'The quality system in the Frankfurt data centre, with read-only rights.'), env), true);
  // An answer kept from before is held to the same rule when it is read back.
  const look = addLook(null, 'k', { items: [owners], found: [{ ...answer(owners.key), target: { kind: 'answer', itemKey: owners.key, proposal: p(owners, 'Relevant functional owners should validate the proposed answers.'), source: 's' } }], passages: 1, tokens: 0 });
  assert.equal(foundFor(look, t).length, 0);
  // A decision with one outcome is a flow to fix, not a question for the sources.
  const g = gold();
  const withGateway = addQuestion(g, { target: { kind: 'gateway', id: g.gateways[0].id }, question: 'Decision "Match?" has only one outcome.' }).model;
  const tg = triage(withGateway, assessProcess(withGateway));
  assert.ok(!toLookUp(tg, null, 'k', { perBatch: 500, batches: 1 }).flat().some(i => i.target.kind === 'gateway'));
});

test('a look cut short: within the wait nothing is sent, after it the same questions go once more, then never again on their own', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const key = 'a,b';
  const t0 = Date.parse('2026-11-16T08:00:00Z');
  const min = 60_000;
  assert.equal(AUTO_LOOK.waitMs, 3 * min);
  assert.equal(AUTO_LOOK.repeats, 1);
  // The first page notes its first call, then is reloaded before the answer comes back.
  const first = toLookUp(t, null, key, AUTO_LOOK, t0)[0];
  let look: SourceLook = noteSent(null, key, first, t0);
  // Pages opened within three minutes send nothing at all, not even questions not sent yet.
  for (const at of [t0 + 10_000, t0 + min, t0 + 2 * min, t0 + 3 * min - 1]) assert.deepEqual(toLookUp(t, look, key, AUTO_LOOK, at), [], `at ${(at - t0) / 1000}s`);
  assert.equal(waitingUntil(look, key, t0 + min), t0 + 3 * min);
  // After the wait the lost questions go once more, first, with the rest of the look.
  const again = toLookUp(t, look, key, AUTO_LOOK, t0 + 3 * min);
  assert.deepEqual(again[0].map(i => i.key), first.map(i => i.key));
  look = noteSent(look, key, again[0], t0 + 3 * min);
  assert.ok(first.every(i => look.sent![i.key].times === 2));
  // Lost again: after the next wait they are never sent again on their own; the others still are.
  const later = toLookUp(t, look, key, AUTO_LOOK, t0 + 7 * min).flat().map(i => i.key);
  assert.ok(first.every(i => !later.includes(i.key)));
  assert.ok(later.length > 0);
  // "Look in the sources", pressed by a person, still sends them.
  const manual = toLookUp(t, look, key, AUTO_LOOK, t0 + 7 * min, true).flat().map(i => i.key);
  assert.ok(first.every(i => manual.includes(i.key)));
  assert.deepEqual(toLookUp(t, look, key, AUTO_LOOK, t0 + 4 * min, true).length > 0, true, 'a person is never held by the wait');
});

test('an answered call is no longer waiting, and a new or archived source starts afresh', () => {
  const m = many();
  const t = triage(m, assessProcess(m));
  const t0 = Date.parse('2026-11-16T08:00:00Z');
  const first = toLookUp(t, null, 'a,b', AUTO_LOOK, t0)[0];
  let look: SourceLook = noteSent(null, 'a,b', first, t0);
  look = addLook(look, 'a,b', { items: first, found: [], passages: 4, tokens: 100 });
  assert.equal(look.sent, undefined);
  assert.equal(waitingUntil(look, 'a,b', t0 + 1000), null);
  // The rest of the look goes at once; what was answered does not go again.
  const next = toLookUp(t, look, 'a,b', AUTO_LOOK, t0 + 1000).flat().map(i => i.key);
  assert.ok(next.length > 0 && first.every(i => !next.includes(i.key)));
  // Another set of sources: nothing waits and everything is looked up again, as before.
  const held = noteSent(null, 'a,b', first, t0);
  assert.deepEqual(toLookUp(t, held, 'a,b', AUTO_LOOK, t0 + 1000), []);
  assert.deepEqual(toLookUp(t, held, 'a,b,c', AUTO_LOOK, t0 + 1000), toLookUp(t, null, 'a,b,c', AUTO_LOOK, t0 + 1000));
  assert.deepEqual(toLookUp(t, held, 'a', AUTO_LOOK, t0 + 1000).flat().length, toLookUp(t, null, 'a', AUTO_LOOK, t0 + 1000).flat().length);
});

test('when the month\'s AI allowance is used up the look stops and says so in plain words', () => {
  const now = Date.parse('2026-11-16T08:00:00Z');
  assert.ok(allowanceUsedUp({ status: 429, message: 'This workspace has used its AI allowance for the month.' }));
  assert.ok(allowanceUsedUp(new Error('This workspace has used its AI allowance for the month.')));
  assert.ok(!allowanceUsedUp({ status: 500, message: 'The AI provider did not answer.' }));
  // Decided by the server's code, which the store's error carries: only BUDGET_EXCEEDED stops the look for the month.
  assert.ok(allowanceUsedUp({ status: 429, code: 'BUDGET_EXCEEDED', message: 'This workspace has used its AI allowance for the month.' }));
  assert.ok(allowanceUsedUp(new StoreError(429, 'This workspace has used its AI allowance for the month.', 'BUDGET_EXCEEDED')));
  assert.ok(!allowanceUsedUp(new StoreError(429, 'You have started 30 AI requests in the last minute, the most one person can. Wait about 40 seconds and try again.', 'RATE_LIMITED')), 'a busy minute does not stop the look for the month');
  assert.ok(!allowanceUsedUp(new StoreError(429, 'This workspace has started 90 AI requests in the last minute, the most it can at once. Wait about 40 seconds and try again.', 'RATE_LIMITED')));
  assert.ok(!allowanceUsedUp(new StoreError(429, 'The key has been tested 10 times in the last hour. Try again later.', 'TEST_LIMIT')));
  assert.ok(!allowanceUsedUp({ status: 429, message: 'You have started 30 AI requests in the last minute, the most one person can.' }), 'a 429 without a code is not the allowance unless its words say so');
  // A code decides even when the words would say otherwise.
  assert.ok(!allowanceUsedUp(new StoreError(429, 'This workspace has used its AI allowance for the month.', 'RATE_LIMITED')));
  const look = noteStopped(null, 'a,b', now);
  assert.ok(allowanceStopped(look, now + 3_600_000));
  assert.ok(!allowanceStopped(look, Date.parse('2026-12-01T00:00:00Z')), 'a new month starts again');
  assert.match(lookSummary(look, 0, now)!, /^Avala OS stopped looking in your sources for answers: this workspace has used its AI allowance for the month\./);
  // A later successful look clears it.
  assert.equal(addLook(look, 'a,b', { items: [], found: [], passages: 0, tokens: 0 }).stopped, undefined);
});
