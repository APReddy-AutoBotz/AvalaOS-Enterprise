-- Only the platform owner creates organizations. Each workspace has its own monthly AI allowance on the
-- platform's key, so a new organization (and so a new workspace) is the owner's decision until workspaces
-- bring their own key. People join by invitation; someone with no workspace is told to ask an admin.
--
-- The owners are listed in app_private.platform_owners (not reachable through the API). This migration adds
-- nobody: add the owner once with
--   insert into app_private.platform_owners (user_id) select id from auth.users where email = '<owner email>';
-- While the list is empty (a new deployment), anyone signed in may create the first organization.
-- Existing organizations and workspaces are unchanged; create_workspace already allows only the
-- organization's creator.

create table app_private.platform_owners (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table app_private.platform_owners enable row level security;
revoke all on app_private.platform_owners from public, anon, authenticated;

create function app_private.may_create_organization(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and (
    exists (select 1 from app_private.platform_owners o where o.user_id = uid)
    or not exists (select 1 from app_private.platform_owners)
  );
$$;

revoke all on function app_private.may_create_organization(uuid) from public, anon, authenticated;

-- Whether the signed-in person may create an organization (the first-run screen asks before showing the form).
create function public.can_create_organization() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.may_create_organization((select auth.uid()));
$$;

revoke all on function public.can_create_organization() from public, anon;
grant execute on function public.can_create_organization() to authenticated;

create or replace function public.create_organization(organization_name text, workspace_name text default 'General')
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
  if not app_private.may_create_organization(caller) then
    raise exception 'Only the Avala OS owner can create an organization. Ask a workspace admin to invite you.' using errcode = '42501';
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
