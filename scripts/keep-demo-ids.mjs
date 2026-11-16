// Keeps the demo's ids when its data is refreshed.
//
// The demo's sample (public/demo-data/sample.json) is the state the tour walk leaves, and every walk
// gives the workspace, the process, the people, the project and the work items new random ids. The
// demo's recorded Ask Avala answers (public/demo-data/ask-answers.json) point at those ids, so a new
// sample would silently drop their sentences. This script gives a freshly walked sample the ids of the
// committed one, matching each thing by what it is (a person by email, a work item by its type and
// title, and so on), so the recorded answers keep finding their facts.
//
//   node scripts/keep-demo-ids.mjs <fresh sample.json> [committed sample.json] [output]
//
// eval/ask/recorded.test.ts then checks that every recorded sentence still has its fact and its quote.
import fs from 'node:fs';

const [fresh, committed = 'public/demo-data/sample.json', out = committed] = process.argv.slice(2);
if (!fresh) { console.error('Usage: node scripts/keep-demo-ids.mjs <fresh sample.json> [committed sample.json] [output]'); process.exit(1); }
const next = JSON.parse(fs.readFileSync(fresh, 'utf8'));
const prev = JSON.parse(fs.readFileSync(committed, 'utf8'));

const map = new Map();
const pair = (a, b) => { if (a && b && a !== b) map.set(a, b); };
/** Pairs the things of two lists that have the same key, the nth with the nth where a key repeats. */
function pairBy(nextList, prevList, key, id = x => x.id) {
  const seen = new Map();
  const index = list => { const m = new Map(); for (const x of list ?? []) { const k = key(x); const n = (seen.get(`${list === nextList}:${k}`) ?? 0); seen.set(`${list === nextList}:${k}`, n + 1); m.set(`${k}#${n}`, x); } return m; };
  const a = index(nextList), b = index(prevList);
  let matched = 0;
  for (const [k, x] of a) { const y = b.get(k); if (y) { pair(id(x), id(y)); matched++; } }
  return matched;
}

pair(next.me?.id, prev.me?.id);
const counts = {
  workspaces: pairBy(next.workspaces, prev.workspaces, x => x.name),
  organisations: pairBy(next.workspaces, prev.workspaces, x => x.name, x => x.organizationId),
  processes: pairBy(next.processes, prev.processes, x => x.name),
  revisions: pairBy(next.revisions, prev.revisions, x => String(x.revNo)),
  sources: pairBy(next.sources, prev.sources, x => x.key),
  projects: pairBy(next.projects, prev.projects, x => x.name),
  workItems: pairBy(next.workItems, prev.workItems, x => `${x.type}|${x.title}`),
  people: pairBy(Object.values(next.people ?? {}).flatMap(p => p.members), Object.values(prev.people ?? {}).flatMap(p => p.members), x => x.email, x => x.userId),
};

let text = JSON.stringify(next);
for (const [from, to] of map) text = text.split(from).join(to);
JSON.parse(text);
fs.writeFileSync(out, text);
console.log(`Kept ${map.size} ids:`, JSON.stringify(counts), `(${next.workItems?.length ?? 0} work items in the fresh sample)`);
