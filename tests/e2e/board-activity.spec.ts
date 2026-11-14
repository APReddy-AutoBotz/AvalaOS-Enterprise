// Working together on a board item, as in Jira: labels, comments (edit and delete your own) and the
// history of changes. Rules: domain/workitems/collab.ts and board.ts (labels); database: board_collaboration.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('a person labels an item, discusses it and sees what changed', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/board');
  const board = page.getByTestId('board');
  await board.getByRole('button', { name: 'New project' }).click();
  await board.getByLabel('New project name').fill('Website');
  await board.getByRole('button', { name: 'Create project' }).click();
  await board.getByRole('button', { name: 'New item' }).click();
  const d = page.getByTestId('new-item');
  await d.getByLabel('Kind').selectOption({ label: 'Story' });
  await d.getByLabel('Title').fill('Pay by card');
  await d.getByRole('button', { name: 'Add item' }).click();
  await board.getByRole('button', { name: 'Pay by card' }).click();
  const panel = page.getByTestId('item-panel');

  // Labels: typed with spaces or commas, repeats dropped; shown on the card and used by the filter.
  await panel.getByLabel('Add a label').fill('payments');
  await panel.getByLabel('Add a label').press('Enter');
  await panel.getByLabel('Add a label').fill('Q4,payments');
  await panel.getByLabel('Add a label').press('Enter');
  await expect(panel.getByTestId('label')).toHaveText(['payments', 'Q4']);
  await panel.getByRole('button', { name: 'Remove label Q4' }).click();
  await expect(panel.getByTestId('label')).toHaveText(['payments']);
  await panel.getByLabel('Status').selectOption({ label: 'In progress' });

  // Comments: add, edit (marked edited), delete with confirmation.
  const activity = panel.getByTestId('item-activity');
  await activity.getByLabel('Add a comment').fill('Which cards do we take?');
  await activity.getByRole('button', { name: 'Comment' }).click();
  await expect(activity.getByTestId('comment')).toHaveCount(1);
  await expect(activity.getByTestId('comment')).toContainText('analyst');
  await activity.getByRole('button', { name: 'Edit' }).click();
  await activity.getByLabel('Edit comment').fill('Which cards do we take? Visa and Mastercard?');
  await activity.getByRole('button', { name: 'Save' }).click();
  await expect(activity.getByTestId('comment')).toContainText('Visa and Mastercard?');
  await expect(activity.getByTestId('comment')).toContainText('(edited)');
  await activity.getByLabel('Add a comment').fill('Second thought');
  await activity.getByRole('button', { name: 'Comment' }).click();
  await activity.getByTestId('comment').nth(1).getByRole('button', { name: 'Delete' }).click();
  await activity.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(activity.getByTestId('comment')).toHaveCount(1);

  // History in plain words, newest first.
  await activity.getByRole('tab', { name: 'History' }).click();
  const history = activity.getByTestId('item-history').getByRole('listitem');
  await expect(history.first()).toContainText('analyst changed the status from To do to In progress');
  await expect(history.last()).toContainText('analyst created this item');
  await expect(activity.getByTestId('item-history')).toContainText('set the labels to payments');
  const result = await new AxeBuilder({ page }).include('[data-testid="item-panel"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);

  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(board.getByTestId('board-card')).toContainText('payments');
  await page.reload();
  await expect(page.getByTestId('board').getByTestId('board-card')).toContainText('payments');
  await page.getByTestId('board').getByLabel('Label').selectOption('payments');
  await expect(page.getByTestId('board').getByTestId('board-card')).toHaveCount(1);
  await page.getByTestId('board').getByRole('button', { name: 'Pay by card' }).click();
  await expect(page.getByTestId('item-activity').getByTestId('comment')).toHaveCount(1);
});
