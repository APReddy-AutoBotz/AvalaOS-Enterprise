// Package B, pull request 2: the task that notices what a person said, and the rules after it, on
// recorded replies (no AI is called).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { deferQuestion } from '../processModel/patch.ts';
import { buildOpenAIRequest, verifyExcerpts } from '../ai/gateway.ts';
import { TASKS } from '../ai/tasks.ts';
import { WORK_OF_TASK } from '../ai/usage.ts';
import { schemaProblems } from '../ai/anthropic.ts';
import { originLine } from './card.ts';
import { discoveryQuestions, NOTICE_LIMITS, noticeSegments, readNotice, targetFor, worthNoticing, type NoticeReply, type Said } from './notice.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));

const said: Said[] = [
  { ref: 'own-1:1', sourceId: 'own-1', locator: { lineStart: 1 }, text: 'Invoices come in by email and the clerk keys them into SAP. Anything over the limit goes to the controller. We get about 1,200 of them. The system should block entries over the limit.' },
  { ref: 'answer-1', answerTo: 'Who does "Three-way match"?', text: 'The buyer does it, and when the buyer is away someone covers for them.' },
];
const call = noticeSegments(gold, said, ['Which SAP S/4HANA interfaces can the automation use?']);
const q = (segmentId: string, excerpt: string, pattern: string, about: string, question: string, whyItMatters = 'It decides who the step is routed to.') => ({ segmentId, excerpt, pattern, about, question, whyItMatters });

test('the task is registered, named in "AI use this month", and its schema is one Anthropic takes', () => {
  assert.equal(TASKS[discoveryQuestions.id], discoveryQuestions);
  assert.equal(WORK_OF_TASK.discoveryQuestions, 'Discovery');
  assert.deepEqual(schemaProblems(discoveryQuestions.schema), []);
  assert.deepEqual(discoveryQuestions.verifyArrays, ['questions', 'wanted']);
  assert.equal(discoveryQuestions.maxOutputTokens, 4000);
  assert.equal(discoveryQuestions.reasoningEffort, 'low');
  const body = buildOpenAIRequest(discoveryQuestions, call.segments, '');
  assert.match(String(body.input), /id="n:2"[^>]*at="Answer to: Who does &quot;Three-way match&quot;\?"|id="n:2"[^>]*at="Answer to: Who does/);
});

test('the call: the person\'s words as n:, the draft\'s names as m:draft, what was asked as a:asked; an answer\'s question is its place, not its text', () => {
  assert.deepEqual(call.segments.map(s => s.id), ['n:1', 'n:2', 'm:draft', 'a:asked']);
  assert.equal(call.segments[1]!.text, said[1]!.text);
  assert.equal(call.segments[1]!.locator, 'Answer to: Who does "Three-way match"?');
  assert.ok(!call.segments[1]!.text.includes('Three-way match'));
  assert.match(call.segments[2]!.text, /^Steps: 1\. /);
  assert.match(call.segments[3]!.text, /Which SAP S\/4HANA interfaces/);
});

test('a candidate without a quote in the passage it names is dropped by the gateway', () => {
  const reply = { questions: [q('n:1', 'Anything over the limit goes to the controller', 'who_handles', 'Review high-value invoice', 'Who is the controller who approves invoices over the limit?'), q('n:1', 'the bank feed posts them', 'application_when', '', 'When does the bank feed post?')], wanted: [{ segmentId: 'n:1', excerpt: 'The system should block entries over the limit.' }, { segmentId: 'n:2', excerpt: 'we want a portal' }] };
  const v = verifyExcerpts(reply, discoveryQuestions.verifyArrays, call.segments);
  assert.deepEqual(v.dropped.map(d => d.reason), ['excerpt_not_found', 'excerpt_not_found']);
  assert.equal((v.data as NoticeReply).questions.length, 1);
  assert.equal((v.data as NoticeReply).wanted.length, 1);
  // A reply lacking a list is refused.
  assert.deepEqual(verifyExcerpts({ questions: [] }, discoveryQuestions.verifyArrays, call.segments).missing, ['wanted']);
});

test('the rules after it: not their words, the question repeated, too long, a link, already asked or settled are dropped; the rest are cards in the order said', () => {
  const reply: NoticeReply = {
    questions: [
      q('n:2', 'someone covers for them', 'who_handles', 'Three-way match', 'Who covers the three-way match when the buyer is away?'),
      q('n:1', 'Anything over the limit goes to the controller', 'who_handles', 'Review high-value invoice', 'Who is the controller who approves invoices over the limit?'),
      q('n:1', 'We get about 1,200 of them', 'unit', 'invoices received', 'Is that 1,200 invoices a month, or in another period?', 'Volume decides the value.'),
      q('m:draft', 'Steps', 'application_when', '', 'Which application is each step done in?'),
      q('n:2', 'Who does "Three-way match"', 'who_handles', 'Three-way match', 'Who does the match?'),
      q('n:1', 'the clerk keys them into SAP', 'application_when', 'Log invoice', 'x'.repeat(201)),
      q('n:1', 'the clerk keys them into SAP', 'operation_confirmer', 'SAP S/4HANA', 'Email ap-lead@example.test to confirm SAP access?'),
      q('n:1', 'the clerk keys them into SAP', 'operation_confirmer', 'SAP S/4HANA', 'Which SAP S/4HANA interfaces can the automation use?'),
      q('n:1', 'the clerk keys them into SAP', 'not_a_pattern', 'SAP S/4HANA', 'Anything?'),
    ],
    wanted: [{ segmentId: 'n:1', excerpt: 'The system should block entries over the limit.' }, { segmentId: 'n:1', excerpt: 'Anything over the limit goes to the controller' }, { segmentId: 'a:asked', excerpt: 'Which SAP' }],
  };
  const r = readNotice(gold, call, reply, { asked: ['Which SAP S/4HANA interfaces can the automation use?'] });
  assert.deepEqual(r.cards.map(c => c.question), [
    'Is that 1,200 invoices a month, or in another period?',
    'Who covers the three-way match when the buyer is away?',
  ], 'in the order said: the description first, then the answer');
  assert.deepEqual(r.dropped.filter(d => d.what === 'question').map(d => d.reason).sort(), ['already_asked', 'already_known', 'contact_or_link', 'not_their_words', 'repeats_the_question', 'too_long', 'unknown_pattern'], 'who reviews a high-value invoice is recorded: already known');
  for (const c of r.cards) { assert.equal(c.group, 'said'); assert.equal(c.origin.kind, 'quote'); }
  assert.equal(originLine(r.cards[1]!.origin), 'You said: “someone covers for them”');
  assert.equal(r.cards[1]!.origin.kind === 'quote' && r.cards[1]!.origin.quote.answerTo, 'Who does "Three-way match"?');
  assert.deepEqual(r.wanted.map(w => w.excerpt), ['The system should block entries over the limit.']);
  assert.deepEqual(r.dropped.filter(d => d.what === 'wanted').map(d => d.reason), ['no_wanting_word', 'not_their_words']);
  // The same inputs and the same recorded reply give the same cards in the same order.
  assert.deepEqual(readNotice(gold, call, reply, { asked: ['Which SAP S/4HANA interfaces can the automation use?'] }).cards.map(c => c.key), r.cards.map(c => c.key));
});

test('a target already known, asked, or left with someone is dropped; at most five questions and five wanted statements', () => {
  // Who does "Check mandatory fields" is not recorded; who does "Three-way match" neither: a question about the role is kept.
  const one = readNotice(gold, call, { questions: [q('n:2', 'The buyer does it', 'who_handles', 'Three-way match', 'Is the buyer the role that does the three-way match?')], wanted: [] }, { asked: [] });
  assert.deepEqual(one.cards[0]!.target, { kind: 'step', id: 's-match', field: 'roleIds' });
  const left = deferQuestion(gold, { questionIds: [], owner: 'Priya', gap: { target: { kind: 'step', id: 's-match', field: 'roleIds' }, question: 'Is the buyer the role that does the three-way match?' } }).model;
  assert.deepEqual(readNotice(left, call, { questions: [q('n:2', 'The buyer does it', 'who_handles', 'Three-way match', 'Is the buyer the role that does the three-way match?')], wanted: [] }, { asked: [] }).dropped.map(d => d.reason), ['already_known']);
  const many: NoticeReply = {
    questions: Array.from({ length: 7 }, (_, i) => q('n:1', 'Invoices come in by email', 'application_when', '', `Question number ${['one', 'two', 'three', 'four', 'five', 'six', 'seven'][i]} about how invoices arrive?`)),
    wanted: Array.from({ length: 7 }, (_, i) => ({ segmentId: 'n:1', excerpt: i === 0 ? 'The system should block entries over the limit.' : `The system should block entries${' '.repeat(i)}` })),
  };
  const r = readNotice(gold, call, many, { asked: [] });
  assert.equal(r.cards.length, NOTICE_LIMITS.questions);
  assert.ok(r.dropped.some(d => d.reason === 'over_limit'));
  assert.ok(r.wanted.length <= NOTICE_LIMITS.wanted);
  assert.ok(r.cards.every(c => c.answer === 'waits' && c.target.kind === 'meta'), 'about nothing the draft holds: a question about the shape, answered at the next update');
});

test('targets by rule, and which answers are worth noticing', () => {
  assert.deepEqual(targetFor(gold, 'operation_confirmer', 'SAP S/4HANA'), { kind: 'system', id: 'sys-sap', field: 'access' });
  assert.deepEqual(targetFor(gold, 'application_when', 'Three-way match'), { kind: 'step', id: 's-match', field: 'systemIds' });
  assert.deepEqual(targetFor(gold, 'wanted_needs', 'a supplier portal'), { kind: 'meta', field: 'wanted' });
  assert.deepEqual(targetFor(gold, 'unit', ''), { kind: 'meta', field: 'flow' });
  assert.equal(worthNoticing('SAP', 'SAP'), false);
  assert.equal(worthNoticing('500 a month', '500'), false);
  assert.equal(worthNoticing('The buyer does it, and when the buyer is away someone from the AP team covers for them, usually after two days', 'Buyer'), true);
});
