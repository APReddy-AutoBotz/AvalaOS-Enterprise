// What a process looks like on My work and on the Processes page: its assessment in three figures, the
// bar that shows how its steps would be done, the people named on it, and what is open. The figures
// are the process's own assessment (domain/assess/portfolio.ts); nothing here is typed in.
import React from 'react';
import type { ProcessCard } from '../domain/assess/portfolio.ts';
import { APPROACH_LABEL } from '../domain/assess/scoring.ts';
import { namedOn, type Duty, type ProcessFacts } from '../domain/work/home.ts';
import { initials } from '../domain/workitems/board.ts';
import { cx, Tag } from './ui.tsx';
import { STATUS_TONE, type LoadedFacts } from './processFacts.ts';

export const DUTY: Record<Duty, string> = { analyst: 'Analyst', architect: 'Architect', approver: 'Approver' };
export const hrs = (n: number) => Math.round(n).toLocaleString('en');
export const approachText = (c: ProcessCard) => (c.lead ? APPROACH_LABEL[c.lead] : 'Keep with people for now');
export const hoursText = (c: ProcessCard) => (c.hours === null ? 'Not known yet' : `${c.exact ? '' : 'Up to '}${hrs(c.hours)}`);
/** One line for a compact row: "Rule-based RPA · up to 20,900 hours a year". */
export const cardLine = (c: ProcessCard) => `${approachText(c)} · ${c.hours === null ? 'hours not known yet' : `${c.exact ? '' : 'up to '}${hrs(c.hours)} hours a year`}`;

export const Tile = ({ value, label, className }: { value: React.ReactNode; label: string; className?: string }) => (
  <div className={cx('min-w-0 rounded-xl bg-slate-50 px-4 py-3', className)}>
    <div className="font-display text-lg font-semibold leading-snug text-[#002C4B]">{value}</div>
    <div className="mt-0.5 text-xs text-slate-600">{label}</div>
  </div>
);

/** The three figures of a card: the recommended approach, the hours a year, the share of steps that fit. */
export const Figures = ({ card, className }: { card: ProcessCard; className?: string }) => (
  <div className={cx('grid gap-3', className)}>
    <Tile value={approachText(card)} label="Recommended approach" />
    <Tile value={hoursText(card)} label="Hours a year" />
    <Tile value={`${Math.round(card.fit * 100)}%`} label="Steps that fit" />
  </div>
);

/** How the steps people do today would be done: by rules, with AI, or kept with people. */
export function StepSplit({ card }: { card: ProcessCard }) {
  const parts = [
    { n: card.split.rules, label: 'by rules', cls: 'bg-[#002C4B]' },
    { n: card.split.ai, label: card.split.ai === 1 ? 'needs AI' : 'need AI', cls: 'bg-[#E69F00]' },
    { n: card.split.people, label: card.split.people === 1 ? 'stays with people' : 'stay with people', cls: 'bg-slate-400' },
  ].filter(p => p.n > 0);
  return (
    <div data-testid="step-split">
      <p className="text-[13px] font-semibold text-slate-900">How the {card.steps === 1 ? 'step' : `${card.steps} steps`} people do today would be done</p>
      <div aria-hidden className="mt-2.5 flex gap-[3px] overflow-hidden rounded-full">
        {parts.map(p => <span key={p.label} className={cx('block h-2.5', p.cls)} style={{ flexGrow: p.n, flexBasis: 0 }} />)}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
        {parts.map(p => <li key={p.label} className="flex items-center gap-1.5 text-[13px] text-slate-700"><span aria-hidden className={cx('h-2.5 w-2.5 rounded-[3px]', p.cls)} />{p.n} {p.label}</li>)}
      </ul>
    </div>
  );
}

// White text on each passes 4.5:1; the order is analyst, architect, approver.
const AVATAR = ['bg-[#002C4B]', 'bg-teal-700', 'bg-amber-700'];

/** The people named on a process: overlapping initials, their names beside them, and the duties for screen readers. */
export function People({ facts, nameOf, names = true }: { facts: Pick<ProcessFacts, 'analystId' | 'architectId' | 'approverId'>; nameOf: (id: string) => string; names?: boolean }) {
  const people = namedOn(facts);
  if (people.length === 0) return <Tag tone="warn">Nobody named</Tag>;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="flex shrink-0 pl-1.5" aria-hidden>
        {people.map((x, i) => (
          <span key={x.userId} title={`${nameOf(x.userId)}: ${x.duties.map(d => DUTY[d]).join(', ')}`}
            className={cx('-ml-1.5 grid h-8 w-8 place-items-center rounded-full border-2 border-white text-[11px] font-bold text-white', AVATAR[i % AVATAR.length])}>{initials(nameOf(x.userId))}</span>
        ))}
      </span>
      {names && <span aria-hidden className="min-w-0 truncate text-[13px] text-slate-600">{people.map(x => nameOf(x.userId)).join(', ')}</span>}
      <span className="sr-only">{people.map(x => `${x.duties.map(d => DUTY[d]).join(', ')}: ${nameOf(x.userId)}.`).join(' ')}</span>
    </span>
  );
}

/** Where a process stands, as a pill. */
const PILL = { neutral: 'bg-slate-200/70 text-slate-700', info: 'bg-sky-100 text-sky-900', ok: 'bg-emerald-100 text-emerald-900', warn: 'bg-amber-100 text-amber-900' } as const;
export const Pill = ({ tone = 'neutral', children }: { tone?: keyof typeof PILL; children: React.ReactNode }) => (
  <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', PILL[tone])}>{children}</span>
);
export const StatusPill = ({ facts }: { facts: LoadedFacts }) => <Pill tone={STATUS_TONE[facts.statusTone]}>{facts.statusLabel}</Pill>;

/** Something open on a process: amber, because it is waiting on somebody. */
export const OpenChip = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#FFF4D6] px-3 py-1 text-[13px] font-semibold text-[#6B4A00]">
    <span aria-hidden className="h-2 w-2 rounded-full bg-[#E69F00]" />{children}
  </span>
);
