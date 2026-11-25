// The words of the review of a reading, on the Sources stage and in Discovery (package B, pull request 5a; owner,
// 25 November 2026): no "extraction", no "model", and the product's own date with the 24-hour clock, never the
// browser's own form ("Nov 25, 2026, 9:10 PM"). Discovery's update says it was read with the person's answers.

/** "25 November 2026 at 21:10", in the viewer's time zone unless one is given (tests). */
export function readingWhen(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const tz = timeZone ? { timeZone } : {};
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...tz });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...tz });
  return `${date} at ${time}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const REVIEW_WORDS = {
  /** Discovery's heading over the review of an update. */
  heading: 'What the new reading would change',
  comparing: 'Comparing with the draft…',
  matches: 'The new reading matches the draft as it stands.',
  /** A first reading: what it found. */
  first: (at: string, steps: number, roles: number, apps: number) =>
    `Read on ${at}: ${plural(steps, 'step', 'steps')}, ${plural(roles, 'role', 'roles')} and ${plural(apps, 'application', 'applications')}.`,
  /** A reading again: how far it differs. */
  again: (at: string, places: number, withAnswers = false) =>
    `Read again${withAnswers ? ' with your answers' : ''} on ${at}. It differs from the draft in ${plural(places, 'place', 'places')}: choose what to take.`,
};
