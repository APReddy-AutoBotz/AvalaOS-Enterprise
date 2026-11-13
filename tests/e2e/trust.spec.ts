// The trust pages: they open on their own (without the application), link to each other, are reachable
// from the homepage and the sign-in page, and pass the accessibility checks.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { shot } from './helpers.ts';

const PAGES = [
  { path: '/privacy', title: 'Privacy notice', link: 'Privacy' },
  { path: '/terms', title: 'Terms of service', link: 'Terms' },
  { path: '/security', title: 'Security', link: 'Security' },
];

for (const p of PAGES) {
  test(`${p.path} opens without the application and passes the accessibility checks`, async ({ page }) => {
    const scripts: string[] = [];
    page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });
    await page.goto(p.path);
    await expect(page).toHaveURL(new RegExp(`${p.path}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(p.title);
    await expect(page).toHaveTitle(`${p.title} | Avala OS`);
    await expect(page.getByText(/^Last updated \d{1,2} [A-Z][a-z]+ \d{4}$/)).toBeVisible();
    // The contents list jumps to each section.
    const contents = page.getByRole('navigation', { name: 'On this page' }).getByRole('link');
    expect(await contents.count()).toBeGreaterThanOrEqual(5);
    const first = contents.first();
    const target = (await first.getAttribute('href'))!;
    await first.click();
    await expect(page.locator(target)).toBeInViewport();
    // Neither the application nor the database client is loaded.
    expect(scripts.filter(u => /JourneyApp|supabase/i.test(u))).toEqual([]);

    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
    await shot(page, `75-trust${p.path.replace('/', '-')}`);
  });
}

test('the homepage footer reaches every trust page, and each links to the others', async ({ page }) => {
  await page.goto('/');
  const legal = page.getByRole('navigation', { name: 'Legal' });
  for (const p of PAGES) await expect(legal.getByRole('link', { name: p.link })).toHaveAttribute('href', p.path);
  await expect(legal.getByRole('link', { name: /@/ })).toHaveAttribute('href', /^mailto:/);
  await legal.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy notice');
  // The main navigation marks the page you are on and leads to the others.
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link', { name: 'Privacy' })).toHaveAttribute('aria-current', 'page');
  await main.getByRole('link', { name: 'Security' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Security');
  await page.getByRole('link', { name: 'Avala OS, home' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('the sign-in page links to the terms and the privacy notice', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByRole('link', { name: 'Terms of service' })).toHaveAttribute('href', '/terms');
  await page.getByRole('link', { name: 'Privacy notice' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy notice');
});

test('a trust page on a phone: nothing spills off the side', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // The title comes before the contents list.
  const titleY = (await page.getByRole('heading', { level: 1 }).boundingBox())!.y;
  expect(titleY).toBeLessThan((await page.getByRole('navigation', { name: 'On this page' }).boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, '76-trust-terms-phone');
});

test('a visitor with a sign-in session sees "Open my work" on the public pages', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('avala.journey.auth', '{}'));
  for (const path of ['/', '/privacy']) {
    await page.goto(path);
    await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Open my work' })).toHaveAttribute('href', '/work');
  }
});
