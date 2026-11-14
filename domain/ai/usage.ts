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
  review_flow: 'Reading sources', participants: 'Reading sources',
  readFlowchart: 'Reading flowchart pictures',
  stepTraits: 'Finding facts for the assessment', profileFacts: 'Finding facts for the assessment',
  answerFromNotes: 'Answers from notes',
  transcribe: 'Turning speech into text',
  draftNarrative: 'Drafting document text',
  askProcess: 'Questions to the assistant',
};
export const workOf = (task: string) => WORK_OF_TASK[task] ?? 'Other AI work';

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
