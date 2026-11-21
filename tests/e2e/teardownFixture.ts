// The made-up teardown of domain/site/fixtures/teardown/, built by the same function that builds a real
// teardown's file, and served at the address a real one would have (tests/e2e/teardown.spec.ts and
// visits-site.spec.ts).
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { teardownState, type TeardownRun } from '../../domain/site/teardownState.ts';
import type { TeardownWords } from '../../domain/site/teardowns.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';

const dir = new URL('../../domain/site/fixtures/teardown/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir));
export const teardownWords: TeardownWords = JSON.parse(read('teardown.json').toString());
const run: TeardownRun = JSON.parse(read('run.json').toString());
const state = teardownState({ words: teardownWords, model: JSON.parse(read('model.json').toString()) as ProcessModel, run, files: Object.fromEntries(Object.values(run.files).map(f => [f, new Uint8Array(read(f))])) });

/** Serves the demo's list of teardowns (this one only) and its file. */
export async function serveTeardown(page: Page) {
  const body = JSON.stringify(await state);
  await page.route('**/demo-data/teardowns/index.json', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ slug: teardownWords.slug, short: teardownWords.short }]) }));
  await page.route(`**/demo-data/teardowns/${teardownWords.slug}.json`, r => r.fulfill({ contentType: 'application/json', body }));
}
