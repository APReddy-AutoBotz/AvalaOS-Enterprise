-- PR 1D narrow correction: close SQL NULL fact-source bypasses and make
-- create idempotency equality unambiguous without invalidating correct legacy
-- receipts produced before the canonical request hash was introduced.

CREATE OR REPLACE FUNCTION public.pr1d_author_fact_valid(
  p_fact jsonb,
  p_expected_field_id text,
  p_agent_boolean boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
  evidence_id jsonb;
  is_null boolean;
  is_unknown boolean;
BEGIN
  IF p_fact IS NULL OR jsonb_typeof(p_fact)<>'object'
    OR NOT (p_fact ?& ARRAY['fieldId','value','status','evidenceIds','source'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_fact))<>5
    OR p_fact->>'fieldId' IS DISTINCT FROM p_expected_field_id
    OR p_fact->>'status' NOT IN ('known','unknown','suggested','assumed')
    OR jsonb_typeof(p_fact->'source')<>'string'
    OR p_fact->>'source' NOT IN ('user','system','template')
    OR jsonb_typeof(p_fact->'evidenceIds')<>'array'
  THEN RETURN false; END IF;

  is_null:=jsonb_typeof(p_fact->'value')='null';
  is_unknown:=p_fact->>'status'='unknown';
  IF is_null IS DISTINCT FROM is_unknown
    OR (p_fact->>'source'='template' AND p_fact->>'status'='known')
    OR (p_agent_boolean AND NOT is_null AND jsonb_typeof(p_fact->'value')<>'boolean')
  THEN RETURN false; END IF;

  FOR evidence_id IN SELECT value FROM jsonb_array_elements(p_fact->'evidenceIds') LOOP
    IF jsonb_typeof(evidence_id)<>'string'
      OR trim(both '"' from evidence_id::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.pr1d_create_assess_v2_case(
  p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_process_id uuid,
  p_name text,p_description text,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  r public.assess_command_receipts;
  c public.assess_v2_cases;
  v public.assess_v2_case_versions;
  control public.assess_v2_runtime_control;
  initial_agent_necessity jsonb := jsonb_build_object(
    'irreducibleAmbiguity',jsonb_build_object('fieldId','agent.irreducibleAmbiguity','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'adaptiveNextStep',jsonb_build_object('fieldId','agent.adaptiveNextStep','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'toolOrPathSelection',jsonb_build_object('fieldId','agent.toolOrPathSelection','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'incrementalValue',jsonb_build_object('fieldId','agent.incrementalValue','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'controllable',jsonb_build_object('fieldId','agent.controllable','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user')
  );
  request_payload jsonb:=jsonb_build_object(
    'organizationId',p_org_id,
    'workspaceId',p_workspace_id,
    'caseId',p_case_id,
    'processId',p_process_id,
    'name',p_name,
    'description',p_description
  );
  h text:=encode(public.digest(request_payload::text,'sha256'),'hex');
  legacy_h text:=encode(public.digest(concat_ws('|',p_org_id,p_workspace_id,p_case_id,p_process_id,p_name,p_description),'sha256'),'hex');
  result jsonb;
BEGIN
  SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled THEN RAISE EXCEPTION 'PR1D_FEATURE_DISABLED'; END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.create',p_authorization_version);
  SELECT * INTO r FROM public.assess_command_receipts
   WHERE org_id=p_org_id AND actor_id=p_actor_id
     AND command_type='assessment_v2.create' AND idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.workspace_id<>p_workspace_id OR r.status<>'succeeded'
      OR r.response->>'id' IS DISTINCT FROM p_case_id::text
      OR (
        r.request_hash<>h
        AND (
          r.request_hash<>legacy_h
          OR NOT EXISTS (
            SELECT 1
            FROM public.assess_v2_cases existing_case
            JOIN public.assess_v2_case_versions existing_version
              ON existing_version.case_id=existing_case.id AND existing_version.version=1
            WHERE existing_case.id=p_case_id
              AND existing_case.org_id=p_org_id
              AND existing_case.workspace_id=p_workspace_id
              AND existing_case.process_id=p_process_id
              AND existing_version.name IS NOT DISTINCT FROM p_name
              AND existing_version.description IS NOT DISTINCT FROM p_description
          )
        )
      )
    THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('outcome','replayed','resource',r.response);
  END IF;
  IF control.read_only THEN RAISE EXCEPTION 'PR1D_READ_ONLY'; END IF;
  PERFORM 1 FROM public.assess_processes
    WHERE id=p_process_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL
    FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('errorCode','NOT_FOUND'); END IF;
  r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment_v2.create',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response); END IF;
  IF r.status<>'in_progress' THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
  INSERT INTO public.assess_v2_cases(id,org_id,workspace_id,process_id,owner_id)
  VALUES(p_case_id,p_org_id,p_workspace_id,p_process_id,p_actor_id) RETURNING * INTO c;
  INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,created_by)
  VALUES(c.id,p_org_id,p_workspace_id,1,p_name,p_description,initial_agent_necessity,'create',p_actor_id) RETURNING * INTO v;
  UPDATE public.assess_v2_cases SET head_version_id=v.id WHERE id=c.id;
  result:=jsonb_build_object('id',c.id,'status','draft','version',1,'headVersionId',v.id);
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version)
  VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment_v2.create','assess_v2_case',c.id,'succeeded',1);
  UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('outcome','committed','resource',result);
EXCEPTION
  WHEN unique_violation THEN RETURN jsonb_build_object('errorCode','VERSION_CONFLICT');
  WHEN OTHERS THEN
    IF SQLERRM LIKE '%PR1B_IDEMPOTENCY_CONFLICT%' THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT');
    ELSIF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE');
    ELSIF SQLERRM LIKE '%PR1D_FEATURE_DISABLED%' THEN RETURN jsonb_build_object('errorCode','FEATURE_DISABLED');
    ELSIF SQLERRM LIKE '%PR1D_READ_ONLY%' THEN RETURN jsonb_build_object('errorCode','READ_ONLY');
    END IF;
    RAISE;
END
$$;

REVOKE ALL ON FUNCTION public.pr1d_author_fact_valid(jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1d_create_assess_v2_case(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1d_create_assess_v2_case(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,bigint) TO service_role;

COMMENT ON FUNCTION public.pr1d_author_fact_valid(jsonb,text,boolean) IS
  'Private service-role fact validator requiring explicit string author provenance.';
COMMENT ON FUNCTION public.pr1d_create_assess_v2_case(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,bigint) IS
  'Creates a PR 1D case with canonical idempotency hashing and exact legacy-replay validation.';

