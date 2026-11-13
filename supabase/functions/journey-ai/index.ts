// journey-ai: the only route from the app to an AI provider.
//
// POST { action: 'health', workspaceId }                    -> checks sign-in, membership, key and model
// POST { action: 'run', workspaceId, task, segments[] }     -> runs a registered task with strict output
// POST { action: 'run', workspaceId, task, image }          -> the same, for tasks that read an image (a data URL)
// POST { action: 'transcribe', workspaceId, audio }         -> the text of a recorded answer (a data URL)
//
// The caller's own token decides access (RLS). A caller presenting the project's secret key is a
// trusted server (it already has full database access): membership is not checked and no user is
// logged. The service key is otherwise used only to read the monthly budget and write the usage log.
// Provider keys (the platform's OPENAI_API_KEY, or a workspace's own key read from the Vault by the
// service role, see domain/ai/providers.ts) never leave this function. A workspace with its own key never
// falls back to the platform key, and only calls on the platform key count against its monthly allowance.
// Deployed with verify_jwt = false because the function authenticates the caller itself.

import {
  validateRequest, buildOpenAIRequest, buildImageRequest, verifyExcerpts,
  isRetryableStatus, monthlyBudgetExceeded, type ParsedResponse,
} from '../../../domain/ai/gateway.ts';
import { ProviderRequestError } from '../../../domain/ai/anthropic.ts';
import { TASKS } from '../../../domain/ai/tasks.ts';
import {
  chooseConnection, parseProviderReply, providerRequest, takesReasoningEffort, taskNeed, testRequestBody, transcriptionTarget,
  unsupported, usesPlatformAllowance, validateAiChoice, type AiConnection,
} from '../../../domain/ai/providers.ts';

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

/** The workspace's own AI connection (with its key, read by the service role), or null when it has none. */
async function workspaceConnection(workspaceId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/workspace_ai_connection`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ target_workspace: workspaceId }),
  });
  // 404: the lookup itself does not exist yet (database not migrated), so no workspace can have a key.
  if (res.status === 404) { await res.body?.cancel(); return null; }
  if (!res.ok) throw new Error(`AI settings lookup failed (${res.status})`);
  const found = await res.json();
  return found ? { ...validateAiChoice(found), apiKey: String(found.apiKey ?? '') } : null;
}

async function noteWorkspaceAi(workspaceId: string, fields: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/workspace_ai_settings?workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', headers: { ...serviceHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify(fields),
  });
  if (!res.ok) console.error('workspace_ai_settings update failed', res.status);
}

async function post(url: string, headers: Record<string, string>, body: BodyInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'POST', signal: ctl.signal, headers, body });
  } finally {
    clearTimeout(timer);
  }
}

/** One provider call with retries on transient statuses. The body is a Responses API body; providerRequest translates it for Anthropic. */
async function callResponses(conn: AiConnection, body: Record<string, unknown>): Promise<{ parsed: ParsedResponse; attempts: number }> {
  const target = providerRequest(conn, body);
  const payload = JSON.stringify(target.body);
  let attempts = 0;
  for (;;) {
    attempts++;
    let res: Response;
    try {
      res = await post(target.url, target.headers, payload);
    } catch (e) {
      if (attempts <= BACKOFF_MS.length) { await sleep(BACKOFF_MS[attempts - 1]); continue; }
      return { parsed: { ok: false, code: 'PROVIDER_ERROR', message: `Provider unreachable: ${(e as Error).name}`, usage: { input: 0, output: 0 } }, attempts };
    }
    if (isRetryableStatus(res.status) && attempts <= BACKOFF_MS.length) { await res.body?.cancel(); await sleep(BACKOFF_MS[attempts - 1]); continue; }
    const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
    if (!res.ok && !json?.error) json.error = { message: `HTTP ${res.status}` };
    return { parsed: parseProviderReply(conn, json), attempts };
  }
}

const STATUS_FOR: Record<string, string> = { PROVIDER_ERROR: 'provider_error', INVALID_OUTPUT: 'invalid_output', TRUNCATED: 'truncated', REFUSED: 'refused' };

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !PUBLISHABLE_KEY || !SECRET_KEY) return fail(500, 'NOT_CONFIGURED', 'Supabase environment is incomplete.');

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

  // The workspace's own key when it has one (never falling back to the platform's), otherwise the platform key.
  let conn: AiConnection | null;
  try {
    conn = chooseConnection(await workspaceConnection(request.workspaceId), { apiKey: env('OPENAI_API_KEY'), model: env('OPENAI_MODEL') || 'gpt-5.5' });
  } catch (e) {
    return fail(500, 'AI_SETTINGS_UNAVAILABLE', (e as Error).message);
  }
  if (!conn) return fail(500, 'NOT_CONFIGURED', 'No AI provider key is set.');
  const model = conn.model;
  const usage = (row: Record<string, unknown>) => logUsage({ ...row, provider: conn!.provider, key_source: conn!.source });

  // "Test this key": a tiny real request through the same address, key and model the workspace uses.
  if (request.action === 'health') {
    const target = providerRequest(conn, testRequestBody(conn));
    let status = 0;
    try {
      const res = await post(target.url, target.headers, JSON.stringify(target.body));
      status = res.status;
      await res.body?.cancel();
    } catch { status = 0; }
    const ok = status >= 200 && status < 300;
    if (conn.source === 'workspace') await noteWorkspaceAi(request.workspaceId, { last_tested_at: new Date().toISOString(), last_test_ok: ok });
    if (status === 401 || status === 403) return fail(502, 'PROVIDER_AUTH', 'The AI provider rejected the key.');
    if (status === 404) return fail(502, 'MODEL_UNAVAILABLE', `The provider has no model or deployment named ${model} for this key.`);
    if (status === 429) return fail(502, 'PROVIDER_LIMIT', 'The key works, but the provider says its rate limit or quota is used up.');
    if (!ok) return fail(502, 'PROVIDER_ERROR', status ? `The provider returned ${status}.` : 'The provider could not be reached.');
    return reply(200, { ok: true, model, provider: conn.provider, source: conn.source, tasks: Object.keys(TASKS) });
  }

  const budget = Number(env('AI_MONTHLY_TOKEN_BUDGET') || 2_000_000);
  const checkAllowance = async (): Promise<Response | null> => {
    if (!usesPlatformAllowance(conn!)) return null;
    try {
      if (monthlyBudgetExceeded(await tokensUsedThisMonth(request.workspaceId), budget)) return fail(429, 'BUDGET_EXCEEDED', 'This workspace has used its AI allowance for the month.');
    } catch (e) { return fail(500, 'BUDGET_UNAVAILABLE', (e as Error).message); }
    return null;
  };
  const used = async () => { if (conn!.source === 'workspace') await noteWorkspaceAi(request.workspaceId, { last_used_at: new Date().toISOString() }); };

  if (request.action === 'transcribe') {
    const off = unsupported(conn, 'transcription');
    if (off) return fail(422, 'NOT_SUPPORTED_BY_PROVIDER', off);
    const over = await checkAllowance();
    if (over) return over;
    const [head, data] = request.audio!.split(',');
    const mime = head.slice(5).split(';')[0];
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const ext = ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' } as Record<string, string>)[mime] ?? 'webm';
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: mime }), `answer.${ext}`);
    const tmodel = env('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-transcribe';
    const ttarget = transcriptionTarget(conn);
    form.append('model', tmodel);
    const started = Date.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let ok = false, text = '', code = 'PROVIDER_ERROR', tokens = { input: 0, output: 0 };
    try {
      const res = await fetch(ttarget.url, { method: 'POST', body: form, signal: ctl.signal, headers: ttarget.headers });
      const json = await res.json().catch(() => ({}));
      ok = res.ok && typeof json.text === 'string';
      text = ok ? json.text : '';
      tokens = { input: Number(json?.usage?.input_tokens ?? 0) || 0, output: Number(json?.usage?.output_tokens ?? 0) || 0 };
      if (!ok) code = res.status === 401 ? 'PROVIDER_AUTH' : 'PROVIDER_ERROR';
    } catch { ok = false; } finally { clearTimeout(timer); }
    await usage({ workspace_id: request.workspaceId, user_id: userId, task: 'transcribe', model: tmodel, status: ok ? 'ok' : 'provider_error', input_tokens: tokens.input, output_tokens: tokens.output, attempts: 1, error_code: ok ? null : code, duration_ms: Date.now() - started });
    if (!ok) return fail(502, code, 'The recording could not be transcribed. Try again, or type the answer.');
    await used();
    return reply(200, { ok: true, text, model: tmodel });
  }

  const task = TASKS[request.task!];
  const off = unsupported(conn, taskNeed(task));
  if (off) return fail(422, 'NOT_SUPPORTED_BY_PROVIDER', off);
  const over = await checkAllowance();
  if (over) return over;

  const segments = request.segments ?? [];
  const openaiBody = task.input === 'image' ? buildImageRequest(task, request.image!, model) : buildOpenAIRequest(task, segments, model);
  const effort = task.reasoningEffort || env('OPENAI_REASONING_EFFORT') || 'low';
  if (takesReasoningEffort(model)) openaiBody.reasoning = { effort };
  // An input the provider cannot take (an image over Anthropic's size limit) is refused before any call.
  try { providerRequest(conn, openaiBody); } catch (e) {
    if (e instanceof ProviderRequestError) return fail(e.code === 'TOO_LARGE' ? 413 : 400, e.code, e.message);
    throw e;
  }

  const started = Date.now();
  let { parsed, attempts } = await callResponses(conn, openaiBody);
  if (!parsed.ok && parsed.code === 'INVALID_OUTPUT') {
    const again = await callResponses(conn, openaiBody);
    attempts += again.attempts;
    parsed = again.parsed;
  }

  await usage({
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
  await used();
  if (task.input === 'image') return reply(200, { ok: true, data: parsed.data, dropped: [], usage: parsed.usage, model });
  const { data, dropped } = verifyExcerpts(parsed.data, task.verifyArrays, segments);
  return reply(200, { ok: true, data, dropped, usage: parsed.usage, model });
});
