// The test pack (docs/effort-first-plan.md, part F): test cases derived by rule from the requirements
// register, so nothing is tested that no requirement states. One case per acceptance criterion of each
// active functional requirement (steps the solution takes on, human checks, exception paths); cases at
// the agent's steps are marked, and the hand-overs there say the agent must stop and hand over. A
// requirement with no criterion yet gets no case: it is listed with why, as an open item. The case
// number is the requirement's code and the criterion's place (FR-003.1), so it stays stable as the
// register keeps its codes. Rendered as a document tree (screen, Word, Markdown) and as CSV for Excel.
import type { ProcessModel } from '../processModel/types.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import type { Requirement } from '../requirements/register.ts';
import { csv } from '../workitems/export.ts';
import { agentSteps } from './agent.ts';
import { DocBuilder, missing, NOT_PROVIDED, type DocTree } from './tree.ts';
import type { DocInput } from './common.ts';

export type CaseKind = 'step' | 'human' | 'exception';
export const CASE_KIND_LABEL: Record<CaseKind, string> = { step: 'What the solution does', human: 'A person checks or decides', exception: 'Exception path' };

export interface TestCase {
  /** The requirement's code and the criterion's place: "FR-003.1". */
  code: string;
  kind: CaseKind;
  /** At a step the agent takes on (part E). */
  agent: boolean;
  /** What is tested: the requirement's title. */
  title: string;
  requirement: string;
  /** Prepare, do, check: the criterion's given, when and then. */
  steps: [string, string, string];
  /** The inputs of the steps the requirement covers; empty when none is recorded. */
  data: string[];
  /** Null when the requirement has no criterion yet, so the expected result is not known. */
  expected: string | null;
  /** Where the case came from, in words. */
  source: string;
}

export interface TestPack {
  cases: TestCase[];
  /** Requirements whose case has no expected result yet (no acceptance criterion), with why. */
  noExpected: { code: string; title: string; why: string }[];
}

const sentence = (s: string) => { const t = s.trim().replace(/\.$/, ''); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : ''; };
const KIND_OF: Partial<Record<Requirement['category'], CaseKind>> = { step: 'step', human: 'human', exception: 'exception' };

export function testPack(input: DocInput): TestPack {
  const m: ProcessModel = input.model;
  const order = orderedSteps(m);
  const no = (id: string) => order.findIndex(s => s.id === id) + 1;
  const agentIds = new Set(agentSteps(input).map(a => a.step.id));
  const frs = (input.requirements ?? []).filter(r => r.state === 'active' && r.kind === 'FR');
  const cases: TestCase[] = [];
  const noExpected: TestPack['noExpected'] = [];
  for (const r of frs) {
    const kind = KIND_OF[r.category] ?? 'step';
    const data = [...new Set(r.stepIds.flatMap(id => m.steps.find(s => s.id === id)?.inputs ?? []))];
    const agent = r.stepIds.some(id => agentIds.has(id));
    if (!r.acceptance.length) {
      // Still one case, from the requirement's own statement; what it should produce is an open item.
      const trigger = r.exceptionIds.map(id => m.exceptions.find(e => e.id === id)?.trigger).find(Boolean);
      const at = r.stepIds.filter(id => no(id) > 0).map(id => `step ${no(id)} ("${m.steps.find(s => s.id === id)!.name}")`);
      const why = r.gaps?.[0] ?? 'Its acceptance criterion is not written yet.';
      cases.push({
        code: `${r.code}.1`, kind, agent, title: r.title, requirement: r.code,
        steps: [sentence(`Prepare: ${trigger ?? (at.length ? `the case reaches ${at.join(' and ')}` : 'a case of the process')}`), sentence(`Do: ${r.statement.replace(/^The solution shall /, 'the solution should ')}`), 'Check: the expected result is not recorded yet.'],
        data, expected: null, source: `${r.code}, which has no acceptance criterion yet`,
      });
      noExpected.push({ code: r.code, title: r.title, why });
      continue;
    }
    r.acceptance.forEach((a, i) => cases.push({
      code: `${r.code}.${i + 1}`, kind, agent, title: r.title, requirement: r.code,
      steps: [sentence(`Prepare: ${a.given}`), sentence(`Do: ${a.when}`), sentence(`Check: ${a.then}`)],
      data, expected: sentence(a.then),
      source: `Acceptance criterion ${i + 1} of ${r.code}${r.edited ? ' (edited by a person)' : ''}`,
    }));
  }
  return { cases, noExpected };
}

/** The pack as a document: about it, the cases, the agent's cases, requirements with no case, open items. */
export function buildTests(input: DocInput): DocTree {
  const m = input.model;
  const pack = testPack(input);
  const steps = orderedSteps(m);
  const b = new DocBuilder();
  const frCount = new Set(pack.cases.map(c => c.requirement)).size;

  b.section('1', 'About this test pack', 1);
  b.paragraph(`Test cases for the solution in "${m.meta.name}": one for each acceptance criterion of its functional requirements (the FRD), and one for each requirement that has no criterion yet, whose expected result is then not provided (section 4). Nothing is tested that no requirement states.`);
  b.keyValue('The pack', [
    ['Test cases', String(pack.cases.length)],
    ['Functional requirements', String(frCount)],
    ['Cases with an expected result', `${pack.cases.filter(c => c.expected).length} of ${pack.cases.length}`],
    ['Exception paths', String(pack.cases.filter(c => c.kind === 'exception').length)],
    ['Checks by a person', String(pack.cases.filter(c => c.kind === 'human').length)],
    ['At the agent\'s steps', String(pack.cases.filter(c => c.agent).length)],
  ]);
  b.paragraph('Proposed, not confirmed: run the cases of each step first, then the exception paths and the checks by a person, then the whole process end to end with the business.');

  const table = (rows: typeof pack.cases) => rows.map(c => [c.code, c.title, c.steps.join(' '), c.data.join(', ') || missing(), c.expected ?? missing(), c.requirement]);
  const cols = ['Case', 'What is tested', 'Steps', 'Data', 'Expected result', 'Requirement'];

  b.section('2', 'Test cases', 1);
  (['step', 'human', 'exception'] as CaseKind[]).forEach((k, i) => {
    b.section(`2.${i + 1}`, CASE_KIND_LABEL[k]);
    b.table(CASE_KIND_LABEL[k], cols, table(pack.cases.filter(c => c.kind === k && !c.agent)), k === 'step' ? 'No step of the solution has an acceptance criterion yet.' : k === 'human' ? 'No check by a person is required.' : 'No exception path has an acceptance criterion yet.');
  });
  if (pack.cases.some(c => !c.data.length)) b.note('Which test data (example documents and records) is available for the cases with no data recorded?');

  b.section('3', 'The agent\'s cases', 1);
  const agentCases = pack.cases.filter(c => c.agent);
  if (agentCases.length) {
    b.paragraph('Cases at the steps the agent takes on (see the agent document). Those for a check by a person or an exception are where the agent must stop and hand the case over, not settle it alone.');
    b.table('At the agent\'s steps', cols, table(agentCases), '');
    b.open('Which past cases, with their known right outcomes, are added as examples for the agent, including ones it must refuse or hand over?');
  } else b.callout('No step is the agent\'s, so there are no agent cases.');

  b.section('4', 'Cases with no expected result yet', 1);
  b.table('No expected result yet', ['Requirement', 'What it covers', 'What is missing'], pack.noExpected.map(u => [u.code, u.title, u.why]), 'Every case has an expected result.');
  for (const u of pack.noExpected) b.note(`${u.code} (${u.title}): ${u.why}`);
  if (!steps.length) b.note('The process has no steps yet.');

  b.section('5', 'Open items', 1);
  b.table('Open items', ['#', 'Item', 'Raised in'], b.openItems.map((o, i) => [String(i + 1), o.text, o.section ?? '']), 'No open items.');

  return {
    type: 'tests', title: 'Test Pack', subtitle: m.meta.name,
    control: [['Process', m.meta.name], ['Revision', input.revision.label], ['Status', input.revision.state === 'approved' ? 'Approved' : 'Working draft'], ['Date', input.revision.date]].map(([key, value]) => ({ key, value })),
    sections: b.sections, openItems: b.openItems,
  };
}

/** The pack for Excel: one row per case, with what Excel and test tools need as columns. */
export function testPackCsv(pack: TestPack): string {
  return csv([
    ['Case', 'Kind', 'At the agent\'s steps', 'What is tested', 'Requirement', 'Prepare', 'Do', 'Check', 'Data', 'Expected result', 'Source'],
    ...pack.cases.map(c => [c.code, CASE_KIND_LABEL[c.kind], c.agent ? 'Yes' : 'No', c.title, c.requirement, c.steps[0], c.steps[1], c.steps[2], c.data.join('; ') || NOT_PROVIDED, c.expected ?? NOT_PROVIDED, c.source]),
  ]);
}

