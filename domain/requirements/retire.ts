// Requirements a decided approach (or one person's choice for a step) leaves behind are retired on their
// own (docs/next-plan.md, section 3d, package 10, item 6). When the decided approach is removed or changed,
// or a person's choice for one step is withdrawn or changed, a requirement that loses its source in that
// same action, that nobody edited, that nothing a person touched links to and that no tester's edit names,
// is retired with the reason in words, instead of staying "Source removed" for a person. Anything edited or
// linked stays "Source removed" as before. Nothing is deleted and codes are never reused: deciding the same
// approach again derives the same key, so the requirement comes back active with its code (register.ts).
import type { Proposal } from '../workitems/register.ts';
import { isUserMade } from '../workitems/register.ts';
import type { TestCaseEdit } from '../docs/testEdits.ts';
import type { Reconciled, StoredRequirement } from './register.ts';

/**
 * Whether a proposal keeps its requirements from being retired (owner, 17 November 2026): only when a
 * person has edited, selected, rejected, merged or split it, or it is on the board. A proposal Avala OS
 * derived and nobody touched follows its requirement, as it does today when a source goes.
 */
export const touchedByPerson = (p: Proposal) =>
  p.edited || p.state !== 'proposed' || isUserMade(p.key) || Boolean(p.workItemId);

/** The codes of requirements something a person did links to: touched proposals and testers' edits. */
export function linkedCodes(proposals: readonly Proposal[], testEdits: readonly TestCaseEdit[]): Set<string> {
  const out = new Set<string>();
  for (const p of proposals) if (touchedByPerson(p)) for (const code of p.requirements) out.add(code);
  for (const e of testEdits) {
    // A derived case is numbered after its requirement (FR-003.1); an added case names its requirement.
    const named = e.caseCode.startsWith('added:') ? e.fields.requirement ?? '' : e.caseCode.replace(/\.[^.]*$/, '');
    if (named) out.add(named);
  }
  return out;
}

export interface RetireContext { reason: string; linked: ReadonlySet<string> }

/**
 * The rows to save after an action, with what it left behind retired. `stored` is the list before the
 * action, `next` the reconciliation after it. A row is retired only when it was active before and lost its
 * source in this very reconciliation; one that was already "Source removed" is a person's to decide.
 */
export function retireLeftBehind(stored: readonly StoredRequirement[], next: Reconciled, ctx: RetireContext): StoredRequirement[] {
  const before = new Map(stored.map(s => [s.code, s]));
  const changed = new Set(next.changed.map(r => r.code));
  const out: StoredRequirement[] = [];
  for (const r of next.requirements) {
    const was = before.get(r.code);
    const leftBehind = was?.state === 'active' && r.state === 'source_removed' && r.origin === 'derived' && !r.edited && !ctx.linked.has(r.code);
    if (leftBehind) { const { needsReview: _n, derived: _d, ...row } = r as typeof r & { needsReview?: boolean; derived?: unknown }; out.push({ ...row, state: 'retired', retiredReason: ctx.reason }); }
    else if (changed.has(r.code)) out.push(next.changed.find(x => x.code === r.code)!);
  }
  return out;
}

/** The reason a requirement left behind by a decided approach is retired with. */
export const decidedReason = (approach: string) => `Applied only while ${approach} was the decided approach`;
/** The reason a requirement left behind by one person's choice for a step is retired with. */
export const stepChoiceReason = (approach: string, stepNo: number | null, stepName: string) =>
  `Applied only while a person had chosen ${approach} for ${stepNo ? `step ${stepNo}` : 'the step'} "${stepName}"`;
