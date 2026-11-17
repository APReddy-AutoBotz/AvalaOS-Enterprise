// Package 15's proof (temporary: removed with the notes once the package is merged). Compares the site built
// from the state before the cleanup with the site built after it, file for file, and reads the stylesheet
// rule by rule.
//
//   node scripts/compare-builds.mjs <before dist> <after dist> <before tree> <after tree> <report dir>
//
// Passes only when:
//   - every built file is byte-identical, except the stylesheet and index.html's line that loads it;
//   - index.html differs only in the stylesheet's file name;
//   - the stylesheet after is the stylesheet before with declarations removed and nothing added, changed
//     or reordered;
//   - no class name or CSS variable that the stylesheet lost appears anywhere in the tree after (domain/
//     included), and no code builds one of them from parts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import postcss from 'postcss';

const [beforeDist, afterDist, beforeTree, afterTree, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const report = [];
const say = s => { report.push(s); console.log(s); };
let ok = true;
const fail = s => { ok = false; say(`FAIL: ${s}`); };

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)).map(f => `${e.name}/${f}`) : [e.name]);
const sha = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const before = new Map(walk(beforeDist).map(f => [f, sha(path.join(beforeDist, f))]));
const after = new Map(walk(afterDist).map(f => [f, sha(path.join(afterDist, f))]));
fs.writeFileSync(path.join(out, 'built-before.txt'), [...before].sort().map(([f, h]) => `${h}  ${f}`).join('\n') + '\n');
fs.writeFileSync(path.join(out, 'built-after.txt'), [...after].sort().map(([f, h]) => `${h}  ${f}`).join('\n') + '\n');

// 1. The built site, file for file.
const css = m => [...m.keys()].filter(f => f.endsWith('.css'));
const [cssBefore, cssAfter] = [css(before), css(after)];
if (cssBefore.length !== 1 || cssAfter.length !== 1) fail(`expected one stylesheet on each side, found ${cssBefore.length} and ${cssAfter.length}`);
let same = 0;
for (const [f, h] of before) {
  if (f === cssBefore[0] || f === 'index.html') continue;
  if (!after.has(f)) fail(`${f} is built before but not after`);
  else if (after.get(f) !== h) fail(`${f} differs`);
  else same++;
}
for (const f of after.keys()) if (!before.has(f) && f !== cssAfter[0]) fail(`${f} is built after but not before`);
say(`Built files: ${before.size} before, ${after.size} after; ${same} byte-identical; the other two are the stylesheet and index.html.`);

const htmlBefore = fs.readFileSync(path.join(beforeDist, 'index.html'), 'utf8');
const htmlAfter = fs.readFileSync(path.join(afterDist, 'index.html'), 'utf8');
if (htmlBefore.split(cssBefore[0]).join(cssAfter[0]) !== htmlAfter) fail('index.html differs in more than the stylesheet\'s name');
else {
  const changed = htmlBefore.split('\n').map((l, i) => [l, htmlAfter.split('\n')[i]]).filter(([a, b]) => a !== b);
  say(`index.html: ${changed.length} line differs, only in the stylesheet's name (${cssBefore[0]} → ${cssAfter[0]}).`);
}

// 2. The stylesheet, declaration by declaration, each with the rules and at-rules it sits in.
function entries(file) {
  const list = [];
  const where = n => { const p = []; for (let x = n.parent; x && x.type !== 'root'; x = x.parent) p.unshift(x.type === 'rule' ? x.selector : `@${x.name} ${x.params}`); return p.join(' ⟩ '); };
  postcss.parse(fs.readFileSync(file, 'utf8')).walk(n => {
    if (n.type === 'decl') list.push({ where: where(n), text: `${n.prop}:${n.value}${n.important ? '!important' : ''}`, node: n });
    else if (n.type === 'atrule' && !n.nodes) list.push({ where: where(n), text: `@${n.name} ${n.params};`, node: n });
    else if ((n.type === 'rule' || n.type === 'atrule') && n.nodes && n.nodes.length === 0) list.push({ where: where(n), text: `${n.type === 'rule' ? n.selector : `@${n.name} ${n.params}`} {}`, node: n });
  });
  return list.map(e => ({ ...e, key: `${e.where} ⟩ ${e.text}` }));
}
const eb = entries(path.join(beforeDist, cssBefore[0]));
const ea = entries(path.join(afterDist, cssAfter[0]));
const removed = [];
let j = 0;
for (const e of eb) { if (j < ea.length && ea[j].key === e.key) j++; else removed.push(e); }
if (j !== ea.length) fail(`the stylesheet after is not the one before with removals only: entry ${j + 1} of ${ea.length} after ("${ea[j].key}") is not found in order`);
else say(`Stylesheet: ${eb.length} declarations before, ${ea.length} after; every one after is unchanged and in the same order; ${removed.length} removed, none added or changed.`);
fs.writeFileSync(path.join(out, 'stylesheet-removed.txt'), removed.map(e => e.key).join('\n') + '\n');

// The rules that went whole, and those that lost some declarations (for the report).
const ruleOf = e => e.where;
const keptWhere = new Set(ea.map(ruleOf));
const gone = new Set(removed.map(ruleOf).filter(w => !keptWhere.has(w)));
const trimmed = new Set(removed.map(ruleOf).filter(w => keptWhere.has(w)));
say(`Rules removed whole: ${gone.size}. Rules that kept their place but lost declarations: ${trimmed.size}${trimmed.size ? ` (${[...trimmed].join('; ')})` : ''}.`);

// 3. The names the stylesheet lost: class names in removed selectors that no kept selector has, and custom
// properties removed with no declaration of them kept.
const classes = s => new Set([...s.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)].map(m => m[1].replace(/\\(.)/g, '$1')));
const keptClasses = new Set(ea.flatMap(e => [...classes(e.where)]));
const lostClasses = [...new Set(removed.flatMap(e => [...classes(e.where)]))].filter(c => !keptClasses.has(c)).sort();
const keptVars = new Set(ea.map(e => e.text.match(/^(--[A-Za-z0-9_-]+):/)?.[1]).filter(Boolean));
const lostVars = [...new Set(removed.map(e => e.text.match(/^(--[A-Za-z0-9_-]+):/)?.[1]).filter(Boolean))].filter(v => !keptVars.has(v)).sort();
fs.writeFileSync(path.join(out, 'names-removed.txt'), [...lostClasses.map(c => `class  ${c}`), ...lostVars.map(v => `var    ${v}`)].join('\n') + '\n');
say(`Names the stylesheet lost: ${lostClasses.length} class names, ${lostVars.length} CSS variables (listed in names-removed.txt).`);

// Every text file of the tree after, domain/ included (the lockfile and the built site aside).
const files = execSync('git ls-files', { cwd: afterTree, encoding: 'utf8' }).split('\n').filter(f => f && !f.endsWith('package-lock.json') && !/\.(png|jpe?g|webp|gif|ico|pdf|docx|xlsx|pptx|woff2?|ttf|otf|zip|gz|mp3|wav|m4a|webm|mp4)$/i.test(f));
const texts = files.map(f => [f, fs.readFileSync(path.join(afterTree, f), 'utf8')]);
say(`Searched: ${texts.length} files of the tree after (everything tracked but pictures, documents and the lockfile).`);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLASS_CHAR = 'A-Za-z0-9_:\\[\\]\\-/.%#!()\'"=,&*>+~';
const found = [];
for (const name of lostClasses) {
  // A class name as Tailwind reads it from source: not part of a longer candidate.
  const re = new RegExp(`(?<![${CLASS_CHAR.replace(/'|"/g, '')}])${esc(name)}(?![A-Za-z0-9_\\-/\\[\\]])`);
  for (const [f, t] of texts) if (re.test(t)) found.push(`class ${name} in ${f}`);
}
for (const v of lostVars) for (const [f, t] of texts) if (new RegExp(`${esc(v)}(?![A-Za-z0-9_-])`).test(t)) found.push(`variable ${v} in ${f}`);
fs.writeFileSync(path.join(out, 'names-found.txt'), found.join('\n') + '\n');
if (found.length) fail(`${found.length} removed names appear in the tree after (names-found.txt)`);
else say('Each removed name appears nowhere in the tree after, domain/ included.');

// 4. No code builds a class name from parts: for every removed class, no prefix of it ending in "-" or ":"
// is followed by an interpolation or joined with "+" anywhere in the tree after.
const parts = [];
for (const name of lostClasses) {
  const cuts = [...name.matchAll(/[-:]/g)].map(m => name.slice(0, m.index + 1));
  for (const p of new Set(cuts)) {
    const re = new RegExp(`(?<![A-Za-z0-9_-])${esc(p)}(?:\\$\\{|['"\`]\\s*\\+)`);
    for (const [f, t] of texts) if (re.test(t)) parts.push(`${name}: "${p}" is built on in ${f}`);
  }
}
// And, in general, every place a class-shaped string is built from parts (for the report to read through).
const general = [];
for (const [f, t] of texts) if (/\.(tsx?|mjs|js|html)$/.test(f)) t.split('\n').forEach((l, i) => {
  for (const m of l.matchAll(/class(?:Name)?=\{?`[^`]*`/g)) if (/[A-Za-z0-9]-\$\{|[A-Za-z0-9]:\$\{/.test(m[0])) general.push(`${f}:${i + 1}: ${m[0].slice(0, 140)}`);
});
fs.writeFileSync(path.join(out, 'built-from-parts.txt'), [...parts, '--- every class attribute that joins a fixed prefix to a value:', ...general].join('\n') + '\n');
if (parts.length) fail(`${parts.length} removed class names could be built from parts (built-from-parts.txt)`);
else say(`No code builds a removed class name from parts. Class attributes anywhere that join a prefix to a value: ${general.length}${general.length ? ' (built-from-parts.txt)' : ''}.`);

say(ok ? 'RESULT: identical but for the stylesheet, which lost only unused rules.' : 'RESULT: not as expected (see above).');
fs.writeFileSync(path.join(out, 'report.md'), report.map(l => `- ${l}`).join('\n') + '\n');
process.exit(ok ? 0 : 1);
