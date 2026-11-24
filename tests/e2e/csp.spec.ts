// The content security policy, report-only (domain/site/csp.ts, written into the built site by vite.config.ts). Every browser test runs under
// it and the run fails on a breach none made on purpose (cspTeardown.ts). Here: the header is on every kind
// of page, the PDF reader's worker runs under it, and a breach made on purpose is reported while the page
// goes on as if nothing happened: report-only blocks nothing and nothing waits for a report.
import { test, expect } from '@playwright/test';
import { CSP_HEADER, cspPolicy } from '../../domain/site/csp.ts';
import { CSP_PROBE_HOST, readCspReports } from './cspReports.ts';
import { signInAndCreateProcess } from './helpers.ts';

const fixture = (name: string) => `domain/ingest/fixtures/${name}`;

// The test server sends the policy the build's settings make (vite.config.ts), as the built site's _headers does.
const CSP_POLICY = cspPolicy({ supabaseUrl: process.env.VITE_SUPABASE_URL, sentryDsn: process.env.VITE_SENTRY_DSN });

test('the policy is sent with the homepage, the trust pages, the demo, sign-in and the application', async ({ request }) => {
  for (const path of ['/', '/privacy', '/terms', '/security', '/demo', '/demo/process/x/assessment', '/signin', '/work', '/process/x/documents', '/unsubscribe']) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()[CSP_HEADER.toLowerCase()], path).toMatch(new RegExp(`^${CSP_POLICY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(; report-uri |$)`));
    expect(res.headers()['content-security-policy'], `${path}: not enforced yet`).toBeUndefined();
  }
});

test("the PDF reader's worker reads a PDF under the policy", async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.getByLabel('Upload source files').setInputFiles([fixture('text-sop.pdf'), fixture('scanned.pdf')]);
  const notes = page.getByTestId('upload-note');
  await expect(notes).toHaveCount(2, { timeout: 30_000 });
  await expect(notes.filter({ hasText: 'text-sop.pdf' })).toContainText('Added:');
  // What the worker would breach is reported to the test server and fails the run (cspTeardown.ts).
});

test('a breach made on purpose is reported, and the page carries on: report-only blocks nothing', async ({ page }) => {
  await page.route(`https://${CSP_PROBE_HOST}/**`, route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>' }));
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const loaded = await page.evaluate(async (host) => {
    const heard = new Promise<string>(ok => document.addEventListener('securitypolicyviolation', e => ok(`${e.effectiveDirective} ${e.disposition}`), { once: true }));
    const img = Object.assign(new Image(), { src: `https://${host}/probe.svg` });
    document.body.append(img);
    await img.decode();
    return { width: img.naturalWidth, heard: await heard };
  }, CSP_PROBE_HOST);
  expect(loaded).toEqual({ width: 4, heard: 'img-src report' });
  // The page did not wait: the next page opens as usual.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect.poll(() => readCspReports().filter(r => r.blocked.includes(CSP_PROBE_HOST)).length, { timeout: 10_000 }).toBeGreaterThan(0);
});
