import { test, expect } from '@playwright/test';
import { INTERNAL, primaryText, shot, signInAndCreateProcess } from './helpers.ts';

const corpus = (name: string) => `eval/corpus/ap-invoice/sources/${name}`;

test('sources are read in the browser and listed; files that cannot be read say why', async ({ page }) => {
  await signInAndCreateProcess(page);
  await expect(page.getByRole('heading', { name: 'No sources yet' })).toBeVisible();

  await page.getByLabel('Upload source files').setInputFiles([
    corpus('01-discovery-call-2026-10-06.vtt'),
    corpus('04-SOP-FIN-AP-004-vendor-invoice-processing.docx'),
    corpus('05-AP-Invoice-AsIs.drawio'),
    corpus('06-AP-Invoice-AsIs.png'),
  ]);
  const notes = page.getByTestId('upload-note');
  await expect(notes).toHaveCount(4, { timeout: 20_000 });
  await expect(notes.filter({ hasText: '05-AP-Invoice-AsIs.drawio' })).toContainText('Added: 46 passages');
  await expect(notes.filter({ hasText: '06-AP-Invoice-AsIs.png' })).toContainText('not available in local mode');

  const rows = page.getByTestId('source-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: 'Meeting transcript' })).toContainText('01 discovery call 2026 10 06');
  await expect(rows.filter({ hasText: 'Word document' })).toBeVisible();
  await expect(rows.filter({ hasText: 'Flowchart (draw.io)' })).toContainText('46 passages');
  await expect(page.getByRole('button', { name: 'Extract from 3 sources' })).toBeDisabled();
  await expect(page.getByText('Extraction runs on the server and is not available in local mode.')).toBeVisible();
  expect(await primaryText(page)).not.toMatch(INTERNAL);
  await shot(page, '20-sources');

  // Archiving keeps the source listed, out of the next extraction.
  await rows.filter({ hasText: 'Word document' }).getByRole('button', { name: 'Archive' }).click();
  await expect(rows.filter({ hasText: 'Word document' })).toContainText('archived');
  await expect(page.getByRole('button', { name: 'Extract from 2 sources' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('source-row')).toHaveCount(3);
});
