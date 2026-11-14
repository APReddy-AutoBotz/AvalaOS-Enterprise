import { test, expect } from '@playwright/test';
import { shot, signInAndCreateProcess, signOut } from './helpers.ts';

test('signing in lands on My work; what needs you comes from the process, and naming someone moves it to them', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.getByRole('link', { name: 'My work' }).click();
  await expect(page).toHaveURL(/\/work$/);
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();

  // Nobody is named yet, so the admin sees the analyst's first step, marked as unassigned.
  const needs = page.getByTestId('needs-you');
  await expect(needs).toContainText('Add sources and start the process model');
  await expect(needs).toContainText('Nobody is named for this yet');
  await expect(page.getByTestId('my-processes')).toContainText('Nobody named');
  await shot(page, '61-my-work-unassigned');

  // Name the analyst on the process: the entry is now theirs, and the process is under "My processes".
  await needs.getByRole('button', { name: /Vendor invoice processing/ }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);
  await page.getByTestId('process-people').getByLabel('Analyst').selectOption({ label: 'analyst' });
  await page.getByRole('link', { name: 'My work' }).click();
  await expect(page.getByTestId('needs-you')).not.toContainText('Nobody is named for this yet');
  await expect(page.getByTestId('my-processes')).toContainText('Analyst');
  await expect(page.getByTestId('my-processes')).not.toContainText('Nobody named');
  await shot(page, '62-my-work-named');

  // Signing in again lands here.
  await signOut(page);
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/work$/);
});
