import { test, expect, type Page } from '@playwright/test';

// Internal labels that must never appear outside History.
const INTERNAL = /\bV2\b|\bV1\b|PR ?\d|schema version|hash|edit_seq|rev_no/i;
const SHOTS = 'test-results/screens';
/** Small JPEGs: CI prints them into the job log for review on agent branches. */
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 70, fullPage: true });

/** Visible text of the page without the History drawer. */
const primaryText = (page: Page) => page.evaluate(() => {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('[data-testid="history"]').forEach(n => n.remove());
  return clone.innerText;
});

async function signInAndCreateProcess(page: Page) {
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
  await expect(page.getByText('Steps', { exact: true })).toBeVisible();
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

test('an unknown process says so, and paths outside the journey are left to the rest of the app', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/process/00000000-0000-4000-8000-000000000000/assessment');
  await expect(page.getByRole('heading', { name: 'Process not found' })).toBeVisible();
  await page.goto('/processes');
  await expect(page.getByRole('link', { name: 'Vendor invoice processing' })).toBeVisible();
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
