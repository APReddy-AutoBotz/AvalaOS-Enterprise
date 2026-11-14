// Start with the part you need: the platform owner switches an organisation between the full journey,
// Assess only and the board on its own; what is off is hidden and nothing is deleted.
// Rules: domain/workspace/modules.ts; database: organization_modules.
import { test, expect } from '@playwright/test';
import { openSettings, signInAndCreateProcess } from './helpers.ts';

test('the owner switches an organisation\'s parts; hidden parts keep their work', async ({ page }) => {
  await signInAndCreateProcess(page);
  const processUrl = new URL(page.url()).pathname;
  const main = page.getByRole('navigation', { name: 'Main' });
  const choose = async (plan: RegExp) => {
    await openSettings(page, 'Parts of Avala OS');
    const parts = page.getByTestId('organization-parts');
    await parts.getByRole('radio', { name: plan }).check();
    await parts.getByRole('button', { name: 'Save' }).click();
    await expect(parts.getByRole('status')).toContainText('Saved');
  };
  await openSettings(page, 'Parts of Avala OS');
  await expect(page.getByTestId('organization-parts')).toContainText('uses The full journey');
  const sections = page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link');
  await expect(sections).toHaveText(['People', 'Applications', 'Assessment', 'AI', 'Documents', 'Parts of Avala OS']);

  // The board on its own: no Processes in the menu, Settings keeps People and the parts, a process says it is off.
  await choose(/The Delivery board on its own/);
  await expect(main.getByRole('link')).toHaveText(['My work', 'Delivery board']);
  await expect(sections).toHaveText(['People', 'Parts of Avala OS']);
  await page.goto('/processes');
  await expect(page.getByText('Processes and their assessment are not switched on')).toBeVisible();
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
