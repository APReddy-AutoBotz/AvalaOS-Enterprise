-- The workspace's list of applications (Phase C, "Organisation system registry"; one list per
-- workspace, because a workspace is one client and client A's SAP is not client B's): each
-- application's name, the other names it goes by in sources, its kind, how it can be reached (API,
-- screens, file …) with what is confirmed, and whether robots may drive its screens or it is reached
-- through a remote desktop. Entered by people, never by extraction; a process takes these facts only
-- when a person accepts them. Members read; editors and admins write.

-- Other names: up to 20, each 1 to 120 characters after trimming.
create function app_private.aliases_ok(a text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(a) <= 20 and not exists (select 1 from unnest(a) x where x is null or length(trim(x)) not between 1 and 120);
$$;

create table public.workspace_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  aliases text[] not null default '{}' check (app_private.aliases_ok(aliases)),
  kind text not null default 'other' check (kind in ('erp', 'email', 'document_store', 'spreadsheet', 'workflow', 'portal', 'scanner', 'other')),
  access jsonb not null default '[]'::jsonb check (jsonb_typeof(access) = 'array' and jsonb_array_length(access) <= 30 and octet_length(access::text) <= 30000),
  ui_allowed boolean,
  remote boolean,
  notes text not null default '' check (length(notes) <= 4000),
  updated_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspace_applications_name_idx on public.workspace_applications (workspace_id, lower(trim(name)));
create index workspace_applications_updated_by_idx on public.workspace_applications (updated_by);
create trigger workspace_applications_touch before update on public.workspace_applications for each row execute function app_private.touch_updated_at();

-- The row keeps its workspace; whoever writes it is recorded.
create function app_private.application_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.name := trim(new.name);
  return new;
end $$;
create trigger workspace_applications_rules before insert or update on public.workspace_applications
  for each row execute function app_private.application_rules();

alter table public.workspace_applications enable row level security;
create policy workspace_applications_select on public.workspace_applications for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy workspace_applications_insert on public.workspace_applications for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy workspace_applications_update on public.workspace_applications for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy workspace_applications_delete on public.workspace_applications for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

revoke all on public.workspace_applications from anon;
revoke truncate on public.workspace_applications from authenticated;
