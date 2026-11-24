// A discovery session as it is kept (package B, plan section 5; pull request 4, plan
// `claude/package-b-pr4-plan-24-nov.md`; table discovery_sessions). The session keeps only what is not in the
// record yet: the answers about the shape of the process waiting for the next update of the draft, the cards
// skipped, the passages already read for noticing, words kept to read later, and what the session used, so the
// cap survives a reload. Everything a person saved is in the record and the sources as today.
//
// Every change is a step on the state, applied to the server's latest copy and saved with the version it was
// read at, as the look in the sources does (domain/assistant/sharedLook.ts). The database refuses a write that
// names another version, so a step from an older copy is never written over a newer one: it is applied again to
// the newer copy. A step adds or removes only its own entries, by key, so two editors' answers both stay. Keys
// this release does not know (a later release's) are kept as they are.
import type { WaitingAnswer } from './answers.ts';
import { afterCall, afterReading, NO_USE, type SessionUse } from './limits.ts';

/** An answer about the shape of the process, kept until the draft is updated: the card it answers, by key. */
export interface KeptAnswer extends WaitingAnswer { key: string }

/** Words a person kept to read later (the allowance or the cap reached); the card stays open. */
export interface LaterWords { key: string; question: string; words: string; at: string }

export interface SessionState {
  waiting: KeptAnswer[];
  later: LaterWords[];
  skipped: string[];
  /** Passage ids already read for noticing (pull request 5). */
  read: string[];
  use: SessionUse;
  /** Anything else a later release keeps; never dropped. */
  [other: string]: unknown;
}

export const emptyState = (): SessionState => ({ waiting: [], later: [], skipped: [], read: [], use: { ...NO_USE } });

/** One open or finished session as the server holds it. */
export interface StoredSession {
  id: string;
  processId: string;
  status: 'open' | 'finished';
  state: SessionState;
  version: number;
  startedBy: string | null;
  startedAt: string;
  updatedAt: string;
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);
const text = (x: unknown): string => (typeof x === 'string' ? x : '');

/** The state as stored, read without trusting it: what does not have the known shape is left out; other keys stay. */
export function readState(raw: unknown): SessionState {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const entries = (x: unknown) => (Array.isArray(x) ? x.filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object') : []);
  const use = o.use && typeof o.use === 'object' ? (o.use as Record<string, unknown>) : {};
  return {
    ...o,
    waiting: entries(o.waiting).filter(e => text(e.key) && text(e.words).trim())
      .map(e => ({ key: text(e.key), words: text(e.words), question: text(e.question), at: text(e.at) })),
    later: entries(o.later).filter(e => text(e.key) && text(e.words).trim())
      .map(e => ({ key: text(e.key), words: text(e.words), question: text(e.question), at: text(e.at) })),
    skipped: strings(o.skipped),
    read: strings(o.read),
    use: { tokens: num(use.tokens), calls: num(use.calls), readings: num(use.readings) },
  };
}

// ---- Size -----------------------------------------------------------------------------------------

/** The database keeps a session's state up to 256 KB as text (`length(state::text) <= 262144`). */
export const STATE_LIMIT = 262_144;

/**
 * The state's length as the database writes it out (jsonb's text: ", " between items and ": " after keys).
 * It never counts less than the database does: a character outside the basic plane counts two here, one there.
 */
export function stateTextLength(v: unknown): number {
  if (v === null || v === undefined) return 4;
  if (Array.isArray(v)) return v.length ? 2 + v.reduce((n: number, x) => n + stateTextLength(x), 0) + 2 * (v.length - 1) : 2;
  if (typeof v === 'object') {
    const e = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    return e.length ? 2 + e.reduce((n, [k, x]) => n + JSON.stringify(k).length + 2 + stateTextLength(x), 0) + 2 * (e.length - 1) : 2;
  }
  return JSON.stringify(v).length;
}

/** What the card says when a step would take the session past its size (review, 24 November 2026). */
export const FULL_LINE = 'This session is full: it holds as many answers as it can keep. Update the draft from your answers, or finish the session, then carry on.';

// ---- Writing a step -------------------------------------------------------------------------------

export type SessionStep = (s: SessionState) => SessionState;

/** What saving one session's state can give back. */
export type SaveAnswer = { version: number } | 'stale' | 'full' | 'finished';

/** Where the session is kept: read the open session; save a state read at `version`. */
export interface SessionServer {
  get(): Promise<StoredSession | null>;
  save(id: string, next: SessionState, version: number): Promise<SaveAnswer>;
}

export type CommitResult =
  | { kind: 'saved'; session: StoredSession }
  /** The step would take the state past its size; nothing was written. */
  | { kind: 'full' }
  /** No open session any more: someone finished it. */
  | { kind: 'gone' }
  /** Refused `tries` times in a row: others are writing at the same moment. Nothing was lost; the person tries again. */
  | { kind: 'busy' };

/** The line when a step could not be saved after several tries. */
export const BUSY_LINE = 'Someone else is answering on this process at the same moment. Your answer is still in the box; press Save again.';

/**
 * Applies a step to the server's latest copy of the open session and saves it with the version it was read at.
 * When another page saved in between, the step is applied again to the newer copy. Never writes without the
 * version it read, and never writes a state past its size.
 */
export async function commitSessionStep(server: SessionServer, step: SessionStep, tries = 5): Promise<CommitResult> {
  for (let i = 0; i < tries; i++) {
    const stored = await server.get();
    if (!stored || stored.status !== 'open') return { kind: 'gone' };
    const next = step(readState(stored.state));
    if (stateTextLength(next) > STATE_LIMIT) return { kind: 'full' };
    const saved = await server.save(stored.id, next, stored.version);
    if (saved === 'full') return { kind: 'full' };
    if (saved === 'finished') return { kind: 'gone' };
    if (saved !== 'stale') return { kind: 'saved', session: { ...stored, state: next, version: saved.version } };
  }
  return { kind: 'busy' };
}

// ---- The steps ------------------------------------------------------------------------------------

const without = <T extends { key: string }>(list: T[], key: string) => list.filter(e => e.key !== key);

/** Keep an answer about the shape of the process (replacing an earlier one to the same card). */
export const keepAnswer = (a: KeptAnswer): SessionStep => s => ({ ...s, waiting: [...without(s.waiting, a.key), a], later: without(s.later, a.key), skipped: s.skipped.filter(k => k !== a.key) });

/** Take back a waiting answer before the draft is updated. */
export const dropAnswer = (key: string): SessionStep => s => ({ ...s, waiting: without(s.waiting, key) });

/** Keep words to read later; the card stays open. */
export const keepLater = (w: LaterWords): SessionStep => s => ({ ...s, later: [...without(s.later, w.key), w] });

/** The words kept for later were read (or the person cleared them). */
export const dropLater = (key: string): SessionStep => s => ({ ...s, later: without(s.later, key) });

export const skip = (key: string): SessionStep => s => (s.skipped.includes(key) ? s : { ...s, skipped: [...s.skipped, key] });
export const unskip = (key: string): SessionStep => s => ({ ...s, skipped: s.skipped.filter(k => k !== key) });

export const markRead = (ids: readonly string[]): SessionStep => s => ({ ...s, read: [...new Set([...s.read, ...ids])] });

/** One call of the panel's own, with the tokens the server reported for it. */
export const usedCall = (usage?: { input: number; output: number } | null): SessionStep => s => ({ ...s, use: afterCall(s.use, usage) });

/** A reading of the sources, with the tokens its own totals record. */
export const usedReading = (tokens: number): SessionStep => s => ({ ...s, use: afterReading(s.use, tokens) });

/** A reading this session started, counted once however often its end is seen (`runs` holds the readings counted). */
export const countedReading = (runId: string, tokens: number): SessionStep => s => {
  const runs = strings(s.runs);
  return runs.includes(runId) ? s : { ...s, runs: [...runs, runId], use: afterReading(s.use, tokens) };
};

/** The readings this session started, so their end is counted and shown here (an update of the draft). */
export const startedReading = (runId: string): SessionStep => s => ({ ...s, started: [...new Set([...strings(s.started), runId])] });
export const readingsStarted = (s: SessionState): string[] => strings(s.started);

/** An update's changes were reviewed (applied, or found to change nothing): its review is not shown again. */
export const reviewedReading = (runId: string): SessionStep => s => ({ ...s, reviewed: [...new Set([...strings(s.reviewed), runId])] });
export const readingsReviewed = (s: SessionState): string[] => strings(s.reviewed);

/** One answer saved to the record in this session (the summary's "Recorded: N answers"). */
export const countSaved: SessionStep = s => ({ ...s, saved: num(s.saved) + 1 });
export const savedCount = (s: SessionState): number => num(s.saved);

/**
 * The waiting answers written into a "Discovery answers" source leave the session in the same step, so a
 * person's words are never kept twice. Only the answers that went into the source leave: one another editor
 * kept meanwhile, or changed since, stays waiting.
 */
export const tookIntoSource = (taken: readonly KeptAnswer[]): SessionStep => s => ({
  ...s,
  waiting: s.waiting.filter(w => !taken.some(t => t.key === w.key && t.at === w.at && t.words === w.words)),
});

// ---- Whether a session is in use ----------------------------------------------------------------

/**
 * An open session holds the automatic look in the sources back only while it is in use (review, 24 November
 * 2026): written in the last 30 minutes, or open in the Discovery tab in this browser. A session left idle
 * blocks nothing; it can be carried on or finished by any editor.
 */
export const IN_USE_MS = 30 * 60 * 1000;

export function sessionInUse(s: Pick<StoredSession, 'status' | 'updatedAt'> | null, now: number, openHere = false): boolean {
  if (!s || s.status !== 'open') return false;
  if (openHere) return true;
  const at = Date.parse(s.updatedAt);
  return Number.isFinite(at) && now - at < IN_USE_MS;
}

/** "Started by {name} on {date}": by name only; an email address or no name is never shown. */
export function startedLine(name: string | null | undefined, date: string): string {
  const n = name?.trim();
  return n && !n.includes('@') ? `Started by ${n} on ${date}` : `Started on ${date}`;
}
