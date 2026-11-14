import type { AuditEntry } from '../../domain/people/roles.ts';
import { monthStart } from '../../domain/ai/usage.ts';
import { documentSettingsFrom, validateBranding } from '../../domain/docs/branding.ts';
import { DEFAULT_SETTINGS, settingsFrom, validateSettings } from '../../domain/assess/settings.ts';
// The real store: Supabase auth, row level security for reads, and the model RPCs for writes.
// Uses only the project URL and the publishable key, which are safe in the browser.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProcessModel } from '../../domain/processModel/types.ts';
import { decisionsFromEntries, decisionsToEntries } from '../../domain/assess/decisions.ts';
import type { StoredRequirement } from '../../domain/requirements/register.ts';
import type { SectionEdit } from '../../domain/docs/edits.ts';
import type { Proposal } from '../../domain/workitems/register.ts';
import type { WorkItem } from '../../domain/workitems/board.ts';

const ITEM_COLUMNS = 'id, project_id, parent_id, item_type, title, description, acceptance_criteria, status, priority, owner_id, estimate_hours, start_date, due_date, process_id, step_ids, details, updated_at, sort_order, labels, sprint_id';
const itemFrom = (r: any): WorkItem => ({
  id: r.id, projectId: r.project_id, parentId: r.parent_id, type: r.item_type, title: r.title, description: r.description, acceptance: r.acceptance_criteria ?? [],
  status: r.status, priority: r.priority, ownerId: r.owner_id, estimateHours: r.estimate_hours === null ? null : Number(r.estimate_hours), startDate: r.start_date, dueDate: r.due_date,
  processId: r.process_id, stepIds: r.step_ids ?? [], requirements: r.details?.requirements ?? [], snapshot: r.details?.snapshot ?? {}, updatedAt: r.updated_at,
  sortOrder: Number(r.sort_order ?? 0), labels: r.labels ?? [], sprintId: r.sprint_id ?? null,
});
const SPRINT_COLUMNS = 'id, project_id, name, goal, starts_on, ends_on, state, started_at, closed_at';
const sprintFrom = (r: any): Sprint => ({ id: r.id, projectId: r.project_id, name: r.name, goal: r.goal, startsOn: r.starts_on, endsOn: r.ends_on, state: r.state, startedAt: r.started_at, closedAt: r.closed_at });
const COMMENT_COLUMNS = 'id, work_item_id, author_id, body, created_at, edited_at';
const commentFrom = (r: any): ItemComment => ({ id: r.id, workItemId: r.work_item_id, authorId: r.author_id, body: r.body, createdAt: r.created_at, editedAt: r.edited_at });

const REQ_TYPE = { BR: 'business', FR: 'functional', NFR: 'non_functional' } as const;
const REQ_KIND = { business: 'BR', functional: 'FR', non_functional: 'NFR' } as const;
import { StoreError, type Draft, type ExtractionRow, type JourneyStore, type Me, type Member, type Person, type Invite, type ProcessRow, type RevisionRow, type SourceRow, type Workspace } from './types.ts';
import { enabledProviders, providerScopes } from '../../domain/auth/providers.ts';
import type { ItemComment, ItemEvent } from '../../domain/workitems/collab.ts';
import type { Sprint } from '../../domain/workitems/sprints.ts';
import type { Module } from '../../domain/workspace/modules.ts';

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
const toProcess = (p: Record<string, any>): ProcessRow => ({ id: p.id, workspaceId: p.workspace_id, name: p.name, description: p.description ?? '', updatedAt: p.updated_at, analystId: p.analyst_id ?? null, architectId: p.architect_id ?? null, approverId: p.approver_id ?? null });
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
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/work` } });
      if (error) fail({ message: /database error|invitation/i.test(error.message) ? 'Sign-up is by invitation. Ask a workspace admin to invite this email address, then create the account with it.' : error.message, status: error.status ?? 400 });
      return { needsConfirmation: !data.session };
    },
    async signOut() { await db.auth.signOut(); },
    async requestPasswordReset(email) {
      const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
      // Only a rate limit is worth telling the person; anything else would say whether the address has an account.
      if (error && error.status === 429) fail({ message: 'Too many requests. Wait a few minutes and try again.', status: 429 });
    },
    async setNewPassword(password) {
      const { error } = await db.auth.updateUser({ password });
      if (error) fail({ message: error.message, status: error.status ?? 400 });
    },
    async signInProviders() {
      try {
        const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey } });
        return res.ok ? enabledProviders(await res.json()) : [];
      } catch { return []; }
    },
    async signInWithProvider(provider) {
      const { error } = await db.auth.signInWithOAuth({
        provider, options: { redirectTo: `${location.origin}/signin`, scopes: providerScopes(provider) },
      });
      if (error) fail({ message: error.message, status: error.status ?? 400 });
    },

    async listWorkspaces() {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) throw new StoreError(401, 'Sign in again.');
      const { data, error } = await db
        .from('workspace_members')
        .select('role, job, can_approve, workspaces(id, name, organization_id, organizations(name, modules, created_by))')
        .eq('user_id', auth.user.id);
      if (error) fail(error);
      return (data ?? []).flatMap((m: any): Workspace[] => (m.workspaces ? [{
        id: m.workspaces.id, name: m.workspaces.name, organizationName: m.workspaces.organizations?.name ?? '',
        role: m.role, canApprove: Boolean(m.can_approve), job: m.job ?? null,
        organizationId: m.workspaces.organization_id, canAddWorkspace: m.workspaces.organizations?.created_by === auth.user!.id, ...(m.workspaces.organizations?.modules ? { modules: m.workspaces.organizations.modules } : {}),
      }] : [])).sort((a, b) => a.organizationName.localeCompare(b.organizationName) || a.name.localeCompare(b.name));
    },
    async createWorkspace(organizationId, name) {
      const { data, error } = await db.rpc('create_workspace', { target_organization: organizationId, workspace_name: name });
      if (error) fail(error);
      return data as string;
    },
    async setOrganizationModules(organizationId, modules) {
      const { data, error } = await db.rpc('set_organization_modules', { target_organization: organizationId, org_modules: modules });
      if (error) fail(error);
      return data as Module[];
    },
    async canCreateOrganization() {
      const { data, error } = await db.rpc('can_create_organization');
      if (error) fail(error);
      return data === true;
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
    async getDocumentSettings(workspaceId) {
      const { data, error } = await db.from('document_settings').select('settings').eq('workspace_id', workspaceId).maybeSingle();
      if (error) fail(error);
      return documentSettingsFrom(data?.settings);
    },
    async saveDocumentSettings(workspaceId, settings) {
      const valid = { branding: validateBranding(settings.branding), layouts: settings.layouts };
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) throw new StoreError(401, 'Sign in again.');
      const { error } = await db.from('document_settings').upsert({ workspace_id: workspaceId, settings: valid, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
      if (error) fail(error);
    },
    async listProcesses(workspaceId) {
      const { data, error } = await db.from('processes').select('id, workspace_id, name, description, updated_at, analyst_id, architect_id, approver_id')
        .eq('workspace_id', workspaceId).is('archived_at', null).order('updated_at', { ascending: false });
      if (error) fail(error);
      return (data ?? []).map(toProcess);
    },
    async createProcess(workspaceId, name) {
      const { data, error } = await db.from('processes').insert({ workspace_id: workspaceId, name: name.trim() })
        .select('id, workspace_id, name, description, updated_at, analyst_id, architect_id, approver_id').single();
      if (error) fail(error);
      return toProcess(data);
    },
    async getProcess(processId) {
      const { data, error } = await db.from('processes').select('id, workspace_id, name, description, updated_at, analyst_id, architect_id, approver_id').eq('id', processId).maybeSingle();
      if (error) fail(error);
      return data ? toProcess(data) : null;
    },

    async setProcessPeople(processId, p) {
      const { error } = await db.from('processes').update({ analyst_id: p.analystId, architect_id: p.architectId, approver_id: p.approverId }).eq('id', processId);
      if (error) fail(error);
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
    async transcribe(workspaceId, audio) {
      const r = await call('journey-ai', { action: 'transcribe', workspaceId, audio });
      return String(r.text ?? '');
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
    async listRequirements(processId) {
      const { data, error } = await db.from('requirements').select('code, requirement_type, statement, rationale, priority, acceptance_criteria, links, origin, derivation_key, state, user_edited, sort_order').eq('process_id', processId).order('sort_order');
      if (error) fail(error);
      return (data ?? []).map((r: any): StoredRequirement => {
        const l = r.links ?? {};
        return { code: r.code, kind: REQ_KIND[r.requirement_type as keyof typeof REQ_KIND], key: r.derivation_key, category: l.category ?? 'user', title: l.title ?? r.code, statement: r.statement, rationale: r.rationale, priority: r.priority, acceptance: r.acceptance_criteria ?? [], stepIds: l.stepIds ?? [], ruleIds: l.ruleIds ?? [], exceptionIds: l.exceptionIds ?? [], traces: l.traces ?? [], gaps: l.gaps ?? [], origin: r.origin, edited: r.user_edited, state: r.state, order: r.sort_order, baseHash: l.baseHash ?? null };
      });
    },
    async listProjects(workspaceId) {
      const { data, error } = await db.from('delivery_projects').select('id, name, description').eq('workspace_id', workspaceId).is('archived_at', null).order('created_at');
      if (error) fail(error);
      return (data ?? []) as any;
    },
    async createProject(workspaceId, name) {
      const { data, error } = await db.from('delivery_projects').insert({ workspace_id: workspaceId, name }).select('id, name, description').single();
      if (error) fail(error);
      return data as any;
    },
    async confirmProposals(processId, projectId, keys) {
      const { data, error } = await db.rpc('confirm_proposals', { target_process: processId, target_project: projectId, proposal_keys: keys });
      if (error) fail(error);
      return data as { created: number; skipped: number };
    },
    async listWorkItems(projectId) {
      const { data, error } = await db.from('delivery_work_items').select(ITEM_COLUMNS).eq('project_id', projectId).order('sort_order');
      if (error) fail(error);
      return (data ?? []).map(itemFrom);
    },
    async listMembers(workspaceId) {
      const { data: rows, error } = await db.from('workspace_members').select('user_id, role').eq('workspace_id', workspaceId);
      if (error) fail(error);
      const ids = (rows ?? []).map(r => r.user_id as string);
      if (!ids.length) return [];
      const { data: profiles, error: e2 } = await db.from('profiles').select('id, display_name').in('id', ids);
      if (e2) fail(e2);
      const name = new Map((profiles ?? []).map(p => [p.id as string, (p.display_name as string).trim()]));
      return (rows ?? []).map(r => ({ userId: r.user_id as string, name: name.get(r.user_id as string) || 'Unnamed member', role: r.role as Member['role'] })).sort((a, b) => a.name.localeCompare(b.name));
    },
    async listPeople(workspaceId) {
      const { data, error } = await db.rpc('list_people', { target_workspace: workspaceId });
      if (error) fail(error);
      const d = data as { members: any[]; invites: any[] };
      return {
        members: d.members.map((m): Person => ({ userId: m.userId, name: m.name, email: m.email ?? null, role: m.role, job: m.job ?? null, canApprove: Boolean(m.canApprove), since: m.since })),
        invites: d.invites.map((i): Invite => ({ email: i.email, role: i.role, job: i.job ?? null, canApprove: Boolean(i.canApprove), at: i.at })),
      };
    },
    async invitePerson(workspaceId, email, r) {
      const { data, error } = await db.rpc('invite_member', { target_workspace: workspaceId, member_email: email, member_role: r.access, member_job: r.job, member_can_approve: r.canApprove });
      if (error) fail(error);
      return { state: (data as { state: 'member' | 'invited' }).state };
    },
    async changePerson(workspaceId, userId, r) {
      const { error } = await db.rpc('change_member', { target_workspace: workspaceId, target_user: userId, member_role: r.access, member_job: r.job, member_can_approve: r.canApprove });
      if (error) fail(error);
    },
    async removePerson(workspaceId, userId) {
      const { error } = await db.rpc('remove_member', { target_workspace: workspaceId, target_user: userId });
      if (error) fail(error);
    },
    async sendInviteEmail(workspaceId, email) {
      await call('journey-invite', { workspaceId, email });
    },
    async getWorkspaceAi(workspaceId) {
      const { data, error } = await db.from('workspace_ai_settings')
        .select('provider, model, endpoint, key_hint, updated_at, last_used_at, last_tested_at, last_test_ok').eq('workspace_id', workspaceId).maybeSingle();
      if (error) fail(error);
      return data ? {
        provider: data.provider, model: data.model, endpoint: data.endpoint ?? null, keyHint: data.key_hint, updatedAt: data.updated_at,
        lastUsedAt: data.last_used_at ?? null, lastTestedAt: data.last_tested_at ?? null, lastTestOk: data.last_test_ok ?? null,
      } : null;
    },
    async saveWorkspaceAi(workspaceId, input) {
      const { error } = await db.rpc('set_workspace_ai', { target_workspace: workspaceId, ai_provider: input.provider, ai_model: input.model, ai_endpoint: input.endpoint, api_key: input.apiKey ?? null });
      if (error) fail(error);
    },
    async clearWorkspaceAi(workspaceId) {
      const { error } = await db.rpc('clear_workspace_ai', { target_workspace: workspaceId });
      if (error) fail(error);
    },
    async testWorkspaceAi(workspaceId) {
      const r = await call('journey-ai', { action: 'health', workspaceId });
      return { model: String(r?.model ?? ''), source: r?.source === 'workspace' ? 'workspace' : 'platform' };
    },
    async getNeedsEmail() {
      const { data: auth } = await db.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await db.from('notification_settings').select('needs_email').eq('user_id', auth.user.id).maybeSingle();
      if (error) return null; // not available (yet): the page leaves the choice out
      return data ? Boolean(data.needs_email) : true; // no row yet: on, as for everyone
    },
    async setNeedsEmail(on) {
      const { error } = await db.rpc('set_needs_email', { email_on: on });
      if (error) fail(error);
    },
    async getAiUsage(workspaceId) {
      const MAX = 10_000;
      const from = monthStart(new Date()).toISOString();
      const [{ data, error }, allowance] = await Promise.all([
        db.from('ai_usage').select('created_at, task, user_id, input_tokens, output_tokens, status, key_source')
          .eq('workspace_id', workspaceId).gte('created_at', from).order('created_at', { ascending: false }).limit(MAX),
        call('journey-ai', { action: 'allowance', workspaceId }).catch(() => null),
      ]);
      if (error) fail(error);
      const rows = (data ?? []).map((r: any) => ({
        createdAt: r.created_at, task: r.task, userId: r.user_id ?? null, inputTokens: Number(r.input_tokens) || 0,
        outputTokens: Number(r.output_tokens) || 0, status: r.status, keySource: r.key_source === 'workspace' ? 'workspace' as const : 'platform' as const,
      }));
      return {
        rows,
        partial: rows.length >= MAX,
        allowance: allowance?.ok ? {
          source: allowance.source === 'workspace' ? 'workspace' : 'platform',
          budget: typeof allowance.budget === 'number' ? allowance.budget : null,
          used: typeof allowance.used === 'number' ? allowance.used : null,
        } : null,
      };
    },
    async cancelInvite(workspaceId, email) {
      const { error } = await db.rpc('cancel_invite', { target_workspace: workspaceId, invite_email: email });
      if (error) fail(error);
    },
    async auditLog(workspaceId) {
      const { data, error } = await db.rpc('workspace_audit_log', { target_workspace: workspaceId });
      if (error) fail(error);
      return (data ?? []) as AuditEntry[];
    },
    async updateWorkItem(id, e) {
      const row: Record<string, unknown> = {};
      if (e.title !== undefined) row.title = e.title;
      if (e.description !== undefined) row.description = e.description;
      if (e.status !== undefined) row.status = e.status;
      if (e.priority !== undefined) row.priority = e.priority;
      if (e.ownerId !== undefined) row.owner_id = e.ownerId;
      if (e.estimateHours !== undefined) row.estimate_hours = e.estimateHours;
      if (e.startDate !== undefined) row.start_date = e.startDate;
      if (e.dueDate !== undefined) row.due_date = e.dueDate;
      if (e.parentId !== undefined) row.parent_id = e.parentId;
      if (e.labels !== undefined) row.labels = e.labels;
      if (e.sprintId !== undefined) row.sprint_id = e.sprintId;
      const { data, error } = await db.from('delivery_work_items').update(row).eq('id', id).select(ITEM_COLUMNS).single();
      if (error) fail(error);
      return itemFrom(data);
    },
    async createWorkItem(projectId, n) {
      const { data: project, error: e1 } = await db.from('delivery_projects').select('workspace_id').eq('id', projectId).single();
      if (e1) fail(e1);
      const { data, error } = await db.from('delivery_work_items').insert({
        workspace_id: project.workspace_id, project_id: projectId, item_type: n.type, title: n.title, description: n.description,
        parent_id: n.parentId, owner_id: n.ownerId, priority: n.priority, estimate_hours: n.estimateHours, start_date: n.startDate,
        due_date: n.dueDate, status: n.status, sort_order: n.sortOrder, labels: n.labels,
      }).select(ITEM_COLUMNS).single();
      if (error) fail(error);
      return itemFrom(data);
    },
    async deleteWorkItem(id) {
      const { data, error } = await db.from('delivery_work_items').delete().eq('id', id).select('id');
      if (error) fail(error);
      if (!data?.length) throw new StoreError(403, 'This item could not be deleted. Deleting needs the editor or admin role.');
    },
    async listComments(workItemId) {
      const { data, error } = await db.from('delivery_work_item_comments').select(COMMENT_COLUMNS).eq('work_item_id', workItemId).order('created_at');
      if (error) fail(error);
      return (data ?? []).map(commentFrom);
    },
    async addComment(workItemId, body) {
      const { data: item, error: e1 } = await db.from('delivery_work_items').select('workspace_id').eq('id', workItemId).single();
      if (e1) fail(e1);
      const { data, error } = await db.from('delivery_work_item_comments').insert({ workspace_id: item.workspace_id, work_item_id: workItemId, body }).select(COMMENT_COLUMNS).single();
      if (error) fail(error);
      return commentFrom(data);
    },
    async editComment(id, body) {
      const { data, error } = await db.from('delivery_work_item_comments').update({ body }).eq('id', id).select(COMMENT_COLUMNS);
      if (error) fail(error);
      if (!data?.length) throw new StoreError(403, 'Only the person who wrote a comment can edit it.');
      return commentFrom(data[0]);
    },
    async deleteComment(id) {
      const { data, error } = await db.from('delivery_work_item_comments').delete().eq('id', id).select('id');
      if (error) fail(error);
      if (!data?.length) throw new StoreError(403, 'Only the person who wrote a comment, or an admin, can delete it.');
    },
    async listSprints(projectId) {
      const { data, error } = await db.from('delivery_sprints').select(SPRINT_COLUMNS).eq('project_id', projectId).order('created_at');
      if (error) fail(error);
      return (data ?? []).map(sprintFrom);
    },
    async createSprint(projectId, v) {
      const { data: project, error: e1 } = await db.from('delivery_projects').select('workspace_id').eq('id', projectId).single();
      if (e1) fail(e1);
      const { data, error } = await db.from('delivery_sprints').insert({ workspace_id: project.workspace_id, project_id: projectId, name: v.name, goal: v.goal, starts_on: v.startsOn, ends_on: v.endsOn }).select(SPRINT_COLUMNS).single();
      if (error) fail(error);
      return sprintFrom(data);
    },
    async updateSprint(id, v) {
      const row: Record<string, unknown> = {};
      if (v.name !== undefined) row.name = v.name;
      if (v.goal !== undefined) row.goal = v.goal;
      if (v.startsOn !== undefined) row.starts_on = v.startsOn;
      if (v.endsOn !== undefined) row.ends_on = v.endsOn;
      if (v.state !== undefined) row.state = v.state;
      const { data, error } = await db.from('delivery_sprints').update(row).eq('id', id).select(SPRINT_COLUMNS);
      if (error) {
        if ((error as { code?: string }).code === '23505') throw new StoreError(409, 'Another sprint is already running on this board. Complete it first.');
        fail(error);
      }
      if (!data?.length) throw new StoreError(403, 'Changing a sprint needs the editor or admin role.');
      return sprintFrom(data[0]);
    },
    async closeSprint(id, moveTo) {
      const { data, error } = await db.rpc('close_sprint', { target_sprint: id, move_to: moveTo });
      if (error) fail(error);
      return Number(data ?? 0);
    },
    async deleteSprint(id) {
      const { data, error } = await db.from('delivery_sprints').delete().eq('id', id).select('id');
      if (error) fail(error);
      if (!data?.length) throw new StoreError(403, 'Deleting a sprint needs the editor or admin role.');
    },
    async importWorkItems(projectId, planned) {
      if (!planned.length) return 0;
      const { data: project, error: e1 } = await db.from('delivery_projects').select('workspace_id').eq('id', projectId).single();
      if (e1) fail(e1);
      const { data: last, error: e2 } = await db.from('delivery_work_items').select('sort_order').eq('project_id', projectId).order('sort_order', { ascending: false }).limit(1);
      if (e2) fail(e2);
      const base = Number(last?.[0]?.sort_order ?? 0);
      const ids = planned.map(() => crypto.randomUUID());
      // One statement: the parent links are checked at its end, so the import lands whole or not at all.
      const { error } = await db.from('delivery_work_items').insert(planned.map((p, n) => ({
        id: ids[n], workspace_id: project.workspace_id, project_id: projectId, parent_id: p.parent === null ? null : ids[p.parent], item_type: p.type,
        title: p.title, description: p.description, status: p.status, priority: p.priority, owner_id: p.ownerId, estimate_hours: p.estimateHours,
        start_date: p.startDate, due_date: p.dueDate, labels: p.labels, sort_order: base + n + 1,
      })));
      if (error) fail(error);
      return planned.length;
    },
    async listItemHistory(workItemId) {
      const { data, error } = await db.from('delivery_work_item_events').select('id, work_item_id, actor_id, kind, field, old_value, new_value, created_at').eq('work_item_id', workItemId).order('id', { ascending: false }).limit(200);
      if (error) fail(error);
      return (data ?? []).map((r: any): ItemEvent => ({ id: String(r.id), workItemId: r.work_item_id, actorId: r.actor_id, kind: r.kind, field: r.field, oldValue: r.old_value, newValue: r.new_value, createdAt: r.created_at }));
    },
    async listProposals(processId) {
      const { data, error } = await db.from('work_item_proposals').select('derivation_key, item_type, parent_key, title, description, acceptance_criteria, step_ids, requirement_codes, state, rejected_reason, user_edited, sort_order, confirmed_work_item_id, base_hash').eq('process_id', processId).not('derivation_key', 'is', null).order('sort_order');
      if (error) fail(error);
      return (data ?? []).map((r: any): Proposal => ({
        key: r.derivation_key, type: r.item_type, parentKey: r.parent_key, title: r.title, description: r.description, acceptance: r.acceptance_criteria ?? [], stepIds: r.step_ids ?? [],
        requirements: r.requirement_codes ?? [], state: r.state === 'edited' ? 'proposed' : r.state, rejectedReason: r.rejected_reason, edited: r.user_edited, order: r.sort_order, workItemId: r.confirmed_work_item_id, baseHash: r.base_hash,
      }));
    },
    async saveProposals(processId, rows) {
      if (!rows.length) return;
      const process = await this.getProcess(processId);
      if (!process) throw new StoreError(404, 'Process not found.');
      const { data: existing, error: e1 } = await db.from('work_item_proposals').select('id, derivation_key, batch_id').eq('process_id', processId).in('derivation_key', rows.map(r => r.key));
      if (e1) fail(e1);
      const idOf = new Map((existing ?? []).map((x: any) => [x.derivation_key, x]));
      const batch = crypto.randomUUID();
      const row = (r: Proposal) => ({
        workspace_id: process.workspaceId, process_id: processId, derivation_key: r.key, item_type: r.type, parent_key: r.parentKey, title: r.title, description: r.description,
        acceptance_criteria: r.acceptance, step_ids: r.stepIds, requirement_codes: r.requirements, state: r.state, rejected_reason: r.rejectedReason, user_edited: r.edited, sort_order: r.order, base_hash: r.baseHash ?? null,
      });
      const updates = rows.filter(r => idOf.has(r.key)).map(r => ({ ...row(r), id: (idOf.get(r.key) as any).id, batch_id: (idOf.get(r.key) as any).batch_id }));
      const inserts = rows.filter(r => !idOf.has(r.key)).map(r => ({ ...row(r), batch_id: batch }));
      if (updates.length) { const { error } = await db.from('work_item_proposals').upsert(updates, { onConflict: 'id' }); if (error) fail(error); }
      if (inserts.length) { const { error } = await db.from('work_item_proposals').insert(inserts); if (error) fail(error); }
    },
    async listDocumentEdits(processId) {
      const { data, error } = await db.from('document_edits').select('doc_type, section_key, html, base_hash, updated_by, updated_at').eq('process_id', processId);
      if (error) fail(error);
      return (data ?? []).map((r: any): SectionEdit => ({ docType: r.doc_type, sectionKey: r.section_key, html: r.html, baseHash: r.base_hash, updatedBy: r.updated_by, updatedAt: r.updated_at }));
    },
    async saveDocumentEdit(processId, edit) {
      const process = await this.getProcess(processId);
      if (!process) throw new StoreError(404, 'Process not found.');
      const me = (await db.auth.getUser()).data.user?.id;
      const { error } = await db.from('document_edits').upsert({
        workspace_id: process.workspaceId, process_id: processId, doc_type: edit.docType, section_key: edit.sectionKey, html: edit.html, base_hash: edit.baseHash, updated_by: me, updated_at: new Date().toISOString(),
      }, { onConflict: 'process_id,doc_type,section_key' });
      if (error) fail(error);
    },
    async removeDocumentEdit(processId, docType, sectionKey) {
      const { error } = await db.from('document_edits').delete().eq('process_id', processId).eq('doc_type', docType).eq('section_key', sectionKey);
      if (error) fail(error);
    },
    async saveRequirements(processId, rows) {
      if (!rows.length) return;
      const process = await this.getProcess(processId);
      if (!process) throw new StoreError(404, 'Process not found.');
      const { error } = await db.from('requirements').upsert(rows.map(r => ({
        workspace_id: process.workspaceId, process_id: processId, code: r.code, requirement_type: REQ_TYPE[r.kind], statement: r.statement, rationale: r.rationale,
        priority: r.priority, acceptance_criteria: r.acceptance, links: { title: r.title, category: r.category, stepIds: r.stepIds, ruleIds: r.ruleIds, exceptionIds: r.exceptionIds, traces: r.traces, gaps: r.gaps, baseHash: r.baseHash ?? null },
        origin: r.origin, derivation_key: r.key, state: r.state, user_edited: r.edited, sort_order: r.order,
      })), { onConflict: 'process_id,code' });
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
