// For the tests of package 14: the demo's sample read as the Documents page reads it, turned into what
// approval would keep. Each kind of later change is a function of this input, so a test can build the
// kept set, make the change, and build the draft's set from the same function.
import fs from 'node:fs';
import { createMemoryStore } from '../../../journey/store/memoryStore.ts';
import { assessProcess } from '../../assess/process.ts';
import { deriveRequirements } from '../../requirements/derive.ts';
import { reconcile, type StoredRequirement } from '../../requirements/register.ts';
import type { Decisions } from '../../assess/decisions.ts';
import type { AssessmentSettings } from '../../assess/settings.ts';
import type { ProcessModel } from '../../processModel/types.ts';
import type { DocumentSettings } from '../branding.ts';
import type { SectionEdit } from '../edits.ts';
import type { TestCaseEdit } from '../testEdits.ts';
import type { KeepInput } from '../keep.ts';
import { FORMAT_LABEL } from '../../workspace/sources.ts';

export interface SampleState {
  model: ProcessModel;
  decisions: Decisions;
  settings: AssessmentSettings | undefined;
  stored: StoredRequirement[];
  edits: SectionEdit[];
  testEdits: TestCaseEdit[];
  docSettings: DocumentSettings;
  sources: { key: string; title: string }[];
  names: Record<string, string>;
  /** What only the evidence pack reads, as the Documents page loads it when the pack is opened. */
  evidence: NonNullable<KeepInput['evidence']>;
}

export async function loadSample(): Promise<SampleState> {
  const demo = JSON.parse(fs.readFileSync(new URL('../../../public/demo-data/sample.json', import.meta.url), 'utf8'));
  const store = createMemoryStore({ demo });
  const ws = (await store.listWorkspaces())[0]!;
  const p = (await store.listProcesses(ws.id))[0]!;
  const revisions = await store.listRevisions(p.id);
  const revision = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved')!;
  const members = await store.listMembers(ws.id);
  const proposals = await store.listProposals(p.id);
  const items = (await Promise.all((await store.listProjects(ws.id)).map(pr => store.listWorkItems(pr.id)))).flat();
  const sources = await store.listSources(p.id);
  const evidence: NonNullable<KeepInput['evidence']> = {
    revNo: revision.revNo,
    revisions: revisions.map(r => ({ revNo: r.revNo, state: r.state, createdAt: r.createdAt, approvedAt: r.approvedAt, approvedBy: r.approvedBy ?? null })),
    allSources: sources.map(x => ({ key: x.key, title: x.title, kind: FORMAT_LABEL[x.format] ?? '', createdAt: x.createdAt, passages: x.segmentCount, archived: x.archived })),
    proposals, boardStatus: Object.fromEntries(items.map(i => [i.id, i.status])), comments: await store.listSectionComments(p.id),
  };
  return {
    evidence,
    model: (await store.getModel(revision.id))!,
    decisions: await store.getAssessmentDecisions(p.id),
    settings: (await store.getSettings(ws.id)).settings,
    stored: await store.listRequirements(p.id),
    edits: await store.listDocumentEdits(p.id),
    testEdits: await store.listTestEdits(p.id),
    docSettings: await store.getDocumentSettings(ws.id),
    sources: (await store.listSources(p.id)).filter(s => !s.archived).map(s => ({ key: s.key, title: s.title })),
    names: Object.fromEntries(members.map(m => [m.userId, m.name])),
  };
}

/** What the Documents page would pass at this moment, as approval of version `label` or as the working draft. */
export function keepInputOf(s: SampleState, revision: KeepInput['revision'] = { label: 'Approved version 1', state: 'approved', date: '21 November 2026' }): KeepInput {
  const assessment = assessProcess(s.model, { rate: s.decisions.rate, settings: s.settings, decisions: s.decisions });
  const requirements = reconcile(deriveRequirements(s.model, assessment), s.stored).requirements;
  return { model: s.model, assessment, decisions: s.decisions, sources: s.sources, requirements, revision, names: s.names, edits: s.edits, testEdits: s.testEdits, layouts: s.docSettings.layouts };
}
