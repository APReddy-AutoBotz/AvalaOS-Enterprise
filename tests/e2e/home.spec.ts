// The public homepage: the product tour, its controls, and accessibility.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { shot } from './helpers.ts';

const region = (name: string) => `${name}: the product on the sample case`;

test('homepage: the five stages can be picked and the tour paused', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evaluate before you automate.');
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/signin');
  // The opening screen is a real product screen and it loads.
  const hero = page.getByRole('img', { name: /assessment of a vendor invoice process/ });
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // The message that AI is not needed everywhere, with the approaches every step is scored for.
  await expect(page.getByRole('heading', { name: 'AI is not the answer to every step' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'The approaches every step is scored for' }).getByRole('listitem')).toHaveCount(5);

  const stages = page.getByRole('list', { name: 'The five stages' }).getByRole('button');
  await expect(stages).toHaveCount(5);
  await expect(stages.first()).toHaveAttribute('aria-current', 'step');

  await page.getByRole('button', { name: 'Pause the tour' }).click();
  await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible();
  await stages.nth(3).click();
  await expect(stages.nth(3)).toHaveAttribute('aria-current', 'step');
  const launch = page.getByRole('region', { name: region('Launch') });
  await expect(launch.getByRole('img')).toHaveCount(2);
  await expect(launch).toContainText('A person chooses what goes to the board.');
  for (const img of await launch.getByRole('img').all()) {
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
  }
  await page.waitForTimeout(400);
  await shot(page, '70-homepage');
});

test('homepage: with reduced motion nothing moves on its own, and every stage is accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pause the tour' })).toBeHidden();
  await page.waitForTimeout(1500);
  const stages = page.getByRole('list', { name: 'The five stages' }).getByRole('button');
  await expect(stages.first()).toHaveAttribute('aria-current', 'step');
  // Both screens of the stage are shown, one under the other.
  for (const img of await page.getByRole('region', { name: region('Assess') }).getByRole('img').all()) await expect(img).toBeVisible();

  const bad: string[] = [];
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

test('homepage on a phone: nothing spills off the side', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, '71-homepage-phone');
});

test('homepage: the ways to start and the AI providers come from the product\'s own lists', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('navigation', { name: 'Main' });
  await main.getByRole('link', { name: 'Ways to start' }).click();
  await expect(page).toHaveURL(/#start$/);
  await expect(page.getByRole('list', { name: 'Ways to start' }).getByRole('heading')).toHaveText(['The full journey', 'Assess and Documents', 'Assess', 'The Delivery board on its own']);
  await expect(page.getByRole('link', { name: 'Ask for an invitation' })).toHaveAttribute('href', /^mailto:/);
  await main.getByRole('link', { name: 'Your AI' }).click();
  await expect(page.getByRole('heading', { name: 'Your AI, your key' })).toBeVisible();
  // Only providers the extraction check has been run with are called available.
  await expect(page.getByRole('list', { name: 'AI providers available now' }).getByRole('listitem')).toHaveText(['OpenAI', 'Azure OpenAI']);
  await expect(page.getByRole('list', { name: 'AI providers coming' }).getByRole('listitem')).toHaveText(['Anthropic', 'OpenAI-compatible endpoint', 'Amazon Bedrock (Claude)', 'Mistral AI']);
  const result = await new AxeBuilder({ page }).include('#start').include('#ai').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await shot(page, '72-homepage-parts-ai');
});

test('homepage on a phone: the links are behind Menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link', { name: 'Demo' })).toBeHidden();
  await main.getByRole('button', { name: 'Menu' }).click();
  await expect(main.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'true');
  await main.getByRole('link', { name: 'Ways to start' }).click();
  await expect(page).toHaveURL(/#start$/);
  await expect(main.getByRole('link', { name: 'Demo' })).toBeHidden();
  await main.getByRole('button', { name: 'Menu' }).click();
  await page.keyboard.press('Escape');
  await expect(main.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
});
