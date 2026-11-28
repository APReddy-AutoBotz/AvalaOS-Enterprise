// The independent check, on recorded replies with the server's own quote check: no AI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyExcerpts, type Segment } from '../../../domain/ai/gateway.ts';
import { TASKS } from '../../../domain/ai/tasks.ts';
import { readTranscript, type Ask } from '../replay.ts';
import { DRAFTS } from './drafts.ts';
import { compareCall, compareLong, renderCompare, renderLong, scoreAnswer, type ReadTally } from './compare.ts';
import type { CallAnswers, CallCase } from './replay.ts';

const dir = new URL('./', import.meta.url);
type Entry = CallAnswers & { file: string; draft: string; process: string; attendees: CallCase['attendees'] };
const answers = (JSON.parse(readFileSync(new URL('answers.json', dir), 'utf8')) as { cases: Entry[] }).cases;
const caseOf = (a: Entry): CallCase => ({ id: a.id, process: a.process, model: DRAFTS[a.draft]!(), attendees: a.attendees, passages: readTranscript(readFileSync(new URL(a.file, dir), 'utf8')) });
const blank = (): ReadTally => ({ right: { stated: 0, inferred: 0 }, wrong: { stated: 0, inferred: 0 }, missed: 0, rightlyEmpty: 0, tokens: 0, calls: 0, failures: 0 });

test('one answer against the hand-written one: right, wrong, missed or rightly left unanswered', () => {
  const t = blank();
  scoreAnswer(t, ['400'], { display: 'About 400 a month', certainty: 'stated' });
  scoreAnswer(t, ['400'], { display: 'About 300 a month', certainty: 'inferred' });
  scoreAnswer(t, '*', { display: 'anything', certainty: 'inferred' });
  scoreAnswer(t, null, { display: 'an answer the notes do not give', certainty: 'stated' });
  scoreAnswer(t, ['400'], undefined);
  scoreAnswer(t, '*', undefined);
  scoreAnswer(t, null, undefined);
  assert.deepEqual([t.right, t.wrong, t.missed, t.rightlyEmpty], [{ stated: 1, inferred: 1 }, { stated: 1, inferred: 1 }, 2, 1]);
});

test('every question with a hand-written answer is read alone and together against all the notes, and scored', async () => {
  const a = answers.find(x => x.id === 'M1')!;
  const seen: { questions: number; notes: number }[] = [];
  // A made-up reader: it answers the volume question from the note that gives it, whether alone or together.
  const ask: Ask = async (task: string, segments: Segment[]) => {
    const qs = segments.filter(s => s.id.startsWith('q:'));
    const ns = segments.filter(s => s.id.startsWith('n:'));
    seen.push({ questions: qs.length, notes: ns.length });
    const q = qs.find(s => /About how many cases/.test(s.text));
    const n = ns.find(s => /400/.test(s.text));
    const data = q && n ? { answers: [{ questionId: q.id, value: '400', interface: '', certainty: 'stated', segmentId: n.id, excerpt: n.text.slice(n.text.indexOf('400') - 6, n.text.indexOf('400') + 3) }] } : { answers: [] };
    const v = verifyExcerpts(data, TASKS[task]!.verifyArrays ?? [], segments);
    return { data: v.data, dropped: v.dropped.length, tokens: 1000 };
  };
  const r = await compareCall(caseOf(a), a, ask);
  assert.ok(r.questions > 0 && r.questions + r.notRead === Object.keys(a.expected).length);
  assert.equal(r.alone.calls, r.questions, 'one call a question, read alone');
  assert.ok(r.together.calls >= 1 && r.together.calls <= 2, 'the end reading\'s own calls');
  const all = seen[0]!.notes;
  assert.ok(seen.every(x => x.notes === all), 'every read has every note');
  assert.ok(seen.slice(r.together.calls).every(x => x.questions === 1));
  for (const k of ['alone', 'together'] as const) {
    const t = r[k];
    assert.equal(t.right.stated + t.right.inferred + t.wrong.stated + t.wrong.inferred + t.missed + t.rightlyEmpty, r.questions);
    assert.equal(t.right.stated, 1, 'the volume, read right both ways');
  }
  const report = renderCompare([r]);
  assert.match(report, /^Independent check: 1 made-up calls, \d+ questions with a hand-written answer/);
  assert.match(report, /Each question read alone: right \d+ of \d+/);
  assert.match(report, /All read together \(as the end reading\): right \d+ of \d+/);
  for (const w of [/\b400\b/, /claim/i, /tomás/i, /payroll/i]) assert.ok(!w.test(report), 'numbers only: no value or words of the notes');
});

test('the long call: agreements and disagreements are counted, stated and inferred apart, and each disagreement is printed', async () => {
  const a = answers.find(x => x.id === 'M1')!;
  const c = caseOf(a);
  const reply = (q: Segment, n: Segment, value: string, certainty: string) => ({ questionId: q.id, value, interface: '', certainty, segmentId: n.id, excerpt: n.text.split(/\s+/).slice(0, 4).join(' ') });
  // Together answers the volume only; alone answers the volume the same way, and the claim's start (stated) as well.
  const ask: Ask = async (task: string, segments: Segment[]) => {
    const qs = segments.filter(s => s.id.startsWith('q:'));
    const ns = segments.filter(s => s.id.startsWith('n:'));
    const vol = qs.find(s => /About how many cases/.test(s.text));
    const start = qs.find(s => /What starts the work/.test(s.text));
    const n400 = ns.find(s => /400/.test(s.text))!;
    const answers = [];
    if (vol) answers.push({ ...reply(vol, n400, '400', 'stated'), excerpt: 'About 400 claims' });
    if (start && qs.length === 1) answers.push(reply(start, ns[0]!, 'A claim form', 'stated'));
    const v = verifyExcerpts({ answers }, TASKS[task]!.verifyArrays ?? [], segments);
    return { data: v.data, dropped: v.dropped.length, tokens: 1000 };
  };
  const r = await compareLong(c, ask, 10);
  assert.equal(r.questions, 10);
  assert.equal(r.alone.calls, 10);
  assert.equal(r.together.calls, 1, 'the end reading\'s own first call');
  const counted = r.same.stated + r.same.other + r.different + r.onlyAlone.stated + r.onlyAlone.inferred + r.onlyTogether.stated + r.onlyTogether.inferred + r.neither;
  assert.equal(counted, r.questions, 'every question counted once');
  assert.ok(r.same.stated >= 1, 'the volume: both stated, the same');
  assert.equal(r.onlyAlone.stated, 1, 'the start: only reading alone');
  assert.equal(r.disagreements.length, 1);
  assert.equal(r.disagreements[0]!.together, null);
  const report = renderLong(r);
  assert.match(report, /Only reading alone found one: 1 stated, 0 inferred\./);
  assert.match(report, /1\. What starts the work[^\n]*\n   Alone: "A claim form" \(stated\), from "[^"]+"\.\n   Together: no answer\./);
});
