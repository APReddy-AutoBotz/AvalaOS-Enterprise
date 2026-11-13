import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { buildBrd } from './brd.ts';
import { buildPdd } from './pdd.ts';
import { buildFrd } from './frd.ts';
import { buildSdd } from './sdd.ts';
import { verifyExcerpts } from '../ai/gateway.ts';
import { draftNarrative, draftToHtml, generatedText, groundingIssues, handoffChecklist, modelFacts, overlaps, SECTION_BRIEF } from './narrative.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const a = assessProcess(gold);
const input: any = { model: gold, assessment: a, decisions: emptyDecisions(), sources: [], requirements: reconcile(deriveRequirements(gold, a), []).requirements, revision: { label: 'r', state: 'approved', date: 'd' } };
const docs = [buildBrd(input), buildPdd(input), buildFrd(input), buildSdd(input)];
const known = generatedText(docs);

test('across the generated documents: no ungrounded names or numbers, no filler, no overlap between documents', () => {
  for (const d of docs) for (const s of d.sections) for (const b of s.blocks) {
    if (b.kind !== 'paragraph') continue;
    assert.deepEqual(groundingIssues(b.text, gold, known), [], `${d.type} ${s.number}: ${b.text}`);
  }
  assert.deepEqual(overlaps(docs, gold), []);
});

test('grounding flags names, numbers and filler that are not in the process', () => {
  const issues = groundingIssues('The AP Clerk posts about 12,500 invoices a month in Oracle Fusion, a seamless experience. TBD.', gold, known);
  const kinds = issues.map(i => `${i.kind}:${i.text}`);
  assert.ok(kinds.includes('number:12,500'), kinds.join());
  assert.ok(kinds.some(k => k.startsWith('name:Oracle')), kinds.join());
  assert.ok(kinds.some(k => k.startsWith('filler:')), kinds.join());
  assert.ok(!kinds.some(k => k === 'name:AP Clerk'), 'a role in the model is not flagged');
  assert.deepEqual(groundingIssues(`Step 3 is done by the AP Clerk in SAP S/4HANA.`, gold, known), []);
  assert.deepEqual(groundingIssues('Cut the time from receipt to posting. Always. Every invoice counts.', gold, known), []);
});

test('the checklist covers the plan\'s seven checks and links each failure to the element to fix', () => {
  const c = handoffChecklist(gold, docs);
  assert.equal(c.length, 7);
  const roles = c.find(x => x.id === 'roles-systems')!;
  for (const f of roles.failures) assert.equal(f.target?.kind, 'step');
  const m2: ProcessModel = structuredClone(gold);
  m2.rules[0].action = '';
  m2.exceptions[0].routedToRoleId = undefined;
  const c2 = handoffChecklist(m2, docs);
  assert.equal(c2.find(x => x.id === 'rules')!.ok, false);
  assert.equal(c2.find(x => x.id === 'exceptions')!.failures[0].target?.id, m2.exceptions[0].id);
});

test('AI drafting: the AI gets only the model\'s facts; a sentence without a real quote is dropped; the draft is checked again', () => {
  const facts = modelFacts(gold);
  const segments = [SECTION_BRIEF('PDD', '2.1 Process overview', 'Say in a few sentences what the process is and who does it.'), ...facts].map(f => ({ id: f.id, text: f.text }));
  const step1 = facts.find(f => f.id.startsWith('f:step:'))!;
  const raw = { sentences: [
    { text: `The process starts when an invoice is logged.`, segmentId: step1.id, excerpt: step1.text.slice(0, 20) },
    { text: 'It saves 4,000 hours a year.', segmentId: step1.id, excerpt: 'saves 4,000 hours' },
    { text: 'Brief text.', segmentId: 'brief', excerpt: 'Document: PDD' },
  ] };
  const v = verifyExcerpts(raw, draftNarrative.verifyArrays, segments as any);
  assert.equal(v.dropped.length, 1);
  const d = draftToHtml(v.data, gold);
  assert.equal(d.sentences, 1);
  assert.match(d.html, /^<p>The process starts/);
  assert.deepEqual(d.issues, []);
});
