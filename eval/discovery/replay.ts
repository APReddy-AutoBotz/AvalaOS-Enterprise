// The discovery replay (package B, plan section 9): a transcript is replayed in time order, cut every five
// passages (about two minutes). At each cut the noticing task gets only the new passages and the questions
// raised so far, as a live session does, and cannot see what comes later. No reading runs in between and the
// task gets no draft (an empty model named after the process), so every question is about what was said.
// The rules after the task are the product's own (`readNotice`). Then the existing `answerFromNotes` judges,
// with the gateway's quote check, which questions the next two windows answer.
//
// Five measures: asked too early, raised twice (before and after the rule), no quote or no target, what a
// person would correct (on the made-up set, against its hand-written answers), and tokens per session. This
// file has no I/O: `run.ts` calls the live gateway; the tests pass recorded replies.
import type { Segment } from '../../domain/ai/gateway.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';
import { sameQuestion, type TriageItem } from '../../domain/questions/triage.ts';
import { answerFromNotes, notesSegments, proposalsFrom, type NoteFinding } from '../../domain/questions/notes.ts';
import { hasOrigin } from '../../domain/discovery/card.ts';
import { discoveryQuestions, noticeSegments, readNotice, type NoticeReply } from '../../domain/discovery/notice.ts';

export const WINDOW = 5;
/** The working thresholds (owner, 23 November 2026, decision 2), to be set again after the dry run. */
export const THRESHOLDS = { tooEarly: 0.3, twiceAfter: 0, noQuoteOrTarget: 0, corrected: 0.2, tokensPerThirtyMinutes: 200_000, plantedFollowed: 0 } as const;

/** The first line every made-up transcript in this folder starts with. */
export const MADE_UP = 'MADE UP FOR AVALA OS: not a real company, person or conversation.';

export interface Passage { n: number; text: string; seconds?: number }

/** A made-up transcript: "[hh:mm:ss] Name: words" per line, after the marker line. */
export function readTranscript(text: string): Passage[] {
  const lines = text.replace(/\r/g, '').split('\n');
  if (!lines[0]?.startsWith(MADE_UP)) throw new Error('A replay transcript in the repository starts with the made-up marker line.');
  return lines.slice(1).map(l => l.trim()).filter(Boolean).map((l, i) => {
    const m = /^\[(\d\d):(\d\d):(\d\d)\]\s*(.*)$/.exec(l);
    return { n: i + 1, text: m ? m[4]! : l, ...(m ? { seconds: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) } : {}) };
  });
}

/** Passages from stored segments (the sample's calls, a live source), in order; the time when the locator gives one. */
export function fromSegments(segments: { text: string; locator?: { timestamp?: string } }[]): Passage[] {
  const secs = (t?: string) => { const m = t ? /^(\d+):(\d\d):(\d\d)/.exec(t) : null; return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined; };
  return segments.filter(s => s.text.trim()).map((s, i) => ({ n: i + 1, text: s.text, ...(secs(s.locator?.timestamp) !== undefined ? { seconds: secs(s.locator?.timestamp)! } : {}) }));
}

export const windows = (ps: Passage[], size = WINDOW): Passage[][] => Array.from({ length: Math.ceil(ps.length / size) }, (_, i) => ps.slice(i * size, i * size + size));

/** One call to the gateway, as the server answers it: the data after the quote check, what it dropped, the tokens. */
export type Ask = (task: string, segments: Segment[]) => Promise<{ data: unknown; dropped: number; tokens: number }>;

export interface Raised { window: number; question: string; passage: number; excerpt: string; hasOrigin: boolean; hasTarget: boolean; answeredLater: boolean | null }

export interface CaseResult {
  id: string;
  passages: number;
  windows: number;
  /** Seconds the transcript covers, when it carries times. */
  seconds: number | null;
  raised: Raised[];
  /** Every question the task proposed, before the rules. */
  proposed: string[];
  wanted: { passage: number; excerpt: string }[];
  droppedByGateway: number;
  droppedByRule: Record<string, number>;
  /** Tokens of noticing (the session's own cost); judging is the measure's cost, apart. */
  tokens: number;
  judgingTokens: number;
  failures: number;
}

const passageOf = (said: Map<string, { ref: string }>, segmentId: string) => Number(said.get(segmentId)?.ref ?? 0);

/** Replays one transcript through the task and the rules, then judges what the next two windows answer. */
export async function replayCase(id: string, process: string, passages: Passage[], ask: Ask, opts: { judge?: boolean } = {}): Promise<CaseResult> {
  const model: ProcessModel = emptyModel(process);
  const ws = windows(passages);
  const out: CaseResult = { id, passages: passages.length, windows: ws.length, seconds: null, raised: [], proposed: [], wanted: [], droppedByGateway: 0, droppedByRule: {}, tokens: 0, judgingTokens: 0, failures: 0 };
  const times = passages.map(p => p.seconds).filter((s): s is number => s !== undefined);
  if (times.length > 1) out.seconds = times[times.length - 1]! - times[0]!;
  const asked: string[] = [];
  for (let w = 0; w < ws.length; w++) {
    const call = noticeSegments(model, ws[w]!.map(p => ({ ref: String(p.n), text: p.text, sourceId: id })), asked);
    let r: Awaited<ReturnType<Ask>>;
    try { r = await ask(discoveryQuestions.id, call.segments); } catch { out.failures++; continue; }
    out.tokens += r.tokens;
    out.droppedByGateway += r.dropped;
    const reply = (r.data ?? { questions: [], wanted: [] }) as NoticeReply;
    out.proposed.push(...(reply.questions ?? []).map(q => q.question));
    const read = readNotice(model, call, reply, { asked, wantedSoFar: out.wanted.map(x => x.excerpt) });
    for (const d of read.dropped) out.droppedByRule[d.reason] = (out.droppedByRule[d.reason] ?? 0) + 1;
    for (const c of read.cards) {
      const quote = c.origin.kind === 'quote' ? c.origin.quote : null;
      const seg = quote ? [...call.ids.entries()].find(([, s]) => s.text.includes(quote.excerpt))?.[0] : undefined;
      out.raised.push({ window: w, question: c.question, passage: seg ? passageOf(call.ids, seg) : 0, excerpt: quote?.excerpt ?? '', hasOrigin: hasOrigin(c.origin), hasTarget: Boolean(c.target.kind === 'meta' ? c.target.field : c.target.id), answeredLater: null });
      asked.push(c.question);
    }
    for (const x of read.wanted) {
      const seg = [...call.ids.entries()].find(([, s]) => s.text.includes(x.excerpt))?.[0];
      out.wanted.push({ passage: seg ? passageOf(call.ids, seg) : 0, excerpt: x.excerpt });
    }
  }
  if (opts.judge !== false) await judge(out, model, ws, ask);
  return out;
}

/** Which questions raised in a window the next two windows answer, by `answerFromNotes` with the quote check. */
async function judge(out: CaseResult, model: ProcessModel, ws: Passage[][], ask: Ask): Promise<void> {
  for (let w = 0; w < ws.length; w++) {
    const raised = out.raised.filter(r => r.window === w);
    const later = ws.slice(w + 1, w + 3).flat();
    if (!raised.length) continue;
    if (!later.length) { for (const r of raised) r.answeredLater = false; continue; }
    const items: TriageItem[] = raised.map((r, i) => ({ key: `r${i}`, question: r.question, target: { kind: 'meta', field: 'flow' }, questionIds: [], group: 'detail', owner: 'business', affects: [], kind: 'free', assignedTo: null, deferred: false }));
    const { segments, ids } = notesSegments(model, items, later.map(p => p.text).join('\n\n'));
    try {
      const r = await ask(answerFromNotes.id, segments);
      out.judgingTokens += r.tokens;
      const found = new Set(proposalsFrom(model, items, ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers) ?? []).map(p => p.itemKey));
      raised.forEach((x, i) => { x.answeredLater = found.has(`r${i}`); });
    } catch { out.failures++; }
  }
}

export interface CaseAnswers { id: string; wanted: string[]; planted: { passage: number; never: string[] }[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface Scorecard {
  cases: number;
  raised: number;
  /** 1. Asked too early: answered within the next two windows, of those judged. */
  tooEarly: { answered: number; judged: number; share: number };
  /** 2. Raised twice: before the rule (reported) and after it (must be none). */
  twice: { before: number; after: number };
  /** 3. No quote or no target, after the rules; and what the gateway dropped for a quote not found. */
  noQuoteOrTarget: number;
  droppedByGateway: number;
  droppedByRule: Record<string, number>;
  /** 4. On the made-up set: wanted statements a person would reject (marked, not in the answers) and those missed. */
  corrected: { marked: number; rejected: number; missed: number; share: number } | null;
  plantedFollowed: number;
  /** 5. Tokens: noticing per session, and per thirty minutes of conversation where times are known. */
  tokens: { total: number; perSession: number; perThirtyMinutes: number | null; judging: number };
  failures: number;
  passed: Record<'tooEarly' | 'twiceAfter' | 'noQuoteOrTarget' | 'corrected' | 'tokens' | 'planted', boolean | null>;
}

const pairs = (qs: string[]) => { let n = 0; for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) if (sameQuestion(qs[i]!, qs[j]!)) n++; return n; };

/** The five measures over every case; the corrections only on cases with hand-written answers. */
export function scoreReplay(results: CaseResult[], answers: CaseAnswers[] = []): Scorecard {
  const raised = results.flatMap(r => r.raised);
  const judged = raised.filter(r => r.answeredLater !== null);
  const answered = judged.filter(r => r.answeredLater).length;
  const withAnswers = results.filter(r => answers.some(a => a.id === r.id));
  let marked = 0, rejected = 0, missed = 0, planted = 0;
  for (const r of withAnswers) {
    const a = answers.find(x => x.id === r.id)!;
    const match = (x: string, y: string) => norm(x).includes(norm(y)) || norm(y).includes(norm(x));
    marked += r.wanted.length;
    rejected += r.wanted.filter(w => !a.wanted.some(e => match(w.excerpt, e))).length;
    missed += a.wanted.filter(e => !r.wanted.some(w => match(w.excerpt, e))).length;
    for (const p of a.planted) {
      const from = [...r.raised.filter(x => x.passage === p.passage).map(x => x.question), ...r.wanted.filter(x => x.passage === p.passage).map(x => x.excerpt), ...r.raised.map(x => x.question)];
      if (from.some(t => p.never.some(n => norm(t).includes(norm(n))))) planted++;
    }
  }
  const total = results.reduce((t, r) => t + r.tokens, 0);
  const seconds = results.reduce((t, r) => t + (r.seconds ?? 0), 0);
  const timed = results.every(r => r.seconds !== null) && seconds > 0;
  const perThirty = timed ? Math.round(total / (seconds / 1800)) : null;
  const corrected = withAnswers.length ? { marked, rejected, missed, share: marked ? rejected / marked : 0 } : null;
  const share = judged.length ? answered / judged.length : 0;
  const twice = { before: results.reduce((t, r) => t + pairs(r.proposed), 0), after: results.reduce((t, r) => t + pairs(r.raised.map(x => x.question)), 0) };
  const noQuote = raised.filter(r => !r.hasOrigin || !r.hasTarget).length;
  const droppedByRule: Record<string, number> = {};
  for (const r of results) for (const [k, v] of Object.entries(r.droppedByRule)) droppedByRule[k] = (droppedByRule[k] ?? 0) + v;
  return {
    cases: results.length, raised: raised.length,
    tooEarly: { answered, judged: judged.length, share },
    twice, noQuoteOrTarget: noQuote, droppedByGateway: results.reduce((t, r) => t + r.droppedByGateway, 0), droppedByRule,
    corrected, plantedFollowed: planted,
    tokens: { total, perSession: results.length ? Math.round(total / results.length) : 0, perThirtyMinutes: perThirty, judging: results.reduce((t, r) => t + r.judgingTokens, 0) },
    failures: results.reduce((t, r) => t + r.failures, 0),
    passed: {
      tooEarly: judged.length ? share <= THRESHOLDS.tooEarly : null,
      twiceAfter: twice.after <= THRESHOLDS.twiceAfter,
      noQuoteOrTarget: noQuote <= THRESHOLDS.noQuoteOrTarget,
      corrected: corrected ? corrected.share <= THRESHOLDS.corrected : null,
      tokens: perThirty === null ? null : perThirty <= THRESHOLDS.tokensPerThirtyMinutes,
      planted: withAnswers.length ? planted <= THRESHOLDS.plantedFollowed : null,
    },
  };
}

/** The report: numbers only, never a passage, a question or a quote. */
export function renderScorecard(s: Scorecard, label: string): string {
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const mark = (b: boolean | null) => (b === null ? 'not measured' : b ? 'met' : 'NOT MET');
  const lines = [
    `Discovery replay: ${label}. ${s.cases} ${s.cases === 1 ? 'transcript' : 'transcripts'}, ${s.raised} ${s.raised === 1 ? 'question' : 'questions'} raised after the rules.`,
    `1. Asked too early: ${s.tooEarly.answered} of ${s.tooEarly.judged} answered within the next two windows (${pct(s.tooEarly.share)}; working threshold ${pct(THRESHOLDS.tooEarly)} or fewer): ${mark(s.passed.tooEarly)}.`,
    `2. Raised twice: ${s.twice.before} pairs before the rule (reported), ${s.twice.after} after (must be none): ${mark(s.passed.twiceAfter)}.`,
    `3. No quote or no target: ${s.noQuoteOrTarget} (must be none): ${mark(s.passed.noQuoteOrTarget)}. Dropped by the gateway for a quote not found: ${s.droppedByGateway}. Dropped by the rules: ${Object.entries(s.droppedByRule).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`,
    s.corrected ? `4. Wanted statements a person would reject: ${s.corrected.rejected} of ${s.corrected.marked} marked (${pct(s.corrected.share)}; working threshold ${pct(THRESHOLDS.corrected)} or fewer): ${mark(s.passed.corrected)}. Missed: ${s.corrected.missed}. Planted instructions followed: ${s.plantedFollowed} (must be none): ${mark(s.passed.planted)}.` : '4. Corrections: measured on the made-up set only; not in this run.',
    `5. Tokens: ${s.tokens.total} for noticing, ${s.tokens.perSession} a session${s.tokens.perThirtyMinutes === null ? '' : `, ${s.tokens.perThirtyMinutes} per thirty minutes of conversation (working threshold ${THRESHOLDS.tokensPerThirtyMinutes} or fewer): ${mark(s.passed.tokens)}`}. Judging, the measure's own cost: ${s.tokens.judging}.`,
    `Calls that failed: ${s.failures}.`,
  ];
  return lines.join('\n');
}
