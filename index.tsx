import React from 'react';
import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/outfit/wght.css';
import './index.css';
import ReactDOM from 'react-dom/client';
import { parseJourneyPath } from './domain/workspace/route';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// The process journey (/signin, /processes, /process/:id/:stage) is the application. Any other
// path goes to the process list, so no route reaches the earlier screens (including the earlier
// assessment versions). They load only when a developer sets VITE_LEGACY_APP=on, until their code
// is deleted.
const legacy = import.meta.env.VITE_LEGACY_APP === 'on';
if (!legacy && !parseJourneyPath(window.location.pathname)) {
  window.history.replaceState(null, '', `/processes${window.location.hash}`);
}
const Root = parseJourneyPath(window.location.pathname)
  ? React.lazy(() => import('./journey/JourneyApp'))
  : React.lazy(() => import('./legacyRoot'));

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Root />
    </React.Suspense>
  </React.StrictMode>
);
