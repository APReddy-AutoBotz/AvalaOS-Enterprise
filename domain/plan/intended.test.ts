import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import { setBriefFact, setProcessMetric } from '../processModel/patch.ts';
import { assessProcess } from '../assess/process.ts';
import { buildPdd } from '../docs/pdd.ts';
import { buildBrd } from '../docs/brd.ts';
import { emptyDecisions } from '../assess/decisions.ts';
import { triage } from '../questions/triage.ts';
import { briefLines } from './delivery.ts';
import { buildingSystem, existingSystems, notDoneToday, partlyDoneToday, processWords } from './intended.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const input = (m: ProcessModel) => ({ model: m, assessment: assessProcess(m), decisions: emptyDecisions(), sources: [], revision: { label: 'r', state: 'working' as const, date: 'd' } });
const titles = (doc: { sections: { title: string }[] }) => doc.sections.map(s => s.title);
const text = (doc: unknown) => JSON.stringify(doc);

/** The sample, told that nothing of it is done today and that the office scanner is what is being built. */
function intended(): ProcessModel {
  let m = gold();
  const sn = m.systems.find(s => /Office scanner/.test(s.name))!;
  m = setBriefFact(m, { fact: 'doneToday', value: 'no' }).model;
  m = setBriefFact(m, { fact: 'kind', value: 'tool' }).model;
  m = setBriefFact(m, { fact: 'building', value: sn.id }).model;
  return m;
}

test('work done today, or not said: nothing changes (the sample stays as it is)', () => {
  for (const m of [gold(), setBriefFact(gold(), { fact: 'doneToday', value: 'yes' }).model]) {
    assert.equal(notDoneToday(m), false);
    assert.equal(processWords(m).process, 'As-Is process');
    const a = assessProcess(m);
    assert.match(a.split, /people do today/);
    const pdd = buildPdd(input(m));
    assert.ok(titles(pdd).includes('As-Is process'));
    assert.match(text(pdd), /is done today, step by step/);
  }
  const partly = setBriefFact(gold(), { fact: 'doneToday', value: 'partly' }).model;
  assert.equal(partlyDoneToday(partly), true);
  assert.equal(notDoneToday(partly), false);
});

test('work not done today: the intended process in words, documents and the split', () => {
  const m = intended();
  assert.equal(notDoneToday(m), true);
  const w = processWords(m);
  assert.deepEqual([w.process, w.map, w.steps], ['Intended process', 'Intended process map', 'Detailed intended steps']);
  const a = assessProcess(m);
  assert.match(a.split, /^Of \d+ intended steps:/);
  const pdd = buildPdd(input(m));
  assert.ok(titles(pdd).includes('Intended process') && !titles(pdd).includes('As-Is process'));
  assert.match(text(pdd), /is intended to work, step by step/);
  assert.doesNotMatch(text(pdd), /Detailed As-Is steps|As-Is process map/);
  const brd = buildBrd(input(m));
  assert.ok(titles(brd).includes('Intended process summary'));
  assert.match(text(brd), /Nothing of this is done today\. The intended process has/);
});

test('the application being built is not an application the process uses, and its access is not asked', () => {
  const plain = gold();
  const m = intended();
  const sn = buildingSystem(m)!;
  assert.match(sn.name, /Office scanner/);
  assert.equal(existingSystems(m).length, m.systems.length - 1);
  // Not in the brief's applications, but named on its own line.
  const lines = briefLines(m);
  assert.doesNotMatch(lines.find(l => l.key === 'applications')!.text!, /Office scanner/);
  assert.match(lines.find(l => l.key === 'building')!.text!, /Office scanner/);
  // Not a prerequisite in the PDD, and said once why.
  const pdd = text(buildPdd(input(m)));
  assert.doesNotMatch(pdd, /Access to Office scanner \(Pune\) for the automation/);
  assert.match(pdd, /Office scanner \(Pune\) is what is being built, so it is not listed/);
  assert.match(text(buildPdd(input(plain))), /Access to Office scanner \(Pune\) for the automation/);
  // Its access question is set aside as answered by the record, with why.
  const before = triage(plain, assessProcess(plain));
  const after = triage(m, assessProcess(m));
  assert.ok(before.items.some(i => i.target.kind === 'system' && i.target.id === sn.id), 'asked before');
  assert.ok(!after.items.some(i => i.target.kind === 'system' && i.target.id === sn.id), 'not asked now');
  // The building line only takes a system of the process.
  assert.throws(() => setBriefFact(gold(), { fact: 'building', value: 'sys-nowhere' }));
});

test('no hours saved for work not done today: the value is what it would take by hand, from figures a person entered', () => {
  let m = intended();
  let a = assessProcess(m);
  assert.equal(a.hours.computable, false);
  assert.equal(a.cautions.find(c => c.id === 'not_worth_automating')!.fired, false);
  // The sample's volume and times come from its sources: not used for work nobody does today.
  assert.equal(a.priority.value.computable, false);
  assert.match(a.priority.value.reason!, /no hours to save\. Enter the expected volume and the time a case would take by hand/);
  m = setProcessMetric(m, { kind: 'volume', value: 1000, period: 'month' }).model;
  assert.equal(assessProcess(m).priority.value.computable, false, 'the time per case is still missing');
  m = setProcessMetric(m, { kind: 'handling_time', value: 12, unit: 'minutes' }).model;
  a = assessProcess(m);
  assert.equal(a.priority.value.computable, true);
  assert.equal(a.priority.value.value!.basis, 'by_hand');
  assert.deepEqual(a.priority.value.value!.hours.map(Math.round), [2400, 2400], '12,000 cases a year at 12 minutes');
  // Work done today keeps the hours it can save.
  assert.notEqual(assessProcess(gold()).priority.value.value?.basis, 'by_hand');
});
