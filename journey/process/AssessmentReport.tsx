// The assessment report: the final outcome as one document, for reading, printing or saving as PDF.
// Everything in it is derived from the scoring; nothing is typed in here.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { orderedSteps } from '../../domain/processModel/selectors.ts';
import { APPROACH_LABEL, CAPS, COMPLEXITY_PENALTY, FIT, HUMAN_FLOOR, WEIGHTS, type Approach, type StepScore } from '../../domain/assess/scoring.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import { effectiveApproach, type Decisions } from '../../domain/assess/decisions.ts';
import { Button, cx } from '../ui.tsx';
import { EASE_BANDS, EASE_WEIGHTS, PRIORITY, QUADRANT } from '../../domain/assess/priority.ts';
import { EASE_LABEL, orList, people as asPeople, valueText } from './AssessmentPriority.tsx';
import { APPROACH_TONE, CONFIDENCE_LABEL, HUMAN_LABEL, RANK_LABEL, ScoreBar, pct, range, stepLabel } from './assessmentShared.tsx';

const FACTOR_LABEL: Record<string, string> = {
  rules: 'Clear, complete rules', input: 'Structured input', screens: 'Work done on stable screens', noJudgment: 'No judgment needed', interface: 'A confirmed API for the work',
  needsReading: 'Documents or free text to read', rulesGap: 'No complete rules to follow', reviewable: 'Output a person can review',
  ambiguity: 'Path cannot be fixed in advance', adaptive: 'Next step depends on findings', toolChoice: 'Choice of tools needed', value: 'Adds value over rules and a person', controllable: 'Can be bounded and reversed',
  judgment: 'Judgment or accountable decision', physical: 'Physical action', inputNotReady: 'Input not ready for a machine',
};

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #assessment-report, #assessment-report * { visibility: visible !important; }
  #assessment-report { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; border: 0; box-shadow: none; }
  #assessment-report .no-print { display: none !important; }
  #assessment-report section, #assessment-report tr { break-inside: avoid; }
  @page { margin: 16mm; }
}`;

function H({ n, children }: { n: number; children: React.ReactNode }) {
  return <h2 className="mt-10 flex items-baseline gap-3 border-b border-slate-200 pb-2 font-display text-lg font-semibold text-slate-900"><span className="text-sm tabular-nums text-[#B58500]">{n}</span>{children}</h2>;
}
const th = 'border-b border-slate-300 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500';
const td = 'border-b border-slate-100 px-3 py-2 align-top text-sm text-slate-800';

export function AssessmentReport({ model, result, decisions, onBack }: { model: ProcessModel; result: ProcessAssessment; decisions: Decisions; onBack: () => void }) {
  const steps = orderedSteps(model);
  const byStep = new Map<string, StepScore>(result.steps.map(s => [s.stepId, s] as [string, StepScore]));
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const overrides = Object.values(decisions.overrides).filter(o => byStep.has(o.stepId));
  const people = result.steps.filter(s => !s.alreadyAutomated && (s.winner === 'human' || s.human !== 'none'));
  const nameOf = (id: string) => model.steps.find(s => s.id === id)?.name ?? id;
  const fired = result.cautions.filter(c => c.fired);
  const pr = result.priority;

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>← Back to the assessment</Button>
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
      </div>

      <article id="assessment-report" data-testid="assessment-report" className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm sm:px-14">
        <header className="border-b-4 border-[#002C4B] pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#B58500]">Automation assessment</p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-slate-900">{model.meta.name}</h1>
          <p className="mt-2 text-sm text-slate-500">{today}{model.meta.owner.value ? ` · Process owner: ${model.meta.owner.value}` : ''}</p>
        </header>

        <section>
          <H n={1}>Recommendation</H>
          <p className="mt-4 font-display text-2xl font-semibold text-[#002C4B]">{result.verdict}</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">{result.split}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            {[[`${Math.round(result.automationFit * 100)}%`, 'of steps fit automation'], [String(result.aiSteps), result.aiSteps === 1 ? 'step needs AI' : 'steps need AI'], [CONFIDENCE_LABEL[result.confidence], `confidence (${Math.round(result.knownShare * 100)}% of the facts are known)`]].map(([v, l]) => (
              <div key={l} className="rounded-xl border border-slate-200 p-3"><dd className="font-display text-xl font-semibold text-slate-900">{v}</dd><dt className="text-xs text-slate-500">{l}</dt></div>
            ))}
          </dl>
          {fired.map(c => <p key={c.id} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">{c.label}.</span> {c.reason}</p>)}
        </section>

        <section>
          <H n={2}>Ranking of the approaches</H>
          <table className="mt-4 w-full border-collapse">
            <thead><tr>{['Rank', 'Approach', 'Score', 'Best for', 'Why it ranks here'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {result.ranking.map((r, i) => (
                <tr key={r.approach}>
                  <td className={cx(td, 'whitespace-nowrap font-semibold')}>{RANK_LABEL[i]}</td>
                  <td className={cx(td, 'whitespace-nowrap')}><span className={cx('mr-2 inline-block h-2 w-2 rounded-full', APPROACH_TONE[r.approach].dot)} aria-hidden />{APPROACH_LABEL[r.approach]}</td>
                  <td className={cx(td, 'w-28')}><span className="font-semibold tabular-nums">{r.score}</span><span className="text-xs text-slate-400"> / 100</span><ScoreBar score={r.score} approach={r.approach} className="mt-1" /></td>
                  <td className={cx(td, 'whitespace-nowrap tabular-nums')}>{r.stepsWon} of {result.assessed}</td>
                  <td className={cx(td, 'text-xs leading-5 text-slate-600')}>{r.why}{r.toWin ? ` ${r.toWin}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section data-testid="report-priority">
          <H n={3}>Readiness, effort and value</H>
          <table className="mt-4 w-full border-collapse">
            <tbody>
              <tr><td className={cx(td, 'w-48 font-semibold')}>Readiness</td><td className={td}>{pr.readiness.label}. {pr.readiness.reasons.join(' ')}{pr.readiness.open.length ? ` Not confirmed yet: ${pr.readiness.open.join(' ')}` : ''}</td></tr>
              <tr><td className={cx(td, 'font-semibold')}>Ease of implementation</td><td className={td}>{pr.ease ? `${pr.ease.score} out of 100 (${EASE_LABEL[pr.ease.band]}${pr.ease.range[0] !== pr.ease.range[1] ? `; between ${pr.ease.range[0]} and ${pr.ease.range[1]} depending on facts not yet known` : ''}). ${[...pr.ease.factors].sort((a, b) => a.value - b.value).slice(0, 2).map(f => f.text).join(' ')} ${pr.ease.multipliers.map(m => m.text).join(' ')}` : 'Not scored: no step is recommended for automation.'}</td></tr>
              <tr><td className={cx(td, 'font-semibold')}>Value</td><td className={td}>{pr.value.computable ? `${valueText(pr.value.value!)} hands-on hours a year, ${pr.value.value!.exact ? 'about' : 'at most'} ${asPeople(pr.value.value!.fte)} full-time people at ${PRIORITY.hoursPerFte.toLocaleString('en')} hours a year.${pr.value.value!.exact ? '' : ' This is an upper bound: step times and shares would turn it into a calculated range.'}` : `Not known yet. ${pr.value.reason}`}</td></tr>
              <tr><td className={cx(td, 'font-semibold')}>Priority</td><td className={td}>{pr.placement.placed ? `${QUADRANT[pr.placement.quadrant!].label}. ${QUADRANT[pr.placement.quadrant!].text}` : `Not placed yet${pr.placement.possible.length > 0 && pr.placement.possible.length < 4 ? `: ${orList(pr.placement.possible.map(q => QUADRANT[q].label))}` : ''}. ${pr.placement.reason}`}</td></tr>
              {pr.standardPath.computable && <tr><td className={cx(td, 'font-semibold')}>Standard path</td><td className={td}>{pr.standardPath.value!.text}</td></tr>}
              {pr.focus.computable && <tr><td className={cx(td, 'font-semibold')}>Where to start</td><td className={td}>{pr.focus.value!.stepIds.length} of the {pr.focus.value!.of} steps to automate carry {Math.round(pr.focus.value!.share * 100)}% of the time automation could take: {pr.focus.value!.stepIds.map(nameOf).join(', ')}.</td></tr>}
            </tbody>
          </table>
          <p className="mt-2 text-xs leading-5 text-slate-500">Ease of implementation is a weighted sum (process stable {EASE_WEIGHTS.processStability}, applications stable {EASE_WEIGHTS.systemStability}, structured input {EASE_WEIGHTS.input}, few exception paths {EASE_WEIGHTS.variability}, few steps {EASE_WEIGHTS.length}, few applications {EASE_WEIGHTS.applications}), reduced for paper or scans, remote desktops and AI steps. {EASE_BANDS.easy} or more is easy, below {EASE_BANDS.medium} is difficult. Priority compares value (line at {PRIORITY.valueHoursPerYear.toLocaleString('en')} hours a year) with ease (line at {PRIORITY.ease}).</p>
        </section>

        <section>
          <H n={4}>Why this approach is proposed</H>
          {result.narrative.map(p => (
            <div key={p.title} className="mt-4">
              <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-700">{p.text}</p>
            </div>
          ))}
        </section>

        <section>
          <H n={5}>Step by step</H>
          <table className="mt-4 w-full border-collapse">
            <thead><tr>{['#', 'Step', 'Recommendation', 'Score', 'Next best', 'Person', 'Reason'].map(h => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {steps.map((s, i) => {
                const r = byStep.get(s.id)!;
                const eff = effectiveApproach(r, decisions);
                const top = r.scores.find(x => x.approach === eff.approach);
                const next = r.scores.find(x => x.approach !== eff.approach && x.approach !== 'human');
                return (
                  <tr key={s.id}>
                    <td className={cx(td, 'tabular-nums text-slate-400')}>{i + 1}</td>
                    <td className={cx(td, 'font-medium')}>{s.name}</td>
                    <td className={td}>{stepLabel(r, eff.approach)}{eff.override ? ' (overridden)' : ''}</td>
                    <td className={cx(td, 'tabular-nums')}>{top ? top.score : ''}</td>
                    <td className={cx(td, 'text-xs text-slate-600')}>{next && !r.alreadyAutomated ? `${APPROACH_LABEL[next.approach]} ${next.score}` : ''}</td>
                    <td className={cx(td, 'text-xs')}>{r.alreadyAutomated ? '' : HUMAN_LABEL[eff.override && eff.approach === 'human' ? 'does_it' : r.human]}</td>
                    <td className={cx(td, 'text-xs leading-5 text-slate-600')}>{eff.override ? `${eff.override.rationale} (${eff.override.by})` : r.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section>
          <H n={6}>People in the automated process</H>
          {people.length === 0 ? <p className="mt-4 text-sm text-slate-700">No step needs a person on what is known.</p> : (
            <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
              {people.map(s => <li key={s.stepId}><span className="font-medium text-slate-900">{nameOf(s.stepId)}:</span> a person {{ none: '', review: 'reviews the AI output', approve: 'approves before it takes effect', decide: 'makes the decision', does_it: s.forNow ? 'does it for now, until more is known' : 'does the work' }[s.human]}.</li>)}
            </ul>
          )}
          {overrides.length > 0 && <p className="mt-3 text-xs text-slate-500">{overrides.length} recommendation{overrides.length === 1 ? ' was' : 's were'} overridden by a person; the step table shows the override and its rationale.</p>}
        </section>

        <section>
          <H n={7}>Benefit</H>
          <table className="mt-4 w-full border-collapse">
            <tbody>
              <tr><td className={td}>Effort that could be automated</td><td className={td}>{result.potential.computable ? pct(result.potential.value!) : `Not computed. ${result.potential.reason}`}</td></tr>
              <tr><td className={td}>Hands-on hours a year</td><td className={td}>{result.hours.computable ? `${range(result.hours.value!.automatable)} could be automated, of ${range(result.hours.value!.today)} today` : `Not computed. ${result.hours.reason}`}</td></tr>
              <tr><td className={td}>Value of those hours</td><td className={td}>{result.money.computable ? `${result.money.value!.currency} ${range(result.money.value!.automatable)} a year. ${result.money.note ?? ''}` : `Not computed. ${result.money.reason}`}</td></tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Figures come only from volume and effort stated in the sources and a cost rate entered by a person. Build cost is not estimated.</p>
        </section>

        <section>
          <H n={8}>Open points</H>
          {result.keyQuestions.length === 0 && result.questions.length === 0 ? <p className="mt-4 text-sm text-slate-700">Every fact the scores rest on is known.</p> : (
            <>
              {result.keyQuestions.length > 0 && <>
                <p className="mt-4 text-sm text-slate-700">Facts that are still open and affect the most steps:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{result.keyQuestions.map(q => <li key={q.key}>{q.question} ({q.steps} {q.steps === 1 ? 'step' : 'steps'})</li>)}</ul>
              </>}
              {result.questions.length > 0 && <>
                <p className="mt-4 text-sm text-slate-700">Interfaces to confirm with the system owners:</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">{result.questions.map(q => <li key={q.question}>{q.question}</li>)}</ul>
              </>}
            </>
          )}
        </section>

        <section>
          <H n={9}>How the scores are calculated</H>
          <p className="mt-4 text-sm leading-6 text-slate-700">
            Each step a person does today is scored from 0 to 100 for every approach. A score is the sum of the weighted factors below, read from the facts recorded for the step.
            A fact that is not known gets a middle value and lowers confidence. Some facts limit a score: a step that needs judgment or a physical action stays with a person (at least {HUMAN_FLOOR});
            paper or unstructured input limits RPA and API to {CAPS.inputMustBeRead}; an API that is not confirmed limits integration to {CAPS.apiNotConfirmed}; an agent needs all five of its conditions.
            AI-assisted automation carries a fixed penalty of {COMPLEXITY_PENALTY.ai_assist} points and agentic AI {COMPLEXITY_PENALTY.agent}, for cost, risk and governance, so they are proposed only where simpler automation cannot do the work.
            An approach is recommended for a step from {FIT.possible} points and is a strong fit from {FIT.strong}. The process score of an approach is its average across the steps open to automation, that is, those that do not need a person's judgment or hands. No AI takes part in the scoring: the same facts always give the same result.
          </p>
          <table className="mt-4 w-full border-collapse">
            <thead><tr><th className={th}>Approach</th><th className={th}>Factors and their weights</th></tr></thead>
            <tbody>
              {(Object.keys(WEIGHTS) as Approach[]).map(a => (
                <tr key={a}><td className={cx(td, 'whitespace-nowrap font-medium')}>{APPROACH_LABEL[a]}</td><td className={cx(td, 'text-xs text-slate-600')}>{Object.entries(WEIGHTS[a]).map(([k, w]) => `${FACTOR_LABEL[k] ?? k} ${w}`).join(' · ')}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </article>
    </div>
  );
}
