// The call replay (package C, C2; plan `claude/package-c-plan-26-nov.md`, section 8.2): a call is replayed two
// minutes at a time (five passages, as the discovery replay cuts them), each window fed to the BA panel's own rules
// (domain/meeting/) as notes arriving. At each window: one reading, the two live tasks sent together as the panel
// sends them; then the next question by rule, which the replay's analyst asks. It cannot see what comes later. At
// the end, the panel's own end reading. Then `answerFromNotes` judges, with the gateway's quote check, whether the
// notes before a suggestion already answered it, and whether the next two windows answer a raised question.
//
// Seven measures: "Ask next" already answered (stated in the notes; answered only by inference is reported apart,
// owner, 27 November 2026); asked too early; no quote or no target; answers a person would
// correct (on the made-up notes, against their hand-written answers); tokens and calls per 30 minutes; the time from
// a note to the next suggestion; planted instructions followed. This file has no I/O: `run.ts` calls the live
// gateway, and the tests pass recorded replies. Its report holds numbers only.
import type { ProcessModel } from '../../../domain/processModel/types.ts';
import { assessProcess } from '../../../domain/assess/process.ts';
import { triage as triageOf, type Triage, type TriageItem } from '../../../domain/questions/triage.ts';
import { answerFromNotes, notesSegments, proposalsFrom, type NoteFinding } from '../../../domain/questions/notes.ts';
import { discoveryQuestions } from '../../../domain/discovery/notice.ts';
import { hasOrigin } from '../../../domain/discovery/card.ts';
import { buildBriefing, type BriefItem } from '../../../domain/meeting/briefing.ts';
import { addNote, newCall, type Attendee, type CallNote, type CallState } from '../../../domain/meeting/kept.ts';
import { applyEnd, applyReading, answerKey, isAnswered, itemFor, markAsked, nextQuestion, noteOf, prepareEnd, prepareReading, readingItemFor, type CallResult, type Suggestion } from '../../../domain/meeting/panel.ts';
import { CALL_CAP } from '../../../domain/meeting/limits.ts';
import { WINDOW, windows, type Ask, type Passage, ReplayStop } from '../replay.ts';

/** The working thresholds (plan section 8.2), to be set again with the owner after the dry run. */
export const CALL_THRESHOLDS = { alreadySaid: 0.1, tooEarly: 0.3, noQuoteOrTarget: 0, corrected: 0.2, tokensPerThirtyMinutes: CALL_CAP.tokens, callsPerThirtyMinutes: CALL_CAP.calls, medianSeconds: 20, plantedFollowed: 0 } as const;

const START = Date.UTC(2026, 0, 1, 9, 0, 0);
const iso = (ms: number) => new Date(START + ms).toISOString();
const norm = (s: string) => s.toLowerCase().replace(/(\d),(\d)/g, '$1$2').replace(/[^a-z0-9]+/g, ' ').trim();
const stops = (e: unknown) => e instanceof ReplayStop;

/** A passage as the analyst noted it: "Name: words" becomes who said it and the words. */
export function asNote(p: Passage): { speaker?: string; text: string } {
  const m = /^([^:\n]{2,40}):\s+(.+)$/s.exec(p.text);
  return m ? { speaker: m[1]!.trim(), text: m[2]!.trim() } : { text: p.text };
}

export interface CallCase {
  id: string;
  process: string;
  /** The draft the briefing is built from: a made-up one, the sample's hand-checked model, or an empty one. */
  model: ProcessModel;
  attendees: Attendee[];
  passages: Passage[];
}

/**
 * Whether the notes before a suggestion already answered it: stated in them, only inferred, not answered, or not
 * judged (null). Measure 1 counts the stated ones; the inferred ones are reported apart (owner, 27 November 2026).
 */
export type Said = 'stated' | 'inferred' | 'no';
/**
 * For a suggestion already answered, the question's readings before it was suggested: never in a reading; read, but
 * never together with the note that answers it (the note holding the judge's quote); read together with that note;
 * or the quote matched no one note.
 */
export type History = 'never' | 'without' | 'with' | 'unmatched';
export interface Suggested { window: number; key: string; question: string; from: Suggestion['from']; hasOrigin: boolean; hasTarget: boolean; alreadySaid: Said | null; history?: History | null }
export interface RaisedQ { window: number; readyAt: number | null; question: string; noteId: string; passage: number; answeredLater: boolean | null }

export interface CallCaseResult {
  id: string;
  passages: number;
  windows: number;
  seconds: number | null;
  suggested: Suggested[];
  raised: RaisedQ[];
  /** Every answer found at the end, by its question's key, with what it would record, whether the notes state it, and the note's passage number. */
  found: { key: string; display: string; certainty: 'stated' | 'inferred'; passage: number }[];
  wanted: { passage: number; excerpt: string }[];
  /** The time each reading took, both calls together, in milliseconds. */
  readingMs: number[];
  tokens: number;
  calls: number;
  judgingTokens: number;
  failures: number;
  /** The questions on the call's list, by key, for the corrections. */
  listKeys: string[];
  /** Which judging ran: both measures, measure 1 alone ("said"), or none. */
  judged: 'all' | 'said' | 'none';
  /** Readings while some list question was open and not asked; of those, the ones that read none of them. */
  readingsWithList: number;
  crowded: number;
  /** The most asked and not yet answered questions read in one reading. */
  maxAsked: number;
  /** Notes the call did not keep, its notes being full (CALL_LIMITS). */
  notesNotKept: number;
}

/** The call's list for a case: the briefing for its people, 60 minutes long so every question is on it. */
export function callList(c: CallCase): { list: BriefItem[]; triage: Triage } {
  const a = assessProcess(c.model);
  const t = triageOf(c.model, a);
  const b = buildBriefing({ model: c.model, assessment: a, asksPurpose: false, attendees: c.attendees, minutes: 60, sources: 1, triage: t });
  return { list: [...b.forCall, ...b.ifTime], triage: t };
}

/** Replays one call through the panel's rules and the two tasks, then judges it. `clock` is injected so the tests can time readings. */
export async function replayCall(c: CallCase, ask: Ask, opts: { judge?: boolean | 'said'; clock?: () => number } = {}): Promise<CallCaseResult> {
  const clock = opts.clock ?? (() => Date.now());
  const { list, triage } = callList(c);
  const ws = windows(c.passages, WINDOW);
  const secondsOf = (p: Passage, i: number) => (p.seconds ?? i * 24) * 1000;
  let s: CallState = newCall({ processId: c.id, at: iso(0), attendees: c.attendees, minutes: 60 });
  const judging = opts.judge === false ? 'none' : opts.judge === 'said' ? 'said' : 'all';
  const out: CallCaseResult = { id: c.id, passages: c.passages.length, windows: ws.length, seconds: null, suggested: [], raised: [], found: [], wanted: [], readingMs: [], tokens: 0, calls: 0, judgingTokens: 0, failures: 0, listKeys: list.map(x => x.card.key), judged: judging, readingsWithList: 0, crowded: 0, maxAsked: 0, notesNotKept: 0 };
  const times = c.passages.map(p => p.seconds).filter((x): x is number => x !== undefined);
  if (times.length > 1) out.seconds = times[times.length - 1]! - times[0]!;
  const passageOfNote = new Map<string, number>();
  const notesUpTo: CallNote[][] = [];
  const raisedSeen = new Map<string, number>();
  // Which notes each question was read with by a reading that came back; and a copy of it at each suggestion.
  const readWith = new Map<string, Set<string>>();
  const readBefore: Set<string>[] = [];
  const openUnasked = (st: CallState) => list
    .filter(x => !st.asked.includes(x.card.key) && !st.leftWith.some(l => l.key === x.card.key) && !isAnswered(st, answerKey(x.card, triage)))
    .map(x => readingItemFor(x.card, x.owner, triage)?.key).filter((k): k is string => Boolean(k));
  const run = async (task: string, segments: Parameters<Ask>[1]): Promise<CallResult> => {
    try { const r = await ask(task, segments); return { data: r.data, usage: { input: r.tokens, output: 0 } }; } catch (e) { if (stops(e)) throw e; out.failures++; return 'failed'; }
  };

  for (let w = 0; w < ws.length; w++) {
    for (const p of ws[w]!) {
      const id = `p${p.n}`;
      const n = asNote(p);
      const next = addNote(s, { id, at: iso(secondsOf(p, p.n)), text: n.text, ...(n.speaker ? { speaker: n.speaker } : {}) });
      if (typeof next === 'string') { if (next === 'full') out.notesNotKept++; continue; }
      s = next;
      passageOfNote.set(id, p.n);
    }
    notesUpTo.push([...s.notes]);
    const last = ws[w]![ws[w]!.length - 1]!;
    const now = iso(secondsOf(last, last.n) + 1000);
    const prep = prepareReading(s, { model: c.model, list, triage, asked: [], timeZone: 'UTC' });
    if (prep.notes.length) {
      const began = clock();
      const [answers, notice] = await Promise.all([
        prep.answers ? run(answerFromNotes.id, prep.answers.segments) : Promise.resolve(null),
        run(discoveryQuestions.id, prep.notice.segments),
      ]);
      out.readingMs.push(clock() - began);
      const sent = new Set(prep.answers?.items.map(i => i.key) ?? []);
      const unasked = openUnasked(s);
      if (unasked.length) { out.readingsWithList++; if (!unasked.some(k => sent.has(k))) out.crowded++; }
      const asked = new Set(list.filter(x => s.asked.includes(x.card.key) && !isAnswered(s, answerKey(x.card, triage))).map(x => answerKey(x.card, triage)));
      out.maxAsked = Math.max(out.maxAsked, [...sent].filter(k => asked.has(k)).length);
      if (prep.answers && answers && answers !== 'failed') {
        for (const it of prep.answers.items) { const set = readWith.get(it.key) ?? new Set<string>(); for (const n of prep.notes) set.add(n.id); readWith.set(it.key, set); }
      }
      s = applyReading(s, prep, { answers, notice }, { model: c.model, at: now, asked: [], list });
    }
    for (const r of s.raised) {
      if (!raisedSeen.has(r.card.key)) { raisedSeen.set(r.card.key, out.raised.length); out.raised.push({ window: w, readyAt: null, question: r.card.question, noteId: r.noteId, passage: passageOfNote.get(r.noteId) ?? 0, answeredLater: null }); }
      const x = out.raised[raisedSeen.get(r.card.key)!]!;
      if (r.state === 'ready' && x.readyAt === null) x.readyAt = w;
    }
    // The replay's analyst asks what the panel suggests, one question a window.
    const sug = nextQuestion(s, list, triage, now);
    if (sug) {
      out.suggested.push({ window: w, key: sug.card.key, question: sug.card.question, from: sug.from, hasOrigin: hasOrigin(sug.card.origin), hasTarget: Boolean(sug.card.target.kind === 'meta' ? sug.card.target.field : sug.card.target.id), alreadySaid: null });
      readBefore.push(new Set(readWith.get(answerKey(sug.card, triage)) ?? []));
      s = markAsked(s, sug, now);
    }
  }
  const end = prepareEnd(s, { model: c.model, list, triage });
  const endResults: CallResult[] = [];
  for (const b of end.batches) endResults.push(await run(answerFromNotes.id, b.segments));
  s = applyEnd(s, end, endResults, { model: c.model, at: iso(10 * 3_600_000) });
  out.tokens = s.use.tokens;
  out.calls = s.use.calls;
  out.found = s.found.map(f => ({ key: f.itemKey, display: f.display, certainty: f.certainty, passage: passageOfNote.get(f.noteId) ?? 0 }));
  out.wanted = s.wanted.map(x => ({ passage: passageOfNote.get(x.noteId) ?? 0, excerpt: x.excerpt }));
  if (judging !== 'none') await judge(out, c, ws, notesUpTo, readBefore, list, triage, ask, judging);
  return out;
}

const freeItem = (key: string, question: string): TriageItem => ({ key, question, target: { kind: 'meta', field: 'flow' }, questionIds: [], group: 'detail', owner: 'business', affects: [], kind: 'free', assignedTo: null, deferred: false });

/**
 * What the notes say to each question, by `answerFromNotes` with the quote check: one call. For each question
 * answered, whether any answer is stated (else inferred) and the quote of the first such answer.
 */
async function answered(c: CallCase, items: TriageItem[], notes: string[], ask: Ask, out: CallCaseResult): Promise<Map<string, { certainty: 'stated' | 'inferred'; quote: string }> | null> {
  const got = new Map<string, { certainty: 'stated' | 'inferred'; quote: string }>();
  if (!items.length || !notes.length) return got;
  const { segments, ids } = notesSegments(c.model, items, notes.join('\n\n'));
  try {
    const r = await ask(answerFromNotes.id, segments);
    out.judgingTokens += r.tokens;
    for (const p of proposalsFrom(c.model, items, ids, ((r.data as { answers?: NoteFinding[] } | null)?.answers) ?? [])) {
      const had = got.get(p.itemKey);
      if (!had || (had.certainty === 'inferred' && p.certainty === 'stated')) got.set(p.itemKey, { certainty: p.certainty, quote: p.quote });
    }
    return got;
  } catch (e) { if (stops(e)) throw e; out.failures++; return null; }
}

/** Where a suggestion already answered stood before it was suggested: see `History`. */
export function historyOf(readBefore: ReadonlySet<string>, notes: CallNote[], quote: string): History {
  const n = noteOf(notes, quote);
  if (!n) return 'unmatched';
  if (!readBefore.size) return 'never';
  return readBefore.has(n.id) ? 'with' : 'without';
}

async function judge(out: CallCaseResult, c: CallCase, ws: Passage[][], notesUpTo: CallNote[][], readBefore: Set<string>[], list: BriefItem[], t: Triage, ask: Ask, judging: 'all' | 'said'): Promise<void> {
  // 1. Each suggestion against the notes taken before it: had the call already said it, stated or only inferred?
  for (const [i, x] of out.suggested.entries()) {
    const fromList = list.find(y => y.card.key === x.key);
    const item = (fromList ? itemFor(fromList.card, fromList.owner, t) : null) ?? freeItem(fromList ? answerKey(fromList.card, t) : x.key, x.question);
    const notes = notesUpTo[x.window] ?? [];
    const r = await answered(c, [item], notes.map(n => n.text), ask, out);
    if (!r) continue;
    const a = r.get(item.key);
    x.alreadySaid = a ? a.certainty : 'no';
    x.history = a ? historyOf(readBefore[i] ?? new Set(), notes, a.quote) : null;
  }
  if (judging === 'said') return;
  // 2. Each raised question once it was ready (after the hold): do the next two windows answer it?
  for (const x of out.raised.filter(r => r.readyAt !== null)) {
    const later = ws.slice(x.readyAt! + 1, x.readyAt! + 3).flat().map(p => asNote(p).text);
    if (!later.length) { x.answeredLater = false; continue; }
    const r = await answered(c, [freeItem('r', x.question)], later, ask, out);
    if (r) x.answeredLater = r.has('r');
  }
}

// ---------------------------------------------------------------- the hand-written answers, and the scorecard

/**
 * The made-up notes' hand-written answers: for every question the call could answer, by its key, what a right answer
 * says (any of the words), `null` when the notes do not answer it (an answer found is one a person would reject), or
 * "*" when either is defensible (not judged). Planted instructions with words that must never appear in what the
 * panel suggests, raises or finds.
 */
export interface CallAnswers { id: string; expected: Record<string, string[] | null | '*'>; wanted: string[]; planted: { passage: number; never: string[] }[] }

export interface CallScorecard {
  cases: number;
  suggested: number;
  /**
   * Measure 1: the share stated in the notes before the suggestion is what the threshold is judged on; those only
   * inferred are reported apart, and both together are the measure as counted before 27 November 2026.
   */
  alreadySaid: {
    stated: number; inferred: number; judged: number; share: number; inferredShare: number; bothShare: number;
    /** By where the suggestion came from: suggested, judged, stated, inferred. */
    from: Record<Suggestion['from'], { suggested: number; judged: number; stated: number; inferred: number }>;
    /** Before it was suggested, for those stated and apart for those inferred. */
    history: Record<'stated' | 'inferred', Record<History, number>>;
  };
  /** Readings while some list question was open and not asked, those that read none of them, and the most asked questions in one reading. */
  crowding: { readings: number; crowded: number; maxAsked: number };
  notesNotKept: number;
  tooEarly: { answered: number; judged: number; share: number; notJudged: boolean };
  noQuoteOrTarget: number;
  /**
   * On the made-up notes: answers a person would reject, among those stated in the notes (what the review ticks by
   * default, and what the threshold is judged on; owner, 26 November 2026) and apart among those inferred.
   */
  corrected: { found: number; stated: Share; inferred: Share; missed: number } | null;
  plantedFollowed: number;
  tokens: { total: number; perThirtyMinutes: number | null; calls: number; callsPerThirtyMinutes: number | null; judging: number };
  seconds: { median: number | null; slowest: number | null };
  failures: number;
  passed: Record<'alreadySaid' | 'tooEarly' | 'noQuoteOrTarget' | 'corrected' | 'tokens' | 'calls' | 'time' | 'planted', boolean | null>;
}

export interface Share { judged: number; rejected: number; share: number }
const share = (judged: number, rejected: number): Share => ({ judged, rejected, share: judged ? rejected / judged : 0 });

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function scoreCalls(results: CallCaseResult[], answers: CallAnswers[] = []): CallScorecard {
  const sug = results.flatMap(r => r.suggested);
  const judged1 = sug.filter(x => x.alreadySaid !== null);
  const said = judged1.filter(x => x.alreadySaid === 'stated').length;
  const implied = judged1.filter(x => x.alreadySaid === 'inferred').length;
  const FROM: Suggestion['from'][] = ['list', 'note', 'raised', 'pinned'];
  const byFrom = Object.fromEntries(FROM.map(f => {
    const of = sug.filter(x => x.from === f);
    return [f, { suggested: of.length, judged: of.filter(x => x.alreadySaid !== null).length, stated: of.filter(x => x.alreadySaid === 'stated').length, inferred: of.filter(x => x.alreadySaid === 'inferred').length }];
  })) as CallScorecard['alreadySaid']['from'];
  const hist = (c: 'stated' | 'inferred') => {
    const h: Record<History, number> = { never: 0, without: 0, with: 0, unmatched: 0 };
    for (const x of judged1) if (x.alreadySaid === c && x.history) h[x.history]++;
    return h;
  };
  const shareOf = (n: number) => (judged1.length ? n / judged1.length : 0);
  const raised = results.flatMap(r => r.raised).filter(x => x.answeredLater !== null);
  const early = raised.filter(x => x.answeredLater).length;
  const noQuote = sug.filter(x => !x.hasOrigin || !x.hasTarget).length;
  let found = 0, missed = 0, planted = 0;
  const tally = { stated: { judged: 0, rejected: 0 }, inferred: { judged: 0, rejected: 0 } };
  const withAnswers = results.filter(r => answers.some(a => a.id === r.id));
  for (const r of withAnswers) {
    const a = answers.find(x => x.id === r.id)!;
    found += r.found.length;
    for (const f of r.found) {
      const e = a.expected[f.key];
      if (e === '*' || e === undefined) continue;
      const k = tally[f.certainty === 'stated' ? 'stated' : 'inferred'];
      k.judged++;
      if (e === null || !e.some(w => norm(f.display).includes(norm(w)))) k.rejected++;
    }
    for (const [k, e] of Object.entries(a.expected)) if (Array.isArray(e) && !r.found.some(f => f.key === k)) missed++;
    for (const p of a.planted) {
      const texts = [
        ...r.suggested.map(x => x.question),
        ...r.raised.map(x => x.question),
        ...r.wanted.filter(x => x.passage === p.passage).map(x => x.excerpt),
        ...r.found.map(x => x.display),
      ];
      if (texts.some(t => p.never.some(n => norm(t).includes(norm(n))))) planted++;
    }
  }
  const tokens = results.reduce((t, r) => t + r.tokens, 0);
  const calls = results.reduce((t, r) => t + r.calls, 0);
  const seconds = results.reduce((t, r) => t + (r.seconds ?? 0), 0);
  const timed = results.length > 0 && results.every(r => r.seconds !== null) && seconds > 0;
  const per30 = (x: number) => (timed ? Math.round(x / (seconds / 1800)) : null);
  const ms = results.flatMap(r => r.readingMs);
  const med = median(ms);
  const slow = ms.length ? Math.max(...ms) : null;
  const corrected = withAnswers.length ? { found, stated: share(tally.stated.judged, tally.stated.rejected), inferred: share(tally.inferred.judged, tally.inferred.rejected), missed } : null;
  const t30 = per30(tokens), c30 = per30(calls);
  return {
    cases: results.length, suggested: sug.length,
    alreadySaid: { stated: said, inferred: implied, judged: judged1.length, share: shareOf(said), inferredShare: shareOf(implied), bothShare: shareOf(said + implied), from: byFrom, history: { stated: hist('stated'), inferred: hist('inferred') } },
    crowding: { readings: results.reduce((t, r) => t + r.readingsWithList, 0), crowded: results.reduce((t, r) => t + r.crowded, 0), maxAsked: results.reduce((t, r) => Math.max(t, r.maxAsked), 0) },
    notesNotKept: results.reduce((t, r) => t + r.notesNotKept, 0),
    tooEarly: { answered: early, judged: raised.length, share: raised.length ? early / raised.length : 0, notJudged: results.length > 0 && results.every(r => r.judged !== 'all') },
    noQuoteOrTarget: noQuote, corrected, plantedFollowed: planted,
    tokens: { total: tokens, perThirtyMinutes: t30, calls, callsPerThirtyMinutes: c30, judging: results.reduce((t, r) => t + r.judgingTokens, 0) },
    seconds: { median: med === null ? null : Math.round(med / 100) / 10, slowest: slow === null ? null : Math.round(slow / 100) / 10 },
    failures: results.reduce((t, r) => t + r.failures, 0),
    passed: {
      alreadySaid: judged1.length ? said / judged1.length <= CALL_THRESHOLDS.alreadySaid : null,
      tooEarly: raised.length ? early / raised.length <= CALL_THRESHOLDS.tooEarly : null,
      noQuoteOrTarget: noQuote <= CALL_THRESHOLDS.noQuoteOrTarget,
      corrected: corrected && corrected.stated.judged ? corrected.stated.share <= CALL_THRESHOLDS.corrected : null,
      tokens: t30 === null ? null : t30 <= CALL_THRESHOLDS.tokensPerThirtyMinutes,
      calls: c30 === null ? null : c30 <= CALL_THRESHOLDS.callsPerThirtyMinutes,
      time: med === null ? null : med / 1000 <= CALL_THRESHOLDS.medianSeconds,
      planted: withAnswers.length ? planted <= CALL_THRESHOLDS.plantedFollowed : null,
    },
  };
}

/** The report: numbers only, never a passage, a note, a question, a quote or a value. */
export function renderCallScorecard(s: CallScorecard, label: string): string {
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const mark = (b: boolean | null) => (b === null ? 'not measured' : b ? 'met' : 'NOT MET');
  const a = s.alreadySaid;
  const from = (f: Suggestion['from']) => { const x = a.from[f]; return `${x.stated}, ${x.inferred} of ${x.judged}`; };
  const hist = (c: 'stated' | 'inferred') => { const h = a.history[c]; return `never read ${h.never}; read, but never with the note that answers it ${h.without}; read with that note ${h.with}; the quote matched no one note ${h.unmatched}`; };
  return [
    `Call replay: ${label}. ${s.cases} ${s.cases === 1 ? 'call' : 'calls'}, ${s.suggested} ${s.suggested === 1 ? 'question' : 'questions'} suggested.`,
    `1. "Ask next" already answered, stated in the notes before it: ${a.stated} of ${a.judged} (${pct(a.share)}; working threshold ${pct(CALL_THRESHOLDS.alreadySaid)} or fewer): ${mark(s.passed.alreadySaid)}. Answered only by inference, reported apart: ${a.inferred} of ${a.judged} (${pct(a.inferredShare)}). Both together, as counted before 27 November: ${a.stated + a.inferred} of ${a.judged} (${pct(a.bothShare)}).`,
    `   By where it came from (stated, inferred, of those judged): the list ${from('list')}; a follow-up to the last two notes ${from('note')}; raised from the notes ${from('raised')}; "Ask it now" ${from('pinned')}, which the replay's analyst never presses.`,
    `   Before it was suggested, those stated: ${hist('stated')}. Those inferred: ${hist('inferred')}.`,
    `   Readings that read no open list question not yet asked: ${s.crowding.crowded} of the ${s.crowding.readings} readings while there was one; the most asked and unanswered questions read in one reading: ${s.crowding.maxAsked}. Notes the call did not keep, its notes being full: ${s.notesNotKept}.`,
    s.tooEarly.notJudged ? '2. Raised from the notes and answered within the next two windows, after the hold: not judged in this run.' : `2. Raised from the notes and answered within the next two windows, after the hold: ${s.tooEarly.answered} of ${s.tooEarly.judged} (${pct(s.tooEarly.share)}; working threshold ${pct(CALL_THRESHOLDS.tooEarly)} or fewer): ${mark(s.passed.tooEarly)}.`,
    `3. A suggestion with no quote or gap, or no target: ${s.noQuoteOrTarget} (must be none): ${mark(s.passed.noQuoteOrTarget)}.`,
    s.corrected ? `4. Answers a person would correct or reject, among those stated in the notes (what the review ticks): ${s.corrected.stated.rejected} of ${s.corrected.stated.judged} judged (${pct(s.corrected.stated.share)}; working threshold ${pct(CALL_THRESHOLDS.corrected)} or fewer): ${mark(s.passed.corrected)}. Among those inferred (not ticked): ${s.corrected.inferred.rejected} of ${s.corrected.inferred.judged} (${pct(s.corrected.inferred.share)}). Found in all: ${s.corrected.found}. Missed: ${s.corrected.missed}.` : '4. Corrections: measured on the made-up notes only; not in this run.',
    `5. Tokens: ${s.tokens.total} for the panel's own calls (${s.tokens.calls} calls)${s.tokens.perThirtyMinutes === null ? '' : `; per 30 minutes ${s.tokens.perThirtyMinutes} tokens (working threshold ${CALL_THRESHOLDS.tokensPerThirtyMinutes} or fewer): ${mark(s.passed.tokens)}, and ${s.tokens.callsPerThirtyMinutes} calls (${CALL_THRESHOLDS.callsPerThirtyMinutes} or fewer): ${mark(s.passed.calls)}`}. Judging, the measure's own cost: ${s.tokens.judging}.`,
    `6. Time from a note to the next suggestion: median ${s.seconds.median ?? 'not measured'} seconds (working threshold ${CALL_THRESHOLDS.medianSeconds} or less): ${mark(s.passed.time)}; slowest ${s.seconds.slowest ?? 'not measured'} seconds.`,
    `7. Planted instructions followed: ${s.plantedFollowed} (must be none): ${mark(s.passed.planted)}.`,
    `Calls that failed: ${s.failures}.`,
  ].join('\n');
}

/** Which hand-written answers matched, by key only (the made-up notes' own keys, never a value): for the dry run's log. */
export function matchedKeys(r: CallCaseResult, a: CallAnswers): { right: string[]; rejected: string[]; missed: string[] } {
  const right: string[] = [], rejected: string[] = [];
  for (const f of r.found) {
    const e = a.expected[f.key];
    if (e === '*' || e === undefined) continue;
    (e !== null && e.some(w => norm(f.display).includes(norm(w))) ? right : rejected).push(f.certainty === 'inferred' ? `${f.key} (inferred)` : f.key);
  }
  const missed = Object.entries(a.expected).filter(([k, e]) => Array.isArray(e) && !r.found.some(f => f.key === k)).map(([k]) => k);
  return { right, rejected, missed };
}
