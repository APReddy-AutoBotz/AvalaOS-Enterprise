-- Each process can name an analyst, an architect and an approver. They decide what "My work" shows
-- first; they do not change what anyone may do (roles do that).

alter table public.processes
  add column analyst_id uuid references auth.users (id) on delete set null,
  add column architect_id uuid references auth.users (id) on delete set null,
  add column approver_id uuid references auth.users (id) on delete set null;
create index processes_analyst_id_idx on public.processes (analyst_id);
create index processes_architect_id_idx on public.processes (architect_id);
create index processes_approver_id_idx on public.processes (approver_id);

-- A named person must belong to the process's workspace.
create function app_private.check_process_people() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who uuid;
begin
  foreach who in array array[new.analyst_id, new.architect_id, new.approver_id] loop
    if who is not null and not exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = who) then
      raise exception 'That person is not a member of this workspace' using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
create trigger processes_people_member before insert or update of analyst_id, architect_id, approver_id on public.processes
  for each row execute function app_private.check_process_people();

-- Removing a member also clears their names on processes.
create or replace function public.remove_member(target_workspace uuid, target_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  cur_role text;
  who text;
begin
  if caller is null or not app_private.is_workspace_admin(target_workspace) then
    raise exception 'FORBIDDEN: only an admin can remove people' using errcode = '42501';
  end if;
  select role into cur_role from public.workspace_members where workspace_id = target_workspace and user_id = target_user for update;
  if not found then
    raise exception 'NOT_FOUND: that person is not in this workspace' using errcode = 'PT404';
  end if;
  if cur_role = 'admin'
     and not exists (select 1 from public.workspace_members where workspace_id = target_workspace and role = 'admin' and user_id <> target_user) then
    raise exception 'LAST_ADMIN: a workspace needs at least one admin' using errcode = '23514';
  end if;
  select coalesce(nullif(trim(display_name), ''), 'Unnamed member') into who from public.profiles where id = target_user;
  update public.delivery_work_items set owner_id = null where workspace_id = target_workspace and owner_id = target_user;
  update public.processes set analyst_id = null where workspace_id = target_workspace and analyst_id = target_user;
  update public.processes set architect_id = null where workspace_id = target_workspace and architect_id = target_user;
  update public.processes set approver_id = null where workspace_id = target_workspace and approver_id = target_user;
  delete from public.workspace_members where workspace_id = target_workspace and user_id = target_user;
  insert into public.workspace_audit (workspace_id, kind, actor, subject_user, subject_label)
  values (target_workspace, 'removed', caller, target_user, coalesce(who, 'Unnamed member'));
end $$;
