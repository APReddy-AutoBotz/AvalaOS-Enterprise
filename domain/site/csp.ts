// The site's content security policy (docs/next-plan.md, section 3e; plan `claude/csp-and-tiptap-plan-24-nov.md`
// in the owner's project, approved 24 November 2026). Report-only first: the browser blocks nothing and tells
// the page what it would have blocked (journey/monitoring.ts sends that through the existing error reports).
// Enforcement is its own pull request and its own release, on the owner's yes.
//
// The policy is built when the site is built, from the build's own settings: the Supabase project's address
// (VITE_SUPABASE_URL) and Sentry's (the host of VITE_SENTRY_DSN, never its key). So no project address is
// written into the code (the secret scanner forbids it), and the policy always names the project the build
// talks to. vite.config.ts writes it into the built site as Netlify's `_headers` file, for the live site and
// its previews alike, and the browser tests' server sends the same text, so every browser test runs under it.
// There is no report-uri or report-to: a browser's own report holds the page's whole address, query included,
// where the unsubscribe page carries its token.

import { UMAMI } from './visits.ts';

/** The header's name while it only reports. */
export const CSP_HEADER = 'Content-Security-Policy-Report-Only';

/** The build's settings the policy reads. */
export interface CspSites { supabaseUrl?: string; sentryDsn?: string }

/** A secure site's origin (scheme and host), never a path, a query or a key in the address; null otherwise. */
export function secureOrigin(address: string | undefined): string | null {
  if (!address?.trim()) return null;
  try {
    const u = new URL(address.trim());
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

export interface CspDirective { name: string; values: string[]; why: string }

/** Each directive with what it allows and why (found from the code and the built site, 24 November 2026). */
export function cspDirectives(sites: CspSites = {}): CspDirective[] {
  const connect = ["'self'", secureOrigin(sites.supabaseUrl), secureOrigin(sites.sentryDsn), secureOrigin(UMAMI.endpoint)].filter((v): v is string => Boolean(v));
  return [
    { name: 'default-src', values: ["'self'"], why: 'Anything not named below comes only from the site itself (frames, media, manifests).' },
    { name: 'script-src', values: ["'self'"], why: 'Scripts only from the site: index.html has no inline script, and no built file uses eval.' },
    { name: 'style-src', values: ["'self'", "'unsafe-inline'"], why: 'The homepage, the print styles of Documents and the assessment report, and Tiptap add <style> elements.' },
    { name: 'img-src', values: ["'self'", 'data:', 'blob:'], why: 'A document logo is kept as data; the flow editor and the PDF reader carry data pictures; the maps are drawn to PNG for Word through a blob.' },
    { name: 'font-src', values: ["'self'", 'data:'], why: 'Inter and Outfit are files of the site; the flow editor (bpmn-js) carries its icon font as data.' },
    { name: 'connect-src', values: [...new Set(connect)], why: 'The site, the Supabase project (data, sign-in, server functions), Sentry (errors), Umami (visit counts).' },
    { name: 'worker-src', values: ["'self'"], why: "The PDF reader's worker is a file of the site." },
    { name: 'object-src', values: ["'none'"], why: 'No plugins.' },
    { name: 'base-uri', values: ["'self'"], why: 'No page may change where its relative addresses point.' },
    { name: 'form-action', values: ["'self'"], why: 'No form is sent anywhere but the site.' },
    { name: 'frame-ancestors', values: ["'none'"], why: 'No other site may show these pages in a frame (as X-Frame-Options says).' },
  ];
}

/** The policy as one header value. */
export const cspPolicy = (sites: CspSites = {}) => cspDirectives(sites).map(d => `${d.name} ${d.values.join(' ')}`).join('; ');

/** Netlify's `_headers` file for the built site: the policy on every page. */
export const cspHeadersFile = (policy: string) =>
  `# The content security policy, report-only, built from domain/site/csp.ts by vite.config.ts.\n/*\n  ${CSP_HEADER}: ${policy}\n`;
