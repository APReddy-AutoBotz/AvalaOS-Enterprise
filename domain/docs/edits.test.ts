import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { updateFact } from '../processModel/patch.ts';
import { buildPdd } from './pdd.ts';
import { toMarkdown } from './markdown.ts';
import { applyLayout } from './layout.ts';
import { applyEdits, EditError, newEdit, richMarkdown, richParas, sanitizeHtml } from './edits.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const pdd = (m: ProcessModel) => buildPdd({ model: m, assessment: assessProcess(m), decisions: emptyDecisions(), sources: [], revision: { label: 'r', state: 'working', date: 'd' } });
const sec = (d: ReturnType<typeof pdd>, n: string) => d.sections.find(s => s.number === n)!;

test('sanitising keeps only the editor\'s tags and drops attributes, scripts and comments', () => {
  assert.equal(sanitizeHtml('<p onclick="x()">Hi <strong class="a">there</strong><script>alert(1)</script><!-- c --><img src=x onerror=y></p>'), '<p>Hi <strong>there</strong></p>');
  assert.equal(sanitizeHtml('<a href="javascript:x">link</a>'), 'link');
  assert.throws(() => sanitizeHtml('x'.repeat(100_001)), EditError);
});

test('edited HTML reads back as paragraphs, list items and runs for Word and Markdown', () => {
  const html = '<p>We <strong>always</strong> post <em>same day</em>.</p><ul><li><p>First</p></li><li><p>Second</p></li></ul><ol><li><p>One</p></li></ol>';
  const p = richParas(html);
  assert.deepEqual(p.map(x => x.kind), ['p', 'li', 'li', 'li']);
  assert.deepEqual(p[0].runs, [{ text: 'We ' }, { text: 'always', bold: true }, { text: ' post ' }, { text: 'same day', italic: true }, { text: '.' }]);
  assert.equal(p[3].ordered, true);
  assert.equal(richMarkdown(html), 'We **always** post *same day*.\n\n- First\n- Second\n1. One');
  assert.equal(richMarkdown('<p>Cut it.<strong> Always.</strong></p>'), 'Cut it. **Always.**');
});

test('an edit replaces the narrative, keeps the tables, survives a rebuild and a layout, and needs review when the generated text changes', () => {
  const d = pdd(gold);
  const s = sec(d, '2.1');
  const e = newEdit('pdd', s, '<p>Our own overview of the AP process.</p>');
  const once = applyEdits(d, [e]);
  const edited = sec(once.doc, '2.1');
  assert.equal(once.status[s.id].state, 'edited');
  assert.equal(edited.blocks.filter(b => b.kind === 'rich').length, 1);
  assert.equal(edited.blocks.filter(b => b.kind === 'paragraph').length, 0);
  assert.equal(edited.blocks.filter(b => b.kind !== 'rich').length, s.blocks.filter(b => !['paragraph', 'list', 'callout'].includes(b.kind)).length);
  assert.match(toMarkdown(once.doc), /Our own overview of the AP process\./);
  // Rebuilt from the same model and moved by a layout: still edited, same section.
  const laid = applyLayout(pdd(gold), { sections: { '2.1': { title: 'Overview' } }, order: ['2', '1'], custom: [] });
  const again = applyEdits(laid, [e]);
  assert.equal(again.status[s.id].state, 'edited');
  assert.ok(again.doc.sections.find(x => x.id === s.id)!.blocks.some(b => b.kind === 'rich'));
  // The model changes what section 1.2 says: an edit made before is flagged, and the generated text is offered.
  const s12 = sec(d, '1.2');
  const e12 = newEdit('pdd', s12, '<p>Objectives as we see them.</p>');
  const m2 = updateFact(gold, { target: { kind: 'meta', field: 'objective' }, value: 'Post every invoice within two days.' }).model;
  const after = applyEdits(pdd(m2), [e, e12]);
  assert.equal(after.status[s12.id].state, 'needs_review');
  assert.match(after.status[s12.id].generatedHtml, /within two days/);
  assert.equal(after.status[s.id].state, 'edited');
  // Edits for another document type are ignored.
  assert.equal(applyEdits(d, [{ ...e, docType: 'brd' }]).status[s.id].state, 'generated');
});

test('an empty edit is refused', () => {
  assert.throws(() => newEdit('pdd', sec(pdd(gold), '2.1'), '<p> </p>'), EditError);
});
