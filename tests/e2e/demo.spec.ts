// The demo at /demo: the product on the sample case, in the browser only. It starts from the committed
// public/demo-data/sample.json (the state tests/e2e/tour.spec.ts leaves the sample in), keeps changes in
// memory, never writes the in-browser store's local storage, and never calls the database.
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers.ts';

// The demo's own words (domain/site/demo.ts).
const POINTER = "You are looking at the sample's assessment: what each step would be done with, and why. Next, open Documents to see the process document written from it.";
const FILES_NOTE = "In the demo the sample's files are already read. Reading your own files happens in a workspace of your own.";
const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

test('the demo opens the sample case at every stage, under /demo, without a server', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173/')) outside.push(r.url()); });

  await page.goto('/');
  await page.getByRole('link', { name: 'Try the live demo' }).first().click();
  // It opens on the sample's assessment, with one line on what to look at next (marketing review, 18 November 2026).
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/assessment$/);
  await expect(page.getByTestId('verdict')).toContainText('RPA');
  await expect(page.getByTestId('demo-pointer')).toHaveText(POINTER);
  await expect(page.getByTestId('demo-banner')).toContainText('made-up company');
  await expect(page.getByRole('link', { name: 'Leave the demo' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await shot(page, '84-demo-opens');
  await page.getByTestId('demo-pointer').getByRole('link', { name: 'Documents' }).click();
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/documents$/);
  await expect(page.getByTestId('demo-pointer')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My work' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /^(Welcome back|My work)/ })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Processes' }).click();
  await expect(page).toHaveURL(/\/demo\/processes$/);
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/sources$/);
  await expect(page.getByTestId('source-row')).toHaveCount(5);
  // Reading one's own files: plain words and the walkthrough, never "local mode".
  await expect(page.getByTestId('demo-files-note')).toContainText(FILES_NOTE);
  await expect(page.getByText('local mode')).toHaveCount(0);
  await page.getByTestId('demo-files-note').getByRole('button', { name: 'Book a walkthrough' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await stage(page, 'Assessment');
  await expect(page.getByTestId('verdict')).toContainText('RPA');
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /PDD/ }).click();
  await expect(page.getByTestId('document')).toContainText('Process Definition Document');
  await stage(page, 'Flows');
  await expect(page.getByRole('tab', { name: 'To-Be map' })).toBeVisible();
  await stage(page, 'Work items');
  await expect(page.getByTestId('proposal').first()).toBeVisible();

  // A reload stays in the demo, on the same screen.
  const here = page.url();
  await page.reload();
  await expect(page).toHaveURL(here);
  await expect(page.getByTestId('demo-banner')).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Delivery board' }).click();
  await expect(page).toHaveURL(/\/demo\/board/);
  await expect(page.getByTestId('board-card').first()).toBeVisible();
  await shot(page, '85-demo-board');

  expect(outside).toEqual([]);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

// Review of 17 November 2026: a link opened in a new tab must stay in the demo, not land on sign-in.
test('in the demo, every link on the Processes page and on a process page stays in the demo', async ({ page }) => {
  const leaving = async () => page.locator('a[href^="/"]').evaluateAll(as => as.map(a => a.getAttribute('href')!)
    .filter(h => !h.startsWith('/demo') && h !== '/' && !h.startsWith('/brand/') && h !== '/terms' && h !== '/privacy'));
  await page.goto('/demo/processes');
  await expect(page.getByRole('link', { name: /Vendor invoice processing/ }).first()).toBeVisible();
  expect(await page.locator('a[href^="/demo/process/"]').count()).toBeGreaterThan(0);
  expect(await leaving()).toEqual([]);
  await page.getByRole('link', { name: /Vendor invoice processing/ }).first().click();
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/sources$/);
  await expect(page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Assessment' })).toHaveAttribute('href', /^\/demo\/process\/[0-9a-f-]{36}\/assessment$/);
  expect(await leaving()).toEqual([]);
  // Opened in a new tab, a stage's link opens the demo on that stage, not the sign-in page.
  const href = await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Documents' }).getAttribute('href');
  const tab = await page.context().newPage();
  await tab.goto(href!);
  await expect(tab.getByTestId('demo-banner')).toBeVisible();
  await expect(tab).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/documents$/);
});

test('in the demo, changes work but are not kept: a reload starts again and nothing is stored', async ({ page }) => {
  await page.goto('/demo/settings/people');
  const people = page.getByTestId('people');
  await people.getByLabel('Work email').fill('visitor@example.test');
  await people.getByLabel('Role for the new person').selectOption({ label: 'Viewer' });
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByTestId('invites')).toContainText('visitor@example.test');

  expect(await page.evaluate(() => localStorage.getItem('avala.journey.memory.v1'))).toBeNull();
  await page.reload();
  await expect(page.getByTestId('people')).toBeVisible();
  await expect(page.getByText('visitor@example.test')).toHaveCount(0);
});
