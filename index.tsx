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

// The process journey (/signin, /processes, /process/:id/:stage) is its own app. Every other path is
// the earlier application, which is replaced route by route. Each loads only its own code.
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
