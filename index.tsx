import React from 'react';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/outfit/wght.css';
import './index.css';
import ReactDOM from 'react-dom/client';
import { parseJourneyPath } from './domain/workspace/route';
import { publicPage } from './domain/site/pages';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// The process journey (/signin, /work, /processes, /process/:id/:stage) is the application. Any other
// path goes to My work, so no route reaches the earlier screens, including the earlier
// assessment versions; they are no longer part of the build.
// The exceptions are the public pages: "/" (the homepage), /privacy, /terms and /security (the trust
// pages), which load without the application, and /demo, the product on the sample case in the browser.
const pub = publicPage(window.location.pathname);
if (!pub && !parseJourneyPath(window.location.pathname)) {
  window.history.replaceState(null, '', `/work${window.location.hash}`);
}
const Root = React.lazy(async (): Promise<{ default: React.ComponentType }> => {
  if (pub === 'home') return import('./journey/home/HomePage');
  if (pub === 'demo') return import('./journey/demo/DemoApp');
  if (pub) {
    const id = pub;
    const { default: TrustPage } = await import('./journey/home/TrustPage');
    return { default: () => <TrustPage id={id} /> };
  }
  return import('./journey/JourneyApp');
});

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Root />
    </React.Suspense>
  </React.StrictMode>
);
