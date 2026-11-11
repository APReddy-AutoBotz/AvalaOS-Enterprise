// In-memory store with the same rules as the database: one working draft per process, approved
// revisions never change, a new draft copies the approved model. State is kept in localStorage
// so a reload keeps it. Used by browser tests and local runs without a backend; it starts empty.
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { PROCESS_MODEL_SCHEMA_VERSION } from '../../domain/processModel/types.ts';
import { hashModel } from '../../domain/processModel/hash.ts';
import { StoreError, type Draft, type EditRow, type JourneyStore, type Me, type ProcessRow, type RevisionRow, type Workspace } from './types.ts';

interface StoredRevision extends RevisionRow { processId: string; model: ProcessModel }
interface State {
  me: Me | null;
  workspaces: Workspace[];
  processes: ProcessRow[];
  revisions: StoredRevision[];
  edits: (EditRow & { processId: string })[];
}

const KEY = 'avala.journey.memory.v1';
const empty = (): State => ({ me: null, workspaces: [], processes: [], revisions: [], edits: [] });

function load(): State {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    return raw ? { ...empty(), ...JSON.parse(raw) } : empty();
  } catch {
    return empty();
  }
}

export function emptyModel(name: string): ProcessModel {
  return {
    schemaVersion: PROCESS_MODEL_SCHEMA_VERSION,
    meta: { name, objective: { value: null, status: 'unknown', sources: [] }, owner: { value: null, status: 'unknown', sources: [] }, scopeIn: [], scopeOut: [], metrics: [] },
    roles: [], systems: [], events: [], steps: [], gateways: [], flows: [], rules: [], exceptions: [],
    dataObjects: [], painPoints: [], controls: [], risks: [], openQuestions: [], conflicts: [],
  };
}

const uuid = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
const strip = ({ processId: _p, model: _m, ...row }: StoredRevision): RevisionRow => row;

export function createMemoryStore(): JourneyStore {
  let state = load();
  const listeners = new Set<(me: Me | null) => void>();
  const save = () => { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } };
  const requireMe = () => { if (!state.me) throw new StoreError(401, 'Sign in again.'); return state.me; };
  const workspaceOf = (processId: string) => {
    const p = state.processes.find(x => x.id === processId);
    const w = p && state.workspaces.find(x => x.id === p.workspaceId);
    if (!p || !w) throw new StoreError(404, 'Process not found.');
    return { p, w };
  };

  return {
    kind: 'memory',
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

    async listWorkspaces() { requireMe(); return state.workspaces; },
    async createOrganization(organizationName, workspaceName) {
      requireMe();
      const w: Workspace = { id: uuid(), name: workspaceName.trim() || 'General', organizationName: organizationName.trim(), role: 'admin', canApprove: true };
      if (!w.organizationName) throw new StoreError(400, 'Name the organization.');
      state.workspaces.push(w);
      save();
      return { workspaceId: w.id };
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
    async history(processId) {
      requireMe();
      return {
        revisions: await this.listRevisions(processId),
        edits: state.edits.filter(e => e.processId === processId).map(({ processId: _p, ...e }) => e),
      };
    },
  };
}
