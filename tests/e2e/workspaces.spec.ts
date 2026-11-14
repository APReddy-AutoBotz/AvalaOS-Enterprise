// A workspace per client: the organisation's owner adds workspaces; each has its own processes and
// boards, and the board can switch between them. Isolation itself is the database's (workspace membership).
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('the owner adds a workspace for a client; its processes and boards are its own', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/processes');
  await expect(page.getByRole('link', { name: 'Vendor invoice processing' })).toBeVisible();
  await page.getByRole('button', { name: 'New workspace' }).click();
  const form = page.getByTestId('new-workspace');
  await expect(form).toContainText('People see only the workspaces they are invited to');
  await form.getByLabel('New workspace').fill('Client: Northwind');
  await form.getByRole('button', { name: 'Create workspace' }).click();
  const picker = page.getByLabel('Workspace');
  await expect(picker.locator('option:checked')).toHaveText(/Client: Northwind$/);
  await expect(page.getByText('No processes yet')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vendor invoice processing' })).toHaveCount(0);

  // The board follows the workspace, and switches between them.
  await page.goto('/board');
  const board = page.getByTestId('board');
  await expect(board.getByLabel('Workspace').locator('option:checked')).toHaveText(/Client: Northwind$/);
  await board.getByRole('button', { name: 'New project' }).click();
  await board.getByLabel('New project name').fill('Northwind rollout');
  await board.getByRole('button', { name: 'Create project' }).click();
  await expect(board.getByLabel('Project').locator('option:checked')).toHaveText('Northwind rollout');
  await board.getByLabel('Workspace').selectOption({ label: 'Kaveri Industrial Components · Finance Operations' });
  await expect(board.getByText('No projects yet')).toBeVisible();
  await board.getByLabel('Workspace').selectOption({ label: 'Kaveri Industrial Components · Client: Northwind' });
  await expect(board.getByLabel('Project').locator('option:checked')).toHaveText('Northwind rollout');
});
