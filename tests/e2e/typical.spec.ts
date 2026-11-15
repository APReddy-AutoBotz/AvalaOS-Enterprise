import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { shot, signInAndCreateProcess } from './helpers.ts';

// Part I of docs/effort-first-plan.md: a typical process to start from, always labelled Typical until confirmed.
const stage = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

test('a typical process: offered by name, mapped to your applications, confirmed item by item, and labelled Typical everywhere until then', async ({ page }) => {
  await signInAndCreateProcess(page); // "Vendor invoice processing"
  const start = page.getByTestId('typical-start');
  await expect(start).toContainText('This looks like accounts payable invoice processing');
  await expect(start).toContainText('It brings no volumes, times, costs or application facts.');
  await start.getByRole('button', { name: 'Start from a typical process' }).click();
  await start.getByLabel('Your ERP').fill('SAP S/4HANA');
  await shot(page, '70-typical-start');
  await start.getByRole('button', { name: 'Start from the typical accounts payable invoice processing' }).click();

  // The Process stage: the confirm pass, one item at a time.
  const panel = page.getByTestId('typical-panel');
  await expect(panel.getByTestId('typical-count')).toHaveText(/^\d+ typical items to confirm$/);
  const total = Number((await panel.getByTestId('typical-count').textContent())!.match(/^\d+/)![0]);
  const item = panel.getByTestId('typical-item');
  await expect(item.getByTestId('typical-name')).toHaveText('Scan paper invoice');
  const axe = await new AxeBuilder({ page }).include('[data-testid="typical-panel"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await item.getByRole('button', { name: "We don't" }).click();
  await expect(item.getByTestId('typical-name')).toHaveText('Log invoice');
  await item.getByRole('button', { name: 'We do this' }).click();
  await expect(item.getByTestId('typical-name')).toHaveText('Check mandatory fields');
  await item.getByRole('button', { name: 'Ours is different' }).click();
  await item.getByLabel('How you call it').fill('Check the invoice fields');
  await item.getByRole('button', { name: 'Save ours' }).click();
  await expect(panel.getByTestId('typical-count')).toHaveText(`${total - 3} typical items to confirm`);
  await expect(page.getByTestId('typical-unconfirmed')).toContainText(`${total - 3} typical items not confirmed`);
  await shot(page, '71-typical-confirm');

  // Downstream: the assessment is provisional; documents say Typical, not confirmed.
  await stage(page, 'Assessment');
  await expect(page.getByTestId('provisional')).toContainText('Provisional:');
  // Effort so far (part H): counted from the history; the draft came from the typical process.
  const effort = page.getByTestId('effort-card');
  await expect(effort.getByTestId('effort-start')).toContainText('From a typical process');
  await expect(effort.getByTestId('effort-draft')).toContainText(/under a minute|\d+ minutes?/);
  await expect(effort.getByTestId('effort-people')).toContainText('0');
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /PDD/ }).click();
  const doc = page.getByTestId('document');
  await expect(doc).toContainText('Check the invoice fields');
  await expect(doc.getByText('Typical, not confirmed').first()).toBeVisible();
  await expect(doc).not.toContainText('Scan paper invoice');
  await shot(page, '72-typical-pdd');
});
