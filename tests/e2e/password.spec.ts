// Forgot password: the sign-in page asks for the address and never says whether it has an account; the
// emailed link lands on /reset-password, signed in for that purpose, where a new password is chosen.
// The in-browser store sends no email, so the link's landing is tested by opening the page signed in.
import { test, expect } from '@playwright/test';
import { shot } from './helpers.ts';

test('forgot password: ask for a link, then choose a new password on the page the link opens', async ({ page }) => {
  await page.goto('/signin');
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Reset your password');
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Sign in with Google or Microsoft' })).toHaveCount(0);
  await page.getByLabel('Email').fill('someone@example.test');
  await page.getByRole('button', { name: 'Email me a link' }).click();
  await expect(page.getByRole('status')).toHaveText(/^If an account uses this address, we have emailed it a link/);
  await shot(page, '82-forgot-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');

  // Signed in (as the link does), the page sets the new password.
  await page.getByLabel('Email').fill('someone@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL(/\/signin$/);
  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Choose a new password');
  await page.getByLabel('New password', { exact: true }).fill('a-new-secret');
  await page.getByLabel('New password again').fill('a-different-one');
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page.getByRole('alert')).toHaveText('The two passwords are not the same.');
  await page.getByLabel('New password again').fill('a-new-secret');
  await page.getByRole('button', { name: 'Save the new password' }).click();
  await expect(page.getByRole('status')).toContainText('Your password is changed');
  await page.getByRole('button', { name: 'Go to my work' }).click();
  await expect(page).toHaveURL(/\/work$/);
});

test('an expired reset link says so on the sign-in page', async ({ page }) => {
  await page.goto('/reset-password#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole('alert')).toHaveText('That link has expired or has already been used. Ask for a new one.');
});
