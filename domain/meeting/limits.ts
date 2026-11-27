// The cap on one call (package C, plan `claude/package-c-plan-26-nov.md`, section 6; owner, 26 November 2026,
// decision 3, and his decision on the dry run the same day): 150,000 tokens and 70 AI calls for each 30 minutes of
// the call, so 45 minutes is 225,000 and 105, and 60 minutes 300,000 and 140, whichever comes first, counted from the
// usage each call returns, on the platform key and on a workspace's own key alike. The share kept for the reading at
// the end is scaled the same way: 20,000 tokens and 3 calls for each 30 minutes (the calls rounded up). It is a rule
// in the browser, kept with the call on the device so closing and opening does not reset it; the server's minute
// limit and the monthly allowance stay the backstops. One reading a minute stays.

/** The cap for each 30 minutes of a call; `capFor` scales it to the call's length. */
export const CALL_CAP = { tokens: 150_000, calls: 70, keptForEnd: { tokens: 20_000, calls: 3 } } as const;
export const CAP_MINUTES = 30;

/** One reading during the call is two AI calls sent together: `answerFromNotes` and `discoveryQuestions`. */
export const CALLS_A_READING = 2;

/** At most one reading a minute while notes come in (plan section 4.2, "When to read"). */
export const READ_EVERY_MS = 60_000;

/** A spoken note stops by itself at one minute (decision 4). */
export const SPOKEN_NOTE_SECONDS = 60;

export interface Cap { tokens: number; calls: number; keptForEnd: { tokens: number; calls: number } }

/** The cap of a call of this length: 30 minutes is 150,000 tokens and 70 calls, with 20,000 and 3 kept for the end. */
export function capFor(minutes: number): Cap {
  const f = Math.max(1, minutes) / CAP_MINUTES;
  return {
    tokens: Math.round(CALL_CAP.tokens * f), calls: Math.round(CALL_CAP.calls * f),
    keptForEnd: { tokens: Math.round(CALL_CAP.keptForEnd.tokens * f), calls: Math.ceil(CALL_CAP.keptForEnd.calls * f) },
  };
}

export interface CallUse { tokens: number; calls: number }

export const NO_CALL_USE: CallUse = { tokens: 0, calls: 0 };

/** One AI call, with the tokens the server reported for it (none when it reported none). */
export const afterCallUse = (u: CallUse, usage?: { input: number; output: number } | null): CallUse =>
  ({ calls: u.calls + 1, tokens: u.tokens + Math.max(0, usage?.input ?? 0) + Math.max(0, usage?.output ?? 0) });

/** Whether `calls` more AI calls may start during a call of `minutes`: under the cap less what is kept for the end. */
export function roomDuringCall(u: CallUse, calls: number, minutes: number): boolean {
  const c = capFor(minutes);
  return u.tokens < c.tokens - c.keptForEnd.tokens && u.calls + calls <= c.calls - c.keptForEnd.calls;
}

/** Whether `calls` more AI calls may start for the end reading: under the whole cap, with them. */
export function roomAtEnd(u: CallUse, calls: number, minutes: number): boolean {
  const c = capFor(minutes);
  return u.tokens < c.tokens && u.calls + calls <= c.calls;
}

/** Whether the readings during the call have stopped at the cap (the line `capReached` says so). */
export const capReachedDuringCall = (u: CallUse, minutes: number): boolean => !roomDuringCall(u, CALLS_A_READING, minutes);
