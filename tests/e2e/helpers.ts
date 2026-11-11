import { expect, type Page } from '@playwright/test';

// Internal labels that must never appear outside History.
export const INTERNAL = /\bV2\b|\bV1\b|PR ?\d|schema version|hash|edit_seq|rev_no/i;
const SHOTS = 'test-results/screens';
/** Small JPEGs: CI prints them into the job log for review on agent branches. */
export const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 70, fullPage: true });

/** Visible text of the page without the History drawer. */
export const primaryText = (page: Page) => page.evaluate(() => {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-testid="history"]').forEach(n => n.remove());
  return clone.innerText;
});

export async function signInAndCreateProcess(page: Page) {
  await page.goto('/processes');
  await expect(page).toHaveURL(/\/signin$/);
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
  await page.getByLabel('Organization').fill('Kaveri Industrial Components');
  await page.getByLabel('First workspace').fill('Finance Operations');
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page.getByRole('heading', { name: 'Processes', exact: true })).toBeVisible();
  await shot(page, `01-processes-empty`);
  await page.getByLabel('Process name').fill('Vendor invoice processing');
  await page.getByRole('button', { name: 'Add process' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);
}

