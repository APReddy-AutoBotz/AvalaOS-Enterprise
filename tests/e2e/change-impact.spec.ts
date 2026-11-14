// Change impact on the demo's sample case: a delete says what it would change before it is
// confirmed, and an inline edit says what it changed once saved, with the details one click away.
// What counts as changed is tested in domain/docs/impact.test.ts.
import { test, expect } from '@playwright/test';

test('a delete shows what it would change; an edit shows what it changed', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Process' }).click();
  await expect(page.getByRole('tab', { name: /^Steps/ })).toBeVisible();

  // Before a delete: the effect downstream, then Keep leaves the step.
  const first = page.getByTestId('step-row').first();
  const name = await first.getByLabel('Name of step 1', { exact: true }).inputValue();
  await first.getByRole('button', { name: `Delete step "${name}"` }).click();
  await expect(first.getByTestId('delete-impact')).toContainText(/^Affects .*PDD \(\d+ sections?\)/);
  await first.getByRole('button', { name: 'Keep' }).click();
  await expect(page.getByLabel('Name of step 1', { exact: true })).toHaveValue(name);

  // After an edit: one line with what it changed, and the details in a panel.
  await page.getByLabel('Name of step 1', { exact: true }).fill(`${name} and file it`);
  await page.getByLabel('Name of step 1', { exact: true }).press('Enter');
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  const note = page.getByTestId('change-impact');
  await expect(note).toContainText(`Changed the name of "${name}".`);
  await expect(note).toContainText(/Affects .*PDD/);
  await note.getByRole('button', { name: 'See what changes' }).click();
  await expect(page.getByRole('heading', { name: 'What this change affects' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Documents' })).toContainText('PDD: ');
  await page.keyboard.press('Escape');
  await note.getByRole('button', { name: 'Dismiss' }).click();
  await expect(note).toHaveCount(0);
});
