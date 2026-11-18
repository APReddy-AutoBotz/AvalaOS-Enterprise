// Reads `npm audit --json` (all packages) and `npm audit --omit=dev --json` (what the site and the server
// functions ship) and says, by severity, what the registry's advisories say about the locked packages.
// Fails when anything shipped is high or critical, so a new warning is seen on the pull request that brings
// it, and on the weekly run for one published later. Package 13 A of docs/next-plan.md (18 November 2026).
//
//   node scripts/audit-summary.mjs <all.json> <shipped.json>
import fs from 'node:fs';

const LEVELS = ['critical', 'high', 'moderate', 'low', 'info'];
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const [all, shipped] = process.argv.slice(2).map(read);
if (!all || !shipped) { console.log('The registry could not be read; nothing to say.'); process.exit(1); }

const counts = a => LEVELS.map(l => `${a.metadata?.vulnerabilities?.[l] ?? 0} ${l}`).join(', ');
const rows = a => Object.values(a.vulnerabilities ?? {}).map(v => ({
  name: v.name, severity: v.severity, direct: v.isDirect,
  fix: v.fixAvailable === true ? 'a fix within the allowed versions' : v.fixAvailable ? `a fix by moving ${v.fixAvailable.name} to ${v.fixAvailable.version}${v.fixAvailable.isSemVerMajor ? ' (a major version)' : ''}` : 'no fix yet',
  via: (v.via ?? []).map(x => typeof x === 'string' ? x : x.title).filter(Boolean).slice(0, 2).join('; '),
})).sort((a, b) => LEVELS.indexOf(a.severity) - LEVELS.indexOf(b.severity) || a.name.localeCompare(b.name));

const lines = [
  `All packages: ${counts(all)}.`,
  `Shipped (without the tools used only to build and test): ${counts(shipped)}.`,
  '',
  '| Package | Severity | Shipped | Direct | Fix | Advisory |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows(all).map(r => `| ${r.name} | ${r.severity} | ${shipped.vulnerabilities?.[r.name] ? 'yes' : 'no'} | ${r.direct ? 'yes' : 'no'} | ${r.fix} | ${r.via} |`),
];
const text = lines.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Dependency check\n\n${text}\n`);
const bad = (shipped.metadata?.vulnerabilities?.critical ?? 0) + (shipped.metadata?.vulnerabilities?.high ?? 0);
if (bad) { console.log(`\n${bad} high or critical in what is shipped.`); process.exit(1); }
