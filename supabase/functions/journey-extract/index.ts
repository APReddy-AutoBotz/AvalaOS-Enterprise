// journey-extract: turns parsed sources into a Process Model, in stages (see the extraction_runs
// migration). Each request does one stage in the background and returns 202 at once; the stage
// starts the next one by calling this function again with the run's token.
//
// POST { action: 'create', workspaceId, processId, sourceIds: [process_sources.id] }
//      with the user's session -> { runId }. Members follow the run in extraction_runs.
// POST { action: 'start' | 'pass' | 'merge' | 'review' | 'assemble', runId, token, ... } -> internal stages.
//      The facts merge runs in parts (domain/extract/factsParts.ts): { action: 'merge', which: 'facts', part }.
// POST { action: 'look', runId } with the user's session (or the run's token) -> ends a run whose step was
//      stopped from outside (domain/extract/failure.ts, STALL_MS) with the step and a plain reason.
// POST { action: 'record-cutoff', runId, token } -> an extraction check run only: one tiny call cut off on
//      purpose, whose reply is kept as it came, for the tests (domain/ai/fixtures/).
//      An extraction check (an eval run) is made by the "Extraction check" workflow or in SQL, which needs
//      the project's secret key or database access, and started with { action: 'start', runId, token,
//      files }: the case's files, taken only when each matches the SHA-256 recorded in
//      eval/corpus/cases.ts. It scores the result against the gold sent and checked with them.
//
// Deployed with verify_jwt = false: 'create' checks the user's session; stages check the run token.

import { withCors } from '../../../domain/site/origins.ts';
import { buildImageRequest, buildListingRequest, buildOpenAIRequest, isRetryableStatus, missingListsMessage, verifyExcerpts, LIMITS, type TaskDefinition } from '../../../domain/ai/gateway.ts';
import { toGatewaySegments, type IngestSegment } from '../../../domain/ingest/segment.ts';
import { looksLikeTranscript, parsePlainText, parseSrt, parseTranscriptText, parseVtt } from '../../../domain/ingest/parsers/text.ts';
import { parseDocx } from '../../../domain/ingest/parsers/docx.ts';
import { buildCandidates, factsListing, flowListing, type SourcePassOutput } from '../../../domain/extract/candidates.ts';
import { FACTS_TASKS, mergeFlow, reviewFlow, sourceFacts, sourceSteps } from '../../../domain/extract/tasks.ts';
import { factsProgress, factsStartFor, isFactsPart, joinFacts, listingKinds, splitAfter, startParts, startsSmallerParts, type FactsStart } from '../../../domain/extract/factsParts.ts';
import {
  TaskError, classify, codeOf, isStalled, plainFailure, spentOn, stepOfRun, STALL_MS, type FailureCode, type ReadingStep,
} from '../../../domain/extract/failure.ts';
import { reviewListing } from '../../../domain/extract/review.ts';
import { finish } from '../../../domain/extract/pipeline.ts';
import { score } from '../../../eval/scorer.ts';
import { CASES, GOLD, checkCaseFiles } from '../../../eval/corpus/cases.ts';
import { parseDrawio } from '../../../domain/flowchart/drawio.ts';
import { graphToSegments } from '../../../domain/flowchart/graph.ts';
import { readFlowchart, readingToGraph } from '../../../domain/flowchart/vision.ts';
import { EndpointError, assertPublicHost } from '../../../domain/ai/compatible.ts';
import {
  decideConnection, isConnection, hostToCheck, parseProviderReply, providerRequest, takesReasoningEffort, taskNeed, unsupported, usesPlatformAllowance, validateAiChoice, type AiConnection,
} from '../../../domain/ai/providers.ts';

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

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
// The 150 s limit counts from when the worker started, and one worker can serve several stages.
const WORKER_STARTED = Date.now();
const callBudgetMs = () => Math.max(5_000, Math.min(115_000, WORKER_STARTED + 135_000 - Date.now()));
/**
 * The AI connection a run uses: the workspace's own key when it has one (never falling back to the
 * platform's), otherwise the platform key. An eval run uses the platform key, or the connection of the
 * workspace named on it (how a provider is evaluated before it is offered; eval runs are made in SQL).
 */
async function connectionFor(run: Pick<Run, 'workspace_id'> | null): Promise<AiConnection> {
  let own: Parameters<typeof decideConnection>[0] = null, saved = false;
  if (run?.workspace_id) {
    // A 404 means the lookup does not exist yet (database not migrated), so no workspace can have a key.
    const found = await rest('rpc/workspace_ai_connection', { method: 'POST', body: JSON.stringify({ target_workspace: run.workspace_id }) })
      .catch((e: Error) => { if (/^database 404/.test(e.message)) return null; throw e; });
    if (found) own = { ...validateAiChoice(found), apiKey: String(found.apiKey ?? '') };
    // Settings saved but no key to read: the workspace's own key has gone missing, and the run stops (F05).
    const rows = await rest(`workspace_ai_settings?workspace_id=eq.${run.workspace_id}&select=workspace_id`);
    saved = Array.isArray(rows) && rows.length > 0;
  }
  const decided = decideConnection(own, saved, { apiKey: env('OPENAI_API_KEY'), model: MODEL });
  if (!isConnection(decided)) throw new Error(`${decided.code}: ${decided.message}`);
  const c = decided;
  // An address an admin typed must resolve only to public addresses (see journey-ai), checked before each stage.
  const host = hostToCheck(c);
  if (host) {
    const resolve = Deno.resolveDns;
    if (!resolve) throw new EndpointError('ENDPOINT_NOT_ALLOWED: this server cannot check the endpoint\'s address');
    await assertPublicHost(host, (h, t) => resolve(h, t));
  }
  return c;
}

async function callProvider(conn: AiConnection, body: Record<string, unknown>) {
  // A Responses API body; providerRequest translates it for Anthropic (and refuses an input it cannot take).
  const target = providerRequest(conn, body);
  const payload = JSON.stringify(target.body);
  // The tokens of a reply that is tried again are counted with the next one (F03).
  let spent = { input: 0, output: 0 };
  for (let attempt = 1; ; attempt++) {
    const ctl = new AbortController();
    // Edge functions are stopped at 150 s; stop the call first so the stage can retry or fail cleanly.
    const timer = setTimeout(() => ctl.abort(), callBudgetMs());
    try {
      const res = await fetch(target.url, {
        method: 'POST', signal: ctl.signal, body: payload, headers: target.headers, redirect: 'error',
      });
      if (isRetryableStatus(res.status) && attempt < 3) { await res.body?.cancel(); await sleep(attempt * 2000); continue; }
      const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
      if (!res.ok && !json?.error) json.error = { message: typeof json?.message === 'string' ? json.message.slice(0, 300) : `HTTP ${res.status}` };
      const parsed = parseProviderReply(conn, json);
      const usage = { ...parsed.usage, input: parsed.usage.input + spent.input, output: parsed.usage.output + spent.output };
      if (!parsed.ok && parsed.code === 'INVALID_OUTPUT' && attempt < 2) { spent = { input: usage.input, output: usage.output }; continue; }
      return { ...parsed, usage } as typeof parsed;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new Error('TIMEOUT: the AI provider took longer than this stage allows');
      if (attempt < 2) { await sleep(2000); continue; }
      throw new Error(`AI provider unreachable: ${(e as Error).name}`);
    } finally {
      clearTimeout(timer);
    }
  }
}


async function runTask(conn: AiConnection, task: TaskDefinition, input: { segments: ReturnType<typeof toGatewaySegments> } | { listing: string } | { image: string }) {
  const off = unsupported(conn, 'image' in input ? 'vision' : taskNeed(task));
  if (off) throw new Error(`NOT_SUPPORTED: ${off}`);
  const model = conn.model;
  const body = 'segments' in input ? buildOpenAIRequest(task, input.segments, model)
    : 'image' in input ? buildImageRequest(task, input.image, model)
      : buildListingRequest(task, input.listing, model);
  if (takesReasoningEffort(model)) body.reasoning = { effort: task.reasoningEffort ?? EFFORT };
  const parsed = await callProvider(conn, body);
  if (!parsed.ok) throw new TaskError(`${task.id}: ${parsed.code} ${parsed.message}`, parsed.usage, parsed.code);
  return { data: parsed.data, usage: parsed.usage };
}

// ---- runs -----------------------------------------------------------------------------------

interface SourceInput { sourceId: string; title: string; kind: string; segments: IngestSegment[]; inferred?: boolean }
interface Run {
  id: string; kind: 'process' | 'eval'; status: string; token_hash: string; source_ids: string[];
  input: { processName?: string; sources?: SourceInput[]; gold?: unknown; factsStart?: FactsStart }; case_id: string | null; ref: string | null;
  workspace_id: string | null; created_by: string | null; updated_at: string;
}

async function loadRun(id: string, token: string): Promise<Run | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof token !== 'string' || token.length < 32) return null;
  const rows = await rest(`extraction_runs?id=eq.${id}&select=id,kind,status,token_hash,source_ids,input,case_id,ref,workspace_id,created_by,updated_at`);
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

const USAGE_STATUS: Partial<Record<FailureCode, string>> = { TRUNCATED: 'truncated', REFUSED: 'refused', INVALID_OUTPUT: 'invalid_output' };
async function logUsage(run: Run, conn: AiConnection, task: string, usage: { input: number; output: number }, ok: boolean, error?: string, code?: FailureCode) {
  if (!run.workspace_id) return;
  await rest('ai_usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    workspace_id: run.workspace_id, user_id: run.created_by, task, model: conn.model, provider: conn.provider, key_source: conn.source,
    status: ok ? 'ok' : (code && USAGE_STATUS[code]) ?? 'provider_error', input_tokens: usage.input, output_tokens: usage.output, attempts: 1, error_code: ok ? null : (error ?? '').slice(0, 60),
  }) }).catch(e => console.error('usage log failed', e));
  if (ok && conn.source === 'workspace') {
    await rest(`workspace_ai_settings?workspace_id=eq.${run.workspace_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) })
      .catch(e => console.error('last used update failed', e));
  }
}

/** One task's call, logged with its tokens whether it worked or not (F03). */
async function counted<T extends { usage: { input: number; output: number } }>(run: Run, conn: AiConnection, task: string, call: () => Promise<T>): Promise<T> {
  try {
    const r = await call();
    await logUsage(run, conn, task, r.usage, true);
    return r;
  } catch (e) {
    await logUsage(run, conn, task, spentOn(e), false, (e as Error).message, codeOf(e));
    throw e;
  }
}

/** Starts a stage: another invocation of this function. Only the call is awaited, not the work. */
async function trigger(body: Record<string, unknown>) {
  const res = await fetch(SELF, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await res.body?.cancel();
  if (res.status !== 202) throw new Error(`could not start stage ${String(body.action)} (${res.status})`);
}

/**
 * Runs a stage after the response. A stage that timed out is started once more in a fresh
 * invocation (the provider is sometimes slow under load); any other failure fails the run, with the
 * step and the reason in plain words (domain/extract/failure.ts).
 */
function inBackground(work: () => Promise<void>, runId: string, step: ReadingStep, stepKey: string, retry?: Record<string, unknown>) {
  const p = work().catch(async e => {
    const message = String((e as Error).message ?? e);
    console.error('stage failed', runId, message);
    if (retry && message.startsWith('TIMEOUT') && !retry.retried) {
      try { await trigger({ ...retry, retried: true }); return; } catch { /* fall through and fail the run */ }
    }
    await failRun(runId, step, stepKey, e, Boolean(retry?.retried));
  });
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

/**
 * Ends a run with the sentence a person sees. The technical text goes to the run's record and the log;
 * the failed call's tokens go to the run's totals through a part of their own, which moves no stage on.
 */
async function failRun(runId: string, step: ReadingStep, stepKey: string, e: unknown, twice: boolean) {
  const message = String((e as Error)?.message ?? e);
  const code = codeOf(e), { detail } = classify(message), usage = spentOn(e);
  await putPart(runId, `failed:${stepKey}`, { step: step.key, code, detail: message.slice(0, 1000), usage }, usage).catch(err => console.error('failure part', runId, err));
  await patchRun(runId, {
    status: 'failed', error: plainFailure(step, code, runId, detail, twice),
    result: { failure: { step: stepKey, code, detail: message.slice(0, 1000) } },
  }).catch(err => console.error('failure write', runId, err));
}

const stageBody = (run: Run, token: string, extra: Record<string, unknown>) => ({ runId: run.id, token, ...extra });
/** The merges, started together once every source is read: the flow, and the first parts of the facts. */
const startMerges = (run: Run, token: string) => Promise.all([
  trigger({ action: 'merge', ...stageBody(run, token, { which: 'flow' }) }),
  ...startParts(run.input.factsStart).map(part => trigger({ action: 'merge', ...stageBody(run, token, { which: 'facts', part }) })),
]);
async function startPasses(run: Run, token: string, sourceIds: string[]) {
  await Promise.all(sourceIds.flatMap(sourceId => ['facts', 'steps'].map(pass => trigger({ action: 'pass', ...stageBody(run, token, { sourceId, pass }) }))));
}

// ---- eval cases -----------------------------------------------------------------------------
// The cases, their files and the files' SHA-256 are in eval/corpus/cases.ts. Whoever starts a check sends
// the files with the start request; they are taken only when they are exactly the recorded files.

/** The eval corpus formats; for 'create' the browser parses the files (and reads images through journey-ai). */
async function parseCorpusFile(run: Run, file: string, bytes: Uint8Array, sourceId: string): Promise<IngestSegment[]> {
  if (file.endsWith('.docx')) return parseDocx(bytes, sourceId);
  if (file.endsWith('.drawio')) return graphToSegments(await parseDrawio(new TextDecoder().decode(bytes)), sourceId);
  if (file.endsWith('.png')) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const conn = await connectionFor(run);
    const r = await counted(run, conn, readFlowchart.id, () => runTask(conn, readFlowchart, { image: `data:image/png;base64,${btoa(bin)}` }));
    return graphToSegments(readingToGraph(r.data), sourceId);
  }
  const text = new TextDecoder().decode(bytes);
  if (file.endsWith('.vtt')) return parseVtt(text, sourceId);
  if (file.endsWith('.srt')) return parseSrt(text, sourceId);
  return looksLikeTranscript(text) ? parseTranscriptText(text, sourceId) : parsePlainText(text, sourceId, file.endsWith('.md'));
}

async function loadEvalInput(run: Run, files: Map<string, Uint8Array>) {
  const c = CASES[run.case_id ?? ''];
  const sources: SourceInput[] = [];
  for (const s of c.sources) {
    const segments = await parseCorpusFile(run, s.file, files.get(s.file)!, s.sourceId);
    if (!segments.length) throw new Error(`${s.file}: no text`);
    sources.push({ sourceId: s.sourceId, title: s.title, kind: s.kind, segments, ...(s.file.endsWith('.png') ? { inferred: true } : {}) });
  }
  // The gold is kept with the run, so the result is scored against the file that was checked.
  const gold = JSON.parse(new TextDecoder().decode(files.get(GOLD)!));
  return { processName: c.processName, sources, gold };
}

// ---- stages ---------------------------------------------------------------------------------

async function stageStart(run: Run, token: string, files: Map<string, Uint8Array> | null, factsStart: FactsStart) {
  if (run.status !== 'queued') return;
  const input = run.kind === 'eval' ? { ...(await loadEvalInput(run, files!)), ...(factsStart === 'kinds' ? { factsStart } : {}) } : run.input;
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
  const conn = await connectionFor(run);
  try {
    const r = await runTask(conn, task, { segments });
    const v = verifyExcerpts(r.data, task.verifyArrays, segments);
    // A reply lacking a list its task requires is refused, not stored unchecked (F16).
    if (v.missing.length) throw new TaskError(`${task.id}: INVALID_OUTPUT ${missingListsMessage(v.missing)}`, r.usage, 'INVALID_OUTPUT');
    await logUsage(run, conn, task.id, r.usage, true);
    const next = await putPart(run.id, `pass:${pass}:${sourceId}`, { data: v.data, dropped: v.dropped }, r.usage);
    if (next === 'merge') await startMerges(run, token);
  } catch (e) {
    await logUsage(run, conn, task.id, spentOn(e), false, (e as Error).message, codeOf(e));
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

async function stageMergeFlow(run: Run, token: string) {
  const { set } = await candidatesOf(run);
  const conn = await connectionFor(run);
  const r = await counted(run, conn, mergeFlow.id, () => runTask(conn, mergeFlow, { listing: flowListing(set) }));
  const next = await putPart(run.id, 'merge:flow', r.data, r.usage);
  if (next === 'review') await trigger({ action: 'review', ...stageBody(run, token, {}) });
}

/**
 * One part of the facts merge (domain/extract/factsParts.ts). Its answer is stored as `facts:<part>`
 * with its tokens and time. A cut-off answer, or a second time-out, is replaced by smaller parts: a note
 * `facts:<part>` records the split and the failed answer's tokens (so they are in the run's totals), and
 * the smaller parts start. When every part the merge needs is in, they are joined into `merge:facts`,
 * which moves the run on as the single answer did. The run's row is locked while a part is stored, so
 * the last part to arrive always sees the others; a second join is ignored by the database.
 */
async function stageFactsPart(run: Run, token: string, part: string, retried: boolean) {
  const { set } = await candidatesOf(run);
  const task = FACTS_TASKS[part];
  const conn = await connectionFor(run);
  const started = Date.now();
  try {
    const r = await counted(run, conn, task.id, () => runTask(conn, task, { listing: factsListing(set, listingKinds(part) ?? undefined) }));
    await putPart(run.id, `facts:${part}`, { data: r.data, usage: r.usage, ms: Date.now() - started }, r.usage);
  } catch (e) {
    const children = splitAfter(part, codeOf(e), retried);
    if (!children) throw e;
    const usage = spentOn(e);
    await putPart(run.id, `facts:${part}`, { splitInto: children, reason: codeOf(e), usage, ms: Date.now() - started }, usage);
    // A run that has failed meanwhile (another step) starts nothing more.
    const now: { status: string }[] = await rest(`extraction_runs?id=eq.${run.id}&select=status`);
    if (!startsSmallerParts(now?.[0]?.status)) return;
    await Promise.all(children.map(c => trigger({ action: 'merge', ...stageBody(run, token, { which: 'facts', part: c }) })));
    return;
  }
  await joinFactsWhenComplete(run, token);
}

async function joinFactsWhenComplete(run: Run, token: string) {
  const rows: { part: string; output: unknown }[] = await rest(`extraction_run_parts?run_id=eq.${run.id}&part=like.facts:*&select=part,output`);
  const stored = Object.fromEntries(rows.map(r => [r.part.slice('facts:'.length), r.output]));
  const progress = factsProgress(run.input.factsStart ?? 'pairs', stored);
  if (!progress.complete) return;
  const next = await putPart(run.id, 'merge:facts', joinFacts(progress.leaves, stored), { input: 0, output: 0 });
  if (next === 'review') await trigger({ action: 'review', ...stageBody(run, token, {}) });
}

async function stageReview(run: Run, token: string) {
  const { parts, set } = await candidatesOf(run);
  const flow = parts.find(p => p.part === 'merge:flow')?.output;
  const conn = await connectionFor(run);
  const r = await counted(run, conn, reviewFlow.id, () => runTask(conn, reviewFlow, { listing: reviewListing(flow, set) }));
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
    const gold = run.input.gold;
    if (!gold) throw new Error('the run has no gold to score against');
    const texts = Object.fromEntries((run.input.sources ?? []).map(s => [s.sourceId, s.segments.map(x => x.text).join('\n')]));
    result.score = score(gold as Parameters<typeof score>[0], model, texts);
  }
  await patchRun(run.id, { status: 'done', result });
}

// ---- create (user) --------------------------------------------------------------------------

async function createRun(req: Request, body: any): Promise<Response> {
  const auth = req.headers.get('Authorization') ?? '';
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  const user = userRes.ok ? await userRes.json() : null;
  if (!user?.id) return fail(401, 'UNAUTHENTICATED', 'Sign in again.');
  const { workspaceId, processId, sourceIds } = body ?? {};
  // Starting the facts merge one kind at a time is for the extraction check only.
  if (body?.startAtKinds !== undefined) {
    const refused = factsStartFor('process', body.startAtKinds);
    if ('refused' in refused) return fail(400, 'INVALID_REQUEST', refused.refused);
  }
  const UUID = /^[0-9a-f-]{36}$/i;
  if (typeof workspaceId !== 'string' || !UUID.test(workspaceId) || typeof processId !== 'string' || !UUID.test(processId)
    || !Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > 40 || !sourceIds.every((x: unknown) => typeof x === 'string' && UUID.test(x))) {
    return fail(400, 'INVALID_REQUEST', 'workspaceId, processId and 1 to 40 sourceIds are required.');
  }
  // Editors only: RLS answers whether the caller can see the process; the role check is explicit.
  const proc = await fetch(`${SUPABASE_URL}/rest/v1/processes?id=eq.${processId}&workspace_id=eq.${workspaceId}&select=id,name`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  const member = await fetch(`${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${user.id}&select=role`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
  const procRows = proc.ok ? await proc.json() : [];
  const memberRows = member.ok ? await member.json() : [];
  if (procRows.length !== 1) return fail(404, 'NOT_FOUND', 'Process not found.');
  if (!['admin', 'editor'].includes(memberRows[0]?.role)) return fail(403, 'FORBIDDEN', 'Extraction needs the editor or admin role.');
  // The sources are read here, so what is extracted is what was stored for this process.
  const rows: any[] = await rest(`process_sources?process_id=eq.${processId}&id=in.(${sourceIds.join(',')})&archived_at=is.null&select=source_key,title,kind,format,inferred,segments`);
  if (!Array.isArray(rows) || rows.length !== new Set(sourceIds).size) return fail(404, 'SOURCE_NOT_FOUND', 'A source was not found for this process.');
  const sources = rows.map(r => ({ sourceId: r.source_key, title: r.title, kind: r.kind || r.format, segments: r.segments, ...(r.inferred ? { inferred: true } : {}) }));
  const total = sources.reduce((n, s) => n + s.segments.reduce((k: number, x: any) => k + String(x?.text ?? '').length, 0), 0);
  if (total > LIMITS.maxTotalChars * 2) return fail(413, 'TOO_LARGE', 'The sources are too large for one extraction.');
  const processName = String(procRows[0].name ?? '');
  // The monthly allowance applies only to the platform key; a workspace on its own key is not held back by it.
  let conn: AiConnection;
  try { conn = await connectionFor({ workspace_id: workspaceId }); } catch (e) {
    // A reason of ours (no key, the workspace's key gone, an address not allowed) is said as it is; anything
    // else, such as a database error, goes to the log and the caller gets a plain message (item 7).
    const message = (e as Error).message;
    if (e instanceof EndpointError) return fail(422, 'ENDPOINT_NOT_ALLOWED', message.replace(/^ENDPOINT_NOT_ALLOWED: /, ''));
    const known = /^(NOT_CONFIGURED|WORKSPACE_KEY_MISSING): /.exec(message);
    if (!known) console.error('connection failed', message);
    return fail(known?.[1] === 'WORKSPACE_KEY_MISSING' ? 409 : 422, known?.[1] ?? 'AI_NOT_AVAILABLE', known ? message.slice(known[0].length) : 'The AI provider could not be prepared just now. Try again in a minute.');
  }
  if (usesPlatformAllowance(conn)) {
    const used = Number(await rest('rpc/ai_tokens_used_this_month', { method: 'POST', body: JSON.stringify({ target_workspace: workspaceId }) }));
    if (used >= Number(env('AI_MONTHLY_TOKEN_BUDGET') || 2_000_000)) return fail(429, 'BUDGET_EXCEEDED', 'This workspace has used its AI allowance for the month.');
  }

  const token = randomToken();
  const [row] = await rest('extraction_runs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({
    kind: 'process', workspace_id: workspaceId, process_id: processId, created_by: user.id, token_hash: await sha256hex(token),
    input: { processName, sources },
  }) });
  await trigger({ action: 'start', runId: row.id, token });
  return reply(202, { ok: true, runId: row.id });
}

// ---- a run whose step was stopped from outside -----------------------------------------------

/**
 * The next look at a run (the Sources screen, the extraction check): a run that has not changed for
 * longer than any step can take was stopped by the platform mid-step, so it is ended here with the step
 * it was in and a plain reason. A member of the run's workspace may look, or the holder of its token.
 * The write is conditional on the run being as it was read, so a run that moved on meanwhile is left.
 */
async function lookAtRun(req: Request, body: any): Promise<Response> {
  const runId = String(body?.runId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return fail(400, 'INVALID_REQUEST', 'runId is required.');
  let run: Pick<Run, 'id' | 'status' | 'updated_at' | 'workspace_id'> | null = null;
  if (typeof body.token === 'string') run = await loadRun(runId, body.token);
  else {
    const auth = req.headers.get('Authorization') ?? '';
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
    const user = userRes.ok ? await userRes.json() : null;
    if (!user?.id) return fail(401, 'UNAUTHENTICATED', 'Sign in again.');
    const rows = await rest(`extraction_runs?id=eq.${runId}&select=id,status,updated_at,workspace_id`);
    const found = rows?.[0];
    if (found?.workspace_id) {
      const member = await fetch(`${SUPABASE_URL}/rest/v1/workspace_members?workspace_id=eq.${found.workspace_id}&user_id=eq.${user.id}&select=role`, { headers: { apikey: PUBLISHABLE_KEY, Authorization: auth } });
      const memberRows = member.ok ? await member.json() : [];
      if (Array.isArray(memberRows) && memberRows.length) run = found;
    }
  }
  if (!run) return fail(404, 'NOT_FOUND', 'Unknown run.');
  if (!isStalled(run.status, run.updated_at, Date.now())) return reply(200, { ok: true, stalled: false });
  const parts: { part: string }[] = await rest(`extraction_run_parts?run_id=eq.${run.id}&select=part`);
  const step = stepOfRun(run.status, parts.map(p => p.part));
  const detail = `stopped from outside: no change for more than ${STALL_MS / 60_000} minutes while ${run.status}`;
  console.error('stage stalled', run.id, run.status, run.updated_at);
  await rest(`extraction_runs?id=eq.${run.id}&status=eq.${run.status}&updated_at=eq.${encodeURIComponent(run.updated_at)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'failed', error: plainFailure(step, 'STOPPED', run.id), result: { failure: { step: step.key, code: 'STOPPED', detail } } }),
  });
  return reply(200, { ok: true, stalled: true });
}

/**
 * An extraction check run only: one call on the run's connection with a reply limit far too small for
 * the answer, so the provider cuts it off; the reply is kept in the run's result exactly as it came, to
 * be copied into the tests (domain/ai/fixtures/). Sample text only; well under 1,000 tokens.
 */
async function recordCutoff(run: Run) {
  const conn = await connectionFor(run);
  const task: TaskDefinition = {
    id: 'record_cutoff', schemaName: 'record_cutoff', maxOutputTokens: 16, verifyArrays: [],
    instructions: 'Write the passage back in full, word for word.',
    schema: { type: 'object', additionalProperties: false, required: ['passage'], properties: { passage: { type: 'string' } } },
  };
  const listing = 'The AP Clerk logs each invoice in the AP tracker, checks SAP for duplicates, matches it with the purchase order and the goods receipt, and sends any invoice over the tolerance to the approver named in the delegation of authority.';
  const body = buildListingRequest(task, listing, conn.model);
  if (takesReasoningEffort(conn.model)) body.reasoning = { effort: 'low' };
  const target = providerRequest(conn, body);
  const res = await fetch(target.url, { method: 'POST', body: JSON.stringify(target.body), headers: target.headers, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  const parsed = parseProviderReply(conn, json);
  await logUsage(run, conn, task.id, parsed.usage, parsed.ok, parsed.ok ? undefined : parsed.message, parsed.ok ? undefined : parsed.code);
  await patchRun(run.id, {
    status: 'done', input_tokens: parsed.usage.input, output_tokens: parsed.usage.output,
    result: { recorded: { provider: conn.provider, model: conn.model, httpStatus: res.status, reply: json, read: parsed.ok ? 'ok' : parsed.code } },
  });
}

// ---- entry ----------------------------------------------------------------------------------

// Cross-site headers on every answer, for the allowed websites only (domain/site/origins.ts).
Deno.serve(withCors(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  // The platform key is not needed here: a workspace on its own key extracts without it (F04); a run that
  // needs the platform key and finds none stops with NOT_CONFIGURED when its connection is decided.
  if (!SUPABASE_URL || !SECRET_KEY) return fail(500, 'NOT_CONFIGURED', 'The server is not configured.');
  const body = await req.json().catch(() => null);
  if (body?.action === 'create') return createRun(req, body);
  if (body?.action === 'look') return lookAtRun(req, body);
  const run = await loadRun(String(body?.runId ?? ''), String(body?.token ?? ''));
  if (!run) return fail(404, 'NOT_FOUND', 'Unknown run.');
  const token = String(body.token);
  const again = { ...body };
  const sourceTitle = (id: string) => run.input.sources?.find(x => x.sourceId === id)?.title ?? id;
  switch (body.action) {
    case 'start': {
      // An extraction check (an eval run, made only by someone with the project's secret key or database
      // access) reads the files sent with its start, and only before it has started; see eval/corpus/cases.ts.
      const start = factsStartFor(run.kind, body.startAtKinds);
      if ('refused' in start) return fail(400, 'INVALID_REQUEST', start.refused);
      let files: Map<string, Uint8Array> | null = null;
      if (run.kind === 'eval') {
        if (run.status !== 'queued') return fail(409, 'ALREADY_STARTED', 'This check has already started.');
        const checked = await checkCaseFiles(run.case_id ?? '', body.files);
        if ('message' in checked) return fail(400, 'INVALID_FILES', checked.message);
        files = checked.files;
      }
      inBackground(() => stageStart(run, token, files, start.start), run.id, { key: 'start' }, 'start'); break;
    }
    case 'record-cutoff':
      if (run.kind !== 'eval' || run.status !== 'queued') return fail(409, 'NOT_A_NEW_CHECK', 'Only a new extraction check run can record a cut-off reply.');
      inBackground(() => recordCutoff(run), run.id, { key: 'start' }, 'record-cutoff'); break;
    case 'pass':
      if (!['facts', 'steps'].includes(body.pass)) return fail(400, 'INVALID_REQUEST', 'pass is facts or steps.');
      inBackground(() => stagePass(run, token, String(body.sourceId), body.pass), run.id,
        { key: 'pass', title: sourceTitle(String(body.sourceId)) }, `pass-${body.pass}-${String(body.sourceId).slice(0, 60)}`, again); break;
    case 'merge':
      if (body.which === 'flow') { inBackground(() => stageMergeFlow(run, token), run.id, { key: 'merge-flow' }, 'merge-flow', again); break; }
      if (body.which !== 'facts' || !isFactsPart(body.part)) return fail(400, 'INVALID_REQUEST', 'which is flow, or facts with a part of the facts merge.');
      inBackground(() => stageFactsPart(run, token, body.part, Boolean(body.retried)), run.id, { key: 'merge-facts' }, `facts-${body.part}`, again); break;
    case 'review': inBackground(() => stageReview(run, token), run.id, { key: 'review' }, 'review', again); break;
    case 'assemble': inBackground(() => stageAssemble(run), run.id, { key: 'assemble' }, 'assemble'); break;
    default: return fail(400, 'INVALID_REQUEST', 'Unknown action.');
  }
  return reply(202, { ok: true });
}, env('ALLOWED_ORIGIN')));
