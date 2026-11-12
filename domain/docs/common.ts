// What every document builder reads, and small helpers shared by them.
import type { Fact, Metric, ProcessModel, Step, SystemRef } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { effectiveApproach, type Decisions } from '../assess/decisions.ts';
import { APPROACH_LABEL, type Approach, type StepScore } from '../assess/scoring.ts';
import { orderedSteps, processMetric } from '../processModel/selectors.ts';
import { missing, NOT_PROVIDED, type Cell } from './tree.ts';

export interface DocInput {
  model: ProcessModel;
  assessment: ProcessAssessment;
  decisions: Decisions;
  /** Source keys and titles, for attribution. */
  sources: { key: string; title: string }[];
  /** The revision the document is built from. */
  revision: { label: string; state: 'working' | 'approved'; date: string };
}

export const known = <T>(f: Fact<T> | undefined): T | null => (f && f.status !== 'unknown' && f.value !== null ? f.value : null);
/** A fact as a cell: its value with its status, or "Not provided". */
export function factCell<T>(f: Fact<T> | undefined, show: (v: T) => string = v => String(v)): Cell {
  const v = known(f);
  return v === null ? missing() : { text: show(v), status: f!.status };
}
export const names = (ids: string[], list: { id: string; name: string }[]) => ids.map(id => list.find(x => x.id === id)?.name).filter(Boolean).join(', ');
export const stepNumber = (m: ProcessModel) => { const order = orderedSteps(m); return (id: string) => order.findIndex(s => s.id === id) + 1; };
export const sourceList = (refs: { sourceId: string }[]) => [...new Set(refs.map(r => r.sourceId))].join(', ');

export function metricText(x: Metric): string {
  const v = x.value !== null ? x.value.toLocaleString('en') : x.range ? `${x.range[0].toLocaleString('en')} to ${x.range[1].toLocaleString('en')}` : '';
  return `${v} ${x.unit}`.trim();
}
export const metricCell = (m: ProcessModel, kind: Metric['kind']): Cell => {
  const x = processMetric(m, kind);
  return x ? { text: metricText(x), status: x.status } : missing();
};

export const ACCESS_TEXT: Record<string, string> = { confirmed: 'confirmed', reported: 'reported, not confirmed', unknown: 'unknown', confirmed_absent: 'not available' };
export function accessText(s: SystemRef): string {
  if (!s.access.length) return NOT_PROVIDED;
  return s.access.map(a => `${a.method.toUpperCase()}${a.name ? ` (${a.name})` : ''}: ${ACCESS_TEXT[a.access]}`).join('; ');
}

export const MODE_LABEL: Record<Approach, string> = { ...APPROACH_LABEL };
export const HUMAN_POINT: Record<string, string> = { none: 'None', review: 'Reviews the output', approve: 'Approves before it takes effect', decide: 'Decides', does_it: 'Does the work' };

/** The approach in effect for a step, with whether a person overrode the scoring. */
export function modeOf(input: DocInput, step: Step): { score: StepScore | undefined; approach: Approach | null; overridden: boolean; by: string | null; why: string } {
  const score = input.assessment.steps.find(s => s.stepId === step.id);
  if (!score || score.alreadyAutomated) return { score, approach: null, overridden: false, by: null, why: score?.reason ?? '' };
  const eff = effectiveApproach(score, input.decisions);
  return { score, approach: eff.approach, overridden: Boolean(eff.override), by: eff.override?.by ?? null, why: eff.override ? `Overridden: ${eff.override.rationale}` : score.reason };
}
