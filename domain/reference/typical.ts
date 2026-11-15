// A typical process to start from (docs/effort-first-plan.md, part I; agreed by the owner on
// 15 November 2026 as the one change to the rule "Invent nothing"). A reference process is written by
// Avala OS and checked by the owner before it ships; nothing is pulled from the web for a client.
// Everything it gives a process is marked "typical" and stays so until a person confirms it: in the
// record (`FactStatus` 'typical'), on screen ("Typical, not confirmed"), in documents, and in the
// assessment, which is provisional while typical steps remain. Never taken from a reference: volumes,
// times, costs, or whether an application has an API (a reference has no field for them, and a test
// keeps them out). With documents present, the reference is a checklist of what a typical process has
// that the sources do not mention.
import type { ExceptionPath, Flow, Gateway, ProcessEvent, ProcessModel, Role, Step, SystemRef } from '../processModel/types.ts';
import { contentWords, wordOverlap } from '../questions/triage.ts';
import { AP_INVOICE } from './apInvoice.ts';

export interface ReferenceProcess {
  id: string;
  /** Its name in plain words, for "Start from a typical …". */
  name: string;
  /** Words in a process name that suggest this reference. */
  keywords: string[];
  roles: Pick<Role, 'id' | 'name' | 'kind' | 'inScope'>[];
  /** Placeholders ("Your ERP") a person maps to their own applications. */
  systems: Pick<SystemRef, 'id' | 'name' | 'kind'>[];
  events: Pick<ProcessEvent, 'id' | 'kind' | 'name'>[];
  steps: Pick<Step, 'id' | 'name' | 'description' | 'roleIds' | 'systemIds' | 'taskType' | 'ruleIds' | 'exceptionIds'>[];
  gateways: Pick<Gateway, 'id' | 'type' | 'question'>[];
  flows: Flow[];
  rules: { id: string; name: string; condition: string; action: string }[];
  exceptions: Pick<ExceptionPath, 'id' | 'kind' | 'name' | 'trigger' | 'handling' | 'stepIds' | 'routedToRoleId'>[];
}

/** The references that ship. The trial has one; more only if it shows people reach documents faster. */
export const REFERENCES: readonly ReferenceProcess[] = [AP_INVOICE];

/** The reference a process name suggests: one of its keywords as whole words in the name. */
export function matchReference(name: string): ReferenceProcess | null {
  const n = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  return REFERENCES.find(r => r.keywords.some(k => n.includes(` ${k} `))) ?? null;
}

const typical = { status: 'typical' as const, sources: [] };

/**
 * A process model holding the reference, every element typical. `apps` maps a placeholder system
 * ("Your ERP") to the application the person named for it: that name is theirs, so the system is
 * confirmed by a person; a placeholder left unmapped stays typical under its placeholder name.
 */
export function typicalElements(ref: ReferenceProcess, apps: Record<string, string> = {}): Pick<ProcessModel, 'roles' | 'systems' | 'events' | 'steps' | 'gateways' | 'flows' | 'rules' | 'exceptions'> {
  return {
    roles: ref.roles.map(r => ({ ...r, ...typical })),
    systems: ref.systems.map(s => {
      const given = (apps[s.id] ?? '').trim();
      return given ? { ...s, name: given, inScope: true, access: [], status: 'user-confirmed' as const, sources: [] } : { ...s, inScope: true, access: [], ...typical };
    }),
    events: ref.events.map(e => ({ ...e, ...typical })),
    steps: ref.steps.map(s => ({ ...s, inputs: [], outputs: [], ...typical })),
    gateways: ref.gateways.map(g => ({ ...g, ...typical })),
    flows: ref.flows.map(f => ({ ...f })),
    rules: ref.rules.map(r => ({ ...r, ...typical })),
    exceptions: ref.exceptions.map(x => ({ ...x, ...typical })),
  };
}

export type TypicalKind = 'step' | 'rule' | 'exception' | 'role' | 'system' | 'gateway' | 'event';

/** How much of a process is still typical, by kind, and in all. */
export function typicalCounts(m: ProcessModel): Record<TypicalKind, number> & { total: number } {
  const n = (xs: { status: string }[]) => xs.filter(x => x.status === 'typical').length;
  const c = { step: n(m.steps), rule: n(m.rules), exception: n(m.exceptions), role: n(m.roles), system: n(m.systems), gateway: n(m.gateways), event: n(m.events) };
  return { ...c, total: Object.values(c).reduce((a, b) => a + b, 0) };
}

/** The confirm pass, in order: steps (in the order of the record), then rules, then exceptions. */
export function toConfirm(m: ProcessModel): { kind: 'step' | 'rule' | 'exception'; id: string; name: string; detail: string }[] {
  return [
    ...m.steps.filter(s => s.status === 'typical').map(s => ({ kind: 'step' as const, id: s.id, name: s.name, detail: s.description })),
    ...m.rules.filter(r => r.status === 'typical').map(r => ({ kind: 'rule' as const, id: r.id, name: r.name, detail: `When ${lowerFirst(r.condition)}: ${lowerFirst(r.action)}.` })),
    ...m.exceptions.filter(x => x.status === 'typical').map(x => ({ kind: 'exception' as const, id: x.id, name: x.name, detail: `${x.trigger}. Handled: ${lowerFirst(x.handling)}.` })),
  ];
}
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/** What the last card of the confirm pass covers: typical roles and applications (to name), and how many decision points and events. */
export function restToConfirm(m: ProcessModel): { roles: { id: string; name: string }[]; systems: { id: string; name: string }[]; gateways: number; events: number } {
  const t = <X extends { status: string }>(xs: X[]) => xs.filter(x => x.status === 'typical');
  return { roles: t(m.roles).map(r => ({ id: r.id, name: r.name })), systems: t(m.systems).map(s => ({ id: s.id, name: s.name })), gateways: t(m.gateways).length, events: t(m.events).length };
}

/** A sentence for the provisional assessment, or null when nothing typical is left among the steps. */
export function provisionalNote(m: ProcessModel): string | null {
  const c = typicalCounts(m);
  if (!c.step) return null;
  return `Provisional: ${c.step} of ${m.steps.length} steps come from a typical process and are not confirmed. The assessment firms up as your people confirm them.`;
}

/**
 * With documents present: the reference's steps the sources do not mention, as a checklist. A step
 * counts as mentioned when a step of the process shares most of its words with it (name or
 * description). Nothing is added by this; each line can be added as typical by a person.
 */
export function typicalChecklist(m: ProcessModel, ref: ReferenceProcess): { stepId: string; name: string; why: string }[] {
  // A process started from the typical one has already been through it (a step taken out with "We don't"
  // must not come back as a suggestion); the checklist is for processes read from sources.
  if (m.meta.startedFrom) return [];
  const own = m.steps.filter(s => s.status !== 'typical');
  if (!own.length) return [];
  const mentioned = (r: ReferenceProcess['steps'][number]) => own.some(s =>
    wordOverlap(s.name, r.name) >= 0.6 || wordOverlap(`${s.name} ${s.description}`, `${r.name} ${r.description}`) >= 0.45
    || [...contentWords(r.name)].every(w => contentWords(`${s.name} ${s.description}`).has(w)));
  const what = ref.name.charAt(0).toLowerCase() + ref.name.slice(1);
  return ref.steps.filter(r => !mentioned(r) && !m.steps.some(s => s.id === r.id))
    .map(r => ({ stepId: r.id, name: r.name, why: `A typical ${what} has "${r.name}"; your sources do not mention it.` }));
}
