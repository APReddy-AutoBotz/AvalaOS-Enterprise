import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions, type Decisions } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { buildTests, testPack, testPackCsv } from './tests.ts';
import { toMarkdown } from './markdown.ts';
import type { DocInput } from './common.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const inputOf = (m: ProcessModel, decisions: Decisions = emptyDecisions()): DocInput => {
  const a = assessProcess(m, { decisions });
  return { model: m, assessment: a, decisions, sources: [], requirements: reconcile(deriveRequirements(m, a), []).requirements, revision: { label: 'Revision 1', state: 'approved', date: '15 November 2026' } };
};
const FILLER = /\b(TBD|lorem|placeholder|to be decided|N\/A|etc\.)/i;

test('the plan\'s proof on the sample: every functional requirement has a case, and every case states a requirement\'s criterion or its own statement', () => {
  const i = inputOf(gold);
  const pack = testPack(i);
  const frs = i.requirements!.filter(r => r.state === 'active' && r.kind === 'FR');
  assert.ok(pack.cases.length > 0);
  for (const r of frs) {
    const mine = pack.cases.filter(c => c.requirement === r.code);
    assert.equal(mine.length, Math.max(1, r.acceptance.length), `${r.code} has a case per criterion, or one`);
    if (!r.acceptance.length) {
      assert.equal(mine[0].expected, null, 'no expected result is made up');
      assert.ok(pack.noExpected.some(u => u.code === r.code), `${r.code} is listed with what is missing`);
    }
  }
  for (const c of pack.cases.filter(x => x.expected)) {
    const r = frs.find(x => x.code === c.requirement)!;
    const a = r.acceptance[Number(c.code.split('.').at(-1)) - 1];
    assert.ok(a, `${c.code} points at a criterion`);
    assert.ok(c.expected!.toLowerCase().includes(a.then.replace(/\.$/, '').toLowerCase()), `${c.code} expects what the criterion says`);
  }
  assert.ok(pack.cases.some(c => c.kind === 'exception'), 'exception paths are tested');
  assert.equal(new Set(pack.cases.map(c => c.code)).size, pack.cases.length, 'case numbers are unique');
});

test('the document: counts, the three kinds, requirements with no case, open items listed again; nothing filled in', () => {
  const d = buildTests(inputOf(gold));
  const md = toMarkdown(d);
  assert.doesNotMatch(md, FILLER);
  assert.equal(d.type, 'tests');
  assert.deepEqual(d.sections.filter(s => s.level === 1).map(s => s.title), ['About this test pack', 'Test cases', 'Cases at the AI steps', 'Cases with no expected result yet', 'Open items']);
  assert.match(md, /Proposed, not confirmed/);
  const closing = d.sections.at(-1)!.blocks.find(b => b.kind === 'table') as any;
  assert.equal(closing.rows.length, d.openItems.length);
});

test('cases at the agent\'s steps are marked, and the agent section asks for example cases', () => {
  const base = inputOf(gold);
  // A step the solution takes on whose requirement has criteria.
  const step = base.requirements!.find(r => r.category === 'step' && r.state === 'active' && r.acceptance.length)!.stepIds[0];
  const decisions: Decisions = { ...emptyDecisions(), overrides: { [step]: { stepId: step, approach: 'agent', rationale: 'Varies too much for fixed rules.', by: 'Analyst', at: '2026-11-15' } } };
  const i = inputOf(gold, decisions);
  const pack = testPack(i);
  const fr = i.requirements!.find(r => r.key === `step:${step}`)!;
  assert.ok(pack.cases.filter(c => c.requirement === fr.code).every(c => c.agent));
  assert.ok(pack.cases.some(c => c.agent));
  const d = buildTests(i);
  assert.ok(d.openItems.some(o => /past cases/.test(o.text)));
  // Without an agent step there are no agent cases, and the document says so.
  assert.equal(testPack(base).cases.filter(c => c.agent).length, 0);
  assert.match(toMarkdown(buildTests(base)), /No step is rated AI-assisted or agentic/);
  // The pack never calls an AI-assisted step "the agent's": the assessment keeps the two apart.
  assert.doesNotMatch(toMarkdown(d), /the agent's (steps|cases)/i);
});

test('the Excel file: a header and one row per case, readable as UTF-8 by Excel', () => {
  const pack = testPack(inputOf(gold));
  const text = testPackCsv(pack);
  assert.ok(text.startsWith('﻿Case,Kind,'));
  assert.equal(text.trimEnd().split('\r\n').length, pack.cases.length + 1);
});
