// A workspace per client: the organisation's owner adds workspaces from the top bar; each has its own
// processes and boards, and every page follows the workspace chosen there. Isolation itself is the
// database's (workspace membership).
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('the owner adds a workspace for a client; its processes and boards are its own', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/processes');
  await expect(page.getByRole('link', { name: 'Vendor invoice processing' })).toBeVisible();
  const switcher = page.getByRole('banner').getByRole('button', { name: /^Workspace: / });
  await expect(switcher).toHaveAccessibleName('Workspace: Kaveri Industrial Components · Finance Operations');
  const choose = async (name: RegExp) => {
    await switcher.click();
    await page.getByTestId('workspace-menu').getByRole('button', { name }).click();
    await expect(page.getByTestId('workspace-menu')).toHaveCount(0);
  };

  await switcher.click();
  await page.getByTestId('workspace-menu').getByRole('button', { name: 'New workspace' }).click();
  const form = page.getByTestId('new-workspace');
  await expect(form).toContainText('People see only the workspaces they are invited to');
  await form.getByLabel('New workspace').fill('Client: Northwind');
  await form.getByRole('button', { name: 'Create workspace' }).click();
  await expect(switcher).toHaveAccessibleName('Workspace: Kaveri Industrial Components · Client: Northwind');
  await expect(page.getByText('No processes yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vendor invoice processing' })).toHaveCount(0);

  // The board follows the workspace, and switches with it.
  await page.goto('/board');
  const board = page.getByTestId('board');
  await expect(switcher).toHaveAccessibleName(/Client: Northwind$/);
  await board.getByRole('button', { name: 'New project' }).click();
  await board.getByLabel('New project name').fill('Northwind rollout');
  await board.getByRole('button', { name: 'Create project' }).click();
  await expect(board.getByLabel('Project').locator('option:checked')).toHaveText('Northwind rollout');
  await choose(/Finance Operations/);
  await expect(board.getByText('No projects yet')).toBeVisible();
  await choose(/Client: Northwind/);
  await expect(board.getByLabel('Project').locator('option:checked')).toHaveText('Northwind rollout');

  // A process opened by its address brings the top bar to its workspace; leaving a workspace closes its process.
  await choose(/Finance Operations/);
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Processes' }).click();
  await page.getByRole('link', { name: 'Vendor invoice processing' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);
  await choose(/Client: Northwind/);
  await expect(page).toHaveURL(/\/processes$/);
  await expect(page.getByText('No processes yet')).toBeVisible();
});
