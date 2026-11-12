// The Assessment stage: what to do with each step and with the process, computed from the model.
// The recommendation is never typed in. People change it by correcting the facts it rests on, or
// by overriding a step with a rationale; both persist and the rules' own answer stays visible.
import React from 'react';
import type { ProcessModel, SystemRef } from '../../domain/processModel/types.ts';
import { addQuestion, setStepTrait, setSystemUiStable, type TraitName } from '../../domain/processModel/patch.ts';
import { hashModel } from '../../domain/processModel/hash.ts';
import { orderedSteps } from '../../domain/processModel/selectors.ts';
import { RULES_VERSION, type AiNeed, type Confidence, type HumanPoint, type Mechanism, type StepResult, type FactUsed } from '../../domain/assess/rules.ts';
import { rollUp, type ProcessResult } from '../../domain/assess/rollup.ts';
import { decisionsToEntries, DecisionError, effectiveMechanism, emptyDecisions, withOverride, withoutOverride, withRate, type Decisions } from '../../domain/assess/decisions.ts';
import { applyTraitFindings, batches, stepTraits, traitSegments, type TraitFinding } from '../../domain/assess/traits.ts';
import type { JourneyStore, SourceRow } from '../store/types.ts';
import { Button, cx, ErrorNote, messageOf } from '../ui.tsx';
import { useModelEditor, type ModelEditor } from './useModelEditor.ts';
import { coarsePatch } from './SourcesStage.tsx';
import { Select, SidePanel, SourceList, StatusBadge, TableShell } from './widgets.tsx';

export const MECHANISM_LABEL: Record<Mechanism, string> = {
  already_automated: 'Already done by a system', eliminate: 'Eliminate or simplify', keep_human: 'Keep with a person', rules: 'Rules or workflow',
  api: 'API integration', api_candidate: 'API-first candidate', rpa: 'UI automation (bridge)', extraction: 'Document extraction',
  ai_assist: 'AI assistance', agent: 'Bounded agent', no_option: 'Keep with a person for now',
};
const MECHANISM_TONE: Record<Mechanism, string> = {
  already_automated: 'bg-slate-100 text-slate-700', eliminate: 'bg-rose-50 text-rose-800', keep_human: 'bg-slate-100 text-slate-800', rules: 'bg-emerald-50 text-emerald-800',
  api: 'bg-emerald-50 text-emerald-800', api_candidate: 'bg-amber-50 text-amber-900', rpa: 'bg-sky-50 text-sky-800', extraction: 'bg-violet-50 text-violet-800',
  ai_assist: 'bg-violet-50 text-violet-800', agent: 'bg-violet-100 text-violet-900', no_option: 'bg-slate-100 text-slate-700',
};
const HUMAN_LABEL: Record<HumanPoint, string> = { none: 'None', review: 'Reviews', approve: 'Approves', decide: 'Decides', does_it: 'Does it' };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const MECHANISMS = Object.keys(MECHANISM_LABEL) as Mechanism[];

function AiBadge({ ai, unnecessary }: { ai: AiNeed; unnecessary: boolean }) {
  if (unnecessary) return <span data-testid="ai-badge" className="whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-900">AI unnecessary</span>;
  if (ai === 'yes') return <span data-testid="ai-badge" className="whitespace-nowrap rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900">AI needed</span>;
  if (ai === 'undecided') return <span data-testid="ai-badge" className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Not decided</span>;
  return <span data-testid="ai-badge" className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">No AI</span>;
}

const fmt = (n: number) => n >= 100 ? Math.round(n).toLocaleString('en') : n.toFixed(1);
const range = ([a, b]: [number, number], unit = '') => (Math.round(a) === Math.round(b) ? `${fmt(a)}${unit}` : `${fmt(a)}–${fmt(b)}${unit}`);
const pct = ([a, b]: [number, number]) => (Math.round(a * 100) === Math.round(b * 100) ? `${Math.round(a * 100)}%` : `${Math.round(a * 100)}–${Math.round(b * 100)}%`);

export function AssessmentStage({ store, processId, workspaceId, model, working, revisionId, canEdit, me, sources, onSaved }: {
  store: JourneyStore; processId: string; workspaceId: string; model: ProcessModel; working: { id: string; seq: number } | null;
  revisionId: string; canEdit: boolean; me: string; sources: SourceRow[]; onSaved: () => void;
}) {
  const editor = useModelEditor(store, processId, { model, working }, onSaved);
  const [decisions, setDecisions] = React.useState<Decisions | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState<string | null>(null);

  React.useEffect(() => { store.getAssessmentDecisions(processId).then(setDecisions).catch(e => setError(messageOf(e))); }, [store, processId]);

  const result = React.useMemo(() => rollUp(editor.model, { rate: decisions?.rate ?? null }), [editor.model, decisions?.rate]);

  const save = async (next: Decisions) => {
    setError(null);
    const prev = decisions;
    setDecisions(next);
    try {
      await store.saveAssessment(processId, {
        revisionId: working?.id ?? revisionId, modelHash: hashModel(editor.model), rulesVersion: RULES_VERSION, decisions: next,
        result: { headline: result.headline, summary: result.summary, steps: result.steps.map(s => ({ stepId: s.stepId, mechanism: s.mechanism, aiNeeded: s.aiNeeded, human: s.human })), decisions: decisionsToEntries(next) },
      });
    } catch (e) { setDecisions(prev); setError(messageOf(e)); }
  };

  const readTraits = async () => {
    setError(null);
    try {
      const steps = orderedSteps(editor.model);
      const loaded = await Promise.all(sources.filter(s => !s.archived).map(async s => ({ key: s.key, segments: await store.getSourceSegments(s.id) })));
      const groups = batches(steps, 7);
      let done = 0;
      setReading(`Reading the sources for ${steps.length} steps…`);
      const findings: TraitFinding[] = [];
      const ingest = new Map();
      await Promise.all(groups.map(async group => {
        const { segments, ingest: map } = traitSegments(editor.model, group, loaded);
        for (const [k, v] of map) ingest.set(k, v);
        const r = await store.runAiTask(workspaceId, stepTraits.id, segments);
        findings.push(...(((r.data as { findings?: TraitFinding[] })?.findings) ?? []));
        done++;
        setReading(`Reading the sources: ${done} of ${groups.length} groups of steps done…`);
      }));
      const count = { n: 0 };
      await editor.apply(m => {
        const { model: next, changes } = applyTraitFindings(m, findings, ingest);
        count.n = changes.length;
        return { model: next, patch: changes.length ? coarsePatch(m, next) : [] };
      }, 'Read assessment details from the sources');
      setReading(count.n ? `Done: ${count.n} details read from the sources.` : 'Done: the sources settle no further details.');
    } catch (e) {
      setReading(null);
      setError(messageOf(e));
    }
  };

  const unansweredApiQuestions = result.questions.filter(q => !editor.model.openQuestions.some(x => x.status === 'open' && x.question === q.question));
  const addApiQuestions = () => editor.apply(m => {
    let cur: { model: ProcessModel; patch: ReturnType<typeof coarsePatch> } = { model: m, patch: [] };
    for (const q of unansweredApiQuestions) {
      if (cur.model.openQuestions.some(x => x.question === q.question)) continue;
      const r = addQuestion(cur.model, { target: q.target, question: q.question, whyItMatters: q.whyItMatters });
      cur = { model: r.model, patch: [...cur.patch, ...r.patch] };
    }
    return cur;
  }, `Asked ${unansweredApiQuestions.length} API question${unansweredApiQuestions.length === 1 ? '' : 's'}`);

  const steps = orderedSteps(editor.model);
  const byStep = new Map<string, StepResult>(result.steps.map(r => [r.stepId, r] as [string, StepResult]));
  const current = open ? byStep.get(open) : undefined;
  const d = decisions ?? emptyDecisions();

  return (
    <div className="space-y-6">
      <ErrorNote message={error ?? editor.error} />
      <Summary result={result} decisions={d} canEdit={canEdit && decisions !== null} me={me} onRate={rate => { try { save(withRate(d, rate)); } catch (e) { setError((e as Error).message); } }} />

      {(canEdit && (store.aiAvailable || unansweredApiQuestions.length > 0)) && (
        <div className="flex flex-wrap items-center gap-3">
          {store.aiAvailable && <Button variant="secondary" disabled={Boolean(reading && reading.endsWith('…'))} onClick={readTraits}>Read step details from the sources</Button>}
          {unansweredApiQuestions.length > 0 && <Button variant="secondary" onClick={addApiQuestions}>Add {unansweredApiQuestions.length} API question{unansweredApiQuestions.length === 1 ? '' : 's'} to open questions</Button>}
          {reading && <span role="status" className="text-sm text-slate-600">{reading}</span>}
          <span className="ml-auto text-xs text-slate-500" data-testid="save-state">{editor.saving ? 'Saving…' : ''}</span>
        </div>
      )}

      <TableShell head={['#', 'Step', 'Recommendation', 'AI', 'Person', 'Confidence', 'Main reason']}>
        {steps.map((s, i) => {
          const r = byStep.get(s.id)!;
          const eff = effectiveMechanism(r, d);
          return (
            <tr key={s.id} data-testid="assessment-row" className="cursor-pointer align-top hover:bg-slate-50" onClick={() => setOpen(s.id)}>
              <td className="px-3 py-2 text-xs text-slate-500">{i + 1}</td>
              <td className="px-3 py-2 font-medium text-slate-900"><button type="button" className="text-left hover:underline" aria-label={`Assessment of ${s.name}`}>{s.name}</button></td>
              <td className="px-3 py-2">
                <span data-testid="recommendation" className={cx('whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold', MECHANISM_TONE[eff.mechanism])}>{MECHANISM_LABEL[eff.mechanism]}</span>
                {eff.override && <p className="mt-1 text-[11px] text-slate-500" data-testid="overridden">Overridden by {eff.override.by}</p>}
              </td>
              <td className="px-3 py-2"><AiBadge ai={eff.override ? aiOf(eff.mechanism) : r.aiNeeded} unnecessary={!eff.override && r.aiUnnecessary} /></td>
              <td className="px-3 py-2 text-xs text-slate-700">{HUMAN_LABEL[r.human]}</td>
              <td className="px-3 py-2 text-xs text-slate-700">{CONFIDENCE_LABEL[r.confidence]}</td>
              <td className="max-w-md px-3 py-2 text-xs leading-5 text-slate-600">{eff.override ? eff.override.rationale : r.reasons[0]?.text}</td>
            </tr>
          );
        })}
      </TableShell>

      {current && (
        <SidePanel title={steps.find(s => s.id === current.stepId)?.name ?? ''} onClose={() => setOpen(null)}>
          <StepDetail model={editor.model} result={current} decisions={d} canEdit={canEdit} editor={editor} me={me}
            onOverride={(mechanism, rationale) => { try { save(withOverride(d, current, { mechanism, rationale, by: me || 'you' })); return true; } catch (e) { setError((e as Error).message); return e instanceof DecisionError ? (e as Error).message : false; } }}
            onClearOverride={() => save(withoutOverride(d, current.stepId))} />
        </SidePanel>
      )}
    </div>
  );
}

const aiOf = (m: Mechanism): AiNeed => (['extraction', 'ai_assist', 'agent'].includes(m) ? 'yes' : m === 'api_candidate' ? 'undecided' : 'no');

function Summary({ result, decisions, canEdit, me, onRate }: { result: ProcessResult; decisions: Decisions; canEdit: boolean; me: string; onRate: (r: Decisions['rate']) => void }) {
  const fired = result.gates.filter(g => g.fired);
  const [amount, setAmount] = React.useState(decisions.rate ? String(decisions.rate.amount) : '');
  const [currency, setCurrency] = React.useState(decisions.rate?.currency ?? '');
  React.useEffect(() => { setAmount(decisions.rate ? String(decisions.rate.amount) : ''); setCurrency(decisions.rate?.currency ?? ''); }, [decisions.rate]);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6" aria-label="Process recommendation">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recommendation for the process</p>
      <h2 className="mt-1 font-display text-xl font-semibold text-slate-900" data-testid="headline">{result.headline}</h2>
      <p className="mt-2 text-sm text-slate-700" data-testid="composition">{result.summary}</p>
      {fired.length > 0 && (
        <ul className="mt-4 space-y-2">
          {fired.map(g => <li key={g.id} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"><span className="font-semibold">{g.label}.</span> {g.reason}</li>)}
        </ul>
      )}
      <dl className="mt-5 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs font-semibold text-slate-500">Effort that could be automated</dt>
          <dd className="mt-1 text-sm text-slate-900">{result.potential.computable ? <><span className="text-lg font-semibold">{pct(result.potential.value!)}</span> <span className="text-xs text-slate-500">{result.potential.note}</span></> : <span className="text-slate-500">Not computed: {result.potential.reason}</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Hands-on hours a year</dt>
          <dd className="mt-1 text-sm text-slate-900">{result.hours.computable ? <><span className="text-lg font-semibold">{range(result.hours.value!.automatable)}</span> could be automated, of {range(result.hours.value!.today)} today</> : <span className="text-slate-500">Not computed: {result.hours.reason}</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-slate-500">Value of those hours</dt>
          <dd className="mt-1 text-sm text-slate-900">
            {result.money.computable ? <><span className="text-lg font-semibold">{result.money.value!.currency} {range(result.money.value!.automatable)}</span> a year <span className="block text-xs text-slate-500">{result.money.note}</span></> : <span className="text-slate-500">Not computed: {result.money.reason}</span>}
            {canEdit && (
              <form className="mt-2 flex items-end gap-1" onSubmit={e => { e.preventDefault(); const n = Number(amount); onRate(amount.trim() ? { amount: n, currency: currency.trim().toUpperCase(), enteredBy: me || 'you' } : null); }}>
                <input aria-label="Currency" placeholder="Currency" value={currency} onChange={e => setCurrency(e.target.value)} className="w-20 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                <input aria-label="Cost per hour" placeholder="Cost per hour" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} className="w-28 rounded-md border border-slate-300 px-2 py-1 text-xs" />
                <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">{decisions.rate ? 'Update rate' : 'Set rate'}</Button>
              </form>
            )}
          </dd>
        </div>
      </dl>
      {fired.length === 0 && <p className="mt-4 text-xs text-slate-500">Checks: {result.gates.map(g => g.label.toLowerCase()).join(', ')} — none apply.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- one step

const TRAIT_CONTROLS: { trait: TraitName; label: string; options: { value: string; label: string }[] }[] = [
  { trait: 'rework', label: 'Rework or duplicate entry', options: yesNo() },
  { trait: 'physical', label: 'Needs a physical action', options: yesNo() },
  { trait: 'judgment', label: 'Needs a judgment or accountable decision', options: yesNo() },
  { trait: 'input', label: 'Form of the input', options: [{ value: '', label: 'Unknown' }, { value: 'structured', label: 'Structured data' }, { value: 'semi_structured', label: 'Semi-structured (emails, varying forms)' }, { value: 'unstructured', label: 'Unstructured documents' }, { value: 'paper', label: 'Paper' }] },
  { trait: 'rulesComplete', label: 'Rules stated in full and stable', options: yesNo() },
  { trait: 'language', label: 'Drafts, summarises or classifies free text', options: yesNo() },
  { trait: 'write', label: 'What it changes', options: [{ value: '', label: 'Unknown' }, { value: 'none', label: 'Nothing' }, { value: 'record', label: 'A record' }, { value: 'financial', label: 'Money (posts, pays, blocks)' }, { value: 'irreversible', label: 'Something that cannot be undone' }] },
];
function yesNo() { return [{ value: '', label: 'Unknown' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]; }

function traitValue(model: ProcessModel, stepId: string, trait: TraitName): string {
  const t = model.steps.find(s => s.id === stepId)?.traits ?? {};
  const f: any = trait.startsWith('agent.') ? (t.agent as any)?.[trait.slice(6)] : (t as any)[trait];
  return f && f.status !== 'unknown' && f.value !== null ? String(f.value) : '';
}
const parse = (trait: TraitName, v: string): unknown => (v === '' ? null : ['input', 'write'].includes(trait) ? v : v === 'true');

function StepDetail({ model, result, decisions, canEdit, editor, me, onOverride, onClearOverride }: {
  model: ProcessModel; result: StepResult; decisions: Decisions; canEdit: boolean; editor: ModelEditor; me: string;
  onOverride: (m: Mechanism, rationale: string) => true | string | false; onClearOverride: () => void;
}) {
  const step = model.steps.find(s => s.id === result.stepId)!;
  const override = decisions.overrides[result.stepId];
  const [mechanism, setMechanism] = React.useState<Mechanism | ''>('');
  const [rationale, setRationale] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const setTrait = (trait: TraitName, v: string) => editor.apply(m => setStepTrait(m, { stepId: step.id, trait, value: parse(trait, v) }), `Assessment detail of "${step.name}"`);
  const systems = step.systemIds.map(id => model.systems.find(s => s.id === id)).filter((s): s is SystemRef => Boolean(s));

  return (
    <div className="space-y-5" data-testid="step-assessment">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cx('rounded-md px-2 py-0.5 text-xs font-semibold', MECHANISM_TONE[result.mechanism])}>{MECHANISM_LABEL[result.mechanism]}</span>
        <AiBadge ai={result.aiNeeded} unnecessary={result.aiUnnecessary} />
        <span className="text-xs text-slate-600">Person: {HUMAN_LABEL[result.human]} · Confidence: {CONFIDENCE_LABEL[result.confidence]}</span>
      </div>
      {override && (
        <div className="rounded-lg border border-slate-300 bg-white p-3 text-sm" data-testid="override-note">
          <p><span className="font-semibold">Overridden by {override.by}:</span> {MECHANISM_LABEL[override.mechanism]}. {override.rationale}</p>
          <p className="mt-1 text-xs text-slate-500">The rules recommend {MECHANISM_LABEL[result.mechanism].toLowerCase()}.</p>
          {canEdit && <Button variant="ghost" className="mt-1 px-2 py-1 text-xs" onClick={onClearOverride}>Remove override</Button>}
        </div>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why</h3>
        <ul className="mt-2 space-y-3">
          {result.reasons.map((r, i) => (
            <li key={i} className="text-sm text-slate-800">
              {r.text}
              {r.facts.length > 0 && <ul className="mt-2 space-y-2">{r.facts.map((f, j) => <li key={j}><FactLine fact={f} /></li>)}</ul>}
            </li>
          ))}
        </ul>
      </section>

      {result.rejected.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Simpler options, and why not</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {result.rejected.map(r => <li key={r.rung}><span className="font-medium text-slate-800">{r.label}:</span> <span className="text-slate-600">{r.reason}</span></li>)}
          </ul>
        </section>
      )}

      {result.unknowns.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">What would change this</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {result.unknowns.map(u => <li key={u.path} className="text-slate-700">{u.question}</li>)}
          </ul>
        </section>
      )}

      {result.questions.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">To confirm</h3>
          <ul className="mt-2 space-y-1 text-sm text-slate-700" data-testid="api-question">{result.questions.map(q => <li key={q.question}>{q.question}</li>)}</ul>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">About this step</h3>
        <div className="mt-2 grid gap-2">
          {TRAIT_CONTROLS.map(c => (
            <label key={c.trait} className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>{c.label}</span>
              <Select value={traitValue(model, step.id, c.trait)} options={c.options} label={`${c.label} for ${step.name}`} disabled={!canEdit} onChange={v => setTrait(c.trait, v)} />
            </label>
          ))}
          {systems.map(s => (
            <label key={s.id} className="flex items-center justify-between gap-3 text-sm text-slate-700">
              <span>Screens of {s.name} are stable</span>
              <Select value={s.uiStable && s.uiStable.status !== 'unknown' && s.uiStable.value !== null ? String(s.uiStable.value) : ''} options={yesNo()} label={`Screens of ${s.name} are stable`} disabled={!canEdit}
                onChange={v => editor.apply(m => setSystemUiStable(m, { systemId: s.id, value: v === '' ? null : v === 'true' }), `Screens of ${s.name}`)} />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Changing a value here records it as confirmed by you and re-evaluates the step at once.</p>
      </section>

      {canEdit && !override && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Override</h3>
          <form className="mt-2 space-y-2" onSubmit={e => { e.preventDefault(); if (!mechanism) return; const r = onOverride(mechanism, rationale); if (r === true) { setRationale(''); setMechanism(''); setProblem(null); } else if (typeof r === 'string') setProblem(r); }}>
            <Select value={mechanism} label="Override recommendation" onChange={setMechanism} options={[{ value: '', label: 'Choose a recommendation' }, ...MECHANISMS.filter(m => m !== result.mechanism).map(m => ({ value: m, label: MECHANISM_LABEL[m] }))]} />
            <textarea aria-label="Rationale" required placeholder="Why the recommendation should be different" value={rationale} onChange={e => setRationale(e.target.value)} rows={3}
              className="block w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm" />
            {problem && <p className="text-xs text-red-700">{problem}</p>}
            <Button type="submit" variant="secondary" disabled={!mechanism || !rationale.trim()}>Override</Button>
          </form>
        </section>
      )}
    </div>
  );
}

function FactLine({ fact }: { fact: FactUsed }) {
  const value = typeof fact.value === 'boolean' ? (fact.value ? 'yes' : 'no') : String(fact.value).replace(/_/g, ' ');
  return (
    <div className="rounded-md bg-slate-50 p-2">
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-700"><span className="font-semibold">{fact.label}:</span> {value} <StatusBadge status={fact.status} /></p>
      {fact.sources.length > 0 && <div className="mt-2"><SourceList sources={fact.sources} /></div>}
    </div>
  );
}
