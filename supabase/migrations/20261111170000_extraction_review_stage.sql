-- WP1.5: a review stage between merging and assembling.
--   running   -> (all pass parts)   -> merging    : start both merges
--   merging   -> (both merge parts) -> reviewing  : start the review
--   reviewing -> (review part)      -> assembling : assemble

alter table public.extraction_runs drop constraint extraction_runs_status_check;
alter table public.extraction_runs add constraint extraction_runs_status_check
  check (status in ('queued', 'running', 'merging', 'reviewing', 'assembling', 'done', 'failed'));

alter table public.extraction_run_parts drop constraint extraction_run_parts_part_check;
alter table public.extraction_run_parts add constraint extraction_run_parts_part_check
  check (part ~ '^(pass|merge|review):[A-Za-z0-9._:-]{1,80}$');

create or replace function public.extraction_put_part(target_run uuid, part_name text, part_output jsonb, used_input bigint, used_output bigint)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.extraction_runs;
  n int;
begin
  select * into r from public.extraction_runs where id = target_run for update;
  if not found then raise exception 'NOT_FOUND: run' using errcode = 'PT404'; end if;
  if r.status in ('done', 'failed') then return null; end if;

  insert into public.extraction_run_parts (run_id, part, output) values (target_run, part_name, part_output)
  on conflict do nothing;
  if not found then return null; end if;
  update public.extraction_runs
     set input_tokens = input_tokens + greatest(used_input, 0), output_tokens = output_tokens + greatest(used_output, 0)
   where id = target_run;

  if r.status = 'running' then
    select count(*) into n from public.extraction_run_parts where run_id = target_run and part like 'pass:%';
    if n >= 2 * coalesce(array_length(r.source_ids, 1), 0) then
      update public.extraction_runs set status = 'merging' where id = target_run;
      return 'merge';
    end if;
  elsif r.status = 'merging' then
    select count(*) into n from public.extraction_run_parts where run_id = target_run and part like 'merge:%';
    if n >= 2 then
      update public.extraction_runs set status = 'reviewing' where id = target_run;
      return 'review';
    end if;
  elsif r.status = 'reviewing' then
    if part_name like 'review:%' then
      update public.extraction_runs set status = 'assembling' where id = target_run;
      return 'assemble';
    end if;
  end if;
  return null;
end $$;

revoke execute on function public.extraction_put_part(uuid, text, jsonb, bigint, bigint) from public, anon, authenticated;
grant execute on function public.extraction_put_part(uuid, text, jsonb, bigint, bigint) to service_role;
