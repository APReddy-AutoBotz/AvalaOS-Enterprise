// Counting visits to the public pages (docs/next-plan.md, section 3e, package 12). Umami's address is
// stood in for: nothing leaves the test. By default the test site sends nothing at all, which is what a
// preview or a local build does. The second group opens the same build under the site's own name
// (avalaos.com, mapped to this machine) in a browser that does not say it is driven by test tools.
import { test, expect, type Page, type Request } from '@playwright/test';

const UMAMI = 'https://gateway.umami.is/api/send';
const bodies = (reqs: Request[]) => reqs.map(r => JSON.parse(r.postData() ?? '{}'));

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

test.describe('on the site\'s own address', () => {
  test.use({
    baseURL: 'http://avalaos.com:4173',
    launchOptions: { args: ['--host-resolver-rules=MAP avalaos.com 127.0.0.1'] },
  });
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  });

  test('a homepage visit sends one count with only the listed fields', async ({ page }) => {
    const seen = await record(page);
    await page.goto('/?utm_source=linkedin&utm_campaign=nov&email=someone@example.com#trust');
    await expect.poll(() => seen.length).toBe(1);
    await page.waitForTimeout(800);
    expect(seen.length).toBe(1);
    const [b] = bodies(seen);
    expect(b.type).toBe('event');
    expect(Object.keys(b.payload).sort()).toEqual(['hostname', 'language', 'referrer', 'screen', 'title', 'url', 'website']);
    expect(b.payload).toMatchObject({ website: '14ef4005-3173-46da-a837-efcc39cf1a48', hostname: 'avalaos.com', url: '/?utm_source=linkedin&utm_campaign=nov' });
    expect(seen[0]!.headers()['cookie']).toBeUndefined();
  });

  test('the walkthrough window sends opened and sent, with nothing typed in them', async ({ page }) => {
    const seen = await record(page);
    await page.route('**/functions/v1/journey-inquiry', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.goto('/');
    await expect.poll(() => seen.length).toBe(1);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a walkthrough' }).click();
    const d = page.getByRole('dialog', { name: 'Book a walkthrough' });
    await d.getByLabel('Your name').fill('Asha Rao');
    await d.getByLabel('Work email').fill('asha@example.com');
    await d.getByLabel('Company').fill('Kaveri Components');
    await page.waitForTimeout(3100);
    await d.getByRole('button', { name: 'Send' }).click();
    await expect(d.getByTestId('inquiry-thanks')).toBeVisible();
    await expect.poll(() => seen.length).toBe(3);
    const names = bodies(seen).map(b => b.payload.name ?? 'page view');
    expect(names).toEqual(['page view', 'Walkthrough opened', 'Walkthrough sent']);
    const all = seen.map(r => r.postData() ?? '').join(' ');
    for (const typed of ['Asha', 'asha@example.com', 'Kaveri']) expect(all).not.toContain(typed);
  });

  test('a tour stage and a "Read more" send their one detail', async ({ page }) => {
    const seen = await record(page);
    await page.goto('/');
    await expect.poll(() => seen.length).toBe(1);
    await page.getByRole('button', { name: /^Validate\./ }).click();
    await page.getByText('Read more').first().click();
    await expect.poll(() => seen.length).toBe(3);
    const [, tour, more] = bodies(seen);
    expect(tour.payload).toMatchObject({ name: 'Tour stage picked', data: { stage: 'Validate' } });
    expect(more.payload.name).toBe('Read more opened');
    expect(Object.keys(more.payload.data)).toEqual(['which']);
  });

  test('the demo is counted once, and nothing inside it', async ({ page }) => {
    const seen = await record(page);
    await page.goto('/demo');
    await expect.poll(() => seen.length).toBe(1);
    await page.getByTestId('demo-pointer').getByRole('link', { name: 'Documents' }).click();
    await page.waitForTimeout(1000);
    expect(seen.length).toBe(1);
    expect(bodies(seen)[0].payload).toMatchObject({ name: 'Demo opened', url: '/demo' });
  });

  test('nothing is sent signed in, with a privacy signal, or inside the product', async ({ page }) => {
    const seen = await record(page);
    await page.addInitScript(() => window.localStorage.setItem('avala.journey.auth', '{}'));
    await page.goto('/');
    await page.goto('/privacy');
    await page.waitForTimeout(1200);
    expect(seen.length).toBe(0);
  });

  test('Global Privacy Control is honoured', async ({ page }) => {
    const seen = await record(page);
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
    await page.goto('/');
    await page.waitForTimeout(1200);
    expect(seen.length).toBe(0);
  });

  test('the page works when the counter is blocked', async ({ page }) => {
    await record(page, 'abort');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a walkthrough' }).click();
    await expect(page.getByRole('dialog', { name: 'Book a walkthrough' })).toBeVisible();
  });

  test('?count=off leaves this browser out until ?count=on', async ({ page }) => {
    const seen = await record(page);
    await page.goto('/?count=off');
    await expect(page).toHaveURL(/avalaos\.com:4173\/$/);
    await expect(page.getByTestId('counting-off')).toBeVisible();
    await page.goto('/privacy');
    await page.waitForTimeout(1200);
    expect(seen.length).toBe(0);
    await page.goto('/?count=on');
    await expect(page.getByTestId('counting-off')).toHaveCount(0);
    await page.goto('/privacy');
    await expect.poll(() => seen.length).toBe(1);
  });
});
