-- Part F of docs/effort-first-plan.md (agreed by the owner on 15 November 2026; applied only on the
-- owner's yes after a rolled-back trial). Three changes; the released site uses none of them, so it
-- keeps working until the next release.
--
-- 1. Review comments on document sections: reviewers comment where they read. Every member comments,
--    viewers too (reviewers and approvers are often viewers); only the author edits the text; the
--    author or an editor marks it resolved (and may reopen it); the author or an admin deletes it.
-- 2. Testers' edits to the test pack: one row per case (the derived case's number, or "added:<id>" for
--    a case a tester adds); a tester may change its fields or set it aside. base_hash is the derived
--    case the edit was made against, so a changed requirement shows "needs review". Editors write,
--    members read.
-- 3. The agent document may have section edits like the other four (document type 'agent').

-- ---------------------------------------------------------------------------
-- 1. Review comments
-- ---------------------------------------------------------------------------
create table public.document_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  doc_type text not null check (doc_type in ('brd', 'pdd', 'frd', 'sdd', 'agent', 'tests')),
  section_key text not null check (length(section_key) between 1 and 80),
  -- The section's title when the comment was written, so a comment whose section is gone can still be read.
  section_title text not null check (length(section_title) between 1 and 300),
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null,
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade
);
create index document_comments_process_idx on public.document_comments (process_id, doc_type, created_at);
create index document_comments_workspace_id_idx on public.document_comments (workspace_id);
create index document_comments_author_id_idx on public.document_comments (author_id);
create index document_comments_resolved_by_idx on public.document_comments (resolved_by);

-- Only the text (by its author) and the resolved state change; who resolved it is the person doing it.
create function app_private.document_comment_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.workspace_id := old.workspace_id;
  new.process_id := old.process_id;
  new.doc_type := old.doc_type;
  new.section_key := old.section_key;
  new.section_title := old.section_title;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  if new.body is distinct from old.body then
    if old.author_id is distinct from (select auth.uid()) then raise exception 'Only the author changes a comment''s text.' using errcode = '42501'; end if;
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  if (new.resolved_at is null) is distinct from (old.resolved_at is null) then
    if old.author_id is distinct from (select auth.uid()) and not app_private.can_edit_workspace(old.workspace_id) then
      raise exception 'Only the author or an editor resolves a comment.' using errcode = '42501';
    end if;
    if new.resolved_at is null then new.resolved_by := null; else new.resolved_at := now(); new.resolved_by := (select auth.uid()); end if;
  else
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;
  return new;
end $$;
create trigger document_comments_rules before update on public.document_comments
  for each row execute function app_private.document_comment_rules();

alter table public.document_comments enable row level security;
create policy document_comments_select on public.document_comments for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy document_comments_insert on public.document_comments for insert to authenticated
  with check (app_private.is_workspace_member(workspace_id) and author_id = (select auth.uid()) and resolved_at is null and resolved_by is null);
create policy document_comments_update on public.document_comments for update to authenticated
  using (app_private.is_workspace_member(workspace_id) and (author_id = (select auth.uid()) or app_private.can_edit_workspace(workspace_id)))
  with check (app_private.is_workspace_member(workspace_id));
create policy document_comments_delete on public.document_comments for delete to authenticated
  using ((author_id = (select auth.uid()) and app_private.is_workspace_member(workspace_id)) or app_private.is_workspace_admin(workspace_id));

revoke all on public.document_comments from anon;
revoke truncate on public.document_comments from authenticated;

-- ---------------------------------------------------------------------------
-- 2. Testers' edits to the test pack
-- ---------------------------------------------------------------------------
create table public.test_case_edits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  -- A derived case's number ("FR-003.1"), or "added:<id>" for a case a tester adds.
  case_code text not null check (case_code ~ '^(FR-[0-9]{3,}\.[0-9]+|added:[0-9a-f-]{36})$'),
  -- The fields a tester set: title, prepare, do, check, data, expected, requirement (an added case).
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 20000),
  -- A tester set the case aside (not run); it is kept, so the next derivation does not bring it back.
  set_aside boolean not null default false,
  base_hash text check (base_hash is null or length(base_hash) between 1 and 64),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, case_code)
);
create index test_case_edits_workspace_id_idx on public.test_case_edits (workspace_id);
create index test_case_edits_updated_by_idx on public.test_case_edits (updated_by);

alter table public.test_case_edits enable row level security;
create policy test_case_edits_select on public.test_case_edits for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy test_case_edits_insert on public.test_case_edits for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy test_case_edits_update on public.test_case_edits for update to authenticated
  using (app_private.can_edit_workspace(workspace_id))
  with check (app_private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy test_case_edits_delete on public.test_case_edits for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

revoke all on public.test_case_edits from anon;
revoke truncate on public.test_case_edits from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Section edits on the agent document
-- ---------------------------------------------------------------------------
alter table public.document_edits drop constraint document_edits_doc_type_check;
alter table public.document_edits add constraint document_edits_doc_type_check check (doc_type in ('brd', 'pdd', 'frd', 'sdd', 'agent'));
