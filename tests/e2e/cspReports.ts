// Where the browser tests' server collects the content security policy's reports (vite.config.ts), and how
// the run reads them (cspTeardown.ts, csp.spec.ts). Plain Node: the build settings load this file too.
import fs from 'node:fs';
import path from 'node:path';

/** The address only the browser tests' preview server answers; never part of the built site's header. */
export const CSP_REPORT_PATH = '/__csp-report';

/** One line of JSON per report, as the browser sent it. */
export const CSP_REPORTS_FILE = path.resolve('test-results', 'csp-reports.ndjson');

/** A site no page uses: what a test loads on purpose to see the policy report it. */
export const CSP_PROBE_HOST = 'csp-probe.invalid';

export interface CspReport { blocked: string; directive: string; page: string; source: string }

/** Every report collected so far, in the browser's own words (its `csp-report` body). */
export function readCspReports(file = CSP_REPORTS_FILE): CspReport[] {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map(l => {
    let r: Record<string, unknown> = {};
    try { const j = JSON.parse(l); r = (j['csp-report'] ?? j) as Record<string, unknown>; } catch { r = { 'blocked-uri': `unreadable: ${l.slice(0, 200)}` }; }
    const s = (k: string) => (typeof r[k] === 'string' ? (r[k] as string) : '');
    return { blocked: s('blocked-uri'), directive: s('effective-directive') || s('violated-directive'), page: s('document-uri'), source: s('source-file') };
  });
}

/** The reports a test did not cause on purpose. */
export const unexpected = (reports: CspReport[]) => reports.filter(r => !r.blocked.includes(CSP_PROBE_HOST));
