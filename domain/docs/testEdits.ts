// Testers' edits to the test pack (part F; table test_case_edits). The pack is always derived again from
// the requirements; an edit replaces a case's fields, sets it aside, or adds a case of a tester's own.
// Each edit records the derived case it was made against (base_hash): when the requirement changes, the
// case shows "needs review" with the new derived text, and the tester keeps theirs or takes the update.
// A case set aside stays in the list as set aside, so deriving again never brings it back silently.
import { hashText } from './edits.ts';
import type { TestCase, TestPack } from './tests.ts';

export const EDITABLE_FIELDS = ['title', 'prepare', 'do', 'check', 'data', 'expected'] as const;
export type EditableField = typeof EDITABLE_FIELDS[number];
export const FIELD_LABEL: Record<EditableField, string> = { title: 'What is tested', prepare: 'Prepare', do: 'Do', check: 'Check', data: 'Data', expected: 'Expected result' };

export interface TestCaseEdit {
  /** A derived case's number ("FR-003.1"), or "added:<id>" for a case a tester added. */
  caseCode: string;
  fields: Partial<Record<EditableField | 'requirement', string>>;
  setAside: boolean;
  baseHash: string | null;
  updatedBy?: string;
  updatedAt?: string;
}

export type CaseState = 'derived' | 'edited' | 'needs_review' | 'set_aside' | 'added' | 'source_removed';
export interface ReviewedCase extends TestCase {
  state: CaseState;
  /** The derived case, when an edit replaced it (shown beside a "needs review"). */
  derived?: TestCase;
  edit?: TestCaseEdit;
}

export class TestEditError extends Error {}

/** The text a tester's edit is made against: changes when the requirement changes the case. */
export const caseHash = (c: TestCase) => hashText(JSON.stringify([c.title, c.steps, c.data, c.expected]));

const strip = (s: string, prefix: string) => s.replace(new RegExp(`^${prefix}:\\s*`), '').replace(/\.$/, '');
/** A case's fields as a tester edits them. */
export function fieldsOf(c: TestCase): Record<EditableField, string> {
  return { title: c.title, prepare: strip(c.steps[0], 'Prepare'), do: strip(c.steps[1], 'Do'), check: c.expected === null ? '' : strip(c.steps[2], 'Check'), data: c.data.join(', '), expected: c.expected === null ? '' : c.expected.replace(/\.$/, '') };
}

const sentence = (s: string) => { const t = s.trim().replace(/\.$/, ''); return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : ''; };
function withFields(c: TestCase, f: TestCaseEdit['fields']): TestCase {
  const cur = fieldsOf(c);
  const v = (k: EditableField) => (f[k] !== undefined ? f[k]!.trim() : cur[k]);
  const expected = v('expected');
  return {
    ...c, title: v('title') || c.title,
    steps: [sentence(`Prepare: ${v('prepare')}`), sentence(`Do: ${v('do')}`), expected || v('check') ? sentence(`Check: ${v('check') || expected}`) : 'Check: the expected result is not recorded yet.'],
    data: v('data') ? v('data').split(/\s*[,;]\s*/).filter(Boolean) : [],
    expected: expected ? sentence(expected) : null,
  };
}

/** The pack with the testers' edits applied, in the derived order, added cases after the cases of their requirement. */
export function applyTestEdits(pack: TestPack, edits: TestCaseEdit[]): ReviewedCase[] {
  const byCode = new Map(edits.map(e => [e.caseCode, e]));
  const out: ReviewedCase[] = [];
  for (const c of pack.cases) {
    const e = byCode.get(c.code);
    if (!e) { out.push({ ...c, state: 'derived' }); continue; }
    const changed = e.baseHash !== null && e.baseHash !== caseHash(c);
    out.push({ ...withFields(c, e.fields), source: `${c.source}; edited by a tester`, state: e.setAside ? 'set_aside' : changed ? 'needs_review' : 'edited', derived: c, edit: e });
  }
  const derivedCodes = new Set(pack.cases.map(c => c.code));
  for (const e of edits.filter(x => !derivedCodes.has(x.caseCode))) {
    const added = e.caseCode.startsWith('added:');
    const req = e.fields.requirement ?? '';
    const base: TestCase = { code: added ? `${req || 'Added'}.T${out.filter(x => x.state === 'added').length + 1}` : e.caseCode, kind: 'step', agent: false, title: e.fields.title ?? 'Added case', requirement: req, steps: ['', '', ''], data: [], expected: null, source: added ? 'Added by a tester' : 'Its requirement or criterion is no longer there' };
    const c: ReviewedCase = { ...withFields(base, e.fields), state: added ? (e.setAside ? 'set_aside' : 'added') : 'source_removed', edit: e };
    const at = out.map(x => x.requirement).lastIndexOf(req);
    if (added && at >= 0) out.splice(at + 1, 0, c); else out.push(c);
  }
  return out;
}

/** The pack as it is run: set-aside cases left out, testers' versions in. */
export function packAsRun(pack: TestPack, edits: TestCaseEdit[]): TestPack {
  const cases = applyTestEdits(pack, edits).filter(c => c.state !== 'set_aside' && c.state !== 'source_removed');
  return { cases, noExpected: pack.noExpected.filter(u => cases.some(c => c.requirement === u.code && c.expected === null)) };
}

/** A tester's edit of one case, checked: only real changes are kept, and an added case needs a title and a requirement. */
export function makeTestEdit(c: TestCase | null, fields: Partial<Record<EditableField | 'requirement', string>>, opts: { caseCode?: string; setAside?: boolean; requirements?: string[] } = {}): TestCaseEdit {
  const clean: TestCaseEdit['fields'] = {};
  for (const [k, v] of Object.entries(fields)) if (typeof v === 'string') clean[k as EditableField] = v.trim().slice(0, 4000);
  if (!c) {
    if (!clean.title) throw new TestEditError('Say what the case tests.');
    if (!clean.requirement || (opts.requirements && !opts.requirements.includes(clean.requirement))) throw new TestEditError('Choose the requirement it proves.');
    return { caseCode: opts.caseCode ?? '', fields: clean, setAside: Boolean(opts.setAside), baseHash: null };
  }
  const cur = fieldsOf(c);
  for (const k of EDITABLE_FIELDS) if (clean[k] !== undefined && clean[k] === cur[k]) delete clean[k];
  return { caseCode: c.code, fields: clean, setAside: Boolean(opts.setAside), baseHash: caseHash(c) };
}

export const CASE_STATE_LABEL: Record<CaseState, string> = { derived: '', edited: 'Edited', needs_review: 'Needs review', set_aside: 'Set aside', added: 'Added by a tester', source_removed: 'Requirement changed' };
