// The facts of one process that My work and the Processes page show: where it stands, who is named on
// it, what is open, and what its assessment says. Read through the store; what they mean is decided in
// domain/work/home.ts and domain/assess.
import type { JourneyStore, ProcessRow, VersionStateRow } from './store/types.ts';
import type { ProcessFacts } from '../domain/work/home.ts';
import { revisionStatus } from '../domain/workspace/route.ts';
import { versionTag } from '../domain/docs/versions.ts';
import { assessProcess } from '../domain/assess/process.ts';
import { processCard, type ProcessCard } from '../domain/assess/portfolio.ts';
import type { AssessmentSettings } from '../domain/assess/settings.ts';
import { sharedLookOf } from './process/sourceLook.ts';
import { firstListCounts } from '../domain/questions/counts.ts';
import { DECIDED_LIST_LINE, purposeOf, whatFollows } from '../domain/plan/purpose.ts';
import { APPROACH_LABEL } from '../domain/assess/scoring.ts';
import { lastChanged } from '../domain/work/changed.ts';

export type LoadedFacts = ProcessFacts & {
  statusLabel: string; statusTone: 'neutral' | 'draft' | 'approved' | 'changed';
  /** The assessment in short; null until the process has a step to assess, and for a process documented as it is or with its approach decided. */
  card: ProcessCard | null;
  /** "Approach decided by a person: Rule-based RPA", when how it will be built is already decided. */
  decidedLine?: string;
  /** When the process last changed: the later of its own change and its working draft's last saved edit. */
  changedAt: string | null;
};
export const STATUS_TONE = { neutral: 'neutral', draft: 'info', approved: 'ok', changed: 'warn' } as const;

/**
 * One process's facts for a list. `version` is its row of version_states, read once for the whole workspace by
 * the page (`versionRows`); without it (the read failed) the list keeps the revision's own words.
 */
export async function loadProcessFacts(store: JourneyStore, p: ProcessRow, settings?: AssessmentSettings, version?: VersionStateRow | null): Promise<LoadedFacts> {
  const revisions = await store.listRevisions(p.id);
  // With a kept version (package 14) the list says what the process page's tag says.
  const v = version ?? null;
  const tag = v ? versionTag({ latest: v.latest, processChanged: v.processChanged, legacyRevision: v.approvedHasVersion ? null : v.approvedRevNo }) : null;
  const byRevision = revisionStatus(revisions);
  const status: { label: string; tone: typeof byRevision.tone } = v?.latest && tag ? { label: tag, tone: v.processChanged ? 'changed' : 'approved' } : tag ? { label: tag, tone: byRevision.tone } : byRevision;
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  // The look in the sources as the server shares it, so every page and the weekday email count the same.
  const [model, proposals, decisions, shared, comments] = await Promise.all([current ? store.getModel(current.id) : Promise.resolve(null), store.listProposals(p.id), store.getAssessmentDecisions(p.id).catch(() => null), sharedLookOf(store, p.id), store.listSectionComments(p.id).catch(() => [])]);
  return {
    id: p.id, name: p.name, analystId: p.analystId ?? null, architectId: p.architectId ?? null, approverId: p.approverId ?? null,
    status: revisions.length === 0 ? 'none' : status.tone === 'approved' ? 'approved' : status.tone === 'changed' ? 'changed' : 'draft',
    openQuestions: model ? model.openQuestions.filter(q => q.status === 'open').length : 0,
    // The first list (part D): what only people can answer now, what the sources answer, what can wait.
    questions: firstListCounts(model, shared.look, shared.dismissed),
    proposalsWaiting: proposals.filter(x => x.state === 'proposed' || x.state === 'selected').length,
    // Open review comments, for the people named on the process (as the weekday email lists them).
    comments: comments.filter(c => !c.resolvedAt).map(c => ({ id: c.id, docType: c.docType, sectionKey: c.sectionKey, sectionTitle: c.sectionTitle, authorId: c.authorId, author: '', createdAt: c.createdAt })),
    statusLabel: status.label, statusTone: status.tone,
    changedAt: lastChanged(p.updatedAt, revisions),
    // The approach in effect for each step, people's choices included, as on the process's own pages.
    // A process documented as it is has no assessment: no score, no recommendation, no place in a ranking.
    card: model && whatFollows(model).assessed ? processCard(assessProcess(model, { settings, decisions })) : null,
    ...(purposeOf(model) !== 'assess' ? { purpose: purposeOf(model) } : {}),
    ...(purposeOf(model) === 'decided' && model?.meta.decidedApproach ? { decidedLine: DECIDED_LIST_LINE(APPROACH_LABEL[model.meta.decidedApproach.approach]) } : {}),
  };
}

/** Where each process of a workspace stands with its approved versions, in one call; empty when it cannot be read. */
export async function versionRows(store: JourneyStore, workspaceId: string): Promise<Map<string, VersionStateRow>> {
  const rows = await store.versionStates(workspaceId).catch(() => []);
  return new Map(rows.map(r => [r.processId, r]));
}
