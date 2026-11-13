-- Confirming selected work proposals to a Delivery board project (WP4.3). One call creates one board
-- item per selected proposal, keeps the epic > story > task links, records which requirements and
-- steps each delivers, and marks the proposals confirmed. A proposal already on the board is skipped,
-- so a double submit or a replay creates nothing twice (the unique origin_proposal_id backs this up).

create function public.confirm_proposals(target_process uuid, target_project uuid, proposal_keys text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  proc public.processes;
  proj public.delivery_projects;
  p public.work_item_proposals;
  parent uuid;
  item uuid;
  created int := 0;
  skipped int := 0;
  pending text[] := proposal_keys;
  progress boolean;
begin
  if proposal_keys is null or cardinality(proposal_keys) = 0 then
    raise exception 'NOTHING_SELECTED' using errcode = 'PT422';
  end if;
  if cardinality(proposal_keys) > 500 then
    raise exception 'TOO_MANY: confirm at most 500 items at once' using errcode = 'PT422';
  end if;
  select * into proc from public.processes where id = target_process;
  if not found or not app_private.is_workspace_member(proc.workspace_id) then
    raise exception 'NOT_FOUND: process' using errcode = 'PT404';
  end if;
  if not app_private.can_edit_workspace(proc.workspace_id) then
    raise exception 'FORBIDDEN: confirming needs the editor or admin role' using errcode = 'PT403';
  end if;
  select * into proj from public.delivery_projects where id = target_project and workspace_id = proc.workspace_id and archived_at is null;
  if not found then
    raise exception 'NOT_FOUND: project' using errcode = 'PT404';
  end if;

  -- Parents before children: repeat until no proposal in the list can be placed.
  loop
    progress := false;
    for p in
      select * from public.work_item_proposals
       where process_id = target_process and derivation_key = any(pending)
       order by sort_order
       for update
    loop
      if p.state = 'confirmed' then
        skipped := skipped + 1;
        pending := array_remove(pending, p.derivation_key);
        progress := true;
        continue;
      end if;
      if p.state <> 'selected' then
        raise exception 'NOT_SELECTED: %', p.title using errcode = 'PT409';
      end if;
      -- Wait for a parent that is in this call and not placed yet.
      if p.parent_key is not null and p.parent_key = any(pending) then continue; end if;
      select confirmed_work_item_id into parent from public.work_item_proposals
       where process_id = target_process and derivation_key = p.parent_key and state = 'confirmed';
      insert into public.delivery_work_items
        (workspace_id, project_id, parent_id, item_type, title, description, acceptance_criteria, status, process_id, origin_proposal_id, step_ids, sort_order, details)
      values
        (proc.workspace_id, target_project, parent, p.item_type, p.title, p.description, p.acceptance_criteria, 'todo', target_process, p.id, p.step_ids, p.sort_order,
         jsonb_build_object('requirements', to_jsonb(p.requirement_codes), 'proposalKey', p.derivation_key,
           -- The wording of each linked requirement now, so a later change shows as "Upstream changed".
           'snapshot', coalesce((select jsonb_object_agg(q.code, q.statement) from public.requirements q
                                  where q.process_id = target_process and q.code = any(p.requirement_codes)), '{}'::jsonb)))
      on conflict (origin_proposal_id) where origin_proposal_id is not null do nothing
      returning id into item;
      if item is null then
        select id into item from public.delivery_work_items where origin_proposal_id = p.id;
        skipped := skipped + 1;
      else
        created := created + 1;
      end if;
      update public.work_item_proposals set state = 'confirmed', confirmed_work_item_id = item where id = p.id;
      pending := array_remove(pending, p.derivation_key);
      progress := true;
    end loop;
    exit when cardinality(pending) = 0 or not progress;
  end loop;
  if cardinality(pending) > 0 then
    raise exception 'NOT_FOUND: % of the selected items are unknown', cardinality(pending) using errcode = 'PT404';
  end if;
  return jsonb_build_object('created', created, 'skipped', skipped);
end;
$$;

revoke all on function public.confirm_proposals(uuid, uuid, text[]) from public, anon;
grant execute on function public.confirm_proposals(uuid, uuid, text[]) to authenticated;
