import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from './board.ts';
import { csv, inOrder, toAzureCsv, toJiraCsv } from './export.ts';

const base: WorkItem = { id: '', projectId: 'p', parentId: null, type: 'story', title: '', description: '', acceptance: [], status: 'todo', priority: null, ownerId: null, estimateHours: null, startDate: null, dueDate: null, processId: null, stepIds: [], requirements: [], snapshot: {}, updatedAt: '' };
const mk = (id: string, type: WorkItem['type'], parentId: string | null, more: Partial<WorkItem> = {}): WorkItem => ({ ...base, id, type, parentId, title: `T ${id}`, ...more });
// Children are listed before their parents on purpose: the export puts parents first.
const items = [
  mk('uat', 'task', 's1'), mk('s1', 'story', 'e1', { description: 'As the AP Clerk, I want "x", so that y.', acceptance: ['Given a, when b, then c.', 'Second'], requirements: ['FR-001', 'FR-002'], priority: 'high', ownerId: 'u1', estimateHours: 1.5, dueDate: '2026-12-01', status: 'in_progress' }),
  mk('sp', 'spike', 'e1'), mk('e1', 'epic', null), mk('d', 'decision', null), mk('acc', 'task', 'e1'),
];
const owner = (id: string) => (id === 'u1' ? 'Priya Nair' : null);
const parse = (text: string) => text.replace(/^﻿/, '').trimEnd().split('\r\n');

test('csv: quotes, commas and line breaks are escaped; Excel reads it as UTF-8', () => {
  const out = csv([['a', 'b'], ['He said "hi", twice', 'line 1\nline 2'], [null, 3]]);
  assert.ok(out.startsWith('﻿'));
  assert.equal(out.slice(1), 'a,b\r\n"He said ""hi"", twice","line 1\nline 2"\r\n,3\r\n');
});

test('order: an epic before its work, a story before its tasks, work without an epic last, nothing twice', () => {
  assert.deepEqual(inOrder(items).map(n => [n.item.id, n.depth]), [['e1', 0], ['s1', 1], ['uat', 2], ['sp', 1], ['acc', 1], ['d', 0]]);
});

test('Jira: numbered rows with their parent, Sub-task under a story, spike and decision as a labelled Task, criteria in the description', () => {
  const rows = parse(toJiraCsv(items, owner));
  assert.equal(rows[0], 'Issue ID,Parent,Issue Type,Summary,Description,Status,Priority,Assignee,Start date,Due date,Original estimate,Labels,Labels,Labels,Labels,Labels,Labels');
  const text = toJiraCsv(items, owner);
  assert.match(text, /\r\n1,,Epic,T e1,/);
  assert.match(text, /\r\n2,1,Story,T s1,"As the AP Clerk, I want ""x"", so that y\.\n\nAcceptance criteria:\n1\. Given a, when b, then c\.\n2\. Second\n\nRequirements: FR-001, FR-002",In progress,High,Priya Nair,,2026-12-01,5400,FR-001,FR-002,,,,\r\n/);
  assert.match(text, /\r\n3,2,Sub-task,T uat,/);
  assert.match(text, /\r\n4,1,Task,T sp,,To do,,,,,,spike,,,,,\r\n/);
  assert.match(text, /\r\n6,,Task,T d,,To do,,,,,,decision,/);
});

test('Azure DevOps: Feature, User Story, Task by title column; no state or ID; what has no field is in the description and tags', () => {
  const rows = parse(toAzureCsv(items, owner));
  assert.equal(rows[0], 'Work Item Type,Title 1,Title 2,Title 3,Description,Priority,Tags');
  assert.equal(rows[1], 'Feature,T e1,,,,,');
  assert.match(rows[2], /^User Story,,T s1,,"As the AP Clerk, I want ""x"", so that y\.<br><br>Acceptance criteria:<br>1\. Given a, when b, then c\.<br>2\. Second<br><br>Requirements: FR-001, FR-002<br>Owner: Priya Nair<br>Estimate: 1\.5 h<br>Due date: 2026-12-01",1,In progress; FR-001; FR-002$/);
  assert.equal(rows[3], 'Task,,,T uat,,,');
  assert.equal(rows[4], 'User Story,,T sp,,,,Spike');
  assert.equal(rows[5], 'User Story,,T acc,,,,Enabler');
  assert.equal(rows[6], 'User Story,T d,,,,,Decision');
  assert.ok(!toAzureCsv(items, owner).includes('State'));
});
