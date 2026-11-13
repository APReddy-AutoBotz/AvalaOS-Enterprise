-- People and roles. Access stays admin / editor / viewer plus can_approve (what the database enforces);
-- a job says what an editor does. People are added by invitation, every change is recorded, and the
-- last admin of a workspace can never be removed.

alter table public.workspace_members
  add column job text check (job in ('business_analyst', 'solution_architect', 'developer', 'approver'));

-- An invitation waits for a person to sign up with the invited email.
create table public.workspace_invites (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (email = lower(email) and length(email) between 5 and 254),
  role text not null check (role in ('admin', 'editor', 'viewer')),
  job text check (job in ('business_analyst', 'solution_architect', 'developer', 'approver')),
  can_approve boolean not null default false,
  invited_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, email)
);

-- Who changed who, in order. Approvals are read from the revisions themselves.
create table public.workspace_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  kind text not null check (kind in ('invited', 'joined', 'role_changed', 'removed', 'invite_cancelled')),
  actor uuid,
  subject_user uuid,
  subject_label text not null,
  detail text not null default ''
);
create index workspace_audit_workspace_idx on public.workspace_audit (workspace_id, at desc);

alter table public.workspace_invites enable row level security;
alter table public.workspace_audit enable row level security;
create policy workspace_invites_select on public.workspace_invites for select to authenticated
  using (app_private.is_workspace_admin(workspace_id));
create policy workspace_audit_select on public.workspace_audit for select to authenticated
  using (app_private.is_workspace_admin(workspace_id));

-- Membership changes now go through the functions below, which keep the audit trail and the last-admin rule.
drop policy workspace_members_insert on public.workspace_members;
drop policy workspace_members_update on public.workspace_members;
drop policy workspace_members_delete on public.workspace_members;

create function app_private.role_label(r text, j text, a boolean) returns text
language sql immutable set search_path = '' as $$
  select case
    when r = 'admin' then 'Admin'
    when j = 'business_analyst' then 'Business analyst'
    when j = 'solution_architect' then 'Solution architect'
    when j = 'developer' then 'Developer'
    when r = 'viewer' and a then 'Approver'
    when r = 'viewer' then 'Viewer'
    else 'Business analyst' end;
$$;

create function app_private.check_role(r text, j text, a boolean) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if r not in ('admin', 'editor', 'viewer') then
    raise exception 'Unknown access level' using errcode = '22023';
  end if;
  if r = 'admin' and j is not null then
    raise exception 'An admin has no job title' using errcode = '22023';
  end if;
  if j is not null and j not in ('business_analyst', 'solution_architect', 'developer', 'approver') then
    raise exception 'Unknown job' using errcode = '22023';
  end if;
end $$;

-- Invite by email. Someone who already has an account joins at once; otherwise the invitation waits for sign-up.
create function public.invite_member(target_workspace uuid, member_email text, member_role text, member_job text default null, member_can_approve boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  addr text := lower(trim(coalesce(member_email, '')));
  existing uuid;
  label text := app_private.role_label(member_role, member_job, member_can_approve);
begin
  if caller is null or not app_private.is_workspace_admin(target_workspace) then
    raise exception 'FORBIDDEN: only an admin can add people' using errcode = '42501';
  end if;
  if addr !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(addr) > 254 then
    raise exception 'Enter a work email address, like name@company.com.' using errcode = '22023';
  end if;
  perform app_private.check_role(member_role, member_job, member_can_approve);

  select id into existing from auth.users where lower(email) = addr;
  if existing is not null then
    if exists (select 1 from public.workspace_members where workspace_id = target_workspace and user_id = existing) then
      raise exception 'CONFLICT: % is already in this workspace' , addr using errcode = '23505';
    end if;
    insert into public.workspace_members (workspace_id, user_id, role, job, can_approve)
    values (target_workspace, existing, member_role, member_job, member_can_approve or member_role = 'admin');
    insert into public.workspace_audit (workspace_id, kind, actor, subject_user, subject_label, detail)
    values (target_workspace, 'joined', caller, existing, addr, label);
    return jsonb_build_object('state', 'member');
  end if;

  insert into public.workspace_invites (workspace_id, email, role, job, can_approve, invited_by)
  values (target_workspace, addr, member_role, member_job, member_can_approve or member_role = 'admin', caller)
  on conflict (workspace_id, email) do update set role = excluded.role, job = excluded.job, can_approve = excluded.can_approve, invited_by = excluded.invited_by, created_at = now();
  insert into public.workspace_audit (workspace_id, kind, actor, subject_label, detail)
  values (target_workspace, 'invited', caller, addr, label);
  return jsonb_build_object('state', 'invited');
end $$;

create function public.change_member(target_workspace uuid, target_user uuid, member_role text, member_job text default null, member_can_approve boolean default false)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  cur_role text;
  who text;
begin
  if caller is null or not app_private.is_workspace_admin(target_workspace) then
    raise exception 'FORBIDDEN: only an admin can change roles' using errcode = '42501';
  end if;
  perform app_private.check_role(member_role, member_job, member_can_approve);
  select role into cur_role from public.workspace_members where workspace_id = target_workspace and user_id = target_user for update;
  if not found then
    raise exception 'NOT_FOUND: that person is not in this workspace' using errcode = 'PT404';
  end if;
  if cur_role = 'admin' and member_role <> 'admin'
     and not exists (select 1 from public.workspace_members where workspace_id = target_workspace and role = 'admin' and user_id <> target_user) then
    raise exception 'LAST_ADMIN: a workspace needs at least one admin' using errcode = '23514';
  end if;
  update public.workspace_members
     set role = member_role, job = member_job, can_approve = member_can_approve or member_role = 'admin'
   where workspace_id = target_workspace and user_id = target_user;
  select coalesce(nullif(trim(display_name), ''), 'Unnamed member') into who from public.profiles where id = target_user;
  insert into public.workspace_audit (workspace_id, kind, actor, subject_user, subject_label, detail)
  values (target_workspace, 'role_changed', caller, target_user, coalesce(who, 'Unnamed member'), app_private.role_label(member_role, member_job, member_can_approve));
end $$;

create function public.remove_member(target_workspace uuid, target_user uuid) returns void
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
  -- Their work stays on the board, unassigned.
  update public.delivery_work_items set owner_id = null where workspace_id = target_workspace and owner_id = target_user;
  delete from public.workspace_members where workspace_id = target_workspace and user_id = target_user;
  insert into public.workspace_audit (workspace_id, kind, actor, subject_user, subject_label)
  values (target_workspace, 'removed', caller, target_user, coalesce(who, 'Unnamed member'));
end $$;

create function public.cancel_invite(target_workspace uuid, invite_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid());
begin
  if caller is null or not app_private.is_workspace_admin(target_workspace) then
    raise exception 'FORBIDDEN: only an admin can cancel an invitation' using errcode = '42501';
  end if;
  delete from public.workspace_invites where workspace_id = target_workspace and email = lower(trim(invite_email));
  if found then
    insert into public.workspace_audit (workspace_id, kind, actor, subject_label)
    values (target_workspace, 'invite_cancelled', caller, lower(trim(invite_email)));
  end if;
end $$;

-- The people of a workspace. Emails are shown to admins only.
create function public.list_people(target_workspace uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean;
begin
  if not app_private.is_workspace_member(target_workspace) then
    raise exception 'NOT_FOUND: workspace' using errcode = 'PT404';
  end if;
  admin := app_private.is_workspace_admin(target_workspace);
  return jsonb_build_object(
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', m.user_id, 'name', coalesce(nullif(trim(p.display_name), ''), 'Unnamed member'),
        'email', case when admin then u.email end, 'role', m.role, 'job', m.job, 'canApprove', m.can_approve, 'since', m.created_at
      ) order by coalesce(nullif(trim(p.display_name), ''), 'Unnamed member'))
      from public.workspace_members m
      left join public.profiles p on p.id = m.user_id
      left join auth.users u on u.id = m.user_id
      where m.workspace_id = target_workspace), '[]'::jsonb),
    'invites', case when admin then coalesce((
      select jsonb_agg(jsonb_build_object('email', i.email, 'role', i.role, 'job', i.job, 'canApprove', i.can_approve, 'at', i.created_at) order by i.created_at)
      from public.workspace_invites i where i.workspace_id = target_workspace), '[]'::jsonb) else '[]'::jsonb end
  );
end $$;

-- Who did what, newest first: membership changes and approvals. Admins only.
create function public.workspace_audit_log(target_workspace uuid, max_rows int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_workspace_admin(target_workspace) then
    raise exception 'FORBIDDEN: only an admin can read the audit trail' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.entry order by x.at desc) from (
      select * from (
        select a.at, jsonb_build_object('id', a.id, 'at', a.at, 'kind', a.kind,
          'actor', coalesce(nullif(trim(pa.display_name), ''), 'Someone'), 'subject', a.subject_label, 'detail', a.detail) as entry
        from public.workspace_audit a left join public.profiles pa on pa.id = a.actor
        where a.workspace_id = target_workspace
        union all
        select r.approved_at, jsonb_build_object('id', r.id, 'at', r.approved_at, 'kind', 'approved',
          'actor', coalesce(nullif(trim(pa.display_name), ''), 'Someone'), 'subject', pr.name, 'detail', 'version ' || r.rev_no)
        from public.process_model_revisions r
        join public.processes pr on pr.id = r.process_id
        left join public.profiles pa on pa.id = r.approved_by
        where r.workspace_id = target_workspace and r.approved_at is not null
      ) u order by u.at desc limit greatest(1, least(max_rows, 500))
    ) x), '[]'::jsonb);
end $$;

-- A new account claims the invitations sent to its email.
create or replace function app_private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  inv record;
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

  for inv in select * from public.workspace_invites where email = lower(coalesce(new.email, '')) loop
    insert into public.workspace_members (workspace_id, user_id, role, job, can_approve)
    values (inv.workspace_id, new.id, inv.role, inv.job, inv.can_approve)
    on conflict do nothing;
    insert into public.workspace_audit (workspace_id, kind, actor, subject_user, subject_label, detail)
    values (inv.workspace_id, 'joined', null, new.id, inv.email, app_private.role_label(inv.role, inv.job, inv.can_approve));
    delete from public.workspace_invites where workspace_id = inv.workspace_id and email = inv.email;
  end loop;
  return new;
end $$;

-- An owner on the board must belong to the workspace.
create function app_private.check_work_item_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
     and not exists (select 1 from public.workspace_members m where m.workspace_id = new.workspace_id and m.user_id = new.owner_id) then
    raise exception 'That person is not a member of this workspace' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger delivery_work_items_owner_member before insert or update of owner_id on public.delivery_work_items
  for each row execute function app_private.check_work_item_owner();

revoke all on function public.invite_member(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.change_member(uuid, uuid, text, text, boolean) from public, anon;
revoke all on function public.remove_member(uuid, uuid) from public, anon;
revoke all on function public.cancel_invite(uuid, text) from public, anon;
revoke all on function public.list_people(uuid) from public, anon;
revoke all on function public.workspace_audit_log(uuid, int) from public, anon;
grant execute on function public.invite_member(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.change_member(uuid, uuid, text, text, boolean) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.cancel_invite(uuid, text) to authenticated;
grant execute on function public.list_people(uuid) to authenticated;
grant execute on function public.workspace_audit_log(uuid, int) to authenticated;
