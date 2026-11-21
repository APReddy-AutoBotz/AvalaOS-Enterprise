// The Word file's own properties (marketing package, part 3): nothing in them names a person or an account, in
// any workspace. Reads the properties the way Word does, from the file's docProps parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openZip } from '../ingest/zip.ts';
import { buildPdd } from './pdd.ts';
import { assessProcess } from '../assess/process.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import type { DocInput } from './common.ts';
import type { ProcessModel } from '../processModel/types.ts';

const gold: ProcessModel = JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const input = (m: ProcessModel): DocInput => ({ model: m, assessment: assessProcess(m), decisions: emptyDecisions(), sources: [{ key: 'call-1', title: 'Discovery call' }], revision: { label: 'Working draft', state: 'working', date: '21 November 2026' } });

/** The child elements of a properties part, as [name, text]. */
function elements(xml: string, root: string): [string, string][] {
  const inner = xml.match(new RegExp(`<${root}[^>]*>([\\s\\S]*)</${root}>`))?.[1] ?? '';
  return [...inner.matchAll(/<([\w:]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g)].map(m => [m[1], m[2]]);
}

async function properties(style?: Parameters<typeof import('./docx.ts')['docxDocument']>[1]['style']) {
  const { docxDocument } = await import('./docx.ts');
  const { Packer } = await import('docx');
  const doc = buildPdd(input(gold));
  const zip = openZip(new Uint8Array(await Packer.toBuffer(docxDocument(doc, { draft: true, style }))));
  const props = zip.names.filter(n => n.startsWith('docProps/') && !n.endsWith('/'));
  return { doc, props, core: (await zip.readText('docProps/core.xml')) ?? '', app: (await zip.readText('docProps/app.xml')) ?? '', custom: (await zip.readText('docProps/custom.xml')) ?? '' };
}

test('the Word file: author and last editor are Avala OS; title and description name only the document and the process', async () => {
  const { doc, props, core, app, custom } = await properties();
  assert.deepEqual(props.sort(), ['docProps/app.xml', 'docProps/core.xml', 'docProps/custom.xml']);
  const found = Object.fromEntries(elements(core, 'cp:coreProperties'));
  assert.deepEqual(Object.keys(found).sort(), ['cp:lastModifiedBy', 'cp:revision', 'dc:creator', 'dc:description', 'dc:title', 'dcterms:created', 'dcterms:modified']);
  assert.equal(found['dc:creator'], 'Avala OS');
  assert.equal(found['cp:lastModifiedBy'], 'Avala OS');
  assert.equal(found['dc:title'], `${doc.title}: ${doc.subtitle}`);
  assert.equal(found['dc:description'], `PDD for ${doc.subtitle}`);
  assert.equal(found['cp:revision'], '1');
  // The extended and custom properties hold nothing: no company, manager, application user or keywords.
  assert.deepEqual(elements(app, 'Properties'), []);
  assert.doesNotMatch(app, /Company|Manager|Keywords/);
  assert.doesNotMatch(custom, /<property\b/);
  assert.doesNotMatch(core, /Un-named|@/);
});

test('the same properties with a company\'s branding: the organisation stays in the page header, never in the properties', async () => {
  const { core, app } = await properties({ font: 'Arial', accent: '7A1F5C', organisation: 'Acme Corp' });
  const found = Object.fromEntries(elements(core, 'cp:coreProperties'));
  assert.equal(found['dc:creator'], 'Avala OS');
  assert.equal(found['cp:lastModifiedBy'], 'Avala OS');
  assert.doesNotMatch(core + app, /Acme Corp/);
});
