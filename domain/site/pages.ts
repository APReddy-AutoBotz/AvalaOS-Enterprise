// The public pages: the homepage and the three trust pages. They load without the application or the
// database client, so they open fast for anyone, signed in or not. Pure: index.tsx and the tests use it.

export const TRUST_PAGES = [
  { id: 'privacy', path: '/privacy', label: 'Privacy' },
  { id: 'terms', path: '/terms', label: 'Terms' },
  { id: 'security', path: '/security', label: 'Security' },
] as const;

export type TrustPageId = (typeof TRUST_PAGES)[number]['id'];
export type PublicPage = 'home' | TrustPageId;

/** The public page a path belongs to, or null when it belongs to the application. */
export function publicPage(pathname: string): PublicPage | null {
  const path = pathname.replace(/\/+$/, '');
  if (path === '') return 'home';
  return TRUST_PAGES.find(p => p.path === path.toLowerCase())?.id ?? null;
}
