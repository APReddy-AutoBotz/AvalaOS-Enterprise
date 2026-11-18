// Starts one extraction check and prints its scorecard: node eval/corpus/check.ts <case> [workspace id]
// Run by the "Extraction check" workflow (.github/workflows/extraction-check.yml), which supplies
// EXTRACT_URL (the project's address) and EXTRACT_KEY (the project's secret key, read with the access
// GitHub already holds for deploying the functions; never printed). Only a holder of that key, or of
// database access, can make a check: the run is a row in extraction_runs, which no signed-in user can
// write. The files go with the start request and are taken only when they match eval/corpus/cases.ts.
import fs from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { CASES, filesOf } from './cases.ts';

const [caseId, workspaceId = ''] = process.argv.slice(2);
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

const files = Object.fromEntries(filesOf(c).map(f => [f, fs.readFileSync(new URL(`./${c.dir}/${f}`, import.meta.url)).toString('base64')]));
const start = await fetch(`${url}/functions/v1/journey-extract`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start', runId: run.id, token, files }) });
if (start.status !== 202) { console.error(`The check did not start (${start.status}): ${(await start.text()).slice(0, 300)}`); process.exit(1); }

const until = Date.now() + 12 * 60_000;
for (;;) {
  await new Promise(r => setTimeout(r, 15_000));
  const r = await fetch(`${url}/rest/v1/extraction_runs?id=eq.${run.id}&select=status,error,result->score,input_tokens,output_tokens`, { headers });
  const [row] = r.ok ? await r.json() : [{}];
  if (row?.status === 'done') {
    console.log(`Done. Tokens: ${row.input_tokens} in, ${row.output_tokens} out.`);
    console.log(JSON.stringify(row.score, null, 2));
    break;
  }
  if (row?.status === 'failed') { console.error(`The check failed: ${String(row.error).slice(0, 500)}`); process.exit(1); }
  if (Date.now() > until) { console.error(`Still ${row?.status ?? 'unknown'} after 12 minutes; read it later with: select status, error, result->'score' from public.extraction_runs where id = '${run.id}';`); process.exit(1); }
  console.log(`… ${row?.status ?? 'waiting'}`);
}
