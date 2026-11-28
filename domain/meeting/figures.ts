// A figure answered in a call (preview walk, 28 November 2026): the reading gives the number only, so the unit and
// the period are read from the note's own words by rule, never by the AI, and shown with the number ("This would
// record: 40 minutes"). When the words name neither, or more than one, the review asks before the figure is kept.
import { periodFrom, type Period } from '../discovery/inputs.ts';

export type TimeUnit = 'minutes' | 'hours';

const UNIT_WORDS: [RegExp, TimeUnit][] = [
  [/\b(minutes?|mins?)\b/i, 'minutes'],
  [/\b(hours?|hrs?)\b/i, 'hours'],
];

/** The unit a time said in words is in ("about 40 minutes"); null when the words name none, or both. */
export function unitFrom(text: string): TimeUnit | null {
  const hits = UNIT_WORDS.filter(([re]) => re.test(text)).map(([, u]) => u);
  return hits.length === 1 ? hits[0]! : null;
}

/** The figure inputs a call records, by their card's key: what the number counts, and what it needs said with it. */
export const FIGURE_INPUTS = { 'input:volume': 'period', 'input:time': 'unit' } as const;
export type FigureKey = keyof typeof FIGURE_INPUTS;
export const isFigure = (key: string): key is FigureKey => Object.hasOwn(FIGURE_INPUTS, key);

/** What a figure needs said with it that the note does not say: its period, or its unit. */
export function figureNeeds(key: string, noteText: string): 'period' | 'unit' | null {
  if (!isFigure(key)) return null;
  if (FIGURE_INPUTS[key] === 'period') return periodFrom(noteText) ? null : 'period';
  return unitFrom(noteText) ? null : 'unit';
}

const one = (n: number, word: string) => (n === 1 ? word.replace(/s$/, '') : word);

/**
 * A figure in words, with what it counts: "500 cases a month", "40 minutes"; with what is not said yet when it is
 * missing ("500 cases, the period not said", "40, minutes or hours not said"). Anything that is not a figure input is
 * shown as given.
 */
export function figureText(key: string, display: string, said: { period?: Period | null; unit?: TimeUnit | null } = {}): string {
  if (!isFigure(key)) return display;
  const n = Number(display);
  if (!Number.isFinite(n)) return display;
  if (key === 'input:volume') return said.period ? `${display} ${one(n, 'cases')} a ${said.period}` : `${display} ${one(n, 'cases')}, the period not said`;
  return said.unit ? `${display} ${one(n, said.unit)}` : `${display}, minutes or hours not said`;
}

/** A figure in words as its note says it. */
export const figureFromNote = (key: string, display: string, noteText: string): string =>
  figureText(key, display, { period: periodFrom(noteText), unit: unitFrom(noteText) });
