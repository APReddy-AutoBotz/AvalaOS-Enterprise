// The Ask Avala interview (docs/product-plan.md, stage 2), in the Ask Avala panel on a process: the open
// questions one at a time in triage's order, each with why it matters; the person answers in their own
// words; the answer is read by the existing notes task and, by rule (domain/questions/interview.ts),
// offered as "This will record: …" with their words and what it changes, asked back when only
// inferred, or followed by one question when it holds no value. Nothing is written until they press
// Save, and then only through the same edit Closing the gaps makes, with their words kept.
import React from 'react';
import type { JourneyStore, ProcessRow, Workspace } from '../store/types.ts';
import { StoreError } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage, type TriageItem } from '../../domain/questions/triage.ts';
import { answerFromNotes, type NoteFinding } from '../../domain/questions/notes.ts';
import {
  followUpFor, interviewAnswer, interviewEdit, interviewQueue, interviewSegments, INTERVIEW_LIMITS, questionHeading, readInterview,
  UNANSWERED, whoCanAnswer, whyItMatters, willRecord, type Reading,
} from '../../domain/questions/interview.ts';
import { impactSummary } from '../../domain/docs/impact.ts';
import { useModelEditor } from './useModelEditor.ts';
import { previewImpact, useImpactContext } from './ImpactNote.tsx';
import { announceProcessChanged } from '../processChanged.ts';
import { Button, ErrorNote, messageOf } from '../ui.tsx';

type Phase =
  | { kind: 'answer'; attempt: 1 | 2; first: string; followUp?: string }
  | { kind: 'reading' }
  | { kind: 'read'; reading: Reading; attempt: 1 | 2; first: string }
  | { kind: 'saved'; what: string };

const SERVER = 'Reading answers needs the server. Sign in to Avala OS to answer questions here; in the demo they can be read but not answered.';

/** The open questions of one process, asked one at a time. */
export function InterviewPanel({ store, process, workspace, model, working }: {
  store: JourneyStore; process: ProcessRow; workspace: Workspace; model: ProcessModel; working: { id: string; seq: number } | null;
}) {
  const canEdit = workspace.role !== 'viewer';
  const editor = useModelEditor(store, process.id, { model, working }, () => announceProcessChanged(process.id));
  const ctx = useImpactContext(store, process.id, process.workspaceId, editor.lastChange?.at);
  const queue = React.useMemo(() => interviewQueue(triage(editor.model, assessProcess(editor.model))), [editor.model]);
  const [skipped, setSkipped] = React.useState<string[]>([]);
  const [analyst, setAnalyst] = React.useState<string | null>(null);
  const [text, setText] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>({ kind: 'answer', attempt: 1, first: '' });
  const [error, setError] = React.useState<string | null>(null);
  const [recorded, setRecorded] = React.useState(0);

  React.useEffect(() => {
    let live = true;
    if (process.analystId) store.listMembers(process.workspaceId).then(ms => { if (live) setAnalyst(ms.find(m => m.userId === process.analystId)?.name ?? null); }).catch(() => {});
    return () => { live = false; };
  }, [store, process.workspaceId, process.analystId]);

  const pending = queue.filter(i => !skipped.includes(i.key));
  const item: TriageItem | null = pending[0] ?? null;
  // A new question starts clean (after Save, Skip, or the answer closing it).
  const key = item?.key ?? '';
  React.useEffect(() => { setText(''); setError(null); setPhase(p => (p.kind === 'saved' ? p : { kind: 'answer', attempt: 1, first: '' })); }, [key]);

  if (!item) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900" data-testid="interview-done">
        {queue.length === 0
          ? 'No open questions are left on this process.'
          : `No more questions for now: ${queue.length} ${queue.length === 1 ? 'was' : 'were'} skipped.`}
        {recorded > 0 && ` ${recorded} ${recorded === 1 ? 'answer was' : 'answers were'} recorded.`}
        {skipped.length > 0 && <div className="mt-2"><Button variant="secondary" onClick={() => setSkipped([])}>Go through the skipped ones</Button></div>}
      </div>
    );
  }

  const position = queue.indexOf(item) + 1;
  const skip = () => { setSkipped(s => [...s, item.key]); setPhase({ kind: 'answer', attempt: 1, first: '' }); };

  const read = async (attempt: 1 | 2, first: string) => {
    const said = attempt === 1 ? interviewAnswer(text) : interviewAnswer(first, text);
    if (said.length < 2) { setError('Write an answer first.'); return; }
    setError(null);
    setPhase({ kind: 'reading' });
    try {
      const { segments, ids } = interviewSegments(editor.model, item, said);
      const r = await store.runAiTask(process.workspaceId, answerFromNotes.id, segments as never);
      const findings = ((r.data as { answers?: NoteFinding[] } | null)?.answers ?? []);
      const reading = readInterview(editor.model, item, ids, findings, attempt, said);
      // No value in the first answer: the one follow-up, straight into the answer box.
      if (reading.kind === 'followUp') { setText(''); setPhase({ kind: 'answer', attempt: 2, first: said, followUp: reading.question }); }
      else setPhase({ kind: 'read', reading, attempt, first: said });
    } catch (x) {
      setError(x instanceof StoreError && x.status === 501 ? SERVER : messageOf(x));
      setPhase({ kind: 'answer', attempt, first });
    }
  };

  const save = async (reading: Extract<Reading, { kind: 'record' | 'confirm' }>) => {
    const edit = interviewEdit(editor.model, item, reading.proposal);
    if (!edit) { setError('This answer cannot be recorded for this question.'); return; }
    if (await editor.apply(edit.op, edit.summary)) {
      setRecorded(n => n + 1);
      setPhase({ kind: 'saved', what: reading.proposal.display });
    }
  };

  return (
    <section aria-label="Open questions" data-testid="interview">
      {phase.kind === 'saved' && <p role="status" className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900" data-testid="interview-saved">Recorded: {phase.what}</p>}
      <p className="text-xs font-medium text-slate-500">{questionHeading(item, position, queue.length)}</p>
      <h3 className="mt-1 font-display text-lg font-semibold leading-7 text-slate-900" data-testid="interview-question">{item.question}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-600">{whyItMatters(item)}</p>
      <ErrorNote message={error ?? editor.error} />

      {!canEdit && (
        <div className="mt-4 space-y-3">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200" data-testid="interview-who">{whoCanAnswer(item, analyst)}</p>
          <Button variant="secondary" onClick={skip}>Next question</Button>
        </div>
      )}

      {canEdit && (phase.kind === 'answer' || phase.kind === 'saved') && (
        <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); read(phase.kind === 'answer' ? phase.attempt : 1, phase.kind === 'answer' ? phase.first : ''); }}>
          {phase.kind === 'answer' && phase.followUp && <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-950 ring-1 ring-inset ring-amber-200" data-testid="interview-follow-up">{phase.followUp}</p>}
          <label htmlFor="interview-answer" className="block text-sm font-medium text-slate-700">Your answer, in your own words</label>
          <textarea id="interview-answer" rows={3} value={text} maxLength={INTERVIEW_LIMITS.answer} onChange={e => setText(e.target.value)}
            className="block w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm leading-6 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20" />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="accent">Read my answer</Button>
            <Button type="button" variant="ghost" onClick={skip}>Skip</Button>
          </div>
          <p className="text-xs text-slate-500">Nothing is recorded until you press Save.</p>
        </form>
      )}

      {canEdit && phase.kind === 'reading' && <p className="mt-4 text-sm text-slate-500" role="status">Reading your answer…</p>}

      {canEdit && phase.kind === 'read' && (phase.reading.kind === 'record' || phase.reading.kind === 'confirm') && (() => {
        const reading = phase.reading;
        const edit = interviewEdit(editor.model, item, reading.proposal);
        const impact = edit ? previewImpact(ctx, editor.model, edit.op) : null;
        return reading.kind === 'confirm' ? (
          <div className="mt-4 space-y-3 rounded-xl border border-amber-200 bg-amber-50/60 p-4" data-testid="interview-confirm">
            <p className="text-sm font-semibold text-slate-900">{reading.question}</p>
            <p className="text-sm leading-6 text-slate-600">From your words: “{reading.proposal.quote}”</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => setPhase({ kind: 'read', reading: { kind: 'record', proposal: reading.proposal }, attempt: phase.attempt, first: phase.first })}>Yes</Button>
              <Button variant="secondary" onClick={() => {
                setText('');
                setPhase(phase.attempt === 1
                  ? { kind: 'answer', attempt: 2, first: phase.first, followUp: followUpFor(item, editor.model) }
                  : { kind: 'read', reading: { kind: 'unanswered', message: UNANSWERED }, attempt: 2, first: phase.first });
              }}>No</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-card" data-testid="interview-record">
            <p className="border-l-[3px] border-[#E69F00] pl-3 text-[15px] font-semibold leading-7 text-slate-900">{willRecord(reading.proposal)}</p>
            <p className="text-sm leading-6 text-slate-600">Your words: “{reading.proposal.quote}”</p>
            {impact && <p className="text-sm leading-6 text-slate-600" data-testid="interview-impact">What it changes: {impactSummary(impact)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => save(reading)} disabled={editor.saving}>{editor.saving ? 'Saving…' : 'Save'}</Button>
              <Button variant="secondary" onClick={() => { setText(phase.first); setPhase({ kind: 'answer', attempt: 1, first: '' }); }}>Change my answer</Button>
              <Button variant="ghost" onClick={skip}>Skip</Button>
            </div>
          </div>
        );
      })()}

      {canEdit && phase.kind === 'read' && phase.reading.kind === 'unanswered' && (
        <div className="mt-4 space-y-3" data-testid="interview-unanswered">
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700 ring-1 ring-inset ring-slate-200">{phase.reading.message}</p>
          <Button variant="secondary" onClick={skip}>Next question</Button>
        </div>
      )}
    </section>
  );
}

