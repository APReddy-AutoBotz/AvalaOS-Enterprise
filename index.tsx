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
// path goes to the process list, so no route reaches the earlier screens, including the earlier
// assessment versions; they are no longer part of the build.
if (!parseJourneyPath(window.location.pathname)) {
  window.history.replaceState(null, '', `/processes${window.location.hash}`);
}
const Root = React.lazy(() => import('./journey/JourneyApp'));

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <React.Suspense fallback={null}>
      <Root />
    </React.Suspense>
  </React.StrictMode>
);
