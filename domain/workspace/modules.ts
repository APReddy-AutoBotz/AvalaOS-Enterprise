// The parts of Avala OS an organisation uses (docs/product-plan.md, "Packaging"). A customer starts with
// the part they need: Assess; Assess and Documents; the full journey; or the Delivery board on its own.
// The platform owner sets it per organisation (migration organization_modules). A part that is off is
// not shown; nothing in it is deleted, and switching it on again brings it all back.
import type { SettingsSection, StageId } from './route.ts';

export type Module = 'assess' | 'documents' | 'board';
export const MODULES: readonly Module[] = ['assess', 'documents', 'board'];
export const ALL_MODULES: Module[] = [...MODULES];

export interface Plan { id: 'full' | 'assess-documents' | 'assess' | 'board'; label: string; modules: Module[]; what: string }
export const PLANS: Plan[] = [
  { id: 'full', label: 'The full journey', modules: ['assess', 'documents', 'board'], what: 'Sources, the process and its assessment, documents and flows, work items and the Delivery board.' },
  { id: 'assess-documents', label: 'Assess and Documents', modules: ['assess', 'documents'], what: 'Sources, the process and its assessment, then the BRD, PDD, FRD, SDD and flows. No work items or board.' },
  { id: 'assess', label: 'Assess', modules: ['assess'], what: 'Sources, the process and its assessment. No documents, work items or board.' },
  { id: 'board', label: 'The Delivery board on its own', modules: ['board'], what: 'Projects, epics, stories, tasks and bugs, sprints, comments and import from Jira. No processes.' },
];

const canonical = (m: readonly string[]) => MODULES.filter(x => m.includes(x));
export const planOf = (modules: readonly string[]): Plan | null => {
  const c = canonical(modules).join(',');
  return modules.every(x => (MODULES as readonly string[]).includes(x)) ? PLANS.find(p => p.modules.join(',') === c) ?? null : null;
};

export class ModulesError extends Error {}
/** The modules of a plan, in their fixed order; any other set is refused (the database has the same check). */
export function validateModules(modules: readonly string[]): Module[] {
  const plan = planOf(modules);
  if (!plan) throw new ModulesError('Choose one of the four set-ups: the full journey, Assess and Documents, Assess, or the Delivery board on its own.');
  return [...plan.modules];
}

export const has = (modules: readonly string[] | undefined, m: Module) => (modules ?? ALL_MODULES).includes(m);

/** The stages of a process shown with these parts: work items need both the documents (their requirements) and the board. */
export function stagesFor(modules: readonly string[] | undefined): StageId[] {
  if (!has(modules, 'assess')) return [];
  const out: StageId[] = ['sources', 'process', 'assessment'];
  if (has(modules, 'documents')) out.push('documents', 'flows');
  if (has(modules, 'documents') && has(modules, 'board')) out.push('work-items');
  return out;
}

/** Main navigation for the workspace a person is in: a page shows when its organisation uses that part. My work and Settings always show. */
export function navFor(workspace: { modules?: readonly string[] } | null): { processes: boolean; board: boolean } {
  return { processes: has(workspace?.modules, 'assess'), board: has(workspace?.modules, 'board') };
}

/** The Settings sections shown with these parts: People and the parts themselves always; the rest belong to the assessment or the documents. */
export function settingsFor(modules: readonly string[] | undefined): SettingsSection[] {
  const out: SettingsSection[] = ['people'];
  if (has(modules, 'assess')) out.push('applications', 'assessment', 'ai');
  if (has(modules, 'documents')) out.push('documents');
  out.push('parts');
  return out;
}

/** What to say on a page whose part is off for this organisation. */
export function offMessage(part: 'processes' | 'board' | StageId, organizationName: string): string {
  const org = organizationName.trim() || 'this organisation';
  const [what, verb] = part === 'board' ? ['The Delivery board', 'is'] : part === 'processes' ? ['Processes and their assessment', 'are']
    : part === 'work-items' ? ['Work items', 'are'] : part === 'documents' || part === 'flows' ? ['Documents and flows', 'are'] : ['This part', 'is'];
  return `${what} ${verb} not switched on for ${org}. Nothing has been deleted: ask the Avala OS team to switch it on.`;
}
