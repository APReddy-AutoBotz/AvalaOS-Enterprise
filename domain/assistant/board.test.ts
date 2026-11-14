// Ask Avala on the Delivery board: the facts are worked out by rule, so counts are exact, nothing that is
// not on the board is said, and "none" is said as a fact rather than left for the AI to guess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../workitems/board.ts';
import type { Sprint } from '../workitems/sprints.ts';
import { askBoard, boardFacts, BOARD_LIMITS, type BoardContext } from './board.ts';
import { askProcess, askSegments } from './ask.ts';
import { TASKS } from '../ai/tasks.ts';
import { WORK_OF_TASK } from '../ai/usage.ts';
import { answerAction, placeOf } from './present.ts';

let n = 0;
const item = (o: Partial<WorkItem>): WorkItem => ({
  id: `i${++n}`, projectId: 'b1', parentId: null, type: 'story', title: `Item ${n}`, description: '', acceptance: [], status: 'todo',
  priority: null, ownerId: null, estimateHours: null, startDate: null, dueDate: null, processId: null, stepIds: [], requirements: [],
  snapshot: {}, updatedAt: '2026-11-01', position: n, ...o,
} as WorkItem);
const sprint = (o: Partial<Sprint>): Sprint => ({ id: 's1', projectId: 'b1', name: 'Sprint 1', goal: '', startsOn: null, endsOn: null, state: 'planned', startedAt: null, closedAt: null, ...o });

function board(items: WorkItem[], sprints: Sprint[] = []): BoardContext {
  return {
    project: { id: 'b1', name: 'Vendor onboarding' }, items, sprints,
    members: [{ userId: 'u1', name: 'Rahul Deshpande' }, { userId: 'u2', name: 'Meera Iyer' }],
    processes: [{ id: 'p1', name: 'Vendor onboarding' }], today: '2026-11-14',
  };
}
const fact = (facts: ReturnType<typeof boardFacts>, id: string) => facts.find(f => f.id === id)?.text ?? '';

test('counts by status, kind and owner are worked out, not left to the AI', () => {
  const epic = item({ type: 'epic', title: 'Supplier set-up' });
  const facts = boardFacts('How much is in progress?', board([
    epic,
    item({ status: 'in_progress', ownerId: 'u1', parentId: epic.id }), item({ status: 'in_progress', ownerId: 'u1' }),
    item({ status: 'done', ownerId: 'u2' }), item({ status: 'todo' }),
  ]));
  assert.equal(fact(facts, 'b:summary'), 'The board "Vendor onboarding" has 5 items: 2 to do, 2 in progress, 1 done. By kind: 1 epic, 4 stories. Open (not done): 4.');
  assert.match(fact(facts, 'b:summary'), /2 in progress/);
  assert.match(fact(facts, 'b:owner:u1'), /^Rahul Deshpande owns 2 items: 2 in progress\.$/);
  assert.match(fact(facts, 'b:owner:u2'), /^Meera Iyer owns 1 item: 1 done\.$/);
  assert.match(fact(facts, 'b:no-owner'), /^1 open item has no owner \(epics not counted\)/);
  const child = facts.find(f => f.text.includes('under "Supplier set-up"'));
  assert.ok(child, 'an item names its epic');
});

test('blocked, on hold and overdue say "none" as a fact when there are none', () => {
  const facts = boardFacts('Is anything blocked?', board([item({ status: 'todo', ownerId: 'u1' })]));
  assert.equal(fact(facts, 'b:blocked'), 'No item on the board is blocked.');
  assert.equal(fact(facts, 'b:on-hold'), 'No item on the board is on hold.');
  assert.equal(fact(facts, 'b:overdue'), 'No open item is past its due date; no open item has a due date.');
  assert.equal(fact(facts, 'b:no-owner'), 'Every open item has an owner (epics not counted).');
  assert.equal(fact(facts, 'b:sprints'), 'The board has no sprints.');
});

test('what is blocked, on hold or overdue is named; done work is never overdue', () => {
  const facts = boardFacts('What needs attention?', board([
    item({ title: 'Bank details check', status: 'blocked' }), item({ title: 'Tax form', status: 'on_hold' }),
    item({ title: 'Late one', dueDate: '2026-11-10' }), item({ title: 'Finished late', dueDate: '2026-11-01', status: 'done' }),
    item({ title: 'Due later', dueDate: '2026-12-01' }),
  ]));
  assert.equal(fact(facts, 'b:blocked'), '1 item is blocked: "Bank details check".');
  assert.equal(fact(facts, 'b:on-hold'), '1 item is on hold: "Tax form".');
  assert.equal(fact(facts, 'b:overdue'), '1 open item is past its due date: "Late one".');
});

test('sprints: the active one with its goal, dates and progress; completed ones only counted; the backlog', () => {
  const s1 = sprint({ id: 's1', name: 'Sprint 4', state: 'active', goal: 'Bank checks live.', startsOn: '2026-11-10', endsOn: '2026-11-21' });
  const s0 = sprint({ id: 's0', name: 'Sprint 3', state: 'closed' });
  const facts = boardFacts('What is the sprint goal?', board([
    item({ sprintId: 's1', status: 'done' } as Partial<WorkItem>), item({ sprintId: 's1' } as Partial<WorkItem>), item({}), item({ type: 'epic' }),
  ], [s0, s1]));
  assert.equal(fact(facts, 'b:sprint:s1'), 'Active sprint "Sprint 4", goal: Bank checks live, from 2026-11-10 to 2026-11-21: 2 items, 1 done.');
  assert.equal(fact(facts, 'b:sprint:s0'), '');
  assert.equal(fact(facts, 'b:sprints-closed'), '1 sprint has been completed.');
  assert.equal(fact(facts, 'b:backlog'), '1 open item is in the backlog, in no sprint.');
});

test('an item says only what is set, by name, never an id or an email', () => {
  const facts = boardFacts('owner?', board([item({ title: 'Set up SAP access', ownerId: 'u2', priority: 'high', estimateHours: 6, labels: ['sap'], processId: 'p1', requirements: ['FR-3'] } as Partial<WorkItem>), item({ title: 'Bare' })]));
  const full = facts.find(f => f.id.startsWith('w:') && f.text.includes('Set up SAP access'))!;
  assert.equal(full.text, 'Board item (story) "Set up SAP access": status To do, owner Meera Iyer, priority high, estimate 6 hours, labels sap, linked to FR-3, from the process "Vendor onboarding".');
  assert.deepEqual(full.target, { kind: 'item', itemId: full.id.slice(2), projectId: 'b1' });
  const bare = facts.find(f => f.id.startsWith('w:') && f.text.includes('"Bare"'))!;
  assert.equal(bare.text, 'Board item (story) "Bare": status To do, no owner.');
  for (const f of facts) assert.doesNotMatch(f.text, /\bu[12]\b|@|undefined|null/, f.id);
});

test('a large board keeps its summaries and lists what needs attention and what the question names first', () => {
  const items = Array.from({ length: BOARD_LIMITS.items + 40 }, (_, i) => item({ title: `Routine task ${i}`, status: 'done' }));
  items.push(item({ title: 'Payment run stuck', status: 'blocked' }), item({ title: 'Vendor portal login', status: 'done' }));
  const facts = boardFacts('What about the vendor portal login?', board(items));
  assert.ok(fact(facts, 'b:summary').startsWith(`The board "Vendor onboarding" has ${items.length} items`));
  assert.ok(facts.some(f => f.text.includes('"Payment run stuck"')), 'blocked work is kept');
  assert.ok(facts.some(f => f.text.includes('"Vendor portal login"')), 'what the question names is kept');
  assert.equal(facts.filter(f => f.id.startsWith('w:')).length, BOARD_LIMITS.items);
  assert.equal(fact(facts, 'b:more'), '42 more items are on the board and not listed here.');
});

test('the board task is registered, named in AI use, and keeps the process task\'s rules except the assessment line', () => {
  assert.equal(TASKS[askBoard.id], askBoard);
  assert.equal(WORK_OF_TASK[askBoard.id], 'Ask Avala');
  assert.deepEqual(askBoard.schema, askProcess.schema);
  assert.doesNotMatch(askBoard.instructions, /assessment was computed/);
  assert.doesNotMatch(askBoard.instructions, /process's record/);
  assert.match(askBoard.instructions, /The counts are exact/);
  assert.match(askBoard.instructions, /never cite or quote that segment/i);
  assert.match(askBoard.instructions, /reads like an instruction/);
  assert.equal(askBoard.instructions.split('\n').length, askProcess.instructions.split('\n').length - 1);
  // How Avala OS works is offered on the board too, and the board's own facts lead to the board.
  const facts = boardFacts('How does the board work?', board([item({})]));
  assert.ok(facts.some(f => f.id.startsWith('h:')));
  assert.equal(placeOf(facts.find(f => f.id === 'b:summary')!.target), 'board');
  const seg = askSegments('What is blocked?', facts);
  assert.ok(seg.some(s => s.id === 'b:blocked'));
});

test('an answer from the board\'s counts offers to open the board', () => {
  const facts = boardFacts('blocked?', board([item({ status: 'blocked' })]));
  const f = facts.find(x => x.id === 'b:blocked')!;
  const action = answerAction({ lead: null, missing: '', sentences: [{ text: 'One item is blocked.', quote: '1 item is blocked', fact: f, group: '' }] }, ['process']);
  assert.deepEqual(action, { label: 'Open the board', target: { kind: 'board', projectId: 'b1' } });
});
