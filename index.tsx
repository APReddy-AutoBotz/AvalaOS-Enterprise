import React from 'react';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/outfit/wght.css';
import './index.css';
import ReactDOM from 'react-dom/client';
import { parseJourneyPath } from './domain/workspace/route';
import { canonicalUrl, publicPage } from './domain/site/pages';
import { teardownCanonical } from './domain/site/teardownPath';
import { startMonitoring, watchPolicy } from './journey/monitoring';
import { ErrorBoundary } from './journey/ErrorBoundary';
import { startCounting } from './journey/home/visits';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// The process journey (/signin, /work, /processes, /process/:id/:stage) is the application. Any other
// path goes to My work, so no route reaches the earlier screens, including the earlier
// assessment versions; they are no longer part of the build.
// The exceptions are the public pages: "/" (the homepage), /privacy, /terms and /security (the trust
// pages), which load without the application, /demo, the product on the sample case in the browser, and
// /unsubscribe, which stops the weekday email from the link in it.
const pub = publicPage(window.location.pathname);
// One address per public page for search engines, whichever address it was opened at (www, a preview, a
// link with campaign words, a page inside the demo): domain/site/pages.ts, `canonicalUrl`. A teardown in the
// demo names its own address (domain/site/teardownPath.ts).
const canonical = pub && (teardownCanonical(window.location.pathname) ?? canonicalUrl(pub));
if (canonical) {
  const link = document.createElement('link');
  link.rel = 'canonical';
  link.href = canonical;
  document.head.appendChild(link);
}
if (!pub && !parseJourneyPath(window.location.pathname)) {
  window.history.replaceState(null, '', `/work${window.location.hash}`);
}
const Root = React.lazy(async (): Promise<{ default: React.ComponentType }> => {
  if (pub === 'home') return import('./journey/home/HomePage');
  if (pub === 'demo') return import('./journey/demo/DemoApp');
  if (pub === 'unsubscribe') return import('./journey/home/UnsubscribePage');
  if (pub) {
    const id = pub;
    const { default: TrustPage } = await import('./journey/home/TrustPage');
    return { default: () => <TrustPage id={id} /> };
  }
  return import('./journey/JourneyApp');
});

// Errors are reported only when the build has VITE_SENTRY_DSN (journey/monitoring.ts), and so is what the
// content security policy would block (netlify.toml, domain/site/csp.ts).
watchPolicy();
startMonitoring();

// Visits to the public pages are counted on avalaos.com only, signed out (package 12, journey/home/visits.ts).
if (pub) startCounting(pub);

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <React.Suspense fallback={null}>
        <Root />
      </React.Suspense>
    </ErrorBoundary>
  </React.StrictMode>
);
