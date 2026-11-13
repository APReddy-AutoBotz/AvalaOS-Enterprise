import { test, expect } from '@playwright/test';
import { INTERNAL, primaryText, shot, signInAndCreateProcess } from './helpers.ts';

test('a process has one workspace with one assessment stage, and internal labels appear only in History', async ({ page }) => {
  await signInAndCreateProcess(page);
  const status = page.getByTestId('revision-status');
  await expect(status).toHaveText('Not started');

  const stages = page.getByRole('navigation', { name: 'Stages' }).getByRole('link');
  await expect(stages).toHaveText(['Sources', 'Process', 'Assessment', 'Documents', 'Flows', 'Work items']);
  await expect(page.getByRole('link', { name: /assess/i })).toHaveCount(1);

  for (const [i, name] of ['Sources', 'Process', 'Assessment', 'Documents', 'Flows', 'Work items'].entries()) {
    await stages.filter({ hasText: name }).click();
    await expect(stages.filter({ hasText: name })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('stage-panel')).toHaveAttribute('aria-label', name);
    expect(await primaryText(page)).not.toMatch(INTERNAL);
    await shot(page, `02-stage-${i + 1}-${name.toLowerCase().replace(' ', '-')}`);
  }

  // Start the model, approve it, and check the header status at each point.
  await stages.filter({ hasText: 'Process' }).click();
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(status).toHaveText('Working draft');
  await expect(page.getByRole('tab', { name: /^Steps/ })).toBeVisible();
  await shot(page, `03-process-started`);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(status).toHaveText('Approved revision 1');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // The route and the data survive a reload; Back returns to the previous stage.
  await page.reload();
  await expect(status).toHaveText('Approved revision 1');
  await expect(page).toHaveURL(/\/process$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/work-items$/);
  expect(await primaryText(page)).not.toMatch(INTERNAL);

  // History holds the internal versions.
  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('dialog', { name: 'History' });
  await expect(history).toContainText('Revision 1');
  await expect(history).toContainText('Approved');
  await expect(history).toContainText('Content hash');
  await expect(history).toContainText('Process model schema version');
  await shot(page, `04-history`);
  await page.keyboard.press('Escape');
  await expect(history).toHaveCount(0);
  expect(await primaryText(page)).not.toMatch(INTERNAL);
});

test('an unknown process says so, and every other path leads to My work, never to the earlier screens', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/process/00000000-0000-4000-8000-000000000000/assessment');
  await expect(page.getByRole('heading', { name: 'Process not found' })).toBeVisible();
  for (const path of ['/', '/sandbox', '/assess/guided']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/work$/);
    await expect(page.getByRole('link', { name: 'Vendor invoice processing' })).toBeVisible();
  }
  await shot(page, `05-processes-list`);
});

test('signing out returns to sign in and protects journey pages', async ({ page }) => {
  await signInAndCreateProcess(page);
  const url = page.url();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin$/);
  await page.goto(url);
  await expect(page).toHaveURL(/\/signin$/);
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(url);
});
