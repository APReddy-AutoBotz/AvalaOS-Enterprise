// Sprints as in Jira's Scrum boards: plan two, start one, put work in it, complete it and see the
// unfinished work move to the next sprint. Rules: domain/workitems/sprints.ts.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('a team plans sprints, runs one and completes it', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/board');
  const board = page.getByTestId('board');
  await board.getByRole('button', { name: 'New project' }).click();
  await board.getByLabel('New project name').fill('Website');
  await board.getByRole('button', { name: 'Create project' }).click();
  for (const title of ['Pay by card', 'Show receipts']) {
    await board.getByRole('button', { name: 'New item' }).click();
    const d = page.getByTestId('new-item');
    await d.getByLabel('Kind').selectOption({ label: 'Story' });
    await d.getByLabel('Title').fill(title);
    await d.getByRole('button', { name: 'Add item' }).click();
    await expect(d).toHaveCount(0);
  }

  // Plan two sprints; names count on by themselves.
  await board.getByRole('button', { name: 'Sprints', exact: true }).click();
  const dialog = page.getByTestId('sprints');
  await dialog.getByRole('button', { name: 'New sprint' }).click();
  await expect(dialog.getByLabel('Sprint name')).toHaveValue('Sprint 1');
  await dialog.getByLabel('Sprint goal').fill('Take card payments');
  await dialog.getByRole('button', { name: 'Add sprint' }).click();
  await dialog.getByRole('button', { name: 'New sprint' }).click();
  await expect(dialog.getByLabel('Sprint name')).toHaveValue('Sprint 2');
  await dialog.getByRole('button', { name: 'Add sprint' }).click();
  await expect(dialog.getByTestId('sprint-row')).toHaveCount(2);
  await dialog.getByTestId('sprint-row').first().getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByTestId('sprint-row').first()).toContainText('Active');
  await expect(dialog.getByTestId('sprint-row').nth(1).getByRole('button', { name: 'Start' })).toBeDisabled();
  const result = await new AxeBuilder({ page }).include('[data-testid="sprints"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Put both stories in Sprint 1 from their panels.
  const panel = page.getByTestId('item-panel');
  for (const title of ['Pay by card', 'Show receipts']) {
    await board.getByRole('button', { name: title }).click();
    await panel.getByLabel('Sprint').selectOption({ label: 'Sprint 1 (active)' });
    if (title === 'Pay by card') await panel.getByLabel('Status').selectOption({ label: 'Done' });
    await panel.getByRole('button', { name: 'Close' }).click();
  }
  await board.getByLabel('Sprint').selectOption({ label: 'Sprint 1 (active)' });
  await expect(board.getByTestId('sprint-bar')).toContainText('Take card payments');
  await expect(board.getByTestId('board-card')).toHaveCount(2);

  // Complete it: the unfinished story moves to Sprint 2, the done one stays.
  await board.getByTestId('sprint-bar').getByRole('button', { name: 'Complete sprint' }).click();
  const complete = page.getByTestId('complete-sprint');
  await expect(complete).toContainText('1 unfinished item will move to Sprint 2. 1 done item stays with Sprint 1.');
  await complete.getByRole('button', { name: 'Complete sprint' }).click();
  await expect(complete).toHaveCount(0);
  await expect(board.getByTestId('sprint-bar')).toContainText('Sprint 2');
  await expect(board.getByTestId('board-card')).toHaveCount(1);
  await expect(board.getByTestId('board-card')).toContainText('Show receipts');

  await page.reload();
  const b2 = page.getByTestId('board');
  await b2.getByLabel('Sprint').selectOption({ label: 'Sprint 1 (completed)' });
  await expect(b2.getByTestId('board-card')).toHaveCount(1);
  await expect(b2.getByTestId('board-card')).toContainText('Pay by card');
  await b2.getByLabel('Sprint').selectOption({ label: 'All work' });
  await b2.getByRole('button', { name: 'Show receipts' }).click();
  await page.getByTestId('item-activity').getByRole('tab', { name: 'History' }).click();
  await expect(page.getByTestId('item-history')).toContainText('changed the sprint from Sprint 1 to Sprint 2');
});
