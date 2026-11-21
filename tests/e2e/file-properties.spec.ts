// A downloaded file's own properties name no person or account (marketing package, part 3). The Word file is
// read the way Word reads it, from its docProps parts; the PDF is the browser's own print, as "Print or save as
// PDF" makes it, read from its information block. Both on the public demo, signed out.
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { openZip } from '../../domain/ingest/zip.ts';

const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

async function openPdd(page: Page) {
  await page.goto('/demo');
  await expect(page).toHaveURL(/\/demo\/process\/[0-9a-f-]{36}\/assessment$/);
  await stage(page, 'Documents');
  await page.getByRole('tab', { name: /PDD/ }).click();
  await expect(page.getByTestId('document')).toContainText('Process Definition Document');
}

/** The child elements of an XML properties part, as name → text. */
const elements = (xml: string, root: string): Record<string, string> => {
  const inner = xml.match(new RegExp(`<${root}[^>]*>([\\s\\S]*)</${root}>`))?.[1] ?? '';
  return Object.fromEntries([...inner.matchAll(/<([\w:]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]]));
};

test('the Word download: author and last editor are Avala OS, and no other property is set', async ({ page }) => {
  await openPdd(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download Word' }).click()]);
  const zip = openZip(new Uint8Array(fs.readFileSync(await download.path())));
  const core = elements((await zip.readText('docProps/core.xml')) ?? '', 'cp:coreProperties');
  expect(Object.keys(core).sort()).toEqual(['cp:lastModifiedBy', 'cp:revision', 'dc:creator', 'dc:description', 'dc:title', 'dcterms:created', 'dcterms:modified']);
  expect(core['dc:creator']).toBe('Avala OS');
  expect(core['cp:lastModifiedBy']).toBe('Avala OS');
  expect(core['dc:title']).toBe('Process Definition Document: Vendor invoice processing (India, company code 1000)');
  expect(Object.keys(elements((await zip.readText('docProps/app.xml')) ?? '', 'Properties'))).toEqual([]);
  expect((await zip.readText('docProps/custom.xml')) ?? '').not.toMatch(/<property\b/);
  for (const part of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml']) expect((await zip.readText(part)) ?? '').not.toMatch(/@|Un-named/);
});

test('the printed PDF: the page title and the browser\'s own name, never an author', async ({ page }) => {
  await openPdd(page);
  await page.emulateMedia({ media: 'print' });
  const bytes = (await page.pdf()).toString('latin1');
  const info = Object.fromEntries([...bytes.matchAll(/\/(Title|Author|Subject|Keywords|Creator|Producer|CreationDate|ModDate)\s*\(((?:\\.|[^\\)])*)\)/g)].map(m => [m[1], m[2]]));
  expect(info.Producer, 'the information block was read').toMatch(/Skia/);
  expect(Object.keys(info).every(k => ['Title', 'Creator', 'Producer', 'CreationDate', 'ModDate'].includes(k))).toBe(true);
  expect(info.Author).toBeUndefined();
  expect(info.Title).toBe(await page.title());
  expect(Object.values(info).join(' ')).not.toMatch(/@/);
});
