import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { emptyModel } from '../processModel/empty.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { automationUnits, buildSdd } from './sdd.ts';
import { buildPdd } from './pdd.ts';
import { toMarkdown } from './markdown.ts';
import type { DocInput } from './common.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const inputOf = (m: ProcessModel): DocInput => {
  const a = assessProcess(m);
  return { model: m, assessment: a, decisions: emptyDecisions(), sources: [], requirements: reconcile(deriveRequirements(m, a), []).requirements, revision: { label: 'Revision 1', state: 'approved', date: '13 November 2026' } };
};
const FILLER = /\b(TBD|lorem|placeholder|to be decided|N\/A|etc\.)/i;

test('automation units cover every automated step once, grouped by approach and main application', () => {
  const i = inputOf(gold);
  const units = automationUnits(i);
  const covered = units.flatMap(u => u.steps.map(s => s.id));
  assert.equal(new Set(covered).size, covered.length);
  const auto = i.assessment.steps.filter(s => !s.alreadyAutomated && s.winner !== 'human').map(s => s.stepId);
  assert.deepEqual([...covered].sort(), [...auto].sort());
  for (const u of units) assert.ok(u.steps.every(s => (s.systemIds[0] ?? '') === (u.steps[0].systemIds[0] ?? '')));
});

test('the SDD asserts nothing technical without a source: authentication, schedules and environments are open design decisions', () => {
  const d = buildSdd(inputOf(gold));
  const md = toMarkdown(d);
  assert.doesNotMatch(md, FILLER);
  assert.match(md, /Open design decisions/);
  assert.ok(d.openItems.some(o => /sign in to SAP S\/4HANA/.test(o.text)));
  assert.ok(d.openItems.some(o => /When and how often does AU-01 run/.test(o.text)));
  const closing = d.sections.at(-1)!.blocks.find(b => b.kind === 'table') as any;
  assert.equal(closing.rows.length, d.openItems.length);
  assert.ok(closing.rows.some((r: any) => r[2].text.includes('Service account')));
  // Distinct from the PDD: no step table repeated.
  assert.equal(d.sections.some(s => s.blocks.some(b => b.kind === 'table' && b.caption === 'Detailed As-Is steps')), false);
  assert.ok(buildPdd(inputOf(gold)).sections.length > 0);
});

test('an empty model gives an SDD that says there is nothing to design, with no filler', () => {
  const d = buildSdd(inputOf(emptyModel('Claims intake')));
  const md = toMarkdown(d);
  assert.match(md, /nothing to design/);
  assert.doesNotMatch(md, FILLER);
});
