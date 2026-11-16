// The facts of one process that My work and the Processes page show: where it stands, who is named on
// it, what is open, and what its assessment says. Read through the store; what they mean is decided in
// domain/work/home.ts and domain/assess.
import type { JourneyStore, ProcessRow } from './store/types.ts';
import type { ProcessFacts } from '../domain/work/home.ts';
import { revisionStatus } from '../domain/workspace/route.ts';
import { assessProcess } from '../domain/assess/process.ts';
import { processCard, type ProcessCard } from '../domain/assess/portfolio.ts';
import type { AssessmentSettings } from '../domain/assess/settings.ts';
import { questionPlan, sharedLookOf } from './process/sourceLook.ts';
import type { SharedLook } from '../domain/assistant/sharedLook.ts';
import type { ProcessModel } from '../domain/processModel/types.ts';

export type LoadedFacts = ProcessFacts & {
  statusLabel: string; statusTone: 'neutral' | 'draft' | 'approved' | 'changed';
  /** The assessment in short; null until the process has a step to assess. */
  card: ProcessCard | null;
};
export const STATUS_TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;

function questionCounts(processId: string, model: ProcessModel, shared: SharedLook) {
  const { plan } = questionPlan(processId, model, undefined, shared.look, shared.dismissed);
  return { now: plan.now.length, found: plan.found.length, wait: plan.wait.length };
}

export async function loadProcessFacts(store: JourneyStore, p: ProcessRow, settings?: AssessmentSettings): Promise<LoadedFacts> {
  const revisions = await store.listRevisions(p.id);
  const status = revisionStatus(revisions);
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  // The look in the sources as the server shares it, so every page and the weekday email count the same.
  const [model, proposals, decisions, shared] = await Promise.all([current ? store.getModel(current.id) : Promise.resolve(null), store.listProposals(p.id), store.getAssessmentDecisions(p.id).catch(() => null), sharedLookOf(store, p.id)]);
  return {
    id: p.id, name: p.name, analystId: p.analystId ?? null, architectId: p.architectId ?? null, approverId: p.approverId ?? null,
    status: revisions.length === 0 ? 'none' : status.tone === 'approved' ? 'approved' : status.tone === 'changed' ? 'changed' : 'draft',
    openQuestions: model ? model.openQuestions.filter(q => q.status === 'open').length : 0,
    // The first list (part D): what only people can answer now, what the sources answer, what can wait.
    questions: model && model.steps.length ? questionCounts(p.id, model, shared) : undefined,
    proposalsWaiting: proposals.filter(x => x.state === 'proposed' || x.state === 'selected').length,
    statusLabel: status.label, statusTone: status.tone,
    // The approach in effect for each step, people's choices included, as on the process's own pages.
    card: model ? processCard(assessProcess(model, { settings, decisions })) : null,
  };
}
