// The weekday "Needs you" email: a person's own choice in the account menu, and the page the email's link opens.
// The digest itself runs on the server (journey-notify) and is checked by domain/work/digest.test.ts and
// supabase/tests/needs_email.sql.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

test('a person turns the weekday email off and on in the account menu, and the choice is kept', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/work');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByTestId('account-menu')).toContainText('analyst@example.test');
  const choice = page.getByTestId('needs-email').getByRole('checkbox', { name: /Email me on weekdays when something new needs me/ });
  await expect(choice).toBeChecked();
  await choice.uncheck();
  await expect(choice).not.toBeChecked();
  await page.reload();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByTestId('needs-email').getByRole('checkbox')).not.toBeChecked();
  await page.getByTestId('needs-email').getByRole('checkbox').check();
  await expect(page.getByTestId('needs-email').getByRole('checkbox')).toBeChecked();
});

test('the email\'s link opens a page that asks before it stops the email, and says when a link is not complete', async ({ page }) => {
  await page.goto('/unsubscribe');
  await expect(page.getByTestId('unsubscribe').getByRole('alert')).toContainText('This link is not complete');

  await page.goto('/unsubscribe?token=0b6a6c1e-2f43-4a7e-9a55-8d1c6b0f4e21');
  await expect(page.getByRole('heading', { name: 'Stop these emails' })).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  // The browser tests have no server: the page says it did not work instead of claiming success.
  await page.getByRole('button', { name: 'Stop these emails' }).click();
  await expect(page.getByTestId('unsubscribe').getByRole('alert')).toContainText('That did not work');
});
