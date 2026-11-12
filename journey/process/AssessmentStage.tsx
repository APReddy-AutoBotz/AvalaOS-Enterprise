// The Assessment stage: one assessment per process, computed from the model by a fixed scoring
// model. It shows the recommended approach, the ranking of the alternatives, why, and the result
// for every step. People change it by correcting the facts it rests on, or by overriding a step
// with a rationale; both persist, and the scoring's own answer stays visible.
import React from 'react';
import type { ProcessModel, SystemRef } from '../../domain/processModel/types.ts';
import { addQuestion, setStepTrait, setSystemUiStable, type TraitName } from '../../domain/processModel/patch.ts';
import { hashModel } from '../../domain/processModel/hash.ts';
import { orderedSteps } from '../../domain/processModel/selectors.ts';
import { APPROACH_LABEL, COMPLEXITY_PENALTY, MODEL_VERSION, type Approach, type ApproachScore, type FactorScore, type StepScore } from '../../domain/assess/scoring.ts';
import { assessProcess, type ProcessAssessment } from '../../domain/assess/process.ts';
import type { AssessmentSettings } from '../../domain/assess/settings.ts';
import { decisionsToEntries, DecisionError, effectiveApproach, emptyDecisions, withCosts, withOverride, withoutOverride, withRate, type Decisions } from '../../domain/assess/decisions.ts';
import { PAYBACK_YEARS, paybackOf } from '../../domain/assess/payback.ts';
import { applyTraitFindings, batches, stepTraits, traitSegments, type TraitFinding } from '../../domain/assess/traits.ts';
import type { JourneyStore, SourceRow } from '../store/types.ts';
import { Button, cx, ErrorNote, messageOf } from '../ui.tsx';
import { useModelEditor, type ModelEditor } from './useModelEditor.ts';
import { coarsePatch } from './SourcesStage.tsx';
import { Select, SidePanel, SourceList, StatusBadge } from './widgets.tsx';
import { AssessmentReport } from './AssessmentReport.tsx';
import { AssessmentWhy } from './AssessmentWhy.tsx';
import { AssessmentInputs } from './AssessmentInputs.tsx';
import { AssessmentPriority } from './AssessmentPriority.tsx';
import { APPROACH_TONE, CONFIDENCE_LABEL, HUMAN_LABEL, RANK_LABEL, ScoreBar, pct, range, stepLabel } from './assessmentShared.tsx';

const APPROACHES = Object.keys(APPROACH_LABEL) as Approach[];

export function ApproachChip({ approach, label }: { approach: Approach; label?: string }) {
  return <span data-testid="recommendation" className={cx('inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', APPROACH_TONE[approach].chip)}>{label ?? APPROACH_LABEL[approach]}</span>;
}

function AiBadge({ s, approach }: { s: StepScore; approach: Approach }) {
  const cls = 'whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold';
  if (!s.alreadyAutomated && (approach === 'ai_assist' || approach === 'agent')) return <span data-testid="ai-badge" className={cx(cls, 'bg-violet-100 text-violet-900')}>AI needed</span>;
  if (!s.alreadyAutomated && (approach === 'rpa' || approach === 'api')) return <span data-testid="ai-badge" className={cx(cls, 'bg-emerald-100 text-emerald-900')}>AI unnecessary</span>;
  return <span data-testid="ai-badge" className={cx(cls, 'bg-slate-100 text-slate-600')}>No AI</span>;
}

export function AssessmentStage({ store, processId, workspaceId, model, working, revisionId, canEdit, me, sources, onSaved }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; working: { id: string; seq: number } | null;
  revisionId: string; canEdit: boolean; me: string; sources: SourceRow[]; onSaved: () => void;
}) {
  const editor = useModelEditor(store, processId, { model, working }, onSaved);
  const [decisions, setDecisions] = React.useState<Decisions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState<string | null>(null);
  const [view, setView] = React.useState<'assessment' | 'inputs' | 'report'>('assessment');

  const [settings, setSettings] = React.useState<AssessmentSettings | undefined>(undefined);
  React.useEffect(() => { store.getAssessmentDecisions(processId).then(setDecisions).catch(e => setError(messageOf(e))); }, [store, processId]);
  React.useEffect(() => { store.getSettings(workspaceId).then(r => setSettings(r.settings)).catch(e => setError(messageOf(e))); }, [store, workspaceId]);

  const result = React.useMemo(() => assessProcess(editor.model, { rate: decisions?.rate ?? null, settings }), [editor.model, decisions?.rate, settings]);
  const d = decisions ?? emptyDecisions();

  const save = async (next: Decisions) => {
    setError(null);
    const prev = decisions;
    setDecisions(next);
    try {
      await store.saveAssessment(processId, {
        revisionId: working?.id ?? revisionId, modelHash: hashModel(editor.model), rulesVersion: MODEL_VERSION, decisions: next,
        result: {
          verdict: result.verdict, split: result.split,
          ranking: result.ranking.map(r => ({ approach: r.approach, rank: r.rank, score: r.score, stepsWon: r.stepsWon })),
          steps: result.steps.map(s => ({ stepId: s.stepId, winner: s.winner, score: s.scores[0]?.score ?? null, human: s.human })),
          decisions: decisionsToEntries(next),
        },
      });
    } catch (e) { setDecisions(prev); setError(messageOf(e)); }
  };

  const readTraits = async () => {
    setError(null);
    try {
      const steps = orderedSteps(editor.model);
      setReading(`Reading the sources for ${steps.length} steps…`);
      const loaded = await Promise.all(sources.filter(s => !s.archived).map(async s => ({ key: s.key, segments: await store.getSourceSegments(s.id) })));
      const groups = batches(steps, 5);
      let done = 0;
      const findings: TraitFinding[] = [];
      const ingest = new Map();
      const owners = new Map<string, Set<string>>();
      await Promise.all(groups.map(async group => {
        const { segments, ingest: map, owners: own } = traitSegments(editor.model, group, loaded);
        for (const [k, v] of map) ingest.set(k, v);
        for (const [k, v] of own) owners.set(k, v);
        const r = await store.runAiTask(workspaceId, stepTraits.id, segments);
        findings.push(...(((r.data as { findings?: TraitFinding[] })?.findings) ?? []));
        done++;
        setReading(`Reading the sources: ${done} of ${groups.length} groups of steps done…`);
      }));
      const count = { n: 0 };
      await editor.apply(m => {
        const { model: next, changes } = applyTraitFindings(m, findings, ingest, { owners, replace: true });
        count.n = changes.length;
        return { model: next, patch: changes.length ? coarsePatch(m, next) : [] };
      }, 'Read assessment facts from the sources');
      setReading(count.n ? `Done: ${count.n} facts read from the sources, each with its quote.` : 'Done: the sources settle no further facts.');
    } catch (e) {
      setReading(null);
      setError(messageOf(e));
    }
  };

  const newApiQuestions = result.questions.filter(q => !editor.model.openQuestions.some(x => x.question === q.question));
  const addApiQuestions = () => editor.apply(m => {
    let cur: { model: ProcessModel; patch: ReturnType<typeof coarsePatch> } = { model: m, patch: [] };
    for (const q of newApiQuestions) {
      if (cur.model.openQuestions.some(x => x.question === q.question)) continue;
      const r = addQuestion(cur.model, { target: q.target, question: q.question, whyItMatters: q.whyItMatters });
      cur = { model: r.model, patch: [...cur.patch, ...r.patch] };
    }
    return cur;
  }, `Asked ${newApiQuestions.length} API question${newApiQuestions.length === 1 ? '' : 's'}`);

  const steps = orderedSteps(editor.model);
  const byStep = new Map<string, StepScore>(result.steps.map(r => [r.stepId, r] as [string, StepScore]));
  const current = open ? byStep.get(open) : undefined;

  if (view === 'report') return <AssessmentReport model={editor.model} result={result} decisions={d} onBack={() => setView('assessment')} />;

  const known = Math.round(result.priority.inputs.share * 100);
  const tabs = (
    <div role="tablist" aria-label="Assessment views" className="inline-flex rounded-xl bg-slate-100 p-1">
      {([['assessment', 'Result'], ['inputs', `Inputs · ${known}% known`]] as const).map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
          className={cx('rounded-lg px-4 py-1.5 text-sm font-semibold transition', view === id ? 'bg-white text-[#002C4B] shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{label}</button>
      ))}
    </div>
  );

  if (view === 'inputs') return (
    <div className="space-y-6">
      {tabs}
      <ErrorNote message={error ?? editor.error} />
      <AssessmentInputs model={editor.model} result={result} editor={editor} canEdit={canEdit} aiAvailable={store.aiAvailable} reading={reading} onRead={readTraits} />
    </div>
  );

  return (
    <div className="space-y-6">
      {tabs}
      <ErrorNote message={error ?? editor.error} />
      <Hero result={result} onReport={() => setView('report')} />
      {result.assessed > 0 && <Ranking result={result} />}
      {result.assessed > 0 && <AssessmentPriority model={editor.model} result={result} onInputs={() => setView('inputs')} onOpenStep={setOpen} />}
      {result.assessed > 0 && (
        <AssessmentWhy model={editor.model} result={result} onOpenStep={setOpen} canEdit={canEdit} aiAvailable={store.aiAvailable} reading={reading} onRead={readTraits}
          newApiQuestions={newApiQuestions.length} onAddQuestions={addApiQuestions} />
      )}
      <Benefit result={result} decisions={d} canEdit={canEdit && decisions !== null} me={me} onSave={save} />

      <section aria-label="Steps">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">Step by step</h3>
            <p className="text-sm text-slate-500">Select a step to see its scores and the facts behind them, and to correct or override.</p>
          </div>
          <span className="text-xs text-slate-500" data-testid="save-state">{editor.saving ? 'Saving…' : ''}</span>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>{['#', 'Step', 'Recommendation', 'Score', 'Next best', 'AI', 'Person', 'Confidence'].map(h => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {steps.map((s, i) => {
                const r = byStep.get(s.id)!;
                const eff = effectiveApproach(r, d);
                const top = r.scores.find(x => x.approach === eff.approach);
                const next = r.scores.find(x => x.approach !== eff.approach && x.approach !== 'human');
                return (
                  <tr key={s.id} data-testid="assessment-row" className="cursor-pointer align-top transition-colors hover:bg-slate-50" onClick={() => setOpen(s.id)}>
                    <td className="px-4 py-3 text-xs tabular-nums text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3">
                      <button type="button" className="text-left font-medium text-slate-900 hover:text-[#002C4B] hover:underline" aria-label={`Assessment of ${s.name}`}>{s.name}</button>
                      <p className="mt-0.5 max-w-md text-xs leading-5 text-slate-500">{eff.override ? eff.override.rationale : r.reason}</p>
                    </td>
                    <td className="px-4 py-3">
                      <ApproachChip approach={eff.approach} label={stepLabel(r, eff.approach)} />
                      {eff.override && <p className="mt-1 text-[11px] text-slate-500" data-testid="overridden">Overridden by {eff.override.by}</p>}
                    </td>
                    <td className="w-28 px-4 py-3">
                      {top ? <><span className="text-sm font-semibold tabular-nums text-slate-900">{top.score}</span><span className="text-xs text-slate-400"> / 100</span><ScoreBar score={top.score} approach={top.approach} className="mt-1.5" /></> : <span className="text-xs text-slate-400">Not scored</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{next && !r.alreadyAutomated ? <>{APPROACH_LABEL[next.approach]} <span className="tabular-nums text-slate-400">{next.score}</span></> : ''}</td>
                    <td className="px-4 py-3"><AiBadge s={r} approach={eff.approach} /></td>
                    <td className="px-4 py-3 text-xs text-slate-700">{HUMAN_LABEL[eff.override && eff.approach === 'human' ? 'does_it' : r.human]}</td>
                    <td className="px-4 py-3 text-xs text-slate-700">{r.alreadyAutomated ? '' : CONFIDENCE_LABEL[r.confidence]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {current && (
        <SidePanel wide title={steps.find(s => s.id === current.stepId)?.name ?? ''} onClose={() => setOpen(null)}>
          <StepDetail model={editor.model} result={current} decisions={d} canEdit={canEdit} editor={editor}
            onOverride={(approach, rationale) => { try { save(withOverride(d, current, { approach, rationale, by: me || 'you' })); return true; } catch (e) { return e instanceof DecisionError ? e.message : false; } }}
            onClearOverride={() => save(withoutOverride(d, current.stepId))} />
        </SidePanel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the process

function Hero({ result, onReport }: { result: ProcessAssessment; onReport: () => void }) {
  const fired = result.cautions.filter(c => c.fired);
  const stats: [string, string, string][] = [
    [`${Math.round(result.automationFit * 100)}%`, 'of steps fit automation', `${result.assessed - result.counts.human} of ${result.assessed}`],
    [String(result.aiSteps), result.aiSteps === 1 ? 'step needs AI' : 'steps need AI', result.aiSteps === 0 ? 'Rules do the work' : `of ${result.assessed}`],
    [CONFIDENCE_LABEL[result.confidence], 'confidence', `${Math.round(result.knownShare * 100)}% of the facts are known`],
  ];
  return (
    <section aria-label="Recommended approach" className="relative overflow-hidden rounded-3xl bg-[#002C4B] p-7 text-white shadow-lg sm:p-9">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#FFBC03]/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#FFBC03]">Recommended approach</p>
          <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-4xl" data-testid="verdict">{result.verdict}</h2>
          <p className="mt-3 text-base leading-7 text-slate-200" data-testid="split">{result.split}</p>
        </div>
        {result.assessed > 0 && <button type="button" onClick={onReport} className="rounded-xl bg-[#FFBC03] px-4 py-2.5 text-sm font-semibold text-[#002C4B] shadow-sm transition hover:bg-[#ffc933] focus:outline-none focus-visible:ring-2 focus-visible:ring-white">Open the assessment report</button>}
      </div>
      {result.assessed > 0 && (
        <dl className="relative mt-7 grid gap-3 sm:grid-cols-3">
          {stats.map(([value, label, sub]) => (
            <div key={label} className="rounded-2xl bg-white/[0.07] p-4 ring-1 ring-inset ring-white/10">
              <dd className="font-display text-2xl font-semibold">{value}</dd>
              <dt className="mt-0.5 text-sm text-slate-200">{label}</dt>
              <p className="mt-1 text-xs text-slate-400">{sub}</p>
            </div>
          ))}
        </dl>
      )}
      {fired.length > 0 && (
        <ul className="relative mt-5 space-y-2">
          {fired.map(c => <li key={c.id} className="rounded-xl bg-amber-400/15 px-4 py-2.5 text-sm text-amber-100 ring-1 ring-inset ring-amber-300/30"><span className="font-semibold">{c.label}.</span> {c.reason}</li>)}
        </ul>
      )}
    </section>
  );
}

function Ranking({ result }: { result: ProcessAssessment }) {
  return (
    <section aria-label="Ranking of approaches">
      <h3 className="font-display text-base font-semibold text-slate-900">How the approaches rank for this process</h3>
      <p className="text-sm text-slate-500">Average fit across the {result.candidates} {result.candidates === 1 ? 'step' : 'steps'} open to automation (not needing a person's judgment or hands), from fixed weights. The same facts always give the same ranking.</p>
      <ol className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {result.ranking.map((r, i) => (
          <li key={r.approach} data-testid="ranked-approach" className={cx('flex flex-col rounded-2xl border bg-white p-5 shadow-sm', i === 0 && result.lead === r.approach ? 'border-[#FFBC03] ring-2 ring-[#FFBC03]/30' : 'border-slate-200')}>
            <div className="flex items-center justify-between">
              <span className={cx('rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider', i === 0 ? 'bg-[#002C4B] text-white' : 'bg-slate-100 text-slate-600')}>{RANK_LABEL[i]}</span>
              <span className={cx('h-2.5 w-2.5 rounded-full', APPROACH_TONE[r.approach].dot)} aria-hidden />
            </div>
            <p className="mt-3 font-display text-lg font-semibold text-slate-900">{APPROACH_LABEL[r.approach]}</p>
            <p className="mt-1"><span className="font-display text-3xl font-semibold tabular-nums text-slate-900">{r.score}</span><span className="text-sm text-slate-400"> / 100</span></p>
            <ScoreBar score={r.score} approach={r.approach} className="mt-2" />
            <p className="mt-3 text-sm font-medium text-slate-800">Best for <span className="tabular-nums">{r.stepsWon}</span> {r.stepsWon === 1 ? 'step' : 'steps'}{r.stepsFit > r.stepsWon ? <span className="font-normal text-slate-500"> · could do {r.stepsFit}</span> : null}</p>
            <dl className="mt-3 space-y-2.5 border-t border-slate-100 pt-3 text-xs leading-5">
              {r.strength && <div><dt className="font-semibold uppercase tracking-wider text-emerald-700">Strongest where</dt><dd className="text-slate-600">{r.strength.text} <span className="text-slate-400">({r.strength.steps} {r.strength.steps === 1 ? 'step' : 'steps'})</span></dd></div>}
              {r.heldBack && <div><dt className="font-semibold uppercase tracking-wider text-amber-700">Held back where</dt><dd className="text-slate-600">{r.heldBack.text} <span className="text-slate-400">({r.heldBack.steps} {r.heldBack.steps === 1 ? 'step' : 'steps'})</span></dd></div>}
              {r.toWin && !(r.approach === 'api' && result.apiSwitch.steps > 0) && <div><dt className="font-semibold uppercase tracking-wider text-slate-500">Would rank higher</dt><dd className="text-slate-600">{r.toWin.replace(/^It (would rank|ranks) higher (only )?/, '').replace(/^It is justified only /, 'only ').replace(/^./, c => c.toUpperCase())}</dd></div>}
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Benefit({ result, decisions, canEdit, me, onSave }: { result: ProcessAssessment; decisions: Decisions; canEdit: boolean; me: string; onSave: (d: Decisions) => void }) {
  const text = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
  const [currency, setCurrency] = React.useState(decisions.rate?.currency ?? '');
  const [rate, setRate] = React.useState(text(decisions.rate?.amount));
  const [build, setBuild] = React.useState(text(decisions.costs?.build));
  const [running, setRunning] = React.useState(text(decisions.costs?.running));
  const [problem, setProblem] = React.useState<string | null>(null);
  React.useEffect(() => { setCurrency(decisions.rate?.currency ?? ''); setRate(text(decisions.rate?.amount)); setBuild(text(decisions.costs?.build)); setRunning(text(decisions.costs?.running)); }, [decisions.rate, decisions.costs]);
  const pb = paybackOf(result.priority.value, decisions.rate, decisions.costs);
  const v = result.priority.value;
  const cur = pb.computable ? pb.value!.currency : decisions.rate?.currency ?? '';
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString('en')}`;
  const span = (r: [number, number], exact: boolean) => (exact ? (Math.round(r[0]) === Math.round(r[1]) ? money(r[0]) : `${money(r[0])} – ${Math.round(r[1]).toLocaleString('en')}`) : `Up to ${money(r[1])}`);
  const months = (m: number) => (m < 1 ? 'under a month' : `${m.toLocaleString('en', { maximumFractionDigits: 1 })} months`);
  const tile = (label: string, body: React.ReactNode, note?: React.ReactNode, testid?: string) => (
    <div className="rounded-xl bg-slate-50 p-4" data-testid={testid}>
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1.5 text-sm leading-6 text-slate-900">{body}</dd>
      {note && <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>}
    </div>
  );
  const big = (t: string) => <span className="font-display text-2xl font-semibold">{t}</span>;
  const missing = (t: string) => <span className="text-slate-500">{t}</span>;
  const num = (t: string) => (t.trim() === '' ? null : Number(t.replace(/,/g, '')));
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setProblem(null);
    try {
      const amount = num(rate);
      let next = withRate(decisions, amount === null ? null : { amount, currency: currency.trim().toUpperCase(), enteredBy: me || 'you' });
      next = withCosts(next, { build: num(build), running: num(running), enteredBy: me || 'you' });
      onSave(next);
    } catch (err) { setProblem((err as Error).message); }
  };
  const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
  const p = pb.computable ? pb.value! : null;
  return (
    <section aria-label="Benefit" className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-display text-base font-semibold text-slate-900">Benefit and payback</h3>
      <p className="mt-1 text-sm text-slate-500">From the hours above and the figures you enter here. Nothing is assumed; where the hours are an upper bound, so is everything that follows.</p>
      <dl className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {tile('Hours a year', v.computable ? big(v.value!.exact ? range(v.value!.hours) : `Up to ${Math.round(v.value!.hours[1]).toLocaleString('en')}`) : missing(v.reason ?? ''), v.computable && !v.value!.exact ? 'An upper bound. Step times and shares would make it a calculated range.' : undefined)}
        {tile('Value a year', p ? big(span(p.value, p.exact)) : missing(pb.reason ?? ''), p ? `At ${cur} ${decisions.rate!.amount.toLocaleString('en')} an hour, entered by ${decisions.rate!.enteredBy}.` : undefined, 'benefit-value')}
        {tile('Payback', p ? (p.months.best === null ? missing(p.missing.includes('the build cost') ? 'Enter the build cost.' : 'The savings do not cover the running cost.') : big(p.months.worst === null ? `From ${months(p.months.best)}` : p.months.worst === 'never' ? `${months(p.months.best)} at best` : p.months.best === p.months.worst ? months(p.months.best) : `${months(p.months.best)} – ${months(p.months.worst)}`)) : missing('Needs the value a year and the build cost.'),
          p && p.months.worst === 'never' ? 'At the low end of the hours the savings do not cover the running cost.' : p && p.months.best !== null && p.months.worst === null ? 'The soonest it could be. The latest needs a calculated range of hours.' : undefined, 'benefit-payback')}
        {tile(`Net over ${PAYBACK_YEARS} years`, p ? big(p.exact ? span(p.net3y, true) : `Up to ${money(p.net3y[1])}`) : missing('Needs the value a year.'), p && p.missing.length ? `Without ${p.missing.join(' and ')}.` : undefined)}
      </dl>
      {canEdit && (
        <form className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-[6rem_repeat(3,minmax(0,1fr))_auto] lg:items-end" onSubmit={submit}>
          <label className="text-xs font-semibold text-slate-600">Currency<input aria-label="Currency" placeholder="INR" value={currency} onChange={e => setCurrency(e.target.value)} className={cx(input, 'mt-1 w-full uppercase')} /></label>
          <label className="text-xs font-semibold text-slate-600">Cost of an hour of this work<input aria-label="Cost per hour" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} className={cx(input, 'mt-1 w-full')} /></label>
          <label className="text-xs font-semibold text-slate-600">Build cost, once<input aria-label="Build cost" inputMode="decimal" value={build} onChange={e => setBuild(e.target.value)} className={cx(input, 'mt-1 w-full')} /></label>
          <label className="text-xs font-semibold text-slate-600">Running cost a year<input aria-label="Running cost a year" inputMode="decimal" value={running} onChange={e => setRunning(e.target.value)} placeholder="Licences, hosting, support" className={cx(input, 'mt-1 w-full')} /></label>
          <Button type="submit" variant="secondary">Save figures</Button>
          {problem && <p className="text-sm text-red-700 sm:col-span-2 lg:col-span-5">{problem}</p>}
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- one step

const yesNo = () => [{ value: '', label: 'Unknown' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }];
const TRAIT_CONTROLS: { trait: TraitName; label: string; options: { value: string; label: string }[] }[] = [
  { trait: 'rulesComplete', label: 'Rules stated in full and stable', options: yesNo() },
  { trait: 'input', label: 'Form of the input', options: [{ value: '', label: 'Unknown' }, { value: 'structured', label: 'Structured data' }, { value: 'semi_structured', label: 'Semi-structured (emails, varying forms)' }, { value: 'unstructured', label: 'Unstructured documents' }, { value: 'paper', label: 'Paper' }] },
  { trait: 'judgment', label: 'Needs a judgment or accountable decision', options: yesNo() },
  { trait: 'physical', label: 'Needs a physical action', options: yesNo() },
  { trait: 'language', label: 'Drafts, summarises or classifies free text', options: yesNo() },
  { trait: 'write', label: 'What it changes', options: [{ value: '', label: 'Unknown' }, { value: 'none', label: 'Nothing' }, { value: 'record', label: 'A record' }, { value: 'financial', label: 'Money (posts, pays, blocks)' }, { value: 'irreversible', label: 'Something that cannot be undone' }] },
  { trait: 'rework', label: 'Rework or duplicate entry', options: yesNo() },
];

function traitValue(model: ProcessModel, stepId: string, trait: TraitName): string {
  const t = model.steps.find(s => s.id === stepId)?.traits ?? {};
  const f: any = trait.startsWith('agent.') ? (t.agent as any)?.[trait.slice(6)] : (t as any)[trait];
  return f && f.status !== 'unknown' && f.value !== null ? String(f.value) : '';
}
const parse = (trait: TraitName, v: string): unknown => (v === '' ? null : ['input', 'write'].includes(trait) ? v : v === 'true');

function StepDetail({ model, result, decisions, canEdit, editor, onOverride, onClearOverride }: {
  model: ProcessModel; result: StepScore; decisions: Decisions; canEdit: boolean; editor: ModelEditor;
  onOverride: (a: Approach, rationale: string) => true | string | false; onClearOverride: () => void;
}) {
  const step = model.steps.find(s => s.id === result.stepId)!;
  const override = decisions.overrides[result.stepId];
  const [approach, setApproach] = React.useState<Approach | ''>('');
  const [rationale, setRationale] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  // The recommendation's breakdown is open until the person opens or closes one themselves.
  const [choice, setChoice] = React.useState<Approach | 'none' | null>(null);
  const expanded = choice === null ? result.scores[0]?.approach ?? null : choice === 'none' ? null : choice;
  const setExpanded = (a: Approach | null) => setChoice(a ?? 'none');
  const setTrait = (trait: TraitName, v: string) => editor.apply(m => setStepTrait(m, { stepId: step.id, trait, value: parse(trait, v) }), `Assessment fact of "${step.name}"`);
  const systems = step.systemIds.map(id => model.systems.find(s => s.id === id)).filter((s): s is SystemRef => Boolean(s));

  return (
    <div className="space-y-6" data-testid="step-assessment">
      <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          <ApproachChip approach={result.winner} label={stepLabel(result)} />
          <AiBadge s={result} approach={result.winner} />
          {!result.alreadyAutomated && <span className="text-xs text-slate-600">Person: {HUMAN_LABEL[result.human]} · Confidence: {CONFIDENCE_LABEL[result.confidence]}</span>}
        </div>
        <p className="mt-2 text-sm leading-6 text-slate-700" data-testid="step-reason">{result.reason}</p>
        {result.human === 'approve' && result.winner !== 'human' && result.winner !== 'agent' && <p className="mt-1 text-sm text-slate-700">A person approves before it takes effect, because the step moves money or cannot be undone.</p>}
      </div>

      {override && (
        <div className="rounded-2xl border border-slate-300 bg-white p-4 text-sm" data-testid="override-note">
          <p><span className="font-semibold">Overridden by {override.by}:</span> {APPROACH_LABEL[override.approach]}. {override.rationale}</p>
          <p className="mt-1 text-xs text-slate-500">The scoring recommends {stepLabel(result)}.</p>
          {canEdit && <Button variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={onClearOverride}>Remove override</Button>}
        </div>
      )}

      {result.scores.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Scores for this step</h3>
          <ul className="mt-2 space-y-2">
            {result.scores.map((a, i) => (
              <li key={a.approach} className="rounded-xl bg-white ring-1 ring-slate-200" data-testid="approach-score">
                <button type="button" aria-expanded={expanded === a.approach} onClick={() => setExpanded(expanded === a.approach ? null : a.approach)} className="flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="w-5 text-xs font-semibold tabular-nums text-slate-400">{i + 1}</span>
                  <span className="w-44 text-sm font-medium text-slate-900">{APPROACH_LABEL[a.approach]}</span>
                  <ScoreBar score={a.score} approach={a.approach} className="flex-1" />
                  <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-900">{a.score}</span>
                  <span aria-hidden className="text-slate-400">{expanded === a.approach ? '−' : '+'}</span>
                </button>
                {expanded === a.approach && <Breakdown a={a} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.questions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">To confirm</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-700" data-testid="api-question">{result.questions.map(q => <li key={q.question}>{q.question}{result.apiWouldWin ? ' A confirmed API would make integration the first choice here.' : ''}</li>)}</ul>
        </section>
      )}

      {!result.alreadyAutomated && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Facts about this step</h3>
          <div className="mt-2 divide-y divide-slate-100 rounded-xl bg-white px-4 ring-1 ring-slate-200">
            {TRAIT_CONTROLS.map(c => (
              <label key={c.trait} className="flex items-center justify-between gap-3 py-2.5 text-sm text-slate-700">
                <span>{c.label}</span>
                <Select value={traitValue(model, step.id, c.trait)} options={c.options} label={`${c.label} for ${step.name}`} disabled={!canEdit} onChange={v => setTrait(c.trait, v)} />
              </label>
            ))}
            {systems.map(s => (
              <label key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-sm text-slate-700">
                <span>Screens of {s.name} are stable</span>
                <Select value={s.uiStable && s.uiStable.status !== 'unknown' && s.uiStable.value !== null ? String(s.uiStable.value) : ''} options={yesNo()} label={`Screens of ${s.name} are stable`} disabled={!canEdit}
                  onChange={v => editor.apply(m => setSystemUiStable(m, { systemId: s.id, value: v === '' ? null : v === 'true' }), `Screens of ${s.name}`)} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">A value you set is recorded as confirmed by you, and the step is scored again at once.</p>
        </section>
      )}

      {canEdit && !override && !result.alreadyAutomated && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Override</h3>
          <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); if (!approach) return; const r = onOverride(approach, rationale); if (r === true) { setRationale(''); setApproach(''); setProblem(null); } else if (typeof r === 'string') setProblem(r); }}>
            <Select value={approach} label="Override recommendation" onChange={setApproach} options={[{ value: '', label: 'Choose an approach' }, ...APPROACHES.filter(m => m !== result.winner).map(m => ({ value: m, label: APPROACH_LABEL[m] }))]} />
            <textarea aria-label="Rationale" required placeholder="Why the recommendation should be different" value={rationale} onChange={e => setRationale(e.target.value)} rows={3}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {problem && <p className="text-xs text-red-700">{problem}</p>}
            <Button type="submit" variant="secondary" disabled={!approach || !rationale.trim()}>Override</Button>
          </form>
        </section>
      )}
    </div>
  );
}

function Breakdown({ a }: { a: ApproachScore }) {
  const binding = a.caps.filter(c => c.to < a.raw - a.penalty);
  return (
    <div className="border-t border-slate-100 px-4 pb-4 pt-3">
      <ul className="space-y-3">
        {a.factors.map(f => <li key={f.id}><FactorLine f={f} approach={a.approach} /></li>)}
      </ul>
      <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
        <div className="flex justify-between"><dt>Sum of the factors</dt><dd className="tabular-nums">{a.raw}</dd></div>
        {a.penalty > 0 && <div className="flex justify-between"><dt>Less the fixed complexity penalty for {a.approach === 'agent' ? 'agents' : 'AI'}</dt><dd className="tabular-nums">−{COMPLEXITY_PENALTY[a.approach as 'ai_assist' | 'agent']}</dd></div>}
        {binding.map((c, i) => <div key={i} className="flex justify-between gap-4 text-amber-800"><dt>{c.reason}</dt><dd className="whitespace-nowrap tabular-nums">at most {c.to}</dd></div>)}
        {a.floor && <div className="flex justify-between gap-4"><dt>{a.floor.reason}</dt><dd className="whitespace-nowrap tabular-nums">at least {a.floor.to}</dd></div>}
        <div className="flex justify-between font-semibold text-slate-900"><dt>Score</dt><dd className="tabular-nums">{a.score}</dd></div>
      </dl>
    </div>
  );
}

function FactorLine({ f, approach }: { f: FactorScore; approach: Approach }) {
  const [show, setShow] = React.useState(false);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-medium text-slate-800">{f.label}</span>
        <span className="tabular-nums text-slate-500">{Math.round(f.points)} of {f.weight}</span>
      </div>
      <ScoreBar score={f.weight ? (f.points / f.weight) * 100 : 0} approach={approach} className="mt-1 h-1" />
      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {f.text} {f.status && <StatusBadge status={f.status} />}
        {f.sources.length > 0 && <button type="button" className="font-medium text-[#002C4B] hover:underline" onClick={() => setShow(!show)}>{show ? 'Hide sources' : `${f.sources.length} source${f.sources.length === 1 ? '' : 's'}`}</button>}
      </p>
      {show && <div className="mt-2"><SourceList sources={f.sources} /></div>}
    </div>
  );
}
