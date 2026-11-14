// Bringing a board over from Jira: a CSV export ("Export issues → Export CSV (all fields)") read into
// board items, shown to a person before anything is saved. Nothing is invented: what Jira has and the
// board has a field for is kept; what does not fit is said in the preview, never guessed.
import { allowedParents, BOARD_LIMITS, LABEL_LIMITS, type ItemType, type WorkItem, type WorkStatus } from './board.ts';

/** Reads CSV (RFC 4180): quoted cells, doubled quotes, line breaks inside quotes, CRLF or LF, a UTF-8 mark. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, i = 0;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' || c === '\n') {
      row.push(cell); cell = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += c; i++;
  }
  row.push(cell);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

export const IMPORT_LIMIT = 2000;

export interface PlannedItem {
  /** Jira's key (ABC-12) or id, to show which row it was. */
  ref: string;
  type: ItemType; title: string; description: string; status: WorkStatus; priority: WorkItem['priority'];
  ownerId: string | null; estimateHours: number | null; startDate: string | null; dueDate: string | null; labels: string[];
  /** Index in `items` of its parent (always earlier in the list), or null. */
  parent: number | null;
}
export interface ImportPlan { items: PlannedItem[]; notes: string[]; counts: Partial<Record<ItemType, number>> }
export class ImportError extends Error {}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
const TYPES: Record<string, ItemType> = { epic: 'epic', story: 'story', 'user story': 'story', task: 'task', bug: 'bug', 'sub task': 'subtask', subtask: 'subtask', 'sub bug': 'subtask' };
const STATUSES: Record<string, WorkStatus> = {
  'to do': 'todo', todo: 'todo', open: 'todo', backlog: 'todo', 'selected for development': 'todo', new: 'todo', reopened: 'todo',
  'in progress': 'in_progress', 'in development': 'in_progress', doing: 'in_progress',
  'in review': 'in_review', review: 'in_review', 'code review': 'in_review', 'peer review': 'in_review',
  testing: 'testing', 'in testing': 'testing', qa: 'testing', 'in qa': 'testing', 'ready for qa': 'testing',
  'ready for release': 'ready_for_release', 'ready to release': 'ready_for_release', 'ready for deployment': 'ready_for_release',
  done: 'done', closed: 'done', resolved: 'done', complete: 'done', completed: 'done', released: 'done',
  blocked: 'blocked', 'on hold': 'on_hold', paused: 'on_hold',
};
const CATEGORY: Record<string, WorkStatus> = { 'to do': 'todo', 'in progress': 'in_progress', done: 'done' };
const PRIORITY: Record<string, WorkItem['priority']> = { highest: 'high', high: 'high', critical: 'high', blocker: 'high', medium: 'medium', low: 'low', lowest: 'low', minor: 'low', trivial: 'low' };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Jira dates: 2026-11-20, 20/Nov/26 or 20/Nov/2026 (with or without a time). Anything else is not read. */
export function jiraDate(v: string): string | null | undefined {
  const t = v.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2}|\d{4})\b/.exec(t);
  if (m) {
    const mon = MONTHS.indexOf(m[2]!.toLowerCase());
    if (mon < 0) return undefined;
    const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(mon + 1).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return undefined;
}

/**
 * Turns a Jira CSV export into board items, parents first. `members` are the workspace's people: an
 * assignee is kept only when exactly one member has that name.
 */
export function planJiraImport(text: string, members: { userId: string; name: string }[]): ImportPlan {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new ImportError('The file has no rows to import.');
  const head = rows[0]!.map(norm);
  const col = (...names: string[]) => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const cols = (name: string) => head.flatMap((h, i) => (h === name ? [i] : []));
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const cSummary = col('summary'), cType = col('issue type'), cKey = col('issue key', 'key'), cId = col('issue id', 'id');
  if (cSummary < 0 || cType < 0) throw new ImportError('This does not look like a Jira export: it needs the Summary and Issue Type columns. In Jira, export the issues as CSV (all fields).');
  const cStatus = col('status'), cCategory = col('status category'), cPriority = col('priority'), cAssignee = col('assignee'), cDesc = col('description');
  const cParent = col('parent', 'parent id'), cParentKey = col('parent key'), cEpicLink = col('custom field (epic link)', 'epic link');
  const cEstimate = col('original estimate'), cDue = col('due date', 'due'), cStart = col('start date', 'custom field (start date)');
  const cLabels = cols('labels');
  const data = rows.slice(1);
  if (data.length > IMPORT_LIMIT) throw new ImportError(`The file has ${data.length} rows; import at most ${IMPORT_LIMIT} at a time.`);

  const notes: string[] = [];
  const counter = new Map<string, number>();
  const note = (k: string) => counter.set(k, (counter.get(k) ?? 0) + 1);
  const byName = new Map<string, string[]>();
  for (const m of members) byName.set(norm(m.name), [...(byName.get(norm(m.name)) ?? []), m.userId]);

  interface Raw extends Omit<PlannedItem, 'parent'> { parentRef: string; id: string; key: string }
  const raw: Raw[] = [];
  for (const r of data) {
    const title = at(r, cSummary).replace(/\s+/g, ' ');
    if (!title) { note('A row without a Summary was left out'); continue; }
    const jiraType = at(r, cType);
    let type = TYPES[norm(jiraType)];
    if (!type) { type = 'task'; note(`"${jiraType || 'no type'}" items came in as tasks`); }
    const statusText = at(r, cStatus);
    let status = STATUSES[norm(statusText)] ?? CATEGORY[norm(at(r, cCategory))];
    if (!status) { status = 'todo'; if (statusText) note(`Status "${statusText}" came in as To do`); }
    const prioText = at(r, cPriority);
    const priority = prioText ? (PRIORITY[norm(prioText)] ?? null) : null;
    if (prioText && !priority) note(`Priority "${prioText}" was left unset`);
    const who = at(r, cAssignee);
    const found = who ? byName.get(norm(who)) : undefined;
    const ownerId = found?.length === 1 ? found[0]! : null;
    if (who && !ownerId) note(found?.length ? `More than one member is called "${who}", so their items came in unassigned` : `"${who}" is not a member of this workspace (by name), so their items came in unassigned`);
    let description = at(r, cDesc);
    if (description.length > BOARD_LIMITS.description) { description = description.slice(0, BOARD_LIMITS.description); note('A description longer than the board takes was shortened'); }
    const secs = Number(at(r, cEstimate));
    const estimateHours = at(r, cEstimate) && Number.isFinite(secs) && secs >= 0 ? Math.round((secs / 3600) * 100) / 100 : null;
    const dates = { dueDate: jiraDate(at(r, cDue)), startDate: jiraDate(at(r, cStart)) };
    for (const [k, v] of Object.entries(dates)) if (v === undefined) note(`A ${k === 'dueDate' ? 'due' : 'start'} date in a form the board cannot read was left out`);
    let startDate = dates.startDate ?? null, dueDate = dates.dueDate ?? null;
    if (startDate && dueDate && dueDate < startDate) { startDate = null; note('A start date after its due date was left out'); }
    const labelSeen = new Set<string>(), labels: string[] = [];
    for (const l of cLabels.flatMap(i => at(r, i).split(/[\s,]+/)).filter(Boolean)) {
      if (l.length > LABEL_LIMITS.length) { note(`A label longer than ${LABEL_LIMITS.length} characters was left out`); continue; }
      if (!labelSeen.has(l.toLowerCase()) && labels.length < LABEL_LIMITS.count) { labelSeen.add(l.toLowerCase()); labels.push(l); }
    }
    const key = at(r, cKey), id = at(r, cId);
    raw.push({ ref: key || id || title, key, id, type, title: title.slice(0, BOARD_LIMITS.title), description, status, priority, ownerId, estimateHours, startDate, dueDate, labels,
      parentRef: at(r, cParent) || at(r, cParentKey) || at(r, cEpicLink) });
  }
  if (!raw.length) throw new ImportError('No row in the file has a Summary.');

  // Parents by Jira id or key; keep a parent only where the board allows it (as in Jira), parents first.
  const index = new Map<string, number>();
  raw.forEach((x, i) => { if (x.id) index.set(x.id, i); if (x.key) index.set(x.key, i); });
  const parentOf = raw.map((x, i) => {
    if (!x.parentRef) return null;
    const p = index.get(x.parentRef);
    if (p === undefined || p === i) { note('A parent that is not in the file was left out'); return null; }
    return p;
  });
  const fake = (x: Raw, i: number) => ({ id: String(i), type: x.type, parentId: parentOf[i] === null ? null : String(parentOf[i]) }) as WorkItem;
  for (let i = 0; i < raw.length; i++) {
    const p = parentOf[i];
    if (p === null) continue;
    const pool = raw.map(fake);
    if (!allowedParents(raw[i]!.type, pool, String(i)).some(c => c.id === String(p))) { parentOf[i] = null; note(`A ${raw[i]!.type === 'subtask' ? 'sub-task' : raw[i]!.type} under a ${raw[p]!.type === 'subtask' ? 'sub-task' : raw[p]!.type} lost that parent (the board does not allow it)`); }
  }
  for (let i = 0; i < raw.length; i++) if (raw[i]!.type === 'subtask' && parentOf[i] === null) { raw[i]!.type = 'task'; note('A sub-task without its parent came in as a task'); }

  const order: number[] = [], placed = new Set<number>();
  const place = (i: number) => { if (placed.has(i)) return; placed.add(i); const p = parentOf[i]; if (p !== null && p !== undefined) place(p); order.push(i); };
  raw.forEach((_, i) => place(i));
  const pos = new Map(order.map((i, n) => [i, n]));
  const items: PlannedItem[] = order.map(i => {
    const { parentRef: _r, id: _i, key: _k, ...rest } = raw[i]!;
    const p = parentOf[i];
    return { ...rest, parent: p === null || p === undefined ? null : pos.get(p)! };
  });

  for (const [k, n] of counter) notes.push(n > 1 ? `${k} (${n}).` : `${k}.`);
  const known = new Set(['summary', 'issue type', 'issue key', 'key', 'issue id', 'id', 'status', 'status category', 'priority', 'assignee', 'description', 'parent', 'parent id', 'parent key', 'custom field (epic link)', 'epic link', 'original estimate', 'due date', 'due', 'start date', 'custom field (start date)', 'labels', 'parent summary']);
  if (head.includes('sprint')) notes.push('Sprints were not brought over; plan them on this board with Sprints.');
  if (head.includes('comment')) notes.push('Comments were not brought over.');
  if (head.includes('attachment')) notes.push('Attachments were not brought over.');
  const other = [...new Set(head.filter(h => h && !known.has(h) && !['sprint', 'comment', 'attachment'].includes(h)))];
  if (other.length) notes.push(`Columns the board has no field for were left out: ${other.slice(0, 8).map(h => rows[0]![head.indexOf(h)]!.trim()).join(', ')}${other.length > 8 ? ` and ${other.length - 8} more` : ''}.`);
  const counts: ImportPlan['counts'] = {};
  for (const x of items) counts[x.type] = (counts[x.type] ?? 0) + 1;
  return { items, notes, counts };
}
