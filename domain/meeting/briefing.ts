// The briefing before a requirements call (package C, plan `claude/package-c-plan-26-nov.md`, section 4.1): what is
// open on the process, in the order to ask it, for the kinds of person on the call, fitted to the call's length,
// with everyone else's questions under "Not for this call". Rules only: no AI is asked and nothing is saved. The
// order is the Discovery session's (`discoveryQueue`), with the owner's two changes of 26 November 2026: the
// briefing leaves out "What do you want from this process?" (the organisation's own choice, not a question for the
// client), and on a process that already has an assessment the questions that could change the recommendation come
// first, then the conflicts, then the shape of the process (`ASSESSED_ORDER`). The same record, the same people and
// the same length give the same briefing.
import type { ProcessModel } from '../processModel/types.ts';
import type { ProcessAssessment } from '../assess/process.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import { decidedOf, purposeOf } from '../plan/purpose.ts';
import { triage as triageOf, type QOwner, type Triage, type TriageItem } from '../questions/triage.ts';
import { couldChange, whoToAsk, type AskGroup } from '../questions/result.ts';
import { GROUP_HEADING, makeCard, type Card } from '../discovery/card.ts';
import { askedParts, coveringItem, discoveryQueue, triageCard } from '../discovery/queue.ts';
import { conflictCards } from '../discovery/checklist.ts';
import type { Attendee, CallLength, OwnQuestion } from './kept.ts';
import { CALL_WORDS } from './words.ts';

/** The opening of a call, then the time a question takes (decision 5: working defaults the owner may change). */
export const OPENING_MINUTES = 5;
export const MINUTES_A_QUESTION = 3;

/** The card the briefing never lists: what is wanted from the process is the organisation's own choice (owner, 26 November 2026). */
export const NOT_FOR_A_CALL = ['start:purpose'] as const;

/**
 * The order of the groups on a process that already has an assessment (owner, 26 November 2026): what could change
 * the recommendation (or settles the decided approach) first, then the conflicts, then the shape of the process; the
 * rest as Discovery has it. Without an assessment the order stays Discovery's.
 */
export const ASSESSED_ORDER: Record<Card['group'], number> = { decides: 0, settles: 0, conflict: 1, start: 2, shape: 2, said: 3, input: 4, signoff: 5 };

/** Whether the process already has an assessment: steps assessed, and not a process documented as it is. */
export const hasAssessment = (m: ProcessModel, a: ProcessAssessment): boolean => a.assessed > 0 && purposeOf(m) !== 'as_is';

/** How many questions fit a call of this length: 8, 13 and 18 for 30, 45 and 60 minutes. */
export const fits = (minutes: number): number => Math.max(1, Math.floor((minutes - OPENING_MINUTES) / MINUTES_A_QUESTION));

export interface BriefItem {
  card: Card;
  /** The kind of person who can answer it. */
  owner: QOwner;
  /** The name typed for that kind of person on the call, when one was. */
  name?: string;
  /** The name it is left with, when that person is on the call. */
  leftWith?: string;
  /** A question of the analyst's own. */
  own?: boolean;
}

export interface Briefing {
  /** "Where the process stands": one to three lines. */
  standing: string[];
  /** "What is open": one line, each part only when it is not zero; null when nothing is open. */
  openLine: string | null;
  forCall: BriefItem[];
  ifTime: BriefItem[];
  /** Left out by the analyst, to bring back. */
  leftOut: BriefItem[];
  /** The open questions no one on the call can answer, by who to ask. */
  elsewhere: AskGroup[];
  fits: number;
}

export interface BriefingInput {
  model: ProcessModel;
  assessment: ProcessAssessment;
  /** Whether the organisation's set-up asks what is wanted from the process. */
  asksPurpose: boolean;
  attendees: Attendee[];
  minutes: CallLength;
  arranged?: { order: string[]; leftOut: string[] };
  own?: OwnQuestion[];
  /** How many sources the process has (the store knows; the model does not). */
  sources: number;
  /** Answers waiting in a Discovery session for the next update of the draft. */
  waitingInDiscovery?: number;
  triage?: Triage;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Who can answer a card: the triage item's kind of person when the card stands for one; whether an application
 * has an API, and an application's access, the IT or application owner; anything else about the shape of the
 * process, a conflict, the first cards and the inputs, the process owner or SME.
 */
export function ownerOf(card: Card, t: Triage): QOwner {
  const item = coveringItem(card, t);
  if (item) return item.owner;
  if (card.key === 'input:api' || card.target.kind === 'system') return 'it';
  return 'business';
}

/** A question of the analyst's own as a card: its origin says it is theirs, about the process as a whole. */
export function ownCard(q: OwnQuestion): Card | null {
  return makeCard({ key: `own:${q.key}`, group: 'said', origin: { kind: 'gap', gap: CALL_WORDS.ownGap }, question: q.question, why: 'You added it for this call.', target: { kind: 'meta', field: 'flow' }, updates: ['The open questions, if you keep it'], answer: 'waits' });
}

/** The heading of a briefing line or a suggestion: the card's group, or "Your own question". */
export const itemHeading = (i: Pick<BriefItem, 'card' | 'own'>): string => (i.own ? CALL_WORDS.ownHeading : GROUP_HEADING[i.card.group]);

/** The analyst's order applied: the keys in their order first, anything new after in the rules' order; left out apart. */
export function arrange<T extends { card: Card }>(items: T[], arranged?: { order: string[]; leftOut: string[] }): { kept: T[]; leftOut: T[] } {
  const out = new Set(arranged?.leftOut ?? []);
  const order = arranged?.order ?? [];
  const pos = (k: string) => { const i = order.indexOf(k); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const kept = items.filter(i => !out.has(i.card.key)).map((i, n) => ({ i, n })).sort((a, b) => pos(a.i.card.key) - pos(b.i.card.key) || a.n - b.n).map(x => x.i);
  return { kept, leftOut: items.filter(i => out.has(i.card.key)) };
}

/** "Move up" and "Move down": the new order of keys, from the list as shown. */
export function moveItem(shown: string[], key: string, by: -1 | 1): string[] {
  const i = shown.indexOf(key), j = i + by;
  if (i < 0 || j < 0 || j >= shown.length) return shown;
  const next = [...shown];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

function standing(i: BriefingInput): string[] {
  const m = i.model;
  const lines = [m.steps.length ? CALL_WORDS.standingCounts(m.steps.length, m.roles.length, m.systems.length, i.sources) : CALL_WORDS.noSteps];
  const decided = decidedOf(m);
  if (purposeOf(m) === 'as_is') lines.push(CALL_WORDS.asIs);
  else if (decided && purposeOf(m) === 'decided') lines.push(CALL_WORDS.decided(APPROACH_LABEL[decided.approach]));
  else if (m.steps.length && i.assessment.assessed > 0) lines.push(CALL_WORDS.assessed(i.assessment.verdict));
  if (i.waitingInDiscovery) lines.push(CALL_WORDS.waitingFromDiscovery(i.waitingInDiscovery));
  return lines;
}

function openLine(m: ProcessModel, t: Triage, shape: number): string | null {
  const open = t.items.filter(x => !x.deferred);
  const decides = open.filter(couldChange).length;
  const conflicts = conflictCards(m).length;
  const signoff = open.filter(x => x.group === 'signoff').length;
  const left = t.items.filter(x => x.deferred).length;
  const parts = [
    decides && `${decides} could change the recommendation`,
    shape && `${shape} about the shape of the process`,
    conflicts && `${conflicts} where the sources disagree`,
    signoff && `${signoff} needed for sign-off`,
    left && `${left} left with someone`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function buildBriefing(i: BriefingInput): Briefing {
  const m = i.model;
  const t = i.triage ?? triageOf(m, i.assessment);
  const kinds = new Set(i.attendees.map(a => a.kind));
  const nameFor = (k: QOwner) => i.attendees.find(a => a.kind === k && a.name)?.name;
  const names = i.attendees.map(a => a.name).filter((n): n is string => Boolean(n));
  const item = (card: Card, extra: Partial<BriefItem> = {}): BriefItem => {
    const owner = extra.owner ?? ownerOf(card, t);
    const name = nameFor(owner);
    return { card, owner, ...(name ? { name } : {}), ...extra };
  };

  // 1. Questions left with a person named on the call (a deferred question is not in the queue).
  const withThem = t.items.filter((x: TriageItem) => x.deferred && x.assignedTo && names.some(n => same(n, x.assignedTo!)))
    .map(x => { const c = triageCard(x, m); return c ? item(c, { owner: x.owner, leftWith: x.assignedTo! }) : null; })
    .filter((x): x is BriefItem => x !== null);
  // 2. The analyst's own questions.
  const own = (i.own ?? []).map(q => { const c = ownCard(q); return c ? item(c, { owner: 'business', own: true }) : null; }).filter((x): x is BriefItem => x !== null);
  // 3. The Discovery order, for the kinds of person on the call, without what is not for a call; on a process that
  // already has an assessment, what could change the recommendation first, then the conflicts, then the shape.
  const discovery = discoveryQueue({ model: m, assessment: i.assessment, asksPurpose: i.asksPurpose, triage: t })
    .filter(c => !(NOT_FOR_A_CALL as readonly string[]).includes(c.key));
  const ordered = hasAssessment(m, i.assessment)
    ? discovery.map((c, n) => ({ c, n })).sort((x, y) => ASSESSED_ORDER[x.c.group] - ASSESSED_ORDER[y.c.group] || x.n - y.n).map(x => x.c)
    : discovery;
  const queue = ordered.map(c => item(c)).filter(x => kinds.has(x.owner));
  const seen = new Set<string>();
  const all = [...withThem, ...own, ...queue].filter(x => (seen.has(x.card.key) ? false : (seen.add(x.card.key), true)));
  const { kept, leftOut } = arrange(all, i.arranged);
  const n = fits(i.minutes);

  // Everyone else's questions, by who to ask: the kinds of person not on the call, and what is left with someone not on it.
  const listed = new Set(kept.concat(leftOut).map(x => coveringItem(x.card, t)?.key).filter(Boolean));
  const elsewhere = whoToAsk(t.items.filter(x => !listed.has(x.key) && (x.deferred ? !(x.assignedTo && names.some(nm => same(nm, x.assignedTo!))) : !kinds.has(x.owner))));

  return {
    standing: standing(i), openLine: openLine(m, t, askedParts(m, t).shape.length),
    forCall: kept.slice(0, n), ifTime: kept.slice(n), leftOut, elsewhere, fits: n,
  };
}

/**
 * "Copy the agenda": the numbered questions only, no origins, no "why it matters", no internal labels, so it can be
 * pasted into a meeting invitation; those that may not fit under "If there is time".
 */
export function agendaText(b: Pick<Briefing, 'forCall' | 'ifTime'>): string {
  const line = (x: BriefItem, i: number) => `${i + 1}. ${x.card.question}`;
  const first = b.forCall.map(line);
  const rest = b.ifTime.map((x, i) => line(x, i + b.forCall.length));
  return [...first, ...(rest.length ? ['', 'If there is time:', ...rest] : [])].join('\n');
}
