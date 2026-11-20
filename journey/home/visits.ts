// The browser side of counting visits to the public pages (rules: domain/site/visits.ts). Each count is
// sent once to Umami's address and forgotten: nothing waits for it, and a failure or a blocked address
// changes nothing on the page. No script of Umami's is loaded, no cookie is set, nothing about a visitor
// is kept in the browser. The one flag this file may keep is the owner's own "not counted in this
// browser" (?count=off), which only that browser's owner sets.
import { OPT_OUT, UMAMI, countable, eventBody, optOutChange, pageViewBody, type PageFacts, type VisitEvent } from '../../domain/site/visits.ts';
import type { PublicPage } from '../../domain/site/pages.ts';

/** The local-storage key of the application's sign-in session (journey/store/supabaseStore.ts). */
export const SESSION_KEY = 'avala.journey.auth';

/** Whether this browser holds a sign-in session: a signed-in visit is never counted, and the homepage offers "Open my work". */
export function hasSession(): boolean {
  try { return Object.keys(window.localStorage).some(k => k === SESSION_KEY || /^sb-.+-auth-token$/.test(k)); } catch { return false; }
}

let current: PublicPage | null = null;

/** Whether this browser's owner switched counting off here. */
export function countingOff(): boolean {
  try { return window.localStorage.getItem(OPT_OUT.key) === OPT_OUT.value; } catch { return false; }
}

function allowed(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return countable({
    hostname: window.location.hostname, page: current, signedIn: hasSession(),
    privacySignal: nav.doNotTrack === '1' || nav.globalPrivacyControl === true,
    automated: nav.webdriver === true, optedOut: countingOff(),
  });
}

function facts(pathname = window.location.pathname): PageFacts {
  return {
    hostname: window.location.hostname, pathname, search: window.location.search, title: document.title,
    referrer: document.referrer, language: navigator.language ?? '', screen: `${window.screen.width}x${window.screen.height}`,
  };
}

function send(body: unknown) {
  try {
    void fetch(UMAMI.endpoint, {
      method: 'POST', keepalive: true, credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => undefined);
  } catch { /* counting never affects the page */ }
}

/**
 * Called once when a public page loads. ?count=off or ?count=on switches this browser out of or back
 * into the counts (that visit is not counted) and is taken out of the address.
 */
export function startCounting(page: PublicPage) {
  current = page;
  const change = optOutChange(window.location.search);
  if (change) {
    try { if (change === 'off') window.localStorage.setItem(OPT_OUT.key, OPT_OUT.value); else window.localStorage.removeItem(OPT_OUT.key); } catch { /* storage may be off */ }
    const u = new URL(window.location.href);
    u.searchParams.delete(OPT_OUT.param);
    window.history.replaceState(window.history.state, '', `${u.pathname}${u.search}${u.hash}`);
    return;
  }
  // After the page has drawn, so the count carries the page's own title; nothing on the page waits for it.
  const go = () => window.setTimeout(() => {
    if (!allowed()) return;
    if (page === 'demo') { const b = eventBody(facts('/demo'), 'Demo opened'); if (b) send(b); return; }
    send(pageViewBody(facts()));
  }, 300);
  if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
}

/** One of the listed events, on a page that counts. */
export function countEvent(name: VisitEvent, detail?: string) {
  if (!allowed() || current === 'demo') return;
  const b = eventBody(facts(), name, detail);
  if (b) send(b);
}
