// The order of a discovery session's cards (package B, plan sections 1 and 6), decided by rules only:
// the first cards; the shape of the process in step order; open conflicts; the questions that could
// change the recommendation (or settle the decided approach); questions raised from what was said, in the
// order said; the inputs that would sharpen the assessment; then what is needed for sign-off. A skipped
// card goes to the end. The same inputs give the same cards in the same order.
import type { ProcessModel } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { groupLabel, triage, type Triage, type TriageItem } from '../questions/triage.ts';
import { whyItMatters } from '../questions/interview.ts';
import { NO_WAY_IN, NO_WAY_IN_LABEL, WAYS } from '../questions/ways.ts';
import { makeCard, type Card, type CardGroup, type CardOrigin } from './card.ts';
import { conflictCards, shapeCards, startCards } from './checklist.ts';
import { inputCards } from './inputs.ts';

export interface QueueInput {
  model: ProcessModel;
  assessment: ProcessAssessment;
  /** Whether the organisation's set-up asks what is wanted from the process. */
  asksPurpose: boolean;
  /** Questions raised from what was said and not yet acted on, in the order said (notice.ts). */
  raised?: Card[];
  /** Card keys the person skipped in this session, in the order skipped. */
  skipped?: string[];
  /** The triage, when the screen already has it. */
  triage?: Triage;
}

const GROUP_RANK: Record<CardGroup, number> = { start: 0, shape: 1, conflict: 2, decides: 3, settles: 3, said: 4, input: 5, signoff: 6 };

/** What is missing, in words, for a question the triage lists. */
function gapFor(item: TriageItem, m: ProcessModel): string {
  const t = item.target;
  const name = (list: { id: string; name: string }[]) => list.find(x => x.id === t.id)?.name;
  if (t.kind === 'system' && t.field === 'access') return `Not confirmed yet: how the automation can use ${name(m.systems) ?? 'this application'}.`;
  if (t.kind === 'step') return `Not recorded yet for "${name(m.steps) ?? 'this step'}".`;
  if (t.kind === 'meta' && (t.field === 'objective' || t.field === 'owner')) return `Not recorded yet: the process ${t.field}.`;
  if (t.kind === 'rule') return `Not recorded yet for the rule "${name(m.rules) ?? 'this rule'}".`;
  if (t.kind === 'metric') return 'Not recorded yet: this figure.';
  return 'Asked, and not answered yet.';
}

/** The choices of a ways-in card: each way by its index, then "No way in". */
const waysChoices = (): [string, string][] => [...WAYS.map((w, i) => [String(i), w.label] as [string, string]), [NO_WAY_IN, NO_WAY_IN_LABEL]];

/** A card for a question the triage lists: its quote when a session raised it, else its gap in words. */
export function triageCard(item: TriageItem, m: ProcessModel): Card | null {
  const stored = m.openQuestions.find(q => item.questionIds.includes(q.id) && q.raisedBy);
  const origin: CardOrigin = stored?.raisedBy ? { kind: 'quote', quote: stored.raisedBy } : { kind: 'gap', gap: gapFor(item, m) };
  const label = groupLabel(item);
  const group: CardGroup = item.group === 'decides' ? (label === 'Settles the decided approach' ? 'settles' : 'decides') : stored?.raisedBy ? 'said' : 'signoff';
  return makeCard({
    key: `item:${item.key}`, itemKey: item.key, group, origin, question: item.question, why: whyItMatters(item), target: item.target, updates: item.affects,
    // An application with no way in recorded is chosen, way by way or "No way in", never asked in plain words.
    answer: item.kind === 'choice' || item.kind === 'ways' ? 'choose' : 'words',
    ...(item.kind === 'ways' ? { choices: waysChoices() } : item.choices ? { choices: item.choices } : {}),
  });
}

/** The session's cards in the order they are asked. */
export function discoveryQueue(i: QueueInput): Card[] {
  const m = i.model;
  const t = i.triage ?? triage(m, i.assessment);
  // A question about the shape left with someone is not asked again in the session: leaving it records a deferred
  // question on the same target (who does the step, or in which application), so its card is dropped by target.
  const at = (x: { kind: string; id?: string | null; field?: string | null }) => `${x.kind}:${x.id ?? ''}:${x.field ?? ''}`;
  const left = new Set(t.items.filter(x => x.deferred && x.target).map(x => at(x.target!)));
  const shape = shapeCards(m).filter(c => !c.itemKey || !left.has(at(c.target)));
  const inShape = new Set(shape.map(c => c.itemKey).filter(Boolean));
  const items = t.items.filter(x => !x.deferred && !inShape.has(x.key)).map(x => triageCard(x, m)).filter((c): c is Card => c !== null);
  const all = [...startCards(m, { asksPurpose: i.asksPurpose }), ...shape, ...conflictCards(m), ...items, ...(i.raised ?? []), ...inputCards(m, i.assessment)];
  // One card per key, the first kept; a stable sort by group keeps each group's own order.
  const seen = new Set<string>();
  const unique = all.filter(c => (seen.has(c.key) ? false : (seen.add(c.key), true)));
  const ordered = unique.map((c, n) => ({ c, n })).sort((a, b) => GROUP_RANK[a.c.group] - GROUP_RANK[b.c.group] || a.n - b.n).map(x => x.c);
  const skipped = i.skipped ?? [];
  return [...ordered.filter(c => !skipped.includes(c.key)), ...skipped.map(k => ordered.find(c => c.key === k)).filter((c): c is Card => Boolean(c))];
}
