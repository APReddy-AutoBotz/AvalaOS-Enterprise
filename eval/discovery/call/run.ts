// Runs the call replay (eval/discovery/call/replay.ts, eval/README.md "The call replay").
//
//   node eval/discovery/call/run.ts                    the calls and their windows, counts only; no AI is called
//   node eval/discovery/call/run.ts --check            signs in to the server and reads the workspace's allowance; no AI is called
//   node eval/discovery/call/run.ts --live --set dry   the two made-up sets of notes (set M, the dry run)
//   node eval/discovery/call/run.ts --live --set a     those, the made-up transcripts D1 and D2 as notes, and the sample's three calls
//   node eval/discovery/call/run.ts --live --set b     the two transcripts of the process "Project time writing", read at run time
//   node eval/discovery/call/run.ts --live --set all   every set: the counting run
//
// A live run calls journey-ai as a trusted server, as the discovery replay does (REPLAY_URL, REPLAY_KEY from the
// environment only, never printed, and REPLAY_WORKSPACE_NAME, the workspace the AI use is counted against). It prints
// numbers only: never a passage, a note, a question, a quote or a value. On set M it also prints which of the
// hand-written answers matched, by their keys only: the notes and their keys are made up. Set B keeps every guard of
// the discovery replay (setBCases, setBAllowed): only on the platform's key, counted first by ids, held in memory,
// never stored, logged or printed. The connection is the discovery replay's, repeated here so its file is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Segment } from '../../../domain/ai/gateway.ts';
import type { ProcessModel } from '../../../domain/processModel/types.ts';
import { emptyModel } from '../../../domain/processModel/empty.ts';
import { parseFile } from '../../../domain/ingest/parsers/index.ts';
import type { Attendee } from '../../../domain/meeting/kept.ts';
import { fromSegments, readTranscript, ReplayStop, SET_B_NOT_ON_PLATFORM, setBAllowed, setBCases, windows, type Ask } from '../replay.ts';
import { DRAFTS } from './drafts.ts';
import { matchedKeys, renderCallScorecard, replayCall, scoreCalls, type CallAnswers, type CallCase, type CallCaseResult } from './replay.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
type AnswersFile = { cases: (CallAnswers & { file: string; draft: string; process: string; attendees: Attendee[] })[] };
const answers = (JSON.parse(fs.readFileSync(path.join(here, 'answers.json'), 'utf8')) as AnswersFile).cases;
const transcripts = (JSON.parse(fs.readFileSync(path.join(here, '../answers.json'), 'utf8')) as { cases: { id: string; file: string; process: string }[] }).cases;
const SAMPLE = ['01-discovery-call-2026-10-06.vtt', '02-exceptions-deep-dive-2026-10-09.srt', '03-sap-integration-call-2026-10-14.txt'];
const gold = (): ProcessModel => JSON.parse(fs.readFileSync(path.join(root, 'eval/corpus/ap-invoice/expected.model.json'), 'utf8'));

/** Set M: the made-up notes, each with its made-up draft. */
const setM = (): CallCase[] => answers.map(a => ({ id: a.id, process: a.process, model: DRAFTS[a.draft]!(), attendees: a.attendees, passages: readTranscript(fs.readFileSync(path.join(here, a.file), 'utf8')) }));

/** Set A: the made-up transcripts D1 and D2 as if every word were noted, with the same drafts; the sample's three calls with its hand-checked model. */
async function setA(): Promise<CallCase[]> {
  const out: CallCase[] = transcripts.map(t => ({ id: `A-${t.id}`, process: t.process, model: DRAFTS[t.id]!(), attendees: [{ kind: 'business' }], passages: readTranscript(fs.readFileSync(path.join(here, '..', t.file), 'utf8')) }));
  for (const [i, name] of SAMPLE.entries()) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(root, 'eval/corpus/ap-invoice/sources', name)));
    const r = await parseFile({ name, bytes, sourceId: `call-${i + 1}` });
    if (r.status !== 'ok') throw new Error(`The sample's call ${i + 1} could not be read.`);
    out.push({ id: `A${i + 1}`, process: 'Vendor invoice processing', model: gold(), attendees: [{ kind: 'business' }, { kind: 'it' }, { kind: 'finance' }], passages: fromSegments(r.segments) });
  }
  return out;
}

interface Server { url: string; key: string; workspaceId: string }
const headers = (key: string): Record<string, string> =>
  key.startsWith('sb_secret_') ? { apikey: key, 'Content-Type': 'application/json' } : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

async function connect(): Promise<Server> {
  const url = (process.env.REPLAY_URL ?? '').replace(/\/+$/, '');
  const key = process.env.REPLAY_KEY ?? '';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) throw new ReplayStop('REPLAY_URL must be the project address, https://<project-ref>.supabase.co.');
  if (!key) throw new ReplayStop('REPLAY_KEY is not set, so the replay cannot sign in to the server.');
  const name = (process.env.REPLAY_WORKSPACE_NAME ?? '').trim();
  if (!name) throw new ReplayStop('Name the workspace the AI use counts against: REPLAY_WORKSPACE_NAME.');
  const res = await fetch(`${url}/rest/v1/workspaces?select=id,name&name=ilike.${encodeURIComponent(name)}`, { headers: headers(key) });
  if (!res.ok) throw new ReplayStop(`The server did not accept the sign-in (${res.status}).`);
  const rows = ((await res.json()) as { id: string; name: string }[]).filter(r => r.name.trim().toLowerCase() === name.toLowerCase());
  if (rows.length !== 1) throw new ReplayStop(rows.length ? 'More than one workspace has the name given.' : 'There is no workspace with the name given.');
  return { url, key, workspaceId: rows[0]!.id };
}

async function gateway(server: Server, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  const res = await fetch(`${server.url}/functions/v1/journey-ai`, { method: 'POST', headers: headers(server.key), body: JSON.stringify({ workspaceId: server.workspaceId, ...body }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const askVia = (server: Server): Ask => async (task: string, segments: Segment[]) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await gateway(server, { action: 'run', task, segments });
    if (r.status === 200 && r.json?.ok) return { data: r.json.data, dropped: (r.json.dropped ?? []).length, tokens: Number(r.json.usage?.input ?? 0) + Number(r.json.usage?.output ?? 0) };
    const code = /^[A-Z_]{2,40}$/.test(String(r.json?.error?.code ?? '')) ? ` ${r.json.error.code}` : '';
    if (r.status === 429 || (r.status >= 400 && r.status < 500)) throw new ReplayStop(`The gateway refused the call (${r.status}${code}). The run stops.`);
  }
  throw new ReplayStop('The gateway did not answer twice running. The run stops.');
};

const setB = (server: Server): Promise<CallCase[]> => setBCases(async (q: string) => {
  const r = await fetch(`${server.url}/rest/v1/${q}`, { headers: headers(server.key) });
  if (!r.ok) throw new ReplayStop(`The server refused a read (${r.status}). Nothing was replayed.`);
  return r.json() as Promise<any[]>;
}).then(cases => cases.map(c => ({ ...c, model: emptyModel(c.process), attendees: [{ kind: 'business' as const }, { kind: 'it' as const }] })));

async function main() {
  const args = process.argv.slice(2);
  const set = args[args.indexOf('--set') + 1] ?? 'dry';
  // "said": measure 1 is judged alone (one transcript before and after a change; owner, 27 November 2026).
  const judging = args.includes('--judge') ? args[args.indexOf('--judge') + 1] : 'all';
  if (!args.includes('--live') && !args.includes('--check')) {
    for (const c of [...setM(), ...(await setA())]) console.log(`${c.id}: ${c.passages.length} passages, ${windows(c.passages).length} windows.`);
    console.log('Set B (the two transcripts of "Project time writing") is read only in a live run, in the workflow.');
    return;
  }
  if (args.includes('--live') && !['dry', 'a', 'b', 'b1', 'all'].includes(set)) throw new ReplayStop('--set is dry, a, b, b1 or all.');
  if (judging !== 'all' && judging !== 'said') throw new ReplayStop('--judge is all or said.');
  const withB = set === 'b' || set === 'b1' || set === 'all';
  const server = await connect();
  const a = await gateway(server, { action: 'allowance' });
  if (a.status !== 200 || !a.json?.ok) throw new ReplayStop(`The AI gateway did not answer (${a.status}).`);
  console.log(`Signed in. AI use counts against the chosen workspace, on ${a.json.source === 'workspace' ? 'its own' : "the platform's"} ${a.json.provider} key${a.json.budget ? `: ${a.json.used} of ${a.json.budget} tokens used this month` : ''}.`);
  if (args.includes('--check')) return;
  if (withB && !setBAllowed(a.json.source)) throw new ReplayStop(SET_B_NOT_ON_PLATFORM);
  console.log(judging === 'said' ? 'Judged: measure 1 alone.' : 'Judged: measures 1 and 2.');
  const ask = askVia(server);
  const cases = [
    ...(set === 'b' || set === 'b1' ? [] : setM()),
    ...(set === 'a' || set === 'all' ? await setA() : []),
    // b1: set B's first transcript alone, read under set B's guards (both are counted first by ids, then only it is kept).
    ...(withB ? (await setB(server)).filter(c => set !== 'b1' || c.id === 'B1') : []),
  ];
  const results: CallCaseResult[] = [];
  for (const c of cases) {
    const r = await replayCall(c, ask, { judge: judging === 'said' ? 'said' : true });
    results.push(r);
    console.log(`${c.id}: ${r.passages} passages in ${r.windows} windows; ${r.suggested.length} suggested; ${r.raised.length} raised; ${r.found.length} answers found; ${r.tokens} tokens in ${r.calls} calls, ${r.judgingTokens} judging; ${r.failures} calls failed.`);
    const m = answers.find(x => x.id === c.id);
    if (m) { const k = matchedKeys(r, m); console.log(`  ${c.id} hand-written answers, by key: right ${k.right.join(', ') || 'none'}; rejected ${k.rejected.join(', ') || 'none'}; missed ${k.missed.join(', ') || 'none'}.`); }
  }
  console.log('');
  console.log(renderCallScorecard(scoreCalls(results, answers), `set ${set}`));
  const b = results.filter(r => r.id.startsWith('B'));
  if (b.length && set !== 'b' && set !== 'b1') { console.log(''); console.log(renderCallScorecard(scoreCalls(b), 'set B alone')); }
}

main().catch(e => {
  console.error(e instanceof ReplayStop ? e.message : 'The call replay stopped on an unexpected error. Nothing of what was read is shown.');
  process.exit(1);
});
