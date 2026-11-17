// What a person wants from a process (docs/next-plan.md, package 8), on the sample case: a process added
// as "Document it as it is" has no Assessment page and no Work items, shows one map, offers the process
// document and the evidence pack only, and its process document downloads as Word; switched to "Assess it
// and document it" in The brief, everything is back. The rule itself is tested in domain/plan/purpose.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers.ts';

const rail = (page: Page) => page.getByRole('navigation', { name: 'Stages' });
const stage = (page: Page, name: string) => rail(page).getByRole('link', { name }).click();
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));

test('documented as it is: no assessment, one map, two documents; switched back, everything returns', async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto('/processes');
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Organization').fill('Kaveri Industrial Components');
  await page.getByLabel('First workspace').fill('Finance Operations');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Processes', exact: true })).toBeVisible();

  // The question is asked when the process is added; "Assess it and document it" is chosen to begin with.
  await page.getByLabel('Process name').fill('Vendor invoice processing');
  const asked = page.getByTestId('new-purpose');
  await expect(asked.getByLabel(/Assess it and document it/)).toBeChecked();
  await asked.getByLabel(/Document it as it is/).check();
  await shot(page, '70-new-process-purpose');
  await page.getByRole('button', { name: 'Add process' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);
  const processUrl = page.url().replace(/\/sources$/, '');

  // The label beside the name says why, on every page of the process.
  await expect(page.getByTestId('purpose-tag')).toHaveText('Documented as it is');
  // No Assessment and no Work items, from the start.
  await expect(rail(page).getByRole('link')).toHaveText(['Sources', 'Process', 'Documents', 'Flows'].map(s => new RegExp(s)));
  // The start with no documents does not ask what the team has in mind.
  await expect(page.getByTestId('own-words')).toBeVisible();
  await expect(page.getByTestId('own-words')).not.toContainText('What do you have in mind?');

  // The sample's hand-checked model stands in for an extraction; the answer given stays on it.
  await page.evaluate(gold => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    const draft = state.revisions.find((r: { state: string }) => r.state === 'working');
    draft.model = { ...gold, meta: { ...gold.meta, purpose: draft.model.meta.purpose } };
    localStorage.setItem(KEY, JSON.stringify(state));
  }, gold);
  await page.reload();
  await expect(rail(page).getByRole('link')).toHaveCount(4);

  // The brief says what was answered, by whom and when, and leaves out what the team has in mind.
  await stage(page, 'Process');
  const purpose = page.getByTestId('brief-purpose');
  await expect(purpose.getByTestId('purpose-value')).toHaveText('Document it as it is');
  await expect(purpose).toContainText('Answered by');
  await expect(page.getByTestId('brief-inMind')).toHaveCount(0);
  await shot(page, '71-brief-purpose');

  // A link to the Assessment page says why it is not there, and where to change that.
  await page.goto(`${processUrl}/assessment`);
  await expect(page.getByTestId('purpose-off')).toContainText('documented as it is');
  await expect(page.getByTestId('purpose-off')).toContainText('The brief');

  // One map, never a To-Be map.
  await stage(page, 'Flows');
  await expect(page.getByRole('tab', { name: 'As-Is map' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'To-Be map' })).toHaveCount(0);
  await expect(page.getByTestId('flow-map').locator('svg')).not.toContainText('Rule-based RPA');

  // Documents: the process document and the evidence pack, and a line on why.
  await stage(page, 'Documents');
  const tabs = page.getByRole('tablist', { name: 'Documents' }).getByRole('tab');
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(0)).toContainText('PDD');
  await expect(tabs.nth(1)).toContainText('Evidence pack');
  await expect(page.getByTestId('documents-note')).toContainText('the process document and the evidence pack');
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Business exception handling');
  for (const word of ['To-Be', 'Delivery model', 'In scope for automation', 'Minimum prerequisites for automation']) await expect(doc).not.toContainText(word);
  await shot(page, '72-pdd-as-is');
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  expect(word.suggestedFilename()).toMatch(/PDD\.docx$/);
  expect(fs.statSync(await word.path()).size).toBeGreaterThan(10_000);
  await tabs.nth(1).click();
  await expect(doc).toContainText('The process and where each part came from');
  await expect(doc).not.toContainText('Requirement to work to test');

  // Switched to "Assess it and document it": everything is back. Switching from "Document it as it is"
  // leaves the stored requirements exactly as they are.
  const stored = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('avala.journey.memory.v1')!).requirements ?? {}));
  const before = await stored();
  await stage(page, 'Process');
  await purpose.getByRole('button', { name: 'Change' }).click();
  await purpose.getByLabel(/Assess it and document it/).check();
  await purpose.getByRole('button', { name: 'Save' }).click();
  await expect(purpose.getByTestId('purpose-value')).toHaveText('Assess it and document it');
  await expect(page.getByTestId('purpose-tag')).toHaveCount(0);
  expect(await stored()).toBe(before);
  await expect(rail(page).getByRole('link')).toHaveText(['Sources', 'Process', 'Assessment', 'Documents', 'Flows', 'Work items'].map(s => new RegExp(s)));
  await expect(page.getByTestId('brief-inMind')).toHaveCount(1);
  await stage(page, 'Flows');
  await expect(page.getByRole('tab', { name: 'To-Be map' })).toBeVisible();
  await stage(page, 'Documents');
  await expect(tabs.filter({ hasText: 'BRD' })).toHaveCount(1);
  await expect(page.getByTestId('documents-note')).toHaveCount(0);
  await tabs.filter({ hasText: 'PDD' }).click();
  await expect(doc).toContainText('To-Be process');
  await stage(page, 'Assessment');
  await expect(page.getByTestId('purpose-off')).toHaveCount(0);
});
