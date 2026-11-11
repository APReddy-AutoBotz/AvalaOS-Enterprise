// journey-ai: the only route from the app to an AI provider.
//
// POST { action: 'health', workspaceId }                    -> checks sign-in, membership, key and model
// POST { action: 'run', workspaceId, task, segments[] }     -> runs a registered task with strict output
//
// The caller's own token decides access (RLS). A caller presenting the project's secret key is a
// trusted server (it already has full database access): membership is not checked and no user is
// logged. The service key is otherwise used only to read the monthly budget and write the usage log.
// The OpenAI key never leaves this function.
// Deployed with verify_jwt = false because the function authenticates the caller itself.

import {
  validateRequest, buildOpenAIRequest, parseOpenAIResponse, verifyExcerpts,
  isRetryableStatus, monthlyBudgetExceeded, type ParsedResponse,
} from '../../../domain/ai/gateway.ts';
import { TASKS } from '../../../domain/ai/tasks.ts';

const OPENAI_URL = 'https://api.openai.com/v1';
const TIMEOUT_MS = 120_000;
const BACKOFF_MS = [1000, 3000];

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');

function pickKey(jsonVar: string, legacyVar: string): string {
  try {
    const parsed = JSON.parse(env(jsonVar) || '{}');
    if (typeof parsed.default === 'string' && parsed.default) return parsed.default;
  } catch { /* fall through to the legacy key */ }
  return env(legacyVar);
}
const PUBLISHABLE_KEY = pickKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const SECRET_KEY = pickKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');

/** New sb_secret_ keys go in apikey only; legacy JWT service keys also need the Bearer header. */
const serviceHeaders = (): Record<string, string> =>
  SECRET_KEY.startsWith('sb_secret_')
    ? { apikey: SECRET_KEY, 'Content-Type': 'application/json' }
    : { apikey: SECRET_KEY, Authorization: `Bearer ${SECRET_KEY}`, 'Content-Type': 'application/json' };

const CORS = {
  'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => reply(status, { ok: false, error: { code, message } });

/** Constant-time string comparison. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the request carries the project's secret key (apikey header or Bearer). */
function isServerCaller(req: Request): boolean {
  const apikey = req.headers.get('apikey') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '');
  return sameSecret(apikey, SECRET_KEY) || sameSecret(bearer, SECRET_KEY);
}

async function currentUser(authHeader: string): Promise<{ id: string } | null> {
  if (!authHeader.startsWith('Bearer ')) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: authHeader } });
  if (!res.ok) return null;
  const user = await res.json();
  return typeof user?.id === 'string' ? { id: user.id } : null;
}

/** RLS answers this: a non-member sees no row. */
async function isMember(authHeader: string, workspaceId: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=id`, {
    headers: { apikey: PUBLISHABLE_KEY, Authorization: authHeader },
  });
  if (!res.ok) return false;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length === 1;
}

async function tokensUsedThisMonth(workspaceId: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_tokens_used_this_month`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ target_workspace: workspaceId }),
  });
  if (!res.ok) throw new Error(`budget lookup failed (${res.status})`);
  return Number(await res.json());
}

async function logUsage(row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
    method: 'POST', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(row),
  });
  if (!res.ok) console.error('ai_usage insert failed', res.status, await res.text());
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function openai(path: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${OPENAI_URL}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** One provider call with retries on transient statuses. */
async function callResponses(body: Record<string, unknown>): Promise<{ parsed: ParsedResponse; attempts: number }> {
  let attempts = 0;
  for (;;) {
    attempts++;
    let res: Response;
    try {
      res = await openai('/responses', { method: 'POST', body: JSON.stringify(body) });
    } catch (e) {
      if (attempts <= BACKOFF_MS.length) { await sleep(BACKOFF_MS[attempts - 1]); continue; }
      return { parsed: { ok: false, code: 'PROVIDER_ERROR', message: `Provider unreachable: ${(e as Error).name}`, usage: { input: 0, output: 0 } }, attempts };
    }
    if (isRetryableStatus(res.status) && attempts <= BACKOFF_MS.length) { await res.body?.cancel(); await sleep(BACKOFF_MS[attempts - 1]); continue; }
    const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    if (!res.ok && !json?.error) json.error = { message: `HTTP ${res.status}` };
    return { parsed: parseOpenAIResponse(json), attempts };
  }
}

const STATUS_FOR: Record<string, string> = { PROVIDER_ERROR: 'provider_error', INVALID_OUTPUT: 'invalid_output', TRUNCATED: 'truncated', REFUSED: 'refused' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) return fail(500, 'NOT_CONFIGURED', 'Supabase environment is incomplete.');
  if (!env('OPENAI_API_KEY')) return fail(500, 'NOT_CONFIGURED', 'The AI provider key is not set.');

  const body = await req.json().catch(() => null);
  const v = validateRequest(body, TASKS);
  if (!v.ok) return fail(400, v.code, v.message);
  const request = v.value;

  const authHeader = req.headers.get('Authorization') ?? '';
  let userId: string | null = null;
  if (isServerCaller(req)) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/workspaces?id=eq.${request.workspaceId}&select=id`, { headers: serviceHeaders() });
    const rows = res.ok ? await res.json() : [];
    if (!Array.isArray(rows) || rows.length !== 1) return fail(404, 'WORKSPACE_NOT_FOUND', 'No such workspace.');
  } else {
    const user = await currentUser(authHeader);
    if (!user) return fail(401, 'UNAUTHENTICATED', 'Sign in again.');
    if (!(await isMember(authHeader, request.workspaceId))) return fail(403, 'FORBIDDEN', 'You are not a member of this workspace.');
    userId = user.id;
  }

  const model = env('OPENAI_MODEL') || 'gpt-5.5';

  if (request.action === 'health') {
    const res = await openai(`/models/${encodeURIComponent(model)}`, { method: 'GET' });
    await res.body?.cancel();
    if (res.status === 401) return fail(502, 'PROVIDER_AUTH', 'The AI provider rejected the key.');
    if (res.status === 404) return fail(502, 'MODEL_UNAVAILABLE', `Model ${model} is not available to this key.`);
    if (!res.ok) return fail(502, 'PROVIDER_ERROR', `Provider returned ${res.status}.`);
    return reply(200, { ok: true, model, tasks: Object.keys(TASKS) });
  }

  const budget = Number(env('AI_MONTHLY_TOKEN_BUDGET') || 2_000_000);
  try {
    if (monthlyBudgetExceeded(await tokensUsedThisMonth(request.workspaceId), budget)) {
      return fail(429, 'BUDGET_EXCEEDED', 'This workspace has used its AI allowance for the month.');
    }
  } catch (e) {
    return fail(500, 'BUDGET_UNAVAILABLE', (e as Error).message);
  }

  const task = TASKS[request.task!];
  const segments = request.segments!;
  const openaiBody = buildOpenAIRequest(task, segments, model);
  const effort = env('OPENAI_REASONING_EFFORT') || 'low';
  if (/^(gpt-5|o\d)/.test(model)) openaiBody.reasoning = { effort };

  const started = Date.now();
  let { parsed, attempts } = await callResponses(openaiBody);
  if (!parsed.ok && parsed.code === 'INVALID_OUTPUT') {
    const again = await callResponses(openaiBody);
    attempts += again.attempts;
    parsed = again.parsed;
  }

  await logUsage({
    workspace_id: request.workspaceId,
    user_id: userId,
    task: task.id,
    model,
    status: parsed.ok ? 'ok' : STATUS_FOR[parsed.code],
    input_tokens: parsed.usage.input,
    output_tokens: parsed.usage.output,
    attempts,
    error_code: parsed.ok ? null : parsed.code,
    duration_ms: Date.now() - started,
  });

  if (!parsed.ok) return fail(502, parsed.code, parsed.message);
  const { data, dropped } = verifyExcerpts(parsed.data, task.verifyArrays, segments);
  return reply(200, { ok: true, data, dropped, usage: parsed.usage, model });
});
