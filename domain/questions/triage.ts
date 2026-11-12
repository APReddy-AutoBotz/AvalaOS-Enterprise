// Turning the raw list of open questions and gaps into the questions that matter, by fixed rules:
// duplicates merged, questions the model already answers set aside, each one grouped by what it
// changes and given a likely owner. Nothing here is decided by AI.
import type { AccessStatus, ElementTarget, OpenQuestion, ProcessModel } from '../processModel/types.ts';
import { gaps, stepsForSystem, type Gap } from '../processModel/selectors.ts';
import type { ProcessAssessment } from '../assess/process.ts';

export type QGroup = 'decides' | 'signoff' | 'detail';
export type QOwner = 'business' | 'it' | 'finance';
export type AnswerKind = 'role' | 'system' | 'number' | 'text' | 'access' | 'free';

export const GROUP_LABEL: Record<QGroup, string> = { decides: 'Changes the recommendation', signoff: 'Needed for sign-off', detail: 'Detail' };
export const OWNER_LABEL: Record<QOwner, string> = { business: 'Process owner or SME', it: 'IT or application owner', finance: 'Finance or controls' };

export interface TriageItem {
  /** Stable while the question is open. */
  key: string;
  question: string;
  target: ElementTarget;
  /** Stored open questions this item answers (none for a gap found by rule). */
  questionIds: string[];
  group: QGroup;
  owner: QOwner;
  /** Where the answer lands. */
  affects: string[];
  kind: AnswerKind;
  /** For merged interface questions: the interfaces to settle, by their index in the system's access list. */
  interfaces?: { index: number; label: string; access: AccessStatus }[];
  /** A person it is assigned to, when deferred. */
  assignedTo: string | null;
  deferred: boolean;
}

export interface Triage {
  items: TriageItem[];
  /** Stored questions the model already answers, with why. */
  alreadyKnown: { questionId: string; question: string; why: string }[];
  /** Raw count before merging, for "50 raised, 20 to answer". */
  raw: number;
}

const IT = /\b(api|apis|sap|system|integration|interface|enable|it|access|fiori|servicenow|landscape|expos\w*|gateway|ocr|tool)\b/i;
const FINANCE = /\b(tolerance|threshold|approv\w*|policy|doa|controller|gl account|lakh|audit|tax|gst|payment terms?)\b/i;
const ORDER: Record<QGroup, number> = { decides: 0, signoff: 1, detail: 2 };
const VALUE_METRICS = new Set(['volume', 'handling_time', 'exception_rate', 'fte']);

function kindOf(t: ElementTarget): AnswerKind {
  if (t.kind === 'step' && t.field === 'roleIds') return 'role';
  if (t.kind === 'step' && t.field === 'systemIds') return 'system';
  if (t.kind === 'exception' && t.field === 'routedToRoleId') return 'role';
  if (t.kind === 'meta' && (t.field === 'objective' || t.field === 'owner')) return 'text';
  if (t.kind === 'metric' && t.field === 'value') return 'number';
  return 'free';
}

/** Whether the model already holds what a stored question asks for. */
function answeredBy(m: ProcessModel, q: OpenQuestion): string | null {
  const t = q.target;
  if (t.kind === 'metric') {
    const x = m.meta.metrics.find(y => y.id === t.id);
    if (x && x.status !== 'unknown' && (x.value !== null || x.range)) return `${x.label} is recorded: ${x.value ?? `${x.range![0]} to ${x.range![1]}`} ${x.unit}.`;
  }
  if (t.kind === 'step' && t.field === 'roleIds') { const s = m.steps.find(y => y.id === t.id); if (s?.roleIds.length) return 'The step now has a role.'; }
  if (t.kind === 'step' && t.field === 'systemIds') { const s = m.steps.find(y => y.id === t.id); if (s?.systemIds.length) return 'The step now has a system.'; }
  if (t.kind === 'meta' && (t.field === 'objective' || t.field === 'owner') && m.meta[t.field].status !== 'unknown') return `The ${t.field} is recorded.`;
  if (t.kind === 'exception' && t.field === 'routedToRoleId') { const e = m.exceptions.find(y => y.id === t.id); if (e?.routedToRoleId) return 'The exception now has a handler.'; }
  return null;
}

function classify(m: ProcessModel, t: ElementTarget, text: string, open: Set<string>): { group: QGroup; owner: QOwner; affects: string[] } {
  switch (t.kind) {
    case 'system': {
      const used = stepsForSystem(m, t.id!).filter(s => open.has(s.id)).length;
      return { group: used ? 'decides' : 'detail', owner: 'it', affects: [`Assessment: ${used} ${used === 1 ? 'step' : 'steps'} use it`, 'PDD 2.2 Applications'] };
    }
    case 'step': return { group: 'signoff', owner: 'business', affects: ['PDD 2.4 Detailed steps', 'BRD stakeholders'] };
    case 'exception': return { group: 'signoff', owner: 'business', affects: ['PDD 3.6 Exception handling'] };
    case 'gateway': return { group: 'signoff', owner: 'business', affects: ['PDD 2.5 Decision points', 'Process map'] };
    case 'metric': {
      const x = m.meta.metrics.find(y => y.id === t.id);
      const value = x && VALUE_METRICS.has(x.kind) && (!x.appliesTo || x.appliesTo === 'process');
      return { group: value ? 'decides' : 'detail', owner: 'business', affects: value ? ['Value and priority', 'BRD benefits'] : ['PDD 2.1 Process overview'] };
    }
    case 'meta':
      if (t.field === 'owner' || t.field === 'objective') return { group: 'signoff', owner: 'business', affects: ['BRD 2 and 5', 'PDD 1.2 and 1.3'] };
      break;
  }
  if (FINANCE.test(text)) return { group: 'signoff', owner: 'finance', affects: ['Business rules', 'BRD 8'] };
  if (IT.test(text)) return { group: 'decides', owner: 'it', affects: ['Assessment', 'PDD 2.2 Applications'] };
  return { group: 'detail', owner: 'business', affects: ['PDD'] };
}

export function triage(m: ProcessModel, a: ProcessAssessment): Triage {
  const openSteps = new Set(a.steps.filter(s => !s.alreadyAutomated && !s.mustStayHuman).map(s => s.stepId));
  const stored = m.openQuestions.filter(q => q.status === 'open' || q.status === 'deferred');
  const alreadyKnown: Triage['alreadyKnown'] = [];
  const items: TriageItem[] = [];
  const bySystem = new Map<string, OpenQuestion[]>();

  for (const q of stored) {
    const why = q.status === 'open' ? answeredBy(m, q) : null;
    if (why) { alreadyKnown.push({ questionId: q.id, question: q.question, why }); continue; }
    if (q.target.kind === 'system' && q.target.field === 'access' && q.target.id) {
      bySystem.set(q.target.id, [...(bySystem.get(q.target.id) ?? []), q]);
      continue;
    }
    items.push({ key: q.id, question: q.question, target: q.target, questionIds: [q.id], kind: kindOf(q.target), assignedTo: q.owner, deferred: q.status === 'deferred', ...classify(m, q.target, q.question, openSteps) });
  }

  // One question per system about its interfaces, however many were raised.
  const systemIds = new Set([...bySystem.keys(), ...gaps(m).filter(g => g.kind === 'system_access_unknown').map(g => g.target.id!)]);
  for (const id of systemIds) {
    const sys = m.systems.find(s => s.id === id);
    if (!sys) continue;
    const qs = bySystem.get(id) ?? [];
    const interfaces = sys.access.map((x, index) => ({ index, label: `${x.method.toUpperCase()}${x.name ? `: ${x.name}` : ''}${x.operations.length ? ` (${x.operations.slice(0, 3).join(', ')}${x.operations.length > 3 ? ', …' : ''})` : ''}`, access: x.access })).filter(x => x.access === 'unknown' || x.access === 'reported');
    const question = interfaces.length
      ? `Which ${sys.name} interfaces can the automation use? ${interfaces.length} ${interfaces.length === 1 ? 'is' : 'are'} not confirmed.`
      : `How can ${sys.name} be accessed by the automation (API, screens, file)?`;
    items.push({ key: `system:${id}`, question, target: { kind: 'system', id, field: 'access' }, questionIds: qs.map(q => q.id), kind: interfaces.length ? 'access' : 'free', interfaces,
      assignedTo: qs.find(q => q.owner)?.owner ?? null, deferred: qs.length > 0 && qs.every(q => q.status === 'deferred'), ...classify(m, { kind: 'system', id }, question, openSteps) });
  }

  // Gaps found by rule that no stored question covers.
  const covered = (g: Gap) => stored.some(q => q.target.kind === g.target.kind && q.target.id === g.target.id && q.target.field === g.target.field);
  for (const g of gaps(m)) {
    if (g.kind === 'system_access_unknown' || covered(g)) continue;
    if (g.kind === 'unsourced_assumption') continue; // confirmed in the Process stage, not by a question
    items.push({ key: `gap:${g.kind}:${g.target.kind}:${g.target.id ?? ''}:${g.target.field ?? ''}`, question: g.label, target: g.target, questionIds: [], kind: kindOf(g.target), assignedTo: null, deferred: false, ...classify(m, g.target, g.label, openSteps) });
  }
  for (const e of m.exceptions.filter(x => !x.routedToRoleId)) {
    const target: ElementTarget = { kind: 'exception', id: e.id, field: 'routedToRoleId' };
    if (stored.some(q => q.target.kind === 'exception' && q.target.id === e.id)) continue;
    items.push({ key: `gap:route:${e.id}`, question: `Who handles the exception "${e.name}"?`, target, questionIds: [], kind: 'role', assignedTo: null, deferred: false, ...classify(m, target, '', openSteps) });
  }

  items.sort((x, y) => Number(x.deferred) - Number(y.deferred) || ORDER[x.group] - ORDER[y.group] || x.owner.localeCompare(y.owner));
  const gapCount = gaps(m).length + m.exceptions.filter(x => !x.routedToRoleId).length;
  return { items, alreadyKnown, raw: stored.length + gapCount };
}
