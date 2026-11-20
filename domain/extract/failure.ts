// Why a reading stopped, in words a person can act on. Pure: no I/O.
//
// The server writes one sentence into the run's `error`: the step, the reason, what to do, and a short
// reference (the first eight characters of the run id). The technical text stays in the run's record
// (`result.failure`) and in the function's log.

export interface Usage { input: number; output: number }

/** Why an AI call or a stage failed. */
export type FailureCode =
  | 'TRUNCATED' | 'TIMEOUT' | 'UNREACHABLE' | 'PROVIDER_ERROR' | 'REFUSED' | 'INVALID_OUTPUT'
  | 'SETUP' | 'STOPPED' | 'OTHER';

/** A task that failed, with its code and the tokens its calls used, so they are counted all the same (F03). */
export class TaskError extends Error {
  readonly code: FailureCode;
  readonly usage: Usage;
  constructor(message: string, usage: Usage, code?: FailureCode) {
    super(message);
    this.usage = usage;
    this.code = code ?? classify(message).code;
  }
}

/** The tokens a failed call used (zero when nothing was answered, as on a time-out). */
export const spentOn = (e: unknown): Usage => (e instanceof TaskError ? e.usage : { input: 0, output: 0 });

const SETUP = /^(NOT_SUPPORTED|NOT_CONFIGURED|WORKSPACE_KEY_MISSING|ENDPOINT_NOT_ALLOWED): /;

/** Reads the code from a failure's text (the server's messages: "merge_flow: TRUNCATED …", "TIMEOUT: …"). */
export function classify(message: string): { code: FailureCode; detail: string } {
  const setup = SETUP.exec(message);
  if (setup) return { code: 'SETUP', detail: message.slice(setup[0].length) };
  if (/^TIMEOUT\b/.test(message)) return { code: 'TIMEOUT', detail: '' };
  if (/^AI provider unreachable\b/.test(message)) return { code: 'UNREACHABLE', detail: '' };
  const m = /^[A-Za-z0-9_]+: (TRUNCATED|REFUSED|INVALID_OUTPUT|PROVIDER_ERROR)\b ?(.*)$/s.exec(message);
  if (m) return { code: m[1] as FailureCode, detail: m[2].trim() };
  return { code: 'OTHER', detail: '' };
}

export const codeOf = (e: unknown): FailureCode => (e instanceof TaskError ? e.code : classify(String((e as Error)?.message ?? e)).code);

/** The steps of a reading, as a person would name them. */
export type ReadingStep =
  | { key: 'start' }
  | { key: 'passes' }
  | { key: 'pass'; title: string }
  | { key: 'merge' }
  | { key: 'merge-flow' }
  | { key: 'merge-facts' }
  | { key: 'review' }
  | { key: 'assemble' };

export function stepLabel(step: ReadingStep): string {
  switch (step.key) {
    case 'start': return 'Starting the reading';
    case 'passes': return 'Reading the sources';
    case 'pass': return `Reading "${step.title}"`;
    case 'merge': return 'Combining what the sources say';
    case 'merge-flow': return 'Combining the steps from the sources';
    case 'merge-facts': return 'Combining the facts from the sources';
    case 'review': return 'Checking the combined steps';
    case 'assemble': return 'Putting the process together';
  }
}

const FEWER = 'Try fewer sources at a time.';

/** The reason and what to do, for one code at one step. */
export function reasonFor(step: ReadingStep, code: FailureCode, detail = '', twice = false): string {
  switch (code) {
    case 'TRUNCATED':
      return `the answer was longer than one reply may be. ${step.key === 'pass' ? 'Try splitting this source into smaller files.' : FEWER}`;
    case 'TIMEOUT':
      return `the AI provider took too long to answer${twice ? ', twice' : ''}. Try again in a few minutes; if it happens again, try fewer sources at a time.`;
    case 'UNREACHABLE':
      return 'the AI provider could not be reached. Try again in a few minutes.';
    case 'PROVIDER_ERROR':
      return `the AI provider answered with an error ("${clip(detail || 'no message', 300)}"). Try again in a few minutes; if it happens again, an admin should check the AI settings.`;
    case 'REFUSED':
      return 'the AI provider declined to answer. Check the sources for anything the provider may not accept, then try again.';
    case 'INVALID_OUTPUT':
      return 'the AI provider\'s answer was not in the expected form. Try again.';
    case 'SETUP':
      return lowerFirst(endWithStop(clip(detail || 'the AI connection is not set up for this.', 300)));
    case 'STOPPED':
      return 'the server stopped this step before it finished, at the time limit for one step. Try again; if it happens again, try fewer sources at a time.';
    case 'OTHER':
      return 'something went wrong on our side. Try again; if it happens again, let us know.';
  }
}

/** The run id's first eight characters, which a person can quote to us. */
export const runReference = (runId: string) => runId.replace(/-/g, '').slice(0, 8);

/** The sentence a person sees: step, reason, what to do, reference. */
export function plainFailure(step: ReadingStep, code: FailureCode, runId: string, detail = '', twice = false): string {
  return `${stepLabel(step)}: ${reasonFor(step, code, detail, twice)} Reference: ${runReference(runId)}.`;
}

/** The same, from a failure's text (classify, then plainFailure). */
export function plainFailureOf(step: ReadingStep, message: string, runId: string, twice = false): string {
  const { code, detail } = classify(message);
  return plainFailure(step, code, runId, detail, twice);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const endWithStop = (s: string) => (/[.!?…]$/.test(s) ? s : `${s}.`);
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

// ---- a step stopped from outside ------------------------------------------------------------
// The platform stops a server invocation at 150 s whatever it is doing, so a step can end without
// writing anything: the run then waits for ever. The longest a working run goes without a change is one
// step, its one retry after a time-out, and the start of the next (about five minutes), so a run that has
// not changed for STALL_MS is stopped, and the next look at it (the Sources screen, the extraction check)
// ends it with the step it was in.

export const STALL_MS = 7 * 60_000;

/** Whether a run that is still going has not changed for longer than any step can take. */
export function isStalled(status: string, updatedAt: string | number, now: number): boolean {
  if (status === 'done' || status === 'failed') return false;
  const t = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
  return Number.isFinite(t) && now - t > STALL_MS;
}

/** The step a run was in, from its status and the parts it has stored. */
export function stepOfRun(status: string, parts: readonly string[]): ReadingStep {
  switch (status) {
    case 'queued': return { key: 'start' };
    case 'running': return { key: 'passes' };
    case 'merging': {
      const flow = parts.includes('merge:flow'), facts = parts.includes('merge:facts');
      return !flow && !facts ? { key: 'merge' } : !flow ? { key: 'merge-flow' } : { key: 'merge-facts' };
    }
    case 'reviewing': return { key: 'review' };
    default: return { key: 'assemble' };
  }
}

/** The line the Sources screen shows for a failed reading. Runs from before these sentences keep their old line. */
export function failedLine(error: string | null): string {
  if (error && /Reference: [0-9a-f]{8}\.$/.test(error)) return `The last reading stopped. ${error}`;
  return `The last extraction failed: ${error ?? 'unknown error'}. Try again.`;
}
