-- An invitation is claimed only by an account whose email address is confirmed.
-- Before this, a new account joined the invited workspaces as soon as it was created, before anyone had
-- shown they own the address. With Google and Microsoft sign-in an account can arrive with an address the
-- provider has not verified (Microsoft without the xms_edov claim), so joining waits for confirmation:
-- at creation when the address is already confirmed (Google, a confirmed Microsoft address, the
-- dashboard), otherwise when it is confirmed later. The invite-only check itself is unchanged.

create or replace function app_private.claim_invites(uid uuid, address text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv record;
begin
  for inv in select * from public.workspace_invites where email = lower(coalesce(address, '')) loop
    insert into public.workspace_members (workspace_id, user_id, role, job, can_approve)
    values (inv.workspace_id, uid, inv.role, inv.job, inv.can_approve)
    on conflict do nothing;
    insert into public.workspace_audit (workspace_id, kind, actor, subject_user, subject_label, detail)
    values (inv.workspace_id, 'joined', null, uid, inv.email, app_private.role_label(inv.role, inv.job, inv.can_approve));
    delete from public.workspace_invites where workspace_id = inv.workspace_id and email = inv.email;
  end loop;
end $$;

revoke all on function app_private.claim_invites(uuid, text) from public, anon, authenticated;

create or replace function app_private.handle_new_user() returns trigger
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

  if new.email_confirmed_at is not null then
    perform app_private.claim_invites(new.id, new.email);
  end if;
  return new;
end $$;

create or replace function app_private.handle_email_confirmed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null then
    perform app_private.claim_invites(new.id, new.email);
  end if;
  return new;
end $$;

revoke all on function app_private.handle_email_confirmed() from public, anon, authenticated;

create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function app_private.handle_email_confirmed();
