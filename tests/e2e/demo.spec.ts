// The demo at /demo: the product on the sample case, in the browser only. It starts from the committed
// public/demo-data/sample.json (the state tests/e2e/tour.spec.ts leaves the sample in), keeps changes in
// memory, never writes the in-browser store's local storage, and never calls the database.
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers.ts';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

test('the demo opens the sample case at every stage, under /demo, without a server', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173/')) outside.push(r.url()); });

  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo' }).click();
  await expect(page).toHaveURL(/\/demo(\/work)?$/);
  await expect(page.getByTestId('demo-banner')).toContainText('made-up company');
  await expect(page.getByRole('link', { name: 'Leave the demo' })).toHaveAttribute('href', '/');
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Processes' }).click();
  await expect(page).toHaveURL(/\/demo\/processes$/);
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/sources$/);
  await expect(page.getByTestId('source-row')).toHaveCount(5);

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

test('in the demo, changes work but are not kept: a reload starts again and nothing is stored', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('tab', { name: 'People' }).click();
  const people = page.getByTestId('people');
  await people.getByLabel('Work email').fill('visitor@example.test');
  await people.getByLabel('Role for the new person').selectOption({ label: 'Viewer' });
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByTestId('invites')).toContainText('visitor@example.test');

  expect(await page.evaluate(() => localStorage.getItem('avala.journey.memory.v1'))).toBeNull();
  await page.reload();
  await page.getByRole('tab', { name: 'People' }).click();
  await expect(page.getByTestId('people')).toBeVisible();
  await expect(page.getByText('visitor@example.test')).toHaveCount(0);
});
