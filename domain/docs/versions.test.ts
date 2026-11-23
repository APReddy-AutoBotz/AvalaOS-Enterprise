// Package 14, pull request 1: what changed between versions, the reason rule, the tag and the Documents
// page's words (part N items 1 to 5 as approved on 21 November 2026, and the line for question 8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { loadSample, keepInputOf } from './fixtures/keepSample.ts';
import { buildKeptDocuments, fingerprintsOf, keptLook, keptSizes } from './keep.ts';
import { changeCount, changeLines, documentsLine, releaseProven, fingerprintChanges, keptLaterLabel, LEGACY_LABEL, openedVersionLine, REASON_LABEL, reasonHelp, reasonProblem, sectionDiff, sectionsDifferingFrom, versionChanges, versionFileName, versionTag } from './versions.ts';

const sample = await loadSample();
const v1 = buildKeptDocuments(keepInputOf(sample));
const look = keptLook(sample.docSettings.branding);

test('version 1 has nothing to compare with; the same documents give no change at all', () => {
  assert.deepEqual(versionChanges(null, { kept: v1, look }), { sections: [], documents: [], look: [] });
  assert.equal(changeCount(versionChanges({ kept: v1, look }, { kept: v1, look })), 0);
});

test('what changed lists exactly the sections that differ, documents added and removed, and the look', () => {
  const s = structuredClone(sample);
  s.edits.push({ docType: 'brd', sectionKey: 's-1', html: '<p>The business case, as the sponsor put it.</p>', baseHash: 'x' });
  const v2 = buildKeptDocuments(keepInputOf(s));
  delete v2.documents.agent;
  const after = { kept: v2, look: { ...look, accent: '112233' } };
  const c = versionChanges({ kept: v1, look }, after);
  assert.deepEqual(c.sections.map(x => [x.doc, x.id, x.kind]), [['brd', 's-1', 'changed']]);
  assert.deepEqual(c.documents, [{ doc: 'agent', kind: 'removed' }]);
  assert.deepEqual(c.look, ['accent']);
  const title = v1.documents.brd!.sections.find(x => x.id === 's-1')!.title;
  assert.deepEqual(changeLines(c), [`BRD: changed: ${title}.`, 'Agent definition no longer offered.', 'The look: the accent colour changed.']);
  assert.deepEqual(versionChanges(after, { kept: v1, look }).documents, [{ doc: 'agent', kind: 'added' }]);
});

test('a section added or removed is named with the title it reads under', () => {
  const before = { pdd: [{ id: 's-1', title: 'Purpose', fp: 'a' }, { id: 's-2', title: 'Old section', fp: 'b' }] };
  const after = { pdd: [{ id: 's-1', title: 'Purpose', fp: 'a' }, { id: 's-3', title: 'New section', fp: 'c' }] };
  assert.deepEqual(fingerprintChanges(before, after).sections, [{ doc: 'pdd', id: 's-3', title: 'New section', kind: 'added' }, { doc: 'pdd', id: 's-2', title: 'Old section', kind: 'removed' }]);
});

test('the Documents page compares the draft with the kept fingerprints alone, and fetches a section only to show its lines', () => {
  const prints = fingerprintsOf(v1);
  const s = structuredClone(sample);
  s.edits.push({ docType: 'pdd', sectionKey: 's-1-1', html: '<p>Edited.</p>', baseHash: 'x' });
  const draft = buildKeptDocuments(keepInputOf(s, { label: 'Working draft', state: 'working', date: '22 November 2026' }));
  assert.deepEqual([...sectionsDifferingFrom(prints, 'pdd', draft.documents.pdd!)], ['s-1-1']);
  assert.deepEqual([...sectionsDifferingFrom(prints, 'frd', draft.documents.frd!)], []);
  const diff = sectionDiff(v1.documents.pdd, draft.documents.pdd, 's-1-1');
  assert.ok(diff.some(l => l.op === 'add' && l.text.includes('Edited.')));
  assert.ok(diff.some(l => l.op === 'del'));
});

test('the evidence pack is kept with a version but never compared', () => {
  const withPack = buildKeptDocuments({ ...keepInputOf(sample), evidence: sample.evidence });
  assert.ok(withPack.documents.evidence, 'kept');
  assert.equal(fingerprintsOf(withPack).evidence, undefined, 'no fingerprint, so it never counts as a change');
  const moved = structuredClone(withPack);
  moved.documents.evidence!.sections[0].title += ' (board moved)';
  assert.equal(changeCount(versionChanges({ kept: withPack, look }, { kept: moved, look })), 0);
  // Measured for the pull request: the whole set with the evidence pack, as JSON and compressed.
  const sizes = keptSizes(withPack);
  assert.ok(sizes.evidence > 0 && sizes.total > keptSizes(v1).total);
  assert.ok(gzipSync(JSON.stringify(withPack)).length < 150_000);
});

test('the reason: none for version 1; from version 2 required, at least three words, under 2,000 characters', () => {
  assert.equal(reasonProblem(1, ''), null);
  assert.equal(reasonProblem(1, 'Because.'), 'The first approved version takes no reason.');
  assert.equal(reasonProblem(2, ''), 'Say why there is a new version.');
  assert.equal(reasonProblem(2, '   '), 'Say why there is a new version.');
  assert.equal(reasonProblem(2, 'Fixes'), 'Say why in at least 3 words.');
  assert.equal(reasonProblem(2, 'The approver limit changed.'), null);
  assert.equal(reasonProblem(3, 'word '.repeat(500)), 'Keep the reason under 2000 characters.');
  assert.equal(REASON_LABEL, 'Why a new version?');
  assert.equal(reasonHelp(2), 'Required. Kept with version 2 and shown in its list of versions.');
});

test('the tag: a change to the process marks it; a workspace-wide change does not; an older approval says it has no copy', () => {
  assert.equal(versionTag({ latest: { number: 2 }, processChanged: true, legacyRevision: null }), 'Approved version 2 · unapproved changes');
  assert.equal(versionTag({ latest: { number: 2 }, processChanged: false, legacyRevision: null }), 'Approved version 2');
  assert.equal(versionTag({ latest: null, processChanged: false, legacyRevision: 3 }), 'Approved revision 3 (before copies were kept)');
  assert.equal(versionTag({ latest: { number: 1 }, processChanged: false, legacyRevision: 3 }), 'Approved version 1');
  assert.equal(versionTag({ latest: null, processChanged: true, legacyRevision: null }), null);
  assert.equal(LEGACY_LABEL, 'Approved before copies were kept: shown as built today');
  assert.equal(keptLaterLabel('22 November 2026'), 'Kept after approval, as it read on 22 November 2026');
});

test('the Documents line, in each case', () => {
  const base = { number: 2, approver: 'Priya Shah', date: '21 November 2026', processChanged: false, workspaceChanged: [] as ('assessment_settings' | 'layout' | 'look')[] };
  assert.equal(documentsLine({ ...base, differing: 0 }), 'The working draft reads exactly as approved version 2.');
  assert.equal(documentsLine({ ...base, differing: 3, processChanged: true }),
    'Approved version 2 is kept exactly as it read when Priya Shah approved it on 21 November 2026. You are looking at the working draft: 3 sections read differently. Approve again to make them version 3.');
  assert.equal(documentsLine({ ...base, differing: 1, processChanged: true }),
    'Approved version 2 is kept exactly as it read when Priya Shah approved it on 21 November 2026. You are looking at the working draft: 1 section reads differently. Approve again to make it version 3.');
  // Item 5 only when the inputs index proves a release (recorded for pull request 3); otherwise neutral words.
  assert.equal(documentsLine({ ...base, differing: 4, releaseProven: true }), 'Avala OS now writes 4 sections differently from approved version 2. The approved version is unchanged.');
  assert.equal(documentsLine({ ...base, differing: 1, releaseProven: true }), 'Avala OS now writes 1 section differently from approved version 2. The approved version is unchanged.');
  assert.equal(documentsLine({ ...base, differing: 4 }), '4 sections read differently from approved version 2 today. Approved version 2 is unchanged.');
  assert.equal(documentsLine({ ...base, differing: 1 }), '1 section reads differently from approved version 2 today. Approved version 2 is unchanged.');
  // An edit saved and then undone (recorded for pull request 3): the tag says "unapproved changes", nothing differs.
  assert.equal(documentsLine({ ...base, differing: 0, processChanged: true }), 'Changes were saved since approved version 2, and the working draft now reads exactly as that version.');
  assert.equal(documentsLine({ ...base, differing: 2, workspaceChanged: ['layout'] }), 'Since approved version 2, the workspace\'s document sections changed, so 2 sections read differently today. Approved version 2 is unchanged.');
  assert.equal(documentsLine({ ...base, differing: 1, workspaceChanged: ['assessment_settings', 'layout'] }), 'Since approved version 2, the workspace\'s assessment settings and document sections changed, so 1 section reads differently today. Approved version 2 is unchanged.');
  assert.equal(documentsLine({ ...base, differing: 0, workspaceChanged: ['look'] }), 'Since approved version 2, the workspace\'s look changed. Approved version 2 is unchanged and downloads with the look it was approved with.');
  assert.equal(openedVersionLine(1, '21 November 2026', 'Priya Shah'), 'Approved version 1, approved on 21 November 2026 by Priya Shah. As kept at approval.');
  assert.equal(versionFileName('pdd', 'Vendor invoice processing', 2, 'docx'), 'PDD - Vendor invoice processing - version 2.docx');
});

test('a release is proven only when every input is the same and the build is not', () => {
  const kept = { build: 'aaa1111', modelHash: 'm', inputs: { edits: 'e', decisions: 'd' } };
  assert.equal(releaseProven(kept, { ...kept, build: 'bbb2222' }), true);
  assert.equal(releaseProven(kept, kept), false, 'the same build explains nothing');
  assert.equal(releaseProven(kept, { ...kept, build: 'bbb2222', inputs: { edits: 'e2', decisions: 'd' } }), false, 'an input changed');
  assert.equal(releaseProven(kept, { ...kept, build: 'bbb2222', modelHash: 'm2' }), false, 'the record changed');
  assert.equal(releaseProven(kept, { ...kept, build: 'bbb2222', inputs: { edits: 'e' } }), false, 'an input went missing');
  assert.equal(releaseProven(null, kept), false);
});
