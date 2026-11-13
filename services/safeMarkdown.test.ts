import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { escapePlainText, isSafeMarkdownHref, renderSafeMarkdown } from './safeMarkdown';

for (const href of [
  'https://example.com/path',
  'http://localhost:3000/path',
  'mailto:security@example.com',
  '/workspace/document',
  '#section',
]) {
  assert.equal(isSafeMarkdownHref(href), true, href);
}

for (const href of [
  'javascript:alert(1)',
  'java\nscript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  '//attacker.example/path',
  'relative/path',
  '',
]) {
  assert.equal(isSafeMarkdownHref(href), false, href);
}

assert.equal(
  escapePlainText(`<img src=x onerror="alert('x')">`),
  '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
);

assert.equal(
  renderSafeMarkdown('<script>alert(1)</script>\n**safe**'),
  '&lt;script&gt;alert(1)&lt;/script&gt;<br />**safe**',
);

for (const sink of [
  'components/docs/RefineSectionModal.tsx',
]) {
  const source = readFileSync(sink, 'utf8');
  assert.match(source, /renderSafeMarkdown/);
  assert.doesNotMatch(source, /window\.marked\s*\?\s*window\.marked\.parse/);
  assert.doesNotMatch(source, /window\.marked\.parse/);
}

const sanitizerSource = readFileSync('services/safeMarkdown.ts', 'utf8');
assert.match(sanitizerSource, /import DOMPurify from 'dompurify'/);
assert.match(sanitizerSource, /DOMPurify\.sanitize/);
assert.match(sanitizerSource, /isSafeMarkdownHref/);
assert.match(sanitizerSource, /sanitizeMermaidSvg/);

const mermaidSource = readFileSync('components/shared/MermaidRenderer.tsx', 'utf8');
assert.match(mermaidSource, /securityLevel:\s*'strict'/);
assert.match(mermaidSource, /htmlLabels:\s*false/);
assert.match(mermaidSource, /sanitizeMermaidSvg\(renderedSvg\)/);

console.log('Unsafe rendering regression suite passed.');
