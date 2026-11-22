-- Package 14 of docs/next-plan.md: an approved document is final. Plan: claude/package-14-plan-21-nov.md
-- (approved by the owner on 21 November 2026 with seven changes, a to g). Additive: no existing table,
-- column, policy or rule changes. model_approve keeps its signature, its checks, its messages and what it
-- returns; its body moves, unchanged, into app_private.approve_revision, which approve_version calls too,
-- so the two ways of approving share one set of checks and cannot drift (change a).
--
-- Three new tables:
--   approved_versions  one row per kept version of a process's documents, never changed or deleted;
--   document_looks     each distinct look a Word file was kept with, once per workspace, by its fingerprint (change c);
--   draft_changes      who changed what kind of thing in the draft and when, written only by triggers, no values.
-- Three new functions for signed-in people: approve_version, keep_version_as_reads_now, version_states.
--
-- The released site (main) never calls the new functions and reads none of the new tables. Its writes to
-- the watched tables go on exactly as before: each trigger below records after the save, inside its own
-- exception block, so a failure in the record never refuses the save (change e).
--
-- A kept version names its approver as the database read the name at approval (approved_by_name, and
-- kept_by_name for a copy kept later): a person who leaves the workspace can no longer be read in profiles.
--
-- An approval is refused when anyone saved a change after the approver's page read the documents: the page
-- passes how many rows of the change record it could see (version_states.changes_seen), and the approval
-- counts again once every save already writing has finished (advisory locks below). Counting, not the newest
-- id, because an id is handed out when a save writes, not when it commits.
--
-- Closing the old door later (change a): until the release, and afterwards in a tab opened before it,
-- model_approve still approves the record without a kept copy. Such an approval shows as "Approved revision R
-- (before copies were kept)" and can be kept with keep_version_as_reads_now. A later migration, asked for
-- separately and not part of this one, replaces model_approve with a refusal ("reload the page to approve")
-- once the release has been live for a day.

-- ---- Approving: one shared body ---------------------------------------------------------------------

-- Who may approve in a workspace; the message names what was looked for. Used by every way of approving.
create function app_private.require_approver(target_workspace uuid, what text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_workspace_member(target_workspace) then
    raise exception 'NOT_FOUND: %', what using errcode = 'PT404';
  end if;
  if not app_private.can_approve_workspace(target_workspace) then
    raise exception 'FORBIDDEN: approving needs approval rights' using errcode = 'PT403';
  end if;
end $$;

-- model_approve's body, as it was (20261111140000_model_persistence.sql), with its two first checks read
-- through require_approver: the same order, the same messages, the same codes.
create function app_private.approve_revision(target_revision uuid, expected_seq bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rev public.process_model_revisions;
begin
  select * into rev from public.process_model_revisions where id = target_revision for update;
  if not found then
    raise exception 'NOT_FOUND: revision' using errcode = 'PT404';
  end if;
  perform app_private.require_approver(rev.workspace_id, 'revision');
  if rev.state <> 'working' then
    raise exception 'NOT_EDITABLE: only the working draft can be approved' using errcode = 'PT409';
  end if;
  if rev.edit_seq <> expected_seq then
    raise exception 'EDIT_CONFLICT: the draft is at edit %, not %', rev.edit_seq, expected_seq using errcode = 'PT409';
  end if;
  if not app_private.model_shape_ok(rev.model) then
    raise exception 'MODEL_INVALID: the draft is not a Process Model' using errcode = 'PT422';
  end if;

  perform 1 from public.processes where id = rev.process_id for update;
  update public.process_model_revisions set state = 'superseded'
   where process_id = rev.process_id and state = 'approved';
  update public.process_model_revisions
     set state = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = rev.id;

  return jsonb_build_object('revisionId', rev.id, 'revNo', rev.rev_no, 'seq', rev.edit_seq, 'modelHash', rev.model_hash);
end $$;

-- The released site's way of approving: unchanged from the outside, now through the shared body.
create or replace function public.model_approve(target_revision uuid, expected_seq bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return app_private.approve_revision(target_revision, expected_seq);
end $$;

-- ---- The look, once per workspace (change c) ---------------------------------------------------------

-- An object holding no key but those allowed (for the checks below).
create function app_private.only_keys(obj jsonb, allowed text[]) returns boolean
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(obj) is distinct from 'object' then false
              else not exists (select 1 from jsonb_object_keys(obj) k where k <> all (allowed)) end
$$;

create table public.document_looks (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- SHA-256 of the look as the database writes it out (jsonb text), worked out by approve_version.
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  look jsonb not null check (
    app_private.only_keys(look, array['organisation', 'font', 'accent', 'logo', 'template'])
    and octet_length(look::text) <= 1500000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (workspace_id, fingerprint)
);

-- ---- Kept versions ----------------------------------------------------------------------------------

create table public.approved_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  -- Per process, from 1, never reused: unique, so two approvals can never share a number.
  number integer not null check (number >= 1),
  -- The process record's revision the documents were built from, and its hash at approval.
  model_revision_id uuid not null,
  model_hash text not null,
  -- The kept set: { format, documents: { brd, pdd, … }, testPack } (domain/docs/keep.ts).
  format integer not null check (format in (1)),
  documents jsonb not null check (
    jsonb_typeof(documents) = 'object' and (documents ->> 'format') = format::text
    and app_private.only_keys(documents -> 'documents', array['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests', 'evidence'])
    and octet_length(documents::text) <= 8000000),
  -- One fingerprint per section, so a page compares without fetching the documents (change d).
  fingerprints jsonb not null check (jsonb_typeof(fingerprints) = 'object' and octet_length(fingerprints::text) <= 262144),
  look_fingerprint text not null,
  -- What it was built from (fingerprints of the inputs) and the build of Avala OS that built it.
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object' and octet_length(inputs::text) <= 65536),
  -- Why there is a new version: none for version 1, required from version 2.
  reason text check (reason is null or char_length(reason) between 1 and 2000),
  -- What changed since the version before: { sections, documents, look } (domain/docs/versions.ts).
  changes jsonb not null default '{"sections": [], "documents": [], "look": []}'::jsonb check (jsonb_typeof(changes) = 'object' and octet_length(changes::text) <= 262144),
  -- Who approved the record and when (the database's own time and the caller, never the browser's word), with
  -- the name as it read then. No name: the person had none, or no profile is left ("Not recorded" on screen).
  approved_by uuid not null,
  approved_by_name text check (approved_by_name is null or char_length(approved_by_name) between 1 and 120),
  approved_at timestamptz not null,
  -- A copy kept after approval ("Keep it as it reads now"): who kept it, their name then, and when.
  kept_by uuid,
  kept_by_name text check (kept_by_name is null or char_length(kept_by_name) between 1 and 120),
  kept_at timestamptz,
  -- The newest row of the change record for this process or its workspace when the version was kept: a later
  -- row is a change since. Every save that was writing then had finished (the approval waits for it).
  change_mark bigint not null default 0,
  -- When the row was written (not when its transaction began).
  created_at timestamptz not null default clock_timestamp(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  foreign key (model_revision_id, workspace_id) references public.process_model_revisions (id, workspace_id) on delete cascade,
  foreign key (workspace_id, look_fingerprint) references public.document_looks (workspace_id, fingerprint),
  unique (process_id, number),
  check ((number = 1) = (reason is null)),
  check ((kept_by is null) = (kept_at is null))
);
create index approved_versions_revision on public.approved_versions (model_revision_id);
create index approved_versions_look on public.approved_versions (workspace_id, look_fingerprint);

-- ---- The draft's change record ------------------------------------------------------------------------

create table public.draft_changes (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  -- None for a change made for the whole workspace (assessment settings, document sections, look).
  process_id uuid,
  kind text not null check (kind in ('section_edit', 'choice', 'rate', 'costs', 'map_shape', 'requirement', 'test_edit', 'source', 'assessment_settings', 'layout', 'look')),
  change text not null check (change in ('added', 'changed', 'removed')),
  -- 'person': a person's own change; 'follows': saved because something else changed (requirements re-derived).
  origin text not null check (origin in ('person', 'follows')),
  -- Which items, by their names in the product (section, step, requirement code, case, source key), the first 50.
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  item_count integer not null default 1 check (item_count >= 1),
  actor uuid default auth.uid(),
  -- When the change was written (not when its transaction began).
  created_at timestamptz not null default clock_timestamp(),
  -- One row per save: rows of one transaction with the same kind are joined. The transaction's id starts again
  -- after a restore into a new database, so its start time is part of the key too: a later save can never be
  -- joined into an old row.
  txid bigint not null default txid_current(),
  started_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  constraint draft_changes_once unique nulls not distinct (txid, started_at, workspace_id, process_id, kind, change, origin)
);
create index draft_changes_process on public.draft_changes (process_id, id);
create index draft_changes_workspace on public.draft_changes (workspace_id, id) where process_id is null;

-- ---- Never changed, never deleted on their own ---------------------------------------------------------

create function app_private.guard_kept() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- Depth 1 is a direct change. A cascade from deleting the process or the workspace arrives at depth 2.
  if pg_trigger_depth() = 1 then
    raise exception '% cannot be %', case tg_table_name when 'approved_versions' then 'Approved versions' when 'document_looks' then 'Kept looks' else 'Recorded draft changes' end,
      case tg_op when 'DELETE' then 'deleted' else 'changed' end using errcode = '55000';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;

create trigger approved_versions_guard before update or delete on public.approved_versions
  for each row execute function app_private.guard_kept();
create trigger document_looks_guard before update or delete on public.document_looks
  for each row execute function app_private.guard_kept();
-- draft_changes: the recording trigger joins rows of one save (depth 2); nothing else changes them.
create trigger draft_changes_guard before update or delete on public.draft_changes
  for each row execute function app_private.guard_kept();

alter table public.approved_versions enable row level security;
alter table public.document_looks enable row level security;
alter table public.draft_changes enable row level security;
create policy approved_versions_select on public.approved_versions for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy document_looks_select on public.document_looks for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy draft_changes_select on public.draft_changes for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
revoke all on table public.approved_versions, public.document_looks, public.draft_changes from anon;
revoke insert, update, delete, truncate, references, trigger on table public.approved_versions, public.document_looks, public.draft_changes from authenticated;
grant select on table public.approved_versions, public.document_looks, public.draft_changes to authenticated;

-- ---- Recording draft changes ----------------------------------------------------------------------------

-- The first 50 items, for a row that lists what a save touched.
create function app_private.first_items(items jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce((select jsonb_agg(e order by n) from jsonb_array_elements(items) with ordinality as x(e, n) where n <= 50), '[]'::jsonb)
$$;

-- The key of the lock that makes an approval wait for saves already writing to the change record.
create function app_private.change_lock_key(target uuid) returns bigint
language sql immutable set search_path = '' as $$
  select hashtextextended('draft_changes:' || target::text, 0)
$$;

-- Adds the rows of one statement, joined with any of the same save. Called only by the triggers below. Each save
-- holds a shared lock on its process (or, for a workspace-wide change, its workspace) until it commits, so an
-- approval, which takes the same lock exclusively, waits for it and then counts it.
create function app_private.note_draft_changes(rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock_shared(app_private.change_lock_key(x.target))
     from (select distinct coalesce((r ->> 'process')::uuid, (r ->> 'workspace')::uuid) as target
             from jsonb_array_elements(rows) r where jsonb_array_length(r -> 'items') > 0 order by 1) x;
  insert into public.draft_changes as d (workspace_id, process_id, kind, change, origin, items, item_count)
  select (r ->> 'workspace')::uuid, (r ->> 'process')::uuid, r ->> 'kind', r ->> 'change', r ->> 'origin',
         app_private.first_items(r -> 'items'), jsonb_array_length(r -> 'items')
    from jsonb_array_elements(rows) r
   where jsonb_array_length(r -> 'items') > 0
  on conflict on constraint draft_changes_once do update
     set items = app_private.first_items(d.items || excluded.items), item_count = d.item_count + excluded.item_count;
end $$;

-- A person's choices in assessments.overrides, of one kind, without the time or the id stamped with them,
-- in a stable order: two saves of the same choices compare equal.
create function app_private.override_part(overrides jsonb, entry_kind text) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(e - 'at' - 'byId' order by e ->> 'stepId', (e - 'at' - 'byId')::text), '[]'::jsonb)
    from jsonb_array_elements(coalesce(overrides, '[]'::jsonb)) e
   where e ->> 'kind' = entry_kind
$$;

-- The steps whose choice differs between two lists of overrides.
create function app_private.changed_steps(before jsonb, after jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(distinct s), '[]'::jsonb) from (
    select e ->> 'stepId' as s from jsonb_array_elements(app_private.override_part(after, 'step')) e
     where not (app_private.override_part(before, 'step') @> jsonb_build_array(e))
    union
    select e ->> 'stepId' from jsonb_array_elements(app_private.override_part(before, 'step')) e
     where not (app_private.override_part(after, 'step') @> jsonb_build_array(e))) x
$$;

create function app_private.record_document_edits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'section_edit', 'change', 'added', 'origin', 'person', 'items', items))
        from (select workspace_id, process_id, jsonb_agg(doc_type || ':' || section_key) items from new_rows group by 1, 2) g), '[]'));
    elsif tg_op = 'UPDATE' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'section_edit', 'change', 'changed', 'origin', 'person', 'items', items))
        from (select n.workspace_id, n.process_id, jsonb_agg(n.doc_type || ':' || n.section_key) items from new_rows n join old_rows o on o.id = n.id
               where (n.html, n.base_hash, n.doc_type, n.section_key) is distinct from (o.html, o.base_hash, o.doc_type, o.section_key) group by 1, 2) g), '[]'));
    else
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'section_edit', 'change', 'removed', 'origin', 'person', 'items', items))
        from (select o.workspace_id, o.process_id, jsonb_agg(o.doc_type || ':' || o.section_key) items from old_rows o
               where exists (select 1 from public.processes p where p.id = o.process_id) group by 1, 2) g), '[]'));
    end if;
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

create function app_private.record_test_case_edits() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'test_edit', 'change', 'added', 'origin', 'person', 'items', items))
        from (select workspace_id, process_id, jsonb_agg(case_code) items from new_rows group by 1, 2) g), '[]'));
    elsif tg_op = 'UPDATE' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'test_edit', 'change', 'changed', 'origin', 'person', 'items', items))
        from (select n.workspace_id, n.process_id, jsonb_agg(n.case_code) items from new_rows n join old_rows o on o.id = n.id
               where (n.fields, n.set_aside, n.base_hash, n.case_code) is distinct from (o.fields, o.set_aside, o.base_hash, o.case_code) group by 1, 2) g), '[]'));
    else
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'test_edit', 'change', 'removed', 'origin', 'person', 'items', items))
        from (select o.workspace_id, o.process_id, jsonb_agg(o.case_code) items from old_rows o
               where exists (select 1 from public.processes p where p.id = o.process_id) group by 1, 2) g), '[]'));
    end if;
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

-- Requirements are saved in bulk (the whole register on the Documents page): one row per save and kind of
-- origin, listing the codes. A person's wording ('person') is told apart from a register that follows the
-- process ('follows'), which only the tag ignores.
create function app_private.record_requirements() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'requirement', 'change', 'added', 'origin', origin, 'items', items))
        from (select workspace_id, process_id, case when user_edited or origin = 'user' then 'person' else 'follows' end origin, jsonb_agg(code order by code) items
                from new_rows group by 1, 2, 3) g), '[]'));
    elsif tg_op = 'UPDATE' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'requirement', 'change', 'changed', 'origin', origin, 'items', items))
        from (select n.workspace_id, n.process_id, case when n.user_edited or o.user_edited or n.origin = 'user' then 'person' else 'follows' end origin, jsonb_agg(n.code order by n.code) items
                from new_rows n join old_rows o on o.id = n.id
               where (n.statement, n.rationale, n.priority, n.acceptance_criteria, n.state, n.user_edited, n.links ->> 'title', n.links ->> 'retiredReason')
                     is distinct from (o.statement, o.rationale, o.priority, o.acceptance_criteria, o.state, o.user_edited, o.links ->> 'title', o.links ->> 'retiredReason')
               group by 1, 2, 3) g), '[]'));
    else
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'requirement', 'change', 'removed', 'origin', 'person', 'items', items))
        from (select o.workspace_id, o.process_id, jsonb_agg(o.code order by o.code) items from old_rows o
               where exists (select 1 from public.processes p where p.id = o.process_id) group by 1, 2) g), '[]'));
    end if;
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

-- A source added, archived or brought back. Its passages are never compared.
create function app_private.record_process_sources() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'source', 'change', 'added', 'origin', 'person', 'items', items))
        from (select workspace_id, process_id, jsonb_agg(source_key) items from new_rows group by 1, 2) g), '[]'));
    else
      perform app_private.note_draft_changes(coalesce((select jsonb_agg(jsonb_build_object('workspace', workspace_id, 'process', process_id, 'kind', 'source', 'change', change, 'origin', 'person', 'items', items))
        from (select n.workspace_id, n.process_id, case when n.archived_at is null then 'added' else 'removed' end change, jsonb_agg(n.source_key) items
                from new_rows n join old_rows o on o.id = n.id
               where (n.archived_at is null) <> (o.archived_at is null) or n.title is distinct from o.title group by 1, 2, 3) g), '[]'));
    end if;
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

-- People's choices: a step's approach, the rate, the costs, the maps' shape. A save of the computed result
-- with the same choices writes nothing. A new revision's row is compared with the process's newest row before it.
create function app_private.record_assessments() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pairs jsonb;
begin
  begin
    if tg_op = 'UPDATE' then
      select coalesce(jsonb_agg(jsonb_build_object('w', n.workspace_id, 'p', n.process_id, 'before', o.overrides, 'after', n.overrides)), '[]')
        into pairs from new_rows n join old_rows o on o.id = n.id;
    else
      select coalesce(jsonb_agg(jsonb_build_object('w', n.workspace_id, 'p', n.process_id, 'after', n.overrides,
               'before', coalesce((select a.overrides from public.assessments a where a.process_id = n.process_id and a.id <> n.id
                                    order by a.updated_at desc limit 1), '[]'::jsonb))), '[]')
        into pairs from new_rows n;
    end if;
    perform app_private.note_draft_changes(coalesce((
      select jsonb_agg(jsonb_build_object('workspace', c ->> 'w', 'process', c ->> 'p', 'kind', k.kind, 'change', 'changed', 'origin', 'person',
                                          'items', case when k.kind = 'choice' then app_private.changed_steps(c -> 'before', c -> 'after') else '[null]'::jsonb end))
        from jsonb_array_elements(pairs) c
        cross join (values ('choice', 'step'), ('rate', 'rate'), ('costs', 'cost'), ('map_shape', 'map')) k(kind, entry_kind)
       where app_private.override_part(c -> 'before', k.entry_kind) is distinct from app_private.override_part(c -> 'after', k.entry_kind)), '[]'));
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

-- Workspace-wide: the assessment settings.
create function app_private.record_workspace_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pairs jsonb;
begin
  begin
    if tg_op = 'UPDATE' then
      select coalesce(jsonb_agg(jsonb_build_object('w', n.workspace_id, 'before', o.assessment, 'after', n.assessment)), '[]')
        into pairs from new_rows n join old_rows o on o.workspace_id = n.workspace_id;
    else
      select coalesce(jsonb_agg(jsonb_build_object('w', n.workspace_id, 'before', '{}'::jsonb, 'after', n.assessment)), '[]') into pairs from new_rows n;
    end if;
    perform app_private.note_draft_changes(coalesce((
      select jsonb_agg(jsonb_build_object('workspace', c ->> 'w', 'process', null, 'kind', 'assessment_settings', 'change', 'changed', 'origin', 'person', 'items', '[null]'::jsonb))
        from jsonb_array_elements(pairs) c where c -> 'before' is distinct from c -> 'after'), '[]'));
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

-- Workspace-wide: the company layout (document sections) and the look, told apart.
create function app_private.record_document_settings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  pairs jsonb;
begin
  begin
    if tg_op = 'UPDATE' then
      select coalesce(jsonb_agg(jsonb_build_object('w', n.workspace_id, 'before', o.settings, 'after', n.settings)), '[]')
        into pairs from new_rows n join old_rows o on o.workspace_id = n.workspace_id;
    else
      select coalesce(jsonb_agg(jsonb_build_object('w', n.workspace_id, 'before', '{}'::jsonb, 'after', n.settings)), '[]') into pairs from new_rows n;
    end if;
    perform app_private.note_draft_changes(coalesce((
      select jsonb_agg(jsonb_build_object('workspace', c ->> 'w', 'process', null, 'kind', k.kind, 'change', 'changed', 'origin', 'person', 'items', '[null]'::jsonb))
        from jsonb_array_elements(pairs) c
        cross join (values ('layout', 'layouts'), ('look', 'branding')) k(kind, part)
       where coalesce(c -> 'before' -> k.part, '{}') is distinct from coalesce(c -> 'after' -> k.part, '{}')), '[]'));
  exception when others then
    raise warning 'draft_changes: % not recorded (%)', tg_table_name, sqlerrm;
  end;
  return null;
end $$;

create trigger document_edits_record_insert after insert on public.document_edits referencing new table as new_rows
  for each statement execute function app_private.record_document_edits();
create trigger document_edits_record_update after update on public.document_edits referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_document_edits();
create trigger document_edits_record_delete after delete on public.document_edits referencing old table as old_rows
  for each statement execute function app_private.record_document_edits();
create trigger test_case_edits_record_insert after insert on public.test_case_edits referencing new table as new_rows
  for each statement execute function app_private.record_test_case_edits();
create trigger test_case_edits_record_update after update on public.test_case_edits referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_test_case_edits();
create trigger test_case_edits_record_delete after delete on public.test_case_edits referencing old table as old_rows
  for each statement execute function app_private.record_test_case_edits();
create trigger requirements_record_insert after insert on public.requirements referencing new table as new_rows
  for each statement execute function app_private.record_requirements();
create trigger requirements_record_update after update on public.requirements referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_requirements();
create trigger requirements_record_delete after delete on public.requirements referencing old table as old_rows
  for each statement execute function app_private.record_requirements();
create trigger process_sources_record_insert after insert on public.process_sources referencing new table as new_rows
  for each statement execute function app_private.record_process_sources();
create trigger process_sources_record_update after update on public.process_sources referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_process_sources();
create trigger assessments_record_insert after insert on public.assessments referencing new table as new_rows
  for each statement execute function app_private.record_assessments();
create trigger assessments_record_update after update on public.assessments referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_assessments();
create trigger workspace_settings_record_insert after insert on public.workspace_settings referencing new table as new_rows
  for each statement execute function app_private.record_workspace_settings();
create trigger workspace_settings_record_update after update on public.workspace_settings referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_workspace_settings();
create trigger document_settings_record_insert after insert on public.document_settings referencing new table as new_rows
  for each statement execute function app_private.record_document_settings();
create trigger document_settings_record_update after update on public.document_settings referencing old table as old_rows new table as new_rows
  for each statement execute function app_private.record_document_settings();

-- ---- Keeping a version --------------------------------------------------------------------------------

-- What a kept version must look like, and the reason rule (domain/docs/versions.ts, REASON). Shared by both ways in.
create function app_private.check_version_payload(next_number integer, reason text, documents jsonb, fingerprints jsonb, look jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  r text := nullif(btrim(coalesce(reason, '')), '');
begin
  if next_number = 1 and r is not null then
    raise exception 'REASON_NOT_TAKEN: the first approved version takes no reason' using errcode = 'PT422';
  end if;
  if next_number > 1 and (r is null or array_length(regexp_split_to_array(r, '\s+'), 1) < 3) then
    raise exception 'REASON_REQUIRED: say why there is a new version, in at least 3 words' using errcode = 'PT422';
  end if;
  if r is not null and char_length(r) > 2000 then
    raise exception 'REASON_TOO_LONG: keep the reason under 2000 characters' using errcode = 'PT422';
  end if;
  if jsonb_typeof(documents) is distinct from 'object' or jsonb_typeof(documents -> 'documents') is distinct from 'object'
     or (documents ->> 'format') is distinct from '1' or not (documents -> 'documents') ?| array['brd', 'pdd', 'frd', 'sdd', 'agent', 'tests', 'evidence'] then
    raise exception 'VERSION_INVALID: the documents are not a kept set of format 1' using errcode = 'PT422';
  end if;
  if jsonb_typeof(fingerprints) is distinct from 'object' or jsonb_typeof(look) is distinct from 'object' then
    raise exception 'VERSION_INVALID: the fingerprints or the look are missing' using errcode = 'PT422';
  end if;
  return r;
end $$;

-- Stores the look once for the workspace and returns its fingerprint.
create function app_private.keep_look(target_workspace uuid, look jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare
  fp text := encode(sha256(convert_to(look::text, 'UTF8')), 'hex');
begin
  insert into public.document_looks (workspace_id, fingerprint, look) values (target_workspace, fp, look)
  on conflict (workspace_id, fingerprint) do nothing;
  return fp;
end $$;

-- What the page could see of the change record for a process: a person's rows for it, and the workspace-wide
-- rows. Rows are never deleted but with their process or workspace, so the count only grows.
create function app_private.changes_seen(target_workspace uuid, target_process uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from public.draft_changes d
   where (d.process_id = target_process and d.origin = 'person') or (d.workspace_id = target_workspace and d.process_id is null)
$$;

-- Waits for every save already writing to this process's or this workspace's change record, then refuses the
-- approval if the count differs from what the page saw, and returns the newest row (the version's change mark).
create function app_private.settle_changes(target_workspace uuid, target_process uuid, expected_changes bigint) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(app_private.change_lock_key(target_process));
  perform pg_advisory_xact_lock(app_private.change_lock_key(target_workspace));
  if app_private.changes_seen(target_workspace, target_process) is distinct from expected_changes then
    raise exception 'CHANGED_MEANWHILE: someone saved a change after this page read the documents; reload and approve again' using errcode = 'PT409';
  end if;
  return coalesce((select max(d.id) from public.draft_changes d
                    where d.process_id = target_process or (d.workspace_id = target_workspace and d.process_id is null)), 0);
end $$;

-- A person's display name as it reads now, or none.
create function app_private.name_now(person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(btrim(p.display_name), '') from public.profiles p where p.id = person
$$;

-- Approves and keeps in one step: both happen or neither does. With a working draft of the record, it is
-- approved through the shared body (as model_approve does); with none, the version keeps the documents of the
-- approved revision as they read now (section edits, choices or settings changed, not the record). The number
-- is the next for the process and must follow the one the approver saw (expected_version: 0 for none yet).
create function public.approve_version(
  target_process uuid, target_revision uuid, expected_seq bigint, expected_version integer, expected_changes bigint,
  reason text, documents jsonb, fingerprints jsonb, look jsonb, changes jsonb, inputs jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  proc public.processes;
  rev public.process_model_revisions;
  draft_process uuid;
  latest integer;
  mark bigint;
  r text;
  fp text;
  v public.approved_versions;
begin
  -- The same order of locks as model_approve: the revision first, then the process. Without a draft to approve,
  -- the working draft is still locked first, so a save to it that is under way finishes before the check below.
  if target_revision is not null then
    select x.process_id into draft_process from public.process_model_revisions x where x.id = target_revision;
    if draft_process is distinct from target_process then
      raise exception 'NOT_FOUND: revision' using errcode = 'PT404';
    end if;
    perform app_private.approve_revision(target_revision, expected_seq);
  else
    perform 1 from public.process_model_revisions w where w.process_id = target_process and w.state = 'working' for update;
  end if;
  select * into proc from public.processes where id = target_process for update;
  if not found then
    raise exception 'NOT_FOUND: process' using errcode = 'PT404';
  end if;
  perform app_private.require_approver(proc.workspace_id, 'process');
  if target_revision is null and exists (select 1 from public.process_model_revisions w where w.process_id = proc.id and w.state = 'working' and w.edit_seq > 0) then
    raise exception 'DRAFT_EXISTS: the process record has a working draft; approve it' using errcode = 'PT409';
  end if;
  select * into rev from public.process_model_revisions where process_id = proc.id and state = 'approved';
  if not found then
    raise exception 'NOTHING_TO_APPROVE: the process has no record to approve' using errcode = 'PT409';
  end if;

  select coalesce(max(number), 0) into latest from public.approved_versions where process_id = proc.id;
  if latest <> coalesce(expected_version, -1) then
    raise exception 'VERSION_CONFLICT: approved version % exists; reload to see what changed', latest using errcode = 'PT409';
  end if;
  mark := app_private.settle_changes(proc.workspace_id, proc.id, expected_changes);
  r := app_private.check_version_payload(latest + 1, reason, documents, fingerprints, look);
  fp := app_private.keep_look(proc.workspace_id, look);

  insert into public.approved_versions (workspace_id, process_id, number, model_revision_id, model_hash, format, documents, fingerprints,
                                        look_fingerprint, inputs, reason, changes, approved_by, approved_by_name, approved_at, change_mark)
  values (proc.workspace_id, proc.id, latest + 1, rev.id, coalesce(rev.model_hash, ''), 1, documents, fingerprints, fp,
          coalesce(inputs, '{}'::jsonb), r, coalesce(changes, '{"sections": [], "documents": [], "look": []}'::jsonb),
          auth.uid(), app_private.name_now(auth.uid()), now(), mark)
  returning * into v;

  return jsonb_build_object('versionId', v.id, 'number', v.number, 'revisionId', rev.id, 'revNo', rev.rev_no, 'approvedAt', v.approved_at);
end $$;

-- "Keep it as it reads now" (part J): for the approved revision that has no kept copy (approved before copies
-- were kept, or by a tab opened before the release). Records both facts: when and by whom the revision was
-- approved, and when and by whom this copy was kept. Nothing is dated earlier than the day it is kept.
create function public.keep_version_as_reads_now(
  target_process uuid, expected_version integer, expected_changes bigint, reason text, documents jsonb, fingerprints jsonb, look jsonb, changes jsonb, inputs jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  proc public.processes;
  rev public.process_model_revisions;
  latest integer;
  mark bigint;
  r text;
  fp text;
  v public.approved_versions;
begin
  select * into proc from public.processes where id = target_process for update;
  if not found then
    raise exception 'NOT_FOUND: process' using errcode = 'PT404';
  end if;
  perform app_private.require_approver(proc.workspace_id, 'process');
  select * into rev from public.process_model_revisions where process_id = proc.id and state = 'approved';
  if not found then
    raise exception 'NOTHING_TO_APPROVE: the process has no approved record' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.approved_versions x where x.model_revision_id = rev.id) then
    raise exception 'ALREADY_KEPT: approved revision % already has a kept version', rev.rev_no using errcode = 'PT409';
  end if;
  select coalesce(max(number), 0) into latest from public.approved_versions where process_id = proc.id;
  if latest <> coalesce(expected_version, -1) then
    raise exception 'VERSION_CONFLICT: approved version % exists; reload to see what changed', latest using errcode = 'PT409';
  end if;
  mark := app_private.settle_changes(proc.workspace_id, proc.id, expected_changes);
  r := app_private.check_version_payload(latest + 1, reason, documents, fingerprints, look);
  fp := app_private.keep_look(proc.workspace_id, look);

  -- The revision's approver is always recorded (a check on the revisions); their name is stored only if a
  -- profile still holds one, else none, which the page shows as "Not recorded". Nothing is refused for it.
  insert into public.approved_versions (workspace_id, process_id, number, model_revision_id, model_hash, format, documents, fingerprints,
                                        look_fingerprint, inputs, reason, changes, approved_by, approved_by_name, approved_at,
                                        kept_by, kept_by_name, kept_at, change_mark)
  values (proc.workspace_id, proc.id, latest + 1, rev.id, coalesce(rev.model_hash, ''), 1, documents, fingerprints, fp,
          coalesce(inputs, '{}'::jsonb), r, coalesce(changes, '{"sections": [], "documents": [], "look": []}'::jsonb),
          rev.approved_by, app_private.name_now(rev.approved_by), rev.approved_at, auth.uid(), app_private.name_now(auth.uid()), now(), mark)
  returning * into v;

  return jsonb_build_object('versionId', v.id, 'number', v.number, 'revisionId', rev.id, 'revNo', rev.rev_no, 'approvedAt', v.approved_at, 'keptAt', v.kept_at);
end $$;

-- ---- What a list or a page shows, in one call (change d) -----------------------------------------------

-- Per process of a workspace (or one process): the latest kept version and who approved it; the approved
-- revision and whether it has a kept copy; whether this process was changed since the version (its working
-- draft holds edits, or a person's row of the change record is newer than the version's mark); which
-- workspace-wide kinds changed since; and how many rows of the change record the page can see, which an
-- approval must pass back unchanged (changes_seen). Never the documents themselves. Runs as the caller, so a
-- person sees only what they may read.
create function public.version_states(target_workspace uuid, target_process uuid default null)
returns table (process_id uuid, latest_number integer, latest_version_id uuid, latest_approved_at timestamptz, latest_approved_by uuid,
               latest_approved_by_name text, latest_kept_at timestamptz, approved_revision_id uuid, approved_rev_no integer,
               approved_has_version boolean, process_changed boolean, workspace_changes text[], changes_seen bigint)
language sql stable security invoker set search_path = '' as $$
  with p as (
    select id from public.processes where workspace_id = target_workspace and (target_process is null or id = target_process)
  ), v as (
    select distinct on (x.process_id) x.process_id, x.id, x.number, x.approved_at, x.approved_by, x.approved_by_name, x.kept_at, x.change_mark
      from public.approved_versions x where x.workspace_id = target_workspace
     order by x.process_id, x.number desc
  ), r as (
    select x.process_id, x.id, x.rev_no from public.process_model_revisions x where x.workspace_id = target_workspace and x.state = 'approved'
  )
  select p.id, v.number, v.id, v.approved_at, v.approved_by, v.approved_by_name, v.kept_at, r.id, r.rev_no,
         r.id is not null and exists (select 1 from public.approved_versions k where k.model_revision_id = r.id),
         v.id is not null and (
           exists (select 1 from public.process_model_revisions w where w.process_id = p.id and w.state = 'working' and w.edit_seq > 0)
           or exists (select 1 from public.draft_changes d where d.process_id = p.id and d.origin = 'person' and d.id > v.change_mark)),
         case when v.id is null then '{}'::text[] else array(
           select distinct d.kind from public.draft_changes d
            where d.workspace_id = target_workspace and d.process_id is null and d.id > v.change_mark order by 1) end,
         (select count(*) from public.draft_changes d
           where (d.process_id = p.id and d.origin = 'person') or (d.workspace_id = target_workspace and d.process_id is null))
    from p left join v on v.process_id = p.id left join r on r.process_id = p.id
$$;

revoke execute on function app_private.only_keys(jsonb, text[]), app_private.require_approver(uuid, text), app_private.approve_revision(uuid, bigint),
  app_private.first_items(jsonb), app_private.note_draft_changes(jsonb), app_private.override_part(jsonb, text),
  app_private.changed_steps(jsonb, jsonb), app_private.check_version_payload(integer, text, jsonb, jsonb, jsonb),
  app_private.keep_look(uuid, jsonb), app_private.guard_kept(), app_private.change_lock_key(uuid),
  app_private.changes_seen(uuid, uuid), app_private.settle_changes(uuid, uuid, bigint), app_private.name_now(uuid),
  app_private.record_document_edits(), app_private.record_test_case_edits(), app_private.record_requirements(),
  app_private.record_process_sources(), app_private.record_assessments(), app_private.record_workspace_settings(),
  app_private.record_document_settings() from public, anon, authenticated;
revoke execute on function public.approve_version(uuid, uuid, bigint, integer, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.keep_version_as_reads_now(uuid, integer, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.version_states(uuid, uuid) from public, anon;
grant execute on function public.approve_version(uuid, uuid, bigint, integer, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.keep_version_as_reads_now(uuid, integer, bigint, text, jsonb, jsonb, jsonb, jsonb, jsonb),
  public.version_states(uuid, uuid) to authenticated, service_role;
