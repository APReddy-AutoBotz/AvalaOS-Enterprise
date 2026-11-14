// The Avala assistant's panel, on the demo's sample case. Answers need the server's AI, which the
// in-browser store does not have, so this checks the panel and that it says so plainly; how facts are
// built and answers read is tested in domain/assistant/ask.test.ts.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

test('the assistant panel opens on a process, offers questions, and says when answers need the server', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  const button = page.getByRole('button', { name: 'Ask Avala' });
  // Set apart from the page's other actions: the brand amber.
  await expect(button).toHaveCSS('background-color', 'rgb(230, 159, 0)');
  await button.click();
  const panel = page.getByTestId('ask-panel');
  await expect(page.getByRole('heading', { name: 'Ask Avala' })).toBeVisible();
  await expect(panel).toContainText('Answers come only from its record');
  await expect(panel).toContainText('it changes nothing');
  const start = panel.getByRole('group', { name: 'Questions to start with' });
  await expect(start.getByRole('button')).toHaveCount(3);
  const result = await new AxeBuilder({ page }).include('[data-testid="ask-panel"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await start.getByRole('button', { name: 'Why is this the recommended approach?' }).click();
  const turn = panel.getByTestId('ask-turn');
  await expect(turn).toContainText('Why is this the recommended approach?');
  await expect(turn.getByRole('alert')).toContainText('need the server');
  // A question of one character is refused before anything is sent.
  await panel.getByLabel('Your question').fill('?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel).toContainText('Ask a question about this process.');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});
