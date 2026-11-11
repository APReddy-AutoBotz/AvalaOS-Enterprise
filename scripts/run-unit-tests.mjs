// Runs every unit test listed in scripts/unit-tests.json, one after another.
// The underlying runners share compile output folders, so tests must not run in parallel.
//
//   npm run test:unit                 run everything
//   npm run test:unit -- scoring      run entries whose name contains "scoring"
//   npm run test:unit -- --list       print the entry names and exit
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const entries = Object.entries(JSON.parse(fs.readFileSync(new URL('./unit-tests.json', import.meta.url), 'utf8')));
const args = process.argv.slice(2);

if (args.includes('--list')) {
  for (const [name] of entries) console.log(name);
  process.exit(0);
}

const filters = args.filter(arg => !arg.startsWith('--'));
const selected = filters.length
  ? entries.filter(([name]) => filters.some(filter => name.includes(filter)))
  : entries;

if (selected.length === 0) {
  console.error(`No unit test entry matches: ${filters.join(', ')}`);
  process.exit(1);
}

const failed = [];
const startedAt = Date.now();
for (const [name, command] of selected) {
  console.log(`\n=== ${name} ===`);
  try {
    execSync(command, { stdio: 'inherit' });
  } catch {
    failed.push(name);
  }
}

const seconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`\n${selected.length - failed.length} of ${selected.length} unit test entries passed in ${seconds}s.`);
if (failed.length) {
  console.error(`Failed:\n${failed.map(name => `  - ${name}`).join('\n')}`);
  process.exit(1);
}
