import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { shot, signInAndCreateProcess } from './helpers.ts';

// Part I of docs/effort-first-plan.md: a typical process to start from, always labelled Typical until confirmed.
const stage = (page: import('@playwright/test').Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

test('a typical process: picked by a person from a list, shown before it is added, confirmed item by item, and labelled Typical everywhere until then', async ({ page }) => {
  await signInAndCreateProcess(page); // "Vendor invoice processing"
  const start = page.getByTestId('typical-start');
  // Avala OS never says which typical process fits, whatever the process is called: the person picks.
  await expect(start).not.toContainText('This looks like');
  await expect(start).not.toContainText(/supplier invoice|accounts payable/i);
  await expect(start).toContainText('It brings no volumes, times, costs or application facts.');
  await start.getByRole('button', { name: 'See the typical processes' }).click();
  await expect(start.getByTestId('typical-preview')).toHaveCount(0);
  await expect(start.getByRole('button', { name: /^Start from the typical/ })).toHaveCount(0);
  await start.getByLabel('Which typical process').selectOption({ label: 'Supplier invoice processing (accounts payable)' });
  // What they would start from is shown first: the steps, and the rules and exceptions behind a click.
  const preview = start.getByTestId('typical-preview');
  await expect(preview).toContainText('21 steps, 9 rules and 11 exceptions');
  await expect(preview.getByRole('listitem').filter({ hasText: 'Three-way match' })).toBeVisible();
  await start.getByLabel('Your ERP').fill('SAP S/4HANA');
  await shot(page, '70-typical-start');
  await start.getByRole('button', { name: 'Start from the typical supplier invoice process' }).click();

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
  // Taking out the scan step took out what only it needed: the scanner and "Paper invoice?" (2 more items).
  await expect(panel.getByTestId('typical-count')).toHaveText(`${total - 5} typical items to confirm`);
  await expect(page.getByTestId('typical-unconfirmed')).toContainText(`${total - 5} typical items not confirmed`);
  await shot(page, '71-typical-confirm');
  // Approving what nobody has confirmed is asked about first; saying no leaves the draft as it is.
  let asked = '';
  page.once('dialog', d => { asked = d.message(); void d.dismiss(); });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  expect(asked).toContain(`${total - 5} typical items have not been confirmed by your people`);
  await expect(page.getByTestId('revision-status')).not.toContainText('Approved');

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
  // The document says at its top that typical items remain.
  await expect(doc.getByTestId('typical-notice')).toContainText(`${total - 5} items come from a typical process and are not confirmed`);
  await shot(page, '72-typical-pdd');
});

test('with a process of your own, a comparison with a typical process appears only when asked for, with the one you pick', async ({ page }) => {
  await signInAndCreateProcess(page); // "Vendor invoice processing": the name decides nothing
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByLabel('New step', { exact: true }).fill('Post invoice in the ERP');
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  // Nothing is compared on its own.
  await expect(page.getByTestId('typical-checklist')).toHaveCount(0);
  await expect(page.getByTestId('typical-panel')).toHaveCount(0);
  await page.getByTestId('typical-compare-offer').getByRole('button', { name: 'Compare with a typical process' }).click();
  const list = page.getByTestId('typical-checklist');
  await expect(list).toContainText('Pick the one closest to this process');
  await expect(list.getByRole('button', { name: 'Add as typical' })).toHaveCount(0);
  await list.getByLabel('Compare with a typical process').selectOption({ label: 'Supplier invoice processing (accounts payable)' });
  await expect(list).toContainText('of a typical supplier invoice process are not in your sources');
  await list.getByRole('listitem').filter({ hasText: 'Three-way match' }).getByRole('button', { name: 'Add as typical' }).click();
  await expect(page.getByTestId('typical-count')).toHaveText('1 typical item to confirm');
  await list.getByRole('button', { name: 'Stop comparing' }).click();
  await expect(page.getByTestId('typical-checklist')).toHaveCount(0);
});
