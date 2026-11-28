// The limit on starting readings (plan (a) of claude/reading-limit-email-link-and-screens-plans-26-nov.md,
// approved by the owner on 26 November 2026). A reading is bounded in itself (editors only, 1 to 40 sources,
// a size cap, the allowance checked when it starts); this limits how many are started:
//   1. one reading at a time per process: while one is under way (not done or failed, and changed within
//      STALL_MS, after which a run counts as stopped from outside and is ended at its next look), another is
//      refused, and the page follows the one under way;
//   2. at most READING_LIMIT.perPersonHour readings an hour per person, in any workspace, counted over the
//      last 60 minutes, whether each then succeeded or failed.
// The database holds both in one step (public.extraction_start, migration extraction_start_limit), so two
// starts sent together cannot both pass. The figures are working defaults the owner may change.
import { STALL_MS } from './failure.ts';

export const READING_LIMIT = { perPersonHour: 6, stallSeconds: STALL_MS / 1000 } as const;

/** What public.extraction_start answers. */
export type StartAnswer =
  | { admitted: true; runId: string }
  | { admitted: false; reason: 'in_progress'; runId: string }
  | { admitted: false; reason: 'per_hour'; retryAfterSeconds: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the function's answer; anything else is an error, never an admission. */
export function readStartAnswer(raw: unknown): StartAnswer {
  const a = (raw ?? {}) as Record<string, unknown>;
  const runId = typeof a.run_id === 'string' && UUID.test(a.run_id) ? a.run_id : null;
  if (a.admitted === true && runId) return { admitted: true, runId };
  if (a.admitted === false && a.reason === 'in_progress' && runId) return { admitted: false, reason: 'in_progress', runId };
  if (a.admitted === false && a.reason === 'per_hour' && Number.isInteger(a.retry_after) && (a.retry_after as number) >= 1) {
    return { admitted: false, reason: 'per_hour', retryAfterSeconds: a.retry_after as number };
  }
  throw new Error(`extraction_start answered ${JSON.stringify(raw)?.slice(0, 200)}`);
}

/** The line the Sources screen and the Discovery tab show while they follow a reading someone else started. */
export const IN_PROGRESS_LINE = 'A reading of this process was already under way. Its result shows here when it is done.';

/** The words for the hourly limit: how many, and when the next one can start, in whole minutes. */
export function perHourMessage(retryAfterSeconds: number, limit: number = READING_LIMIT.perPersonHour): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `You have started ${limit} readings in the last hour. You can start the next one in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

export interface StartRefusal {
  status: 409 | 429;
  code: 'READING_IN_PROGRESS' | 'READINGS_PER_HOUR';
  message: string;
  /** The reading under way, which the page follows. */
  runId?: string;
  retryAfterSeconds?: number;
}

/** How a refused start is answered to the page; null when it was admitted. */
export function readingRefusal(a: StartAnswer, limit: number = READING_LIMIT.perPersonHour): StartRefusal | null {
  if (a.admitted) return null;
  // Spelt out, so it reads the same under the site's looser type settings as under the functions' strict ones.
  const r = a as Exclude<StartAnswer, { admitted: true }>;
  if (r.reason === 'in_progress') return { status: 409, code: 'READING_IN_PROGRESS', message: IN_PROGRESS_LINE, runId: (r as Extract<StartAnswer, { reason: 'in_progress' }>).runId };
  const wait = (r as Extract<StartAnswer, { reason: 'per_hour' }>).retryAfterSeconds;
  return { status: 429, code: 'READINGS_PER_HOUR', message: perHourMessage(wait, limit), retryAfterSeconds: wait };
}

/** The reading under way named by a refusal the page received (`READING_IN_PROGRESS` with its run), else null. */
export function runUnderWay(e: unknown): string | null {
  const x = e as { code?: unknown; runId?: unknown } | null;
  return x && x.code === 'READING_IN_PROGRESS' && typeof x.runId === 'string' && UUID.test(x.runId) ? x.runId : null;
}

/** A reading as the in-browser store keeps it: enough to apply the two rules. */
export interface RunFacts { id: string; processId: string; createdBy?: string | null; status: string; createdAt: string; updatedAt: string }

/**
 * The two rules on readings kept in the browser, in the order public.extraction_start applies them: a reading
 * of the process under way (the newest), then the person's starts in the last hour; null when a start may go.
 * The in-browser store and the browser tests use it; the live site is held by the database.
 */
export function startRefused(runs: readonly RunFacts[], processId: string, personId: string, nowMs: number, limit: number = READING_LIMIT.perPersonHour): Exclude<StartAnswer, { admitted: true }> | null {
  const open = runs
    .filter(r => r.processId === processId && r.status !== 'done' && r.status !== 'failed' && Date.parse(r.updatedAt) > nowMs - READING_LIMIT.stallSeconds * 1000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (open) return { admitted: false, reason: 'in_progress', runId: open.id };
  const hour = runs.filter(r => r.createdBy === personId && Date.parse(r.createdAt) > nowMs - 3_600_000);
  if (hour.length >= limit) {
    const oldest = Math.min(...hour.map(r => Date.parse(r.createdAt)));
    return { admitted: false, reason: 'per_hour', retryAfterSeconds: Math.max(1, Math.ceil((oldest + 3_600_000 - nowMs) / 1000)) };
  }
  return null;
}
