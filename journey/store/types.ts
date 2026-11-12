import type { AssessmentSettings, SettingsRecord } from '../../domain/assess/settings.ts';
// Everything the journey screens read and write goes through this interface. The Supabase store is
// the real one; the memory store backs browser tests and local runs without a backend.
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { JsonPatchOp } from '../../domain/processModel/jsonPatch.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import type { StoredFormat } from '../../domain/workspace/sources.ts';
import type { Decisions } from '../../domain/assess/decisions.ts';
import type { Segment } from '../../domain/ai/gateway.ts';

export interface Me { id: string; email: string }
export interface Workspace { id: string; name: string; organizationName: string; role: 'admin' | 'editor' | 'viewer'; canApprove: boolean }
export interface ProcessRow { id: string; workspaceId: string; name: string; description: string; updatedAt: string }

export interface RevisionRow {
  id: string;
  revNo: number;
  state: 'working' | 'approved' | 'superseded';
  seq: number;
  modelHash: string | null;
  basedOn: string | null;
  createdAt: string;
  approvedAt: string | null;
}

export interface EditRow { revisionId: string; seq: number; origin: string; summary: string; createdAt: string; operations: number }

export interface Draft { revisionId: string; revNo: number; seq: number; model: ProcessModel; modelHash: string | null }

export interface SourceRow {
  id: string;
  key: string;
  title: string;
  fileName: string;
  format: StoredFormat;
  kind: string;
  inferred: boolean;
  segmentCount: number;
  warnings: string[];
  createdAt: string;
  archived: boolean;
}

export interface NewSource {
  key: string;
  title: string;
  fileName: string;
  format: StoredFormat;
  kind: string;
  segments: IngestSegment[];
  inferred: boolean;
  warnings: string[];
  byteSize: number;
}

export type ExtractionStatus = 'queued' | 'running' | 'merging' | 'reviewing' | 'assembling' | 'done' | 'failed';
export interface ExtractionRow { id: string; status: ExtractionStatus; error: string | null; createdAt: string; updatedAt: string; model: ProcessModel | null }

/** A failed request, with the HTTP-like status the server returned. */
export class StoreError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface JourneyStore {
  readonly kind: 'supabase' | 'memory';
  currentUser(): Promise<Me | null>;
  onAuthChange(listener: (me: Me | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  signOut(): Promise<void>;

  listWorkspaces(): Promise<Workspace[]>;
  createOrganization(organizationName: string, workspaceName: string): Promise<{ workspaceId: string }>;

  /** The assessment settings of a workspace; the defaults when none are set. */
  getSettings(workspaceId: string): Promise<SettingsRecord>;
  /** Admins only. */
  saveSettings(workspaceId: string, settings: AssessmentSettings): Promise<void>;

  listProcesses(workspaceId: string): Promise<ProcessRow[]>;
  createProcess(workspaceId: string, name: string): Promise<ProcessRow>;
  getProcess(processId: string): Promise<ProcessRow | null>;

  /** Revisions of a process, newest first. */
  listRevisions(processId: string): Promise<RevisionRow[]>;
  /** The model of one revision. */
  getModel(revisionId: string): Promise<ProcessModel | null>;
  startDraft(processId: string): Promise<Draft>;
  /** Saves one edit to the working draft. 409 when the draft moved on or was approved: reload and redo. */
  savePatch(revisionId: string, expectedSeq: number, patch: JsonPatchOp[], origin: 'user' | 'extraction' | 'diagram' | 'import', summary: string): Promise<{ seq: number }>;
  approve(revisionId: string, expectedSeq: number): Promise<void>;
  history(processId: string): Promise<{ revisions: RevisionRow[]; edits: EditRow[] }>;

  /** Sources of a process, oldest first, without their content. Archived ones are included and marked. */
  listSources(processId: string): Promise<SourceRow[]>;
  getSourceSegments(sourceId: string): Promise<IngestSegment[]>;
  addSource(processId: string, source: NewSource): Promise<SourceRow>;
  archiveSource(sourceId: string): Promise<void>;

  /** Whether AI tasks (image reading, extraction) are available with this store. */
  readonly aiAvailable: boolean;
  /** Reads a flowchart image with the AI; returns the raw reading for readingToGraph. */
  readFlowchartImage(workspaceId: string, dataUrl: string): Promise<unknown>;
  /** The text of a recorded answer (a data URL of audio). */
  transcribe(workspaceId: string, audioDataUrl: string): Promise<string>;
  startExtraction(workspaceId: string, processId: string, sourceIds: string[]): Promise<{ runId: string }>;
  /** The latest extraction of a process, with its model once done. */
  latestExtraction(processId: string): Promise<ExtractionRow | null>;
  /** Runs a registered AI task on segments; quotes in the result are already checked against them. */
  runAiTask(workspaceId: string, task: string, segments: Segment[]): Promise<{ data: unknown }>;

  /** Overrides and the cost rate for a process's assessment (the latest saved). */
  getAssessmentDecisions(processId: string): Promise<Decisions>;
  /** Saves the decisions with a snapshot of the result for the model revision it was computed on. */
  saveAssessment(processId: string, input: { revisionId: string; modelHash: string; rulesVersion: string; result: unknown; decisions: Decisions }): Promise<void>;
}
