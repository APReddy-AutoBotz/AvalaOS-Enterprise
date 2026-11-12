// Readiness, ease of implementation, value and placement, at a glance. All four come from
// `domain/assess/priority.ts`; this file only shows them.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import { EASE_BANDS, PRIORITY, QUADRANT, type Quadrant, type ReadinessState } from '../../domain/assess/priority.ts';
import { cx } from '../ui.tsx';
import { range } from './assessmentShared.tsx';

const READY_TONE: Record<ReadinessState, string> = { ready: 'bg-emerald-100 text-emerald-900 ring-emerald-200', fix_first: 'bg-amber-100 text-amber-900 ring-amber-200', wait: 'bg-rose-100 text-rose-900 ring-rose-200' };
export const EASE_LABEL = { easy: 'Easy', medium: 'Medium', difficult: 'Difficult' } as const;
const EASE_TONE = { easy: 'bg-emerald-500', medium: 'bg-[#FFBC03]', difficult: 'bg-rose-500' } as const;
export const people = (fte: number) => (fte < 0.1 ? 'under 0.1' : fte.toFixed(1));

const GRID: Quadrant[][] = [['quick_win', 'major_project'], ['fill_in', 'not_now']];

function Card({ title, children, testid }: { title: string; children: React.ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      {children}
    </div>
  );
}
const NotYet = ({ reason, onInputs }: { reason: string; onInputs: () => void }) => (
  <>
    <p className="mt-2 font-display text-xl font-semibold text-slate-400">Not known yet</p>
    <p className="mt-1.5 text-sm leading-6 text-slate-600">{reason}</p>
    <button type="button" onClick={onInputs} className="mt-3 self-start text-sm font-semibold text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4 hover:decoration-[#002C4B]">Complete the inputs</button>
  </>
);

export function AssessmentPriority({ model, result, onInputs, onOpenStep }: { model: ProcessModel; result: ProcessAssessment; onInputs: () => void; onOpenStep: (id: string) => void }) {
  const p = result.priority;
  const [details, setDetails] = React.useState(false);
  const nameOf = (id: string) => model.steps.find(s => s.id === id)?.name ?? id;
  // Naming the steps to start with only helps when it is fewer than all of them.
  const showFocus = p.focus.computable && p.focus.value!.stepIds.length < p.focus.value!.of;
  const weakest = p.ease ? [...p.ease.factors].sort((a, b) => a.value - b.value).filter(f => f.value < 0.7).slice(0, 2) : [];
  return (
    <section aria-label="Priority">
      <h3 className="font-display text-base font-semibold text-slate-900">Should it start now, and how big is it?</h3>
      <p className="text-sm text-slate-500">Readiness, build effort and value, each from fixed tables, then where this process sits among other candidates.</p>
      <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Readiness" testid="readiness">
          <p className="mt-2"><span className={cx('inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ring-inset', READY_TONE[p.readiness.state])}>{p.readiness.label}</span></p>
          <ul className="mt-3 space-y-1.5 text-sm leading-6 text-slate-700">{p.readiness.reasons.map(r => <li key={r}>{r}</li>)}</ul>
          {p.readiness.open.length > 0 && (
            <div className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">
              <p className="font-semibold uppercase tracking-wider text-amber-700">Not confirmed yet</p>
              <ul className="mt-1 space-y-0.5">{p.readiness.open.map(o => <li key={o}>{o}</li>)}</ul>
            </div>
          )}
        </Card>

        <Card title="Ease of implementation" testid="ease">
          {p.ease ? (
            <>
              <p className="mt-2 flex items-baseline gap-2"><span className="font-display text-3xl font-semibold tabular-nums text-slate-900" data-testid="ease-score">{p.ease.score}</span><span className="text-sm text-slate-400">/ 100</span><span className="ml-auto rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">{EASE_LABEL[p.ease.band]}</span></p>
              <div className="relative mt-2 h-2 rounded-full bg-slate-100" aria-hidden>
                <div className={cx('h-full rounded-full', EASE_TONE[p.ease.band])} style={{ width: `${p.ease.score}%` }} />
                {[EASE_BANDS.medium, EASE_BANDS.easy].map(b => <span key={b} className="absolute top-[-3px] h-[14px] w-px bg-slate-400" style={{ left: `${b}%` }} />)}
              </div>
              <ul className="mt-3 space-y-1.5 text-sm leading-6 text-slate-700">
                {weakest.length === 0 && p.ease.multipliers.length === 0 && <li>Short, stable and structured: nothing makes this build hard.</li>}
                {weakest.map(f => <li key={f.id}>{f.text}</li>)}
                {p.ease.multipliers.map(m => <li key={m.id}>{m.text}</li>)}
              </ul>
              <button type="button" aria-expanded={details} onClick={() => setDetails(!details)} className="mt-3 self-start text-xs font-semibold text-slate-500 hover:text-slate-900">{details ? 'Hide the calculation' : 'Show the calculation'}</button>
              {details && (
                <table className="mt-2 w-full text-xs text-slate-600" data-testid="ease-breakdown">
                  <tbody>
                    {p.ease.factors.map(f => <tr key={f.id}><td className="py-0.5 pr-2">{f.label}{!f.known && <span className="text-amber-700"> (not known)</span>}</td><td className="py-0.5 text-right tabular-nums">{f.weight} × {f.value.toFixed(2)}</td><td className="w-10 py-0.5 text-right font-semibold tabular-nums text-slate-900">{Math.round(f.points * 10) / 10}</td></tr>)}
                    {p.ease.multipliers.map(m => <tr key={m.id}><td className="py-0.5 pr-2" colSpan={2}>{m.id === 'remoteDesktop' ? 'Remote desktop' : m.id === 'scannedInput' ? 'Paper or scans' : m.id === 'agentSteps' ? 'Agent steps' : 'AI steps'}</td><td className="py-0.5 text-right font-semibold tabular-nums text-slate-900">× {m.factor.toFixed(2)}</td></tr>)}
                  </tbody>
                </table>
              )}
            </>
          ) : <NotYet reason="No step is recommended for automation yet." onInputs={onInputs} />}
        </Card>

        <Card title="Value" testid="value">
          {p.value.computable ? (
            <>
              <p className="mt-2"><span className="font-display text-3xl font-semibold tabular-nums text-slate-900">{range(p.value.value!.hours)}</span><span className="text-sm text-slate-500"> hours a year</span></p>
              <p className="mt-1.5 text-sm leading-6 text-slate-700">Hands-on time automation could take, about {people(p.value.value!.fte)} full-time {p.value.value!.fte >= 0.95 && p.value.value!.fte < 1.05 ? 'person' : 'people'} at {PRIORITY.hoursPerFte.toLocaleString('en')} hours a year.</p>
              <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">{p.value.value!.high ? 'High' : 'Lower'} value: the line is {PRIORITY.valueHoursPerYear.toLocaleString('en')} hours a year.</p>
            </>
          ) : <NotYet reason={p.value.reason ?? ''} onInputs={onInputs} />}
        </Card>

        <Card title="Priority" testid="priority">
          <div className="mt-2 flex gap-4">
            <div className="grid shrink-0 grid-cols-2 gap-1" aria-hidden>
              {GRID.flat().map(q => <span key={q} className={cx('h-9 w-9 rounded-lg', p.placement.placed && p.placement.quadrant === q ? 'bg-[#002C4B] ring-2 ring-[#FFBC03]' : 'bg-slate-200')} />)}
            </div>
            <div>
              <p className={cx('font-display text-xl font-semibold', p.placement.placed ? 'text-slate-900' : 'text-slate-400')} data-testid="priority-quadrant">{p.placement.placed ? QUADRANT[p.placement.quadrant!].label : 'Not placed yet'}</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{p.placement.placed ? QUADRANT[p.placement.quadrant!].text : p.placement.reason}</p>
            </div>
          </div>
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs leading-5 text-slate-500">Value against ease. Top row: {PRIORITY.valueHoursPerYear.toLocaleString('en')} hours a year or more. Left column: ease of {PRIORITY.ease} or more.</p>
          {!p.placement.placed && <button type="button" onClick={onInputs} className="mt-2 self-start text-sm font-semibold text-[#002C4B] underline decoration-[#FFBC03] decoration-2 underline-offset-4">Complete the inputs</button>}
          {p.placement.placed && p.readiness.state !== 'ready' && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">Readiness says “{p.readiness.label}”: settle that before starting.</p>}
        </Card>
      </div>

      {(p.standardPath.computable || showFocus) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2" data-testid="where-to-start">
          {p.standardPath.computable && (
            <div className={cx('rounded-2xl border p-5', p.standardPath.value!.caution ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white')}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Start with the standard path</p>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-200" aria-hidden><div className="bg-[#002C4B]" style={{ width: `${p.standardPath.value!.share * 100}%` }} /></div>
              <p className="mt-2 text-sm leading-6 text-slate-700">{p.standardPath.value!.text}</p>
            </div>
          )}
          {showFocus && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Start with these steps</p>
              <p className="mt-2 text-sm leading-6 text-slate-700"><span className="font-semibold text-slate-900">{p.focus.value!.stepIds.length} of the {p.focus.value!.of} steps to automate</span> carry {Math.round(p.focus.value!.share * 100)}% of the time automation could take.</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">{p.focus.value!.stepIds.map(id => <li key={id}><button type="button" onClick={() => onOpenStep(id)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-200">{nameOf(id)}</button></li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
