// The browser tests' stand-in for AI tasks (journey/store/standIns.ts, domain/ai/standIn.ts) must never be
// in the released site. Run after `npm run build`: `node scripts/check-no-stand-ins.mjs dist`. It fails when
// any built file carries the names only those two files use.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MARKS = ['__avalaStandIns', '__avalaStandInLog', 'The stand-in answers only what a person said'];
const dir = process.argv[2] ?? 'dist';
if (!existsSync(dir)) { console.error(`No folder ${dir}: run the build first.`); process.exit(1); }
const files = [];
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(dir);
const built = files.filter(f => /\.(js|mjs|html)$/.test(f));
if (!built.length) { console.error(`No built scripts in ${dir}: run the build first.`); process.exit(1); }
const found = built.flatMap(f => { const text = readFileSync(f, 'utf8'); return MARKS.filter(m => text.includes(m)).map(m => `${f}: ${m}`); });
if (found.length) { console.error(`The test stand-in is in the build:\n${found.join('\n')}`); process.exit(1); }
console.log(`The test stand-in is not in the build (${built.length} scripts read).`);
