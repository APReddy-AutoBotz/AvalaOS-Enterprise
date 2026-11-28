// Runs the discovery replay (eval/discovery/replay.ts, eval/README.md "The discovery replay").
//
//   node eval/discovery/run.ts                    the transcripts and their windows, counts only; no AI is called
//   node eval/discovery/run.ts --check            signs in to the server and reads the workspace's allowance; no AI is called
//   node eval/discovery/run.ts --live --set dry   the two made-up transcripts of this folder (the dry run)
//   node eval/discovery/run.ts --live --set a     those and the sample's three calls (eval/corpus/ap-invoice/sources)
//   node eval/discovery/run.ts --live --set b     the two transcripts of the process "Project time writing", read at run time
//   node eval/discovery/run.ts --live --set all   both sets: the counting run
//
// A live run calls journey-ai as a trusted server, as the Ask Avala measure does: REPLAY_URL
// (https://<project-ref>.supabase.co), REPLAY_KEY (the project's server key, from the environment only, never
// printed) and the workspace the AI use is counted against, REPLAY_WORKSPACE_NAME. It prints numbers only: never
// a passage, a question, a quote or a source's title. Set B (review of 23 November 2026):
//   - runs only when the counted workspace is on the platform key, and refuses before reading anything otherwise;
//   - counts first, by ids only, and reads the transcripts' text only when exactly one process of that name
//     holds exactly two transcripts;
//   - is held in memory for the run and never stored, logged or printed.
// Any error the run does not expect prints one fixed line and exits 1, never the error's own message, which
// could carry characters of what was read.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Segment } from '../../domain/ai/gateway.ts';
import { parseFile } from '../../domain/ingest/parsers/index.ts';
import { fromSegments, readTranscript, renderScorecard, replayCase, ReplayStop, scoreReplay, SET_B_NOT_ON_PLATFORM, setBAllowed, setBCases, wantedLine, wantedMatches, windows, type Ask, type CaseAnswers, type CaseResult, type Passage } from './replay.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const answers = (JSON.parse(fs.readFileSync(path.join(here, 'answers.json'), 'utf8')) as { cases: (CaseAnswers & { file: string; process: string })[] }).cases;
const SAMPLE = ['01-discovery-call-2026-10-06.vtt', '02-exceptions-deep-dive-2026-10-09.srt', '03-sap-integration-call-2026-10-14.txt'];

interface Case { id: string; process: string; passages: Passage[] }

function madeUp(): Case[] {
  return answers.map(a => ({ id: a.id, process: a.process, passages: readTranscript(fs.readFileSync(path.join(here, a.file), 'utf8')) }));
}

async function sample(): Promise<Case[]> {
  const out: Case[] = [];
  for (const [i, name] of SAMPLE.entries()) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(root, 'eval/corpus/ap-invoice/sources', name)));
    const r = await parseFile({ name, bytes, sourceId: `call-${i + 1}` });
    if (r.status !== 'ok') throw new Error(`The sample's call ${i + 1} could not be read.`);
    out.push({ id: `A${i + 1}`, process: 'Vendor invoice processing', passages: fromSegments(r.segments) });
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
    // Asking again cannot help when the allowance is used up, the task is unknown or the request is refused:
    // the run stops (a refusal names only the status and the server's code, never what was sent).
    const code = /^[A-Z_]{2,40}$/.test(String(r.json?.error?.code ?? '')) ? ` ${r.json.error.code}` : '';
    if (r.status === 429 || (r.status >= 400 && r.status < 500)) throw new ReplayStop(`The gateway refused the call (${r.status}${code}). The run stops.`);
  }
  throw new ReplayStop('The gateway did not answer twice running. The run stops.');
};

/** Set B through the server's REST reads (`setBCases` in replay.ts holds the order and the guards). */
const setB = (server: Server): Promise<Case[]> => setBCases(async (q: string) => {
  const r = await fetch(`${server.url}/rest/v1/${q}`, { headers: headers(server.key) });
  if (!r.ok) throw new ReplayStop(`The server refused a read (${r.status}). Nothing was replayed.`);
  return r.json() as Promise<any[]>;
});

async function main() {
  const args = process.argv.slice(2);
  const set = args[args.indexOf('--set') + 1] ?? 'dry';
  if (!args.includes('--live') && !args.includes('--check')) {
    const cases = [...madeUp(), ...(await sample())];
    for (const c of cases) console.log(`${c.id}: ${c.passages.length} passages, ${windows(c.passages).length} windows.`);
    console.log('Set B (the two transcripts of "Project time writing") is read only in a live run, in the workflow.');
    return;
  }
  if (args.includes('--live') && !['dry', 'a', 'b', 'all'].includes(set)) throw new ReplayStop('--set is dry, a, b or all.');
  const server = await connect();
  const a = await gateway(server, { action: 'allowance' });
  if (a.status !== 200 || !a.json?.ok) throw new ReplayStop(`The AI gateway did not answer (${a.status}).`);
  console.log(`Signed in. AI use counts against the chosen workspace, on ${a.json.source === 'workspace' ? 'its own' : "the platform's"} ${a.json.provider} key${a.json.budget ? `: ${a.json.used} of ${a.json.budget} tokens used this month` : ''}.`);
  if (args.includes('--check')) return;
  // Set B only on the platform's key: the two real transcripts never go to a provider a workspace connected.
  if ((set === 'b' || set === 'all') && !setBAllowed(a.json.source)) throw new ReplayStop(SET_B_NOT_ON_PLATFORM);
  const ask = askVia(server);
  const results: CaseResult[] = [];
  const cases = [...(set === 'b' ? [] : madeUp()), ...(set === 'a' || set === 'all' ? await sample() : []), ...(set === 'b' || set === 'all' ? await setB(server) : [])];
  for (const c of cases) {
    const r = await replayCase(c.id, c.process, c.passages, ask);
    results.push(r);
    // Numbers only, per transcript.
    console.log(`${c.id}: ${r.passages} passages in ${r.windows} windows; ${r.raised.length} questions raised; ${r.wanted.length} wanted statements; ${r.tokens} tokens noticing, ${r.judgingTokens} judging; ${r.failures} calls failed.`);
  }
  console.log('');
  console.log(renderScorecard(scoreReplay(results, answers), `set ${set}`));
  // On the made-up set only: which hand-written wanted statements matched, and what was marked besides.
  const matches = wantedMatches(results, answers);
  if (matches.length) { console.log(''); for (const m of matches) console.log(wantedLine(m)); }
  const b = results.filter(r => r.id.startsWith('B'));
  if (b.length) { console.log(''); console.log(renderScorecard(scoreReplay(b), 'set B alone')); }
}

// A stop the run expects says why in its own fixed words; anything else prints one fixed line, never its message.
main().catch(e => {
  console.error(e instanceof ReplayStop ? e.message : 'The replay stopped on an unexpected error. Nothing of what was read is shown.');
  process.exit(1);
});
