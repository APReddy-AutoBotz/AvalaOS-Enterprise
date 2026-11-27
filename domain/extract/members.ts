// Which candidates a group's members name (27 November 2026). The listings print each candidate as its id, then
// its place in brackets: "S1 [own-1 #1] …". The merges are asked for the id, but a reading of a description
// alone answered every member with the place ("own-1 #1"), and assembly, which looked members up by id only,
// dropped every role, application, step and decision as "no candidates" (claude/first-description-zero-steps-
// and-public-repo-27-nov.md in the owner's project). A member is now read as one of three things, and only
// when it can mean one candidate:
//   1. an id ("S1"), as before;
//   2. an id followed by its own place ("S1 [own-1 #1]"); an id and a place that disagree are not read;
//   3. a place alone ("own-1 #1", "[own-1 #1]", "own-1 §6.12"), when exactly one candidate of the kinds the group
//      allows is at that place. Places count per kind and per source, so "own-1 #1" names one role, one step and
//      one decision: a role group finds its role, while an event (a step, a decision, a rule or an exception)
//      naming "own-1 #1" stays unread when the process has both a first step and a first decision.
// Anything else stays unread. Nothing is guessed from names.
import { positionOf, type Candidate, type CandidateKind, type CandidateSet } from './candidates.ts';

/** How the members of one reading were read: by their place (2 or 3 above), or not at all. */
export interface MemberCounts { byLabel: number; unresolved: number }

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
const unbracket = (s: string) => tidy(s.replace(/^\[\s*/, '').replace(/\s*\]$/, ''));
const ID_AND_PLACE = /^(\S+)\s*\[([^\]]+)\]$/;

export interface MemberReader {
  /** The candidate a member names among the kinds allowed, or null. Counts what it read by place. */
  read(member: string, kinds: readonly CandidateKind[]): Candidate | null;
  /** The candidates a group's members name, each once, in the members' order. */
  readAll(members: readonly string[], kinds: readonly CandidateKind[]): Candidate[];
  readonly counts: MemberCounts;
}

export function memberReader(set: CandidateSet): MemberReader {
  const byId = new Map(set.items.map(c => [c.id, c]));
  const byPlace = new Map<string, Candidate[]>();
  for (const c of set.items) byPlace.set(positionOf(c), [...(byPlace.get(positionOf(c)) ?? []), c]);
  const counts: MemberCounts = { byLabel: 0, unresolved: 0 };

  const resolve = (raw: string, kinds: readonly CandidateKind[]): { c: Candidate; byLabel: boolean } | null => {
    const m = tidy(String(raw ?? ''));
    if (!m) return null;
    const exact = byId.get(m);
    if (exact) return kinds.includes(exact.kind) ? { c: exact, byLabel: false } : null;
    const both = ID_AND_PLACE.exec(m);
    if (both) {
      const c = byId.get(both[1]!);
      return c && kinds.includes(c.kind) && positionOf(c) === tidy(both[2]!) ? { c, byLabel: true } : null;
    }
    const here = (byPlace.get(unbracket(m)) ?? []).filter(c => kinds.includes(c.kind));
    return here.length === 1 ? { c: here[0]!, byLabel: true } : null;
  };

  const read = (member: string, kinds: readonly CandidateKind[]) => {
    const r = resolve(member, kinds);
    if (!r) { if (tidy(String(member ?? ''))) counts.unresolved++; return null; }
    if (r.byLabel) counts.byLabel++;
    return r.c;
  };
  const readAll = (members: readonly string[], kinds: readonly CandidateKind[]) => {
    const out: Candidate[] = [];
    for (const m of [...new Set(members ?? [])]) {
      const c = read(m, kinds);
      if (c && !out.includes(c)) out.push(c);
    }
    return out;
  };
  return { read, readAll, counts };
}
