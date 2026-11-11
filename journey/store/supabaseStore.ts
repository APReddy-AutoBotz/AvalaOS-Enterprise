// The real store: Supabase auth, row level security for reads, and the model RPCs for writes.
// Uses only the project URL and the publishable key, which are safe in the browser.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { StoreError, type Draft, type JourneyStore, type Me, type ProcessRow, type RevisionRow, type Workspace } from './types.ts';

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
const toMe = (u: { id: string; email?: string | null } | null | undefined): Me | null => (u ? { id: u.id, email: u.email ?? '' } : null);

export function createSupabaseStore(url: string, publishableKey: string): JourneyStore {
  const db: SupabaseClient = createClient(url, publishableKey, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'avala.journey.auth' } });

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
    async history(processId) {
      const { data, error } = await db.rpc('model_history', { target_process: processId });
      if (error) fail(error);
      const d = data as any;
      return { revisions: (d.revisions ?? []).map(toRevision), edits: d.edits ?? [] };
    },
  };
}
