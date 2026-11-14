// The Avala assistant's panel, on the demo's sample case. "Ask Avala" is in the top bar on every page:
// on a process it asks about that process; elsewhere the person picks one. Answers need the server's AI,
// which the in-browser store does not have, so this checks the panel and that it says so plainly; how
// facts are built and answers read is tested in domain/assistant/ask.test.ts.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const ask = (page: import('@playwright/test').Page) => page.getByRole('banner').getByRole('button', { name: 'Ask Avala' });

test('Ask Avala is in the top bar: away from a process it asks which one, on a process it asks about that one', async ({ page }) => {
  await page.goto('/demo/processes');
  const button = ask(page);
  // Set apart from the page's actions: the brand amber.
  await expect(button).toHaveCSS('background-color', 'rgb(230, 159, 0)');
  await button.click();
  let panel = page.getByTestId('ask-panel');
  await expect(page.getByRole('heading', { name: 'Ask Avala' })).toBeVisible();
  const about = panel.getByLabel('Asking about');
  await expect(about).toHaveValue('');
  await expect(panel).toContainText('Choose a process to ask about');
  await about.selectOption({ label: 'Vendor invoice processing' });
  await expect(panel).toContainText('Answers come only from its record');
  await expect(panel.getByRole('group', { name: 'Questions to start with' }).getByRole('button')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);

  // On a process page there is no second button: the top bar's asks about the process in view.
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await expect(page.getByRole('button', { name: 'Ask Avala' })).toHaveCount(1);
  await ask(page).click();
  panel = page.getByTestId('ask-panel');
  await expect(panel.getByLabel('Asking about').locator('option:checked')).toHaveText('Vendor invoice processing');
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
