// What Ask Avala can be asked about, each with how its record is read and how its facts are built. The
// panel (AskPanel.tsx) is the same for all of them: it asks the subject for its facts and its task.
import type { JourneyStore, SourceRow } from '../store/types.ts';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { ProcessAssessment } from '../../domain/assess/process.ts';
import type { TaskDefinition } from '../../domain/ai/gateway.ts';
import { askFacts, askProcess, type AskContext, type Fact } from '../../domain/assistant/ask.ts';
import { askBoard, boardFacts, type BoardContext } from '../../domain/assistant/board.ts';
import { loadAskRecord } from './askRecord.ts';

export interface AskSubject {
  kind: 'process' | 'board';
  /** "this process", "this board": how the panel and its messages name it. */
  noun: string;
  intro: string;
  placeholder: string;
  suggested: string[];
  task: TaskDefinition;
  /** Read the record once, when the panel opens. */
  load(): Promise<unknown>;
  facts(question: string, record: unknown): Fact[];
  /** For the figures beside an answer, where the subject has an assessment. */
  assessment(record: unknown): ProcessAssessment | null;
}

export function processSubject(store: JourneyStore, p: { processId: string; workspaceId: string; model: ProcessModel; sources: SourceRow[] }): AskSubject {
  return {
    kind: 'process', noun: 'this process', task: askProcess,
    intro: 'Ask about this process. Answers come only from its record (its steps, assessment, requirements, board items and sources) and from how Avala OS itself works. Each sentence links to where it came from. Ask Avala explains; it changes nothing, and nothing here is saved.',
    placeholder: 'Ask about the steps, the assessment, requirements or sources…',
    suggested: ['Why is this the recommended approach?', 'Which steps stay with people, and why?', 'What is still unknown about this process?'],
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
    suggested: ['What is blocked or overdue?', 'Which open items have no owner?', 'What is in progress, and who owns it?'],
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
