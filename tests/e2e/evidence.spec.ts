// The evidence pack (package 6 of docs/next-plan.md) on the demo's sample case: one click away on Documents,
// never a planned document, read-only, every functional requirement followed to its work and tests, and a
// Word download. What each section holds is tested in domain/docs/evidence.test.ts.
import { test, expect } from '@playwright/test';

test('the evidence pack opens on the sample, lists its 25 functional requirements, and downloads as Word', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Documents' }).click();
  const tab = page.getByRole('tab', { name: /Evidence pack/ });
  await expect(tab).toBeVisible();
  // Never one of the planned documents.
  await expect(tab).toHaveAttribute('data-planned', 'no');
  await tab.click();
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Evidence pack');
  await expect(doc.getByRole('heading', { name: /What this pack covers/ })).toBeVisible();
  await expect(doc.getByRole('heading', { name: /What is not evidenced/ })).toBeVisible();
  // Section 4: one row per functional requirement of the sample.
  const chain = doc.locator('[data-testid="doc-table"][data-caption="Requirement to work to test"] tbody tr');
  await expect(chain).toHaveCount(25);
  await expect(chain.first()).toContainText(/^FR-\d{3}/);
  // Read-only: no Edit and no Comment in the pack.
  await expect(doc.getByRole('button', { name: /^Edit section/ })).toHaveCount(0);
  await expect(doc.getByRole('button', { name: /Comment/ })).toHaveCount(0);
  // Nothing in the pack shows an email address.
  expect(await doc.innerText()).not.toMatch(/@/);
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  expect(word.suggestedFilename()).toMatch(/Evidence pack\.docx$/);
});
