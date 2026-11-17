// The evidence pack (package 6 of docs/next-plan.md): for a regulated client, the chain Avala OS already
// holds, in one document a person can read and download: what the pack covers and who approved it, the
// sources, every requirement and where it came from, from requirement to work to test, the test cases as
// they stand, the decisions people made, the review comments, and what is not evidenced. All by rule from the
// record; nothing worded by AI. A name or a time the record does not hold says "Not recorded"; people are
// named, never by email address.
import type { ProcessModel, SourceRef } from '../processModel/types.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import { locatorLabel } from '../ingest/segment.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import type { Proposal } from '../workitems/register.ts';
import type { Requirement } from '../requirements/register.ts';
import type { SectionComment } from './review.ts';
import { DocBuilder, docShort, type Cell, type DocTree, type DocType } from './tree.ts';
import { controlOf, typicalLeft, type DocInput } from './common.ts';
import { testPack } from './tests.ts';
import { applyTestEdits, packAsRun, CASE_STATE_LABEL, type TestCaseEdit } from './testEdits.ts';
import { asksQuestion, whatFollows } from '../plan/purpose.ts';
import { decidedSummary } from '../assess/decided.ts';
import { triage } from '../questions/triage.ts';
import { NOT_RECORDED_WHO, whoChose } from '../assess/decisions.ts';
import type { ProcessAssessment } from '../assess/process.ts';

/**
 * The sentence under the pack's count of open questions (review of 16 November 2026: the pack said 44 where
 * the screens said 43). The pack lists every open question as recorded; the screens show the questions as
 * triage groups them: two wordings of the same question once, and none the record already answers.
 */
export function openCountNote(m: ProcessModel, assessment: ProcessAssessment, recorded: readonly { id: string }[]): string {
  const ids = new Set(recorded.map(q => q.id));
  const t = triage(m, assessment);
  const onScreens = t.items.filter(i => i.questionIds.some(id => ids.has(id))).length;
  const known = t.alreadyKnown.filter(k => ids.has(k.questionId)).length;
  const n = recorded.length;
  const every = `This is every open question as recorded${n ? `, ${n} in all` : ''}.`;
  if (onScreens === n) return every;
  const merged = n - known - onScreens;
  const why = [merged > 0 ? 'show repeated wordings of a question once' : '', known > 0 ? `leave out ${known} the record already answers` : ''].filter(Boolean);
  return `${every} The screens show ${onScreens}${why.length ? `: they ${why.join(' and ')}` : ''}.`;
}

export const NOT_RECORDED = 'Not recorded';

export interface EvidenceInput extends DocInput {
  /** Every revision of the process, newest first: approvals are read from them. */
  revisions: { revNo: number; state: 'working' | 'approved' | 'superseded'; createdAt: string; approvedAt: string | null; approvedBy: string | null }[];
  /** The revision the pack is built from. */
  revNo: number;
  /** Every source, archived ones too; `kind` in words ("Word document", "Call transcript"). */
  allSources: { key: string; title: string; kind: string; createdAt: string; passages: number; archived: boolean }[];
  /** The work proposals, with the board item each became; and each board item's status. */
  proposals: Proposal[];
  boardStatus: Record<string, string>;
  testEdits: TestCaseEdit[];
  comments: SectionComment[];
  /** People's names by user id (members of the workspace). */
  names: Record<string, string>;
}

const STATUS_WORDS: Record<string, string> = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', testing: 'Testing', ready_for_release: 'Ready for release', done: 'Done', blocked: 'Blocked', on_hold: 'On hold' };
const date = (iso: string | null | undefined): string => {
  if (!iso) return NOT_RECORDED;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? NOT_RECORDED : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const notRecorded = (): Cell => ({ text: NOT_RECORDED, missing: true });
/** A person by name; never an email address, which some older records hold in place of a name. */
const personCell = (name: string | null | undefined): Cell => (name && name.trim() && !name.includes('@') && name !== 'you' ? { text: name.trim() } : notRecorded());

/** Where a requirement came from, in words, and the source passages behind that. */
function originOf(r: Requirement, m: ProcessModel): { from: string; refs: SourceRef[] } {
  const no = (id: string) => orderedSteps(m).findIndex(s => s.id === id) + 1;
  if (r.origin === 'user') return { from: 'Added by a person', refs: [] };
  const key = r.key ?? '';
  if (key === 'objective') return { from: 'The objective of the process', refs: m.meta.objective.sources ?? [] };
  if (key.startsWith('control:')) {
    const c = (m.controls as { id: string; text: string; sources?: SourceRef[] }[]).find(x => x.id === key.slice(8));
    return { from: c ? `Control: ${c.text}` : 'A control no longer in the process', refs: c?.sources ?? [] };
  }
  const parts: string[] = [];
  const refs: SourceRef[] = [];
  for (const id of r.stepIds) { const s = m.steps.find(x => x.id === id); if (s) { parts.push(`Step ${no(id)}: ${s.name}`); refs.push(...s.sources); } }
  for (const id of r.ruleIds) { const x = m.rules.find(y => y.id === id); if (x) { parts.push(`Rule: ${x.name}`); refs.push(...x.sources); } }
  for (const id of r.exceptionIds) { const x = m.exceptions.find(y => y.id === id); if (x) { parts.push(`Exception: ${x.name}`); refs.push(...x.sources); } }
  return { from: parts.join('; ') || 'Its source is no longer in the process', refs };
}

/** The source passages as "Title (place)", at most three, with a count of the rest. */
function passagesCell(refs: SourceRef[], titles: Map<string, string>): Cell {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    const where = locatorLabel(r.locator ?? {});
    const text = `${titles.get(r.sourceId) ?? r.sourceId}${where ? ` (${where})` : ''}`;
    if (!seen.has(text)) { seen.add(text); out.push(text); }
  }
  if (!out.length) return notRecorded();
  return { text: out.length > 3 ? `${out.slice(0, 3).join('; ')}; and ${out.length - 3} more` : out.join('; ') };
}

export function buildEvidence(input: EvidenceInput): DocTree {
  // A process documented as it is has no requirements, work or tests: its pack is the process itself.
  if (!whatFollows(input.model).future) return buildEvidenceAsIs(input);
  const m = input.model;
  const b = new DocBuilder();
  const name = (id: string | null | undefined) => (id ? input.names[id] ?? null : null);
  const titles = new Map(input.allSources.map(s => [s.key, s.title]));
  const reqs = (input.requirements ?? []).filter(r => r.state === 'active');
  const frs = reqs.filter(r => r.kind === 'FR');
  const current = input.revisions.find(r => r.revNo === input.revNo) ?? null;
  const approved = input.revision.state === 'approved';

  // ---- 1 What the pack covers
  b.section('1', 'What this pack covers', 1);
  if (!approved) b.callout('Built from a working draft: this pack is not evidence of an approved state. Approve the revision, then take the pack again.', 'warning');
  b.paragraph(`The record Avala OS holds for "${m.meta.name}": where each requirement came from, who approved the process, and which work and test cover each requirement. Everything here is read from the record; nothing is written for the pack.`);
  b.keyValue('The revision', [
    ['Process', m.meta.name],
    ['Revision', input.revision.label],
    ['State', approved ? 'Approved' : 'Working draft'],
    ['Created', date(current?.createdAt)],
    ['Approved by', approved ? personCell(name(current?.approvedBy)) : 'Not approved'],
    ['Approved on', approved ? (current?.approvedAt ? date(current.approvedAt) : notRecorded()) : 'Not approved'],
  ]);
  const earlier = input.revisions.filter(r => r.approvedAt && r.revNo !== input.revNo).sort((a, z) => z.revNo - a.revNo);
  b.table('Earlier approved revisions', ['Revision', 'Approved by', 'Approved on'],
    earlier.map(r => [`Revision ${r.revNo}`, personCell(name(r.approvedBy)), date(r.approvedAt)]), 'No earlier revision was approved.');

  // ---- 2 The sources
  b.section('2', 'The sources', 1);
  b.table('Sources', ['Source', 'Kind', 'Added', 'Passages', 'State'],
    input.allSources.map(s => [`${s.title} (${s.key})`, s.kind || NOT_RECORDED, date(s.createdAt), String(s.passages), s.archived ? 'Archived' : 'In use']),
    'No sources were added: the process was entered by hand or started from a typical process.');

  // ---- 3 Requirements and where each came from
  b.section('3', 'Requirements and where each came from', 1);
  b.paragraph('Every active requirement, with what it was derived from in the process and the source passages behind that. "Changed by a person" means its wording was edited after it was derived.');
  const origins = new Map(reqs.map(r => [r.code, originOf(r, m)]));
  b.table('Requirements', ['Code', 'Requirement', 'Derived from', 'Source passages', 'Wording'],
    reqs.map(r => { const o = origins.get(r.code)!; return [r.code, r.statement || r.title, o.from, passagesCell(o.refs, titles), r.edited || r.origin === 'user' ? 'Changed by a person' : 'As derived']; }),
    'No requirements are recorded yet.');

  // ---- 4 From requirement to work to test
  b.section('4', 'From requirement to work to test', 1);
  const run = packAsRun(testPack(input), input.testEdits);
  const work = (code: string) => input.proposals.filter(p => p.state !== 'rejected' && p.requirements.includes(code));
  const tests = (code: string) => run.cases.filter(c => c.requirement === code);
  const gapsOf = (code: string): string[] => {
    const g: string[] = [];
    if (!work(code).length) g.push('No work item');
    const t = tests(code);
    if (!t.length) g.push('No test case');
    else if (t.some(c => c.expected === null)) g.push('The test has no expected result');
    return g;
  };
  b.paragraph('One row for each functional requirement: the work planned for it (with its status once on the board) and the test cases that prove it.');
  b.table('Requirement to work to test', ['Requirement', 'Work items', 'Test cases', 'Gaps'],
    frs.map(r => {
      const w = work(r.code).map(p => `${p.title} (${p.workItemId ? `on the board: ${STATUS_WORDS[input.boardStatus[p.workItemId] ?? ''] ?? NOT_RECORDED}` : 'proposed'})`);
      const t = tests(r.code).map(c => c.code);
      const g = gapsOf(r.code);
      return [`${r.code}: ${r.title}`, w.length ? w.join('; ') : notRecorded(), t.length ? t.join(', ') : notRecorded(), g.length ? { text: g.join('; '), missing: true } : 'None'];
    }), 'No functional requirements are recorded yet.');

  // ---- 5 The test cases as they stand
  b.section('5', 'The test cases as they stand', 1);
  const reviewed = applyTestEdits(testPack(input), input.testEdits);
  b.table('Test cases', ['Case', 'What it tests', 'Requirement', 'Expected result', 'State'],
    reviewed.map(c => [c.code.startsWith('added:') ? 'Added' : c.code, c.title, c.requirement, c.expected ?? notRecorded(), CASE_STATE_LABEL[c.state] || 'As derived']),
    'No test cases: there are no functional requirements yet.');

  // ---- 6 Decisions people made
  b.section('6', 'Decisions people made', 1);
  // An approach decided for the whole process (package 9): what, why, who and when, and what it can do.
  const dec = decidedSummary(m, input.assessment);
  if (dec) {
    b.table('The approach decided for the whole process', ['Approach', 'Reason', 'Who', 'When', 'What it can do'],
      [[dec.label, dec.decided.reason, personCell(name(dec.decided.by)), date(dec.decided.at),
        `${dec.can.length} ${dec.can.length === 1 ? 'step' : 'steps'}; not known yet for ${dec.unknown.length}; ${dec.cannot.length} stay with people`]], '');
  }
  const overrides = Object.values(input.decisions.overrides);
  const order = orderedSteps(m);
  // Decided: a person's choice for a step is set against the decided approach, not against a recommendation.
  b.table(dec ? 'Steps a person set themselves' : 'Choices of approach against the scoring', ['Step', 'Approach chosen', dec ? 'The scoring alone gives' : 'The scoring recommended', 'Reason', 'Who', 'When'],
    overrides.map(o => {
      const i = order.findIndex(s => s.id === o.stepId);
      const score = input.assessment.steps.find(s => s.stepId === o.stepId);
      const rec = score ? (score.recommended ?? score.winner) : null;
      return [i >= 0 ? `${i + 1}. ${order[i]!.name}` : 'A step no longer in the process', APPROACH_LABEL[o.approach], rec ? APPROACH_LABEL[rec] : notRecorded(), o.rationale, (whoChose(o, input.names) === NOT_RECORDED_WHO ? notRecorded() : personCell(whoChose(o, input.names))), date(o.at)];
    }), dec ? 'Nobody set a step themselves.' : 'Nobody has chosen another approach than the scoring recommends.');

  // ---- 7 Review comments
  b.section('7', 'Review comments', 1);
  const docName = (t: string) => docShort(t as DocType);
  b.table('Comments on document sections', ['Document', 'Section', 'Comment', 'Written by', 'Written on', 'State'],
    [...input.comments].sort((a, z) => a.docType.localeCompare(z.docType) || a.sectionTitle.localeCompare(z.sectionTitle) || a.createdAt.localeCompare(z.createdAt)).map(c => [
      docName(c.docType), c.sectionTitle, c.body, personCell(name(c.authorId)), date(c.createdAt),
      c.resolvedAt ? (() => { const who = personCell(name(c.resolvedBy)); return `Resolved by ${who.text} on ${date(c.resolvedAt)}`; })() : 'Open',
    ]), 'No review comments were made.');

  // ---- 8 What is not evidenced
  b.section('8', 'What is not evidenced', 1);
  const openQs = m.openQuestions.filter(q => q.status === 'open');
  const typical = typicalLeft(m);
  const noSource = reqs.filter(r => r.origin !== 'user' && !origins.get(r.code)!.refs.length);
  const noWork = frs.filter(r => !work(r.code).length);
  const noTest = frs.filter(r => !tests(r.code).length);
  const noExpected = frs.filter(r => tests(r.code).length && tests(r.code).some(c => c.expected === null));
  b.keyValue('In short', [
    ['Open questions', String(openQs.length)],
    ['Typical items not confirmed', String(typical)],
    ['Requirements with no source passage', String(noSource.length)],
    ['Functional requirements with no work item', String(noWork.length)],
    ['Functional requirements with no test case', String(noTest.length)],
    ['Test cases with no expected result', String(noExpected.length)],
  ]);
  b.paragraph(openCountNote(m, input.assessment, openQs));
  const list = (title: string, items: string[]) => { if (items.length) { b.paragraph(`${title}:`); b.list(items); } };
  list('Open questions', openQs.map(q => q.question));
  list('Requirements with no source passage', noSource.map(r => `${r.code}: ${r.title}`));
  list('Functional requirements with no work item', noWork.map(r => `${r.code}: ${r.title}`));
  list('Functional requirements with no test case', noTest.map(r => `${r.code}: ${r.title}`));
  list('Functional requirements whose test has no expected result', noExpected.map(r => `${r.code}: ${r.title}`));
  if (!openQs.length && !typical && !noSource.length && !noWork.length && !noTest.length && !noExpected.length) b.paragraph('Everything the pack covers is evidenced.');

  return { type: 'evidence', title: 'Evidence pack', subtitle: m.meta.name, control: controlOf(input), sections: b.sections, openItems: [] };
}

/**
 * The evidence pack of a process documented as it is (domain/plan/purpose.ts): what the pack covers and
 * who approved it, the sources, each step, rule, exception and control with the source passages behind
 * it, the review comments, and what is not evidenced. People's choices of approach are kept on the
 * record and not listed: there is no assessment to choose against.
 */
function buildEvidenceAsIs(input: EvidenceInput): DocTree {
  const m = input.model;
  const b = new DocBuilder();
  const name = (id: string | null | undefined) => (id ? input.names[id] ?? null : null);
  const titles = new Map(input.allSources.map(s => [s.key, s.title]));
  const current = input.revisions.find(r => r.revNo === input.revNo) ?? null;
  const approved = input.revision.state === 'approved';
  const order = orderedSteps(m);

  b.section('1', 'What this pack covers', 1);
  if (!approved) b.callout('Built from a working draft: this pack is not evidence of an approved state. Approve the revision, then take the pack again.', 'warning');
  b.paragraph(`The record Avala OS holds for "${m.meta.name}", documented as it is: where each step, rule, exception and control came from, and who approved the process. Everything here is read from the record; nothing is written for the pack.`);
  b.keyValue('The revision', [
    ['Process', m.meta.name],
    ['Revision', input.revision.label],
    ['State', approved ? 'Approved' : 'Working draft'],
    ['Created', date(current?.createdAt)],
    ['Approved by', approved ? personCell(name(current?.approvedBy)) : 'Not approved'],
    ['Approved on', approved ? (current?.approvedAt ? date(current.approvedAt) : notRecorded()) : 'Not approved'],
  ]);
  const earlier = input.revisions.filter(r => r.approvedAt && r.revNo !== input.revNo).sort((a, z) => z.revNo - a.revNo);
  b.table('Earlier approved revisions', ['Revision', 'Approved by', 'Approved on'],
    earlier.map(r => [`Revision ${r.revNo}`, personCell(name(r.approvedBy)), date(r.approvedAt)]), 'No earlier revision was approved.');

  b.section('2', 'The sources', 1);
  b.table('Sources', ['Source', 'Kind', 'Added', 'Passages', 'State'],
    input.allSources.map(s => [`${s.title} (${s.key})`, s.kind || NOT_RECORDED, date(s.createdAt), String(s.passages), s.archived ? 'Archived' : 'In use']),
    'No sources were added: the process was entered by hand or started from a typical process.');

  b.section('3', 'The process and where each part came from', 1);
  b.paragraph('Every step, business rule, exception and control of the process, with the source passages behind it and whether a person confirmed it.');
  const STATE: Record<string, string> = { stated: 'Stated in a source', inferred: 'Inferred from the sources', 'user-confirmed': 'Confirmed by a person', assumed: 'An assumption to confirm', typical: 'Typical, not confirmed', unknown: NOT_RECORDED };
  type Part = { kind: string; name: string; status: string; refs: SourceRef[] };
  const parts: Part[] = [
    ...order.map((s, i) => ({ kind: `Step ${i + 1}`, name: s.name, status: s.status, refs: s.sources })),
    ...m.rules.map(r => ({ kind: 'Rule', name: r.name, status: r.status, refs: r.sources })),
    ...m.exceptions.map(e => ({ kind: 'Exception', name: e.name, status: e.status, refs: e.sources })),
    ...m.controls.map(c => ({ kind: 'Control', name: c.text, status: c.status, refs: c.sources })),
  ];
  b.table('The process', ['Part', 'What', 'Source passages', 'State'],
    parts.map(p => [p.kind, p.name, passagesCell(p.refs, titles), STATE[p.status] ?? NOT_RECORDED]),
    'No steps are recorded yet.');

  b.section('4', 'Review comments', 1);
  const docName = (t: string) => docShort(t as DocType);
  b.table('Comments on document sections', ['Document', 'Section', 'Comment', 'Written by', 'Written on', 'State'],
    [...input.comments].sort((a, z) => a.docType.localeCompare(z.docType) || a.sectionTitle.localeCompare(z.sectionTitle) || a.createdAt.localeCompare(z.createdAt)).map(c => [
      docName(c.docType), c.sectionTitle, c.body, personCell(name(c.authorId)), date(c.createdAt),
      c.resolvedAt ? (() => { const who = personCell(name(c.resolvedBy)); return `Resolved by ${who.text} on ${date(c.resolvedAt)}`; })() : 'Open',
    ]), 'No review comments were made.');

  b.section('5', 'What is not evidenced', 1);
  const openQs = m.openQuestions.filter(q => q.status === 'open' && asksQuestion(m, q));
  const typical = typicalLeft(m);
  const noSource = parts.filter(p => !p.refs.length && p.status !== 'user-confirmed');
  b.keyValue('In short', [
    ['Open questions', String(openQs.length)],
    ['Typical items not confirmed', String(typical)],
    ['Parts of the process with no source passage and not confirmed by a person', String(noSource.length)],
  ]);
  b.paragraph(openCountNote(m, input.assessment, openQs));
  const list = (title: string, items: string[]) => { if (items.length) { b.paragraph(`${title}:`); b.list(items); } };
  list('Open questions', openQs.map(q => q.question));
  list('Parts with no source passage', noSource.map(p => `${p.kind}: ${p.name}`));
  if (!openQs.length && !typical && !noSource.length) b.paragraph('Everything the pack covers is evidenced.');

  return { type: 'evidence', title: 'Evidence pack', subtitle: m.meta.name, control: controlOf(input), sections: b.sections, openItems: [] };
}
