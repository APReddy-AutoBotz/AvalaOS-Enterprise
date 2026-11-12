-- Assessment settings an organisation sets for itself, one row per workspace: hours a full-time
-- person works in a year, where high value starts, and where an easier build starts. Without a row
-- the application uses its published defaults. Members read; admins write.

create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  assessment jsonb not null default '{}'::jsonb check (jsonb_typeof(assessment) = 'object' and octet_length(assessment::text) <= 4000),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index workspace_settings_updated_by_idx on public.workspace_settings (updated_by);

alter table public.workspace_settings enable row level security;

create policy workspace_settings_select on public.workspace_settings for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy workspace_settings_insert on public.workspace_settings for insert to authenticated
  with check (app_private.is_workspace_admin(workspace_id) and updated_by = (select auth.uid()));
create policy workspace_settings_update on public.workspace_settings for update to authenticated
  using (app_private.is_workspace_admin(workspace_id))
  with check (app_private.is_workspace_admin(workspace_id) and updated_by = (select auth.uid()));

revoke all on public.workspace_settings from anon;
revoke delete, truncate on public.workspace_settings from authenticated;
