// Lists which files of the repository are in use, by following imports from what runs (package 15 of
// docs/next-plan.md, section 3f). Run it again at any time:
//
//   node scripts/in-use.mjs            a summary by folder: in use, not in use
//   node scripts/in-use.mjs --unused   every file not reached, one per line
//   node scripts/in-use.mjs --used     every file reached, one per line
//
// What runs, and so where the walk starts:
//   - the site: index.html and every local file it names (the build follows imports from there);
//   - the five live server functions: supabase/functions/journey-*/index.ts;
//   - the checks that are run: the browser tests and their configuration, the fast tests (domain/, eval/),
//     the eval and the Ask Avala measure, the build's own configuration, every script named in package.json
//     or a workflow;
//   - the database's history: every migration and database test (kept whole, never followed);
//   - the documents, the public files and the repository's own configuration (kept whole).
// A file is in use when one of those reaches it through an import (static, dynamic, `export … from`,
// `new URL(…, import.meta.url)`, a CSS @import or url()). Anything else is listed as not in use.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// The tree to read: this repository, or another checkout given as AVALA_ROOT (the comparison reads the tag's).
const ROOT = process.env.AVALA_ROOT ? path.resolve(process.env.AVALA_ROOT) : path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const rel = p => path.relative(ROOT, p).split(path.sep).join('/');
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
const trackedSet = new Set(tracked);

// Kept whole: the database's history, documents, public files, configuration, workflows.
const KEPT_WHOLE = [
  /^supabase\/migrations\//, /^supabase\/tests\//, /^supabase\/config\.toml$/, /^docs\//, /^\.github\//,
  /^[^/]+\.(md|json|toml|lock)$/, /^\.gitignore$/, /^\.nvmrc$/, /^\.npmrc$/, /^\.editorconfig$/, /^eval\/corpus\//, /^eval\/README\.md$/,
  /^eval\/ask\/.*\.json$/, /^tsconfig(\.[a-z]+)?\.json$/,
  // Files the fast tests read from disk (documents, spreadsheets, PDFs) rather than import.
  /^(domain|eval)\/.*\/fixtures\//,
  // What each teardown's demo file is built from (domain/site/teardowns.ts; scripts/teardown-data.ts reads it).
  /^teardowns\//,
];

// Where the walk starts.
const START = new Set([
  'index.html', 'index.tsx', 'index.css', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'playwright.config.ts',
  'vite-env.d.ts', 'supabase/functions/deno.d.ts',
  ...tracked.filter(f => /^supabase\/functions\/journey-[^/]+\/index\.ts$/.test(f)),
  ...tracked.filter(f => /^tests\/e2e\/.*\.ts$/.test(f)),
  ...tracked.filter(f => /^(domain|eval)\/.*\.test\.ts$/.test(f)),
  'eval/run.ts', 'eval/ask/run.ts',
]);
// Every script package.json or a workflow names.
// AGENTS.md names the tools a person runs by hand (for example the demo-data tool).
const named = [fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'), fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8'), ...tracked.filter(f => f.startsWith('.github/workflows/')).map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'))].join('\n');
for (const m of named.matchAll(/(?:^|[\s"'`])((?:scripts|eval|tests|domain|journey)\/[A-Za-z0-9_./-]+\.(?:mjs|js|ts|tsx))/g)) if (trackedSet.has(m[1])) START.add(m[1]);
// index.html's own local files (script, link, icons).
for (const m of fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/(?:src|href)="\/?([^"#?:]+)"/g)) {
  if (trackedSet.has(m[1])) START.add(m[1]);
}

const EXT = ['', '.ts', '.tsx', '.mjs', '.js', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];
function resolve(from, spec) {
  spec = spec.split('?')[0];
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null; // a package, npm:, https:, node:
  const base = spec.startsWith('/') ? path.join(ROOT, spec.startsWith('/public/') ? spec : `public${spec}`) : path.resolve(path.dirname(path.join(ROOT, from)), spec);
  for (const e of EXT) { const f = rel(base + e); if (trackedSet.has(f)) return f; }
  if (spec.startsWith('/')) { for (const e of EXT) { const f = rel(path.join(ROOT, spec.slice(1)) + e); if (trackedSet.has(f)) return f; } }
  return null;
}
const IMPORT = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?[\w*{}\s,]*?\s+from\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /new\s+URL\s*\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g,
  /@import\s+(?:url\()?['"]([^'"]+)['"]/g,
  /\/\/\/\s*<reference\s+path=['"]([^'"]+)['"]/g,
];
// Script runners that take file paths as arguments (scripts/unit-tests.json entries name their files).
const ARGS = /(?:^|\s)((?:services|components|supabase|types|constants|data|tests|domain|journey)[A-Za-z0-9_./-]*\.(?:ts|tsx|mjs|js))/g;

const used = new Set();
const why = new Map();
const queue = [...START].filter(f => trackedSet.has(f));
for (const f of queue) { used.add(f); why.set(f, 'starts the walk'); }
while (queue.length) {
  const f = queue.shift();
  if (!/\.(ts|tsx|mjs|js|css|html)$/.test(f)) continue;
  const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const specs = [];
  for (const re of IMPORT) for (const m of text.matchAll(re)) specs.push(m[1]);
  if (f.endsWith('.html')) for (const m of text.matchAll(/(?:src|href)="([^"#]+)"/g)) specs.push(m[1].startsWith('/') ? m[1] : `./${m[1]}`);
  for (const s of specs) {
    const r = resolve(f, s);
    if (r && !used.has(r)) { used.add(r); why.set(r, f); queue.push(r); }
  }
}
for (const f of tracked) if (KEPT_WHOLE.some(re => re.test(f))) { if (!used.has(f)) { used.add(f); why.set(f, 'kept whole'); } }

// Public files are addressed by name, not imported: one is in use when a file in use names its path, or names
// it as a quoted base name beside a template for its folder (the tour's `/marketing/tour/${name}.webp`), or
// when it is one the server or the browser asks for by its own name. The light mark stays on the owner's
// word (17 November 2026): it is the current mark, though no page shows it today.
const BY_NAME = new Set(['public/_headers', 'public/_redirects', 'public/robots.txt', 'public/sitemap.xml', 'public/favicon.ico', 'public/.well-known/security.txt', 'public/security.txt']);
const KEPT_ON_WORD = new Set(['public/brand/avala-os-mark-light.svg']);
const texts = [...used].filter(f => /\.(ts|tsx|html|css|toml|json|txt|xml|webmanifest)$/.test(f) && !f.startsWith('public/') && !f.startsWith('docs/') && !f.startsWith('supabase/') && !f.endsWith('package-lock.json'))
  .concat(tracked.filter(f => f.startsWith('public/') && /\.(html|txt|xml|webmanifest|json)$/.test(f)))
  .map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
for (const f of tracked.filter(f => f.startsWith('public/'))) {
  const served = f.slice('public'.length);
  const dir = path.posix.dirname(served);
  const base = path.posix.basename(served).replace(/\.[^.]+$/, '');
  const hit = texts.find(([g, t]) => g !== f && (t.includes(served) || (t.includes(`${dir}/\${`) && (t.includes(`'${base}'`) || t.includes(`"${base}"`)))));
  const reason = hit ? hit[0] : BY_NAME.has(f) ? 'asked for by its own name' : KEPT_ON_WORD.has(f) ? "the current mark, kept on the owner's word" : null;
  if (reason) { used.add(f); why.set(f, reason); }
}

const unused = tracked.filter(f => !used.has(f));
const arg = process.argv[2];
if (arg === '--unused') { console.log(unused.join('\n')); process.exit(0); }
if (arg === '--used') { console.log([...used].sort().join('\n')); process.exit(0); }
// --from <files>: every file those files reach by import, with its SHA-256 (the comparison of server functions).
if (arg === '--from') {
  const seen = new Set(process.argv.slice(3)); const q = [...seen];
  while (q.length) {
    const f = q.shift(); if (!/\.(ts|tsx|mjs|js)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const re of IMPORT) for (const m of text.matchAll(re)) { const r = resolve(f, m[1]); if (r && !seen.has(r)) { seen.add(r); q.push(r); } }
  }
  for (const f of [...seen].sort()) console.log(`${createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex')}  ${f}`);
  process.exit(0);
}
if (arg === '--why') { for (const f of process.argv.slice(3)) console.log(`${f}: ${used.has(f) ? `in use, reached from ${why.get(f)}` : 'not in use'}`); process.exit(0); }

const top = f => { const p = f.split('/'); return p.length > 2 && ['supabase', 'tests', 'scripts'].includes(p[0]) ? `${p[0]}/${p[1]}/` : p.length > 1 ? `${p[0]}/` : f; };
const by = new Map();
for (const f of tracked) { const k = top(f); const e = by.get(k) ?? { used: 0, unused: 0 }; used.has(f) ? e.used++ : e.unused++; by.set(k, e); }
console.log('folder'.padEnd(36), 'in use'.padStart(7), 'not in use'.padStart(11));
for (const [k, e] of [...by].sort()) console.log(k.padEnd(36), String(e.used).padStart(7), String(e.unused).padStart(11));
console.log(`\n${tracked.length} files tracked: ${used.size} in use, ${unused.length} not in use.`);
