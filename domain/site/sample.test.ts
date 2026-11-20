import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SAMPLE_FIGURES, sampleLine } from './sample.ts';
import { createMemoryStore } from '../../journey/store/memoryStore.ts';
import { assessProcess } from '../assess/process.ts';
import { deliveryPlan } from '../plan/delivery.ts';
import { deriveRequirements } from '../requirements/derive.ts';
import { reconcile } from '../requirements/register.ts';
import { testPack } from '../docs/tests.ts';

// The demo read as its pages read it: the same store, the working draft (else the approved revision),
// the decisions and settings the Documents page loads, the requirements register it reconciles.
async function demoFigures() {
  const demo = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8'));
  const store = createMemoryStore({ demo });
  const ws = (await store.listWorkspaces())[0]!;
  const p = (await store.listProcesses(ws.id))[0]!;
  const revisions = await store.listRevisions(p.id);
  const revision = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved')!;
  const model = (await store.getModel(revision.id))!;
  const decisions = await store.getAssessmentDecisions(p.id);
  const { settings } = await store.getSettings(ws.id);
  const assessment = assessProcess(model, { rate: decisions.rate, settings, decisions });
  const planned = deliveryPlan(model, assessment).docs.filter(d => d.planned).map(d => d.doc);
  const register = reconcile(deriveRequirements(model, assessment), await store.listRequirements(p.id));
  // The revision's label and date only head the document; they do not change which cases there are.
  const pack = testPack({ model, assessment, decisions, sources: [], revision: { label: 'Working draft', state: revision.state === 'approved' ? 'approved' : 'working', date: '' }, requirements: register.requirements });
  const projects = await store.listProjects(ws.id);
  const items = (await Promise.all(projects.map(pr => store.listWorkItems(pr.id)))).flat();
  return {
    sources: (await store.listSources(p.id)).filter(s => !s.archived).length,
    plannedDocuments: planned,
    testCases: pack.cases.length,
    boardItems: items.length,
  };
}

test('the homepage\'s figures for the sample case are what the demo shows', async () => {
  const demo = await demoFigures();
  assert.deepEqual([...demo.plannedDocuments], ['pdd', 'sdd'], 'the sample\'s delivery plan plans exactly a PDD and an SDD');
  assert.deepEqual({ ...SAMPLE_FIGURES, plannedDocuments: [...SAMPLE_FIGURES.plannedDocuments] }, { ...demo, plannedDocuments: [...demo.plannedDocuments] });
});

test('the line names the planned documents and says the counts in words up to ten, digits above', () => {
  assert.equal(sampleLine(), 'Real product screens. A made-up sample case: five source files in; a PDD and an SDD, 32 test cases and a 50-item Delivery board out.');
  assert.match(sampleLine({ sources: 12, plannedDocuments: ['pdd', 'agent', 'sdd'], testCases: 3, boardItems: 7 }), /12 source files in; a PDD, an agent document and an SDD, 3 test cases and a 7-item/);
});
