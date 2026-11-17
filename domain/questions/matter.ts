// One gap about the objective, and one about the owner (review of 17 November 2026: "Process objective is
// unknown" was listed beside "The objective of the process is not stated"). A document raises the missing
// objective and owner itself, the model's gaps raise them again, and a question read from the sources may ask
// for them in its own words. They are one matter: listed once, counted once, closed together. Only a question
// that asks for the objective alone, or the owner alone, in a known form is taken as the same; anything else
// (two things at once, a question about the objective of one step, a wording not listed here) stays apart.
import type { ElementTarget } from '../processModel/types.ts';

export type Matter = 'objective' | 'owner';

const END = String.raw`(?:\s+(?:is\s+)?(?:unknown|not\s+(?:stated|known|given|defined|recorded|clear|identified|named)|missing|unclear|undefined|to\s+be\s+confirmed))?\s*[.?]?`;
const OF_PROCESS = String.raw`(?:\s+(?:of|for)\s+(?:the|this)\s+process)?`;
const LEAD = String.raw`(?:(?:what\s+is|what's|confirm|state|please\s+confirm)\s+)?(?:the\s+)?(?:process(?:'s|’s)?\s+)?(?:business\s+)?`;
const ONLY: Record<Matter, RegExp[]> = {
  objective: [new RegExp(String.raw`^${LEAD}(?:objective|purpose|goal|aim)${OF_PROCESS}${END}$`, 'i')],
  owner: [
    new RegExp(String.raw`^(?:(?:who\s+is|who's|confirm|name)\s+)?(?:the\s+)?(?:process(?:'s|’s)?\s+)?(?:business\s+)?owner${OF_PROCESS}${END}$`, 'i'),
    /^who\s+owns\s+(?:the|this)\s+process\s*\??$/i,
  ],
};

/** The matter a question in free words asks for alone, or null when it asks for something else or more. */
export function asksOnlyFor(text: string): Matter | null {
  const t = text.trim().replace(/\s+/g, ' ');
  for (const m of ['objective', 'owner'] as const) if (ONLY[m].some(re => re.test(t))) return m;
  return null;
}

/** The matter an open item or question is about: the structured field, or a free question asking for it alone. */
export function matterOf(x: { target?: ElementTarget; text: string }): Matter | null {
  if (x.target?.kind !== 'meta') return null;
  if (x.target.field === 'objective' || x.target.field === 'owner') return x.target.field;
  return x.target.field ? null : asksOnlyFor(x.text);
}

/** Whether two items are the same matter about the objective or the owner. */
export const sameMatter = (a: { target?: ElementTarget; text: string }, b: { target?: ElementTarget; text: string }) => {
  const m = matterOf(a);
  return m !== null && m === matterOf(b);
};
