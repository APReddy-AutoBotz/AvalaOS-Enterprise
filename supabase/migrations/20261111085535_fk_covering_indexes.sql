-- Covering indexes for the composite (child, workspace) foreign keys, so cascades and joins stay fast.
-- Single-column indexes that the new ones make redundant are dropped.

create index assessments_model_revision_fk_idx on public.assessments (model_revision_id, workspace_id);
create index assessments_process_fk_idx on public.assessments (process_id, workspace_id);
drop index public.assessments_process_id_idx;

create index delivery_work_items_project_fk_idx on public.delivery_work_items (project_id, workspace_id);

create index document_revisions_document_fk_idx on public.document_revisions (document_id, workspace_id);
create index documents_process_fk_idx on public.documents (process_id, workspace_id);
create index flow_diagrams_process_fk_idx on public.flow_diagrams (process_id, workspace_id);

create index process_model_edits_process_fk_idx on public.process_model_edits (process_id, workspace_id);
create index process_model_edits_revision_fk_idx on public.process_model_edits (revision_id, workspace_id);
drop index public.process_model_edits_process_id_idx;

create index process_model_revisions_process_fk_idx on public.process_model_revisions (process_id, workspace_id);

create index proposal_requirements_proposal_fk_idx on public.proposal_requirements (proposal_id, workspace_id);
create index proposal_requirements_requirement_fk_idx on public.proposal_requirements (requirement_id, workspace_id);
drop index public.proposal_requirements_requirement_id_idx;

create index requirements_process_fk_idx on public.requirements (process_id, workspace_id);

create index work_item_proposals_process_fk_idx on public.work_item_proposals (process_id, workspace_id);
drop index public.work_item_proposals_process_id_idx;

create index work_item_requirements_work_item_fk_idx on public.work_item_requirements (work_item_id, workspace_id);
create index work_item_requirements_requirement_fk_idx on public.work_item_requirements (requirement_id, workspace_id);
drop index public.work_item_requirements_requirement_id_idx;
