import { test, expect } from '@playwright/test';
import { shot, signInAndCreateProcess } from './helpers.ts';

test('an admin invites people by role, cannot demote the last admin, and sees it in the audit trail', async ({ page }) => {
  await signInAndCreateProcess(page);
  await page.goto('/settings/people');
  const people = page.getByTestId('people');
  await expect(people.getByTestId('people-list')).toContainText('analyst');
  await expect(people.getByLabel('Role of analyst')).toHaveValue('admin');

  // A bad address is refused in plain words.
  await people.getByLabel('Work email').fill('ravi@acme');
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByRole('alert')).toContainText('Enter a work email address');

  // A good one waits for sign-up, with the chosen role.
  await people.getByLabel('Work email').fill('  Ravi@Acme.com ');
  await people.getByLabel('Role for the new person').selectOption({ label: 'Developer' });
  await people.getByRole('button', { name: 'Add person' }).click();
  await expect(page.getByTestId('invites')).toContainText('ravi@acme.com');
  await expect(page.getByTestId('invites')).toContainText('Developer');
  await expect(people.getByRole('status')).toContainText('when they sign up');
  // The in-browser store cannot send email: the admin is told to let the person know, and can send again later.
  await expect(people.getByRole('status')).toContainText('The invitation email was not sent');
  await expect(people.getByRole('button', { name: 'Email the invitation to ravi@acme.com again' })).toBeVisible();

  // The only admin cannot be demoted.
  await people.getByLabel('Role of analyst').selectOption({ label: 'Viewer' });
  await expect(page.getByRole('alert')).toContainText('at least one admin');
  await expect(people.getByLabel('Role of analyst')).toHaveValue('admin');

  await people.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByTestId('audit')).toContainText('invited ravi@acme.com as Developer');
  await shot(page, '60-people');
});
