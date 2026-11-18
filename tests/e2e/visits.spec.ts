// Counting visits to the public pages (docs/next-plan.md, section 3e, package 12). Umami's address is
// stood in for: nothing leaves the test. By default the test site sends nothing at all, which is what a
// preview or a local build does. On the site's own address: tests/e2e/visits-site.spec.ts.
import { test, expect, type Page, type Request } from '@playwright/test';

const UMAMI = 'https://gateway.umami.is/api/send';

async function record(page: Page, how: 'ok' | 'abort' = 'ok') {
  const seen: Request[] = [];
  await page.route(UMAMI, route => { seen.push(route.request()); return how === 'abort' ? route.abort() : route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  return seen;
}

test('the test site, like a preview or a local build, sends nothing', async ({ page }) => {
  const seen = await record(page);
  await page.goto('/?utm_source=test');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a walkthrough' }).click();
  await page.goto('/privacy');
  await page.goto('/demo');
  await page.waitForTimeout(1500);
  expect(seen.length).toBe(0);
});
