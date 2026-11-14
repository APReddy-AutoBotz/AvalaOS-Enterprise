// Bringing a board over from Jira's CSV export: what fits is kept, what does not is said, nothing is guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportError, jiraDate, parseCsv, planJiraImport } from './jiraImport.ts';

test('CSV is read as Jira writes it: quotes, doubled quotes, line breaks in cells, a UTF-8 mark', () => {
  assert.deepEqual(parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line 1\nline 2"\r\n\r\n,,z\n'), [['a', 'b', 'c'], ['x, y', 'say "hi"', 'line 1\nline 2'], ['', '', 'z']]);
  assert.deepEqual(parseCsv('a,b'), [['a', 'b']]);
});

test('Jira dates are read in the forms Jira writes; others are not guessed', () => {
  assert.equal(jiraDate('2026-11-20'), '2026-11-20');
  assert.equal(jiraDate('20/Nov/26 12:00 AM'), '2026-11-20');
  assert.equal(jiraDate('5/Dec/2026'), '2026-12-05');
  assert.equal(jiraDate(''), null);
  assert.equal(jiraDate('11/20/2026'), undefined);
});

const members = [{ userId: 'u1', name: 'Ana Rao' }, { userId: 'u2', name: 'Ben Iyer' }, { userId: 'u3', name: 'Ben Iyer' }];
const file = [
  'Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Description,Parent,Labels,Labels,Original Estimate,Due date,Sprint,Custom field (Story Points)',
  'Pay by card,WEB-2,10002,Story,In Progress,Highest,Ana Rao,"As a shopper, I want to pay by card",10001,payments,q4,7200,20/Nov/26 12:00 AM,Sprint 3,5',
  'Card form,WEB-3,10003,Sub-task,To Do,Low,Ben Iyer,,10002,,,,,,',
  'Checkout,WEB-1,10001,Epic,Done,Medium,,,,,,,,,',
  'Total shows twice,WEB-4,10004,Bug,Waiting for vendor,,Chandra,,,ui,,,,,',
  'Speed up search,WEB-5,10005,Improvement,Closed,,,,,,,,,,',
  'Orphan step,WEB-6,10006,Sub-task,To Do,,,,99999,,,,,,',
].join('\r\n');

test('a Jira export becomes board items, parents first, with what fits kept', () => {
  const plan = planJiraImport(file, members);
  assert.deepEqual(plan.items.map(i => `${i.ref}:${i.type}`), ['WEB-1:epic', 'WEB-2:story', 'WEB-3:subtask', 'WEB-4:bug', 'WEB-5:task', 'WEB-6:task']);
  const [epic, story, sub, bug, imp] = plan.items;
  assert.equal(story!.parent, 0); assert.equal(sub!.parent, 1); assert.equal(epic!.parent, null);
  assert.deepEqual({ s: story!.status, p: story!.priority, o: story!.ownerId, e: story!.estimateHours, d: story!.dueDate, l: story!.labels, desc: story!.description },
    { s: 'in_progress', p: 'high', o: 'u1', e: 2, d: '2026-11-20', l: ['payments', 'q4'], desc: 'As a shopper, I want to pay by card' });
  assert.equal(epic!.status, 'done'); assert.equal(imp!.status, 'done');
  assert.equal(bug!.status, 'todo'); assert.equal(bug!.ownerId, null);
  assert.equal(sub!.ownerId, null, 'two members share the name, so nobody is picked');
  assert.deepEqual(plan.counts, { epic: 1, story: 1, subtask: 1, bug: 1, task: 2 });
  assert.deepEqual(plan.notes, [
    'More than one member is called "Ben Iyer", so their items came in unassigned.',
    'Status "Waiting for vendor" came in as To do.',
    '"Chandra" is not a member of this workspace (by name), so their items came in unassigned.',
    '"Improvement" items came in as tasks.',
    'A parent that is not in the file was left out.',
    'A sub-task without its parent came in as a task.',
    'Sprints were not brought over; plan them on this board with Sprints.',
    'Columns the board has no field for were left out: Custom field (Story Points).',
  ]);
});

test('a parent the board does not allow is dropped and said; older exports use Epic Link', () => {
  const csv = ['Summary,Issue key,Issue Type,Custom field (Epic Link),Parent id', 'Big,K-1,Epic,,', 'Under epic,K-2,Story,K-1,', 'Story under story,K-3,Story,,K-2'].join('\n');
  const plan = planJiraImport(csv, []);
  assert.deepEqual(plan.items.map(i => [i.ref, i.parent]), [['K-1', null], ['K-2', 0], ['K-3', null]]);
  assert.ok(plan.notes.includes('A story under a story lost that parent (the board does not allow it).'));
});

test('a file that is not a Jira export is refused with what to do', () => {
  assert.throws(() => planJiraImport('Name,Owner\nx,y', []), (e: unknown) => e instanceof ImportError && /Summary and Issue Type/.test(e.message));
  assert.throws(() => planJiraImport('Summary,Issue Type', []), /no rows/);
  assert.throws(() => planJiraImport('Summary,Issue Type\n,Task', []), /No row/);
});
