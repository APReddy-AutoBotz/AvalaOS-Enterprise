// What approval keeps (package 14 of docs/next-plan.md: "an approved document is final"). At approval the
// approver's browser builds every document the process offers, exactly as the Documents page shows it
// (section edits and the company layout applied, the SDD as final), and the database keeps that copy with
// the approval in one step. Nothing is rebuilt from it later: an approved version opens, prints and
// downloads from the kept trees, and a change after approval is only ever the working draft's.
//
// A kept version can never be rewritten, so what is written here must stay readable for good. Every kept
// set carries KEPT_FORMAT. A later release that changes the shape of a tree, of the look or of a fingerprint
// adds a reader for the new format and keeps the reader for every earlier one; the frozen fixture in
// domain/docs/fixtures/kept-v1.json and keep.test.ts hold the earlier format to that.
import type { DocTree, DocType, Section, Block } from './tree.ts';
import type { DocInput } from './common.ts';
import type { SectionEdit } from './edits.ts';
import { applyEdits } from './edits.ts';
import type { TestCaseEdit } from './testEdits.ts';
import { packAsRun } from './testEdits.ts';
import type { Branding, DocLayout } from './branding.ts';
import { applyLayout } from './layout.ts';
import { buildBrd } from './brd.ts';
import { buildPdd } from './pdd.ts';
import { buildFrd } from './frd.ts';
import { buildSdd } from './sdd.ts';
import { buildAgent } from './agent.ts';
import { buildTests, testPack, type TestPack } from './tests.ts';
import { buildEvidence, type EvidenceInput } from './evidence.ts';
import { deliveryPlan } from '../plan/delivery.ts';
import { offersDocument, whatFollows } from '../plan/purpose.ts';
import { hashValue } from '../processModel/hash.ts';

/** The format of a kept version. Raised only together with a reader for the new format; never reused. */
export const KEPT_FORMAT = 1;
/** Every format this release can read. A kept version in any other format is refused, never guessed at. */
export const READABLE_FORMATS: readonly number[] = [1];

/** The documents a version can keep, in the order the Documents page shows its tabs. */
export const KEPT_TYPES = ['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests', 'evidence'] as const;
export type KeptType = typeof KEPT_TYPES[number];
/** The documents compared for "unapproved changes" and "what changed": all but the evidence pack, which moves with the board (question 5). */
export const COMPARED_TYPES: readonly KeptType[] = ['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests'];

/** The look a Word file is written with, as it was at approval. Kept once per workspace by its fingerprint. */
export interface KeptLook {
  organisation: string;
  font: string;
  accent: string;
  logo: string | null;
  /** Only what the Word writer reads from a company template: its name and styles. */
  template: { name: string; stylesXml: string } | null;
}

/** One section's fingerprint, in the document's order, with the title it read under (for a section later removed). */
export interface SectionPrint { id: string; title: string; fp: string }
export type Fingerprints = Partial<Record<KeptType, SectionPrint[]>>;

/** What a version keeps: the built documents, the test pack as run (for its spreadsheet download), and their fingerprints. */
export interface KeptDocuments {
  format: number;
  documents: Partial<Record<KeptType, DocTree>>;
  testPack: TestPack | null;
}

/** What building the kept documents needs: what the Documents page reads, as it is at that moment. */
export interface KeepInput extends DocInput {
  edits: SectionEdit[];
  testEdits: TestCaseEdit[];
  layouts: Partial<Record<DocType, DocLayout>>;
  /** What only the evidence pack reads. Absent: the evidence pack is not kept with this version. */
  evidence?: Omit<EvidenceInput, keyof DocInput | 'testEdits'>;
}

export class KeptFormatError extends Error {}

/** The documents the Documents page offers for this process: the same rules as its tabs. */
export function keptTypes(input: Pick<KeepInput, 'model' | 'assessment' | 'evidence'>): KeptType[] {
  const follows = whatFollows(input.model);
  const delivery = follows.future ? deliveryPlan(input.model, input.assessment) : null;
  return KEPT_TYPES.filter(t => offersDocument(input.model, t)
    && (t !== 'agent' || (delivery?.docs ?? []).some(d => d.doc === 'agent'))
    && (t !== 'evidence' || Boolean(input.evidence)));
}

// A map's PNG is drawn by the browser at download and never kept: the kept SVG is the drawing.
const withoutPng = (b: Block): Block => (b.kind === 'figure' && 'png' in b ? (({ png: _png, ...rest }) => rest)(b) : b);
const keptTree = (doc: DocTree): DocTree => ({ ...doc, sections: doc.sections.map(s => ({ ...s, blocks: s.blocks.map(withoutPng) })) });

/**
 * Every document the process offers, built as the Documents page builds it: section edits applied, then
 * the company layout; the SDD as final; the test pack with testers' edits; the evidence pack as it reads
 * (no edits, no layout). The same function builds the working draft's documents for the comparison, so
 * the two sides can only differ where the process, its settings or the code differ.
 */
export function buildKeptDocuments(input: KeepInput): KeptDocuments {
  const documents: Partial<Record<KeptType, DocTree>> = {};
  const base: DocInput = { model: input.model, assessment: input.assessment, decisions: input.decisions, sources: input.sources, requirements: input.requirements, revision: input.revision, mapShape: input.mapShape, names: input.names };
  for (const t of keptTypes(input)) {
    if (t === 'evidence') { documents.evidence = keptTree(buildEvidence({ ...base, ...input.evidence!, testEdits: input.testEdits, names: input.names ?? {} })); continue; }
    const raw = t === 'brd' ? buildBrd(base) : t === 'pdd' ? buildPdd(base) : t === 'frd' ? buildFrd(base) : t === 'sdd' ? buildSdd(base) : t === 'agent' ? buildAgent(base) : buildTests(base, input.testEdits);
    documents[t] = keptTree(applyLayout(applyEdits(raw, input.edits).doc, input.layouts[t]));
  }
  const testPackKept = documents.tests ? packAsRun(testPack(base), input.testEdits) : null;
  return { format: KEPT_FORMAT, documents, testPack: testPackKept };
}

/** The look as kept: only what the Word writer reads. */
export function keptLook(b: Branding): KeptLook {
  return { organisation: b.organisation, font: b.font, accent: b.accent, logo: b.logo, template: b.template ? { name: b.template.name, stylesXml: b.template.stylesXml } : null };
}

/**
 * A section's fingerprint: its title, level and blocks, never its number (a section pushed down by a new one
 * before it has not changed itself). Part of format 1: a later release computes it the same way for a
 * format-1 version, or the comparison would mark every section changed.
 */
export const sectionFingerprint = (s: Section): string => hashValue({ title: s.title, level: s.level, blocks: s.blocks.map(withoutPng) });

/** The fingerprints a version keeps beside its documents, so the Documents page compares without fetching them. */
export function fingerprintsOf(kept: Pick<KeptDocuments, 'documents'>): Fingerprints {
  const out: Fingerprints = {};
  for (const t of COMPARED_TYPES) {
    const d = kept.documents[t];
    if (d) out[t] = d.sections.map(s => ({ id: s.id, title: s.title, fp: sectionFingerprint(s) }));
  }
  return out;
}

/** A kept set read back from the database: refused when this release cannot read its format. */
export function readKept(stored: unknown): KeptDocuments {
  const s = (stored && typeof stored === 'object' ? stored : null) as Partial<KeptDocuments> | null;
  if (!s || typeof s.format !== 'number' || !READABLE_FORMATS.includes(s.format)) throw new KeptFormatError(`This approved version was kept in a format this release cannot read (${String(s?.format ?? 'none')}).`);
  if (!s.documents || typeof s.documents !== 'object') throw new KeptFormatError('This approved version holds no documents.');
  return { format: s.format, documents: s.documents, testPack: s.testPack ?? null };
}

/** Sizes, for the limit the database checks and for the report: characters of JSON per document. */
export function keptSizes(kept: KeptDocuments): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, d] of Object.entries(kept.documents)) out[t] = JSON.stringify(d).length;
  if (kept.testPack) out.testPack = JSON.stringify(kept.testPack).length;
  out.total = JSON.stringify(kept).length;
  return out;
}
