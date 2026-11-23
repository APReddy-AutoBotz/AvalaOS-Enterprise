// How the automation reaches an application with no way in recorded (plan `claude/no-way-in-answer-plan-23-nov.md`,
// approved by the owner on 23 November 2026). Such an application's question is asked as a choice of ways in,
// answer kind `ways`: each of the six with "Can be used", "Exists, not confirmed for use" or "Not available",
// or "No way in: a person does this". Words are read into the same choices; words that settle no way in
// record nothing, so a question is never answered while it stays open. Before Save the card says what will be
// recorded and, for "No way in", what happens to the steps done in the application.
import type { AccessMethodKind, AccessStatus, ProcessModel } from '../processModel/types.ts';
import { addWayIn, setSystemUiAllowed, type OpResult } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { APPROACH_LABEL } from '../assess/scoring.ts';
import { orderedSteps } from '../processModel/selectors.ts';
import type { TriageItem } from './triage.ts';

/** The six ways in, in the order they are offered; a way's index is its place here. */
export const WAYS: readonly { method: AccessMethodKind; label: string }[] = [
  { method: 'api', label: 'API' }, { method: 'ui', label: 'Screens' }, { method: 'file', label: 'File' },
  { method: 'database', label: 'Database' }, { method: 'event', label: 'Event' }, { method: 'email', label: 'Email' },
];

/** The pick for "No way in: a person does this". */
export const NO_WAY_IN = 'none';
export const NO_WAY_IN_LABEL = 'No way in: a person does this';
export const NO_WAY_IN_NOTE = 'No way in: a person does this.';

const STATUS_WORDS: Record<AccessStatus, string> = { confirmed: 'can be used', reported: 'exists, not confirmed for use', confirmed_absent: 'not available', unknown: 'not known' };

/** The six ways as a question's interfaces, every one unknown. */
export const waysInterfaces = (): { index: number; label: string; access: AccessStatus }[] => WAYS.map((w, index) => ({ index, label: w.label, access: 'unknown' as const }));

/** The ways a person settled, by index. */
const settled = (statuses: Record<number, AccessStatus> = {}) => WAYS.map((w, i) => ({ ...w, access: statuses[i] ?? 'unknown' })).filter(w => w.access !== 'unknown');

/** The answer in words, as the question is closed with it; null when nothing is settled. */
export function waysNote(a: { pick?: string; statuses?: Record<number, AccessStatus> }): string | null {
  if (a.pick === NO_WAY_IN) return NO_WAY_IN_NOTE;
  const s = settled(a.statuses);
  return s.length ? `Ways in: ${s.map(w => `${w.label} ${STATUS_WORDS[w.access]}`).join('; ')}.` : null;
}

/** The edit: one way in per way settled (the existing shape, confirmed by a person); for "No way in", screens and API not available and robots not allowed on the screens. Null when nothing is settled. */
export function waysEdit(systemId: string, a: { pick?: string; statuses?: Record<number, AccessStatus> }): ((m: ProcessModel) => OpResult)[] | null {
  if (a.pick === NO_WAY_IN) return [
    m => addWayIn(m, { systemId, method: 'api', access: 'confirmed_absent' }),
    m => addWayIn(m, { systemId, method: 'ui', access: 'confirmed_absent' }),
    m => setSystemUiAllowed(m, { systemId, value: false }),
  ];
  const s = settled(a.statuses);
  return s.length ? s.map(w => (m: ProcessModel) => addWayIn(m, { systemId, method: w.method, access: w.access })) : null;
}

/**
 * "This will record: …" before Save, with the consequence for "No way in": which steps done in the
 * application then stay with a person, worked out by the assessment on the process as it would be.
 * Null when nothing is chosen yet.
 */
export function waysRecordLine(m: ProcessModel, item: TriageItem, a: { pick?: string; statuses?: Record<number, AccessStatus> }): string | null {
  const sys = m.systems.find(s => s.id === item.target.id);
  const ops = sys && waysEdit(sys.id, a);
  if (!sys || !ops) return null;
  if (a.pick !== NO_WAY_IN) return `This will record for ${sys.name}: ${settled(a.statuses).map(w => `${w.label} ${STATUS_WORDS[w.access]}`).join('; ')}.`;
  const after = ops.reduce((x, op) => op(x).model, m);
  const steps = orderedSteps(m).filter(s => s.systemIds.includes(sys.id));
  const scored = new Map(assessProcess(after).steps.map(s => [s.stepId, s]));
  const human = steps.filter(s => scored.get(s.id)?.winner === 'human').map(s => `"${s.name}"`);
  const other = steps.map(s => ({ s, r: scored.get(s.id) })).filter(x => x.r && !x.r.alreadyAutomated && x.r.winner !== 'human')
    .map(x => `"${x.s.name}" is still recommended for ${APPROACH_LABEL[x.r!.winner].toLowerCase()}, which does not need a way into ${sys.name}`);
  const base = `This will record: no way in to ${sys.name}; a person does the work in it.`;
  if (!steps.length) return `${base} No step is done in it.`;
  const parts = [
    human.length ? `The ${human.length === 1 ? 'step' : 'steps'} done in it then ${human.length === 1 ? 'stays' : 'stay'} with a person: ${human.join(', ')}.` : '',
    other.length ? `${other.join('; ')}.` : '',
  ].filter(Boolean);
  return `${base} ${parts.join(' ') || `The ${steps.length === 1 ? 'step' : 'steps'} done in it ${steps.length === 1 ? 'is' : 'are'} not assessed on how the automation reaches ${sys.name}, so no recommendation changes.`}`;
}

/** Earlier worded answers to this application's access question, kept on stored questions: "You answered earlier: …". */
export function earlierAnswers(m: ProcessModel, item: TriageItem): string[] {
  if (item.target.kind !== 'system') return [];
  return m.openQuestions.filter(q => q.status === 'answered' && q.target.kind === 'system' && q.target.id === item.target.id && q.target.field === 'access' && q.answer?.trim()).map(q => q.answer!.trim());
}
