-- Package 13 part C: the walls between workspaces (findings F01 and F02 of the outside review).
--
-- 1. Every link between two rows that each belong to a workspace now carries the workspace, so both
--    rows must be in the same one. Eight links named only the other row's id; each gets a second
--    foreign key on (that id, workspace_id) against the other table's existing unique (id, workspace_id).
--    A foreign key holds whichever side changes: the row that links, or the row it links to (whose
--    workspace can then no longer change while the link stands). The single-column keys stay as they
--    are, so nothing that deletes or nulls a link behaves differently: each new key takes the same
--    action on delete, on the link's column only. Added "not valid", then validated: no existing row
--    crosses a workspace (checked on the live database on 18 November 2026).
-- 2. A reading run that names a process names its workspace too, so the link above is always checked.
-- 3. A workspace cannot be moved to another organisation from the site. A change made directly in the
--    database (the SQL editor, the service role) is still possible, for the platform owner.
--
-- Additive: new constraints and one trigger. The released site and server functions write only
-- links within one workspace, so they keep working unchanged.

-- 1. The eight links.
alter table public.delivery_work_items
  add constraint delivery_work_items_parent_same_ws foreign key (parent_id, workspace_id)
    references public.delivery_work_items (id, workspace_id) on delete set null (parent_id) not valid,
  add constraint delivery_work_items_process_same_ws foreign key (process_id, workspace_id)
    references public.processes (id, workspace_id) on delete set null (process_id) not valid,
  add constraint delivery_work_items_origin_same_ws foreign key (origin_proposal_id, workspace_id)
    references public.work_item_proposals (id, workspace_id) on delete set null (origin_proposal_id) not valid;

alter table public.work_item_proposals
  add constraint work_item_proposals_parent_same_ws foreign key (parent_id, workspace_id)
    references public.work_item_proposals (id, workspace_id) on delete cascade not valid,
  add constraint work_item_proposals_confirmed_same_ws foreign key (confirmed_work_item_id, workspace_id)
    references public.delivery_work_items (id, workspace_id) on delete set null (confirmed_work_item_id) not valid;

alter table public.document_revisions
  add constraint document_revisions_model_same_ws foreign key (model_revision_id, workspace_id)
    references public.process_model_revisions (id, workspace_id) not valid;

alter table public.process_model_revisions
  add constraint process_model_revisions_based_on_same_ws foreign key (based_on, workspace_id)
    references public.process_model_revisions (id, workspace_id) not valid;

alter table public.extraction_runs
  add constraint extraction_runs_process_same_ws foreign key (process_id, workspace_id)
    references public.processes (id, workspace_id) on delete cascade not valid,
-- 2. A run that names a process names its workspace (so the key above is never skipped).
  add constraint extraction_runs_process_has_ws check (process_id is null or workspace_id is not null) not valid;

alter table public.delivery_work_items validate constraint delivery_work_items_parent_same_ws;
alter table public.delivery_work_items validate constraint delivery_work_items_process_same_ws;
alter table public.delivery_work_items validate constraint delivery_work_items_origin_same_ws;
alter table public.work_item_proposals validate constraint work_item_proposals_parent_same_ws;
alter table public.work_item_proposals validate constraint work_item_proposals_confirmed_same_ws;
alter table public.document_revisions validate constraint document_revisions_model_same_ws;
alter table public.process_model_revisions validate constraint process_model_revisions_based_on_same_ws;
alter table public.extraction_runs validate constraint extraction_runs_process_same_ws;
alter table public.extraction_runs validate constraint extraction_runs_process_has_ws;

-- 3. A workspace stays in its organisation.
create function app_private.workspace_keeps_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- A signed-in caller (the site) is refused; the SQL editor and the service role have no user.
  if new.organization_id is distinct from old.organization_id and (select auth.uid()) is not null then
    raise exception 'A workspace cannot be moved to another organisation' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function app_private.workspace_keeps_organization() from public, anon, authenticated;
create trigger workspaces_keep_organization before update of organization_id on public.workspaces
  for each row execute function app_private.workspace_keeps_organization();
