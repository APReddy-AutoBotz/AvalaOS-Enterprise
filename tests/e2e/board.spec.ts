// The board on its own, as in Jira: a person starts a project, adds epics, stories, bugs and sub-tasks,
// moves an item under another, and deletes one. Rules: domain/workitems/board.ts (manage.test.ts).
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('a person runs a board without a process: add, move under an epic, and delete', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/board');
  const board = page.getByTestId('board');
  await expect(board.getByText('No projects yet')).toBeVisible();
  await board.getByRole('button', { name: 'New project' }).click();
  await board.getByLabel('New project name').fill('Website');
  await board.getByRole('button', { name: 'Create project' }).click();
  await expect(board.getByText('Nothing on this board yet')).toBeVisible();

  const add = async (kind: string, title: string, more: (d: ReturnType<typeof page.getByTestId>) => Promise<void> = async () => {}) => {
    await board.getByRole('button', { name: 'New item' }).click();
    const d = page.getByTestId('new-item');
    await d.getByLabel('Kind').selectOption({ label: kind });
    await d.getByLabel('Title').fill(title);
    await more(d);
    await d.getByRole('button', { name: 'Add item' }).click();
    await expect(d).toHaveCount(0);
  };

  await add('Epic', 'Checkout');
  await add('Story', 'Pay by card', async d => { await d.getByLabel('Parent').selectOption({ label: 'Epic: Checkout' }); await d.getByLabel('Priority').selectOption({ label: 'High' }); });
  await add('Bug', 'Total shows twice');

  // A sub-task must belong to something.
  await board.getByRole('button', { name: 'New item' }).click();
  const d = page.getByTestId('new-item');
  await d.getByLabel('Kind').selectOption({ label: 'Sub-task' });
  await d.getByLabel('Title').fill('Card form');
  await d.getByRole('button', { name: 'Add item' }).click();
  await expect(d.getByRole('alert')).toContainText('Choose the story, task or bug this sub-task belongs to');
  const result = await new AxeBuilder({ page }).include('[data-testid="new-item"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await d.getByLabel('Belongs to').selectOption({ label: 'Story: Pay by card' });
  await d.getByRole('button', { name: 'Add item' }).click();
  await expect(d).toHaveCount(0);

  // The epic heads a lane with its story and sub-task; the bug has no epic. New items start in To do.
  const lane = board.getByRole('region', { name: 'Checkout' });
  await expect(lane.getByTestId('column-todo').getByTestId('board-card')).toHaveCount(2);
  await expect(lane.getByText('High')).toBeVisible();
  const loose = board.getByRole('region', { name: 'Work without an epic' });
  await expect(loose.getByTestId('board-card')).toHaveCount(1);

  // Move the bug under the epic from its panel.
  await loose.getByRole('button', { name: 'Total shows twice' }).click();
  const panel = page.getByTestId('item-panel');
  await panel.getByLabel('Parent').selectOption({ label: 'Epic: Checkout' });
  await expect(lane.getByTestId('board-card')).toHaveCount(3);
  await panel.getByRole('button', { name: 'Close' }).click();

  // Delete the epic: the work directly under it stays, without a parent.
  await lane.getByTestId('epic-open').click();
  await panel.getByRole('button', { name: 'Delete this item' }).click();
  await expect(panel.getByRole('alertdialog')).toContainText('Delete this epic? This cannot be undone. The 2 items directly under it stay on the board without a parent.');
  await panel.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(board.getByRole('region', { name: 'Checkout' })).toHaveCount(0);
  await expect(board.getByRole('region', { name: 'Work without an epic' }).getByTestId('board-card')).toHaveCount(3);

  await page.reload();
  await expect(page.getByTestId('board').getByTestId('board-card')).toHaveCount(3);
});
