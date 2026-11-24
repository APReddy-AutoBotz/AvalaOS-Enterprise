// Approving keeps the documents (package 14, pull request 3): what the approver's page reads and sends. The
// order of reading is part of the rule (recorded for pull request 3): where the process stands with its
// versions (its count of changes seen) is read first, then everything the documents are built from. A save in
// between moves the count, and the database refuses the approval and asks for a reload; it never keeps a copy
// without that save.
import type { JourneyStore, VersionStateRow } from '../store/types.ts';
import { approvalChanges, approvalTarget, keepInputFrom, keptLaterRevision, keptRevision, type ApprovalTarget, type KeepRecord } from '../../domain/docs/approving.ts';
import { buildKeptDocuments, fingerprintsOf, keptInputs, keptLook, keptSizes, type KeptDocuments, type KeptLook, type Fingerprints, type KeptInputs, type KeepInput } from '../../domain/docs/keep.ts';
import type { VersionChanges } from '../../domain/docs/versions.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { AssessmentSettings } from '../../domain/assess/settings.ts';
import { BUILD } from '../build.ts';
import { FORMAT_LABEL } from '../../domain/workspace/sources.ts';
import { approvalCounts, type ApprovalCounts } from '../../domain/questions/approvalCounts.ts';

export const longDate = (iso: string | Date) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * A read the approval could not make. A kept version can never be corrected, so it is never built from less than
 * the whole record: nothing falls back to empty, and approve_version is not called.
 */
export class ApprovalReadError extends Error {
  readonly what: string;
  constructor(what: string, cause?: unknown) { super(`${what} could not be read`, { cause }); this.name = 'ApprovalReadError'; this.what = what; }
}
const read = <T,>(what: string, p: Promise<T>): Promise<T> => p.catch(e => { throw new ApprovalReadError(what, e); });

/** Everything the documents of a process are built from, as stored (never a viewer's switch for the visit). */
export async function loadRecord(store: JourneyStore, processId: string, workspaceId: string, model: ProcessModel): Promise<KeepRecord & { settings?: AssessmentSettings }> {
  const [decisions, settings, docSettings, stored, edits, testEdits, sources, members] = await Promise.all([
    read("people's choices for this process", store.getAssessmentDecisions(processId)), read("the workspace's assessment settings", store.getSettings(workspaceId)),
    read('how documents look', store.getDocumentSettings(workspaceId)), read('the requirements', store.listRequirements(processId)),
    read('the section edits', store.listDocumentEdits(processId)), read("testers' edits", store.listTestEdits(processId)),
    read('the sources', store.listSources(processId)), read("the people's names", store.listMembers(workspaceId)),
  ]);
  return {
    model, decisions, settings: settings.settings, stored, edits, testEdits, layouts: docSettings.layouts,
    sources: sources.map(s => ({ key: s.key, title: s.title, archived: s.archived })),
    names: Object.fromEntries(members.map(m => [m.userId, m.name])),
  };
}

/**
 * An approval ready to confirm: what will be kept, what changed since the version before, and what the page saw.
 * `keep`: "Keep it as it reads now" (part J), for the approved revision that has no kept copy, with who approved
 * it and when, as the revision records them.
 */
export interface PreparedApproval {
  mode: 'approve' | 'keep';
  /** For a keep: the approved revision kept, its approval date and its approver's name (null: not recorded). */
  approved?: { revNo: number; approvedAt: string; approverName: string | null };
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
  /** The two numbers on the confirmation (part L): open questions that could still change what is approved. */
  counts: ApprovalCounts | null;
  /**
   * The kept set again with the reason typed in the window: the evidence pack kept with the version lists the
   * version with its reason (part I). Nothing else in the set depends on the reason.
   */
  withReason: (reason: string | null) => { kept: KeptDocuments; fingerprints: Fingerprints; size: number };
}

/**
 * What only the evidence pack reads, for the pack kept with the version (pull request 5): the sources, the work
 * proposals and their board items' status, the review comments, the versions kept so far and who is approving.
 * Every read stops the approval if it fails, as the others do.
 */
async function loadEvidence(store: JourneyStore, processId: string, workspaceId: string) {
  const [sources, proposals, projects, comments, versions, me] = await Promise.all([
    read('the sources', store.listSources(processId)), read('the work proposals', store.listProposals(processId)),
    read('the boards', store.listProjects(workspaceId)), read('the review comments', store.listSectionComments(processId)),
    read('the approved versions', store.listVersions(processId)), read('who you are', store.currentUser()),
  ]);
  const onBoard = new Set(proposals.map(p => p.workItemId).filter(Boolean));
  const boardStatus: Record<string, string> = {};
  if (onBoard.size) {
    for (const items of await read('the board items', Promise.all(projects.map(p => store.listWorkItems(p.id))))) for (const i of items) if (onBoard.has(i.id)) boardStatus[i.id] = i.status;
  }
  return { sources, proposals, boardStatus, comments, versions, meId: me?.id ?? null };
}

/**
 * Reads the version state first, then the record, and builds what approving would keep. Null: nothing to approve.
 * With `keep`, it builds from the approved record, never from a working draft, and only while that record has
 * no kept copy.
 */
export async function prepareApproval(store: JourneyStore, processId: string, workspaceId: string, mode: 'approve' | 'keep' = 'approve'): Promise<PreparedApproval | null> {
  const [state] = await read('where the process stands with its approved versions', store.versionStates(workspaceId, processId));
  if (!state) return null;
  if (mode === 'keep' && (state.approvedRevisionId === null || state.approvedHasVersion)) return null;
  const revisions = await read('the revisions of the process record', store.listRevisions(processId));
  const target: ApprovalTarget | null = mode === 'keep' ? { from: 'approved', revisionId: null, expectedSeq: null } : approvalTarget(revisions);
  if (!target) return null;
  const revision = target.from === 'draft' ? revisions.find(r => r.id === target.revisionId) : revisions.find(r => r.state === 'approved');
  if (mode === 'keep' && revision?.id !== state.approvedRevisionId) return null;
  const model = revision ? await read('the process record', store.getModel(revision.id)) : null;
  if (!model) return null;
  const latest = state.latest;
  const [record, docSettings, ev, before] = await Promise.all([
    loadRecord(store, processId, workspaceId, model), read('how documents look', store.getDocumentSettings(workspaceId)),
    loadEvidence(store, processId, workspaceId),
    // The version before, for what changed: its fingerprints and its look (only here and when a version is opened).
    latest ? read(`approved version ${latest.number}`, Promise.all([store.getVersionPrints(latest.id), store.getVersionLook(latest.id)])).then(([p, look]) => ({ fingerprints: p.fingerprints, look })) : Promise.resolve(null),
  ]);
  const number = (state.latest?.number ?? 0) + 1;
  const base = keepInputFrom(record, (mode === 'keep' ? keptLaterRevision : keptRevision)(number, longDate(new Date())));
  const approved = mode === 'keep' && revision
    ? { revNo: revision.revNo, approvedAt: revision.approvedAt ?? '', approverName: (revision.approvedBy && record.names[revision.approvedBy]?.trim()) || null }
    : undefined;
  const nowIso = new Date().toISOString();
  const myName = (ev.meId && record.names[ev.meId]?.trim()) || null;
  const revNoOf = new Map(revisions.map(r => [r.id, r.revNo]));
  // The evidence pack kept with the version records whose approval it is: for Approve, the approver's, today;
  // for a copy kept later, the revision's own approval, and who kept it today (part I).
  const evidence = (reason: string | null): NonNullable<KeepInput['evidence']> => ({
    revisions: revisions.map(r => ({ revNo: r.revNo, state: r.state, createdAt: r.createdAt, approvedAt: r.approvedAt, approvedBy: r.approvedBy ?? null })),
    revNo: revision!.revNo,
    allSources: ev.sources.map(s => ({ key: s.key, title: s.title, kind: FORMAT_LABEL[s.format] ?? '', createdAt: s.createdAt, passages: s.segmentCount, archived: s.archived })),
    proposals: ev.proposals, boardStatus: ev.boardStatus, comments: ev.comments,
    versions: ev.versions.map(v => ({ number: v.number, revNo: revNoOf.get(v.revisionId) ?? null, approvedAt: v.approvedAt, approvedByName: v.approvedByName, reason: v.reason, keptAt: v.keptAt, keptByName: v.keptByName })),
    keptAs: approved
      ? { number, approvedAt: approved.approvedAt, approverName: approved.approverName, reason, kept: { at: nowIso, name: myName } }
      : { number, approvedAt: nowIso, approverName: myName, reason },
  });
  const build = (reason: string | null) => {
    const kept = buildKeptDocuments({ ...base, evidence: evidence(reason) });
    return { kept, fingerprints: fingerprintsOf(kept), size: keptSizes(kept).total };
  };
  const first = build(null);
  const look = keptLook(docSettings.branding);
  return {
    mode, approved, number, target, state, kept: first.kept, fingerprints: first.fingerprints, look, changes: approvalChanges(before, first.kept, look),
    inputs: keptInputs(base, { build: BUILD, settings: record.settings }), size: first.size,
    counts: approvalCounts(model, base.assessment), withReason: build,
  };
}

/** Sends the prepared approval (or keep) with the reason. The database approves and keeps in one step. */
export function approvePrepared(store: JourneyStore, processId: string, prepared: PreparedApproval, reason: string | null) {
  // The reason goes into the evidence pack kept with the version; version 1 has none, so nothing is rebuilt.
  const p = reason?.trim() ? { ...prepared, ...prepared.withReason(reason.trim()) } : prepared;
  if (p.mode === 'keep') {
    return store.keepVersionAsReadsNow({
      processId, expectedVersion: p.state.latest?.number ?? 0, expectedChanges: p.state.changesSeen, reason: reason?.trim() || null,
      documents: p.kept, fingerprints: p.fingerprints, look: p.look, changes: p.changes, inputs: p.inputs,
    });
  }
  return store.approveVersion({
    processId, revisionId: p.target.revisionId, expectedSeq: p.target.expectedSeq, expectedVersion: p.state.latest?.number ?? 0,
    expectedChanges: p.state.changesSeen, reason: reason?.trim() || null, documents: p.kept, fingerprints: p.fingerprints, look: p.look,
    changes: p.changes, inputs: p.inputs,
  });
}
