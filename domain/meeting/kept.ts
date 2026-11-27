// A running call as it is kept on the analyst's device (package C, plan `claude/package-c-plan-26-nov.md`, section
// 5, revision 2; owner, 26 November 2026): in the browser's local storage, one key per process, written after every
// change, so a closed tab, a crash or a restart loses nothing. Nothing of it is on the server before the analyst
// ends the call and saves. It is removed at Save, at Discard and at sign-out (the key's prefix is in
// SIGN_OUT_FORGETS). Pure rules here: what the call holds, how it is read back without trusting it, how two tabs'
// copies are merged by note id, its age, and the plain-text file "Download my notes".
import type { ElementTarget } from '../processModel/types.ts';
import type { Proposal } from '../questions/notes.ts';
import type { QOwner } from '../questions/triage.ts';
import type { Card } from '../discovery/card.ts';
import { NO_CALL_USE, type CallUse } from './limits.ts';
import { CALL_WORDS, clock, day } from './words.ts';

/** The prefix of the key a call is kept under; sign-out removes every key with it. */
export const CALL_KEY_PREFIX = 'avala:call:';
export const callKey = (processId: string): string => `${CALL_KEY_PREFIX}${processId}`;

export const CALL_LIMITS = { chars: 20_000, notes: 300, noteChars: 2_000 } as const;
/** After this many days an unfinished call says how old it is, and continuing it builds its list again. */
export const STALE_DAYS = 7;
export const CALL_LENGTHS = [30, 45, 60] as const;
export type CallLength = (typeof CALL_LENGTHS)[number];

export interface CallNote {
  id: string;
  /** When it was added (ISO). */
  at: string;
  text: string;
  /** Who said it, as the analyst marked it: a name, a kind of person, or "Me". */
  speaker?: string;
  spoken?: boolean;
  editedAt?: string;
}

export interface Attendee { kind: QOwner; name?: string }

/** A question of the analyst's own, added in the briefing. */
export interface OwnQuestion { key: string; question: string }

/** An answer found in the notes during the call or at its end: the existing proposal, with the note it quotes. */
export interface Found extends Proposal { noteId: string; readAt: string }

/** A question raised from the notes by `discoveryQuestions`, held one reading before it is suggested. */
export interface Raised {
  card: Card;
  noteId: string;
  owner: QOwner;
  /** held: waiting one reading in case the notes answer it; ready: may be suggested; answered: the notes answered it. */
  state: 'held' | 'ready' | 'answered';
  /** The reading it was raised by (1 for the first), and when. */
  heldAt: number;
  heldSince: string;
}

export interface Wanted { excerpt: string; noteId: string }

export interface CallState {
  version: 1;
  processId: string;
  startedAt: string;
  changedAt: string;
  attendees: Attendee[];
  minutes: CallLength;
  /** The analyst's moves in the briefing: the order of card keys, and those left out. */
  arranged: { order: string[]; leftOut: string[] };
  own: OwnQuestion[];
  notes: CallNote[];
  /** Ids of notes removed, so a merge with another tab does not bring them back. */
  removed: string[];
  /** Ids of notes read by a reading that came back. */
  read: string[];
  /**
   * For each question read during the call, by the key its answer is kept under: how many of the notes, from the
   * first, it has been read against. A question is suggested only once it has been read against every note a reading
   * has read (measure 1's fix, F2; owner, 27 November 2026).
   */
  readThrough: Record<string, number>;
  /** When a reading last sent earlier notes again for a question that had not been read against them. */
  lastCatchUpAt?: string;
  /** The last reading's answer call failed: the next question follows the list until a reading comes back. */
  lastFailed?: boolean;
  lastReadAt: string | null;
  readings: number;
  found: Found[];
  raised: Raised[];
  wanted: Wanted[];
  /** Card keys marked Asked, Skip (in the order skipped), and left with someone. */
  asked: string[];
  skipped: string[];
  leftWith: { key: string; name: string }[];
  /** Answers marked "Not right": the answer's key and the note it quoted. */
  dismissed: string[];
  /** Follow-ups to the notes suggested and asked in a row; at most one before the list comes back. */
  followUpsInRow: number;
  /** A question raised from the notes that the analyst chose to ask now ("Ask it now"): the next suggestion. */
  pinned?: string;
  use: CallUse;
  /** When the list was built again for a call more than STALE_DAYS old. */
  rebuiltAt?: string;
  endedAt?: string;
}

export function newCall(a: { processId: string; at: string; attendees: Attendee[]; minutes: CallLength; arranged?: CallState['arranged']; own?: OwnQuestion[] }): CallState {
  return {
    version: 1, processId: a.processId, startedAt: a.at, changedAt: a.at, attendees: a.attendees, minutes: a.minutes,
    arranged: a.arranged ?? { order: [], leftOut: [] }, own: a.own ?? [], notes: [], removed: [], read: [], readThrough: {}, lastReadAt: null, readings: 0,
    found: [], raised: [], wanted: [], asked: [], skipped: [], leftWith: [], dismissed: [], followUpsInRow: 0, use: { ...NO_CALL_USE },
  };
}

// ---------------------------------------------------------------- reading it back

const isObj = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const objs = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.filter(isObj) : []);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
const OWNERS: QOwner[] = ['business', 'it', 'finance'];
const owner = (x: unknown): QOwner => (OWNERS.includes(x as QOwner) ? (x as QOwner) : 'business');
const isTime = (x: unknown) => typeof x === 'string' && !Number.isNaN(Date.parse(x));

/**
 * The call as kept, read without trusting it (the device's storage can hold anything): null when it is not a call
 * of this version for this process; otherwise every entry without the known shape is left out.
 */
export function readCall(raw: unknown, processId: string): CallState | null {
  let o: unknown = raw;
  if (typeof raw === 'string') { try { o = JSON.parse(raw); } catch { return null; } }
  if (!isObj(o) || o.version !== 1 || o.processId !== processId || !isTime(o.startedAt)) return null;
  const notes: CallNote[] = objs(o.notes).filter(n => str(n.id) && isTime(n.at) && str(n.text).trim()).map(n => ({
    id: str(n.id), at: str(n.at), text: str(n.text).slice(0, CALL_LIMITS.noteChars),
    ...(str(n.speaker) ? { speaker: str(n.speaker).slice(0, 120) } : {}), ...(n.spoken === true ? { spoken: true } : {}), ...(isTime(n.editedAt) ? { editedAt: str(n.editedAt) } : {}),
  }));
  const ids = new Set(notes.map(n => n.id));
  const isCard = (c: unknown): c is Card => isObj(c) && Boolean(str(c.key)) && Boolean(str(c.question)) && isObj(c.target) && isObj(c.origin);
  const isProposal = (f: Record<string, unknown>) => str(f.itemKey) && str(f.question) && str(f.quote) && ids.has(str(f.noteId)) && isObj(f.answer) && (f.certainty === 'stated' || f.certainty === 'inferred');
  const minutes = (CALL_LENGTHS as readonly number[]).includes(o.minutes as number) ? (o.minutes as CallLength) : 30;
  const arranged = isObj(o.arranged) ? o.arranged : {};
  const use = isObj(o.use) ? o.use : {};
  return {
    version: 1, processId, startedAt: str(o.startedAt), changedAt: isTime(o.changedAt) ? str(o.changedAt) : str(o.startedAt),
    attendees: objs(o.attendees).map(a => ({ kind: owner(a.kind), ...(str(a.name).trim() ? { name: str(a.name).trim().slice(0, 120) } : {}) })),
    minutes,
    arranged: { order: strs(arranged.order), leftOut: strs(arranged.leftOut) },
    own: objs(o.own).filter(q => str(q.key) && str(q.question).trim()).map(q => ({ key: str(q.key), question: str(q.question).trim().slice(0, 200) })),
    notes, removed: strs(o.removed), read: strs(o.read).filter(id => ids.has(id)),
    readThrough: Object.fromEntries(Object.entries(isObj(o.readThrough) ? o.readThrough : {}).map(([k, v]) => [k, Math.min(Math.floor(num(v)), notes.length)] as const).filter(([k, v]) => k && v > 0)),
    ...(isTime(o.lastCatchUpAt) ? { lastCatchUpAt: str(o.lastCatchUpAt) } : {}), ...(o.lastFailed === true ? { lastFailed: true } : {}),
    lastReadAt: isTime(o.lastReadAt) ? str(o.lastReadAt) : null, readings: num(o.readings),
    found: objs(o.found).filter(isProposal).map(f => f as unknown as Found),
    raised: objs(o.raised).filter(r => isCard(r.card) && ids.has(str(r.noteId)) && ['held', 'ready', 'answered'].includes(str(r.state))).map(r => ({
      card: r.card as Card, noteId: str(r.noteId), owner: owner(r.owner), state: r.state as Raised['state'], heldAt: num(r.heldAt), heldSince: isTime(r.heldSince) ? str(r.heldSince) : str(o.startedAt),
    })),
    wanted: objs(o.wanted).filter(w => str(w.excerpt) && ids.has(str(w.noteId))).map(w => ({ excerpt: str(w.excerpt), noteId: str(w.noteId) })),
    asked: strs(o.asked), skipped: strs(o.skipped),
    leftWith: objs(o.leftWith).filter(l => str(l.key) && str(l.name).trim()).map(l => ({ key: str(l.key), name: str(l.name).trim().slice(0, 120) })),
    dismissed: strs(o.dismissed), followUpsInRow: num(o.followUpsInRow) ? 1 : 0,
    ...(str(o.pinned) ? { pinned: str(o.pinned) } : {}),
    use: { tokens: num(use.tokens), calls: num(use.calls) },
    ...(isTime(o.rebuiltAt) ? { rebuiltAt: str(o.rebuiltAt) } : {}), ...(isTime(o.endedAt) ? { endedAt: str(o.endedAt) } : {}),
  };
}

// ---------------------------------------------------------------- two tabs

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
const later = (a?: string, b?: string) => (Date.parse(b ?? '') > Date.parse(a ?? '') ? b : a);

/**
 * Two copies of one call (two tabs, or a tab and what the storage now holds), merged by note id: a note from either
 * stays unless either removed it, an edited note keeps its later edit, and the lists of either are kept. The rest
 * comes from the copy changed last. The AI used is the larger of the two, so the cap is never undercounted.
 */
export function mergeCalls(mine: CallState, theirs: CallState): CallState {
  const [base, other] = Date.parse(theirs.changedAt) > Date.parse(mine.changedAt) ? [theirs, mine] : [mine, theirs];
  const removed = union(base.removed, other.removed);
  const byId = new Map<string, CallNote>();
  for (const n of [...other.notes, ...base.notes]) {
    const was = byId.get(n.id);
    if (!was || Date.parse(n.editedAt ?? n.at) >= Date.parse(was.editedAt ?? was.at)) byId.set(n.id, n);
  }
  const notes = [...byId.values()].filter(n => !removed.includes(n.id)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  const ids = new Set(notes.map(n => n.id));
  const byKey = <T>(xs: T[], key: (x: T) => string) => { const m = new Map<string, T>(); for (const x of xs) if (!m.has(key(x))) m.set(key(x), x); return [...m.values()]; };
  return {
    ...base, notes, removed,
    read: union(base.read, other.read).filter(id => ids.has(id)),
    readThrough: mergedReadThrough(base, other, notes),
    lastReadAt: later(base.lastReadAt ?? undefined, other.lastReadAt ?? undefined) ?? null,
    readings: Math.max(base.readings, other.readings),
    found: byKey([...base.found, ...other.found], f => f.itemKey).filter(f => ids.has(f.noteId)),
    raised: byKey([...base.raised, ...other.raised], r => r.card.key).filter(r => ids.has(r.noteId)),
    wanted: byKey([...base.wanted, ...other.wanted], w => w.excerpt).filter(w => ids.has(w.noteId)),
    asked: union(base.asked, other.asked), skipped: union(base.skipped, other.skipped), dismissed: union(base.dismissed, other.dismissed),
    leftWith: byKey([...base.leftWith, ...other.leftWith], l => l.key),
    use: { tokens: Math.max(base.use.tokens, other.use.tokens), calls: Math.max(base.use.calls, other.use.calls) },
  };
}

/**
 * How far each question was read, in the merged notes: in each copy, the merged notes from the first up to the first
 * one that copy had not read for it (a note it never had, or one changed since), so notes that came only from the
 * other copy are never counted as read; the lesser of the two copies that read it.
 */
function mergedReadThrough(a: CallState, b: CallState, notes: CallNote[]): Record<string, number> {
  const upTo = (c: CallState, n: number) => {
    const seen = new Set(c.notes.slice(0, n).map(x => `${x.id}\u0000${x.text}`));
    const i = notes.findIndex(x => !seen.has(`${x.id}\u0000${x.text}`));
    return i < 0 ? notes.length : i;
  };
  const out: Record<string, number> = {};
  for (const k of new Set([...Object.keys(a.readThrough), ...Object.keys(b.readThrough)])) {
    out[k] = Math.min(...[a, b].filter(c => k in c.readThrough).map(c => upTo(c, c.readThrough[k]!)));
  }
  return out;
}

// ---------------------------------------------------------------- notes

const tidy = (s: string) => s.replace(/\r/g, '').replace(/\n\s*\n+/g, '\n').trim();
const total = (notes: CallNote[]) => notes.reduce((t, n) => t + n.text.length, 0);

export type NoteRefusal = 'empty' | 'full';

/** Adds a note at the end; refused when it is empty, or the call is at 300 notes or 20,000 characters. */
export function addNote(s: CallState, n: { id: string; at: string; text: string; speaker?: string; spoken?: boolean }): CallState | NoteRefusal {
  const text = tidy(n.text).slice(0, CALL_LIMITS.noteChars);
  if (!text) return 'empty';
  if (s.notes.length >= CALL_LIMITS.notes || total(s.notes) + text.length > CALL_LIMITS.chars) return 'full';
  const note: CallNote = { id: n.id, at: n.at, text, ...(n.speaker?.trim() ? { speaker: n.speaker.trim().slice(0, 120) } : {}), ...(n.spoken ? { spoken: true } : {}) };
  return { ...s, notes: [...s.notes, note], changedAt: n.at };
}

/**
 * Changes a note's words. It is read again at the next reading, and what was found in it or raised from it is
 * dropped, since its quote may no longer be in the note.
 */
export function editNote(s: CallState, id: string, text: string, at: string): CallState | NoteRefusal {
  const t = tidy(text).slice(0, CALL_LIMITS.noteChars);
  if (!t) return 'empty';
  const was = s.notes.find(n => n.id === id);
  if (!was) return s;
  if (total(s.notes) - was.text.length + t.length > CALL_LIMITS.chars) return 'full';
  // Every question read past the note is read again from it.
  const i = s.notes.findIndex(n => n.id === id);
  const readThrough = Object.fromEntries(Object.entries(s.readThrough).map(([k, v]) => [k, Math.min(v, i)]));
  return dropFrom({ ...s, notes: s.notes.map(n => (n.id === id ? { ...n, text: t, editedAt: at } : n)), read: s.read.filter(x => x !== id), readThrough, changedAt: at }, id);
}

/** Removes a note, and what was found in it or raised from it. */
export function removeNote(s: CallState, id: string, at: string): CallState {
  // The notes after it move up one place; nothing needs reading again.
  const i = s.notes.findIndex(n => n.id === id);
  const readThrough = i < 0 ? s.readThrough : Object.fromEntries(Object.entries(s.readThrough).map(([k, v]) => [k, v > i ? v - 1 : v]));
  return dropFrom({ ...s, notes: s.notes.filter(n => n.id !== id), removed: union(s.removed, [id]), read: s.read.filter(x => x !== id), readThrough, changedAt: at }, id);
}

const dropFrom = (s: CallState, id: string): CallState => ({ ...s, found: s.found.filter(f => f.noteId !== id), raised: s.raised.filter(r => r.noteId !== id), wanted: s.wanted.filter(w => w.noteId !== id) });

// ---------------------------------------------------------------- age, and the plain-text copy

const DAY_MS = 86_400_000;

/** Whole days since the call was last changed. */
export const callAgeDays = (s: CallState, now: string): number => Math.max(0, Math.floor((Date.parse(now) - Date.parse(s.changedAt)) / DAY_MS));

/** The line on opening the call page with an unfinished call. */
export function unfinishedLine(s: CallState, now: string, timeZone?: string): string {
  const when = `${day(s.startedAt, timeZone)} at ${clock(s.startedAt, timeZone)}`;
  const days = callAgeDays(s, now);
  return days >= STALE_DAYS ? CALL_WORDS.unfinishedOld(when, days) : CALL_WORDS.unfinished(when);
}

/**
 * Continuing an unfinished call. One more than STALE_DAYS old has its list built again from the process as it is
 * now (the record may have moved on): the analyst's order is forgotten, their own questions and the notes stay.
 */
export function continueCall(s: CallState, now: string): CallState {
  if (callAgeDays(s, now) < STALE_DAYS) return s;
  return { ...s, arranged: { order: [], leftOut: [] }, rebuiltAt: now, changedAt: now };
}

/** "Download my notes": one line per note, "14:09 · Priya: …", and nothing else (no question, no answer found). */
export function notesFile(s: CallState, timeZone?: string): string {
  return s.notes.map(n => `${clock(n.at, timeZone)} · ${n.speaker ? `${n.speaker}: ` : ''}${n.text.replace(/\n/g, ' ')}`).join('\n') + (s.notes.length ? '\n' : '');
}

/** The file's name: "Call notes, {process}, {date}.txt", without characters a file name cannot hold. */
export const notesFileName = (process: string, s: CallState, timeZone?: string): string =>
  `Call notes, ${process.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)}, ${day(s.startedAt, timeZone)}.txt`;

/** The ids of an ElementTarget as one string, the way the discovery rules compare targets. */
export const targetKey = (t: ElementTarget): string => `${t.kind}:${t.id ?? ''}:${t.field ?? ''}`;
