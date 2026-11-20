// Package 13 part A (docs/next-plan.md, section 3f), what a browser shows: sign-out clears what was found in
// the sources from this browser (F10), and robots.txt and the sitemap are real files, not the homepage. The
// demo's opening and its plain words: tests/e2e/demo.spec.ts. Rules: domain/site/storage.test.ts,
// domain/site/headers.test.ts, domain/site/microphone.test.ts, domain/docs/approval.test.ts, domain/ai/usage.test.ts.
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess, signOut } from './helpers.ts';

test('signing out removes what this browser kept about the sources and processes, and keeps preferences', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.evaluate(() => {
    localStorage.setItem('avala:source-look:p1', '{"found":["an answer read from a source"]}');
    localStorage.setItem('avala:dismissed:p1', '["s1"]');
    sessionStorage.setItem('avala:map-shape:p1', 'simple');
    localStorage.setItem('avala.journey.processes.view', 'list');
  });
  await signOut(page);
  await expect(page).toHaveURL(/\/signin$/);
  const left = await page.evaluate(() => ({
    look: localStorage.getItem('avala:source-look:p1'), dismissed: localStorage.getItem('avala:dismissed:p1'),
    shape: sessionStorage.getItem('avala:map-shape:p1'), workspace: localStorage.getItem('avala.journey.workspace'),
    view: localStorage.getItem('avala.journey.processes.view'),
  }));
  expect(left).toEqual({ look: null, dismissed: null, shape: null, workspace: null, view: 'list' });
});

test('robots.txt and the sitemap are real files', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.ok()).toBe(true);
  const text = await robots.text();
  expect(text).toContain('Sitemap: https://avalaos.com/sitemap.xml');
  expect(text).toContain('Disallow: /signin');
  expect(text).not.toContain('<html');
  const map = await (await request.get('/sitemap.xml')).text();
  expect(map).toContain('<urlset');
  expect(map).toContain('<loc>https://avalaos.com/privacy</loc>');
  expect(map).not.toContain('<html');
});

test('each public page names its one canonical address; the application names none', async ({ page }) => {
  const canonical = () => page.locator('link[rel="canonical"]');
  for (const [path, url] of [['/?utm_source=test', 'https://avalaos.com/'], ['/privacy', 'https://avalaos.com/privacy'], ['/terms', 'https://avalaos.com/terms'], ['/security', 'https://avalaos.com/security'], ['/demo', 'https://avalaos.com/demo'], ['/demo/board', 'https://avalaos.com/demo']] as const) {
    await page.goto(path);
    await expect(canonical()).toHaveCount(1);
    await expect(canonical()).toHaveAttribute('href', url);
  }
  await page.goto('/signin');
  await expect(canonical()).toHaveCount(0);
});
