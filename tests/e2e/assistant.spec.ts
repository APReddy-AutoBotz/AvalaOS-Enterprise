// The Avala assistant's panel, on the demo's sample case. "Ask Avala" is in the top bar on every page:
// on a process it asks about that process, on the Delivery board about that board; elsewhere about the
// whole workspace, and the person can pick a process or a board instead. The demo has no AI: it answers
// the suggested questions from answers recorded on the sample case (public/demo-data/ask-answers.json),
// marked as such, and says any other question needs the server. How facts are built and answers read is
// tested in domain/assistant/*.test.ts; that the recordings still fit the demo in eval/ask/recorded.test.ts.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';

const ask = (page: import('@playwright/test').Page) => page.getByRole('banner').getByRole('button', { name: 'Ask Avala' });

test('Ask Avala is in the top bar: away from a process it asks about the workspace, on a process about that one', async ({ page }) => {
  await page.goto('/demo/processes');
  const button = ask(page);
  // Set apart from the page's actions: the brand amber.
  await expect(button).toHaveCSS('background-color', 'rgb(230, 159, 0)');
  await button.click();
  let panel = page.getByTestId('ask-panel');
  await expect(page.getByRole('heading', { name: 'Ask Avala' })).toBeVisible();
  const about = panel.getByLabel('Asking about');
  await expect(about).toHaveValue('w');
  await expect(about.locator('option:checked')).toHaveText('The whole workspace');
  await expect(panel).toContainText('Ask about this workspace');
  const whole = panel.getByRole('group', { name: 'Questions to start with' });
  await expect(whole.getByRole('button')).toHaveCount(3);
  await whole.getByRole('button', { name: 'Where does each process stand?' }).click();
  // The demo answers its suggested questions from what was recorded on the sample case.
  await expect(panel.getByTestId('ask-recorded')).toHaveText('Recorded answer on the sample case');
  await expect(panel.getByTestId('ask-lead')).toBeVisible();
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
  // One click widens to the whole workspace, and back.
  await panel.getByLabel('Asking about').selectOption('w');
  await expect(page.getByTestId('ask-panel')).toContainText('Ask about this workspace');
  await page.getByTestId('ask-panel').getByLabel('Asking about').selectOption({ label: 'Vendor invoice processing' });
  panel = page.getByTestId('ask-panel');
  const start = panel.getByRole('group', { name: 'Questions to start with' });
  await expect(start.getByRole('button')).toHaveCount(3);
  const result = await new AxeBuilder({ page }).include('[data-testid="ask-panel"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await start.getByRole('button', { name: 'Why is this the recommended approach?' }).click();
  const turn = panel.getByTestId('ask-turn');
  await expect(turn).toContainText('Why is this the recommended approach?');
  await expect(turn.getByTestId('ask-recorded')).toHaveText('Recorded answer on the sample case');
  await expect(turn.getByTestId('ask-lead')).toContainText('RPA');
  await expect(turn.getByTestId('ask-citation').first()).toBeVisible();
  // Next, the other recorded questions; a question of its own needs the server.
  await expect(turn.getByRole('group', { name: 'Ask next' }).getByRole('button')).toHaveCount(2);
  await panel.getByLabel('Your question').fill('Who scans the paper invoices?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel.getByTestId('ask-turn').nth(1).getByRole('alert')).toContainText('only for the suggested questions');
  // A question of one character is refused before anything is sent.
  await panel.getByLabel('Your question').fill('?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel).toContainText('Ask a question about this process.');
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
});

test('on the Delivery board Ask Avala asks about that board, and a board can be picked from anywhere', async ({ page }) => {
  await page.goto('/demo/board');
  await expect(page.getByRole('heading', { name: 'Delivery board', level: 1 })).toBeVisible();
  await ask(page).click();
  let panel = page.getByTestId('ask-panel');
  await expect(panel.getByLabel('Asking about').locator('option:checked')).toHaveText('Invoice automation');
  await expect(panel).toContainText('Ask about this Delivery board');
  const start = panel.getByRole('group', { name: 'Questions to start with' });
  await expect(start.getByRole('button')).toHaveCount(3);
  const result = await new AxeBuilder({ page }).include('[data-testid="ask-panel"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await start.getByRole('button', { name: 'What is blocked or overdue?' }).click();
  await expect(panel.getByTestId('ask-recorded')).toBeVisible();
  await expect(panel.getByTestId('ask-lead')).toContainText('Nothing is blocked or overdue');
  await panel.getByLabel('Your question').fill('?');
  await panel.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(panel).toContainText('Ask a question about this board.');
  await page.keyboard.press('Escape');

  // From another page, the board is offered beside the processes.
  await page.goto('/demo/work');
  await ask(page).click();
  panel = page.getByTestId('ask-panel');
  await panel.getByLabel('Asking about').selectOption({ label: 'Invoice automation' });
  await expect(panel).toContainText('Ask about this Delivery board');
});

test('on a process, Ask Avala goes through the open questions one at a time, most decisive first', async ({ page }) => {
  await page.goto('/demo/processes');
  await page.getByRole('link', { name: /Vendor invoice processing/ }).click();
  await ask(page).click();
  const panel = page.getByTestId('ask-panel');
  const tab = panel.getByRole('tab', { name: /^Open questions \(\d+\)$/ });
  await expect(tab).toBeVisible();
  const count = Number((await tab.textContent())!.match(/\((\d+)\)/)![1]);
  expect(count).toBeGreaterThan(1);
  await tab.click();
  const interview = panel.getByTestId('interview');
  await expect(interview).toContainText(`Question 1 of ${count} · Changes the recommendation`);
  await expect(interview).toContainText('The answer can change the recommended approach.');
  const first = await interview.getByTestId('interview-question').textContent();
  const result = await new AxeBuilder({ page }).include('[data-testid="ask-panel"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  // The demo has no AI: the answer is not read, and nothing is recorded.
  await interview.getByLabel('Your answer, in your own words').fill('Through its screens, with a service account.');
  await interview.getByRole('button', { name: 'Read my answer' }).click();
  await expect(interview.getByRole('alert')).toContainText('Reading answers needs the server');
  await expect(interview.getByTestId('interview-record')).toHaveCount(0);
  // Skip moves on to the next question.
  await interview.getByRole('button', { name: 'Skip' }).click();
  await expect(interview).toContainText(`Question 2 of ${count}`);
  await expect(interview.getByTestId('interview-question')).not.toHaveText(first!);
  // Back to asking.
  await panel.getByRole('tab', { name: 'Ask' }).click();
  await expect(panel.getByRole('group', { name: 'Questions to start with' })).toBeVisible();
});
