// The inputs of the assessment in one place: the process profile, the applications and the facts
// of each step. Everything here is a fact in the Process Model: read from the sources where they
// say it, entered or corrected by a person where they do not. The result recalculates on each edit.
import React from 'react';
import type { AccessStatus, ChangeLevel, Fact, FactStatus, Metric, ProcessModel, Step, SystemRef } from '../../domain/processModel/types.ts';
import { PERIODS, setProcessMetric, setProfileFact, setStepTrait, setSystemApi, setSystemRemote, setSystemUiStable, type TraitName } from '../../domain/processModel/patch.ts';
import { orderedSteps, stepsForSystem } from '../../domain/processModel/selectors.ts';
import { periodOf, type ProcessAssessment } from '../../domain/assess/process.ts';
import { Button, cx } from '../ui.tsx';
import type { ModelEditor } from './useModelEditor.ts';
import { StatusBadge } from './widgets.tsx';

type Period = typeof PERIODS[number];
const known = <T,>(f: Fact<T> | undefined): T | null => (f && f.status !== 'unknown' && f.value !== null ? f.value : null);
const statusOf = (f: { status: FactStatus } | undefined): FactStatus => f?.status ?? 'unknown';
const quoteOf = (f: { sources: { excerpt: string }[] } | undefined) => f?.sources[0]?.excerpt;

const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:bg-slate-50 disabled:text-slate-500';
const cellCls = 'w-full rounded-md border px-1.5 py-1 text-xs focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20 disabled:opacity-70';
const unknownCls = 'border-amber-300 bg-amber-50 text-amber-900';
const knownCls = 'border-slate-200 bg-white text-slate-800';

/** A number saved on Enter or when focus leaves; empty clears it. */
function NumberInput({ value, onSave, label, disabled, className, placeholder, max }: { value: number | null; onSave: (v: number | null) => void; label: string; disabled?: boolean; className?: string; placeholder?: string; max?: number }) {
  const text = value === null ? '' : String(value);
  const [draft, setDraft] = React.useState(text);
  React.useEffect(() => setDraft(text), [text]);
  const commit = () => {
    const t = draft.trim();
    if (t === text) return;
    const n = Number(t.replace(',', '.'));
    if (t === '') onSave(null);
    else if (Number.isFinite(n) && n >= 0 && (max === undefined || n <= max)) onSave(n);
    else setDraft(text);
  };
  return <input aria-label={label} inputMode="decimal" value={draft} disabled={disabled} placeholder={placeholder} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(text); }} className={className ?? inputCls} />;
}

function Pick({ value, options, onChange, label, disabled, cell }: { value: string; options: [string, string][]; onChange: (v: string) => void; label: string; disabled?: boolean; cell?: boolean }) {
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} className={cell ? cx(cellCls, value === '' ? unknownCls : knownCls) : inputCls}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function ProfileField({ label, hint, status, quote, children }: { label: string; hint: string; status: FactStatus; quote?: string; children: React.ReactNode }) {
  return (
    <div className={cx('rounded-2xl border bg-white p-4', status === 'unknown' ? 'border-amber-200' : 'border-slate-200')} data-testid="profile-field">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <StatusBadge status={status} />
      </div>
      <div className="mt-2.5">{children}</div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
      {quote && <p className="mt-1.5 border-l-2 border-sky-200 pl-2 text-xs italic leading-5 text-slate-500">“{quote.length > 140 ? `${quote.slice(0, 140)}…` : quote}”</p>}
    </div>
  );
}

const YES_NO: [string, string][] = [['', 'Unknown'], ['true', 'Yes'], ['false', 'No']];
const CHANGE: [string, string][] = [['', 'Unknown'], ['none', 'No change expected'], ['minor', 'Minor change'], ['major', 'Major change']];
const API: [string, string][] = [['unknown', 'Unknown'], ['confirmed', 'Yes, confirmed'], ['reported', 'Said to exist, not confirmed'], ['confirmed_absent', 'No API']];
const STEP_COLUMNS: { trait: TraitName; head: string; title: string; options: [string, string][] }[] = [
  { trait: 'rulesComplete', head: 'Rules written', title: 'Rules stated in full and stable', options: YES_NO },
  { trait: 'input', head: 'Input', title: 'Form of the input', options: [['', 'Unknown'], ['structured', 'Structured'], ['semi_structured', 'Semi-structured'], ['unstructured', 'Documents'], ['paper', 'Paper']] },
  { trait: 'judgment', head: 'Judgment', title: 'Needs a judgment or accountable decision', options: YES_NO },
  { trait: 'physical', head: 'Physical', title: 'Needs a physical action', options: YES_NO },
  { trait: 'language', head: 'Free text', title: 'Drafts, summarises or classifies free text', options: YES_NO },
  { trait: 'write', head: 'Changes', title: 'What it changes', options: [['', 'Unknown'], ['none', 'Nothing'], ['record', 'A record'], ['financial', 'Money'], ['irreversible', 'Cannot be undone']] },
];
const parseTrait = (trait: TraitName, v: string): unknown => (v === '' ? null : trait === 'input' || trait === 'write' ? v : v === 'true');
const traitText = (s: Step, trait: TraitName): string => { const v = known((s.traits as Record<string, Fact<unknown>> | undefined)?.[trait]); return v === null ? '' : String(v); };

export function AssessmentInputs({ model, result, editor, canEdit, aiAvailable, reading, onRead }: {
  model: ProcessModel; result: ProcessAssessment; editor: ModelEditor; canEdit: boolean; aiAvailable: boolean; reading: string | null; onRead: () => void;
}) {
  const steps = orderedSteps(model);
  const inputs = result.priority.inputs;
  const metric = (kind: Metric['kind']) => model.meta.metrics.find(x => x.kind === kind && (!x.appliesTo || x.appliesTo === 'process'));
  const volume = metric('volume'), handling = metric('handling_time'), people = metric('fte'), exceptions = metric('exception_rate');
  const [period, setPeriod] = React.useState<Period>((volume && periodOf(volume) as Period) || 'month');
  React.useEffect(() => { const p = volume && periodOf(volume); if (p) setPeriod(p as Period); }, [volume?.unit, volume?.period]);
  const said = (m: Metric | undefined) => (m?.range && m.value === null ? `Sources say ${m.range[0]} to ${m.range[1]}` : undefined);
  const setMetric = (kind: 'volume' | 'handling_time' | 'fte' | 'exception_rate', value: number | null, p: Period = period) => editor.apply(m => setProcessMetric(m, { kind, value, period: p }), 'Assessment input');
  const profile = model.meta.profile ?? {};
  const stepMinutes = steps.reduce((t, s) => t + (known(s.traits?.effortMinutes) ?? 0) * ((known(s.traits?.sharePercent) ?? 100) / 100), 0);
  const blankShares = steps.filter(s => known(s.traits?.sharePercent) === null);
  const fillShares = () => editor.apply(m => {
    let cur = { model: m, patch: [] as ReturnType<typeof setStepTrait>['patch'] };
    for (const s of blankShares) { const r = setStepTrait(cur.model, { stepId: s.id, trait: 'sharePercent', value: 100 }); cur = { model: r.model, patch: [...cur.patch, ...r.patch] }; }
    return cur;
  }, 'Set the share of cases to 100% where it was blank');

  return (
    <div className="space-y-6" data-testid="assessment-inputs">
      <section aria-label="Completeness" className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <h3 className="font-display text-xl font-semibold text-slate-900">What the assessment is calculated from</h3>
            <p className="mt-1.5 text-sm leading-6 text-slate-600">Filled in from your sources where they say it. Enter or correct the rest; the result recalculates as you go. Amber fields are not known yet.</p>
          </div>
          <div className="text-right">
            <p className="font-display text-3xl font-semibold tabular-nums text-slate-900" data-testid="inputs-known">{Math.round(inputs.share * 100)}%</p>
            <p className="text-xs text-slate-500">{inputs.known} of {inputs.total} inputs known</p>
          </div>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {inputs.groups.map(g => (
            <div key={g.id}>
              <div className="flex items-baseline justify-between text-xs"><dt className="font-semibold text-slate-700">{g.label}</dt><dd className="tabular-nums text-slate-500">{g.known} / {g.total}</dd></div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full rounded-full', g.total && g.known === g.total ? 'bg-emerald-500' : 'bg-[#FFBC03]')} style={{ width: `${g.total ? (g.known / g.total) * 100 : 0}%` }} /></div>
            </div>
          ))}
        </dl>
        {canEdit && aiAvailable && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
            <Button variant="secondary" onClick={onRead} disabled={Boolean(reading) && !reading!.startsWith('Done')}>Read step facts from the sources</Button>
            <p className="text-xs text-slate-500" role="status">{reading ?? 'Reads rules, input, judgment, time and share for each step, each with its quote. What you confirmed is never changed.'}</p>
          </div>
        )}
      </section>

      <section aria-label="Process profile">
        <h3 className="font-display text-base font-semibold text-slate-900">Process profile</h3>
        <p className="text-sm text-slate-500">How much work there is, and how stable it is.</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ProfileField label="Volume" hint="How many cases are handled. Needed for hours and value." status={statusOf(volume)} quote={quoteOf(volume)}>
            <div className="flex gap-2">
              <NumberInput label="Volume" value={volume?.status === 'unknown' ? null : volume?.value ?? null} placeholder={said(volume) ?? 'Number of cases'} disabled={!canEdit} onSave={v => setMetric('volume', v)} />
              <select aria-label="Volume period" value={period} disabled={!canEdit} className={cx(inputCls, 'w-32')}
                onChange={e => { const p = e.target.value as Period; setPeriod(p); if (volume && volume.value !== null && volume.status !== 'unknown') setMetric('volume', volume.value, p); }}>
                {PERIODS.map(p => <option key={p} value={p}>per {p}</option>)}
              </select>
            </div>
          </ProfileField>
          <ProfileField label="Cases that leave the standard path" hint="Share of cases that hit an exception. Sets how much of the work the first automation covers." status={statusOf(exceptions)} quote={quoteOf(exceptions)}>
            <div className="flex items-center gap-2"><NumberInput label="Exception rate" max={100} value={exceptions?.status === 'unknown' ? null : exceptions?.value ?? null} placeholder={said(exceptions) ?? 'Percent of cases'} disabled={!canEdit} onSave={v => setMetric('exception_rate', v)} /><span className="text-sm text-slate-500">%</span></div>
          </ProfileField>
          <ProfileField label="Hands-on time per case" hint={stepMinutes > 0 ? `For reference. The step times below add up to ${Math.round(stepMinutes * 10) / 10} minutes a case.` : 'For reference. Hours are calculated from the time on each step below.'} status={statusOf(handling)} quote={quoteOf(handling)}>
            <div className="flex items-center gap-2"><NumberInput label="Handling time" value={handling?.status === 'unknown' ? null : handling?.value ?? null} placeholder={said(handling) ?? 'Minutes'} disabled={!canEdit} onSave={v => setMetric('handling_time', v)} /><span className="text-sm text-slate-500">min</span></div>
          </ProfileField>
          <ProfileField label="People doing this work" hint="For reference: how many full-time people the work takes today." status={statusOf(people)} quote={quoteOf(people)}>
            <NumberInput label="People" value={people?.status === 'unknown' ? null : people?.value ?? null} placeholder={said(people) ?? 'Full-time equivalents'} disabled={!canEdit} onSave={v => setMetric('fte', v)} />
          </ProfileField>
          <ProfileField label="Change to the process" hint="Expected in the next six months. A major change means wait." status={statusOf(profile.processChange)} quote={quoteOf(profile.processChange)}>
            <Pick label="Process change expected" value={known(profile.processChange) ?? ''} options={CHANGE} disabled={!canEdit} onChange={v => editor.apply(m => setProfileFact(m, { fact: 'processChange', value: (v || null) as ChangeLevel | null }), 'Assessment input')} />
          </ProfileField>
          <ProfileField label="Change to the applications" hint="Upgrades, migrations or replacements expected in the next six months." status={statusOf(profile.systemChange)} quote={quoteOf(profile.systemChange)}>
            <Pick label="Application change expected" value={known(profile.systemChange) ?? ''} options={CHANGE} disabled={!canEdit} onChange={v => editor.apply(m => setProfileFact(m, { fact: 'systemChange', value: (v || null) as ChangeLevel | null }), 'Assessment input')} />
          </ProfileField>
        </div>
      </section>

      <section aria-label="Applications">
        <h3 className="font-display text-base font-semibold text-slate-900">Applications</h3>
        <p className="text-sm text-slate-500">Where no API is confirmed, the assessment plans on rule-based RPA through the screens.</p>
        {model.systems.length === 0 ? <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">No applications yet. Add them in the Process stage.</p> : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>{['Application', 'API for this work', 'Screens stable', 'Remote desktop', 'Used in'].map(h => <th key={h} className="px-4 py-2.5 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {model.systems.map((s: SystemRef) => {
                  const apis = s.access.filter(a => a.method === 'api');
                  const api: AccessStatus = apis.find(a => a.access === 'confirmed')?.access ?? apis.find(a => a.access === 'reported')?.access ?? (apis.length && apis.every(a => a.access === 'confirmed_absent') ? 'confirmed_absent' : 'unknown');
                  const used = stepsForSystem(model, s.id).length;
                  return (
                    <tr key={s.id} data-testid="application-row">
                      <td className="px-4 py-3 font-medium text-slate-900">{s.name}{apis[0]?.name ? <span className="block text-xs font-normal text-slate-500">{apis[0].name}</span> : null}</td>
                      <td className="w-56 px-4 py-3"><Pick cell label={`API of ${s.name}`} value={api === 'unknown' ? '' : api} options={API.map(([v, l]) => [v === 'unknown' ? '' : v, l])} disabled={!canEdit} onChange={v => editor.apply(m => setSystemApi(m, { systemId: s.id, access: (v || 'unknown') as AccessStatus }), `API of ${s.name}`)} /></td>
                      <td className="w-36 px-4 py-3"><Pick cell label={`Screens of ${s.name} stable`} value={known(s.uiStable) === null ? '' : String(known(s.uiStable))} options={YES_NO} disabled={!canEdit} onChange={v => editor.apply(m => setSystemUiStable(m, { systemId: s.id, value: v === '' ? null : v === 'true' }), `Screens of ${s.name}`)} /></td>
                      <td className="w-36 px-4 py-3"><Pick cell label={`${s.name} through a remote desktop`} value={known(s.remote) === null ? '' : String(known(s.remote))} options={YES_NO} disabled={!canEdit} onChange={v => editor.apply(m => setSystemRemote(m, { systemId: s.id, value: v === '' ? null : v === 'true' }), `Remote desktop for ${s.name}`)} /></td>
                      <td className="px-4 py-3 text-xs text-slate-500">{used} {used === 1 ? 'step' : 'steps'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Step inputs">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900">Steps</h3>
            <p className="text-sm text-slate-500">The facts each step is scored on, and the time it takes.</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500" data-testid="save-state">{editor.saving ? 'Saving…' : ''}</span>
            {canEdit && blankShares.length > 0 && <Button variant="ghost" onClick={fillShares}>Set blank “% of cases” to 100</Button>}
          </div>
        </div>
        {steps.length === 0 ? <p className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-500">No steps yet. Add them in the Process stage or upload sources.</p> : (
          <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Step</th>
                  {STEP_COLUMNS.map(c => <th key={c.trait} title={c.title} className="px-2 py-2.5 font-semibold">{c.head}</th>)}
                  <th title="Hands-on minutes per case" className="px-2 py-2.5 font-semibold">Min / case</th>
                  <th title="Share of cases that pass through the step" className="px-2 py-2.5 font-semibold">% of cases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {steps.map((s, i) => {
                  const automated = s.taskType === 'service';
                  const set = (trait: TraitName, value: unknown) => editor.apply(m => setStepTrait(m, { stepId: s.id, trait, value }), `Assessment fact of "${s.name}"`);
                  const effort = known(s.traits?.effortMinutes), share = known(s.traits?.sharePercent);
                  return (
                    <tr key={s.id} data-testid="input-row" className={automated ? 'bg-slate-50/60' : undefined}>
                      <td className="px-3 py-2 text-xs tabular-nums text-slate-400">{i + 1}</td>
                      <td className="max-w-[16rem] px-3 py-2 text-sm font-medium text-slate-900">{s.name}{automated && <span className="block text-xs font-normal text-slate-500">Already done by a system</span>}</td>
                      {STEP_COLUMNS.map(c => (
                        <td key={c.trait} className="w-28 px-1.5 py-2">
                          {!automated && <Pick cell label={`${c.title} for ${s.name}`} value={traitText(s, c.trait)} options={c.options} disabled={!canEdit} onChange={v => set(c.trait, parseTrait(c.trait, v))} />}
                        </td>
                      ))}
                      <td className="w-20 px-1.5 py-2">{!automated && <NumberInput label={`Minutes per case for ${s.name}`} value={effort} disabled={!canEdit} onSave={v => set('effortMinutes', v)} className={cx(cellCls, 'tabular-nums', effort === null ? unknownCls : knownCls)} />}</td>
                      <td className="w-20 px-1.5 py-2">{!automated && <NumberInput label={`Share of cases for ${s.name}`} max={100} value={share} disabled={!canEdit} onSave={v => set('sharePercent', v)} className={cx(cellCls, 'tabular-nums', share === null ? unknownCls : knownCls)} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
