// The delivery plan (docs/effort-first-plan.md, part B), on the Assessment stage: for this process, the
// documents the table plans and why, those one click away, what the plan rests on that nobody has said
// yet, and what the team expected against what the assessment says. Nothing here decides the approach;
// the documents wanted can be changed in the brief on the Process stage. Rules: domain/plan/delivery.ts.
import React from 'react';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import { DOC_LABEL, deliveryPlan } from '../../domain/plan/delivery.ts';
import { cx, Tag } from '../ui.tsx';

export function DeliveryPlanPanel({ model, result, firstQuestions, onBrief }: {
  model: ProcessModel; result: ProcessAssessment;
  /** How many questions only people can answer now (part D's first list). */
  firstQuestions?: number;
  onBrief?: () => void;
}) {
  const plan = React.useMemo(() => deliveryPlan(model, result), [model, result]);
  const planned = plan.docs.filter(d => d.planned);
  const offered = plan.docs.filter(d => !d.planned);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Delivery plan" data-testid="delivery-plan">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">For this process</h3>
        {onBrief && <button type="button" className="text-xs font-medium text-slate-500 hover:text-slate-900 hover:underline" onClick={onBrief}>Change in the brief</button>}
      </div>
      <p className="mt-1 text-sm leading-6 text-slate-600" data-testid="delivery-why">{plan.why}</p>
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {planned.map(d => (
          <li key={d.doc} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5" data-testid="planned-doc">
            <span className="min-w-[14rem] text-sm font-semibold text-slate-900">{d.label}</span>
            <span className="flex-1 text-sm leading-6 text-slate-600">{d.reason}</span>
          </li>
        ))}
      </ul>
      {offered.length > 0 && <p className="mt-2 text-xs text-slate-500" data-testid="offered-docs">One click away on Documents: {offered.map(d => DOC_LABEL[d.doc]).join(', ')}.</p>}
      {plan.ruleWouldPlan && <p className="mt-2 text-xs text-slate-500">The rule alone would plan: {plan.ruleWouldPlan.map(d => DOC_LABEL[d]).join(', ')}.</p>}
      {firstQuestions !== undefined && firstQuestions > 0 && <p className="mt-3 text-sm text-slate-700">First, {firstQuestions} {firstQuestions === 1 ? 'question' : 'questions'} only your people can answer (Ask Avala, Questions).</p>}
      {plan.expectation && (
        <p className={cx('mt-3 rounded-lg px-3 py-2 text-sm leading-6 ring-1 ring-inset', /^As expected/.test(plan.expectation) ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-950 ring-amber-200')} data-testid="delivery-expectation">
          {plan.expectation}
        </p>
      )}
      {plan.unknowns.length > 0 && <ul className="mt-3 list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-500" data-testid="delivery-unknowns">{plan.unknowns.map(u => <li key={u}>{u}</li>)}</ul>}
    </section>
  );
}
