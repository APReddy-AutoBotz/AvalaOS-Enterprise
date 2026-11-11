-- Legacy Delivery task/import authority.
--
-- This migration promotes the existing delivery_work_items table for the
-- original Docs -> Delivery Task workflow. It does not replace that workflow
-- with governed Delivery/Monitor PR C packages. Existing rows are preserved
-- unchanged and remain read-only until they have authoritative version and
-- lineage created by the service-only command below.

-- The hosted-pilot marker and every current exact-tip consumer are migration
-- inputs. Abort before adding authority when this file is not the exact next
-- migration or a consumer has drifted.
DO $legacy_delivery_source$
DECLARE
 marker public.hosted_pilot_environment_identity;
 marker_constraint text;exercise_constraint text;
 final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261009162752''';
 old_equal text:='marker.migration_tip=''20261009162752''';
 old_assert text:='marker.migration_tip = ''20261009162752''';
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
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.migration_tip<>'20261009162752'
  OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  OR marker_constraint<>'(migration_tip = ''20261009162752''::text)'
  OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text, ''20261004025101''::text, ''20261004112232''::text, ''20261008022445''::text, ''20261009162752''::text]))'
  OR (length(final_activation_definition)-length(replace(final_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
  OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_equal,'')))/length(old_equal)<>1
  OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
  OR (length(brd_v3_activation_definition)-length(replace(brd_v3_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
  OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
 THEN RAISE EXCEPTION 'LEGACY_DELIVERY_SOURCE_MISMATCH'; END IF;
END
$legacy_delivery_source$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('task.read','delivery','Read workspace-scoped legacy Delivery tasks'),
 ('task.create','delivery','Create workspace-scoped legacy Delivery tasks'),
 ('task.update','delivery','Update workspace-scoped legacy Delivery tasks'),
 ('task.update.own','delivery','Update assigned legacy Delivery tasks without protected-field changes'),
 ('task.assign','delivery','Assign workspace-scoped legacy Delivery tasks'),
 ('task.delete','delivery','Record retention or soft-deletion for legacy Delivery tasks'),
 ('backlog.read','delivery','Read workspace-scoped Delivery backlog'),
 ('backlog.manage','delivery','Manage workspace-scoped Delivery backlog'),
 ('workitems.import','delivery','Import persisted Docs work items into legacy Delivery'),
 ('project.manage','delivery','Manage workspace-scoped Delivery projects'),
 ('roles.manage','admin','Manage tenant role authority')
ON CONFLICT(capability_key) DO UPDATE
SET module=EXCLUDED.module,description=EXCLUDED.description;

-- Existing role permission JSON is upgrade input only. Promote only exact,
-- already-configured Delivery permission keys; never infer a role or grant.
INSERT INTO public.role_capabilities(role_id,capability_key)
SELECT role_row.id,permission.value
FROM public.roles role_row
CROSS JOIN LATERAL jsonb_array_elements_text(
 CASE WHEN jsonb_typeof(role_row.permissions)='array' THEN role_row.permissions ELSE '[]'::jsonb END
) permission(value)
JOIN public.capabilities capability ON capability.capability_key=permission.value
WHERE permission.value IN(
 'task.read','task.create','task.update','task.update.own','task.assign','task.delete',
 'backlog.read','backlog.manage','workitems.import','project.manage'
)
ON CONFLICT DO NOTHING;

ALTER TABLE public.delivery_work_items
 ADD COLUMN IF NOT EXISTS authority_version bigint,
 ADD COLUMN IF NOT EXISTS legacy_import_id uuid,
 ADD COLUMN IF NOT EXISTS source_item_index integer,
 ADD COLUMN IF NOT EXISTS source_epic_index integer,
 ADD COLUMN IF NOT EXISTS source_epic_title text,
 ADD COLUMN IF NOT EXISTS retention_state text,
 ADD COLUMN IF NOT EXISTS retention_class text,
 ADD COLUMN IF NOT EXISTS retention_reason text,
 ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
 ADD COLUMN IF NOT EXISTS deletion_requested_by uuid;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_authority_version_check' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_authority_version_check
   CHECK(authority_version IS NULL OR authority_version>0) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_source_index_check' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_source_index_check
   CHECK(source_item_index IS NULL OR source_item_index>=0) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_epic_index_check' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_epic_index_check
   CHECK(source_epic_index IS NULL OR source_epic_index>=0) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_retention_state_check' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_retention_state_check
   CHECK(retention_state IS NULL OR retention_state IN('active','soft_deleted','retained')) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_retention_class_check' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_retention_class_check
   CHECK(retention_class IS NULL OR retention_class IN('none','lineage','terminal','dependency')) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_authority_shape_check' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_authority_shape_check CHECK(
   authority_version IS NULL OR(
    org_id IS NOT NULL AND workspace_id IS NOT NULL AND project_id IS NOT NULL
    AND created_by IS NOT NULL AND updated_by IS NOT NULL AND owner_id IS NOT NULL AND reporter_id IS NOT NULL
    AND title IS NOT NULL AND length(btrim(title)) BETWEEN 1 AND 300
    AND status IS NOT NULL AND priority IS NOT NULL AND type IS NOT NULL
    AND retention_state IS NOT NULL AND retention_class IS NOT NULL
    AND jsonb_typeof(source_lineage)='object'
   )
  ) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_id_workspace_org_key' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_id_workspace_org_key UNIQUE(id,workspace_id,org_id);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.legacy_delivery_workspace_controls(
 org_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 writes_enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.legacy_delivery_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 command_type text NOT NULL CHECK(command_type IN('import','task.create','task.update','task.delete')),
 idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 200),
 request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^sha256:[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('in_progress','committed')),
 resource_id uuid,
 response jsonb,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 completed_at timestamptz,
 UNIQUE(org_id,actor_id,command_type,idempotency_key),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 CHECK((status='in_progress' AND response IS NULL AND completed_at IS NULL)
    OR(status='committed' AND response IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.legacy_delivery_imports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 project_id uuid NOT NULL,
 source_generation_id uuid NOT NULL,
 source_process_id uuid NOT NULL,
 source_assessment_id uuid NOT NULL,
 source_digest text NOT NULL CHECK(source_digest~'^sha256:[0-9a-f]{64}$'),
 selection_digest text NOT NULL CHECK(selection_digest~'^sha256:[0-9a-f]{64}$'),
 source_item_indices integer[] NOT NULL CHECK(cardinality(source_item_indices) BETWEEN 1 AND 100),
 imported_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.legacy_delivery_command_receipts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(org_id,workspace_id,project_id,source_generation_id,source_digest,selection_digest),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(project_id,org_id) REFERENCES public.projects(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_generation_id,org_id) REFERENCES public.document_generations(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_process_id,org_id) REFERENCES public.assess_processes(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_assessment_id,org_id) REFERENCES public.assessments(id,org_id) ON DELETE RESTRICT
);

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_import_fkey' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_import_fkey
   FOREIGN KEY(legacy_import_id) REFERENCES public.legacy_delivery_imports(id) ON DELETE RESTRICT NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='legacy_delivery_work_items_deletion_actor_fkey' AND conrelid='public.delivery_work_items'::regclass) THEN
  ALTER TABLE public.delivery_work_items ADD CONSTRAINT legacy_delivery_work_items_deletion_actor_fkey
   FOREIGN KEY(deletion_requested_by) REFERENCES public.profiles(id) ON DELETE RESTRICT NOT VALID;
 END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS legacy_delivery_one_import_per_source_item
 ON public.delivery_work_items(org_id,workspace_id,project_id,document_generation_id,source_item_index)
 WHERE document_generation_id IS NOT NULL AND source_item_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.legacy_delivery_work_item_assignees(
 work_item_id uuid NOT NULL,
 org_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 assignee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(work_item_id,assignee_id),
 FOREIGN KEY(work_item_id,workspace_id,org_id) REFERENCES public.delivery_work_items(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.legacy_delivery_work_item_dependencies(
 work_item_id uuid NOT NULL,
 dependency_id uuid NOT NULL,
 org_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(work_item_id,dependency_id),
 CHECK(work_item_id<>dependency_id),
 FOREIGN KEY(work_item_id,workspace_id,org_id) REFERENCES public.delivery_work_items(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(dependency_id,workspace_id,org_id) REFERENCES public.delivery_work_items(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);

-- Unsafe partially-applied authority must stop. Historical rows have all new
-- authority columns NULL and are intentionally excluded from this assertion.
DO $$ BEGIN
 IF EXISTS(
  SELECT 1 FROM public.delivery_work_items item
  WHERE item.authority_version IS NOT NULL AND(
   item.workspace_id IS NULL OR item.project_id IS NULL OR item.created_by IS NULL OR item.updated_by IS NULL
   OR item.owner_id IS NULL OR item.reporter_id IS NULL OR item.retention_state IS NULL OR item.retention_class IS NULL
   OR jsonb_typeof(item.source_lineage)<>'object'
   OR(item.legacy_import_id IS NOT NULL AND(
    item.document_generation_id IS NULL OR item.source_process_id IS NULL OR item.source_assessment_id IS NULL OR item.source_item_index IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.legacy_delivery_imports imported WHERE imported.id=item.legacy_import_id
      AND imported.org_id=item.org_id AND imported.workspace_id=item.workspace_id AND imported.project_id=item.project_id
      AND imported.source_generation_id=item.document_generation_id AND imported.source_process_id=item.source_process_id
      AND imported.source_assessment_id=item.source_assessment_id)
   ))
  )
 ) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_UNSAFE_HISTORICAL_AUTHORITY'; END IF;
END $$;

ALTER TABLE public.legacy_delivery_workspace_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_work_item_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_delivery_work_item_dependencies ENABLE ROW LEVEL SECURITY;

-- Preserve historical SELECT compatibility, but require the capability-checked
-- query RPC for newly authoritative rows. The older membership-only SELECT
-- policy must not bypass the new task read boundary.
DROP POLICY IF EXISTS legacy_delivery_authoritative_items_rpc_only ON public.delivery_work_items;
CREATE POLICY legacy_delivery_authoritative_items_rpc_only ON public.delivery_work_items
 AS RESTRICTIVE FOR SELECT TO authenticated USING (authority_version IS NULL);

CREATE OR REPLACE FUNCTION public.legacy_delivery_sha256_jsonb(p_value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT 'sha256:'||encode(public.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex')
$$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_jsonb_keys_allowed(p_value jsonb,p_allowed text[],p_required text[] DEFAULT ARRAY[]::text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_typeof(p_value)='object'
  AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p_value) key WHERE NOT(key=ANY(p_allowed)))
  AND NOT EXISTS(SELECT 1 FROM unnest(p_required) key WHERE NOT(p_value?key))
$$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_assert_any_authority(
 p_actor uuid,p_org uuid,p_workspace uuid,p_capabilities text[],p_version bigint
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE capability text;message text;
BEGIN
 IF p_capabilities IS NULL OR cardinality(p_capabilities)=0 THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
 FOREACH capability IN ARRAY p_capabilities LOOP
  BEGIN
   PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,capability,p_version);
   RETURN capability;
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS message=MESSAGE_TEXT;
   IF message LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RAISE EXCEPTION 'LEGACY_DELIVERY_AUTHORIZATION_STALE'; END IF;
   IF message NOT LIKE '%PR1B_NOT_FOUND%' THEN RAISE; END IF;
  END;
 END LOOP;
 RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND';
END $$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_transition_allowed(p_from text,p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_from
  WHEN 'To Do' THEN p_to=ANY(ARRAY['To Do','In Progress','On Hold','Blocked'])
  WHEN 'In Progress' THEN p_to=ANY(ARRAY['In Progress','In Review','On Hold','Blocked'])
  WHEN 'In Review' THEN p_to=ANY(ARRAY['In Review','Testing','In Progress','On Hold','Blocked'])
  WHEN 'Testing' THEN p_to=ANY(ARRAY['Testing','Ready for Release','In Review','Blocked'])
  WHEN 'Ready for Release' THEN p_to=ANY(ARRAY['Ready for Release','Done','Testing','Blocked'])
  WHEN 'Done' THEN p_to='Done'
  WHEN 'Blocked' THEN p_to=ANY(ARRAY['Blocked','On Hold'])
  WHEN 'On Hold' THEN p_to=ANY(ARRAY['On Hold','To Do','Blocked'])
  ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_task_projection(p_item public.delivery_work_items)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'id',p_item.id,
  'version',p_item.authority_version,
  'mutable',p_item.authority_version IS NOT NULL,
  'projectId',p_item.project_id,
  'title',p_item.title,
  'description',COALESCE(p_item.description,''),
  'status',p_item.status,
  'priority',p_item.priority,
  'type',p_item.type,
  'assigneeIds',COALESCE((
   SELECT jsonb_agg(binding.assignee_id ORDER BY binding.assignee_id)
   FROM public.legacy_delivery_work_item_assignees binding
   WHERE binding.work_item_id=p_item.id AND binding.org_id=p_item.org_id AND binding.workspace_id=p_item.workspace_id
  ),'[]'::jsonb),
  'dependencyIds',COALESCE((
   SELECT jsonb_agg(binding.dependency_id ORDER BY binding.dependency_id)
   FROM public.legacy_delivery_work_item_dependencies binding
   WHERE binding.work_item_id=p_item.id AND binding.org_id=p_item.org_id AND binding.workspace_id=p_item.workspace_id
  ),'[]'::jsonb),
  'ownerId',p_item.owner_id,
  'reporterId',p_item.reporter_id,
  'sourceLineage',CASE WHEN p_item.authority_version IS NOT NULL AND p_item.legacy_import_id IS NOT NULL
   THEN jsonb_build_object(
    'schemaVersion','legacy-delivery-lineage.v1','importId',p_item.legacy_import_id,
    'documentGenerationId',p_item.document_generation_id,'documentSourceDigest',p_item.source_lineage->>'documentSourceDigest',
    'sourceItemIndex',p_item.source_item_index,'sourceProcessId',p_item.source_process_id,
    'sourceAssessmentId',p_item.source_assessment_id,'sourceEpicIndex',p_item.source_epic_index,
    'sourceEpicTitle',p_item.source_epic_title
   ) ELSE NULL END,
  'sourceEpicIndex',p_item.source_epic_index,
  'sourceEpicTitle',p_item.source_epic_title,
  'retentionState',COALESCE(p_item.retention_state,CASE WHEN p_item.deleted_at IS NULL THEN 'active' ELSE 'soft_deleted' END),
  'retentionClass',COALESCE(p_item.retention_class,'none'),
  'retentionReason',p_item.retention_reason,
  'deletionRequestedAt',p_item.deletion_requested_at,
  'deletionRequestedBy',p_item.deletion_requested_by,
  'createdAt',p_item.created_at,
  'updatedAt',p_item.updated_at
 )
$$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_guard_work_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.authority_version IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_HISTORICAL_INSERT_DISABLED'; END IF;
  IF NEW.authority_version<>1 OR NEW.workspace_id IS NULL OR NEW.project_id IS NULL
     OR NEW.created_by IS NULL OR NEW.updated_by IS NULL OR NEW.owner_id IS NULL OR NEW.reporter_id IS NULL
     OR NEW.retention_state IS DISTINCT FROM 'active' OR NEW.retention_class IS DISTINCT FROM 'none'
     OR jsonb_typeof(NEW.source_lineage)<>'object' THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_PHYSICAL_DELETE_DENIED';
 END IF;
 IF OLD.authority_version IS NULL THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_HISTORICAL_READ_ONLY';
 END IF;
 IF NEW.authority_version IS DISTINCT FROM OLD.authority_version+1
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.legacy_import_id IS DISTINCT FROM OLD.legacy_import_id
    OR NEW.document_generation_id IS DISTINCT FROM OLD.document_generation_id
    OR NEW.source_process_id IS DISTINCT FROM OLD.source_process_id
    OR NEW.source_assessment_id IS DISTINCT FROM OLD.source_assessment_id
    OR NEW.source_item_index IS DISTINCT FROM OLD.source_item_index
    OR NEW.source_epic_index IS DISTINCT FROM OLD.source_epic_index
    OR NEW.source_epic_title IS DISTINCT FROM OLD.source_epic_title
    OR NEW.source_lineage IS DISTINCT FROM OLD.source_lineage
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_IMMUTABLE_AUTHORITY';
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS legacy_delivery_work_item_guard ON public.delivery_work_items;
CREATE TRIGGER legacy_delivery_work_item_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.delivery_work_items
FOR EACH ROW EXECUTE FUNCTION public.legacy_delivery_guard_work_item();

CREATE OR REPLACE FUNCTION public.legacy_delivery_guard_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='committed' THEN RAISE EXCEPTION 'LEGACY_DELIVERY_RECEIPT_IMMUTABLE'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.actor_id IS DISTINCT FROM OLD.actor_id OR NEW.command_type IS DISTINCT FROM OLD.command_type
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_id IS DISTINCT FROM OLD.request_id
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.status IS DISTINCT FROM 'committed' OR NEW.response IS NULL OR NEW.completed_at IS NULL THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_RECEIPT_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS legacy_delivery_receipt_guard ON public.legacy_delivery_command_receipts;
CREATE TRIGGER legacy_delivery_receipt_guard BEFORE UPDATE OR DELETE ON public.legacy_delivery_command_receipts
FOR EACH ROW EXECUTE FUNCTION public.legacy_delivery_guard_receipt();

CREATE OR REPLACE FUNCTION public.legacy_delivery_reject_immutable_row()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'LEGACY_DELIVERY_IMMUTABLE_AUTHORITY'; END $$;
DROP TRIGGER IF EXISTS legacy_delivery_import_immutable ON public.legacy_delivery_imports;
CREATE TRIGGER legacy_delivery_import_immutable BEFORE UPDATE OR DELETE ON public.legacy_delivery_imports
FOR EACH ROW EXECUTE FUNCTION public.legacy_delivery_reject_immutable_row();

CREATE OR REPLACE FUNCTION public.legacy_delivery_claim_command(
 p_actor uuid,p_org uuid,p_workspace uuid,p_type text,p_key text,p_request uuid,p_hash text
) RETURNS public.legacy_delivery_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE receipt public.legacy_delivery_command_receipts;
BEGIN
 IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_request IS NULL
    OR p_type NOT IN('import','task.create','task.update','task.delete')
    OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 200
    OR p_hash !~ '^sha256:[0-9a-f]{64}$' THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
 END IF;
 INSERT INTO public.legacy_delivery_command_receipts(
  org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status
 ) VALUES(p_org,p_workspace,p_actor,p_type,p_key,p_request,p_hash,'in_progress')
 ON CONFLICT(org_id,actor_id,command_type,idempotency_key) DO NOTHING RETURNING * INTO receipt;
 IF receipt.id IS NULL THEN
  SELECT * INTO receipt FROM public.legacy_delivery_command_receipts existing
  WHERE existing.org_id=p_org AND existing.actor_id=p_actor AND existing.command_type=p_type AND existing.idempotency_key=p_key
  FOR UPDATE;
  IF receipt.workspace_id IS DISTINCT FROM p_workspace OR receipt.request_hash IS DISTINCT FROM p_hash THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_IDEMPOTENCY_CONFLICT';
  END IF;
  IF receipt.status<>'committed' OR receipt.response IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_COMMAND_UNAVAILABLE'; END IF;
 END IF;
 RETURN receipt;
END $$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_error_envelope(p_message text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT jsonb_build_object('ok',false,'errorCode',CASE
  WHEN p_message LIKE '%LEGACY_DELIVERY_FEATURE_DISABLED%' THEN 'FEATURE_DISABLED'
  WHEN p_message LIKE '%LEGACY_DELIVERY_AUTHORIZATION_STALE%' OR p_message LIKE '%PR1B_AUTHORIZATION_STALE%' THEN 'AUTHORIZATION_STALE'
  WHEN p_message LIKE '%LEGACY_DELIVERY_IDEMPOTENCY_CONFLICT%' THEN 'IDEMPOTENCY_CONFLICT'
  WHEN p_message LIKE '%LEGACY_DELIVERY_VERSION_CONFLICT%' THEN 'VERSION_CONFLICT'
  WHEN p_message LIKE '%LEGACY_DELIVERY_DUPLICATE_IMPORT%' OR p_message LIKE '%legacy_delivery_one_import_per_source_item%' THEN 'DUPLICATE_IMPORT'
  WHEN p_message LIKE '%LEGACY_DELIVERY_SOURCE_CHANGED%' THEN 'SOURCE_CHANGED'
  WHEN p_message LIKE '%LEGACY_DELIVERY_TRANSITION_DENIED%' THEN 'TRANSITION_DENIED'
  WHEN p_message LIKE '%LEGACY_DELIVERY_DEPENDENCY_INCOMPLETE%' THEN 'DEPENDENCY_INCOMPLETE'
  WHEN p_message LIKE '%LEGACY_DELIVERY_INVALID_COMMAND%' THEN 'INVALID_COMMAND'
  WHEN p_message LIKE '%LEGACY_DELIVERY_NOT_FOUND%' OR p_message LIKE '%PR1B_NOT_FOUND%' THEN 'NOT_FOUND'
  ELSE 'COMMAND_UNAVAILABLE' END)
$$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_apply_command(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_authorization_version bigint,
 p_request_id uuid,p_idempotency_key text,p_action text,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
 capability text;receipt public.legacy_delivery_command_receipts;request_hash text;result jsonb;
 project_row public.projects;generation public.document_generations;task_row public.delivery_work_items;
 imported public.legacy_delivery_imports;source_items jsonb;source_item jsonb;target_source_digest text;target_selection_digest text;
 source_indices integer[];source_index integer;source_count integer;task_count integer:=0;
 current_epic_index integer;current_epic_title text;description_value text;criteria_text text;
 task_payload jsonb;patch jsonb;task_id uuid;target_project_id uuid;generation_id uuid;expected_version bigint;
 assignees uuid[]:=ARRAY[]::uuid[];dependencies uuid[]:=ARRAY[]::uuid[];assignee uuid;dependency uuid;
 next_title text;next_description text;next_status text;next_priority text;next_type text;
 next_assigned_to uuid;retention_state_value text;retention_class_value text;projections jsonb:='[]'::jsonb;
 writes_enabled_value boolean;
BEGIN
 IF p_actor_id IS NULL OR p_org_id IS NULL OR p_workspace_id IS NULL OR p_expected_authorization_version IS NULL
    OR p_request_id IS NULL OR p_idempotency_key IS NULL OR p_action NOT IN('import','task.create','task.update','task.delete')
    OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;

 capability:=public.legacy_delivery_assert_any_authority(
  p_actor_id,p_org_id,p_workspace_id,
  CASE p_action
   WHEN 'import' THEN ARRAY['org.admin','security.manage','roles.manage','workitems.import','project.manage']
   WHEN 'task.create' THEN ARRAY['org.admin','security.manage','roles.manage','task.create','backlog.manage','workitems.import','project.manage']
   WHEN 'task.update' THEN ARRAY['org.admin','security.manage','roles.manage','task.update','project.manage','task.update.own']
   WHEN 'task.delete' THEN ARRAY['org.admin','security.manage','roles.manage','task.delete','project.manage'] END,
  p_expected_authorization_version
 );

 request_hash:=public.legacy_delivery_sha256_jsonb(jsonb_build_object(
  'schemaVersion','legacy-delivery-command.v1','requestId',p_request_id,'organizationId',p_org_id,
  'workspaceId',p_workspace_id,'action',p_action,'payload',p_payload
 ));
 receipt:=public.legacy_delivery_claim_command(
  p_actor_id,p_org_id,p_workspace_id,p_action,p_idempotency_key,p_request_id,request_hash
 );
 IF receipt.status='committed' THEN
  IF p_action='import' THEN
   IF NOT EXISTS(SELECT 1 FROM public.legacy_delivery_imports import_record
    JOIN public.projects project ON project.id=import_record.project_id AND project.org_id=import_record.org_id
    WHERE import_record.id=receipt.resource_id AND import_record.org_id=p_org_id AND import_record.workspace_id=p_workspace_id
      AND project.workspace_id=p_workspace_id AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL
    FOR SHARE OF import_record,project) THEN
    RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND';
   END IF;
  ELSE
   SELECT * INTO task_row FROM public.delivery_work_items item
   WHERE item.id=receipt.resource_id AND item.org_id=p_org_id AND item.workspace_id=p_workspace_id AND item.authority_version IS NOT NULL FOR SHARE;
   IF task_row.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.projects project
      WHERE project.id=task_row.project_id AND project.org_id=p_org_id AND project.workspace_id=p_workspace_id
       AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL FOR SHARE)
      OR(p_action='task.update' AND capability='task.update.own' AND NOT EXISTS(
       SELECT 1 FROM public.legacy_delivery_work_item_assignees binding
       WHERE binding.work_item_id=task_row.id AND binding.assignee_id=p_actor_id
      )) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  END IF;
  RETURN receipt.response;
 END IF;

 SELECT control.writes_enabled INTO writes_enabled_value FROM public.legacy_delivery_workspace_controls control
 WHERE control.org_id=p_org_id AND control.workspace_id=p_workspace_id FOR SHARE;
 IF writes_enabled_value IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_FEATURE_DISABLED';
 END IF;

 IF p_action='import' THEN
  IF NOT public.legacy_delivery_jsonb_keys_allowed(
   p_payload,ARRAY['projectId','sourceGenerationId','expectedSourceDigest','sourceItemIndices'],
   ARRAY['projectId','sourceGenerationId','expectedSourceDigest','sourceItemIndices']
  ) OR (p_payload->>'projectId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR (p_payload->>'sourceGenerationId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR (p_payload->>'expectedSourceDigest')!~'^sha256:[0-9a-f]{64}$'
    OR jsonb_typeof(p_payload->'sourceItemIndices')<>'array'
    OR jsonb_array_length(p_payload->'sourceItemIndices') NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_payload->'sourceItemIndices') value WHERE value!~'^(0|[1-9][0-9]*)$') THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
  END IF;
  target_project_id:=(p_payload->>'projectId')::uuid;
  generation_id:=(p_payload->>'sourceGenerationId')::uuid;
  SELECT array_agg(value::integer ORDER BY value::integer),count(*),count(DISTINCT value::integer)
   INTO source_indices,source_count,task_count
  FROM jsonb_array_elements_text(p_payload->'sourceItemIndices') value;
  IF source_count<>task_count THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  task_count:=0;

  SELECT * INTO project_row FROM public.projects project
  WHERE project.id=target_project_id AND project.org_id=p_org_id AND project.workspace_id=p_workspace_id
    AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL FOR SHARE;
  IF project_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  SELECT * INTO generation FROM public.document_generations source
  WHERE source.id=generation_id AND source.org_id=p_org_id AND source.workspace_id=p_workspace_id
    AND source.project_id=target_project_id AND source.deleted_at IS NULL AND source.archived_at IS NULL
    AND source.status IN('generated','draft') FOR SHARE;
  IF generation.id IS NULL OR generation.source_process_id IS NULL OR generation.source_assessment_id IS NULL THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.assess_processes process
     WHERE process.id=generation.source_process_id AND process.org_id=p_org_id AND process.workspace_id=p_workspace_id AND process.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.assessments assessment
     WHERE assessment.id=generation.source_assessment_id AND assessment.process_id=generation.source_process_id
       AND assessment.org_id=p_org_id AND assessment.workspace_id=p_workspace_id AND assessment.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND';
  END IF;
  source_items:=generation.artifacts->'workItems';
  IF jsonb_typeof(source_items)<>'array' OR jsonb_array_length(source_items) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
  END IF;
  target_source_digest:=public.legacy_delivery_sha256_jsonb(generation.artifacts);
  IF target_source_digest IS DISTINCT FROM p_payload->>'expectedSourceDigest' THEN RAISE EXCEPTION 'LEGACY_DELIVERY_SOURCE_CHANGED'; END IF;
  target_selection_digest:=public.legacy_delivery_sha256_jsonb(to_jsonb(source_indices));
  IF source_indices[cardinality(source_indices)]>=jsonb_array_length(source_items) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  IF EXISTS(SELECT 1 FROM public.delivery_work_items existing
   WHERE existing.org_id=p_org_id AND existing.workspace_id=p_workspace_id AND existing.project_id=target_project_id
     AND existing.document_generation_id=generation_id AND existing.source_item_index=ANY(source_indices))
   OR EXISTS(SELECT 1 FROM public.legacy_delivery_imports existing
   WHERE existing.org_id=p_org_id AND existing.workspace_id=p_workspace_id AND existing.project_id=target_project_id
     AND existing.source_generation_id=generation_id AND existing.source_digest=target_source_digest AND existing.selection_digest=target_selection_digest) THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_DUPLICATE_IMPORT';
  END IF;

  INSERT INTO public.legacy_delivery_imports(
   org_id,workspace_id,project_id,source_generation_id,source_process_id,source_assessment_id,
   source_digest,selection_digest,source_item_indices,imported_by,receipt_id
  ) VALUES(
   p_org_id,p_workspace_id,target_project_id,generation_id,generation.source_process_id,generation.source_assessment_id,
   target_source_digest,target_selection_digest,source_indices,p_actor_id,receipt.id
  ) RETURNING * INTO imported;

  FOREACH source_index IN ARRAY source_indices LOOP
   source_item:=source_items->source_index;
   IF jsonb_typeof(source_item)<>'object' OR source_item->>'type' NOT IN('Epic','Story','Task')
      OR source_item->>'title' IS NULL OR length(btrim(source_item->>'title')) NOT BETWEEN 1 AND 300
      OR source_item->>'description' IS NULL OR jsonb_typeof(source_item->'description')<>'string' OR length(source_item->>'description')>20000
      OR jsonb_typeof(source_item->'acceptanceCriteria')<>'array' OR jsonb_array_length(source_item->'acceptanceCriteria')>100
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(source_item->'acceptanceCriteria') criterion
       WHERE jsonb_typeof(criterion)<>'string' OR length(criterion#>>'{}')>2000) THEN
    RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
   END IF;
   IF source_item->>'type'='Epic' THEN
    current_epic_index:=source_index;current_epic_title:=btrim(source_item->>'title');
    CONTINUE;
   END IF;
   SELECT string_agg('- '||value,E'\n' ORDER BY ordinal) INTO criteria_text
   FROM jsonb_array_elements_text(source_item->'acceptanceCriteria') WITH ORDINALITY criterion(value,ordinal);
   description_value:=source_item->>'description'||CASE WHEN criteria_text IS NULL THEN '' ELSE E'\n\nAcceptance Criteria:\n'||criteria_text END;
   IF length(description_value)>20000 THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
   INSERT INTO public.delivery_work_items(
    org_id,workspace_id,project_id,document_generation_id,source_process_id,source_assessment_id,
    created_by,updated_by,owner_id,assigned_to,reporter_id,title,description,status,priority,type,
    source_lineage,metadata,audit_correlation_id,authority_version,legacy_import_id,source_item_index,
    source_epic_index,source_epic_title,retention_state,retention_class
   ) VALUES(
    p_org_id,p_workspace_id,target_project_id,generation_id,generation.source_process_id,generation.source_assessment_id,
    p_actor_id,p_actor_id,p_actor_id,NULL,p_actor_id,btrim(source_item->>'title'),description_value,'To Do','Medium',source_item->>'type',
    jsonb_build_object(
     'schemaVersion','legacy-delivery-lineage.v1','importId',imported.id,'documentGenerationId',generation_id,
     'documentSourceDigest',target_source_digest,'sourceItemIndex',source_index,'sourceProcessId',generation.source_process_id,
     'sourceAssessmentId',generation.source_assessment_id,'sourceEpicIndex',current_epic_index,'sourceEpicTitle',current_epic_title
    ),'{}'::jsonb,p_request_id::text,1,imported.id,source_index,current_epic_index,current_epic_title,'active','none'
   ) RETURNING * INTO task_row;
   task_count:=task_count+1;
   projections:=projections||jsonb_build_array(public.legacy_delivery_task_projection(task_row));
  END LOOP;
  IF task_count=0 THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  result:=jsonb_build_object('ok',true,'schemaVersion','legacy-delivery-command.v1','action','import','resource',jsonb_build_object(
   'importId',imported.id,'projectId',target_project_id,'sourceGenerationId',generation_id,'sourceDigest',target_source_digest,
   'selectionDigest',target_selection_digest,'itemCount',task_count,'items',projections
  ));
  INSERT INTO public.privileged_audit_events(
   org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata
  ) VALUES(
   p_org_id,p_workspace_id,p_actor_id,p_request_id,'legacy_delivery.import','legacy_delivery_import',imported.id,'succeeded',1,
   jsonb_build_object('sourceDigest',target_source_digest,'selectionDigest',target_selection_digest,'itemCount',task_count)
  );
  UPDATE public.legacy_delivery_command_receipts SET status='committed',resource_id=imported.id,response=result,completed_at=statement_timestamp()
   WHERE id=receipt.id;
  RETURN result;
 END IF;

 IF p_action='task.create' THEN
  IF NOT public.legacy_delivery_jsonb_keys_allowed(p_payload,ARRAY['projectId','task'],ARRAY['projectId','task'])
    OR (p_payload->>'projectId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR NOT public.legacy_delivery_jsonb_keys_allowed(
     p_payload->'task',ARRAY['title','description','priority','type','assigneeIds','dependencyIds'],
     ARRAY['title','description','priority','type','assigneeIds','dependencyIds']
    ) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  target_project_id:=(p_payload->>'projectId')::uuid;task_payload:=p_payload->'task';
  SELECT * INTO project_row FROM public.projects project WHERE project.id=target_project_id AND project.org_id=p_org_id
   AND project.workspace_id=p_workspace_id AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL FOR SHARE;
  IF project_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  next_title:=btrim(task_payload->>'title');next_description:=COALESCE(task_payload->>'description','');
  next_priority:=COALESCE(task_payload->>'priority','Medium');next_type:=COALESCE(task_payload->>'type','Task');
  IF length(next_title) NOT BETWEEN 1 AND 300 OR length(next_description)>20000
    OR next_priority NOT IN('High','Medium','Low') OR next_type NOT IN('Story','Task','Bug','Subtask')
    OR(task_payload?'description' AND jsonb_typeof(task_payload->'description')<>'string')
    OR(task_payload?'priority' AND jsonb_typeof(task_payload->'priority')<>'string')
    OR(task_payload?'type' AND jsonb_typeof(task_payload->'type')<>'string')
    OR(task_payload?'assigneeIds' AND jsonb_typeof(task_payload->'assigneeIds')<>'array')
    OR(task_payload?'dependencyIds' AND jsonb_typeof(task_payload->'dependencyIds')<>'array') THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
  END IF;
  IF task_payload?'assigneeIds' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(task_payload->'assigneeIds') value WHERE value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
   SELECT COALESCE(array_agg(DISTINCT value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO assignees FROM jsonb_array_elements_text(task_payload->'assigneeIds') value;
   IF cardinality(assignees)>0 THEN
    PERFORM public.legacy_delivery_assert_any_authority(p_actor_id,p_org_id,p_workspace_id,ARRAY['org.admin','security.manage','roles.manage','task.assign','project.manage'],p_expected_authorization_version);
   END IF;
  END IF;
  IF task_payload?'dependencyIds' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(task_payload->'dependencyIds') value WHERE value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
   SELECT COALESCE(array_agg(DISTINCT value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO dependencies FROM jsonb_array_elements_text(task_payload->'dependencyIds') value;
  END IF;
  IF cardinality(assignees)>20 OR cardinality(dependencies)>100 THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(assignees) actor WHERE NOT EXISTS(
   SELECT 1 FROM public.profiles profile JOIN public.organization_members member ON member.user_id=profile.id AND member.org_id=p_org_id
    JOIN public.workspace_memberships workspace_member ON workspace_member.user_id=profile.id AND workspace_member.org_id=p_org_id AND workspace_member.workspace_id=p_workspace_id
   WHERE profile.id=actor AND profile.status='active' AND profile.deleted_at IS NULL AND member.status='active' AND member.deleted_at IS NULL
     AND workspace_member.status='active' AND workspace_member.deleted_at IS NULL
  )) OR EXISTS(SELECT 1 FROM unnest(dependencies) item_id WHERE NOT EXISTS(
   SELECT 1 FROM public.delivery_work_items dependency_item WHERE dependency_item.id=item_id AND dependency_item.org_id=p_org_id
    AND dependency_item.workspace_id=p_workspace_id AND dependency_item.project_id=target_project_id
    AND dependency_item.authority_version IS NOT NULL AND dependency_item.retention_state='active'
  )) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.delivery_work_items dependency_item
   WHERE dependency_item.id=ANY(dependencies) AND dependency_item.org_id=p_org_id
    AND dependency_item.workspace_id=p_workspace_id AND dependency_item.project_id=target_project_id
   ORDER BY dependency_item.id FOR SHARE;
  next_assigned_to:=assignees[1];
  INSERT INTO public.delivery_work_items(
   org_id,workspace_id,project_id,created_by,updated_by,owner_id,assigned_to,reporter_id,title,description,status,priority,type,
   source_lineage,metadata,audit_correlation_id,authority_version,retention_state,retention_class
  ) VALUES(
   p_org_id,p_workspace_id,target_project_id,p_actor_id,p_actor_id,p_actor_id,next_assigned_to,p_actor_id,next_title,next_description,'To Do',next_priority,next_type,
   '{}'::jsonb,'{}'::jsonb,p_request_id::text,1,'active','none'
  ) RETURNING * INTO task_row;
  FOREACH assignee IN ARRAY assignees LOOP INSERT INTO public.legacy_delivery_work_item_assignees(work_item_id,org_id,workspace_id,assignee_id) VALUES(task_row.id,p_org_id,p_workspace_id,assignee); END LOOP;
  FOREACH dependency IN ARRAY dependencies LOOP INSERT INTO public.legacy_delivery_work_item_dependencies(work_item_id,dependency_id,org_id,workspace_id) VALUES(task_row.id,dependency,p_org_id,p_workspace_id); END LOOP;
  result:=jsonb_build_object('ok',true,'schemaVersion','legacy-delivery-command.v1','action','task.create','resource',public.legacy_delivery_task_projection(task_row));
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
   VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'legacy_delivery.task.create','legacy_delivery_task',task_row.id,'succeeded',1,'{}');
  UPDATE public.legacy_delivery_command_receipts SET status='committed',resource_id=task_row.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
  RETURN result;
 END IF;

 IF p_action='task.update' THEN
  IF NOT public.legacy_delivery_jsonb_keys_allowed(p_payload,ARRAY['taskId','expectedVersion','patch'],ARRAY['taskId','expectedVersion','patch'])
    OR (p_payload->>'taskId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    OR jsonb_typeof(p_payload->'expectedVersion')<>'number' OR (p_payload->>'expectedVersion')!~'^[1-9][0-9]*$'
    OR NOT public.legacy_delivery_jsonb_keys_allowed(p_payload->'patch',ARRAY['title','description','priority','status','assigneeIds','dependencyIds'])
    OR p_payload->'patch'='{}'::jsonb THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  task_id:=(p_payload->>'taskId')::uuid;expected_version:=(p_payload->>'expectedVersion')::bigint;patch:=p_payload->'patch';
  SELECT * INTO task_row FROM public.delivery_work_items item WHERE item.id=task_id AND item.org_id=p_org_id
   AND item.workspace_id=p_workspace_id AND item.authority_version IS NOT NULL FOR UPDATE;
  IF task_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  SELECT * INTO project_row FROM public.projects project WHERE project.id=task_row.project_id AND project.org_id=p_org_id
   AND project.workspace_id=p_workspace_id AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL FOR SHARE;
  IF project_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  IF task_row.authority_version<>expected_version THEN RAISE EXCEPTION 'LEGACY_DELIVERY_VERSION_CONFLICT'; END IF;
  IF task_row.retention_state<>'active' THEN RAISE EXCEPTION 'LEGACY_DELIVERY_VERSION_CONFLICT'; END IF;
  IF capability='task.update.own' THEN
   IF NOT EXISTS(SELECT 1 FROM public.legacy_delivery_work_item_assignees binding WHERE binding.work_item_id=task_id AND binding.assignee_id=p_actor_id)
      OR patch?|'{"assigneeIds","dependencyIds"}'::text[] THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  END IF;
  next_title:=CASE WHEN patch?'title' THEN btrim(patch->>'title') ELSE task_row.title END;
  next_description:=CASE WHEN patch?'description' THEN patch->>'description' ELSE COALESCE(task_row.description,'') END;
  next_priority:=CASE WHEN patch?'priority' THEN patch->>'priority' ELSE task_row.priority END;
  next_status:=CASE WHEN patch?'status' THEN patch->>'status' ELSE task_row.status END;
  IF length(next_title) NOT BETWEEN 1 AND 300 OR length(next_description)>20000 OR next_priority NOT IN('High','Medium','Low')
    OR next_status NOT IN('To Do','In Progress','In Review','Testing','Ready for Release','Done','Blocked','On Hold')
    OR(patch?'title' AND jsonb_typeof(patch->'title')<>'string') OR(patch?'description' AND jsonb_typeof(patch->'description')<>'string')
    OR(patch?'priority' AND jsonb_typeof(patch->'priority')<>'string') OR(patch?'status' AND jsonb_typeof(patch->'status')<>'string')
    OR(patch?'assigneeIds' AND jsonb_typeof(patch->'assigneeIds')<>'array') OR(patch?'dependencyIds' AND jsonb_typeof(patch->'dependencyIds')<>'array') THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
  END IF;
  IF NOT public.legacy_delivery_transition_allowed(task_row.status,next_status) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_TRANSITION_DENIED'; END IF;
  SELECT COALESCE(array_agg(binding.assignee_id ORDER BY binding.assignee_id),ARRAY[]::uuid[]) INTO assignees
   FROM public.legacy_delivery_work_item_assignees binding WHERE binding.work_item_id=task_id;
  SELECT COALESCE(array_agg(binding.dependency_id ORDER BY binding.dependency_id),ARRAY[]::uuid[]) INTO dependencies
   FROM public.legacy_delivery_work_item_dependencies binding WHERE binding.work_item_id=task_id;
  IF patch?'assigneeIds' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(patch->'assigneeIds') value WHERE value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
   SELECT COALESCE(array_agg(DISTINCT value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO assignees FROM jsonb_array_elements_text(patch->'assigneeIds') value;
   PERFORM public.legacy_delivery_assert_any_authority(p_actor_id,p_org_id,p_workspace_id,ARRAY['org.admin','security.manage','roles.manage','task.assign','project.manage'],p_expected_authorization_version);
  END IF;
  IF patch?'dependencyIds' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(patch->'dependencyIds') value WHERE value!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
   SELECT COALESCE(array_agg(DISTINCT value::uuid ORDER BY value::uuid),ARRAY[]::uuid[]) INTO dependencies FROM jsonb_array_elements_text(patch->'dependencyIds') value;
  END IF;
  IF cardinality(assignees)>20 OR cardinality(dependencies)>100 OR task_id=ANY(dependencies) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(assignees) actor WHERE NOT EXISTS(
   SELECT 1 FROM public.profiles profile JOIN public.organization_members member ON member.user_id=profile.id AND member.org_id=p_org_id
    JOIN public.workspace_memberships workspace_member ON workspace_member.user_id=profile.id AND workspace_member.org_id=p_org_id AND workspace_member.workspace_id=p_workspace_id
   WHERE profile.id=actor AND profile.status='active' AND profile.deleted_at IS NULL AND member.status='active' AND member.deleted_at IS NULL
     AND workspace_member.status='active' AND workspace_member.deleted_at IS NULL
  )) OR EXISTS(SELECT 1 FROM unnest(dependencies) item_id WHERE NOT EXISTS(
   SELECT 1 FROM public.delivery_work_items dependency_item WHERE dependency_item.id=item_id AND dependency_item.org_id=p_org_id
    AND dependency_item.workspace_id=p_workspace_id AND dependency_item.project_id=task_row.project_id
    AND dependency_item.authority_version IS NOT NULL AND dependency_item.retention_state='active'
  )) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
  PERFORM 1 FROM public.delivery_work_items dependency_item
   WHERE dependency_item.id=ANY(dependencies) AND dependency_item.org_id=p_org_id
    AND dependency_item.workspace_id=p_workspace_id AND dependency_item.project_id=task_row.project_id
   ORDER BY dependency_item.id FOR SHARE;
  IF next_status=ANY(ARRAY['In Progress','In Review','Testing','Ready for Release','Done']) AND EXISTS(
   SELECT 1 FROM unnest(dependencies) dependency_id JOIN public.delivery_work_items dependency_item ON dependency_item.id=dependency_id
   WHERE dependency_item.status<>'Done' OR dependency_item.retention_state<>'active'
  ) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_DEPENDENCY_INCOMPLETE'; END IF;
  next_assigned_to:=assignees[1];
  UPDATE public.delivery_work_items SET title=next_title,description=next_description,priority=next_priority,status=next_status,
   assigned_to=next_assigned_to,updated_by=p_actor_id,updated_at=statement_timestamp(),audit_correlation_id=p_request_id::text,
   authority_version=authority_version+1 WHERE id=task_id RETURNING * INTO task_row;
  IF patch?'assigneeIds' THEN
   DELETE FROM public.legacy_delivery_work_item_assignees WHERE work_item_id=task_id;
   FOREACH assignee IN ARRAY assignees LOOP INSERT INTO public.legacy_delivery_work_item_assignees(work_item_id,org_id,workspace_id,assignee_id) VALUES(task_id,p_org_id,p_workspace_id,assignee); END LOOP;
  END IF;
  IF patch?'dependencyIds' THEN
   DELETE FROM public.legacy_delivery_work_item_dependencies WHERE work_item_id=task_id;
   FOREACH dependency IN ARRAY dependencies LOOP INSERT INTO public.legacy_delivery_work_item_dependencies(work_item_id,dependency_id,org_id,workspace_id) VALUES(task_id,dependency,p_org_id,p_workspace_id); END LOOP;
  END IF;
  result:=jsonb_build_object('ok',true,'schemaVersion','legacy-delivery-command.v1','action','task.update','resource',public.legacy_delivery_task_projection(task_row));
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
   VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'legacy_delivery.task.update','legacy_delivery_task',task_id,'succeeded',task_row.authority_version,
    jsonb_build_object('changedFields',(SELECT jsonb_agg(key ORDER BY key) FROM jsonb_object_keys(patch) key)));
  UPDATE public.legacy_delivery_command_receipts SET status='committed',resource_id=task_id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
  RETURN result;
 END IF;

 IF NOT public.legacy_delivery_jsonb_keys_allowed(p_payload,ARRAY['taskId','expectedVersion','deletionReason'],ARRAY['taskId','expectedVersion','deletionReason'])
   OR (p_payload->>'taskId')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   OR jsonb_typeof(p_payload->'expectedVersion')<>'number' OR (p_payload->>'expectedVersion')!~'^[1-9][0-9]*$'
   OR jsonb_typeof(p_payload->'deletionReason')<>'string' OR length(btrim(p_payload->>'deletionReason')) NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
 END IF;
 task_id:=(p_payload->>'taskId')::uuid;expected_version:=(p_payload->>'expectedVersion')::bigint;
 SELECT * INTO task_row FROM public.delivery_work_items item WHERE item.id=task_id AND item.org_id=p_org_id
  AND item.workspace_id=p_workspace_id AND item.authority_version IS NOT NULL FOR UPDATE;
 IF task_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
 SELECT * INTO project_row FROM public.projects project WHERE project.id=task_row.project_id AND project.org_id=p_org_id
  AND project.workspace_id=p_workspace_id AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL FOR SHARE;
 IF project_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;
 IF task_row.authority_version<>expected_version THEN RAISE EXCEPTION 'LEGACY_DELIVERY_VERSION_CONFLICT'; END IF;
 IF task_row.retention_state<>'active' THEN RAISE EXCEPTION 'LEGACY_DELIVERY_VERSION_CONFLICT'; END IF;
 PERFORM 1 FROM public.legacy_delivery_work_item_dependencies binding
  JOIN public.delivery_work_items dependent ON dependent.id=binding.work_item_id
  WHERE binding.dependency_id=task_id AND binding.org_id=p_org_id AND binding.workspace_id=p_workspace_id
  ORDER BY dependent.id FOR SHARE OF binding,dependent;
 IF task_row.legacy_import_id IS NOT NULL OR task_row.document_generation_id IS NOT NULL THEN
  retention_state_value:='retained';retention_class_value:='lineage';
 ELSIF task_row.status IN('Ready for Release','Done') THEN
  retention_state_value:='retained';retention_class_value:='terminal';
 ELSIF EXISTS(SELECT 1 FROM public.legacy_delivery_work_item_dependencies binding
  JOIN public.delivery_work_items dependent ON dependent.id=binding.work_item_id
  WHERE binding.dependency_id=task_id AND dependent.retention_state='active') THEN
  retention_state_value:='retained';retention_class_value:='dependency';
 ELSE retention_state_value:='soft_deleted';retention_class_value:='none'; END IF;
 UPDATE public.delivery_work_items SET retention_state=retention_state_value,retention_class=retention_class_value,
  retention_reason=btrim(p_payload->>'deletionReason'),deletion_requested_at=statement_timestamp(),deletion_requested_by=p_actor_id,
  deleted_at=CASE WHEN retention_state_value='soft_deleted' THEN statement_timestamp() ELSE deleted_at END,
  updated_by=p_actor_id,updated_at=statement_timestamp(),audit_correlation_id=p_request_id::text,authority_version=authority_version+1
 WHERE id=task_id RETURNING * INTO task_row;
 result:=jsonb_build_object('ok',true,'schemaVersion','legacy-delivery-command.v1','action','task.delete','resource',public.legacy_delivery_task_projection(task_row));
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'legacy_delivery.task.delete','legacy_delivery_task',task_id,'succeeded',task_row.authority_version,
   jsonb_build_object('retentionState',retention_state_value,'retentionClass',retention_class_value,'physicalDelete',false));
 UPDATE public.legacy_delivery_command_receipts SET status='committed',resource_id=task_id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF SQLSTATE='23505' AND p_action='import' THEN RETURN jsonb_build_object('ok',false,'errorCode','DUPLICATE_IMPORT'); END IF;
 IF SQLERRM NOT LIKE '%LEGACY_DELIVERY_%' AND SQLERRM NOT LIKE '%PR1B_%' THEN
  RAISE LOG 'LEGACY_DELIVERY_COMMAND_UNAVAILABLE action=% sqlstate=%',p_action,SQLSTATE;
 END IF;
 RETURN public.legacy_delivery_error_envelope(SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.legacy_delivery_query(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_authorization_version bigint,p_project_id uuid,
 p_limit integer DEFAULT 100,p_cursor uuid DEFAULT NULL,p_source_generation_id uuid DEFAULT NULL,p_include_retained boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE project_row public.projects;generation public.document_generations;source_items jsonb;source_value jsonb;
 items jsonb;next_cursor uuid;has_more boolean;source_projection jsonb:=NULL;source_digest text;
BEGIN
 PERFORM public.legacy_delivery_assert_any_authority(
  p_actor_id,p_org_id,p_workspace_id,ARRAY['org.admin','security.manage','roles.manage','task.read','project.manage','backlog.read'],p_expected_authorization_version
 );
 IF p_project_id IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR p_include_retained IS NULL THEN
  RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
 END IF;
 SELECT * INTO project_row FROM public.projects project WHERE project.id=p_project_id AND project.org_id=p_org_id
  AND project.workspace_id=p_workspace_id AND project.status='active' AND project.archived_at IS NULL AND project.deleted_at IS NULL FOR SHARE;
 IF project_row.id IS NULL THEN RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND'; END IF;

 SELECT COALESCE(jsonb_agg(page.projection ORDER BY page.id),'[]'::jsonb),max(page.id::text)::uuid
  INTO items,next_cursor
 FROM(
  SELECT item.id,public.legacy_delivery_task_projection(item) projection
  FROM public.delivery_work_items item
  WHERE item.org_id=p_org_id AND item.workspace_id=p_workspace_id AND item.project_id=p_project_id
    AND(p_cursor IS NULL OR item.id>p_cursor)
    AND(p_include_retained OR COALESCE(item.retention_state,CASE WHEN item.deleted_at IS NULL THEN 'active' ELSE 'soft_deleted' END)='active')
  ORDER BY item.id LIMIT p_limit
 ) page;
 SELECT COALESCE(next_cursor IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.delivery_work_items item
  WHERE item.org_id=p_org_id AND item.workspace_id=p_workspace_id AND item.project_id=p_project_id
    AND item.id>next_cursor
    AND(p_include_retained OR COALESCE(item.retention_state,CASE WHEN item.deleted_at IS NULL THEN 'active' ELSE 'soft_deleted' END)='active')
 ),false) INTO has_more;
 IF NOT has_more THEN next_cursor:=NULL; END IF;

 IF p_source_generation_id IS NOT NULL THEN
  SELECT * INTO generation FROM public.document_generations source
  WHERE source.id=p_source_generation_id AND source.org_id=p_org_id AND source.workspace_id=p_workspace_id
    AND source.project_id=p_project_id AND source.deleted_at IS NULL AND source.archived_at IS NULL
    AND source.status IN('generated','draft') FOR SHARE;
  IF generation.id IS NULL OR generation.source_process_id IS NULL OR generation.source_assessment_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM public.assess_processes process WHERE process.id=generation.source_process_id
      AND process.org_id=p_org_id AND process.workspace_id=p_workspace_id AND process.deleted_at IS NULL)
    OR NOT EXISTS(SELECT 1 FROM public.assessments assessment WHERE assessment.id=generation.source_assessment_id
      AND assessment.process_id=generation.source_process_id AND assessment.org_id=p_org_id
      AND assessment.workspace_id=p_workspace_id AND assessment.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_NOT_FOUND';
  END IF;
  source_items:=generation.artifacts->'workItems';
  IF jsonb_typeof(source_items)<>'array' OR jsonb_array_length(source_items) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(source_items) item WHERE jsonb_typeof(item)<>'object'
    OR item->>'type' NOT IN('Epic','Story','Task') OR jsonb_typeof(item->'title')<>'string'
    OR length(btrim(item->>'title')) NOT BETWEEN 1 AND 300 OR jsonb_typeof(item->'description')<>'string'
    OR length(item->>'description')>20000 OR jsonb_typeof(item->'acceptanceCriteria')<>'array'
    OR jsonb_array_length(item->'acceptanceCriteria')>100 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(item->'acceptanceCriteria') criterion
      WHERE jsonb_typeof(criterion)<>'string' OR length(criterion#>>'{}')>2000
    )) THEN RAISE EXCEPTION 'LEGACY_DELIVERY_INVALID_COMMAND'; END IF;
  source_digest:=public.legacy_delivery_sha256_jsonb(generation.artifacts);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'sourceIndex',ordinal-1,'type',value->>'type','title',value->>'title','description',value->>'description',
   'acceptanceCriteria',CASE WHEN jsonb_typeof(value->'acceptanceCriteria')='array' THEN value->'acceptanceCriteria' ELSE '[]'::jsonb END
  ) ORDER BY ordinal),'[]'::jsonb) INTO source_value
  FROM jsonb_array_elements(source_items) WITH ORDINALITY source(value,ordinal);
  source_projection:=jsonb_build_object('id',generation.id,'digest',source_digest,'items',source_value);
 END IF;
 RETURN jsonb_build_object(
  'ok',true,'schemaVersion','legacy-delivery-query.v1','projectId',p_project_id,'items',items,
  'page',jsonb_build_object('limit',p_limit,'nextCursor',next_cursor,'hasMore',has_more),'source',source_projection
 );
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%LEGACY_DELIVERY_%' AND SQLERRM NOT LIKE '%PR1B_%' THEN
  RAISE LOG 'LEGACY_DELIVERY_QUERY_UNAVAILABLE sqlstate=%',SQLSTATE;
 END IF;
 RETURN public.legacy_delivery_error_envelope(SQLERRM);
END $$;

-- Existing Delivery direct-write surfaces are compatibility reads only once
-- the canonical command is installed. These tables are not created here; the
-- conditional revokes cover historical databases where they still exist.
DO $$
DECLARE relation_name text;role_name text;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY['tasks','epics','task_comments','task_activity_events','handoff_ledger_entries'] LOOP
  IF to_regclass('public.'||relation_name) IS NOT NULL THEN
   EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.%I FROM PUBLIC',relation_name);
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
     EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.%I FROM %I',relation_name,role_name);
    END IF;
   END LOOP;
  END IF;
 END LOOP;
END $$;

REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.delivery_work_items FROM PUBLIC;
REVOKE ALL ON TABLE
 public.legacy_delivery_workspace_controls,public.legacy_delivery_command_receipts,public.legacy_delivery_imports,
 public.legacy_delivery_work_item_assignees,public.legacy_delivery_work_item_dependencies
FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION
 public.legacy_delivery_sha256_jsonb(jsonb),public.legacy_delivery_jsonb_keys_allowed(jsonb,text[],text[]),
 public.legacy_delivery_assert_any_authority(uuid,uuid,uuid,text[],bigint),public.legacy_delivery_transition_allowed(text,text),
 public.legacy_delivery_task_projection(public.delivery_work_items),public.legacy_delivery_guard_work_item(),
 public.legacy_delivery_guard_receipt(),public.legacy_delivery_reject_immutable_row(),
 public.legacy_delivery_claim_command(uuid,uuid,uuid,text,text,uuid,text),public.legacy_delivery_error_envelope(text),
 public.legacy_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
 public.legacy_delivery_query(uuid,uuid,uuid,bigint,uuid,integer,uuid,uuid,boolean)
FROM PUBLIC;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.delivery_work_items FROM anon;
  REVOKE ALL ON TABLE public.legacy_delivery_workspace_controls,public.legacy_delivery_command_receipts,
   public.legacy_delivery_imports,public.legacy_delivery_work_item_assignees,public.legacy_delivery_work_item_dependencies FROM anon;
  REVOKE EXECUTE ON FUNCTION public.legacy_delivery_sha256_jsonb(jsonb),public.legacy_delivery_jsonb_keys_allowed(jsonb,text[],text[]),
   public.legacy_delivery_assert_any_authority(uuid,uuid,uuid,text[],bigint),public.legacy_delivery_transition_allowed(text,text),
   public.legacy_delivery_task_projection(public.delivery_work_items),public.legacy_delivery_guard_work_item(),
   public.legacy_delivery_guard_receipt(),public.legacy_delivery_reject_immutable_row(),
   public.legacy_delivery_claim_command(uuid,uuid,uuid,text,text,uuid,text),public.legacy_delivery_error_envelope(text),
   public.legacy_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
   public.legacy_delivery_query(uuid,uuid,uuid,bigint,uuid,integer,uuid,uuid,boolean) FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.delivery_work_items FROM authenticated;
  REVOKE ALL ON TABLE public.legacy_delivery_workspace_controls,public.legacy_delivery_command_receipts,
   public.legacy_delivery_imports,public.legacy_delivery_work_item_assignees,public.legacy_delivery_work_item_dependencies FROM authenticated;
  REVOKE EXECUTE ON FUNCTION public.legacy_delivery_sha256_jsonb(jsonb),public.legacy_delivery_jsonb_keys_allowed(jsonb,text[],text[]),
   public.legacy_delivery_assert_any_authority(uuid,uuid,uuid,text[],bigint),public.legacy_delivery_transition_allowed(text,text),
   public.legacy_delivery_task_projection(public.delivery_work_items),public.legacy_delivery_guard_work_item(),
   public.legacy_delivery_guard_receipt(),public.legacy_delivery_reject_immutable_row(),
   public.legacy_delivery_claim_command(uuid,uuid,uuid,text,text,uuid,text),public.legacy_delivery_error_envelope(text),
   public.legacy_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
   public.legacy_delivery_query(uuid,uuid,uuid,bigint,uuid,integer,uuid,uuid,boolean) FROM authenticated;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON TABLE public.delivery_work_items FROM service_role;
  REVOKE ALL ON TABLE public.legacy_delivery_workspace_controls,public.legacy_delivery_command_receipts,
   public.legacy_delivery_imports,public.legacy_delivery_work_item_assignees,public.legacy_delivery_work_item_dependencies FROM service_role;
  REVOKE EXECUTE ON FUNCTION public.legacy_delivery_sha256_jsonb(jsonb),public.legacy_delivery_jsonb_keys_allowed(jsonb,text[],text[]),
   public.legacy_delivery_assert_any_authority(uuid,uuid,uuid,text[],bigint),public.legacy_delivery_transition_allowed(text,text),
   public.legacy_delivery_task_projection(public.delivery_work_items),public.legacy_delivery_guard_work_item(),
   public.legacy_delivery_guard_receipt(),public.legacy_delivery_reject_immutable_row(),
   public.legacy_delivery_claim_command(uuid,uuid,uuid,text,text,uuid,text),public.legacy_delivery_error_envelope(text),
   public.legacy_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
   public.legacy_delivery_query(uuid,uuid,uuid,bigint,uuid,integer,uuid,uuid,boolean) FROM service_role;
  GRANT EXECUTE ON FUNCTION public.legacy_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb),
   public.legacy_delivery_query(uuid,uuid,uuid,bigint,uuid,integer,uuid,uuid,boolean) TO service_role;
 END IF;
END $$;

COMMENT ON FUNCTION public.legacy_delivery_apply_command(uuid,uuid,uuid,bigint,uuid,text,text,jsonb) IS
'Service-role-only legacy Delivery command. Reauthorizes the server-resolved actor, defaults writes off, reads Docs import content at the server, and atomically commits task/import state, receipt, audit and immutable ancestry.';
COMMENT ON FUNCTION public.legacy_delivery_query(uuid,uuid,uuid,bigint,uuid,integer,uuid,uuid,boolean) IS
'Service-role-only bounded legacy Delivery projection. Reauthorizes the server-resolved actor, returns at most 100 UUID-keyset rows, and exposes sanitized persisted Docs source selectors without raw metadata.';
COMMENT ON TABLE public.legacy_delivery_workspace_controls IS
'Workspace-local fail-closed control for legacy Delivery writes. Installation inserts no row and therefore enables no writes.';
COMMENT ON TABLE public.legacy_delivery_imports IS
'Immutable authoritative binding from persisted Docs generation and selected zero-based source indices to one logical legacy Delivery import.';

-- Advance the exact hosted-pilot source marker and its current consumers only
-- after the complete authority contract and ACLs have installed successfully.
DO $legacy_delivery_marker$
DECLARE
 final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261009162752''';new_not_equal text:='marker.migration_tip<>''20261010025331''';
 old_equal text:='marker.migration_tip=''20261009162752''';new_equal text:='marker.migration_tip=''20261010025331''';
 old_assert text:='marker.migration_tip = ''20261009162752''';new_assert text:='marker.migration_tip = ''20261010025331''';
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
  CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232','20261008022445','20261009162752','20261010025331'));
 ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
 UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261010025331' WHERE singleton;
 ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20261010025331');
END
$legacy_delivery_marker$;
