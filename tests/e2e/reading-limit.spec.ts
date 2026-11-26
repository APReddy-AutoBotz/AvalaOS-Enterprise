// The limit on starting readings (plan (a) of claude/reading-limit-email-link-and-screens-plans-26-nov.md): one
// at a time per process, and 6 an hour per person. A reading someone else started while this page was open is
// followed, with one line, instead of a second one starting; the seventh in an hour says when the next can
// start. The in-browser store holds the same rules as the database (startRefused in domain/extract/startLimit.ts);
// the readings are the browser tests' stand-ins (journey/store/standIns.ts). The database's own function is
// tested in supabase/tests/extraction_start.sql.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { signInAndCreateProcess } from './helpers.ts';

const KEY = 'avala.journey.memory.v1';
const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
const corpus = (name: string) => `eval/corpus/ap-invoice/sources/${name}`;
const UNDER_WAY = 'A reading of this process was already under way. Its result shows here when it is done.';

type Log = { task: string }[];
const reads = (page: Page) => page.evaluate(() => ((window as unknown as { __avalaStandInLog?: Log }).__avalaStandInLog ?? []).filter(c => c.task === 'extraction').length);
const withStandIns = (page: Page, replies: unknown) => page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = r; }, replies);

/**
 * Readings kept as another tab would leave them, for this process (or others), by the person signed in:
 * `minutesAgo` when each started; a reading `running` has just moved and is not finished yet.
 */
const keepRuns = (page: Page, processId: string, runs: { minutesAgo: number; running?: boolean; otherProcess?: boolean }[]) => page.evaluate(({ KEY, processId, runs, gold }) => {
  const s = JSON.parse(localStorage.getItem(KEY)!);
  const now = Date.now();
  s.extractions = runs.map((r, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, processId: r.otherProcess ? `other-${i}` : processId, createdBy: s.me.id,
    status: r.running ? 'running' : 'done', error: null, model: r.running ? null : gold, tokens: 0, sourceIds: [], done: gold,
    // A reading still running starts "in a minute", so the in-browser store does not finish it during the test.
    createdAt: new Date(r.running ? now + 60_000 : now - r.minutesAgo * 60_000).toISOString(), updatedAt: new Date(now).toISOString(),
  }));
  localStorage.setItem(KEY, JSON.stringify(s));
}, { KEY, processId, runs, gold });

async function processWithSource(page: Page): Promise<string> {
  await signInAndCreateProcess(page);
  const processId = page.url().match(/\/process\/([^/]+)\//)![1];
  await page.getByLabel('Upload source files').setInputFiles([corpus('05-AP-Invoice-AsIs.drawio')]);
  await expect(page.getByTestId('source-row')).toHaveCount(1, { timeout: 20_000 });
  return processId;
}

test('Sources: a reading already under way is followed, not started again; the seventh in an hour says when', async ({ page }) => {
  await withStandIns(page, { extraction: [gold, gold] });
  const processId = await processWithSource(page);
  const extract = page.getByRole('button', { name: 'Extract from 1 source' });
  await expect(extract).toBeEnabled();

  // Another tab started a reading of this process after this page opened.
  await keepRuns(page, processId, [{ minutesAgo: 0, running: true }]);
  await extract.click();
  await expect(page.getByTestId('reading-under-way')).toHaveText(UNDER_WAY);
  await expect(page.getByRole('status').filter({ hasText: 'This takes a few minutes' })).toBeVisible();
  expect(await reads(page), 'no second reading was started').toBe(0);

  // Six readings started in the last hour (here on other processes, the oldest 50 minutes ago): the seventh waits.
  await keepRuns(page, processId, [50, 40, 30, 20, 10, 5].map(m => ({ minutesAgo: m, otherProcess: true })));
  await page.reload();
  await page.getByRole('button', { name: 'Extract from 1 source' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'You have started 6 readings in the last hour.' }))
    .toContainText('You have started 6 readings in the last hour. You can start the next one in 10 minutes.');
  await expect(page.getByTestId('reading-under-way')).toHaveCount(0);
  expect(await reads(page)).toBe(0);

  // One of them an hour and a minute ago instead: the reading starts.
  await keepRuns(page, processId, [61, 40, 30, 20, 10, 5].map(m => ({ minutesAgo: m, otherProcess: true })));
  await page.reload();
  await page.getByRole('button', { name: 'Extract from 1 source' }).click();
  await expect.poll(() => reads(page)).toBe(1);
  await expect(page.getByTestId('reading-under-way')).toHaveCount(0);
});

test('Discovery: a reading already under way is followed with the same line', async ({ page }) => {
  await withStandIns(page, { extraction: [gold] });
  await signInAndCreateProcess(page);
  const processId = page.url().match(/\/process\/([^/]+)\//)![1];
  await page.getByTestId('own-words-discovery').getByRole('button', { name: 'Start with Ask Avala' }).click();
  const discovery = page.getByTestId('discovery');
  await discovery.getByLabel('In your own words').fill('Supplier invoices arrive in the AP shared mailbox. An AP clerk checks the mandatory fields.');
  await keepRuns(page, processId, [{ minutesAgo: 0, running: true }]);
  await discovery.getByRole('button', { name: 'Save and read it' }).click();
  await expect(discovery.getByTestId('reading-under-way')).toHaveText(UNDER_WAY, { timeout: 20_000 });
  await expect(discovery.getByTestId('discovery-reading')).toBeVisible();
  expect(await reads(page)).toBe(0);
});
