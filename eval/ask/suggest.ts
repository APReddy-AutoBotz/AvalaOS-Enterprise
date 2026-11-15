// The suggestions' measure (docs/product-plan.md, stage 3: "a set of 'should suggest' and 'should not
// suggest' cases, and nothing is suggested that the record does not support"). Each case gives made-up
// source passages; they are read with the sample's open questions as the Suggestions tab reads them
// (`sourceSegments`, the `answerFromNotes` task, `answerSuggestions`) and judged here by rule.
import fs from 'node:fs';
import type { AccessStatus } from '../../domain/processModel/types.ts';
import type { Passage } from '../../domain/assistant/ask.ts';
import type { Suggestion } from '../../domain/assistant/suggest.ts';
import { says } from './scorer.ts';

export interface SuggestCase {
  id: string; passages: string[];
  expect: { key: string; say?: string[][]; pick?: string; statuses?: Record<string, AccessStatus> }[];
}
export const loadSuggestCases = (): SuggestCase[] =>
  (JSON.parse(fs.readFileSync(new URL('./suggest.json', import.meta.url), 'utf8')) as { cases: SuggestCase[] }).cases;

/** A case's passages as a source of its own, "Case notes", one section each. */
export const casePassages = (c: SuggestCase): Passage[] =>
  c.passages.map((text, i) => ({ sourceKey: 'case', sourceTitle: 'Case notes', locator: { section: String(i + 1) } as never, text }));

export interface SuggestOutcome { id: string; pass: boolean; reasons: string[]; suggested: string[]; unsupported: boolean }

/** Every expected answer suggested as it should be, and nothing else: anything else is unsupported. */
export function judgeSuggestions(c: SuggestCase, got: Suggestion[]): SuggestOutcome {
  const reasons: string[] = [];
  let unsupported = false;
  const answers = got.filter(s => s.target.kind === 'answer');
  for (const e of c.expect) {
    const s = answers.find(x => x.target.kind === 'answer' && x.target.itemKey === e.key);
    if (!s || s.target.kind !== 'answer') { reasons.push(`did not suggest the answer to ${e.key}`); continue; }
    const p = s.target.proposal;
    if (e.pick && p.display !== e.pick) { reasons.push(`suggested "${p.display}", not "${e.pick}"`); unsupported = true; }
    for (const [i, want] of Object.entries(e.statuses ?? {})) if (p.answer.statuses?.[Number(i)] !== want) { reasons.push(`interface ${i}: "${p.answer.statuses?.[Number(i)] ?? 'unchanged'}", not "${want}"`); unsupported = true; }
    for (const g of e.say ?? []) if (!g.some(w => says(p.display, w))) reasons.push(`does not say ${g.map(w => `"${w}"`).join(' or ')}: "${p.display}"`);
  }
  for (const s of answers) {
    if (s.target.kind !== 'answer' || c.expect.some(e => e.key === (s.target as { itemKey: string }).itemKey)) continue;
    reasons.push(`suggested what the passages do not state: ${s.title} → ${s.willDo}`); unsupported = true;
  }
  return { id: c.id, pass: reasons.length === 0, reasons, suggested: answers.map(s => `${s.title} → ${s.willDo}`), unsupported };
}
