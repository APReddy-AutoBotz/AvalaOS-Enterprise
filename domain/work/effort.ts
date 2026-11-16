// The effort scorecard (docs/effort-first-plan.md, part H): what it took to get a process to documents,
// counted only from records that already exist: when the sources were added, the process's history, its
// questions and how each was answered, and the delivery plan. Nothing is estimated; what was not
// recorded is said so. It is the proof a pilot client takes to their management.
import type { ProcessModel } from '../processModel/types.ts';

export interface EffortInput {
  /** Every source, archived ones too: when each was added and its key ("own-1" is a person's own words). */
  sources: { key: string; createdAt: string }[];
  /** The process's history: each saved change with its origin and summary. */
  edits: { origin: string; summary: string; createdAt: string }[];
  /** When the first revision was started, if any. */
  firstRevisionAt: string | null;
  model: ProcessModel | null;
  /**
   * The first list of questions (part D), when worked out: only people can answer now, found in the sources,
   * can wait, and left with a named person. It counts what is open the way the screens do: the recorded
   * questions with repeats merged, plus what the process still lacks that nobody has asked about yet.
   */
  plan?: { now: number; found: number; wait: number; deferred?: number };
  /** The documents the delivery plan names that can be produced now. */
  documents: string[];
}

/** The documents a delivery plan names that can be produced now, by name. */
export const readyDocuments = (docs: { label: string; planned: boolean; available: boolean }[]) => docs.filter(d => d.planned && d.available).map(d => d.label);

export type StartKind = 'sources' | 'own_words' | 'typical' | 'by_hand';
export const START_LABEL: Record<StartKind, string> = { sources: 'Read from the sources', own_words: 'From a person\'s own words', typical: 'From a typical process', by_hand: 'Built by hand' };

export interface Effort {
  startedAt: string | null;
  /** When the process first had steps, and how they came. */
  draftAt: string | null;
  draftFrom: StartKind | null;
  minutesToDraft: number | null;
  /**
   * Every question so far, and how each ended. With the first list known, the lines add up:
   * raised = answered by people + answered from the sources + still open + left with a named person,
   * and still open = only people can answer + found to confirm + can wait. Without it, the same sums
   * hold over the recorded questions alone.
   */
  raised: number;
  answeredByPeople: number;
  answeredFromSources: number;
  deferred: number;
  stillOpen: number;
  /** From the first list, when known. */
  onlyPeopleNow: number | null;
  foundToConfirm: number | null;
  canWait: number | null;
  documents: string[];
}

const BY_PEOPLE_SOURCE = /^(ans|own)-\d+$/;
/** Where an answer came from, read from the note the answer was recorded with. */
export function answerOrigin(answer: string | undefined): 'source' | 'person' {
  const from = /\(from ([^:()]+): "/.exec(answer ?? '');
  return from && !BY_PEOPLE_SOURCE.test(from[1].trim()) ? 'source' : 'person';
}

const earliest = (xs: (string | null | undefined)[]) => xs.filter((x): x is string => Boolean(x)).sort()[0] ?? null;

export function effortOf(i: EffortInput): Effort {
  const startedAt = earliest([...i.sources.map(s => s.createdAt), i.firstRevisionAt]);
  const edits = [...i.edits].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const typical = edits.find(e => /^Started from a typical/.test(e.summary));
  const read = edits.find(e => e.origin === 'extraction' || e.origin === 'import' || e.origin === 'diagram');
  const hasSteps = Boolean(i.model?.steps.length);
  const first = [typical, read].filter((e): e is NonNullable<typeof e> => Boolean(e)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    ?? (hasSteps ? edits.find(e => e.origin === 'user') : undefined);
  const firstSource = [...i.sources].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const draftFrom: StartKind | null = !first ? null : first === typical ? 'typical' : first === read ? (firstSource && /^own-/.test(firstSource.key) ? 'own_words' : 'sources') : 'by_hand';
  const minutes = first && startedAt ? Math.round((Date.parse(first.createdAt) - Date.parse(startedAt)) / 60000) : null;
  const qs = i.model?.openQuestions ?? [];
  const answered = qs.filter(q => q.status === 'answered');
  const byPeople = answered.filter(q => answerOrigin(q.answer) === 'person').length;
  const fromSources = answered.length - byPeople;
  // One basis for what is open: the first list when it is known, the recorded questions otherwise.
  const stillOpen = i.plan ? i.plan.now + i.plan.found + i.plan.wait : qs.filter(q => q.status === 'open').length;
  const deferred = i.plan?.deferred ?? qs.filter(q => q.status === 'deferred').length;
  return {
    startedAt, draftAt: first?.createdAt ?? null, draftFrom, minutesToDraft: minutes !== null && minutes >= 0 ? minutes : null,
    raised: byPeople + fromSources + stillOpen + deferred,
    answeredByPeople: byPeople,
    answeredFromSources: fromSources,
    deferred,
    stillOpen,
    onlyPeopleNow: i.plan?.now ?? null, foundToConfirm: i.plan?.found ?? null, canWait: i.plan?.wait ?? null,
    documents: hasSteps ? i.documents : [],
  };
}

/** "under a minute", "12 minutes", "3 hours 5 minutes", "2 days 4 hours". */
export function durationText(minutes: number): string {
  if (minutes < 1) return 'under a minute';
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60), m = minutes % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (d) return h ? `${part(d, 'day')} ${part(h, 'hour')}` : part(d, 'day');
  if (h) return m ? `${part(h, 'hour')} ${part(m, 'minute')}` : part(h, 'hour');
  return part(m, 'minute');
}

export const NOT_RECORDED = 'Not recorded';

/** The scorecard's lines, in words, each with a value or "Not recorded". */
export function effortLines(e: Effort): { key: string; label: string; value: string }[] {
  const n = (x: number | null) => (x === null ? NOT_RECORDED : String(x));
  return [
    { key: 'draft', label: 'From the first source to a first draft', value: e.minutesToDraft !== null ? durationText(e.minutesToDraft) : e.draftAt ? NOT_RECORDED : 'No draft yet' },
    { key: 'start', label: 'How the first draft came', value: e.draftFrom ? START_LABEL[e.draftFrom] : 'No draft yet' },
    { key: 'raised', label: 'Questions so far, answered and open', value: String(e.raised) },
    { key: 'people', label: 'Answered by people', value: String(e.answeredByPeople) },
    { key: 'sources', label: 'Answered from the sources', value: String(e.answeredFromSources) },
    { key: 'now', label: 'Of those open: only people can answer', value: n(e.onlyPeopleNow) },
    { key: 'found', label: 'Of those open: found in the sources, to confirm', value: n(e.foundToConfirm) },
    { key: 'wait', label: 'Of those open: can wait until sign-off', value: n(e.canWait) },
    ...(e.deferred ? [{ key: 'held', label: 'Left with a named person', value: String(e.deferred) }] : []),
    { key: 'open', label: 'Open questions left', value: String(e.stillOpen) },
    { key: 'docs', label: 'Documents ready', value: e.documents.length ? e.documents.join(', ') : 'None yet' },
  ];
}

export interface EffortTotals {
  processes: number;
  withDraft: number;
  /** The middle time to a first draft, over the processes where both ends are recorded. */
  medianMinutesToDraft: number | null;
  raised: number;
  answeredByPeople: number;
  answeredFromSources: number;
  /** Still open, those left with a named person included, so raised = answered + this. */
  stillOpen: number;
  documents: number;
}

/** Across processes, for the portfolio: sums, and the median time to a first draft. */
export function effortTotals(list: Effort[]): EffortTotals {
  const times = list.map(e => e.minutesToDraft).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const mid = times.length ? (times.length % 2 ? times[(times.length - 1) / 2] : Math.round((times[times.length / 2 - 1] + times[times.length / 2]) / 2)) : null;
  const sum = (k: keyof Effort) => list.reduce((t, e) => t + (e[k] as number), 0);
  return {
    processes: list.length, withDraft: list.filter(e => e.draftAt).length, medianMinutesToDraft: mid,
    raised: sum('raised'), answeredByPeople: sum('answeredByPeople'), answeredFromSources: sum('answeredFromSources'), stillOpen: sum('stillOpen') + sum('deferred'),
    documents: list.reduce((t, e) => t + e.documents.length, 0),
  };
}
