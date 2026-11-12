// Answers from notes or voice: the person types, pastes or speaks; the AI proposes which open
// questions the text answers, each with the words that answer it; the person ticks what is right
// and applies. The text is kept as a source of the process, so every answer can be traced to it.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import type { TriageItem } from '../../domain/questions/triage.ts';
import { answerFromNotes, notesSegments, proposalsFrom, type NoteFinding, type Proposal } from '../../domain/questions/notes.ts';
import type { JourneyStore } from '../store/types.ts';
import { Button, cx, messageOf } from '../ui.tsx';
import type { ModelEditor } from './useModelEditor.ts';
import { buildAnswer } from './GapsAssistant.tsx';
import type { OpResult } from '../../domain/processModel/patch.ts';
import type { JsonPatchOp } from '../../domain/processModel/jsonPatch.ts';

export interface NotesContext { store: JourneyStore; workspaceId: string; processId: string; me: string; sourceKeys: string[]; onSourcesChanged: () => void }

const MAX_SECONDS = 600;
const readAsDataUrl = (blob: Blob) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => bad(r.error); r.readAsDataURL(blob); });

function useRecorder(onAudio: (dataUrl: string) => void) {
  const [state, setState] = React.useState<'idle' | 'recording' | 'unsupported'>(() => (typeof MediaRecorder === 'undefined' ? 'unsupported' : 'idle'));
  const [seconds, setSeconds] = React.useState(0);
  const rec = React.useRef<MediaRecorder | null>(null);
  const timer = React.useRef<number | null>(null);
  const stop = () => { rec.current?.state === 'recording' && rec.current.stop(); };
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) ?? '';
    const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = e => chunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      if (timer.current) clearInterval(timer.current);
      setState('idle');
      const blob = new Blob(chunks, { type: (r.mimeType || 'audio/webm').split(';')[0] });
      onAudio(await readAsDataUrl(blob));
    };
    rec.current = r;
    r.start();
    setSeconds(0);
    setState('recording');
    timer.current = window.setInterval(() => setSeconds(s => { if (s + 1 >= MAX_SECONDS) stop(); return s + 1; }), 1000);
  };
  React.useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  return { state, seconds, start, stop };
}

export function AnswerFromNotes({ model, items, editor, ctx }: { model: ProcessModel; items: TriageItem[]; editor: ModelEditor; ctx: NotesContext }) {
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<Proposal[] | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [done, setDone] = React.useState<string | null>(null);

  const recorder = useRecorder(async audio => {
    setBusy('Turning the recording into text…'); setError(null);
    try { const text = await ctx.store.transcribe(ctx.workspaceId, audio); setNotes(n => (n.trim() ? `${n.trim()}\n\n${text}` : text)); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(null); }
  });

  const find = async () => {
    setBusy(`Reading your notes against ${items.length} open ${items.length === 1 ? 'question' : 'questions'}…`); setError(null); setDone(null);
    try {
      const { segments, ids } = notesSegments(model, items, notes);
      const r = await ctx.store.runAiTask(ctx.workspaceId, answerFromNotes.id, segments);
      const found = proposalsFrom(model, items, ids, ((r.data as { answers?: NoteFinding[] })?.answers) ?? []);
      setProposals(found);
      setChosen(new Set(found.filter(p => p.certainty === 'stated').map(p => p.itemKey)));
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(null); }
  };

  const apply = async () => {
    if (!proposals) return;
    setBusy('Saving the answers…'); setError(null);
    try {
      // Keep the notes as a source first, so the answers can name it.
      let n = 1; while (ctx.sourceKeys.includes(`ans-${n}`)) n++;
      const key = `ans-${n}`;
      const paras = notes.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      const segments: IngestSegment[] = paras.map((text, i) => ({ id: `${key}:${i + 1}`, sourceId: key, kind: 'paragraph', text, locator: { lineStart: i + 1 } }));
      const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      await ctx.store.addSource(ctx.processId, { key, title: `Answers from ${ctx.me || 'a reviewer'}, ${date}`, fileName: '', format: 'txt', kind: 'Answers session', segments, inferred: false, warnings: [], byteSize: new Blob([notes]).size });
      ctx.onSourcesChanged();
      const picked = proposals.filter(p => chosen.has(p.itemKey));
      const ops = picked.map(p => buildAnswer(items.find(i => i.key === p.itemKey)!, model, p.answer, `from ${key}: "${p.quote.slice(0, 160)}"`)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const ok = await editor.apply(m => ops.reduce<{ model: ProcessModel; patch: JsonPatchOp[] }>((cur, x) => { const r: OpResult = x.op(cur.model); return { model: r.model, patch: [...cur.patch, ...r.patch] }; }, { model: m, patch: [] }), `Answered ${ops.length} questions from notes (${key})`);
      if (ok) { setDone(`${ops.length} ${ops.length === 1 ? 'answer' : 'answers'} saved. Your notes are kept as source ${key}.`); setProposals(null); setNotes(''); }
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(null); }
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="answer-from-notes">
      <h4 className="font-display text-lg font-semibold text-slate-900">Answer from notes or voice</h4>
      <p className="mt-1 text-sm leading-6 text-slate-600">Type or paste anything: meeting notes, an email reply, a follow-up call transcript. Or speak your answers. You will see which of the {items.length} open {items.length === 1 ? 'question' : 'questions'} it answers, with the words that answer each, before anything is saved.</p>
      {!proposals && (
        <div className="mt-4 space-y-3">
          <textarea aria-label="Notes" rows={8} value={notes} onChange={e => setNotes(e.target.value)} disabled={Boolean(busy)}
            placeholder={'For example:\nMIRO and FB60 can be used by the automation user. MIGO is not available to AP.\nThe AP Team Lead handles duplicate invoices.'}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm leading-6 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20" />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!notes.trim() || Boolean(busy) || recorder.state === 'recording'} onClick={find}>Find answers</Button>
            {recorder.state === 'idle' && <Button variant="secondary" disabled={Boolean(busy)} onClick={() => recorder.start().catch(e => setError(messageOf(e)))}>Speak your answers</Button>}
            {recorder.state === 'recording' && <Button variant="secondary" onClick={recorder.stop}><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-600 align-middle" />Stop recording ({mmss(recorder.seconds)})</Button>}
            {recorder.state === 'unsupported' && <span className="text-xs text-slate-500">This browser cannot record; type or paste instead.</span>}
            <span className="text-xs text-slate-500" role="status">{busy ?? (recorder.state === 'recording' ? `Recording. Stops by itself at ${MAX_SECONDS / 60} minutes.` : '')}</span>
          </div>
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      {done && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{done}</p>}
      {proposals && (
        <div className="mt-4 space-y-3" data-testid="proposals">
          {proposals.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">The notes do not answer any of the open questions in this view.</p> : (
            <ul className="space-y-2">
              {proposals.map(p => (
                <li key={p.itemKey} className={cx('rounded-xl border p-4', chosen.has(p.itemKey) ? 'border-[#002C4B] bg-slate-50' : 'border-slate-200')}>
                  <label className="flex gap-3">
                    <input type="checkbox" className="mt-1" checked={chosen.has(p.itemKey)} onChange={e => { const n = new Set(chosen); e.target.checked ? n.add(p.itemKey) : n.delete(p.itemKey); setChosen(n); }} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900">{p.question}</span>
                      <span className="mt-1 block text-sm text-slate-800"><span className="font-semibold text-[#002C4B]">Answer:</span> {p.display}</span>
                      <span className="mt-1 block border-l-2 border-sky-200 pl-2 text-xs italic text-slate-500">“{p.quote}”</span>
                      {p.certainty === 'inferred' && <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">Read between the lines: check it</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {proposals.length > 0 && <Button disabled={chosen.size === 0 || Boolean(busy)} onClick={apply}>Apply {chosen.size} {chosen.size === 1 ? 'answer' : 'answers'}</Button>}
            <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setProposals(null)}>Back to the notes</Button>
            <span className="text-xs text-slate-500" role="status">{busy ?? ''}</span>
          </div>
        </div>
      )}
    </section>
  );
}
