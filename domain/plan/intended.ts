// Work that is not done today (docs/effort-first-plan.md, part C). The brief says whether the work is
// done today and what kind of thing it is; when it is not done today (or is a tool or a new process to be
// built), the steps describe the intended process, not a current one. Everything that would otherwise
// speak of "As-Is" or of hours saved asks here: the words, whether there is one map or two, which
// application is the thing being built (so it is not treated as an application the process uses), and
// that a value can only come from figures a person enters. No I/O; no assessment imports, so the
// assessment can use it.
import type { Fact, ProcessModel, SystemRef } from '../processModel/types.ts';

const known = <T>(f: Fact<T> | undefined): T | null => (f && f.status !== 'unknown' ? f.value : null);

/** Whether the work is known not to be done today: the brief says so, or says it is a tool or a new process. */
export function notDoneToday(m: ProcessModel): boolean {
  const b = m.meta.brief ?? {};
  return known(b.doneToday) === 'no' || ['tool', 'new_process'].includes(known(b.kind) ?? '');
}

/** Whether only part of the work is done today. */
export const partlyDoneToday = (m: ProcessModel) => known(m.meta.brief?.doneToday) === 'partly' && !notDoneToday(m);

/** The application being built, when the brief names one that is in the model. */
export function buildingSystem(m: ProcessModel): SystemRef | null {
  const id = known(m.meta.brief?.building);
  return id ? m.systems.find(s => s.id === id) ?? null : null;
}

/** The applications the process uses, without the one being built. */
export const existingSystems = (m: ProcessModel) => { const b = buildingSystem(m); return m.systems.filter(s => s.id !== b?.id); };

export interface ProcessWords {
  intended: boolean;
  /** "As-Is process" / "Intended process". */
  process: string;
  /** "As-Is map" / "Intended process map". */
  map: string;
  /** "Detailed As-Is steps" / "Detailed intended steps". */
  steps: string;
  /** "the steps people do today" / "the intended steps". */
  stepsPhrase: string;
  /** "Edit the As-Is flow" / "Edit the intended flow". */
  edit: string;
}

/** The words for the process as described, by whether the work is done today. */
export function processWords(m: ProcessModel): ProcessWords {
  return notDoneToday(m)
    ? { intended: true, process: 'Intended process', map: 'Intended process map', steps: 'Detailed intended steps', stepsPhrase: 'the intended steps', edit: 'Edit the intended flow' }
    : { intended: false, process: 'As-Is process', map: 'As-Is map', steps: 'Detailed As-Is steps', stepsPhrase: 'the steps people do today', edit: 'Edit the As-Is flow' };
}
