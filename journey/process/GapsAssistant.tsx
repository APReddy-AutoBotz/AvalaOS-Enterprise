// Closing the gaps: the open questions after triage, answered one at a time with the right input
// for each. Every answer is written to the process model, so the assessment and the documents
// update at once. Nothing is written without the person pressing save.
import React from 'react';
import { whatFollows } from '../../domain/plan/purpose.ts';
import type { AccessStatus, ProcessModel } from '../../domain/processModel/types.ts';
import { closeQuestions, deferQuestion, reopenQuestions } from '../../domain/processModel/patch.ts';
import { ACCESS, all, buildAnswer, record, type Op } from '../../domain/questions/answer.ts';
import { groupLabel, OWNER_LABEL, type QGroup, type QOwner, type TriageItem } from '../../domain/questions/triage.ts';
import { holdReason, nowHeading, planSummary } from '../../domain/questions/firstList.ts';
import { lookSummary } from '../../domain/assistant/sourceLook.ts';
import { useQuestionPlan } from './sourceLook.ts';
import { FoundAnswers } from './FoundAnswers.tsx';

type View = 'now' | 'found' | 'wait';
import { Button, cx } from '../ui.tsx';
import type { ModelEditor } from './useModelEditor.ts';
import { AnswerBox, SeveralAnswers, type NotesContext } from './AnswerFromNotes.tsx';
import { answerFromNotes, notesSegments, proposalsFrom, type NoteFinding } from '../../domain/questions/notes.ts';
import { messageOf } from '../ui.tsx';
import { QuestionPacks, type ImportedReply } from './QuestionPacks.tsx';
import type { Branding } from '../../domain/docs/branding.ts';
import { couldChange, focusedLine, meetingResult } from '../../domain/questions/result.ts';
import { closedGaps } from '../../domain/questions/closedGaps.ts';
import { earlierAnswers, NO_WAY_IN, NO_WAY_IN_LABEL, waysMissing, waysRecordLine } from '../../domain/questions/ways.ts';
import type { GapsMode } from './openGaps.ts';
import { useVoice, voiceProps } from './voice.ts';

const GROUP_TONE: Record<QGroup, string> = { decides: 'bg-[#002C4B] text-white', signoff: 'bg-sky-100 text-sky-900', detail: 'bg-slate-100 text-slate-700' };
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';

export function GapsAssistant({ processId, model, editor, canEdit, onClose, notes, branding, opening = 'all', backLabel = 'Back to the document', documents = true }: {
  processId: string; model: ProcessModel; editor: ModelEditor; canEdit: boolean; onClose?: () => void; notes?: NotesContext & { aiAvailable: boolean }; branding?: Branding;
  /** How it opens (package 16): only the questions that could change the recommendation, on "Several at once", or as from Documents. */
  opening?: GapsMode;
  backLabel?: string;
  /** Whether the organisation uses the documents; without them no line speaks of them. */
  documents?: boolean;
}) {
  const [scope, setScope] = React.useState<'one' | 'several'>(opening === 'several' ? 'several' : 'one');
  // Only the questions the Assessment stage's line counts, until the person asks for all (package 16).
  const [focus, setFocus] = React.useState(opening === 'focused');
  // What was open before answers from notes, a transcript or a returned file were saved: the result shows against it.
  const [before, setBefore] = React.useState<ProcessModel | null>(null);
  const sendRef = React.useRef<HTMLDivElement>(null);
  const [reply, setReply] = React.useState<ImportedReply | null>(null);
  const ai = Boolean(notes?.aiAvailable && canEdit);
  // The first list (part D): only what people must answer is asked first; answers found in the sources are confirmed; the rest waits.
  const { plan, found, triage: t, look, looking } = useQuestionPlan(processId, model);
  const [view, setView] = React.useState<View | null>(null);
  const shown: View = view ?? (plan.now.length ? 'now' : plan.found.length ? 'found' : 'wait');
  const [owner, setOwner] = React.useState<QOwner | 'all'>('all');
  const [showDeferred, setShowDeferred] = React.useState(false);
  const inView = shown === 'now' ? plan.now : shown === 'found' ? [] : plan.wait;
  const focused = t.items.filter(couldChange);
  const list = (focus ? focused : [...inView, ...(showDeferred && shown === 'wait' ? plan.deferred : [])]).filter(i => owner === 'all' || i.owner === owner);
  const [index, setIndex] = React.useState(0);
  const at = Math.min(index, Math.max(0, list.length - 1));
  const item = list[at];
  const open = t.items.filter(i => !i.deferred);
  const tiles: [View, number, string][] = [['now', plan.now.length, 'Only your people can tell us'], ['found', plan.found.length, 'Found in your sources: confirm'], ['wait', plan.wait.length, 'Can wait until sign-off']];
  const lookLine = looking ? 'Looking in your sources for answers…' : lookSummary(look, found.length);

  return (
    <div className="space-y-5" data-testid="gaps-assistant">
      <section className="rounded-xl bg-[#002C4B] p-6 text-white shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#FFBC03]">Close the gaps</p>
            <h3 className="mt-1.5 font-display text-2xl font-semibold" data-testid="gaps-count">{nowHeading(plan)}</h3>
            <p className="mt-1 text-sm text-slate-200" data-testid="gaps-summary">{planSummary(plan)} {whatFollows(model).assessed ? (documents ? 'Each answer updates the model, the assessment and the documents at once.' : 'Each answer updates the model and the assessment at once.') : 'Each answer updates the process and its document at once.'}</p>
            {lookLine && <p className="mt-1 text-xs text-slate-300" role="status" data-testid="source-look">{lookLine}</p>}
          </div>
          {onClose && <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white ring-1 ring-white/30 hover:bg-white/10">{backLabel}</button>}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {tiles.map(([v, n, label]) => (
            <button key={v} type="button" onClick={() => { setView(v); setIndex(0); setFocus(false); }} aria-pressed={!focus && shown === v} data-testid={`gaps-view-${v}`}
              className={cx('rounded-xl p-4 text-left ring-1 ring-inset transition', !focus && shown === v ? 'bg-white text-[#002C4B] ring-white' : 'bg-white/[0.07] ring-white/10 hover:bg-white/[0.12]')}>
              <span className="font-display text-2xl font-semibold tabular-nums">{n}</span>
              <span className="mt-0.5 block text-sm">{label}</span>
            </button>
          ))}
        </div>
        {focus && (
          <p className="mt-4 text-sm text-slate-100" data-testid="gaps-focused">
            {focusedLine(focused.length)} · <button type="button" onClick={() => { setFocus(false); setIndex(0); }} className="font-semibold text-white underline decoration-[#FFBC03] decoration-2 underline-offset-4">Show all</button>
          </p>
        )}
      </section>

      {before && <MeetingResultPanel before={before} after={model} onSend={() => sendRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} onClose={() => setBefore(null)} />}

      {t.alreadyKnown.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3.5" data-testid="already-known">
          <p className="text-sm text-emerald-900"><span className="font-semibold">{t.alreadyKnown.length} {t.alreadyKnown.length === 1 ? 'question is' : 'questions are'} already answered by the model</span>, for example: {t.alreadyKnown[0].why}</p>
          {canEdit && <Button variant="secondary" onClick={() => editor.apply(all(...t.alreadyKnown.map(k => (m: ProcessModel) => closeQuestions(m, { questionIds: [k.questionId], answer: `Already recorded: ${k.why}` }))), `Closed ${t.alreadyKnown.length} questions the model already answers`)}>Close them</Button>}
        </div>
      )}

      <div ref={sendRef} className="scroll-mt-4"><QuestionPacks model={model} t={t} plan={plan} branding={branding} canImport={canEdit} onImported={r => setReply(r)} /></div>

      {reply && (
        <section className="rounded-xl border border-[#B58500]/40 bg-white p-6" aria-label="Replies read" data-testid="pack-reply">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-display text-lg font-semibold text-slate-900">Replies from {reply.label}</h4>
              <p className="mt-1 text-sm text-slate-600" data-testid="pack-reply-count">{reply.answered ? `${reply.answered} answered ${reply.answered === 1 ? 'row' : 'rows'} read from the file.` : 'No answered rows; the whole reply is read as notes.'} {ai ? 'Check what each answer settles before saving.' : 'Matching answers to questions needs the AI service, which is not available here; the replies are shown so you can answer each question yourself.'}</p>
            </div>
            <button type="button" className="text-sm text-slate-600 hover:underline" onClick={() => setReply(null)}>Close</button>
          </div>
          {ai ? <div className="mt-4" key={reply.label}><SeveralAnswers model={model} items={reply.items.length ? reply.items : list} editor={editor} ctx={notes!} initialNotes={reply.notes} onSaved={setBefore} /></div>
            : <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{reply.notes}</pre>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-slate-600">Who can answer
          <select aria-label="Who can answer" value={owner} onChange={e => { setOwner(e.target.value as QOwner | 'all'); setIndex(0); }} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm">
            <option value="all">Anyone</option>{(Object.keys(OWNER_LABEL) as QOwner[]).map(o => <option key={o} value={o}>{OWNER_LABEL[o]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-slate-600"><input type="checkbox" checked={showDeferred} onChange={e => setShowDeferred(e.target.checked)} />Include the ones set aside ({t.items.filter(i => i.deferred).length})</label>
        <span className="ml-auto text-xs text-slate-500" data-testid="save-state">{editor.saving ? 'Saving…' : ''}</span>
      </div>

      {shown === 'found' ? (
        plan.found.length
          ? <FoundAnswers processId={processId} model={model} items={t.items} found={found} canEdit={canEdit} onApply={(op, summary) => editor.apply(op, summary)} />
          : <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600" data-testid="found-none">{looking ? 'Looking in your sources…' : 'No answers found in your sources to confirm.'}</p>
      ) : !item ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center" data-testid="gaps-done">
          <p className="font-display text-lg font-semibold text-slate-900">{open.length === 0 ? 'No open questions left' : focus ? 'No open question could change the recommendation' : shown === 'now' ? 'Nothing only your people can tell us right now' : 'Nothing left in this view'}</p>
          <p className="mt-1 text-sm text-slate-600">{open.length === 0 ? (documents ? 'The documents now rest on answered facts. Questions set aside stay listed in each document until someone answers them.' : 'The assessment now rests on answered facts. Questions set aside stay listed until someone answers them.') : focus ? 'Show all to answer the rest.' : shown === 'now' ? `What is left can wait until sign-off (${plan.wait.length}).` : 'Change the filters to see the rest.'}</p>
        </div>
      ) : (
        <div className="grid gap-5 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-xl border border-slate-200 bg-white p-6" aria-label="Your answer">
            {ai && (
              <div role="tablist" aria-label="Answer" className="mb-5 inline-flex rounded-lg bg-slate-200/70 p-0.5">
                {([['one', 'This question'], ['several', `Several at once (${list.length})`]] as const).map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={scope === id} onClick={() => setScope(id)}
                    className={cx('rounded-md px-3.5 py-1.5 text-sm font-semibold transition', scope === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
                ))}
              </div>
            )}
            {scope === 'several' && ai ? (
              <>
                <h4 className="font-display text-lg font-semibold text-slate-900">{list.length === 1 ? 'Answer the question listed' : `Answer any of the ${list.length} questions listed`}</h4>
                <p className="mb-4 mt-1 text-sm leading-6 text-slate-600">Speak or type freely, in any order. You will see which questions it answers, with your words for each, before anything is saved.</p>
                <SeveralAnswers model={model} items={list} editor={editor} ctx={notes!} onSaved={setBefore} />
              </>
            ) : (
              <QuestionCard key={item.key} item={item} model={model} canEdit={canEdit} position={`${at + 1} of ${list.length}`} notes={ai ? notes : undefined} waits={shown === 'wait' ? holdReason(plan.held[item.key]) : ''}
                onApply={(op, summary) => editor.apply(op, summary)}
                onSkip={() => setIndex((at + 1) % list.length)} onBack={at > 0 ? () => setIndex(at - 1) : undefined} />
            )}
          </section>
          <div className="rounded-xl border border-slate-200 bg-white p-2">
            <p className="px-3 pb-1 pt-2 text-xs font-semibold text-slate-500">{scope === 'several' && ai ? 'Questions you can answer now' : 'Questions'}</p>
            <ol className="max-h-[34rem] space-y-0.5 overflow-y-auto text-sm" aria-label="Questions">
              {list.map((x, i) => (
                <li key={x.key}><button type="button" onClick={() => { setIndex(i); setScope('one'); }} className={cx('w-full rounded-lg px-3 py-2 text-left', scope === 'one' && i === at ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-700 hover:bg-slate-50')}>
                  <span className="flex items-start gap-2">
                    <span className="w-5 shrink-0 text-right tabular-nums text-slate-500">{i + 1}.</span>
                    <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', x.group === 'decides' ? 'bg-[#002C4B]' : x.group === 'signoff' ? 'bg-sky-400' : 'bg-slate-300')} />
                    <span className="line-clamp-2">{x.question}{x.deferred && <span className="ml-1 text-xs font-normal text-slate-500">(set aside)</span>}{(x.also?.length ?? 0) > 0 && <span className="ml-1 text-xs font-normal text-slate-500">(asked {x.also!.length + 1} times)</span>}</span>
                  </span>
                </button></li>
              ))}
            </ol>
          </div>
        </div>
      )}
      <ClosedByPerson model={model} canEdit={canEdit} onReopen={(ids, question) => editor.apply(m => reopenQuestions(m, { questionIds: ids }), `Reopened: ${question}`)} />
    </div>
  );
}

/**
 * The gaps a person closed ("Not applicable", or answered without a value) are not asked again (package B, pull
 * request 5a): one line says how many, and opens them, each with its answer and Reopen, the only way back.
 */
function ClosedByPerson({ model, canEdit, onReopen }: { model: ProcessModel; canEdit: boolean; onReopen: (ids: string[], question: string) => void }) {
  const closed = React.useMemo(() => closedGaps(model), [model]);
  const [open, setOpen] = React.useState(false);
  if (!closed.length) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-3" data-testid="closed-gaps">
      <p className="text-sm text-slate-700">
        {closed.length} {closed.length === 1 ? 'question closed by a person is' : 'questions closed by a person are'} not asked again.{' '}
        <button type="button" className="font-medium text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide them' : 'Show them'}</button>
      </p>
      {open && (
        <ul className="mt-2 divide-y divide-slate-100">
          {closed.map(c => (
            <li key={c.question.id} className="flex flex-wrap items-start justify-between gap-2 py-2" data-testid="closed-gap">
              <div>
                <p className="text-sm font-medium text-slate-900">{c.question.question}</p>
                <p className="text-sm text-slate-600">Answer: {c.question.answer ?? 'Closed'}</p>
              </div>
              {canEdit && <Button variant="ghost" onClick={() => onReopen([c.question.id], c.question.question)}>Reopen</Button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * After answers from notes, a transcript or a returned question file are saved: how many of the open
 * questions they closed, and what is left, grouped by who to ask as the question files are, the most
 * decisive first, with the name a question is left with (domain/questions/result.ts).
 */
function MeetingResultPanel({ before, after, onSend, onClose }: { before: ProcessModel; after: ProcessModel; onSend: () => void; onClose: () => void }) {
  const r = React.useMemo(() => meetingResult(before, after), [before, after]);
  return (
    <section className="rounded-xl border border-emerald-200 bg-white p-6" aria-labelledby="meeting-result" data-testid="meeting-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id="meeting-result" className="font-display text-lg font-semibold text-slate-900" data-testid="meeting-result-count">{r.text}</h4>
          <p className="mt-1 text-sm text-slate-600">{r.left.length ? 'What is left, by who can answer it:' : 'Nothing is left open.'}</p>
        </div>
        <button type="button" className="text-sm text-slate-600 hover:underline" onClick={onClose}>Close</button>
      </div>
      {r.left.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {r.left.map(g => (
            <div key={g.owner} data-testid="meeting-result-group">
              <p className="text-xs font-semibold text-slate-500">{g.label} ({g.items.length})</p>
              <ul className="mt-2 space-y-2 text-sm">
                {g.items.map(i => (
                  <li key={i.key} className="leading-6 text-slate-800">
                    {i.question}
                    <span className="mt-0.5 flex flex-wrap gap-1.5">
                      {i.decisive && <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', GROUP_TONE.decides)}>{i.group}</span>}
                      {i.leftWith && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">Ask: {i.leftWith}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {r.left.length > 0 && <button type="button" onClick={onSend} className="mt-4 text-sm font-semibold text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4">Send questions to the people who know</button>}
    </section>
  );
}

function QuestionCard({ item, model, canEdit, position, onApply, onSkip, onBack, notes, waits }: {
  key?: React.Key; item: TriageItem; model: ProcessModel; canEdit: boolean; position: string; notes?: NotesContext; waits?: string;
  onApply: (op: Op, summary: string) => Promise<boolean>; onSkip: () => void; onBack?: () => void;
}) {
  const voice = useVoice(notes?.store, notes?.workspaceId);
  const [text, setText] = React.useState('');
  const [pick, setPick] = React.useState('');
  const [statuses, setStatuses] = React.useState<Record<number, AccessStatus>>(() => Object.fromEntries((item.interfaces ?? []).map(x => [x.index, x.access])));
  const [assignee, setAssignee] = React.useState(item.assignedTo ?? '');
  const [mode, setMode] = React.useState<'answer' | 'later'>('answer');
  const t = item.target;
  const options = item.kind === 'role' ? model.roles : item.kind === 'system' ? model.systems : [];

  const [said, setSaid] = React.useState('');
  const [filling, setFilling] = React.useState<string | null>(null);
  const structured = item.kind !== 'free' && item.kind !== 'text';
  // A spoken or typed answer to a question that needs a choice (a role, a number, interface statuses) is read by the AI into that choice, for the person to check.
  const fill = async () => {
    if (!notes) return;
    setFilling('Reading your answer…');
    try {
      const { segments, ids } = notesSegments(model, [item], said);
      const r = await notes.store.runAiTask(notes.workspaceId, answerFromNotes.id, segments);
      const [p] = proposalsFrom(model, [item], ids, ((r.data as { answers?: NoteFinding[] })?.answers) ?? []);
      if (!p) {
        setFilling(item.kind === 'ways'
          ? `Your words do not say how the automation reaches ${model.systems.find(x => x.id === item.target.id)?.name ?? 'it'}, so nothing is recorded yet. Choose a way in, or "${NO_WAY_IN_LABEL}".`
          : 'Your answer does not settle this question. Choose below, or say it differently.');
        return;
      }
      if (p.answer.pick) setPick(p.answer.pick);
      if (p.answer.statuses) { setStatuses(p.answer.statuses); if (item.kind === 'ways') setPick(''); }
      if (item.kind === 'number' && p.answer.text) setText(p.answer.text);
      setFilling(`Filled in from “${p.quote}”. Check it, then save.`);
    } catch (e) { setFilling(messageOf(e)); }
  };
  const answerOp = () => buildAnswer(item, model, { pick, text: structured ? (item.kind === 'number' ? text : said || text) : text, statuses });
  const ready = answerOp() !== null;
  const save = async () => { const a = answerOp(); if (a) await onApply(a.op, a.summary); };

  return (
    <article data-testid="gap-question">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold tabular-nums text-slate-500">Question {position}</span>
        <span className={cx('rounded-full px-2.5 py-0.5 font-semibold', GROUP_TONE[item.group])}>{groupLabel(item)}</span>
        <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">Ask: {item.assignedTo ?? OWNER_LABEL[item.owner]}</span>
      </div>
      <h4 className="mt-3 font-display text-lg font-semibold leading-snug text-slate-900">{item.question}</h4>
      <p className="mt-1 text-xs text-slate-500">Updates: {item.affects.join(' · ')}</p>
      {waits && <p className="mt-1 text-xs text-slate-500" data-testid="gap-waits">Why it can wait: {waits}</p>}
      {(item.also?.length ?? 0) > 0 && <p className="mt-1 text-xs text-slate-500">Also asked as: {item.also!.map(q => `“${q}”`).join('; ')}</p>}
      {/* An earlier worded answer to this question, kept on the record though it settled nothing (plan "No way in"). */}
      {earlierAnswers(model, item).map((a, i) => <p key={i} className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="earlier-answer">You answered earlier: “{a}”</p>)}

      {canEdit && mode === 'answer' && (
        <div className="mt-5 space-y-3">
          {item.kind === 'choice' && (
            <select aria-label="Answer" value={pick} onChange={e => setPick(e.target.value)} className={input}>
              <option value="">Choose the answer</option>
              {(item.choices ?? []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
          {(item.kind === 'role' || item.kind === 'system') && (
            <select aria-label="Answer" value={pick} onChange={e => setPick(e.target.value)} className={input}>
              <option value="">{item.kind === 'role' ? 'Choose the role' : 'Choose the system'}</option>
              {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {(item.kind === 'access' || item.kind === 'ways') && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" aria-label={item.kind === 'ways' ? 'Ways in' : undefined}>
              {item.interfaces!.map(x => (
                <li key={x.index} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-sm text-slate-800">{x.label}</span>
                  <select aria-label={`Status of ${x.label}`} value={statuses[x.index]} onChange={e => { setStatuses({ ...statuses, [x.index]: e.target.value as AccessStatus }); if (item.kind === 'ways') setPick(''); }}
                    className={cx('rounded-md border px-2 py-1 text-xs', statuses[x.index] === 'unknown' ? 'border-amber-300 bg-amber-50' : 'border-slate-300 bg-white')}>
                    {ACCESS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {item.kind === 'ways' && (
            <div className="space-y-2">
              <button type="button" aria-pressed={pick === NO_WAY_IN} onClick={() => { if (pick === NO_WAY_IN) setPick(''); else { setPick(NO_WAY_IN); setStatuses(Object.fromEntries((item.interfaces ?? []).map(x => [x.index, x.access]))); } }}
                className={cx('rounded-lg px-3 py-1.5 text-sm font-semibold ring-1 ring-inset', pick === NO_WAY_IN ? 'bg-[#002C4B] text-white ring-[#002C4B]' : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50')}>{NO_WAY_IN_LABEL}</button>
              {/* What Save will record, and for "No way in" what happens to the steps done in the application. */}
              {/* Only other ways chosen: the API or the screens are still needed; Save stays off. */}
              {waysMissing({ pick, statuses }) && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200" role="status" data-testid="ways-missing">{waysMissing({ pick, statuses })}</p>}
              {waysRecordLine(model, item, { pick, statuses }) && <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm leading-6 text-sky-950 ring-1 ring-inset ring-sky-200" role="status" data-testid="ways-record">{waysRecordLine(model, item, { pick, statuses })}</p>}
            </div>
          )}
          {item.kind === 'number' && <input aria-label="Answer" inputMode="decimal" value={text} onChange={e => setText(e.target.value)} placeholder="A number" className={input} />}
          {structured ? (
            <div>
              <AnswerBox label={notes ? 'Or say it' : 'Note (optional)'} value={said} onChange={setSaid} rows={2} {...(notes ? voiceProps(voice, notes.store, notes.workspaceId) : {})}
                placeholder={notes ? 'Or type or say the answer in your own words, then press Fill in' : 'Anything worth recording with the answer'} />
              {notes && <div className="-mt-1 flex flex-wrap items-center gap-2"><Button variant="secondary" disabled={!said.trim() || filling === 'Reading your answer…'} onClick={fill}>Fill in from my answer</Button><span className="text-xs text-slate-600" role="status">{filling ?? ''}</span></div>}
            </div>
          ) : (
            <AnswerBox label="Answer" value={text} onChange={setText} rows={4} {...(notes ? voiceProps(voice, notes.store, notes.workspaceId) : {})}
              placeholder="Type the answer as you would say it, or press the microphone and speak" />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!ready} onClick={save}>Save answer</Button>
            <Button variant="ghost" onClick={onSkip}>Skip</Button>
            {onBack && <Button variant="ghost" onClick={onBack}>Back</Button>}
            <span className="flex-1" />
            <Button variant="ghost" onClick={() => onApply(record(item, 'Not applicable to this process.'), `Not applicable: ${item.question}`)}>Not applicable</Button>
            {item.deferred
              ? <Button variant="ghost" onClick={() => onApply(m => reopenQuestions(m, { questionIds: item.questionIds }), `Reopened: ${item.question}`)}>Reopen</Button>
              : <Button variant="ghost" onClick={() => setMode('later')}>Ask someone later</Button>}
          </div>
        </div>
      )}
      {canEdit && mode === 'later' && (
        <div className="mt-5 flex flex-wrap items-end gap-2">
          <label className="flex-1 text-xs font-semibold text-slate-600">Who should answer it
            <input aria-label="Who should answer it" value={assignee} onChange={e => setAssignee(e.target.value)} placeholder={OWNER_LABEL[item.owner]} className={cx(input, 'mt-1')} />
          </label>
          <Button onClick={() => onApply(m => deferQuestion(m, { questionIds: item.questionIds, owner: assignee || OWNER_LABEL[item.owner], gap: { target: item.target, question: item.question } }), `Set aside for ${assignee || OWNER_LABEL[item.owner]}: ${item.question}`)}>Set aside</Button>
          <Button variant="ghost" onClick={() => setMode('answer')}>Cancel</Button>
        </div>
      )}
    </article>
  );
}
