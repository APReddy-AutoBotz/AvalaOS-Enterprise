-- Bounded Assess process metadata update authority for authenticated product
-- acceptance. Discovery completion remains owned by the existing server-side
-- assessment.finalize command and production scoring rules.

-- Exact nonproduction predecessor and dirty-schema gate. Existing process rows
-- remain read-only (NULL authority_version); only rows created after this
-- migration receive version 1 automatically.
DO $process_update_source$
DECLARE
 marker public.hosted_pilot_environment_identity;
 marker_constraint text;exercise_constraint text;
 final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261010051100''';
 old_equal text:='marker.migration_tip=''20261010051100''';
 old_assert text:='marker.migration_tip = ''20261010051100''';
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
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.migration_tip<>'20261010051100'
  OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  OR marker_constraint<>'(migration_tip = ''20261010051100''::text)'
  OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text, ''20261004025101''::text, ''20261004112232''::text, ''20261008022445''::text, ''20261009162752''::text, ''20261010025331''::text, ''20261010051100''::text]))'
  OR (length(final_activation_definition)-length(replace(final_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
  OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_equal,'')))/length(old_equal)<>1
  OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
  OR (length(brd_v3_activation_definition)-length(replace(brd_v3_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
  OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  OR to_regclass('public.process_update_workspace_controls') IS NOT NULL
  OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assess_processes'
    AND column_name IN('authority_version','update_receipt_id','update_request_id','update_idempotency_key'))
 THEN RAISE EXCEPTION 'PROCESS_UPDATE_SOURCE_MISMATCH'; END IF;
END
$process_update_source$;
INSERT INTO public.capabilities(capability_key,module,description)
VALUES ('assess.process.update','assess','Update an owned workspace Assess process')
ON CONFLICT(capability_key) DO UPDATE SET module=EXCLUDED.module,description=EXCLUDED.description;

ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS authority_version bigint;
ALTER TABLE public.assess_processes ALTER COLUMN authority_version SET DEFAULT 1;
ALTER TABLE public.assess_processes DROP CONSTRAINT IF EXISTS assess_processes_authority_version_check;
ALTER TABLE public.assess_processes ADD CONSTRAINT assess_processes_authority_version_check CHECK(authority_version IS NULL OR authority_version>=1);
ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS update_receipt_id uuid
 REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT;
ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS update_request_id uuid;
ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS update_idempotency_key text;

CREATE TABLE IF NOT EXISTS public.process_update_workspace_controls(
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  read_only boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,workspace_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.process_update_workspace_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_update_workspace_controls FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.process_update_workspace_controls FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.update_assess_process(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_authorization_version bigint,
 p_request_id uuid,p_idempotency_key text,p_expected_version bigint,p_process_id uuid,
 p_name text,p_description text,p_department text,p_criticality text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  r public.assess_command_receipts;
  c public.process_update_workspace_controls;
  p public.assess_processes;
  h text;
  result jsonb;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.process.update',p_authorization_version);
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.read',p_authorization_version);
  IF p_expected_version IS NULL OR p_expected_version<1 OR p_process_id IS NULL OR p_request_id IS NULL
     OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 200 OR btrim(p_name)=''
     OR p_description IS NULL OR length(p_description)>4000
     OR p_department IS NULL OR length(p_department)>200
     OR p_criticality IS NULL OR p_criticality NOT IN('Low','Medium','High','Critical')
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  THEN RAISE EXCEPTION 'PROCESS_UPDATE_INVALID_COMMAND'; END IF;
  SELECT * INTO c FROM public.process_update_workspace_controls
   WHERE org_id=p_org_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF c.org_id IS NULL OR NOT c.enabled THEN RAISE EXCEPTION 'PROCESS_UPDATE_FEATURE_DISABLED'; END IF;
  IF c.read_only THEN RAISE EXCEPTION 'PROCESS_UPDATE_READ_ONLY'; END IF;
  -- Re-establish current resource authority before consulting an earlier
  -- receipt. A caller who lost ownership must not recover the old response.
  SELECT * INTO p FROM public.assess_processes
   WHERE id=p_process_id AND org_id=p_org_id AND workspace_id=p_workspace_id
     AND owner_id=p_actor_id AND authority_version IS NOT NULL AND deleted_at IS NULL FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION 'PROCESS_UPDATE_PERMISSION_DENIED'; END IF;
  h:=encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
    'actorId',p_actor_id,'orgId',p_org_id,'workspaceId',p_workspace_id,'requestId',p_request_id,
    'expectedVersion',p_expected_version,'processId',p_process_id,'name',btrim(p_name),
    'description',p_description,'department',p_department,'criticality',p_criticality)::text,'UTF8')),'hex');
  r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'process.update',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN RETURN jsonb_set(r.response,'{outcome}','"replayed"'::jsonb); END IF;
  IF r.status<>'in_progress' THEN RAISE EXCEPTION 'PROCESS_UPDATE_IDEMPOTENCY_CONFLICT'; END IF;
  IF p.authority_version<>p_expected_version THEN RAISE EXCEPTION 'PROCESS_UPDATE_VERSION_CONFLICT'; END IF;
  UPDATE public.assess_processes SET name=btrim(p_name),description=p_description,department=p_department,
    criticality=p_criticality,authority_version=authority_version+1,updated_by=p_actor_id,updated_at=now(),
    update_receipt_id=r.id,update_request_id=p_request_id,update_idempotency_key=p_idempotency_key
   WHERE id=p_process_id AND org_id=p_org_id AND workspace_id=p_workspace_id
   RETURNING * INTO p;
  result:=jsonb_build_object('ok',true,'outcome','committed','resource',jsonb_build_object(
    'id',p.id,'orgId',p.org_id,'workspaceId',p.workspace_id,'ownerId',p.owner_id,
    'name',p.name,'description',p.description,'department',p.department,
    'criticality',p.criticality,'status',p.status,'templateId',p.template_id,
    'version',p.authority_version,'receiptId',p.update_receipt_id,'requestId',p.update_request_id,
    'idempotencyKey',p.update_idempotency_key,'createdAt',p.created_at,'updatedAt',p.updated_at));
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,
    resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'process.update','assess_process',p.id,
    'succeeded',p.authority_version,jsonb_build_object('operation','metadata_update'));
  UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','AUTHORITY_STALE')); END IF;
  IF SQLERRM LIKE '%PR1B_IDEMPOTENCY_CONFLICT%' OR SQLERRM LIKE '%PROCESS_UPDATE_IDEMPOTENCY_CONFLICT%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','IDEMPOTENCY_CONFLICT')); END IF;
  IF SQLERRM LIKE '%PROCESS_UPDATE_FEATURE_DISABLED%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','FEATURE_DISABLED')); END IF;
  IF SQLERRM LIKE '%PROCESS_UPDATE_READ_ONLY%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','READ_ONLY')); END IF;
  IF SQLERRM LIKE '%PROCESS_UPDATE_VERSION_CONFLICT%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','VERSION_CONFLICT')); END IF;
  IF SQLERRM LIKE '%PROCESS_UPDATE_INVALID_COMMAND%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_COMMAND')); END IF;
  IF SQLERRM LIKE '%PR1B_NOT_FOUND%' OR SQLERRM LIKE '%PROCESS_UPDATE_PERMISSION_DENIED%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','PERMISSION_DENIED')); END IF;
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','COMMAND_UNAVAILABLE'));
END$$;
REVOKE EXECUTE ON FUNCTION public.update_assess_process(uuid,uuid,uuid,bigint,uuid,text,bigint,uuid,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_assess_process(uuid,uuid,uuid,bigint,uuid,text,bigint,uuid,text,text,text,text)
 TO service_role;

COMMENT ON COLUMN public.assess_processes.authority_version IS
'Nullable migration-bound process metadata authority. Existing rows remain NULL/read-only; new rows default to version 1.';
COMMENT ON FUNCTION public.update_assess_process(uuid,uuid,uuid,bigint,uuid,text,bigint,uuid,text,text,text,text) IS
'Service-only, version-bound metadata update for a currently authorized owned process. It cannot change status, scores, thresholds, recommendations or discovery completion.';

DO $process_update_marker$
DECLARE
 final_activation_definition text;bootstrap_definition text;assert_marker_definition text;brd_v3_activation_definition text;
 old_not_equal text:='marker.migration_tip<>''20261010051100''';new_not_equal text:='marker.migration_tip<>''20261010051413''';
 old_equal text:='marker.migration_tip=''20261010051100''';new_equal text:='marker.migration_tip=''20261010051413''';
 old_assert text:='marker.migration_tip = ''20261010051100''';new_assert text:='marker.migration_tip = ''20261010051413''';
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
  CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232','20261008022445','20261009162752','20261010025331','20261010051100','20261010051413'));
 ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
 UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261010051413' WHERE singleton;
 ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20261010051413');
END
$process_update_marker$;
