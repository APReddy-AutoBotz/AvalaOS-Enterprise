-- The board on its own, step 2 (docs/product-plan.md, "The Delivery board on its own"):
-- comments on items, an item history written by the database, sprints, and labels.

-- ---------------------------------------------------------------------------
-- Sprints: one project's time boxes. At most one active sprint per project.
-- ---------------------------------------------------------------------------
create table public.delivery_sprints (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 120),
  goal text not null default '' check (length(goal) <= 2000),
  starts_on date,
  ends_on date,
  state text not null default 'planned' check (state in ('planned', 'active', 'closed')),
  started_at timestamptz,
  closed_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, workspace_id) references public.delivery_projects (id, workspace_id) on delete cascade,
  unique (id, workspace_id),
  unique (id, project_id),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);
create index delivery_sprints_workspace_id_idx on public.delivery_sprints (workspace_id);
create index delivery_sprints_project_id_idx on public.delivery_sprints (project_id, state);
create unique index delivery_sprints_one_active_idx on public.delivery_sprints (project_id) where state = 'active';
create trigger delivery_sprints_touch before update on public.delivery_sprints for each row execute function app_private.touch_updated_at();

-- A sprint keeps its project; starting and completing it are stamped.
create function app_private.sprint_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.workspace_id := old.workspace_id;
    new.project_id := old.project_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.state = 'closed' and new.state <> 'closed' then
      raise exception 'A completed sprint cannot be reopened' using errcode = '22023';
    end if;
  end if;
  if new.state = 'active' and (tg_op = 'INSERT' or old.state <> 'active') then new.started_at := now(); end if;
  if new.state = 'closed' and (tg_op = 'INSERT' or old.state <> 'closed') then new.closed_at := now(); end if;
  return new;
end $$;
create trigger delivery_sprints_rules before insert or update on public.delivery_sprints
  for each row execute function app_private.sprint_rules();

alter table public.delivery_sprints enable row level security;
create policy delivery_sprints_select on public.delivery_sprints for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy delivery_sprints_insert on public.delivery_sprints for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id));
create policy delivery_sprints_update on public.delivery_sprints for update to authenticated
  using (app_private.can_edit_workspace(workspace_id)) with check (app_private.can_edit_workspace(workspace_id));
create policy delivery_sprints_delete on public.delivery_sprints for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

-- ---------------------------------------------------------------------------
-- Items: a sprint of the same project, and labels (as in Jira: no spaces or commas).
-- ---------------------------------------------------------------------------
create function app_private.labels_ok(l text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(l) <= 20 and not exists (select 1 from unnest(l) x where x is null or x !~ '^[^[:space:],]{1,40}$');
$$;

alter table public.delivery_work_items
  add column sprint_id uuid,
  add column labels text[] not null default '{}' check (app_private.labels_ok(labels)),
  add constraint delivery_work_items_sprint_fk foreign key (sprint_id, project_id)
    references public.delivery_sprints (id, project_id) on delete set null (sprint_id);
create index delivery_work_items_sprint_id_idx on public.delivery_work_items (sprint_id);
create index delivery_work_items_labels_idx on public.delivery_work_items using gin (labels);

-- Completing a sprint: unfinished work moves to a planned sprint of the same project, or back to the backlog.
-- Done work stays with the completed sprint. Runs with the caller's rights.
create function public.close_sprint(target_sprint uuid, move_to uuid default null) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  s public.delivery_sprints;
  moved integer;
begin
  select * into s from public.delivery_sprints where id = target_sprint;
  if not found then raise exception 'That sprint was not found' using errcode = 'P0002'; end if;
  if not app_private.can_edit_workspace(s.workspace_id) then
    raise exception 'Only editors and admins can complete a sprint' using errcode = '42501';
  end if;
  if s.state <> 'active' then raise exception 'Only the active sprint can be completed' using errcode = '22023'; end if;
  if move_to is not null and not exists (
    select 1 from public.delivery_sprints t where t.id = move_to and t.project_id = s.project_id and t.state = 'planned'
  ) then
    raise exception 'Open work can move to a planned sprint of this project, or to the backlog' using errcode = '22023';
  end if;
  update public.delivery_work_items set sprint_id = move_to where sprint_id = s.id and status <> 'done';
  get diagnostics moved = row_count;
  update public.delivery_sprints set state = 'closed' where id = s.id;
  return moved;
end $$;
revoke all on function public.close_sprint(uuid, uuid) from public, anon;
grant execute on function public.close_sprint(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Comments: every member may comment (viewers too); a person edits only their own;
-- the author or an admin deletes one.
-- ---------------------------------------------------------------------------
create table public.delivery_work_item_comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  work_item_id uuid not null,
  author_id uuid default auth.uid() references auth.users (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  foreign key (work_item_id, workspace_id) references public.delivery_work_items (id, workspace_id) on delete cascade
);
create index delivery_work_item_comments_item_idx on public.delivery_work_item_comments (work_item_id, created_at);
create index delivery_work_item_comments_workspace_id_idx on public.delivery_work_item_comments (workspace_id);
create index delivery_work_item_comments_author_id_idx on public.delivery_work_item_comments (author_id);

-- Only the text changes; editing it is stamped.
create function app_private.comment_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.workspace_id := old.workspace_id;
  new.work_item_id := old.work_item_id;
  new.author_id := old.author_id;
  new.created_at := old.created_at;
  if new.body is distinct from old.body then new.edited_at := now(); else new.edited_at := old.edited_at; end if;
  return new;
end $$;
create trigger delivery_work_item_comments_rules before update on public.delivery_work_item_comments
  for each row execute function app_private.comment_rules();

alter table public.delivery_work_item_comments enable row level security;
create policy delivery_work_item_comments_select on public.delivery_work_item_comments for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy delivery_work_item_comments_insert on public.delivery_work_item_comments for insert to authenticated
  with check (app_private.is_workspace_member(workspace_id) and author_id = (select auth.uid()));
create policy delivery_work_item_comments_update on public.delivery_work_item_comments for update to authenticated
  using (author_id = (select auth.uid()) and app_private.is_workspace_member(workspace_id))
  with check (author_id = (select auth.uid()) and app_private.is_workspace_member(workspace_id));
create policy delivery_work_item_comments_delete on public.delivery_work_item_comments for delete to authenticated
  using ((author_id = (select auth.uid()) and app_private.is_workspace_member(workspace_id)) or app_private.is_workspace_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- History: written only by the database when an item is created or changed. Members read it.
-- Long text (description, acceptance criteria) is recorded as changed, without its values.
-- ---------------------------------------------------------------------------
create table public.delivery_work_item_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  work_item_id uuid not null,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('created', 'changed')),
  field text check (field in ('title', 'type', 'status', 'priority', 'owner', 'parent', 'sprint', 'estimate', 'start_date', 'due_date', 'labels', 'description', 'acceptance_criteria')),
  old_value text,
  new_value text,
  created_at timestamptz not null default now(),
  foreign key (work_item_id, workspace_id) references public.delivery_work_items (id, workspace_id) on delete cascade,
  check ((kind = 'created') = (field is null))
);
create index delivery_work_item_events_item_idx on public.delivery_work_item_events (work_item_id, id);
create index delivery_work_item_events_workspace_id_idx on public.delivery_work_item_events (workspace_id);
create index delivery_work_item_events_actor_id_idx on public.delivery_work_item_events (actor_id);

alter table public.delivery_work_item_events enable row level security;
create policy delivery_work_item_events_select on public.delivery_work_item_events for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
revoke insert, update, delete, truncate on public.delivery_work_item_events from anon, authenticated;

create function app_private.log_work_item_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.delivery_work_item_events (workspace_id, work_item_id, actor_id, kind)
      values (new.workspace_id, new.id, auth.uid(), 'created');
    return null;
  end if;
  insert into public.delivery_work_item_events (workspace_id, work_item_id, actor_id, kind, field, old_value, new_value)
  select new.workspace_id, new.id, auth.uid(), 'changed', c.field,
         case when c.keep then c.o end, case when c.keep then c.n end
  from (values
    ('title', old.title, new.title, true),
    ('type', old.item_type, new.item_type, true),
    ('status', old.status, new.status, true),
    ('priority', old.priority, new.priority, true),
    ('owner', old.owner_id::text, new.owner_id::text, true),
    ('parent', old.parent_id::text, new.parent_id::text, true),
    ('sprint', old.sprint_id::text, new.sprint_id::text, true),
    ('estimate', old.estimate_hours::text, new.estimate_hours::text, true),
    ('start_date', old.start_date::text, new.start_date::text, true),
    ('due_date', old.due_date::text, new.due_date::text, true),
    ('labels', array_to_string(old.labels, ' '), array_to_string(new.labels, ' '), true),
    ('description', old.description, new.description, false),
    ('acceptance_criteria', old.acceptance_criteria::text, new.acceptance_criteria::text, false)
  ) as c(field, o, n, keep)
  where c.o is distinct from c.n;
  return null;
end $$;
revoke all on function app_private.log_work_item_change() from public, anon, authenticated;
create trigger delivery_work_items_history after insert or update on public.delivery_work_items
  for each row execute function app_private.log_work_item_change();
