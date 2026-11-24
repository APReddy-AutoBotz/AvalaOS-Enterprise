// The section editor (Tiptap) gives back exactly what it was given (the Tiptap upgrade, plan
// `claude/csp-and-tiptap-plan-24-nov.md` in the owner's project). Opening a section and saving it without a
// change must write the same cleaned text, or an approved version would show "unapproved changes" for words
// nobody changed. The cases: every editable section of every document of the demo's sample, opened as a
// person opens it, and a hand-made set (marks, line breaks, sub-headings, lists inside lists, a section
// ending in a list or a sub-heading, an empty paragraph, entities, and what a person might paste).
//
// The results go to test-results/editor/roundtrip.json (printed to CI's log on claude/ branches). Where
// tests/e2e/fixtures/editor-roundtrip-v2.json is present, the results Tiptap 2 gave, every case must give
// exactly the same cleaned text.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { sanitizeHtml } from '../../domain/docs/edits.ts';
import { signInAndCreateProcess } from './helpers.ts';

const OUT = path.resolve('test-results', 'editor', 'roundtrip.json');
const FIXTURE = path.resolve('tests', 'e2e', 'fixtures', 'editor-roundtrip-v2.json');
const stage = (page: Page, name: string) => page.getByRole('navigation', { name: 'Stages' }).getByRole('link', { name }).click();

const LONG = Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} of a long section, with words enough to wrap.`).join(' ');
const CASES: Record<string, string> = {
  plain: '<p>Cut the time from receipt to posting.</p>',
  marks: '<p>One <strong>bold</strong> and <em>italic</em> word.</p>',
  'marks nested': '<p><strong><em>Both</em></strong> at once, <em>then <strong>inside</strong></em>.</p>',
  'b and i': '<p><b>Old bold</b> and <i>old italic</i>.</p>',
  'line break': '<p>First line<br>Second line</p>',
  'sub-headings': '<h3>Heading three</h3><p>Text.</p><h4>Heading four</h4><p>More.</p>',
  'other heading levels': '<h2>Big heading</h2><p>Under it.</p><h5>Small heading</h5>',
  bullets: '<ul><li><p>One</p></li><li><p>Two</p></li></ul>',
  'items without paragraphs': '<ul><li>One</li><li>Two</li></ul>',
  numbers: '<ol><li><p>First</p></li><li><p>Second</p></li></ol>',
  'lists inside lists': '<ul><li><p>Outer</p><ul><li><p>Inner</p></li></ul></li><li><p>Next</p><ol><li><p>Numbered inside</p></li></ol></li></ul>',
  'ends in a list': '<p>Intro.</p><ul><li><p>Last item</p></li></ul>',
  'ends in a numbered list': '<p>Intro.</p><ol><li><p>Last step</p></li></ol>',
  'ends in a sub-heading': '<p>Intro.</p><h4>Closing heading</h4>',
  'empty paragraph': '<p>Before.</p><p></p><p>After.</p>',
  entities: '<p>Tom &amp; Jerry: 3 &lt; 5 &gt; 2, "quoted" and \'single\', a&nbsp;space.</p>',
  spaces: '<p>Two  spaces and a trailing space </p>',
  long: `<p>${LONG}</p>`,
  'bare text': 'Just text, no tags',
  empty: '<p></p>',
  'pasted link': '<p>See <a href="https://example.com">the site</a>.</p>',
  'pasted underline': '<p><u>Under</u> lined.</p>',
  'pasted strike': '<p><s>Gone</s> text.</p>',
  'pasted code': '<p>Run <code>x = 1</code> now.</p><pre><code>block of code</code></pre>',
  'pasted quote and rule': '<blockquote><p>Quoted.</p></blockquote><hr><p>After the rule.</p>',
  'pasted table': '<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table><p>Below.</p>',
  'pasted styles': '<p><span style="color:red">Red</span> and <span class="x">classed</span>.</p>',
};

/** The open section editor's own Tiptap instance (Tiptap keeps it on its element, for tests). */
const editorHtml = (page: Page, content?: string) => page.evaluate((c) => {
  const el = document.querySelector('[data-testid="section-editor"] .ProseMirror') as (HTMLElement & { editor?: { getHTML(): string; commands: { setContent(c: string): boolean } } }) | null;
  if (!el?.editor) throw new Error('No section editor is open.');
  if (c !== undefined) el.editor.commands.setContent(c);
  return el.editor.getHTML();
}, content);

test('opening and saving without a change gives back the same text, for every section of the sample and every case', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/demo');
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  const sections: Record<string, string> = {};
  const tabs = page.getByRole('tab', { name: /^(PDD|SDD|BRD|FRD|Agent)/ });
  const tabNames = (await tabs.allInnerTexts()).map(t => t.trim());
  for (const [i, tabName] of tabNames.entries()) {
    await tabs.nth(i).click();
    const buttons = doc.getByRole('button', { name: /^Edit section / });
    const labels = await buttons.evaluateAll(els => els.map(e => e.getAttribute('aria-label') ?? e.textContent ?? ''));
    for (const label of labels) {
      await doc.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByTestId('section-editor')).toBeVisible();
      sections[`${tabName.match(/^(PDD|SDD|BRD|FRD|Agent)/)![1]} ${label}`] = sanitizeHtml(await editorHtml(page));
      await page.getByTestId('section-editor').getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('section-editor')).toHaveCount(0);
    }
  }
  expect(Object.keys(sections).length).toBeGreaterThan(20);

  // The hand-made cases, in one open editor, as its content is set when a section opens.
  await tabs.first().click();
  await doc.getByRole('button', { name: /^Edit section / }).first().click();
  const cases: Record<string, string> = {};
  for (const [name, html] of Object.entries(CASES)) cases[name] = sanitizeHtml(await editorHtml(page, html));
  await page.getByTestId('section-editor').getByRole('button', { name: 'Cancel' }).click();

  const result = { sections, cases };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
  // Tags a save never keeps never come out of the editor's cleaned text.
  for (const html of [...Object.values(sections), ...Object.values(cases)]) expect(html).not.toMatch(/<(a|u|s|code|pre|table|blockquote|hr|span)\b/);
  if (fs.existsSync(FIXTURE)) expect(result).toEqual(JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
});

test('the editor allows what it allowed: Bold shows as pressed, no underline, a typed address stays text, pasting keeps only the allowed tags', async ({ page }) => {
  await page.goto('/demo');
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await doc.getByRole('button', { name: /^Edit section / }).first().click();
  const editor = page.getByTestId('section-editor');
  const box = editor.getByRole('textbox');
  await box.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Plain words');
  const bold = editor.getByRole('button', { name: 'Bold' });
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('ControlOrMeta+a');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'true');
  await bold.click();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');

  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Under');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('ControlOrMeta+u');
  await page.keyboard.press('End');
  await page.keyboard.type(' see https://example.com now ');
  const typed = await editorHtml(page);
  expect(typed).not.toMatch(/<u\b|<a\b/);
  expect(typed).toContain('https://example.com');

  const pasted = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="section-editor"] .ProseMirror') as HTMLElement & { editor: { view: { pasteHTML(h: string): boolean }; getHTML(): string; commands: { setContent(c: string): boolean } } };
    el.editor.commands.setContent('<p></p>');
    el.editor.view.pasteHTML('<p>See <a href="https://example.com">the site</a>, <u>under</u>, <s>gone</s>, <code>x = 1</code>.</p><table><tbody><tr><td>A</td></tr></tbody></table><blockquote><p>Quoted</p></blockquote>');
    return el.editor.getHTML();
  });
  expect(pasted).not.toMatch(/<(a|u|s|code|table|td|blockquote)\b/);
  expect(pasted).toContain('the site');
  await editor.getByRole('button', { name: 'Cancel' }).click();
});

test('"Draft with AI" fills the editor, and the check of what the process does not have still shows', async ({ page }) => {
  const reply = { sentences: [{ text: 'Each invoice takes 42 minutes to check.', segmentId: 'f:process' }] };
  await page.addInitScript(r => { (window as unknown as { __avalaStandIns: unknown }).__avalaStandIns = { draftNarrative: [r] }; }, reply);
  await signInAndCreateProcess(page);
  await stage(page, 'Process');
  await page.getByRole('button', { name: 'Start the process model' }).click();
  await page.getByRole('tab', { name: /^Steps/ }).click();
  await page.getByLabel('New step', { exact: true }).fill('Check invoice totals');
  await page.getByRole('button', { name: 'Add step' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('All changes saved');
  await stage(page, 'Documents');
  const doc = page.getByTestId('document');
  await doc.getByRole('button', { name: /^Edit section / }).first().click();
  const editor = page.getByTestId('section-editor');
  await editor.getByRole('button', { name: 'Draft with AI' }).click();
  await expect(editor.getByRole('status')).toHaveText('Drafted 1 sentence from the process. Read and change it before saving.');
  await expect(editor.getByRole('textbox')).toContainText('Each invoice takes 42 minutes to check.');
  await expect(editor.getByTestId('grounding-issues')).toContainText('42');
});
