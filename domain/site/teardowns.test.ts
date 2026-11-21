// Teardowns in the demo: the address, the words, the state built from a folder, and what a published file may
// not hold (B of the plan and changes a, b and d). The fixture is a made-up procedure in ./fixtures/teardown/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ABOUT_TITLE, TEARDOWN_DOCS, TEARDOWN_PERSON, findContacts, isTeardownSlug, openQuestionsLine, removeContacts, teardownCanonical, teardownModel, teardownProblems, teardownSlug, type TeardownWords } from './teardowns.ts';
import { stableId, teardownState, type TeardownRun } from './teardownState.ts';
import type { ProcessModel } from '../processModel/types.ts';

const dir = new URL('./fixtures/teardown/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, dir));
const fixture = () => {
  const run: TeardownRun = JSON.parse(read('run.json').toString());
  return { words: JSON.parse(read('teardown.json').toString()) as TeardownWords, model: JSON.parse(read('model.json').toString()) as ProcessModel, run, files: Object.fromEntries(Object.values(run.files).map(f => [f, new Uint8Array(read(f))])) };
};
const built = async () => { const f = fixture(); return { f, state: await teardownState(f) }; };
const clone = <T>(x: T): T => structuredClone(x);

test('the address: /demo/teardowns/<slug>, with its own canonical address; anything else is the sample', () => {
  assert.equal(teardownSlug('/demo/teardowns/access-to-work'), 'access-to-work');
  assert.equal(teardownSlug('/demo/teardowns/access-to-work/process/x/assessment'), 'access-to-work');
  assert.equal(teardownSlug('/demo'), null);
  assert.equal(teardownSlug('/demo/process/x/assessment'), null);
  assert.equal(teardownSlug('/demo/teardowns/Bad_Slug'), null);
  assert.equal(teardownSlug('/demo/teardowns/../x'), null);
  assert.equal(teardownCanonical('/demo/teardowns/access-to-work/process/x/documents'), 'https://avalaos.com/demo/teardowns/access-to-work');
  assert.equal(teardownCanonical('/demo'), null);
  assert.ok(isTeardownSlug('a-1') && !isTeardownSlug('-a') && !isTeardownSlug('a'.repeat(61)));
});

test('the open-questions line counts what the screens count, in the approved words', () => {
  assert.equal(openQuestionsLine(12), '12 questions stayed open because nobody who does this work was asked. In a real assessment, they go to the people who know.');
  assert.match(openQuestionsLine(1), /^1 question stayed open/);
});

test('the fixture builds into a file with nothing to fix: same file every time, neutral people, the section in every document', async () => {
  const { f, state } = await built();
  assert.deepEqual(teardownProblems(state, f.run), []);
  assert.deepEqual(JSON.stringify(await teardownState(fixture())), JSON.stringify(state), 'building again gives the same file');
  assert.equal(state.me.email, TEARDOWN_PERSON.email);
  assert.equal(state.revisions[0].state, 'working');
  assert.equal(state.sources[0].segmentCount, 9);
  assert.equal(state.edits[0].createdAt, f.run.finishedAt);
  assert.equal(state.processes[0].id, stableId('fixture-teardown', 'process'));
  const layouts = state.documentSettings[0].settings.layouts;
  for (const t of TEARDOWN_DOCS) assert.equal(layouts[t]!.custom[0].title, ABOUT_TITLE);
  assert.equal(layouts.evidence, undefined, 'the evidence pack is not offered');
  const about = layouts.pdd!.custom[0].text;
  for (const line of [f.words.label, f.words.credit.text, f.words.source.text, f.words.notReview]) assert.ok(about.includes(line), line);
  assert.match(about, /\[email address removed\]/);
  assert.ok(about.includes(`Retrieved ${f.words.source.retrieved}.`));
});

test('B: a person, an email address or a stray id in the file is found', async () => {
  const { f, state } = await built();
  const a = clone(state); (a.people[a.workspaces[0].id].members[0] as { name: string }).name = 'Someone Real';
  assert.ok(teardownProblems(a, f.run).some(p => /not the teardown analyst/.test(p)));
  const b = clone(state); (b.revisions[0].model.steps[0] as unknown as { description: string }).description += ' Write to jo@example.com.';
  assert.ok(teardownProblems(b, f.run).some(p => /email address at/.test(p)));
  const c = clone(state); (c.processes[0] as { approverId: string | null }).approverId = '11111111-2222-4333-8444-555555555555';
  assert.ok(teardownProblems(c, f.run).some(p => /approverId names someone/.test(p)));
  const e = clone(state); e.revisions[0].model.steps[0].name += ' (0b7c2a1e-5d4f-4a3b-9c2d-1e0f9a8b7c6d)';
  assert.ok(teardownProblems(e, f.run).some(p => /An id from outside the file at \$\.revisions\[0\]\.model\.steps\[0\]\.name/.test(p)), 'change c: a live id is found');
  const g = clone(state); (g.processes[0] as { architectId: string | null }).architectId = g.workspaces[0].id;
  assert.ok(teardownProblems(g, f.run).some(p => /architectId names someone/.test(p)), 'an id of the file in a person field is still not a person');
  const d = clone(state); (d.revisions[0] as { state: string }).state = 'approved';
  assert.ok(teardownProblems(d, f.run).some(p => /approved/.test(p)));
});

test('change a: nothing a person gave: no answer, deferral, owner, resolution, own words, or fact without a passage', async () => {
  const { f, state } = await built();
  const m = (s: typeof state) => s.revisions[0].model;
  const cases: [string, (s: typeof state) => void, RegExp][] = [
    ['answered', s => { m(s).openQuestions[0].status = 'answered'; m(s).openQuestions[0].answer = 'yes'; }, /answered or deferred/],
    ['deferred', s => { m(s).openQuestions[0].status = 'deferred'; }, /deferred/],
    ['left with someone', s => { m(s).openQuestions[0].owner = 'A person'; }, /left with someone/],
    ['resolved', s => { m(s).conflicts.push({ id: 'c-1', target: { kind: 'meta' }, summary: 's', values: [], resolution: { chosen: 'x', by: TEARDOWN_PERSON.name, reason: 'r' } }); }, /resolved/],
    ['purpose set', s => { m(s).meta.purpose = { value: 'as_is', by: s.me.id, at: s.edits[0].createdAt }; }, /What is wanted from the process is set/],
    ['decided', s => { m(s).meta.decidedApproach = { approach: 'rpa', reason: 'r', by: s.me.id, at: s.edits[0].createdAt }; }, /decided/],
    ['confirmed by a person', s => { m(s).steps[0].status = 'user-confirmed'; }, /given by a person/],
    ['assumed', s => { (m(s).meta as { objective: { value: string | null; status: string } }).objective = { value: 'x', status: 'assumed', sources: [] } as never; }, /given by a person/],
    ['stated with no passage', s => { m(s).steps[0].sources = []; }, /no passage of the text/],
    ["a person's notes", s => { s.sources[0].key = 'ans-1'; }, /notes or own words/],
  ];
  for (const [name, change, want] of cases) {
    const s = clone(state); change(s);
    assert.ok(teardownProblems(s, f.run).some(p => want.test(p)), name);
  }
});

test('quotes and passages: every quote is in the committed text, and the passage count matches the live reading', async () => {
  const { f, state } = await built();
  const a = clone(state); a.revisions[0].model.steps[0].sources[0].excerpt = 'words the text never had';
  assert.ok(teardownProblems(a, f.run).some(p => /not in source doc-1/.test(p)));
  assert.ok(teardownProblems(state, { liveSegments: { 'doc-1': 10 } }).some(p => /9 passages here and 10/.test(p)));
});

test('change d: contact details are replaced in the copy before the reading, counted, and the counts must match', async () => {
  const r = removeContacts('Write to access.to.work@dwp.example.gov.uk or call 0800 121 7479, textphone 0800 121 7579.');
  assert.deepEqual(r.removed, { email: 1, phone: 2 });
  assert.equal(r.text, 'Write to [email address removed] or call [telephone number removed], textphone [telephone number removed].');
  assert.deepEqual(findContacts(r.text), { emails: [], phones: [] });
  assert.deepEqual(findContacts('Pay within 10 working days, up to £1,000.').phones, [], 'amounts and days are not numbers to remove');
  assert.deepEqual(removeContacts('Ring 020 7946 0958, +44 20 7946 0958 or (01632) 960 001.').removed, { email: 0, phone: 3 });
  assert.deepEqual(findContacts('Reference 2026-11-21, form 0 to 10, version 0.5, case 012345.').phones, [], 'dates, ranges and short references stay');
  const { f, state } = await built();
  const a = clone(state); a.teardown.removed = { email: 0, phone: 1 };
  assert.ok(teardownProblems(a, f.run).some(p => /words say 0 and 1/.test(p)));
  const b = clone(state); b.sources[0].segments[8].text = 'For help, contact help@claims.example.org.';
  assert.ok(teardownProblems(b, f.run).some(p => /still holds 1 email address/.test(p)));
});

test('change b: a document without its section, or with other words in it, is found', async () => {
  const { f, state } = await built();
  const a = clone(state); delete a.documentSettings[0].settings.layouts.sdd;
  assert.ok(teardownProblems(a, f.run).some(p => /sdd document does not start/.test(p)));
  const b = clone(state); b.documentSettings[0].settings.layouts.pdd!.custom[0].text = 'Something else';
  assert.ok(teardownProblems(b, f.run).some(p => /pdd document does not start/.test(p)));
});

test('teardownModel replaces who decided or resolved with the teardown person and keeps everything else', () => {
  const f = fixture();
  const raw = clone(f.model);
  raw.meta.purpose = { value: 'assess', by: 'live-person-id', at: '2026-11-22T00:00:00Z' };
  raw.conflicts.push({ id: 'c-1', target: { kind: 'meta' }, summary: 's', values: [], resolution: { chosen: 'x', by: 'Real Name', byId: 'live-id', reason: 'r' } });
  const m = teardownModel(raw, 'teardown-id', '2026-11-21T06:02:30.000Z');
  assert.equal(m.meta.purpose, undefined, '"assess" is the default: taken out, with who chose it');
  const asIs = teardownModel({ ...raw, meta: { ...raw.meta, purpose: { value: 'as_is', by: 'live-person-id', at: 'x' } } } as ProcessModel, 'teardown-id', '2026-11-21T06:02:30.000Z');
  assert.deepEqual(asIs.meta.purpose, { value: 'as_is', by: 'teardown-id', at: '2026-11-21T06:02:30.000Z' }, 'another answer is kept, with the teardown person, for the check to refuse');
  assert.deepEqual(m.conflicts[0].resolution, { chosen: 'x', by: TEARDOWN_PERSON.name, byId: 'teardown-id', reason: 'r' });
  assert.deepEqual(m.steps, f.model.steps);
  assert.equal(raw.meta.purpose.by, 'live-person-id', 'the input is not changed');
});

test('every published teardown file passes the same checks, and each is in the index and the sitemap', async () => {
  const pub = new URL('../../public/demo-data/teardowns/', import.meta.url);
  const index: { slug: string; short: string }[] = JSON.parse(readFileSync(new URL('index.json', pub), 'utf8'));
  const files = readdirSync(pub).filter(n => n.endsWith('.json') && n !== 'index.json');
  assert.deepEqual(index.map(t => `${t.slug}.json`).sort(), files.sort(), 'the index lists exactly the files');
  const sitemap = readFileSync(new URL('../../public/sitemap.xml', import.meta.url), 'utf8');
  for (const { slug } of index) {
    assert.ok(sitemap.includes(`<loc>https://avalaos.com/demo/teardowns/${slug}</loc>`), `${slug} in the sitemap`);
    const folder = new URL(`../../teardowns/${slug}/`, import.meta.url);
    assert.ok(existsSync(folder), `teardowns/${slug}/ holds what the file is built from`);
    const run: TeardownRun = JSON.parse(readFileSync(new URL('run.json', folder), 'utf8'));
    const state = JSON.parse(readFileSync(new URL(`${slug}.json`, pub), 'utf8'));
    assert.deepEqual(teardownProblems(state, run), [], slug);
  }
});
