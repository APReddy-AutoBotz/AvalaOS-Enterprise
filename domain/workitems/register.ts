// Stored proposals matched to the derived ones by derivation key. A person's edit, selection,
// rejection or confirmation is never undone by deriving again; a stored proposal whose source is
// gone is kept and flagged; new derived proposals are added as proposed.
import type { ProposalDraft, ProposalType } from './derive.ts';
import { hashText } from '../docs/edits.ts';

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
  /** For an edited item: the hash of the derived text it was edited from. */
  baseHash?: string | null;
}
export interface ProposalRow extends Proposal {
  sourceRemoved: boolean;
  /** Hash of the text derived now. */
  derivedHash: string;
  /** An edited item whose derived text changed since the edit. */
  needsReview: boolean;
  derived: { title: string; description: string; acceptance: string[] } | null;
}
export interface ReconciledProposals { proposals: ProposalRow[]; changed: Proposal[] }
export const draftHash = (d: { title: string; description: string; acceptance: string[] }) => hashText(JSON.stringify([d.title, d.description, d.acceptance]));

const canon = (p: Proposal) => JSON.stringify({ key: p.key, type: p.type, parentKey: p.parentKey, title: p.title, description: p.description, acceptance: p.acceptance, stepIds: p.stepIds, requirements: p.requirements, state: p.state, rejectedReason: p.rejectedReason, edited: p.edited, order: p.order, workItemId: p.workItemId ?? null, baseHash: p.baseHash ?? null });
const same = (a: Proposal, b: Proposal) => canon(a) === canon(b);

export function reconcileProposals(drafts: ProposalDraft[], stored: Proposal[]): ReconciledProposals {
  const byKey = new Map(stored.map(s => [s.key, s]));
  const out: ProposalRow[] = [];
  drafts.forEach((d, i) => {
    const old = byKey.get(d.key);
    const derivedHash = draftHash(d);
    const edited = old?.edited ?? false;
    const text = edited ? { title: old!.title, description: old!.description, acceptance: old!.acceptance } : { title: d.title, description: d.description, acceptance: d.acceptance };
    // An edit made before base hashes were kept is taken as made against today's text.
    const baseHash = edited ? old!.baseHash ?? derivedHash : null;
    out.push({
      key: d.key, type: d.type, parentKey: d.parentKey, ...text, stepIds: d.stepIds, requirements: d.requirements,
      state: old?.state ?? 'proposed', rejectedReason: old?.rejectedReason ?? null, edited, order: i,
      ...(old?.workItemId ? { workItemId: old.workItemId } : {}), baseHash, sourceRemoved: false,
      derivedHash, needsReview: edited && baseHash !== derivedHash, derived: { title: d.title, description: d.description, acceptance: d.acceptance },
    });
  });
  const live = new Set(drafts.map(d => d.key));
  for (const s of stored) if (!live.has(s.key)) out.push({ ...s, order: out.length, sourceRemoved: true, derivedHash: '', needsReview: false, derived: null });
  const before = new Map(stored.map(s => [s.key, s]));
  const strip = ({ sourceRemoved: _s, derivedHash: _h, needsReview: _n, derived: _d, ...p }: ProposalRow): Proposal => p;
  return { proposals: out, changed: out.map(strip).filter(p => !before.has(p.key) || !same(before.get(p.key)!, p)) };
}

export class ProposalError extends Error {}
export const PROPOSAL_LIMITS = { title: 300, description: 8000, criteria: 30, criterion: 800, reason: 500 } as const;

/** A person's edit, recorded against the derived text it was made from (so a later change asks for review). */
export function editProposal(p: Proposal & { derivedHash?: string }, e: { title: string; description: string; acceptance: string[] }): Proposal {
  if (p.state === 'confirmed') throw new ProposalError('This item is on the board already: change it there.');
  const title = e.title.trim(), description = e.description.trim();
  const acceptance = e.acceptance.map(a => a.trim()).filter(Boolean);
  if (!title) throw new ProposalError('Give the item a title.');
  if (title.length > PROPOSAL_LIMITS.title || description.length > PROPOSAL_LIMITS.description) throw new ProposalError('The title or description is too long.');
  if (acceptance.length < 2) throw new ProposalError('Keep at least two acceptance criteria, so the item can be tested.');
  if (acceptance.length > PROPOSAL_LIMITS.criteria || acceptance.some(a => a.length > PROPOSAL_LIMITS.criterion)) throw new ProposalError('There are too many or too long acceptance criteria.');
  const { derivedHash, ...rest } = p as Proposal & { derivedHash?: string; sourceRemoved?: boolean; needsReview?: boolean; derived?: unknown };
  delete (rest as any).sourceRemoved; delete (rest as any).needsReview; delete (rest as any).derived;
  return { ...rest, title, description, acceptance, edited: true, baseHash: p.edited ? p.baseHash ?? derivedHash ?? null : derivedHash ?? null };
}
/** Keep the person's text and mark the new derived text as seen. */
export const keepMine = (p: ProposalRow): Proposal => { const { sourceRemoved: _s, derivedHash, needsReview: _n, derived: _d, ...rest } = p; return { ...rest, baseHash: derivedHash }; };
/** Back to the derived text. */
export const takeUpdate = (p: ProposalRow): Proposal => { const { sourceRemoved: _s, derivedHash: _h, needsReview: _n, derived, ...rest } = p; return { ...rest, ...(derived ?? {}), edited: false, baseHash: null }; };
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
