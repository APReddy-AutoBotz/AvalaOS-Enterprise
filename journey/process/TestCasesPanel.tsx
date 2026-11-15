// Testers' edits beside the test pack (part F; table test_case_edits): every case with its state, an
// editor for its fields, "Set aside" and "Bring back", "Add a test case" under a requirement, and for a
// case whose requirement changed since the edit: the new derived case, "Keep mine" or "Take update".
// Rules: domain/docs/testEdits.ts. The document beside it is built from the same edits.
import React from 'react';
import type { TestPack } from '../../domain/docs/tests.ts';
import { applyTestEdits, CASE_STATE_LABEL, caseHash, EDITABLE_FIELDS, FIELD_LABEL, fieldsOf, makeTestEdit, TestEditError, type EditableField, type ReviewedCase, type TestCaseEdit } from '../../domain/docs/testEdits.ts';
import { Button, cx, messageOf, Tag } from '../ui.tsx';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:border-[#002C4B] focus:outline-none focus:ring-2 focus:ring-[#002C4B]/20';
const newCode = () => `added:${crypto.randomUUID()}`;

function CaseEditor({ c, requirements, onSave, onCancel }: { c: ReviewedCase | null; requirements: string[]; onSave: (fields: Partial<Record<EditableField | 'requirement', string>>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = React.useState<Partial<Record<EditableField | 'requirement', string>>>(c ? fieldsOf(c) : { requirement: requirements[0] ?? '' });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const label = c ? c.code : 'the new case';
  return (
    <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-4 ring-1 ring-inset ring-slate-200" data-testid="case-editor">
      {!c && (
        <label className="grid gap-1 text-xs font-semibold text-slate-700">Requirement it proves
          <select aria-label="Requirement it proves" className={input} value={f.requirement ?? ''} onChange={e => setF({ ...f, requirement: e.target.value })}>
            {requirements.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </label>
      )}
      {EDITABLE_FIELDS.map(k => (
        <label key={k} className="grid gap-1 text-xs font-semibold text-slate-700">{FIELD_LABEL[k]}
          {k === 'title' || k === 'data'
            ? <input aria-label={`${FIELD_LABEL[k]} of ${label}`} className={input} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} />
            : <textarea aria-label={`${FIELD_LABEL[k]} of ${label}`} rows={2} className={input} value={f[k] ?? ''} onChange={e => setF({ ...f, [k]: e.target.value })} />}
        </label>
      ))}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await onSave(f); } catch (e) { setError(e instanceof TestEditError ? e.message : messageOf(e)); setBusy(false); } }}>Save</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

export function TestCasesPanel({ pack, edits, canEdit, onSave, onRemove }: { pack: TestPack; edits: TestCaseEdit[]; canEdit: boolean; onSave: (e: TestCaseEdit) => Promise<void>; onRemove: (caseCode: string) => Promise<void> }) {
  const cases = applyTestEdits(pack, edits);
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const requirements = [...new Set(pack.cases.map(c => c.requirement))];
  const counts = { edited: cases.filter(c => c.state === 'edited').length, review: cases.filter(c => c.state === 'needs_review').length, aside: cases.filter(c => c.state === 'set_aside').length, added: cases.filter(c => c.state === 'added').length };
  const act = async (f: () => Promise<void>) => { setError(null); try { await f(); } catch (e) { setError(messageOf(e)); } };
  const original = (c: ReviewedCase) => c.derived ?? pack.cases.find(x => x.code === c.code) ?? null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5" aria-label="Test cases" data-testid="test-cases-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-base font-semibold text-slate-900">Test cases</h3>
          <p className="text-xs text-slate-600">{cases.length} cases{counts.edited ? ` · ${counts.edited} edited` : ''}{counts.added ? ` · ${counts.added} added` : ''}{counts.aside ? ` · ${counts.aside} set aside` : ''}{counts.review ? ` · ${counts.review} to review` : ''}</p>
        </div>
        <div className="flex gap-2">
          {canEdit && <Button variant="secondary" onClick={() => { setOpen(true); setEditing('new'); }}>Add a test case</Button>}
          <Button variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide the list' : canEdit ? 'Edit cases' : 'Show the list'}</Button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
      {open && editing === 'new' && canEdit && (
        <CaseEditor c={null} requirements={requirements} onCancel={() => setEditing(null)} onSave={async f => { await onSave(makeTestEdit(null, f, { caseCode: newCode(), requirements })); setEditing(null); }} />
      )}
      {open && (
        <ul className="mt-3 divide-y divide-slate-100" data-testid="case-list">
          {cases.map(c => {
            const key = c.edit?.caseCode ?? c.code;
            const base = original(c);
            return (
              <li key={key} className={cx('py-2.5', c.state === 'set_aside' && 'opacity-70')} data-testid="case-row" data-state={c.state}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="min-w-0 text-sm"><span className="mr-2 font-semibold tabular-nums text-slate-600">{c.code}</span><span className="font-medium text-slate-900">{c.title}</span>
                    {CASE_STATE_LABEL[c.state] && <Tag tone={c.state === 'needs_review' || c.state === 'source_removed' ? 'warn' : 'neutral'} className="ml-2">{CASE_STATE_LABEL[c.state]}</Tag>}
                    {c.expected === null && c.state !== 'set_aside' && <span className="ml-2 text-xs text-amber-800">No expected result yet</span>}
                  </p>
                  {canEdit && editing !== key && (
                    <span className="flex gap-3 text-xs font-medium">
                      {c.state !== 'set_aside' && c.state !== 'source_removed' && <button type="button" className="text-[#002C4B] hover:underline" onClick={() => setEditing(key)} aria-label={`Edit case ${c.code}`}>Edit</button>}
                      {c.state === 'set_aside'
                        ? <button type="button" className="text-[#002C4B] hover:underline" onClick={() => act(() => (c.edit && Object.keys(c.edit.fields).length ? onSave({ ...c.edit, setAside: false }) : onRemove(key)))}>Bring back</button>
                        : c.state !== 'source_removed' && <button type="button" className="text-slate-600 hover:underline" onClick={() => act(() => onSave(c.edit ? { ...c.edit, setAside: true } : makeTestEdit(base, {}, { setAside: true })))} aria-label={`Set aside case ${c.code}`}>Set aside</button>}
                      {(c.state === 'edited' || c.state === 'added' || c.state === 'source_removed') && <button type="button" className="text-slate-600 hover:underline" onClick={() => act(() => onRemove(key))}>{c.state === 'added' || c.state === 'source_removed' ? 'Remove' : 'Use the derived case'}</button>}
                    </span>
                  )}
                </div>
                {c.state === 'needs_review' && base && (
                  <div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm ring-1 ring-inset ring-amber-200" data-testid="case-review">
                    <p className="text-amber-950"><span className="font-semibold">Its requirement changed since you edited it.</span> The derived case now reads: {base.steps.join(' ')}</p>
                    {canEdit && <div className="mt-2 flex gap-2">
                      <Button variant="secondary" onClick={() => act(() => onSave({ ...c.edit!, baseHash: caseHash(base) }))}>Keep mine</Button>
                      <Button variant="secondary" onClick={() => act(() => onRemove(key))}>Take update</Button>
                    </div>}
                  </div>
                )}
                {editing === key && canEdit && (
                  <CaseEditor c={c} requirements={requirements} onCancel={() => setEditing(null)} onSave={async f => {
                    const e = c.state === 'added' ? { ...makeTestEdit(null, { ...c.edit!.fields, ...f, requirement: c.requirement }, { caseCode: key, requirements }) } : makeTestEdit(base!, f);
                    if (c.state !== 'added' && !Object.keys(e.fields).length) await onRemove(key); else await onSave(e);
                    setEditing(null);
                  }} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
