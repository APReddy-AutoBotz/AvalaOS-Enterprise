// The dates a release sets in its own commit (docs/next-plan.md, "Before the release"): each trust page's
// "last updated" and the coverage notice's date. Until they are set the pages show "[release date]", so a
// release must not go out with one empty. The check "Release dates set" (.github/workflows/release-dates.yml,
// scripts/release-dates.ts) runs this on every pull request into main (owner, 21 November 2026). Pure.
import { UPDATED } from './trust.ts';
import { COVERAGE_RULE } from '../assess/coverage.ts';

/** Each date the release's own commit sets: what it is in plain words, where it lives, and its value now. */
export function releaseDates(): { what: string; where: string; value: string | null }[] {
  return [
    { what: "the privacy page's \"Last updated\" date", where: 'UPDATED.privacy in domain/site/trust.ts', value: UPDATED.privacy },
    { what: "the terms page's \"Last updated\" date", where: 'UPDATED.terms in domain/site/trust.ts', value: UPDATED.terms },
    { what: "the security page's \"Last updated\" date", where: 'UPDATED.security in domain/site/trust.ts', value: UPDATED.security },
    { what: "the date in the API coverage notice", where: 'COVERAGE_RULE.since in domain/assess/coverage.ts', value: COVERAGE_RULE.since },
  ];
}

/** The report, in plain words, and whether every date is set. */
export function releaseDatesReport(dates = releaseDates()): { ok: boolean; lines: string[] } {
  const missing = dates.filter(d => !d.value);
  if (!missing.length) return { ok: true, lines: ['Release dates set: every date the release sets is filled in.', ...dates.map(d => `- ${d.what}: ${d.value}`)] };
  return {
    ok: false,
    lines: [
      `Release dates not set: ${missing.length} of ${dates.length} still ${missing.length === 1 ? 'shows' : 'show'} "[release date]".`,
      ...missing.map(d => `- ${d.what} is empty. Set ${d.where} to the release date.`),
      'Set them in the release\'s own commit (docs/next-plan.md, "Before the release").',
    ],
  };
}
