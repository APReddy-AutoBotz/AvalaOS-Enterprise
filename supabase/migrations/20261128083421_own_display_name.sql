-- A person sets their own name (plan claude/your-name-plan-28-nov.md in the owner's project, approved by the owner
-- on 28 November 2026). Additive only, and nothing the released site or the server functions use changes:
-- the released site never writes profiles, and the server functions use the service role, whose grants stay.
--
-- 1. A signed-in person may update only the name column. The policy profiles_update already limits them to their
--    own row (id = auth.uid(), before and after); until now the table-wide grant also let them change created_at.
-- 2. A name a signed-in person writes is trimmed, and refused with NAME_INVALID (check violation) unless it has 1 to
--    80 characters and is not the shape of an email address (no "@"). The rule is a trigger on update, not a table
--    check: sign-up (app_private.handle_new_user, an insert) is untouched and may still give an empty name or a
--    provider's long one, which the screens show as "Unnamed member"; and the database owner and the service role,
--    which empty a name when an account goes, are not held to it.
--
-- To undo: drop the trigger and its function, revoke update (display_name) and grant update on public.profiles to
-- authenticated again.

revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

create function app_private.check_display_name() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  new.display_name := btrim(coalesce(new.display_name, ''));
  if char_length(new.display_name) < 1 or char_length(new.display_name) > 80 or position('@' in new.display_name) > 0 then
    raise exception 'NAME_INVALID: a name has 1 to 80 characters and is not an email address' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app_private.check_display_name() from public, anon, authenticated;

create trigger profiles_check_display_name before update of display_name on public.profiles
  for each row execute function app_private.check_display_name();
