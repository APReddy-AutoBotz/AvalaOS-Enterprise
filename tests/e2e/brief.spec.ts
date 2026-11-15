import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { shot, signInAndCreateProcess } from './helpers.ts';

// Parts A and B of docs/effort-first-plan.md: the brief, a start with no documents, and the delivery plan by rule.
const stage = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

test('no documents: the short form and "in your own words" start the process; the brief and the delivery plan follow from them', async ({ page }) => {
  await signInAndCreateProcess(page);
  const start = page.getByTestId('own-words');
  await expect(start).toContainText('No documents? Tell us in your own words');
  await start.getByLabel('Is the work done today?').selectOption({ label: 'Not done today' });
  await start.getByLabel('Applications it touches').fill('SAP S/4HANA, Coupa, sap s/4hana');
  await start.getByLabel('An AI agent').check();
  const save = start.getByRole('button', { name: 'Save as the first source' });
  await expect(save).toBeDisabled();
  await start.getByLabel('In your own words').fill('Supplier onboarding is to be built from scratch. A buyer sends a form to the supplier, the agent checks the bank details against the register and asks procurement when something does not match.');
  await save.click();
  await expect(page.getByTestId('source-row')).toHaveCount(1);
  await expect(page.getByTestId('source-row')).toContainText('Described in own words');
  await shot(page, '60-own-words');

  await stage(page, 'Process');
  const brief = page.getByTestId('brief');
  await expect(brief.getByTestId('brief-doneToday')).toContainText('Not done today');
  await expect(brief.getByTestId('brief-doneToday')).toContainText('Confirmed');
  await expect(brief.getByTestId('brief-inMind')).toContainText('An AI agent');
  await expect(brief.getByTestId('brief-applications')).toContainText('SAP S/4HANA and Coupa');
  await expect(brief.getByTestId('brief-kind')).toContainText('Not filled in yet.');
  // Nothing the person did not say is filled in, and nothing claims the sources were read.
  await expect(brief.getByTestId('brief-summary')).toContainText('Not filled in yet.');
  await expect(brief).not.toContainText('Not stated in the sources.');
  const axe = await new AxeBuilder({ page }).include('[data-testid="brief"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);

  // A person adds a line.
  await brief.getByTestId('brief-kind').getByRole('button', { name: 'Add' }).click();
  await brief.getByLabel('What kind of thing').selectOption({ label: 'An agent to be built' });
  await brief.getByRole('button', { name: 'Save' }).click();
  await expect(brief.getByTestId('brief-kind')).toContainText('An agent to be built');
  await shot(page, '61-brief');

  // The delivery plan by rule: an agent to be built gets the process, agent and design documents; the expectation is kept, not used.
  await stage(page, 'Assessment');
  const plan = page.getByTestId('delivery-plan');
  await expect(plan.getByTestId('delivery-why')).toContainText('An agent is to be built (confirmed by a person)');
  await expect(plan.getByTestId('planned-doc')).toHaveText([/Process definition \(PDD\)/, /Agent definition document.*Comes with the agent document work/, /Solution design \(SDD\)/]);
  await expect(plan.getByTestId('offered-docs')).toContainText('Business requirements (BRD), Functional requirements (FRD)');
  await expect(plan.getByTestId('delivery-expectation')).toContainText('An AI agent was expected; there are no steps to compare it with yet.');
  await shot(page, '62-delivery-plan');
});

test('the approved Sources wording: no internal "model" words where a person reads them', async ({ page }) => {
  await signInAndCreateProcess(page);
  await expect(page.getByTestId('own-words')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Extract the process model');
  await expect(page.locator('main')).not.toContainText('Use this model');
});

test('work not done today: the intended process in words, one map, and no hours saved; the tool being built is not an application the process uses', async ({ page }) => {
  await signInAndCreateProcess(page);
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  for (const name of ['SAP S/4HANA', 'Supplier portal']) {
    await page.getByLabel('New system', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add system' }).click();
    await expect(page.getByLabel(`Name of system ${name}`)).toBeVisible();
  }
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await page.getByLabel('New step', { exact: true }).fill('Check the bank details');
  await page.getByLabel('Type of new step').selectOption({ label: 'Automatic check' });
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByLabel(/^Name of step \d+$/).last()).toHaveValue('Check the bank details');

  // The brief: not done today, a tool to be built, and which application that is.
  const brief = page.getByTestId('brief');
  await brief.getByTestId('brief-doneToday').getByRole('button', { name: 'Add' }).click();
  await brief.getByLabel('Done today?').selectOption({ label: 'Not done today' });
  await brief.getByRole('button', { name: 'Save' }).click();
  await brief.getByTestId('brief-kind').getByRole('button', { name: 'Add' }).click();
  await brief.getByLabel('What kind of thing').selectOption({ label: 'A tool to be built' });
  await brief.getByRole('button', { name: 'Save' }).click();
  await brief.getByTestId('brief-building').getByRole('button', { name: 'Add' }).click();
  await brief.getByLabel('What is being built').selectOption({ label: 'Supplier portal' });
  await brief.getByRole('button', { name: 'Save' }).click();
  await expect(brief.getByTestId('brief-building')).toContainText('Supplier portal');
  await expect(brief.getByTestId('brief-applications')).toContainText('SAP S/4HANA');
  await expect(brief.getByTestId('brief-applications')).not.toContainText('Supplier portal');

  await stage(page, 'Assessment');
  await expect(page.getByTestId('value')).toContainText('Nothing of this work is done today, so there are no hours to save');
  await expect(page.getByTestId('delivery-why')).toContainText('The work is not done today (confirmed by a person)');
  await shot(page, '63-intended-assessment');

  await stage(page, 'Flows');
  const tabs = page.getByRole('tablist', { name: 'Flow view' });
  await expect(tabs.getByRole('tab')).toHaveText(['Intended process', 'Edit the intended flow']);
  await expect(page.getByTestId('flow-map')).toContainText('nothing of it is done today');

  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /PDD/ }).click();
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Intended process');
  await expect(doc).toContainText('Supplier portal is what is being built, so it is not listed');
  await expect(doc).not.toContainText('As-Is');
  await shot(page, '64-intended-pdd');
});
