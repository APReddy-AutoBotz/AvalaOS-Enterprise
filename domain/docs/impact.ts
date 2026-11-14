// Change impact: what one edit to the process would change downstream, worked out by building
// everything from the model before and after the edit and comparing. Nothing is stored; the same
// builders as the Documents and Work items stages are used, so the preview cannot disagree with them.
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import type { AssessmentSettings } from '../assess/settings.ts';
import { effectiveApproach, type Decisions } from '../assess/decisions.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { persisted, reconcile, type Requirement, type StoredRequirement } from '../requirements/register.ts';
import { deriveProposals, type ProposalDraft, type ProposalType } from '../workitems/derive.ts';
import { draftHash, type Proposal } from '../workitems/register.ts';
import type { DocInput } from './common.ts';
import type { DocTree } from './tree.ts';
import { buildBrd } from './brd.ts';
import { buildPdd } from './pdd.ts';
import { buildFrd } from './frd.ts';
import { buildSdd } from './sdd.ts';
import { changedSections } from './changes.ts';

export interface ImpactContext {
  decisions: Decisions;
  settings?: AssessmentSettings;
  /** The stored requirements register, as the Documents stage keeps it. */
  requirements: StoredRequirement[];
  /** The stored work-item proposals, as the Work items stage keeps them. */
  proposals: Proposal[];
}

export type ImpactChange = 'changed' | 'added' | 'removed';
export interface StepImpact { stepId: string; name: string; before: string; after: string }
export interface DocImpact { type: 'brd' | 'pdd' | 'frd' | 'sdd'; name: string; sections: string[] }
export interface RequirementImpact { code: string; title: string; change: ImpactChange; edited: boolean }
export interface WorkItemImpact { key: string; title: string; type: ProposalType; change: ImpactChange; edited: boolean; onBoard: boolean }
export interface Impact {
  verdict: { before: string; after: string } | null;
  steps: StepImpact[];
  documents: DocImpact[];
  requirements: RequirementImpact[];
  workItems: WorkItemImpact[];
}

export const DOC_NAMES: Record<DocImpact['type'], string> = { brd: 'BRD', pdd: 'PDD', frd: 'FRD', sdd: 'SDD' };
const BUILDERS: [DocImpact['type'], (i: DocInput) => DocTree][] = [['brd', buildBrd], ['pdd', buildPdd], ['frd', buildFrd], ['sdd', buildSdd]];

interface Built { input: DocInput; register: Requirement[]; docs: Map<DocImpact['type'], DocTree>; drafts: ProposalDraft[] }

function build(m: ProcessModel, ctx: ImpactContext, stored: StoredRequirement[]): Built {
  const assessment = assessProcess(m, { rate: ctx.decisions.rate, ...(ctx.settings ? { settings: ctx.settings } : {}) });
  const register = reconcile(deriveRequirements(m, assessment), stored).requirements;
  const input: DocInput = { model: m, assessment, decisions: ctx.decisions, sources: [], requirements: register, revision: { label: '', state: 'working', date: '' } };
  const docs = new Map(BUILDERS.map(([t, b]) => [t, b(input)] as const));
  const headings = [...docs.values()].flatMap(d => d.sections.map(s => s.title));
  return { input, register, docs, drafts: deriveProposals(input, headings).proposals };
}

/** What the requirement says as derived now (an edited one keeps the person's words, so compare what it was derived from). */
const reqText = (r: Requirement) => JSON.stringify([r.derived ?? { title: r.title, statement: r.statement, acceptance: r.acceptance }, r.stepIds, r.ruleIds, r.exceptionIds, r.state]);
const draftText = (d: ProposalDraft) => JSON.stringify([draftHash(d), d.parentKey, d.stepIds, d.requirements]);

/** The impact of going from `before` to `after`. */
export function changeImpact(before: ProcessModel, after: ProcessModel, ctx: ImpactContext): Impact {
  const b = build(before, ctx, ctx.requirements);
  // The register after the edit continues from the one before it, as the Documents stage would save it.
  const a = build(after, ctx, b.register.map(persisted));

  const verdict = b.input.assessment.verdict !== a.input.assessment.verdict ? { before: b.input.assessment.verdict, after: a.input.assessment.verdict } : null;
  const was = new Map(b.input.assessment.steps.map(s => [s.stepId, s]));
  const steps: StepImpact[] = [];
  for (const s of a.input.assessment.steps) {
    const o = was.get(s.stepId);
    if (!o) continue;
    const label = (x: typeof s) => (x.alreadyAutomated ? 'Already automated' : APPROACH_LABEL[effectiveApproach(x, ctx.decisions).approach]);
    if (label(o) !== label(s)) steps.push({ stepId: s.stepId, name: after.steps.find(x => x.id === s.stepId)?.name ?? s.stepId, before: label(o), after: label(s) });
  }

  const documents: DocImpact[] = [];
  for (const [type] of BUILDERS) {
    const sections = changedSections(b.docs.get(type)!, a.docs.get(type)!).map(c => c.title);
    if (sections.length) documents.push({ type, name: DOC_NAMES[type], sections });
  }

  const requirements: RequirementImpact[] = [];
  const oldReq = new Map(b.register.map(r => [r.code, r]));
  for (const r of a.register) {
    const o = oldReq.get(r.code);
    const active = r.state === 'active';
    const change: ImpactChange | null = !o || o.state !== 'active' ? (active ? 'added' : null) : !active ? 'removed' : reqText(o) !== reqText(r) ? 'changed' : null;
    if (change) requirements.push({ code: r.code, title: r.title, change, edited: r.edited });
  }

  const storedBy = new Map(ctx.proposals.map(p => [p.key, p]));
  const workItems: WorkItemImpact[] = [];
  const oldDraft = new Map(b.drafts.map(d => [d.key, d]));
  const newKeys = new Set(a.drafts.map(d => d.key));
  const push = (d: ProposalDraft, change: ImpactChange) => {
    const s = storedBy.get(d.key);
    if (s?.state === 'rejected') return;
    workItems.push({ key: d.key, title: s?.edited ? s.title : d.title, type: d.type, change, edited: Boolean(s?.edited), onBoard: Boolean(s && (s.state === 'confirmed' || s.workItemId)) });
  };
  for (const d of a.drafts) {
    const o = oldDraft.get(d.key);
    if (!o) push(d, 'added');
    else if (draftText(o) !== draftText(d)) push(d, 'changed');
  }
  for (const d of b.drafts) if (!newKeys.has(d.key)) push(d, 'removed');

  return { verdict, steps, documents, requirements, workItems };
}

export const isEmptyImpact = (i: Impact) => !i.verdict && !i.steps.length && !i.documents.length && !i.requirements.length && !i.workItems.length;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** One line for a confirmation or a status note: "Affects the recommendation for 1 step, PDD (3 sections), FRD (1 section), FR-007 and 3 work items, 1 on the board." */
export function impactSummary(i: Impact): string {
  if (isEmptyImpact(i)) return 'Nothing downstream changes.';
  const parts: string[] = [];
  if (i.verdict) parts.push('the overall recommendation');
  if (i.steps.length) parts.push(`the recommendation for ${plural(i.steps.length, 'step')}`);
  for (const d of i.documents) parts.push(`${d.name} (${plural(d.sections.length, 'section')})`);
  if (i.requirements.length) parts.push(i.requirements.length <= 3 ? i.requirements.map(r => r.code).join(', ') : plural(i.requirements.length, 'requirement'));
  if (i.workItems.length) {
    const board = i.workItems.filter(w => w.onBoard).length;
    parts.push(`${plural(i.workItems.length, 'work item')}${board ? `, ${board} on the board` : ''}`);
  }
  return `Affects ${listOf(parts)}.`;
}

const CHANGE_WORD: Record<ImpactChange, string> = { changed: 'changes', added: 'is added', removed: 'loses its source' };

/** The impact in plain lines, grouped, for the details view. */
export function impactDetails(i: Impact): { heading: string; lines: string[] }[] {
  const out: { heading: string; lines: string[] }[] = [];
  const rec: string[] = [];
  if (i.verdict) rec.push(`Overall: "${i.verdict.before}" becomes "${i.verdict.after}".`);
  for (const s of i.steps) rec.push(`"${s.name}": ${s.before} becomes ${s.after}.`);
  if (rec.length) out.push({ heading: 'Assessment', lines: rec });
  if (i.documents.length) out.push({ heading: 'Documents', lines: i.documents.map(d => `${d.name}: ${listOf(d.sections)}.`) });
  if (i.requirements.length) out.push({
    heading: 'Requirements',
    lines: i.requirements.map(r => `${r.code} ${r.title} ${CHANGE_WORD[r.change]}${r.edited && r.change === 'changed' ? '; your edit is kept and will show "Needs review"' : ''}.`),
  });
  if (i.workItems.length) out.push({
    heading: 'Work items',
    lines: i.workItems.map(w => `${w.title} ${CHANGE_WORD[w.change]}${w.edited && w.change === 'changed' ? '; your edit is kept and will show "Needs review"' : ''}${w.onBoard ? '; the item on the board is not changed' : ''}.`),
  });
  return out;
}
