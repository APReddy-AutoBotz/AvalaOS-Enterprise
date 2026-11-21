// Counting visits to the public pages (package 12 of docs/next-plan.md, section 3e). Pure: the browser
// side is journey/home/visits.ts.
//
// Our own few lines send each count to Umami Cloud's documented collection address; no script of
// Umami's is loaded. Counts only, nothing about a person: no cookies, nothing kept in the browser, no
// visitor identifier, no data beyond the fields and events below. Only the real site counts
// (avalaos.com and www.avalaos.com), only signed out, only the homepage, the three trust pages and the
// demo's opening (or a teardown's, and its documents once), and never with "Do Not Track" or "Global Privacy Control", in a browser driven by test
// tools, or in a browser its owner has switched off (OPT_OUT).

import type { PublicPage } from './pages.ts';
import { isTeardownSlug, teardownBase, teardownSlug } from './teardownPath.ts';

/** Umami Cloud's collection address (docs.umami.is, "Sending stats") and our website's id (not a secret). */
export const UMAMI = { endpoint: 'https://gateway.umami.is/api/send', website: '14ef4005-3173-46da-a837-efcc39cf1a48' } as const;

/** The only addresses that count: never a preview, a local build or the browser tests. */
export const COUNTED_HOSTS = ['avalaos.com', 'www.avalaos.com'] as const;

/**
 * The pages that count. The demo is counted once, as "Demo opened", or at a teardown's address as
 * "Teardown opened" with its slug; inside it, only a teardown's documents opening, once (marketing
 * package, owner's yes, 21 November 2026). Nothing else inside the demo.
 */
export const COUNTED_PAGES: readonly PublicPage[] = ['home', 'privacy', 'terms', 'security', 'demo'];

/** The events, and no others: each with the one detail it may carry, if any. */
export const EVENTS = {
  'Demo opened': null,
  'Walkthrough opened': null,
  'Walkthrough sent': null,
  'Walkthrough not sent': null,
  'Tour stage picked': 'stage',
  'Read more opened': 'which',
  'Teardown opened': 'which',
  'Teardown documents opened': 'which',
} as const;
export type VisitEvent = keyof typeof EVENTS;

/**
 * A person's own browser left out of the counts: open any public page with ?count=off once (and
 * ?count=on to count it again). One flag in that browser's storage; nothing about any visitor.
 */
export const OPT_OUT = { key: 'avala.count', value: 'off', param: 'count' } as const;
export function optOutChange(search: string): 'off' | 'on' | null {
  const v = new URLSearchParams(search).get(OPT_OUT.param);
  return v === 'off' ? 'off' : v === 'on' ? 'on' : null;
}

export interface CountEnv {
  hostname: string;
  page: PublicPage | null;
  signedIn: boolean;
  /** navigator.doNotTrack === '1', or navigator.globalPrivacyControl. */
  privacySignal: boolean;
  /** navigator.webdriver: a browser driven by test tools. */
  automated: boolean;
  /** This browser's owner switched counting off (OPT_OUT). */
  optedOut: boolean;
}

/** Whether this page view may be counted at all. */
export function countable(e: CountEnv): boolean {
  return (COUNTED_HOSTS as readonly string[]).includes(e.hostname) && e.page !== null && COUNTED_PAGES.includes(e.page)
    && !e.signedIn && !e.privacySignal && !e.automated && !e.optedOut;
}

const CAMPAIGN = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

/** The page's address as counted: the path, and of what follows "?" only the three campaign words; never what follows "#". */
export function countedUrl(pathname: string, search: string): string {
  const q = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const k of CAMPAIGN) { const v = q.get(k); if (v) kept.set(k, v.slice(0, 100)); }
  const s = kept.toString();
  return `${pathname || '/'}${s ? `?${s}` : ''}`;
}

/** The site a visitor came from, by its address alone (never its path or query); empty for our own site or none. */
export function referrerSite(referrer: string, hostname: string): string {
  try {
    const u = new URL(referrer);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    if (u.hostname === hostname || (COUNTED_HOSTS as readonly string[]).includes(u.hostname)) return '';
    return `${u.protocol}//${u.hostname}`;
  } catch { return ''; }
}

export interface PageFacts { hostname: string; pathname: string; search: string; title: string; referrer: string; language: string; screen: string }

/** The fields of a count: exactly these, and no visitor identifier. */
function base(f: PageFacts, url = countedUrl(f.pathname, f.search)) {
  return {
    website: UMAMI.website, hostname: f.hostname, url, title: f.title.slice(0, 200),
    referrer: referrerSite(f.referrer, f.hostname), language: f.language.slice(0, 35), screen: /^\d{2,5}x\d{2,5}$/.test(f.screen) ? f.screen : '',
  };
}

/** A page view (an event with no name, as Umami counts a page view). */
export function pageViewBody(f: PageFacts): { type: 'event'; payload: ReturnType<typeof base> } {
  return { type: 'event', payload: base(f) };
}

/** One of the events, with its one allowed detail; null for anything else. */
export function eventBody(f: PageFacts, name: string, detail?: string): { type: 'event'; payload: ReturnType<typeof base> & { name: VisitEvent; data?: Record<string, string> } } | null {
  if (!Object.hasOwn(EVENTS, name)) return null;
  const key = EVENTS[name as VisitEvent];
  const value = typeof detail === 'string' ? detail.replace(/[^\w .-]/g, '').slice(0, 40) : '';
  const data = key && value ? { [key]: value } : undefined;
  return { type: 'event', payload: { ...base(f), name: name as VisitEvent, ...(data ? { data } : {}) } };
}

/**
 * How the demo's opening is counted, from the address it was opened at (taken at load, before the journey
 * moves it to the first stage): the sample as "Demo opened" at /demo, a teardown as "Teardown opened" at its
 * own address, its slug the only detail. The campaign words are kept by `countedUrl`.
 */
export function demoOpening(pathname: string): { name: 'Demo opened' | 'Teardown opened'; path: string; slug?: string } {
  const slug = teardownSlug(pathname);
  return slug ? { name: 'Teardown opened', path: teardownBase(slug), slug } : { name: 'Demo opened', path: '/demo' };
}

/** The one event inside the demo: a teardown's documents opened, with its slug; null for anything else. */
export function teardownDocumentsEvent(f: PageFacts, slug: string) {
  return isTeardownSlug(slug) ? eventBody({ ...f, pathname: teardownBase(slug) }, 'Teardown documents opened', slug) : null;
}
