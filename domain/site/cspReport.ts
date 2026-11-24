// What a report of the content security policy carries when it leaves the browser (domain/site/csp.ts).
// Pure, so it is tested. The page hears of each breach from the browser's own event and sends one message
// through the existing error reports (journey/monitoring.ts), whose scrubber (domain/site/errors.ts) then
// takes the page's address down to its path. Here: only the rule, a keyword or a site's origin for what was
// blocked (never a path or a query), and our file and line. Browser extensions' breaches are not ours and
// are dropped. At most one report per rule and thing, and POLICY_REPORTS_PER_PAGE a page load, so a fault
// cannot use up the error plan.

import { scrubUrl } from './errors.ts';

/** The fields of the browser's `securitypolicyviolation` event this reads. */
export interface PolicyBreach {
  effectiveDirective: string;
  blockedURI: string;
  sourceFile: string;
  lineNumber: number;
  /** "report" while the policy only reports, "enforce" once it blocks. */
  disposition?: string;
}

export interface PolicyReport {
  message: string;
  tags: { csp_directive: string; csp_blocked: string };
}

export const POLICY_REPORTS_PER_PAGE = 5;

/** The keywords a browser uses in place of an address: an inline script or style, eval, and the like. */
const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'data', 'blob', 'self', 'trusted-types-policy', 'trusted-types-sink']);

/** Addresses of browser extensions (Safari hides them as webkit-masked-url). */
const EXTENSION = /^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:|^webkit-masked-url:/i;

/** What was blocked, as said in a report: a keyword, a site's origin, or a scheme alone. */
export function blockedWhat(blockedURI: string): string {
  const b = blockedURI.trim();
  if (!b) return 'unknown';
  const word = b.toLowerCase();
  if (KEYWORDS.has(word)) return word;
  try {
    const u = new URL(b);
    if (/^(https?|wss?):$/.test(u.protocol)) return u.origin;
    return u.protocol.replace(/:$/, '');
  } catch {
    return 'unknown';
  }
}

/** The file a breach came from, without anything after `?` or `#`; relative to the page when it is ours. */
function sourceOf(sourceFile: string, pageOrigin: string): string {
  const s = scrubUrl(sourceFile.trim());
  if (!s) return '';
  return pageOrigin && s.startsWith(`${pageOrigin}/`) ? s.slice(pageOrigin.length) : s;
}

/**
 * The report for one breach, or null: a browser extension's, one already reported on this page (`seen` holds
 * the rule and thing of each sent), or past the limit for the page.
 */
export function policyReport(b: PolicyBreach, seen: Set<string>, pageOrigin = ''): PolicyReport | null {
  if (EXTENSION.test(b.blockedURI.trim()) || EXTENSION.test(b.sourceFile.trim())) return null;
  const directive = b.effectiveDirective.trim().toLowerCase() || 'unknown';
  const what = blockedWhat(b.blockedURI);
  const key = `${directive} ${what}`;
  if (seen.has(key) || seen.size >= POLICY_REPORTS_PER_PAGE) return null;
  seen.add(key);
  const source = sourceOf(b.sourceFile, pageOrigin);
  const where = source ? ` (${source}${b.lineNumber > 0 ? `:${b.lineNumber}` : ''})` : '';
  const verb = b.disposition === 'enforce' ? 'blocked' : 'would block';
  return {
    message: `Content security policy${b.disposition === 'enforce' ? '' : ' (report only)'}: ${directive} ${verb} ${what}${where}`,
    tags: { csp_directive: directive, csp_blocked: what },
  };
}
