// Package 13 part A's proof (temporary, removed before the merge; first written for package 15). Compares the site built
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

// 1. The built site, file for file. Built files carry an 8-character hash of their content in their name
// (index-D2f8JFG9.css), and a file that names another (index.html, a script that loads a later one) changes
// when that one's name does. So files are paired by name without the hash, and a pair that differs is read
// again with every hashed name in it written without its hash: if it is then identical, it differs only in
// the names of other built files it refers to.
const HASHED = /([A-Za-z0-9_.]+(?:-[A-Za-z0-9_]+)*?)-[A-Za-z0-9_-]{8}\.(js|mjs|css|svg|eot|woff2?|ttf|png|webp|jpe?g)\b/g;
const keyOf = f => f.replace(HASHED, '$1.$2');
const unhash = t => t.replace(HASHED, '$1-#.$2');
const removedPublic = new Set(fs.existsSync(path.join(out, 'removed-public.txt')) ? fs.readFileSync(path.join(out, 'removed-public.txt'), 'utf8').split('\n').filter(Boolean).map(f => f.replace(/^public\//, '')) : []);
const byKey = m => new Map([...m.keys()].map(f => [keyOf(f), f]));
const kb = byKey(before), ka = byKey(after);
if (kb.size !== before.size || ka.size !== after.size) fail('two built files share a name once their hashes are taken out');
const sameBytes = [], namesOnly = [], differ = [], gonePublic = [];
for (const [k, fb] of kb) {
  const fa = ka.get(k);
  if (!fa) { if (removedPublic.has(fb)) gonePublic.push(fb); else fail(`${fb} is built before but not after`); continue; }
  if (before.get(fb) === after.get(fa)) { sameBytes.push(fb); continue; }
  const tb = fs.readFileSync(path.join(beforeDist, fb), 'utf8'), ta = fs.readFileSync(path.join(afterDist, fa), 'utf8');
  if (unhash(tb) === unhash(ta)) namesOnly.push([fb, fa]); else differ.push([fb, fa, tb, ta]);
}
for (const [k, fa] of ka) if (!kb.has(k)) fail(`${fa} is built after but not before`);
const firstDiff = (tb, ta) => {
  let i = 0; while (i < tb.length && tb[i] === ta[i]) i++;
  let j = 0; while (j < tb.length - i && j < ta.length - i && tb[tb.length - 1 - j] === ta[ta.length - 1 - j]) j++;
  const cut = (t, end) => t.slice(Math.max(0, i - 160), Math.min(end + 160, i + 1500));
  return { before: cut(tb, tb.length - j), after: cut(ta, ta.length - j), at: i, lengths: `${tb.length} → ${ta.length} characters` };
};
const envOnly = [];
for (const [fb, fa, tb, ta] of differ) {
  const w = firstDiff(unhash(tb), unhash(ta));
  fs.appendFileSync(path.join(out, 'differences.txt'), `=== ${fb} → ${fa} (${w.lengths}; first difference at character ${w.at}, hashed names written as -#)\n--- before\n${w.before}\n--- after\n${w.after}\n\n`);
  if (fb.endsWith('.css')) continue;
  // A script may differ by settings names the build no longer writes (REMOVED_ENV_NAMES): taken out of the
  // before side as name:"value" pairs of the settings object, it must then be identical.
  const names = (process.env.REMOVED_ENV_NAMES ?? '').split(',').filter(Boolean);
  if (names.length) {
    let without = unhash(tb);
    const counts = names.map(n => { const re = new RegExp(`,?${n}:"[^"]*"`, 'g'); const c = (without.match(re) ?? []).length; without = without.replace(re, ''); return c; });
    if (without === unhash(ta)) { envOnly.push(`${fb}: ${counts.reduce((a, b) => a + b, 0)} pairs taken out (${names.filter((_, i) => counts[i]).join(', ')})`); continue; }
  }
  fail(`${fb} differs in its content, not only in the names it refers to (differences.txt)`);
}
if (envOnly.length) say(`Scripts that differ only by the settings names taken out: ${envOnly.join('; ')}.`);
const cssPairs = differ.filter(([fb]) => fb.endsWith('.css'));
fs.writeFileSync(path.join(out, 'names-only.txt'), namesOnly.map(([b, a]) => `${b} → ${a}`).join('\n') + '\n');
say(`Built files: ${before.size} before, ${after.size} after. ${sameBytes.length} byte-identical under the same name; ${namesOnly.length} identical but for the hashed names of built files they refer to (names-only.txt); ${differ.length} with different content (${differ.map(([fb]) => fb).join(', ') || 'none'}); ${gonePublic.length} removed public files no longer copied.`);
const cssBefore = cssPairs.map(([fb]) => fb), cssAfter = cssPairs.map(([, fa]) => fa);

// 2. The stylesheet, declaration by declaration, each with the rules and at-rules it sits in.
// The minifier joins rules with the same declarations into one rule with a selector list (".a,.b{color:…}"),
// so when ".b" goes, ".a" stands alone: each selector of a list is read as an entry of its own.
const splitList = sel => { const out = []; let depth = 0, cur = '';
  for (let i = 0; i < sel.length; i++) { const c = sel[i];
    if (c === '\\') { cur += c + sel[++i]; continue; }
    if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c; }
  out.push(cur.trim()); return out; };
function entries(file) {
  const list = [];
  const paths = n => { let ps = ['']; const chain = []; for (let x = n.parent; x && x.type !== 'root'; x = x.parent) chain.unshift(x);
    for (const x of chain) { const parts = x.type === 'rule' ? splitList(x.selector) : [`@${x.name} ${x.params}`]; ps = ps.flatMap(p => parts.map(q => p ? `${p} ⟩ ${q}` : q)); }
    return ps; };
  const add = (n, text) => { for (const where of paths(n)) list.push({ where, text, key: `${where} ⟩ ${text}` }); };
  postcss.parse(fs.readFileSync(file, 'utf8')).walk(n => {
    if (n.type === 'decl') add(n, `${n.prop}:${n.value}${n.important ? '!important' : ''}`);
    else if (n.type === 'atrule' && !n.nodes) add(n, `@${n.name} ${n.params};`);
    else if ((n.type === 'rule' || n.type === 'atrule') && n.nodes && n.nodes.length === 0) add(n, `${n.type === 'rule' ? n.selector : `@${n.name} ${n.params}`} {}`);
  });
  // Within one rule, every declaration of its first selector, then of its second, and so on.
  const rank = new Map(); list.forEach((e, i) => rank.set(e, i));
  return list;
}
const eb = [], ea = [], removed = [];
for (let n = 0; n < cssBefore.length; n++) {
  const xb = entries(path.join(beforeDist, cssBefore[n])), xa = entries(path.join(afterDist, cssAfter[n]));
  const gone = [];
  let j = 0;
  for (const e of xb) { if (j < xa.length && xa[j].key === e.key) j++; else gone.push(e); }
  if (j !== xa.length) {
    // Where the order differs: every entry after that is not in its place, with where it stood before.
    const posB = new Map(); xb.forEach((e, i) => { if (!posB.has(e.key)) posB.set(e.key, []); posB.get(e.key).push(i); });
    const lines = [];
    let last = -1;
    xa.forEach((e, i) => {
      const at = (posB.get(e.key) ?? []).find(p => p > last);
      if (at === undefined) lines.push(`after #${i}: ${e.key}  ← ${posB.has(e.key) ? `before only at #${posB.get(e.key).join(', #')}, earlier than the entry above` : 'not in the stylesheet before'}`);
      else last = at;
    });
    fs.writeFileSync(path.join(out, `order-${n}.txt`), lines.join('\n') + '\n');
    for (const l of lines.slice(0, 40)) say(`  ${l}`);
  }
  if (j !== xa.length) fail(`${cssAfter[n]} is not ${cssBefore[n]} with removals only: entry ${j + 1} of ${xa.length} after ("${xa[j].key}") is not found in order`);
  else say(`${cssBefore[n]} → ${cssAfter[n]}: ${xb.length} declarations before, ${xa.length} after; every one after is unchanged and in the same order; ${gone.length} removed, none added or changed.`);
  eb.push(...xb); ea.push(...xa); removed.push(...gone);
}
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
// The notes (docs/ and Markdown) may name a removed rule while describing the change; they are not read by any page.
const files = execSync('git ls-files', { cwd: afterTree, encoding: 'utf8' }).split('\n').filter(f => f && !f.endsWith('package-lock.json') && !f.startsWith('docs/') && !f.endsWith('.md') && f !== 'scripts/compare-builds.mjs' && !/\.(png|jpe?g|webp|gif|ico|pdf|docx|xlsx|pptx|woff2?|ttf|otf|zip|gz|mp3|wav|m4a|webm|mp4)$/i.test(f));
const texts = files.map(f => [f, fs.readFileSync(path.join(afterTree, f), 'utf8')]);
say(`Searched: ${texts.length} files of the tree after (everything tracked but pictures, documents, the notes and the lockfile).`);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const CLASS_CHAR = 'A-Za-z0-9_:\\[\\]\\-/.%#!()\'"=,&*>+~';
const found = [], ownRules = [];
for (const name of lostClasses) {
  // A class name as Tailwind reads it from source: not part of a longer candidate.
  const re = new RegExp(`(?<![${CLASS_CHAR.replace(/'|"/g, '')}])${esc(name)}(?![A-Za-z0-9_\\-/\\[\\]])`);
  for (const [f, t] of texts) if (re.test(t)) (f === 'index.css' ? ownRules : found).push(`class ${name} in ${f}: ${t.split('\n').filter(l => re.test(l)).map(l => l.trim()).join(' | ')}`);
}
for (const v of lostVars) for (const [f, t] of texts) if (new RegExp(`${esc(v)}(?![A-Za-z0-9_-])`).test(t)) found.push(`variable ${v} in ${f}`);
fs.writeFileSync(path.join(out, 'names-found.txt'), [...found, '--- named only in index.css\'s own rules:', ...ownRules].join('\n') + '\n');
// A removed name that appears as a word somewhere (an element called header, a test id, a comment) can only
// keep a removed rule alive if every class that rule needs is in what stays: so for each removed selector,
// at least one of its classes must appear nowhere. That class decides it; it is listed beside the rule.
const wordHits = new Set(found.filter(l => l.startsWith('class ')).map(l => l.split(' ')[1]));
const varHits = found.filter(l => l.startsWith('variable '));
const decided = [], open = [];
const anyHit = new Map();
const hasWord = c => {
  if (!anyHit.has(c)) {
    const re = new RegExp(`(?<![${CLASS_CHAR.replace(/'|"/g, '')}])${esc(c)}(?![A-Za-z0-9_\\-/\\[\\]])`);
    anyHit.set(c, texts.some(([f, t]) => f !== 'index.css' && re.test(t)));
  }
  return anyHit.get(c);
};
for (const where of new Set(removed.map(e => e.where))) {
  if (keptWhere.has(where)) continue; // the rule stays and lost declarations only: the variables check covers it
  const frames = where.match(/^@keyframes ([A-Za-z0-9_-]+)/)?.[1];
  if (frames) {
    // A removed animation: no kept rule may name it, and no code may.
    // tailwind.config.js may define an animation of the same name; it reaches the page only through the class
    // animate-<name>, so that class must appear nowhere either.
    const inCode = texts.some(([f, t]) => f !== 'index.css' && f !== 'tailwind.config.js' && new RegExp(`(?<![A-Za-z0-9_-])${esc(frames)}(?![A-Za-z0-9_-])`).test(t));
    const named = ea.some(e => new RegExp(`(?<![A-Za-z0-9_-])${esc(frames)}(?![A-Za-z0-9_-])`).test(e.text)) || inCode || hasWord(`animate-${frames}`);
    if (named) open.push(where); else decided.push(`${where}  ← the animation ${frames} is named by no kept rule and no code`);
    continue;
  }
  const leaf = where.split(' ⟩ ').filter(p => !p.startsWith('@'));
  const need = [...new Set(leaf.flatMap(p => [...classes(p)]))];
  if (!need.length) { open.push(where); continue; }
  const absent = need.filter(c => !hasWord(c));
  if (absent.length) decided.push(`${where}  ← needs .${absent[0]}, which nothing that stays carries`); else open.push(where);
}
fs.writeFileSync(path.join(out, 'removed-rules-decided.txt'), decided.join('\n') + '\n');
if (open.length) fail(`${open.length} removed rules need only classes that appear in what stays: ${open.slice(0, 10).join('; ')}`);
if (varHits.length) fail(`${varHits.length} removed variables appear in what stays (names-found.txt)`);
const plain = lostClasses.filter(c => !wordHits.has(c));
say(`Of the ${lostClasses.length} class names the stylesheet lost, ${plain.length} appear nowhere in what stays, domain/ included; ${wordHits.size} appear only as other words (${[...wordHits].join(', ')}), and every removed rule also needs a class that nothing carries (removed-rules-decided.txt). No removed variable appears anywhere.`);
if (ownRules.length) say(`Named only inside index.css's own rules: ${ownRules.map(l => l.split(':')[0]).join('; ')}.`);

// 4. No code builds a class name from parts: for every removed class, no prefix of it ending in "-" or ":"
// is followed by an interpolation or joined with "+" anywhere in the tree after.
const parts = [];
for (const name of lostClasses) {
  // Prefixes that a template could end with: at least two letters before the cut ("bg-", "text-amber-").
  const cuts = [...name.matchAll(/[-:]/g)].map(m => name.slice(0, m.index + 1)).filter(p => /[A-Za-z]{2}[^]*[-:]$/.test(p.replace(/^-/, '')));
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
