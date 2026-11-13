// The public pages: the homepage, the three trust pages and the demo. They load without the database
// client (the demo runs the product on the sample case in the browser), so they open for anyone, signed in
// or not. Pure: index.tsx and the tests use it.

export const TRUST_PAGES = [
  { id: 'privacy', path: '/privacy', label: 'Privacy' },
  { id: 'terms', path: '/terms', label: 'Terms' },
  { id: 'security', path: '/security', label: 'Security' },
] as const;

export type TrustPageId = (typeof TRUST_PAGES)[number]['id'];
export type PublicPage = 'home' | TrustPageId | 'demo';

/** The demo runs the journey under this prefix: /demo/work, /demo/process/:id/:stage, … */
export const DEMO_BASE = '/demo';

/** The public page a path belongs to, or null when it belongs to the application. */
export function publicPage(pathname: string): PublicPage | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '') return 'home';
  if (path === DEMO_BASE || path.startsWith(`${DEMO_BASE}/`)) return 'demo';
  return TRUST_PAGES.find(p => p.path === path.toLowerCase())?.id ?? null;
}

/** The journey path inside the demo (/demo/board -> /board); /demo itself opens My work. */
export function demoPath(pathname: string): string {
  const rest = pathname.replace(/\/+$/, '').slice(DEMO_BASE.length);
  return rest === '' ? '/work' : rest;
}
