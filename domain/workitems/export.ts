// The board as files other tools import: Jira (CSV import with "Issue ID" and "Parent") and Azure
// DevOps (CSV import with "Title 1", "Title 2", "Title 3" for the hierarchy). Nothing is added that
// is not on the item; what a tool cannot take as a field goes into the description in words.
//
// Jira: a story and a task are the same level, so work under a story becomes a Sub-task; spikes and
// decisions become a Task with a label. Azure DevOps (Agile process): an epic here is a Feature, work
// directly under it is a User Story (tagged when it is a task, spike or decision), work under a
// story is a Task. Azure creates every imported item as New, so the status goes into the tags.
import { lanesOf, STATUS_LABEL, type WorkItem } from './board.ts';

/** One CSV document (RFC 4180): quoted where needed, CRLF lines, and a mark so Excel reads it as UTF-8. */
export function csv(rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => { const s = v === null ? '' : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

interface Node { item: WorkItem; depth: number; parent: WorkItem | null }
/** Parents before their children, epics first, as both importers need. Depth 0 is an epic or work without one. */
export function inOrder(items: WorkItem[]): Node[] {
  const out: Node[] = [];
  const seen = new Set<string>();
  const kids = (id: string) => items.filter(i => i.parentId === id);
  const walk = (item: WorkItem, depth: number, parent: WorkItem | null) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    out.push({ item, depth, parent });
    for (const k of kids(item.id)) walk(k, depth + 1, item);
  };
  for (const lane of lanesOf(items)) {
    if (lane.epic) walk(lane.epic, 0, null);
    else for (const i of lane.items) if (!i.parentId || !items.some(x => x.id === i.parentId)) walk(i, 0, null);
  }
  for (const i of items) walk(i, 0, null); // anything not reached keeps its place at the end
  return out;
}

/** The description as the other tool shows it: the item's text, its criteria, and what has no field there. */
function body(i: WorkItem, extra: string[]): string {
  return [
    i.description.trim(),
    i.acceptance.length ? ['Acceptance criteria:', ...i.acceptance.map((a, n) => `${n + 1}. ${a}`)].join('\n') : '',
    [...(i.requirements.length ? [`Requirements: ${i.requirements.join(', ')}`] : []), ...extra].join('\n'),
  ].filter(Boolean).join('\n\n');
}

const JIRA_LABELS = 6;
/** Jira CSV import. Map "Issue ID" to Work item ID (Issue ID) and "Parent" to Parent in the import wizard. */
export function toJiraCsv(items: WorkItem[], ownerName: (id: string) => string | null): string {
  const nodes = inOrder(items);
  const no = new Map(nodes.map((n, i) => [n.item.id, i + 1]));
  const type = (n: Node) => (n.item.type === 'epic' ? 'Epic' : n.parent && n.parent.type !== 'epic' ? 'Sub-task' : n.item.type === 'story' ? 'Story' : n.item.type === 'bug' ? 'Bug' : 'Task');
  const head = ['Issue ID', 'Parent', 'Issue Type', 'Summary', 'Description', 'Status', 'Priority', 'Assignee', 'Start date', 'Due date', 'Original estimate', ...Array.from({ length: JIRA_LABELS }, () => 'Labels')];
  const rows = nodes.map(n => {
    const i = n.item;
    const labels = [...(i.type === 'spike' ? ['spike'] : i.type === 'decision' ? ['decision'] : []), ...i.requirements].slice(0, JIRA_LABELS);
    return [
      no.get(i.id)!, n.parent ? no.get(n.parent.id)! : null, type(n), i.title, body(i, []), STATUS_LABEL[i.status],
      i.priority ? i.priority[0].toUpperCase() + i.priority.slice(1) : null, i.ownerId ? ownerName(i.ownerId) : null,
      i.startDate, i.dueDate, i.estimateHours === null ? null : Math.round(i.estimateHours * 3600),
      ...Array.from({ length: JIRA_LABELS }, (_, k) => labels[k] ?? null),
    ];
  });
  return csv([head, ...rows]);
}

const html = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
const AZURE_PRIORITY = { high: 1, medium: 2, low: 3 } as const;
/** Azure DevOps CSV import (Agile process). New items only: no ID, no State. Deeper levels than three stay at the third. */
export function toAzureCsv(items: WorkItem[], ownerName: (id: string) => string | null): string {
  const head = ['Work Item Type', 'Title 1', 'Title 2', 'Title 3', 'Description', 'Priority', 'Tags'];
  const rows = inOrder(items).map(n => {
    const i = n.item;
    const underEpic = n.depth === 1 && n.parent?.type === 'epic';
    const level = Math.min(n.depth, 2);
    const type = i.type === 'epic' ? 'Feature' : i.type === 'bug' ? 'Bug' : n.depth === 0 || underEpic ? 'User Story' : 'Task';
    const kind = i.type === 'spike' ? 'Spike' : i.type === 'decision' ? 'Decision' : i.type === 'task' && type === 'User Story' ? 'Enabler' : null;
    const extra = [
      ...(i.ownerId && ownerName(i.ownerId) ? [`Owner: ${ownerName(i.ownerId)}`] : []),
      ...(i.estimateHours !== null ? [`Estimate: ${i.estimateHours} h`] : []),
      ...(i.startDate ? [`Start date: ${i.startDate}`] : []), ...(i.dueDate ? [`Due date: ${i.dueDate}`] : []),
    ];
    return [type, level === 0 ? i.title : null, level === 1 ? i.title : null, level === 2 ? i.title : null, html(body(i, extra)),
      i.priority ? AZURE_PRIORITY[i.priority] : null, [...(kind ? [kind] : []), ...(i.status !== 'todo' ? [STATUS_LABEL[i.status]] : []), ...i.requirements].join('; ')];
  });
  return csv([head, ...rows]);
}
