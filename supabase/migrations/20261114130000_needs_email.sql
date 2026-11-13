-- Weekday "Needs you" emails (domain/work/digest.ts, edge function journey-notify).
--
-- public.notification_settings: one row per person: whether they get the email, and the token in their
--   "Stop these emails" link. A person reads their own row and changes it only through set_needs_email.
-- app_private.needs_digest_state: per person and workspace, what they were told at the last run, so an
--   email goes only when something new needs them. Server only.
-- The server functions (service role only):
--   needs_digest_input()        everything the run needs, in one read: people with their email and roles,
--                               each process's state, and what was seen last time;
--   needs_digest_record(jsonb)  what each person has now, after the run;
--   needs_digest_secret_ok(text) whether a call carries the scheduled job's secret;
--   unsubscribe_needs_email(uuid) turns the email off for the person whose link it is.
-- A schedule (pg_cron) calls journey-notify at 03:30 UTC (09:00 in India) Monday to Friday, with a secret
-- kept in the Vault. The function's address is kept in the Vault too, as needs_digest_url, added once when
-- this is applied (it is the project's own address, so it is not written into the repository):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/journey-notify', 'needs_digest_url');
-- Until it is there the job calls nothing; until RESEND_API_KEY is set, journey-notify sends and records nothing.

create table public.notification_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  needs_email boolean not null default true,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
create policy notification_settings_own on public.notification_settings for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.notification_settings from anon;
revoke insert, update, delete, truncate on public.notification_settings from authenticated;

create function public.set_needs_email(email_on boolean) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in again.' using errcode = '42501'; end if;
  insert into public.notification_settings (user_id, needs_email) values ((select auth.uid()), coalesce(email_on, true))
  on conflict (user_id) do update set needs_email = excluded.needs_email, updated_at = now();
  return coalesce(email_on, true);
end $$;
revoke all on function public.set_needs_email(boolean) from public, anon;
grant execute on function public.set_needs_email(boolean) to authenticated;

create table app_private.needs_digest_state (
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  seen_keys text[] not null default '{}',
  last_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);
alter table app_private.needs_digest_state enable row level security;
revoke all on app_private.needs_digest_state from public, anon, authenticated;

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'needs_digest_secret', 'Avala OS: the scheduled needs digest presents this to journey-notify');

create function public.needs_digest_secret_ok(candidate text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(length(candidate) = 64 and exists (
    select 1 from vault.decrypted_secrets where name = 'needs_digest_secret' and decrypted_secret = candidate), false);
$$;

create function public.needs_digest_input() returns jsonb
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
      from app_private.needs_digest_state d), '[]'::jsonb)
  );
end $$;

create function public.needs_digest_record(entries jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  insert into app_private.needs_digest_state (user_id, workspace_id, seen_keys, last_sent_at, updated_at)
  select (e ->> 'userId')::uuid, (e ->> 'workspaceId')::uuid,
    coalesce(array(select jsonb_array_elements_text(e -> 'keys')), '{}'),
    case when (e ->> 'sent')::boolean then now() end, now()
  from jsonb_array_elements(coalesce(entries, '[]'::jsonb)) e
  where exists (select 1 from public.workspace_members m where m.user_id = (e ->> 'userId')::uuid and m.workspace_id = (e ->> 'workspaceId')::uuid)
  on conflict (user_id, workspace_id) do update set
    seen_keys = excluded.seen_keys,
    last_sent_at = coalesce(excluded.last_sent_at, app_private.needs_digest_state.last_sent_at),
    updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

create function public.unsubscribe_needs_email(token uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.notification_settings set needs_email = false, updated_at = now() where unsubscribe_token = token;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.needs_digest_secret_ok(text) from public, anon, authenticated;
revoke all on function public.needs_digest_input() from public, anon, authenticated;
revoke all on function public.needs_digest_record(jsonb) from public, anon, authenticated;
revoke all on function public.unsubscribe_needs_email(uuid) from public, anon, authenticated;
grant execute on function public.needs_digest_secret_ok(text) to service_role;
grant execute on function public.needs_digest_input() to service_role;
grant execute on function public.needs_digest_record(jsonb) to service_role;
grant execute on function public.unsubscribe_needs_email(uuid) to service_role;

-- The schedule: weekdays at 03:30 UTC (09:00 in India).
create extension if not exists pg_cron;
select cron.schedule('avala-needs-digest', '30 3 * * 1-5', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'needs_digest_url'),
    body := '{"action":"digest"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-digest-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'needs_digest_secret')),
    timeout_milliseconds := 120000);
$job$);
