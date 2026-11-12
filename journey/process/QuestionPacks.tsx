// Question packs: the open questions per owner, downloaded as Word or Markdown for people who will not
// open the app, and the returned file read back. Read-back answers are reviewed like spoken ones.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { Triage, TriageItem } from '../../domain/questions/triage.ts';
import { buildPacks, packDocument, packItems, replyNotes, type QuestionPack } from '../../domain/questions/packs.ts';
import { toMarkdown } from '../../domain/docs/markdown.ts';
import type { Branding } from '../../domain/docs/branding.ts';
import { parseFile } from '../../domain/ingest/parsers/index.ts';
import { cx, messageOf } from '../ui.tsx';

export interface ImportedReply { label: string; notes: string; items: TriageItem[]; answered: number }

const save = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};
const today = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function QuestionPacks({ model, t, branding, onImported, canImport }: { model: ProcessModel; t: Triage; branding?: Branding; onImported: (r: ImportedReply) => void; canImport: boolean }) {
  const packs = React.useMemo(() => buildPacks(t, model), [t, model]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!packs.length) return null;
  const name = (p: QuestionPack, ext: string) => `${model.meta.name} - questions for ${p.label}.${ext}`;

  const word = async (p: QuestionPack) => {
    setBusy(p.owner); setError(null);
    try {
      const { toDocxBlob, docxStyleFrom } = await import('../../domain/docs/docx.ts');
      save(await toDocxBlob(packDocument(p, model.meta.name, today()), { draft: false, ...(branding ? { style: docxStyleFrom(branding) } : {}) }), name(p, 'docx'));
    } catch (e) { setError(messageOf(e)); } finally { setBusy(null); }
  };
  const markdown = (p: QuestionPack) => save(new Blob([toMarkdown(packDocument(p, model.meta.name, today()))], { type: 'text/markdown' }), name(p, 'md'));
  const read = async (p: QuestionPack, file: File | undefined) => {
    if (!file) return;
    setBusy(p.owner); setError(null);
    try {
      // Word: table rows from the parser. Markdown or text: the raw lines, so table rows stay one per line.
      let lines: string[];
      if (/\.docx$/i.test(file.name)) {
        const r = await parseFile({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), sourceId: 'reply' });
        if (r.status !== 'ok') { setError(r.message); return; }
        lines = r.segments.map(s => s.text);
      } else lines = (await file.text()).split(/\r?\n/);
      const reply = replyNotes(p, lines);
      if (!reply.notes) { setError('The file has no answers in it.'); return; }
      const open = new Set(t.items.map(i => i.key));
      onImported({ label: `${p.label} (${file.name})`, notes: reply.notes, answered: reply.answered.length, items: packItems(p, reply.answered).filter(i => open.has(i.key)) });
    } catch (e) { setError(messageOf(e)); } finally { setBusy(null); }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Question packs" data-testid="question-packs">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="font-display text-base font-semibold text-slate-900">Send questions to the people who know</h4>
        <p className="text-xs text-slate-500">One file per owner. They write answers in the last column and send it back.</p>
      </div>
      <ul className="mt-3 grid gap-3 md:grid-cols-3">
        {packs.map(p => (
          <li key={p.owner} className="rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" data-testid="question-pack">
            <p className="text-sm font-semibold text-slate-900">{p.label}</p>
            <p className="text-xs text-slate-600">{p.items.length} {p.items.length === 1 ? 'question' : 'questions'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <button type="button" disabled={busy === p.owner} onClick={() => word(p)} aria-label={`Word pack for ${p.label}`} className="rounded-lg bg-[#002C4B] px-3 py-1.5 font-semibold text-white hover:bg-[#073B60] disabled:opacity-60">{busy === p.owner ? 'Working…' : 'Word'}</button>
              <button type="button" onClick={() => markdown(p)} aria-label={`Markdown pack for ${p.label}`} className="rounded-lg px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-white">Markdown</button>
              {canImport && <label className={cx('cursor-pointer rounded-lg px-3 py-1.5 font-semibold text-[#002C4B] hover:underline')}>Read replies<input type="file" accept=".docx,.md,.txt" className="sr-only" aria-label={`Read replies for ${p.label}`} onChange={e => { read(p, e.target.files?.[0]); e.target.value = ''; }} /></label>}
            </div>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </section>
  );
}
