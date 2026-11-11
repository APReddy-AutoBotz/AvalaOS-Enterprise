// Scores a candidate Process Model against a corpus case and prints the scorecard.
//
//   node eval/run.ts ap-invoice                      score the gold against itself (integrity check)
//   node eval/run.ts ap-invoice path/to/model.json   score an extraction result
//   add --json for machine-readable output, --strict to exit 1 when a target fails
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { ProcessModel } from '../domain/processModel/types.ts';
import { score } from './scorer.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Reads one entry from a zip archive (enough for .docx; no dependency). */
export function readZipEntry(buf: Buffer, name: string): Buffer | null {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const runText = (xml: string) => decode([...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(''));

/** Plain text of a .docx: paragraphs on lines, table rows as "cell | cell". */
export function docxText(buf: Buffer): string {
  const xml = readZipEntry(buf, 'word/document.xml')?.toString('utf8') ?? '';
  const withTables = xml.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, row =>
    '<w:p><w:t>' + [...row.matchAll(/<w:tc>([\s\S]*?)<\/w:tc>/g)].map(c => runText(c[1].replace(/<\/w:p>/g, ' '))).map(t => t.trim()).join(' | ').replace(/</g, '&lt;') + '</w:t></w:p>');
  return withTables.split('</w:p>').map(runText).join('\n');
}

export function sourceText(file: string): string | undefined {
  const ext = path.extname(file).toLowerCase();
  if (['.vtt', '.srt', '.txt', '.md'].includes(ext)) return fs.readFileSync(file, 'utf8');
  if (ext === '.drawio') return [...fs.readFileSync(file, 'utf8').matchAll(/value="([^"]*)"/g)].map(m => decode(m[1])).join('\n');
  if (ext === '.docx') return docxText(fs.readFileSync(file));
  return undefined; // images: excerpts cannot be checked as text
}

export function loadCase(name: string) {
  const dir = path.join(here, 'corpus', name);
  const gold = JSON.parse(fs.readFileSync(path.join(dir, 'expected.model.json'), 'utf8')) as ProcessModel;
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8')) as Record<string, string>;
  const texts: Record<string, string> = {};
  for (const [id, file] of Object.entries(manifest)) {
    const t = sourceText(path.join(dir, 'sources', file));
    if (t !== undefined) texts[id] = t;
  }
  return { gold, texts, manifest };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const [caseName = 'ap-invoice', candidatePath] = args.filter(a => !a.startsWith('--'));
  const { gold, texts } = loadCase(caseName);
  const candidate = candidatePath ? (JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as ProcessModel) : gold;
  const card = score(gold, candidate, texts);
  if (args.includes('--json')) {
    console.log(JSON.stringify(card, null, 2));
  } else {
    console.log(`Case: ${caseName}${candidatePath ? '' : ' (gold scored against itself)'}\n`);
    for (const t of card.targetResults) console.log(`${t.pass ? 'PASS' : 'FAIL'}  ${t.name.padEnd(20)} ${t.name === 'apiOverclaims' ? t.value : pct(t.value)}  (target ${t.name === 'apiOverclaims' ? `<= ${t.target}` : pct(t.target)})`);
    console.log(`\nAlso: rules ${pct(card.ruleRecall)}, exceptions ${pct(card.exceptionRecall)}, metrics ${pct(card.metricRecall)}, conflicts ${pct(card.conflictRecall)}, provenance ${pct(card.provenanceRate)}, excerpts checked ${card.excerptsChecked}`);
    for (const [label, list] of [['Missed steps', card.missedSteps], ['Extra steps', card.extraSteps], ['Unmatched roles and systems', card.unmatchedEntities], ['API overclaims', card.overclaims], ['Unverified excerpts', card.unverifiedExcerpts.map(u => `${u.sourceId}: ${u.excerpt}`)]] as const)
      if (list.length) console.log(`\n${label}:\n${list.map(x => `  - ${x}`).join('\n')}`);
  }
  if (args.includes('--strict') && !card.pass) process.exit(1);
}
