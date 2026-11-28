// "Your name" (plan claude/your-name-plan-28-nov.md): a person sets their own name in Settings, and the account menu,
// the People list and My work show it. On the in-browser store; the database's own rule is checked by
// supabase/tests/own_display_name.sql and the words by domain/people/name.test.ts.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { openSettings, signInAndCreateProcess, signOut } from './helpers.ts';

test('a person sets their own name; wrong names are refused in words; the menu, People and My work show it', async ({ page }) => {
  await signInAndCreateProcess(page);

  // Sign-up made the name from the address: My work says so once, with a way to set it.
  await page.goto('/work');
  const line = page.getByTestId('set-name-line');
  await expect(line).toContainText('Your name shows as “analyst”.');
  await line.getByRole('button', { name: 'Set your name' }).click();
  await expect(page).toHaveURL(/\/settings\/you$/);
  const card = page.getByTestId('your-name');
  await expect(card.getByRole('heading', { name: 'Your name' })).toBeVisible();
  await expect(card).toContainText('Your email address is never shown in its place.');
  const field = card.getByLabel('Name');
  const save = card.getByRole('button', { name: 'Save' });
  await expect(field).toHaveValue('analyst');
  await expect(save).toBeDisabled();

  // Refused before anything is sent: empty, an email address, too long.
  await field.fill('   ');
  await expect(card).toContainText('Type your name.');
  await expect(save).toBeDisabled();
  await field.fill('ann@example.com');
  await expect(card).toContainText('Your name, not your email address.');
  await expect(save).toBeDisabled();
  await field.fill('a'.repeat(81));
  await expect(card).toContainText('At most 80 characters.');
  await expect(save).toBeDisabled();

  const result = await new AxeBuilder({ page }).include('[data-testid="your-name"]').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);

  // Saved trimmed.
  await field.fill('  Ann Reddy  ');
  await save.click();
  await expect(card.getByRole('status')).toHaveText('Saved.');
  await expect(field).toHaveValue('Ann Reddy');
  await expect(save).toBeDisabled();

  // The account menu shows it above the address.
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByTestId('account-name')).toHaveText('Ann Reddy');
  await expect(page.getByTestId('account-menu')).toContainText('analyst@example.test');
  await page.keyboard.press('Escape');

  // People lists it, and it is kept after a reload.
  await page.reload();
  await openSettings(page, 'People');
  await expect(page.getByTestId('settings-section')).toContainText('Ann Reddy');

  // My work greets the person by it, and the line has gone.
  await page.goto('/work');
  await expect(page.getByRole('heading', { name: 'Welcome back, Ann Reddy' })).toBeVisible();
  await expect(page.getByTestId('set-name-line')).toHaveCount(0);

  // "Change your name" in the account menu opens the same section.
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Change your name' }).click();
  await expect(page).toHaveURL(/\/settings\/you$/);
  await expect(page.getByTestId('your-name').getByLabel('Name')).toHaveValue('Ann Reddy');
});

test('the line on My work can be closed and stays closed; the note holds no id and goes at sign-out', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/work');
  await page.getByTestId('set-name-line').getByRole('button', { name: 'Close this line' }).click();
  await expect(page.getByTestId('set-name-line')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  await expect(page.getByTestId('set-name-line')).toHaveCount(0);
  // What the browser keeps for it: one key, with no account's id in it.
  const kept = await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('name-line')));
  expect(kept).toEqual(['avala:name-line-closed']);

  // Signing out removes it, so whoever signs in next is asked again.
  await signOut(page);
  await expect(page).toHaveURL(/\/signin$/);
  expect(await page.evaluate(() => localStorage.getItem('avala:name-line-closed'))).toBeNull();
  await page.getByLabel('Email').fill('analyst@example.test');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.goto('/work');
  await expect(page.getByTestId('set-name-line')).toContainText('Your name shows as “analyst”.');
});
