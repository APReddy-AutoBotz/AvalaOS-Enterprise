import { forgetOnSignOut } from '../forgetOnSignOut.ts';
import { leavesNoAdmin, PeopleError, roleOf, validateEmail, type AuditEntry } from '../../domain/people/roles.ts';
import type { SectionComment } from '../../domain/docs/review.ts';
import type { TestCaseEdit } from '../../domain/docs/testEdits.ts';
import { findRecorded, NOT_RECORDED, type RecordedAnswer } from '../../domain/assistant/recorded.ts';
import { documentSettingsFrom, validateBranding, type DocumentSettings } from '../../domain/docs/branding.ts';
import { DEFAULT_SETTINGS, settingsFrom, validateSettings, type AssessmentSettings } from '../../domain/assess/settings.ts';
// In-memory store with the same rules as the database: one working draft per process, approved
// revisions never change, a new draft copies the approved model. State is kept in localStorage
// so a reload keeps it. Used by browser tests and local runs without a backend; it starts empty.
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { hashModel } from '../../domain/processModel/hash.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';
import { applyPatch } from '../../domain/processModel/jsonPatch.ts';
import { validateModel, errorsOf } from '../../domain/processModel/validate.ts';
import { StoreError, type WorkspaceAi, type Draft, type EditRow, type JourneyStore, type Me, type Person, type Invite, type RoleChoice, type ProcessRow, type RevisionRow, type SourceRow, type Workspace } from './types.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';
import { emptyDecisions, type Decisions } from '../../domain/assess/decisions.ts';
import type { StoredLook } from '../../domain/assistant/sharedLook.ts';
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import type { SectionEdit } from '../../domain/docs/edits.ts';
import type { Proposal } from '../../domain/workitems/register.ts';
import type { Project, WorkItem } from '../../domain/workitems/board.ts';
import { changedFields, type ItemComment, type ItemEvent } from '../../domain/workitems/collab.ts';
import type { Sprint } from '../../domain/workitems/sprints.ts';
import { validateModules } from '../../domain/workspace/modules.ts';
import { providerLabel } from '../../domain/auth/providers.ts';
import { keyHint, validateAiChoice, validateApiKey } from '../../domain/ai/providers.ts';
import { validateApplication, type Application } from '../../domain/workspace/applications.ts';
import type { WalkthroughRequest } from '../../domain/site/inquiry.ts';
import { readKept, KeptFormatError, type Fingerprints, type KeptDocuments, type KeptInputs, type KeptLook } from '../../domain/docs/keep.ts';
import { reasonProblem } from '../../domain/docs/versions.ts';
import { hashValue } from '../../domain/processModel/hash.ts';
import { DRAFT_CHANGES_SHOWN, type DraftChangeRow, type VersionRow, type VersionStateRow } from './types.ts';
import type { StandIn } from './standIns.ts';

interface StoredRevision extends RevisionRow { processId: string; model: ProcessModel }
/** A kept version (package 14), as the database's approved_versions holds it. */
interface StoredVersion extends VersionRow { processId: string; workspaceId: string; kept: KeptDocuments; fingerprints: Fingerprints; lookFingerprint: string; inputs: KeptInputs | null; changeMark: number }
/** One row of the change record (the database's draft_changes): a person's change, or one that follows another. */
interface DraftChange { id: number; workspaceId: string; processId: string | null; kind: string; person: boolean; change?: 'added' | 'changed' | 'removed'; items?: (string | null)[]; actor?: string | null; at?: string }
interface State {
  me: Me | null;
  workspaces: Workspace[];
  processes: ProcessRow[];
  revisions: StoredRevision[];
  edits: (EditRow & { processId: string })[];
  sources: (SourceRow & { processId: string; segments: IngestSegment[] })[];
  assessments?: { processId: string; revisionId: string; decisions: Decisions; result: unknown }[];
  requirements?: Record<string, StoredRequirement[]>;
  docEdits?: Record<string, SectionEdit[]>;
  sectionComments?: (SectionComment & { processId: string })[];
  testEdits?: Record<string, TestCaseEdit[]>;
  proposals?: Record<string, Proposal[]>;
  projects?: (Project & { workspaceId: string })[];
  workItems?: WorkItem[];
  settings?: { workspaceId: string; assessment: AssessmentSettings; updatedBy: string; updatedAt: string }[];
  documentSettings?: { workspaceId: string; settings: DocumentSettings }[];
  people?: Record<string, { members: Person[]; invites: Invite[]; audit: AuditEntry[] }>;
  /** Only what the browser may know of a key: its last four characters. */
  ai?: Record<string, WorkspaceAi>;
  needsEmail?: boolean;
  comments?: ItemComment[];
  itemEvents?: ItemEvent[];
  sprints?: Sprint[];
  applications?: (Application & { workspaceId: string })[];
  /** What was looked up in each process's sources (the server's process_source_looks). */
  looks?: Record<string, StoredLook>;
  /** Walkthrough requests from the homepage (the server's walkthrough_requests); the in-browser person is the platform owner. */
  walkthroughRequests?: WalkthroughRequest[];
  /** Set by a test that plays the platform owner: Settings then shows the walkthrough requests. */
  platformOwner?: boolean;
  /** Package 14: kept versions, their looks (stored once per workspace), and the change record. */
  versions?: StoredVersion[];
  keptLooks?: { workspaceId: string; fingerprint: string; look: KeptLook }[];
  draftChanges?: DraftChange[];
}

const KEY = 'avala.journey.memory.v1';
const empty = (): State => ({ me: null, workspaces: [], processes: [], revisions: [], edits: [], sources: [] });

function load(): State {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

export { emptyModel };

const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
const strip = ({ processId: _p, model: _m, ...row }: StoredRevision): RevisionRow => row;

export interface MemoryStoreOptions {
  /**
   * The demo: start from this state (the sample case as the tour test leaves it, public/demo-data/sample.json)
   * and keep every change in memory only, so a reload starts again and nothing reaches local storage.
   */
  demo?: unknown;
  /** The demo's recorded answers to the suggested questions, played back by runAiTask. */
  recorded?: RecordedAnswer[];
  /** Browser tests only (journey/store/standIns.ts): replies a test gave, by task name. With it the store reads with AI. */
  standIn?: StandIn;
}

export function createMemoryStore(options: MemoryStoreOptions = {}): JourneyStore {
  const demo = options.demo !== undefined;
  let state: State = demo ? { ...empty(), ...(structuredClone(options.demo) as Partial<State>) } : load();
  const listeners = new Set<(me: Me | null) => void>();
  const save = () => {
    if (demo) return;
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  };
  const where = demo ? 'in the demo' : 'in local mode';
  const requireMe = () => { if (!state.me) throw new StoreError(401, 'Sign in again.'); return state.me; };
  const workspaceOf = (processId: string) => {
    const p = state.processes.find(x => x.id === processId);
    const w = p && state.workspaces.find(x => x.id === p.workspaceId);
    if (!p || !w) throw new StoreError(404, 'Process not found.');
    return { p, w };
  };

  const nameOf = () => requireMe().email.split('@')[0]!;
  // The change record, as the database's recording triggers write it: one row per saved change, a person's
  // own or one that follows another; never a value. The tag and the approval guard read it.
  // As the database keeps them: what changed (added, changed, removed), which items by their names in the product,
  // who and when; History lists them (pull request 5).
  const noteChange = (workspaceId: string, processId: string | null, kind: string, person = true, change: 'added' | 'changed' | 'removed' = 'changed', items: (string | null)[] = [null]) => {
    const rows = (state.draftChanges ??= []);
    rows.push({ id: (rows[rows.length - 1]?.id ?? 0) + 1, workspaceId, processId, kind, person, change, items, actor: state.me?.id ?? null, at: now() });
  };
  const changesSeen = (workspaceId: string, processId: string) => (state.draftChanges ?? []).filter(d => (d.processId === processId && d.person) || (d.workspaceId === workspaceId && d.processId === null)).length;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  /** The workspace of a board item, for the member rules. */
  const itemWorkspace = (workItemId: string) => {
    const item = (state.workItems ?? []).find(i => i.id === workItemId);
    const project = item && (state.projects ?? []).find(p => p.id === item.projectId);
    const w = project && state.workspaces.find(x => x.id === project.workspaceId);
    if (!w) throw new StoreError(404, 'Work item not found.');
    return w;
  };
  // History, as the database's trigger writes it (changedFields mirrors app_private.log_work_item_change).
  let eventSeq = Math.max(0, ...(state.itemEvents ?? []).map(x => Number(x.id)));
  const pushEvent = (e: Omit<ItemEvent, 'id' | 'createdAt' | 'actorId'>) => (state.itemEvents ??= []).push({ ...e, id: String(++eventSeq), actorId: state.me?.id ?? null, createdAt: now() });
  const logCreated = (workItemId: string) => pushEvent({ workItemId, kind: 'created', field: null, oldValue: null, newValue: null });
  const sprintEditable = (id: string) => {
    const sprint = (state.sprints ?? []).find(x => x.id === id);
    const project = sprint && (state.projects ?? []).find(p => p.id === sprint.projectId);
    const w = project && state.workspaces.find(x => x.id === project.workspaceId);
    if (!sprint || !w) throw new StoreError(404, 'Sprint not found.');
    if (w.role === 'viewer') throw new StoreError(403, 'Changing a sprint needs the editor or admin role.');
    return sprint;
  };
  const logChange = (before: WorkItem, after: WorkItem) => { for (const c of changedFields(before, after)) pushEvent({ workItemId: after.id, kind: 'changed', ...c }); };
  const peopleOf = (workspaceId: string) => {
    const me = requireMe();
    const w = state.workspaces.find(x => x.id === workspaceId);
    if (!w) throw new StoreError(404, 'Workspace not found.');
    const all = (state.people ??= {});
    return (all[workspaceId] ??= { members: [{ userId: me.id, name: me.email.split('@')[0]!, email: me.email, role: 'admin', job: null, canApprove: true, since: now() }], invites: [], audit: [] });
  };
  const adminOf = (workspaceId: string, strict = true) => {
    peopleOf(workspaceId);
    const w = state.workspaces.find(x => x.id === workspaceId);
    const ok = w?.role === 'admin';
    if (!ok && strict) throw new StoreError(403, 'Only an admin can do that.');
    return ok;
  };

  return {
    kind: demo ? 'demo' : 'memory',
    async currentUser() { return state.me; },
    onAuthChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async signIn(email, password) {
      if (!email.includes('@') || password.length < 6) throw new StoreError(400, 'Enter an email address and a password of at least 6 characters.');
      state.me = { id: state.me?.email === email ? state.me.id : uuid(), email };
      save();
      listeners.forEach(l => l(state.me));
    },
    async signUp(email, password) { await this.signIn(email, password); return { needsConfirmation: false }; },
    async signOut() { forgetOnSignOut(); state.me = null; save(); listeners.forEach(l => l(null)); },
    // The in-browser store has no email and no passwords to keep: both succeed and change nothing.
    async requestPasswordReset() { /* nothing to send */ },
    async setNewPassword() { requireMe(); },
    // The in-browser store has no provider to send anyone to: it offers both so the screen can be
    // tested, and says so when one is chosen.
    async signInProviders() { return ['google', 'azure']; },
    async signInWithProvider(provider) {
      throw new StoreError(501, `${providerLabel(provider)} sign-in needs the server; this is the in-browser store.`);
    },

    async listWorkspaces() { requireMe(); return state.workspaces.map(w => ({ canAddWorkspace: true, ...w })); },
    async setProcessPeople(processId, people) {
      requireMe();
      const { p, w } = workspaceOf(processId);
      if (w.role === 'viewer') throw new StoreError(403, 'Naming people on a process needs the editor or admin role.');
      const members = peopleOf(w.id).members;
      for (const id of [people.analystId, people.architectId, people.approverId]) {
        if (id && !members.some(m => m.userId === id)) throw new StoreError(400, 'That person is not a member of this workspace');
      }
      Object.assign(p, people);
      save();
    },
    // The in-browser store has one person, who is the owner.
    async canCreateOrganization() { return true; },
    async isPlatformOwner() { return state.platformOwner === true; },
    async listWalkthroughRequests() {
      requireMe();
      if (state.platformOwner !== true) throw new StoreError(403, 'Only the Avala OS owner can read walkthrough requests.');
      return [...(state.walkthroughRequests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => ({ ...r }));
    },
    async setWalkthroughRequestStatus(id, status) {
      requireMe();
      const r = (state.walkthroughRequests ?? []).find(x => x.id === id);
      if (!r) throw new StoreError(404, 'No such request.');
      r.status = status; r.lastContactAt = now();
      save();
    },
    async noteWalkthroughReply(id) {
      requireMe();
      const r = (state.walkthroughRequests ?? []).find(x => x.id === id);
      if (!r) throw new StoreError(404, 'No such request.');
      r.lastContactAt = now();
      save();
    },
    async deleteWalkthroughRequest(id) {
      requireMe();
      state.walkthroughRequests = (state.walkthroughRequests ?? []).filter(x => x.id !== id);
      save();
    },
    async createOrganization(organizationName, workspaceName) {
      requireMe();
      const id = uuid();
      const w: Workspace = { id, name: workspaceName.trim() || 'General', organizationName: organizationName.trim(), role: 'admin', canApprove: true, organizationId: id, modules: ['assess', 'documents', 'board'], canAddWorkspace: true };
      if (!w.organizationName) throw new StoreError(400, 'Name the organization.');
      state.workspaces.push(w);
      save();
      return { workspaceId: w.id };
    },

    async createWorkspace(organizationId, name) {
      requireMe();
      const first = state.workspaces.find(w => (w.organizationId ?? w.id) === organizationId);
      if (!first) throw new StoreError(404, 'Organisation not found');
      if (!name.trim() || name.trim().length > 120) throw new StoreError(400, 'Workspace name must be 1 to 120 characters');
      const w: Workspace = { id: uuid(), name: name.trim(), organizationName: first.organizationName, role: 'admin', canApprove: true, organizationId, modules: first.modules, canAddWorkspace: true };
      state.workspaces.push(w);
      save();
      return w.id;
    },
    async setOrganizationModules(organizationId, modules) {
      requireMe();
      const list = state.workspaces.filter(w => (w.organizationId ?? w.id) === organizationId);
      if (!list.length) throw new StoreError(404, 'Organisation not found');
      const chosen = validateModules(modules);
      for (const w of list) w.modules = [...chosen];
      save();
      return chosen;
    },
    async getSettings(workspaceId) {
      requireMe();
      const row = (state.settings ?? []).find(x => x.workspaceId === workspaceId);
      return row ? { settings: settingsFrom(row.assessment), custom: true, updatedBy: row.updatedBy, updatedAt: row.updatedAt } : { settings: { ...DEFAULT_SETTINGS }, custom: false, updatedBy: null, updatedAt: null };
    },
    async saveSettings(workspaceId, settings) {
      const me = requireMe();
      const w = state.workspaces.find(x => x.id === workspaceId);
      if (!w) throw new StoreError(404, 'Workspace not found.');
      if (w.role !== 'admin') throw new StoreError(403, 'Only an admin can change the settings.');
      const valid = validateSettings(settings);
      const before = (state.settings ?? []).find(x => x.workspaceId === workspaceId)?.assessment;
      state.settings = [...(state.settings ?? []).filter(x => x.workspaceId !== workspaceId), { workspaceId, assessment: valid, updatedBy: me.email, updatedAt: now() }];
      if (!same(before, valid)) noteChange(workspaceId, null, 'assessment_settings');
      save();
    },
    async getDocumentSettings(workspaceId) {
      requireMe();
      return documentSettingsFrom((state.documentSettings ?? []).find(x => x.workspaceId === workspaceId)?.settings);
    },
    async saveDocumentSettings(workspaceId, settings) {
      requireMe();
      const w = state.workspaces.find(x => x.id === workspaceId);
      if (!w) throw new StoreError(404, 'Workspace not found.');
      if (w.role !== 'admin') throw new StoreError(403, 'Only an admin can change how documents look.');
      const valid = { branding: validateBranding(settings.branding), layouts: settings.layouts };
      const before = (state.documentSettings ?? []).find(x => x.workspaceId === workspaceId)?.settings;
      state.documentSettings = [...(state.documentSettings ?? []).filter(x => x.workspaceId !== workspaceId), { workspaceId, settings: valid }];
      if (!same(before?.layouts ?? {}, valid.layouts ?? {})) noteChange(workspaceId, null, 'layout');
      if (before && !same(before.branding, valid.branding)) noteChange(workspaceId, null, 'look');
      save();
    },
    async listProcesses(workspaceId) {
      requireMe();
      return state.processes.filter(p => p.workspaceId === workspaceId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async createProcess(workspaceId, name) {
      requireMe();
      const w = state.workspaces.find(x => x.id === workspaceId);
      if (!w) throw new StoreError(404, 'Workspace not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Viewers cannot add processes.');
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 200) throw new StoreError(400, 'A process name is 1 to 200 characters.');
      const p: ProcessRow = { id: uuid(), workspaceId, name: trimmed, description: '', updatedAt: now() };
      state.processes.push(p);
      save();
      return p;
    },
    async getProcess(processId) { requireMe(); return state.processes.find(p => p.id === processId) ?? null; },

    async listRevisions(processId) {
      requireMe();
      return state.revisions.filter(r => r.processId === processId).sort((a, b) => b.revNo - a.revNo).map(strip);
    },
    async getModel(revisionId) { requireMe(); return state.revisions.find(r => r.id === revisionId)?.model ?? null; },
    async startDraft(processId) {
      requireMe();
      const { p, w } = workspaceOf(processId);
      const existing = state.revisions.find(r => r.processId === processId && r.state === 'working');
      if (existing) return { revisionId: existing.id, revNo: existing.revNo, seq: existing.seq, model: existing.model, modelHash: existing.modelHash };
      if (w.role === 'viewer') throw new StoreError(403, 'Editing needs the editor or admin role.');
      const approved = state.revisions.find(r => r.processId === processId && r.state === 'approved');
      const revNo = Math.max(0, ...state.revisions.filter(r => r.processId === processId).map(r => r.revNo)) + 1;
      const model = approved ? structuredClone(approved.model) : emptyModel(p.name);
      const rev: StoredRevision = { id: uuid(), processId, revNo, state: 'working', seq: 0, model, modelHash: hashModel(model), basedOn: approved?.id ?? null, createdAt: now(), approvedAt: null };
      state.revisions.push(rev);
      p.updatedAt = now();
      save();
      return { revisionId: rev.id, revNo, seq: 0, model, modelHash: rev.modelHash };
    },
    async savePatch(revisionId, expectedSeq, patch, origin, summary) {
      requireMe();
      const rev = state.revisions.find(r => r.id === revisionId);
      if (!rev) throw new StoreError(404, 'Revision not found.');
      const { w } = workspaceOf(rev.processId);
      if (w.role === 'viewer') throw new StoreError(403, 'Editing needs the editor or admin role.');
      if (rev.state !== 'working') throw new StoreError(409, 'This revision is approved and cannot change.');
      if (rev.seq !== expectedSeq) throw new StoreError(409, 'The draft changed since you opened it. Reload and try again.');
      if (!patch.length) throw new StoreError(422, 'The edit is empty.');
      let next: ProcessModel;
      try { next = applyPatch(rev.model, patch); } catch (e) { throw new StoreError(422, (e as Error).message); }
      const v = validateModel(next);
      if (!v.valid) throw new StoreError(422, errorsOf(v)[0].message);
      rev.model = next;
      rev.seq += 1;
      rev.modelHash = hashModel(next);
      state.edits.push({ processId: rev.processId, revisionId, seq: rev.seq, origin, summary, createdAt: now(), operations: patch.length });
      // As the database does: an edit moves the draft's own time; the process row's moves when the process itself changes.
      rev.updatedAt = now();
      save();
      return { seq: rev.seq };
    },
    async approve(revisionId, expectedSeq) {
      requireMe();
      const rev = state.revisions.find(r => r.id === revisionId);
      if (!rev) throw new StoreError(404, 'Revision not found.');
      const { w } = workspaceOf(rev.processId);
      if (!w.canApprove) throw new StoreError(403, 'Approving needs approval rights.');
      if (rev.state !== 'working') throw new StoreError(409, 'Only the working draft can be approved.');
      if (rev.seq !== expectedSeq) throw new StoreError(409, 'The draft changed since you opened it. Reload and try again.');
      state.revisions.filter(r => r.processId === rev.processId && r.state === 'approved').forEach(r => { r.state = 'superseded'; });
      rev.state = 'approved';
      rev.approvedAt = now();
      rev.approvedBy = state.me!.id;
      save();
    },
    async versionStates(workspaceId, processId) {
      requireMe();
      return state.processes.filter(p => p.workspaceId === workspaceId && (!processId || p.id === processId)).map((p): VersionStateRow => {
        const mine = (state.versions ?? []).filter(v => v.processId === p.id).sort((a, b) => b.number - a.number);
        const latest = mine[0];
        const approved = state.revisions.find(r => r.processId === p.id && r.state === 'approved');
        const working = state.revisions.find(r => r.processId === p.id && r.state === 'working');
        const after = (d: DraftChange) => Boolean(latest && d.id > latest.changeMark);
        return {
          processId: p.id,
          latest: latest ? { id: latest.id, number: latest.number, approvedAt: latest.approvedAt, approvedBy: latest.approvedBy, approvedByName: latest.approvedByName, keptAt: latest.keptAt } : null,
          approvedRevisionId: approved?.id ?? null, approvedRevNo: approved?.revNo ?? null,
          approvedHasVersion: Boolean(approved && (state.versions ?? []).some(v => v.revisionId === approved.id)),
          processChanged: Boolean(latest && ((working && working.seq > 0) || (state.draftChanges ?? []).some(d => d.processId === p.id && d.person && after(d)))),
          workspaceChanges: latest ? [...new Set((state.draftChanges ?? []).filter(d => d.workspaceId === workspaceId && d.processId === null && after(d)).map(d => d.kind))].sort() as VersionStateRow['workspaceChanges'] : [],
          changesSeen: changesSeen(workspaceId, p.id),
        };
      });
    },
    async approveVersion(i) {
      const me = requireMe();
      const { w } = workspaceOf(i.processId);
      if (!w.canApprove) throw new StoreError(403, 'Approving needs approval rights.');
      // The same checks, in the same order, as the database's approve_version; nothing changes until all pass.
      const rev = i.revisionId ? state.revisions.find(r => r.id === i.revisionId) : null;
      if (i.revisionId) {
        if (!rev || rev.processId !== i.processId) throw new StoreError(404, 'Revision not found.');
        if (rev.state !== 'working') throw new StoreError(409, 'Only the working draft can be approved.');
        if (rev.seq !== i.expectedSeq) throw new StoreError(409, 'The draft changed since you opened it. Reload and try again.');
      } else if (state.revisions.some(r => r.processId === i.processId && r.state === 'working' && r.seq > 0)) {
        throw new StoreError(409, 'the process record has a working draft; approve it', 'DRAFT_EXISTS');
      }
      const record = rev ?? state.revisions.find(r => r.processId === i.processId && r.state === 'approved');
      if (!record) throw new StoreError(409, 'the process has no record to approve', 'NOTHING_TO_APPROVE');
      const latest = Math.max(0, ...(state.versions ?? []).filter(v => v.processId === i.processId).map(v => v.number));
      if (latest !== i.expectedVersion) throw new StoreError(409, `approved version ${latest} exists; reload to see what changed`, 'VERSION_CONFLICT');
      if (changesSeen(w.id, i.processId) !== i.expectedChanges) throw new StoreError(409, 'someone saved a change after this page read the documents; reload and approve again', 'CHANGED_MEANWHILE');
      const problem = reasonProblem(latest + 1, i.reason);
      if (problem) throw new StoreError(422, problem, latest + 1 === 1 ? 'REASON_NOT_TAKEN' : 'REASON_REQUIRED');
      try { readKept(i.documents); } catch (e) { throw new StoreError(422, e instanceof KeptFormatError ? e.message : 'the documents are not a kept set of format 1', 'VERSION_INVALID'); }
      if (rev) {
        state.revisions.filter(r => r.processId === rev.processId && r.state === 'approved').forEach(r => { r.state = 'superseded'; });
        rev.state = 'approved'; rev.approvedAt = now(); rev.approvedBy = me.id;
      }
      const fingerprint = hashValue(i.look);
      if (!(state.keptLooks ?? []).some(l => l.workspaceId === w.id && l.fingerprint === fingerprint)) (state.keptLooks ??= []).push({ workspaceId: w.id, fingerprint, look: structuredClone(i.look) });
      const mark = Math.max(0, ...(state.draftChanges ?? []).filter(d => d.processId === i.processId || (d.workspaceId === w.id && d.processId === null)).map(d => d.id));
      const name = peopleOf(w.id).members.find(m => m.userId === me.id)?.name?.trim() || null;
      const v: StoredVersion = {
        id: uuid(), number: latest + 1, revisionId: record.id, approvedAt: now(), approvedBy: me.id, approvedByName: name, reason: i.reason?.trim() || null,
        changes: structuredClone(i.changes), keptAt: null, keptByName: null, processId: i.processId, workspaceId: w.id, kept: structuredClone(i.documents),
        fingerprints: structuredClone(i.fingerprints), lookFingerprint: fingerprint, inputs: structuredClone(i.inputs), changeMark: mark,
      };
      (state.versions ??= []).push(v);
      save();
      return { versionId: v.id, number: v.number };
    },
    async keepVersionAsReadsNow(i) {
      const me = requireMe();
      const { w } = workspaceOf(i.processId);
      if (!w.canApprove) throw new StoreError(403, 'Approving needs approval rights.');
      // The same checks, in the same order, as the database's keep_version_as_reads_now; nothing changes until all pass.
      const rev = state.revisions.find(r => r.processId === i.processId && r.state === 'approved');
      if (!rev) throw new StoreError(409, 'the process has no approved record', 'NOTHING_TO_APPROVE');
      if ((state.versions ?? []).some(v => v.revisionId === rev.id)) throw new StoreError(409, `approved revision ${rev.revNo} already has a kept version`, 'ALREADY_KEPT');
      const latest = Math.max(0, ...(state.versions ?? []).filter(v => v.processId === i.processId).map(v => v.number));
      if (latest !== i.expectedVersion) throw new StoreError(409, `approved version ${latest} exists; reload to see what changed`, 'VERSION_CONFLICT');
      if (changesSeen(w.id, i.processId) !== i.expectedChanges) throw new StoreError(409, 'someone saved a change after this page read the documents; reload and approve again', 'CHANGED_MEANWHILE');
      const problem = reasonProblem(latest + 1, i.reason);
      if (problem) throw new StoreError(422, problem, latest + 1 === 1 ? 'REASON_NOT_TAKEN' : 'REASON_REQUIRED');
      try { readKept(i.documents); } catch (e) { throw new StoreError(422, e instanceof KeptFormatError ? e.message : 'the documents are not a kept set of format 1', 'VERSION_INVALID'); }
      const fingerprint = hashValue(i.look);
      if (!(state.keptLooks ?? []).some(l => l.workspaceId === w.id && l.fingerprint === fingerprint)) (state.keptLooks ??= []).push({ workspaceId: w.id, fingerprint, look: structuredClone(i.look) });
      const mark = Math.max(0, ...(state.draftChanges ?? []).filter(d => d.processId === i.processId || (d.workspaceId === w.id && d.processId === null)).map(d => d.id));
      const nameNow = (id: string | null | undefined) => (id ? peopleOf(w.id).members.find(m => m.userId === id)?.name?.trim() || null : null);
      // Both facts: who approved the revision and when (as recorded with it), and who kept this copy and when.
      const v: StoredVersion = {
        id: uuid(), number: latest + 1, revisionId: rev.id, approvedAt: rev.approvedAt ?? now(), approvedBy: rev.approvedBy ?? null, approvedByName: nameNow(rev.approvedBy),
        reason: i.reason?.trim() || null, changes: structuredClone(i.changes), keptAt: now(), keptByName: nameNow(me.id), processId: i.processId, workspaceId: w.id,
        kept: structuredClone(i.documents), fingerprints: structuredClone(i.fingerprints), lookFingerprint: fingerprint, inputs: structuredClone(i.inputs), changeMark: mark,
      };
      (state.versions ??= []).push(v);
      save();
      return { versionId: v.id, number: v.number };
    },
    async listVersions(processId) {
      requireMe();
      workspaceOf(processId);
      return (state.versions ?? []).filter(v => v.processId === processId).sort((a, b) => b.number - a.number)
        .map(({ processId: _p, workspaceId: _w, kept: _k, fingerprints: _f, lookFingerprint: _l, inputs: _i, changeMark: _m, ...row }) => structuredClone(row));
    },
    async listDraftChanges(processId) {
      requireMe();
      const { w } = workspaceOf(processId);
      return (state.draftChanges ?? []).filter(d => d.processId === processId || (d.workspaceId === w.id && d.processId === null))
        .sort((a, b) => b.id - a.id).slice(0, DRAFT_CHANGES_SHOWN)
        .map(d => ({
          id: d.id, processId: d.processId, kind: d.kind as DraftChangeRow['kind'], change: d.change ?? 'changed', origin: d.person ? 'person' as const : 'follows' as const,
          items: (d.items ?? [null]).slice(0, 50), itemCount: (d.items ?? [null]).length, actor: d.actor ?? null, createdAt: d.at ?? '',
        }));
    },
    async getVersionPrints(versionId) {
      requireMe();
      const v = (state.versions ?? []).find(x => x.id === versionId);
      if (!v) throw new StoreError(404, 'Version not found.');
      return structuredClone({ fingerprints: v.fingerprints, inputs: v.inputs, lookFingerprint: v.lookFingerprint });
    },
    async getVersionLook(versionId) {
      requireMe();
      const v = (state.versions ?? []).find(x => x.id === versionId);
      if (!v) throw new StoreError(404, 'Version not found.');
      return structuredClone((state.keptLooks ?? []).find(l => l.workspaceId === v.workspaceId && l.fingerprint === v.lookFingerprint)!.look);
    },
    async getVersion(versionId) {
      requireMe();
      const v = (state.versions ?? []).find(x => x.id === versionId);
      if (!v) throw new StoreError(404, 'Version not found.');
      const { processId: _p, workspaceId: _w, kept, fingerprints: _f, lookFingerprint, inputs: _i, changeMark: _m, ...row } = v;
      return structuredClone({ ...row, kept: readKept(kept), look: (state.keptLooks ?? []).find(l => l.workspaceId === v.workspaceId && l.fingerprint === lookFingerprint)!.look });
    },
    async listSources(processId) {
      requireMe();
      workspaceOf(processId);
      return state.sources.filter(x => x.processId === processId).map(({ processId: _p, segments: _s, ...row }) => row);
    },
    async getSourceSegments(sourceId) {
      requireMe();
      const src = state.sources.find(x => x.id === sourceId);
      if (!src) throw new StoreError(404, 'Source not found.');
      return src.segments;
    },
    async addSource(processId, input) {
      requireMe();
      const { w } = workspaceOf(processId);
      if (w.role === 'viewer') throw new StoreError(403, 'Adding sources needs the editor or admin role.');
      if (state.sources.some(x => x.processId === processId && x.key === input.key)) throw new StoreError(409, 'A source with this key exists.');
      if (!input.segments.length) throw new StoreError(422, 'The source has no content.');
      const row: SourceRow = {
        id: uuid(), key: input.key, title: input.title.trim().slice(0, 200) || 'Untitled source', fileName: input.fileName, format: input.format, kind: input.kind,
        inferred: input.inferred, segmentCount: input.segments.length, warnings: input.warnings, createdAt: now(), archived: false,
      };
      state.sources.push({ ...row, processId, segments: input.segments });
      noteChange(w.id, processId, 'source', true, 'added', [input.key]);
      save();
      return row;
    },
    async archiveSource(sourceId) {
      requireMe();
      const src = state.sources.find(x => x.id === sourceId);
      if (!src) throw new StoreError(404, 'Source not found.');
      const { w: sw } = workspaceOf(src.processId);
      if (sw.role === 'viewer') throw new StoreError(403, 'Archiving needs the editor or admin role.');
      if (!src.archived) noteChange(sw.id, src.processId, 'source', true, 'removed', [src.key]);
      src.archived = true;
      save();
    },
    aiAvailable: Boolean(options.standIn),
    async readFlowchartImage() { throw new StoreError(501, `Reading images needs the server; it is not available ${where}.`); },
    async transcribe() { throw new StoreError(501, `Transcription needs the server; it is not available ${where}.`); },
    async startExtraction() { throw new StoreError(501, `Extraction needs the server; it is not available ${where}.`); },
    async latestExtraction() { return null; },
    async lookAtExtraction() { /* no extraction runs in the browser */ },
    async runAiTask(_workspaceId, task, segments) {
      if (options.standIn) return options.standIn.run(task, segments);
      // The demo answers its suggested questions from what was recorded on the sample case; nothing else.
      if (options.recorded) {
        const question = segments.find(s => s.id === 'question')?.text ?? '';
        const hit = findRecorded(options.recorded, task, question);
        if (hit) return { data: structuredClone(hit.reply), recorded: true };
        throw new StoreError(501, NOT_RECORDED);
      }
      throw new StoreError(501, `AI tasks need the server; they are not available ${where}.`);
    },
    async listProjects(workspaceId) {
      requireMe();
      return (state.projects ?? []).filter(p => p.workspaceId === workspaceId).map(({ workspaceId: _w, ...p }) => p);
    },
    async createProject(workspaceId, name) {
      requireMe();
      const w = state.workspaces.find(x => x.id === workspaceId);
      if (!w) throw new StoreError(404, 'Workspace not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Creating a project needs the editor or admin role.');
      const p = { id: crypto.randomUUID(), name, description: '', workspaceId };
      (state.projects ??= []).push(p);
      save();
      return { id: p.id, name: p.name, description: '' };
    },
    async confirmProposals(processId, projectId, keys) {
      requireMe();
      const { w } = workspaceOf(processId);
      if (w.role === 'viewer') throw new StoreError(403, 'Confirming needs the editor or admin role.');
      if (!(state.projects ?? []).some(p => p.id === projectId && p.workspaceId === w.id)) throw new StoreError(404, 'Project not found.');
      const list = (state.proposals ?? {})[processId] ?? [];
      const reqs = (state.requirements ?? {})[processId] ?? [];
      let created = 0, skipped = 0;
      let pending = [...keys];
      for (let pass = 0; pending.length && pass < 10; pass++) {
        for (const p of list.filter(x => pending.includes(x.key)).sort((a, b) => a.order - b.order)) {
          if (p.state === 'confirmed') { skipped++; pending = pending.filter(k => k !== p.key); continue; }
          if (p.state !== 'selected') throw new StoreError(409, `Not selected: ${p.title}`);
          if (p.parentKey && pending.includes(p.parentKey)) continue;
          const parent = list.find(x => x.key === p.parentKey && x.state === 'confirmed')?.workItemId ?? null;
          const item: WorkItem = { id: crypto.randomUUID(), projectId, parentId: parent, type: p.type, title: p.title, description: p.description, acceptance: p.acceptance, status: 'todo', priority: null, ownerId: null, estimateHours: null, startDate: null, dueDate: null, processId, stepIds: p.stepIds, requirements: p.requirements, snapshot: Object.fromEntries(reqs.filter(r => p.requirements.includes(r.code)).map(r => [r.code, r.statement])), updatedAt: new Date().toISOString() };
          (state.workItems ??= []).push(item);
          logCreated(item.id);
          p.state = 'confirmed'; p.workItemId = item.id;
          created++; pending = pending.filter(k => k !== p.key);
        }
      }
      if (pending.length) throw new StoreError(404, `${pending.length} of the selected items are unknown.`);
      save();
      return { created, skipped };
    },
    async listWorkItems(projectId) {
      requireMe();
      return structuredClone((state.workItems ?? []).filter(i => i.projectId === projectId));
    },
    async listMembers(workspaceId) {
      requireMe();
      return peopleOf(workspaceId).members.map(m => ({ userId: m.userId, name: m.name, role: m.role }));
    },
    async listPeople(workspaceId) {
      const admin = adminOf(workspaceId, false);
      const { members, invites } = peopleOf(workspaceId);
      return structuredClone({ members: members.map(m => ({ ...m, email: admin ? m.email : null })), invites: admin ? invites : [] });
    },
    async invitePerson(workspaceId, rawEmail, r) {
      adminOf(workspaceId);
      let email: string;
      try { email = validateEmail(rawEmail); } catch (e) { throw new StoreError(422, e instanceof PeopleError ? e.message : 'Enter a work email address.'); }
      const p = peopleOf(workspaceId);
      if (p.members.some(m => m.email === email)) throw new StoreError(409, `${email} is already in this workspace`);
      const label = roleOf({ access: r.access, canApprove: r.canApprove, job: r.job }).label;
      p.invites = p.invites.filter(i => i.email !== email).concat({ email, role: r.access, job: r.job, canApprove: r.canApprove || r.access === 'admin', at: now() });
      p.audit.unshift({ id: uuid(), at: now(), kind: 'invited', actor: nameOf(), subject: email, detail: label });
      save();
      return { state: 'invited' as const };
    },
    async changePerson(workspaceId, userId, r) {
      adminOf(workspaceId);
      const p = peopleOf(workspaceId);
      const m = p.members.find(x => x.userId === userId);
      if (!m) throw new StoreError(404, 'That person is not in this workspace');
      if (leavesNoAdmin(p.members.map(x => ({ userId: x.userId, access: x.role })), userId, r.access)) throw new StoreError(400, 'a workspace needs at least one admin');
      Object.assign(m, { role: r.access, job: r.job, canApprove: r.canApprove || r.access === 'admin' });
      const mine = state.me && m.userId === state.me.id ? state.workspaces.find(w => w.id === workspaceId) : null;
      if (mine) Object.assign(mine, { role: m.role, job: m.job, canApprove: m.canApprove });
      p.audit.unshift({ id: uuid(), at: now(), kind: 'role_changed', actor: nameOf(), subject: m.name, detail: roleOf({ access: m.role, canApprove: m.canApprove, job: m.job }).label });
      save();
    },
    async removePerson(workspaceId, userId) {
      adminOf(workspaceId);
      const p = peopleOf(workspaceId);
      const m = p.members.find(x => x.userId === userId);
      if (!m) throw new StoreError(404, 'That person is not in this workspace');
      if (leavesNoAdmin(p.members.map(x => ({ userId: x.userId, access: x.role })), userId, null)) throw new StoreError(400, 'a workspace needs at least one admin');
      p.members = p.members.filter(x => x.userId !== userId);
      for (const i of state.workItems ?? []) if (i.ownerId === userId) i.ownerId = null;
      for (const pr of state.processes) if (pr.workspaceId === workspaceId) { if (pr.analystId === userId) pr.analystId = null; if (pr.architectId === userId) pr.architectId = null; if (pr.approverId === userId) pr.approverId = null; }
      p.audit.unshift({ id: uuid(), at: now(), kind: 'removed', actor: nameOf(), subject: m.name, detail: '' });
      save();
    },
    async sendInviteEmail() { throw new StoreError(501, `Emails need the server; they are not sent ${where}`); },
    async getWorkspaceAi(workspaceId) { requireMe(); return state.ai?.[workspaceId] ?? null; },
    async saveWorkspaceAi(workspaceId, input) {
      adminOf(workspaceId, true);
      const choice = validateAiChoice(input);
      const current = state.ai?.[workspaceId];
      if (!input.apiKey && (!current || current.provider !== choice.provider)) throw new StoreError(422, 'Paste the API key for this provider.');
      const hint = input.apiKey ? keyHint(validateApiKey(input.apiKey)) : current!.keyHint;
      state.ai = { ...(state.ai ?? {}), [workspaceId]: { ...choice, keyHint: hint, updatedAt: now(), lastUsedAt: null, lastTestedAt: null, lastTestOk: null } };
      save();
    },
    async clearWorkspaceAi(workspaceId) {
      adminOf(workspaceId, true);
      if (state.ai) delete state.ai[workspaceId];
      save();
    },
    async testWorkspaceAi() { throw new StoreError(501, `Testing a key needs the server; it is not available ${where}.`); },
    async getNeedsEmail() { requireMe(); return state.needsEmail ?? true; },
    async setNeedsEmail(on) { requireMe(); state.needsEmail = on; save(); },
    // The in-browser store has no AI, so it has no AI use and no allowance to report.
    async getAiUsage(workspaceId) { peopleOf(workspaceId); return { rows: [], allowance: null, partial: false }; },
    async cancelInvite(workspaceId, email) {
      adminOf(workspaceId);
      const p = peopleOf(workspaceId);
      p.invites = p.invites.filter(i => i.email !== email.trim().toLowerCase());
      save();
    },
    async auditLog(workspaceId) {
      adminOf(workspaceId);
      return structuredClone(peopleOf(workspaceId).audit);
    },
    async updateWorkItem(id, e) {
      requireMe();
      const item = (state.workItems ?? []).find(i => i.id === id);
      if (!item) throw new StoreError(404, 'Work item not found.');
      const before = structuredClone(item);
      Object.assign(item, Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)), { updatedAt: new Date().toISOString() });
      logChange(before, item);
      save();
      return structuredClone(item);
    },
    async createWorkItem(projectId, n) {
      requireMe();
      const project = (state.projects ?? []).find(p => p.id === projectId);
      const w = project && state.workspaces.find(x => x.id === project.workspaceId);
      if (!project || !w) throw new StoreError(404, 'Project not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Adding an item needs the editor or admin role.');
      const item: WorkItem = {
        id: crypto.randomUUID(), projectId, parentId: n.parentId, type: n.type, title: n.title, description: n.description, acceptance: [], status: n.status,
        priority: n.priority, ownerId: n.ownerId, estimateHours: n.estimateHours, startDate: n.startDate, dueDate: n.dueDate, processId: null, stepIds: [],
        requirements: [], snapshot: {}, updatedAt: new Date().toISOString(), sortOrder: n.sortOrder, labels: n.labels,
      };
      (state.workItems ??= []).push(item);
      logCreated(item.id);
      save();
      return structuredClone(item);
    },
    async deleteWorkItem(id) {
      requireMe();
      const item = (state.workItems ?? []).find(i => i.id === id);
      const project = item && (state.projects ?? []).find(p => p.id === item.projectId);
      const w = project && state.workspaces.find(x => x.id === project.workspaceId);
      if (!item || !w) throw new StoreError(404, 'Work item not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Deleting needs the editor or admin role.');
      state.workItems = (state.workItems ?? []).filter(i => i.id !== id);
      for (const i of state.workItems) if (i.parentId === id) { const before = structuredClone(i); i.parentId = null; logChange(before, i); } // as the database: on delete set null
      state.comments = (state.comments ?? []).filter(c => c.workItemId !== id);
      state.itemEvents = (state.itemEvents ?? []).filter(x => x.workItemId !== id);
      for (const list of Object.values(state.proposals ?? {})) for (const p of list) if (p.workItemId === id) p.workItemId = null;
      save();
    },
    async listComments(workItemId) {
      requireMe();
      itemWorkspace(workItemId);
      return structuredClone((state.comments ?? []).filter(c => c.workItemId === workItemId));
    },
    async addComment(workItemId, body) {
      const me = requireMe();
      itemWorkspace(workItemId);
      const c: ItemComment = { id: uuid(), workItemId, authorId: me.id, body, createdAt: now(), editedAt: null };
      (state.comments ??= []).push(c);
      save();
      return structuredClone(c);
    },
    async editComment(id, body) {
      const me = requireMe();
      const c = (state.comments ?? []).find(x => x.id === id);
      if (!c || c.authorId !== me.id) throw new StoreError(403, 'Only the person who wrote a comment can edit it.');
      if (c.body !== body) { c.body = body; c.editedAt = now(); }
      save();
      return structuredClone(c);
    },
    async deleteComment(id) {
      const me = requireMe();
      const c = (state.comments ?? []).find(x => x.id === id);
      if (!c) throw new StoreError(404, 'Comment not found.');
      if (c.authorId !== me.id && itemWorkspace(c.workItemId).role !== 'admin') throw new StoreError(403, 'Only the person who wrote a comment, or an admin, can delete it.');
      state.comments = (state.comments ?? []).filter(x => x.id !== id);
      save();
    },
    async listApplications(workspaceId) {
      requireMe();
      return (state.applications ?? []).filter(a => a.workspaceId === workspaceId).map(({ workspaceId: _w, ...a }) => a).sort((x, y) => x.name.localeCompare(y.name));
    },
    async saveApplication(workspaceId, input, id) {
      const me = requireMe();
      const w = state.workspaces.find(x => x.id === workspaceId);
      if (!w) throw new StoreError(404, 'Workspace not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Changing the applications list needs the editor or admin role.');
      const mine = (state.applications ?? []).filter(a => a.workspaceId === workspaceId);
      const v = validateApplication(input, mine, id);
      if (id && !mine.some(a => a.id === id)) throw new StoreError(404, 'Application not found.');
      const app: Application = { id: id ?? uuid(), ...v, updatedAt: now(), updatedBy: me.id };
      state.applications = [...(state.applications ?? []).filter(a => a.id !== app.id), { ...app, workspaceId }];
      save();
      return app;
    },
    async deleteApplication(id) {
      requireMe();
      const a = (state.applications ?? []).find(x => x.id === id);
      if (!a) return;
      if (state.workspaces.find(x => x.id === a.workspaceId)?.role === 'viewer') throw new StoreError(403, 'Changing the applications list needs the editor or admin role.');
      state.applications = (state.applications ?? []).filter(x => x.id !== id);
      save();
    },
    async listSprints(projectId) {
      requireMe();
      return structuredClone((state.sprints ?? []).filter(x => x.projectId === projectId));
    },
    async createSprint(projectId, v) {
      requireMe();
      const project = (state.projects ?? []).find(p => p.id === projectId);
      const w = project && state.workspaces.find(x => x.id === project.workspaceId);
      if (!w) throw new StoreError(404, 'Project not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Planning a sprint needs the editor or admin role.');
      const sprint: Sprint = { id: uuid(), projectId, name: v.name, goal: v.goal, startsOn: v.startsOn, endsOn: v.endsOn, state: 'planned', startedAt: null, closedAt: null };
      (state.sprints ??= []).push(sprint);
      save();
      return structuredClone(sprint);
    },
    async updateSprint(id, v) {
      requireMe();
      const sprint = sprintEditable(id);
      if (v.state === 'active' && sprint.state !== 'active') {
        if (sprint.state === 'closed') throw new StoreError(400, 'A completed sprint cannot be reopened');
        if ((state.sprints ?? []).some(x => x.projectId === sprint.projectId && x.state === 'active')) throw new StoreError(409, 'Another sprint is already running on this board. Complete it first.');
        sprint.state = 'active'; sprint.startedAt = now();
      }
      const { state: _s, ...rest } = v;
      Object.assign(sprint, Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== undefined)));
      save();
      return structuredClone(sprint);
    },
    async closeSprint(id, moveTo) {
      requireMe();
      const sprint = sprintEditable(id);
      if (sprint.state !== 'active') throw new StoreError(400, 'Only the active sprint can be completed');
      if (moveTo && !(state.sprints ?? []).some(x => x.id === moveTo && x.projectId === sprint.projectId && x.state === 'planned')) throw new StoreError(400, 'Open work can move to a planned sprint of this project, or to the backlog');
      let moved = 0;
      for (const i of state.workItems ?? []) if (i.sprintId === id && i.status !== 'done') { const before = structuredClone(i); i.sprintId = moveTo; logChange(before, i); moved++; }
      sprint.state = 'closed'; sprint.closedAt = now();
      save();
      return moved;
    },
    async deleteSprint(id) {
      requireMe();
      sprintEditable(id);
      for (const i of state.workItems ?? []) if (i.sprintId === id) { const before = structuredClone(i); i.sprintId = null; logChange(before, i); }
      state.sprints = (state.sprints ?? []).filter(x => x.id !== id);
      save();
    },
    async importWorkItems(projectId, planned) {
      requireMe();
      const project = (state.projects ?? []).find(p => p.id === projectId);
      const w = project && state.workspaces.find(x => x.id === project.workspaceId);
      if (!w) throw new StoreError(404, 'Project not found.');
      if (w.role === 'viewer') throw new StoreError(403, 'Importing needs the editor or admin role.');
      const members = new Set(peopleOf(w.id).members.map(m => m.userId));
      if (planned.some(p => p.ownerId && !members.has(p.ownerId))) throw new StoreError(400, 'That person is not a member of this workspace');
      const base = Math.max(0, ...(state.workItems ?? []).filter(i => i.projectId === projectId).map(i => i.sortOrder ?? 0));
      const ids = planned.map(() => uuid());
      planned.forEach((p, n) => {
        (state.workItems ??= []).push({
          id: ids[n]!, projectId, parentId: p.parent === null ? null : ids[p.parent]!, type: p.type, title: p.title, description: p.description, acceptance: [],
          status: p.status, priority: p.priority, ownerId: p.ownerId, estimateHours: p.estimateHours, startDate: p.startDate, dueDate: p.dueDate,
          processId: null, stepIds: [], requirements: [], snapshot: {}, updatedAt: now(), sortOrder: base + n + 1, labels: p.labels, sprintId: null,
        });
        logCreated(ids[n]!);
      });
      save();
      return planned.length;
    },
    async listItemHistory(workItemId) {
      requireMe();
      itemWorkspace(workItemId);
      return structuredClone((state.itemEvents ?? []).filter(x => x.workItemId === workItemId).reverse());
    },
    async listProposals(processId) {
      requireMe();
      workspaceOf(processId);
      return structuredClone((state.proposals ?? {})[processId] ?? []).sort((a, b) => a.order - b.order);
    },
    async saveProposals(processId, rows) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Changing work items needs the editor or admin role.');
      state.proposals ??= {};
      const list = state.proposals[processId] ?? [];
      for (const r of rows) { const i = list.findIndex(x => x.key === r.key); if (i >= 0) list[i] = structuredClone(r); else list.push(structuredClone(r)); }
      state.proposals[processId] = list;
      save();
    },
    async listDocumentEdits(processId) {
      requireMe();
      workspaceOf(processId);
      return structuredClone((state.docEdits ?? {})[processId] ?? []);
    },
    async saveDocumentEdit(processId, edit) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Editing documents needs the editor or admin role.');
      state.docEdits ??= {};
      const was = (state.docEdits[processId] ?? []).find(e => e.docType === edit.docType && e.sectionKey === edit.sectionKey);
      if (!was || was.html !== edit.html || was.baseHash !== edit.baseHash) noteChange(workspaceOf(processId).w.id, processId, 'section_edit', true, was ? 'changed' : 'added', [`${edit.docType}:${edit.sectionKey}`]);
      const list = (state.docEdits[processId] ?? []).filter(e => !(e.docType === edit.docType && e.sectionKey === edit.sectionKey));
      list.push({ ...structuredClone(edit), updatedBy: state.me?.email, updatedAt: new Date().toISOString() });
      state.docEdits[processId] = list;
      save();
    },
    async removeDocumentEdit(processId, docType, sectionKey) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Editing documents needs the editor or admin role.');
      state.docEdits ??= {};
      if ((state.docEdits[processId] ?? []).some(e => e.docType === docType && e.sectionKey === sectionKey)) noteChange(workspaceOf(processId).w.id, processId, 'section_edit', true, 'removed', [`${docType}:${sectionKey}`]);
      state.docEdits[processId] = (state.docEdits[processId] ?? []).filter(e => !(e.docType === docType && e.sectionKey === sectionKey));
      save();
    },
    async listSectionComments(processId) {
      requireMe();
      workspaceOf(processId);
      return structuredClone((state.sectionComments ?? []).filter(c => c.processId === processId)).map(({ processId: _p, ...c }) => c);
    },
    async addSectionComment(processId, c) {
      const me = requireMe();
      workspaceOf(processId);
      const row = { id: uuid(), processId, docType: c.docType, sectionKey: c.sectionKey, sectionTitle: c.sectionTitle, authorId: me.id, body: c.body, createdAt: now(), editedAt: null, resolvedAt: null, resolvedBy: null };
      (state.sectionComments ??= []).push(row);
      save();
      const { processId: _p, ...out } = structuredClone(row);
      return out;
    },
    async editSectionComment(id, body) {
      const me = requireMe();
      const c = (state.sectionComments ?? []).find(x => x.id === id);
      if (!c || c.authorId !== me.id) throw new StoreError(403, 'Only the person who wrote a comment can change it.');
      if (c.body !== body) { c.body = body; c.editedAt = now(); }
      save();
      const { processId: _p, ...out } = structuredClone(c);
      return out;
    },
    async resolveSectionComment(id, resolved) {
      const me = requireMe();
      const c = (state.sectionComments ?? []).find(x => x.id === id);
      if (!c) throw new StoreError(404, 'Comment not found.');
      if (c.authorId !== me.id && workspaceOf(c.processId).w.role === 'viewer') throw new StoreError(403, 'Only the author or an editor can resolve a comment.');
      if (resolved !== Boolean(c.resolvedAt)) { c.resolvedAt = resolved ? now() : null; c.resolvedBy = resolved ? me.id : null; }
      save();
      const { processId: _p, ...out } = structuredClone(c);
      return out;
    },
    async deleteSectionComment(id) {
      const me = requireMe();
      const c = (state.sectionComments ?? []).find(x => x.id === id);
      if (!c || (c.authorId !== me.id && workspaceOf(c.processId).w.role !== 'admin')) throw new StoreError(403, 'Only the person who wrote a comment, or an admin, can delete it.');
      state.sectionComments = (state.sectionComments ?? []).filter(x => x.id !== id);
      save();
    },
    async listTestEdits(processId) {
      requireMe();
      workspaceOf(processId);
      return structuredClone((state.testEdits ?? {})[processId] ?? []);
    },
    async saveTestEdit(processId, edit) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Editing test cases needs the editor or admin role.');
      state.testEdits ??= {};
      const was = (state.testEdits[processId] ?? []).find(e => e.caseCode === edit.caseCode);
      if (!was || !same([was.fields, was.setAside, was.baseHash ?? null], [edit.fields, edit.setAside, edit.baseHash ?? null])) noteChange(workspaceOf(processId).w.id, processId, 'test_edit', true, was ? 'changed' : 'added', [edit.caseCode]);
      state.testEdits[processId] = [...(state.testEdits[processId] ?? []).filter(e => e.caseCode !== edit.caseCode), { ...structuredClone(edit), updatedBy: state.me?.email, updatedAt: now() }];
      save();
    },
    async removeTestEdit(processId, caseCode) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Editing test cases needs the editor or admin role.');
      state.testEdits ??= {};
      if ((state.testEdits[processId] ?? []).some(e => e.caseCode === caseCode)) noteChange(workspaceOf(processId).w.id, processId, 'test_edit', true, 'removed', [caseCode]);
      state.testEdits[processId] = (state.testEdits[processId] ?? []).filter(e => e.caseCode !== caseCode);
      save();
    },
    async listRequirements(processId) {
      requireMe();
      workspaceOf(processId);
      return structuredClone((state.requirements ?? {})[processId] ?? []).sort((a, b) => a.order - b.order);
    },
    async saveRequirements(processId, rows) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Saving requirements needs the editor or admin role.');
      state.requirements ??= {};
      const list = state.requirements[processId] ?? [];
      // One row of the change record per save for a person's wording, one for a register that follows the process.
      // Codes by who changed them and how, as the database groups one save's rows.
      const groups = new Map<string, string[]>();
      for (const r of rows) {
        const i = list.findIndex(x => x.code === r.code);
        const old = i >= 0 ? list[i] : null;
        if (!old || !same({ ...old, order: 0 }, { ...r, order: 0 })) {
          const key = `${r.edited || old?.edited || r.category === 'user' ? 'person' : 'follows'}:${old ? 'changed' : 'added'}`;
          groups.set(key, [...(groups.get(key) ?? []), r.code]);
        }
        if (i >= 0) list[i] = structuredClone(r); else list.push(structuredClone(r));
      }
      const rw = workspaceOf(processId).w.id;
      for (const [key, codes] of [...groups].sort()) {
        const [who, how] = key.split(':') as ['person' | 'follows', 'added' | 'changed'];
        noteChange(rw, processId, 'requirement', who === 'person', how, [...codes].sort());
      }
      state.requirements[processId] = list;
      save();
    },
    async getSourceLook(processId) {
      requireMe();
      workspaceOf(processId);
      // A fresh page reads what other pages saved (the server's copy, here the browser's storage).
      if (!demo) state = { ...state, looks: load().looks ?? state.looks };
      const row = state.looks?.[processId];
      return row ? structuredClone(row) : null;
    },
    async saveSourceLook(processId, _workspaceId, next, version) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Looking in the sources needs the editor or admin role.');
      if (!demo) state = { ...state, looks: load().looks ?? state.looks };
      const row = state.looks?.[processId] ?? null;
      if ((row?.version ?? null) !== version) return null;
      state.looks = { ...(state.looks ?? {}), [processId]: { ...structuredClone(next), version: (row?.version ?? 0) + 1 } };
      save();
      return state.looks[processId].version;
    },
    async getAssessmentDecisions(processId) {
      requireMe();
      workspaceOf(processId);
      const rows = (state.assessments ?? []).filter(a => a.processId === processId);
      return rows.length ? structuredClone(rows[rows.length - 1].decisions) : emptyDecisions();
    },
    async saveAssessment(processId, input) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Saving the assessment needs the editor or admin role.');
      // Only a change of people's choices, rate, costs or shape is recorded, not the computed result saved again.
      const prior = (state.assessments ?? []).filter(a => a.processId === processId);
      const before = prior.length ? prior[prior.length - 1].decisions : emptyDecisions();
      // One row per kind, as the database's trigger writes them; a step's choice names the steps it changed.
      const aw = workspaceOf(processId).w.id;
      const was = (before.overrides ?? {}) as Record<string, unknown>, is = (input.decisions.overrides ?? {}) as Record<string, unknown>;
      const steps = [...new Set([...Object.keys(was), ...Object.keys(is)])].filter(k => !same(was[k] ?? null, is[k] ?? null)).sort();
      if (steps.length) noteChange(aw, processId, 'choice', true, 'changed', steps);
      if (!same(before.rate ?? null, input.decisions.rate ?? null)) noteChange(aw, processId, 'rate');
      if (!same(before.costs ?? null, input.decisions.costs ?? null)) noteChange(aw, processId, 'costs');
      if (!same(before.map ?? null, input.decisions.map ?? null)) noteChange(aw, processId, 'map_shape');
      state.assessments = (state.assessments ?? []).filter(a => !(a.processId === processId && a.revisionId === input.revisionId));
      state.assessments.push({ processId, revisionId: input.revisionId, decisions: structuredClone(input.decisions), result: input.result });
      save();
    },
    async history(processId) {
      requireMe();
      return {
        revisions: await this.listRevisions(processId),
        edits: state.edits.filter(e => e.processId === processId).map(({ processId: _p, ...e }) => e),
      };
    },
  };
}
