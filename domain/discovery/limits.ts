// The cap on one discovery session (package B, plan section 4; owner, 23 November 2026): 250,000 tokens,
// 60 calls of the panel's own (noticing, reading answers, voice) and three readings (the first and two
// updates of the draft), whichever comes first. It counts on the platform key and on a workspace's own
// key alike. A rule in the browser, as the automatic look's limits are; the server's per-minute limit and
// the monthly allowance stay the backstops. At the cap the session stops reading words and updating the
// draft; cards with a field still save, and answers about the shape of the process are still kept.

export const SESSION_CAP = { tokens: 250_000, calls: 60, readings: 3 } as const;

export interface SessionUse { tokens: number; calls: number; readings: number }

export const NO_USE: SessionUse = { tokens: 0, calls: 0, readings: 0 };

export type CapReached = 'tokens' | 'calls' | 'readings';

/** One call of the panel's own, with the tokens the server reported for it (none when it reported none). */
export const afterCall = (u: SessionUse, usage?: { input: number; output: number } | null): SessionUse =>
  ({ ...u, calls: u.calls + 1, tokens: u.tokens + Math.max(0, usage?.input ?? 0) + Math.max(0, usage?.output ?? 0) });

/** A reading of the sources, with the tokens its own totals record. */
export const afterReading = (u: SessionUse, tokens: number): SessionUse => ({ ...u, readings: u.readings + 1, tokens: u.tokens + Math.max(0, tokens) });

/** Which part of the cap is reached, the tokens first; null while none is. */
export function capReached(u: SessionUse): CapReached | null {
  if (u.tokens >= SESSION_CAP.tokens) return 'tokens';
  if (u.calls >= SESSION_CAP.calls) return 'calls';
  if (u.readings >= SESSION_CAP.readings) return 'readings';
  return null;
}

/** Whether words may still be read (noticing, reading an answer, voice). */
export const canReadWords = (u: SessionUse): boolean => capReached(u) === null;

/** Whether the draft may still be updated from the answers: the tokens and the readings, not the panel's own calls. */
export const canUpdateDraft = (u: SessionUse): boolean => u.tokens < SESSION_CAP.tokens && u.readings < SESSION_CAP.readings;

/** The line at the cap (plan section 6, "Limits"). */
export const CAP_LINE = 'This session has used its share of AI. Questions with a choice or a number still save. Start a new session to read words again.';
