// The facts of one process that My work and the Processes page show: where it stands, who is named on
// it, what is open, and what its assessment says. Read through the store; what they mean is decided in
// domain/work/home.ts and domain/assess.
import type { JourneyStore, ProcessRow } from './store/types.ts';
import type { ProcessFacts } from '../domain/work/home.ts';
import { revisionStatus } from '../domain/workspace/route.ts';
import { assessProcess } from '../domain/assess/process.ts';
import { processCard, type ProcessCard } from '../domain/assess/portfolio.ts';
import type { AssessmentSettings } from '../domain/assess/settings.ts';

export type LoadedFacts = ProcessFacts & {
  statusLabel: string; statusTone: 'neutral' | 'draft' | 'approved' | 'changed';
  /** The assessment in short; null until the process has a step to assess. */
  card: ProcessCard | null;
};
export const STATUS_TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;

export async function loadProcessFacts(store: JourneyStore, p: ProcessRow, settings?: AssessmentSettings): Promise<LoadedFacts> {
  const revisions = await store.listRevisions(p.id);
  const status = revisionStatus(revisions);
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  const [model, proposals, decisions] = await Promise.all([current ? store.getModel(current.id) : Promise.resolve(null), store.listProposals(p.id), store.getAssessmentDecisions(p.id).catch(() => null)]);
  return {
    id: p.id, name: p.name, analystId: p.analystId ?? null, architectId: p.architectId ?? null, approverId: p.approverId ?? null,
    status: revisions.length === 0 ? 'none' : status.tone === 'approved' ? 'approved' : status.tone === 'changed' ? 'changed' : 'draft',
    openQuestions: model ? model.openQuestions.filter(q => q.status === 'open').length : 0,
    proposalsWaiting: proposals.filter(x => x.state === 'proposed' || x.state === 'selected').length,
    statusLabel: status.label, statusTone: status.tone,
    // The approach in effect for each step, people's choices included, as on the process's own pages.
    card: model ? processCard(assessProcess(model, { settings, decisions })) : null,
  };
}
