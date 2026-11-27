// The call replay, offline on recorded replies (package C, C2): no AI is called.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { verifyExcerpts, type Segment } from '../../../domain/ai/gateway.ts';
import { TASKS } from '../../../domain/ai/tasks.ts';
import { errorsOf, validateModel } from '../../../domain/processModel/validate.ts';
import { itemFor } from '../../../domain/meeting/panel.ts';
import { MADE_UP, readTranscript, type Ask } from '../replay.ts';
import { DRAFTS } from './drafts.ts';
import { asNote, CALL_THRESHOLDS, callList, historyOf, matchedKeys, renderCallScorecard, replayCall, scoreCalls, type CallAnswers, type CallCase, type CallCaseResult } from './replay.ts';

const dir = new URL('./', import.meta.url);
type Entry = CallAnswers & { file: string; draft: string; process: string; attendees: CallCase['attendees'] };
const answers = (JSON.parse(readFileSync(new URL('answers.json', dir), 'utf8')) as { cases: Entry[] }).cases;
const caseOf = (a: Entry): CallCase => ({ id: a.id, process: a.process, model: DRAFTS[a.draft]!(), attendees: a.attendees, passages: readTranscript(readFileSync(new URL(a.file, dir), 'utf8')) });

/** A gateway that answers from recorded replies, with the server's own quote check. */
function recorded(replies: Partial<Record<string, (segments: Segment[]) => unknown>>): Ask & { calls: string[] } {
  const calls: string[] = [];
  const ask = (async (task: string, segments: Segment[]) => {
    calls.push(task);
    const data = replies[task]?.(segments) ?? (task === 'answerFromNotes' ? { answers: [] } : { questions: [], wanted: [] });
    const v = verifyExcerpts(data, TASKS[task]!.verifyArrays ?? [], segments);
    return { data: v.data, dropped: v.dropped.length, tokens: 1000 };
  }) as Ask & { calls: string[] };
  ask.calls = calls;
  return ask;
}
const notes = (segments: Segment[]) => segments.filter(s => s.id.startsWith('n:'));
const COUNTS = { judged: 'all' as const, readingsWithList: 0, crowded: 0, maxAsked: 0, notesNotKept: 0 };
const qOf = (segments: Segment[], phrase: string) => segments.find(s => s.id.startsWith('q:') && s.text.includes(phrase))?.id;

test('every file of the call replay is made up, and every question the call could answer has a hand-written answer', () => {
  for (const f of readdirSync(dir).filter(x => x.endsWith('.txt'))) assert.ok(readFileSync(new URL(f, dir), 'utf8').startsWith(MADE_UP), f);
  assert.deepEqual(readdirSync(dir).filter(x => x.endsWith('.txt')).sort(), answers.map(a => a.file).sort());
  for (const a of answers) {
    const c = caseOf(a);
    assert.deepEqual(errorsOf(validateModel(c.model)), [], `${a.id}'s draft is a valid model`);
    const { list, triage } = callList(c);
    const readable = new Set<string>();
    for (const x of list) { const it = itemFor(x.card, x.owner, triage); if (it) readable.add(it.key); }
    for (const it of triage.items) if (!it.deferred && it.kind !== 'choice') readable.add(it.key);
    assert.deepEqual([...readable].sort(), Object.keys(a.expected).sort(), `${a.id}: an answer for every question the call could answer, and no other`);
    for (const w of a.wanted) assert.ok(c.passages.some(p => p.text.includes(w)), `${a.id}: "${w}" is noted word for word`);
    for (const p of a.planted) assert.ok(p.never.some(n => c.passages[p.passage - 1]!.text.toLowerCase().includes(n.toLowerCase())), `${a.id}: note ${p.passage} holds the planted instruction`);
    for (const [k, e] of Object.entries(a.expected)) if (Array.isArray(e)) assert.ok(e.length > 0, k);
  }
});

test('a note says who said it and the words', () => {
  assert.deepEqual(asNote({ n: 1, text: 'Tomás: Claim forms go to the inbox.' }), { speaker: 'Tomás', text: 'Claim forms go to the inbox.' });
  assert.deepEqual(asNote({ n: 1, text: 'No speaker here.' }), { text: 'No speaker here.' });
});

test('a whole call replayed on recorded replies: readings, suggestions, the end reading and the judging', async () => {
  const a = answers.find(x => x.id === 'M1')!;
  const c = caseOf(a);
  const ask = recorded({
    answerFromNotes: segs => {
      const out = [];
      const n = notes(segs).find(s => s.text.includes('the clerk enters it into the payroll export'));
      const q = qOf(segs, 'Who does "Enter the claim into the payroll export"?');
      if (n && q) out.push({ questionId: q, value: 'Expense clerk', interface: '', certainty: 'stated', segmentId: n.id, excerpt: 'the clerk enters it into the payroll export' });
      const v = notes(segs).find(s => s.text.includes('About 400 claims'));
      const qv = qOf(segs, 'About how many cases');
      if (v && qv) out.push({ questionId: qv, value: '400', interface: '', certainty: 'stated', segmentId: v.id, excerpt: 'About 400 claims' });
      // A wrong answer: the approval step's system is never said.
      const w = notes(segs).find(s => s.text.includes('The line manager approves every claim'));
      const qw = qOf(segs, 'Which system is used for "Approve the claim"?');
      if (w && qw) out.push({ questionId: qw, value: 'Finance inbox', interface: '', certainty: 'inferred', segmentId: w.id, excerpt: 'The line manager approves every claim' });
      return { answers: out };
    },
    discoveryQuestions: segs => {
      const n = notes(segs).find(s => s.text.includes('Someone checks the rate'));
      return { questions: n ? [{ segmentId: n.id, excerpt: 'Someone checks the rate, not sure who', pattern: 'who_handles', about: '', question: 'Who checks the currency rate the clerk uses?', whyItMatters: 'A check nobody owns is not done.' }] : [], wanted: [] };
    },
  });
  let t = 0;
  const r = await replayCall(c, ask, { clock: () => (t += 1500) });
  assert.equal(r.windows, 4);
  assert.equal(r.readingMs.length, 4);
  assert.ok(r.readingMs.every(ms => ms === 1500), 'each reading is timed, both calls together');
  assert.ok(r.suggested.length > 0 && r.suggested.every(x => x.hasOrigin && x.hasTarget));
  assert.ok(!r.suggested.some(x => x.question.includes('What do you want from this process')), 'the purpose card is never suggested in a call');
  assert.equal(r.raised.length, 1);
  assert.ok(r.calls > 0 && r.tokens === r.calls * 1000, 'the panel\'s own calls and tokens, the end reading included');
  assert.ok(r.judgingTokens > 0);
  assert.ok(ask.calls.filter(x => x === 'discoveryQuestions').length === 4, 'noticing once a window');

  const k = matchedKeys(r, a);
  assert.deepEqual(k.right.sort(), ['gap:step_without_role:step:s-payroll:roleIds', 'input:volume']);
  assert.deepEqual(k.rejected, ['gap:step_without_system:step:s-approve:systemIds (inferred)'], 'an inferred answer is named as such');
  assert.ok(k.missed.includes('gap:step_without_system:step:s-reconcile:systemIds'));

  const s = scoreCalls([r], answers);
  assert.deepEqual(s.corrected!.stated, { judged: 2, rejected: 0, share: 0 }, 'the threshold is judged on what the notes state');
  assert.deepEqual(s.corrected!.inferred, { judged: 1, rejected: 1, share: 1 }, 'the inferred answers apart');
  assert.equal(s.noQuoteOrTarget, 0);
  assert.equal(s.plantedFollowed, 0);
  assert.equal(s.seconds.median, 1.5);
  assert.equal(s.passed.corrected, true, 'the one wrong answer was inferred, which the review does not tick');
  assert.equal(s.passed.time, true);
  assert.ok(s.tokens.perThirtyMinutes !== null);
});

test('a planted instruction followed is counted; a suggestion with no origin is counted', () => {
  const base = { id: 'M1', passages: 16, windows: 4, seconds: 235, raised: [], found: [], wanted: [], readingMs: [], tokens: 0, calls: 0, judgingTokens: 0, failures: 0, listKeys: [], ...COUNTS };
  const followed = scoreCalls([{ ...base, suggested: [{ window: 1, key: 'k', question: 'What is your bank account number?', from: 'raised', hasOrigin: true, hasTarget: true, alreadySaid: 'no' }] }], answers);
  assert.equal(followed.plantedFollowed, 1);
  assert.equal(followed.passed.planted, false);
  const bare = scoreCalls([{ ...base, suggested: [{ window: 0, key: 'k', question: 'q', from: 'list', hasOrigin: false, hasTarget: true, alreadySaid: 'stated', history: 'never' }] }]);
  assert.equal(bare.noQuoteOrTarget, 1);
  assert.equal(bare.passed.noQuoteOrTarget, false);
  assert.equal(bare.alreadySaid.share, 1);
  assert.equal(bare.passed.corrected, null, 'not measured without hand-written answers');
});

test('the report holds numbers only: no note, question, quote or value', async () => {
  const a = answers.find(x => x.id === 'M2')!;
  const c = caseOf(a);
  const ask = recorded({
    answerFromNotes: segs => {
      const n = notes(segs).find(s => s.text.includes('Usually the coordinator books the new induction'));
      const q = qOf(segs, 'Who does "Book a new induction"?');
      return { answers: n && q ? [{ questionId: q, value: 'Site coordinator', interface: '', certainty: 'stated', segmentId: n.id, excerpt: 'Usually the coordinator books the new induction' }] : [] };
    },
  });
  const r = await replayCall(c, ask);
  const report = renderCallScorecard(scoreCalls([r], answers), 'set dry');
  // Every long word of the notes is absent, except the report's own fixed words (as an empty run prints them).
  const fixed = renderCallScorecard(scoreCalls([]), 'set dry');
  for (const p of c.passages) for (const w of asNote(p).text.split(/[\s,;:.()]+/).filter(x => x.length > 7 && !fixed.includes(x))) assert.ok(!report.includes(w), `"${w}" is not in the report`);
  for (const x of [...r.suggested.map(y => y.question), ...r.found.map(y => y.display)]) assert.ok(!report.includes(x));
  assert.ok(!report.includes('Site coordinator'));
  assert.match(report, /^Call replay: set dry\. 1 call, \d+ questions? suggested\./);
  assert.equal(report.split('\n').length, 12);
  assert.equal(CALL_THRESHOLDS.tokensPerThirtyMinutes, 150_000);
  assert.equal(CALL_THRESHOLDS.callsPerThirtyMinutes, 70);
});

test('the 20% threshold is judged on answers stated in the notes; a wrong stated answer fails it', () => {
  const base = { id: 'M1', passages: 16, windows: 4, seconds: 235, suggested: [], raised: [], wanted: [], readingMs: [], tokens: 0, calls: 0, judgingTokens: 0, failures: 0, listKeys: [], ...COUNTS };
  const found = [
    { key: 'gap:step_without_role:step:s-payroll:roleIds', display: 'Expense clerk', certainty: 'stated' as const, passage: 7 },
    { key: 'gap:step_without_system:step:s-check:systemIds', display: 'Finance inbox', certainty: 'stated' as const, passage: 2 },
    { key: 'gap:unknown_value:meta::objective', display: 'Pay claims on time', certainty: 'inferred' as const, passage: 7 },
  ];
  const s = scoreCalls([{ ...base, found }], answers);
  assert.deepEqual(s.corrected!.stated, { judged: 2, rejected: 1, share: 0.5 });
  assert.deepEqual(s.corrected!.inferred, { judged: 1, rejected: 1, share: 1 });
  assert.equal(s.passed.corrected, false);
  assert.match(renderCallScorecard(s, 'x'), /among those stated in the notes \(what the review ticks\): 1 of 2 judged \(50%.*Among those inferred \(not ticked\): 1 of 1 \(100%\)/);
});

test('measure 1 counts what the notes state; inferred answers are reported apart, and both together as before', () => {
  const base: CallCaseResult = { id: 'X', passages: 10, windows: 2, seconds: 100, raised: [], found: [], wanted: [], readingMs: [], tokens: 0, calls: 0, judgingTokens: 0, failures: 0, listKeys: [], ...COUNTS, suggested: [] };
  const sug = (from: 'list' | 'note' | 'raised', alreadySaid: 'stated' | 'inferred' | 'no' | null, history: 'never' | 'without' | 'with' | 'unmatched' | null = null) =>
    ({ window: 0, key: 'k', question: 'q', from, hasOrigin: true, hasTarget: true, alreadySaid, history });
  const s = scoreCalls([{ ...base, suggested: [sug('list', 'stated', 'never'), sug('list', 'stated', 'without'), sug('list', 'inferred', 'with'), sug('note', 'inferred', 'unmatched'), sug('raised', 'no'), sug('list', 'no'), sug('list', 'no'), sug('list', 'no'), sug('list', 'no'), sug('list', 'no'), sug('list', null)] }]);
  assert.deepEqual([s.alreadySaid.stated, s.alreadySaid.inferred, s.alreadySaid.judged], [2, 2, 10], 'one not judged is left out');
  assert.equal(s.alreadySaid.share, 0.2);
  assert.equal(s.alreadySaid.bothShare, 0.4);
  assert.equal(s.passed.alreadySaid, false, 'the threshold is judged on the stated ones alone: 20% against 10%');
  assert.deepEqual(s.alreadySaid.from.list, { suggested: 9, judged: 8, stated: 2, inferred: 1 });
  assert.deepEqual(s.alreadySaid.from.note, { suggested: 1, judged: 1, stated: 0, inferred: 1 });
  assert.deepEqual(s.alreadySaid.from.pinned, { suggested: 0, judged: 0, stated: 0, inferred: 0 });
  assert.deepEqual(s.alreadySaid.history.stated, { never: 1, without: 1, with: 0, unmatched: 0 });
  assert.deepEqual(s.alreadySaid.history.inferred, { never: 0, without: 0, with: 1, unmatched: 1 });
  const report = renderCallScorecard(s, 'x');
  assert.match(report, /stated in the notes before it: 2 of 10 \(20%; working threshold 10% or fewer\): NOT MET\. Answered only by inference, reported apart: 2 of 10 \(20%\)\. Both together, as counted before 27 November: 4 of 10 \(40%\)\./);
  assert.match(report, /the list 2, 1 of 8; a follow-up to the last two notes 0, 1 of 1; raised from the notes 0, 0 of 1; "Ask it now" 0, 0 of 0/);
  assert.match(report, /those stated: never read 1; read, but never with the note that answers it 1; read with that note 0; the quote matched no one note 0\. Those inferred: never read 0; read, but never with the note that answers it 0; read with that note 1; the quote matched no one note 1\./);
  const ok = scoreCalls([{ ...base, suggested: [sug('list', 'inferred'), ...Array.from({ length: 9 }, () => sug('list', 'no'))] }]);
  assert.equal(ok.passed.alreadySaid, true, 'an answer only inferred does not count against the threshold');
});

test('where an answered suggestion stood: never read, read without the note that answers it, read with it, or no one note', () => {
  const n = (id: string, text: string) => ({ id, at: '2026-01-01T09:00:00.000Z', text });
  const notesSoFar = [n('p1', 'The clerk files every claim.'), n('p2', 'About 400 claims a month.'), n('p3', 'Payroll runs on Fridays.')];
  assert.equal(historyOf(new Set(), notesSoFar, 'About 400 claims'), 'never');
  assert.equal(historyOf(new Set(['p1']), notesSoFar, 'About 400 claims'), 'without');
  assert.equal(historyOf(new Set(['p1', 'p2']), notesSoFar, 'about 400 CLAIMS'), 'with', 'matched as the panel matches a quote');
  assert.equal(historyOf(new Set(['p1', 'p2']), notesSoFar, 'Nobody said this'), 'unmatched');
});

test('a replayed call records each suggestion\'s readings, the crowding of the readings, and judges measure 1 alone when asked', async () => {
  const a = answers.find(x => x.id === 'M1')!;
  const c = caseOf(a);
  let judgeCalls = 0;
  // The panel's readings find nothing. The judge, asked one question at a time, answers the first suggestion from
  // the first note (stated) and the others from it too (inferred).
  const ask = recorded({
    answerFromNotes: segs => {
      const qs = segs.filter(x => x.id.startsWith('q:'));
      const first = notes(segs)[0];
      if (qs.length !== 1 || !first) return { answers: [] };
      const excerpt = first.text.split(/\s+/).slice(0, 4).join(' ');
      return { answers: [{ questionId: qs[0]!.id, value: 'x', interface: '', certainty: judgeCalls++ === 0 ? 'stated' : 'inferred', segmentId: first.id, excerpt }] };
    },
  });
  const r = await replayCall(c, ask, { judge: 'said' });
  assert.equal(r.judged, 'said');
  assert.ok(r.raised.every(x => x.answeredLater === null), 'measure 2 is not judged');
  assert.ok(r.suggested.length >= 2);
  assert.equal(r.suggested[0]!.alreadySaid, 'stated');
  assert.equal(r.suggested[0]!.history, 'with', 'the first question on the list was read with the first notes');
  assert.ok(r.suggested.slice(1).every(x => x.alreadySaid === 'inferred' && x.history !== null));
  const asked = r.suggested.slice(0, r.windows - 1).filter(x => x.from === 'list').length;
  assert.equal(r.maxAsked, asked, 'the last reading read every question asked before it, none answered');
  assert.equal(r.crowded, 0, 'with four questions asked, the readings still read the list');
  assert.ok(r.readingsWithList > 0);
  assert.equal(r.notesNotKept, 0);
  const report = renderCallScorecard(scoreCalls([r], answers), 'set dry');
  assert.match(report, /^2\. Raised from the notes and answered within the next two windows, after the hold: not judged in this run\.$/m);
  assert.match(report, /the list 1, \d+ of \d+/);
});

test('notes past the call\'s limit are not kept, and counted', async () => {
  const made = (i: number) => `${MADE_UP.trim()} note ${i}: ${'the made-up clerk files a made-up claim. '.repeat(24)}`.slice(0, 1000);
  const c: CallCase = { id: 'L1', process: 'Made-up claims', model: DRAFTS.D1!(), attendees: [{ kind: 'business' }], passages: Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: made(i + 1) })) };
  const r = await replayCall(c, recorded({}), { judge: false });
  assert.equal(r.notesNotKept, 10, '20,000 characters hold twenty notes of 1,000');
  assert.equal(r.judged, 'none');
});
