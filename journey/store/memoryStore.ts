import { leavesNoAdmin, PeopleError, roleOf, validateEmail, type AuditEntry } from '../../domain/people/roles.ts';
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
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import type { SectionEdit } from '../../domain/docs/edits.ts';
import type { Proposal } from '../../domain/workitems/register.ts';
import type { Project, WorkItem } from '../../domain/workitems/board.ts';
import { providerLabel } from '../../domain/auth/providers.ts';
import { keyHint, validateAiChoice, validateApiKey } from '../../domain/ai/providers.ts';

interface StoredRevision extends RevisionRow { processId: string; model: ProcessModel }
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
  proposals?: Record<string, Proposal[]>;
  projects?: (Project & { workspaceId: string })[];
  workItems?: WorkItem[];
  settings?: { workspaceId: string; assessment: AssessmentSettings; updatedBy: string; updatedAt: string }[];
  documentSettings?: { workspaceId: string; settings: DocumentSettings }[];
  people?: Record<string, { members: Person[]; invites: Invite[]; audit: AuditEntry[] }>;
  /** Only what the browser may know of a key: its last four characters. */
  ai?: Record<string, WorkspaceAi>;
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
    async signOut() { state.me = null; save(); listeners.forEach(l => l(null)); },
    // The in-browser store has no email and no passwords to keep: both succeed and change nothing.
    async requestPasswordReset() { /* nothing to send */ },
    async setNewPassword() { requireMe(); },
    // The in-browser store has no provider to send anyone to: it offers both so the screen can be
    // tested, and says so when one is chosen.
    async signInProviders() { return ['google', 'azure']; },
    async signInWithProvider(provider) {
      throw new StoreError(501, `${providerLabel(provider)} sign-in needs the server; this is the in-browser store.`);
    },

    async listWorkspaces() { requireMe(); return state.workspaces; },
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
    async createOrganization(organizationName, workspaceName) {
      requireMe();
      const w: Workspace = { id: uuid(), name: workspaceName.trim() || 'General', organizationName: organizationName.trim(), role: 'admin', canApprove: true };
      if (!w.organizationName) throw new StoreError(400, 'Name the organization.');
      state.workspaces.push(w);
      save();
      return { workspaceId: w.id };
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
      state.settings = [...(state.settings ?? []).filter(x => x.workspaceId !== workspaceId), { workspaceId, assessment: valid, updatedBy: me.email, updatedAt: now() }];
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
      state.documentSettings = [...(state.documentSettings ?? []).filter(x => x.workspaceId !== workspaceId), { workspaceId, settings: valid }];
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
      const { p, w } = workspaceOf(rev.processId);
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
      p.updatedAt = now();
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
      save();
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
      save();
      return row;
    },
    async archiveSource(sourceId) {
      requireMe();
      const src = state.sources.find(x => x.id === sourceId);
      if (!src) throw new StoreError(404, 'Source not found.');
      if (workspaceOf(src.processId).w.role === 'viewer') throw new StoreError(403, 'Archiving needs the editor or admin role.');
      src.archived = true;
      save();
    },
    aiAvailable: false,
    async readFlowchartImage() { throw new StoreError(501, `Reading images needs the server; it is not available ${where}.`); },
    async transcribe() { throw new StoreError(501, `Transcription needs the server; it is not available ${where}.`); },
    async startExtraction() { throw new StoreError(501, `Extraction needs the server; it is not available ${where}.`); },
    async latestExtraction() { return null; },
    async runAiTask() { throw new StoreError(501, `AI tasks need the server; they are not available ${where}.`); },
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
      Object.assign(item, Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)), { updatedAt: new Date().toISOString() });
      save();
      return structuredClone(item);
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
      const list = (state.docEdits[processId] ?? []).filter(e => !(e.docType === edit.docType && e.sectionKey === edit.sectionKey));
      list.push({ ...structuredClone(edit), updatedBy: state.me?.email, updatedAt: new Date().toISOString() });
      state.docEdits[processId] = list;
      save();
    },
    async removeDocumentEdit(processId, docType, sectionKey) {
      requireMe();
      if (workspaceOf(processId).w.role === 'viewer') throw new StoreError(403, 'Editing documents needs the editor or admin role.');
      state.docEdits ??= {};
      state.docEdits[processId] = (state.docEdits[processId] ?? []).filter(e => !(e.docType === docType && e.sectionKey === sectionKey));
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
      for (const r of rows) { const i = list.findIndex(x => x.code === r.code); if (i >= 0) list[i] = structuredClone(r); else list.push(structuredClone(r)); }
      state.requirements[processId] = list;
      save();
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
