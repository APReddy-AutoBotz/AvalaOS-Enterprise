import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { triage } from './triage.ts';
import { buildPacks, packDocument, packItems, replyNotes } from './packs.ts';
import { toMarkdown } from '../docs/markdown.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const t = triage(gold, assessProcess(gold));
const packs = buildPacks(t, gold);

test('one pack per owner with questions; every triaged question is in exactly one pack, most decisive first', () => {
  assert.ok(packs.length >= 2);
  assert.equal(packs.reduce((n, p) => n + p.items.length, 0), t.items.length);
  for (const p of packs) {
    assert.ok(p.items.every(x => x.item.owner === p.owner));
    const g = p.items.map(x => ({ decides: 0, signoff: 1, detail: 2 })[x.item.group]);
    assert.deepEqual(g, [...g].sort());
    assert.match(p.items[0].ref, /^[BTF]1$/);
  }
  const it = packs.find(p => p.owner === 'it')!;
  const access = it.items.find(x => x.item.kind === 'access');
  if (access) assert.match(access.how, /can be used/);
});

test('the pack document has an empty answer column and no filler', () => {
  const p = packs[0];
  const d = packDocument(p, gold.meta.name, '12 November 2026');
  const tbl = d.sections[1].blocks.find(b => b.kind === 'table') as any;
  assert.equal(tbl.rows.length, p.items.length);
  assert.equal(tbl.columns.at(-1), 'Your answer');
  assert.ok(tbl.rows.every((r: any) => r.at(-1).text === ''));
  assert.doesNotMatch(toMarkdown(d), /TBD|lorem|placeholder/i);
});

test('a returned pack: answered rows (Word or Markdown) become notes; empty rows are skipped; a free-form reply is kept whole', () => {
  const p = packs[0];
  const [a, b] = p.items;
  const lines = [
    'Ref | Question | Why it matters | How to answer | Your answer',
    `${a.ref} | ${a.item.question} | x | ${a.how} | The AP Team Lead approves it.`,
    `${b.ref} | ${b.item.question} | x | ${b.how} | `,
    `| ${b.ref} | ${b.item.question} | x | ${b.how} | About 4,200 a month |`,
    'Z9 | not ours | x | y | z',
  ];
  const r = replyNotes(p, lines);
  assert.deepEqual(r.answered, [a.ref, b.ref]);
  assert.match(r.notes, new RegExp(`${a.ref}\\. [\\s\\S]*Answer: The AP Team Lead approves it\\.`));
  assert.match(r.notes, /Answer: About 4,200 a month/);
  const email = replyNotes(p, ['Hi, the approver is the AP Team Lead.', 'Thanks']);
  assert.deepEqual(email.answered, []);
  assert.match(email.notes, /approver is the AP Team Lead/);
  assert.equal(packItems(p, [a.ref]).length, 1);
  assert.equal(packItems(p).length, p.items.length);
});
