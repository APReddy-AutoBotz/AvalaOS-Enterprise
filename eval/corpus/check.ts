// Starts one extraction check and prints its scorecard: node eval/corpus/check.ts <case> [workspace id] [--start-at-kinds | --record-cutoff]
//   --start-at-kinds  the facts merge starts at one answer per kind (domain/extract/factsParts.ts), to show
//                     that path on a real provider; refused for any reading that is not a check.
//   --record-cutoff   no reading: one tiny call cut off on purpose, whose reply is printed as it came, for
//                     domain/ai/fixtures/ (well under 1,000 tokens).
// Run by the "Extraction check" workflow (.github/workflows/extraction-check.yml), which supplies
// EXTRACT_URL (the project's address) and EXTRACT_KEY (the project's secret key, read with the access
// GitHub already holds for deploying the functions; never printed). Only a holder of that key, or of
// database access, can make a check: the run is a row in extraction_runs, which no signed-in user can
// write. The files go with the start request and are taken only when they match eval/corpus/cases.ts.
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CASES, filesOf } from './cases.ts';

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const [caseId, workspaceId = ''] = args.filter(a => !a.startsWith('--'));
for (const f of flags) if (!['--start-at-kinds', '--record-cutoff'].includes(f)) { console.error(`Unknown option ${f}.`); process.exit(1); }
if (flags.size > 1) { console.error('Give at most one option.'); process.exit(1); }
const url = process.env.EXTRACT_URL ?? '', key = process.env.EXTRACT_KEY ?? '';
if (!url || !key) { console.error('EXTRACT_URL and EXTRACT_KEY are needed.'); process.exit(1); }
if (!Object.hasOwn(CASES, caseId)) { console.error(`Unknown case. Cases: ${Object.keys(CASES).join(', ')}.`); process.exit(1); }
if (workspaceId && !/^[0-9a-f-]{36}$/i.test(workspaceId)) { console.error('The workspace id is not a UUID.'); process.exit(1); }
const c = CASES[caseId];

const headers: Record<string, string> = { apikey: key, 'Content-Type': 'application/json', ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }) };
const token = randomBytes(24).toString('hex');
const res = await fetch(`${url}/rest/v1/extraction_runs`, {
  method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify({ kind: 'eval', case_id: caseId, ref: process.env.GITHUB_SHA ?? 'local', token_hash: createHash('sha256').update(token).digest('hex'), ...(workspaceId ? { workspace_id: workspaceId } : {}) }),
});
if (!res.ok) { console.error(`The check could not be made (${res.status}).`); process.exit(1); }
const [run] = await res.json();
console.log(`Check ${run.id}: case ${caseId}${workspaceId ? `, on workspace ${workspaceId}'s AI connection` : ', on the platform key'}.`);

const fn = `${url}/functions/v1/journey-extract`;
const files = flags.has('--record-cutoff') ? {} : Object.fromEntries(filesOf(c).map(f => [f, fs.readFileSync(new URL(`./${c.dir}/${f}`, import.meta.url)).toString('base64')]));
const startBody = flags.has('--record-cutoff') ? { action: 'record-cutoff', runId: run.id, token }
  : { action: 'start', runId: run.id, token, files, ...(flags.has('--start-at-kinds') ? { startAtKinds: true } : {}) };
const start = await fetch(fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(startBody) });
if (start.status !== 202) { console.error(`The check did not start (${start.status}): ${(await start.text()).slice(0, 300)}`); process.exit(1); }

/** Tokens and time of each part of the facts merge, split notes included. */
async function printFactsParts() {
  const r = await fetch(`${url}/rest/v1/extraction_run_parts?run_id=eq.${run.id}&part=like.facts:*&select=part,usage:output->usage,ms:output->ms,splitInto:output->splitInto,reason:output->reason&order=part`, { headers });
  const rows: any[] = r.ok ? await r.json() : [];
  console.log('Facts merge, per part (tokens in / out, seconds):');
  for (const p of rows) {
    const t = p.usage ? `${p.usage.input} / ${p.usage.output}` : '—';
    console.log(`  ${p.part}: ${t}, ${p.ms ? (p.ms / 1000).toFixed(1) : '—'} s${p.splitInto ? `, split into ${p.splitInto.join(', ')} (${p.reason})` : ''}`);
  }
}

const until = Date.now() + 12 * 60_000;
for (;;) {
  await new Promise(r => setTimeout(r, 15_000));
  const r = await fetch(`${url}/rest/v1/extraction_runs?id=eq.${run.id}&select=status,error,result->score,recorded:result->recorded,failure:result->failure,input_tokens,output_tokens,updated_at`, { headers });
  const [row] = r.ok ? await r.json() : [{}];
  if (row?.status === 'done' && flags.has('--record-cutoff')) {
    console.log(`Recorded. Tokens: ${row.input_tokens} in, ${row.output_tokens} out. Read as: ${row.recorded?.read}.`);
    console.log('BEGIN_CUTOFF_REPLY');
    console.log(JSON.stringify(row.recorded, null, 2));
    console.log('END_CUTOFF_REPLY');
    break;
  }
  if (row?.status === 'done') {
    console.log(`Done. Tokens: ${row.input_tokens} in, ${row.output_tokens} out.`);
    await printFactsParts();
    console.log(JSON.stringify(row.score, null, 2));
    break;
  }
  if (row?.status === 'failed') {
    console.error(`The check failed: ${String(row.error).slice(0, 500)}`);
    if (row.failure) console.error(`Detail: ${JSON.stringify(row.failure).slice(0, 1000)}`);
    console.error(`Tokens: ${row.input_tokens} in, ${row.output_tokens} out.`);
    await printFactsParts();
    process.exit(1);
  }
  // A step stopped from outside leaves the run unchanged; the function ends it once it has sat too long.
  if (row?.updated_at && Date.now() - Date.parse(row.updated_at) > 7 * 60_000) {
    await fetch(fn, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'look', runId: run.id, token }) }).catch(() => {});
  }
  if (Date.now() > until) { console.error(`Still ${row?.status ?? 'unknown'} after 12 minutes; read it later with: select status, error, result->'score' from public.extraction_runs where id = '${run.id}';`); process.exit(1); }
  console.log(`… ${row?.status ?? 'waiting'}`);
}
