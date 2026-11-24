// Approved versions of a process's documents (package 14 of docs/next-plan.md): what changed between two
// kept sets, the reason rule, the tag on a process, and the words the Documents page says. The words are
// those the owner approved on 21 November 2026 (items 1 to 5 of the plan's part N), and the line for a
// change made for the whole workspace (question 8).
import type { DocTree } from './tree.ts';
import { sectionLines, type DiffLine, diffLines } from './changes.ts';
import { COMPARED_TYPES, fingerprintsOf, sectionFingerprint, type Fingerprints, type KeptDocuments, type KeptLook, type KeptType } from './keep.ts';
import { docShort } from './tree.ts';

export interface SectionVersionChange { doc: KeptType; id: string; title: string; kind: 'changed' | 'added' | 'removed' }
export interface DocumentVersionChange { doc: KeptType; kind: 'added' | 'removed' }
export type LookPart = 'organisation' | 'font' | 'accent' | 'logo' | 'template';
/** What changed since the version before, as stored with a version and listed in its "What changed". */
export interface VersionChanges { sections: SectionVersionChange[]; documents: DocumentVersionChange[]; look: LookPart[] }

const LOOK_PARTS: LookPart[] = ['organisation', 'font', 'accent', 'logo', 'template'];
export const LOOK_WORDS: Record<LookPart, string> = { organisation: 'the organisation name', font: 'the font', accent: 'the accent colour', logo: 'the logo', template: 'the Word template' };

/** The parts of the look that differ. */
export function lookChanges(before: KeptLook | null, after: KeptLook): LookPart[] {
  if (!before) return [];
  return LOOK_PARTS.filter(p => (p === 'template' ? (before.template?.stylesXml ?? null) !== (after.template?.stylesXml ?? null) || (before.template?.name ?? null) !== (after.template?.name ?? null) : before[p] !== after[p]));
}

/**
 * What changed from one set of fingerprints to the next, document by document and section by section, in
 * the new documents' order (removed sections last). The evidence pack is never compared. The same function
 * serves the Documents page (the kept version's fingerprints against the draft's) and approval (the last
 * version's against the set about to be kept), so both say the same thing.
 */
export function fingerprintChanges(before: Fingerprints, after: Fingerprints): Omit<VersionChanges, 'look'> {
  const sections: SectionVersionChange[] = [];
  const documents: DocumentVersionChange[] = [];
  for (const doc of COMPARED_TYPES) {
    const a = before[doc], b = after[doc];
    if (!a && !b) continue;
    if (!a) { documents.push({ doc, kind: 'added' }); continue; }
    if (!b) { documents.push({ doc, kind: 'removed' }); continue; }
    const old = new Map(a.map(s => [s.id, s]));
    for (const s of b) {
      const o = old.get(s.id);
      if (!o) sections.push({ doc, id: s.id, title: s.title, kind: 'added' });
      else if (o.fp !== s.fp) sections.push({ doc, id: s.id, title: s.title, kind: 'changed' });
    }
    const now = new Set(b.map(s => s.id));
    for (const s of a) if (!now.has(s.id)) sections.push({ doc, id: s.id, title: s.title, kind: 'removed' });
  }
  return { sections, documents };
}

/** What changed between two kept sets, with the look. Version 1 (nothing before) has no changes. */
export function versionChanges(before: { kept: Pick<KeptDocuments, 'documents'>; look: KeptLook } | null, after: { kept: Pick<KeptDocuments, 'documents'>; look: KeptLook }): VersionChanges {
  if (!before) return { sections: [], documents: [], look: [] };
  return { ...fingerprintChanges(fingerprintsOf(before.kept), fingerprintsOf(after.kept)), look: lookChanges(before.look, after.look) };
}

/** The line-by-line view of one section, fetched only when a person opens it (both trees in hand). */
export function sectionDiff(before: DocTree | undefined, after: DocTree | undefined, id: string): DiffLine[] {
  const a = before?.sections.find(s => s.id === id), b = after?.sections.find(s => s.id === id);
  return diffLines(a ? sectionLines(a) : [], b ? sectionLines(b) : []);
}

/** The sections of a draft document that differ from a kept version's fingerprints, for "Changed since version N". */
export function sectionsDifferingFrom(prints: Fingerprints, doc: KeptType, draft: DocTree): Set<string> {
  const kept = new Map((prints[doc] ?? []).map(s => [s.id, s.fp]));
  return new Set(draft.sections.filter(s => kept.get(s.id) !== sectionFingerprint(s)).map(s => s.id));
}

export const changeCount = (c: Pick<VersionChanges, 'sections' | 'documents'> & { look?: LookPart[] }) => c.sections.length + c.documents.length + (c.look?.length ?? 0);

/** "What changed" in words, for the confirmation and the version list. */
export function changeLines(c: VersionChanges): string[] {
  const out: string[] = [];
  for (const doc of COMPARED_TYPES) {
    const s = c.sections.filter(x => x.doc === doc);
    if (!s.length) continue;
    const part = (kind: SectionVersionChange['kind'], word: string) => { const t = s.filter(x => x.kind === kind).map(x => x.title); return t.length ? `${word}: ${t.join('; ')}` : null; };
    out.push(`${docShort(doc)}: ${[part('changed', 'changed'), part('added', 'added'), part('removed', 'removed')].filter(Boolean).join('. ')}.`);
  }
  for (const d of c.documents) out.push(d.kind === 'added' ? `${docShort(d.doc)} added.` : `${docShort(d.doc)} no longer offered.`);
  if (c.look.length) out.push(`The look: ${c.look.map(p => LOOK_WORDS[p]).join(', ')} changed.`);
  return out;
}

// ---- The reason ------------------------------------------------------------------------------------

/** The reason's limits. The database checks the same (migration approved_versions). */
export const REASON = { minWords: 3, maxChars: 2000 } as const;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Why a version cannot be approved with this reason, or null. Version 1 takes none; from version 2 it is required. */
export function reasonProblem(number: number, reason: string | null | undefined): string | null {
  const r = (reason ?? '').trim();
  if (number <= 1) return r ? 'The first approved version takes no reason.' : null;
  if (!r) return 'Say why there is a new version.';
  if (words(r) < REASON.minWords) return `Say why in at least ${REASON.minWords} words.`;
  if (r.length > REASON.maxChars) return `Keep the reason under ${REASON.maxChars} characters.`;
  return null;
}

/** Item 3 of part N: the reason's label and the line under it. */
export const REASON_LABEL = 'Why a new version?';
export const reasonHelp = (next: number) => `Required. Kept with version ${next} and shown in its list of versions.`;

// ---- The tag and the Documents line ----------------------------------------------------------------

/** What the tag needs: the latest kept version, whether anything of this process was saved since, and an older approval without a copy. */
export interface VersionState {
  latest: { number: number } | null;
  /** A change to this process saved after the latest version was approved (the record, or the change record's process rows). */
  processChanged: boolean;
  /** The latest approved revision's number when it has no kept version (approved before copies were kept). */
  legacyRevision: number | null;
}

/** Item 2 of part N, and the label of part J. Null: nothing is approved. A change made for the whole workspace never changes it (question 8). */
export function versionTag(s: VersionState): string | null {
  // The approved revision without a copy comes first: when a version exists it is older than what is approved
  // (a page opened before copies were kept approved with the old button), so "Approved version N" would be wrong.
  if (s.legacyRevision !== null) return `Approved revision ${s.legacyRevision} (before copies were kept)`;
  if (s.latest) return s.processChanged ? `Approved version ${s.latest.number} · unapproved changes` : `Approved version ${s.latest.number}`;
  return null;
}

/** Item 4 of part N. */
export const LEGACY_LABEL = 'Approved before copies were kept: shown as built today';
/** An earlier approval without a copy that is no longer the approved one: it is not shown, so not "shown as built today". */
export const SUPERSEDED_LEGACY_LABEL = 'Approved before copies were kept';
export const keptLaterLabel = (date: string) => `Kept after approval, as it read on ${date}`;
/** Part J: what a copy kept later says when opened. Nothing is dated earlier than the day it was kept. */
export const keptLaterLine = (kept: string, approved: string) => `Kept after approval, as it read on ${kept}; the copy is not what was approved on ${approved}.`;
/** Proposed to the owner (pull request 4): the one question before keeping version 1 of an earlier approval. */
export const keepFirstQuestion = (revision: number, date: string, approver: string) =>
  `Keep approved revision ${revision} as its documents read now? It becomes approved version 1, recorded as approved on ${date} by ${approver} and kept today by you, after approval.`;
/** Proposed to the owner (pull request 4): the window's title when a version exists before it, and its opening line. */
export const keepTitle = (number: number) => `Keep version ${number} as it reads now`;
export const keepIntro = (number: number, revision: number, date: string, approver: string) =>
  `Approved revision ${revision} becomes approved version ${number} as its documents read now, recorded as approved on ${date} by ${approver} and kept today by you, after approval. Approved version ${number - 1} stays as it was.`;
/**
 * The day evidence packs are first kept with a version (package 14, pull request 5): set by the release's own
 * commit, checked by "Release dates set" (domain/site/releaseDates.ts). Until then the line shows "[release date]".
 */
export const EVIDENCE_KEPT_SINCE: string | null = '24 November 2026';
/** Owner-approved (24 November 2026): an opened version kept before evidence packs were kept with versions. */
export const noEvidenceLine = (since: string | null = EVIDENCE_KEPT_SINCE) =>
  `No evidence pack was kept with this version: packs are kept from ${since ?? '[release date]'} on.`;
/** Who approved, when the record holds no name for them. */
export const UNNAMED_APPROVER = 'an approver whose name was not recorded';

/** The workspace-wide changes the Documents page names (question 8). */
export type WorkspaceChange = 'assessment_settings' | 'layout' | 'look';
const WORKSPACE_WORDS: Record<WorkspaceChange, string> = { assessment_settings: 'assessment settings', layout: 'document sections', look: 'look' };

const sectionsRead = (k: number) => `${k} ${k === 1 ? 'section reads' : 'sections read'}`;
const listWords = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export interface DocumentsLineInput {
  number: number;
  approver: string;
  date: string;
  /** Sections of the documents that read differently from the kept version (the evidence pack not counted). */
  differing: number;
  /** A change to this process was saved since the version (the tag's "unapproved changes"). */
  processChanged: boolean;
  /** Changes made for the whole workspace since the version. */
  workspaceChanged: WorkspaceChange[];
  /**
   * The inputs index proves that only a release of Avala OS changed the documents: every input's fingerprint
   * equals the version's and the build differs (keptInputs, releaseProven). Only then is item 5 said.
   */
  releaseProven?: boolean;
}

/** Recorded for pull request 3 (owner, 22 November 2026): an edit saved and then undone. */
export const savedThenUndoneLine = (N: number) => `Changes were saved since approved version ${N}, and the working draft now reads exactly as that version.`;

/**
 * The line above the documents of a process that has a kept version. In order: nothing differs (and, when a
 * change was saved since, that it was undone); this process was changed (item 1 of part N); only the
 * workspace's settings changed (question 8); a release of Avala OS writes sections differently, said only
 * when the inputs index proves it (item 5); otherwise neutral words that blame nothing (proposed to the owner).
 */
export function documentsLine(i: DocumentsLineInput): string {
  const N = i.number;
  if (i.differing === 0 && !i.workspaceChanged.includes('look')) return i.processChanged ? savedThenUndoneLine(N) : `The working draft reads exactly as approved version ${N}.`;
  if (i.processChanged && i.differing > 0) {
    return `Approved version ${N} is kept exactly as it read when ${i.approver} approved it on ${i.date}. You are looking at the working draft: ${sectionsRead(i.differing)} differently. Approve again to make ${i.differing === 1 ? 'it' : 'them'} version ${N + 1}.`;
  }
  if (i.workspaceChanged.length) {
    const what = `the workspace's ${listWords(i.workspaceChanged.map(w => WORKSPACE_WORDS[w]))} changed`;
    return i.differing > 0
      ? `Since approved version ${N}, ${what}, so ${sectionsRead(i.differing)} differently today. Approved version ${N} is unchanged.`
      : `Since approved version ${N}, ${what}. Approved version ${N} is unchanged and downloads with the look it was approved with.`;
  }
  if (i.releaseProven) return `Avala OS now writes ${i.differing} ${i.differing === 1 ? 'section' : 'sections'} differently from approved version ${N}. The approved version is unchanged.`;
  return `${sectionsRead(i.differing)} differently from approved version ${N} today. Approved version ${N} is unchanged.`;
}

/** Whether only a release of Avala OS can explain a difference: every input the same, the build not. */
export function releaseProven(kept: { build: string; modelHash: string; inputs: Record<string, string> } | null, now: { build: string; modelHash: string; inputs: Record<string, string> }): boolean {
  if (!kept || kept.build === now.build || kept.modelHash !== now.modelHash) return false;
  const keys = new Set([...Object.keys(kept.inputs), ...Object.keys(now.inputs)]);
  return [...keys].every(k => kept.inputs[k] === now.inputs[k]);
}

/** Item 1 of part N, its first half, for the kept version's own band. */
export const openedVersionLine = (number: number, date: string, approver: string, keptOn?: string | null) =>
  keptOn ? `Approved version ${number}, approved on ${date} by ${approver}. ${keptLaterLine(keptOn, date)}` : `Approved version ${number}, approved on ${date} by ${approver}. As kept at approval.`;

/** A Word or Markdown file name for a kept version. */
export const versionFileName = (doc: KeptType, process: string, number: number, ext: 'docx' | 'md') => `${docShort(doc)} - ${process} - version ${number}.${ext}`;

