// Stored proposals matched to the derived ones by derivation key. A person's edit, selection,
// rejection or confirmation is never undone by deriving again; a stored proposal whose source is
// gone is kept and flagged; new derived proposals are added as proposed.
import type { ProposalDraft, ProposalType } from './derive.ts';

export type ProposalState = 'proposed' | 'selected' | 'rejected' | 'confirmed';
export interface Proposal {
  key: string;
  type: ProposalType;
  parentKey: string | null;
  title: string;
  description: string;
  acceptance: string[];
  stepIds: string[];
  requirements: string[];
  state: ProposalState;
  rejectedReason: string | null;
  edited: boolean;
  order: number;
  /** Set when the item is on the board. */
  workItemId?: string | null;
}
export interface ReconciledProposals { proposals: (Proposal & { sourceRemoved: boolean })[]; changed: Proposal[] }

const canon = (p: Proposal) => JSON.stringify({ key: p.key, type: p.type, parentKey: p.parentKey, title: p.title, description: p.description, acceptance: p.acceptance, stepIds: p.stepIds, requirements: p.requirements, state: p.state, rejectedReason: p.rejectedReason, edited: p.edited, order: p.order, workItemId: p.workItemId ?? null });
const same = (a: Proposal, b: Proposal) => canon(a) === canon(b);

export function reconcileProposals(drafts: ProposalDraft[], stored: Proposal[]): ReconciledProposals {
  const byKey = new Map(stored.map(s => [s.key, s]));
  const out: (Proposal & { sourceRemoved: boolean })[] = [];
  drafts.forEach((d, i) => {
    const old = byKey.get(d.key);
    const text = old?.edited ? { title: old.title, description: old.description, acceptance: old.acceptance } : { title: d.title, description: d.description, acceptance: d.acceptance };
    out.push({
      key: d.key, type: d.type, parentKey: d.parentKey, ...text, stepIds: d.stepIds, requirements: d.requirements,
      state: old?.state ?? 'proposed', rejectedReason: old?.rejectedReason ?? null, edited: old?.edited ?? false, order: i,
      ...(old?.workItemId ? { workItemId: old.workItemId } : {}), sourceRemoved: false,
    });
  });
  const live = new Set(drafts.map(d => d.key));
  for (const s of stored) if (!live.has(s.key)) out.push({ ...s, order: out.length, sourceRemoved: true });
  const before = new Map(stored.map(s => [s.key, s]));
  const strip = ({ sourceRemoved: _s, ...p }: Proposal & { sourceRemoved: boolean }): Proposal => p;
  return { proposals: out, changed: out.map(strip).filter(p => !before.has(p.key) || !same(before.get(p.key)!, p)) };
}

export class ProposalError extends Error {}
export const PROPOSAL_LIMITS = { title: 300, description: 8000, criteria: 30, criterion: 800, reason: 500 } as const;

export function editProposal(p: Proposal, e: { title: string; description: string; acceptance: string[] }): Proposal {
  if (p.state === 'confirmed') throw new ProposalError('This item is on the board already: change it there.');
  const title = e.title.trim(), description = e.description.trim();
  const acceptance = e.acceptance.map(a => a.trim()).filter(Boolean);
  if (!title) throw new ProposalError('Give the item a title.');
  if (title.length > PROPOSAL_LIMITS.title || description.length > PROPOSAL_LIMITS.description) throw new ProposalError('The title or description is too long.');
  if (acceptance.length < 2) throw new ProposalError('Keep at least two acceptance criteria, so the item can be tested.');
  if (acceptance.length > PROPOSAL_LIMITS.criteria || acceptance.some(a => a.length > PROPOSAL_LIMITS.criterion)) throw new ProposalError('There are too many or too long acceptance criteria.');
  return { ...p, title, description, acceptance, edited: true };
}
export function setSelected(p: Proposal, on: boolean): Proposal {
  if (p.state === 'confirmed') return p;
  return { ...p, state: on ? 'selected' : 'proposed', rejectedReason: null };
}
export function rejectProposal(p: Proposal, reason: string): Proposal {
  if (p.state === 'confirmed') throw new ProposalError('This item is on the board already.');
  const r = reason.trim();
  if (!r) throw new ProposalError('Say why it is rejected, so others know.');
  if (r.length > PROPOSAL_LIMITS.reason) throw new ProposalError('Keep the reason shorter.');
  return { ...p, state: 'rejected', rejectedReason: r };
}
export const restoreProposal = (p: Proposal): Proposal => (p.state === 'rejected' ? { ...p, state: 'proposed', rejectedReason: null } : p);

/** What will be confirmed: the selected items, with their selected or already confirmed parent. */
export function toConfirm(ps: Proposal[]): Proposal[] {
  return ps.filter(p => p.state === 'selected');
}
