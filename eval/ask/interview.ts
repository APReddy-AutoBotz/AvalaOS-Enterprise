// The interview's measure (docs/product-plan.md, stage 2: "twenty answer interpretations are in the
// measure and none records a value the person did not state"). Each case is a person's answer to one of
// the sample's open questions; the answer is read as the panel reads it (`interviewSegments`, the
// `answerFromNotes` task, `readInterview`) and judged here by rule.
import fs from 'node:fs';
import type { AccessStatus } from '../../domain/processModel/types.ts';
import type { Reading } from '../../domain/questions/interview.ts';
import { says } from './scorer.ts';

export interface InterviewCase {
  id: string; key: string; answer: string;
  expect: { none?: true; pick?: string; statuses?: Record<string, AccessStatus>; say?: string[][]; maybe?: boolean };
}
export const loadInterviewCases = (): InterviewCase[] =>
  (JSON.parse(fs.readFileSync(new URL('./interview.json', import.meta.url), 'utf8')) as { cases: InterviewCase[] }).cases;

const NUMBER_WORDS: Record<string, string> = { one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10', twelve: '12', fifteen: '15', twenty: '20', thirty: '30', forty: '40', fifty: '50', hundred: '100' };
/** The figures in a text, number words read as digits ("two" is 2). */
const figures = (s: string) => new Set([...(s.match(/\d+(?:\.\d+)?/g) ?? []), ...(s.toLowerCase().match(/[a-z]+/g) ?? []).map(w => NUMBER_WORDS[w]).filter(Boolean)]);

export interface InterviewOutcome { id: string; pass: boolean; reasons: string[]; kind: Reading['kind'] | 'error'; recorded: string | null; notStated: boolean }

/** Whether the reading did what the case asks; `notStated` marks a value offered that the person did not give. */
export function judgeInterview(c: InterviewCase, reading: Reading): InterviewOutcome {
  const reasons: string[] = [];
  const p = reading.kind === 'record' || reading.kind === 'confirm' ? reading.proposal : null;
  const recorded = p?.display ?? null;
  let notStated = false;
  // Any figure offered must be one the person gave.
  if (p) {
    const given = figures(c.answer);
    const extra = [...figures(p.display)].filter(n => !given.has(n));
    if (extra.length) { reasons.push(`offers a figure the person did not give: ${extra.join(', ')}`); notStated = true; }
    // The person's words it shows must be theirs (an access answer joins several quotes with " … ").
    const norm = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
    if (p.quote.split(' … ').some(part => !norm(c.answer).includes(norm(part)))) reasons.push(`quotes words that are not in the answer: "${p.quote}"`);
  }
  const e = c.expect;
  if (e.none) {
    if (p) { reasons.push(`offered "${recorded}" although the answer gives no value`); notStated = true; }
    else if (reading.kind !== 'followUp') reasons.push(`did not ask the one follow-up (${reading.kind})`);
  } else if (!p) {
    if (!e.maybe) reasons.push(`recorded nothing (${reading.kind}) although the answer gives a value`);
  } else {
    if (e.pick && p.display !== e.pick) { reasons.push(`offered "${p.display}", not "${e.pick}"`); notStated = true; }
    if (e.statuses) for (const [i, want] of Object.entries(e.statuses)) {
      const got = p.answer.statuses?.[Number(i)];
      if (got !== want) { reasons.push(`interface ${i}: "${got ?? 'unchanged'}", not "${want}"`); notStated = true; }
    }
    for (const group of e.say ?? []) if (!group.some(w => says(p.display, w))) reasons.push(`does not say ${group.map(w => `"${w}"`).join(' or ')}: "${p.display}"`);
  }
  return { id: c.id, pass: reasons.length === 0, reasons, kind: reading.kind, recorded, notStated };
}
