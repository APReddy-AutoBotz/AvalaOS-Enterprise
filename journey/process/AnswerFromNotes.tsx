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

const Mic = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /><path d="M8 21h8" />
  </svg>
);

/** One place to answer: type, or press the microphone and speak. What is said is written into the box to check before saving. */
export function AnswerBox({ value, onChange, label, placeholder, rows = 4, transcribe, disabled }: {
  value: string; onChange: (v: string) => void; label: string; placeholder: string; rows?: number;
  /** Absent when speech cannot be turned into text here (local mode). */
  transcribe?: (audioDataUrl: string) => Promise<string>; disabled?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const latest = React.useRef(value);
  latest.current = value;
  const recorder = useRecorder(async audio => {
    if (!transcribe) return;
    setBusy(true); setError(null);
    try { const text = (await transcribe(audio)).trim(); if (text) onChange(latest.current.trim() ? `${latest.current.trim()}\n${text}` : text); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  });
  const recording = recorder.state === 'recording';
  const mmss = (x: number) => `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
  const canSpeak = Boolean(transcribe) && recorder.state !== 'unsupported';
  return (
    <div>
      <div className={cx('relative rounded-xl border bg-white transition focus-within:border-[#002C4B] focus-within:ring-2 focus-within:ring-[#002C4B]/20', recording ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-300')}>
        <textarea aria-label={label} rows={rows} value={value} onChange={e => onChange(e.target.value)} disabled={disabled || busy || recording} placeholder={placeholder}
          className="block w-full resize-y rounded-xl bg-transparent px-3.5 py-3 pr-16 text-sm leading-6 focus:outline-none disabled:text-slate-500" />
        {canSpeak && (
          <button type="button" onClick={() => (recording ? recorder.stop() : recorder.start().catch(e => setError(messageOf(e))))} disabled={disabled || busy}
            aria-label={recording ? 'Stop recording' : 'Speak your answer'} title={recording ? 'Stop recording' : 'Speak your answer'}
            className={cx('absolute bottom-2.5 right-2.5 flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              recording ? 'bg-rose-600 text-white focus-visible:ring-rose-400' : 'bg-[#002C4B] text-white hover:bg-[#003d68] focus-visible:ring-[#002C4B] disabled:opacity-50')}>
            {recording ? <span className="h-3.5 w-3.5 rounded-sm bg-white" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
      </div>
      <p className="mt-1.5 min-h-[1.25rem] text-xs text-slate-500" role="status">
        {recording ? <span className="font-semibold text-rose-700"><span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-rose-600" />Listening {mmss(recorder.seconds)}. Press the square to stop.</span>
          : busy ? 'Writing down what you said…'
          : error ? <span className="text-red-700">{error}</span>
          : canSpeak ? 'Type, or press the microphone and speak. You can check and edit the words before saving.' : ''}
      </p>
    </div>
  );
}

/** Answers to several questions at once: the AI proposes which of the listed questions the text answers, with the words that answer each; only ticked ones are written. */
export function SeveralAnswers({ model, items, editor, ctx, initialNotes = '' }: { model: ProcessModel; items: TriageItem[]; editor: ModelEditor; ctx: NotesContext; initialNotes?: string }) {
  const [notes, setNotes] = React.useState(initialNotes);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<Proposal[] | null>(null);
  const [chosen, setChosen] = React.useState<Set<string>>(new Set());
  const [done, setDone] = React.useState<string | null>(null);

  const find = async () => {
    setBusy(`Reading your answer against ${items.length} ${items.length === 1 ? 'question' : 'questions'}…`); setError(null); setDone(null);
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
      const key = await saveNotesSource(ctx, notes);
      const picked = proposals.filter(p => chosen.has(p.itemKey));
      const ops = picked.map(p => buildAnswer(items.find(i => i.key === p.itemKey)!, model, p.answer, `from ${key}: "${p.quote.slice(0, 160)}"`)).filter((x): x is NonNullable<typeof x> => Boolean(x));
      const ok = await editor.apply(m => ops.reduce<{ model: ProcessModel; patch: JsonPatchOp[] }>((cur, x) => { const r: OpResult = x.op(cur.model); return { model: r.model, patch: [...cur.patch, ...r.patch] }; }, { model: m, patch: [] }), `Answered ${ops.length} questions (${key})`);
      if (ok) { setDone(`${ops.length} ${ops.length === 1 ? 'answer' : 'answers'} saved. What you said is kept as source ${key}.`); setProposals(null); setNotes(''); }
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3" data-testid="answer-several">
      {!proposals && <>
        <AnswerBox label="Your answers" value={notes} onChange={setNotes} rows={7} disabled={Boolean(busy)} transcribe={audio => ctx.store.transcribe(ctx.workspaceId, audio)}
          placeholder={'Answer any of the numbered questions, in any order, as you would say it. You can also paste meeting notes or an email reply.\nFor example: MIRO and FB60 can be used by the automation user; MIGO is not available to AP.'} />
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!notes.trim() || Boolean(busy)} onClick={find}>Find the answers</Button>
          <span className="text-xs text-slate-500" role="status">{busy ?? ''}</span>
        </div>
      </>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" role="status">{done}</p>}
      {proposals && (
        <div className="space-y-3" data-testid="proposals">
          {proposals.length === 0 ? <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-700">What you said does not answer any of the listed questions. Go back and add to it, or answer them one by one.</p> : (
            <ul className="space-y-2">
              {proposals.map(p => (
                <li key={p.itemKey} className={cx('rounded-xl border p-4', chosen.has(p.itemKey) ? 'border-[#002C4B] bg-slate-50' : 'border-slate-200')}>
                  <label className="flex gap-3">
                    <input type="checkbox" className="mt-1" checked={chosen.has(p.itemKey)} onChange={e => { const n = new Set(chosen); e.target.checked ? n.add(p.itemKey) : n.delete(p.itemKey); setChosen(n); }} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900"><span className="mr-1.5 tabular-nums text-slate-500">{items.findIndex(i => i.key === p.itemKey) + 1}.</span>{p.question}</span>
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
            {proposals.length > 0 && <Button disabled={chosen.size === 0 || Boolean(busy)} onClick={apply}>Save {chosen.size} {chosen.size === 1 ? 'answer' : 'answers'}</Button>}
            <Button variant="ghost" disabled={Boolean(busy)} onClick={() => setProposals(null)}>Back to what I said</Button>
            <span className="text-xs text-slate-500" role="status">{busy ?? ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Keeps what the person said as a source of the process, so answers can name it. Returns its key. */
export async function saveNotesSource(ctx: NotesContext, notes: string): Promise<string> {
  let n = 1; while (ctx.sourceKeys.includes(`ans-${n}`)) n++;
  const key = `ans-${n}`;
  const paras = notes.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const segments: IngestSegment[] = paras.map((text, i) => ({ id: `${key}:${i + 1}`, sourceId: key, kind: 'paragraph', text, locator: { lineStart: i + 1 } }));
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  await ctx.store.addSource(ctx.processId, { key, title: `Answers from ${ctx.me || 'a reviewer'}, ${date}`, fileName: '', format: 'txt', kind: 'Answers session', segments, inferred: false, warnings: [], byteSize: new Blob([notes]).size });
  ctx.sourceKeys.push(key);
  ctx.onSourcesChanged();
  return key;
}
