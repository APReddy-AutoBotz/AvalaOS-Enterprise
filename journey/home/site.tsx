// Pieces shared by the public pages (the homepage and the trust pages). No database client here.
import React from 'react';
import { TRUST_PAGES } from '../../domain/site/pages.ts';
import { CONTACT_EMAIL } from '../../domain/site/trust.ts';

export const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2';

/** "Open my work" for a visitor with a sign-in session in local storage, otherwise "Sign in". */
export function useGo(): { href: string; label: string } {
  const signedIn = React.useMemo(() => {
    try { return Object.keys(window.localStorage).some(k => /^sb-.+-auth-token$/.test(k)); } catch { return false; }
  }, []);
  return signedIn ? { href: '/work', label: 'Open my work' } : { href: '/signin', label: 'Sign in' };
}

export function SiteFooter({ go }: { go: { href: string; label: string } }) {
  const link = `rounded text-slate-300 underline-offset-4 hover:text-white hover:underline ${focus} focus-visible:outline-white`;
  return (
    <footer className="bg-[#001B2F] text-slate-300">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-4 border-t border-white/15 px-6 py-8 text-sm">
        <p>© 2026 Avala OS</p>
        <nav aria-label="Legal" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {TRUST_PAGES.map(p => <a key={p.id} href={p.path} className={link}>{p.label}</a>)}
          <a href={`mailto:${CONTACT_EMAIL}`} className={link}>{CONTACT_EMAIL}</a>
        </nav>
        <a href={go.href} className={`font-semibold text-white underline decoration-[#E69F00] decoration-2 underline-offset-4 ${focus} focus-visible:outline-white`}>{go.label}</a>
      </div>
    </footer>
  );
}
