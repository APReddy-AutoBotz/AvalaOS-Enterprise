// A teardown's addresses (domain/site/teardowns.ts says what a teardown is). Kept apart because index.tsx
// loads it on every page to name a teardown's canonical address: nothing heavy may come with it.
import { SITE_ORIGIN } from './pages.ts';

/** Teardowns live under the demo: /demo/teardowns/<slug>/…, the journey running under that prefix. */
export const TEARDOWN_BASE = '/demo/teardowns';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isTeardownSlug = (s: string): boolean => s.length <= 60 && SLUG.test(s);

/** The teardown a demo address belongs to, or null for the sample. */
export function teardownSlug(pathname: string): string | null {
  const m = /^\/demo\/teardowns\/([^/]+)(?:\/|$)/.exec(pathname);
  return m && isTeardownSlug(m[1]) ? m[1] : null;
}
export const teardownBase = (slug: string) => `${TEARDOWN_BASE}/${slug}`;
export const teardownDataUrl = (slug: string) => `/demo-data/teardowns/${slug}.json`;
/** The list of teardowns, for the demo's banner links: [{ slug, short }]. */
export const TEARDOWN_INDEX_URL = '/demo-data/teardowns/index.json';
/** A teardown's pages name its own address as canonical (the sitemap lists the same); null elsewhere. */
export function teardownCanonical(pathname: string): string | null {
  const slug = teardownSlug(pathname);
  return slug ? `${SITE_ORIGIN}${teardownBase(slug)}` : null;
}

