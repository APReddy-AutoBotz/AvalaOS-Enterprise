-- model_approve approves nothing from now on (plan: claude/model-approve-refusal-plan-26-nov.md).
--
-- Since the eleventh release (24 November 2026) the site approves through approve_version, which keeps a copy
-- of the documents. Only a page opened before that release still has the old Approve button, which calls
-- model_approve and would approve without keeping a copy. Such a page now shows this sentence and nothing
-- changes; after a reload it has the new button.
--
-- The name, the arguments and the grants stay, so the old page gets the sentence rather than "function not
-- found". The refusal is the same for everyone and every revision: it looks nothing up and tells an outsider
-- nothing, so it runs with the caller's own rights. app_private.approve_revision, the shared body that
-- approve_version uses, is unchanged.
--
-- To undo: put back the body `return app_private.approve_revision(target_revision, expected_seq);` as
-- security definer (migration approved_versions).

create or replace function public.model_approve(target_revision uuid, expected_seq bigint) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'RELOAD_TO_APPROVE: This page is out of date. Reload the page, then approve.' using errcode = 'PT409';
end $$;

comment on function public.model_approve(uuid, bigint) is
  'Refuses: the page is out of date. Approving is approve_version since the eleventh release (24 November 2026).';

-- The grants as they are today (create or replace keeps them; restated so the file says who may call it).
revoke all on function public.model_approve(uuid, bigint) from public, anon;
grant execute on function public.model_approve(uuid, bigint) to authenticated, service_role;
