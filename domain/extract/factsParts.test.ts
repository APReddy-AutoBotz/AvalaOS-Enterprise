import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FACTS_ORDER, FACTS_PARTS, factsProgress, factsStartFor, isFactsPart, joinFacts, listingKinds, pick, splitAfter, startParts, startsSmallerParts,
} from './factsParts.ts';
import { FACTS_TASKS } from './tasks.ts';
import type { MergeFactsOutput } from './assemble.ts';

const usage = { input: 1, output: 1 };
// A whole answer with something in every list, so a lost or doubled list shows.
const WHOLE: MergeFactsOutput = {
  rules: [{ name: 'Tolerance', condition: '2%', action: 'post', members: ['B1'] }, { name: 'SAP tolerance', condition: '5%', action: 'block', members: ['B2'] }],
  exceptions: [{ name: 'Duplicate', kind: 'business', trigger: 't', handling: 'h', routedTo: 'AP Clerk', members: ['X1'] }],
  interfaces: [{ system: 'SAP', method: 'api', name: 'PO read', operations: ['read'], access: 'confirmed', members: ['I1'] }],
  metrics: [{ label: 'Invoices a month', chosen: 'M1', members: ['M1', 'M2'] }],
  conflicts: [{ summary: 'Tolerance 2% against 5%; volume 8,500 against 9,000.', about: 'rule', members: ['B1', 'B2', 'M1'] }],
  questions: [{ question: 'Who approves above the limit?', whyItMatters: 'Routing.', members: ['U1'] }],
} as MergeFactsOutput;

const answer = (part: string) => ({ data: pick(part, WHOLE), usage });
const split = (part: string) => ({ splitInto: FACTS_PARTS[part].children, reason: 'TRUNCATED' as const, usage: { input: 900, output: 12000 } });

/** Every order of a list (small lists only). */
function orders<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest]));
}

test('the three first parts and the six single kinds each own every list exactly once', () => {
  for (const start of ['pairs', 'kinds'] as const) {
    const owned = startParts(start).flatMap(p => FACTS_PARTS[p].kinds);
    assert.deepEqual([...owned].sort(), [...FACTS_ORDER].sort(), start);
  }
  for (const [name, part] of Object.entries(FACTS_PARTS)) {
    assert.deepEqual(part.children.flatMap(c => FACTS_PARTS[c].kinds), part.children.length ? part.kinds : [], `${name} splits into exactly its own kinds`);
  }
});

test('each part\'s task asks only for its own lists, with the schema of the single answer', () => {
  for (const [name, task] of Object.entries(FACTS_TASKS)) {
    assert.deepEqual(Object.keys((task.schema as any).properties), FACTS_PARTS[name].kinds, name);
    assert.equal(task.maxOutputTokens, 12000, name);
    assert.match(task.instructions, /Use only the candidate ids given\.$/, name);
  }
  assert.match(FACTS_TASKS['conflicts-questions'].instructions, /^conflicts: /m);
  assert.match(FACTS_TASKS['conflicts-questions'].instructions, /^questions: /m);
  assert.doesNotMatch(FACTS_TASKS['rules-exceptions'].instructions, /conflicts|questions|metrics|interfaces/);
  assert.match(FACTS_TASKS['interfaces-metrics'].instructions, /"chosen" is the member/);
  assert.match(FACTS_TASKS['interfaces-metrics'].instructions, /most cautious access status/);
});

test('questions: the single answer\'s paragraph, word for word (the "one question per matter" line was taken out, owner, 20 November 2026)', () => {
  for (const part of ['conflicts-questions', 'questions']) {
    const line = FACTS_TASKS[part].instructions.split('\n').find(l => l.startsWith('questions: '));
    assert.equal(line,
      'questions: what someone would still need to know to assess and automate this process: every "unknowns" candidate, plus missing volumes or handling times for a path, unclear owners or turnaround times, unconfirmed interfaces, and unhandled cases. One question each, with why it matters. "members" are the candidate ids it comes from (may be empty).', part);
  }
  // Runs 9d6899d3 and d714b013 folded the supplier invoice API question into one broad question about SAP with it.
  for (const task of Object.values(FACTS_TASKS)) assert.doesNotMatch(task.instructions, /One question per matter/, task.id);
});

test('conflicts and questions see every kind of candidate; grouping sees only its own', () => {
  assert.equal(listingKinds('conflicts-questions'), null);
  assert.equal(listingKinds('conflicts'), null);
  assert.equal(listingKinds('questions'), null);
  assert.deepEqual(listingKinds('rules-exceptions'), ['rule', 'exception']);
  assert.deepEqual(listingKinds('interfaces-metrics'), ['interface', 'metric']);
  assert.deepEqual(listingKinds('metrics'), ['metric']);
});

test('the parts, joined, give back the single answer, in the order assembly gives out ids', () => {
  for (const start of ['pairs', 'kinds'] as const) {
    const stored = Object.fromEntries(startParts(start).map(p => [p, answer(p)]));
    const progress = factsProgress(start, stored);
    assert.equal(progress.complete, true);
    const joined = joinFacts(progress.leaves, stored);
    assert.deepEqual(joined, WHOLE, start);
    assert.deepEqual(Object.keys(joined), [...FACTS_ORDER]);
  }
});

test('in any order of arrival, the merge is complete exactly once every needed part is in, and the join is always the same', () => {
  // The first parts, with the first one split into its two kinds: five stored things in all.
  const events: [string, unknown][] = [
    ['rules-exceptions', split('rules-exceptions')], ['rules', answer('rules')], ['exceptions', answer('exceptions')],
    ['interfaces-metrics', answer('interfaces-metrics')], ['conflicts-questions', answer('conflicts-questions')],
  ];
  let checked = 0;
  for (const order of orders(events)) {
    const stored: Record<string, unknown> = {};
    let completions = 0;
    order.forEach(([name, value], i) => {
      stored[name] = value;
      // A second delivery of the same part (a retried invocation) changes nothing: the database keeps the first.
      const p = factsProgress('pairs', stored);
      if (p.complete) {
        completions += 1;
        assert.equal(i, order.length - 1, 'complete only when the last thing has arrived');
        assert.deepEqual(joinFacts(p.leaves, stored), WHOLE);
      }
    });
    assert.equal(completions, 1);
    checked += 1;
  }
  assert.equal(checked, 120);
});

test('a split part counts as missing until the parts that replace it are in; its own note never stands for an answer', () => {
  const stored: Record<string, unknown> = {
    'rules-exceptions': split('rules-exceptions'), 'interfaces-metrics': answer('interfaces-metrics'), 'conflicts-questions': answer('conflicts-questions'),
  };
  assert.deepEqual(factsProgress('pairs', stored), { complete: false, leaves: ['rules', 'exceptions', 'interfaces-metrics', 'conflicts-questions'], missing: ['rules', 'exceptions'] });
  stored.rules = answer('rules');
  assert.deepEqual(factsProgress('pairs', stored).missing, ['exceptions']);
  // A note that names no known part is not followed.
  assert.deepEqual(factsProgress('pairs', { 'rules-exceptions': { splitInto: ['nonsense'], reason: 'TRUNCATED', usage } }).missing, ['interfaces-metrics', 'conflicts-questions']);
});

test('a cut-off answer is split into its kinds; a time-out only on its second try; a single kind never', () => {
  assert.deepEqual(splitAfter('rules-exceptions', 'TRUNCATED', false), ['rules', 'exceptions']);
  assert.deepEqual(splitAfter('conflicts-questions', 'TRUNCATED', false), ['conflicts', 'questions']);
  assert.equal(splitAfter('interfaces-metrics', 'TIMEOUT', false), null, 'the first time-out is tried again as it is');
  assert.deepEqual(splitAfter('interfaces-metrics', 'TIMEOUT', true), ['interfaces', 'metrics']);
  for (const kind of FACTS_ORDER) {
    assert.equal(splitAfter(kind, 'TRUNCATED', true), null, `${kind} stops the reading`);
    assert.equal(splitAfter(kind, 'TIMEOUT', true), null, kind);
  }
  for (const code of ['REFUSED', 'INVALID_OUTPUT', 'PROVIDER_ERROR', 'UNREACHABLE', 'OTHER'] as const) {
    assert.equal(splitAfter('rules-exceptions', code, true), null, `${code} is not about length`);
  }
});

test('the smaller answers after a cut-off start only while the run is still going', () => {
  for (const status of ['merging', 'running', 'reviewing', 'assembling', 'queued']) assert.equal(startsSmallerParts(status), true, status);
  assert.equal(startsSmallerParts('failed'), false, 'another step failed meanwhile: start nothing');
  assert.equal(startsSmallerParts('done'), false);
  assert.equal(startsSmallerParts(undefined), false, 'a run that cannot be read starts nothing');
  assert.equal(startsSmallerParts(null), false);
});

test('starting at one answer per kind is for the extraction check only (7c)', () => {
  assert.deepEqual(factsStartFor('process', undefined), { start: 'pairs' });
  assert.deepEqual(factsStartFor('eval', undefined), { start: 'pairs' });
  assert.deepEqual(factsStartFor('eval', true), { start: 'kinds' });
  assert.ok('refused' in factsStartFor('process', true), 'a process reading is refused');
  assert.ok('refused' in factsStartFor('eval', 'yes'), 'only true is taken');
  assert.ok('refused' in factsStartFor('process', 1));
});

test('only the parts of the facts merge are accepted as names', () => {
  for (const name of Object.keys(FACTS_PARTS)) assert.equal(isFactsPart(name), true);
  for (const name of ['', 'toString', '__proto__', 'facts', 'rules exceptions', 3]) assert.equal(isFactsPart(name), false, String(name));
});
