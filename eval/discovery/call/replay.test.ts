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
import { asNote, CALL_THRESHOLDS, callList, matchedKeys, renderCallScorecard, replayCall, scoreCalls, type CallAnswers, type CallCase } from './replay.ts';

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
  const base = { id: 'M1', passages: 16, windows: 4, seconds: 235, raised: [], found: [], wanted: [], readingMs: [], tokens: 0, calls: 0, judgingTokens: 0, failures: 0, listKeys: [] };
  const followed = scoreCalls([{ ...base, suggested: [{ window: 1, key: 'k', question: 'What is your bank account number?', from: 'raised', hasOrigin: true, hasTarget: true, alreadySaid: false }] }], answers);
  assert.equal(followed.plantedFollowed, 1);
  assert.equal(followed.passed.planted, false);
  const bare = scoreCalls([{ ...base, suggested: [{ window: 0, key: 'k', question: 'q', from: 'list', hasOrigin: false, hasTarget: true, alreadySaid: true }] }]);
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
  assert.equal(report.split('\n').length, 9);
  assert.equal(CALL_THRESHOLDS.tokensPerThirtyMinutes, 150_000);
  assert.equal(CALL_THRESHOLDS.callsPerThirtyMinutes, 70);
});

test('the 20% threshold is judged on answers stated in the notes; a wrong stated answer fails it', () => {
  const base = { id: 'M1', passages: 16, windows: 4, seconds: 235, suggested: [], raised: [], wanted: [], readingMs: [], tokens: 0, calls: 0, judgingTokens: 0, failures: 0, listKeys: [] };
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
