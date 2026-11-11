// journey-extract: turns parsed sources into a Process Model, in stages (see the extraction_runs
// migration). Each request does one stage in the background and returns 202 at once; the stage
// starts the next one by calling this function again with the run's token.
//
// POST { action: 'create', workspaceId, processId, processName, sources: [{ sourceId, title, kind, segments }] }
//      with the user's session -> { runId }. Members follow the run in extraction_runs.
// POST { action: 'start' | 'pass' | 'merge' | 'review' | 'assemble', runId, token, ... } -> internal stages.
//      An eval run is created in SQL and started with { action: 'start', runId, token }; it reads its
//      sources from the public repository at a given commit and scores the result against the gold.
//
// Deployed with verify_jwt = false: 'create' checks the user's session; stages check the run token.

import { buildImageRequest, buildListingRequest, buildOpenAIRequest, isRetryableStatus, parseOpenAIResponse, verifyExcerpts, LIMITS, type TaskDefinition } from '../../../domain/ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../../../domain/ingest/segment.ts';
import { looksLikeTranscript, parsePlainText, parseSrt, parseTranscriptText, parseVtt } from '../../../domain/ingest/parsers/text.ts';
import { parseDocx } from '../../../domain/ingest/parsers/docx.ts';
import { buildCandidates, factsListing, flowListing, type SourcePassOutput } from '../../../domain/extract/candidates.ts';
import { mergeFacts, mergeFlow, reviewFlow, sourceFacts, sourceSteps } from '../../../domain/extract/tasks.ts';
import { reviewListing } from '../../../domain/extract/review.ts';
import { finish } from '../../../domain/extract/pipeline.ts';
import { score } from '../../../eval/scorer.ts';
import { parseDrawio } from '../../../domain/flowchart/drawio.ts';
import { graphToSegments } from '../../../domain/flowchart/graph.ts';
import { readFlowchart, readingToGraph } from '../../../domain/flowchart/vision.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
function pickKey(jsonVar: string, legacyVar: string): string {
  try { const p = JSON.parse(env(jsonVar) || '{}'); if (typeof p.default === 'string' && p.default) return p.default; } catch { /* legacy */ }
  return env(legacyVar);
}
const PUBLISHABLE_KEY = pickKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const SECRET_KEY = pickKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const MODEL = env('OPENAI_EXTRACT_MODEL') || env('OPENAI_MODEL') || 'gpt-5.5';
const EFFORT = env('OPENAI_REASONING_EFFORT') || 'low';
const SELF = `${SUPABASE_URL}/functions/v1/journey-extract`;
const REPO_RAW = 'https://raw.githubusercontent.com/APReddy-AutoBotz/AvalaOS-Enterprise';

const CORS = {
  'Access-Control-Allow-Origin': env('ALLOWED_ORIGIN') || '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => reply(status, { ok: false, error: { code, message } });

const service = (extra: Record<string, string> = {}): Record<string, string> => ({
  apikey: SECRET_KEY, 'Content-Type': 'application/json', ...(SECRET_KEY.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${SECRET_KEY}` }), ...extra,
});
async function rest(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...service(), ...(init.headers as Record<string, string> ?? {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`database ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, '0')).join('');

// ---- AI calls -------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function callOpenAI(body: Record<string, unknown>) {
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    // Edge functions are stopped at 150 s; stop the call first so the run can be marked failed.
    const timer = setTimeout(() => ctl.abort(), 115_000);
    try {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', signal: ctl.signal, body: JSON.stringify(body),
        headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'Content-Type': 'application/json' },
      });
      if (isRetryableStatus(res.status) && attempt < 3) { await res.body?.cancel(); await sleep(attempt * 2000); continue; }
      const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      if (!res.ok && !json?.error) json.error = { message: `HTTP ${res.status}` };
      const parsed = parseOpenAIResponse(json);
      if (!parsed.ok && parsed.code === 'INVALID_OUTPUT' && attempt < 2) continue;
      return parsed;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('TIMEOUT: the AI provider took longer than this stage allows');
      if (attempt < 2) { await sleep(2000); continue; }
      throw new Error(`AI provider unreachable: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function runTask(task: TaskDefinition, input: { segments: ReturnType<typeof toGatewaySegments> } | { listing: string } | { image: string }) {
  const body = 'segments' in input ? buildOpenAIRequest(task, input.segments, MODEL)
    : 'image' in input ? buildImageRequest(task, input.image, MODEL)
      : buildListingRequest(task, input.listing, MODEL);
  if (/^(gpt-5|o\d)/.test(MODEL)) body.reasoning = { effort: task.reasoningEffort ?? EFFORT };
  const parsed = await callOpenAI(body);
  if (!parsed.ok) throw new Error(`${task.id}: ${parsed.code} ${parsed.message}`);
  return { data: parsed.data, usage: parsed.usage };
}

// ---- runs -----------------------------------------------------------------------------------

interface SourceInput { sourceId: string; title: string; kind: string; segments: IngestSegment[]; inferred?: boolean }
interface Run {
  id: string; kind: 'process' | 'eval'; status: string; token_hash: string; source_ids: string[];
  input: { processName?: string; sources?: SourceInput[] }; case_id: string | null; ref: string | null;
  workspace_id: string | null; created_by: string | null;
}

async function loadRun(id: string, token: string): Promise<Run | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof token !== 'string' || token.length < 32) return null;
  const rows = await rest(`extraction_runs?id=eq.${id}&select=id,kind,status,token_hash,source_ids,input,case_id,ref,workspace_id,created_by`);
  const run: Run | undefined = rows?.[0];
  if (!run) return null;
  const hash = await sha256hex(token);
  if (hash.length !== run.token_hash.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ run.token_hash.charCodeAt(i);
  return diff === 0 ? run : null;
}
const patchRun = (id: string, fields: Record<string, unknown>) => rest(`extraction_runs?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(fields) });
const putPart = (id: string, part: string, output: unknown, usage: { input: number; output: number }): Promise<string | null> =>
  rest('rpc/extraction_put_part', { method: 'POST', body: JSON.stringify({ target_run: id, part_name: part, part_output: output, used_input: usage.input, used_output: usage.output }) });

async function logUsage(run: Run, task: string, usage: { input: number; output: number }, ok: boolean, error?: string) {
  if (run.kind !== 'process' || !run.workspace_id) return;
  await rest('ai_usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    workspace_id: run.workspace_id, user_id: run.created_by, task, model: MODEL, status: ok ? 'ok' : 'provider_error',
    input_tokens: usage.input, output_tokens: usage.output, attempts: 1, error_code: ok ? null : (error ?? '').slice(0, 60),
  }) }).catch(e => console.error('usage log failed', e));
}

/** Starts a stage: another invocation of this function. Only the call is awaited, not the work. */
async function trigger(body: Record<string, unknown>) {
  const res = await fetch(SELF, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await res.body?.cancel();
  if (res.status !== 202) throw new Error(`could not start stage ${String(body.action)} (${res.status})`);
}

/**
 * Runs a stage after the response. A stage that timed out is started once more in a fresh
 * invocation (the provider is sometimes slow under load); any other failure fails the run.
 */
function inBackground(work: () => Promise<void>, runId: string, retry?: Record<string, unknown>) {
  const p = work().catch(async e => {
    const message = String((e as Error).message ?? e);
    console.error('stage failed', runId, message);
    if (retry && message.startsWith('TIMEOUT') && !retry.retried) {
      try { await trigger({ ...retry, retried: true }); return; } catch { /* fall through and fail the run */ }
    }
    await patchRun(runId, { status: 'failed', error: message.slice(0, 1000) }).catch(() => {});
  });
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

const stageBody = (run: Run, token: string, extra: Record<string, unknown>) => ({ runId: run.id, token, ...extra });
async function startPasses(run: Run, token: string, sourceIds: string[]) {
  await Promise.all(sourceIds.flatMap(sourceId => ['facts', 'steps'].map(pass => trigger({ action: 'pass', ...stageBody(run, token, { sourceId, pass }) }))));
}

// ---- eval cases -----------------------------------------------------------------------------

interface EvalCase { dir?: string; processName: string; sources: { sourceId: string; file: string; title: string; kind: string }[] }
const AP_CALLS_AND_SOP = [
      { sourceId: 'call-1', file: 'sources/01-discovery-call-2026-10-06.vtt', title: 'Discovery call, 6 October 2026', kind: 'meeting transcript' },
      { sourceId: 'call-2', file: 'sources/02-exceptions-deep-dive-2026-10-09.srt', title: 'Exceptions deep dive, 9 October 2026', kind: 'meeting transcript' },
      { sourceId: 'call-3', file: 'sources/03-sap-integration-call-2026-10-14.txt', title: 'SAP and integration review, 14 October 2026', kind: 'meeting transcript' },
      { sourceId: 'sop', file: 'sources/04-SOP-FIN-AP-004-vendor-invoice-processing.docx', title: 'SOP FIN-AP-004 Vendor invoice processing', kind: 'standard operating procedure' },
];
const CASES: Record<string, EvalCase> = {
  'ap-invoice': {
    processName: 'Vendor invoice processing',
    sources: [...AP_CALLS_AND_SOP, { sourceId: 'flow', file: 'sources/05-AP-Invoice-AsIs.drawio', title: 'As-Is flowchart (Appendix A)', kind: 'flowchart' }],
  },
  // The same case with the flowchart as an image instead of a draw.io file.
  'ap-invoice-image': {
    dir: 'ap-invoice',
    processName: 'Vendor invoice processing',
    sources: [...AP_CALLS_AND_SOP, { sourceId: 'flow', file: 'sources/06-AP-Invoice-AsIs.png', title: 'As-Is flowchart (Appendix A), image', kind: 'flowchart image' }],
  },
  'ap-invoice-no-flow': {
    dir: 'ap-invoice',
    processName: 'Vendor invoice processing',
    sources: AP_CALLS_AND_SOP,
  },
};
const corpusUrl = (run: Run, file: string) => `${REPO_RAW}/${run.ref}/eval/corpus/${CASES[run.case_id ?? '']?.dir ?? run.case_id}/${file}`;

/** The eval corpus formats; for 'create' the browser parses the files (and reads images through journey-ai). */
async function parseCorpusFile(file: string, bytes: Uint8Array, sourceId: string): Promise<IngestSegment[]> {
  if (file.endsWith('.docx')) return parseDocx(bytes, sourceId);
  if (file.endsWith('.drawio')) return graphToSegments(await parseDrawio(new TextDecoder().decode(bytes)), sourceId);
  if (file.endsWith('.png')) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await runTask(readFlowchart, { image: `data:image/png;base64,${btoa(bin)}` });
    return graphToSegments(readingToGraph(r.data), sourceId);
  }
  const text = new TextDecoder().decode(bytes);
  if (file.endsWith('.vtt')) return parseVtt(text, sourceId);
  if (file.endsWith('.srt')) return parseSrt(text, sourceId);
  return looksLikeTranscript(text) ? parseTranscriptText(text, sourceId) : parsePlainText(text, sourceId, file.endsWith('.md'));
}

async function loadEvalInput(run: Run) {
  const c = CASES[run.case_id ?? ''];
  if (!c || !/^[0-9a-f]{7,40}$|^main$/.test(run.ref ?? '')) throw new Error('unknown eval case or ref');
  const sources: SourceInput[] = [];
  for (const s of c.sources) {
    const res = await fetch(corpusUrl(run, s.file));
    if (!res.ok) throw new Error(`could not fetch ${s.file} (${res.status})`);
    const segments = await parseCorpusFile(s.file, new Uint8Array(await res.arrayBuffer()), s.sourceId);
    if (!segments.length) throw new Error(`${s.file}: no text`);
    sources.push({ sourceId: s.sourceId, title: s.title, kind: s.kind, segments, ...(s.file.endsWith('.png') ? { inferred: true } : {}) });
  }
  return { processName: c.processName, sources };
}

// ---- stages ---------------------------------------------------------------------------------

async function stageStart(run: Run, token: string) {
  if (run.status !== 'queued') return;
  const input = run.kind === 'eval' ? await loadEvalInput(run) : run.input;
  const sourceIds = (input.sources ?? []).map(s => s.sourceId);
  if (!sourceIds.length) throw new Error('no sources');
  await patchRun(run.id, { input, source_ids: sourceIds, status: 'running' });
  await startPasses(run, token, sourceIds);
}

async function stagePass(run: Run, token: string, sourceId: string, pass: 'facts' | 'steps') {
  const source = run.input.sources?.find(s => s.sourceId === sourceId);
  if (!source) throw new Error(`unknown source ${sourceId}`);
  const task = pass === 'facts' ? sourceFacts : sourceSteps;
  const segments = toGatewaySegments(source.segments);
  try {
    const r = await runTask(task, { segments });
    const v = verifyExcerpts(r.data, task.verifyArrays, segments);
    await logUsage(run, task.id, r.usage, true);
    const next = await putPart(run.id, `pass:${pass}:${sourceId}`, { data: v.data, dropped: v.dropped }, r.usage);
    if (next === 'merge') await Promise.all(['flow', 'facts'].map(which => trigger({ action: 'merge', ...stageBody(run, token, { which }) })));
  } catch (e) {
    await logUsage(run, task.id, { input: 0, output: 0 }, false, (e as Error).message);
    throw e;
  }
}

async function candidatesOf(run: Run) {
  const parts: { part: string; output: any }[] = await rest(`extraction_run_parts?run_id=eq.${run.id}&select=part,output`);
  const sources = run.input.sources ?? [];
  const outputs: SourcePassOutput[] = sources.map(s => ({
    sourceId: s.sourceId,
    facts: parts.find(p => p.part === `pass:facts:${s.sourceId}`)?.output.data,
    steps: parts.find(p => p.part === `pass:steps:${s.sourceId}`)?.output.data,
  }));
  const dropped = parts.filter(p => p.part.startsWith('pass:')).flatMap(p => p.output.dropped ?? []);
  return { parts, set: buildCandidates(sources.map(({ segments: _s, ...info }) => info), outputs, sources.flatMap(s => s.segments)), dropped };
}

async function stageMerge(run: Run, token: string, which: 'flow' | 'facts') {
  const { set } = await candidatesOf(run);
  const task = which === 'flow' ? mergeFlow : mergeFacts;
  const r = await runTask(task, { listing: which === 'flow' ? flowListing(set) : factsListing(set) });
  await logUsage(run, task.id, r.usage, true);
  const next = await putPart(run.id, `merge:${which}`, r.data, r.usage);
  if (next === 'review') await trigger({ action: 'review', ...stageBody(run, token, {}) });
}

async function stageReview(run: Run, token: string) {
  const { parts, set } = await candidatesOf(run);
  const flow = parts.find(p => p.part === 'merge:flow')?.output;
  const r = await runTask(reviewFlow, { listing: reviewListing(flow, set) });
  await logUsage(run, reviewFlow.id, r.usage, true);
  const next = await putPart(run.id, 'review:flow', r.data, r.usage);
  if (next === 'assemble') await trigger({ action: 'assemble', ...stageBody(run, token, {}) });
}

async function stageAssemble(run: Run) {
  const { parts, set, dropped } = await candidatesOf(run);
  const flow = parts.find(p => p.part === 'merge:flow')?.output;
  const facts = parts.find(p => p.part === 'merge:facts')?.output;
  const review = parts.find(p => p.part === 'review:flow')?.output ?? null;
  const name = run.kind === 'eval' ? CASES[run.case_id!].processName : run.input.processName ?? 'Process';
  const { model, report } = finish(name, set, flow, facts, review);
  const result: Record<string, unknown> = { model, report: { ...report, droppedQuotes: dropped, candidates: set.items.length }, model_name: MODEL };
  if (run.kind === 'eval') {
    const gold = await (await fetch(corpusUrl(run, 'expected.model.json'))).json();
    const texts = Object.fromEntries((run.input.sources ?? []).map(s => [s.sourceId, s.segments.map(x => x.text).join('\n')]));
    result.score = score(gold, model, texts);
  }
  await patchRun(run.id, { status: 'done', result });
}

// ---- create (user) --------------------------------------------------------------------------

async function createRun(req: Request, body: any): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  const user = userRes.ok ? await userRes.json() : null;
  if (!user?.id) return fail(401, 'UNAUTHENTICATED', 'Sign in again.');
  const { workspaceId, processId, processName, sources } = body ?? {};
  if (typeof workspaceId !== 'string' || typeof processId !== 'string' || !Array.isArray(sources) || !sources.length || sources.length > 40) return fail(400, 'INVALID_REQUEST', 'workspaceId, processId and 1 to 40 sources are required.');
  // Editors only: RLS answers whether the caller can see the process; the role check is explicit.
  const proc = await fetch(`${SUPABASE_URL}/rest/v1/processes?id=eq.${processId}&workspace_id=eq.${workspaceId}&select=id`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  const member = await fetch(`${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&select=role`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  const procRows = proc.ok ? await proc.json() : [];
  const memberRows = member.ok ? await member.json() : [];
  if (procRows.length !== 1) return fail(404, 'NOT_FOUND', 'Process not found.');
  if (!['admin', 'editor'].includes(memberRows[0]?.role)) return fail(403, 'FORBIDDEN', 'Extraction needs the editor or admin role.');
  let total = 0;
  for (const s of sources) {
    if (typeof s?.sourceId !== 'string' || !/^[A-Za-z0-9._-]{1,24}$/.test(s.sourceId) || !Array.isArray(s.segments)) return fail(400, 'INVALID_REQUEST', 'Each source needs a sourceId and segments.');
    total += s.segments.reduce((n: number, x: any) => n + String(x?.text ?? '').length, 0);
  }
  if (total > LIMITS.maxTotalChars * 2) return fail(413, 'TOO_LARGE', 'The sources are too large for one extraction.');
  const used = Number(await rest('rpc/ai_tokens_used_this_month', { method: 'POST', body: JSON.stringify({ target_workspace: workspaceId }) }));
  if (used >= Number(env('AI_MONTHLY_TOKEN_BUDGET') || 2_000_000)) return fail(429, 'BUDGET_EXCEEDED', 'This workspace has used its AI allowance for the month.');

  const token = randomToken();
  const [row] = await rest('extraction_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    kind: 'process', workspace_id: workspaceId, process_id: processId, created_by: user.id, token_hash: await sha256hex(token),
    input: { processName: String(processName ?? ''), sources: sources.map((s: any) => ({ sourceId: s.sourceId, title: String(s.title ?? s.sourceId), kind: String(s.kind ?? ''), segments: s.segments, ...(s.inferred === true ? { inferred: true } : {}) })) },
  }) });
  await trigger({ action: 'start', runId: row.id, token });
  return reply(202, { ok: true, runId: row.id });
}

// ---- entry ----------------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (!SUPABASE_URL || !SECRET_KEY || !env('OPENAI_API_KEY')) return fail(500, 'NOT_CONFIGURED', 'The server is not configured.');
  const body = await req.json().catch(() => null);
  if (body?.action === 'create') return createRun(req, body);

  const run = await loadRun(String(body?.runId ?? ''), String(body?.token ?? ''));
  if (!run) return fail(404, 'NOT_FOUND', 'Unknown run.');
  const token = String(body.token);
  const again = { ...body };
  switch (body.action) {
    case 'start': inBackground(() => stageStart(run, token), run.id); break;
    case 'pass':
      if (!['facts', 'steps'].includes(body.pass)) return fail(400, 'INVALID_REQUEST', 'pass is facts or steps.');
      inBackground(() => stagePass(run, token, String(body.sourceId), body.pass), run.id, again); break;
    case 'merge':
      if (!['flow', 'facts'].includes(body.which)) return fail(400, 'INVALID_REQUEST', 'which is flow or facts.');
      inBackground(() => stageMerge(run, token, body.which), run.id, again); break;
    case 'review': inBackground(() => stageReview(run, token), run.id, again); break;
    case 'assemble': inBackground(() => stageAssemble(run), run.id); break;
    default: return fail(400, 'INVALID_REQUEST', 'Unknown action.');
  }
  return reply(202, { ok: true });
});
