// "Why this approach", shown so it can be taken in at a glance: one sentence, how the steps split,
// and five short cards with numbers and step names. The same content in full sentences is in the
// assessment report.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { APPROACH_LABEL, lower, type Approach } from '../../domain/assess/scoring.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import { Button, cx } from '../ui.tsx';
import { APPROACH_TONE, CONFIDENCE_LABEL } from './assessmentShared.tsx';

const SPLIT_ORDER: Approach[] = ['rpa', 'api', 'ai_assist', 'agent', 'human'];
const SPLIT_LABEL: Record<Approach, string> = { ...APPROACH_LABEL, human: 'Stay with people' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ICONS = {
  check: 'M5 13l4 4L19 7',
  swap: 'M7 7h11m0 0l-3-3m3 3l-3 3M17 17H6m0 0l3 3m-3-3l3-3',
  spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6.3 6.3l2.8 2.8m5.8 5.8l2.8 2.8m0-11.4l-2.8 2.8m-5.8 5.8l-2.8 2.8',
  person: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-7 9a7 7 0 0114 0',
  gauge: 'M4 16a8 8 0 1116 0M12 16l4-5',
};
function Icon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cx('h-4 w-4', className)}><path d={ICONS[name]} /></svg>;
}

function Card({ icon, tone, title, children, testid }: { icon: keyof typeof ICONS; tone: string; title: string; children: React.ReactNode; testid: string }) {
  return (
    <div data-testid={testid} className="flex h-full flex-col bg-white p-5">
      <div className="flex items-center gap-2.5">
        <span className={cx('flex h-8 w-8 items-center justify-center rounded-lg', tone)}><Icon name={icon} /></span>
        <h4 className="font-display text-sm font-semibold text-slate-900">{title}</h4>
      </div>
      <div className="mt-4 flex-1">{children}</div>
    </div>
  );
}

function Big({ value, of, label }: { value: React.ReactNode; of?: number; label: string }) {
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-display text-3xl font-semibold tabular-nums text-slate-900">{value}</span>{' '}
      <span className="text-sm text-slate-500">{of !== undefined ? `of ${of} ` : ''}{label}</span>
    </p>
  );
}

function StepChips({ ids, model, onOpen, max = 5 }: { ids: string[]; model: ProcessModel; onOpen: (id: string) => void; max?: number }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? ids : ids.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map(id => (
        <button key={id} type="button" onClick={() => onOpen(id)} title="Open this step"
          className="max-w-full truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-[#002C4B] hover:bg-white hover:text-[#002C4B]">
          {model.steps.find(s => s.id === id)?.name ?? id}
        </button>
      ))}
      {ids.length > max && <button type="button" onClick={() => setAll(!all)} className="rounded-full px-2 py-1 text-xs font-medium text-[#002C4B] hover:underline">{all ? 'Show fewer' : `+${ids.length - max} more`}</button>}
    </div>
  );
}

export function AssessmentWhy({ model, result, onOpenStep, canEdit, aiAvailable, reading, onRead, newApiQuestions, onAddQuestions }: {
  model: ProcessModel; result: ProcessAssessment; onOpenStep: (id: string) => void;
  canEdit: boolean; aiAvailable: boolean; reading: string | null; onRead: () => void; newApiQuestions: number; onAddQuestions: () => void;
}) {
  const lead = result.lead;
  const n = result.assessed;
  const split = SPLIT_ORDER.map(a => ({ approach: a, count: result.counts[a] })).filter(x => x.count > 0);
  const people = result.mustStayStepIds.length + result.forNowStepIds.length;
  const known = Math.round(result.knownShare * 100);
  const tone = lead ? APPROACH_TONE[lead] : APPROACH_TONE.human;

  return (
    <section aria-label="Why this approach" className="space-y-4">
      <div>
        <h3 className="font-display text-base font-semibold text-slate-900">Why this approach</h3>
        <p className="mt-1 max-w-3xl text-[15px] leading-6 text-slate-700" data-testid="takeaway">{result.takeaway}</p>
      </div>

      {/* How the steps split */}
      <div className="rounded-xl border border-slate-200 bg-white p-5" data-testid="step-split">
        <div className="flex items-baseline justify-between gap-3">
          <h4 className="font-display text-sm font-semibold text-slate-900">How the {n} steps split</h4>
          {result.alreadyAutomated > 0 && <p className="text-xs text-slate-500">{result.alreadyAutomated} more {result.alreadyAutomated === 1 ? 'is' : 'are'} already done by a system</p>}
        </div>
        <div className="mt-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={split.map(x => `${SPLIT_LABEL[x.approach]}: ${x.count}`).join(', ')}>
          {split.map(x => <div key={x.approach} className={cx('h-full first:rounded-l-full last:rounded-r-full', APPROACH_TONE[x.approach].bar)} style={{ width: `${(x.count / n) * 100}%` }} />)}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          {split.map(x => (
            <li key={x.approach} className="flex items-center gap-2 text-sm text-slate-700">
              <span className={cx('h-2.5 w-2.5 rounded-full', APPROACH_TONE[x.approach].dot)} aria-hidden />
              <span className="font-semibold tabular-nums text-slate-900">{x.count}</span> {SPLIT_LABEL[x.approach]}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 md:grid-cols-2 xl:grid-cols-3">
        <Card testid="why-drivers" icon="check" tone={cx(tone.chip, 'ring-1 ring-inset')} title={lead ? `What makes ${APPROACH_LABEL[lead]} the best fit` : 'Why nothing is recommended yet'}>
          {lead && result.drivers.length > 0 ? (
            <ul className="space-y-2.5">
              {result.drivers.map(d => (
                <li key={d.text} className="flex items-start justify-between gap-3 text-sm text-slate-700">
                  <span className="flex items-start gap-2"><Icon name="check" className="mt-0.5 shrink-0 text-emerald-600" />{d.text}</span>
                  <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{d.steps} {d.steps === 1 ? 'step' : 'steps'}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm leading-6 text-slate-600">{lead ? 'It scores highest on what is known, but few facts are confirmed yet.' : `No approach reaches 50 out of 100 on any step. The closest is ${APPROACH_LABEL[result.ranking[0].approach]}.`}</p>
          )}
        </Card>

        <Card testid="why-switch" icon="swap" tone="bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200" title="What would change the ranking">
          {result.apiSwitch.steps > 0 ? (
            <>
              <Big value={result.apiSwitch.steps} label={`${result.apiSwitch.steps === 1 ? 'step moves' : 'steps move'} to API integration`} />
              <p className="mt-2 text-sm text-slate-600">if an API is confirmed for:</p>
              <div className="mt-2 flex flex-wrap gap-1.5">{result.apiSwitch.systems.map(s => <span key={s} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-900 ring-1 ring-inset ring-emerald-200">{s}</span>)}</div>
            </>
          ) : (
            <p className="text-sm leading-6 text-slate-600">No open fact about an API would move a step. The order changes only if the facts about the steps change.</p>
          )}
        </Card>

        <Card testid="why-ai" icon="spark" tone="bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200" title="Where AI is needed">
          <Big value={result.aiSteps} of={n} label={result.aiSteps === 1 ? 'step' : 'steps'} />
          {result.aiSteps === 0 ? (
            <p className="mt-2 text-sm leading-6 text-slate-600">Rules on structured data do the work. AI would add cost and risk without doing more.</p>
          ) : (
            <>
              <p className="mb-2 mt-2 text-sm text-slate-600">Documents or free text have to be read; a person reviews the output.</p>
              <StepChips ids={result.aiStepIds} model={model} onOpen={onOpenStep} />
            </>
          )}
        </Card>

        <Card testid="why-people" icon="person" tone="bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200" title="What stays with people">
          <Big value={people} of={n} label={people === 1 ? 'step' : 'steps'} />
          {people === 0 && <p className="mt-2 text-sm text-slate-600">No step needs a person on what is known.</p>}
          {result.mustStayStepIds.length > 0 && <>
            <p className="mb-2 mt-3 text-xs font-semibold text-slate-500">Judgment, accountability or physical work</p>
            <StepChips ids={result.mustStayStepIds} model={model} onOpen={onOpenStep} max={4} />
          </>}
          {result.forNowStepIds.length > 0 && <>
            <p className="mb-2 mt-3 text-xs font-semibold text-slate-500">Only until more is known</p>
            <StepChips ids={result.forNowStepIds} model={model} onOpen={onOpenStep} max={3} />
          </>}
          {result.approvalStepIds.length > 0 && <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600"><span className="font-semibold text-slate-900">{result.approvalStepIds.length}</span> automated {result.approvalStepIds.length === 1 ? 'step keeps' : 'steps keep'} a person's approval (money or irreversible changes).</p>}
        </Card>

        <div className="md:col-span-2 xl:col-span-2">
          <Card testid="why-firm" icon="gauge" tone="bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200" title="How firm this is">
            <div className="grid gap-6 sm:grid-cols-[minmax(0,14rem)_1fr]">
              <div>
                <Big value={`${known}%`} label="of the facts are known" />
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200/70" role="img" aria-label={`${known}% of the facts are known`}>
                  <div className={cx('h-full rounded-full', result.confidence === 'high' ? 'bg-emerald-600' : result.confidence === 'medium' ? 'bg-amber-500' : 'bg-slate-400')} style={{ width: `${known}%` }} />
                </div>
                <p className="mt-2 text-sm text-slate-600">Confidence: <span className="font-semibold text-slate-900">{CONFIDENCE_LABEL[result.confidence]}</span></p>
                <p className="mt-2 text-xs leading-5 text-slate-500">Scores come from fixed weights: the same facts always give the same result.</p>
              </div>
              <div>
                {result.keyQuestions.length === 0 ? <p className="text-sm text-emerald-800">Every fact the scores rest on is known.</p> : (
                  <>
                    <p className="text-xs font-semibold text-slate-500">Answers that would firm it up most</p>
                    <ul className="mt-2 divide-y divide-slate-100">
                      {result.keyQuestions.slice(0, 5).map(q => (
                        <li key={q.key} className="flex items-start justify-between gap-3 py-1.5 text-sm">
                          <span className="text-slate-700">{cap(lower(q.question))}</span>
                          <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-600">{q.steps} {q.steps === 1 ? 'step' : 'steps'}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {canEdit && (aiAvailable || newApiQuestions > 0) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {aiAvailable && <Button variant="secondary" disabled={Boolean(reading && reading.endsWith('…'))} onClick={onRead}>Read these facts from the sources</Button>}
                    {newApiQuestions > 0 && <Button variant="secondary" onClick={onAddQuestions}>Add {newApiQuestions} API question{newApiQuestions === 1 ? '' : 's'} to open questions</Button>}
                  </div>
                )}
                {aiAvailable && canEdit && <p className="mt-2 text-xs text-slate-500">AI only collects facts with their quotes for you to check; it does not score or recommend.</p>}
                {reading && <p role="status" className="mt-2 text-sm text-slate-700">{reading}</p>}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
