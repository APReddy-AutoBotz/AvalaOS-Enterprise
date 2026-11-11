-- WP1.7: the sources of a process. Files are parsed in the browser (or read by the vision task for
-- images); what is stored is the parsed segments with their locators, which extraction cites.
-- Sources are archived, not deleted, so the quotes in a model keep pointing at something.

create table public.process_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  process_id uuid not null,
  source_key text not null check (source_key ~ '^[A-Za-z0-9._-]{1,24}$'),
  title text not null check (length(trim(title)) between 1 and 200),
  file_name text not null default '' check (length(file_name) <= 300),
  format text not null check (format in ('txt', 'md', 'vtt', 'srt', 'transcript_txt', 'docx', 'xlsx', 'pdf', 'drawio', 'bpmn', 'image')),
  kind text not null default '' check (length(kind) <= 60),
  segments jsonb not null check (jsonb_typeof(segments) = 'array' and jsonb_array_length(segments) between 1 and 5000 and octet_length(segments::text) <= 4000000),
  inferred boolean not null default false,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  byte_size bigint not null default 0 check (byte_size >= 0),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, source_key)
);
create index process_sources_workspace_idx on public.process_sources (workspace_id);
create index process_sources_created_by_idx on public.process_sources (created_by);

alter table public.process_sources enable row level security;

create policy process_sources_select on public.process_sources for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy process_sources_insert on public.process_sources for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id) and created_by = (select auth.uid()));
-- Editors may retitle or archive a source; the parsed content never changes.
create policy process_sources_update on public.process_sources for update to authenticated
  using (app_private.can_edit_workspace(workspace_id))
  with check (app_private.can_edit_workspace(workspace_id));

revoke all on public.process_sources from anon;
revoke update, delete, truncate on public.process_sources from authenticated;
grant update (title, kind, archived_at) on public.process_sources to authenticated;

alter table public.process_sources add column segment_count int generated always as (jsonb_array_length(segments)) stored;
