-- AvalaOS Enterprise baseline schema.
-- Tenancy, processes, the versioned Process Model, its projections
-- (assessment, requirements, documents, flows, work proposals) and the Delivery board.
-- Every table has row-level security. Access is by workspace membership.

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated, service_role, supabase_auth_admin;

create function app_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  can_approve boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_id_idx on public.workspace_members (user_id);

create function app_private.is_workspace_member(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
  );
$$;

create function app_private.can_edit_workspace(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
      and m.role in ('admin', 'editor')
  );
$$;

create function app_private.is_workspace_admin(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
      and m.role = 'admin'
  );
$$;

create function app_private.can_approve_workspace(target_workspace uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = target_workspace and m.user_id = (select auth.uid())
      and m.can_approve
  );
$$;

create function app_private.is_organization_member(target_organization uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organizations o
    where o.id = target_organization and o.created_by = (select auth.uid())
  ) or exists (
    select 1 from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.organization_id = target_organization and m.user_id = (select auth.uid())
  );
$$;

create function app_private.shares_workspace_with(other_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members mine
    join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other_user
  );
$$;

create function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ), 120)
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- A signed-in user creates an organization and its first workspace, and becomes its admin and approver.
create function public.create_organization(organization_name text, workspace_name text default 'General')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  new_organization uuid;
  new_workspace uuid;
begin
  if caller is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if organization_name is null or length(trim(organization_name)) not between 1 and 120 then
    raise exception 'Organization name must be 1 to 120 characters' using errcode = '22023';
  end if;
  if workspace_name is null or length(trim(workspace_name)) not between 1 and 120 then
    raise exception 'Workspace name must be 1 to 120 characters' using errcode = '22023';
  end if;

  insert into public.organizations (name, created_by)
  values (trim(organization_name), caller)
  returning id into new_organization;

  insert into public.workspaces (organization_id, name, created_by)
  values (new_organization, trim(workspace_name), caller)
  returning id into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, can_approve)
  values (new_workspace, caller, 'admin', true);

  return jsonb_build_object('organizationId', new_organization, 'workspaceId', new_workspace);
end $$;

-- The organization's creator adds another workspace and becomes its admin and approver.
create function public.create_workspace(target_organization uuid, workspace_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  new_workspace uuid;
begin
  if caller is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.organizations o where o.id = target_organization and o.created_by = caller
  ) then
    raise exception 'Only the organization owner can add a workspace' using errcode = '42501';
  end if;
  if workspace_name is null or length(trim(workspace_name)) not between 1 and 120 then
    raise exception 'Workspace name must be 1 to 120 characters' using errcode = '22023';
  end if;

  insert into public.workspaces (organization_id, name, created_by)
  values (target_organization, trim(workspace_name), caller)
  returning id into new_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, can_approve)
  values (new_workspace, caller, 'admin', true);

  return new_workspace;
end $$;

-- ---------------------------------------------------------------------------
-- Processes and the versioned Process Model
-- ---------------------------------------------------------------------------

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '',
  department text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, workspace_id)
);
create index processes_workspace_id_idx on public.processes (workspace_id);

-- One working draft per process; approved revisions are immutable and preserved.
create table public.process_model_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  rev_no integer not null check (rev_no >= 1),
  state text not null default 'working' check (state in ('working', 'approved', 'superseded')),
  model jsonb not null default '{}'::jsonb check (jsonb_typeof(model) = 'object'),
  model_hash text,
  edit_seq bigint not null default 0 check (edit_seq >= 0),
  based_on uuid references public.process_model_revisions (id),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, rev_no),
  unique (id, workspace_id),
  check ((state = 'working') = (approved_at is null)),
  check ((approved_at is null) = (approved_by is null))
);
create unique index process_model_revisions_one_working_idx on public.process_model_revisions (process_id) where state = 'working';
create unique index process_model_revisions_one_approved_idx on public.process_model_revisions (process_id) where state = 'approved';
create index process_model_revisions_workspace_id_idx on public.process_model_revisions (workspace_id);
create index process_model_revisions_based_on_idx on public.process_model_revisions (based_on);

-- Approved and superseded revisions never change. The only allowed update is approved -> superseded.
create function app_private.guard_revision_immutability() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- Depth 1 is a direct delete. A cascade from deleting the parent arrives at depth 2.
    if old.state <> 'working' and pg_trigger_depth() = 1 then
      raise exception 'Approved revisions cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if old.state = 'working' then
    return new;
  end if;
  if old.state = 'approved' and new.state = 'superseded'
     and (to_jsonb(new) - 'state' - 'updated_at') = (to_jsonb(old) - 'state' - 'updated_at') then
    return new;
  end if;
  raise exception 'Approved revisions cannot be changed' using errcode = '55000';
end $$;

create trigger process_model_revisions_guard
  before update or delete on public.process_model_revisions
  for each row execute function app_private.guard_revision_immutability();

-- Every change to a model, in order. This is the history and audit trail.
create table public.process_model_edits (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  process_id uuid not null,
  revision_id uuid not null,
  seq bigint not null check (seq >= 1),
  patch jsonb not null check (jsonb_typeof(patch) = 'array'),
  origin text not null check (origin in ('user', 'extraction', 'diagram', 'import', 'system')),
  summary text not null default '',
  actor uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  foreign key (revision_id, workspace_id) references public.process_model_revisions (id, workspace_id) on delete cascade,
  unique (revision_id, seq)
);
create index process_model_edits_workspace_id_idx on public.process_model_edits (workspace_id);
create index process_model_edits_process_id_idx on public.process_model_edits (process_id);

-- ---------------------------------------------------------------------------
-- Projections of the model
-- ---------------------------------------------------------------------------

-- One assessment per model revision. is_stale is set when the working model changes after it was computed.
create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  model_revision_id uuid not null,
  model_hash text not null,
  rules_version text not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  overrides jsonb not null default '[]'::jsonb check (jsonb_typeof(overrides) = 'array'),
  is_stale boolean not null default false,
  computed_by uuid default auth.uid(),
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  foreign key (model_revision_id, workspace_id) references public.process_model_revisions (id, workspace_id) on delete cascade,
  unique (model_revision_id)
);
create index assessments_workspace_id_idx on public.assessments (workspace_id);
create index assessments_process_id_idx on public.assessments (process_id);

-- Requirements are first-class records so traceability is real.
create table public.requirements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  code text not null check (code ~ '^(BR|FR|NFR)-[0-9]{3,}$'),
  requirement_type text not null check (requirement_type in ('business', 'functional', 'non_functional')),
  statement text not null check (length(trim(statement)) >= 1),
  rationale text not null default '',
  priority text check (priority in ('must', 'should', 'could', 'wont')),
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  links jsonb not null default '{}'::jsonb check (jsonb_typeof(links) = 'object'),
  origin text not null default 'derived' check (origin in ('derived', 'user')),
  derivation_key text,
  state text not null default 'active' check (state in ('active', 'source_removed', 'retired')),
  user_edited boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, code),
  unique (id, workspace_id)
);
create unique index requirements_derivation_key_idx on public.requirements (process_id, derivation_key) where derivation_key is not null;
create index requirements_workspace_id_idx on public.requirements (workspace_id);

-- One document per type per process; revisions follow the same working / approved rule as the model.
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  doc_type text not null check (doc_type in ('brd', 'pdd', 'frd', 'sdd')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, doc_type),
  unique (id, workspace_id)
);
create index documents_workspace_id_idx on public.documents (workspace_id);

create table public.document_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  document_id uuid not null,
  rev_no integer not null check (rev_no >= 1),
  state text not null default 'working' check (state in ('working', 'approved', 'superseded')),
  template_version text not null,
  sections jsonb not null default '[]'::jsonb check (jsonb_typeof(sections) = 'array'),
  model_revision_id uuid references public.process_model_revisions (id),
  model_hash text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  foreign key (document_id, workspace_id) references public.documents (id, workspace_id) on delete cascade,
  unique (document_id, rev_no),
  check ((state = 'working') = (approved_at is null)),
  check ((approved_at is null) = (approved_by is null))
);
create unique index document_revisions_one_working_idx on public.document_revisions (document_id) where state = 'working';
create unique index document_revisions_one_approved_idx on public.document_revisions (document_id) where state = 'approved';
create index document_revisions_workspace_id_idx on public.document_revisions (workspace_id);
create index document_revisions_model_revision_id_idx on public.document_revisions (model_revision_id);

create trigger document_revisions_guard
  before update or delete on public.document_revisions
  for each row execute function app_private.guard_revision_immutability();

create table public.flow_diagrams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  kind text not null check (kind in ('as_is', 'to_be')),
  bpmn_xml text not null default '',
  layout jsonb not null default '{}'::jsonb check (jsonb_typeof(layout) = 'object'),
  model_hash text,
  needs_review boolean not null default false,
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, kind)
);
create index flow_diagrams_workspace_id_idx on public.flow_diagrams (workspace_id);

-- ---------------------------------------------------------------------------
-- Delivery board
-- ---------------------------------------------------------------------------

create table public.delivery_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  description text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, workspace_id)
);
create index delivery_projects_workspace_id_idx on public.delivery_projects (workspace_id);

-- Work proposals are reviewed, edited and selected before any of them becomes a board item.
create table public.work_item_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  batch_id uuid not null,
  parent_id uuid references public.work_item_proposals (id) on delete cascade,
  item_type text not null check (item_type in ('epic', 'story', 'task', 'spike', 'decision')),
  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '',
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  step_ids text[] not null default '{}',
  derivation_key text,
  state text not null default 'proposed' check (state in ('proposed', 'edited', 'selected', 'rejected', 'confirmed')),
  rejected_reason text,
  sort_order integer not null default 0,
  confirmed_work_item_id uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (id, workspace_id),
  check (confirmed_work_item_id is null or state = 'confirmed')
);
create unique index work_item_proposals_derivation_key_idx on public.work_item_proposals (process_id, derivation_key) where derivation_key is not null;
create index work_item_proposals_workspace_id_idx on public.work_item_proposals (workspace_id);
create index work_item_proposals_process_id_idx on public.work_item_proposals (process_id);
create index work_item_proposals_parent_id_idx on public.work_item_proposals (parent_id);
create index work_item_proposals_confirmed_work_item_id_idx on public.work_item_proposals (confirmed_work_item_id);

-- Owner, estimate and dates are nullable on purpose: "unassigned" is a valid state.
create table public.delivery_work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  parent_id uuid references public.delivery_work_items (id) on delete set null,
  item_type text not null default 'task' check (item_type in ('epic', 'story', 'task', 'bug', 'subtask', 'spike', 'decision')),
  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '',
  acceptance_criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(acceptance_criteria) = 'array'),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'in_review', 'testing', 'ready_for_release', 'done', 'blocked', 'on_hold')),
  priority text check (priority in ('high', 'medium', 'low')),
  owner_id uuid references auth.users (id) on delete set null,
  estimate_hours numeric(8, 2) check (estimate_hours >= 0),
  start_date date,
  due_date date,
  process_id uuid references public.processes (id) on delete set null,
  origin_proposal_id uuid references public.work_item_proposals (id) on delete set null,
  step_ids text[] not null default '{}',
  sort_order double precision not null default 0,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.delivery_projects (id, workspace_id) on delete cascade,
  unique (id, workspace_id),
  check (start_date is null or due_date is null or due_date >= start_date)
);
-- A confirmed proposal appears on the board exactly once.
create unique index delivery_work_items_origin_proposal_idx on public.delivery_work_items (origin_proposal_id) where origin_proposal_id is not null;
create index delivery_work_items_workspace_id_idx on public.delivery_work_items (workspace_id);
create index delivery_work_items_project_id_idx on public.delivery_work_items (project_id, status);
create index delivery_work_items_parent_id_idx on public.delivery_work_items (parent_id);
create index delivery_work_items_owner_id_idx on public.delivery_work_items (owner_id);
create index delivery_work_items_process_id_idx on public.delivery_work_items (process_id);

alter table public.work_item_proposals
  add constraint work_item_proposals_confirmed_work_item_fk
  foreign key (confirmed_work_item_id) references public.delivery_work_items (id) on delete set null;

create table public.proposal_requirements (
  proposal_id uuid not null,
  requirement_id uuid not null,
  workspace_id uuid not null,
  primary key (proposal_id, requirement_id),
  foreign key (proposal_id, workspace_id) references public.work_item_proposals (id, workspace_id) on delete cascade,
  foreign key (requirement_id, workspace_id) references public.requirements (id, workspace_id) on delete cascade
);
create index proposal_requirements_requirement_id_idx on public.proposal_requirements (requirement_id);
create index proposal_requirements_workspace_id_idx on public.proposal_requirements (workspace_id);

create table public.work_item_requirements (
  work_item_id uuid not null,
  requirement_id uuid not null,
  workspace_id uuid not null,
  primary key (work_item_id, requirement_id),
  foreign key (work_item_id, workspace_id) references public.delivery_work_items (id, workspace_id) on delete cascade,
  foreign key (requirement_id, workspace_id) references public.requirements (id, workspace_id) on delete cascade
);
create index work_item_requirements_requirement_id_idx on public.work_item_requirements (requirement_id);
create index work_item_requirements_workspace_id_idx on public.work_item_requirements (workspace_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

create trigger profiles_touch before update on public.profiles for each row execute function app_private.touch_updated_at();
create trigger organizations_touch before update on public.organizations for each row execute function app_private.touch_updated_at();
create trigger workspaces_touch before update on public.workspaces for each row execute function app_private.touch_updated_at();
create trigger processes_touch before update on public.processes for each row execute function app_private.touch_updated_at();
create trigger process_model_revisions_touch before update on public.process_model_revisions for each row execute function app_private.touch_updated_at();
create trigger assessments_touch before update on public.assessments for each row execute function app_private.touch_updated_at();
create trigger requirements_touch before update on public.requirements for each row execute function app_private.touch_updated_at();
create trigger document_revisions_touch before update on public.document_revisions for each row execute function app_private.touch_updated_at();
create trigger flow_diagrams_touch before update on public.flow_diagrams for each row execute function app_private.touch_updated_at();
create trigger delivery_projects_touch before update on public.delivery_projects for each row execute function app_private.touch_updated_at();
create trigger work_item_proposals_touch before update on public.work_item_proposals for each row execute function app_private.touch_updated_at();
create trigger delivery_work_items_touch before update on public.delivery_work_items for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.processes enable row level security;
alter table public.process_model_revisions enable row level security;
alter table public.process_model_edits enable row level security;
alter table public.assessments enable row level security;
alter table public.requirements enable row level security;
alter table public.documents enable row level security;
alter table public.document_revisions enable row level security;
alter table public.flow_diagrams enable row level security;
alter table public.delivery_projects enable row level security;
alter table public.work_item_proposals enable row level security;
alter table public.delivery_work_items enable row level security;
alter table public.proposal_requirements enable row level security;
alter table public.work_item_requirements enable row level security;

-- Profiles: read your own and those of people you share a workspace with; change only your own.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or app_private.shares_workspace_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Organizations and workspaces are created through create_organization / create_workspace.
create policy organizations_select on public.organizations for select to authenticated
  using (app_private.is_organization_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));

create policy workspaces_select on public.workspaces for select to authenticated
  using (app_private.is_workspace_member(id));
create policy workspaces_update on public.workspaces for update to authenticated
  using (app_private.is_workspace_admin(id)) with check (app_private.is_workspace_admin(id));

create policy workspace_members_select on public.workspace_members for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
  with check (app_private.is_workspace_admin(workspace_id));
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (app_private.is_workspace_admin(workspace_id)) with check (app_private.is_workspace_admin(workspace_id));
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (app_private.is_workspace_admin(workspace_id));

-- Processes are archived, not deleted, so there is no delete policy.
create policy processes_select on public.processes for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy processes_insert on public.processes for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy processes_update on public.processes for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));

-- Model revisions, their edit log and document revisions are read-only here.
-- Writes go through server commands that enforce ordering and approval rules.
create policy process_model_revisions_select on public.process_model_revisions for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy process_model_edits_select on public.process_model_edits for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy document_revisions_select on public.document_revisions for select to authenticated
  using (app_private.is_workspace_member(workspace_id));

create policy assessments_select on public.assessments for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy assessments_insert on public.assessments for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy assessments_update on public.assessments for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy assessments_delete on public.assessments for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

create policy requirements_select on public.requirements for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy requirements_insert on public.requirements for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy requirements_update on public.requirements for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy requirements_delete on public.requirements for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

create policy documents_select on public.documents for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));

create policy flow_diagrams_select on public.flow_diagrams for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy flow_diagrams_insert on public.flow_diagrams for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy flow_diagrams_update on public.flow_diagrams for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));

create policy delivery_projects_select on public.delivery_projects for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy delivery_projects_insert on public.delivery_projects for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy delivery_projects_update on public.delivery_projects for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy delivery_projects_delete on public.delivery_projects for delete to authenticated
  using (app_private.is_workspace_admin(workspace_id));

create policy work_item_proposals_select on public.work_item_proposals for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy work_item_proposals_insert on public.work_item_proposals for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy work_item_proposals_update on public.work_item_proposals for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy work_item_proposals_delete on public.work_item_proposals for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

create policy delivery_work_items_select on public.delivery_work_items for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy delivery_work_items_insert on public.delivery_work_items for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy delivery_work_items_update on public.delivery_work_items for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy delivery_work_items_delete on public.delivery_work_items for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

create policy proposal_requirements_select on public.proposal_requirements for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy proposal_requirements_insert on public.proposal_requirements for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy proposal_requirements_delete on public.proposal_requirements for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

create policy work_item_requirements_select on public.work_item_requirements for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy work_item_requirements_insert on public.work_item_requirements for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy work_item_requirements_delete on public.work_item_requirements for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- Privileges: signed-in users only. Row-level security decides which rows.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on all functions in schema app_private from public;
grant execute on all functions in schema app_private to authenticated, service_role, supabase_auth_admin;

revoke execute on function public.create_organization(text, text) from public, anon;
revoke execute on function public.create_workspace(uuid, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.create_workspace(uuid, text) to authenticated;
