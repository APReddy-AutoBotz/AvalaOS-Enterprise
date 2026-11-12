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

test('the process gets a ranked outcome; a rules-only step is RPA with AI unnecessary; an unconfirmed API ranks second with a question', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Assessment');
  await expect(page.getByTestId('verdict')).toHaveText('RPA-led automation');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Keep with a person for now');
  await expect(row(page, 'Post invoice in SAP').getByTestId('recommendation')).toHaveText('Rule-based RPA');

  let panel = await openStep(page, 'Check invoice totals');
  await panel.getByLabel('Rules stated in full and stable for Check invoice totals').selectOption({ label: 'Yes' });
  await panel.getByLabel('Form of the input for Check invoice totals').selectOption({ label: 'Structured data' });
  await expect(panel.getByTestId('recommendation')).toHaveText('Rule-based RPA');
  await expect(panel.getByTestId('ai-badge')).toHaveText('AI unnecessary');
  await expect(panel.getByTestId('step-reason')).toContainText('The rules are written down in full and the input is structured data.');
  // The score is explained: factors, their points, and the limits that applied.
  await expect(panel.getByTestId('approach-score').first()).toContainText('Clear, complete rules');
  await expect(panel.getByTestId('approach-score').first()).toContainText('35 of 35');
  await panel.getByRole('button', { name: /AI-assisted automation/ }).click();
  await expect(panel).toContainText('Less the fixed complexity penalty for AI');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Check invoice totals').getByTestId('ai-badge')).toHaveText('AI unnecessary');

  panel = await openStep(page, 'Post invoice in SAP');
  await expect(panel.getByTestId('approach-score').nth(1)).toContainText('API integration');
  await expect(panel.getByTestId('api-question')).toContainText('Confirm whether SAP S/4HANA has an API that covers "Post invoice in SAP". A confirmed API would make integration the first choice here.');
  await page.keyboard.press('Escape');

  // The final outcome: a ranking with reasons, and the explanation in words.
  const ranked = page.getByTestId('ranked-approach');
  await expect(ranked).toHaveCount(4);
  await expect(ranked.nth(0)).toContainText('1st choice');
  await expect(ranked.nth(0)).toContainText('Rule-based RPA');
  await expect(ranked.nth(0)).toContainText('Best fit for 2 of 2 steps');
  await expect(ranked.nth(1)).toContainText('2nd choice');
  await expect(ranked.nth(1)).toContainText('API integration');
  await expect(ranked.nth(1)).toContainText('If the APIs of SAP S/4HANA are confirmed');
  await expect(page.getByTestId('split')).toHaveText('Of 2 steps people do today: Rule-based RPA for 2.');
  await expect(page.getByTestId('narrative').first()).toContainText('Rule-based RPA scores');
  await expect(page.getByTestId('narrative').filter({ hasText: 'Where AI is needed' })).toContainText('AI is not needed for any step.');
  await shot(page, '30-assessment');
  expect(await primaryText(page)).not.toMatch(INTERNAL);

  // The API question becomes a linked open question in the model.
  await page.getByRole('button', { name: 'Add 1 API question to open questions' }).click();
  await expect(page.getByRole('button', { name: /API question/ })).toHaveCount(0);

  // The report carries the same outcome.
  await page.getByRole('button', { name: 'Open the assessment report' }).click();
  const report = page.getByTestId('assessment-report');
  await expect(report.getByRole('heading', { name: 'Vendor invoice processing' })).toBeVisible();
  await expect(report).toContainText('RPA-led automation');
  await expect(report).toContainText('Ranking of the approaches');
  await expect(report).toContainText('Why this approach is proposed');
  await expect(report).toContainText('How the scores are calculated');
  await shot(page, '31-assessment-report');
  expect(await primaryText(page)).not.toMatch(INTERNAL);
  await page.getByRole('button', { name: /Back to the assessment/ }).click();

  await stage(page, 'Process');
  await page.getByRole('tab', { name: /^Open questions/ }).click();
  await expect(page.getByTestId('open-question').filter({ hasText: 'Confirm whether SAP S/4HANA has an API' })).toContainText('About: SAP S/4HANA');

  // The facts persist with the model.
  await page.reload();
  await stage(page, 'Assessment');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Rule-based RPA');
});

test('an override needs a rationale, survives reload and re-scoring, and keeps the scoring answer visible', async ({ page }) => {
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
  await expect(panel.getByTestId('override-note')).toContainText('The scoring recommends Rule-based RPA.');
  await page.keyboard.press('Escape');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Keep with a person');
  await expect(row(page, 'Check invoice totals').getByTestId('overridden')).toBeVisible();

  await page.reload();
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Keep with a person');
  await expect(row(page, 'Check invoice totals')).toContainText('Auditors require a second person');

  // Re-scoring after a fact changes keeps the override.
  panel = await openStep(page, 'Check invoice totals');
  await panel.getByLabel('Needs a physical action for Check invoice totals').selectOption({ label: 'No' });
  await saved(page);
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(row(page, 'Check invoice totals').getByTestId('overridden')).toBeVisible();
  panel = await openStep(page, 'Check invoice totals');
  await expect(panel.getByTestId('override-note')).toContainText('The scoring recommends Rule-based RPA.');
  await panel.getByRole('button', { name: 'Remove override' }).click();
  await page.keyboard.press('Escape');
  await expect(row(page, 'Check invoice totals').getByTestId('recommendation')).toHaveText('Rule-based RPA');
});
