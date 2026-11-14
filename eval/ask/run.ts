// Asks Ask Avala the question set on the sample case and prints the scorecard (eval/README.md).
//
//   node eval/ask/run.ts                       the set, and what each question is given; no AI is called
//   node eval/ask/run.ts --check               signs in to the server and reads the workspace's allowance; no AI is called
//   node eval/ask/run.ts --live [--runs 2]     asks every question through the live gateway and scores the answers
//   add --only A01,S03 (ids) or --only platform,score (kinds) to ask some questions, --json for machine-readable
//   output, --strict to exit 1 when a target fails
//
// A live run calls journey-ai exactly as the panel does (the registered task, the same facts), as a
// trusted server: ASK_EVAL_URL (https://<project-ref>.supabase.co), ASK_EVAL_KEY (the project's server
// key, from the environment only, never printed) and the workspace the AI use is counted against,
// ASK_EVAL_WORKSPACE (its id) or ASK_EVAL_WORKSPACE_NAME. The workspace's own AI provider is used when
// it has one, which is how the measure is run once for each provider.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenAIRequest } from '../../domain/ai/gateway.ts';
import { askProcess, askSegments, readAnswer, type Fact } from '../../domain/assistant/ask.ts';
import { askBoard } from '../../domain/assistant/board.ts';
import { askWorkspace } from '../../domain/assistant/workspace.ts';
import type { RecordedAnswer } from '../../domain/assistant/recorded.ts';
import { STARTERS } from '../../journey/process/askSubjects.ts';
import { answerFromNotes, type NoteFinding } from '../../domain/questions/notes.ts';
import { interviewQueue, interviewSegments, readInterview } from '../../domain/questions/interview.ts';
import { triage } from '../../domain/questions/triage.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { judgeInterview, loadInterviewCases, type InterviewOutcome } from './interview.ts';
import { factsFor, loadQuestions, loadSample, plantedFor, type Sample } from './sample.ts';
import { holders, judge, KINDS, KIND_ORDER, renderScorecard, scorecard, ungrounded, type Outcome, type Question, type QuestionSet } from './scorer.ts';

const CONCURRENCY = 4;
const taskOf = (scope: Question['scope']) => (scope === 'board' ? askBoard : scope === 'workspace' ? askWorkspace : askProcess);
/**
 * About how many tokens the gateway sends for one question: the request it would build, at 3.4
 * characters a token (measured on the baseline run; ids and quoted names take more tokens than prose).
 */
function approxTokens(facts: Fact[], question: string, scope: Question['scope'] = 'process'): number {
  const body = buildOpenAIRequest(taskOf(scope), askSegments(question, facts), '');
  return Math.round((String(body.instructions).length + String(body.input).length + JSON.stringify(body.text).length) / 3.4);
}

interface Server { url: string; key: string; workspaceId: string }
const headers = (key: string): Record<string, string> =>
  // The newer server keys travel in "apikey" only; the older ones are also the bearer token.
  key.startsWith('sb_secret_') ? { apikey: key, 'Content-Type': 'application/json' } : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function gateway(server: Server, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${server.url}/functions/v1/journey-ai`, { method: 'POST', headers: headers(server.key), body: JSON.stringify({ workspaceId: server.workspaceId, ...body }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function connect(): Promise<Server> {
  const url = (process.env.ASK_EVAL_URL ?? '').replace(/\/+$/, '');
  const key = process.env.ASK_EVAL_KEY ?? '';
  // The project's own address, or a stand-in on this machine when trying the runner itself.
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$|^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('ASK_EVAL_URL must be the project address, https://<project-ref>.supabase.co.');
  if (!key) throw new Error('ASK_EVAL_KEY is not set, so the measure cannot sign in to the server.');
  let workspaceId = process.env.ASK_EVAL_WORKSPACE ?? '';
  const name = process.env.ASK_EVAL_WORKSPACE_NAME ?? '';
  if (!workspaceId) {
    if (!name) throw new Error('Name the workspace the AI use counts against: ASK_EVAL_WORKSPACE (its id) or ASK_EVAL_WORKSPACE_NAME.');
    // By name, whatever its capitals ("Avala Check" is "Avala check"); the pattern's own wildcards are then ruled out.
    const same = (a: string) => a.trim().toLowerCase() === name.trim().toLowerCase();
    const res = await fetch(`${url}/rest/v1/workspaces?select=id,name&name=ilike.${encodeURIComponent(name.trim())}`, { headers: headers(key) });
    if (!res.ok) throw new Error(`The server did not accept the sign-in (${res.status}).`);
    const rows = ((await res.json()) as { id: string; name: string }[]).filter(r => same(r.name));
    console.log('Signed in to the server.');
    if (rows.length === 0) throw new Error(`There is no workspace named "${name}" yet.`);
    if (rows.length > 1) throw new Error(`More than one workspace is named "${name}"; give its id in ASK_EVAL_WORKSPACE.`);
    workspaceId = rows[0].id;
  }
  return { url, key, workspaceId };
}

/** Which key the workspace's AI runs on and, on the platform's key, how much of the month's allowance is left. */
async function allowance(server: Server): Promise<{ source: string; provider: string; budget: number | null; used: number | null }> {
  const r = await gateway(server, { action: 'allowance' });
  if (r.status !== 200 || !r.json?.ok) throw new Error(`The AI gateway did not answer (${r.status}${r.json?.error?.code ? ` ${r.json.error.code}` : ''}).`);
  return r.json;
}
const keyWords = (a: { source: string; provider: string }) => (a.source === 'workspace' ? `the workspace's own ${a.provider} key` : `the platform's ${a.provider} key`);

async function askOne(server: Server, q: Question, sample: Sample, set: QuestionSet, run: number): Promise<{ outcome: Outcome; model?: string }> {
  const { question, facts } = factsFor(q, sample, set);
  const base = { id: q.id, kind: q.kind, scope: q.scope ?? 'process' as const, question: q.question, run, tokens: { input: 0, output: 0 }, dropped: 0, ungrounded: [] as string[] };
  const offered = q.kind === 'answered' || q.kind === 'partial' || q.kind === 'platform' ? holders(q, facts).length > 0 : undefined;
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await gateway(server, { action: 'run', task: taskOf(q.scope).id, segments: askSegments(question, facts) });
      if (r.status === 200 && r.json?.ok) {
        const answer = readAnswer(r.json.data, facts);
        const verdict = judge(q, facts, answer, plantedFor(q, set));
        return {
          model: r.json.model,
          outcome: { ...base, offered, answer, ...verdict, tokens: { input: Number(r.json.usage?.input ?? 0), output: Number(r.json.usage?.output ?? 0), cached: Number(r.json.usage?.cached ?? 0) }, dropped: (r.json.dropped ?? []).length, ungrounded: ungrounded(question, facts, answer, sample.model) },
        };
      }
      last = `${r.status} ${r.json?.error?.code ?? ''}: ${String(r.json?.error?.message ?? 'no reply').slice(0, 200)}`;
      // Asking again cannot help when the allowance is used up or the request itself is refused.
      if (r.status === 429 || (r.status >= 400 && r.status < 500)) break;
    } catch (e) { last = `no connection (${(e as Error).name})`; }
  }
  return { outcome: { ...base, offered, error: last, pass: false, reasons: [] } };
}

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await work(items[i]);
  }));
  return out;
}

function describeSet(questions: Question[], sample: Sample, set: QuestionSet) {
  console.log(`Ask Avala measure on the sample case "${sample.processName}": ${questions.length} questions. No AI is called.\n`);
  let total = 0;
  for (const k of KIND_ORDER) {
    const of = questions.filter(q => q.kind === k);
    if (!of.length) continue;
    console.log(`${KINDS[k].label} (${of.length}): ${KINDS[k].must}; target ${KINDS[k].target === 1 ? 'every time' : `${Math.round(KINDS[k].target * 100)}% or more`}`);
    for (const q of of) {
      const { question, facts } = factsFor(q, sample, set);
      const tokens = approxTokens(facts, question);
      total += tokens;
      const held = q.kind === 'answered' || q.kind === 'partial' || q.kind === 'platform' ? (holders(q, facts).length ? '' : '  [the fact that holds the answer is not among the facts sent]') : '';
      console.log(`  ${q.id}  ${q.question}  (${facts.length} facts, about ${tokens.toLocaleString('en')} tokens)${held}`);
    }
  }
  console.log(`\nAbout ${total.toLocaleString('en')} tokens to read for one run, before the answers.`);
  return total;
}

/**
 * The demo's recorded answers: each scope's starter questions, asked once on the sample case, printed as
 * public/demo-data/ask-answers.json between markers (the sample company is made up, so the log may show it).
 */
async function record(server: Server, sample: Sample, set: QuestionSet, only?: string[]) {
  // --only takes ids (R-workspace-2) or scopes (workspace), to record again just those.
  const asks = (Object.entries(STARTERS) as [Question['scope'] & string, readonly string[]][])
    .flatMap(([scope, qs]) => qs.map((question, i) => ({ id: `R-${scope}-${i + 1}`, kind: 'answered' as const, scope, question })))
    .filter(q => !only?.length || only.includes(q.id) || only.includes(q.scope));
  const out: RecordedAnswer[] = [];
  for (const q of asks) {
    const { question, facts } = factsFor(q as Question, sample, set);
    const r = await gateway(server, { action: 'run', task: taskOf(q.scope).id, segments: askSegments(question, facts) });
    if (r.status !== 200 || !r.json?.ok) throw new Error(`${q.id} was not answered (${r.status} ${r.json?.error?.code ?? ''}). Nothing was recorded.`);
    const answer = readAnswer(r.json.data, facts);
    if (!answer.lead) throw new Error(`${q.id} has no direct answer first. Nothing was recorded; ask again.`);
    console.log(`${q.id}: ${answer.sentences.length} sentences, ${Number(r.json.usage?.input ?? 0) + Number(r.json.usage?.output ?? 0)} tokens.`);
    out.push({ task: taskOf(q.scope).id, question, reply: r.json.data });
  }
  console.log('BEGIN_ASK_ANSWERS');
  console.log(JSON.stringify(out, null, 2));
  console.log('END_ASK_ANSWERS');
}

/**
 * The interview's twenty answers (eval/ask/interview.json), each read with its one question through the
 * `answerFromNotes` task as the panel reads it, and judged by rule. The target: every case as expected,
 * and no answer offering a value the person did not give.
 */
async function interview(server: Server, sample: Sample, only?: string[]) {
  const items = interviewQueue(triage(sample.model, assessProcess(sample.model)));
  const cases = loadInterviewCases().filter(c => !only?.length || only.includes(c.id));
  const outcomes: InterviewOutcome[] = [];
  let tokens = 0;
  await pool(cases, CONCURRENCY, async c => {
    const item = items.find(i => i.key === c.key)!;
    const { segments, ids } = interviewSegments(sample.model, item, c.answer);
    const r = await gateway(server, { action: 'run', task: answerFromNotes.id, segments });
    if (r.status !== 200 || !r.json?.ok) { outcomes.push({ id: c.id, pass: false, reasons: [`${r.status} ${r.json?.error?.code ?? ''}`], kind: 'error', recorded: null, notStated: false }); return; }
    tokens += Number(r.json.usage?.input ?? 0) + Number(r.json.usage?.output ?? 0);
    const findings = ((r.json.data as { answers?: NoteFinding[] })?.answers ?? []);
    outcomes.push(judgeInterview(c, readInterview(sample.model, item, ids, findings, 1, c.answer)));
  });
  outcomes.sort((a, b) => a.id.localeCompare(b.id));
  const passed = outcomes.filter(o => o.pass).length, notStated = outcomes.filter(o => o.notStated).length;
  console.log(`Interview: ${passed} of ${outcomes.length} answers read as expected. Values offered that the person did not give (target: none): ${notStated ? outcomes.filter(o => o.notStated).map(o => o.id).join(', ') : 'none'}. Tokens: ${tokens.toLocaleString('en')} (${Math.round(tokens / Math.max(1, outcomes.length)).toLocaleString('en')} an answer).`);
  for (const o of outcomes) {
    const c = cases.find(x => x.id === o.id)!;
    console.log(`\n${o.id} ${o.pass ? 'passed' : 'NOT PASSED'} (${o.kind}${o.recorded ? `: "${o.recorded}"` : ''})\n  Answer: ${c.answer}${o.reasons.map(r => `\n  - ${r}`).join('')}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const set = loadQuestions();
  const sample = await loadSample();
  const only = value('--only')?.split(',').map(s => s.trim()).filter(Boolean);
  // --only takes question ids or kinds ("platform,score").
  const questions = only ? set.questions.filter(q => only.includes(q.id) || only.includes(q.kind)) : set.questions;
  if (!questions.length && !flag('--record')) throw new Error('No question matches --only.');

  if (!flag('--live') && !flag('--check') && !flag('--record') && !flag('--interview')) { describeSet(questions, sample, set); return; }

  const server = await connect();
  const before = await allowance(server);
  console.log(`The workspace's AI runs on ${keyWords(before)}.${before.budget ? ` This month ${Number(before.used ?? 0).toLocaleString('en')} of ${before.budget.toLocaleString('en')} tokens of its allowance are used.` : ''}`);
  if (flag('--check')) { console.log('Sign-in and workspace are in order. No AI was called.'); return; }
  if (flag('--interview')) { await interview(server, sample, value('--only')?.split(',').map(s => s.trim()).filter(Boolean)); return; }
  if (flag('--record')) { await record(server, sample, set, value('--only')?.split(',').map(s => s.trim()).filter(Boolean)); return; }

  const runs = Math.max(1, Math.min(5, Number(value('--runs') ?? 1) || 1));
  const estimate = questions.reduce((n, q) => { const f = factsFor(q, sample, set); return n + approxTokens(f.facts, f.question) + 400; }, 0) * runs;
  if (before.budget && before.used !== null && before.budget - before.used < estimate && !flag('--force')) {
    throw new Error(`This would need about ${estimate.toLocaleString('en')} tokens and the workspace has ${(before.budget - before.used).toLocaleString('en')} left this month. Nothing was asked.`);
  }

  const outcomes: Outcome[] = [];
  let model: string | undefined;
  for (let run = 1; run <= runs; run++) {
    const done = await pool(questions, CONCURRENCY, q => askOne(server, q, sample, set, run));
    for (const d of done) { outcomes.push(d.outcome); model ??= d.model; }
    console.log(`Run ${run}: ${done.filter(d => d.outcome.pass).length} of ${done.length} passed.`);
    if (done.some(d => d.outcome.error?.startsWith('429'))) { console.log('The allowance ran out; stopping here.'); break; }
  }
  const card = scorecard(outcomes);
  const text = renderScorecard(card, { model, key: keyWords(before) });
  if (flag('--json')) console.log(JSON.stringify({ model, key: before.source, provider: before.provider, card, outcomes }, null, 2));
  else {
    console.log(`\n${text}`);
    // Every answer, so the ones that passed can be read too: a rule can pass an answer a person would not.
    const group = !!process.env.GITHUB_ACTIONS;
    console.log(group ? '::group::Every answer' : '\nEvery answer:');
    for (const o of outcomes) {
      console.log(`\n${o.id}${card.runs > 1 ? ` (run ${o.run})` : ''} ${o.pass ? 'passed' : 'NOT PASSED'}: ${o.question}`);
      if (o.error) console.log(`  the request failed: ${o.error}`);
      for (const s of o.answer?.sentences ?? []) console.log(`  ${s.text} [${s.fact.id}]`);
      if (o.answer?.missing) console.log(`  Not in the record: ${o.answer.missing}`);
    }
    if (group) console.log('::endgroup::');
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) fs.appendFileSync(summary, `${text}\n`);
  const out = value('--out');
  if (out) fs.writeFileSync(out, JSON.stringify({ model, key: before.source, provider: before.provider, card, outcomes }, null, 2));
  if (flag('--strict') && !card.met) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(`The measure could not run: ${(e as Error).message}`); process.exitCode = 1; });
}
