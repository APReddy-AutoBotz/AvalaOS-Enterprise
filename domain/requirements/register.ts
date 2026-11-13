// The requirements register: derived requirements matched to the stored ones by derivation key.
// IDs (BR-001, FR-001, NFR-001) are given once and never reused. A person's edit to the wording,
// acceptance criteria or priority wins on every regeneration; links always follow the model. A stored
// requirement whose source is gone is kept, marked "source removed", never deleted.
import { hashText } from '../docs/edits.ts';
import { REQ_ORDER, type Acceptance, type DerivedRequirement, type Priority, type ReqCategory, type ReqKind } from './derive.ts';

export interface StoredRequirement {
  code: string;
  kind: ReqKind;
  key: string | null;
  category: ReqCategory | 'user';
  title: string;
  statement: string;
  rationale: string;
  priority: Priority | null;
  acceptance: Acceptance[];
  stepIds: string[];
  ruleIds: string[];
  exceptionIds: string[];
  /** Codes of the business requirements this one serves. */
  traces: string[];
  gaps: string[];
  origin: 'derived' | 'user';
  edited: boolean;
  state: 'active' | 'source_removed' | 'retired';
  order: number;
  /** For an edited requirement: the hash of the derived text it was edited from. */
  baseHash?: string | null;
}
export interface Requirement extends StoredRequirement {
  /** An edited requirement whose derived text changed since the edit. */
  needsReview?: boolean;
  derived?: { title: string; statement: string; acceptance: Acceptance[] };
}
export const reqHash = (r: { title: string; statement: string; acceptance: Acceptance[] }) => hashText(JSON.stringify([r.title, r.statement, r.acceptance]));

export interface Reconciled { requirements: Requirement[]; changed: StoredRequirement[] }

const pad = (n: number) => String(n).padStart(3, '0');
const numberOf = (code: string) => Number(code.split('-')[1]) || 0;
/** The fields kept in storage, in a fixed form, so comparing ignores what is computed on each build. */
export const persisted = ({ needsReview: _n, derived: _d, ...r }: Requirement): StoredRequirement => ({ ...r, baseHash: r.baseHash ?? null });
const same = (a: StoredRequirement, b: StoredRequirement) => JSON.stringify(persisted(a)) === JSON.stringify(persisted(b));

export function reconcile(derived: DerivedRequirement[], stored: StoredRequirement[]): Reconciled {
  const byKey = new Map(stored.filter(s => s.key).map(s => [s.key!, s]));
  const next: Record<ReqKind, number> = { BR: 0, FR: 0, NFR: 0 };
  for (const s of stored) next[s.kind] = Math.max(next[s.kind], numberOf(s.code));
  const codeOfKey = new Map<string, string>();
  for (const d of derived) {
    const old = byKey.get(d.key);
    codeOfKey.set(d.key, old && old.kind === d.kind ? old.code : `${d.kind}-${pad(++next[d.kind])}`);
  }
  const out: StoredRequirement[] = [];
  derived.forEach((d, i) => {
    const old = byKey.get(d.key);
    const code = codeOfKey.get(d.key)!;
    const links = { stepIds: d.stepIds, ruleIds: d.ruleIds, exceptionIds: d.exceptionIds, traces: d.traces.map(k => codeOfKey.get(k)).filter((x): x is string => Boolean(x)), gaps: d.gaps };
    const editedNow = Boolean(old?.edited && old.code === code);
    const text = editedNow
      ? { title: old!.title, statement: old!.statement, rationale: old!.rationale, acceptance: old!.acceptance, priority: old!.priority, edited: true }
      : { title: d.title, statement: d.statement, rationale: d.rationale, acceptance: d.acceptance, priority: old?.code === code ? old.priority : null, edited: false };
    // An edit is checked against the derived text it was made from: when that changes, it needs review.
    const derivedHash = reqHash(d);
    const baseHash = editedNow ? old!.baseHash ?? derivedHash : null;
    out.push({ code, kind: d.kind, key: d.key, category: d.category, ...text, ...links, origin: 'derived', state: 'active', order: i, baseHash,
      ...(editedNow ? { needsReview: baseHash !== derivedHash, derived: { title: d.title, statement: d.statement, acceptance: d.acceptance } } : {}) });
  });
  const live = new Set(out.map(r => r.code));
  // Stored requirements no longer derived (or written by a person) are kept after the derived ones.
  for (const s of stored) {
    if (live.has(s.code)) continue;
    const state = s.origin === 'user' ? s.state : s.state === 'retired' ? 'retired' : 'source_removed';
    out.push({ ...s, state, order: derived.length + out.length });
  }
  out.sort((a, b) => (a.state === 'active' ? 0 : 1) - (b.state === 'active' ? 0 : 1) || REQ_ORDER[a.kind] - REQ_ORDER[b.kind] || a.order - b.order);
  out.forEach((r, i) => { r.order = i; });
  const before = new Map(stored.map(s => [s.code, s]));
  return { requirements: out, changed: out.filter(r => !before.has(r.code) || !same(before.get(r.code)!, r)) };
}

export class RequirementError extends Error {}
export const REQ_LIMITS = { title: 200, statement: 2000, rationale: 2000, criteria: 20, criterion: 600 } as const;

/** A person's edit: the wording, criteria and priority are theirs from now on. */
export function editRequirement(r: Requirement, e: { title: string; statement: string; priority: Priority | null; acceptance: Acceptance[] }): Requirement {
  const title = e.title.trim(), statement = e.statement.trim();
  if (!title) throw new RequirementError('Give the requirement a title.');
  if (!statement) throw new RequirementError('Write what the solution shall do.');
  if (title.length > REQ_LIMITS.title || statement.length > REQ_LIMITS.statement) throw new RequirementError('The title or statement is too long.');
  const acceptance = e.acceptance.map(a => ({ given: a.given.trim(), when: a.when.trim(), then: a.then.trim() })).filter(a => a.given || a.when || a.then);
  if (acceptance.length > REQ_LIMITS.criteria) throw new RequirementError(`Keep to ${REQ_LIMITS.criteria} acceptance criteria.`);
  if (acceptance.some(a => !a.given || !a.when || !a.then)) throw new RequirementError('Each acceptance criterion needs Given, When and Then.');
  if (acceptance.some(a => a.given.length + a.when.length + a.then.length > REQ_LIMITS.criterion)) throw new RequirementError('An acceptance criterion is too long.');
  // The edit is made against the derived text shown now, unless it was already edited.
  const base = r.edited ? r.baseHash ?? null : reqHash(r.derived ?? r);
  return { ...r, title, statement, priority: e.priority, acceptance, edited: true, baseHash: base, needsReview: false };
}

/** Back to the derived wording on the next reconcile. */
export const revertRequirement = (r: Requirement): Requirement => ({ ...r, edited: false, baseHash: null, needsReview: false });
/** Keep the person's text and mark the new derived text as seen. */
export const keepRequirement = (r: Requirement): Requirement => ({ ...r, baseHash: r.derived ? reqHash(r.derived) : r.baseHash, needsReview: false });

export const PRIORITY_LABEL: Record<Priority, string> = { must: 'Must', should: 'Should', could: 'Could', wont: "Won't" };
const low = (s: string) => (/^([A-Z][a-z]|A\s)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
export const criterionText = (a: Acceptance) => `Given ${low(a.given.replace(/\.$/, ''))}, when ${low(a.when.replace(/\.$/, ''))}, then ${low(a.then.replace(/\.$/, ''))}.`;
