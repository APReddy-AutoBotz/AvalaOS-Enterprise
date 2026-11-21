// AI use and limits per workspace (Settings → AI use). Pure: no I/O.
//
// Reads the workspace's ai_usage rows for the current month (members may read them) and the platform's
// monthly allowance (from journey-ai, the only place that knows it) and says, in plain words:
// - how much of the allowance work on the platform key has used, and when it starts again;
// - how much ran on the workspace's own key, which the allowance does not count;
// - what kind of work used it, on which days, and by whom.
// Months are calendar months in UTC, as the server counts them (ai_tokens_used_this_month).
// Nothing is projected or estimated: only what the rows record.

export interface UsageRow {
  createdAt: string;
  task: string;
  userId: string | null;
  inputTokens: number;
  outputTokens: number;
  status: string;
  keySource: 'platform' | 'workspace';
}

export interface Allowance {
  /** Tokens per month on the platform key; null when the workspace runs on its own key. */
  budget: number | null;
  /** The server's own count for this month, when it gave one. */
  used: number | null;
}

/** Kinds of AI work, in the words the screens use. Tasks not listed are "Other AI work". */
export const WORK_OF_TASK: Record<string, string> = {
  source_facts: 'Reading sources', source_steps: 'Reading sources', merge_facts: 'Reading sources', merge_flow: 'Reading sources',
  // The facts merge in parts (domain/extract/factsParts.ts); `merge_facts` is its single answer, kept for earlier months.
  merge_facts_rules_exceptions: 'Reading sources', merge_facts_interfaces_metrics: 'Reading sources', merge_facts_conflicts_questions: 'Reading sources',
  merge_facts_rules: 'Reading sources', merge_facts_exceptions: 'Reading sources', merge_facts_interfaces: 'Reading sources',
  merge_facts_metrics: 'Reading sources', merge_facts_conflicts: 'Reading sources', merge_facts_questions: 'Reading sources',
  record_cutoff: 'Reading sources',
  review_flow: 'Reading sources', participants: 'Reading sources',
  readFlowchart: 'Reading flowchart pictures',
  stepTraits: 'Finding facts for the assessment', profileFacts: 'Finding facts for the assessment',
  answerFromNotes: 'Answers from notes',
  readBrief: 'Reading the brief',
  transcribe: 'Turning speech into text',
  draftNarrative: 'Drafting document text',
  askProcess: 'Ask Avala',
  askBoard: 'Ask Avala',
  askWorkspace: 'Ask Avala',
  health: 'Testing the AI key',
};

/**
 * "Test this key" (package 13 B). On the platform key a test is checked against the monthly allowance and
 * counted in it, like any call. On a workspace's own key it is not held back by our allowance, or a workspace
 * whose allowance is used up could never switch to its own key; it has its own small limit instead, counted
 * from the usage log's 'health' rows of the last hour. Every test, working or not, is logged.
 */
export const KEY_TEST_LIMIT = { perHour: 10 } as const;
export const keyTestLimited = (testsInLastHour: number): boolean => testsInLastHour >= KEY_TEST_LIMIT.perHour;
export const KEY_TEST_LIMITED = `The key has been tested ${KEY_TEST_LIMIT.perHour} times in the last hour. Try again later.`;
export const workOf = (task: string) => WORK_OF_TASK[task] ?? 'Other AI work';

/**
 * The per-minute AI limit (docs/next-plan.md, section 3e), beside the monthly allowance. Before every call to a
 * provider that a signed-in person starts (`run`, `transcribe` and `health`; `allowance` calls no provider),
 * journey-ai asks the database (`ai_call_admit`, migration ai_call_admit) whether the person has started fewer
 * than `perPerson` calls in the last `windowSeconds`, in any workspace, and, on the platform key only, whether the
 * workspace has started fewer than `perWorkspace`. A request is one call however often it is retried inside.
 * The trusted server (a caller with the project's secret key: the Ask Avala measure) is never asked.
 * Working defaults (owner, 21 November 2026); change them here, with the test.
 *
 * What it does not do: it caps calls started, not tokens. The monthly allowance is checked when a call starts,
 * so calls already started when it runs out still finish and count: the allowance can be overshot by up to one
 * minute of calls. The hard spend limit set at OpenAI stays the backstop.
 */
export const AI_RATE_LIMIT = { windowSeconds: 60, perPerson: 30, perWorkspace: 90 } as const;

export type RateScope = 'person' | 'workspace';
export type AdmitAnswer = { admitted: true } | { admitted: false; scope: RateScope; retryAfterSeconds: number };

/** Whether a request is checked against the minute limit: a provider call by anyone but the trusted server. */
export const rateLimitApplies = (action: string, serverCaller: boolean): boolean =>
  !serverCaller && (action === 'run' || action === 'transcribe' || action === 'health');

/** The arguments of `ai_call_admit`: the workspace's limit is counted only on the platform key. */
export const admitArgs = (workspaceId: string, userId: string, onPlatformKey: boolean) => ({
  target_workspace: workspaceId, target_person: userId,
  per_person: AI_RATE_LIMIT.perPerson, per_workspace: AI_RATE_LIMIT.perWorkspace,
  count_workspace: onPlatformKey, window_seconds: AI_RATE_LIMIT.windowSeconds,
});

/** The database's answer, or null when it is not one (then the limit could not be checked). */
export function readAdmit(json: unknown): AdmitAnswer | null {
  const x = json as { admitted?: unknown; scope?: unknown; retry_after?: unknown } | null;
  if (!x || typeof x !== 'object') return null;
  if (x.admitted === true) return { admitted: true };
  if (x.admitted !== false || (x.scope !== 'person' && x.scope !== 'workspace')) return null;
  const s = Number(x.retry_after);
  const retryAfterSeconds = Number.isFinite(s) ? Math.min(AI_RATE_LIMIT.windowSeconds, Math.max(1, Math.ceil(s))) : AI_RATE_LIMIT.windowSeconds;
  return { admitted: false, scope: x.scope, retryAfterSeconds };
}

const seconds = (n: number) => `${n} ${n === 1 ? 'second' : 'seconds'}`;

/** The words a person sees when the limit is reached. */
export function rateLimitedMessage(scope: RateScope, retryAfterSeconds: number): string {
  const wait = `Wait about ${seconds(retryAfterSeconds)} and try again.`;
  return scope === 'person'
    ? `You have started ${AI_RATE_LIMIT.perPerson} AI requests in the last minute, the most one person can. ${wait}`
    : `This workspace has started ${AI_RATE_LIMIT.perWorkspace} AI requests in the last minute, the most it can at once. ${wait}`;
}

/** When the limit itself cannot be checked, the call is refused, as when the allowance cannot be read. */
export const RATE_LIMIT_UNAVAILABLE = 'The AI limit could not be checked just now. Try again in a minute.';

const tokensOf = (r: UsageRow) => Math.max(0, Number(r.inputTokens) || 0) + Math.max(0, Number(r.outputTokens) || 0);

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
export const nextMonthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export type AllowanceState = 'ok' | 'near' | 'reached';
/** At or past this share of the allowance, the screen warns. */
export const NEAR_SHARE = 0.8;

export interface UsageSummary {
  from: string;
  resetsOn: string;
  platform: { tokens: number; calls: number };
  own: { tokens: number; calls: number };
  failed: number;
  allowance: { budget: number; used: number; left: number; share: number; state: AllowanceState } | null;
  byWork: { work: string; tokens: number; calls: number }[];
  byDay: { day: string; tokens: number }[];
  byPerson: { userId: string | null; tokens: number; calls: number }[];
}

export function summarizeUsage(rows: UsageRow[], now: Date, allowance: Allowance | null): UsageSummary {
  const from = monthStart(now);
  const until = nextMonthStart(now);
  const month = rows.filter(r => { const t = new Date(r.createdAt); return t >= from && t < until; });

  const platform = { tokens: 0, calls: 0 };
  const own = { tokens: 0, calls: 0 };
  let failed = 0;
  const work = new Map<string, { tokens: number; calls: number }>();
  const days = new Map<string, number>();
  const people = new Map<string | null, { tokens: number; calls: number }>();
  for (const r of month) {
    const t = tokensOf(r);
    const side = r.keySource === 'workspace' ? own : platform;
    side.tokens += t; side.calls++;
    if (r.status !== 'ok') failed++;
    const w = work.get(workOf(r.task)) ?? { tokens: 0, calls: 0 };
    w.tokens += t; w.calls++; work.set(workOf(r.task), w);
    const d = dayKey(new Date(r.createdAt));
    days.set(d, (days.get(d) ?? 0) + t);
    const p = people.get(r.userId) ?? { tokens: 0, calls: 0 };
    p.tokens += t; p.calls++; people.set(r.userId, p);
  }

  const byDay: UsageSummary['byDay'] = [];
  const today = dayKey(now);
  for (let d = new Date(from); dayKey(d) <= today && d < until; d = new Date(d.getTime() + 86_400_000)) byDay.push({ day: dayKey(d), tokens: days.get(dayKey(d)) ?? 0 });

  let limit: UsageSummary['allowance'] = null;
  if (allowance?.budget && allowance.budget > 0) {
    const used = allowance.used ?? platform.tokens;
    const share = used / allowance.budget;
    limit = { budget: allowance.budget, used, left: Math.max(0, allowance.budget - used), share, state: share >= 1 ? 'reached' : share >= NEAR_SHARE ? 'near' : 'ok' };
  }

  const desc = <T extends { tokens: number }>(a: T, b: T) => b.tokens - a.tokens;
  return {
    from: from.toISOString(), resetsOn: until.toISOString(), platform, own, failed, allowance: limit,
    byWork: [...work].map(([w, v]) => ({ work: w, ...v })).sort(desc),
    byDay,
    byPerson: [...people].map(([userId, v]) => ({ userId, ...v })).sort(desc),
  };
}

/** A token count in words people can read at a glance: 950, 12.4 thousand, 1.5 million. */
export function tokenWords(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')} thousand`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0).replace(/\.0$/, '')} million`;
}

/**
 * Reading a month's rows: the server hands back at most `size` rows a request and does not say when it stops,
 * so the page reads on until a request comes back short, up to `max` rows (then it says the figures cover the
 * most recent ones).
 */
export const USAGE_PAGES = { size: 1000, max: 20_000 } as const;

/** Whether another page may hold more rows: only a full page can. */
export const usageMorePages = (rowsInPage: number): boolean => rowsInPage >= USAGE_PAGES.size;
