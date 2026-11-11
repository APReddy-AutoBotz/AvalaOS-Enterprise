-- WP1.2: saving, approving and reading Process Model revisions.
--
-- Users never write revisions or edits directly (no insert/update privileges). They call:
--   model_start_draft(process)                         -> the working draft, created if needed
--   model_save_patch(revision, expected_seq, patch)    -> applies one JSON Patch, optimistic concurrency
--   model_approve(revision, expected_seq)              -> working draft becomes the approved revision
--   model_history(process)                             -> revisions and edits, newest first
--
-- Errors use PostgREST status codes: PT409 conflict, PT403 forbidden, PT404 not found, PT422 invalid.
-- The domain code (domain/processModel/patch.ts) validates the full model before it sends a patch;
-- the server applies the patch authoritatively and checks the model's shape.

-- ---------------------------------------------------------------------------
-- JSON Patch (RFC 6902: add, remove, replace, test), matching domain/processModel/jsonPatch.ts
-- ---------------------------------------------------------------------------

create function app_private.json_pointer(pointer text) returns text[]
language plpgsql immutable set search_path = '' as $$
declare
  tokens text[];
begin
  if pointer is null then
    raise exception 'PATCH_INVALID: missing path' using errcode = 'PT422';
  end if;
  if pointer = '' then
    return '{}'::text[];
  end if;
  if left(pointer, 1) <> '/' then
    raise exception 'PATCH_INVALID: pointer must start with /: %', pointer using errcode = 'PT422';
  end if;
  select coalesce(array_agg(replace(replace(t, '~1', '/'), '~0', '~') order by ord), '{}'::text[])
    into tokens
    from unnest(string_to_array(substr(pointer, 2), '/')) with ordinality as u(t, ord);
  return tokens;
end $$;

-- Walks `path` in `doc`, checking that every token used on an array is a canonical index.
-- Returns the value at the path, or SQL null when it does not exist.
create function app_private.json_at(doc jsonb, path text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  cur jsonb := doc;
  t text;
begin
  foreach t in array path loop
    if cur is null then return null; end if;
    if jsonb_typeof(cur) = 'array' then
      if t !~ '^(0|[1-9][0-9]*)$' then return null; end if;
      if t::bigint >= jsonb_array_length(cur) then return null; end if;
      cur := cur -> t::int;
    elsif jsonb_typeof(cur) = 'object' then
      if not (cur ? t) then return null; end if;
      cur := cur -> t;
    else
      return null;
    end if;
  end loop;
  return cur;
end $$;

create function app_private.jsonb_apply_patch(doc jsonb, patch jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  op jsonb;
  kind text;
  path text[];
  n int;
  parent_path text[];
  parent jsonb;
  last text;
  len int;
begin
  if jsonb_typeof(patch) <> 'array' then
    raise exception 'PATCH_INVALID: patch must be an array' using errcode = 'PT422';
  end if;
  for op in select value from jsonb_array_elements(patch) loop
    kind := op ->> 'op';
    path := app_private.json_pointer(op ->> 'path');
    n := coalesce(array_length(path, 1), 0);

    if kind in ('add', 'replace', 'test') and not (op ? 'value') then
      raise exception 'PATCH_INVALID: % needs a value', kind using errcode = 'PT422';
    end if;

    if kind = 'test' then
      if app_private.json_at(doc, path) is distinct from op -> 'value' then
        raise exception 'PATCH_TEST_FAILED at %', op ->> 'path' using errcode = 'PT409';
      end if;
      continue;
    end if;

    if n = 0 then
      if kind = 'remove' then raise exception 'PATCH_INVALID: cannot remove the root' using errcode = 'PT422'; end if;
      doc := op -> 'value';
      continue;
    end if;

    parent_path := path[1:n - 1];
    parent := app_private.json_at(doc, parent_path);
    last := path[n];
    if parent is null or jsonb_typeof(parent) not in ('array', 'object') then
      raise exception 'PATCH_PATH_NOT_FOUND: %', op ->> 'path' using errcode = 'PT422';
    end if;

    if kind = 'add' then
      if jsonb_typeof(parent) = 'array' then
        len := jsonb_array_length(parent);
        if last = '-' or (last ~ '^(0|[1-9][0-9]*)$' and last::bigint = len) then
          parent := parent || jsonb_build_array(op -> 'value');
          doc := case when n = 1 then parent else jsonb_set(doc, parent_path, parent, false) end;
        elsif last ~ '^(0|[1-9][0-9]*)$' and last::bigint < len then
          doc := jsonb_insert(doc, path, op -> 'value', false);
        else
          raise exception 'PATCH_PATH_NOT_FOUND: %', op ->> 'path' using errcode = 'PT422';
        end if;
      else
        doc := jsonb_set(doc, path, op -> 'value', true);
      end if;
    elsif kind in ('remove', 'replace') then
      if app_private.json_at(doc, path) is null then
        raise exception 'PATCH_PATH_NOT_FOUND: %', op ->> 'path' using errcode = 'PT422';
      end if;
      if kind = 'remove' then
        doc := doc #- path;
      else
        doc := jsonb_set(doc, path, op -> 'value', false);
      end if;
    else
      raise exception 'PATCH_INVALID: unsupported op %', coalesce(kind, 'null') using errcode = 'PT422';
    end if;
  end loop;
  return doc;
end $$;

-- The parts of a model every reader relies on. Full validation runs in the domain code.
create function app_private.model_shape_ok(m jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
         jsonb_typeof(m) = 'object'
     and m -> 'schemaVersion' = '1'::jsonb
     and jsonb_typeof(m -> 'meta') = 'object'
     and jsonb_typeof(m -> 'meta' -> 'name') = 'string'
     and jsonb_typeof(m -> 'meta' -> 'scopeIn') = 'array'
     and jsonb_typeof(m -> 'meta' -> 'scopeOut') = 'array'
     and jsonb_typeof(m -> 'meta' -> 'metrics') = 'array'
     and (select bool_and(coalesce(jsonb_typeof(m -> k) = 'array', false))
            from unnest(array['roles','systems','events','steps','gateways','flows','rules','exceptions',
                              'dataObjects','painPoints','controls','risks','openQuestions','conflicts']) as k),
         false)
$$;

-- An empty model for a new process: its name and nothing else. Unknowns are explicit.
create function app_private.empty_model(process_name text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'meta', jsonb_build_object(
      'name', process_name,
      'objective', jsonb_build_object('value', null, 'status', 'unknown', 'sources', '[]'::jsonb),
      'owner', jsonb_build_object('value', null, 'status', 'unknown', 'sources', '[]'::jsonb),
      'scopeIn', '[]'::jsonb, 'scopeOut', '[]'::jsonb, 'metrics', '[]'::jsonb),
    'roles', '[]'::jsonb, 'systems', '[]'::jsonb, 'events', '[]'::jsonb, 'steps', '[]'::jsonb,
    'gateways', '[]'::jsonb, 'flows', '[]'::jsonb, 'rules', '[]'::jsonb, 'exceptions', '[]'::jsonb,
    'dataObjects', '[]'::jsonb, 'painPoints', '[]'::jsonb, 'controls', '[]'::jsonb, 'risks', '[]'::jsonb,
    'openQuestions', '[]'::jsonb, 'conflicts', '[]'::jsonb)
$$;

-- jsonb text output has a fixed key order, so md5 of it identifies the content.
create function app_private.model_hash(m jsonb) returns text
language sql immutable set search_path = '' as $$ select md5(m::text) $$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.model_start_draft(target_process uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  proc public.processes;
  draft public.process_model_revisions;
  approved public.process_model_revisions;
  next_no int;
begin
  select * into proc from public.processes where id = target_process for update;
  if not found or not app_private.is_workspace_member(proc.workspace_id) then
    raise exception 'NOT_FOUND: process' using errcode = 'PT404';
  end if;

  select * into draft from public.process_model_revisions where process_id = proc.id and state = 'working';
  if found then
    return jsonb_build_object('revisionId', draft.id, 'revNo', draft.rev_no, 'seq', draft.edit_seq,
                              'model', draft.model, 'modelHash', draft.model_hash, 'created', false);
  end if;

  if not app_private.can_edit_workspace(proc.workspace_id) then
    raise exception 'FORBIDDEN: editing needs the editor or admin role' using errcode = 'PT403';
  end if;

  select * into approved from public.process_model_revisions where process_id = proc.id and state = 'approved';
  select coalesce(max(rev_no), 0) + 1 into next_no from public.process_model_revisions where process_id = proc.id;

  insert into public.process_model_revisions (workspace_id, process_id, rev_no, model, model_hash, based_on, created_by)
  values (
    proc.workspace_id, proc.id, next_no,
    coalesce(approved.model, app_private.empty_model(proc.name)),
    app_private.model_hash(coalesce(approved.model, app_private.empty_model(proc.name))),
    approved.id, auth.uid())
  returning * into draft;

  return jsonb_build_object('revisionId', draft.id, 'revNo', draft.rev_no, 'seq', draft.edit_seq,
                            'model', draft.model, 'modelHash', draft.model_hash, 'created', true);
end $$;

create function public.model_save_patch(
  target_revision uuid,
  expected_seq bigint,
  patch jsonb,
  origin text default 'user',
  summary text default ''
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rev public.process_model_revisions;
  next_model jsonb;
  next_seq bigint;
begin
  if jsonb_typeof(patch) <> 'array' or jsonb_array_length(patch) = 0 then
    raise exception 'PATCH_INVALID: patch must be a non-empty array' using errcode = 'PT422';
  end if;
  if jsonb_array_length(patch) > 2000 or octet_length(patch::text) > 2000000 then
    raise exception 'PATCH_TOO_LARGE' using errcode = 'PT422';
  end if;
  if origin not in ('user', 'extraction', 'diagram', 'import', 'system') then
    raise exception 'PATCH_INVALID: unknown origin %', origin using errcode = 'PT422';
  end if;

  -- The row lock serialises concurrent saves; the second one then sees a newer seq.
  select * into rev from public.process_model_revisions where id = target_revision for update;
  if not found or not app_private.is_workspace_member(rev.workspace_id) then
    raise exception 'NOT_FOUND: revision' using errcode = 'PT404';
  end if;
  if not app_private.can_edit_workspace(rev.workspace_id) then
    raise exception 'FORBIDDEN: editing needs the editor or admin role' using errcode = 'PT403';
  end if;
  if rev.state <> 'working' then
    raise exception 'NOT_EDITABLE: approved revisions cannot change; start a new draft' using errcode = 'PT409';
  end if;
  if rev.edit_seq <> expected_seq then
    raise exception 'EDIT_CONFLICT: the draft is at edit %, not %', rev.edit_seq, expected_seq using errcode = 'PT409';
  end if;

  next_model := app_private.jsonb_apply_patch(rev.model, patch);
  if not app_private.model_shape_ok(next_model) then
    raise exception 'MODEL_INVALID: the result is not a Process Model' using errcode = 'PT422';
  end if;
  next_seq := rev.edit_seq + 1;

  update public.process_model_revisions
     set model = next_model, edit_seq = next_seq, model_hash = app_private.model_hash(next_model)
   where id = rev.id;
  insert into public.process_model_edits (workspace_id, process_id, revision_id, seq, patch, origin, summary, actor)
  values (rev.workspace_id, rev.process_id, rev.id, next_seq, patch, origin, left(coalesce(summary, ''), 500), auth.uid());

  return jsonb_build_object('revisionId', rev.id, 'seq', next_seq, 'modelHash', app_private.model_hash(next_model));
end $$;

create function public.model_approve(target_revision uuid, expected_seq bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  rev public.process_model_revisions;
begin
  select * into rev from public.process_model_revisions where id = target_revision for update;
  if not found or not app_private.is_workspace_member(rev.workspace_id) then
    raise exception 'NOT_FOUND: revision' using errcode = 'PT404';
  end if;
  if not app_private.can_approve_workspace(rev.workspace_id) then
    raise exception 'FORBIDDEN: approving needs approval rights' using errcode = 'PT403';
  end if;
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

-- Runs as the caller, so row level security decides what is visible.
create function public.model_history(target_process uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'revNo', r.rev_no, 'state', r.state, 'seq', r.edit_seq, 'modelHash', r.model_hash,
        'basedOn', r.based_on, 'createdBy', r.created_by, 'createdAt', r.created_at,
        'approvedBy', r.approved_by, 'approvedAt', r.approved_at) order by r.rev_no desc)
      from public.process_model_revisions r where r.process_id = target_process), '[]'::jsonb),
    'edits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'revisionId', e.revision_id, 'seq', e.seq, 'origin', e.origin, 'summary', e.summary,
        'actor', e.actor, 'createdAt', e.created_at, 'operations', jsonb_array_length(e.patch))
        order by e.created_at desc, e.seq desc)
      from public.process_model_edits e where e.process_id = target_process), '[]'::jsonb))
$$;

revoke execute on function app_private.json_pointer(text), app_private.json_at(jsonb, text[]),
  app_private.jsonb_apply_patch(jsonb, jsonb), app_private.model_shape_ok(jsonb),
  app_private.empty_model(text), app_private.model_hash(jsonb) from public, anon;

revoke execute on function public.model_start_draft(uuid), public.model_save_patch(uuid, bigint, jsonb, text, text),
  public.model_approve(uuid, bigint), public.model_history(uuid) from public, anon;
grant execute on function public.model_start_draft(uuid), public.model_save_patch(uuid, bigint, jsonb, text, text),
  public.model_approve(uuid, bigint), public.model_history(uuid) to authenticated, service_role;
