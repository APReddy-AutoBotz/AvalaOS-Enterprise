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
import type { Block, Cell, DocTree, DocType } from '../../domain/docs/tree.ts';
import type { JourneyStore, SourceRow } from '../store/types.ts';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { StatusBadge } from './widgets.tsx';
import { GapsAssistant } from './GapsAssistant.tsx';
import { useModelEditor } from './useModelEditor.ts';
import { triage } from '../../domain/questions/triage.ts';

const TYPES: { id: DocType; short: string; label: string; ready: boolean }[] = [
  { id: 'brd', short: 'BRD', label: 'Business requirements', ready: true },
  { id: 'pdd', short: 'PDD', label: 'Process definition', ready: true },
  { id: 'frd', short: 'FRD', label: 'Functional requirements', ready: false },
  { id: 'sdd', short: 'SDD', label: 'Solution design', ready: false },
];

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #document-print, #document-print * { visibility: visible !important; }
  #document-print { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; border: 0; box-shadow: none; }
  #document-print .no-print { display: none !important; }
  #document-print tr, #document-print .keep { break-inside: avoid; }
  @page { margin: 16mm; }
}`;

function CellView({ c }: { c: Cell; key?: React.Key }) {
  if (c.missing) return <span className="italic text-amber-700">{c.text}</span>;
  return <>{c.text}{c.status && c.status !== 'stated' && c.status !== 'user-confirmed' && <span className="ml-1.5 align-middle"><StatusBadge status={c.status} /></span>}</>;
}

function BlockView({ b }: { b: Block; key?: React.Key }) {
  switch (b.kind) {
    case 'paragraph': return <p className="text-sm leading-7 text-slate-800">{b.text}</p>;
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
          <caption className="caption-top pb-1.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{b.caption}</caption>
          <thead><tr>{b.columns.map(c => <th key={c} className="border-b-2 border-slate-300 px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c}</th>)}</tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i} className="border-b border-slate-100 align-top">{r.map((c, j) => <td key={j} className="px-2.5 py-2 text-slate-800"><CellView c={c} /></td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
}

export function DocumentsStage({ store, processId, workspaceId, model: loaded, working, onSaved, canEdit, revision, sources }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; working: { id: string; seq: number } | null; onSaved: () => void; canEdit: boolean;
  revision: { label: string; state: 'working' | 'approved'; date: string }; sources: SourceRow[];
}) {
  const editor = useModelEditor(store, processId, { model: loaded, working }, onSaved);
  const model = editor.model;
  const [answering, setAnswering] = React.useState(false);
  const [type, setType] = React.useState<DocType>('pdd');
  const [decisions, setDecisions] = React.useState<Decisions | null>(null);
  const [settings, setSettings] = React.useState<AssessmentSettings | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    Promise.all([store.getAssessmentDecisions(processId), store.getSettings(workspaceId)])
      .then(([d, s]) => { setDecisions(d); setSettings(s.settings); }).catch(e => setError(messageOf(e)));
  }, [store, processId, workspaceId]);

  const doc = React.useMemo<DocTree | null>(() => {
    if (!decisions) return null;
    const input = { model, assessment: assessProcess(model, { rate: decisions.rate, settings }), decisions: decisions ?? emptyDecisions(), sources: sources.filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })), revision };
    return type === 'brd' ? buildBrd(input) : type === 'pdd' ? buildPdd(input) : null;
  }, [type, model, decisions, settings, sources, revision]);

  const download = () => {
    if (!doc) return;
    const url = URL.createObjectURL(new Blob([toMarkdown(doc)], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${model.meta.name} - ${doc.type.toUpperCase()}.md` });
    a.click(); URL.revokeObjectURL(url);
  };

  const toAnswer = React.useMemo(() => (decisions ? triage(model, assessProcess(model, { settings })) : null), [model, decisions, settings]);
  if (answering) return <><ErrorNote message={editor.error} /><GapsAssistant model={model} editor={editor} canEdit={canEdit} onClose={() => setAnswering(false)} /></>;

  return (
    <div className="space-y-5">
      <style>{PRINT_CSS}</style>
      <ErrorNote message={error ?? editor.error} />
      {toAnswer && (toAnswer.items.some(i => !i.deferred) || toAnswer.alreadyKnown.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4" data-testid="gaps-banner">
          <p className="text-sm text-amber-950"><span className="font-semibold">{toAnswer.items.filter(i => !i.deferred).length} questions to answer</span> before these documents are complete (from {toAnswer.raw} raised; duplicates merged{toAnswer.alreadyKnown.length ? `, ${toAnswer.alreadyKnown.length} already answered by the model` : ''}).</p>
          <Button onClick={() => setAnswering(true)}>Answer them</Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Documents" className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
          {TYPES.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={type === t.id} onClick={() => setType(t.id)}
              className={cx('rounded-lg px-4 py-1.5 text-sm font-semibold transition', type === t.id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>
              {t.short}<span className="ml-1.5 hidden font-normal text-slate-500 sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
        {doc && <div className="flex gap-2"><Button variant="ghost" onClick={download}>Download Markdown</Button><Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button></div>}
      </div>

      {!decisions ? (error ? null : <Spinner label="Writing the document" />) : !doc ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="doc-not-ready">
          <p className="font-display text-lg font-semibold text-slate-900">{TYPES.find(t => t.id === type)!.label} ({type.toUpperCase()})</p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">{type === 'frd'
            ? 'The FRD needs the requirements derived from the To-Be steps, rules and exceptions, each with acceptance criteria. That comes next.'
            : 'The SDD is written from an approved PDD and the confirmed design facts. It comes after the FRD.'}</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <nav aria-label="Contents" className="hidden lg:block">
            <div className="sticky top-4 max-h-[80vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 text-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Contents</p>
              <ol className="mt-2 space-y-1">{doc.sections.map(s => <li key={s.id} className={s.level === 2 ? 'pl-3' : 'mt-2 font-semibold'}><a href={`#${s.id}`} className="text-slate-700 hover:text-[#002C4B] hover:underline"><span className="tabular-nums text-slate-400">{s.number}</span> {s.title}</a></li>)}</ol>
              <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{doc.openItems.length} open {doc.openItems.length === 1 ? 'item' : 'items'}</p>
            </div>
          </nav>
          <article id="document-print" data-testid="document" className="min-w-0 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10">
            <header className="border-b-4 border-[#002C4B] pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#B58500]">{doc.title}</p>
              <h2 className="mt-1.5 font-display text-2xl font-semibold tracking-tight text-slate-900">{doc.subtitle}</h2>
              <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">{doc.control.slice(1).map(c => <div key={c.key}><dt className="inline font-semibold">{c.key}: </dt><dd className="inline">{c.value}</dd></div>)}</dl>
              {revision.state === 'working' && <p className="mt-3 inline-block rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-slate-600">Draft until the revision is approved</p>}
            </header>
            {doc.sections.map(s => (
              <section key={s.id} id={s.id} className="scroll-mt-4">
                {s.level === 1
                  ? <h3 className="mt-9 border-b border-slate-200 pb-2 font-display text-lg font-semibold text-slate-900"><span className="mr-2 tabular-nums text-[#B58500]">{s.number}</span>{s.title}</h3>
                  : <h4 className="mt-6 font-display text-base font-semibold text-slate-900"><span className="mr-2 tabular-nums text-slate-400">{s.number}</span>{s.title}</h4>}
                <div className="mt-3 space-y-3">{s.blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>
              </section>
            ))}
          </article>
        </div>
      )}
    </div>
  );
}
