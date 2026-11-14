// The record Ask Avala answers from on one process, read through the store: its assessment under the
// workspace's settings and the saved decisions, its active requirements, its board items and the
// passages of its sources. The panel reads it when it opens; the measure (eval/ask) reads the sample
// case the same way, so what is measured is what the panel asks.
import type { JourneyStore, SourceRow } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import type { Override } from '../../domain/assess/decisions.ts';
import type { AskContext, Passage } from '../../domain/assistant/ask.ts';
import { STATUS_LABEL } from '../../domain/workitems/board.ts';

export async function loadAskRecord(store: JourneyStore, p: { processId: string; workspaceId: string; model: ProcessModel; sources: SourceRow[] }): Promise<Omit<AskContext, 'model'>> {
  const { processId, workspaceId, model, sources } = p;
  const [settings, decisions, requirements, projects, members] = await Promise.all([
    store.getSettings(workspaceId).catch(() => null), store.getAssessmentDecisions(processId).catch(() => null),
    store.listRequirements(processId).catch(() => []), store.listProjects(workspaceId).catch(() => []), store.listMembers(workspaceId).catch(() => []),
  ]);
  const items = (await Promise.all(projects.map(x => store.listWorkItems(x.id).catch(() => [])))).flat().filter(i => i.processId === processId);
  const passages: Passage[] = (await Promise.all(sources.map(async s => (await store.getSourceSegments(s.id).catch(() => []))
    .map(seg => ({ sourceKey: s.key, sourceTitle: s.title, locator: seg.locator, text: seg.text }))))).flat();
  const name = (id: string | null) => (id ? members.find(m => m.userId === id)?.name ?? null : null);
  return {
    assessment: assessProcess(model, { rate: decisions?.rate ?? null, ...(settings ? { settings: settings.settings } : {}) }),
    requirements: requirements.filter(r => r.state === 'active').map(r => ({ code: r.code, statement: r.statement })),
    items: items.map(i => ({ id: i.id, projectId: i.projectId, title: i.title, type: i.type, status: STATUS_LABEL[i.status], owner: name(i.ownerId) })),
    passages,
    overrides: (decisions ? Object.values(decisions.overrides) as Override[] : []).map(o => ({ stepId: o.stepId, approach: o.approach, rationale: o.rationale })),
  };
}
