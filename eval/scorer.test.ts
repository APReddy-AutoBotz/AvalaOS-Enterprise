import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ProcessModel } from '../domain/processModel/types.ts';
import { docxText, loadCase } from './run.ts';
import { score, similarity } from './scorer.ts';

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
