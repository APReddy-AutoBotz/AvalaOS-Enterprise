// Settings → Applications: the workspace's list of applications, kept by people.
// Rules: domain/workspace/applications.ts; database: workspace_applications.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { openSettings, signInAndCreateProcess } from './helpers.ts';

test('an application is added with its ways in, shown in words, kept unique, edited and deleted', async ({ page }) => {
  await signInAndCreateProcess(page);
  await openSettings(page, 'Applications');
  const list = page.getByTestId('applications-list');
  await expect(list).toContainText('No applications yet.');

  await list.getByRole('button', { name: 'Add an application' }).click();
  const form = list.getByRole('form', { name: 'New application' });
  await form.getByRole('textbox', { name: 'Name', exact: true }).fill('SAP S/4HANA');
  await form.getByLabel('Kind').selectOption({ label: 'ERP' });
  await form.getByLabel('Other names it goes by').fill('SAP, S4');
  await form.getByRole('button', { name: 'Add a way in' }).click();
  await form.getByLabel('Way in 1: interface name').fill('API_SUPPLIERINVOICE_PROCESS_SRV');
  await form.getByLabel('Way in 1: operations').fill('post invoice');
  await form.getByRole('button', { name: 'Add a way in' }).click();
  await form.getByLabel('Way in 2: how').selectOption({ label: 'Screens' });
  await form.getByLabel('Way in 2: available').selectOption({ label: 'Not available' });
  await form.getByLabel('Robots may use its screens').selectOption({ label: 'No, not allowed' });
  const axe = await new AxeBuilder({ page }).include('[data-testid="applications-list"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await form.getByRole('button', { name: 'Add application' }).click();

  const row = list.getByTestId('application-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('SAP S/4HANA · ERP');
  await expect(row).toContainText('Also called SAP, S4');
  await expect(row).toContainText('API API_SUPPLIERINVOICE_PROCESS_SRV: confirmed available; Screens: not available; robots may not use its screens');

  // Another name already on the list is refused, in words.
  await list.getByRole('button', { name: 'Add an application' }).click();
  await list.getByRole('form', { name: 'New application' }).getByRole('textbox', { name: 'Name', exact: true }).fill('s4');
  await list.getByRole('button', { name: 'Add application' }).click();
  await expect(list.getByRole('alert')).toContainText('"S4" is already on the list as another name of SAP S/4HANA');
  await list.getByRole('button', { name: 'Cancel' }).click();

  // Edit, then reload: kept.
  await list.getByRole('button', { name: 'Edit SAP S/4HANA' }).click();
  await list.getByRole('form', { name: 'Edit SAP S/4HANA' }).getByLabel('Reached through a remote desktop').selectOption({ label: 'No' });
  await list.getByRole('button', { name: 'Save changes' }).click();
  await expect(row).toContainText('not through a remote desktop');
  await page.reload();
  await expect(page.getByTestId('application-row')).toContainText('not through a remote desktop');

  // Delete asks first.
  await page.getByTestId('applications-list').getByRole('button', { name: 'Delete SAP S/4HANA' }).click();
  await page.getByTestId('applications-list').getByRole('button', { name: 'Delete SAP S/4HANA' }).click();
  await expect(page.getByTestId('application-row')).toHaveCount(0);
});

test('a process adds its application to the list, and later takes the list\'s facts when a person accepts them', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Process' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  const sapRow = page.getByTestId('system-row').filter({ has: page.getByLabel('Name of system SAP S/4HANA', { exact: true }) });

  // Not on the list yet: add it from what the process states or a person confirmed.
  await sapRow.getByRole('button', { name: 'Add to the applications list' }).click();
  await expect(sapRow.getByTestId('add-to-list')).toContainText('Adds SAP S/4HANA to the workspace\'s list with: ');
  await sapRow.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sapRow.getByTestId('on-list')).toHaveText('On the applications list');

  // The list learns something new: SAP is reached through a remote desktop.
  await openSettings(page, 'Applications');
  const list = page.getByTestId('applications-list');
  await list.getByRole('button', { name: 'Edit SAP S/4HANA' }).click();
  await list.getByLabel('Reached through a remote desktop').selectOption({ label: 'Yes (Citrix or similar)' });
  await list.getByRole('button', { name: 'Save changes' }).click();
  await expect(list.getByTestId('application-row')).toContainText('reached through a remote desktop');

  // Back on the process (the demo keeps changes only until a reload, so by the links): the fact is
  // offered, with what it changes, and taken only on Accept.
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Processes' }).click();
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name: 'Process' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  const offer = sapRow.getByTestId('list-offer');
  await expect(offer).toHaveText('On the applications list: 1 fact to bring in');
  await offer.click();
  await expect(page.getByRole('heading', { name: 'From the applications list: SAP S/4HANA' })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Reached through a remote desktop' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept it' }).click();
  await expect(sapRow.getByTestId('on-list')).toHaveText('On the applications list');
  await expect(page.getByTestId('change-impact')).toContainText('Took the applications list\'s facts for SAP S/4HANA.');
});
