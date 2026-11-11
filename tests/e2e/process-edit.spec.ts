import { test, expect, type Page } from '@playwright/test';
import { INTERNAL, primaryText, shot, signInAndCreateProcess } from './helpers.ts';

async function openProcessStage(page: Page) {
  await signInAndCreateProcess(page);
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Process' }).click();
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByRole('tab', { name: /^Steps/ })).toBeVisible();
}

const saved = (page: Page) => expect(page.getByTestId('save-state')).toHaveText('All changes saved');

async function addRoles(page: Page, names: string[]) {
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  for (const name of names) {
    await page.getByLabel('New role', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add role' }).click();
    await expect(page.getByLabel(`Name of role ${name}`)).toBeVisible();
  }
  await saved(page);
}

async function addStep(page: Page, name: string, type = 'Manual, no system') {
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await page.getByLabel('New step', { exact: true }).fill(name);
  await page.getByLabel('Type of new step').selectOption({ label: type });
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByLabel(/^Name of step \d+$/).last()).toHaveValue(name);
  await saved(page);
}

test('a step can be added, assigned a role, renamed, reordered and deleted, and the edits survive a reload', async ({ page }) => {
  await openProcessStage(page);
  await addRoles(page, ['AP Clerk', 'AP Team Lead']);
  await addStep(page, 'Check mandatory fields');
  await addStep(page, 'Validate vendor in SAP');

  const roles = page.getByRole('group', { name: 'Roles for Check mandatory fields' });
  await page.getByLabel('Add to roles for check mandatory fields').selectOption({ label: 'AP Clerk' });
  await expect(roles.getByRole('button', { name: 'Remove AP Clerk from roles for check mandatory fields' })).toBeVisible();
  await saved(page);

  // Change the role: remove the clerk, add the team lead.
  await page.getByRole('button', { name: 'Remove AP Clerk from roles for check mandatory fields' }).click();
  await page.getByLabel('Add to roles for check mandatory fields').selectOption({ label: 'AP Team Lead' });
  await saved(page);
  await page.getByLabel('Name of step 2', { exact: true }).fill('Validate vendor and GSTIN in SAP');
  await page.getByLabel('Name of step 2', { exact: true }).press('Enter');
  await saved(page);
  await shot(page, '10-steps-edited');

  await page.reload();
  const chip = (role: string) => page.getByRole('button', { name: `Remove ${role} from roles for check mandatory fields` });
  await expect(chip('AP Team Lead')).toBeVisible();
  await expect(chip('AP Clerk')).toHaveCount(0);
  await expect(page.getByLabel('Name of step 2', { exact: true })).toHaveValue('Validate vendor and GSTIN in SAP');
  await expect(page.getByTestId('step-row').first().locator('[data-status]')).toHaveAttribute('data-status', 'user-confirmed');
  await expect(page.getByTestId('revision-status')).toHaveText('Working draft');

  // Reorder, then delete.
  await page.getByRole('button', { name: 'Move Validate vendor and GSTIN in SAP up' }).click();
  await saved(page);
  await expect(page.getByLabel('Name of step 1', { exact: true })).toHaveValue('Validate vendor and GSTIN in SAP');
  await page.getByRole('button', { name: 'Delete step "Check mandatory fields"' }).click();
  await page.getByRole('button', { name: 'Delete step "Check mandatory fields"?' }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('step-row')).toHaveCount(1);
  await expect(page.getByLabel('Name of step 1', { exact: true })).toHaveValue('Validate vendor and GSTIN in SAP');
  expect(await primaryText(page)).not.toMatch(INTERNAL);

  // Every edit is in History.
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog', { name: 'History' })).toContainText('Deleted "Check mandatory fields"');
});

test('answering an open question writes the answer to the model as confirmed', async ({ page }) => {
  await openProcessStage(page);
  await addRoles(page, ['AP Clerk']);
  await addStep(page, 'Scan paper invoice');

  await page.getByRole('tab', { name: /^Open questions/ }).click();
  const gap = page.getByTestId('gap-row').filter({ hasText: 'Who does "Scan paper invoice"?' });
  await gap.getByRole('button', { name: 'Track as question' }).click();
  const question = page.getByTestId('open-question').filter({ hasText: 'Who does "Scan paper invoice"?' });
  await expect(question).toBeVisible();
  await saved(page);
  await shot(page, '11-open-question');

  await question.getByLabel('Answer to: Who does "Scan paper invoice"?').selectOption({ label: 'AP Clerk' });
  await question.getByRole('button', { name: 'Answer' }).click();
  await saved(page);
  await expect(page.getByTestId('answered-question')).toContainText('AP Clerk');

  await page.reload();
  await page.getByRole('tab', { name: /^Open questions/ }).click();
  await expect(page.getByTestId('open-question')).toHaveCount(0);
  await expect(page.getByTestId('answered-question')).toContainText('Who does "Scan paper invoice"?');
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await expect(page.getByRole('button', { name: 'Remove AP Clerk from roles for scan paper invoice' })).toBeVisible();
  await expect(page.getByTestId('step-row').first().locator('[data-status]')).toHaveAttribute('data-status', 'user-confirmed');
});

test('editing after approval starts a new working draft and keeps the approved revision', async ({ page }) => {
  await openProcessStage(page);
  await addStep(page, 'Post invoice');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('revision-status')).toHaveText('Approved revision 1');
  await addStep(page, 'Close the case');
  await expect(page.getByTestId('revision-status')).toContainText('unapproved changes');
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('dialog', { name: 'History' })).toContainText('Revision 2');
});
