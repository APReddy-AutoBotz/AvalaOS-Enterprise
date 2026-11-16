import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import type { IngestSegment } from '../ingest/segment.ts';
import { adoptBrief, setBriefFact } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { BRIEF_LIMITS, briefFromFindings, briefSegments, readBrief, type BriefFinding } from './readBrief.ts';
import { TASKS } from '../ai/tasks.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const seg = (sourceId: string, n: number, text: string): IngestSegment => ({ id: `${sourceId}:${n}`, sourceId, kind: 'paragraph', text, locator: { lineStart: n } });

// A synthetic pack shaped like the owner's first real documents: requirements for a tool to be built.
const pack = [
  { key: 'req', title: 'Requirements', segments: [
    seg('req', 1, 'Requirements for the questionnaire assistant.'),
    seg('req', 2, 'The primary goal of this tool is to pre-fill fit-gap questionnaires from the legacy configuration.'),
    seg('req', 3, 'The assistant will be built as a chatbot in Teams; a consultant confirms every proposed answer.'),
    seg('req', 4, 'Lunch was at one.'),
    seg('req', 5, 'Lunch was at one.'),
    seg('req', 6, 'We need a solution design document before the build starts.'),
  ] },
  { key: 'call', title: 'Kick-off call', segments: [seg('call', 1, 'Today nobody fills these in automatically; it is all manual.')] },
];

test('the reading task is registered, and only the opening passages and those with a cue are sent', () => {
  assert.equal(TASKS.readBrief, readBrief);
  const { segments, ingest } = briefSegments(gold(), pack);
  assert.equal(segments[0].id, 'process');
  assert.match(segments[0].text, /Applications: .*SAP/);
  const ids = segments.slice(1).map(s => s.id);
  assert.ok(ids.includes('req:1') && ids.includes('req:2') && ids.includes('req:6') && ids.includes('call:1'));
  assert.ok(!ids.includes('req:5'), 'a passage with no cue past the opening is not sent');
  assert.ok(ingest.size <= BRIEF_LIMITS.passages);
  assert.deepEqual(briefSegments(gold(), []).segments, []);
});

test('findings become the brief: each line with its passage; disagreement and silence stay unknown', () => {
  const { ingest } = briefSegments(gold(), pack);
  const f = (line: BriefFinding['line'], value: string, segmentId: string, excerpt: string, certainty: BriefFinding['certainty'] = 'stated'): BriefFinding => ({ line, value, segmentId, excerpt, certainty });
  const brief = briefFromFindings([
    f('summary', 'A tool to pre-fill fit-gap questionnaires from the legacy configuration.', 'req:2', 'pre-fill fit-gap questionnaires'),
    f('doneToday', 'no', 'req:3', 'The assistant will be built', 'inferred'),
    f('kind', 'tool', 'req:3', 'will be built as a chatbot'),
    f('inMind', 'ai', 'req:3', 'a consultant confirms every proposed answer'),
    f('inMind', 'robot', 'req:3', 'x'),                      // not one of the words: dropped
    f('documents', 'sdd', 'req:6', 'solution design document'),
    f('kind', 'tool', 'nowhere:1', 'x'),                     // a passage that was not sent: dropped
  ], ingest);
  assert.equal(brief.summary!.status, 'stated');
  assert.deepEqual(brief.summary!.sources, [{ sourceId: 'req', locator: { lineStart: 2 }, excerpt: 'pre-fill fit-gap questionnaires' }]);
  assert.deepEqual([brief.doneToday!.value, brief.doneToday!.status], ['no', 'inferred']);
  assert.deepEqual([brief.kind!.value, brief.kind!.sources.length], ['tool', 1]);
  assert.deepEqual(brief.inMind!.value, ['ai']);
  assert.deepEqual(brief.documents!.value, ['sdd']);

  const split = briefFromFindings([f('doneToday', 'yes', 'call:1', 'it is all manual'), f('doneToday', 'no', 'req:3', 'will be built')], ingest);
  assert.equal(split.doneToday!.status, 'unknown', 'the passages disagree: not decided for the person');
  assert.equal(split.kind!.status, 'unknown', 'nothing said: unknown');
  assert.equal(split.summary!.value, null);

  // What is being built: an application of the process by its exact name; else unknown.
  const sap = gold().systems.find(x => /SAP/.test(x.name))!;
  const withModel = briefFromFindings([f('building', sap.name.toUpperCase(), 'req:3', 'will be built')], ingest, gold());
  assert.deepEqual([withModel.building!.value, withModel.building!.status], [sap.id, 'stated']);
  assert.equal(briefFromFindings([f('building', 'A tool nobody listed', 'req:3', 'will be built')], ingest, gold()).building!.status, 'unknown');
  assert.equal(briefFromFindings([f('building', sap.name, 'req:3', 'x'), f('building', 'ServiceNow', 'req:2', 'y')], ingest, gold()).building!.status, 'unknown', 'two different answers');
  assert.equal(brief.building, undefined, 'without the model, the line is not read');

  // Into the model: valid, and a person's line is kept.
  let m = setBriefFact(gold(), { fact: 'kind', value: 'existing_process' }).model;
  m = adoptBrief(m, brief).model;
  assert.equal(validateModel(m).valid, true);
  assert.equal(m.meta.brief!.kind!.value, 'existing_process');
  assert.equal(m.meta.brief!.doneToday!.value, 'no');
});
