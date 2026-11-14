// The sample case as the demo holds it (public/demo-data/sample.json), read the way the Ask Avala panel
// reads a process: the same store, the same record (journey/process/askRecord.ts), the same facts
// (domain/assistant/ask.ts). So what the measure asks about is what a person would be asking about.
import fs from 'node:fs';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { askFacts, validateQuestion, type AskContext, type Fact } from '../../domain/assistant/ask.ts';
import { createMemoryStore } from '../../journey/store/memoryStore.ts';
import { loadAskRecord } from '../../journey/process/askRecord.ts';
import { boardSubject, workspaceSubject } from '../../journey/process/askSubjects.ts';
import { boardFacts, type BoardContext } from '../../domain/assistant/board.ts';
import { namedProcess, workspaceFacts, type WorkspaceContext } from '../../domain/assistant/workspace.ts';
import type { Planted, Question, QuestionSet } from './scorer.ts';

export interface Sample { processId: string; processName: string; model: ProcessModel; record: Omit<AskContext, 'model'>; board: BoardContext; workspace: WorkspaceContext }

export async function loadSample(): Promise<Sample> {
  const demo = JSON.parse(fs.readFileSync(new URL('../../public/demo-data/sample.json', import.meta.url), 'utf8'));
  const store = createMemoryStore({ demo });
  const workspace = (await store.listWorkspaces())[0];
  const process = workspace && (await store.listProcesses(workspace.id))[0];
  if (!process) throw new Error('The sample has no process.');
  // The revision the process page shows: the working draft, else the approved one.
  const revisions = await store.listRevisions(process.id);
  const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
  const model = current ? await store.getModel(current.id) : null;
  if (!model) throw new Error('The sample process has no model.');
  const sources = await store.listSources(process.id);
  // The board as the panel reads it on the Delivery board; today is fixed so the measure does not change by the day.
  const project = (await store.listProjects(workspace.id))[0];
  if (!project) throw new Error('The sample has no board.');
  const board = { ...(await boardSubject(store, { workspaceId: workspace.id, project }).load()) as BoardContext, today: '2026-11-14' };
  // The whole workspace as the panel reads it away from a process or board.
  const ws = await workspaceSubject(store, { workspace: { id: workspace.id, name: workspace.name }, processesInUse: true, boardsInUse: true }).load() as { ctx: WorkspaceContext };
  return {
    processId: process.id, processName: process.name, model, board,
    record: await loadAskRecord(store, { processId: process.id, workspaceId: workspace.id, model, sources }),
    workspace: { ...ws.ctx, today: '2026-11-14' },
  };
}

export function loadQuestions(): QuestionSet {
  return JSON.parse(fs.readFileSync(new URL('./questions.json', import.meta.url), 'utf8')) as QuestionSet;
}

export const plantedFor = (q: Question, set: QuestionSet): Planted | undefined => (q.plant ? set.planted.find(p => p.id === q.plant) : undefined);

/** The facts the panel would send for this question; a planted passage joins the sources for its question only. */
export function factsFor(q: Question, sample: Sample, set: QuestionSet): { question: string; facts: Fact[] } {
  const question = validateQuestion(q.question);
  if (q.scope === 'board') return { question, facts: boardFacts(question, sample.board) };
  if (q.scope === 'workspace') {
    // As the panel does: the process's own record joins only when the question names it.
    const named = namedProcess(question, sample.workspace.processes) === sample.processId
      ? { processId: sample.processId, facts: askFacts(question, { model: sample.model, ...sample.record }) } : null;
    return { question, facts: workspaceFacts(question, sample.workspace, named) };
  }
  const p = plantedFor(q, set);
  const passages = [...(sample.record.passages ?? []), ...(p ? [{ sourceKey: p.sourceKey, sourceTitle: p.sourceTitle, locator: p.locator as never, text: p.text }] : [])];
  return { question, facts: askFacts(question, { model: sample.model, ...sample.record, passages }) };
}
