import fs from 'fs';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { CSP_HEADER, cspHeadersFile, cspPolicy } from './domain/site/csp.ts';
import { CSP_REPORT_PATH } from './tests/e2e/cspReports.ts';

// The site's content security policy (domain/site/csp.ts), built from the build's own settings: written into
// the built site as Netlify's `_headers` file, so the live site and every preview are sent it.
function policyHeaders(policy: string): Plugin {
  return {
        name: 'avala-csp-headers',
        apply: 'build',
        generateBundle() { this.emitFile({ type: 'asset', fileName: '_headers', source: cspHeadersFile(policy) }); },
  };
}

// The browser tests run under the same policy: `vite preview` sends it too, and, only when the tests name a
// file for it (CSP_REPORTS_FILE, set in playwright.config.ts), asks the browser to report every breach to
// CSP_REPORT_PATH, which only this preview server answers. The tests then fail on any breach they did not
// cause on purpose. The built site's header has no reporting address.
const cspReports = process.env.CSP_REPORTS_FILE;
function policyReports(): Plugin {
  return {
    name: 'avala-csp-reports',
    configurePreviewServer(server) {
      server.middlewares.use(CSP_REPORT_PATH, (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          if (cspReports && body.trim()) fs.appendFileSync(cspReports, `${body.replace(/\s*\n\s*/g, ' ').trim()}\n`);
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

// The site's one build: index.html is the entry; the journey, the homepage and the demo are reached from it.

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const policy = cspPolicy({ supabaseUrl: env.VITE_SUPABASE_URL, sentryDsn: env.VITE_SENTRY_DSN });
  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    // The visit-counting browser test opens the local build under the site's own name (tests/e2e/visits.spec.ts);
    // this applies only to `vite preview` on a developer's or CI's machine, never to the built site.
    preview: {
      allowedHosts: ['avalaos.com'],
      headers: { [CSP_HEADER]: cspReports ? `${policy}; report-uri ${CSP_REPORT_PATH}` : policy },
    },
    plugins: [react(), policyHeaders(policy), policyReports()],
    // The build of Avala OS a kept version records beside its inputs (package 14): Netlify's commit, else "local".
    // Not a secret. It lets the Documents page say a release changed the text only when the inputs prove it.
    // The browser tests' stand-in for AI tasks (journey/store/standIns.ts) is built in only for the test build,
    // which sets VITE_JOURNEY_STORE=memory (playwright.config.ts); elsewhere the branch is false and left out.
    define: {
      __AVALA_BUILD__: JSON.stringify((process.env.COMMIT_REF ?? '').slice(0, 12) || 'local'),
      __AVALA_STAND_INS__: JSON.stringify(process.env.VITE_JOURNEY_STORE === 'memory'),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
            if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
