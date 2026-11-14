-- Start with the part you need (docs/product-plan.md, "Packaging"; domain/workspace/modules.ts): each
-- organisation uses one of four set-ups, the full journey (the default, what every organisation has
-- today), Assess and Documents, Assess, or the Delivery board on its own. A part that is off is not shown;
-- nothing in it is deleted. Only the platform owner changes it, through set_organization_modules; a guard
-- stops anyone else, the organisation's own creator included, from changing the column directly.

alter table public.organizations
  add column modules text[] not null default '{assess,documents,board}'
  constraint organizations_modules_plan check (modules in ('{assess,documents,board}'::text[], '{assess,documents}'::text[], '{assess}'::text[], '{board}'::text[]));

create function app_private.guard_organization_modules() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.modules is distinct from old.modules and (select auth.uid()) is not null
     and not app_private.may_create_organization((select auth.uid())) then
    raise exception 'Only the Avala OS team can switch parts on or off for an organisation' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_organization_modules() from public, anon, authenticated;
create trigger organizations_modules_guard before update of modules on public.organizations
  for each row execute function app_private.guard_organization_modules();

-- The platform owner sets an organisation's parts (in the fixed order); the result must be one of the four set-ups.
create function public.set_organization_modules(target_organization uuid, org_modules text[]) returns text[]
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  chosen text[];
begin
  if not app_private.may_create_organization(caller) then
    raise exception 'Only the Avala OS team can switch parts on or off for an organisation' using errcode = '42501';
  end if;
  if not app_private.is_organization_member(target_organization) then
    raise exception 'Organisation not found' using errcode = 'P0002';
  end if;
  if org_modules is null or exists (select 1 from unnest(org_modules) x where x is null or x not in ('assess', 'documents', 'board')) then
    raise exception 'Unknown part of Avala OS' using errcode = '22023';
  end if;
  chosen := array(select x from unnest(array['assess', 'documents', 'board']) with ordinality as t(x, n) where x = any (org_modules) order by n);
  update public.organizations set modules = chosen where id = target_organization;
  return chosen;
end $$;
revoke all on function public.set_organization_modules(uuid, text[]) from public, anon;
grant execute on function public.set_organization_modules(uuid, text[]) to authenticated;
