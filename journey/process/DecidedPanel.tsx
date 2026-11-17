// The approach decided for the whole process (docs/next-plan.md, package 9), at the top of Documents: one
// line with the approach, who decided, what it can do and what stays with people; behind it, which steps
// and why. A step not known yet names the questions that would settle it and takes the answer here; a
// step that stays with people can be set by a person themselves, here, with a reason. No dead end.
import React from 'react';
import type { AccessStatus, ProcessModel } from '../../domain/processModel/types.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import { APPROACH_LABEL, MODEL_VERSION, type Approach, type DecidedQuestion } from '../../domain/assess/scoring.ts';
import { decidedFallsShort, decidedLine, decidedSummary, type DecidedStep } from '../../domain/assess/decided.ts';
import { withoutOverride, type Decisions } from '../../domain/assess/decisions.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { assessmentResult } from '../../domain/assess/record.ts';
import { hashModel } from '../../domain/processModel/hash.ts';
import { setStepTrait, setSystemApi, setSystemUiStable, type TraitName } from '../../domain/processModel/patch.ts';
import type { JourneyStore } from '../store/types.ts';
import type { ModelEditor } from './useModelEditor.ts';
import { API_CHOICES, parseTrait, STEP_COLUMNS, YES_NO } from './AssessmentInputs.tsx';
import { Button, cx, messageOf } from '../ui.tsx';

const input = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
const CHOICES: Approach[] = ['rpa', 'api', 'ai_assist', 'agent'];

export function DecidedPanel({ model, assessment, names, meId, canEdit, editor, store, processId, revisionId, decisions, onDecisions, onAnswerQuestions }: {
  model: ProcessModel; assessment: ProcessAssessment; names: Record<string, string>; canEdit: boolean; editor: ModelEditor;
  /** Who sets a step: the person's id, never an email address. */
  meId: string;
  store: JourneyStore; processId: string; revisionId: string; decisions: Decisions; onDecisions: (d: Decisions) => void;
  /** Opens Closing the gaps, where the questions about an application lead the first list. */
  onAnswerQuestions?: () => void;
}) {
  const summary = React.useMemo(() => decidedSummary(model, assessment), [model, assessment]);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (!summary) return null;

  const saveDecisions = async (next: Decisions) => {
    setError(null);
    try {
      const result = assessProcess(model, { rate: next.rate, decisions: next });
      await store.saveAssessment(processId, { revisionId, modelHash: hashModel(model), rulesVersion: MODEL_VERSION, decisions: next, result: assessmentResult(result, next) });
      onDecisions(next);
    } catch (e) { setError(messageOf(e)); }
  };
  const answer = (q: DecidedQuestion, v: string) => {
    const t = q.target;
    if (t.kind === 'api') return editor.apply(m => setSystemApi(m, { systemId: t.systemId, access: (v || 'unknown') as AccessStatus }), 'API of an application, for the decided approach');
    if (t.kind === 'screens') return editor.apply(m => setSystemUiStable(m, { systemId: t.systemId, value: v === '' ? null : v === 'true' }), 'Screens of an application, for the decided approach');
    const trait = t.trait as TraitName;
    return editor.apply(m => setStepTrait(m, { stepId: t.stepId, trait, value: parseTrait(trait, v) }), 'A fact of a step, for the decided approach');
  };
  const people = summary.cannot.length + summary.unknown.length;
  const short = decidedFallsShort(summary);

  return (
    // Amber when the decided approach can do fewer than half the steps it is weighed on, so it is not missed.
    <section className={cx('rounded-xl border px-5 py-4', short ? 'border-amber-300 bg-amber-50' : 'border-[#002C4B]/15 bg-white')} aria-label="The approach decided" data-testid="decided" data-short={short ? 'yes' : 'no'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm leading-6 text-slate-800" data-testid="decided-line">{decidedLine(summary, names)}</p>
        <button type="button" className="text-sm font-semibold text-[#002C4B] hover:underline" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide the steps' : 'Which steps, and why'}</button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      {open && (
        <div className="mt-4 space-y-5 border-t border-slate-100 pt-4 text-sm" data-testid="decided-steps">
          {summary.unknown.length > 0 && (
            <Group title={`Not known yet: ${summary.unknown.length}`} note={`${summary.label} falls short on these only because facts are missing. Answer them here; a question about an application's API also leads Closing the gaps.`} testId="decided-unknown">
              {summary.unknown.map(s => (
                <li key={s.stepId} className="py-2.5">
                  <StepName s={s} />
                  <ul className="mt-1.5 space-y-1.5">
                    {s.questions.map(q => (
                      <li key={q.key} className="flex flex-wrap items-center gap-2 text-slate-700">
                        <span className="min-w-0 flex-1">{q.question}</span>
                        {canEdit && <QuestionAnswer q={q} model={model} onAnswer={v => answer(q, v)} />}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              {onAnswerQuestions && summary.questions.some(q => q.question.target.kind === 'api') && <li className="pt-2"><Button variant="secondary" onClick={onAnswerQuestions}>Answer them in Closing the gaps</Button></li>}
            </Group>
          )}
          {summary.cannot.length > 0 && (
            <Group title={`Stays with people: ${summary.cannot.length}`} note={`${summary.label} cannot do these on what is known. ${canEdit ? 'You can set a step yourself, with a reason; your choice comes first.' : 'Someone who can edit the process can set a step themselves, with a reason.'}`} testId="decided-cannot">
              {summary.cannot.map(s => <React.Fragment key={s.stepId}><PeopleStep s={s} canEdit={canEdit} onSet={(approach, rationale) => saveDecisions({ ...decisions, overrides: { ...decisions.overrides, [s.stepId]: { stepId: s.stepId, approach, rationale, by: meId, at: new Date().toISOString() } } })} /></React.Fragment>)}
            </Group>
          )}
          {summary.person.length > 0 && (
            <Group title={`Set by a person: ${summary.person.length}`} note="A person's own choice for a step comes before the decided approach." testId="decided-person">
              {summary.person.map(s => (
                <li key={s.stepId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <span><StepName s={s} /> <span className="text-slate-600">{APPROACH_LABEL[s.approach]}</span></span>
                  {canEdit && <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => saveDecisions(withoutOverride(decisions, s.stepId))}>Go back to the decided approach</button>}
                </li>
              ))}
            </Group>
          )}
          <Group title={`${summary.label} can do: ${summary.can.length}`} testId="decided-can">
            {summary.can.map(s => <li key={s.stepId} className="py-2"><StepName s={s} /></li>)}
          </Group>
          {summary.already.length > 0 && <p className="text-xs text-slate-500">{summary.already.length} {summary.already.length === 1 ? 'step is' : 'steps are'} already done by a system on its own.</p>}
          {people === 0 && summary.person.length === 0 && <p className="text-xs text-slate-500">No step stays with people.</p>}
        </div>
      )}
    </section>
  );
}

function Group({ title, note, testId, children }: { title: string; note?: string; testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId}>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {note && <p className="mt-0.5 text-xs leading-5 text-slate-600">{note}</p>}
      <ul className="mt-1 divide-y divide-slate-100">{children}</ul>
    </div>
  );
}

const StepName = ({ s }: { s: DecidedStep }) => <span className="font-medium text-slate-900"><span className="mr-1.5 tabular-nums text-slate-500">{s.no}.</span>{s.name}</span>;

function QuestionAnswer({ q, model, onAnswer }: { q: DecidedQuestion; model: ProcessModel; onAnswer: (v: string) => void }) {
  const t = q.target;
  const options = t.kind === 'api' ? API_CHOICES.map(([v, l]) => [v === 'unknown' ? '' : v, l] as [string, string])
    : t.kind === 'screens' ? YES_NO : (STEP_COLUMNS.find(c => c.trait === t.trait)?.options ?? YES_NO);
  const label = t.kind === 'api' ? `API of ${model.systems.find(s => s.id === t.systemId)?.name ?? 'the application'}` : q.question;
  return (
    <select aria-label={label} defaultValue="" className={input} onChange={e => { if (e.target.value) onAnswer(e.target.value); }}>
      <option value="">Answer…</option>
      {options.filter(([v]) => v !== '').map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function PeopleStep({ s, canEdit, onSet }: { s: DecidedStep; canEdit: boolean; onSet: (approach: Approach, rationale: string) => void }) {
  const [setting, setSetting] = React.useState(false);
  const [approach, setApproach] = React.useState<Approach>('rpa');
  const [why, setWhy] = React.useState('');
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <span className="min-w-0 flex-1"><StepName s={s} /><span className="mt-0.5 block text-xs leading-5 text-slate-600">{s.reason}</span></span>
        {canEdit && !setting && <button type="button" className="text-xs font-semibold text-[#002C4B] hover:underline" onClick={() => setSetting(true)}>Set this step yourself</button>}
      </div>
      {setting && (
        <div className={cx('mt-2 flex flex-wrap items-end gap-2')}>
          <label className="text-xs font-medium text-slate-700">Approach
            <select className={`${input} mt-0.5 block`} value={approach} onChange={e => setApproach(e.target.value as Approach)}>{CHOICES.map(a => <option key={a} value={a}>{APPROACH_LABEL[a]}</option>)}</select>
          </label>
          <label className="min-w-56 flex-1 text-xs font-medium text-slate-700">Why
            <input className={`${input} mt-0.5 block w-full`} value={why} maxLength={500} onChange={e => setWhy(e.target.value)} />
          </label>
          <Button disabled={!why.trim()} onClick={() => { onSet(approach, why.trim()); setSetting(false); }}>Save</Button>
          <Button variant="ghost" onClick={() => setSetting(false)}>Cancel</Button>
        </div>
      )}
    </li>
  );
}
