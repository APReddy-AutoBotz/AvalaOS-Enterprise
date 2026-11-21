// A teardown in the demo (marketing package, PR 2): the made-up fixture of domain/site/fixtures/teardown/,
// built here by the same function that builds a real teardown's file, served at the address a real one
// would have. The checks of the file itself are domain/site/teardowns.test.ts; this proves the pages.
import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ABOUT_TITLE, NOT_ON_TEARDOWN, TEARDOWN_ASK_NOTE, openQuestionsLine } from '../../domain/site/teardowns.ts';
import { openZip } from '../../domain/ingest/zip.ts';
import { serveTeardown as serve, teardownWords as words } from './teardownFixture.ts';
import { shot } from './helpers.ts';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

test('a teardown opens on its assessment with its lines, keeps the link words, and names its own address', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:4173/')) outside.push(r.url()); });
  await serve(page);
  await page.goto(`/demo/teardowns/${words.slug}?utm_source=test`);
  await expect(page).toHaveURL(new RegExp(`/demo/teardowns/${words.slug}/process/[0-9a-f-]{36}/assessment\\?utm_source=test$`));
  await expect(page.getByTestId('verdict')).toBeVisible();
  const banner = page.getByTestId('teardown-banner');
  await expect(banner.getByTestId('teardown-label')).toHaveText(words.label);
  await expect(banner.getByTestId('teardown-credit').getByRole('link')).toHaveAttribute('href', words.credit.url);
  await expect(banner.getByTestId('teardown-source')).toContainText(`Retrieved ${words.source.retrieved}.`);
  await expect(banner.getByTestId('teardown-not-review')).toHaveText(words.notReview);
  await expect(banner.getByTestId('teardown-open')).toHaveText(/^\d+ questions? stayed open because nobody who does this work was asked\./);
  const n = Number((await banner.getByTestId('teardown-open').innerText()).split(' ')[0]);
  await expect(banner.getByTestId('teardown-open')).toHaveText(openQuestionsLine(n));
  await expect(banner.getByTestId('teardown-removed')).toContainText('[email address removed]');
  await expect(banner.getByRole('link', { name: 'Sample case' })).toHaveAttribute('href', '/demo');
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(page.getByTestId('demo-pointer')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://avalaos.com/demo/teardowns/${words.slug}`);
  await expect(page).toHaveTitle(`${words.short} · Demo | Avala OS`);
  // The assessment's headline (change e).
  await shot(page, '90-teardown-assessment');

  // Ask Avala says its recorded answers are the sample's.
  await page.getByRole('banner').getByRole('button', { name: 'Ask Avala' }).click();
  await expect(page.getByTestId('ask-teardown-note')).toContainText(TEARDOWN_ASK_NOTE.text);
  await page.getByRole('button', { name: 'Close' }).click();

  // The printed assessment carries the lines.
  await page.getByRole('button', { name: 'Open the assessment report' }).click();
  await expect(page.getByTestId('report-teardown').getByTestId('teardown-label')).toHaveText(words.label);
  expect(outside).toEqual([]);
});

test('every document a teardown offers starts with its section; the downloads that could not carry it are not offered', async ({ page }) => {
  await serve(page);
  await page.goto(`/demo/teardowns/${words.slug}`);
  await expect(page.getByTestId('verdict')).toBeVisible();
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await page.getByRole('tab', { name: /^PDD/ }).click();
  await expect(doc.getByRole('heading', { name: new RegExp(ABOUT_TITLE) })).toBeVisible();
  await expect(doc).toContainText(words.credit.text);
  await expect(doc).toContainText(words.notReview);
  // The To-Be process and the delivery model in the PDD (change e).
  await doc.getByRole('heading', { name: /To-Be process map/ }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/screens/91-teardown-pdd-to-be.jpg', type: 'jpeg', quality: 70 });
  await doc.locator('[data-caption="Delivery model"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/screens/92-teardown-pdd-delivery.jpg', type: 'jpeg', quality: 70 });
  // Word: the section is in the file.
  const [word] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const xml = await openZip(new Uint8Array(readFileSync(await word.path()))).readText('word/document.xml');
  expect(xml).toContain(ABOUT_TITLE);
  expect(xml).toContain('not a review of any organisation');
  // Markdown too.
  const [md] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Markdown' }).click()]);
  const text = readFileSync(await md.path(), 'utf8');
  expect(text.indexOf(ABOUT_TITLE)).toBeGreaterThan(-1);
  expect(text).toContain(words.source.url);

  // The SDD's first page (change e).
  await page.getByRole('tab', { name: /^SDD/ }).click();
  // A teardown is never approved, so its SDD is the preview from the working draft, as for any draft.
  await page.getByRole('button', { name: 'Preview the SDD from this draft' }).click();
  await expect(page.getByTestId('sdd-preview')).toBeVisible();
  await expect(doc.getByRole('heading', { name: new RegExp(ABOUT_TITLE) })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/93-teardown-sdd.jpg', type: 'jpeg', quality: 70 });

  // No evidence pack; the test pack's CSV says why it is not offered.
  await expect(page.getByRole('tab', { name: /Evidence pack/ })).toHaveCount(0);
  await page.getByRole('tab', { name: /^Tests/ }).click();
  await expect(page.getByRole('button', { name: 'Download for Excel' })).toHaveCount(0);
  await expect(page.getByTestId('not-on-teardown')).toContainText(NOT_ON_TEARDOWN);

  // BPMN: the lines as a comment.
  await stage(page, 'Flows');
  const [bpmn] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download BPMN' }).click()]);
  const file = readFileSync(await bpmn.path(), 'utf8');
  expect(file).toMatch(/^<\?xml[^>]*\?>\n<!--\n {2}About this teardown/);
  expect(file).toContain(words.label);
  expect(file).toContain('<bpmn:definitions');
});

test('an address for a teardown the demo does not hold says so, with a way to the sample', async ({ page }) => {
  await page.route('**/demo-data/teardowns/not-here.json', r => r.fulfill({ status: 404, body: '' }));
  await page.goto('/demo/teardowns/not-here');
  await expect(page.getByRole('heading', { name: 'This teardown is not in the demo' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'the demo' })).toHaveAttribute('href', '/demo');
});

test('the sample is unchanged: its banner, its pointer, and no teardown lines', async ({ page }) => {
  await page.goto('/demo?utm_source=test');
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/assessment\?utm_source=test$/);
  await expect(page.getByTestId('demo-banner')).toContainText('made-up company');
  await expect(page.getByTestId('demo-pointer')).toBeVisible();
  await expect(page.getByTestId('teardown-banner')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://avalaos.com/demo');
});
