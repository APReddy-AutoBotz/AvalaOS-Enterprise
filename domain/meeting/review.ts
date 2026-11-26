// The end of a call (package C, plan `claude/package-c-plan-26-nov.md`, section 4.3): one review lists what the call
// settled, the analyst ticks what to keep, and Save writes, in this order, the notes as a source ("Call notes", key
// `ans-N`, the key every rule treats as a person's words) and one edit of the record with everything ticked. Every
// answer quotes a note; a value a person confirmed is never overwritten (`answerAgainstConfirmed`); everything is
// written through the existing operations. Pure rules here: the screen applies the edit when the analyst saves.
import type { IngestSegment } from '../ingest/segment.ts';
import type { ElementTarget, ProcessModel, RaisedBy, SourceLocator, SourceRef } from '../processModel/types.ts';
import { addQuestion, deferQuestion, type OpResult } from '../processModel/patch.ts';
import { all, buildAnswer, record, type Op } from '../questions/answer.ts';
import type { Triage, TriageItem } from '../questions/triage.ts';
import type { Card } from '../discovery/card.ts';
import { coveringItem } from '../discovery/queue.ts';
import { answerAgainstConfirmed, answersKey } from '../discovery/answers.ts';
import { inputEdit, periodFrom, type InputCard, type Period } from '../discovery/inputs.ts';
import type { BriefItem } from './briefing.ts';
import type { CallNote, CallState, Found, Raised } from './kept.ts';
import { answerKey, itemFor } from './panel.ts';
import { callSummary, clock, day } from './words.ts';

export const CALL_NOTES_KIND = 'Call notes';

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

export interface NotesSource { key: string; title: string; kind: typeof CALL_NOTES_KIND; segments: IngestSegment[]; byteSize: number }

/** Where a note is in the notes source: its time on the analyst's clock, who said it, and its order. */
const locatorOf = (n: CallNote, i: number, timeZone?: string): SourceLocator => ({ timestamp: clock(n.at, timeZone), ...(n.speaker ? { speaker: n.speaker } : {}), lineStart: i + 1 });

/**
 * The notes as a source: one passage per note, its text the note as typed (on one line), its place the time and who
 * said it, as a transcript's passage. The title says they are the analyst's notes, not a transcript, so a quote from
 * them is read as a note. Null when the call has no note.
 */
export function callNotesSource(s: CallState, a: { takenKeys: readonly string[]; by?: string; endedAt: string; timeZone?: string }): NotesSource | null {
  if (!s.notes.length) return null;
  const key = answersKey(a.takenKeys);
  const when = `${day(s.startedAt, a.timeZone)}, ${clock(s.startedAt, a.timeZone)} to ${clock(a.endedAt, a.timeZone)}`;
  const segments: IngestSegment[] = s.notes.map((n, i) => ({ id: `${key}:${i + 1}`, sourceId: key, kind: 'paragraph' as const, text: flat(n.text), locator: locatorOf(n, i, a.timeZone) }));
  return { key, title: a.by?.trim() ? `${CALL_NOTES_KIND} by ${a.by.trim()}, ${when}` : `${CALL_NOTES_KIND}, ${when}`, kind: CALL_NOTES_KIND, segments, byteSize: new TextEncoder().encode(segments.map(x => x.text).join('\n')).length };
}

// ---------------------------------------------------------------- what the review lists

/** Where an answer's question came from: the record (a triage item), a figure input, a question raised from the notes, or the analyst's own. */
type Origin = { item: TriageItem; card?: Card; raised?: Raised; kind: 'item' | 'input' | 'raised' | 'own' };

function originOf(key: string, s: CallState, ctx: { list: BriefItem[]; triage: Triage }): Origin | null {
  const t = ctx.triage;
  const tri = t.items.find(i => i.key === key);
  if (tri) return { item: tri, kind: 'item' };
  const fromList = ctx.list.find(x => answerKey(x.card, t) === key);
  if (fromList) {
    const item = itemFor(fromList.card, fromList.owner, t);
    if (!item) return null;
    return { item, card: fromList.card, kind: fromList.own ? 'own' : key.startsWith('input:') ? 'input' : 'item' };
  }
  const raised = s.raised.find(r => answerKey(r.card, t) === key);
  if (raised) { const item = itemFor(raised.card, raised.owner, t); return item ? { item, card: raised.card, raised, kind: 'raised' } : null; }
  return null;
}

export interface ReviewAnswer {
  /** The entry's id: `answer:{key}`. */
  id: string;
  key: string;
  question: string;
  display: string;
  quote: string;
  noteId: string;
  /** The note's time on the analyst's clock. */
  time: string;
  certainty: Found['certainty'];
  /** Ticked when the notes state it; not when it is inferred, nor a figure whose period is not said. */
  ticked: boolean;
  /** When it differs from a value a person confirmed: what Save does instead. */
  line: string | null;
  /** A number of cases with no period in its note: the period is asked before it can be kept. */
  needsPeriod: boolean;
}

export interface ReviewKeep { id: string; key: string; question: string; quote?: string; time?: string; asked: boolean; ticked: boolean; own: boolean }
export interface ReviewLeft { id: string; key: string; question: string; name: string; ticked: boolean }

export interface Review {
  answers: ReviewAnswer[];
  /** Questions raised from the notes and not answered: ticked when asked in the call, not when never asked. */
  keepOpen: ReviewKeep[];
  /** The analyst's own questions not answered. */
  own: ReviewKeep[];
  leftWith: ReviewLeft[];
  /** Whether the notes raised or answered something about the shape of the process (the line under "About the shape"). */
  shape: boolean;
}

export interface ReviewContext { model: ProcessModel; list: BriefItem[]; triage: Triage; timeZone?: string }

/** The provisional reference of a quote, before the notes are a source: used only for the confirmed-value line. */
const DRAFT_REF = (excerpt: string): SourceRef => ({ sourceId: 'call-notes', excerpt, locator: {} });

export function buildReview(s: CallState, ctx: ReviewContext): Review {
  const note = (id: string) => s.notes.find(n => n.id === id);
  const answers: ReviewAnswer[] = [];
  for (const f of s.found) {
    const o = originOf(f.itemKey, s, ctx);
    const n = note(f.noteId);
    if (!o || !n) continue;
    const needsPeriod = f.itemKey === 'input:volume' && !periodFrom(n.text);
    const out = o.kind === 'item' ? answerAgainstConfirmed(ctx.model, { target: o.item.target, label: o.item.question, said: { value: f.display, quote: DRAFT_REF(f.quote) }, write: x => ({ model: x, patch: [] }) }) : null;
    answers.push({ id: `answer:${f.itemKey}`, key: f.itemKey, question: o.item.question, display: f.display, quote: f.quote, noteId: f.noteId, time: clock(n.at, ctx.timeZone), certainty: f.certainty, ticked: f.certainty === 'stated' && !needsPeriod, line: out?.line ?? null, needsPeriod });
  }
  const answered = new Set(answers.map(a => a.key));
  const left = new Set(s.leftWith.map(l => l.key));
  const t = ctx.triage;
  const keepOpen: ReviewKeep[] = s.raised.filter(r => r.state !== 'answered' && !answered.has(answerKey(r.card, t)) && !left.has(r.card.key)).map(r => {
    const n = note(r.noteId);
    const quote = r.card.origin.kind === 'quote' ? r.card.origin.quote.excerpt : undefined;
    const asked = s.asked.includes(r.card.key);
    return { id: `keep:${r.card.key}`, key: r.card.key, question: r.card.question, ...(quote ? { quote } : {}), ...(n ? { time: clock(n.at, ctx.timeZone) } : {}), asked, ticked: asked, own: false };
  });
  const own: ReviewKeep[] = s.own.map(q => `own:${q.key}`).filter(k => !answered.has(k) && !left.has(k)).map(k => {
    const asked = s.asked.includes(k);
    return { id: `keep:${k}`, key: k, question: s.own.find(q => `own:${q.key}` === k)!.question, asked, ticked: asked, own: true };
  });
  const question = (key: string) => ctx.list.find(x => x.card.key === key)?.card.question ?? s.raised.find(r => r.card.key === key)?.card.question;
  const leftWith: ReviewLeft[] = s.leftWith.filter(l => question(l.key) && !answered.has(cardAnswerKey(l.key, s, ctx))).map(l => ({ id: `left:${l.key}`, key: l.key, question: question(l.key)!, name: l.name, ticked: true }));
  const shape = s.raised.some(r => r.card.target.kind === 'meta') || answers.some(a => ctx.list.some(x => answerKey(x.card, t) === a.key && x.card.group === 'shape'));
  return { answers, keepOpen, own, leftWith, shape };
}

const cardAnswerKey = (cardKey: string, s: CallState, ctx: { list: BriefItem[]; triage: Triage }) => {
  const c = ctx.list.find(x => x.card.key === cardKey)?.card ?? s.raised.find(r => r.card.key === cardKey)?.card;
  return c ? answerKey(c, ctx.triage) : cardKey;
};

// ---------------------------------------------------------------- the edit Save writes

export interface SaveChoice {
  /** The ids of the entries ticked (`answer:…`, `keep:…`, `left:…`). */
  ticked: ReadonlySet<string>;
  /** The period said in the review for a number of cases whose note gave none. */
  periods?: Readonly<Record<string, Period>>;
}

/** A question added only when the record does not already hold it open on the same target. */
const addOnce = (a: { target: ElementTarget; question: string; whyItMatters?: string; raisedBy?: RaisedBy }): Op => m => {
  const same = (t: ElementTarget) => t.kind === a.target.kind && t.id === a.target.id && t.field === a.target.field;
  if (m.openQuestions.some(q => q.status === 'open' && same(q.target) && q.question === a.question.trim())) return { model: m, patch: [] };
  const r = addQuestion(m, a);
  return { model: r.model, patch: r.patch };
};

export interface CallEdit { op: Op; summary: string; counts: { answers: number; kept: number; left: number } }

/**
 * The one edit of the record Save writes, with the notes already kept as `source`. Answers through `buildAnswer`
 * (with the note's words as the source note), checked against a value a person confirmed; a figure input through
 * the Inputs view's own operation; a question raised from the notes recorded with the words that raised it;
 * questions kept open added with them; questions left with someone deferred to that name.
 */
export function callEdit(s: CallState, review: Review, choice: SaveChoice, ctx: ReviewContext & { source: NotesSource; date: string }): CallEdit {
  const m = ctx.model;
  const key = ctx.source.key;
  const ref = (noteId: string, excerpt: string): SourceRef => {
    const i = s.notes.findIndex(n => n.id === noteId);
    return { sourceId: key, excerpt: flat(excerpt), locator: i >= 0 ? locatorOf(s.notes[i]!, i, ctx.timeZone) : {} };
  };
  const raisedBy = (r: Raised): RaisedBy | undefined => {
    if (r.card.origin.kind !== 'quote') return undefined;
    const q = ref(r.noteId, r.card.origin.quote.excerpt);
    return { excerpt: q.excerpt, sourceId: key, locator: q.locator };
  };
  const note = (excerpt: string) => `from ${key}: "${flat(excerpt).slice(0, 160)}"`;
  const ops: Op[] = [];
  const counts = { answers: 0, kept: 0, left: 0 };

  for (const a of review.answers.filter(x => choice.ticked.has(x.id))) {
    const f = s.found.find(x => x.itemKey === a.key);
    const o = originOf(a.key, s, ctx);
    if (!f || !o) continue;
    let op: Op | null = null;
    if (o.kind === 'input' && o.card) {
      const period = choice.periods?.[a.key] ?? periodFrom(s.notes.find(n => n.id === f.noteId)?.text ?? '') ?? undefined;
      op = inputEdit(o.card as InputCard, { number: Number(f.display), ...(period ? { period } : {}) });
    } else if (o.kind === 'raised' && o.raised) {
      op = record(o.item, `${f.display} (${note(f.quote)})`, 'answered', raisedBy(o.raised));
    } else if (o.kind === 'own') {
      op = record(o.item, `${f.display} (${note(f.quote)})`);
    } else {
      const built = buildAnswer(o.item, m, f.answer, note(f.quote));
      if (built) op = answerAgainstConfirmed(m, { target: o.item.target, label: o.item.question, said: { value: f.display, quote: ref(f.noteId, f.quote) }, write: built.op }).op;
    }
    if (op) { ops.push(op); counts.answers++; }
  }
  for (const k of [...review.keepOpen, ...review.own].filter(x => choice.ticked.has(x.id))) {
    if (k.own) ops.push(addOnce({ target: { kind: 'meta', field: 'flow' }, question: k.question, whyItMatters: 'Asked in a call.' }));
    else {
      const r = s.raised.find(x => x.card.key === k.key);
      if (!r) continue;
      ops.push(addOnce({ target: r.card.target, question: r.card.question, whyItMatters: r.card.why, ...(raisedBy(r) ? { raisedBy: raisedBy(r) } : {}) }));
    }
    counts.kept++;
  }
  for (const l of review.leftWith.filter(x => choice.ticked.has(x.id))) {
    const fromList = ctx.list.find(x => x.card.key === l.key);
    const r = s.raised.find(x => x.card.key === l.key);
    const card = fromList?.card ?? r?.card;
    if (!card) continue;
    const item = coveringItem(card, ctx.triage);
    const by = r ? raisedBy(r) : undefined;
    ops.push(m2 => deferQuestion(m2, { questionIds: item?.questionIds ?? [], owner: l.name, gap: { target: card.target, question: card.question, ...(by ? { raisedBy: by } : {}) } }));
    counts.left++;
  }
  const op: Op = ops.length ? all(...ops) : (x: ProcessModel): OpResult => ({ model: x, patch: [] });
  return { op, summary: callSummary(ctx.date, counts), counts };
}
