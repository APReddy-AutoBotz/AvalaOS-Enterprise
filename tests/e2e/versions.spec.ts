// Package 14, pull request 3 (docs/next-plan.md, section 3f): approving keeps the documents. On a small
// process in the in-browser store, which keeps versions by the database's rules: approve and version 1 is
// kept; a section edit and a choice of approach are unapproved changes, listed on Documents; approving again
// needs a reason and makes version 2; the list shows both; version 1 opens, and downloads as Word and
// Markdown, as it read before the edit; a viewer's switch of the maps' shape for the visit marks nothing.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openZip } from '../../domain/ingest/zip.ts';
import { shot, signInAndCreateProcess } from './helpers.ts';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();
const NEW_TEXT = 'Wording kept only in version two.';

async function buildProcess(page: Page) {
  await signInAndCreateProcess(page);
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByRole('tab', { name: /^Roles and systems/ }).click();
  await page.getByLabel('New system', { exact: true }).fill('SAP S/4HANA');
  await page.getByRole('button', { name: 'Add system' }).click();
  await expect(page.getByLabel('Name of system SAP S/4HANA')).toBeVisible();
  await page.getByRole('tab', { name: /^Steps/ }).click();
  for (const [name, type] of [['Check invoice totals', 'Automatic check'], ['Post invoice in SAP', 'Person using a system']]) {
    await page.getByLabel('New step', { exact: true }).fill(name);
    await page.getByLabel('Type of new step').selectOption({ label: type });
    await page.getByRole('button', { name: 'Add step' }).click();
    await expect(page.getByLabel(/^Name of step \d+$/).last()).toHaveValue(name);
  }
  await page.getByLabel('Add to systems for post invoice in sap').selectOption({ label: 'SAP S/4HANA' });
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
}

const download = async (page: Page, button: ReturnType<Page['getByTestId']>) => {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  return { name: file.suggestedFilename(), bytes: new Uint8Array(fs.readFileSync(await file.path())) };
};
const wordText = async (bytes: Uint8Array) => ((await openZip(bytes).readText('word/document.xml')) ?? '').replace(/<[^>]+>/g, '');

test('approving keeps the documents: versions 1 and 2, what changed, and version 1 opened and downloaded as it read', async ({ page }) => {
  test.setTimeout(180_000);
  await buildProcess(page);
  const status = page.getByTestId('revision-status');

  // Version 1: the first approval asks for no reason.
  await page.getByTestId('approve').click();
  await expect(status).toHaveText('Approved version 1');
  await expect(page.getByTestId('approve')).toHaveCount(0);
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /^PDD/ }).click();
  await expect(page.getByTestId('version-line')).toHaveText('The working draft reads exactly as approved version 1.');
  await expect(page.getByTestId('versions')).toContainText('Approved versions (1)');

  // A section edit after approval: an unapproved change, and Documents lists that one section.
  const doc = page.getByTestId('document');
  // The first section a person can edit that has generated text: a run of plain words from it, to look for later.
  const section = doc.getByTestId('doc-section').filter({ has: page.getByRole('button', { name: /^Edit section/ }) }).filter({ has: page.locator('p.leading-7') }).first();
  const oldText = ((await section.locator('p.leading-7').first().innerText()).match(/[A-Za-z][A-Za-z ]{15,40}[A-Za-z]/)?.[0] ?? '').trim();
  expect(oldText.length).toBeGreaterThan(15);
  await section.getByRole('button', { name: /^Edit section/ }).click();
  await doc.getByRole('textbox').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type(NEW_TEXT);
  await doc.getByRole('button', { name: 'Save section' }).click();
  await expect(doc.getByTestId('edited-text').first()).toContainText(NEW_TEXT);
  await expect(status).toHaveText('Approved version 1 · unapproved changes');
  const line = page.getByTestId('version-line');
  await expect(line).toContainText('You are looking at the working draft: 1 section reads differently. Approve again to make it version 2.');
  await expect(doc.getByTestId('chip-changed')).toHaveCount(1);
  await expect(doc.getByTestId('chip-changed')).toHaveText('Changed since version 1');
  await line.getByRole('button', { name: 'Review changes' }).click();
  await expect(line.getByTestId('change-list')).toContainText(NEW_TEXT);

  // A choice of approach for a step: an unapproved change too.
  await stage(page, 'Assessment');
  await page.getByRole('button', { name: 'Assessment of Check invoice totals' }).click();
  const panel = page.getByRole('dialog', { name: 'Check invoice totals' });
  // Facts first (as tests/e2e/assessment.spec.ts does), so the scoring recommends rules and a person can choose otherwise.
  await panel.getByLabel('Rules stated in full and stable for Check invoice totals').selectOption({ label: 'Yes' });
  await panel.getByLabel('Form of the input for Check invoice totals').selectOption({ label: 'Structured data' });
  await panel.getByLabel('Override recommendation').selectOption({ label: 'Keep with a person' });
  await panel.getByLabel('Rationale').fill('Auditors require a second person on totals checks.');
  await panel.getByRole('button', { name: 'Override' }).click();
  await expect(panel.getByTestId('override-note')).toContainText('Overridden by');
  await page.keyboard.press('Escape');
  await expect(status).toHaveText('Approved version 1 · unapproved changes');
  await stage(page, 'Documents');
  await expect(page.getByTestId('version-line')).toContainText('sections read differently');

  // Approving again: what changed is listed, and Approve stays off until the reason is given.
  await page.getByTestId('approve').click();
  const dialog = page.getByTestId('approve-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Approve version 2' })).toBeVisible();
  await expect(dialog.getByTestId('approve-changes')).toContainText('PDD: changed:');
  await expect(dialog.getByTestId('approve-confirm')).toBeDisabled();
  await dialog.getByTestId('approve-reason').fill('Too short');
  await expect(dialog.getByTestId('approve-problem')).toHaveText('Say why in at least 3 words.');
  await expect(dialog.getByTestId('approve-confirm')).toBeDisabled();
  await dialog.getByTestId('approve-reason').fill('Objectives reworded and the totals check kept with a person');
  await shot(page, '80-approve-version-2');
  await dialog.getByTestId('approve-confirm').click();
  await expect(status).toHaveText('Approved version 2');
  await expect(page.getByTestId('approve')).toHaveCount(0);

  // The list of versions: newest first, with the reason and what changed.
  await stage(page, 'Documents');
  await page.getByTestId('versions').getByRole('button', { name: 'Approved versions (2)' }).click();
  const rows = page.getByTestId('version-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-number', '2');
  await expect(rows.nth(0).getByTestId('version-reason')).toHaveText('Objectives reworded and the totals check kept with a person');
  await expect(rows.nth(0).getByTestId('version-changes')).toContainText('What changed:');
  await expect(rows.nth(1).getByTestId('version-reason')).toHaveText('The first approved version.');
  await shot(page, '81-versions-list');

  // Version 1 opens as it read before the edit, and downloads so.
  await rows.nth(1).getByTestId('version-open').click();
  const kept = page.getByTestId('kept-version');
  await expect(kept).toHaveAttribute('data-number', '1');
  await expect(page.getByTestId('version-band')).toContainText('Approved version 1, approved on');
  await expect(page.getByTestId('version-band')).toContainText('As kept at approval.');
  await expect(kept.getByRole('tab', { name: /Evidence pack/ })).toHaveCount(0);
  await kept.getByRole('tab', { name: /^PDD/ }).click();
  await expect(kept.getByTestId('document')).not.toContainText(NEW_TEXT);
  await expect(kept.getByTestId('document')).toContainText(oldText);
  await expect(kept.getByRole('button', { name: /^Edit section/ })).toHaveCount(0);
  await shot(page, '82-version-1-opened');
  const md = await download(page, page.getByTestId('version-markdown'));
  expect(md.name).toBe('PDD - Vendor invoice processing - version 1.md');
  const mdText = Buffer.from(md.bytes).toString('utf8');
  expect(mdText).toContain(oldText);
  expect(mdText).not.toContain(NEW_TEXT);
  const word = await download(page, page.getByTestId('version-word'));
  expect(word.name).toBe('PDD - Vendor invoice processing - version 1.docx');
  const wordBody = await wordText(word.bytes);
  expect(wordBody).toContain(oldText);
  expect(wordBody).not.toContain(NEW_TEXT);

  // Version 2 holds the edit.
  // Back to the working draft: the list is still open where the person left it.
  await page.getByTestId('version-back').click();
  await expect(page.getByTestId('versions').getByRole('button', { name: 'Approved versions (2)' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByTestId('version-row').nth(0).getByTestId('version-open').click();
  await page.getByTestId('kept-version').getByRole('tab', { name: /^PDD/ }).click();
  await expect(page.getByTestId('kept-version').getByTestId('document')).toContainText(NEW_TEXT);
  const md2 = await download(page, page.getByTestId('version-markdown'));
  expect(md2.name).toBe('PDD - Vendor invoice processing - version 2.md');
  expect(Buffer.from(md2.bytes).toString('utf8')).toContain(NEW_TEXT);
  await page.getByTestId('version-back').click();

  // A viewer's switch of the maps' shape lasts for the visit, is not saved, and marks nothing.
  await page.evaluate(() => {
    const KEY = 'avala.journey.memory.v1';
    const s = JSON.parse(localStorage.getItem(KEY)!);
    for (const w of s.workspaces) { w.role = 'viewer'; w.canApprove = false; }
    localStorage.setItem(KEY, JSON.stringify(s));
  });
  await page.reload();
  await stage(page, 'Flows');
  const map = page.getByTestId('flow-map');
  const was = await map.getAttribute('data-shape');
  const other = was === 'simple' ? 'swimlanes' : 'simple';
  await page.getByTestId('map-shape').getByRole('button', { name: other === 'simple' ? 'Simple flow' : 'Swimlanes' }).click();
  await expect(map).toHaveAttribute('data-shape', other);
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /^PDD/ }).click();
  await expect(page.getByTestId('version-line')).toHaveText('The working draft reads exactly as approved version 2.');
  await expect(page.getByTestId('document').getByTestId('chip-changed')).toHaveCount(0);
  await expect(status).toHaveText('Approved version 2');
});
