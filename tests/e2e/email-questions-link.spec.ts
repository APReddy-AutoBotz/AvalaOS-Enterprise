// The weekday email's link for questions (plan (b) of claude/reading-limit-email-link-and-screens-plans-26-nov.md,
// option b1): the two question lines link to /process/<id>/documents?gaps=all, and the page opens Closing the gaps
// where the process answers questions: on Documents, or on the Assessment stage in an organisation on "Assess",
// which has no Documents stage. Once: the marker leaves the address. A plain link to Documents is unchanged.
// My work's "Answer them" follows the same rule (questionsLanding in domain/work/home.ts). The links themselves are
// tested in domain/work/digest.test.ts.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openSettings, signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const rail = (page: Page) => page.getByRole('navigation', { name: 'Stages' });

/** A process holding the sample's hand-checked model as its working draft; returns its address without the stage. */
async function sampleProcess(page: Page): Promise<string> {
  await signInAndCreateProcess(page);
  const processUrl = page.url().replace(/\/sources$/, '');
  await page.goto(`${processUrl}/process`);
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  await page.evaluate(({ gold, KEY }) => {
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, KEY });
  return processUrl;
}

test('on the "Assess" set-up the email\'s link for questions opens Closing the gaps on the Assessment stage', async ({ page }) => {
  test.setTimeout(90_000);
  const processUrl = await sampleProcess(page);
  await openSettings(page, 'Parts of Avala OS');
  const parts = page.getByTestId('organization-parts');
  await parts.getByRole('radio', { name: /^Assess Sources/ }).check();
  await parts.getByRole('button', { name: 'Save' }).click();
  await expect(parts.getByRole('status')).toContainText('Saved');

  await page.goto(`${processUrl}/documents?gaps=all`);
  await expect(page).toHaveURL(/\/assessment$/);
  await expect(rail(page).getByRole('link')).toHaveText([/Sources/, /Process/, /Assessment/]);
  await expect(page.getByTestId('gaps-assistant')).toBeVisible();

  // Without the marker, Documents says it is not switched on, as before.
  await page.goto(`${processUrl}/documents`);
  await expect(page.getByText('Not switched on', { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId('gaps-assistant')).toHaveCount(0);
});

test('on the full journey the email\'s link for questions opens Closing the gaps on Documents, once; My work does the same', async ({ page }) => {
  test.setTimeout(90_000);
  const processUrl = await sampleProcess(page);

  await page.goto(`${processUrl}/documents?gaps=all`);
  await expect(page.getByTestId('gaps-assistant')).toBeVisible();
  await expect(page).toHaveURL(/\/documents$/);
  // The marker left the address: a reload opens Documents alone.
  await page.reload();
  await expect(rail(page).getByRole('link', { name: /Documents/ })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('gaps-assistant')).toHaveCount(0);

  // My work's line for questions leads to the same place.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My work' }).click();
  const needs = page.getByTestId('needs-you');
  await expect(needs).toContainText('only your people can answer');
  await needs.getByRole('button', { name: /only your people can answer/ }).click();
  await expect(page).toHaveURL(/\/documents$/);
  await expect(page.getByTestId('gaps-assistant')).toBeVisible();
});
