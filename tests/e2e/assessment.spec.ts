import { test, expect, type Page } from '@playwright/test';
import { INTERNAL, primaryText, shot, signInAndCreateProcess } from './helpers.ts';

const saved = (page: Page) => expect(page.getByTestId('save-state').first()).not.toHaveText('Saving…');
const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

async function buildProcess(page: Page) {
  await signInAndCreateProcess(page);
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  await page.getByLabel('New system', { exact: true }).fill('SAP S/4HANA');
  await page.getByRole('button', { name: 'Add system' }).click();
  await expect(page.getByLabel('Name of system SAP S/4HANA')).toBeVisible();
  await page.getByRole('tab', { name: /^Steps/ }).click();
  for (const [name, type] of [['Check invoice totals', 'Automatic check'], ['Post invoice in SAP', 'Person using a system']]) {
    await page.getByLabel('New step', { exact: true }).fill(name);
    await page.getByLabel('Type of new step').selectOption({ label: type });
    await page.getByRole('button', { name: 'Add step' }).click();
    await expect(page.getByLabel(/^Name of step \d+$/).last()).toHaveValue(name);
  }
  await page.getByLabel('Add to systems for post invoice in sap').selectOption({ label: 'SAP S/4HANA' });
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
}

const row = (page: Page, name: string) => page.getByTestId('assessment-row').filter({ hasText: name });
async function openStep(page: Page, name: string) {
  await page.getByRole('button', { name: `Assessment of ${name}` }).click();
  return page.getByRole('dialog', { name });
}

test('a rules-only step shows AI unnecessary with its reason; an unknown API is an API-first candidate with a question', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Assessment');
  await expect(page.getByTestId('headline')).toBeVisible();
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Keep with a person for now');

  let panel = await openStep(page, 'Check invoice totals');
  await panel.getByLabel('Rules stated in full and stable for Check invoice totals').selectOption({ label: 'Yes' });
  await panel.getByLabel('Form of the input for Check invoice totals').selectOption({ label: 'Structured data' });
  await expect(panel.getByTestId('ai-badge')).toHaveText('AI unnecessary');
  await expect(panel).toContainText('fixed rules or a workflow can do this. AI is unnecessary.');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Rules or workflow');
  await expect(row(page, 'Check invoice totals').getByTestId('ai-badge')).toHaveText('AI unnecessary');

  panel = await openStep(page, 'Post invoice in SAP');
  await panel.getByLabel('Form of the input for Post invoice in SAP').selectOption({ label: 'Structured data' });
  await expect(panel.getByTestId('api-question')).toContainText('Confirm whether SAP S/4HANA has an API that covers "Post invoice in SAP".');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Post invoice in SAP').getByTestId('recommendation')).toHaveText('API-first candidate');
  await expect(row(page, 'Post invoice in SAP').getByTestId('ai-badge')).toHaveText('Not decided');
  await expect(page.getByTestId('composition')).toHaveText('1 of 2 steps need no AI: 1 by rules; 1 wait on an API confirmation.');
  await shot(page, '30-assessment');
  expect(await primaryText(page)).not.toMatch(INTERNAL);

  // The API question becomes a linked open question in the model.
  await page.getByRole('button', { name: 'Add 1 API question to open questions' }).click();
  await expect(page.getByRole('button', { name: /API question/ })).toHaveCount(0);
  await stage(page, 'Process');
  await page.getByRole('tab', { name: /^Open questions/ }).click();
  const q = page.getByTestId('open-question').filter({ hasText: 'Confirm whether SAP S/4HANA has an API' });
  await expect(q).toContainText('About: SAP S/4HANA');

  // The facts persist with the model.
  await page.reload();
  await stage(page, 'Assessment');
  await expect(row(page, 'Check invoice totals').getByTestId('ai-badge')).toHaveText('AI unnecessary');
});

test('an override needs a rationale, survives reload and re-evaluation, and keeps the rules answer visible', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Assessment');
  let panel = await openStep(page, 'Check invoice totals');
  await panel.getByLabel('Rules stated in full and stable for Check invoice totals').selectOption({ label: 'Yes' });
  await panel.getByLabel('Form of the input for Check invoice totals').selectOption({ label: 'Structured data' });
  await panel.getByLabel('Override recommendation').selectOption({ label: 'Keep with a person' });
  await expect(panel.getByRole('button', { name: 'Override' })).toBeDisabled();
  await panel.getByLabel('Rationale').fill('Auditors require a second person on totals checks.');
  await panel.getByRole('button', { name: 'Override' }).click();
  await expect(panel.getByTestId('override-note')).toContainText('Overridden by');
  await expect(panel.getByTestId('override-note')).toContainText('The rules recommend rules or workflow.');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Keep with a person');
  await expect(row(page, 'Check invoice totals').getByTestId('overridden')).toBeVisible();

  await page.reload();
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Keep with a person');
  await expect(row(page, 'Check invoice totals')).toContainText('Auditors require a second person');

  // Re-evaluation after a fact changes keeps the override.
  panel = await openStep(page, 'Check invoice totals');
  await panel.getByLabel('Needs a physical action for Check invoice totals').selectOption({ label: 'No' });
  await saved(page);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(row(page, 'Check invoice totals').getByTestId('overridden')).toBeVisible();
  panel = await openStep(page, 'Check invoice totals');
  await expect(panel.getByTestId('override-note')).toContainText('The rules recommend rules or workflow.');
  await panel.getByRole('button', { name: 'Remove override' }).click();
  await page.keyboard.press('Escape');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Rules or workflow');
});
