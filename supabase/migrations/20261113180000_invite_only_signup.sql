-- Sign-up is by invitation: an account can only be created for an email that a workspace admin has invited.
-- Existing accounts are untouched. Accounts made from the Supabase dashboard ("Invite user") still work:
-- those are created by the service role and carry no invite, so they are allowed when the caller is not a public sign-up.
create function app_private.require_invite() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Dashboard / admin-created users are marked by the auth admin API with an invited_at stamp.
  if new.invited_at is not null then return new; end if;
  if exists (select 1 from public.workspace_invites i where i.email = lower(coalesce(new.email, ''))) then return new; end if;
  raise exception 'Sign-up is by invitation. Ask a workspace admin to invite this email address.' using errcode = 'P0001';
end $$;

revoke all on function app_private.require_invite() from public, anon, authenticated;

create trigger require_invite_before_signup
  before insert on auth.users
  for each row execute function app_private.require_invite();
