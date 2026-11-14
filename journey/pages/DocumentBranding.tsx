// How the workspace's documents look: organisation, font, colour, logo and the company's own Word
// template. Admins change it; everyone sees it. Applied to the Word download and the document on screen.
import React from 'react';
import type { JourneyStore, Workspace } from '../store/types.ts';
import { BrandingError, FONTS, readWordTemplate, validateBranding, type Branding, type DocumentSettings } from '../../domain/docs/branding.ts';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { DocumentSections } from './DocumentSections.tsx';

const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50 disabled:text-slate-600';
const readDataUrl = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(f); });

export function DocumentBranding({ store, workspace }: { store: JourneyStore; workspace: Workspace }) {
  const [settings, setSettings] = React.useState<DocumentSettings | null>(null);
  const [draft, setDraft] = React.useState<Branding | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const isAdmin = workspace.role === 'admin';
  React.useEffect(() => { store.getDocumentSettings(workspace.id).then(s => { setSettings(s); setDraft(s.branding); }).catch(e => setError(messageOf(e))); }, [store, workspace.id]);
  if (!settings || !draft) return error ? <ErrorNote message={error} /> : <Spinner />;
  const set = (patch: Partial<Branding>) => { setDraft({ ...draft, ...patch }); setNote(null); };

  const onLogo = async (f: File | undefined) => {
    if (!f) return;
    if (!/^image\/(png|jpeg)$/.test(f.type)) { setError('Use a PNG or JPEG logo.'); return; }
    if (f.size > 300_000) { setError('Use a logo under 300 KB.'); return; }
    setError(null); set({ logo: await readDataUrl(f) });
  };
  const onTemplate = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const r = await readWordTemplate(f.name, new Uint8Array(await f.arrayBuffer()));
      setDraft({ ...draft, template: r.template, ...(r.font ? { font: r.font } : {}), ...(r.accent ? { accent: r.accent } : {}) });
      setNote(`Read ${f.name}: ${r.template.headings.length} headings${r.font ? `, font ${r.font}` : ''}${r.accent ? `, heading colour #${r.accent}` : ''}. Save to use it.`);
    } catch (e) { setError(e instanceof BrandingError ? e.message : messageOf(e)); }
  };
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const branding = validateBranding(draft);
      await store.saveDocumentSettings(workspace.id, { ...settings, branding });
      setSettings({ ...settings, branding }); setDraft(branding); setNote('Saved. Documents in this workspace use it now.');
    } catch (e) { setError(e instanceof BrandingError ? e.message : messageOf(e)); } finally { setBusy(false); }
  };

  return (
    <>
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card" data-testid="document-branding">
      <h2 className="font-display text-lg font-semibold text-slate-900">How documents look</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">Your organisation's look for the BRD, PDD, FRD and SDD, on screen and in Word. Upload your company's Word template to use its fonts and heading styles.{isAdmin ? '' : ' Only an admin can change it.'}</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-4">
          <label className="grid gap-1 text-sm font-semibold text-slate-800">Organisation name
            <input aria-label="Organisation name" value={draft.organisation} disabled={!isAdmin} onChange={e => set({ organisation: e.target.value })} placeholder="Shown on the cover and in the header" className={input} />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="grid gap-1 text-sm font-semibold text-slate-800">Font
              <select aria-label="Font" value={FONTS.includes(draft.font) ? draft.font : '__other'} disabled={!isAdmin} onChange={e => e.target.value !== '__other' && set({ font: e.target.value })} className={input}>
                {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                {!FONTS.includes(draft.font) && <option value="__other">{draft.font} (from template)</option>}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-slate-800">Accent colour
              <span className="flex items-center gap-2">
                <input type="color" aria-label="Accent colour" value={`#${draft.accent}`} disabled={!isAdmin} onChange={e => set({ accent: e.target.value.slice(1).toUpperCase() })} className="h-9 w-12 cursor-pointer rounded border border-slate-300 bg-white" />
                <input aria-label="Accent colour hex" value={`#${draft.accent}`} disabled={!isAdmin} onChange={e => set({ accent: e.target.value.replace('#', '').toUpperCase() })} className={cx(input, 'w-28 font-mono')} />
              </span>
            </label>
          </div>
          <div className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-800">Logo</span>
            <span className="flex flex-wrap items-center gap-3">
              {draft.logo ? <img src={draft.logo} alt="Logo" className="h-10 max-w-[10rem] rounded border border-slate-200 bg-white object-contain p-1" /> : <span className="text-xs text-slate-500">None. PNG or JPEG, under 300 KB.</span>}
              {isAdmin && <label className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold text-[#002C4B] ring-1 ring-inset ring-slate-300 hover:bg-slate-50">{draft.logo ? 'Replace' : 'Upload logo'}<input type="file" accept="image/png,image/jpeg" aria-label="Upload logo" className="sr-only" onChange={e => onLogo(e.target.files?.[0])} /></label>}
              {isAdmin && draft.logo && <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => set({ logo: null })}>Remove</button>}
            </span>
          </div>
          <div className="grid gap-1 text-sm">
            <span className="font-semibold text-slate-800">Company Word template</span>
            <span className="flex flex-wrap items-center gap-3">
              {draft.template ? <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-700 ring-1 ring-inset ring-slate-200" data-testid="template-name">{draft.template.name} · {draft.template.headings.length} headings</span> : <span className="text-xs text-slate-500">None. Upload a .docx or .dotx to use its fonts and heading styles.</span>}
              {isAdmin && <label className="cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold text-[#002C4B] ring-1 ring-inset ring-slate-300 hover:bg-slate-50">{draft.template ? 'Replace' : 'Upload template'}<input type="file" accept=".docx,.dotx" aria-label="Upload Word template" className="sr-only" onChange={e => onTemplate(e.target.files?.[0])} /></label>}
              {isAdmin && draft.template && <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => set({ template: null })}>Remove</button>}
            </span>
          </div>
          <ErrorNote message={error} />
          {note && <p className="text-sm text-emerald-700" role="status">{note}</p>}
          {isAdmin && <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save how documents look'}</Button>}
        </div>
        <figure aria-label="Preview" className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <figcaption className="text-xs font-semibold text-slate-500">Preview</figcaption>
          <div className="mt-2 aspect-[1/1.3] rounded-md bg-white p-4 shadow-sm" style={{ fontFamily: `${draft.font}, Calibri, sans-serif` }}>
            {draft.logo && <img src={draft.logo} alt="" className="mb-3 h-6 object-contain" />}
            <p className="text-[9px] font-bold text-slate-500">{draft.organisation || 'Organisation'}</p>
            <p className="mt-1 text-base font-bold leading-tight" style={{ color: `#${draft.accent}` }}>Process Definition Document</p>
            <p className="mt-1 border-b-2 pb-2 text-[11px] text-slate-800" style={{ borderColor: `#${draft.accent}` }}>Vendor invoice processing</p>
            <p className="mt-3 text-[10px] font-bold" style={{ color: `#${draft.accent}` }}>2.4  Detailed As-Is steps</p>
            <div className="mt-1 grid grid-cols-3 gap-px text-[8px]">
              {['#', 'Step', 'Role'].map(h => <span key={h} className="px-1 py-0.5 font-bold text-white" style={{ background: `#${draft.accent}` }}>{h}</span>)}
              {['1', 'Receive invoice', 'AP Clerk', '2', 'Check vendor', 'AP Clerk'].map((c, i) => <span key={i} className="border-b border-slate-100 px-1 py-0.5 text-slate-700">{c}</span>)}
            </div>
          </div>
        </figure>
      </div>
    </div>
    <DocumentSections store={store} workspace={workspace} settings={settings} onSaved={setSettings} />
    </>
  );
}
