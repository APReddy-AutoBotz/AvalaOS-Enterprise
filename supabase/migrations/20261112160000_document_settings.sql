-- How a workspace's documents look and are laid out: branding (organisation, font, colour, logo,
-- the styles of the company's Word template) and per document type the section layout. One row per
-- workspace; without a row the application uses its defaults. Members read; admins write.

create table public.document_settings (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 1500000),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now()
);
create index document_settings_updated_by_idx on public.document_settings (updated_by);

alter table public.document_settings enable row level security;

create policy document_settings_select on public.document_settings for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy document_settings_insert on public.document_settings for insert to authenticated
  with check (app_private.is_workspace_admin(workspace_id) and updated_by = (select auth.uid()));
create policy document_settings_update on public.document_settings for update to authenticated
  using (app_private.is_workspace_admin(workspace_id))
  with check (app_private.is_workspace_admin(workspace_id) and updated_by = (select auth.uid()));

revoke all on public.document_settings from anon;
revoke delete, truncate on public.document_settings from authenticated;
