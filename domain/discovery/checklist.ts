// What a discovery session asks by rule, before any AI (package B, plan section 1, steps 3 to 5, and
// section 6): the first cards (what is wanted from the process, whether the work is done today) when not
// answered; the shape of the process (what starts it, the steps, who does each, in which application, what
// ends it); and one card for each open conflict, with both quotes. Every card names its gap or its quotes.
import type { ProcessModel, Step } from '../processModel/types.ts';
import { gaps, orderedSteps } from '../processModel/selectors.ts';
import { PURPOSE_LABEL } from '../plan/purpose.ts';
import { DONE_TODAY_LABEL } from '../plan/delivery.ts';
import { makeCard, type Card } from './card.ts';

/** The key the triage gives a gap found by rule (domain/questions/triage.ts), so the existing answer writes it. */
const gapKey = (kind: string, t: { kind: string; id?: string; field?: string }) => `gap:${kind}:${t.kind}:${t.id ?? ''}:${t.field ?? ''}`;

export interface ChecklistContext {
  /** Whether the organisation's set-up asks what is wanted from the process (`offersPurpose`). */
  asksPurpose: boolean;
}

/** The first cards: each only when not answered. */
export function startCards(m: ProcessModel, ctx: ChecklistContext): Card[] {
  const out: (Card | null)[] = [];
  if (ctx.asksPurpose && !m.meta.purpose) out.push(makeCard({
    key: 'start:purpose', group: 'start', origin: { kind: 'gap', gap: 'Not said yet: what you want from this process.' },
    question: 'What do you want from this process?', why: 'It decides whether the process is assessed, and which documents it gets.',
    target: { kind: 'meta', field: 'purpose' }, updates: ['What is wanted from the process'], answer: 'choose',
    choices: (['assess', 'as_is', 'decided'] as const).map(v => [v, PURPOSE_LABEL[v]] as [string, string]),
  }));
  const done = m.meta.brief?.doneToday;
  if (!done || done.status === 'unknown') out.push(makeCard({
    key: 'start:doneToday', group: 'start', origin: { kind: 'gap', gap: 'Not said yet: whether the work is done today.' },
    question: 'Is the work done today?', why: 'Work done today is documented as it runs; work not done today is described as it should run.',
    target: { kind: 'meta', field: 'brief.doneToday' }, updates: ['The brief'], answer: 'choose',
    choices: [...(['yes', 'partly', 'no'] as const).map(v => [v, DONE_TODAY_LABEL[v]] as [string, string]), ['unknown', 'Not sure yet']],
  }));
  return out.filter((c): c is Card => c !== null);
}

/**
 * The shape of the process. What starts it, the steps and what ends it can only be answered in words that
 * wait for the next update of the draft (no edit adds an event or a step from an answer). Who does a step,
 * and in which application, is read into a value when the draft has roles or applications to choose from,
 * and otherwise waits too.
 */
export function shapeCards(m: ProcessModel): Card[] {
  const out: (Card | null)[] = [];
  const steps = orderedSteps(m);
  if (!steps.length) out.push(makeCard({
    key: 'shape:steps', group: 'shape', origin: { kind: 'gap', gap: 'No step is recorded yet.' },
    question: 'What are the steps of the work, in order, from the first to the last?', why: 'Every document and the assessment are built from the steps.',
    target: { kind: 'meta', field: 'steps' }, updates: ['The steps', 'Both maps'], answer: 'waits',
  }));
  if (!m.events.some(e => e.kind === 'start')) out.push(makeCard({
    key: 'shape:start', group: 'shape', origin: { kind: 'gap', gap: 'No step says what starts the work.' },
    question: 'What starts the work: what arrives, or who asks for it?', why: 'The maps and the documents begin where the work begins.',
    target: { kind: 'meta', field: 'start' }, updates: ['The start of the process', 'Both maps'], answer: 'waits',
  }));
  const byStep = new Map<string, Step>(steps.map(s => [s.id, s]));
  const found = gaps(m).filter(g => (g.kind === 'step_without_role' || g.kind === 'step_without_system') && g.target.id && byStep.has(g.target.id));
  // In the order of the steps, who before which application.
  const order = new Map(steps.map((s, i) => [s.id, i]));
  found.sort((a, b) => order.get(a.target.id!)! - order.get(b.target.id!)! || (a.kind === 'step_without_role' ? -1 : 1));
  for (const g of found) {
    const step = byStep.get(g.target.id!)!;
    const role = g.kind === 'step_without_role';
    const listed = role ? m.roles.length > 0 : m.systems.length > 0;
    out.push(makeCard({
      key: gapKey(g.kind, g.target), itemKey: gapKey(g.kind, g.target), group: 'shape',
      origin: { kind: 'gap', gap: role ? `No one is recorded doing "${step.name}".` : `No application is recorded for "${step.name}".` },
      question: g.label, why: role ? 'Assessment and documents need who does each step.' : 'How a step could be automated depends on the application it is done in.',
      target: g.target, updates: [role ? 'Who does the step' : 'The applications of the step', 'Both maps'], answer: listed ? 'words' : 'waits',
    }));
  }
  if (!m.events.some(e => e.kind === 'end')) out.push(makeCard({
    key: 'shape:end', group: 'shape', origin: { kind: 'gap', gap: 'No step says when the work is finished.' },
    question: 'When is a case finished: what is the last thing that happens?', why: 'The maps and the documents end where the work ends.',
    target: { kind: 'meta', field: 'end' }, updates: ['The end of the process', 'Both maps'], answer: 'waits',
  }));
  return out.filter((c): c is Card => c !== null);
}

/** One card for each open conflict whose sides each quote their words; the answer is one of its values. */
export function conflictCards(m: ProcessModel): Card[] {
  return m.conflicts.filter(c => !c.resolution).map(c => {
    const values = c.values.map(v => ({ value: v.value, quote: v.sources[0]! })).filter(v => v.quote);
    if (values.length !== c.values.length) return null;
    const summary = c.summary.length > 150 ? `${c.summary.slice(0, 147)}…` : c.summary;
    return makeCard({
      key: `conflict:${c.id}`, group: 'conflict', origin: { kind: 'conflict', conflictId: c.id, values },
      question: `Which is right? ${summary}`, why: 'The process cannot say two different things; a person chooses.',
      target: c.target, updates: ['The value the process keeps'], answer: 'choose',
      choices: c.values.map(v => [v.value, v.value] as [string, string]),
    });
  }).filter((c): c is Card => c !== null);
}
