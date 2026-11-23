// Builds a teardown's demo file from its folder (marketing package, domain/site/teardowns.ts), and makes the
// committed copy of a published text safe before it is read. Runs on a laptop with Node; nothing here talks to
// the database, a server function or the AI.
//
//   node scripts/teardown-data.ts clean <file>   replace email addresses and telephone numbers in a copied
//                                                 text with the visible marks, in place, and print the counts
//                                                 (they go into teardown.json "removed")
//   node scripts/teardown-data.ts build <slug>   build public/demo-data/teardowns/<slug>.json from
//                                                 teardowns/<slug>/ (teardown.json, model.json, run.json and
//                                                 the files run.json names), refusing if any check fails
//
// The model in model.json is the one the live reading produced, exported once (PR 4 of the plan); this script
// replaces who decided what with the teardown's own person, rebuilds the passages from the committed files
// with the product's own parser, and checks the result (teardownProblems) before writing anything.
import { readFileSync, writeFileSync } from 'node:fs';
import { removeContacts, teardownProblems, type TeardownWords } from '../domain/site/teardowns.ts';
import { teardownState, type TeardownRun } from '../domain/site/teardownState.ts';
import type { ProcessModel } from '../domain/processModel/types.ts';

const [what, arg] = process.argv.slice(2);
const root = new URL('../', import.meta.url);

if (what === 'clean' && arg) {
  const r = removeContacts(readFileSync(arg, 'utf8'));
  writeFileSync(arg, r.text);
  console.log(JSON.stringify({ removed: r.removed }));
} else if (what === 'build' && arg) {
  const dir = new URL(`teardowns/${arg}/`, root);
  const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  const run = json<TeardownRun>('run.json');
  const words = json<TeardownWords>('teardown.json');
  if (words.slug !== arg) throw new Error(`teardown.json names ${words.slug}, not ${arg}.`);
  const files = Object.fromEntries(Object.values(run.files).map(f => [f, new Uint8Array(readFileSync(new URL(f, dir)))]));
  const state = await teardownState({ words, model: json<ProcessModel>('model.json'), run, files });
  const problems = teardownProblems(state, run);
  if (problems.length) {
    console.error(`Not written: ${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}.\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  const out = new URL(`public/demo-data/teardowns/${arg}.json`, root);
  writeFileSync(out, `${JSON.stringify(state, null, 1)}\n`);
  console.log(`Wrote ${out.pathname.slice(root.pathname.length)} (${readFileSync(out).length} bytes).`);
} else {
  console.error('Use: node scripts/teardown-data.ts clean <file> | build <slug>');
  process.exit(2);
}
