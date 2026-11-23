// Approving keeps the documents (package 14 of docs/next-plan.md, pull request 3). What the approver's page
// does, as rules: which record an approval keeps, the documents it keeps (built by buildKeptDocuments, the
// one builder), what changed since the version before, how the working draft is compared with the latest
// version, and when Approve is offered. No I/O: journey/process/keepVersion.ts reads the store and calls these.
import type { ProcessModel } from '../processModel/types.ts';
import type { Decisions } from '../assess/decisions.ts';
import { assessProcess } from '../assess/process.ts';
import type { AssessmentSettings } from '../assess/settings.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile, type StoredRequirement } from '../requirements/register.ts';
import type { SectionEdit } from './edits.ts';
import type { TestCaseEdit } from './testEdits.ts';
import type { DocLayout } from './branding.ts';
import type { DocType } from './tree.ts';
import { fingerprintsOf, type Fingerprints, type KeepInput, type KeptDocuments, type KeptLook, type KeptType } from './keep.ts';
import { fingerprintChanges, lookChanges, type DocumentVersionChange, type SectionVersionChange, type VersionChanges } from './versions.ts';

/** What a version is built from, as the store holds it: the stored choices, never a viewer's switch for the visit. */
export interface KeepRecord {
  model: ProcessModel;
  decisions: Decisions;
  settings?: AssessmentSettings;
  stored: StoredRequirement[];
  sources: { key: string; title: string; archived?: boolean }[];
  names: Record<string, string>;
  edits: SectionEdit[];
  testEdits: TestCaseEdit[];
  layouts: Partial<Record<DocType, DocLayout>>;
}

/** The revision line a kept version's documents carry in their document control (never part of a section). */
export const keptRevision = (number: number, date: string): KeepInput['revision'] => ({ label: `Approved version ${number}`, state: 'approved', date });

/**
 * The input the Documents page builds from, out of the stored record: the assessment with the stored choices
 * and settings, and the requirements reconciled as the page shows them. The working draft's comparison and
 * the approval use this one function, so the two can only differ where the record differs.
 */
export function keepInputFrom(r: KeepRecord, revision: KeepInput['revision']): KeepInput {
  const assessment = assessProcess(r.model, { rate: r.decisions.rate, settings: r.settings, decisions: r.decisions });
  const requirements = reconcile(deriveRequirements(r.model, assessment), r.stored).requirements;
  return {
    model: r.model, assessment, decisions: r.decisions, sources: r.sources.filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })),
    revision, requirements, names: r.names, edits: r.edits, testEdits: r.testEdits, layouts: r.layouts,
  };
}

/**
 * Which record an approval keeps. With a working draft that has edits (or with no approved revision yet), the
 * draft is approved with it. Otherwise the approved revision is kept as its documents read now: the record
 * itself did not change, only section edits, choices, requirements or settings. It is built from the approved
 * record, never from a working draft (recorded for pull request 3).
 */
export type ApprovalTarget = { from: 'draft'; revisionId: string; expectedSeq: number } | { from: 'approved'; revisionId: null; expectedSeq: null };
export function approvalTarget(revisions: { id: string; state: string; seq: number }[]): ApprovalTarget | null {
  const working = revisions.find(r => r.state === 'working');
  const approved = revisions.find(r => r.state === 'approved');
  if (working && (working.seq > 0 || !approved)) return { from: 'draft', revisionId: working.id, expectedSeq: working.seq };
  return approved ? { from: 'approved', revisionId: null, expectedSeq: null } : null;
}

/**
 * Whether Approve is offered. A working draft of the record can always be approved by an approver. Without one,
 * there is something to approve only when a version exists and a change was saved since: by a person on this
 * process, or for the whole workspace. An approval from before copies were kept is kept as it reads with its
 * own action (pull request 4), not through Approve.
 */
export function offersApproval(i: { canApprove: boolean; target: ApprovalTarget | null; latest: number | null; processChanged: boolean; workspaceChanges: readonly string[] }): boolean {
  if (!i.canApprove || !i.target) return false;
  if (i.target.from === 'draft') return true;
  return i.latest !== null && (i.processChanged || i.workspaceChanges.length > 0);
}

/** What changed since the version before, as stored with the new version. Version 1 has nothing before it. */
export function approvalChanges(before: { fingerprints: Fingerprints; look: KeptLook } | null, kept: Pick<KeptDocuments, 'documents'>, look: KeptLook): VersionChanges {
  if (!before) return { sections: [], documents: [], look: [] };
  return { ...fingerprintChanges(before.fingerprints, fingerprintsOf(kept)), look: lookChanges(before.look, look) };
}

export interface DraftComparison {
  sections: SectionVersionChange[];
  documents: DocumentVersionChange[];
  /** Sections that read differently, counting every section of a document added or no longer offered. */
  differing: number;
  /** For each document, the ids of its sections marked "Changed since version N". */
  byDoc: Partial<Record<KeptType, Set<string>>>;
}

/** The working draft's documents (built from the stored record) against the latest version's fingerprints. */
export function compareDraft(prints: Fingerprints, draft: Pick<KeptDocuments, 'documents'>): DraftComparison {
  const now = fingerprintsOf(draft);
  const { sections, documents } = fingerprintChanges(prints, now);
  const byDoc: Partial<Record<KeptType, Set<string>>> = {};
  for (const s of sections) if (s.kind !== 'removed') (byDoc[s.doc] ??= new Set()).add(s.id);
  for (const d of documents) if (d.kind === 'added') byDoc[d.doc] = new Set((now[d.doc] ?? []).map(s => s.id));
  const whole = documents.reduce((n, d) => n + ((d.kind === 'added' ? now[d.doc] : prints[d.doc])?.length ?? 0), 0);
  return { sections, documents, differing: sections.length + whole, byDoc };
}
