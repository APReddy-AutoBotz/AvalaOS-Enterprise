// Approving keeps the documents (package 14, pull request 3): what the approver's page reads and sends. The
// order of reading is part of the rule (recorded for pull request 3): where the process stands with its
// versions (its count of changes seen) is read first, then everything the documents are built from. A save in
// between moves the count, and the database refuses the approval and asks for a reload; it never keeps a copy
// without that save.
import type { JourneyStore, VersionStateRow } from '../store/types.ts';
import { approvalChanges, approvalTarget, keepInputFrom, keptRevision, type ApprovalTarget, type KeepRecord } from '../../domain/docs/approving.ts';
import { buildKeptDocuments, fingerprintsOf, keptInputs, keptLook, keptSizes, type KeptDocuments, type KeptLook, type Fingerprints, type KeptInputs } from '../../domain/docs/keep.ts';
import { emptyDecisions } from '../../domain/assess/decisions.ts';
import type { VersionChanges } from '../../domain/docs/versions.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { AssessmentSettings } from '../../domain/assess/settings.ts';
import { BUILD } from '../build.ts';

export const longDate = (iso: string | Date) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** Everything the documents of a process are built from, as stored (never a viewer's switch for the visit). */
export async function loadRecord(store: JourneyStore, processId: string, workspaceId: string, model: ProcessModel): Promise<KeepRecord & { settings?: AssessmentSettings }> {
  const [decisions, settings, docSettings, stored, edits, testEdits, sources, members] = await Promise.all([
    store.getAssessmentDecisions(processId).catch(() => emptyDecisions()), store.getSettings(workspaceId), store.getDocumentSettings(workspaceId),
    store.listRequirements(processId), store.listDocumentEdits(processId), store.listTestEdits(processId), store.listSources(processId),
    store.listMembers(workspaceId).catch(() => []),
  ]);
  return {
    model, decisions, settings: settings.settings, stored, edits, testEdits, layouts: docSettings.layouts,
    sources: sources.map(s => ({ key: s.key, title: s.title, archived: s.archived })),
    names: Object.fromEntries(members.map(m => [m.userId, m.name])),
  };
}

/** An approval ready to confirm: what will be kept, what changed since the version before, and what the page saw. */
export interface PreparedApproval {
  number: number;
  target: ApprovalTarget;
  state: VersionStateRow;
  kept: KeptDocuments;
  fingerprints: Fingerprints;
  look: KeptLook;
  changes: VersionChanges;
  inputs: KeptInputs;
  /** Characters of JSON, for the size limit and the report. */
  size: number;
}

/** Reads the version state first, then the record, and builds what approving would keep. Null: nothing to approve. */
export async function prepareApproval(store: JourneyStore, processId: string, workspaceId: string): Promise<PreparedApproval | null> {
  const [state] = await store.versionStates(workspaceId, processId);
  if (!state) return null;
  const revisions = await store.listRevisions(processId);
  const target = approvalTarget(revisions);
  if (!target) return null;
  const revision = target.from === 'draft' ? revisions.find(r => r.id === target.revisionId) : revisions.find(r => r.state === 'approved');
  const model = revision ? await store.getModel(revision.id) : null;
  if (!model) return null;
  const [record, docSettings, before] = await Promise.all([
    loadRecord(store, processId, workspaceId, model), store.getDocumentSettings(workspaceId),
    state.latest ? store.getVersionPrints(state.latest.id) : Promise.resolve(null),
  ]);
  const number = (state.latest?.number ?? 0) + 1;
  const input = keepInputFrom(record, keptRevision(number, longDate(new Date())));
  const kept = buildKeptDocuments(input);
  const look = keptLook(docSettings.branding);
  return {
    number, target, state, kept, fingerprints: fingerprintsOf(kept), look, changes: approvalChanges(before, kept, look),
    inputs: keptInputs(input, { build: BUILD, settings: record.settings }), size: keptSizes(kept).total,
  };
}

/** Sends the prepared approval with the reason. The database approves and keeps in one step. */
export function approvePrepared(store: JourneyStore, processId: string, p: PreparedApproval, reason: string | null) {
  return store.approveVersion({
    processId, revisionId: p.target.revisionId, expectedSeq: p.target.expectedSeq, expectedVersion: p.state.latest?.number ?? 0,
    expectedChanges: p.state.changesSeen, reason: reason?.trim() || null, documents: p.kept, fingerprints: p.fingerprints, look: p.look,
    changes: p.changes, inputs: p.inputs,
  });
}
