-- Package 4 of docs/next-plan.md (section 3b; applied only on the owner's yes after a rolled-back trial).
-- What Avala OS looked up in a process's sources, kept on the server for everyone instead of in each
-- browser: the look (the set of sources, the questions looked up, the answers found, what it cost, what was
-- sent and when, when the month's allowance ran out; domain/assistant/sourceLook.ts) and the suggestions set
-- aside with "Not right". One row per process. Members read; editors write. The database records who wrote
-- and when, and counts each write (`version`), so a page that read an older copy sees its write refused and
-- adds its step to the newer copy instead (journey/process/sourceLook.ts). The row goes with its process.
-- Additive only: the released site does not read it, and keeps its look in the browser until the release.

create table public.process_source_looks (
  process_id uuid primary key,
  workspace_id uuid not null,
  look jsonb not null default '{}'::jsonb check (jsonb_typeof(look) = 'object' and length(look::text) <= 2000000),
  dismissed jsonb not null default '[]'::jsonb check (jsonb_typeof(dismissed) = 'array' and jsonb_array_length(dismissed) <= 500),
  version integer not null default 1 check (version > 0),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade
);
create index process_source_looks_workspace_id_idx on public.process_source_looks (workspace_id);
create index process_source_looks_updated_by_idx on public.process_source_looks (updated_by);

-- Who wrote and when are the database's, not the writer's; a write counts one more version; a row stays
-- with its process and workspace.
create function app_private.process_source_look_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.process_id := old.process_id;
    new.workspace_id := old.workspace_id;
    new.version := old.version + 1;
  else
    new.version := 1;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;
create trigger process_source_looks_rules before insert or update on public.process_source_looks
  for each row execute function app_private.process_source_look_rules();

alter table public.process_source_looks enable row level security;
create policy process_source_looks_select on public.process_source_looks for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy process_source_looks_insert on public.process_source_looks for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy process_source_looks_update on public.process_source_looks for update to authenticated
  using (app_private.can_edit_workspace(workspace_id))
  with check (app_private.can_edit_workspace(workspace_id));
revoke all on public.process_source_looks from anon;
revoke truncate, delete on public.process_source_looks from authenticated;
