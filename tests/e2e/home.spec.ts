// The public homepage: the product tour, its controls, and accessibility.
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { shot } from './helpers.ts';

const region = (name: string) => `${name}: the product on the sample case`;

test('homepage: the five stages can be picked and the tour paused', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Evaluate before you automate.');
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toHaveAttribute('href', '/signin');
  // A buyer has one thing to ask for, a walkthrough, in the bar and in the opening, beside the demo; who the
  // page is for is said first, and the opening no longer explains invitations (owner, 16 November 2026).
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a walkthrough' })).toHaveAttribute('href', /^mailto:.*walkthrough/i);
  await expect(page.getByText('For automation teams and consulting partners')).toBeVisible();
  await expect(page.getByText('Already have an invitation?')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /pilot/i })).toHaveCount(0);
  // The first screen says what a buyer asks first, and each line leads to where the page shows it.
  const facts = page.getByRole('list', { name: 'In short' }).getByRole('link');
  await expect(facts).toHaveText(['Bring your own AI key (BYOK)', 'Scores come from fixed tables, not from AI', 'A named person signs off']);
  for (const f of await facts.all()) await expect(page.locator(String(await f.getAttribute('href')))).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Try the live demo' }).first()).toHaveAttribute('href', '/demo');
  await expect(page).toHaveTitle('Avala OS | Evaluate before you automate');
  await expect(page.getByText(/AvalaOS/)).toHaveCount(0);
  // The opening screen is a real product screen and it loads.
  const hero = page.getByRole('img', { name: /assessment of a vendor invoice process/ });
  await expect(hero).toBeVisible();
  expect(await hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);

  // What the page promises about people's effort is what the product does, and it never says Avala OS picks a typical process.
  const effort = page.locator('#effort');
  await expect(effort.getByRole('heading', { level: 2 })).toHaveText('Avala OS does the work. Your people confirm it.');
  await expect(effort.getByRole('list', { name: 'What you get' }).getByRole('heading')).toHaveText(['Choose the right approach', 'Less preparation for your people', 'Delivery tied to the decision']);
  // The longer explanation is one click away, not on the page by default.
  await expect(effort.getByText('Effort you can show')).toBeHidden();
  await effort.getByText('Read more').click();
  await expect(effort.getByText('Effort you can show')).toBeVisible();
  await expect(effort).toContainText('at most seven questions');
  await expect(effort).toContainText('pick a typical process from the list');
  await expect(page.getByText(/This looks like/)).toHaveCount(0);

  // The message that AI is not needed everywhere, with the approaches every step is scored for.
  await expect(page.getByRole('heading', { name: 'AI is not the answer to every step' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'The approaches every step is scored for' }).getByRole('listitem')).toHaveCount(5);
  // The sample is told as one short case.
  await expect(page.getByText('What went in')).toBeVisible();
  await expect(page.getByText('One step: reading the invoice.')).toBeVisible();

  const stages = page.getByRole('list', { name: 'The five stages' }).getByRole('button');
  await expect(stages).toHaveCount(5);
  await expect(stages.first()).toHaveAttribute('aria-current', 'step');

  await page.getByRole('button', { name: 'Pause the tour' }).click();
  await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible();
  await stages.nth(3).click();
  await expect(stages.nth(3)).toHaveAttribute('aria-current', 'step');
  // A stage a visitor picked stays: the tour does not move on until it is played again.
  await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible();
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

test('homepage: the opening picture is whole at laptop and desktop widths, never cut off by the edge of the window', async ({ page }) => {
  for (const [width, height] of [[1024, 700], [1280, 720], [1366, 650], [1440, 800], [1536, 730], [1920, 950]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const box = (await page.getByRole('img', { name: /assessment of a vendor invoice process/ }).boundingBox())!;
    const inner = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box.x + box.width, `at ${width} wide the picture ends inside the page`).toBeLessThanOrEqual(inner - 16);
    expect(box.width, `at ${width} wide the picture is still large enough to read`).toBeGreaterThanOrEqual(480);
  }
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
  // The opening picture on a phone is the product's own phone screen, shown whole.
  const hero = page.getByRole('img', { name: /assessment of a vendor invoice process/ });
  await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.currentSrc)).toContain('assessment-phone');
  const box = (await hero.boundingBox())!;
  const frame = (await hero.locator('xpath=ancestor::div[contains(@class,"shot-frame")]').boundingBox())!;
  expect(Math.round(box.width)).toBeLessThanOrEqual(Math.round(frame.width));
  await shot(page, '71-homepage-phone');
});

test('homepage: the ways to start and the AI providers come from the product\'s own lists', async ({ page }) => {
  await page.goto('/');
  const main = page.getByRole('navigation', { name: 'Main' });
  await main.getByRole('link', { name: 'Trust' }).click();
  await expect(page).toHaveURL(/#trust$/);
  await expect(page.getByRole('heading', { name: 'What your security team will ask' })).toBeVisible();
  await expect(page.locator('#trust')).toContainText('Inside your own cloud, on request');
  for (const name of ['Privacy', 'Terms', 'Security']) await expect(page.locator('#trust').getByRole('link', { name })).toHaveAttribute('href', `/${name.toLowerCase()}`);
  await expect(page.getByRole('list', { name: 'Ways to start' }).getByRole('heading')).toHaveText(['The full journey', 'Assess and Documents', 'Assess', 'The Delivery board on its own']);
  // The close asks for one thing, and shows the address for anyone whose mail program does not open.
  await expect(page.getByRole('heading', { name: 'Start with one process. Decide with evidence.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Book a walkthrough' }).last()).toHaveAttribute('href', /^mailto:/);
  await expect(page.getByRole('main').getByRole('link', { name: 'hello@avalaos.com' })).toHaveAttribute('href', 'mailto:hello@avalaos.com');
  // What comes out names what the product makes today, the evidence pack included.
  await expect(page.getByText('An evidence pack')).toBeVisible();
  // Why the answer can be defended: three short points; the one picked shows its screen.
  await page.getByRole('button', { name: 'Every line traces to a source' }).click();
  await expect(page.getByRole('img', { name: /one access marked Not provided/ })).toBeVisible();
  await expect(page.getByText('Nothing is invented')).toHaveCount(0);
  // Ask Avala is described as it works: a person confirms, nothing is written on its own.
  await expect(page.getByRole('heading', { name: 'Ask Avala, and check its answer' })).toBeVisible();
  await expect(page.locator('#ask')).toContainText('nothing is written until you press Save');
  // The five words read as five words, not one.
  await expect(page.getByText('Assess. Validate. Assemble. Launch. Audit.')).toBeVisible();
  await expect(page.getByText('Built by a practitioner.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your AI, your key' })).toBeVisible();
  await expect(page.locator('#ai')).toContainText('Bring your own AI key (BYOK)');
  await expect(page.locator('#ai')).toContainText('to no other AI provider');
  // Only providers the extraction check has been run with are called available.
  await expect(page.getByRole('list', { name: 'AI providers available now' }).getByRole('listitem')).toHaveText(['OpenAI', 'Azure OpenAI']);
  await expect(page.getByRole('list', { name: 'AI providers coming' }).getByRole('listitem')).toHaveText(['Anthropic', 'OpenAI-compatible endpoint', 'Amazon Bedrock (Claude)', 'Mistral AI']);
  const result = await new AxeBuilder({ page }).include('#start').include('#trust').include('#ask').include('#why').include('#effort').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
  await shot(page, '72-homepage-parts-ai');
});

test('homepage on a phone: the links are behind Menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const main = page.getByRole('navigation', { name: 'Main' });
  await expect(main.getByRole('link', { name: 'Live demo' })).toBeHidden();
  await main.getByRole('button', { name: 'Menu' }).click();
  await expect(main.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'true');
  await main.getByRole('link', { name: 'Trust' }).click();
  await expect(page).toHaveURL(/#trust$/);
  await expect(main.getByRole('link', { name: 'Live demo' })).toBeHidden();
  await main.getByRole('button', { name: 'Menu' }).click();
  await page.keyboard.press('Escape');
  await expect(main.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
});

test('homepage: it stays short, under eight screens on a laptop and about 1,000 words before "Read more"', async ({ page }) => {
  // The owner's laptop (15.6 inch): the page had grown to 11 screens and 1,440 words (16 November 2026).
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What comes out' })).toBeVisible();
  const size = await page.evaluate(() => ({
    screens: document.documentElement.scrollHeight / window.innerHeight,
    words: (document.querySelector('main')!.innerText.match(/\S+/g) ?? []).length,
    sections: [...document.querySelectorAll('main > section')].map(x => `${x.querySelector('h2')?.textContent?.slice(0, 24)}: ${Math.round(x.getBoundingClientRect().height)}`),
  }));
  console.log(`HOME_SIZE ${size.screens.toFixed(2)} screens, ${size.words} words | ${size.sections.join(' | ')}`);
  expect(size.screens).toBeLessThanOrEqual(8);
  expect(size.words).toBeLessThanOrEqual(1050);
});

test.describe('the card a shared link shows', () => {
  test.use({ viewport: { width: 1280, height: 672 }, deviceScaleFactor: 2 });
  test('homepage: a shared link has a card, taken from the opening of the page', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBe('https://avalaos.com/marketing/share-card.jpg');
    expect(await page.locator('meta[name="twitter:card"]').getAttribute('content')).toBe('summary_large_image');
    // The card is the opening itself (public/marketing/share-card.jpg, 1200 by 630): the name, the headline, the two
    // actions and the product screen. The smaller links are left out of the picture.
    await page.addStyleTag({ content: 'ul[aria-label="In short"]{display:none!important}' });
    const hero = page.getByRole('img', { name: /assessment of a vendor invoice process/ });
    await expect.poll(() => hero.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: 'test-results/screens/share-card.jpg', type: 'jpeg', quality: 90 });
  });
});
