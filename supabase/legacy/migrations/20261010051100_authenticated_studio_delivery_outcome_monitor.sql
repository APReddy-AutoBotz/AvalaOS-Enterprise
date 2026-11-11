-- Authenticated Studio -> legacy Docs/Delivery authority and Delivery-owned
-- human outcome projection for Monitor. New writes default OFF. Rollback is
-- disablement plus read-only history; schema rollback is forward-only.

-- Exact nonproduction predecessor gate. The migration must not install over a
-- dirty marker, an active controlled-human exercise, or any live authorization.
DO $studio_delivery_source$
DECLARE
 marker public.hosted_pilot_environment_identity;
 marker_constraint text;exercise_constraint text;
 final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261010025331''';
 old_equal text:='marker.migration_tip=''20261010025331''';
 old_assert text:='marker.migration_tip = ''20261010025331''';
BEGIN
 LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
  WHERE conrelid='public.hosted_pilot_environment_identity'::regclass AND conname='hosted_pilot_environment_identity_migration_tip_check';
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
  WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass AND conname='pr_c_controlled_human_exercises_migration_tip_check';
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT final_activation_definition;
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT bootstrap_definition;
 SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT assert_marker_definition;
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT brd_v3_activation_definition;
 IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.migration_tip<>'20261010025331'
  OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  OR marker_constraint<>'(migration_tip = ''20261010025331''::text)'
  OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text, ''20261004025101''::text, ''20261004112232''::text, ''20261008022445''::text, ''20261009162752''::text, ''20261010025331''::text]))'
  OR (length(final_activation_definition)-length(replace(final_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
  OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_equal,'')))/length(old_equal)<>1
  OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
  OR (length(brd_v3_activation_definition)-length(replace(brd_v3_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
  OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
 THEN RAISE EXCEPTION 'STUDIO_DELIVERY_SOURCE_MISMATCH'; END IF;
END
$studio_delivery_source$;

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('studio.artifacts.publish','docs','Materialize a current approved Studio artifact as immutable structured legacy Docs work items'),
 ('delivery.outcomes.record','delivery','Record an explicit human Delivery outcome against exact imported-task ancestry'),
 ('delivery.pack.snapshot','delivery','Save an immutable point-in-time Delivery Pack from current authoritative project tasks and exact Studio ancestry'),
 ('delivery.outcomes.read','monitor','Read explicit Delivery outcomes and immutable Studio/Docs ancestry')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

CREATE TABLE public.studio_delivery_workspace_controls(
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 publication_writes_enabled boolean NOT NULL DEFAULT false,
 outcome_writes_enabled boolean NOT NULL DEFAULT false,
 pack_writes_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.studio_delivery_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL CHECK(action IN('studio.approved-artifact.publish','delivery.outcome.record','delivery.pack.snapshot')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 160),request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),status text NOT NULL CHECK(status IN('claimed','committed')),
 resource_id uuid,response jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(org_id,actor_id,action,idempotency_key),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_delivery_publications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,
 document_generation_id uuid NOT NULL,studio_artifact_id uuid NOT NULL,studio_artifact_version_id uuid NOT NULL,
 studio_artifact_version bigint NOT NULL CHECK(studio_artifact_version>0),studio_artifact_content_hash text NOT NULL CHECK(studio_artifact_content_hash~'^[0-9a-f]{64}$'),
 studio_aggregate_version bigint NOT NULL CHECK(studio_aggregate_version>0),source_case_id uuid NOT NULL,source_decision_id uuid NOT NULL,source_process_id uuid NOT NULL,
 source_assessment_id uuid NOT NULL,review_resolution_id uuid NOT NULL,govern_resolution_id uuid NOT NULL,
 work_item_digest text NOT NULL CHECK(work_item_digest~'^sha256:[0-9a-f]{64}$'),work_item_count integer NOT NULL CHECK(work_item_count BETWEEN 1 AND 100),
 published_by uuid NOT NULL REFERENCES public.profiles(id),publisher_authorization_version bigint NOT NULL CHECK(publisher_authorization_version>0),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.studio_delivery_command_receipts(id) ON DELETE RESTRICT,
 audit_event_id uuid NOT NULL UNIQUE,published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(document_generation_id,org_id),
 UNIQUE(org_id,workspace_id,project_id,studio_artifact_version_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(project_id,org_id) REFERENCES public.projects(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_artifact_version_id,studio_artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_case_id,workspace_id,org_id) REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_process_id,workspace_id,org_id) REFERENCES public.assess_processes(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_assessment_id,workspace_id,org_id) REFERENCES public.assessments(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(govern_resolution_id,source_case_id,source_decision_id,workspace_id,org_id) REFERENCES public.assess_v2_govern_resolutions(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT
);

ALTER TABLE public.document_generations
 ADD COLUMN studio_delivery_publication_id uuid,
 ADD COLUMN studio_artifact_id uuid,
 ADD COLUMN studio_artifact_version_id uuid,
 ADD COLUMN studio_artifact_content_hash text,
 ADD COLUMN studio_govern_resolution_id uuid,
 ADD COLUMN studio_work_item_digest text,
 ADD COLUMN publication_authorization_version bigint;

ALTER TABLE public.document_generations
 ADD CONSTRAINT document_generation_studio_publication_shape CHECK(
  (studio_delivery_publication_id IS NULL AND studio_artifact_id IS NULL AND studio_artifact_version_id IS NULL
   AND studio_artifact_content_hash IS NULL AND studio_govern_resolution_id IS NULL AND studio_work_item_digest IS NULL
   AND publication_authorization_version IS NULL)
  OR(studio_delivery_publication_id IS NOT NULL AND studio_artifact_id IS NOT NULL AND studio_artifact_version_id IS NOT NULL
   AND studio_artifact_content_hash~'^[0-9a-f]{64}$' AND studio_govern_resolution_id IS NOT NULL
   AND studio_work_item_digest~'^sha256:[0-9a-f]{64}$' AND publication_authorization_version>0)
 ) NOT VALID,
 ADD CONSTRAINT document_generation_studio_publication_fk
  FOREIGN KEY(studio_delivery_publication_id,org_id,workspace_id) REFERENCES public.studio_delivery_publications(id,org_id,workspace_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT document_generation_studio_artifact_fk
  FOREIGN KEY(studio_artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT document_generation_studio_version_fk
  FOREIGN KEY(studio_artifact_version_id,studio_artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT;

ALTER TABLE public.studio_delivery_publications
 ADD CONSTRAINT studio_delivery_publication_document_fk
 FOREIGN KEY(document_generation_id,org_id) REFERENCES public.document_generations(id,org_id)
 ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.legacy_delivery_outcome_aggregates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,task_id uuid NOT NULL,
 current_version_id uuid,version bigint NOT NULL DEFAULT 0 CHECK(version>=0),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(task_id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(project_id,org_id) REFERENCES public.projects(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(task_id,workspace_id,org_id) REFERENCES public.delivery_work_items(id,workspace_id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.legacy_delivery_outcome_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),outcome_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 project_id uuid NOT NULL,task_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),task_version bigint NOT NULL CHECK(task_version>0),
 status text NOT NULL CHECK(status IN('achieved','partial','not_achieved')),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 200),
 detail text NOT NULL CHECK(length(btrim(detail)) BETWEEN 1 AND 4000),publication_id uuid NOT NULL,document_generation_id uuid NOT NULL,
 studio_artifact_id uuid NOT NULL,studio_artifact_version_id uuid NOT NULL,legacy_import_id uuid NOT NULL,
 recorded_by uuid NOT NULL REFERENCES public.profiles(id),recorder_authorization_version bigint NOT NULL CHECK(recorder_authorization_version>0),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.studio_delivery_command_receipts(id) ON DELETE RESTRICT,audit_event_id uuid NOT NULL UNIQUE,
 recorded_at timestamptz NOT NULL DEFAULT now(),UNIQUE(outcome_id,version),UNIQUE(id,outcome_id,org_id,workspace_id),
 FOREIGN KEY(outcome_id,org_id,workspace_id) REFERENCES public.legacy_delivery_outcome_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(task_id,workspace_id,org_id) REFERENCES public.delivery_work_items(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(publication_id,org_id,workspace_id) REFERENCES public.studio_delivery_publications(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(document_generation_id,org_id) REFERENCES public.document_generations(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_artifact_version_id,studio_artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(legacy_import_id) REFERENCES public.legacy_delivery_imports(id) ON DELETE RESTRICT
);
ALTER TABLE public.legacy_delivery_outcome_aggregates
 ADD CONSTRAINT legacy_delivery_outcome_current_fk FOREIGN KEY(current_version_id,id,org_id,workspace_id)
 REFERENCES public.legacy_delivery_outcome_versions(id,outcome_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.legacy_delivery_pack_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,project_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),task_count integer NOT NULL CHECK(task_count>0),bound_task_count integer NOT NULL CHECK(bound_task_count BETWEEN 0 AND task_count),
 task_set_hash text NOT NULL CHECK(task_set_hash~'^sha256:[0-9a-f]{64}$'),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),creator_authorization_version bigint NOT NULL CHECK(creator_authorization_version>0),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.studio_delivery_command_receipts(id) ON DELETE RESTRICT,audit_event_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,workspace_id,project_id,version),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(project_id,org_id) REFERENCES public.projects(id,org_id) ON DELETE RESTRICT
);

CREATE INDEX studio_delivery_publications_project_idx ON public.studio_delivery_publications(org_id,workspace_id,project_id,published_at DESC);
CREATE INDEX legacy_delivery_outcome_project_idx ON public.legacy_delivery_outcome_aggregates(org_id,workspace_id,project_id,id);
CREATE INDEX legacy_delivery_pack_snapshot_project_idx ON public.legacy_delivery_pack_snapshots(org_id,workspace_id,project_id,version DESC);

ALTER TABLE public.studio_delivery_workspace_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_delivery_workspace_controls FORCE ROW LEVEL SECURITY;
ALTER TABLE public.studio_delivery_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_delivery_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.studio_delivery_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_delivery_publications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_outcome_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_outcome_aggregates FORCE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_outcome_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_outcome_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_pack_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_pack_snapshots FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.studio_delivery_reject_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'STUDIO_DELIVERY_IMMUTABLE'; END $$;
CREATE OR REPLACE FUNCTION public.studio_delivery_guard_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'claimed' OR NEW.status<>'committed'
  OR (to_jsonb(NEW)-ARRAY['status','resource_id','response','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resource_id','response','completed_at'])
  OR NEW.resource_id IS NULL OR NEW.response IS NULL OR NEW.completed_at IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_IMMUTABLE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_delivery_receipt_immutable BEFORE UPDATE OR DELETE ON public.studio_delivery_command_receipts FOR EACH ROW EXECUTE FUNCTION public.studio_delivery_guard_receipt();
CREATE TRIGGER studio_delivery_publication_immutable BEFORE UPDATE OR DELETE ON public.studio_delivery_publications FOR EACH ROW EXECUTE FUNCTION public.studio_delivery_reject_immutable();
CREATE TRIGGER legacy_delivery_outcome_version_immutable BEFORE UPDATE OR DELETE ON public.legacy_delivery_outcome_versions FOR EACH ROW EXECUTE FUNCTION public.studio_delivery_reject_immutable();
CREATE TRIGGER legacy_delivery_pack_snapshot_immutable BEFORE UPDATE OR DELETE ON public.legacy_delivery_pack_snapshots FOR EACH ROW EXECUTE FUNCTION public.studio_delivery_reject_immutable();

CREATE OR REPLACE FUNCTION public.studio_delivery_guard_document_generation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.studio_delivery_publication_id IS NOT NULL AND COALESCE(current_setting('app.studio_delivery_publish',true),'')<>'on' THEN
   RAISE EXCEPTION 'STUDIO_DELIVERY_IMMUTABLE';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.studio_delivery_publication_id IS NOT NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_IMMUTABLE'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER studio_delivery_document_guard BEFORE INSERT OR UPDATE OR DELETE ON public.document_generations
FOR EACH ROW EXECUTE FUNCTION public.studio_delivery_guard_document_generation();

CREATE OR REPLACE FUNCTION public.studio_delivery_hash_jsonb(p_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT 'sha256:'||encode(public.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION public.studio_delivery_claim_command(
 p_actor uuid,p_org uuid,p_workspace uuid,p_action text,p_idempotency text,p_request uuid,p_hash text
) RETURNS public.studio_delivery_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.studio_delivery_command_receipts;
BEGIN
 INSERT INTO public.studio_delivery_command_receipts(org_id,workspace_id,actor_id,action,idempotency_key,request_id,request_hash,status)
 VALUES(p_org,p_workspace,p_actor,p_action,p_idempotency,p_request,p_hash,'claimed')
 ON CONFLICT(org_id,actor_id,action,idempotency_key) DO NOTHING RETURNING * INTO receipt;
 IF receipt.id IS NULL THEN
  SELECT * INTO receipt FROM public.studio_delivery_command_receipts existing
   WHERE existing.org_id=p_org AND existing.actor_id=p_actor AND existing.action=p_action AND existing.idempotency_key=p_idempotency FOR UPDATE;
  IF receipt.workspace_id IS DISTINCT FROM p_workspace OR receipt.request_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'STUDIO_DELIVERY_IDEMPOTENCY_CONFLICT'; END IF;
  IF receipt.status<>'committed' OR receipt.response IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_COMMAND_IN_PROGRESS'; END IF;
 END IF;
 RETURN receipt;
END $$;

CREATE OR REPLACE FUNCTION public.studio_delivery_error(p_message text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('ok',false,'errorCode',CASE
  WHEN p_message LIKE '%STUDIO_DELIVERY_FEATURE_DISABLED%' THEN 'FEATURE_DISABLED'
  WHEN p_message LIKE '%STUDIO_DELIVERY_AUTHORIZATION_STALE%' OR p_message LIKE '%LEGACY_DELIVERY_AUTHORIZATION_STALE%'
   OR p_message LIKE '%PR1B_AUTHORIZATION_STALE%' THEN 'AUTHORIZATION_STALE'
  WHEN p_message LIKE '%STUDIO_DELIVERY_IDEMPOTENCY_CONFLICT%' THEN 'IDEMPOTENCY_CONFLICT'
  WHEN p_message LIKE '%STUDIO_DELIVERY_VERSION_CONFLICT%' THEN 'VERSION_CONFLICT'
  WHEN p_message LIKE '%STUDIO_DELIVERY_INVALID_COMMAND%' THEN 'INVALID_COMMAND'
  WHEN p_message LIKE '%STUDIO_DELIVERY_NOT_FOUND%' OR p_message LIKE '%LEGACY_DELIVERY_NOT_FOUND%'
   OR p_message LIKE '%PR1B_NOT_FOUND%' THEN 'NOT_FOUND'
  WHEN p_message LIKE '%STUDIO_DELIVERY_COMMAND_IN_PROGRESS%' THEN 'COMMAND_IN_PROGRESS'
  ELSE 'COMMAND_UNAVAILABLE' END)
$$;

CREATE OR REPLACE FUNCTION public.studio_delivery_publication_projection(p_row public.studio_delivery_publications) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('publicationId',p_row.id,'documentGenerationId',p_row.document_generation_id,'projectId',p_row.project_id,
  'artifactId',p_row.studio_artifact_id,'artifactVersionId',p_row.studio_artifact_version_id,'artifactVersion',p_row.studio_artifact_version,
  'artifactContentHash',p_row.studio_artifact_content_hash,'sourceProcessId',p_row.source_process_id,'sourceAssessmentId',p_row.source_assessment_id,
  'governResolutionId',p_row.govern_resolution_id,'workItemCount',p_row.work_item_count,'workItemDigest',p_row.work_item_digest,'publishedAt',p_row.published_at)
$$;

CREATE OR REPLACE FUNCTION public.studio_delivery_outcome_projection(p_row public.legacy_delivery_outcome_versions) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('outcomeId',p_row.outcome_id,'version',p_row.version,'taskId',p_row.task_id,'taskVersion',p_row.task_version,
  'projectId',p_row.project_id,'status',p_row.status,'label',p_row.label,'detail',p_row.detail,'documentGenerationId',p_row.document_generation_id,
  'studioArtifactId',p_row.studio_artifact_id,'studioArtifactVersionId',p_row.studio_artifact_version_id,
  'recordedBy',p_row.recorded_by,'recordedAt',p_row.recorded_at)
$$;

CREATE OR REPLACE FUNCTION public.studio_delivery_pack_snapshot_projection(p_row public.legacy_delivery_pack_snapshots) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('snapshotId',p_row.id,'version',p_row.version,'projectId',p_row.project_id,'taskCount',p_row.task_count,
  'boundTaskCount',p_row.bound_task_count,'taskSetHash',p_row.task_set_hash,'createdAt',p_row.created_at)
$$;

CREATE OR REPLACE FUNCTION public.studio_delivery_apply_command(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_authorization_version bigint,
 p_request_id uuid,p_idempotency_key text,p_action text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 capability text;receipt public.studio_delivery_command_receipts;control public.studio_delivery_workspace_controls;
 request_hash text;result jsonb;audit_id uuid:=gen_random_uuid();
 artifact public.studio_artifact_aggregates;artifact_version public.studio_artifact_versions;approval public.studio_artifact_approval_resolutions;
 source_case public.assess_v2_cases;source_assessment public.assessments;govern public.assess_v2_govern_resolutions;project_row public.projects;
 publication public.studio_delivery_publications;document_id uuid:=gen_random_uuid();publication_id uuid:=gen_random_uuid();
 work_items jsonb;normalized_items jsonb;primary_document jsonb;work_item_count integer;work_item_digest text;
 task public.delivery_work_items;import_row public.legacy_delivery_imports;document_row public.document_generations;
 outcome public.legacy_delivery_outcome_aggregates;outcome_version public.legacy_delivery_outcome_versions;
 pack_snapshot public.legacy_delivery_pack_snapshots;pack_tasks jsonb;pack_task_count integer;pack_bound_task_count integer;pack_version bigint;
 expected_outcome_version bigint;next_version bigint;writes_enabled boolean;
BEGIN
 IF p_actor_id IS NULL OR p_org_id IS NULL OR p_workspace_id IS NULL OR p_expected_authorization_version IS NULL OR p_request_id IS NULL
  OR p_idempotency_key IS NULL OR p_action NOT IN('studio.approved-artifact.publish','delivery.outcome.record','delivery.pack.snapshot') OR jsonb_typeof(p_payload)<>'object' THEN
  RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND';
 END IF;
 capability:=public.legacy_delivery_assert_any_authority(p_actor_id,p_org_id,p_workspace_id,
  CASE p_action WHEN 'studio.approved-artifact.publish' THEN ARRAY['org.admin','security.manage','roles.manage','project.manage','studio.artifacts.publish']
   WHEN 'delivery.outcome.record' THEN ARRAY['org.admin','security.manage','roles.manage','project.manage','delivery.outcomes.record']
   ELSE ARRAY['org.admin','security.manage','roles.manage','project.manage','delivery.pack.snapshot'] END,p_expected_authorization_version);
 request_hash:=public.studio_delivery_hash_jsonb(jsonb_build_object('schemaVersion','studio-delivery-command.v1','requestId',p_request_id,
  'organizationId',p_org_id,'workspaceId',p_workspace_id,'action',p_action,'payload',p_payload));
 receipt:=public.studio_delivery_claim_command(p_actor_id,p_org_id,p_workspace_id,p_action,p_idempotency_key,p_request_id,request_hash);
 IF receipt.status='committed' THEN
  IF p_action='studio.approved-artifact.publish' THEN
   SELECT * INTO publication FROM public.studio_delivery_publications row WHERE row.id=receipt.resource_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id;
   IF publication.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=publication.project_id AND p.org_id=p_org_id AND p.workspace_id=p_workspace_id AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  ELSIF p_action='delivery.outcome.record' THEN
   SELECT version.* INTO outcome_version FROM public.legacy_delivery_outcome_versions version
    JOIN public.legacy_delivery_outcome_aggregates aggregate ON aggregate.id=version.outcome_id AND aggregate.current_version_id=version.id
    JOIN public.delivery_work_items item ON item.id=version.task_id AND item.org_id=version.org_id AND item.workspace_id=version.workspace_id
    WHERE version.id=receipt.resource_id AND version.org_id=p_org_id AND version.workspace_id=p_workspace_id;
   IF outcome_version.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  ELSE
   SELECT * INTO pack_snapshot FROM public.legacy_delivery_pack_snapshots row
    WHERE row.id=receipt.resource_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id;
   IF pack_snapshot.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=pack_snapshot.project_id AND p.org_id=p_org_id AND p.workspace_id=p_workspace_id AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  END IF;
  RETURN jsonb_set(receipt.response,'{outcome}','"replayed"'::jsonb,false);
 END IF;
 SELECT * INTO control FROM public.studio_delivery_workspace_controls row WHERE row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR SHARE;
 writes_enabled:=CASE p_action WHEN 'studio.approved-artifact.publish' THEN control.publication_writes_enabled
  WHEN 'delivery.outcome.record' THEN control.outcome_writes_enabled ELSE control.pack_writes_enabled END;
 IF writes_enabled IS DISTINCT FROM true THEN RAISE EXCEPTION 'STUDIO_DELIVERY_FEATURE_DISABLED'; END IF;

 IF p_action='studio.approved-artifact.publish' THEN
  IF NOT public.legacy_delivery_jsonb_keys_allowed(p_payload,ARRAY['artifactId','expectedArtifactVersionId','expectedAggregateVersion','projectId','workItems'],ARRAY['artifactId','expectedArtifactVersionId','expectedAggregateVersion','projectId','workItems'])
   OR (p_payload->>'artifactId')!~*'^[0-9a-f-]{36}$' OR (p_payload->>'expectedArtifactVersionId')!~*'^[0-9a-f-]{36}$'
   OR (p_payload->>'projectId')!~*'^[0-9a-f-]{36}$' OR (p_payload->>'expectedAggregateVersion')!~'^[1-9][0-9]*$'
   OR jsonb_typeof(p_payload->'workItems')<>'array' OR jsonb_array_length(p_payload->'workItems') NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND';
  END IF;
  SELECT * INTO artifact FROM public.studio_artifact_aggregates row WHERE row.id=(p_payload->>'artifactId')::uuid
   AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR UPDATE;
  IF artifact.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  IF artifact.aggregate_version<>(p_payload->>'expectedAggregateVersion')::bigint OR artifact.current_approved_version_id IS DISTINCT FROM (p_payload->>'expectedArtifactVersionId')::uuid THEN RAISE EXCEPTION 'STUDIO_DELIVERY_VERSION_CONFLICT'; END IF;
  IF artifact.lifecycle<>'approved' OR artifact.source_mode NOT IN('assess_handoff','assess_plus_transcript_bundle') OR artifact.case_id IS NULL OR artifact.govern_resolution_id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  SELECT * INTO artifact_version FROM public.studio_artifact_versions row WHERE row.id=artifact.current_approved_version_id AND row.artifact_id=artifact.id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR SHARE;
  SELECT * INTO approval FROM public.studio_artifact_approval_resolutions row WHERE row.artifact_version_id=artifact_version.id AND row.artifact_id=artifact.id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id AND row.outcome='approved' FOR SHARE;
  SELECT * INTO govern FROM public.assess_v2_govern_resolutions row WHERE row.id=artifact.govern_resolution_id AND row.case_id=artifact.case_id AND row.review_resolution_id=artifact.review_resolution_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR SHARE;
  SELECT * INTO source_case FROM public.assess_v2_cases row WHERE row.id=artifact.case_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id AND row.deleted_at IS NULL FOR SHARE;
  SELECT * INTO project_row FROM public.projects row WHERE row.id=(p_payload->>'projectId')::uuid AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id
   AND row.source_process_id=source_case.process_id AND row.source_assessment_id IS NOT NULL
   AND row.status='active' AND row.archived_at IS NULL AND row.deleted_at IS NULL FOR SHARE;
  SELECT * INTO source_assessment FROM public.assessments row WHERE row.id=project_row.source_assessment_id
   AND row.process_id=source_case.process_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id AND row.deleted_at IS NULL FOR SHARE;
  IF artifact_version.id IS NULL OR artifact_version.lifecycle<>'approved' OR approval.id IS NULL OR govern.id IS NULL OR source_case.id IS NULL OR source_assessment.id IS NULL OR project_row.id IS NULL
   OR (source_case.source_v1_assessment_id IS NOT NULL AND (source_case.source_v1_assessment_id IS DISTINCT FROM source_assessment.id
    OR source_case.source_v1_score_version IS DISTINCT FROM source_assessment.score_version)) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  IF artifact.artifact_type NOT IN('brd','frd','pdd') OR jsonb_typeof(artifact_version.content) IS DISTINCT FROM 'object'
   OR pg_column_size(artifact_version.content)>1048576 OR jsonb_typeof(artifact_version.content->'title') IS DISTINCT FROM 'string'
   OR length(btrim(artifact_version.content->>'title')) NOT BETWEEN 1 AND 300
   OR jsonb_typeof(artifact_version.content->'sections') IS DISTINCT FROM 'array'
   OR jsonb_array_length(artifact_version.content->'sections') NOT BETWEEN 1 AND 100
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(artifact_version.content->'sections') section WHERE jsonb_typeof(section)<>'object'
    OR(section?'id' AND jsonb_typeof(section->'id') IS DISTINCT FROM 'string')
    OR(section?'key' AND jsonb_typeof(section->'key') IS DISTINCT FROM 'string')
    OR(jsonb_typeof(section->'id') IS DISTINCT FROM 'string' AND jsonb_typeof(section->'key') IS DISTINCT FROM 'string')
    OR(section?'id' AND section?'key' AND section->>'id' IS DISTINCT FROM section->>'key')
    OR COALESCE(section->>'id',section->>'key','')!~'^[A-Za-z][A-Za-z0-9_.-]{0,79}$'
    OR jsonb_typeof(section->'title') IS DISTINCT FROM 'string' OR length(btrim(section->>'title')) NOT BETWEEN 1 AND 300
    OR(section?'body' AND jsonb_typeof(section->'body') IS DISTINCT FROM 'string')
    OR(section?'content' AND jsonb_typeof(section->'content') IS DISTINCT FROM 'string')
    OR(jsonb_typeof(section->'body') IS DISTINCT FROM 'string' AND jsonb_typeof(section->'content') IS DISTINCT FROM 'string')
    OR(section?'body' AND section?'content' AND section->>'body' IS DISTINCT FROM section->>'content')
    OR length(COALESCE(section->>'body',section->>'content',''))>20000)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(artifact_version.content->'sections') section
    GROUP BY COALESCE(section->>'id',section->>'key') HAVING count(*)>1) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  SELECT jsonb_build_object('title',artifact_version.content->>'title','sections',jsonb_agg(jsonb_build_object(
    'key',COALESCE(section->>'id',section->>'key'),'title',section->>'title','content',COALESCE(section->>'body',section->>'content')) ORDER BY ordinal))
   INTO primary_document FROM jsonb_array_elements(artifact_version.content->'sections') WITH ORDINALITY source(section,ordinal);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'workItems') item WHERE jsonb_typeof(item)<>'object'
    OR NOT public.legacy_delivery_jsonb_keys_allowed(item,ARRAY['type','title','description','acceptanceCriteria'],ARRAY['type','title','description','acceptanceCriteria'])
    OR item->>'type' NOT IN('Epic','Story','Task') OR jsonb_typeof(item->'title')<>'string' OR length(btrim(item->>'title')) NOT BETWEEN 1 AND 300
    OR jsonb_typeof(item->'description')<>'string' OR length(item->>'description')>20000 OR jsonb_typeof(item->'acceptanceCriteria')<>'array'
    OR jsonb_array_length(item->'acceptanceCriteria')>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(item->'acceptanceCriteria') criterion WHERE jsonb_typeof(criterion)<>'string' OR length(criterion#>>'{}')>2000)
  ) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND'; END IF;
  SELECT jsonb_agg(jsonb_build_object('type',item->>'type','title',btrim(item->>'title'),'description',item->>'description','acceptanceCriteria',item->'acceptanceCriteria') ORDER BY ordinal),count(*)
   INTO normalized_items,work_item_count FROM jsonb_array_elements(p_payload->'workItems') WITH ORDINALITY source(item,ordinal);
  work_item_digest:=public.studio_delivery_hash_jsonb(normalized_items);
  IF EXISTS(SELECT 1 FROM public.studio_delivery_publications existing WHERE existing.org_id=p_org_id AND existing.workspace_id=p_workspace_id AND existing.project_id=project_row.id AND existing.studio_artifact_version_id=artifact_version.id) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_VERSION_CONFLICT'; END IF;
  INSERT INTO public.studio_delivery_publications(id,org_id,workspace_id,project_id,document_generation_id,studio_artifact_id,studio_artifact_version_id,
   studio_artifact_version,studio_artifact_content_hash,studio_aggregate_version,source_case_id,source_decision_id,source_process_id,source_assessment_id,review_resolution_id,govern_resolution_id,
   work_item_digest,work_item_count,published_by,publisher_authorization_version,receipt_id,audit_event_id)
  VALUES(publication_id,p_org_id,p_workspace_id,project_row.id,document_id,artifact.id,artifact_version.id,artifact_version.version,artifact_version.content_hash,
   artifact.aggregate_version,source_case.id,artifact.decision_id,source_case.process_id,source_assessment.id,artifact.review_resolution_id,govern.id,work_item_digest,work_item_count,
   p_actor_id,p_expected_authorization_version,receipt.id,audit_id) RETURNING * INTO publication;
  PERFORM set_config('app.studio_delivery_publish','on',true);
  INSERT INTO public.document_generations(id,org_id,workspace_id,project_id,template_id,generated_at,artifacts,status,created_by,updated_by,
   source_process_id,source_assessment_id,audit_correlation_id,studio_delivery_publication_id,studio_artifact_id,studio_artifact_version_id,
   studio_artifact_content_hash,studio_govern_resolution_id,studio_work_item_digest,publication_authorization_version)
  VALUES(document_id,p_org_id,p_workspace_id,project_row.id,'studio-approved-'||artifact.artifact_type,statement_timestamp(),
   jsonb_build_object('schemaVersion','studio-approved-work-items.v1',artifact.artifact_type,primary_document,
    'approvedStudioContent',artifact_version.content,'workItems',normalized_items,'source',jsonb_build_object(
    'publicationId',publication.id,'artifactId',artifact.id,'artifactVersionId',artifact_version.id,'artifactVersion',artifact_version.version,
    'artifactContentHash',artifact_version.content_hash,'caseId',source_case.id,'processId',source_case.process_id,'assessmentId',source_assessment.id,
    'reviewResolutionId',artifact.review_resolution_id,'governResolutionId',govern.id,'workItemDigest',work_item_digest)),
   'generated',p_actor_id,p_actor_id,source_case.process_id,source_assessment.id,p_request_id::text,publication.id,artifact.id,artifact_version.id,
   artifact_version.content_hash,govern.id,work_item_digest,p_expected_authorization_version);
  result:=jsonb_build_object('ok',true,'schemaVersion','studio-delivery-command.v1','action',p_action,'outcome','committed','receiptId',receipt.id,
   'resource',public.studio_delivery_publication_projection(publication));
  INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,'studio.approved-artifact.publish','studio_delivery_publication',publication.id,'succeeded',1,
   jsonb_build_object('documentGenerationId',document_id,'artifactId',artifact.id,'artifactVersionId',artifact_version.id,'projectId',project_row.id,'workItemCount',work_item_count,'workItemDigest',work_item_digest));
 ELSIF p_action='delivery.outcome.record' THEN
  IF NOT public.legacy_delivery_jsonb_keys_allowed(p_payload,ARRAY['taskId','expectedTaskVersion','expectedOutcomeVersion','status','label','detail'],ARRAY['taskId','expectedTaskVersion','expectedOutcomeVersion','status','label','detail'])
   OR (p_payload->>'taskId')!~*'^[0-9a-f-]{36}$' OR (p_payload->>'expectedTaskVersion')!~'^[1-9][0-9]*$'
   OR NOT(p_payload->'expectedOutcomeVersion'='null'::jsonb OR (p_payload->>'expectedOutcomeVersion')~'^[1-9][0-9]*$')
   OR p_payload->>'status' NOT IN('achieved','partial','not_achieved') OR jsonb_typeof(p_payload->'label')<>'string'
   OR length(btrim(p_payload->>'label')) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_payload->'detail')<>'string'
   OR length(btrim(p_payload->>'detail')) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND'; END IF;
  SELECT * INTO task FROM public.delivery_work_items row WHERE row.id=(p_payload->>'taskId')::uuid AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id AND row.authority_version IS NOT NULL FOR UPDATE;
  IF task.id IS NULL OR task.authority_version<>(p_payload->>'expectedTaskVersion')::bigint OR task.legacy_import_id IS NULL OR task.document_generation_id IS NULL OR task.retention_state NOT IN('active','retained') THEN RAISE EXCEPTION 'STUDIO_DELIVERY_VERSION_CONFLICT'; END IF;
  SELECT * INTO project_row FROM public.projects row WHERE row.id=task.project_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id AND row.status='active' AND row.archived_at IS NULL AND row.deleted_at IS NULL FOR SHARE;
  SELECT * INTO import_row FROM public.legacy_delivery_imports row WHERE row.id=task.legacy_import_id AND row.source_generation_id=task.document_generation_id AND row.project_id=task.project_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR SHARE;
  SELECT * INTO document_row FROM public.document_generations row WHERE row.id=task.document_generation_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id AND row.project_id=task.project_id AND row.studio_delivery_publication_id IS NOT NULL FOR SHARE;
  SELECT * INTO publication FROM public.studio_delivery_publications row WHERE row.id=document_row.studio_delivery_publication_id AND row.document_generation_id=document_row.id AND row.project_id=task.project_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR SHARE;
  IF project_row.id IS NULL OR import_row.id IS NULL OR document_row.id IS NULL OR publication.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  SELECT * INTO outcome FROM public.legacy_delivery_outcome_aggregates row WHERE row.task_id=task.id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id FOR UPDATE;
  expected_outcome_version:=CASE WHEN p_payload->'expectedOutcomeVersion'='null'::jsonb THEN NULL ELSE (p_payload->>'expectedOutcomeVersion')::bigint END;
  IF outcome.id IS NULL THEN
   IF expected_outcome_version IS NOT NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_VERSION_CONFLICT'; END IF;
   INSERT INTO public.legacy_delivery_outcome_aggregates(org_id,workspace_id,project_id,task_id) VALUES(p_org_id,p_workspace_id,task.project_id,task.id) RETURNING * INTO outcome;
  ELSIF expected_outcome_version IS NULL OR outcome.version<>expected_outcome_version THEN RAISE EXCEPTION 'STUDIO_DELIVERY_VERSION_CONFLICT'; END IF;
  next_version:=outcome.version+1;
  INSERT INTO public.legacy_delivery_outcome_versions(outcome_id,org_id,workspace_id,project_id,task_id,version,task_version,status,label,detail,
   publication_id,document_generation_id,studio_artifact_id,studio_artifact_version_id,legacy_import_id,recorded_by,recorder_authorization_version,receipt_id,audit_event_id)
  VALUES(outcome.id,p_org_id,p_workspace_id,task.project_id,task.id,next_version,task.authority_version,p_payload->>'status',btrim(p_payload->>'label'),btrim(p_payload->>'detail'),
   publication.id,document_row.id,publication.studio_artifact_id,publication.studio_artifact_version_id,import_row.id,p_actor_id,p_expected_authorization_version,receipt.id,audit_id)
  RETURNING * INTO outcome_version;
  UPDATE public.legacy_delivery_outcome_aggregates SET current_version_id=outcome_version.id,version=next_version,updated_at=statement_timestamp() WHERE id=outcome.id;
  result:=jsonb_build_object('ok',true,'schemaVersion','studio-delivery-command.v1','action',p_action,'outcome','committed','receiptId',receipt.id,
   'resource',public.studio_delivery_outcome_projection(outcome_version));
  INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,'delivery.outcome.record','legacy_delivery_outcome',outcome.id,'succeeded',next_version,
   jsonb_build_object('taskId',task.id,'taskVersion',task.authority_version,'projectId',task.project_id,'publicationId',publication.id,'documentGenerationId',document_row.id,'status',outcome_version.status));
 ELSE
  IF NOT public.legacy_delivery_jsonb_keys_allowed(p_payload,ARRAY['projectId'],ARRAY['projectId']) OR (p_payload->>'projectId')!~*'^[0-9a-f-]{36}$' THEN
   RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND';
  END IF;
  SELECT * INTO project_row FROM public.projects row WHERE row.id=(p_payload->>'projectId')::uuid AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id
   AND row.status='active' AND row.archived_at IS NULL AND row.deleted_at IS NULL FOR UPDATE;
  IF project_row.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.delivery_work_items item WHERE item.org_id=p_org_id AND item.workspace_id=p_workspace_id AND item.project_id=project_row.id
   AND item.authority_version IS NOT NULL AND item.retention_state='active' ORDER BY item.id FOR SHARE;
  IF EXISTS(
   SELECT 1 FROM public.delivery_work_items item
   LEFT JOIN public.legacy_delivery_imports imported ON imported.id=item.legacy_import_id AND imported.org_id=item.org_id AND imported.workspace_id=item.workspace_id
    AND imported.project_id=item.project_id AND imported.source_generation_id=item.document_generation_id
   LEFT JOIN public.document_generations generation ON generation.id=item.document_generation_id AND generation.org_id=item.org_id
    AND generation.workspace_id=item.workspace_id AND generation.project_id=item.project_id
   LEFT JOIN public.studio_delivery_publications published ON published.id=generation.studio_delivery_publication_id AND published.org_id=item.org_id
    AND published.workspace_id=item.workspace_id AND published.project_id=item.project_id AND published.document_generation_id=generation.id
   WHERE item.org_id=p_org_id AND item.workspace_id=p_workspace_id AND item.project_id=project_row.id AND item.authority_version IS NOT NULL
    AND item.retention_state='active' AND item.legacy_import_id IS NOT NULL
    AND(imported.id IS NULL OR generation.id IS NULL OR published.id IS NULL OR item.source_process_id IS DISTINCT FROM published.source_process_id
     OR item.source_assessment_id IS DISTINCT FROM published.source_assessment_id)
  ) THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'task',public.legacy_delivery_task_projection(item),
    'studioAncestry',CASE WHEN item.legacy_import_id IS NULL THEN NULL ELSE jsonb_build_object(
      'importId',imported.id,'documentGenerationId',generation.id,'publicationId',published.id,
      'studioArtifactId',published.studio_artifact_id,'studioArtifactVersionId',published.studio_artifact_version_id,
      'sourceProcessId',published.source_process_id,'sourceAssessmentId',published.source_assessment_id,'workItemDigest',published.work_item_digest) END
   ) ORDER BY item.id),count(*),count(*) FILTER(WHERE item.legacy_import_id IS NOT NULL)
   INTO pack_tasks,pack_task_count,pack_bound_task_count
  FROM public.delivery_work_items item
  LEFT JOIN public.legacy_delivery_imports imported ON imported.id=item.legacy_import_id AND imported.org_id=item.org_id AND imported.workspace_id=item.workspace_id
   AND imported.project_id=item.project_id AND imported.source_generation_id=item.document_generation_id
  LEFT JOIN public.document_generations generation ON generation.id=item.document_generation_id AND generation.org_id=item.org_id
   AND generation.workspace_id=item.workspace_id AND generation.project_id=item.project_id
  LEFT JOIN public.studio_delivery_publications published ON published.id=generation.studio_delivery_publication_id AND published.org_id=item.org_id
   AND published.workspace_id=item.workspace_id AND published.project_id=item.project_id AND published.document_generation_id=generation.id
  WHERE item.org_id=p_org_id AND item.workspace_id=p_workspace_id AND item.project_id=project_row.id AND item.authority_version IS NOT NULL AND item.retention_state='active';
  IF pack_task_count<1 THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
  SELECT COALESCE(max(existing.version),0)+1 INTO pack_version FROM public.legacy_delivery_pack_snapshots existing
   WHERE existing.org_id=p_org_id AND existing.workspace_id=p_workspace_id AND existing.project_id=project_row.id;
  INSERT INTO public.legacy_delivery_pack_snapshots(org_id,workspace_id,project_id,version,task_count,bound_task_count,task_set_hash,snapshot,
   created_by,creator_authorization_version,receipt_id,audit_event_id)
  VALUES(p_org_id,p_workspace_id,project_row.id,pack_version,pack_task_count,pack_bound_task_count,public.studio_delivery_hash_jsonb(pack_tasks),
   jsonb_build_object('schemaVersion','legacy-delivery-pack-snapshot.v1','project',jsonb_build_object('id',project_row.id,'name',project_row.name),
    'tasks',pack_tasks),p_actor_id,p_expected_authorization_version,receipt.id,audit_id) RETURNING * INTO pack_snapshot;
  result:=jsonb_build_object('ok',true,'schemaVersion','studio-delivery-command.v1','action',p_action,'outcome','committed','receiptId',receipt.id,
   'resource',public.studio_delivery_pack_snapshot_projection(pack_snapshot));
  INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,'delivery.pack.snapshot','legacy_delivery_pack_snapshot',pack_snapshot.id,'succeeded',pack_snapshot.version,
   jsonb_build_object('projectId',project_row.id,'taskCount',pack_task_count,'boundTaskCount',pack_bound_task_count,'taskSetHash',pack_snapshot.task_set_hash));
 END IF;
 UPDATE public.studio_delivery_command_receipts SET status='committed',resource_id=CASE p_action WHEN 'studio.approved-artifact.publish' THEN publication.id
  WHEN 'delivery.outcome.record' THEN outcome_version.id ELSE pack_snapshot.id END,
  response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%STUDIO_DELIVERY_%' AND SQLERRM NOT LIKE '%PR1B_%' THEN RAISE LOG 'STUDIO_DELIVERY_COMMAND_UNAVAILABLE action=% sqlstate=%',p_action,SQLSTATE; END IF;
 RETURN public.studio_delivery_error(SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.studio_delivery_outcome_query(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_authorization_version bigint,p_project_id uuid,
 p_limit integer DEFAULT 100,p_cursor uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE project_row public.projects;items jsonb;next_cursor uuid;has_more boolean;
BEGIN
 PERFORM public.legacy_delivery_assert_any_authority(p_actor_id,p_org_id,p_workspace_id,
  ARRAY['org.admin','security.manage','roles.manage','project.manage','delivery.outcomes.read','task.read','backlog.read'],p_expected_authorization_version);
 IF p_project_id IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND'; END IF;
 SELECT * INTO project_row FROM public.projects row WHERE row.id=p_project_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id
  AND row.status='active' AND row.archived_at IS NULL AND row.deleted_at IS NULL;
 IF project_row.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
 SELECT COALESCE(jsonb_agg(page.projection ORDER BY page.id),'[]'::jsonb),max(page.id::text)::uuid INTO items,next_cursor FROM(
  SELECT aggregate.id,public.studio_delivery_outcome_projection(outcome_version) projection
  FROM public.legacy_delivery_outcome_aggregates aggregate
  JOIN public.legacy_delivery_outcome_versions outcome_version ON outcome_version.id=aggregate.current_version_id AND outcome_version.outcome_id=aggregate.id
  JOIN public.delivery_work_items task ON task.id=aggregate.task_id AND task.org_id=aggregate.org_id AND task.workspace_id=aggregate.workspace_id AND task.project_id=aggregate.project_id
  JOIN public.legacy_delivery_imports imported ON imported.id=outcome_version.legacy_import_id AND imported.project_id=aggregate.project_id AND imported.source_generation_id=outcome_version.document_generation_id
  JOIN public.studio_delivery_publications publication ON publication.id=outcome_version.publication_id AND publication.project_id=aggregate.project_id AND publication.document_generation_id=outcome_version.document_generation_id
  WHERE aggregate.org_id=p_org_id AND aggregate.workspace_id=p_workspace_id AND aggregate.project_id=p_project_id AND(p_cursor IS NULL OR aggregate.id>p_cursor)
  ORDER BY aggregate.id LIMIT p_limit
 ) page;
 SELECT COALESCE(next_cursor IS NOT NULL AND EXISTS(SELECT 1 FROM public.legacy_delivery_outcome_aggregates aggregate
  WHERE aggregate.org_id=p_org_id AND aggregate.workspace_id=p_workspace_id AND aggregate.project_id=p_project_id AND aggregate.id>next_cursor),false) INTO has_more;
 IF NOT has_more THEN next_cursor:=NULL; END IF;
 RETURN jsonb_build_object('ok',true,'schemaVersion','studio-delivery-outcome-query.v1','projectId',p_project_id,'items',items,
  'page',jsonb_build_object('limit',p_limit,'nextCursor',next_cursor,'hasMore',has_more));
EXCEPTION WHEN OTHERS THEN RETURN public.studio_delivery_error(SQLERRM); END $$;

CREATE OR REPLACE FUNCTION public.studio_delivery_pack_snapshot_query(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_authorization_version bigint,p_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE project_row public.projects;snapshot_row public.legacy_delivery_pack_snapshots;
BEGIN
 PERFORM public.legacy_delivery_assert_any_authority(p_actor_id,p_org_id,p_workspace_id,
  ARRAY['org.admin','security.manage','roles.manage','project.manage','delivery.pack.snapshot'],p_expected_authorization_version);
 IF p_project_id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND'; END IF;
 SELECT * INTO project_row FROM public.projects row WHERE row.id=p_project_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id
  AND row.status='active' AND row.archived_at IS NULL AND row.deleted_at IS NULL;
 IF project_row.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
 SELECT * INTO snapshot_row FROM public.legacy_delivery_pack_snapshots row WHERE row.org_id=p_org_id AND row.workspace_id=p_workspace_id
  AND row.project_id=p_project_id ORDER BY row.version DESC LIMIT 1;
 RETURN jsonb_build_object('ok',true,'schemaVersion','studio-delivery-pack-query.v1','projectId',p_project_id,
  'latestSnapshot',CASE WHEN snapshot_row.id IS NULL THEN NULL ELSE public.studio_delivery_pack_snapshot_projection(snapshot_row) END);
EXCEPTION WHEN OTHERS THEN RETURN public.studio_delivery_error(SQLERRM); END $$;

CREATE OR REPLACE FUNCTION public.studio_delivery_assignee_query(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_authorization_version bigint,p_project_id uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE project_row public.projects;eligible_count integer;items jsonb;
BEGIN
 PERFORM public.legacy_delivery_assert_any_authority(p_actor_id,p_org_id,p_workspace_id,
  ARRAY['org.admin','security.manage','roles.manage','task.assign','project.manage'],p_expected_authorization_version);
 IF p_project_id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_INVALID_COMMAND'; END IF;
 SELECT * INTO project_row FROM public.projects row WHERE row.id=p_project_id AND row.org_id=p_org_id AND row.workspace_id=p_workspace_id
  AND row.status='active' AND row.archived_at IS NULL AND row.deleted_at IS NULL;
 IF project_row.id IS NULL THEN RAISE EXCEPTION 'STUDIO_DELIVERY_NOT_FOUND'; END IF;
 SELECT count(*)::integer INTO eligible_count FROM public.profiles profile
 JOIN public.organization_members member ON member.user_id=profile.id AND member.org_id=p_org_id
 JOIN public.workspace_memberships workspace_member ON workspace_member.user_id=profile.id AND workspace_member.org_id=p_org_id
  AND workspace_member.workspace_id=p_workspace_id
 WHERE profile.status='active' AND profile.deleted_at IS NULL AND member.status='active' AND member.deleted_at IS NULL
  AND workspace_member.status='active' AND workspace_member.deleted_at IS NULL;
 IF eligible_count>500 THEN RAISE EXCEPTION 'STUDIO_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',eligible.id,'displayName',eligible.display_name)
  ORDER BY lower(eligible.display_name),eligible.id),'[]'::jsonb) INTO items FROM(
  SELECT profile.id,COALESCE(NULLIF(left(btrim(profile.full_name),240),''),'Unnamed member') display_name
  FROM public.profiles profile
  JOIN public.organization_members member ON member.user_id=profile.id AND member.org_id=p_org_id
  JOIN public.workspace_memberships workspace_member ON workspace_member.user_id=profile.id AND workspace_member.org_id=p_org_id
   AND workspace_member.workspace_id=p_workspace_id
  WHERE profile.status='active' AND profile.deleted_at IS NULL AND member.status='active' AND member.deleted_at IS NULL
   AND workspace_member.status='active' AND workspace_member.deleted_at IS NULL
 ) eligible;
 RETURN jsonb_build_object('ok',true,'schemaVersion','studio-delivery-assignee-query.v1','projectId',p_project_id,'items',items);
EXCEPTION WHEN OTHERS THEN RETURN public.studio_delivery_error(SQLERRM); END $$;

REVOKE ALL ON TABLE public.studio_delivery_workspace_controls,public.studio_delivery_command_receipts,public.studio_delivery_publications,
 public.legacy_delivery_outcome_aggregates,public.legacy_delivery_outcome_versions,public.legacy_delivery_pack_snapshots FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION public.studio_delivery_reject_immutable(),public.studio_delivery_guard_receipt(),public.studio_delivery_guard_document_generation(),
 public.studio_delivery_hash_jsonb(jsonb),public.studio_delivery_claim_command(uuid,uuid,uuid,text,text,uuid,text),public.studio_delivery_error(text),
 public.studio_delivery_publication_projection(public.studio_delivery_publications),public.studio_delivery_outcome_projection(public.legacy_delivery_outcome_versions),
 public.studio_delivery_pack_snapshot_projection(public.legacy_delivery_pack_snapshots),
 public.studio_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),public.studio_delivery_outcome_query(uuid,uuid,uuid,bigint,uuid,integer,uuid),
 public.studio_delivery_pack_snapshot_query(uuid,uuid,uuid,bigint,uuid),public.studio_delivery_assignee_query(uuid,uuid,uuid,bigint,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.studio_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
 public.studio_delivery_outcome_query(uuid,uuid,uuid,bigint,uuid,integer,uuid),public.studio_delivery_pack_snapshot_query(uuid,uuid,uuid,bigint,uuid),
 public.studio_delivery_assignee_query(uuid,uuid,uuid,bigint,uuid) TO service_role;

COMMENT ON TABLE public.studio_delivery_publications IS 'Immutable server-authorized binding from one current approved assessed Studio artifact version and a human-approved structured work-item payload to one legacy Docs generation. Browser prose parsing and provider task generation are prohibited.';
COMMENT ON TABLE public.legacy_delivery_outcome_versions IS 'Immutable human-authored Delivery outcome versions tied to exact authoritative imported task, Docs publication and approved Studio ancestry. Monitor reads current versions without writing or inferring values.';
COMMENT ON TABLE public.legacy_delivery_pack_snapshots IS 'Immutable point-in-time Delivery Pack snapshots derived server-side from current authoritative project tasks and exact imported Studio publication ancestry.';
COMMENT ON FUNCTION public.studio_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) IS 'Service-only atomic publish/outcome/pack snapshot command. Reauthorizes current actor, defaults writes off, validates exact lineage and idempotency, and commits receipt, effect and audit together.';
COMMENT ON FUNCTION public.studio_delivery_outcome_query(uuid,uuid,uuid,bigint,uuid,integer,uuid) IS 'Service-only, read-only, tenant/project-scoped current outcome projection. It returns no inferred or fallback values.';
COMMENT ON FUNCTION public.studio_delivery_pack_snapshot_query(uuid,uuid,uuid,bigint,uuid) IS 'Service-only, read-only tenant/project-scoped latest saved Delivery Pack snapshot projection.';
COMMENT ON FUNCTION public.studio_delivery_assignee_query(uuid,uuid,uuid,bigint,uuid) IS 'Service-only, read-only exact-project assignment-authority projection of active eligible workspace member IDs and display names. It returns no email, role or capability data.';

-- Advance the exact marker and each retained nonproduction consumer only after
-- the complete schema, authority, ACL and immutable-history contract succeeds.
DO $studio_delivery_marker$
DECLARE
 final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261010025331''';new_not_equal text:='marker.migration_tip<>''20261010051100''';
 old_equal text:='marker.migration_tip=''20261010025331''';new_equal text:='marker.migration_tip=''20261010051100''';
 old_assert text:='marker.migration_tip = ''20261010025331''';new_assert text:='marker.migration_tip = ''20261010051100''';
BEGIN
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT final_activation_definition;
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT bootstrap_definition;
 SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT assert_marker_definition;
 SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10)) INTO STRICT brd_v3_activation_definition;
 EXECUTE replace(final_activation_definition,old_not_equal,new_not_equal);
 EXECUTE replace(bootstrap_definition,old_equal,new_equal);
 EXECUTE replace(assert_marker_definition,old_assert,new_assert);
 EXECUTE replace(brd_v3_activation_definition,old_not_equal,new_not_equal);
 ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
 ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
  CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232','20261008022445','20261009162752','20261010025331','20261010051100'));
 ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
 UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261010051100' WHERE singleton;
 ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20261010051100');
END
$studio_delivery_marker$;
