// What Ask Avala can be asked about, each with how its record is read and how its facts are built. The
// panel (AskPanel.tsx) is the same for all of them: it asks the subject for its facts and its task.
import type { JourneyStore, SourceRow } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import type { TaskDefinition } from '../../domain/ai/gateway.ts';
import { askFacts, askProcess, type AskContext, type Fact } from '../../domain/assistant/ask.ts';
import { askBoard, boardFacts, type BoardContext } from '../../domain/assistant/board.ts';
import { askWorkspace, namedProcess, workspaceFacts, type WorkspaceContext, type WorkspaceProcess } from '../../domain/assistant/workspace.ts';
import { assessProcess } from '../../domain/assess/process.ts';
import { buildPortfolio, processCard } from '../../domain/assess/portfolio.ts';
import { revisionStatus } from '../../domain/workspace/route.ts';
import { loadAskRecord } from './askRecord.ts'; 

export interface AskSubject {
  kind: 'process' | 'board' | 'workspace';
  /** "this process", "this board": how the panel and its messages name it. */
  noun: string;
  intro: string;
  placeholder: string;
  suggested: string[];
  task: TaskDefinition;
  /** Read the record once, when the panel opens. */
  load(): Promise<unknown>;
  facts(question: string, record: unknown): Fact[] | Promise<Fact[]>;
  /** For the figures beside an answer, where the subject has an assessment. */
  assessment(record: unknown): ProcessAssessment | null;
}

/**
 * The questions each subject starts with. They are also the demo's recorded questions (eval/ask/run.ts
 * --record asks exactly these), so change them together with public/demo-data/ask-answers.json.
 */
export const STARTERS = {
  process: ['Why is this the recommended approach?', 'Which steps stay with people, and why?', 'What is still unknown about this process?'],
  board: ['What is blocked or overdue?', 'Which open items have no owner?', 'What is in progress, and who owns it?'],
  workspace: ['Which processes are quick wins?', 'What is open across the workspace?', 'Which processes have no approver named?'],
} as const;

export function processSubject(store: JourneyStore, p: { processId: string; workspaceId: string; model: ProcessModel; sources: SourceRow[] }): AskSubject {
  return {
    kind: 'process', noun: 'this process', task: askProcess,
    intro: 'Ask about this process. Answers come only from its record (its steps, assessment, requirements, board items and sources) and from how Avala OS itself works. Each sentence links to where it came from. Ask Avala explains; it changes nothing, and nothing here is saved.',
    placeholder: 'Ask about the steps, the assessment, requirements or sources…',
    suggested: [...STARTERS.process],
    load: () => loadAskRecord(store, p),
    facts: (q, r) => askFacts(q, { model: p.model, ...(r as Omit<AskContext, 'model'>) }),
    assessment: r => (r as Omit<AskContext, 'model'>).assessment ?? null,
  };
}

/** The board as its page reads it: items, sprints, the people by name, and the processes by name. */
export function boardSubject(store: JourneyStore, b: { workspaceId: string; project: { id: string; name: string } }): AskSubject {
  return {
    kind: 'board', noun: 'this board', task: askBoard,
    intro: 'Ask about this Delivery board. Answers come only from its items, owners, statuses, dates and sprints, with the counts worked out exactly, and from how Avala OS itself works. Each sentence links to where it came from. Ask Avala explains; it changes nothing, and nothing here is saved.',
    placeholder: 'Ask about items, owners, statuses, dates or sprints…',
    suggested: [...STARTERS.board],
    load: async (): Promise<BoardContext> => {
      const [items, sprints, members, processes] = await Promise.all([
        store.listWorkItems(b.project.id), store.listSprints(b.project.id).catch(() => []),
        store.listMembers(b.workspaceId).catch(() => []), store.listProcesses(b.workspaceId).catch(() => []),
      ]);
      return { project: b.project, items, sprints, members: members.map(m => ({ userId: m.userId, name: m.name })), processes: processes.map(p => ({ id: p.id, name: p.name })), today: new Date().toISOString().slice(0, 10) };
    },
    facts: (q, r) => boardFacts(q, r as BoardContext),
    assessment: () => null,
  };
}

interface WorkspaceRecord { ctx: WorkspaceContext; models: Map<string, { model: ProcessModel; sources: () => Promise<SourceRow[]> }>; asked: Map<string, Promise<Omit<AskContext, 'model'>>> }

/**
 * The workspace as My work, the Processes page, the Portfolio, the applications list, People and the board
 * read it, all through the store, so a person is answered only from what they can read. A process's own
 * record is read only when a question names it, once.
 */
export function workspaceSubject(store: JourneyStore, w: { workspace: { id: string; name: string }; processesInUse: boolean; boardsInUse: boolean }): AskSubject {
  return {
    kind: 'workspace', noun: 'this workspace', task: askWorkspace,
    intro: 'Ask about this workspace: its processes, where each stands and who is named on it, the portfolio, the applications list, its people and its boards. Name a process to ask about its steps and sources. Answers come only from what the workspace holds and from how Avala OS itself works, and each sentence links to where it came from. Ask Avala explains; it changes nothing, and nothing here is saved.',
    placeholder: 'Ask about processes, the portfolio, applications, people or boards…',
    suggested: w.processesInUse
      ? [...STARTERS.workspace]
      : ['What is blocked or overdue on the boards?', 'Who are the people in this workspace?', 'Which applications are on the list?'],
    load: async (): Promise<WorkspaceRecord> => {
      const id = w.workspace.id;
      const [rows, members, applications, projects, settings] = await Promise.all([
        w.processesInUse ? store.listProcesses(id) : Promise.resolve([]), store.listMembers(id).catch(() => []),
        store.listApplications(id).catch(() => []), w.boardsInUse ? store.listProjects(id).catch(() => []) : Promise.resolve([]),
        store.getSettings(id).then(r => r.settings).catch(() => undefined),
      ]);
      const nameOf = (u: string | null | undefined) => (u ? members.find(m => m.userId === u)?.name ?? null : null);
      const models = new Map<string, { model: ProcessModel; sources: () => Promise<SourceRow[]> }>();
      const loaded = await Promise.all(rows.map(async p => {
        const revisions = await store.listRevisions(p.id);
        const current = revisions.find(r => r.state === 'working') ?? revisions.find(r => r.state === 'approved');
        const [model, proposals, decisions] = await Promise.all([current ? store.getModel(current.id) : Promise.resolve(null), store.listProposals(p.id).catch(() => []), store.getAssessmentDecisions(p.id).catch(() => null)]);
        const assessment = model ? assessProcess(model, { settings, decisions }) : null;
        if (model && model.steps.length) models.set(p.id, { model, sources: () => store.listSources(p.id) });
        const status = revisionStatus(revisions);
        const proc: WorkspaceProcess = {
          id: p.id, name: p.name, status: revisions.length ? status.label : 'No process steps yet',
          openQuestions: model ? model.openQuestions.filter(q => q.status === 'open').length : 0,
          proposalsWaiting: proposals.filter(x => x.state === 'proposed' || x.state === 'selected').length,
          named: { analyst: nameOf(p.analystId), architect: nameOf(p.architectId), approver: nameOf(p.approverId) },
          card: assessment ? processCard(assessment) : null, systems: model ? model.systems.map(s => s.name) : [],
        };
        return { proc, item: assessment ? { id: p.id, name: p.name, assessment, rate: decisions?.rate ?? null, costs: decisions?.costs ?? null } : null };
      }));
      const items = loaded.map(l => l.item).filter((i): i is NonNullable<typeof i> => i !== null);
      const boards = await Promise.all(projects.map(async b => ({ id: b.id, name: b.name, items: await store.listWorkItems(b.id).catch(() => []) })));
      const ctx: WorkspaceContext = {
        workspace: { name: w.workspace.name }, processesInUse: w.processesInUse, processes: loaded.map(l => l.proc),
        portfolio: items.length ? buildPortfolio(items) : null, applications,
        people: members.map(m => ({ name: m.name, role: m.role })), boards, today: new Date().toISOString().slice(0, 10),
      };
      return { ctx, models, asked: new Map() };
    },
    facts: async (q, r) => {
      const rec = r as WorkspaceRecord;
      const id = namedProcess(q, [...rec.models.keys()].map(k => ({ id: k, name: rec.ctx.processes.find(p => p.id === k)!.name })));
      if (!id) return workspaceFacts(q, rec.ctx);
      const m = rec.models.get(id)!;
      if (!rec.asked.has(id)) rec.asked.set(id, m.sources().then(sources => loadAskRecord(store, { processId: id, workspaceId: w.workspace.id, model: m.model, sources })));
      const record = await rec.asked.get(id)!;
      return workspaceFacts(q, rec.ctx, { processId: id, facts: askFacts(q, { model: m.model, ...record }) });
    },
    assessment: () => null,
  };
}
