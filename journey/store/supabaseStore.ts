import { DEFAULT_SETTINGS, settingsFrom, validateSettings } from '../../domain/assess/settings.ts';
// The real store: Supabase auth, row level security for reads, and the model RPCs for writes.
// Uses only the project URL and the publishable key, which are safe in the browser.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { decisionsFromEntries, decisionsToEntries } from '../../domain/assess/decisions.ts';
import { StoreError, type Draft, type ExtractionRow, type JourneyStore, type Me, type ProcessRow, type RevisionRow, type SourceRow, type Workspace } from './types.ts';

/** PostgREST returns custom SQLSTATEs PTxyz as HTTP status xyz; map the rest to sensible statuses. */
function fail(error: { message: string; code?: string; status?: number } | null, fallback = 500): never {
  const code = error?.code ?? '';
  const status = /^PT\d{3}$/.test(code) ? Number(code.slice(2)) : code === '42501' ? 403 : error?.status ?? fallback;
  const message = (error?.message ?? 'Request failed.').replace(/^[A-Z_]+: /, '');
  throw new StoreError(status, message);
}

const toRevision = (r: Record<string, any>): RevisionRow => ({
  id: r.id, revNo: r.rev_no ?? r.revNo, state: r.state, seq: Number(r.edit_seq ?? r.seq ?? 0), modelHash: r.model_hash ?? r.modelHash ?? null,
  basedOn: r.based_on ?? r.basedOn ?? null, createdAt: r.created_at ?? r.createdAt, approvedAt: r.approved_at ?? r.approvedAt ?? null,
});
const toProcess = (p: Record<string, any>): ProcessRow => ({ id: p.id, workspaceId: p.workspace_id, name: p.name, description: p.description ?? '', updatedAt: p.updated_at });
const toSource = (r: Record<string, any>): SourceRow => ({
  id: r.id, key: r.source_key, title: r.title, fileName: r.file_name ?? '', format: r.format, kind: r.kind ?? '', inferred: Boolean(r.inferred),
  segmentCount: Number(r.segment_count ?? 0), warnings: Array.isArray(r.warnings) ? r.warnings : [], createdAt: r.created_at, archived: Boolean(r.archived_at),
});
const SOURCE_COLUMNS = 'id, source_key, title, file_name, format, kind, inferred, warnings, segment_count, created_at, archived_at';
const toMe = (u: { id: string; email?: string | null } | null | undefined): Me | null => (u ? { id: u.id, email: u.email ?? '' } : null);

export function createSupabaseStore(url: string, publishableKey: string): JourneyStore {
  const db: SupabaseClient = createClient(url, publishableKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'avala.journey.auth' } });

  /** Calls an edge function with the user's session; errors carry the function's own message. */
  async function call(name: string, body: Record<string, unknown>): Promise<any> {
    const { data, error } = await db.functions.invoke(name, { body });
    if (!error) return data;
    const res: Response | undefined = (error as any).context;
    let message = error.message, status = 500;
    if (res && typeof res.json === 'function') {
      status = res.status;
      try { const j = await res.json(); message = j?.error?.message ?? j?.message ?? message; } catch { /* keep the generic message */ }
    }
    throw new StoreError(status, message);
  }

  return {
    kind: 'supabase',
    async currentUser() {
      const { data } = await db.auth.getSession();
      return toMe(data.session?.user);
    },
    onAuthChange(listener) {
      const { data } = db.auth.onAuthStateChange((_e, session) => listener(toMe(session?.user)));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) fail({ message: error.message, status: error.status ?? 400 });
    },
    async signUp(email, password) {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/processes` } });
      if (error) fail({ message: error.message, status: error.status ?? 400 });
      return { needsConfirmation: !data.session };
    },
    async signOut() { await db.auth.signOut(); },

    async listWorkspaces() {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) throw new StoreError(401, 'Sign in again.');
      const { data, error } = await db
        .from('workspace_members')
        .select('role, can_approve, workspaces(id, name, organizations(name))')
        .eq('user_id', auth.user.id);
      if (error) fail(error);
      return (data ?? []).flatMap((m: any): Workspace[] => (m.workspaces ? [{
        id: m.workspaces.id, name: m.workspaces.name, organizationName: m.workspaces.organizations?.name ?? '',
        role: m.role, canApprove: Boolean(m.can_approve),
      }] : [])).sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.name.localeCompare(b.name));
    },
    async createOrganization(organizationName, workspaceName) {
      const { data, error } = await db.rpc('create_organization', { organization_name: organizationName, workspace_name: workspaceName });
      if (error) fail(error);
      return { workspaceId: (data as any).workspaceId };
    },

    async getSettings(workspaceId) {
      const { data, error } = await db.from('workspace_settings').select('assessment, updated_at').eq('workspace_id', workspaceId).maybeSingle();
      if (error) fail(error);
      return data ? { settings: settingsFrom(data.assessment), custom: true, updatedBy: null, updatedAt: data.updated_at } : { settings: { ...DEFAULT_SETTINGS }, custom: false, updatedBy: null, updatedAt: null };
    },
    async saveSettings(workspaceId, settings) {
      const valid = validateSettings(settings);
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) throw new StoreError(401, 'Sign in again.');
      const { error } = await db.from('workspace_settings').upsert({ workspace_id: workspaceId, assessment: valid, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
      if (error) fail(error);
    },
    async listProcesses(workspaceId) {
      const { data, error } = await db.from('processes').select('id, workspace_id, name, description, updated_at')
        .eq('workspace_id', workspaceId).is('archived_at', null).order('updated_at', { ascending: false });
      if (error) fail(error);
      return (data ?? []).map(toProcess);
    },
    async createProcess(workspaceId, name) {
      const { data, error } = await db.from('processes').insert({ workspace_id: workspaceId, name: name.trim() })
        .select('id, workspace_id, name, description, updated_at').single();
      if (error) fail(error);
      return toProcess(data);
    },
    async getProcess(processId) {
      const { data, error } = await db.from('processes').select('id, workspace_id, name, description, updated_at').eq('id', processId).maybeSingle();
      if (error) fail(error);
      return data ? toProcess(data) : null;
    },

    async listRevisions(processId) {
      const { data, error } = await db.from('process_model_revisions')
        .select('id, rev_no, state, edit_seq, model_hash, based_on, created_at, approved_at')
        .eq('process_id', processId).order('rev_no', { ascending: false });
      if (error) fail(error);
      return (data ?? []).map(toRevision);
    },
    async getModel(revisionId) {
      const { data, error } = await db.from('process_model_revisions').select('model').eq('id', revisionId).maybeSingle();
      if (error) fail(error);
      return (data?.model as ProcessModel | undefined) ?? null;
    },
    async startDraft(processId): Promise<Draft> {
      const { data, error } = await db.rpc('model_start_draft', { target_process: processId });
      if (error) fail(error);
      const d = data as any;
      return { revisionId: d.revisionId, revNo: d.revNo, seq: Number(d.seq), model: d.model, modelHash: d.modelHash ?? null };
    },
    async savePatch(revisionId, expectedSeq, patch, origin, summary) {
      const { data, error } = await db.rpc('model_save_patch', { target_revision: revisionId, expected_seq: expectedSeq, patch, origin, summary });
      if (error) fail(error);
      return { seq: Number((data as any).seq) };
    },
    async approve(revisionId, expectedSeq) {
      const { error } = await db.rpc('model_approve', { target_revision: revisionId, expected_seq: expectedSeq });
      if (error) fail(error);
    },
    async listSources(processId) {
      const { data, error } = await db.from('process_sources').select(SOURCE_COLUMNS)
        .eq('process_id', processId).order('created_at', { ascending: true });
      if (error) fail(error);
      return (data ?? []).map(toSource);
    },
    async getSourceSegments(sourceId) {
      const { data, error } = await db.from('process_sources').select('segments').eq('id', sourceId).maybeSingle();
      if (error) fail(error);
      if (!data) throw new StoreError(404, 'Source not found.');
      return data.segments as any;
    },
    async addSource(processId, input) {
      const process = await this.getProcess(processId);
      if (!process) throw new StoreError(404, 'Process not found.');
      const { data, error } = await db.from('process_sources').insert({
        workspace_id: process.workspaceId, process_id: processId, source_key: input.key, title: input.title.trim().slice(0, 200) || 'Untitled source',
        file_name: input.fileName.slice(0, 300), format: input.format, kind: input.kind, segments: input.segments, inferred: input.inferred,
        warnings: input.warnings.slice(0, 50), byte_size: input.byteSize,
      }).select(SOURCE_COLUMNS).single();
      if (error) fail(error);
      return { ...toSource(data), segmentCount: input.segments.length };
    },
    async archiveSource(sourceId) {
      const { error } = await db.from('process_sources').update({ archived_at: new Date().toISOString() }).eq('id', sourceId);
      if (error) fail(error);
    },
    aiAvailable: true,
    async readFlowchartImage(workspaceId, dataUrl) {
      const r = await call('journey-ai', { action: 'run', workspaceId, task: 'readFlowchart', image: dataUrl });
      return r.data;
    },
    async startExtraction(workspaceId, processId, sourceIds) {
      const r = await call('journey-extract', { action: 'create', workspaceId, processId, sourceIds });
      return { runId: r.runId };
    },
    async runAiTask(workspaceId, task, segments) {
      const r = await call('journey-ai', { action: 'run', workspaceId, task, segments });
      return { data: r.data };
    },
    async getAssessmentDecisions(processId) {
      const { data, error } = await db.from('assessments').select('overrides').eq('process_id', processId).order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (error) fail(error);
      return decisionsFromEntries(data?.overrides);
    },
    async saveAssessment(processId, input) {
      const process = await this.getProcess(processId);
      if (!process) throw new StoreError(404, 'Process not found.');
      const { error } = await db.from('assessments').upsert({
        workspace_id: process.workspaceId, process_id: processId, model_revision_id: input.revisionId, model_hash: input.modelHash,
        rules_version: input.rulesVersion, result: input.result, overrides: decisionsToEntries(input.decisions), is_stale: false,
      }, { onConflict: 'model_revision_id' });
      if (error) fail(error);
    },
    async latestExtraction(processId): Promise<ExtractionRow | null> {
      const { data, error } = await db.from('extraction_runs').select('id, status, error, result, created_at, updated_at')
        .eq('process_id', processId).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) fail(error);
      if (!data) return null;
      return { id: data.id, status: data.status, error: data.error, createdAt: data.created_at, updatedAt: data.updated_at, model: (data.result as any)?.model ?? null };
    },
    async history(processId) {
      const { data, error } = await db.rpc('model_history', { target_process: processId });
      if (error) fail(error);
      const d = data as any;
      return { revisions: (d.revisions ?? []).map(toRevision), edits: d.edits ?? [] };
    },
  };
}
