// The walkthrough request (docs/next-plan.md, section 3d, package 11): the window opens from all three
// "Book a walkthrough" buttons, keeps focus inside, closes on Escape, sends and thanks, keeps the text and
// shows the address when sending fails, and Send is off while a request is on its way. The server function
// is stood in for here (it is not live until the release); its rules are domain/site/inquiry.test.ts and the
// database's are supabase/tests/walkthrough_requests.sql. Settings → Walkthrough requests for the owner.
import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type Route } from '@playwright/test';
import { shot, signInAndCreateProcess } from './helpers.ts';

const FUNCTION = '**/functions/v1/journey-inquiry';
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Book a walkthrough' });

async function fill(page: Page) {
  const d = dialog(page);
  await d.getByLabel('Your name').fill('Asha\nRao');
  await d.getByLabel('Work email').fill('asha@example.com');
  await d.getByLabel('Company').fill('Kaveri Components');
  await d.getByLabel(/A process you have in mind/).fill('Supplier invoices\nand credit notes');
  await d.getByLabel(/How many people work on it/).selectOption({ label: '6 to 20' });
}

test('the window opens from the bar, the opening and the close, keeps focus inside, and closes on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.goto('/');
  const buttons = [
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Book a walkthrough' }),
    page.locator('a[data-walk]').first(),
    page.locator('a[data-walk]').last(),
  ];
  for (const button of buttons) {
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(dialog(page)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    // Tabbing round never leaves the window.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog')))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    // Focus goes back to the button that opened it.
    expect(await button.evaluate(el => el === document.activeElement)).toBe(true);
  }
  // The page itself did not grow: the window's words exist only while it is open.
  await expect(page.getByText('Tell us who you are and we will arrange a time.')).toHaveCount(0);
});

test('sending: Send is off while it goes, the elapsed time goes with it, and the visitor is thanked', async ({ page }) => {
  let body: Record<string, unknown> | null = null;
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route(FUNCTION, async (route: Route) => {
    body = route.request().postDataJSON();
    await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('/');
  await page.locator('a[data-walk]').first().click();
  await fill(page);
  // What the visitor can fix is said first, and nothing is sent.
  await dialog(page).getByLabel('Company').fill('');
  await dialog(page).getByRole('button', { name: 'Send' }).click();
  await expect(dialog(page).getByRole('alert')).toHaveText('Company is needed.');
  expect(body).toBeNull();
  await dialog(page).getByLabel('Company').fill('Kaveri Components');
  await page.waitForTimeout(3100);
  await dialog(page).getByRole('button', { name: 'Send' }).click();
  await expect(dialog(page).getByRole('button', { name: 'Sending…' })).toBeDisabled();
  await expect.poll(() => body).not.toBeNull();
  expect(body!.elapsedMs).toEqual(expect.any(Number));
  expect(body!.elapsedMs as number).toBeGreaterThanOrEqual(3000);
  expect(body!.website).toBe('');
  expect(body!.people).toBe('6-20');
  release();
  await expect(dialog(page).getByTestId('inquiry-thanks')).toHaveText('Thank you. We will write to you within two working days.');
  await shot(page, '95-inquiry-thanks');
  // The release gate's scan, with the window open.
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

test('when sending fails, the window keeps what was typed and offers the address', async ({ page }) => {
  await page.route(FUNCTION, route => route.fulfill({ status: 429, contentType: 'application/json', body: '{"ok":false,"error":{"code":"TOO_MANY"}}' }));
  await page.goto('/');
  await page.locator('a[data-walk]').first().click();
  await fill(page);
  await dialog(page).getByRole('button', { name: 'Send' }).click();
  const failed = dialog(page).getByTestId('inquiry-failed');
  await expect(failed).toHaveText('We could not send this. Please write to hello@avalaos.com.');
  await expect(failed.getByRole('link', { name: 'hello@avalaos.com' })).toHaveAttribute('href', 'mailto:hello@avalaos.com');
  await expect(dialog(page).getByLabel('Work email')).toHaveValue('asha@example.com');
  await expect(dialog(page).getByRole('button', { name: 'Send' })).toBeEnabled();
  await shot(page, '96-inquiry-failed');
  // The release gate's scan, with the window open and its message showing.
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});

test('Settings → Walkthrough requests: only the owner sees it; plain text, reply by email, status and delete', async ({ page }) => {
  await signInAndCreateProcess(page);
  const settings = () => page.getByRole('banner').getByRole('link', { name: 'Settings' }).click();
  const menu = () => page.getByRole('navigation', { name: 'Settings sections' });
  await settings();
  await expect(menu().getByRole('link', { name: 'People' })).toBeVisible();
  await expect(menu().getByRole('link', { name: 'Walkthrough requests' })).toHaveCount(0);

  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  await page.evaluate(old => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.platformOwner = true;
    state.walkthroughRequests = [
      { id: 'r1', name: '<b>Asha</b> Rao', email: 'asha@example.com', company: 'Kaveri <script>x</script>', process: 'Supplier invoices\nand credit notes', people: '6-20', status: 'new', createdAt: old, lastContactAt: old },
      { id: 'r2', name: 'Ben', email: 'ben@example.com', company: 'Mill Co', process: null, people: null, status: 'new', createdAt: new Date(Date.now() - 86_400_000).toISOString(), lastContactAt: old },
    ];
    localStorage.setItem(KEY, JSON.stringify(state));
  }, old);
  await page.reload();
  await settings();
  await menu().getByRole('link', { name: 'Walkthrough requests' }).click();
  const list = page.getByTestId('walkthrough-requests');
  const rows = list.getByTestId('walkthrough-request');
  await expect(rows).toHaveCount(2);
  // Newest first; what a visitor typed is shown as text, never as markup.
  await expect(rows.first().getByTestId('request-name')).toHaveText('Ben');
  const asha = rows.filter({ hasText: 'asha@example.com' });
  await expect(asha.getByTestId('request-name')).toHaveText('<b>Asha</b> Rao');
  await expect(asha).toContainText('Kaveri <script>x</script>');
  await expect(list.locator('b, script')).toHaveCount(0);
  await expect(asha.getByTestId('request-process')).toHaveText('Supplier invoices\nand credit notes');
  await shot(page, '97-walkthrough-requests');

  // "Reply by email" is addressed to the visitor and counts as contact.
  const reply = asha.getByRole('link', { name: 'Reply by email' });
  await expect(reply).toHaveAttribute('href', 'mailto:asha@example.com?subject=Your%20walkthrough%20of%20Avala%20OS');
  await reply.evaluate(a => a.addEventListener('click', e => e.preventDefault()));
  await reply.click();
  const stored = (id: string) => page.evaluate(id => JSON.parse(localStorage.getItem('avala.journey.memory.v1')!).walkthroughRequests.find((r: { id: string }) => r.id === id), id);
  await expect.poll(async () => (await stored('r1')).lastContactAt).not.toBe(old);

  // Setting a status counts as contact.
  await rows.filter({ hasText: 'ben@example.com' }).getByLabel('Status of the request from Ben').selectOption('answered');
  await expect.poll(async () => (await stored('r2')).status).toBe('answered');
  expect((await stored('r2')).lastContactAt).not.toBe(old);

  // Removal on request, asked first.
  await rows.filter({ hasText: 'ben@example.com' }).getByRole('button', { name: 'Delete the request from Ben' }).click();
  await list.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(rows).toHaveCount(1);
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => `${v.id}: ${v.nodes[0]?.target.join(' ')}`)).toEqual([]);
});
