// The BA panel during a call (package C, plan `claude/package-c-plan-26-nov.md`, section 4.2): the analyst adds
// short notes; about once a minute Avala OS reads the new ones with the two existing tasks, `answerFromNotes` (which
// open questions the notes answer) and `discoveryQuestions` (what the notes raise), and rules choose the one question
// to ask next, with the words it came from. Nothing is saved here: every function returns the call's next state,
// which the screen keeps on the device until the analyst ends the call and confirms.
//
// The rules, in order: when to read (at most once a minute, the notes added since the last reading with the one
// before as context); what one reading asks (at most 12 questions from the list, those marked Asked first, and at
// most 3 being held; a choice is asked as a plain question only to learn whether it is answered); the hold (a question raised from the notes waits one reading, or two minutes, and is dropped
// if the notes answer it, so the panel does not suggest what is about to be said); the next question (a follow-up to
// the last two notes first, at most one in a row, then the list, then other raised questions, then what was
// skipped; only questions someone on the call can answer). The same notes, list and replies give the same result.
import type { Segment } from '../ai/gateway.ts';
import type { ProcessModel } from '../processModel/types.ts';
import { notesSegments, proposalsFrom, type NoteFinding } from '../questions/notes.ts';
import type { QOwner, Triage, TriageItem } from '../questions/triage.ts';
import type { Card } from '../discovery/card.ts';
import { coveringItem } from '../discovery/queue.ts';
import { noticeSegments, readNotice, type NoticeCall, type NoticeReply } from '../discovery/notice.ts';
import type { BriefItem } from './briefing.ts';
import { afterCallUse, CALLS_A_READING, READ_EVERY_MS, roomAtEnd, roomDuringCall } from './limits.ts';
import type { CallNote, CallState, Found, Raised } from './kept.ts';
import { clock } from './words.ts';

/** The source id a note's quote carries during the call; at Save it becomes the notes source's own key. */
export const CALL_SOURCE = 'call-notes';
/** A held question is ready after one reading, or after this long with no reading. */
export const HOLD_MS = 120_000;
export const READING_LIMITS = { list: 12, held: 3, endBatch: 30, endBatches: 2 } as const;

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const unread = (s: CallState): CallNote[] => s.notes.filter(n => !s.read.includes(n.id));

/** Whether a reading is due: unread notes, a minute since the last one (unless the analyst pressed "Read now"), and room under the cap. */
export function readingDue(s: CallState, now: string, manual = false): boolean {
  if (!unread(s).length || !roomDuringCall(s.use, CALLS_A_READING, s.minutes)) return false;
  return manual || !s.lastReadAt || Date.parse(now) - Date.parse(s.lastReadAt) >= READ_EVERY_MS;
}

/** The notes a reading sends: those not read yet, and the one before the first of them as context. */
export function readingNotes(s: CallState): CallNote[] {
  const first = s.notes.findIndex(n => !s.read.includes(n.id));
  if (first < 0) return [];
  return [...(first > 0 ? [s.notes[first - 1]!] : []), ...s.notes.slice(first).filter(n => !s.read.includes(n.id))];
}

/** The key an answer to a card is kept under: its triage item's, else its own. */
export const answerKey = (card: Card, t: Triage): string => coveringItem(card, t)?.key ?? card.key;

/** Who can answer a question raised from the notes: about an application, the IT or application owner; else the process owner or SME. */
export const raisedOwner = (card: Card): QOwner => (card.target.kind === 'system' ? 'it' : 'business');

/**
 * The question `answerFromNotes` is asked for a card: its triage item (an application's ways in included, which the
 * task reads as access); a figure input as a number; a question raised from the notes, or of the analyst's own, as
 * a free answer. A choice (a conflict, the first cards, a fact to pick) is not read from notes: it is chosen.
 */
export function itemFor(card: Card, owner: QOwner, t: Triage): TriageItem | null {
  const covering = coveringItem(card, t);
  if (covering) return covering.kind === 'choice' ? null : covering;
  if (card.answer === 'choose') return null;
  const base = { key: card.key, question: card.question, target: card.target, questionIds: [], group: 'detail' as const, owner, affects: card.updates, assignedTo: null, deferred: false };
  if (card.key.startsWith('input:')) return card.key === 'input:volume' || card.key === 'input:time' ? { ...base, kind: 'number' } : null;
  return { ...base, kind: 'free' };
}

/**
 * The question a reading sends for a card. A choice (the first cards, a conflict, a fact to pick) is sent as a plain
 * question only to learn whether the notes already answer it, so it is not suggested again (owner, 26 November 2026,
 * on the dry run); the analyst still picks the answer in the review. Everything else is `itemFor`'s question.
 */
export function readingItemFor(card: Card, owner: QOwner, t: Triage): TriageItem | null {
  const it = itemFor(card, owner, t);
  if (it) return it;
  if (!card.question.trim()) return null;
  return { key: answerKey(card, t), question: card.question, target: card.target, questionIds: [], group: 'detail', owner, affects: card.updates, kind: 'free', assignedTo: null, deferred: false };
}

/** A triage item that is a choice, as a plain question, for the same reason. */
const plainItem = (it: TriageItem): TriageItem => (it.kind === 'choice' ? { ...it, kind: 'free' } : it);

const dismissKey = (f: Pick<Found, 'itemKey' | 'noteId'>) => `${f.itemKey}@${f.noteId}`;
export const isAnswered = (s: CallState, key: string): boolean => s.found.some(f => f.itemKey === key);
const isDone = (s: CallState, card: Card, t: Triage) => s.asked.includes(card.key) || s.leftWith.some(l => l.key === card.key) || isAnswered(s, answerKey(card, t));

export interface ReadingPrep {
  notes: CallNote[];
  /** `answerFromNotes`' call; null when there is no question to read the notes against. */
  answers: { items: TriageItem[]; ids: Map<string, string>; segments: Segment[] } | null;
  notice: NoticeCall;
  /** Held raised questions sent this reading: the card key and the key their answer is kept under. */
  held: { cardKey: string; answerKey: string }[];
}

export interface PrepContext {
  model: ProcessModel;
  list: BriefItem[];
  triage: Triage;
  /**
   * Every question already asked, answered, left with someone or closed, in the record as well as on the call, so
   * noticing does not raise it again. The screens pass the Discovery rules' own list (package B, 5b) with the call's.
   */
  asked: readonly string[];
  timeZone?: string;
}

/** The questions the call already knows of, for noticing: the list, what was raised, the analyst's own, and `extra`. */
export const knownQuestions = (s: CallState, list: BriefItem[], extra: readonly string[] = []): string[] =>
  [...new Set([...list.map(x => x.card.question), ...s.raised.map(r => r.card.question), ...s.own.map(q => q.question), ...extra])];

const saidOf = (n: CallNote, timeZone?: string) => ({ ref: n.id, text: flat(n.text), sourceId: CALL_SOURCE, locator: { timestamp: clock(n.at, timeZone), ...(n.speaker ? { speaker: n.speaker } : {}) } });

/** The two calls of one reading, built from the call as it stands. */
export function prepareReading(s: CallState, ctx: PrepContext): ReadingPrep {
  const notes = readingNotes(s);
  const t = ctx.triage;
  const open = ctx.list.filter(x => !isDone(s, x.card, t) || (s.asked.includes(x.card.key) && !isAnswered(s, answerKey(x.card, t))));
  // Asked and not answered yet first, the latest asked first; then the list in its order.
  const asked = open.filter(x => s.asked.includes(x.card.key)).sort((a, b) => s.asked.indexOf(b.card.key) - s.asked.indexOf(a.card.key));
  const rest = open.filter(x => !s.asked.includes(x.card.key) && !s.leftWith.some(l => l.key === x.card.key));
  const items: TriageItem[] = [];
  const keys = new Set<string>();
  const push = (it: TriageItem | null) => { if (it && !keys.has(it.key)) { keys.add(it.key); items.push(it); return true; } return false; };
  for (const x of [...asked, ...rest]) { if (items.length >= READING_LIMITS.list) break; push(readingItemFor(x.card, x.owner, t)); }
  const held: ReadingPrep['held'] = [];
  for (const r of s.raised.filter(x => x.state === 'held').sort((a, b) => a.heldAt - b.heldAt)) {
    if (held.length >= READING_LIMITS.held) break;
    const it = readingItemFor(r.card, r.owner, t);
    if (it && push(it)) held.push({ cardKey: r.card.key, answerKey: it.key });
  }
  const text = notes.map(n => flat(n.text)).join('\n\n');
  const answers = items.length && notes.length ? { items, ...notesSegments(ctx.model, items, text) } : null;
  const notice = noticeSegments(ctx.model, notes.map(n => saidOf(n, ctx.timeZone)), knownQuestions(s, ctx.list, ctx.asked));
  return { notes, answers, notice, held };
}

/** What one call of a reading returned: its data and usage, or that it failed (the screen says so in one line). */
export type CallResult = { data: unknown; usage?: { input: number; output: number } | null } | 'failed';

/** The note a quote comes from: the first of the notes sent that holds it, word for word. */
export function noteOf(notes: CallNote[], excerpt: string): CallNote | undefined {
  const e = norm(excerpt);
  return e ? notes.find(n => norm(n.text).includes(e)) : undefined;
}

function mergeFound(s: CallState, items: TriageItem[], ids: Map<string, string>, data: unknown, notes: CallNote[], model: ProcessModel, at: string): Found[] {
  const findings = ((data as { answers?: NoteFinding[] } | null)?.answers) ?? [];
  const found = [...s.found];
  for (const p of proposalsFrom(model, items, ids, findings)) {
    const note = noteOf(notes, p.quote);
    if (!note || s.dismissed.includes(dismissKey({ itemKey: p.itemKey, noteId: note.id }))) continue;
    // A later answer to the same question replaces an earlier one ("actually it is closer to 600").
    const i = found.findIndex(f => f.itemKey === p.itemKey);
    const f: Found = { ...p, noteId: note.id, readAt: at };
    if (i >= 0) found[i] = f; else found.push(f);
  }
  return found;
}

/**
 * The call after one reading came back. Answers found are kept under their question's key; a held question its
 * reading answered is "answered", one it did not is "ready"; what noticing raised is held for one reading; wanted
 * statements are kept. The notes are marked read only when both calls came back; a failed call is counted against
 * the cap all the same, and its notes are sent again with the next reading.
 */
export function applyReading(s: CallState, prep: ReadingPrep, r: { answers: CallResult | null; notice: CallResult }, ctx: { model: ProcessModel; at: string; asked: readonly string[]; list: BriefItem[] }): CallState {
  let use = s.use;
  for (const x of [r.answers, r.notice]) if (x) use = afterCallUse(use, x === 'failed' ? null : x.usage);
  let found = s.found;
  if (prep.answers && r.answers && r.answers !== 'failed') found = mergeFound(s, prep.answers.items, prep.answers.ids, r.answers.data, prep.notes, ctx.model, ctx.at);
  const reading = s.readings + 1;
  let raised = s.raised.map(x => {
    const h = prep.held.find(y => y.cardKey === x.card.key);
    if (!h || !r.answers || r.answers === 'failed') return x;
    return { ...x, state: found.some(f => f.itemKey === h.answerKey) ? 'answered' as const : 'ready' as const };
  });
  let wanted = s.wanted;
  if (r.notice !== 'failed') {
    const read = readNotice(ctx.model, prep.notice, (r.notice.data ?? { questions: [], wanted: [] }) as NoticeReply, { asked: knownQuestions(s, ctx.list, ctx.asked), wantedSoFar: s.wanted.map(w => w.excerpt) });
    const added: Raised[] = [];
    for (const card of read.cards) {
      const note = card.origin.kind === 'quote' ? noteOf(prep.notes, card.origin.quote.excerpt) : undefined;
      if (!note || raised.some(x => x.card.key === card.key) || added.some(x => x.card.key === card.key)) continue;
      added.push({ card, noteId: note.id, owner: raisedOwner(card), state: 'held', heldAt: reading, heldSince: ctx.at });
    }
    raised = [...raised, ...added];
    wanted = [...wanted, ...read.wanted.map(w => ({ excerpt: w.excerpt, noteId: noteOf(prep.notes, w.excerpt)?.id ?? '' })).filter(w => w.noteId)];
  }
  const ok = r.notice !== 'failed' && r.answers !== 'failed';
  return {
    ...s, use, found, raised, wanted, lastReadAt: ctx.at, changedAt: ctx.at,
    readings: reading,
    read: ok ? [...new Set([...s.read, ...prep.notes.map(n => n.id)])] : s.read,
  };
}

// ---------------------------------------------------------------- the next question

export interface Suggestion {
  card: Card;
  owner: QOwner;
  name?: string;
  /** list: from the briefing; note: a follow-up to the last two notes; raised: another question the notes raised; pinned: "Ask it now". */
  from: 'list' | 'note' | 'raised' | 'pinned';
  noteId?: string;
  own?: boolean;
}

const ready = (r: Raised, now: string) => r.state === 'ready' || (r.state === 'held' && Date.parse(now) - Date.parse(r.heldSince) >= HOLD_MS);

/** The one question to ask next, or null when nothing is left for the people on the call. */
export function nextQuestion(s: CallState, list: BriefItem[], t: Triage, now: string): Suggestion | null {
  const kinds = new Set(s.attendees.map(a => a.kind));
  const nameFor = (k: QOwner) => s.attendees.find(a => a.kind === k && a.name)?.name;
  const fromRaised = (r: Raised, from: Suggestion['from']): Suggestion => ({ card: r.card, owner: r.owner, ...(nameFor(r.owner) ? { name: nameFor(r.owner) } : {}), from, noteId: r.noteId });
  const open = s.raised.filter(r => r.state !== 'answered' && !isDone(s, r.card, t) && kinds.has(r.owner));
  if (s.pinned) { const p = open.find(r => r.card.key === s.pinned); if (p) return fromRaised(p, 'pinned'); }
  const readyRaised = open.filter(r => ready(r, now));
  const lastTwo = s.notes.slice(-2).map(n => n.id);
  if (s.followUpsInRow < 1) {
    const f = [...readyRaised].reverse().find(r => lastTwo.includes(r.noteId));
    if (f) return fromRaised(f, 'note');
  }
  const pending = list.filter(x => !isDone(s, x.card, t));
  const first = pending.find(x => !s.skipped.includes(x.card.key));
  if (first) return { card: first.card, owner: first.owner, ...(first.name ? { name: first.name } : {}), from: 'list', ...(first.own ? { own: true } : {}) };
  const other = readyRaised.find(r => !s.skipped.includes(r.card.key));
  if (other) return fromRaised(other, 'raised');
  const skipped = s.skipped.map(k => pending.find(x => x.card.key === k)).find(Boolean);
  if (skipped) return { card: skipped.card, owner: skipped.owner, ...(skipped.name ? { name: skipped.name } : {}), from: 'list', ...(skipped.own ? { own: true } : {}) };
  const skippedRaised = s.skipped.map(k => readyRaised.find(r => r.card.key === k)).find(Boolean);
  return skippedRaised ? fromRaised(skippedRaised, 'raised') : null;
}

/** "Asked": the question moves to Asked; a follow-up counts towards the one allowed in a row, anything else resets it. */
export function markAsked(s: CallState, sug: Pick<Suggestion, 'card' | 'from'>, at: string): CallState {
  const followUp = sug.from === 'note';
  return { ...s, asked: [...s.asked.filter(k => k !== sug.card.key), sug.card.key], skipped: s.skipped.filter(k => k !== sug.card.key), followUpsInRow: followUp ? s.followUpsInRow + 1 : 0, ...(s.pinned === sug.card.key ? { pinned: undefined } : {}), changedAt: at };
}

/** "Skip": to the end of the list. */
export const skipQuestion = (s: CallState, key: string, at: string): CallState =>
  ({ ...s, skipped: [...s.skipped.filter(k => k !== key), key], ...(s.pinned === key ? { pinned: undefined } : {}), changedAt: at });

/** "Someone else knows": left with that name when the call is confirmed. */
export function leaveWithName(s: CallState, key: string, name: string, at: string): CallState {
  const who = name.trim().slice(0, 120);
  if (!who) return s;
  return { ...s, leftWith: [...s.leftWith.filter(l => l.key !== key), { key, name: who }], ...(s.pinned === key ? { pinned: undefined } : {}), changedAt: at };
}

/** "Not right": the answer found is removed; the same note does not propose it again. */
export const dismissFound = (s: CallState, f: Pick<Found, 'itemKey' | 'noteId'>, at: string): CallState =>
  ({ ...s, found: s.found.filter(x => !(x.itemKey === f.itemKey && x.noteId === f.noteId)), dismissed: [...new Set([...s.dismissed, dismissKey(f)])], changedAt: at });

/** "Ask it now": a question raised from the notes becomes the next suggestion. */
export function askNow(s: CallState, cardKey: string, at: string): CallState {
  if (!s.raised.some(r => r.card.key === cardKey && r.state !== 'answered')) return s;
  return { ...s, pinned: cardKey, raised: s.raised.map(r => (r.card.key === cardKey ? { ...r, state: 'ready' as const } : r)), skipped: s.skipped.filter(k => k !== cardKey), changedAt: at };
}

/** "Asked (N)": each question marked Asked, with whether the notes answered it. */
export function askedList(s: CallState, list: BriefItem[], t: Triage): { key: string; question: string; answered: boolean }[] {
  const card = (k: string) => list.find(x => x.card.key === k)?.card ?? s.raised.find(r => r.card.key === k)?.card;
  return s.asked.map(k => card(k)).filter((c): c is Card => Boolean(c)).map(c => ({ key: c.key, question: c.question, answered: isAnswered(s, answerKey(c, t)) }));
}

/** "Raised from your notes": what is still to ask, held or ready, for anyone. */
export const raisedToShow = (s: CallState, now: string) => s.raised.filter(r => r.state !== 'answered' && !s.asked.includes(r.card.key)).map(r => ({ ...r, holding: !ready(r, now) }));

// ---------------------------------------------------------------- the end reading

export interface EndPrep {
  batches: { items: TriageItem[]; ids: Map<string, string>; segments: Segment[] }[];
  /** Every open question there was to read against, and how many were (at most 60). */
  total: number;
  read: number;
}

/**
 * The reading at the end: all the notes, against every open question, the most decisive first: those asked and not
 * answered, the list, the questions raised from the notes, the analyst's own, then every other open question in the
 * record. At most 30 questions a call and two calls, within the cap's last 20,000 tokens and 3 calls.
 */
export function prepareEnd(s: CallState, ctx: { model: ProcessModel; list: BriefItem[]; triage: Triage }): EndPrep {
  const t = ctx.triage;
  const all: TriageItem[] = [];
  const keys = new Set<string>();
  const push = (it: TriageItem | null) => { if (it && !keys.has(it.key) && !isAnswered(s, it.key)) { keys.add(it.key); all.push(it); } };
  const byKey = (k: string) => ctx.list.find(x => x.card.key === k);
  for (const k of [...s.asked].reverse()) { const x = byKey(k); if (x) push(readingItemFor(x.card, x.owner, t)); const r = s.raised.find(y => y.card.key === k); if (r) push(readingItemFor(r.card, r.owner, t)); }
  for (const x of ctx.list) push(readingItemFor(x.card, x.owner, t));
  for (const r of s.raised.filter(y => y.state !== 'answered')) push(readingItemFor(r.card, r.owner, t));
  for (const it of [...t.items].filter(y => !y.deferred).sort((a, b) => (a.group === 'decides' ? 0 : 1) - (b.group === 'decides' ? 0 : 1))) push(plainItem(it));
  const cap = READING_LIMITS.endBatch * READING_LIMITS.endBatches;
  const picked = all.slice(0, cap);
  const text = s.notes.map(n => flat(n.text)).join('\n\n');
  const batches = [];
  for (let i = 0; i < picked.length && s.notes.length; i += READING_LIMITS.endBatch) {
    if (!roomAtEnd(s.use, batches.length + 1, s.minutes)) break;
    const items = picked.slice(i, i + READING_LIMITS.endBatch);
    batches.push({ items, ...notesSegments(ctx.model, items, text) });
  }
  return { batches, total: all.length, read: batches.reduce((n, b) => n + b.items.length, 0) };
}

/** The call after the end reading: answers found kept as during the call; the call is ended. */
export function applyEnd(s: CallState, prep: EndPrep, results: CallResult[], ctx: { model: ProcessModel; at: string }): CallState {
  let next = s;
  prep.batches.forEach((b, i) => {
    const r = results[i];
    if (!r) return;
    next = { ...next, use: afterCallUse(next.use, r === 'failed' ? null : r.usage) };
    if (r !== 'failed') next = { ...next, found: mergeFound(next, b.items, b.ids, r.data, next.notes, ctx.model, ctx.at) };
  });
  return { ...next, endedAt: ctx.at, changedAt: ctx.at };
}
