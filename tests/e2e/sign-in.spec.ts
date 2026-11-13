// Sign-in with Google and Microsoft. The in-browser store offers both providers but cannot leave for
// them, so these tests cover the screen: the buttons, what a provider's error says, and that email and
// password still work. Database rules (invitation claimed only once the address is confirmed) are in
// supabase/tests/invite_only_signup.sql.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { shot } from './helpers.ts';

test('the sign-in page offers Google and Microsoft above email and password', async ({ page }) => {
  await page.goto('/signin');
  const group = page.getByRole('group', { name: 'Sign in with Google or Microsoft' });
  await expect(group.getByRole('button')).toHaveText(['Continue with Google', 'Continue with Microsoft']);
  await group.getByRole('button', { name: 'Continue with Microsoft' }).click();
  await expect(page.getByRole('alert')).toHaveText('Microsoft sign-in needs the server; this is the in-browser store.');
  await expect(group.getByRole('button', { name: 'Continue with Microsoft' })).toBeEnabled();

  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await shot(page, '80-sign-in-providers');

  // Email and password still sign in.
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/signin$/);
});

test('a provider sending back an uninvited email: the page says sign-up is by invitation, once', async ({ page }) => {
  await page.goto('/signin?error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user');
  await expect(page.getByRole('alert')).toHaveText(/^Sign-up is by invitation\. Ask a workspace admin to invite the email address you sign in with/);
  // The reason is taken out of the address, so a reload does not repeat it.
  await expect(page).toHaveURL(/\/signin$/);
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a cancelled provider sign-in in the fragment is reported plainly', async ({ page }) => {
  await page.goto('/signin#error=access_denied&error_description=The+user+cancelled+the+sign-in');
  await expect(page.getByRole('alert')).toHaveText('Sign-in was cancelled.');
  await expect(page).toHaveURL(/\/signin$/);
});
