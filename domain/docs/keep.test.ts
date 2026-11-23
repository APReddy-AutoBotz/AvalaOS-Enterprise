// Package 14, pull request 1: what approval keeps. Built from the demo's sample as the Documents page
// reads it. For each kind of change after approval, the set kept before it is untouched, and the working
// draft's set differs in exactly the sections that change touches (the fingerprint comparison agrees,
// section for section, with the line comparison the Documents page has used since WP3.5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { loadSample, keepInputOf, type SampleState } from './fixtures/keepSample.ts';
import { buildKeptDocuments, fingerprintsOf, keptInputs, keptLook, keptSizes, keptTypes, KEPT_FORMAT, KeptFormatError, readKept, sectionFingerprint, type KeptDocuments, type KeptLook } from './keep.ts';
import { versionChanges } from './versions.ts';
import { changedSections } from './changes.ts';
import { withCosts, withMapShape, withOverride, withRate } from '../assess/decisions.ts';
import { assessProcess } from '../assess/process.ts';
import { DEFAULT_SETTINGS } from '../assess/settings.ts';
import { setPurpose } from '../processModel/patch.ts';
import { toMarkdown } from './markdown.ts';
import { openZip } from '../ingest/zip.ts';
import { docxStyleFrom } from './docx.ts';
import { DEFAULT_BRANDING } from './branding.ts';

const sample = await loadSample();
const kept = buildKeptDocuments(keepInputOf(sample));
const look = keptLook(sample.docSettings.branding);
const keptText = JSON.stringify(kept);

/** The draft after one change, compared with the kept set: by fingerprints, and by lines per document. */
function after(change: (s: SampleState) => void) {
  const s = structuredClone(sample);
  change(s);
  const draft = buildKeptDocuments(keepInputOf(s, { label: 'Working draft', state: 'working', date: '22 November 2026' }));
  const byPrint = versionChanges({ kept, look }, { kept: draft, look });
  const byLines = Object.entries(draft.documents).flatMap(([t, d]) => (t !== 'evidence' && kept.documents[t as 'pdd'] ? changedSections(kept.documents[t as 'pdd']!, d!).map(c => `${t}:${c.id}`) : []));
  return { s, draft, byPrint, prints: byPrint.sections.map(c => `${c.doc}:${c.id}`), byLines };
}

test('approval keeps every document the page offers, in format 1, with no PNG and the SDD as final', () => {
  assert.deepEqual(keptTypes(keepInputOf(sample)), ['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests']);
  assert.deepEqual(Object.keys(kept.documents), ['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests']);
  assert.equal(kept.format, KEPT_FORMAT);
  assert.ok(!keptText.includes('"png"'), 'a map is kept as drawn (SVG and Mermaid), never as the browser\'s PNG');
  assert.ok(kept.documents.pdd!.sections.some(s => s.blocks.some(b => b.kind === 'figure' && b.svg.startsWith('<svg'))));
  assert.ok(kept.documents.sdd!.control.some(r => r.key === 'Status' && r.value === 'Approved'), 'the SDD is kept as approved, never as the preview');
  assert.ok(kept.testPack && kept.testPack.cases.length > 0, 'the test pack as run is kept for its spreadsheet download');
});

test('documented as it is, approval keeps the PDD alone (the evidence pack only when its record is given)', () => {
  const s = structuredClone(sample);
  s.model = setPurpose(s.model, { value: 'as_is', by: 'u1', at: '2026-11-21T10:00:00.000Z' }).model;
  assert.deepEqual(keptTypes(keepInputOf(s)), ['pdd']);
});

const KINDS: [string, (s: SampleState) => void, string[] | 'some'][] = [
  ['a section edit', s => { s.edits.push({ docType: 'pdd', sectionKey: 's-1-1', html: '<p>Edited by a person.</p>', baseHash: 'x' }); }, ['pdd:s-1-1']],
  ['a person\'s choice of approach for a step', s => {
    const a = assessProcess(s.model, { rate: s.decisions.rate, settings: s.settings, decisions: s.decisions });
    s.decisions = withOverride(s.decisions, a.steps.find(x => x.winner !== 'human')!, { approach: 'human', rationale: 'Kept with people for now.', by: 'A', byId: 'u1', at: '2026-11-21T10:00:00Z' });
  }, 'some'],
  ['the rate', s => { s.decisions = withRate(s.decisions, { amount: 40, currency: 'EUR', enteredBy: 'A' }); }, ['brd:s-11']],
  ['the costs', s => { s.decisions = withCosts(s.decisions, { build: 1000, running: 100, enteredBy: 'A' }); }, ['brd:s-11']],
  ['the maps\' shape, saved', s => { s.decisions = withMapShape(s.decisions, { shape: 'simple', suggested: 'swimlanes', by: 'A', byId: 'u1', at: '2026-11-21T10:00:00Z' }); }, ['pdd:s-2-3', 'pdd:s-3-1']],
  ['a requirement\'s wording', s => { const r = s.stored.find(x => x.kind === 'FR')!; r.statement += ' Edited.'; r.edited = true; }, 'some'],
  ['a tester\'s edit', s => { s.testEdits.push({ caseCode: kept.testPack!.cases[0].code, fields: { expected: 'Edited expected result.' }, setAside: false, baseHash: 'x' }); }, ['tests:s-3']],
  ['a source added', s => { s.sources.push({ key: 'doc-9', title: 'A new source' }); }, ['pdd:s-5']],
  ['the company layout', s => { s.docSettings.layouts = { pdd: { sections: { '2': { title: 'Renamed by the company' } }, custom: [] } }; }, ['pdd:s-2']],
  ['an edit to the process record', s => { (s.model.steps[0] as { name: string }).name = 'Renamed step'; }, 'some'],
];

for (const [kind, change, expected] of KINDS) {
  test(`after ${kind}: the kept set is unchanged, and the draft differs exactly where the change reaches`, () => {
    const r = after(change);
    assert.equal(JSON.stringify(kept), keptText, 'the kept set is a value: nothing done to the draft reaches it');
    assert.ok(r.prints.length > 0, 'the change shows in the draft');
    assert.deepEqual([...r.prints].sort(), [...r.byLines].sort(), 'the fingerprints mark the sections that read differently, and only those');
    if (expected !== 'some') assert.deepEqual([...r.prints].sort(), [...expected].sort());
  });
}

test('a requirement\'s wording reaches the FRD sections holding it; a choice of approach reaches every document it changes, and the agent document goes', () => {
  const req = after(s => { const r = s.stored.find(x => x.kind === 'FR')!; r.statement += ' Edited.'; r.edited = true; });
  assert.ok(req.prints.every(p => p.startsWith('frd:')), `only the FRD: ${req.prints.join(', ')}`);
  const choice = after(s => {
    const a = assessProcess(s.model, { rate: s.decisions.rate, settings: s.settings, decisions: s.decisions });
    s.decisions = withOverride(s.decisions, a.steps.find(x => x.winner === 'ai_assist' || x.winner === 'agent') ?? a.steps.find(x => x.winner !== 'human')!, { approach: 'human', rationale: 'Kept with people for now.', by: 'A', byId: 'u1', at: '2026-11-21T10:00:00Z' });
  });
  assert.deepEqual(choice.byPrint.documents, [{ doc: 'agent', kind: 'removed' }]);
});

test('a viewer\'s switch of the maps\' shape is never saved, so the draft built from the saved choices reads as kept', () => {
  const r = after(() => { /* the switch lives in the viewer's tab only (journey/process/mapShape.ts) */ });
  assert.deepEqual(r.prints, []);
  assert.deepEqual(r.byPrint.documents, []);
});

test('the workspace\'s assessment settings and the look: neither changes what the sample\'s sections say', () => {
  const settings = after(s => { s.settings = { ...(s.settings ?? DEFAULT_SETTINGS), hoursPerFte: 1500 }; });
  assert.deepEqual(settings.prints, [], 'the sample\'s documents state no hours per person; the line for a workspace change still names it (versions.ts)');
  const other: KeptLook = { ...look, organisation: 'Another name', logo: 'data:image/png;base64,AAAA' };
  assert.deepEqual(versionChanges({ kept, look }, { kept, look: other }).look, ['organisation', 'logo']);
});

test('a section\'s fingerprint ignores its number and the map\'s PNG; it follows its title and every block', () => {
  const s = kept.documents.pdd!.sections.find(x => x.blocks.some(b => b.kind === 'figure'))!;
  assert.equal(sectionFingerprint({ ...s, number: '9.9' }), sectionFingerprint(s));
  assert.equal(sectionFingerprint({ ...s, blocks: s.blocks.map(b => (b.kind === 'figure' ? { ...b, png: 'data:image/png;base64,AAAA' } : b)) }), sectionFingerprint(s));
  assert.notEqual(sectionFingerprint({ ...s, title: `${s.title}.` }), sectionFingerprint(s));
});

test('the inputs index: fingerprints of what the version was built from and the build, never a value or a name', () => {
  const index = keptInputs(keepInputOf(sample), { build: 'abc1234', settings: sample.settings });
  assert.equal(index.build, 'abc1234');
  assert.deepEqual(Object.keys(index.inputs).sort(), ['decisions', 'edits', 'layouts', 'names', 'requirements', 'settings', 'sources', 'testEdits']);
  assert.ok(Object.values(index.inputs).every(v => /^[0-9a-f]{16}$/.test(v)));
  const s = structuredClone(sample);
  s.edits.push({ docType: 'pdd', sectionKey: 's-1-1', html: '<p>Edited.</p>', baseHash: 'x' });
  const other = keptInputs(keepInputOf(s), { build: 'abc1234', settings: sample.settings });
  assert.notEqual(other.inputs.edits, index.inputs.edits);
  assert.equal(other.inputs.decisions, index.inputs.decisions);
  for (const name of Object.values(sample.names)) assert.ok(!JSON.stringify(index).includes(name));
});

test('a kept set in a format this release cannot read is refused, never guessed at', () => {
  assert.throws(() => readKept({ format: 2, documents: {} }), KeptFormatError);
  assert.throws(() => readKept(null), KeptFormatError);
  assert.equal(readKept(JSON.parse(keptText)).documents.pdd!.title, kept.documents.pdd!.title);
});

// ---- The frozen version (change b) ---------------------------------------------------------------------
// fixtures/kept-v1.json is a version kept by this release: the sample's documents and look as approval
// builds them, with their fingerprints. Every later release must pass this test unchanged: open it, write
// Word and Markdown from it, and compute the same fingerprints. Regenerate it never; add kept-v2.json beside
// it if the format is ever raised.
const FROZEN = new URL('./fixtures/kept-v1.json', import.meta.url);

test('the frozen version of format 1 still opens, writes Word and Markdown, and keeps its fingerprints', async () => {
  const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8')) as { kept: KeptDocuments; look: KeptLook; fingerprints: ReturnType<typeof fingerprintsOf> };
  const k = readKept(frozen.kept);
  assert.equal(k.format, 1);
  assert.deepEqual(fingerprintsOf(k), frozen.fingerprints, 'the fingerprints of a kept version are computed the same way by every release');
  const { docxDocument } = await import('./docx.ts');
  const { Packer } = await import('docx');
  for (const [type, doc] of Object.entries(k.documents)) {
    const md = toMarkdown(doc!);
    for (const s of doc!.sections) assert.ok(md.includes(s.title), `${type}: Markdown carries "${s.title}"`);
    const zip = openZip(new Uint8Array(await Packer.toBuffer(docxDocument(doc!, { draft: false, style: docxStyleFrom(frozen.look) }))));
    const body = (await zip.readText('word/document.xml')) ?? '';
    const firstParagraph = doc!.sections.flatMap(s => s.blocks).find(b => b.kind === 'paragraph');
    assert.ok(body.includes(doc!.title), `${type}: the Word file carries its title`);
    if (firstParagraph && firstParagraph.kind === 'paragraph') assert.ok(body.includes(firstParagraph.text.slice(0, 40).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')) || body.includes(firstParagraph.text.slice(0, 20)), `${type}: the Word file carries the kept text`);
  }
});

test('the frozen version is what this release keeps for the sample (only while format 1 is current)', () => {
  const frozen = JSON.parse(fs.readFileSync(FROZEN, 'utf8')) as { kept: KeptDocuments; look: KeptLook };
  assert.equal(KEPT_FORMAT, 1, 'raising the format: keep this file, add a fixture of the new format, and drop only this test');
  assert.deepEqual(frozen.look, keptLook(DEFAULT_BRANDING));
  assert.equal(Object.keys(frozen.kept.documents).join(), Object.keys(kept.documents).join());
});

test('the sample\'s kept set, measured (the evidence pack is measured in versions.test.ts)', () => {
  const sizes = keptSizes(kept);
  const gz = gzipSync(keptText).length;
  // Recorded in the pull request; the bounds only say the sample has not grown out of the free plan's reach.
  assert.ok(sizes.total > 150_000 && sizes.total < 600_000, `total ${sizes.total}`);
  assert.ok(gz < 120_000, `gzip ${gz}`);
  assert.ok(JSON.stringify(fingerprintsOf(kept)).length < 20_000);
});
