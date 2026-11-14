// The Sources stage: upload files, see what was read from each, and extract the process model.
// A finished extraction is reviewed as a change set before anything reaches the model.
import React from 'react';
import { applyChanges, proposeChanges, type ChangeSet, type ProposedChange } from '../../domain/extract/rebase.ts';
import { deepEqual, type JsonPatchOp } from '../../domain/processModel/jsonPatch.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';
import { FORMAT_LABEL } from '../../domain/workspace/sources.ts';
import type { ExtractionRow, JourneyStore, SourceRow } from '../store/types.ts';
import { StoreError } from '../store/types.ts';
import { ago, Button, cx, EmptyState, ErrorNote, messageOf, Tag, when } from '../ui.tsx';
import { ACCEPT, ingestFile } from './ingestFile.ts';
import { InlineText } from './widgets.tsx';

const STATUS_TEXT: Record<ExtractionRow['status'], string> = {
  queued: 'Starting…', running: 'Reading each source…', merging: 'Combining what the sources say…', reviewing: 'Checking the flow…',
  assembling: 'Building the model…', done: 'Done', failed: 'Failed',
};

/** One replace per top-level part that changed: small enough to store, exact enough to replay. */
export function coarsePatch(before: ProcessModel, after: ProcessModel): JsonPatchOp[] {
  const ops: JsonPatchOp[] = [];
  for (const k of Object.keys(after) as (keyof ProcessModel)[]) {
    if (!deepEqual(before[k], after[k])) ops.push({ op: 'replace', path: `/${k}`, value: after[k] });
  }
  return ops;
}

export function SourcesStage({ store, processId, workspaceId, canEdit, onModelChanged, onSourcesChanged, goToProcess }: {
  store: JourneyStore; processId: string; workspaceId: string; canEdit: boolean;
  onModelChanged: () => void; onSourcesChanged: () => void; goToProcess: () => void;
}) {
  const [sources, setSources] = React.useState<SourceRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<{ file: string; message: string; ok: boolean }[]>([]);
  const [dropping, setDropping] = React.useState(false);
  const [uploading, setUploading] = React.useState<string | null>(null);
  const [run, setRun] = React.useState<ExtractionRow | null>(null);
  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(async () => {
    try {
      const [list, latest] = await Promise.all([store.listSources(processId), store.latestExtraction(processId)]);
      setSources(list);
      setRun(latest);
    } catch (e) { setError(messageOf(e)); }
  }, [store, processId]);
  React.useEffect(() => { load(); }, [load]);

  // Follow a running extraction.
  React.useEffect(() => {
    if (!run || run.status === 'done' || run.status === 'failed') return;
    const t = setInterval(async () => {
      try { setRun(await store.latestExtraction(processId)); } catch { /* keep polling */ }
    }, 4000);
    return () => clearInterval(t);
  }, [run?.id, run?.status, store, processId]);

  const active = (sources ?? []).filter(s => !s.archived);
  const chosen = selected ?? new Set(active.map(s => s.id));

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const out: typeof notes = [];
    const taken = (sources ?? []).map(s => s.key);
    for (const file of Array.from(files)) {
      setUploading(file.name);
      try {
        const r = await ingestFile(store, workspaceId, file, taken);
        if (!r.ok) { out.push({ file: file.name, message: r.message ?? '', ok: false }); continue; }
        const source = r.source!;
        await store.addSource(processId, source);
        taken.push(source.key);
        const what = source.format === 'image' ? 'read from the image; check what was read' : `${source.segments.length} passages`;
        out.push({ file: file.name, message: `Added: ${what}.`, ok: true });
      } catch (e) {
        out.push({ file: file.name, message: messageOf(e), ok: false });
      }
    }
    setUploading(null);
    setNotes(out);
    if (fileInput.current) fileInput.current.value = '';
    await load();
    onSourcesChanged();
  };

  const extract = async () => {
    setError(null);
    try {
      const { runId } = await store.startExtraction(workspaceId, processId, [...chosen]);
      setRun({ id: runId, status: 'queued', error: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), model: null });
    } catch (e) { setError(messageOf(e)); }
  };

  if (!sources) return error ? <ErrorNote message={error} /> : <p className="p-6 text-sm text-slate-500">Loading sources…</p>;

  return (
    <div className="space-y-6">
      <ErrorNote message={error} />
      {canEdit && (
        <div
          onDragOver={e => { e.preventDefault(); if (!dropping) setDropping(true); }}
          onDragLeave={() => setDropping(false)}
          onDrop={e => { e.preventDefault(); setDropping(false); upload(e.dataTransfer.files); }}
          className={cx('rounded-xl border border-dashed p-5 transition-colors', dropping ? 'border-[#002C4B] bg-[#F1F6FB]' : 'border-slate-300 bg-white')}>
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
              <svg viewBox="0 0 20 20" className="h-5 w-5"><path d="M10 13V4m0 0L6.5 7.5M10 4l3.5 3.5M4 13v2.5h12V13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div className="min-w-0 flex-1 basis-56">
              <h3 className="text-sm font-semibold text-slate-900">Add sources</h3>
              <p className="mt-0.5 max-w-3xl text-sm leading-6 text-slate-600">
                Drop files here, or choose them. Meeting transcripts (.vtt, .srt, .txt), procedures (Word, PDF, Markdown), trackers (Excel) and flowcharts (draw.io, BPMN, or an image).
                Files are read in your browser; only the text and where it came from is stored.
              </p>
            </div>
            <label className={cx('inline-flex cursor-pointer items-center rounded-lg bg-[#002C4B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#073B60]', uploading && 'pointer-events-none opacity-50')}>
              {uploading ? `Reading ${uploading}…` : 'Choose files'}
              <input ref={fileInput} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Upload source files" onChange={e => upload(e.target.files)} />
            </label>
          </div>
          {notes.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-slate-200 pt-3" aria-live="polite">
              {notes.map((n, i) => (
                <li key={i} data-testid="upload-note" className="flex items-start gap-2 text-sm text-slate-700">
                  <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white', n.ok ? 'bg-emerald-600' : 'bg-red-600')} aria-hidden>
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">{n.ok ? <path d="M2.8 6.3 5 8.4l4.2-4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : <path d="m3.2 3.2 5.6 5.6m0-5.6-5.6 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}</svg>
                  </span>
                  <span><span className="font-semibold text-slate-900">{n.file}:</span> <span className={n.ok ? undefined : 'text-red-800'}>{n.message}</span></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sources.length === 0 ? (
        <EmptyState title="No sources yet">Every extracted fact keeps a link back to the passage it came from in these files.</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold text-slate-500">
            <span className="flex-1">{active.length} {active.length === 1 ? 'source' : 'sources'}{canEdit ? `, ${chosen.size} ticked for extraction` : ''}</span>
            <span className="hidden w-24 text-right sm:block" aria-hidden>Passages</span>
            <span className="hidden w-28 text-right sm:block" aria-hidden>Added</span>
            {canEdit && <span className="hidden w-16 sm:block" aria-hidden />}
          </div>
          <ul className="divide-y divide-slate-100">
            {sources.map(s => (
              <li key={s.id} data-testid="source-row" className={cx('flex flex-wrap items-center gap-3 px-4 py-3', s.archived && 'opacity-60')}>
                {canEdit && (s.archived ? <span className="w-4" aria-hidden /> : (
                  <input type="checkbox" className="h-4 w-4 accent-[#002C4B]" aria-label={`Use ${s.title} for extraction`} checked={chosen.has(s.id)}
                    onChange={e => { const n = new Set(chosen); if (e.target.checked) n.add(s.id); else n.delete(s.id); setSelected(n); }} />
                ))}
                <KindMark format={s.format} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">{s.title}{s.archived && <Tag>archived</Tag>}{s.inferred && <Tag tone="info">Read from an image</Tag>}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">{FORMAT_LABEL[s.format]}<span className="mx-1.5 text-slate-300" aria-hidden>|</span>{s.fileName}</p>
                  {/* On a phone the passages and the date go under the name, not in columns. */}
                  <p className="mt-0.5 text-xs text-slate-500 sm:hidden">{s.segmentCount} passages<span className="mx-1.5 text-slate-300" aria-hidden>|</span>added {ago(s.createdAt)}</p>
                  {s.inferred && <p className="mt-1 text-xs text-slate-600">Everything this source supports is marked Inferred until a person confirms it.</p>}
                  {s.warnings.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">{s.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}</ul>}
                </div>
                <span className="hidden w-24 text-right text-sm tabular-nums text-slate-700 sm:block">{s.segmentCount} passages</span>
                <span className="hidden w-28 text-right text-xs text-slate-500 sm:block" title={when(s.createdAt)}>{ago(s.createdAt)}</span>
                {canEdit && <span className="w-16 text-right">{!s.archived && (
                  <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" onClick={async () => { try { await store.archiveSource(s.id); await load(); onSourcesChanged(); } catch (e) { setError(messageOf(e)); } }}>Archive</button>
                )}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit && active.length > 0 && (
        <ExtractionPanel store={store} run={run} chosenCount={chosen.size} onExtract={extract} processId={processId}
          onApplied={() => { onModelChanged(); goToProcess(); }} />
      )}
    </div>
  );
}

function ExtractionPanel({ store, run, chosenCount, onExtract, processId, onApplied }: {
  store: JourneyStore; run: ExtractionRow | null; chosenCount: number; onExtract: () => void; processId: string; onApplied: () => void;
}) {
  const running = run && run.status !== 'done' && run.status !== 'failed';
  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5" aria-label="Extraction">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Extract the process model</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            The AI reads the ticked sources and proposes steps, roles, systems, rules, exceptions, figures and open questions, each with its quote.
            You review the changes before they reach the model; what you have confirmed is never overwritten.
          </p>
        </div>
        <Button onClick={onExtract} disabled={!store.aiAvailable || !chosenCount || Boolean(running)}>
          {running ? STATUS_TEXT[run!.status] : `Extract from ${chosenCount} source${chosenCount === 1 ? '' : 's'}`}
        </Button>
      </div>
      {!store.aiAvailable && <p className="text-sm text-slate-500">Extraction runs on the server and is not available in local mode.</p>}
      {running && <p role="status" className="text-sm text-slate-600">{STATUS_TEXT[run!.status]} This takes a few minutes; you can leave this page and come back.</p>}
      {run?.status === 'failed' && <ErrorNote message={`The last extraction failed: ${run.error ?? 'unknown error'}. Try again.`} />}
      {run?.status === 'done' && run.model && <ChangeReview store={store} processId={processId} extracted={run.model} finishedAt={run.updatedAt} onApplied={onApplied} />}
    </section>
  );
}

const ELEMENT_LABEL: Record<ProposedChange['element'], string> = {
  step: 'Steps', role: 'Roles', system: 'Systems', gateway: 'Decisions', event: 'Start and end', rule: 'Rules', exception: 'Exceptions',
  metric: 'Figures', data: 'Data', question: 'Open questions', conflict: 'Conflicts between sources', meta: 'Process',
};
const KIND_LABEL: Record<ProposedChange['kind'], string> = { add: 'New', update: 'Changed', remove: 'Not found any more', conflict: 'Differs from what you confirmed' };

function ChangeReview({ store, processId, extracted, finishedAt, onApplied }: { store: JourneyStore; processId: string; extracted: ProcessModel; finishedAt: string; onApplied: () => void }) {
  const [current, setCurrent] = React.useState<ProcessModel | null>(null);
  const [set, setSet] = React.useState<ChangeSet | null>(null);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    // Read the current model without starting a draft: looking is not editing.
    const revisions = await store.listRevisions(processId);
    const rev = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
    const model = (rev && await store.getModel(rev.id)) || emptyModel(extracted.meta.name);
    const cs = proposeChanges(model, extracted);
    setCurrent(model);
    setSet(cs);
    setPicked(new Set(cs.changes.filter(c => c.defaultSelected).map(c => c.id)));
  }, [store, processId, extracted]);
  React.useEffect(() => { load().catch(e => setError(messageOf(e))); }, [load]);

  if (error && !set) return <ErrorNote message={error} />;
  if (!set || !current) return <p className="text-sm text-slate-500">Comparing with the current model…</p>;
  if (!set.changes.length) return <p className="text-sm text-emerald-800" data-testid="no-changes">The extraction of {when(finishedAt)} matches the current model.</p>;

  const apply = async () => {
    setBusy(true);
    setError(null);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const d = await store.startDraft(processId);
        const next = applyChanges(d.model, extracted, picked);
        const patch = coarsePatch(d.model, next);
        if (patch.length) await store.savePatch(d.revisionId, d.seq, patch, 'extraction', set.first ? 'Model extracted from sources' : `Extraction: ${picked.size} change${picked.size === 1 ? '' : 's'} applied`);
        setBusy(false);
        onApplied();
        return;
      } catch (e) {
        if (!(e instanceof StoreError && e.status === 409) || attempt === 1) { setError(messageOf(e)); setBusy(false); return; }
      }
    }
  };

  const groups = new Map<string, ProposedChange[]>();
  for (const c of set.changes) groups.set(c.element, [...(groups.get(c.element) ?? []), c]);
  const toggle = (id: string, on: boolean) => { const n = new Set(picked); if (on) n.add(id); else n.delete(id); setPicked(n); };

  return (
    <div className="space-y-3" data-testid="change-review">
      <p className="text-sm text-slate-700">
        {set.first
          ? `The extraction of ${when(finishedAt)} found ${extracted.steps.length} steps, ${extracted.roles.length} roles, ${extracted.systems.length} systems and ${extracted.openQuestions.length} open questions.`
          : `The extraction of ${when(finishedAt)} differs from the current model in ${set.changes.length} place${set.changes.length === 1 ? '' : 's'}. Choose what to take.`}
      </p>
      {!set.first && (
        <div className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border border-slate-200 p-3">
          {[...groups].map(([element, changes]) => (
            <fieldset key={element}>
              <legend className="text-xs font-semibold text-slate-500">{ELEMENT_LABEL[element as ProposedChange['element']]}</legend>
              <ul className="mt-1 space-y-1">
                {changes.map(c => (
                  <li key={c.id}>
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" className="mt-1" checked={picked.has(c.id)} onChange={e => toggle(c.id, e.target.checked)} />
                      <span>
                        <Tag tone={c.kind === 'conflict' ? 'warn' : c.kind === 'remove' ? 'danger' : 'neutral'} className="mr-1.5">{KIND_LABEL[c.kind]}</Tag>
                        <span className="font-medium text-slate-900">{c.label}</span>
                        {c.detail && <span className="block text-xs text-slate-500">{c.kind === 'conflict' ? `${c.detail} Ticking records the difference as a conflict; your value stays.` : c.detail}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
        </div>
      )}
      <ErrorNote message={error} />
      <Button onClick={apply} disabled={busy || (!set.first && picked.size === 0)}>{set.first ? 'Use this model' : `Apply ${picked.size} change${picked.size === 1 ? '' : 's'}`}</Button>
    </div>
  );
}

// A small mark for the kind of source, so a list of files can be scanned by what they are.
const KIND: { test: RegExp; cls: string; glyph: React.ReactNode }[] = [
  { test: /transcript|vtt|srt/i, cls: 'bg-sky-100 text-sky-800', glyph: <path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /> },
  { test: /flowchart|bpmn|drawio|image/i, cls: 'bg-violet-100 text-violet-800', glyph: <><rect x="2.5" y="2.5" width="4.5" height="3.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="9" y="10" width="4.5" height="3.5" rx="0.8" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M4.8 6v3.8a2 2 0 0 0 2 2H9" fill="none" stroke="currentColor" strokeWidth="1.4" /></> },
  { test: /excel|xlsx|csv|sheet|tracker/i, cls: 'bg-emerald-100 text-emerald-800', glyph: <><rect x="2.5" y="3" width="11" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M2.5 6.5h11M2.5 9.8h11M6.5 3v10" fill="none" stroke="currentColor" strokeWidth="1.2" /></> },
];
const DOC = { cls: 'bg-blue-100 text-blue-800', glyph: <><path d="M4 2.5h5.5L12.5 5.5V13.5H4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M6 8h4.5M6 10.5h4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></> };
function KindMark({ format }: { format: SourceRow['format'] }) {
  const k = KIND.find(x => x.test.test(`${format} ${FORMAT_LABEL[format]}`)) ?? DOC;
  return <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', k.cls)} aria-hidden><svg viewBox="0 0 16 16" className="h-4 w-4">{k.glyph}</svg></span>;
}
