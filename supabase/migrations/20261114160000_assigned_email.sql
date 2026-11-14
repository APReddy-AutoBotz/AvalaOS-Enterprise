-- "Assigned to you" in the weekday email (domain/work/digest.ts): needs_digest_input() also returns the
-- open board items whose current owner was set by someone else, read from the item history
-- (board_collaboration). The email lists those that are new since the last one; the same seen-keys
-- record keeps them from repeating. Only the function changes; its rights stay as they were.

create or replace function public.needs_digest_input() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  -- Everyone who belongs to a workspace gets settings (on by default, with their own token).
  insert into public.notification_settings (user_id)
  select distinct m.user_id from public.workspace_members m
  on conflict (user_id) do nothing;

  return jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspaceId', w.id, 'workspace', w.name, 'organization', coalesce(o.name, ''),
        'userId', m.user_id, 'email', coalesce(u.email, ''), 'name', coalesce(pr.display_name, ''),
        'access', m.role, 'job', m.job, 'canApprove', m.can_approve,
        'emailOn', s.needs_email, 'token', s.unsubscribe_token))
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      left join public.organizations o on o.id = w.organization_id
      join auth.users u on u.id = m.user_id
      left join public.profiles pr on pr.id = m.user_id
      join public.notification_settings s on s.user_id = m.user_id), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspaceId', p.workspace_id, 'id', p.id, 'name', p.name,
        'analystId', p.analyst_id, 'architectId', p.architect_id, 'approverId', p.approver_id,
        'status', case
          when ap.id is not null and wk.id is not null and wk.edit_seq > 0 then 'changed'
          when ap.id is not null then 'approved'
          when wk.id is not null or exists (select 1 from public.process_model_revisions r where r.process_id = p.id) then 'draft'
          else 'none' end,
        'openQuestions', coalesce(jsonb_array_length(jsonb_path_query_array(coalesce(wk.model, ap.model), '$.openQuestions[*] ? (@.status == "open")')), 0),
        'proposalsWaiting', (select count(*) from public.work_item_proposals x
          where x.process_id = p.id and x.derivation_key is not null and x.state in ('proposed', 'selected', 'edited'))))
      from public.processes p
      left join lateral (select r.id, r.model, r.edit_seq from public.process_model_revisions r
        where r.process_id = p.id and r.state = 'working' order by r.rev_no desc limit 1) wk on true
      left join lateral (select r.id, r.model from public.process_model_revisions r
        where r.process_id = p.id and r.state = 'approved' order by r.rev_no desc limit 1) ap on true
      where p.archived_at is null), '[]'::jsonb),
    'seen', coalesce((
      select jsonb_agg(jsonb_build_object('userId', d.user_id, 'workspaceId', d.workspace_id, 'keys', to_jsonb(d.seen_keys)))
      from app_private.needs_digest_state d), '[]'::jsonb),
    -- Open board items whose current owner was set by someone else: the latest of the item's creation
    -- and the change that gave it this owner, from the history. Self-assigned work is not emailed.
    'assigned', coalesce((
      select jsonb_agg(jsonb_build_object(
        'workspaceId', i.workspace_id, 'ownerId', i.owner_id, 'id', i.id, 'title', i.title, 'type', i.item_type,
        'projectId', i.project_id, 'project', pj.name, 'assignedBy', coalesce(pr.display_name, ''), 'assignedAt', e.created_at))
      from public.delivery_work_items i
      join public.delivery_projects pj on pj.id = i.project_id and pj.archived_at is null
      join lateral (select ev.actor_id, ev.created_at from public.delivery_work_item_events ev
        where ev.work_item_id = i.id and (ev.kind = 'created' or (ev.field = 'owner' and ev.new_value = i.owner_id::text))
        order by ev.id desc limit 1) e on true
      left join public.profiles pr on pr.id = e.actor_id
      where i.owner_id is not null and i.status <> 'done' and e.actor_id is not null and e.actor_id <> i.owner_id), '[]'::jsonb)
  );
end $$;
