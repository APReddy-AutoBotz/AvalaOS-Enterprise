// The suggestions measure fits the sample and its judge holds to the rule: nothing the passages do not state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessProcess } from '../../domain/assess/process.ts';
import { triage } from '../../domain/questions/triage.ts';
import { interviewQueue } from '../../domain/questions/interview.ts';
import { sourceSegments } from '../../domain/assistant/suggest.ts';
import { casePassages, judgeSuggestions, loadSuggestCases } from './suggest.ts';
import { loadSample } from './sample.ts';

const sample = await loadSample();
const items = interviewQueue(triage(sample.model, assessProcess(sample.model)));
const cases = loadSuggestCases();

test('ten cases, half that should suggest and half that should not, each on the sample\'s open questions', () => {
  assert.equal(cases.length, 10);
  assert.equal(cases.filter(c => c.expect.length === 0).length, 5);
  for (const c of cases) for (const e of c.expect) assert.ok(items.some(i => i.key === e.key), `${c.id}: ${e.key}`);
  // Each case's passage reaches the AI: it shares words with at least one open question.
  for (const c of cases.filter(c => c.expect.length)) assert.ok(sourceSegments(sample.model, items, casePassages(c)).passageOf.size > 0, c.id);
});

test('the judge: the expected answer passes; a missing one, a wrong one or an extra one does not', () => {
  const c = cases.find(x => x.id === 'SG02')!;
  const s = (itemKey: string, display: string) => ({ key: itemKey, kind: 'answer' as const, title: 't', why: 'w', willDo: `Record: ${display}`, needs: 'edit_process' as const,
    target: { kind: 'answer' as const, itemKey, source: 'Case notes, 1', proposal: { itemKey, question: 'q', display, quote: 'q', certainty: 'stated' as const, answer: {} } } });
  assert.ok(judgeSuggestions(c, [s(c.expect[0].key, 'AP Clerk')]).pass);
  assert.ok(!judgeSuggestions(c, []).pass);
  const wrong = judgeSuggestions(c, [s(c.expect[0].key, 'AP Manager')]);
  assert.ok(!wrong.pass && wrong.unsupported);
  const extra = judgeSuggestions(cases.find(x => x.id === 'SG07')!, [s('q-buyer-sla', 'Within a day')]);
  assert.ok(!extra.pass && extra.unsupported);
  assert.ok(judgeSuggestions(cases.find(x => x.id === 'SG07')!, []).pass);
});
