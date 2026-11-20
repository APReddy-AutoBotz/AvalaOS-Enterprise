import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProcessModel } from '../domain/processModel/types.ts';
import { docxText, loadCase } from './run.ts';
import { matchByName, matchByNameOrText, score, similarity } from './scorer.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const { gold, texts } = loadCase('ap-invoice');
const clone = (): ProcessModel => structuredClone(gold);

test('the gold model scores 100% against itself, with every excerpt verified in its source', () => {
  const card = score(gold, gold, texts);
  assert.equal(card.pass, true);
  for (const k of ['stepRecall', 'stepPrecision', 'roleAccuracy', 'systemAccuracy', 'ruleRecall', 'exceptionRecall', 'metricRecall', 'openQuestionRecall', 'conflictRecall', 'verifiedExcerptRate'] as const)
    assert.equal(card[k], 1, k);
  assert.ok(card.excerptsChecked >= 80, `only ${card.excerptsChecked} excerpts checked`);
  assert.deepEqual(card.unverifiedExcerpts, []);
});

test('every excerpt in the whole gold file, not only scored elements, is found in its source', () => {
  const missing: string[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.sourceId === 'string' && typeof o.excerpt === 'string' && texts[o.sourceId] !== undefined) {
        const norm = (s: string) => s.replace(/\s+/g, ' ');
        if (!norm(texts[o.sourceId]).includes(norm(o.excerpt))) missing.push(`${o.sourceId}: ${o.excerpt}`);
      }
      Object.values(o).forEach(walk);
    }
  };
  walk(gold);
  assert.deepEqual(missing, []);
});

test('paraphrased step names still match', () => {
  assert.ok(similarity('Duplicate check', 'Check for duplicates') >= 0.5);
  const c = clone();
  c.steps.find(s => s.id === 's-dup')!.name = 'Duplicate check';
  c.steps.find(s => s.id === 's-miro')!.name = 'Enter invoice in MIRO';
  assert.equal(score(gold, c, texts).stepRecall, 1);
});

test('missing steps, wrong roles, overclaimed APIs, missing questions and invented excerpts are all caught', () => {
  const c = clone();
  c.steps = c.steps.filter(s => !['s-scan', 's-ticket', 's-credit'].includes(s.id));
  c.steps.find(s => s.id === 's-review')!.roleIds = ['r-clerk'];
  c.systems.find(s => s.id === 'sys-sap')!.access.find(a => a.name === 'API_SUPPLIERINVOICE_PROCESS_SRV')!.access = 'confirmed';
  c.openQuestions = c.openQuestions.slice(0, 5);
  c.rules[0].sources = [{ sourceId: 'sop', locator: {}, excerpt: 'Tolerance is ten percent for all vendors.' }];

  const card = score(gold, c, texts);
  assert.equal(card.pass, false);
  assert.equal(card.stepRecall, 18 / 21);
  assert.deepEqual(card.missedSteps.sort(), ['Raise vendor master request', 'Request credit note or revised invoice', 'Scan paper invoice']);
  assert.equal(card.roleAccuracy, 17 / 18);
  assert.equal(card.apiOverclaims, 1);
  assert.match(card.overclaims[0], /API_SUPPLIERINVOICE_PROCESS_SRV is reported/);
  assert.equal(card.openQuestionRecall, 0.5);
  assert.deepEqual(card.unverifiedExcerpts, [{ sourceId: 'sop', excerpt: 'Tolerance is ten percent for all vendors.' }]);
  const failed = card.targetResults.filter(t => !t.pass).map(t => t.name).sort();
  assert.deepEqual(failed, ['apiOverclaims', 'openQuestionRecall', 'stepRecall', 'verifiedExcerptRate']);
});

test('an invented system is reported for review', () => {
  const c = clone();
  c.systems.push({ id: 'sys-x', name: 'Coupa', kind: 'portal', inScope: true, access: [], status: 'inferred', sources: [] });
  assert.deepEqual(score(gold, c, texts).unmatchedEntities, ['system: Coupa']);
});

test('docx text keeps body paragraphs and joins table cells', () => {
  const text = docxText(fs.readFileSync(path.join(here, 'corpus/ap-invoice/sources/04-SOP-FIN-AP-004-vendor-invoice-processing.docx')));
  assert.match(text, /Vendor Invoice Processing \(India\)/);
  assert.match(text, /Up to 2,00,000 \| Cost Centre Owner/);
  assert.match(text, /6\.6 Enter PO invoices/);
});

// Rules and exceptions (owner, 20 November 2026): the better of the name against the gold's name and
// aliases, and the name with its trigger or condition against the gold's. The examples are answers of the
// single facts merge (the code before the reading split), copied from stored check runs.
const OLD_RULE = (goldItems: any[], cands: any[], extra: string) => {
  const withText = (xs: any[]) => xs.map(x => ({ id: x.id, name: `${x.name} ${x[extra] ?? ''}`, aliases: [x.name, ...(x.aliases ?? [])] }));
  return matchByName(withText(goldItems), withText(cands), 0.45);
};
const NEW_RULE = (goldItems: any[], cands: any[], extra: string) =>
  matchByNameOrText(goldItems.map(x => ({ id: x.id, name: x.name, text: x[extra] ?? '', aliases: x.aliases })), cands.map(x => ({ id: x.id, name: x.name, text: x[extra] ?? '' })), 0.45);

test('an exception named right is found however long its trigger (run 3304ce6c, 20 November 2026)', () => {
  const cand = { ...clone().exceptions[0], id: 'x-c',
    name: 'Missing or incorrect mandatory invoice fields',
    trigger: 'Invoice is incomplete/incorrect or missing legal name/GSTIN, vendor GSTIN, invoice number/date, PO number, HSN/SAC codes, or tax breakup.' };
  const goldItem = gold.exceptions.find(x => x.id === 'x-missing-field')!;
  assert.equal(OLD_RULE([goldItem], [cand], 'trigger').size, 0, 'the rule before scored it a miss');
  assert.equal(NEW_RULE([goldItem], [cand], 'trigger').get('x-missing-field'), 'x-c');
  // In the whole scorecard: every gold exception kept as it is, the missing-field one replaced by this answer.
  const m = clone();
  m.exceptions = m.exceptions.map(x => (x.id === 'x-missing-field' ? cand : x));
  assert.equal(score(gold, m, texts).exceptionRecall, 1);
});

test('the same holds for an exception whose name is a gold alias (run 3304ce6c: "Missing goods receipt")', () => {
  const cand = { ...clone().exceptions[0], id: 'x-c', name: 'Missing goods receipt', trigger: 'Invoice arrives/entered before GR is posted in SAP.' };
  const goldItem = gold.exceptions.find(x => x.id === 'x-no-gr')!;
  assert.equal(NEW_RULE([goldItem], [cand], 'trigger').get('x-no-gr'), 'x-c');
});

test('a rule is found on its name with its condition (run 85799b5d: the goods receipt reminder)', () => {
  const cand = { ...clone().rules[0], id: 'br-c', name: 'Missing goods receipt reminder', condition: 'No GR exists or nothing happens after requesting GR posting.' };
  const goldItem = gold.rules.find(x => x.id === 'br-gr-followup')!;
  assert.equal(OLD_RULE([goldItem], [cand], 'condition').size, 0, 'the rule before scored it a miss');
  assert.equal(NEW_RULE([goldItem], [cand], 'condition').get('br-gr-followup'), 'br-c');
});

test('nothing else moves: the threshold, one-to-one matching, and an unrelated exception still a miss', () => {
  const goldItems = gold.exceptions.filter(x => ['x-price', 'x-qty'].includes(x.id));
  // One joined answer can stand for only one of the two gold exceptions (run 9d6899d3's join).
  const joined = { id: 'x-c', name: 'Price or quantity variance outside tolerance', trigger: 'Invoice price or quantity differs from the PO or the goods receipt beyond tolerance.' };
  assert.equal(NEW_RULE(goldItems, [joined], 'trigger').size, 1);
  const unrelated = { id: 'x-d', name: 'Supplier invoice API not available', trigger: 'The API is not activated in S/4.' };
  assert.equal(NEW_RULE(gold.exceptions, [unrelated], 'trigger').size, 0);
  assert.equal(score(gold, gold, texts).ruleRecall, 1);
});
