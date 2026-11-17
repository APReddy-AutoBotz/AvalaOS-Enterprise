import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions, withOverride } from '../assess/decisions.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { deriveProposals } from '../workitems/derive.ts';
import type { Proposal } from '../workitems/register.ts';
import { testPack } from './tests.ts';
import { toMarkdown } from './markdown.ts';
import { buildEvidence, NOT_RECORDED, type EvidenceInput } from './evidence.ts';
import type { DocTree } from './tree.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const ANA = 'u-ana', BEN = 'u-ben';

function fixture(over: Partial<EvidenceInput> = {}): EvidenceInput {
  const m = gold;
  const step = assessProcess(m).steps.find(s => !s.alreadyAutomated)!;
  const decisions = withOverride(emptyDecisions(), step, { approach: step.winner === 'human' ? 'rpa' : 'human', rationale: 'The team wants a person here.', by: 'ana@example.com', at: '2026-11-14T10:00:00Z' });
  const assessment = assessProcess(m, { decisions });
  const requirements = reconcile(deriveRequirements(m, assessment), []).requirements;
  const base = { model: m, assessment, decisions, sources: [], requirements, revision: { label: 'Revision 2', state: 'approved' as const, date: '16 November 2026' } };
  const proposals: Proposal[] = deriveProposals(base, []).proposals.map((p, i) => ({
    key: p.key, type: p.type, parentKey: p.parentKey, title: p.title, description: p.description, acceptance: p.acceptance, stepIds: p.stepIds,
    requirements: p.requirements, state: i === 0 ? 'confirmed' : 'proposed', rejectedReason: null, edited: false, order: i, workItemId: i === 0 ? 'w1' : null,
  } as Proposal));
  return {
    ...base,
    revisions: [
      { revNo: 2, state: 'approved', createdAt: '2026-11-15T09:00:00Z', approvedAt: '2026-11-16T08:00:00Z', approvedBy: ANA },
      { revNo: 1, state: 'superseded', createdAt: '2026-11-12T09:00:00Z', approvedAt: '2026-11-13T08:00:00Z', approvedBy: 'u-gone' },
    ],
    revNo: 2,
    allSources: [
      { key: 'S1', title: 'Discovery call', kind: 'Call transcript', createdAt: '2026-11-12T08:00:00Z', passages: 120, archived: false },
      { key: 'S9', title: 'Old notes', kind: '', createdAt: '2026-11-12T08:05:00Z', passages: 4, archived: true },
    ],
    proposals, boardStatus: { w1: 'in_progress' }, testEdits: [],
    comments: [
      { id: 'c1', docType: 'pdd', sectionKey: 's-2-4', sectionTitle: 'Detailed As-Is steps', authorId: BEN, body: 'Step 4 misses the call-back.', createdAt: '2026-11-15T10:00:00Z', editedAt: null, resolvedAt: '2026-11-15T12:00:00Z', resolvedBy: ANA },
      { id: 'c2', docType: 'brd', sectionKey: 's-1', sectionTitle: 'Introduction', authorId: 'u-gone', body: 'Who signs this?', createdAt: '2026-11-15T11:00:00Z', editedAt: null, resolvedAt: null, resolvedBy: null },
    ],
    names: { [ANA]: 'Ana Rao', [BEN]: 'Ben Iyer' },
    ...over,
  };
}
const section = (d: DocTree, n: string) => d.sections.find(s => s.number === n)!;
const tableOf = (d: DocTree, n: string, caption?: string) => section(d, n).blocks.find(b => b.kind === 'table' && (!caption || b.caption === caption)) as Extract<DocTree['sections'][0]['blocks'][0], { kind: 'table' }>;
const kv = (d: DocTree, n: string) => Object.fromEntries((section(d, n).blocks.find(b => b.kind === 'keyValue') as any).rows.map((r: any) => [r.key, r.value.text]));

test('the pack has its eight sections, in order, built by rule from the record', () => {
  const d = buildEvidence(fixture());
  assert.equal(d.type, 'evidence');
  assert.deepEqual(d.sections.map(s => s.title), ['What this pack covers', 'The sources', 'Requirements and where each came from', 'From requirement to work to test', 'The test cases as they stand', 'Decisions people made', 'Review comments', 'What is not evidenced']);
  // 1: who approved and when; earlier approvals, a person no longer in the workspace not recorded.
  assert.equal(kv(d, '1')['Approved by'], 'Ana Rao');
  assert.equal(kv(d, '1')['Approved on'], '16 November 2026');
  assert.deepEqual(tableOf(d, '1').rows.map(r => r.map(c => c.text)), [['Revision 1', NOT_RECORDED, '13 November 2026']]);
  // 2: the sources, archived ones marked, a missing kind not recorded.
  assert.deepEqual(tableOf(d, '2').rows.map(r => r.map(c => c.text)), [
    ['Discovery call (S1)', 'Call transcript', '12 November 2026', '120', 'In use'], ['Old notes (S9)', NOT_RECORDED, '12 November 2026', '4', 'Archived']]);
  // 3: every active requirement, with what it came from and where in the sources.
  const active = fixture().requirements!.filter(r => r.state === 'active');
  const reqRows = tableOf(d, '3').rows;
  assert.equal(reqRows.length, active.length);
  const step1 = reqRows.find(r => r[2]!.text.startsWith('Step '))!;
  assert.ok(step1[3]!.text.length > 0);
  // 6: the decision with its reason; the person recorded by email address is not named.
  const dec = tableOf(d, '6').rows;
  assert.equal(dec.length, 1);
  assert.equal(dec[0]![3]!.text, 'The team wants a person here.');
  assert.equal(dec[0]![4]!.text, NOT_RECORDED);
  assert.equal(dec[0]![5]!.text, '14 November 2026');
  // 7: comments with who wrote and who resolved, by name only.
  const com = tableOf(d, '7').rows.map(r => r.map(c => c.text));
  assert.deepEqual(com.map(r => [r[0], r[1], r[3], r[5]]), [['BRD', 'Introduction', NOT_RECORDED, 'Open'], ['PDD', 'Detailed As-Is steps', 'Ben Iyer', 'Resolved by Ana Rao on 15 November 2026']]);
  // Nothing the record does not hold: no email address anywhere, no AI wording.
  assert.doesNotMatch(toMarkdown(d), /@|example\.com/);
});

test('every active functional requirement is in section 4, with its work, its status on the board and its tests', () => {
  const f = fixture();
  const d = buildEvidence(f);
  const frs = f.requirements!.filter(r => r.state === 'active' && r.kind === 'FR');
  assert.ok(frs.length > 20);
  const rows = tableOf(d, '4').rows;
  assert.equal(rows.length, frs.length);
  for (const r of frs) assert.ok(rows.some(x => x[0]!.text.startsWith(`${r.code}:`)), r.code);
  assert.ok(rows.some(x => /on the board: In progress/.test(x[1]!.text)));
  const cases = testPack(f).cases;
  for (const x of rows) if (!x[2]!.missing) assert.ok(x[2]!.text.split(', ').every(code => cases.some(c => c.code === code)));
  // The sample has requirements with no criterion yet: their test has no expected result, said plainly.
  assert.ok(rows.some(x => x[3]!.text.includes('The test has no expected result')));
});

test('a requirement with no test appears in section 8; a working draft says it is not evidence of an approved state', () => {
  const f = fixture();
  const fr = f.requirements!.find(r => r.state === 'active' && r.kind === 'FR')!;
  const only = testPack(f).cases.filter(c => c.requirement === fr.code);
  const d = buildEvidence({ ...f, testEdits: only.map(c => ({ caseCode: c.code, fields: {}, setAside: true, baseHash: null })) });
  const row = tableOf(d, '4').rows.find(x => x[0]!.text.startsWith(`${fr.code}:`))!;
  assert.match(row[3]!.text, /No test case/);
  assert.match(toMarkdown(d), new RegExp(`Functional requirements with no test case:[\\s\\S]*${fr.code}: `));
  assert.ok(tableOf(d, '5').rows.some(x => x[0]!.text === only[0]!.code && x[4]!.text === 'Set aside'));
  // From a working draft: said at the top, and nobody is named as approver.
  const draft = buildEvidence({ ...f, revision: { ...f.revision, state: 'working' }, revisions: [{ revNo: 3, state: 'working', createdAt: '2026-11-16T09:00:00Z', approvedAt: null, approvedBy: null }, ...f.revisions], revNo: 3 });
  const first = section(draft, '1').blocks[0]!;
  assert.equal(first.kind, 'callout');
  assert.match((first as any).text, /^Built from a working draft: this pack is not evidence of an approved state/);
  assert.equal(kv(draft, '1')['Approved by'], 'Not approved');
  assert.equal(tableOf(draft, '1').rows.length, 2);
});

test('section 8 counts what is not evidenced from the record', () => {
  const f = fixture();
  const d = buildEvidence(f);
  const k = kv(d, '8');
  assert.equal(k['Open questions'], String(gold.openQuestions.filter(q => q.status === 'open').length));
  assert.equal(k['Typical items not confirmed'], '0');
  const noWork = f.requirements!.filter(r => r.state === 'active' && r.kind === 'FR' && !f.proposals.some(p => p.requirements.includes(r.code)));
  assert.equal(k['Functional requirements with no work item'], String(noWork.length));
});

test('the pack says what its count of open questions is: every one as recorded, and what the screens show when they differ', async () => {
  const { openCountNote } = await import('./evidence.ts');
  const open = (m: ProcessModel) => m.openQuestions.filter(q => q.status === 'open');
  // One question each: the pack and the screens agree, and the sentence says only what the count is.
  const one = structuredClone(gold);
  const first = open(one).find(q => q.target.kind === 'metric')!;
  one.openQuestions = [first];
  assert.equal(openCountNote(one, assessProcess(one), open(one)), 'This is every open question as recorded, 1 in all.');
  // A second wording of the same question: the pack counts both, the screens show it once.
  one.openQuestions.push({ ...first, id: 'q-again', question: `${first.question.replace(/\?$/, '')}?` });
  assert.equal(openCountNote(one, assessProcess(one), open(one)), 'This is every open question as recorded, 2 in all. The screens show 1: they show repeated wordings of a question once.');
  // The sample: several questions about one application's access are one question on the screens, and one the record already answers is left out.
  const note = openCountNote(gold, assessProcess(gold), open(gold));
  assert.equal(note, `This is every open question as recorded, ${open(gold).length} in all. The screens show 7: they show repeated wordings of a question once and leave out 1 the record already answers.`);
  // And the sentence is under the count in the pack.
  const pack = buildEvidence(fixture());
  assert.ok(JSON.stringify(pack.sections.find(s => s.title === 'What is not evidenced')).includes(openCountNote(gold, fixture().assessment, open(gold))));
});
