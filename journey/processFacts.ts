// The facts of one process that My work and the Processes list show: where it stands, who is named on
// it, and what is open. Read through the store; what they mean is decided in domain/work/home.ts.
import type { JourneyStore, ProcessRow } from './store/types.ts';
import type { ProcessFacts } from '../domain/work/home.ts';
import { revisionStatus } from '../domain/workspace/route.ts';

export type LoadedFacts = ProcessFacts & { statusLabel: string; statusTone: 'neutral' | 'draft' | 'approved' | 'changed' };
export const STATUS_TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;

export async function loadProcessFacts(store: JourneyStore, p: ProcessRow): Promise<LoadedFacts> {
  const revisions = await store.listRevisions(p.id);
  const status = revisionStatus(revisions);
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  const [model, proposals] = await Promise.all([current ? store.getModel(current.id) : Promise.resolve(null), store.listProposals(p.id)]);
  return {
    id: p.id, name: p.name, analystId: p.analystId ?? null, architectId: p.architectId ?? null, approverId: p.approverId ?? null,
    status: revisions.length === 0 ? 'none' : status.tone === 'approved' ? 'approved' : status.tone === 'changed' ? 'changed' : 'draft',
    openQuestions: model ? model.openQuestions.filter(q => q.status === 'open').length : 0,
    proposalsWaiting: proposals.filter(x => x.state === 'proposed' || x.state === 'selected').length,
    statusLabel: status.label, statusTone: status.tone,
  };
}
