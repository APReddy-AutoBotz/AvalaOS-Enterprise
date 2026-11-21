import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STALL_MS, TaskError, classify, codeOf, failedLine, isStalled, plainFailure, plainFailureOf, runReference, spentOn, stepOfRun, stepLabel,
  type FailureCode, type ReadingStep,
} from './failure.ts';

const RUN = '85799b5d-f10b-4056-afcf-fe6edc329a16';
const STEPS: ReadingStep[] = [
  { key: 'start' }, { key: 'passes' }, { key: 'pass', title: 'SOP AP-07' }, { key: 'merge' }, { key: 'merge-flow' },
  { key: 'merge-facts' }, { key: 'review' }, { key: 'assemble' },
];
const CODES: FailureCode[] = ['TRUNCATED', 'TIMEOUT', 'UNREACHABLE', 'PROVIDER_ERROR', 'REFUSED', 'INVALID_OUTPUT', 'SETUP', 'STOPPED', 'OTHER'];
// What a person must never read: our codes, task ids and the provider's raw words for a cut-off.
const CODE_WORDS = /TRUNCATED|TIMEOUT|INVALID_OUTPUT|PROVIDER_ERROR|REFUSED|NOT_SUPPORTED|max_tokens|max_output_tokens|merge_facts|merge_flow|source_facts|source_steps|review_flow|undefined|null/;

test('the exact lines of the approved table', () => {
  const ref = 'Reference: 85799b5d.';
  assert.equal(plainFailure({ key: 'merge-facts' }, 'TRUNCATED', RUN),
    `Combining the facts from the sources: the answer was longer than one reply may be. Try fewer sources at a time. ${ref}`);
  assert.equal(plainFailure({ key: 'merge-flow' }, 'TRUNCATED', RUN),
    `Combining the steps from the sources: the answer was longer than one reply may be. Try fewer sources at a time. ${ref}`);
  assert.equal(plainFailure({ key: 'pass', title: 'SOP AP-07' }, 'TRUNCATED', RUN),
    `Reading "SOP AP-07": the answer was longer than one reply may be. Try splitting this source into smaller files. ${ref}`);
  assert.equal(plainFailure({ key: 'review' }, 'TRUNCATED', RUN),
    `Checking the combined steps: the answer was longer than one reply may be. Try fewer sources at a time. ${ref}`);
  assert.equal(plainFailure({ key: 'merge-flow' }, 'TIMEOUT', RUN, '', true),
    `Combining the steps from the sources: the AI provider took too long to answer, twice. Try again in a few minutes; if it happens again, try fewer sources at a time. ${ref}`);
  assert.equal(plainFailure({ key: 'merge-flow' }, 'UNREACHABLE', RUN),
    `Combining the steps from the sources: the AI provider could not be reached. Try again in a few minutes. ${ref}`);
  assert.equal(plainFailure({ key: 'review' }, 'PROVIDER_ERROR', RUN, 'Rate limit reached for requests'),
    `Checking the combined steps: the AI provider answered with an error ("Rate limit reached for requests"). Try again in a few minutes; if it happens again, an admin should check the AI settings. ${ref}`);
  assert.equal(plainFailure({ key: 'pass', title: 'Call 1' }, 'REFUSED', RUN),
    `Reading "Call 1": the AI provider declined to answer. Check the sources for anything the provider may not accept, then try again. ${ref}`);
  assert.equal(plainFailure({ key: 'merge-facts' }, 'INVALID_OUTPUT', RUN),
    `Combining the facts from the sources: the AI provider's answer was not in the expected form. Try again. ${ref}`);
  assert.equal(plainFailure({ key: 'assemble' }, 'OTHER', RUN),
    `Putting the process together: something went wrong on our side. Try again; if it happens again, let us know. ${ref}`);
  // Added in the review (7a): a step the platform stopped mid-call, ended on the next look.
  assert.equal(plainFailure({ key: 'merge-facts' }, 'STOPPED', RUN),
    `Combining the facts from the sources: the server stopped this step before it finished, at the time limit for one step. Try again; if it happens again, try fewer sources at a time. ${ref}`);
});

test('every reason at every step is a sentence with the step, no code word, and the run\'s reference', () => {
  for (const step of STEPS) for (const code of CODES) {
    const line = plainFailure(step, code, RUN, code === 'SETUP' ? 'This workspace\'s own AI key can no longer be read; an admin should enter it again' : '');
    assert.ok(line.startsWith(`${stepLabel(step)}: `), line);
    assert.ok(line.endsWith(' Reference: 85799b5d.'), line);
    assert.doesNotMatch(line, CODE_WORDS, line);
    assert.match(line, /[.?!] Reference/, `the reason ends as a sentence: ${line}`);
  }
});

test('the server\'s failure texts are read into codes, and so into the table\'s lines', () => {
  assert.deepEqual(classify('merge_facts_rules: TRUNCATED Response incomplete: max_tokens.'), { code: 'TRUNCATED', detail: 'Response incomplete: max_tokens.' });
  assert.equal(classify('TIMEOUT: the AI provider took longer than this stage allows').code, 'TIMEOUT');
  assert.equal(classify('AI provider unreachable: TypeError').code, 'UNREACHABLE');
  assert.deepEqual(classify('review_flow: PROVIDER_ERROR Rate limit reached'), { code: 'PROVIDER_ERROR', detail: 'Rate limit reached' });
  assert.equal(classify('source_steps: INVALID_OUTPUT The reply lacks steps.').code, 'INVALID_OUTPUT');
  assert.deepEqual(classify('NOT_SUPPORTED: This AI provider cannot read images.'), { code: 'SETUP', detail: 'This AI provider cannot read images.' });
  assert.equal(classify('database 500: boom').code, 'OTHER');
  assert.equal(classify('Assembled model is invalid: /conflicts/0/target/id No metric with id m-2.').code, 'OTHER');
  // The message of Anthropic's run of 19 November, as a person would now read it.
  assert.equal(plainFailureOf({ key: 'merge-facts' }, 'merge_facts: TRUNCATED Response incomplete: max_tokens.', RUN),
    'Combining the facts from the sources: the answer was longer than one reply may be. Try fewer sources at a time. Reference: 85799b5d.');
  assert.equal(plainFailureOf({ key: 'start' }, 'NOT_SUPPORTED: This AI provider cannot read images.', RUN),
    'Starting the reading: this AI provider cannot read images. Reference: 85799b5d.');
});

test('a task error carries its code and the tokens its call used', () => {
  const e = new TaskError('merge_facts_rules: TRUNCATED Response incomplete: max_tokens.', { input: 900, output: 12000 }, 'TRUNCATED');
  assert.equal(codeOf(e), 'TRUNCATED');
  assert.deepEqual(spentOn(e), { input: 900, output: 12000 });
  assert.equal(codeOf(new TaskError('x: REFUSED no', { input: 0, output: 0 })), 'REFUSED', 'the code is read from the text when not given');
  assert.equal(codeOf(new Error('TIMEOUT: slow')), 'TIMEOUT');
  assert.deepEqual(spentOn(new Error('TIMEOUT: slow')), { input: 0, output: 0 }, 'a time-out answered nothing');
});

test('the reference is the run id\'s first eight characters', () => {
  assert.equal(runReference(RUN), '85799b5d');
});

test('a reading that has not changed for longer than any step can take is stopped; one still moving is not', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(isStalled('merging', ago(STALL_MS + 1000), now), true);
  assert.equal(isStalled('merging', ago(STALL_MS - 1000), now), false);
  assert.equal(isStalled('queued', ago(STALL_MS + 1000), now), true);
  assert.equal(isStalled('done', ago(STALL_MS * 10), now), false);
  assert.equal(isStalled('failed', ago(STALL_MS * 10), now), false);
  // The longest legitimate silence: a step that times out at 135 s, its retry that does too, the next start.
  assert.ok(STALL_MS > 2 * 150_000 + 60_000, 'the limit leaves room for a time-out and its one retry');
});

test('the step a stopped reading was in comes from its status and the parts it has', () => {
  assert.deepEqual(stepOfRun('queued', []), { key: 'start' });
  assert.deepEqual(stepOfRun('running', ['pass:facts:sop']), { key: 'passes' });
  assert.deepEqual(stepOfRun('merging', ['pass:facts:sop']), { key: 'merge' });
  assert.deepEqual(stepOfRun('merging', ['merge:facts']), { key: 'merge-flow' });
  // The last part was stored but the join was not: the run ends as a stopped facts step (7a).
  assert.deepEqual(stepOfRun('merging', ['merge:flow', 'facts:rules-exceptions', 'facts:interfaces-metrics', 'facts:conflicts-questions']), { key: 'merge-facts' });
  assert.deepEqual(stepOfRun('reviewing', ['merge:flow', 'merge:facts']), { key: 'review' });
  assert.deepEqual(stepOfRun('assembling', []), { key: 'assemble' });
});

test('the Sources screen\'s line: the plain sentence for new runs, the old line for runs from before', () => {
  const plain = plainFailure({ key: 'merge-facts' }, 'TRUNCATED', RUN);
  assert.equal(failedLine(plain), `The last reading stopped. ${plain}`);
  assert.equal(failedLine('merge_facts: TRUNCATED Response incomplete: max_tokens.'), 'The last extraction failed: merge_facts: TRUNCATED Response incomplete: max_tokens.. Try again.');
  assert.equal(failedLine(null), 'The last extraction failed: unknown error. Try again.');
});
