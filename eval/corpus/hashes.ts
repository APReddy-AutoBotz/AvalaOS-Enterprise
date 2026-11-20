// Prints the SHA-256 of every corpus file, to paste into CORPUS_SHA256 in cases.ts: node eval/corpus/hashes.ts
import fs from 'node:fs';
import { CASES, GOLD, filesOf, sha256 } from './cases.ts';

for (const dir of new Set(Object.values(CASES).map(c => c.dir))) {
  console.log(`  '${dir}': {`);
  const all = new Set(Object.values(CASES).filter(c => c.dir === dir).flatMap(filesOf));
  const sorted = [...all].sort((a, b) => (a === GOLD ? 1 : b === GOLD ? -1 : a.localeCompare(b)));
  for (const f of sorted) console.log(`    '${f}': '${await sha256(fs.readFileSync(new URL(`./${dir}/${f}`, import.meta.url)))}',`);
  console.log('  },');
}
