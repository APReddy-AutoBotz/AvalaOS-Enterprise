-- Walkthrough requests from the homepage (docs/next-plan.md, section 3d, package 11). Additive only: one new
-- table, five new functions and one daily schedule; nothing the released site or the released server functions
-- use changes.
--
-- Nobody reaches the table through the public API (row security on, no policies, no grants). Only the server
-- function journey-inquiry adds a request, through submit_walkthrough_request (service role only), which also
-- holds the limits: per email address and in total, per hour and over any 24 hours, and how many notice
-- emails go out in any 24 hours. Only a platform owner (app_private.platform_owners, never "anyone while the
-- list is empty") lists requests, sets their status, notes a reply and deletes one. No IP address is kept.
-- A request is deleted twelve months after the last contact: when it came, or when the owner last set its
-- status or pressed "Reply by email" (a daily job of the existing scheduler).

create table public.walkthrough_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100 and name !~ '[[:cntrl:]]'),
  email text not null check (length(email) between 3 and 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
  company text not null check (length(company) between 1 and 150 and company !~ '[[:cntrl:]]'),
  process text check (process is null or length(process) between 1 and 500),
  people text check (people is null or people in ('1-5', '6-20', '21-100', '100+')),
  status text not null default 'new' check (status in ('new', 'answered', 'closed')),
  -- The notice email this request was counted for: one each up to the day's cap, then one "more" email.
  notice text check (notice is null or notice in ('each', 'more')),
  created_at timestamptz not null default now(),
  last_contact_at timestamptz not null default now()
);

create index walkthrough_requests_created_idx on public.walkthrough_requests (created_at desc);
create index walkthrough_requests_email_idx on public.walkthrough_requests (email, created_at);
create index walkthrough_requests_contact_idx on public.walkthrough_requests (last_contact_at);

alter table public.walkthrough_requests enable row level security;
revoke all on public.walkthrough_requests from public, anon, authenticated;

create function app_private.is_platform_owner(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists (select 1 from app_private.platform_owners o where o.user_id = uid);
$$;
revoke all on function app_private.is_platform_owner(uuid) from public, anon, authenticated;

-- Adds one request, or refuses it beyond the limits. The values have already been checked and tidied by the
-- server function (domain/site/inquiry.ts); the table's own checks hold them again. Requests are taken one at
-- a time, so two arriving together cannot both slip under a limit.
create function public.submit_walkthrough_request(
  p_name text, p_email text, p_company text, p_process text, p_people text,
  per_email_hour int default 3, per_hour int default 20, per_day int default 50, notices_per_day int default 10
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  addr text := lower(trim(p_email));
  new_id uuid;
  kind text;
begin
  perform pg_advisory_xact_lock(hashtext('public.walkthrough_requests'));
  if (select count(*) from public.walkthrough_requests where email = addr and created_at > now() - interval '1 hour') >= per_email_hour
     or (select count(*) from public.walkthrough_requests where created_at > now() - interval '1 hour') >= per_hour
     or (select count(*) from public.walkthrough_requests where created_at > now() - interval '24 hours') >= per_day then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  if (select count(*) from public.walkthrough_requests where notice = 'each' and created_at > now() - interval '24 hours') < notices_per_day then
    kind := 'each';
  elsif not exists (select 1 from public.walkthrough_requests where notice = 'more' and created_at > now() - interval '24 hours') then
    kind := 'more';
  end if;
  insert into public.walkthrough_requests (name, email, company, process, people, notice)
  values (trim(p_name), addr, trim(p_company), nullif(trim(p_process), ''), nullif(p_people, ''), kind)
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id, 'notice', kind);
end $$;

revoke all on function public.submit_walkthrough_request(text, text, text, text, text, int, int, int, int) from public, anon, authenticated;
grant execute on function public.submit_walkthrough_request(text, text, text, text, text, int, int, int, int) to service_role;

-- The requests, newest first, for a platform owner only.
create function public.list_walkthrough_requests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_platform_owner((select auth.uid())) then
    raise exception 'Only the Avala OS owner can read walkthrough requests' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'email', r.email, 'company', r.company, 'process', r.process, 'people', r.people,
      'status', r.status, 'createdAt', r.created_at, 'lastContactAt', r.last_contact_at) order by r.created_at desc)
    from public.walkthrough_requests r), '[]'::jsonb);
end $$;

-- Setting a status counts as contact, and so does "Reply by email" (note_walkthrough_reply).
create function public.set_walkthrough_request_status(target uuid, new_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_platform_owner((select auth.uid())) then
    raise exception 'Only the Avala OS owner can change walkthrough requests' using errcode = '42501';
  end if;
  if new_status not in ('new', 'answered', 'closed') then
    raise exception 'Status is new, answered or closed' using errcode = '22023';
  end if;
  update public.walkthrough_requests set status = new_status, last_contact_at = now() where id = target;
  if not found then raise exception 'No such request' using errcode = 'P0002'; end if;
end $$;

create function public.note_walkthrough_reply(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_platform_owner((select auth.uid())) then
    raise exception 'Only the Avala OS owner can change walkthrough requests' using errcode = '42501';
  end if;
  update public.walkthrough_requests set last_contact_at = now() where id = target;
  if not found then raise exception 'No such request' using errcode = 'P0002'; end if;
end $$;

-- Removal on request.
create function public.delete_walkthrough_request(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app_private.is_platform_owner((select auth.uid())) then
    raise exception 'Only the Avala OS owner can delete walkthrough requests' using errcode = '42501';
  end if;
  delete from public.walkthrough_requests where id = target;
end $$;

revoke all on function public.list_walkthrough_requests() from public, anon;
revoke all on function public.set_walkthrough_request_status(uuid, text) from public, anon;
revoke all on function public.note_walkthrough_reply(uuid) from public, anon;
revoke all on function public.delete_walkthrough_request(uuid) from public, anon;
grant execute on function public.list_walkthrough_requests() to authenticated;
grant execute on function public.set_walkthrough_request_status(uuid, text) to authenticated;
grant execute on function public.note_walkthrough_reply(uuid) to authenticated;
grant execute on function public.delete_walkthrough_request(uuid) to authenticated;

-- Twelve months after the last contact a request is deleted (a working default the owner may change).
create function app_private.delete_old_walkthrough_requests() returns int
language sql security definer set search_path = '' as $$
  with gone as (delete from public.walkthrough_requests where last_contact_at < now() - interval '12 months' returning 1)
  select count(*)::int from gone;
$$;
revoke all on function app_private.delete_old_walkthrough_requests() from public, anon, authenticated;

-- Daily at 02:41 UTC (08:11 in India), on the scheduler the weekday email already uses.
select cron.schedule('avala-walkthrough-requests-retention', '41 2 * * *', $job$ select app_private.delete_old_walkthrough_requests(); $job$);
