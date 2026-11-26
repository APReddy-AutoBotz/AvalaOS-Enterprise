// The cap on one call (package C, plan `claude/package-c-plan-26-nov.md`, section 6; owner, 26 November 2026,
// decision 3): 150,000 tokens and 50 AI calls a call, whichever comes first, counted from the usage each call
// returns, on the platform key and on a workspace's own key alike. The last 20,000 tokens and 3 calls are kept for
// the reading at the end of the call, so readings during the call stop at 130,000 tokens or 47 calls. It is a rule
// in the browser, kept with the call on the device so closing and opening does not reset it; the server's minute
// limit and the monthly allowance stay the backstops.

export const CALL_CAP = { tokens: 150_000, calls: 50, keptForEnd: { tokens: 20_000, calls: 3 } } as const;

/** One reading during the call is two AI calls sent together: `answerFromNotes` and `discoveryQuestions`. */
export const CALLS_A_READING = 2;

/** At most one reading a minute while notes come in (plan section 4.2, "When to read"). */
export const READ_EVERY_MS = 60_000;

/** A spoken note stops by itself at one minute (decision 4). */
export const SPOKEN_NOTE_SECONDS = 60;

export interface CallUse { tokens: number; calls: number }

export const NO_CALL_USE: CallUse = { tokens: 0, calls: 0 };

/** One AI call, with the tokens the server reported for it (none when it reported none). */
export const afterCallUse = (u: CallUse, usage?: { input: number; output: number } | null): CallUse =>
  ({ calls: u.calls + 1, tokens: u.tokens + Math.max(0, usage?.input ?? 0) + Math.max(0, usage?.output ?? 0) });

const during = { tokens: CALL_CAP.tokens - CALL_CAP.keptForEnd.tokens, calls: CALL_CAP.calls - CALL_CAP.keptForEnd.calls };

/** Whether `calls` more AI calls may start during the call: under 130,000 tokens, and 47 calls with them. */
export const roomDuringCall = (u: CallUse, calls: number): boolean => u.tokens < during.tokens && u.calls + calls <= during.calls;

/** Whether `calls` more AI calls may start for the end reading: under the whole cap, with them. */
export const roomAtEnd = (u: CallUse, calls: number): boolean => u.tokens < CALL_CAP.tokens && u.calls + calls <= CALL_CAP.calls;

/** Whether the readings during the call have stopped at the cap (the line `CALL_CAP_LINE` says so). */
export const capReachedDuringCall = (u: CallUse): boolean => !roomDuringCall(u, CALLS_A_READING);
