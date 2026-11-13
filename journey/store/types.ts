import type { AssessmentSettings, SettingsRecord } from '../../domain/assess/settings.ts';
import type { DocumentSettings } from '../../domain/docs/branding.ts';
// Everything the journey screens read and write goes through this interface. The Supabase store is
// the real one; the memory store backs browser tests and local runs without a backend.
import type { ProcessModel } from '../../domain/processModel/types.ts';
import type { JsonPatchOp } from '../../domain/processModel/jsonPatch.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import type { StoredFormat } from '../../domain/workspace/sources.ts';
import type { Decisions } from '../../domain/assess/decisions.ts';
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import type { SectionEdit } from '../../domain/docs/edits.ts';
import type { Proposal } from '../../domain/workitems/register.ts';
import type { Project, WorkItem, WorkItemEdit } from '../../domain/workitems/board.ts';
import type { Segment } from '../../domain/ai/gateway.ts';
import type { AuditEntry, Job, RoleDef } from '../../domain/people/roles.ts';
import type { ProviderId } from '../../domain/auth/providers.ts';

export interface Me { id: string; email: string }
export interface Workspace { id: string; name: string; organizationName: string; role: 'admin' | 'editor' | 'viewer'; canApprove: boolean; job?: Job | null }
/** A person in a workspace, as others see them: a name, never an email address. */
export interface Member { userId: string; name: string; role: Workspace['role'] }
/** A person as an admin sees them in the People screen. `email` is set for admins only. */
export interface Person { userId: string; name: string; email: string | null; role: Workspace['role']; job: Job | null; canApprove: boolean; since: string }
export interface Invite { email: string; role: Workspace['role']; job: Job | null; canApprove: boolean; at: string }
export type RoleChoice = Pick<RoleDef, 'access' | 'job' | 'canApprove'>;
export interface ProcessRow { id: string; workspaceId: string; name: string; description: string; updatedAt: string; analystId?: string | null; architectId?: string | null; approverId?: string | null }
/** The people named on a process. Each is a workspace member or null. */
export interface ProcessPeople { analystId: string | null; architectId: string | null; approverId: string | null }

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
  readonly kind: 'supabase' | 'memory' | 'demo';
  currentUser(): Promise<Me | null>;
  onAuthChange(listener: (me: Me | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }>;
  /** The sign-in providers (Google, Microsoft) the server has turned on; none when it cannot tell. */
  signInProviders(): Promise<ProviderId[]>;
  /** Leaves for the provider's sign-in page; the provider sends the person back to /signin. */
  signInWithProvider(provider: ProviderId): Promise<void>;
  signOut(): Promise<void>;

  listWorkspaces(): Promise<Workspace[]>;
  /** The people in a workspace, for assigning work. */
  listMembers(workspaceId: string): Promise<Member[]>;
  /** Everyone in a workspace with their role, and pending invitations (admins only). */
  listPeople(workspaceId: string): Promise<{ members: Person[]; invites: Invite[] }>;
  /** Admins only. Someone with an account joins at once; otherwise the invitation waits for their sign-up. */
  invitePerson(workspaceId: string, email: string, role: RoleChoice): Promise<{ state: 'member' | 'invited' }>;
  /** Admins only. The last admin cannot be demoted. */
  changePerson(workspaceId: string, userId: string, role: RoleChoice): Promise<void>;
  /** Admins only. Their work items stay on the board, unassigned. */
  removePerson(workspaceId: string, userId: string): Promise<void>;
  cancelInvite(workspaceId: string, email: string): Promise<void>;
  /** Admins only. Membership changes and approvals, newest first. */
  auditLog(workspaceId: string): Promise<AuditEntry[]>;
  createOrganization(organizationName: string, workspaceName: string): Promise<{ workspaceId: string }>;

  /** The assessment settings of a workspace; the defaults when none are set. */
  getSettings(workspaceId: string): Promise<SettingsRecord>;
  /** Admins only. */
  saveSettings(workspaceId: string, settings: AssessmentSettings): Promise<void>;
  /** How the workspace's documents look and are laid out; the defaults when none are set. */
  getDocumentSettings(workspaceId: string): Promise<DocumentSettings>;
  /** Admins only. */
  saveDocumentSettings(workspaceId: string, settings: DocumentSettings): Promise<void>;

  listProcesses(workspaceId: string): Promise<ProcessRow[]>;
  createProcess(workspaceId: string, name: string): Promise<ProcessRow>;
  getProcess(processId: string): Promise<ProcessRow | null>;
  /** Editors and admins. Everyone named must be a member of the workspace. */
  setProcessPeople(processId: string, people: ProcessPeople): Promise<void>;

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

  /** The process's requirements register (every requirement ever given an ID). */
  listRequirements(processId: string): Promise<StoredRequirement[]>;
  /** Inserts or updates requirements by their ID; editors and admins only. Nothing is deleted. */
  saveRequirements(processId: string, rows: StoredRequirement[]): Promise<void>;

  /** People's edits to section narratives, for every document of the process. */
  listDocumentEdits(processId: string): Promise<SectionEdit[]>;
  /** Saves an edit (one per section); editors and admins only. */
  saveDocumentEdit(processId: string, edit: SectionEdit): Promise<void>;
  /** Removes an edit, so the section shows the generated text again ("take update"). */
  removeDocumentEdit(processId: string, docType: SectionEdit['docType'], sectionKey: string): Promise<void>;

  /** The process's work proposals, every one ever derived (by derivation key). */
  listProposals(processId: string): Promise<Proposal[]>;
  /** Inserts or updates proposals by derivation key; editors and admins only. Nothing is deleted. */
  saveProposals(processId: string, rows: Proposal[]): Promise<void>;

  /** Delivery board projects of the workspace. */
  listProjects(workspaceId: string): Promise<Project[]>;
  createProject(workspaceId: string, name: string): Promise<Project>;
  /** Puts the selected proposals on the board once: a repeat creates nothing. */
  confirmProposals(processId: string, projectId: string, keys: string[]): Promise<{ created: number; skipped: number }>;
  listWorkItems(projectId: string): Promise<WorkItem[]>;
  updateWorkItem(id: string, edit: WorkItemEdit): Promise<WorkItem>;
}
