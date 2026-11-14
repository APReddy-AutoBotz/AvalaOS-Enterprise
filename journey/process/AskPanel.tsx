// "Ask Avala" on a process: the Avala assistant, read-only (domain/assistant/ask.ts). It answers only from
// this process's record, and every sentence links to the fact it came from. It changes nothing and saves
// nothing; the conversation goes when the panel closes.
import React from 'react';
import type { JourneyStore, SourceRow } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { AskError, askFacts, askFailure, askProcess, askSegments, readAnswer, validateQuestion, type Answer, type AskContext, type Target } from '../../domain/assistant/ask.ts';
import { loadAskRecord } from './askRecord.ts';
import { answerAction, citedFacts, followUps, STAGE_ORDER } from '../../domain/assistant/present.ts';
import type { StageId } from '../../domain/workspace/route.ts';
import { Button, cx, ErrorNote, messageOf, Spinner } from '../ui.tsx';
import { SidePanel, SourceList } from './widgets.tsx';

type Turn = { question: string; answer?: Answer; error?: string };
const SUGGESTED = ['Why is this the recommended approach?', 'Which steps stay with people, and why?', 'What is still unknown about this process?'];

export function AskPanel({ store, processId, workspaceId, model, sources, about, stages = STAGE_ORDER, onOpen, onClose }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; sources: SourceRow[];
  /** What the panel is asking about, and the choice of another process (the top bar's panel, journey/AskAvala.tsx). */
  about?: React.ReactNode;
  /** The stages this workspace uses: the answer's action opens only one of them. */
  stages?: StageId[];
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
          {turns.map((t, n) => {
            // Two questions to ask next, by rule from what the last answer cited, never one already asked.
            const next = t.answer && n === turns.length - 1 && !busy ? followUps(t.answer, turns.map(x => x.question), stages) : [];
            return (
              <section key={n} aria-label={`Question ${n + 1}`} data-testid="ask-turn">
                <p className="ml-auto w-fit max-w-[90%] rounded-xl bg-[#002C4B] px-3.5 py-2 text-sm text-white">{t.question}</p>
                {!t.answer && !t.error && <p className="mt-3 text-sm text-slate-500">Reading the record…</p>}
                {t.error && <p role="alert" className="mt-3 text-sm text-red-700">{t.error}</p>}
                {t.answer && <AnswerView answer={t.answer} stages={stages} onOpen={onOpen} />}
                {next.length > 0 && (
                  <div role="group" aria-label="Ask next" className="mt-4 flex flex-wrap gap-2">
                    {next.map(q => <button key={q} type="button" onClick={() => ask(q)} className="rounded-full border border-slate-300 px-3 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">{q}</button>)}
                  </div>
                )}
              </section>
            );
          })}
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

/**
 * One answer: the sentences with their numbers, what the record does not hold, one action that opens where
 * most of the facts live, and the sources as compact chips that show their quote when opened. The layout
 * is decided by rule (domain/assistant/present.ts); nothing here is written by the AI.
 */
function AnswerView({ answer, stages, onOpen }: { answer: Answer; stages: StageId[]; onOpen: (t: Target) => void }) {
  const cited = citedFacts(answer);
  const num = (id: string) => cited.findIndex(f => f.id === id) + 1;
  const [shown, setShown] = React.useState<string | null>(null);
  if (!answer.sentences.length) {
    return <p className="mt-3 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200">{answer.missing || 'The record of this process does not answer that.'}</p>;
  }
  const action = answerAction(answer, stages);
  const open = cited.find(f => f.id === shown) ?? null;
  return (
    <div className="mt-3" data-testid="ask-answer">
      <p className="text-sm leading-7 text-slate-800">
        {answer.sentences.map((s, i) => (
          <React.Fragment key={i}>{i > 0 && ' '}{s.text}<sup className="ml-0.5"><a href={`#cite-${s.fact.id}`} onClick={() => setShown(s.fact.id)} className="font-semibold text-[#002C4B] no-underline hover:underline" aria-label={`Source ${num(s.fact.id)}: ${s.fact.label}`}>{num(s.fact.id)}</a></sup></React.Fragment>
        ))}
      </p>
      {answer.missing && <p className="mt-2 text-sm text-amber-900"><span className="font-semibold">Not in the record:</span> {answer.missing}</p>}
      {action && (
        <Button variant="secondary" className="mt-3" onClick={() => onOpen(action.target)}>
          {action.label}<svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
        </Button>
      )}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-slate-500" id={`sources-${cited[0]!.id}`}>Sources</span>
          <ul className="contents" aria-labelledby={`sources-${cited[0]!.id}`}>
            {cited.map((f, i) => (
              <li key={f.id} id={`cite-${f.id}`} data-testid="ask-citation">
                <button type="button" aria-expanded={shown === f.id} onClick={() => setShown(shown === f.id ? null : f.id)}
                  className={cx('max-w-[16rem] truncate rounded-md px-2 py-1 text-left text-xs', shown === f.id ? 'bg-[#002C4B] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>
                  <span className="font-semibold">{i + 1}</span> · {f.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {open && (
          <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600 ring-1 ring-inset ring-slate-200" data-testid="ask-quote">
            <p className="font-semibold text-slate-700">{num(open.id)} · {open.label}</p>
            {open.target.kind === 'source'
              ? <div className="mt-1"><SourceList sources={[open.target.ref]} sourceTitle={() => open.label} /></div>
              : <p className="mt-1">“{answer.sentences.find(s => s.fact.id === open.id)!.quote}”</p>}
            {open.target.kind !== 'source' && <button type="button" onClick={() => onOpen(open.target)} className="mt-1.5 font-medium text-[#002C4B] hover:underline">Open where this is</button>}
          </div>
        )}
      </div>
    </div>
  );
}
