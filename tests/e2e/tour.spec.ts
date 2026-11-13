// The product tour on the homepage uses real screens. This walk runs the sample case in the repository
// (eval/corpus/ap-invoice: a made-up company, its call transcripts, procedure and flowchart, and the
// hand-checked process model for them) through the product and captures each stage. The captured
// screens are committed to public/marketing/tour/ when the tour is refreshed.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

const corpus = (name: string) => `eval/corpus/ap-invoice/sources/${name}`;
const snap = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/tour-${name}.jpg`, type: 'jpeg', quality: 80 });
const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();
const settle = (page: Page) => page.waitForTimeout(700);

test('tour: the sample case through every stage', async ({ page }) => {
  test.setTimeout(240_000);
  // The local-mode note belongs to the test build, not to the product a visitor will use.
  await page.addInitScript(() => {
    const css = document.createElement('style');
    css.textContent = '[data-testid="local-mode"]{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
  });

  await page.goto('/processes');
  await page.getByLabel('Email').fill('rahul.deshpande@kaveri-ic.example');
  await page.getByLabel('Password').fill('secret-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Organization').fill('Kaveri Industrial Components');
  await page.getByLabel('First workspace').fill('Finance Operations');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await page.getByLabel('Process name').fill('Vendor invoice processing');
  await page.getByRole('button', { name: 'Add process' }).click();
  await expect(page).toHaveURL(/\/process\/[0-9a-f-]{36}\/sources$/);

  const files = ['01-discovery-call-2026-10-06.vtt', '02-exceptions-deep-dive-2026-10-09.srt', '03-sap-integration-call-2026-10-14.txt', '04-SOP-FIN-AP-004-vendor-invoice-processing.docx', '05-AP-Invoice-AsIs.drawio'];
  await page.getByLabel('Upload source files').setInputFiles(files.map(corpus));
  await expect(page.getByTestId('source-row')).toHaveCount(files.length, { timeout: 40_000 });
  await settle(page);
  await snap(page, 'sources');

  // The model the sources lead to. Extraction needs the server, so the hand-checked model for this
  // case stands in for it; everything after this is the product working on that model.
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await expect(page.getByTestId('save-state')).toBeVisible();
  const gold = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/expected.model.json', 'utf8'));
  const keys = JSON.parse(fs.readFileSync('eval/corpus/ap-invoice/sources.json', 'utf8')) as Record<string, string>;
  await page.evaluate(({ gold, keys }) => {
    const KEY = 'avala.journey.memory.v1';
    const state = JSON.parse(localStorage.getItem(KEY)!);
    state.revisions.find((r: { state: string }) => r.state === 'working').model = gold;
    for (const s of state.sources) for (const [key, file] of Object.entries(keys)) if (s.fileName === file) s.key = key;
    localStorage.setItem(KEY, JSON.stringify(state));
  }, { gold, keys });
  await page.reload();
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await settle(page);
  await snap(page, 'process');

  await stage(page, 'Assessment');
  await expect(page.getByTestId('verdict')).toBeVisible();
  await settle(page);
  await snap(page, 'assessment');
  for (const [label, name] of [['Priority', 'assessment-priority'], ['Benefit', 'assessment-benefit'], ['Steps', 'assessment-steps']] as const) {
    await page.locator(`section[aria-label="${label}"]`).evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.mouse.wheel(0, -24);
    await settle(page);
    await snap(page, name);
  }

  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /PDD/ }).click();
  await expect(page.getByTestId('document')).toContainText('Process Definition Document');
  await settle(page);
  await snap(page, 'document');
  await page.mouse.wheel(0, 1500);
  await settle(page);
  await snap(page, 'document-2');
  await page.getByRole('tab', { name: /BRD/ }).click();
  await expect(page.getByTestId('document')).toContainText('Business Requirements Document');
  await page.mouse.wheel(0, -5000);
  await settle(page);
  await snap(page, 'document-brd');

  await stage(page, 'Flows');
  await settle(page);
  await snap(page, 'flows');
  await page.mouse.wheel(0, 700);
  await settle(page);
  await snap(page, 'flows-2');

  await page.mouse.wheel(0, -5000);
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('revision-status')).toHaveText('Approved revision 1');

  await stage(page, 'Work items');
  const items = page.getByTestId('work-items');
  await expect(items.getByTestId('proposal').first()).toBeVisible();
  await settle(page);
  await snap(page, 'work-items');
  await items.getByRole('button', { name: 'Select all' }).click();
  const confirm = page.getByTestId('confirm-panel');
  await confirm.getByLabel('New project name').fill('Invoice automation');
  await confirm.getByRole('button', { name: /^Confirm \d+ to the board$/ }).click();
  await expect(confirm.getByRole('status')).toContainText('items added to the board');

  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.getByRole('link', { name: 'Delivery board' }).click();
  await expect(page.getByTestId('board-card').first()).toBeVisible();
  await settle(page);
  await snap(page, 'board');
  await page.getByTestId('board-card').first().click();
  await settle(page);
  await snap(page, 'board-item');
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/processes');
  await page.getByRole('tab', { name: 'People' }).click();
  const people = page.getByTestId('people');
  for (const [email, role] of [['meera.iyer@kaveri-ic.example', 'Approver'], ['vikram.shah@kaveri-ic.example', 'Solution architect'], ['sunita.rao@kaveri-ic.example', 'Viewer']] as const) {
    await people.getByLabel('Work email').fill(email);
    await people.getByLabel('Role for the new person').selectOption({ label: role });
    await people.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByTestId('invites')).toContainText(email);
  }
  await people.getByRole('button', { name: 'Show' }).click();
  await expect(page.getByTestId('audit')).toBeVisible();
  await settle(page);
  await snap(page, 'people');
  await page.getByTestId('audit').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await settle(page);
  await snap(page, 'audit');

  await page.getByRole('tab', { name: 'Portfolio' }).click();
  await settle(page);
  await snap(page, 'portfolio');
  await page.getByRole('link', { name: 'My work' }).click();
  await expect(page.getByRole('heading', { name: 'My work', exact: true })).toBeVisible();
  await settle(page);
  await snap(page, 'my-work');
});
