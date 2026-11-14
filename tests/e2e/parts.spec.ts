// Start with the part you need: the platform owner switches an organisation between the full journey,
// Assess only and the board on its own; what is off is hidden and nothing is deleted.
// Rules: domain/workspace/modules.ts; database: organization_modules.
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('the owner switches an organisation\'s parts; hidden parts keep their work', async ({ page }) => {
  await signInAndCreateProcess(page);
  const processUrl = new URL(page.url()).pathname;
  const main = page.getByRole('navigation', { name: 'Main' });
  const choose = async (plan: RegExp) => {
    await main.getByRole('link', { name: /^(Processes|Workspace)$/ }).click();
    await page.getByRole('tab', { name: 'Settings' }).click();
    const parts = page.getByTestId('organization-parts');
    await parts.getByRole('radio', { name: plan }).check();
    await parts.getByRole('button', { name: 'Save' }).click();
    await expect(parts.getByRole('status')).toContainText('Saved');
  };
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Processes' }).click();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await expect(page.getByTestId('organization-parts')).toContainText('uses The full journey');

  // The board on its own: no processes, the page keeps People and Settings, a process says it is off.
  await choose(/The Delivery board on its own/);
  await expect(main.getByRole('link', { name: 'Workspace' })).toBeVisible();
  await expect(main.getByRole('link', { name: 'Delivery board' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['People', 'Settings']);
  await page.goto(processUrl);
  await expect(page.getByTestId('stage-panel')).toContainText('Processes and their assessment are not switched on');
  await page.goto('/work');
  await expect(page.getByText('Nothing assigned to you yet')).toBeVisible();

  // Assess only: three stages, no board.
  await choose(/^Assess Sources/);
  await expect(main.getByRole('link', { name: 'Delivery board' })).toHaveCount(0);
  await page.goto(processUrl);
  await expect(page.getByRole('navigation', { name: 'Stages' }).getByRole('link')).toHaveText([/Sources/, /Process/, /Assessment/]);
  await page.goto('/board');
  await expect(page.getByText('The Delivery board is not switched on')).toBeVisible();

  // Back to the full journey: everything is there, the process too.
  await choose(/The full journey/);
  await page.goto(processUrl);
  await expect(page.getByRole('navigation', { name: 'Stages' }).getByRole('link')).toHaveCount(6);
  await expect(main.getByRole('link', { name: 'Delivery board' })).toBeVisible();
});
