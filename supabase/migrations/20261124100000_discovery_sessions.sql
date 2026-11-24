-- Package B of docs/next-plan.md, pull request 3 (plan `claude/package-b-plan-23-nov.md`, section 15; approved
-- 23 November 2026). Applied only on the owner's yes, after a rolled-back trial.
--
-- A discovery session: Ask Avala asking about one process, one question at a time (journey/process/
-- DiscoveryPanel.tsx, pull request 4). One row per session. What a person saved is in the record and the sources
-- as today; the session keeps only what is not in the record yet, in `state` (domain/discovery/): the shape answers
-- waiting for the next update of the draft, each the person's words and the question asked; the questions raised
-- and not yet acted on, each with its quote; the wanted statements not yet kept; the questions skipped; the
-- passages already read for noticing; the calls, tokens and readings used, so the cap survives a reload.
--
-- One open session per process, shared by its editors, so a person can stop and go on from another device. A
-- write carries the version it read: the database refuses a write that names another version, counts each write
-- one more, and stamps who and when, so two editors never lose each other's work (the page reads again and
-- applies its step once more, as with the look in the sources). A finished session is kept as it was and cannot
-- be reopened. Members read; editors and admins write; nobody deletes a session by hand; it goes with its process.
--
-- Additive only: no existing table, function or rule changes, and the released site and server functions read
-- none of it. No trigger feeds package 14's change record: a session feeds no document.

create table public.discovery_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  status text not null default 'open' check (status in ('open', 'finished')),
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object' and length(state::text) <= 262144),
  version integer not null default 1 check (version > 0),
  started_by uuid default auth.uid() references auth.users (id) on delete set null,
  started_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'finished') = (finished_at is not null)),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade
);
-- At most one open session per process.
create unique index discovery_sessions_one_open_idx on public.discovery_sessions (process_id) where status = 'open';
create index discovery_sessions_process_id_idx on public.discovery_sessions (process_id, workspace_id);
create index discovery_sessions_workspace_id_idx on public.discovery_sessions (workspace_id);
create index discovery_sessions_started_by_idx on public.discovery_sessions (started_by);
create index discovery_sessions_updated_by_idx on public.discovery_sessions (updated_by);

-- Who started it, who wrote last and when are the database's, not the writer's. A write must name the version it
-- read (an update that leaves `version` as it is names the current one); the stored version is then one more.
-- A session stays with its process and workspace, and a finished one is never changed.
create function app_private.discovery_session_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'finished' then
      raise exception 'FINISHED: this discovery session is finished; start a new one' using errcode = 'P0001';
    end if;
    if new.version is distinct from old.version then
      raise exception 'EDIT_CONFLICT: the session is at version %, not %', old.version, new.version using errcode = 'P0001';
    end if;
    new.id := old.id;
    new.process_id := old.process_id;
    new.workspace_id := old.workspace_id;
    new.started_by := old.started_by;
    new.started_at := old.started_at;
    new.version := old.version + 1;
  else
    if new.status <> 'open' then
      raise exception 'BAD_INPUT: a discovery session starts open' using errcode = 'P0001';
    end if;
    new.version := 1;
    new.started_by := (select auth.uid());
    new.started_at := now();
  end if;
  new.finished_at := case when new.status = 'finished' then now() end;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end $$;
create trigger discovery_sessions_rules before insert or update on public.discovery_sessions
  for each row execute function app_private.discovery_session_rules();

alter table public.discovery_sessions enable row level security;
create policy discovery_sessions_select on public.discovery_sessions for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy discovery_sessions_insert on public.discovery_sessions for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy discovery_sessions_update on public.discovery_sessions for update to authenticated
  using (app_private.can_edit_workspace(workspace_id))
  with check (app_private.can_edit_workspace(workspace_id));
revoke all on public.discovery_sessions from anon;
revoke truncate, delete on public.discovery_sessions from authenticated;
