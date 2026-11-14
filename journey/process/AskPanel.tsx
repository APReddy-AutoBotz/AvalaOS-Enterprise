// "Ask Avala" on a process: the Avala assistant, read-only (domain/assistant/ask.ts). It answers only from
// this process's record, and every sentence links to the fact it came from. It changes nothing and saves
// nothing; the conversation goes when the panel closes.
import React from 'react';
import type { JourneyStore, SourceRow } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { AskError, askFacts, askFailure, askProcess, askSegments, readAnswer, validateQuestion, type Answer, type AskContext, type Target } from '../../domain/assistant/ask.ts';
import { loadAskRecord } from './askRecord.ts';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { SidePanel, SourceList } from './widgets.tsx';

type Turn = { question: string; answer?: Answer; error?: string };
const SUGGESTED = ['Why is this the recommended approach?', 'Which steps stay with people, and why?', 'What is still unknown about this process?'];

export function AskPanel({ store, processId, workspaceId, model, sources, about, onOpen, onClose }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; sources: SourceRow[];
  /** What the panel is asking about, and the choice of another process (the top bar's panel, journey/AskAvala.tsx). */
  about?: React.ReactNode;
  onOpen: (target: Target) => void; onClose: () => void;
}) {
  const [record, setRecord] = React.useState<Omit<AskContext, 'model'> | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [turns, setTurns] = React.useState<Turn[]>([]);
  const [question, setQuestion] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const end = React.useRef<HTMLDivElement>(null);

  // The record the answers come from: read once when the panel opens.
  React.useEffect(() => {
    let live = true;
    loadAskRecord(store, { processId, workspaceId, model, sources }).then(r => { if (live) setRecord(r); })
      .catch(e => { if (live) setLoadError(messageOf(e)); });
    return () => { live = false; };
  }, [store, processId, workspaceId, model, sources]);

  React.useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  const ask = async (text: string) => {
    if (!record || busy) return;
    setError(null);
    let q: string;
    try { q = validateQuestion(text); } catch (x) { setError(x instanceof AskError ? x.message : messageOf(x)); return; }
    const facts = askFacts(q, { model, ...record });
    setBusy(true); setQuestion('');
    setTurns(t => [...t, { question: q }]);
    try {
      const r = await store.runAiTask(workspaceId, askProcess.id, askSegments(q, facts) as never);
      const answer = readAnswer(r.data, facts);
      setTurns(t => t.map((x, i) => (i === t.length - 1 ? { ...x, answer } : x)));
    } catch (x) {
      setTurns(t => t.map((y, i) => (i === t.length - 1 ? { ...y, error: askFailure(messageOf(x)) } : y)));
    } finally { setBusy(false); }
  };

  return (
    <SidePanel title="Ask Avala" onClose={onClose} wide>
      <div className="flex min-h-full flex-col" data-testid="ask-panel">
        {about}
        <p className="text-sm leading-6 text-slate-600">Ask about this process. Answers come only from its record (its steps, assessment, requirements, board items and sources) and from how Avala OS itself works. Each sentence links to where it came from. Ask Avala explains; it changes nothing, and nothing here is saved.</p>
        <ErrorNote message={loadError} />
        {!record && !loadError && <div className="mt-6"><Spinner /></div>}
        <div className="mt-5 flex-1 space-y-6" aria-live="polite">
          {record && !turns.length && (
            <div role="group" className="flex flex-wrap gap-2" aria-label="Questions to start with">
              {SUGGESTED.map(s => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full bg-slate-100 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-200">{s}</button>)}
            </div>
          )}
          {turns.map((t, n) => (
            <section key={n} aria-label={`Question ${n + 1}`} data-testid="ask-turn">
              <p className="ml-auto w-fit max-w-[90%] rounded-xl bg-[#002C4B] px-3.5 py-2 text-sm text-white">{t.question}</p>
              {!t.answer && !t.error && <p className="mt-3 text-sm text-slate-500">Reading the record…</p>}
              {t.error && <p role="alert" className="mt-3 text-sm text-red-700">{t.error}</p>}
              {t.answer && <AnswerView answer={t.answer} onOpen={onOpen} />}
            </section>
          ))}
          <div ref={end} />
        </div>
        <form className="sticky bottom-0 mt-6 border-t border-slate-100 bg-white pt-4" onSubmit={e => { e.preventDefault(); ask(question); }}>
          <label htmlFor="ask-question" className="sr-only">Your question</label>
          <textarea id="ask-question" rows={2} value={question} maxLength={500} disabled={!record} placeholder="Ask about the steps, the assessment, requirements or sources…"
            onChange={e => setQuestion(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(question); } }}
            className="block w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20" />
          <ErrorNote message={error} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">Enter to ask, Shift + Enter for a new line</span>
            <Button type="submit" disabled={!record || busy || !question.trim()}>{busy ? 'Reading…' : 'Ask'}</Button>
          </div>
        </form>
      </div>
    </SidePanel>
  );
}

function AnswerView({ answer, onOpen }: { answer: Answer; onOpen: (t: Target) => void }) {
  // One number per fact cited, in the order they first appear.
  const cited = [...new Map(answer.sentences.map(s => [s.fact.id, s.fact])).values()];
  const num = (id: string) => cited.findIndex(f => f.id === id) + 1;
  if (!answer.sentences.length) {
    return <p className="mt-3 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200">{answer.missing || 'The record of this process does not answer that.'}</p>;
  }
  return (
    <div className="mt-3" data-testid="ask-answer">
      <p className="text-sm leading-7 text-slate-800">
        {answer.sentences.map((s, i) => (
          <React.Fragment key={i}>{i > 0 && ' '}{s.text}<sup className="ml-0.5"><a href={`#cite-${s.fact.id}`} className="font-semibold text-[#002C4B] no-underline hover:underline" aria-label={`Source ${num(s.fact.id)}: ${s.fact.label}`}>[{num(s.fact.id)}]</a></sup></React.Fragment>
        ))}
      </p>
      {answer.missing && <p className="mt-2 text-sm text-amber-900"><span className="font-semibold">Not in the record:</span> {answer.missing}</p>}
      <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3 text-xs" aria-label="Where this comes from">
        {cited.map((f, i) => (
          <li key={f.id} id={`cite-${f.id}`} data-testid="ask-citation">
            <span className="font-semibold text-slate-700">[{i + 1}]</span>{' '}
            {f.target.kind === 'source'
              ? <span className="text-slate-700">{f.label}<span className="mt-1 block"><SourceList sources={[f.target.ref]} sourceTitle={() => f.label} /></span></span>
              : <button type="button" onClick={() => onOpen(f.target)} className={cx('text-left font-medium text-[#002C4B] hover:underline')}>{f.label}</button>}
            <span className="mt-0.5 block text-slate-500">“{answer.sentences.find(s => s.fact.id === f.id)!.quote}”</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
