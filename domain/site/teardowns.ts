// Teardowns in the demo (marketing package, parts 1 and 2; plan claude/marketing-package-plan-21-nov.md, approved
// 21 November 2026). A teardown is a published procedure read once by the real product; only its process model
// comes out of the live database, and the demo's own file is built from that model, the committed copy of the
// published text and a short file of words (teardownState in ./teardownState.ts). Pure: DemoApp, index.tsx, the
// data tool and the tests use it. No server function loads this file.
//
// Adding a teardown is data and words only: a folder under teardowns/<slug>/ (source, model, run, words), its
// built file public/demo-data/teardowns/<slug>.json, its line in public/demo-data/teardowns/index.json and its
// line in public/sitemap.xml.
import type { ProcessModel } from '../processModel/types.ts';
import type { DocLayout, DocumentSettings } from '../docs/branding.ts';
import { DEFAULT_BRANDING } from '../docs/branding.ts';
import type { DocType } from '../docs/tree.ts';

// The addresses are in ./teardownPath.ts, which index.tsx loads on every page, so it stays small.
export { TEARDOWN_BASE, TEARDOWN_INDEX_URL, isTeardownSlug, teardownBase, teardownCanonical, teardownDataUrl, teardownSlug } from './teardownPath.ts';

/** The words every teardown carries (owner-approved for teardown 1, 21 November 2026), from its teardown.json. */
export interface TeardownWords {
  slug: string;
  /** Its name in the demo's banner links. */
  short: string;
  /** 1. The label: a teardown of published text, one document read, nobody interviewed. */
  label: string;
  /** 2. The licence's own credit line, with the licence's address. */
  credit: { text: string; url: string };
  /** 3. The source, with its address and the date the text was retrieved. */
  source: { text: string; url: string; retrieved: string };
  /** 4. Not a review of the organisation, not endorsed by it. */
  notReview: string;
  /** Contact details replaced in the committed copy before the reading, by kind (change d). */
  removed?: { email: number; phone: number };
}

export interface TeardownLink { slug: string; short: string }

/** 5. How many questions stayed open: worked out on the page from the screens' own count, never typed. */
export const openQuestionsLine = (n: number): string =>
  `${n} ${n === 1 ? 'question stayed' : 'questions stayed'} open because nobody who does this work was asked. In a real assessment, they go to the people who know.`;

/** What replaces an email address or a telephone number in the committed copy of the published text. */
export const REMOVED_MARK = { email: '[email address removed]', phone: '[telephone number removed]' } as const;
/** The line a reader is told when the copy had contact details replaced (proposed words, for the owner). */
export function removedLine(w: TeardownWords): string | null {
  const e = w.removed?.email ?? 0, p = w.removed?.phone ?? 0;
  if (!e && !p) return null;
  const parts = [e ? `email addresses are shown as ${REMOVED_MARK.email}` : '', p ? `telephone numbers as ${REMOVED_MARK.phone}` : ''].filter(Boolean);
  return `In this copy of the published text, ${parts.join(' and ')}.`;
}

/** The neutral people, workspace and organisation of every teardown in the demo (C of the plan). */
export const TEARDOWN_PERSON = { name: 'Teardown analyst', email: 'analyst@teardowns.example' } as const;
export const TEARDOWN_ORGANISATION = 'Teardowns';
export const TEARDOWN_WORKSPACE = 'Published processes';

/** The documents a teardown offers with its own section at the start; the evidence pack is not offered (change b). */
export const TEARDOWN_DOCS: DocType[] = ['pdd', 'brd', 'frd', 'sdd', 'agent', 'tests'];
export const ABOUT_TITLE = 'About this teardown';

/** The text of "About this teardown", the first section of every document the teardown offers. */
export function aboutText(w: TeardownWords): string {
  return [w.label, `${w.credit.text} ${w.credit.url}`, `${w.source.text} Retrieved ${w.source.retrieved}. ${w.source.url}`, w.notReview,
    'Every open question in this document stayed open because nobody who does this work was asked.', removedLine(w)]
    .filter(Boolean).join('\n\n');
}

/**
 * The BPMN download on a teardown carries the same lines as an XML comment straight after the declaration
 * (change b). A comment may not hold "--", so any run of hyphens becomes one.
 */
export function withTeardownComment(xml: string, w: TeardownWords): string {
  const body = aboutText(w).replace(/-{2,}/g, '-').split('\n').map(l => `  ${l}`.trimEnd()).join('\n');
  const comment = `<!--\n  ${ABOUT_TITLE}\n\n${body}\n-->`;
  const decl = /^<\?xml[^>]*\?>\n?/.exec(xml);
  return decl ? `${decl[0].replace(/\n?$/, '\n')}${comment}\n${xml.slice(decl[0].length)}` : `${comment}\n${xml}`;
}

/** The teardown's document settings: its organisation's name in the header, and its section first in every document. */
export function teardownDocumentSettings(w: TeardownWords): DocumentSettings {
  const about: DocLayout = { sections: {}, custom: [{ id: 'teardown', after: 'start', title: ABOUT_TITLE, text: aboutText(w) }] };
  return { branding: { ...DEFAULT_BRANDING, organisation: TEARDOWN_ORGANISATION }, layouts: Object.fromEntries(TEARDOWN_DOCS.map(t => [t, about])) };
}

/** The line in Ask Avala's panel on a teardown: the demo has no AI, and its recorded answers are the sample's. */
export const TEARDOWN_ASK_NOTE = {
  text: "Ask Avala's answers are recorded on the sample case only. On a teardown, asking needs a workspace of your own.",
  link: 'Open the sample case',
} as const;
/** What a teardown does not offer, and why, where the download would have been (change b). */
export const NOT_ON_TEARDOWN = 'Not offered on a teardown: this download would not carry the source and licence lines.';

/**
 * The model as it goes into the demo (B of the plan): who answered what a person gives in the product (the
 * process's purpose, a decided approach, a resolved conflict) is the teardown's neutral person, with the
 * teardown's time; everything else is kept exactly as the reading wrote it, the quotes of the published text
 * included. A teardown must hold nothing a person gave; teardownProblems says so when it does.
 */
export function teardownModel(raw: ProcessModel, personId: string, at: string): ProcessModel {
  const m: ProcessModel = structuredClone(raw);
  if (m.meta.purpose) m.meta.purpose = { ...m.meta.purpose, by: personId, at };
  if (m.meta.decidedApproach) m.meta.decidedApproach = { ...m.meta.decidedApproach, by: personId, at };
  for (const c of m.conflicts) if (c.resolution) c.resolution = { ...c.resolution, by: TEARDOWN_PERSON.name, byId: personId };
  return m;
}

// ---- What a teardown's file may not hold (B, and changes a and d) --------------------------------------------

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A telephone number: starts with "+" or a 0 (UK and Indian forms), groups of digits split by single spaces,
// hyphens or brackets, 9 to 13 digits in all. Amounts, dates and counts do not start that way.
const PHONE_LIKE = /(?<![\w.£$€])(?:\+|\(?0)[\d()\- ]*\d(?![\w])/g;
const isPhone = (m: string) => { const n = m.replace(/\D/g, '').length; return n >= 9 && n <= 13 && !/[ -]{2}/.test(m); };
const phonesIn = (text: string) => (text.match(PHONE_LIKE) ?? []).filter(isPhone);
const JWT = /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/;
const KEY = /\b(?:sk|pk|sb|rk)[-_][A-Za-z0-9_-]{16,}\b/;

/** Email addresses and telephone numbers in a text. */
export function findContacts(text: string): { emails: string[]; phones: string[] } {
  return { emails: text.match(EMAIL) ?? [], phones: phonesIn(text) };
}
/** The committed copy of a published text with its contact details replaced, and how many of each (change d). */
export function removeContacts(text: string): { text: string; removed: { email: number; phone: number } } {
  let email = 0, phone = 0;
  const out = text.replace(EMAIL, () => { email++; return REMOVED_MARK.email; }).replace(PHONE_LIKE, m => { if (!isPhone(m)) return m; phone++; return REMOVED_MARK.phone; });
  return { text: out, removed: { email, phone } };
}
const count = (text: string, mark: string) => text.split(mark).length - 1;

/** The fields of the demo's state that name a person. */
const PERSON_KEYS = new Set(['userId', 'analystId', 'architectId', 'approverId', 'ownerId', 'actorId', 'authorId', 'resolvedBy', 'approvedBy', 'by', 'byId', 'updatedBy']);
/** A fact or element a reading writes has one of these; a person's answer is user-confirmed, assumed or typical. */
const READ_STATUSES = new Set(['stated', 'inferred', 'unknown']);

interface Walked { path: string; key: string; value: unknown; parent: Record<string, unknown> }
function walk(v: unknown, path: string, out: Walked[], parent: Record<string, unknown> | null = null, key = '') {
  if (parent) out.push({ path, key, value: v, parent });
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, out, v as unknown as Record<string, unknown>, String(i)));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, out, v as Record<string, unknown>, k);
}

/** The demo state's shape, as far as these checks read it. */
interface StateLike {
  teardown?: TeardownWords;
  me?: { id: string; email: string };
  workspaces?: { organizationName?: string; name?: string }[];
  revisions?: { state: string; approvedAt?: string | null; model: ProcessModel }[];
  sources?: { key: string; fileName: string; segmentCount: number; segments: { text: string }[] }[];
  people?: Record<string, { members: { userId: string; name: string; email: string }[] }>;
  documentSettings?: { settings: DocumentSettings }[];
}

/**
 * Everything wrong with a teardown's demo file, in words; empty when it may be published. `live` is what the
 * live database said when the model was taken out: each source's passage count, by key.
 */
export function teardownProblems(state: StateLike, live: { liveSegments: Record<string, number> }): string[] {
  const p: string[] = [];
  const w = state.teardown;
  if (!w) return ['The file carries no teardown words.'];
  for (const [k, v] of [['label', w.label], ['credit', w.credit?.text], ['source', w.source?.text], ['retrieved', w.source?.retrieved], ['not a review', w.notReview]] as const) if (!v?.trim()) p.push(`The ${k} line is missing.`);
  const all: Walked[] = [];
  walk(state, '$', all);
  const strings = all.filter(x => typeof x.value === 'string') as (Walked & { value: string })[];

  // People: only the neutral person, by id and by name; every email address the made-up one.
  const members = Object.values(state.people ?? {}).flatMap(x => x.members);
  const ids = new Set([state.me?.id, ...members.map(m => m.userId)].filter(Boolean) as string[]);
  if (state.me?.email !== TEARDOWN_PERSON.email) p.push('The person signed in is not the teardown analyst.');
  for (const m of members) if (m.name !== TEARDOWN_PERSON.name || m.email !== TEARDOWN_PERSON.email) p.push(`A person who is not the teardown analyst: ${m.name}.`);
  for (const ws of state.workspaces ?? []) if (ws.organizationName !== TEARDOWN_ORGANISATION || ws.name !== TEARDOWN_WORKSPACE) p.push('The workspace is not the neutral teardowns workspace.');
  for (const s of strings) for (const e of s.value.match(EMAIL) ?? []) if (!e.endsWith('@teardowns.example')) p.push(`An email address at ${s.path}.`);
  for (const s of strings) if (JWT.test(s.value) || KEY.test(s.value)) p.push(`Something like a key or a sign-in token at ${s.path}.`);
  for (const x of all) if (PERSON_KEYS.has(x.key) && x.value !== null && x.value !== undefined && x.key !== 'by' && !ids.has(String(x.value))) p.push(`${x.path} names someone who is not in the file.`);
  for (const x of all) if (x.key === 'by' && x.value !== null && x.value !== undefined && !ids.has(String(x.value)) && x.value !== TEARDOWN_PERSON.name) p.push(`${x.path} names someone who is not in the file.`);

  // Nothing approved; nothing a person gave (change a).
  for (const r of state.revisions ?? []) {
    if (r.state === 'approved' || r.approvedAt) p.push('A revision is approved: a teardown stays a working draft.');
    const m = r.model;
    for (const q of m.openQuestions) {
      if (q.status !== 'open') p.push(`Question ${q.id} is ${q.status}: nothing in a teardown is answered or deferred.`);
      if (q.owner !== null) p.push(`Question ${q.id} is left with someone.`);
      if (q.answer) p.push(`Question ${q.id} holds an answer.`);
    }
    for (const c of m.conflicts) if (c.resolution) p.push(`Conflict ${c.id} is resolved: nobody resolves anything in a teardown.`);
    if (m.meta.decidedApproach) p.push('An approach is decided: nobody decides anything in a teardown.');
    const facts: Walked[] = [];
    walk(m, '$.model', facts);
    for (const x of facts) {
      const o = x.value as { status?: unknown; sources?: unknown } | null;
      if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.sources) || typeof o.status !== 'string') continue;
      if (!READ_STATUSES.has(o.status)) p.push(`${x.path} is "${o.status}": given by a person, not read from the text.`);
      else if (o.status !== 'unknown' && !o.sources.length) p.push(`${x.path} is "${o.status}" with no passage of the text behind it.`);
    }
  }

  // The sources: only the committed text, passage for passage as the live reading had it; every quote found in it.
  const sources = state.sources ?? [];
  for (const s of sources) {
    if (/^(ans|own)-/.test(s.key)) p.push(`Source ${s.key} is a person's notes or own words.`);
    if (live.liveSegments[s.key] !== s.segmentCount || s.segments.length !== s.segmentCount) p.push(`Source ${s.key} has ${s.segments.length} passages here and ${live.liveSegments[s.key] ?? 'none'} in the live reading.`);
  }
  for (const k of Object.keys(live.liveSegments)) if (!sources.some(s => s.key === k)) p.push(`The live reading had source ${k}, which is not here.`);
  const text = new Map(sources.map(s => [s.key, s.segments.map(x => x.text).join('\n')]));
  for (const r of state.revisions ?? []) {
    const refs: Walked[] = [];
    walk(r.model, '$.model', refs);
    for (const x of refs) {
      const o = x.value as { sourceId?: unknown; excerpt?: unknown } | null;
      if (!o || typeof o !== 'object' || typeof o.sourceId !== 'string' || typeof o.excerpt !== 'string') continue;
      const t = text.get(o.sourceId);
      if (t === undefined) p.push(`${x.path} quotes source ${o.sourceId}, which is not in the file.`);
      else if (o.excerpt && !t.includes(o.excerpt)) p.push(`${x.path} quotes words that are not in source ${o.sourceId}.`);
    }
  }

  // Contact details (change d): none left in the text, each replaced one said so.
  const all_text = [...text.values()].join('\n');
  const left = findContacts(all_text);
  if (left.emails.length) p.push(`The text still holds ${left.emails.length} email ${left.emails.length === 1 ? 'address' : 'addresses'}.`);
  if (left.phones.length) p.push(`The text still holds ${left.phones.length} telephone ${left.phones.length === 1 ? 'number' : 'numbers'}.`);
  const marked = { email: count(all_text, REMOVED_MARK.email), phone: count(all_text, REMOVED_MARK.phone) };
  if (marked.email !== (w.removed?.email ?? 0) || marked.phone !== (w.removed?.phone ?? 0)) p.push(`The text shows ${marked.email} removed email addresses and ${marked.phone} removed numbers; the words say ${w.removed?.email ?? 0} and ${w.removed?.phone ?? 0}.`);

  // Every document the teardown offers starts with its section, carrying the lines (change b).
  const layouts = state.documentSettings?.[0]?.settings.layouts ?? {};
  const want = aboutText(w);
  for (const t of TEARDOWN_DOCS) {
    const c = layouts[t]?.custom?.find(x => x.after === 'start' && x.title === ABOUT_TITLE);
    if (!c || c.text !== want) p.push(`The ${t} document does not start with "${ABOUT_TITLE}" and its lines.`);
  }
  return [...new Set(p)];
}
