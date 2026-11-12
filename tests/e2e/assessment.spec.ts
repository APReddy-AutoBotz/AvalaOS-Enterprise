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
  await expect(ranked.nth(0)).toContainText('Best for 2 steps');
  await expect(ranked.nth(1)).toContainText('2nd choice');
  await expect(ranked.nth(1)).toContainText('API integration');
  await expect(page.getByTestId('split')).toHaveText('Of 2 steps people do today: Rule-based RPA for 2.');
  // Why, at a glance: one sentence, the split, and short cards with numbers.
  await expect(page.getByTestId('takeaway')).toContainText('Rule-based RPA is the best fit for 2 of the 2 steps open to automation, mainly because');
  await expect(page.getByTestId('step-split')).toContainText('2 Rule-based RPA');
  await expect(page.getByTestId('why-switch')).toContainText('1 step moves to API integration');
  await expect(page.getByTestId('why-switch')).toContainText('SAP S/4HANA');
  await expect(page.getByTestId('why-ai')).toContainText('Rules on structured data do the work.');
  await expect(page.getByTestId('why-firm')).toContainText('of the facts are known');
  await shot(page, '30-assessment');
  expect(await primaryText(page)).not.toMatch(INTERNAL);

  // The API question becomes a linked open question in the model.
  await page.getByRole('button', { name: 'Add 1 API question to open questions' }).click();
  await expect(page.getByRole('button', { name: /API question/ })).toHaveCount(0);

  // The report carries the same outcome, with the reasons in full sentences.
  await page.getByRole('button', { name: 'Open the assessment report' }).click();
  const report = page.getByTestId('assessment-report');
  await expect(report.getByRole('heading', { name: 'Vendor invoice processing' })).toBeVisible();
  await expect(report).toContainText('RPA-led automation');
  await expect(report).toContainText('Ranking of the approaches');
  await expect(report).toContainText('Why this approach is proposed');
  await expect(report).toContainText('AI is not needed for any step.');
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

test('inputs entered by hand give value and a priority, persist, and a major change means wait', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Assessment');
  // With nothing entered the result is bounded, not blank: what is possible, and what to add first.
  await expect(page.getByTestId('priority-quadrant')).toHaveText('Not placed yet');
  await expect(page.getByTestId('next-inputs')).toContainText('Volume');
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  const inputs = page.getByTestId('assessment-inputs');
  for (const name of ['Check invoice totals', 'Post invoice in SAP']) {
    await inputs.getByLabel(`Rules stated in full and stable for ${name}`).selectOption({ label: 'Yes' });
    await inputs.getByLabel(`Form of the input for ${name}`).selectOption({ label: 'Structured' });
  }
  // The time per case, spread over the steps as an assumption, then one step confirmed by hand.
  await inputs.getByLabel('Handling time', { exact: true }).fill('6');
  await inputs.getByLabel('Handling time', { exact: true }).blur();
  await inputs.getByLabel('Volume', { exact: true }).fill('2000');
  await inputs.getByLabel('Volume', { exact: true }).blur();
  await saved(page);
  // Volume and time per case alone give an upper bound on the value.
  await page.getByRole('tab', { name: 'Result' }).click();
  await expect(page.getByTestId('value')).toContainText('Up to 2,400');
  await expect(page.getByTestId('priority-possible')).toHaveText('Quick win or Fill-in');
  await shot(page, '34-assessment-partial-inputs');
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await inputs.getByRole('button', { name: 'Spread 6 min evenly over 2 steps' }).click();
  await expect(inputs.getByLabel('Minutes per case for Post invoice in SAP')).toHaveValue('3');
  await inputs.getByRole('button', { name: /Set blank/ }).click();
  await inputs.getByLabel('API of SAP S/4HANA').selectOption({ label: 'No API' });
  await inputs.getByLabel('Screens of SAP S/4HANA stable').selectOption({ label: 'Yes' });
  await saved(page);
  await expect(inputs.getByLabel('Share of cases for Post invoice in SAP')).toHaveValue('100');
  await shot(page, '32-assessment-inputs');

  await page.getByRole('tab', { name: 'Result' }).click();
  await expect(page.getByTestId('priority-quadrant')).toHaveText('Quick win');
  await expect(page.getByTestId('value')).toContainText('2,400');
  await expect(page.getByTestId('readiness')).toContainText('Ready to automate');
  await expect(page.getByTestId('value-assumed')).toContainText('2 steps');
  await shot(page, '33-assessment-priority');

  await page.reload();
  await expect(page.getByTestId('priority-quadrant')).toHaveText('Quick win');
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('2000');
  await page.getByLabel('Application change expected').selectOption({ label: 'Major change' });
  await saved(page);
  await page.getByRole('tab', { name: 'Result' }).click();
  await expect(page.getByTestId('readiness')).toContainText('Wait');
  await page.getByRole('button', { name: 'Open the assessment report' }).click();
  await expect(page.getByTestId('report-priority')).toContainText('Quick win');
});

test('a process known only as a whole is assessed as one step from answers given once', async ({ page }) => {
  await signInAndCreateProcess(page);
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByRole('tab', { name: /^Steps/ })).toBeVisible();
  await stage(page, 'Assessment');
  await expect(page.getByTestId('verdict')).toHaveText('Nothing to assess yet');
  await page.getByRole('tab', { name: /^Inputs/ }).click();
  const inputs = page.getByTestId('assessment-inputs');
  await inputs.getByRole('button', { name: 'Assess the process as one step' }).click();
  await inputs.getByLabel('Rules stated in full and stable for the process as a whole').selectOption({ label: 'Yes' });
  await inputs.getByLabel('Form of the input for the process as a whole').selectOption({ label: 'Structured' });
  await inputs.getByLabel('Needs a judgment or accountable decision for the process as a whole').selectOption({ label: 'No' });
  await inputs.getByLabel('Handling time unit').selectOption('hours');
  await inputs.getByLabel('Handling time', { exact: true }).fill('16');
  await inputs.getByLabel('Handling time', { exact: true }).blur();
  await inputs.getByLabel('Volume period').selectOption('year');
  await inputs.getByLabel('Volume', { exact: true }).fill('12');
  await inputs.getByLabel('Volume', { exact: true }).blur();
  await saved(page);
  await expect(inputs.getByTestId('input-row').getByLabel(/^Rules stated in full and stable for /)).toContainText('↑ Yes');
  await shot(page, '35-assessment-whole-process');
  await page.getByRole('tab', { name: 'Result' }).click();
  await expect(page.getByTestId('verdict')).toHaveText('RPA-led automation');
  await expect(page.getByTestId('value')).toContainText('Up to 192');
  await expect(page.getByTestId('priority-quadrant')).toHaveText('Fill-in');

  // The portfolio lists the process with the same result.
  await page.getByRole('link', { name: 'Processes' }).first().click();
  await page.getByRole('tab', { name: 'Portfolio' }).click();
  const prow = page.getByTestId('portfolio-row');
  await expect(prow).toHaveCount(1);
  await expect(prow).toContainText('Rule-based RPA');
  await expect(prow).toContainText('Up to 192');
  await expect(prow).toContainText('Fill-in');
  await expect(page.getByTestId('portfolio-chart')).toBeVisible();
  await shot(page, '36-portfolio');

  // An admin lowers the value line: up to 192 hours could now be on either side of it; the approach is unchanged.
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-state')).toContainText('defaults apply');
  await page.getByLabel('High value starts at').fill('100');
  await page.getByLabel('Hours a full-time person works in a year').fill('100');
  await expect(page.getByRole('button', { name: 'Save settings' })).toBeEnabled();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/enter a number from 800 to 3,000/)).toBeVisible();
  await page.getByLabel('Hours a full-time person works in a year').fill('1800');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toContainText('Saved');
  await shot(page, '37-settings');
  await page.getByRole('tab', { name: 'Portfolio' }).click();
  await expect(prow).toContainText('Rule-based RPA');
  await expect(prow).toContainText('Quick win or Fill-in');
  await page.reload();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByLabel('High value starts at')).toHaveValue('100');
});
