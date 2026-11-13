import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
  // Money only from figures entered here: 2,400 hours at 500 an hour, build 600,000, running 120,000 a year.
  await page.getByLabel('Currency').fill('inr');
  await page.getByLabel('Cost per hour').fill('500');
  await page.getByLabel('Build cost').fill('600000');
  await page.getByLabel('Running cost a year').fill('120,000');
  await page.getByRole('button', { name: 'Save figures' }).click();
  await expect(page.getByTestId('benefit-value')).toContainText('INR 1,200,000');
  await expect(page.getByTestId('benefit-payback')).toContainText('6.7 months');
  await page.getByTestId('benefit-payback').scrollIntoViewIfNeeded();
  await shot(page, '38-benefit-payback');
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

test('the documents follow the model: PDD with one row per step, BRD, open items and Markdown download', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Process Definition Document');
  const steps = doc.locator('[data-caption="Detailed As-Is steps"] tbody tr');
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1)).toContainText('Post invoice in SAP');
  await expect(doc.locator('[data-caption="Delivery model"] tbody tr').nth(1)).toContainText('Rule-based RPA');
  await expect(doc.getByTestId('open-item').first()).toContainText('objective');
  await expect(doc).not.toContainText(/TBD|placeholder|lorem/i);
  await shot(page, '39-documents-pdd');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()]);
  expect(download.suggestedFilename()).toMatch(/PDD\.md$/);
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  expect(word.suggestedFilename()).toMatch(/PDD\.docx$/);
  const bytes = readFileSync(await word.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.length).toBeGreaterThan(5000);
  // The As-Is and To-Be maps are in the document and, as pictures, in the Word file.
  await expect(doc.getByTestId('flow-figure')).toHaveCount(2);
  await expect(doc.locator('[data-caption="To-Be process map, coloured by delivery mode"] svg')).toContainText('Rule-based RPA');
  expect(bytes.includes(Buffer.from('word/media/'))).toBe(true);

  await page.getByRole('tab', { name: /BRD/ }).click();
  await expect(doc).toContainText('Business Requirements Document');
  await expect(doc).toContainText('PDD section "Detailed As-Is steps"');
  await page.getByRole('tab', { name: /SDD/ }).click();
  await expect(page.getByTestId('doc-not-ready')).toContainText('approved PDD');
  await page.getByRole('button', { name: 'Preview the SDD from this draft' }).click();
  await expect(page.getByTestId('sdd-preview')).toBeVisible();
  await expect(doc).toContainText('Solution Design Document');
  await expect(doc).toContainText(/AU-0\d Rule-based RPA in SAP S\/4HANA/);
  await expect(doc).toContainText('How does the solution sign in to SAP S/4HANA');
  await expect(doc).toContainText('Open design decisions');
  await shot(page, '49-sdd');
  const [sdd] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  expect(sdd.suggestedFilename()).toMatch(/SDD\.docx$/);
});

test('closing the gaps: answers in a guided session update the model and the documents', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Documents');
  await expect(page.getByTestId('gaps-banner')).toBeVisible();
  await page.getByRole('button', { name: 'Answer them' }).click();
  const assistant = page.getByTestId('gaps-assistant');
  const before = Number((await assistant.getByTestId('gaps-count').textContent())!.match(/\d+/)![0]);
  await shot(page, '40-gaps-assistant');

  // Who does the step: a role picker; the answer writes the step's role.
  const roleQ = assistant.getByRole('list', { name: 'Questions' }).getByRole('button', { name: /Who does "Check invoice totals"/ });
  if (await roleQ.count()) {
    await roleQ.click();
    await expect(assistant.getByTestId('gap-question')).toContainText('Who does "Check invoice totals"');
  }
  // The objective: free text written to the process.
  await assistant.getByRole('list', { name: 'Questions' }).getByRole('button', { name: /objective/i }).click();
  await assistant.getByLabel('Answer', { exact: true }).fill('Post supplier invoices correctly within five working days.');
  await assistant.getByRole('button', { name: 'Save answer' }).click();
  await saved(page);
  await expect(assistant.getByTestId('gaps-count')).toHaveText(new RegExp(`^${before - 1} `));

  // Set one aside for someone else.
  await assistant.getByRole('button', { name: 'Ask someone later' }).click();
  await assistant.getByLabel('Who should answer it').fill('AP Team Lead');
  await assistant.getByRole('button', { name: 'Set aside' }).click();
  await saved(page);
  await expect(assistant.getByTestId('gaps-count')).toHaveText(new RegExp(`^${before - 2} `));

  await assistant.getByRole('button', { name: 'Back to the document' }).click();
  await expect(page.getByTestId('document')).toContainText('Post supplier invoices correctly within five working days.');
});

test('an admin sets how documents look: organisation, colour and logo show on the document and the Word download still works', async ({ page }) => {
  await buildProcess(page);
  const processUrl = page.url();
  await page.getByRole('link', { name: 'Processes' }).first().click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const brand = page.getByTestId('document-branding');
  await brand.getByLabel('Organisation name').fill('Northwind Shared Services');
  await brand.getByLabel('Accent colour hex').fill('#7A1F5C');
  // A 1x1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  await brand.getByLabel('Upload logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: png });
  await expect(brand.getByRole('img', { name: 'Logo' })).toBeVisible();
  await brand.getByLabel('Accent colour hex').fill('not a colour');
  await brand.getByRole('button', { name: 'Save how documents look' }).click();
  await expect(brand.getByRole('alert')).toContainText('six hex digits');
  await brand.getByLabel('Accent colour hex').fill('#7A1F5C');
  await brand.getByRole('button', { name: 'Save how documents look' }).click();
  await expect(brand.getByRole('status')).toContainText('Saved');
  await shot(page, '45-document-branding');

  await page.goto(processUrl);
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Northwind Shared Services');
  await expect(doc.locator('header').first()).toHaveCSS('border-bottom-color', 'rgb(122, 31, 92)');
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const bytes = readFileSync(await word.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
  expect(bytes.includes(Buffer.from('word/media/'))).toBe(true);
});

test('an admin uses the company\'s section structure: renamed, hidden and own sections show in the PDD, renumbered', async ({ page }) => {
  await buildProcess(page);
  const processUrl = page.url();
  await page.getByRole('link', { name: 'Processes' }).first().click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  const box = page.getByTestId('document-sections');
  await box.getByLabel('Title of section 2.4').fill('Current procedure');
  await box.getByLabel('Hide section 1.4').check();
  await expect(box.getByLabel('Hide section 6')).toHaveCount(0);
  await box.getByTestId('layout-section').filter({ has: page.getByLabel('Title of section 1', { exact: true }) }).getByRole('button', { name: '+ Add after' }).click();
  await box.getByLabel('Title of your section').fill('Approval and sign-off');
  await box.getByLabel('Text of Approval and sign-off').fill('Approved by the Process Owner and the Head of Finance Operations.');
  await box.getByRole('button', { name: 'Move section 1 down' }).click();
  await box.getByRole('button', { name: 'Save PDD sections' }).click();
  await expect(box.getByRole('status')).toContainText('Saved');
  await shot(page, '46-document-sections');

  await page.goto(processUrl);
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Current procedure');
  await expect(doc).not.toContainText('Minimum prerequisites for automation');
  await expect(doc).toContainText('Approved by the Process Owner and the Head of Finance Operations.');
  // As-Is moved first, so it is now section 1 and the steps are 1.4.
  await expect(doc.locator('[data-caption="Detailed As-Is steps"] tbody tr')).toHaveCount(2);
  await expect(page.getByRole('link', { name: /^1\.4 Current procedure$/ })).toBeVisible();
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  expect(readFileSync(await word.path()).subarray(0, 2).toString()).toBe('PK');
});

test('question packs: one file per owner to download, and a returned pack is read back for review', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Documents');
  await page.getByRole('button', { name: 'Answer them' }).click();
  const packs = page.getByTestId('question-packs');
  await expect(packs.getByTestId('question-pack').first()).toBeVisible();
  await shot(page, '47-question-packs');
  const owner = (await packs.getByTestId('question-pack').first().locator('p').first().textContent())!;
  const [word] = await Promise.all([page.waitForEvent('download'), packs.getByRole('button', { name: `Word pack for ${owner}` }).click()]);
  expect(word.suggestedFilename()).toMatch(/questions for .*\.docx$/);
  expect(readFileSync(await word.path()).subarray(0, 2).toString()).toBe('PK');
  const [md] = await Promise.all([page.waitForEvent('download'), packs.getByRole('button', { name: `Markdown pack for ${owner}` }).click()]);
  const text = readFileSync(await md.path(), 'utf8');
  expect(text).toContain('| Your answer |');
  // The owner fills in the first row and sends it back.
  const answered = text.replace(/^(\| [BTF]1 \|.*\|)\s+\|$/m, '$1 The AP Team Lead decides. |');
  expect(answered).not.toBe(text);
  await packs.getByLabel(`Read replies for ${owner}`).setInputFiles({ name: 'reply.md', mimeType: 'text/markdown', buffer: Buffer.from(answered) });
  await expect(page.getByTestId('pack-reply-count')).toContainText('1 answered row');
  await expect(page.getByTestId('pack-reply')).toContainText('The AP Team Lead decides.');
});

test('the FRD: requirements derived from the process with IDs; an edit is kept after a reload and a change to the process', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /FRD/ }).click();
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Functional Requirements Document');
  await expect(doc).toContainText(/FR-\d{3} Post invoice in SAP/);
  await expect(doc).toContainText('The solution shall post invoice in SAP in SAP S/4HANA.');
  await expect(doc).toContainText('Traceability matrix');
  await expect(doc).not.toContainText(/TBD|placeholder|lorem/i);
  const panel = page.getByTestId('requirements-panel');
  await panel.getByRole('button', { name: /Requirements register/ }).click();
  const fr = panel.getByTestId('requirement').filter({ hasText: 'Post invoice in SAP' });
  const code = (await fr.locator('span.font-mono').textContent())!;
  await fr.getByRole('button', { name: `Edit ${code}` }).click();
  await panel.getByLabel(`Statement of ${code}`).fill('The solution shall post the invoice in SAP S/4HANA with the PDF attached.');
  await panel.getByLabel(`Priority of ${code}`).selectOption('must');
  await panel.getByRole('button', { name: '+ Add a criterion' }).click();
  await panel.getByLabel(`Given 1 of ${code}`).fill('a checked invoice');
  await panel.getByLabel(`When 1 of ${code}`).fill('it is posted');
  await panel.getByLabel(`Then 1 of ${code}`).fill('SAP returns a document number');
  await panel.getByRole('button', { name: 'Save requirement' }).click();
  await expect(doc).toContainText('The solution shall post the invoice in SAP S/4HANA with the PDF attached.');
  await shot(page, '48-frd');

  // A change to the process does not undo the edit, and the ID stays.
  await stage(page, 'Process');
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await page.getByLabel('New step', { exact: true }).fill('Archive invoice');
  await page.getByLabel('Type of new step').selectOption({ label: 'Person using a system' });
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await page.reload();
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /FRD/ }).click();
  await expect(doc).toContainText(`${code} Post invoice in SAP`);
  await expect(doc).toContainText('The solution shall post the invoice in SAP S/4HANA with the PDF attached.');
  await expect(doc).toContainText('Edited by a person');
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  expect(word.suggestedFilename()).toMatch(/FRD\.docx$/);
});

test('editing a section: the text is kept on rebuild and reload, and when the process changes the person keeps theirs or takes the update', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await doc.getByRole('button', { name: 'Edit section 1.2' }).click();
  const box = doc.getByRole('textbox', { name: 'Text of Objectives of the process' });
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Cut the time from receipt to posting.');
  await doc.getByRole('button', { name: 'Bold' }).click();
  await page.keyboard.type(' Always.');
  await doc.getByRole('button', { name: 'Save section' }).click();
  await expect(doc.getByTestId('edited-text').first()).toContainText('Cut the time from receipt to posting.');
  await expect(doc.getByTestId('edited-text').first().locator('strong')).toHaveText('Always.');
  await expect(doc.getByTestId('chip-edited')).toHaveCount(1);
  // Tables and open items still come from the model.
  await expect(doc.getByTestId('open-item').first()).toBeVisible();
  await page.reload();
  await stage(page, 'Documents');
  await expect(doc.getByTestId('edited-text').first()).toContainText('Cut the time from receipt to posting.');
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()]);
  expect(readFileSync(await md.path(), 'utf8')).toContain('Cut the time from receipt to posting. **Always.**');
  await shot(page, '50-section-edited');

  // The objective is answered: the generated text changes, so the edit needs review.
  await page.getByRole('button', { name: 'Answer them' }).click();
  const assistant = page.getByTestId('gaps-assistant');
  await assistant.getByRole('list', { name: 'Questions' }).getByRole('button', { name: /objective/i }).click();
  await assistant.getByLabel('Answer', { exact: true }).fill('Post supplier invoices correctly within five working days.');
  await assistant.getByRole('button', { name: 'Save answer' }).click();
  await saved(page);
  await assistant.getByRole('button', { name: 'Back to the document' }).click();
  await expect(page.getByTestId('review-banner')).toContainText('1 edited section needs review');
  await expect(doc.getByTestId('chip-review')).toHaveCount(1);
  await expect(doc.getByTestId('review-update')).toContainText('Post supplier invoices correctly within five working days.');
  await expect(doc.getByTestId('edited-text').first()).toContainText('Cut the time from receipt to posting.');
  await shot(page, '51-section-needs-review');
  await doc.getByRole('button', { name: 'Take update' }).click();
  await expect(doc.getByTestId('chip-review')).toHaveCount(0);
  await expect(doc.getByTestId('edited-text')).toHaveCount(0);
  await expect(doc).toContainText('Post supplier invoices correctly within five working days.');
});

test('flows: the maps fit the screen; the flow is edited on the BPMN canvas and saved to the process after review', async ({ page }) => {
  await buildProcess(page);
  await stage(page, 'Flows');
  const map = page.getByTestId('flow-map');
  await expect(map.locator('svg')).toContainText('Post invoice in SAP');
  // Fitted: the map is no wider than its box.
  const [mapW, boxW] = await map.evaluate(el => [el.querySelector('svg')!.getBoundingClientRect().width, el.getBoundingClientRect().width]);
  expect(mapW).toBeLessThanOrEqual(boxW);
  await page.getByRole('tab', { name: 'To-Be map' }).click();
  await expect(map.locator('svg')).toContainText('Rule-based RPA');
  const [bpmn] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download BPMN' }).click()]);
  expect(readFileSync(await bpmn.path(), 'utf8')).toContain('<bpmn:definitions');

  await page.getByRole('tab', { name: 'Edit the flow' }).click();
  const canvas = page.getByTestId('bpmn-canvas');
  await expect(canvas.locator('.djs-element[data-element-id]').first()).toBeVisible();
  await expect(canvas).toContainText('Post invoice in SAP');
  await shot(page, '52-flow-editor');
  // Edit as a person would on the canvas: rename one step, delete another.
  await page.evaluate(() => {
    const m = (window as any).__bpmnModeler;
    const reg = m.get('elementRegistry'), modeling = m.get('modeling');
    const named = (n: string) => reg.filter((e: any) => e.businessObject?.name === n && e.type !== 'label')[0];
    modeling.updateLabel(named('Post invoice in SAP'), 'Post invoice in SAP S/4HANA');
    modeling.removeElements([named('Check invoice totals')]);
  });
  await page.getByRole('button', { name: 'Review changes' }).click();
  const changes = page.getByTestId('flow-changes');
  await expect(changes).toContainText('Rename the step "Post invoice in SAP" to "Post invoice in SAP S/4HANA"');
  await expect(changes).toContainText('Remove the step "Check invoice totals"');
  await expect(changes).toContainText('things to check in the flow');
  await shot(page, '53-flow-changes');
  await changes.getByRole('button', { name: /^Save \d+ changes?$/ }).click();
  await expect(page.getByRole('status')).toContainText('Saved');

  await stage(page, 'Process');
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await expect(page.getByLabel(/^Name of step \d+$/)).toHaveCount(1);
  await expect(page.getByLabel('Name of step 1')).toHaveValue('Post invoice in SAP S/4HANA');
});
