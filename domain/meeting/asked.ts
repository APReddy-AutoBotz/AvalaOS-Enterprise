// What the call's noticing must not raise again (C3, plan `claude/package-c-c3-plan-28-nov.md`, section 2): 5b's own
// list, `noticeAsked` in domain/discovery/flow.ts. Every question the record holds (open, left with someone, answered
// or not applicable), and the questions of the process's open Discovery session (raised, waiting for the draft,
// left for later). With no session open, the record's alone. The screen reads the session at the call's start and
// again before each reading, and passes the result as `PrepContext.asked`.
import type { ProcessModel } from '../processModel/types.ts';
import { noticeAsked } from '../discovery/flow.ts';
import type { SessionState } from '../discovery/session.ts';

export function callAsked(model: ProcessModel, session?: Pick<SessionState, 'waiting' | 'later'> & { raised?: unknown } | null): string[] {
  return noticeAsked(model, session ?? { waiting: [], later: [] });
}
