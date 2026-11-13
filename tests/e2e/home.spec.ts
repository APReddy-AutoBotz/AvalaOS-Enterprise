// The public homepage: the lifecycle demo, its controls, and accessibility.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { shot } from './helpers.ts';

test('homepage: the five stages can be picked and the demo paused', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evaluate before you automate.');
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/signin');

  const stages = page.getByRole('list', { name: 'The five stages' }).getByRole('button');
  await expect(stages).toHaveCount(5);
  await expect(stages.first()).toHaveAttribute('aria-current', 'step');

  await stages.nth(2).click();
  await expect(stages.nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('region', { name: 'Assemble: example' })).toContainText('Business requirements');
  await stages.nth(4).click();
  await expect(page.getByRole('region', { name: 'Audit: example' })).toContainText('Revision 1 approved');
  await shot(page, '70-homepage-audit');

  const pause = page.getByRole('button', { name: 'Pause the demo' });
  await pause.click();
  await expect(page.getByRole('button', { name: 'Play the demo' })).toBeVisible();
});

test('homepage: with reduced motion nothing moves on its own', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause the demo' })).toBeHidden();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('list', { name: 'The five stages' }).getByRole('button').first()).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('region', { name: 'Assess: example' })).toContainText('Rule-based automation');

  // Scanned with motion off, so no text is caught half-way through its fade-in. Every stage is checked.
  const bad: string[] = [];
  const stages = page.getByRole('list', { name: 'The five stages' }).getByRole('button');
  for (let i = 0; i < 5; i++) {
    await stages.nth(i).click();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    for (const v of result.violations.filter(x => x.impact === 'serious' || x.impact === 'critical')) bad.push(`stage ${i + 1}: ${v.id}: ${v.nodes[0]?.target.join(' ')}`);
  }
  expect(bad).toEqual([]);
});

test('the sign-in page still opens from the homepage link', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/signin$/);
});
