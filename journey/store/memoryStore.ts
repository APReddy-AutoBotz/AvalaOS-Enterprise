// In-memory store with the same rules as the database: one working draft per process, approved
// revisions never change, a new draft copies the approved model. State is kept in localStorage
// so a reload keeps it. Used by browser tests and local runs without a backend; it starts empty.
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { hashModel } from '../../domain/processModel/hash.ts';
import { emptyModel } from '../../domain/processModel/empty.ts';
import { applyPatch } from '../../domain/processModel/jsonPatch.ts';
import { validateModel, errorsOf } from '../../domain/processModel/validate.ts';
import { StoreError, type Draft, type EditRow, type JourneyStore, type Me, type ProcessRow, type RevisionRow, type SourceRow, type Workspace } from './types.ts';
import type { IngestSegment } from '../../domain/ingest/segment.ts';

interface StoredRevision extends RevisionRow { processId: string; model: ProcessModel }
interface State {
  me: Me | null;
  workspaces: Workspace[];
  processes: ProcessRow[];
  revisions: StoredRevision[];
  edits: (EditRow & { processId: string })[];
  sources: (SourceRow & { processId: string; segments: IngestSegment[] })[];
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
    async readFlowchartImage() { throw new StoreError(501, 'Reading images needs the server; it is not available in local mode.'); },
    async startExtraction() { throw new StoreError(501, 'Extraction needs the server; it is not available in local mode.'); },
    async latestExtraction() { return null; },
    async history(processId) {
      requireMe();
      return {
        revisions: await this.listRevisions(processId),
        edits: state.edits.filter(e => e.processId === processId).map(({ processId: _p, ...e }) => e),
      };
    },
  };
}
