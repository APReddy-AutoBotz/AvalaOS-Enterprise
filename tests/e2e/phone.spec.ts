// Every main screen at phone width (390 px), on the demo's sample case: nothing may stick out past the
// screen's edge, so the page never scrolls sideways. Wide content (tables, the stage rail, maps, the
// board) scrolls inside its own box instead. The screens are printed for review on claude/ branches.
import { test, expect, type Page } from '@playwright/test';
import { shot } from './helpers.ts';

test.use({ viewport: { width: 390, height: 844 } });

/** What sticks out past the right edge, outside any box that scrolls sideways on its own. */
const overflow = (page: Page) => page.evaluate(() => {
  const w = document.documentElement.clientWidth;
  const scrolls = (el: Element | null): boolean => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll' || s.overflowX === 'hidden' || s.overflowX === 'clip') && e.scrollWidth > e.clientWidth - 1) return true;
    }
    return false;
  };
  const out: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= w + 1) continue;
    if (scrolls(el.parentElement)) continue;
    const s = getComputedStyle(el);
    if (s.position === 'fixed' && s.visibility === 'hidden') continue;
    const label = `${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''}.${String(el.className).split(' ').slice(0, 4).join('.')}`;
    out.push(`${label} right=${Math.round(r.right)} "${(el.textContent ?? '').trim().slice(0, 40)}"`);
    if (out.length >= 8) break;
  }
  return { page: document.documentElement.scrollWidth - w, out };
});

const check = async (page: Page, name: string, problems: string[]) => {
  await page.waitForLoadState('networkidle');
  const o = await overflow(page);
  await shot(page, `phone-${name}`);
  if (o.page > 1 || o.out.length) problems.push(`${name}: page ${o.page}px wider\n    ${o.out.join('\n    ')}`);
};

test('every main screen fits a phone: nothing makes the page scroll sideways', async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  await page.goto('/demo/work');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'my-work', problems);

  await page.goto('/demo/processes');
  await expect(page.getByRole('link', { name: /Vendor invoice processing/ }).first()).toBeVisible();
  await check(page, 'processes', problems);

  await page.getByRole('link', { name: /Vendor invoice processing/ }).first().click();
  await expect(page.getByTestId('source-row').first()).toBeVisible();
  const base = page.url().replace(/\/sources$/, '');
  for (const s of ['sources', 'process', 'assessment', 'documents', 'flows', 'work-items']) {
    await page.goto(`${base}/${s}`);
    await expect(page.getByTestId('stage-panel')).toBeVisible();
    await check(page, `process-${s}`, problems);
  }

  await page.goto('/demo/board');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await check(page, 'board', problems);

  for (const s of ['people', 'applications', 'assessment', 'documents']) {
    await page.goto(`/demo/settings/${s}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await check(page, `settings-${s}`, problems);
  }

  await page.goto('/demo/work');
  await page.getByRole('button', { name: 'Ask Avala' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await check(page, 'ask-avala', problems);

  expect(problems, problems.join('\n')).toEqual([]);
});
