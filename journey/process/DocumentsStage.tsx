// The Documents stage: the BRD and PDD of the process, written from the process model and the
// assessment. Read-only for now; every table follows the model, so correcting a fact in the
// Process or Assessment stage corrects the documents.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { emptyDecisions, type Decisions } from '../../domain/assess/decisions.ts';
import type { AssessmentSettings } from '../../domain/assess/settings.ts';
import { buildBrd } from '../../domain/docs/brd.ts';
import { buildPdd } from '../../domain/docs/pdd.ts';
import { toMarkdown } from '../../domain/docs/markdown.ts';
import { docShort, type Block, type Cell, type DocTree, type DocType } from '../../domain/docs/tree.ts';
import type { JourneyStore, RevisionRow, SourceRow } from '../store/types.ts';
import type { Proposal } from '../../domain/workitems/register.ts';
import { FORMAT_LABEL } from '../../domain/workspace/sources.ts';
import { buildEvidence } from '../../domain/docs/evidence.ts';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { StatusBadge } from './widgets.tsx';
import { GapsAssistant } from './GapsAssistant.tsx';
import { useQuestionPlan } from './sourceLook.ts';
import { nowHeading, planSummary } from '../../domain/questions/firstList.ts';
import { deliveryPlan } from '../../domain/plan/delivery.ts';
import { DecidedPanel } from './DecidedPanel.tsx';
import { documentsNote, offersDocument, PURPOSE_LABEL, purposeOf, whatFollows } from '../../domain/plan/purpose.ts';
import { useModelEditor } from './useModelEditor.ts';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '../../domain/docs/branding.ts';
import { applyLayout } from '../../domain/docs/layout.ts';
import { buildFrd } from '../../domain/docs/frd.ts';
import { buildSdd } from '../../domain/docs/sdd.ts';
import { buildAgent } from '../../domain/docs/agent.ts';
import { buildTests, testPack, testPackCsv } from '../../domain/docs/tests.ts';
import { packAsRun, type TestCaseEdit } from '../../domain/docs/testEdits.ts';
import { openCommentsText, reviewOf, type SectionComment } from '../../domain/docs/review.ts';
import { CommentButton, SectionComments, type ReviewContext } from './SectionComments.tsx';
import { TestCasesPanel } from './TestCasesPanel.tsx';
import type { Member } from '../store/types.ts';
import { deriveRequirements } from '../../domain/requirements/derive.ts';
import { reconcile, type StoredRequirement } from '../../domain/requirements/register.ts';
import { RequirementsPanel } from './RequirementsPanel.tsx';
import { applyEdits, EditError, makeEdit, type SectionEdit, type SectionStatus } from '../../domain/docs/edits.ts';
import { changedSections, type SectionChange } from '../../domain/docs/changes.ts';
import { shapeInEffect } from '../../domain/flowchart/shape.ts';
import { viewDecisions } from './mapShape.ts';
import { draftNarrative, draftToHtml, generatedText, groundingIssues, handoffChecklist, modelFacts, overlaps, SECTION_BRIEF } from '../../domain/docs/narrative.ts';

const SectionEditor = React.lazy(() => import('./SectionEditor.tsx'));

const TYPES: { id: DocType; short: string; label: string; ready: boolean }[] = [
  { id: 'brd', short: 'BRD', label: 'Business requirements', ready: true },
  { id: 'pdd', short: 'PDD', label: 'Process definition', ready: true },
  { id: 'frd', short: 'FRD', label: 'Functional requirements', ready: true },
  { id: 'sdd', short: 'SDD', label: 'Solution design', ready: true },
  { id: 'agent', short: 'Agent', label: 'Agent definition', ready: true },
  { id: 'tests', short: 'Tests', label: 'Test pack', ready: true },
  // Always one click away and never one of the planned documents (package 6 of docs/next-plan.md).
  { id: 'evidence', short: 'Evidence pack', label: 'Evidence pack', ready: true },
];

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #document-print, #document-print * { visibility: visible !important; }
  #document-print { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; border: 0; box-shadow: none; }
  #document-print .no-print { display: none !important; }
  #document-print tr, #document-print .keep { break-inside: avoid; }
  #document-print .flow-svg { max-height: none !important; overflow: visible !important; border: 0; }
  #document-print .flow-svg svg { width: 100% !important; height: auto !important; max-height: 250mm; }
  @page { margin: 16mm; }
}`;

/** A process map: fitted to the page width on screen and in print, with a full-size view to zoom in. */
function FigureView({ b }: { b: Extract<Block, { kind: 'figure' }> }) {
  const [full, setFull] = React.useState(false);
  return (
    <figure className="flow-figure" data-testid="flow-figure" data-caption={b.caption}>
      <figcaption className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold" style={{ color: 'var(--doc-accent)' }}>{b.caption}</span>
        <button type="button" className="no-print text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => setFull(!full)} aria-pressed={full}>{full ? 'Fit to width' : 'Full size'}</button>
      </figcaption>
      <div className={cx('flow-svg rounded-lg border border-slate-200 bg-white', full ? 'max-h-[80vh] overflow-auto' : '[&_svg]:h-auto [&_svg]:max-w-full')} dangerouslySetInnerHTML={{ __html: b.svg }} />
    </figure>
  );
}

function CellView({ c }: { c: Cell; key?: React.Key }) {
  if (c.missing) return <span className="italic text-amber-700">{c.text}</span>;
  return <>{c.text}{c.status && c.status !== 'stated' && c.status !== 'user-confirmed' && <span className="ml-1.5 align-middle"><StatusBadge status={c.status} /></span>}</>;
}

function BlockView({ b }: { b: Block; key?: React.Key }) {
  switch (b.kind) {
    case 'paragraph': return <p className="text-sm leading-7 text-slate-800">{b.text}</p>;
    case 'rich': return <div data-testid="edited-text" className="text-sm leading-7 text-slate-800 [&_h3]:mt-3 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: b.html }} />;
    case 'figure': return <FigureView b={b} />;
    case 'list': return <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-slate-800">{b.items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
    case 'callout': return <p className={cx('keep rounded-lg px-4 py-2.5 text-sm leading-6', b.tone === 'warning' ? 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200' : 'bg-slate-50 text-slate-600 ring-1 ring-inset ring-slate-200')}>{b.text}</p>;
    case 'openItem': return <p className="keep flex gap-2 rounded-lg bg-amber-50 px-4 py-2.5 text-sm leading-6 text-amber-900 ring-1 ring-inset ring-amber-200" data-testid="open-item"><span className="font-semibold">Open:</span>{b.item.text}</p>;
    case 'keyValue': return (
      <table className="w-full border-collapse text-sm"><caption className="sr-only">{b.caption}</caption>
        <tbody>{b.rows.map(r => <tr key={r.key} className="border-b border-slate-100"><th scope="row" className="w-64 py-2 pr-4 text-left align-top font-semibold text-slate-600">{r.key}</th><td className="py-2 text-slate-900"><CellView c={r.value} /></td></tr>)}</tbody>
      </table>
    );
    case 'table': return b.rows.length === 0 ? <p className="text-sm italic text-slate-500">{b.caption}: {b.empty}</p> : (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" data-testid="doc-table" data-caption={b.caption}>
          <caption className="caption-top pb-1.5 text-left text-xs font-semibold text-slate-500">{b.caption}</caption>
          <thead><tr>{b.columns.map(c => <th key={c} className="border-b-2 border-slate-300 px-2.5 py-2 text-left align-bottom text-xs font-semibold text-slate-600">{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i} className="border-b border-slate-100 align-top">{r.map((c, j) => <td key={j} className="px-2.5 py-2 text-slate-800"><CellView c={c} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
}

/** SVG maps drawn to PNG through a canvas, at twice their size, for the Word file. */
async function svgToPng(svg: string, width: number, height: number): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('The map could not be drawn.')); i.src = url; });
    const canvas = Object.assign(document.createElement('canvas'), { width: width * 2, height: height * 2 });
    const ctx = canvas.getContext('2d')!;
    ctx.scale(2, 2); ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}
async function withPngFigures(doc: DocTree): Promise<DocTree> {
  const sections = await Promise.all(doc.sections.map(async s => ({ ...s, blocks: await Promise.all(s.blocks.map(async b => (b.kind === 'figure' ? { ...b, png: await svgToPng(b.svg, b.width, b.height).catch(() => undefined) } : b))) })));
  return { ...doc, sections };
}

export function DocumentsStage({ store, processId, workspaceId, model: loaded, working, onSaved, canEdit, revision, sources, me, onSourcesChanged, approvedRevision = null, approvedRevisionId = null, onFix, currentRevisionId = '' }: {
  /** The revision shown (the working draft, else the approved one): a person's choice for a step is saved against it. */
  currentRevisionId?: string;
  /** The number of the latest approved revision, if any: the SDD is written once one exists. */
  approvedRevision?: number | null;
  /** The latest approved revision, when the working draft is newer: sections changed since then are marked. */
  approvedRevisionId?: string | null;
  /** Opens the Process stage, to fix what the hand-over checklist found. */
  onFix?: () => void;
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; working: { id: string; seq: number } | null; onSaved: () => void; canEdit: boolean; me: string; onSourcesChanged: () => void;
  revision: { label: string; state: 'working' | 'approved'; date: string }; sources: SourceRow[];
}) {
  const editor = useModelEditor(store, processId, { model: loaded, working }, onSaved);
  const model = editor.model;
  const [answering, setAnswering] = React.useState(false);
  const [previewSdd, setPreviewSdd] = React.useState(false);
  const sddReady = approvedRevision !== null || previewSdd;
  // A link from the weekday email opens the document it names (?doc=pdd) at the section it names (#s-2-4).
  const asked = React.useRef(typeof location !== 'undefined' ? new URLSearchParams(location.search).get('doc') : null);
  // What the person wants from the process decides which documents there are (domain/plan/purpose.ts).
  const follows = whatFollows(model);
  const [type, setType] = React.useState<DocType>(() => (asked.current && ['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests'].includes(asked.current) && offersDocument(model, asked.current as DocType) ? asked.current as DocType : 'pdd'));
  React.useEffect(() => { if (!offersDocument(model, type)) setType('pdd'); }, [model, type]);
  const [decisions, setDecisions] = React.useState<Decisions | null>(null);
  const [settings, setSettings] = React.useState<AssessmentSettings | undefined>(undefined);
  const [docSettings, setDocSettings] = React.useState<DocumentSettings>(DEFAULT_DOCUMENT_SETTINGS);
  const [error, setError] = React.useState<string | null>(null);
  const [stored, setStored] = React.useState<StoredRequirement[] | null>(null);
  const [edits, setEdits] = React.useState<SectionEdit[]>([]);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [editBusy, setEditBusy] = React.useState(false);
  // Review comments and testers' edits (part F); members and who I am, for names and what I may do.
  const [comments, setComments] = React.useState<SectionComment[]>([]);
  const [testEdits, setTestEdits] = React.useState<TestCaseEdit[]>([]);
  const [members, setMembers] = React.useState<Member[]>([]);
  const [myId, setMyId] = React.useState('');
  const [commenting, setCommenting] = React.useState<string | null>(null);
  React.useEffect(() => {
    Promise.all([store.getAssessmentDecisions(processId), store.getSettings(workspaceId), store.getDocumentSettings(workspaceId), store.listRequirements(processId), store.listDocumentEdits(processId)])
      .then(([d, s, ds, r, ed]) => { setDecisions(viewDecisions(processId, d, canEdit)); setSettings(s.settings); setDocSettings(ds); setStored(r); setEdits(ed); }).catch(e => setError(messageOf(e)));
    Promise.all([store.listSectionComments(processId), store.listTestEdits(processId), store.listMembers(workspaceId), store.currentUser()])
      .then(([c, t, mem, u]) => { setComments(c); setTestEdits(t); setMembers(mem); setMyId(u?.id ?? ''); }).catch(e => setError(messageOf(e)));
  }, [store, processId, workspaceId]);
  // What only the evidence pack reads: every revision with who approved it, the work proposals, and the
  // status of the board items they became. Loaded when the pack is opened.
  const [evidenceRecord, setEvidenceRecord] = React.useState<{ revisions: RevisionRow[]; proposals: Proposal[]; boardStatus: Record<string, string> } | null>(null);
  React.useEffect(() => {
    if (type !== 'evidence' || evidenceRecord) return;
    let live = true;
    (async () => {
      const [revisions, proposals, projects] = await Promise.all([store.listRevisions(processId), store.listProposals(processId), store.listProjects(workspaceId).catch(() => [])]);
      const onBoard = new Set(proposals.map(p => p.workItemId).filter(Boolean));
      const boardStatus: Record<string, string> = {};
      if (onBoard.size) for (const items of await Promise.all(projects.map(p => store.listWorkItems(p.id).catch(() => [])))) for (const i of items) if (onBoard.has(i.id)) boardStatus[i.id] = i.status;
      if (live) setEvidenceRecord({ revisions, proposals, boardStatus });
    })().catch(e => { if (live) setError(messageOf(e)); });
    return () => { live = false; };
  }, [type, evidenceRecord, store, processId, workspaceId]);
  const nameById = React.useMemo(() => Object.fromEntries(members.map(m => [m.userId, m.name])), [members]);
  const reviewCtx: ReviewContext = { store, processId, me: myId, canEdit, isAdmin: members.find(m => m.userId === myId)?.role === 'admin', members, onChanged: next => setComments(next) };
  const saveTestEdit = async (e: TestCaseEdit) => { await store.saveTestEdit(processId, e); setTestEdits(cur => [...cur.filter(x => x.caseCode !== e.caseCode), e]); };
  const removeTestEdit = async (code: string) => { await store.removeTestEdit(processId, code); setTestEdits(cur => cur.filter(x => x.caseCode !== code)); };

  const assessment = React.useMemo(() => (decisions ? assessProcess(model, { rate: decisions.rate, settings, decisions }) : null), [model, decisions, settings]);
  // The delivery plan (part B): its documents come first and the first of them opens, unless the person chose a tab.
  // Documented as it is, there is no delivery to plan: the process document is the one document.
  const delivery = React.useMemo(() => (assessment && follows.future ? deliveryPlan(model, assessment) : null), [model, assessment, follows.future]);
  const planned = React.useMemo(() => (follows.future ? new Set<DocType>((delivery?.docs ?? []).filter(d => d.planned && d.available).map(d => d.doc as DocType)) : new Set<DocType>(['pdd'])), [delivery, follows.future]);
  // The agent document is a tab only when the delivery plan lists it, planned or one click away (part E).
  const types = React.useMemo(() => TYPES.filter(t => offersDocument(model, t.id) && (t.id !== 'agent' || (delivery?.docs ?? []).some(d => d.doc === 'agent'))), [delivery, model]);
  const orderedTypes = React.useMemo(() => [...types.filter(t => planned.has(t.id)), ...types.filter(t => !planned.has(t.id))], [planned, types]);
  const typeChosen = React.useRef(Boolean(asked.current));
  React.useEffect(() => { if (!typeChosen.current && planned.size && !planned.has(type)) setType(orderedTypes[0].id); }, [planned, orderedTypes, type]);
  const plannedLine = !follows.future ? 'Planned for this process: the process document.' : delivery ? `Planned for this process: ${delivery.docs.filter(d => d.planned).map(d => (d.doc === 'agent' ? 'the agent document' : d.doc.toUpperCase())).join(', ')}.` : '';
  // The requirements register follows the model: new IDs for new sources, edits kept, removed sources marked.
  const register = React.useMemo(() => (assessment && stored ? reconcile(deriveRequirements(model, assessment), stored) : null), [model, assessment, stored]);
  React.useEffect(() => {
    // Documented as it is there are no requirements: the register is left exactly as it is, so nothing is marked removed.
    if (!register?.changed.length || !canEdit || !follows.future) return;
    store.saveRequirements(processId, register.changed).then(() => setStored(register.requirements)).catch(e => setError(messageOf(e)));
  }, [register, canEdit, store, processId, follows.future]);
  const saveRequirement = async (r: StoredRequirement) => {
    await store.saveRequirements(processId, [r]);
    setStored(cur => (cur ?? []).some(x => x.code === r.code) ? (cur ?? []).map(x => (x.code === r.code ? r : x)) : [...(cur ?? []), r]);
  };

  const built = React.useMemo<{ doc: DocTree; status: Record<string, SectionStatus> } | null>(() => {
    if (!decisions || !assessment) return null;
    const input = { model, assessment, decisions: decisions ?? emptyDecisions(), sources: sources.filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })), revision, requirements: register?.requirements, names: nameById };
    if (type === 'evidence') {
      // Read-only and built from the record as it is: no section edits, no company layout.
      if (!evidenceRecord || !register) return null;
      const current = evidenceRecord.revisions.find(r => r.state === (revision.state === 'approved' ? 'approved' : 'working')) ?? evidenceRecord.revisions[0];
      const doc = buildEvidence({
        ...input, revNo: current?.revNo ?? 0,
        revisions: evidenceRecord.revisions.map(r => ({ revNo: r.revNo, state: r.state, createdAt: r.createdAt, approvedAt: r.approvedAt, approvedBy: r.approvedBy ?? null })),
        allSources: sources.map(s => ({ key: s.key, title: s.title, kind: FORMAT_LABEL[s.format] ?? '', createdAt: s.createdAt, passages: s.segmentCount, archived: s.archived })),
        proposals: evidenceRecord.proposals, boardStatus: evidenceRecord.boardStatus, testEdits, comments,
        names: Object.fromEntries(members.map(m => [m.userId, m.name])),
      });
      return { doc, status: {} };
    }
    const raw = type === 'brd' ? buildBrd(input) : type === 'pdd' ? buildPdd(input) : type === 'frd' ? buildFrd(input) : type === 'agent' ? buildAgent(input) : type === 'tests' ? buildTests(input, testEdits) : sddReady ? buildSdd(input) : null;
    if (!raw) return null;
    const edited = applyEdits(raw, edits);
    return { doc: applyLayout(edited.doc, docSettings.layouts[type]), status: edited.status };
  }, [type, model, decisions, assessment, sources, revision, docSettings, register, sddReady, edits, testEdits, evidenceRecord, comments, members, nameById]);
  const doc = built?.doc ?? null;
  const scrolled = React.useRef(false);
  React.useEffect(() => {
    if (scrolled.current || !doc || typeof location === 'undefined' || !location.hash) return;
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) { scrolled.current = true; el.scrollIntoView({ block: 'start' }); }
  }, [doc]);
  const reviewView = React.useMemo(() => (doc ? reviewOf(doc, comments) : null), [doc, comments]);
  const testPackNow = React.useMemo(() => {
    if (type !== 'tests' || !decisions || !assessment) return null;
    return testPack({ model, assessment, decisions, sources: [], revision, requirements: register?.requirements });
  }, [type, model, decisions, assessment, revision, register]);
  // The same document built from the approved revision's model: what changed since approval.
  const [approvedModel, setApprovedModel] = React.useState<ProcessModel | null>(null);
  React.useEffect(() => { setApprovedModel(null); if (approvedRevisionId) store.getModel(approvedRevisionId).then(setApprovedModel).catch(() => setApprovedModel(null)); }, [store, approvedRevisionId]);
  // An approved revision's documents follow the answer it was approved with: when the draft's answer
  // differs, the two are different documents, and that is said once instead of marking every section.
  const answerChanged = Boolean(approvedModel && purposeOf(approvedModel) !== purposeOf(model));
  const sinceApproved = React.useMemo<SectionChange[]>(() => {
    if (!approvedModel || !doc || !decisions || !stored || type === 'evidence' || purposeOf(approvedModel) !== purposeOf(model)) return [];
    const a = assessProcess(approvedModel, { rate: decisions.rate, settings, decisions });
    // Both sides are drawn in the shape the maps are in now, so the shape alone never marks a section changed.
    const input = { model: approvedModel, assessment: a, decisions, mapShape: shapeInEffect(model, decisions).shape, sources: sources.filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })), revision, requirements: reconcile(deriveRequirements(approvedModel, a), stored).requirements };
    const raw = type === 'brd' ? buildBrd(input) : type === 'pdd' ? buildPdd(input) : type === 'frd' ? buildFrd(input) : type === 'agent' ? buildAgent(input) : type === 'tests' ? buildTests(input, testEdits) : buildSdd(input);
    return changedSections(applyLayout(applyEdits(raw, edits).doc, docSettings.layouts[type]), doc);
  }, [approvedModel, doc, decisions, stored, settings, sources, revision, type, edits, docSettings, model]);
  const changedIds = new Set(sinceApproved.map(c => c.id));
  // All four documents, for the hand-over checklist, the overlap check and what counts as grounded.
  const all = React.useMemo(() => {
    if (!decisions || !assessment) return null;
    const input = { model, assessment, decisions, sources: sources.filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })), revision, requirements: register?.requirements };
    const raw = follows.future ? [buildBrd(input), buildPdd(input), buildFrd(input), buildSdd(input)] : [buildPdd(input)];
    const docsWithEdits = raw.map(d => applyEdits(d, edits).doc);
    return { known: generatedText(raw), checks: handoffChecklist(model, docsWithEdits), overlap: overlaps(docsWithEdits, model) };
  }, [model, decisions, assessment, sources, revision, register, edits, follows.future]);
  const [showChecks, setShowChecks] = React.useState(false);
  const failing = all ? all.checks.filter(c => !c.ok).length + (all.overlap.length ? 1 : 0) : 0;
  const checkText = (html: string) => groundingIssues(html, model, all?.known ?? '');
  const draftFor = (title: string, number: string) => store.aiAvailable ? async () => {
    const segments = [SECTION_BRIEF(doc!.title, `${number} ${title}`, `Write the narrative of this section of the ${doc!.title}.`), ...modelFacts(model)];
    const r = await store.runAiTask(workspaceId, draftNarrative.id, segments as any);
    return draftToHtml(r.data, model);
  } : undefined;
  const [showChanges, setShowChanges] = React.useState(false);
  const review = built ? Object.values<SectionStatus>(built.status).filter(s => s.state === 'needs_review').length : 0;

  const saveEdit = async (sectionKey: string, html: string, hash: string) => {
    setEditBusy(true); setError(null);
    try {
      const e = makeEdit(type, sectionKey, html, hash);
      await store.saveDocumentEdit(processId, e);
      setEdits(cur => [...cur.filter(x => !(x.docType === type && x.sectionKey === sectionKey)), e]);
      setEditing(null);
    } catch (x) { setError(x instanceof EditError ? x.message : messageOf(x)); } finally { setEditBusy(false); }
  };
  const takeUpdate = async (sectionKey: string) => {
    setError(null);
    try {
      await store.removeDocumentEdit(processId, type, sectionKey);
      setEdits(cur => cur.filter(x => !(x.docType === type && x.sectionKey === sectionKey)));
    } catch (x) { setError(messageOf(x)); }
  };

  const [wordBusy, setWordBusy] = React.useState(false);
  const downloadWord = async () => {
    if (!doc) return;
    setWordBusy(true);
    try {
      // Loaded on demand: the Word library is only needed when someone downloads.
      const { toDocxBlob, docxStyleFrom } = await import('../../domain/docs/docx.ts');
      const blob = await toDocxBlob(await withPngFigures(doc), { draft: revision.state !== 'approved', style: docxStyleFrom(docSettings.branding) });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: `${model.meta.name} - ${docShort(doc.type)}.docx` });
      a.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(messageOf(e)); } finally { setWordBusy(false); }
  };
  // The test pack for Excel (part F): one row per case, as CSV, which Excel opens directly.
  const downloadExcel = () => {
    if (!decisions || !assessment) return;
    const input = { model, assessment, decisions, sources: sources.filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })), revision, requirements: register?.requirements };
    const url = URL.createObjectURL(new Blob([testPackCsv(packAsRun(testPack(input), testEdits))], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${model.meta.name} - Test pack.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const download = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([toMarkdown(doc)], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${model.meta.name} - ${docShort(doc.type)}.md` });
    a.click(); URL.revokeObjectURL(url);
  };

  // The first list (part D): the banner counts only what people must answer now and answers to confirm.
  const { plan } = useQuestionPlan(processId, model);
  const toAnswer = decisions ? plan : null;
  if (answering) return <><ErrorNote message={editor.error} /><GapsAssistant processId={processId} model={model} editor={editor} canEdit={canEdit} onClose={() => setAnswering(false)} notes={{ store, workspaceId, processId, me, sourceKeys: sources.map(s => s.key), onSourcesChanged, aiAvailable: store.aiAvailable }} branding={docSettings.branding} /></>;

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>
      <ErrorNote message={error ?? editor.error} />
      {toAnswer && (toAnswer.now.length + toAnswer.found.length + toAnswer.wait.length > 0 || toAnswer.counts.alreadyKnown > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4" data-testid="gaps-banner">
          <p className="text-sm text-amber-950"><span className="font-semibold">{nowHeading(toAnswer)}</span>. {planSummary(toAnswer)}</p>
          <Button onClick={() => setAnswering(true)}>{toAnswer.now.length || toAnswer.found.length ? 'Answer them' : 'See what can wait'}</Button>
        </div>
      )}
      {/* An approach decided for the whole process (package 9): what it can do, step by step, and why. */}
      {assessment && decisions && model.meta.decidedApproach && (
        <DecidedPanel model={model} assessment={assessment} names={nameById} meId={myId} canEdit={canEdit} editor={editor} store={store} processId={processId}
          revisionId={working?.id ?? currentRevisionId} decisions={decisions} onDecisions={setDecisions} onAnswerQuestions={() => setAnswering(true)} />
      )}
      {documentsNote(model) && <p className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-700" data-testid="documents-note">{documentsNote(model)}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* The delivery plan's documents first (part B), marked with an amber dot; the others stay one click away. */}
          <div role="tablist" aria-label="Documents" className="inline-flex flex-wrap rounded-lg bg-slate-200/70 p-0.5">
            {orderedTypes.map(t => (
              <button key={t.id} type="button" role="tab" aria-selected={type === t.id} onClick={() => { setType(t.id); typeChosen.current = true; }} data-planned={planned.has(t.id) ? 'yes' : 'no'}
                title={planned.has(t.id) ? 'Planned for this process' : 'Not in the plan for this process; one click away'}
                className={cx('rounded-md px-4 py-1.5 text-sm font-semibold transition', type === t.id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
                {planned.has(t.id) && <span aria-hidden className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#E69F00] align-middle" />}
                {t.short}<span className="ml-1.5 hidden font-normal text-slate-600 sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
          {plannedLine && <span className="text-xs text-slate-500" data-testid="planned-docs">{plannedLine}</span>}
        </div>
        {doc && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setShowChecks(!showChecks)} aria-expanded={showChecks}>{failing ? `Ready to hand over? ${failing} to fix` : 'Ready to hand over ✓'}</Button>{type === 'tests' && <Button onClick={downloadExcel}>Download for Excel</Button>}<Button variant={type === 'tests' ? 'secondary' : undefined} onClick={downloadWord} disabled={wordBusy}>{wordBusy ? 'Preparing…' : 'Download Word'}</Button><Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button><Button variant="ghost" onClick={download}>Markdown</Button></div>}
      </div>

      {!decisions ? (error ? null : <Spinner label="Writing the document" />) : !doc ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="doc-not-ready">
          <p className="font-display text-lg font-semibold text-slate-900">{TYPES.find(t => t.id === type)!.label} ({type.toUpperCase()})</p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">The SDD is written from an approved PDD: approve this revision of the process first, so the design rests on agreed steps. Design facts that are not in the sources become open design decisions.</p>
          <div className="mt-4"><Button variant="secondary" onClick={() => setPreviewSdd(true)}>Preview the SDD from this draft</Button></div>
        </div>
      ) : (
        <>
        {showChecks && all && (
          <section aria-label="Hand-over checklist" className="rounded-xl border border-slate-200 bg-white p-5" data-testid="handoff-checklist">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-display text-base font-semibold text-slate-900">Ready to hand over?</h3>
              <p className="text-xs text-slate-500">{follows.future ? 'Checks on the process and all four documents before they go to the delivery team.' : 'Checks on the process and its document before it is handed over.'}</p>
            </div>
            <ul className="mt-3 space-y-2">
              {all.checks.map(c => (
                <li key={c.id} className="rounded-xl px-3 py-2 ring-1 ring-inset ring-slate-200" data-testid="check" data-ok={c.ok}>
                  <p className="flex items-start gap-2 text-sm"><span className={c.ok ? 'text-emerald-700' : 'text-amber-700'} aria-hidden>{c.ok ? '✓' : '!'}</span><span className="font-semibold text-slate-900">{c.label}</span>{!c.ok && <span className="ml-auto shrink-0 text-xs text-slate-500">{c.failures.length} to fix</span>}</p>
                  {!c.ok && <ul className="mt-1 space-y-0.5 pl-6 text-xs text-slate-700">{c.failures.slice(0, 8).map((f, i) => <li key={i}>{f.text}{f.target && onFix && <button type="button" className="ml-2 font-semibold text-[#002C4B] hover:underline" onClick={onFix}>Fix in Process</button>}</li>)}{c.failures.length > 8 && <li>and {c.failures.length - 8} more</li>}</ul>}
                </li>
              ))}
              <li className="rounded-xl px-3 py-2 ring-1 ring-inset ring-slate-200" data-testid="check" data-ok={!all.overlap.length}>
                <p className="flex items-start gap-2 text-sm"><span className={all.overlap.length ? 'text-amber-700' : 'text-emerald-700'} aria-hidden>{all.overlap.length ? '!' : '✓'}</span><span className="font-semibold text-slate-900">Each fact has one home: no text is repeated across the documents</span></p>
                {all.overlap.length > 0 && <ul className="mt-1 space-y-0.5 pl-6 text-xs text-slate-700">{all.overlap.map((o, i) => <li key={i}>{o.a.doc.toUpperCase()} {o.a.section} and {o.b.doc.toUpperCase()} {o.b.section} say mostly the same ({Math.round(o.similarity * 100)}% the same words). Keep it in one and point to it from the other.</li>)}</ul>}
              </li>
            </ul>
          </section>
        )}
        {answerChanged && approvedModel && (
          <p className="rounded-xl bg-sky-50 px-4 py-2.5 text-sm text-sky-950 ring-1 ring-inset ring-sky-200" data-testid="answer-changed">
            <span className="font-semibold">Approved revision {approvedRevision} was approved as "{PURPOSE_LABEL[purposeOf(approvedModel)]}"</span>; this draft is "{PURPOSE_LABEL[purposeOf(model)]}". The approved documents are unchanged and follow the answer they were approved with; approve this draft to make these the approved version.
          </p>
        )}
        {sinceApproved.length > 0 && (
          <div className="rounded-xl bg-sky-50 px-4 py-2.5 text-sm text-sky-950 ring-1 ring-inset ring-sky-200" data-testid="since-approved">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-semibold">{sinceApproved.length} {sinceApproved.length === 1 ? 'section changed' : 'sections changed'} since approved revision {approvedRevision}</span>: the process was edited after approval. The approved document is unchanged; approve this draft to make these the approved version.</span>
              <button type="button" className="font-semibold text-[#002C4B] hover:underline" onClick={() => setShowChanges(!showChanges)} aria-expanded={showChanges}>{showChanges ? 'Hide changes' : 'Review changes'}</button>
            </div>
            {showChanges && (
              <ul className="mt-3 space-y-3" data-testid="change-list">
                {sinceApproved.map(c => (
                  <li key={c.id} className="rounded-lg bg-white p-3 ring-1 ring-inset ring-slate-200">
                    <a href={`#${c.id}`} className="text-sm font-semibold text-slate-900 hover:underline">{c.number} {c.title}</a>
                    <span className="ml-2 text-xs text-slate-500">{c.kind === 'added' ? 'New section' : c.kind === 'removed' ? 'Removed' : c.figure ? 'The map changed' : 'Changed'}</span>
                    {!c.figure && <div className="mt-2 max-h-56 overflow-auto font-mono text-[11px] leading-5">
                      {c.diff.filter(d => d.op !== 'same').slice(0, 40).map((d, i) => <div key={i} className={d.op === 'add' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900 line-through decoration-red-300'}>{d.op === 'add' ? '+ ' : '− '}{d.text}</div>)}
                    </div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {review > 0 && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="review-banner"><span className="font-semibold">{review} edited {review === 1 ? 'section needs' : 'sections need'} review:</span> the process changed after you edited {review === 1 ? 'it' : 'them'}. Keep your text or take the update in each section.</p>}
        {type === 'sdd' && approvedRevision === null && <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-950" data-testid="sdd-preview">Preview from the working draft: no revision is approved yet, so this SDD is not for sign-off.</p>}
        {type === 'tests' && <p className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm text-slate-700" data-testid="tests-note">One test case for each acceptance criterion of the functional requirements, so nothing is tested that no requirement states. It follows the requirements as they change; testers' own changes are kept, and a case whose requirement changed since is marked for review.</p>}
        {type === 'tests' && testPackNow && <TestCasesPanel pack={testPackNow} edits={testEdits} canEdit={canEdit} onSave={saveTestEdit} onRemove={removeTestEdit} />}
        {type === 'frd' && register && <RequirementsPanel model={model} requirements={register.requirements} canEdit={canEdit} onSave={saveRequirement} />}
        <div className="grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Contents" className="hidden lg:block">
            <div className="sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-sm">
              <p className="text-xs font-semibold text-slate-500">Contents</p>
              <ol className="mt-2 space-y-1">{doc.sections.map(s => <li key={s.id} className={s.level === 2 ? 'pl-3' : 'mt-2 font-semibold'}><a href={`#${s.id}`} className="text-slate-700 hover:text-[#002C4B] hover:underline"><span className="tabular-nums text-slate-500">{s.number}</span> {s.title}</a></li>)}</ol>
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{doc.openItems.length} open {doc.openItems.length === 1 ? 'item' : 'items'}</p>
              {openCommentsText(reviewView!.open) && <p className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-800" data-testid="open-comments">{openCommentsText(reviewView!.open)}</p>}
            </div>
          </nav>
          <article id="document-print" data-testid="document" className="min-w-0 rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-[0_1px_2px_rgba(15,23,42,0.05),0_16px_40px_-24px_rgba(15,23,42,0.18)] sm:px-12 sm:py-10" style={{ fontFamily: `${docSettings.branding.font}, Inter, sans-serif`, ['--doc-accent' as string]: `#${docSettings.branding.accent}` }}>
            <header className="border-b-4 pb-5" style={{ borderColor: 'var(--doc-accent)' }}>
              {docSettings.branding.logo && <img src={docSettings.branding.logo} alt="" className="mb-3 h-8 object-contain" />}
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{docSettings.branding.organisation ? `${docSettings.branding.organisation} · ` : ''}{doc.title}</p>
              <h2 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-slate-900">{doc.subtitle}</h2>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">{doc.control.slice(1).filter(c => c.key !== 'Typical content').map(c => <div key={c.key}><dt className="inline font-semibold">{c.key}: </dt><dd className="inline">{c.value}</dd></div>)}</dl>
              {doc.control.filter(c => c.key === 'Typical content').map(c => <p key={c.key} data-testid="typical-notice" className="mt-3 rounded-md bg-orange-50 px-3 py-2 text-sm leading-6 text-orange-950 ring-1 ring-inset ring-orange-200"><span className="font-semibold">Typical content.</span> {c.value}</p>)}
              {revision.state === 'working' && <p className="mt-3 inline-block rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">Draft until the revision is approved</p>}
            </header>
            {doc.sections.map(s => {
              const st = built!.status[s.id];
              const mine = edits.find(e => e.docType === type && e.sectionKey === s.id);
              const editable = canEdit && st && type !== 'tests' && !s.id.startsWith('c-') && !/^Open (gaps|questions)|Open design decisions/.test(s.title);
              const head = (
                <span className="flex flex-wrap items-center gap-2">
                  <span><span className={cx('mr-2 tabular-nums', s.level === 2 && 'text-slate-500')} style={s.level === 1 ? { color: 'var(--doc-accent)' } : undefined}>{s.number}</span>{s.title}</span>
                  {changedIds.has(s.id) && <span className="no-print rounded bg-sky-50 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-sky-800" data-testid="chip-changed">Changed since revision {approvedRevision}</span>}
                  {st?.state === 'edited' && <span className="no-print rounded bg-sky-50 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-sky-800" data-testid="chip-edited">Edited by you</span>}
                  {st?.state === 'needs_review' && <span className="no-print rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-amber-900" data-testid="chip-review">Needs review</span>}
                  {st && st.openItems > 0 && <span className="no-print rounded bg-amber-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-amber-800">{st.openItems} open</span>}
                  <span className="no-print ml-auto flex items-center gap-3">
                    {type !== 'evidence' && <CommentButton number={s.number} open={commenting === s.id} count={(reviewView!.bySection.get(s.id) ?? []).filter(c => !c.resolvedAt).length} onClick={() => setCommenting(commenting === s.id ? null : s.id)} />}
                    {editable && editing !== s.id && <button type="button" className="font-sans text-xs font-medium text-slate-500 hover:text-[#002C4B] hover:underline focus-visible:text-[#002C4B]" aria-label={`Edit section ${s.number}`} onClick={() => setEditing(s.id)}>Edit</button>}
                  </span>
                </span>
              );
              return (
                <section key={s.id} id={s.id} className="group scroll-mt-4" data-testid="doc-section">
                  {s.level === 1
                    ? <h3 className="mt-9 border-b border-slate-200 pb-2 font-display text-lg font-semibold text-slate-900">{head}</h3>
                    : <h4 className="mt-6 font-display text-base font-semibold text-slate-900">{head}</h4>}
                  {type !== 'evidence' && <React.Fragment key={`${type}:${s.id}`}><SectionComments ctx={reviewCtx} docType={type} sectionKey={s.id} sectionTitle={s.title} comments={reviewView!.bySection.get(s.id) ?? []} startOpen={commenting === s.id} /></React.Fragment>}
                  {st?.state === 'needs_review' && mine && (
                    <div className="no-print mt-3 rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200" data-testid="review-update">
                      <p className="text-sm text-amber-950"><span className="font-semibold">The process changed since you edited this section.</span> The generated text now reads:</p>
                      <div className="mt-2 rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-700 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: st.generatedHtml || '<p><em>No generated text.</em></p>' }} />
                      {canEdit && <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => saveEdit(s.id, mine.html, st.hash)}>Keep mine</Button>
                        <Button variant="secondary" onClick={() => takeUpdate(s.id)}>Take update</Button>
                        <Button variant="ghost" onClick={() => setEditing(s.id)}>Edit mine</Button>
                      </div>}
                    </div>
                  )}
                  {editing === s.id && st ? (
                    <div className="mt-3 space-y-3">
                      <React.Suspense fallback={<Spinner label="Opening the editor" />}>
                        <SectionEditor initial={mine?.html ?? st.generatedHtml} title={s.title} busy={editBusy} onCancel={() => setEditing(null)} onSave={html => saveEdit(s.id, html, st.hash)} check={checkText} draft={draftFor(s.title, s.number)} />
                      </React.Suspense>
                      {mine && <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => { takeUpdate(s.id); setEditing(null); }}>Use the generated text instead</button>}
                      {s.blocks.filter(b => b.kind !== 'rich' && b.kind !== 'paragraph' && b.kind !== 'list' && b.kind !== 'callout').map((b, i) => <BlockView key={i} b={b} />)}
                    </div>
                  ) : <div className="mt-3 space-y-3">{s.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>}
                </section>
              );
            })}
            {reviewView!.orphaned.length > 0 && (
              <section className="no-print mt-9" data-testid="orphaned-comments">
                <h3 className="border-b border-slate-200 pb-2 font-display text-lg font-semibold text-slate-900">Comments on sections no longer in this document</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">{reviewView!.orphaned.map(c => <li key={c.id}><span className="font-semibold">{c.sectionTitle}:</span> {c.body}{c.resolvedAt ? ' (resolved)' : ''}</li>)}</ul>
              </section>
            )}
          </article>
        </div>
        </>
      )}
    </div>
  );
}
