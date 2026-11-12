import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { emptyModel } from '../processModel/empty.ts';
import { deriveRequirements } from './derive.ts';
import { editRequirement, reconcile, RequirementError, revertRequirement } from './register.ts';
import { buildFrd } from '../docs/frd.ts';
import { buildBrd } from '../docs/brd.ts';
import { toMarkdown } from '../docs/markdown.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const derive = (m: ProcessModel) => deriveRequirements(m, assessProcess(m));
const FILLER = /\b(TBD|lorem|placeholder|to be decided|N\/A|etc\.)/i;

test('derivation: every FR links to at least one step or exception; rules become BRs; controls become NFRs; keys are unique', () => {
  const d = derive(gold);
  const keys = d.map(r => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(d.filter(r => r.kind === 'FR').every(r => r.stepIds.length || r.exceptionIds.length));
  assert.equal(d.filter(r => r.category === 'rule').length, gold.rules.length);
  assert.equal(d.filter(r => r.kind === 'NFR').length, gold.controls.length);
  assert.equal(d.filter(r => r.category === 'exception').length, gold.exceptions.length);
  const a = assessProcess(gold);
  const auto = a.steps.filter(s => !s.alreadyAutomated && s.winner !== 'human').map(s => s.stepId);
  assert.deepEqual(d.filter(r => r.category === 'step').map(r => r.stepIds[0]).sort(), [...auto].sort());
  for (const r of d) assert.doesNotMatch(r.statement, FILLER);
  assert.ok(d.filter(r => r.category === 'step').every(r => /^The solution shall /.test(r.statement)));
});

test('an empty model derives nothing and invents nothing', () => {
  assert.deepEqual(derive(emptyModel('Claims intake')), []);
});

test('IDs are given once and never reused; an edited FR survives regeneration; a removed step marks its FR "source removed"', () => {
  const first = reconcile(derive(gold), []);
  assert.equal(first.changed.length, first.requirements.length);
  assert.ok(first.requirements.every(r => /^(BR|FR|NFR)-\d{3}$/.test(r.code)));
  const fr = first.requirements.find(r => r.category === 'step')!;
  const edited = editRequirement(fr, { title: 'Validate totals', statement: 'The solution shall check the invoice totals against the PO.', priority: 'must', acceptance: [{ given: 'an invoice', when: 'it is checked', then: 'differences are flagged' }] });
  const stored = first.requirements.map(r => (r.code === fr.code ? edited : r));

  // Regenerate unchanged: nothing changes, the edit stays.
  const again = reconcile(derive(gold), stored);
  assert.equal(again.changed.length, 0);
  assert.equal(again.requirements.find(r => r.code === fr.code)!.statement, 'The solution shall check the invoice totals against the PO.');

  // Remove the step: its FR is kept as source removed; a new step gets a new number, never the old one.
  const stepId = fr.stepIds[0];
  const m2: ProcessModel = structuredClone(gold);
  m2.steps = m2.steps.filter(s => s.id !== stepId);
  m2.flows = m2.flows.filter(f => f.from !== stepId && f.to !== stepId);
  for (const e of m2.exceptions) e.stepIds = e.stepIds.filter(id => id !== stepId);
  for (const c of m2.controls) c.stepIds = c.stepIds.filter(id => id !== stepId);
  const after = reconcile(deriveRequirements(m2, assessProcess(m2)), stored);
  const gone = after.requirements.find(r => r.code === fr.code)!;
  assert.equal(gone.state, 'source_removed');
  assert.equal(gone.statement, 'The solution shall check the invoice totals against the PO.');
  const back = reconcile(derive(gold), after.requirements);
  assert.equal(back.requirements.find(r => r.code === fr.code)!.state, 'active');

  const maxFr = Math.max(...first.requirements.filter(r => r.kind === 'FR').map(r => Number(r.code.slice(3))));
  const m3: ProcessModel = structuredClone(m2);
  m3.exceptions.push({ id: 'ex-new', kind: 'business', name: 'Duplicate invoice', trigger: 'The invoice number was already posted', stepIds: [], handling: 'Reject it', sources: [], status: 'user_confirmed' } as any);
  const withNew = reconcile(deriveRequirements(m3, assessProcess(m3)), after.requirements);
  const added = withNew.requirements.find(r => r.key === 'exception:ex-new')!;
  assert.equal(Number(added.code.slice(3)), maxFr + 1);

  // Revert: the derived wording returns.
  const reverted = reconcile(derive(gold), stored.map(r => (r.code === fr.code ? revertRequirement(r) : r)));
  assert.equal(reverted.requirements.find(r => r.code === fr.code)!.statement, fr.statement);
});

test('edit validation: title, statement and complete Given/When/Then are required', () => {
  const r = reconcile(derive(gold), []).requirements[0];
  assert.throws(() => editRequirement(r, { title: '', statement: 'x', priority: null, acceptance: [] }), RequirementError);
  assert.throws(() => editRequirement(r, { title: 'x', statement: 'x', priority: null, acceptance: [{ given: 'a', when: '', then: 'c' }] }), RequirementError);
});

test('FRD: one card per FR with acceptance criteria, interfaces, traceability; missing NFR topics are open questions', () => {
  const m = gold;
  const reqs = reconcile(derive(m), []).requirements;
  const input = { model: m, assessment: assessProcess(m), decisions: emptyDecisions(), sources: [], requirements: reqs, revision: { label: 'Working draft', state: 'working' as const, date: '12 November 2026' } };
  const d = buildFrd(input);
  const md = toMarkdown(d);
  const frs = reqs.filter(r => r.kind === 'FR');
  for (const r of frs) assert.ok(d.sections.some(s => s.title === `${r.code} ${r.title}`), r.code);
  assert.match(md, /Traceability/);
  assert.match(md, /Interface requirements/);
  assert.doesNotMatch(md, FILLER);
  assert.ok(d.openItems.some(o => /priority of FR-/.test(o.text)));
  const closing = d.sections.at(-1)!.blocks.find(b => b.kind === 'table') as any;
  assert.equal(closing.rows.length, d.openItems.length);
  // The BRD lists the business requirements from the same register.
  const brd = toMarkdown(buildBrd(input));
  for (const r of reqs.filter(x => x.kind === 'BR')) assert.ok(brd.includes(r.code), r.code);
});
