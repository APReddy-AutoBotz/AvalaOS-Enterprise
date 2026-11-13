-- A person's edits to the narrative of a document section. The generated document is rebuilt from the
-- model every time; an edit replaces the section's narrative until the person takes the update.
-- base_hash is the hash of the generated narrative the edit was made against: when the generated text
-- changes, the section shows "needs review". Members read; editors and admins write and remove.

create table public.document_edits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  doc_type text not null check (doc_type in ('brd', 'pdd', 'frd', 'sdd')),
  section_key text not null check (length(section_key) between 1 and 80),
  html text not null check (length(html) <= 100000),
  base_hash text not null check (length(base_hash) between 1 and 64),
  updated_by uuid not null default auth.uid(),
  updated_at timestamptz not null default now(),
  foreign key (process_id, workspace_id) references public.processes (id, workspace_id) on delete cascade,
  unique (process_id, doc_type, section_key)
);
create index document_edits_workspace_id_idx on public.document_edits (workspace_id);
create index document_edits_updated_by_idx on public.document_edits (updated_by);

alter table public.document_edits enable row level security;

create policy document_edits_select on public.document_edits for select to authenticated
  using (app_private.is_workspace_member(workspace_id));
create policy document_edits_insert on public.document_edits for insert to authenticated
  with check (app_private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy document_edits_update on public.document_edits for update to authenticated
  using (app_private.can_edit_workspace(workspace_id))
  with check (app_private.can_edit_workspace(workspace_id) and updated_by = (select auth.uid()));
create policy document_edits_delete on public.document_edits for delete to authenticated
  using (app_private.can_edit_workspace(workspace_id));

revoke all on public.document_edits from anon;
revoke truncate on public.document_edits from authenticated;
