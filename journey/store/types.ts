// Everything the journey screens read and write goes through this interface. The Supabase store is
// the real one; the memory store backs browser tests and local runs without a backend.
import type { ProcessModel } from '../../domain/processModel/types.ts';

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

  listProcesses(workspaceId: string): Promise<ProcessRow[]>;
  createProcess(workspaceId: string, name: string): Promise<ProcessRow>;
  getProcess(processId: string): Promise<ProcessRow | null>;

  /** Revisions of a process, newest first. */
  listRevisions(processId: string): Promise<RevisionRow[]>;
  /** The model of one revision. */
  getModel(revisionId: string): Promise<ProcessModel | null>;
  startDraft(processId: string): Promise<Draft>;
  approve(revisionId: string, expectedSeq: number): Promise<void>;
  history(processId: string): Promise<{ revisions: RevisionRow[]; edits: EditRow[] }>;
}
