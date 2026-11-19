// The public pages: the homepage, the three trust pages, the demo and the page that stops the weekday email. They load without the database
// client (the demo runs the product on the sample case in the browser), so they open for anyone, signed in
// or not. Pure: index.tsx and the tests use it.

export const TRUST_PAGES = [
  { id: 'privacy', path: '/privacy', label: 'Privacy' },
  { id: 'terms', path: '/terms', label: 'Terms' },
  { id: 'security', path: '/security', label: 'Security' },
] as const;

export type TrustPageId = (typeof TRUST_PAGES)[number]['id'];
export type PublicPage = 'home' | TrustPageId | 'demo' | 'unsubscribe';

/** The page an email's "Stop these emails" link opens (journey/home/UnsubscribePage.tsx). */
export const UNSUBSCRIBE_PATH = '/unsubscribe';

/** The demo runs the journey under this prefix: /demo/work, /demo/process/:id/:stage, … */
export const DEMO_BASE = '/demo';

/** The public page a path belongs to, or null when it belongs to the application. */
export function publicPage(pathname: string): PublicPage | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '') return 'home';
  if (path === DEMO_BASE || path.startsWith(`${DEMO_BASE}/`)) return 'demo';
  if (path.toLowerCase() === UNSUBSCRIBE_PATH) return 'unsubscribe';
  return TRUST_PAGES.find(p => p.path === path.toLowerCase())?.id ?? null;
}

/** The site's one address: canonical links and the sitemap name it, never www or a preview. */
export const SITE_ORIGIN = 'https://avalaos.com';

/**
 * The canonical address of a public page: the homepage, the trust pages and the demo, whichever of the
 * demo's own pages is open (the same addresses as public/sitemap.xml; a test keeps them equal). The page
 * that stops the weekday email has none: it is reached only from an email's link and is not listed.
 */
export function canonicalUrl(page: PublicPage): string | null {
  if (page === 'unsubscribe') return null;
  if (page === 'home') return `${SITE_ORIGIN}/`;
  if (page === 'demo') return `${SITE_ORIGIN}${DEMO_BASE}`;
  return `${SITE_ORIGIN}${TRUST_PAGES.find(p => p.id === page)!.path}`;
}

/** The journey path inside the demo (/demo/board -> /board); /demo itself opens My work. */
export function demoPath(pathname: string): string {
  const rest = pathname.replace(/\/+$/, '').slice(DEMO_BASE.length);
  return rest === '' ? '/work' : rest;
}
