// Labels, colours and small pieces shared by the Assessment screen and the report.
import React from 'react';
import { APPROACH_LABEL, type Approach, type Confidence, type HumanPoint, type StepScore } from '../../domain/assess/scoring.ts';
import type { Range } from '../../domain/assess/process.ts';
import { cx } from '../ui.tsx';

export const APPROACH_TONE: Record<Approach, { chip: string; bar: string; dot: string }> = {
  rpa: { chip: 'bg-sky-50 text-sky-900 ring-sky-200', bar: 'bg-sky-600', dot: 'bg-sky-600' },
  api: { chip: 'bg-emerald-50 text-emerald-900 ring-emerald-200', bar: 'bg-emerald-600', dot: 'bg-emerald-600' },
  ai_assist: { chip: 'bg-violet-50 text-violet-900 ring-violet-200', bar: 'bg-violet-600', dot: 'bg-violet-600' },
  agent: { chip: 'bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-200', bar: 'bg-fuchsia-600', dot: 'bg-fuchsia-600' },
  human: { chip: 'bg-slate-100 text-slate-800 ring-slate-200', bar: 'bg-slate-500', dot: 'bg-slate-500' },
};
export const HUMAN_LABEL: Record<HumanPoint, string> = { none: 'None', review: 'Reviews the output', approve: 'Approves', decide: 'Decides', does_it: 'Does it' };
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const RANK_LABEL = ['1st choice', '2nd choice', '3rd choice', '4th choice'];

export const fmt = (n: number) => (n >= 100 ? Math.round(n).toLocaleString('en') : n.toFixed(1));
export const range = ([a, b]: Range, unit = '') => (Math.round(a) === Math.round(b) ? `${fmt(a)}${unit}` : `${fmt(a)}–${fmt(b)}${unit}`);
export const pct = ([a, b]: Range) => (Math.round(a * 100) === Math.round(b * 100) ? `${Math.round(a * 100)}%` : `${Math.round(a * 100)}–${Math.round(b * 100)}%`);
export const stepLabel = (s: StepScore, approach: Approach = s.winner) => (s.alreadyAutomated ? 'Already automated' : approach === 'human' && s.forNow ? 'Keep with a person for now' : APPROACH_LABEL[approach]);

export function ScoreBar({ score, approach, className }: { score: number; approach: Approach; className?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70', className)} role="img" aria-label={`${APPROACH_LABEL[approach]}: ${Math.round(score)} out of 100`}>
      <div className={cx('h-full rounded-full', APPROACH_TONE[approach].bar)} style={{ width: `${score}%` }} />
    </div>
  );
}

