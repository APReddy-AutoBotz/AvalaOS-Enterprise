// The company's own structure for each document: rename, hide or reorder sections and add the
// company's own. Suggested from the uploaded Word template's headings; a person reviews before saving.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import type { DocLayout, DocumentSettings } from '../../domain/docs/branding.ts';
import type { DocType } from '../../domain/docs/tree.ts';
import { EMPTY_LAYOUT, LayoutError, outlineOf, suggestLayout, validateLayout, type HeadingMatch, type OutlineEntry } from '../../domain/docs/layout.ts';
import { buildPdd } from '../../domain/docs/pdd.ts';
import { buildBrd } from '../../domain/docs/brd.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { emptyDecisions } from '../../domain/assess/decisions.ts';
import { Button, cx, ErrorNote, messageOf } from '../ui.tsx';

const TYPES: { type: DocType; label: string }[] = [{ type: 'pdd', label: 'PDD' }, { type: 'brd', label: 'BRD' }];
const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50 disabled:text-slate-600';

/** The sections every document of this type has (the builders' sections do not depend on the model). */
function outlineFor(type: DocType): OutlineEntry[] {
  const m = emptyModel('Outline');
  const i = { model: m, assessment: assessProcess(m), decisions: emptyDecisions(), sources: [], revision: { label: '', state: 'working' as const, date: '' } };
  return outlineOf(type === 'brd' ? buildBrd(i) : buildPdd(i));
}

export function DocumentSections({ store, workspace, settings, onSaved }: { store: JourneyStore; workspace: Workspace; settings: DocumentSettings; onSaved: (s: DocumentSettings) => void }) {
  const [type, setType] = React.useState<DocType>('pdd');
  const outline = React.useMemo(() => outlineFor(type), [type]);
  const [draft, setDraft] = React.useState<DocLayout>(settings.layouts[type] ?? EMPTY_LAYOUT);
  const [matches, setMatches] = React.useState<HeadingMatch[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const isAdmin = workspace.role === 'admin';
  // A save or another type reloads the draft; the saved note stays until the next change.
  React.useEffect(() => { setDraft(settings.layouts[type] ?? EMPTY_LAYOUT); setMatches(null); setError(null); }, [type, settings]);

  const tops = outline.filter(o => o.level === 1).map(o => o.number);
  const order = draft.order?.length ? [...draft.order, ...tops.filter(n => !draft.order!.includes(n))] : tops;
  const change = (d: DocLayout) => { setDraft(d); setNote(null); };
  const setSection = (n: string, v: { title?: string; hidden?: boolean }) => change({ ...draft, sections: { ...draft.sections, [n]: { ...draft.sections[n], ...v } } });
  const move = (n: string, by: -1 | 1) => {
    const o = [...order]; const i = o.indexOf(n); const j = i + by;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]]; change({ ...draft, order: o });
  };
  const addCustom = (after: string) => change({ ...draft, custom: [...draft.custom, { id: `c${Date.now().toString(36)}`, after, title: '', text: '' }] });
  const setCustom = (id: string, v: Partial<DocLayout['custom'][number]>) => change({ ...draft, custom: draft.custom.map(c => (c.id === id ? { ...c, ...v } : c)) });
  const fromTemplate = () => {
    const t = settings.branding.template; if (!t) return;
    const s = suggestLayout(outline, t.headings);
    setMatches(s.matches); change(s.layout);
    setNote(`Matched ${s.matches.filter(m => m.number).length} of ${s.matches.length} headings from ${t.name}. Check the list, then save.`);
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const layout = validateLayout(draft, outline);
      const next = { ...settings, layouts: { ...settings.layouts, [type]: layout } };
      await store.saveDocumentSettings(workspace.id, next);
      onSaved(next); setNote('Saved. Documents in this workspace use this structure now.');
    } catch (e) { setError(e instanceof LayoutError ? e.message : messageOf(e)); } finally { setBusy(false); }
  };

  const children = (top: string) => outline.filter(o => o.level === 2 && o.number.split('.')[0] === top);
  const customAfter = (n: string) => draft.custom.filter(c => c.after === n);
  const row = (o: OutlineEntry) => {
    const v = draft.sections[o.number] ?? {};
    return (
      <div key={o.number} className={cx('flex flex-wrap items-center gap-2 py-1.5', o.level === 2 && 'pl-6', v.hidden && 'opacity-50')} data-testid="layout-section">
        <span className="w-8 text-xs tabular-nums text-slate-500">{o.number}</span>
        <input aria-label={`Title of section ${o.number}`} value={v.title ?? o.title} disabled={!isAdmin || v.hidden} onChange={e => setSection(o.number, { title: e.target.value })} className={cx(input, 'min-w-[14rem] flex-1', o.level === 1 && 'font-semibold')} />
        {o.locked ? <span className="text-xs text-slate-500">Always shown</span> : (
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" aria-label={`Hide section ${o.number}`} checked={!!v.hidden} disabled={!isAdmin} onChange={e => setSection(o.number, { hidden: e.target.checked })} /> Hide</label>
        )}
        {o.level === 1 && isAdmin && <span className="flex gap-1">
          <button type="button" aria-label={`Move section ${o.number} up`} className="rounded px-1.5 text-slate-500 hover:bg-slate-100" onClick={() => move(o.number, -1)}>↑</button>
          <button type="button" aria-label={`Move section ${o.number} down`} className="rounded px-1.5 text-slate-500 hover:bg-slate-100" onClick={() => move(o.number, 1)}>↓</button>
        </span>}
        {isAdmin && <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => addCustom(o.number)}>+ Add after</button>}
        {matches && <span className="text-[11px] text-slate-500">{matches.find(m => m.number === o.number)?.heading ? `from “${matches.find(m => m.number === o.number)!.heading}”` : 'no heading in template'}</span>}
      </div>
    );
  };
  const custom = (c: DocLayout['custom'][number], level: 1 | 2) => (
    <div key={c.id} className={cx('my-1 rounded-lg border border-dashed border-[#B58500]/50 bg-amber-50/40 p-2', level === 2 && 'ml-6')} data-testid="layout-custom">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-[#8a6500]">Your section</span>
        <input aria-label="Title of your section" value={c.title} disabled={!isAdmin} placeholder="Title" onChange={e => setCustom(c.id, { title: e.target.value })} className={cx(input, 'flex-1')} />
        {isAdmin && <button type="button" className="text-xs text-slate-600 hover:underline" onClick={() => change({ ...draft, custom: draft.custom.filter(x => x.id !== c.id) })}>Remove</button>}
      </div>
      <textarea aria-label={`Text of ${c.title || 'your section'}`} value={c.text} disabled={!isAdmin} rows={2} placeholder="Standard text for every document, such as an approval statement. Leave empty to show Not provided." onChange={e => setCustom(c.id, { text: e.target.value })} className={cx(input, 'mt-2 w-full')} />
    </div>
  );
  const levelOf = (n: string) => (n === 'start' || !n.includes('.') ? 1 : 2) as 1 | 2;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card" data-testid="document-sections">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Document sections</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">Use your company's headings and order. Renaming, hiding or moving a section changes where things appear, never what the facts say; open items from a hidden section are still listed at the end.</p>
        </div>
        <div role="tablist" aria-label="Document type" className="flex rounded-lg bg-slate-200/70 p-0.5">
          {TYPES.map(t => <button key={t.type} role="tab" aria-selected={type === t.type} onClick={() => { setType(t.type); setNote(null); }} className={cx('rounded-md px-3 py-1 text-sm font-semibold', type === t.type ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600')}>{t.label}</button>)}
        </div>
      </div>
      {isAdmin && settings.branding.template && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm ring-1 ring-inset ring-slate-200">
        <span className="text-slate-700">Your template <strong>{settings.branding.template.name}</strong> has {settings.branding.template.headings.length} headings.</span>
        <Button variant="secondary" onClick={fromTemplate}>Match to my template</Button>
      </div>}
      <div className="mt-4 divide-y divide-slate-100">
        {customAfter('start').map(c => custom(c, 1))}
        {order.map(top => {
          const o = outline.find(x => x.number === top)!;
          return (
            <div key={top} className="py-1">
              {row(o)}
              {children(top).map(ch => <React.Fragment key={ch.number}>{row(ch)}{customAfter(ch.number).map(c => custom(c, levelOf(ch.number)))}</React.Fragment>)}
              {customAfter(top).map(c => custom(c, 1))}
            </div>
          );
        })}
      </div>
      {matches && matches.some(m => !m.number) && <p className="mt-3 text-xs text-slate-600">Headings with no match became sections of your own: {matches.filter(m => !m.number).map(m => m.heading).join(', ')}.</p>}
      <div className="mt-4 space-y-2">
        <ErrorNote message={error} />
        {note && <p className="text-sm text-emerald-700" role="status">{note}</p>}
        {isAdmin && <div className="flex gap-2">
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : `Save ${TYPES.find(t => t.type === type)!.label} sections`}</Button>
          <Button variant="secondary" onClick={() => { change(EMPTY_LAYOUT); setMatches(null); }}>Back to standard</Button>
        </div>}
      </div>
    </div>
  );
}
