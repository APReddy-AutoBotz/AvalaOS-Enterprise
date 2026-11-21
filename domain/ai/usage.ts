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

/**
 * Voice: how a transcription's use is counted (docs/next-plan.md, section 3g, dated items; plan of 20 November
 * 2026, approved by the owner). OpenAI gives a transcription's `usage` in one of two forms: tokens
 * (`input_tokens`, `output_tokens`), or, for models billed by the length of the audio (`gpt-transcribe`),
 * `type: "duration"` with `seconds`. The allowance counts tokens, so a duration counts as
 * `VOICE_TOKENS_PER_SECOND` (owner: an allowance rule, not a claim about cost), as input. A reply with neither
 * is counted from the recording's size at a low rate, so it over-counts rather than counting nothing, and the
 * log line says so as a warning. Everything is capped at what `VOICE_MAX_SECONDS` of audio counts: the server
 * refuses a recording longer than about ten minutes (`LIMITS.maxAudioChars` in gateway.ts).
 */
export const VOICE_TOKENS_PER_SECOND = 20;
/** 16 kbps: below what browsers record at, so an estimate from the size over-counts. */
export const VOICE_FALLBACK_BYTES_PER_SECOND = 2_000;
export const VOICE_MAX_SECONDS = 600;
export const VOICE_TOKEN_CAP = VOICE_MAX_SECONDS * VOICE_TOKENS_PER_SECOND;
/** A `seconds` beyond this is not a real recording's length: counted as absent. */
const VOICE_ABSURD_SECONDS = 24 * 3600;

export type TranscriptionForm = 'tokens' | 'duration' | 'neither';

const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/** The tokens a transcription counts as, and which form of usage its reply gave. */
export function transcriptionUsage(reply: unknown, audioBytes: number): { input: number; output: number; form: TranscriptionForm } {
  const usage = (reply as { usage?: Record<string, unknown> } | null)?.usage;
  const u = usage && typeof usage === 'object' ? usage : {};
  const capped = (input: number, output: number) => {
    const i = Math.min(VOICE_TOKEN_CAP, Math.round(input));
    return { input: i, output: Math.min(VOICE_TOKEN_CAP - i, Math.round(output)) };
  };
  const inTokens = count(u.input_tokens), outTokens = count(u.output_tokens);
  if (u.type !== 'duration' && (inTokens !== null || outTokens !== null)) return { ...capped(inTokens ?? 0, outTokens ?? 0), form: 'tokens' };
  const secs = count(u.seconds);
  if (u.type === 'duration' && secs !== null && secs > 0 && secs <= VOICE_ABSURD_SECONDS) {
    return { ...capped(Math.ceil(secs) * VOICE_TOKENS_PER_SECOND, 0), form: 'duration' };
  }
  const bytes = Math.max(0, Number(audioBytes) || 0);
  const estimated = Math.max(1, Math.ceil(bytes / VOICE_FALLBACK_BYTES_PER_SECOND));
  return { ...capped(estimated * VOICE_TOKENS_PER_SECOND, 0), form: 'neither' };
}

/** The one log line a transcription writes: the form and the model, never the reply's text, values or the recording. */
export function transcriptionLogLine(form: TranscriptionForm, model: string): { level: 'info' | 'warn'; text: string } {
  const name = String(model).replace(/[^\w.-]/g, '').slice(0, 60);
  return form === 'neither'
    ? { level: 'warn', text: `transcribe usage form: neither (${name}), estimated from the recording's size` }
    : { level: 'info', text: `transcribe usage form: ${form} (${name})` };
}

/** The sentence under "AI use this month". */
export const VOICE_COUNT_NOTE = `Spoken answers are counted at ${VOICE_TOKENS_PER_SECOND} tokens a second of audio.`;
