// Import from Jira: Jira's CSV export becomes items on this board, with a preview of what comes over
// and what does not. Rules: domain/workitems/jiraImport.ts.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const csv = [
  'Summary,Issue key,Issue id,Issue Type,Status,Priority,Assignee,Description,Parent,Labels,Sprint',
  'Checkout,WEB-1,10001,Epic,In Progress,,,,,,',
  'Pay by card,WEB-2,10002,Story,In Progress,High,analyst,"As a shopper, I want to pay by card",10001,payments,Sprint 3',
  'Card form,WEB-3,10003,Sub-task,To Do,,,,10002,,',
  'Total shows twice,WEB-4,10004,Bug,Waiting for vendor,,Chandra,,,,',
].join('\r\n');

test('a team brings its Jira board over from a CSV export', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/board');
  const board = page.getByTestId('board');
  await board.getByRole('button', { name: 'New project' }).click();
  await board.getByLabel('New project name').fill('Website');
  await board.getByRole('button', { name: 'Create project' }).click();
  await board.getByRole('button', { name: 'Import from Jira' }).click();
  const dialog = page.getByTestId('jira-import');
  await dialog.getByLabel('Jira CSV file').setInputFiles({ name: 'jira.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  const preview = dialog.getByTestId('import-preview');
  await expect(preview).toContainText('jira.csv: 4 items (1 epic, 1 story, 1 sub-task, 1 bug)');
  await expect(dialog.getByTestId('import-notes')).toContainText('Status "Waiting for vendor" came in as To do.');
  await expect(dialog.getByTestId('import-notes')).toContainText('"Chandra" is not a member of this workspace');
  await expect(dialog.getByTestId('import-notes')).toContainText('Sprints were not brought over');
  const result = await new AxeBuilder({ page }).include('[data-testid="jira-import"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await dialog.getByRole('button', { name: 'Import 4 items' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(board.getByRole('status')).toContainText('4 items imported from Jira into Website.');

  // The epic heads a lane with its story and sub-task; the bug has none.
  const lane = board.getByRole('region', { name: 'Checkout' });
  await expect(lane.getByTestId('board-card')).toHaveCount(2);
  await expect(lane.getByTestId('column-in_progress').getByTestId('board-card')).toContainText('Pay by card');
  await expect(board.getByRole('region', { name: 'Work without an epic' }).getByTestId('board-card')).toHaveCount(1);
  await page.reload();
  await page.getByTestId('board').getByRole('button', { name: 'Card form' }).click();
  const panel = page.getByTestId('item-panel');
  await expect(panel.getByLabel('Parent')).toHaveValue(/.+/);
  await expect(panel).toContainText('Pay by card');
  await panel.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('board').getByRole('button', { name: 'Pay by card' }).click();
  await expect(panel.getByTestId('label')).toHaveText(['payments']);
  await expect(panel.getByLabel('Owner')).toHaveValue(/.+/);
});
