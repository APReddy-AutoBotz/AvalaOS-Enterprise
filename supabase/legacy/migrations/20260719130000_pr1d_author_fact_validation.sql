-- PR 1D narrow correction: enforce Edge-equivalent author fact provenance at
-- the private service-role draft RPC boundary. Trusted V1 clone imports remain
-- immutable server-owned data and are not accepted through p_authoring.

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

CREATE OR REPLACE FUNCTION public.pr1d_author_agent_necessity_valid(p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
  key_name text;
  field_id text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value)<>'object'
    OR NOT (p_value ?& ARRAY['irreducibleAmbiguity','adaptiveNextStep','toolOrPathSelection','incrementalValue','controllable'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_value))<>5
  THEN RETURN false; END IF;
  FOR key_name,field_id IN
    SELECT * FROM (VALUES
      ('irreducibleAmbiguity','agent.irreducibleAmbiguity'),
      ('adaptiveNextStep','agent.adaptiveNextStep'),
      ('toolOrPathSelection','agent.toolOrPathSelection'),
      ('incrementalValue','agent.incrementalValue'),
      ('controllable','agent.controllable')
    ) expected(key_name,field_id)
  LOOP
    IF NOT public.pr1d_author_fact_valid(p_value->key_name,field_id,true) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION public.pr1d_authoring_facts_valid(p_authoring jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE
  primitive jsonb;
  fact_entry record;
BEGIN
  IF p_authoring IS NULL OR jsonb_typeof(p_authoring)<>'object'
    OR jsonb_typeof(p_authoring->'primitives')<>'array'
    OR NOT public.pr1d_author_agent_necessity_valid(p_authoring->'agentNecessity')
  THEN RETURN false; END IF;
  FOR primitive IN SELECT value FROM jsonb_array_elements(p_authoring->'primitives') LOOP
    IF jsonb_typeof(primitive)<>'object' OR jsonb_typeof(primitive->'facts')<>'object' THEN RETURN false; END IF;
    FOR fact_entry IN SELECT key,value FROM jsonb_each(primitive->'facts') LOOP
      IF NOT public.pr1d_author_fact_valid(fact_entry.value,fact_entry.key,false) THEN RETURN false; END IF;
    END LOOP;
    IF primitive ? 'agentNecessity'
      AND NOT public.pr1d_author_agent_necessity_valid(primitive->'agentNecessity')
    THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.pr1d_author_fact_valid(jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1d_author_agent_necessity_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1d_authoring_facts_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.pr1d_upsert_assess_v2_draft(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_expected_version bigint,p_authoring jsonb,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.assess_v2_cases;r public.assess_command_receipts;v public.assess_v2_case_versions;prior public.assess_v2_case_versions;control public.assess_v2_runtime_control;x jsonb;h text:=encode(public.digest(concat_ws('|',p_org_id,p_workspace_id,p_case_id,p_expected_version,p_authoring::text),'sha256'),'hex');result jsonb;
BEGIN
  SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled THEN RAISE EXCEPTION 'PR1D_FEATURE_DISABLED'; END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.draft.write',p_authorization_version);
  SELECT * INTO r FROM public.assess_command_receipts WHERE org_id=p_org_id AND actor_id=p_actor_id AND command_type='assessment_v2.draft.upsert' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.workspace_id<>p_workspace_id OR r.request_hash<>h OR r.status<>'succeeded'
      OR r.response->>'id' IS DISTINCT FROM p_case_id::text
      OR r.response->>'status' IS DISTINCT FROM 'draft'
      OR r.response->>'version' IS DISTINCT FROM (p_expected_version+1)::text
    THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('outcome','replayed','resource',r.response);
  END IF;
  IF control.read_only THEN RAISE EXCEPTION 'PR1D_READ_ONLY'; END IF;
  -- This guard intentionally precedes both the case mutation lock and command
  -- claim so malformed direct service-role calls have zero durable side effects.
  IF NOT public.pr1d_authoring_facts_valid(p_authoring) THEN
    RETURN jsonb_build_object('errorCode','INVALID_COMMAND');
  END IF;
  SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('errorCode','NOT_FOUND');END IF;
  SELECT * INTO r FROM public.assess_command_receipts WHERE org_id=p_org_id AND actor_id=p_actor_id AND command_type='assessment_v2.draft.upsert' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.workspace_id<>p_workspace_id OR r.request_hash<>h OR r.status<>'succeeded'
      OR r.response->>'id' IS DISTINCT FROM p_case_id::text
      OR r.response->>'status' IS DISTINCT FROM 'draft'
      OR r.response->>'version' IS DISTINCT FROM (p_expected_version+1)::text
    THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('outcome','replayed','resource',r.response);
  END IF;
  IF c.status<>'draft' OR c.version<>p_expected_version THEN RETURN jsonb_build_object('errorCode','VERSION_CONFLICT');END IF;
  SELECT * INTO prior FROM public.assess_v2_case_versions WHERE id=c.head_version_id;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_authoring->'evidence','[]'::jsonb)) authored(payload)
    JOIN public.assess_v2_evidence_links imported_evidence ON imported_evidence.id::text=authored.payload->>'id'
    JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
    WHERE clone_version.case_id=c.id
      AND clone_version.version=1
      AND clone_version.source_kind='v1_clone'
      AND authored.payload IS DISTINCT FROM (imported_evidence.payload - ARRAY['reviewerIds','contradictory'])
  ) THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;
  r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment_v2.draft.upsert',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response);END IF;
  INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,imported_facts,created_by)
  VALUES(c.id,p_org_id,p_workspace_id,c.version+1,p_authoring->>'name',p_authoring->>'description',p_authoring->'agentNecessity','draft_upsert',prior.source_snapshot,prior.imported_facts,p_actor_id) RETURNING * INTO v;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'primitives') LOOP INSERT INTO public.assess_v2_primitives VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'edges') LOOP INSERT INTO public.assess_v2_edges VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'decisionPoints') LOOP INSERT INTO public.assess_v2_decision_points VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'exceptionPaths') LOOP INSERT INTO public.assess_v2_exception_paths VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'assets') LOOP INSERT INTO public.assess_v2_application_assets VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'interactions') LOOP INSERT INTO public.assess_v2_application_interactions VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(p_authoring->'evidence') LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.assess_v2_evidence_links imported_evidence
      JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
      WHERE clone_version.case_id=c.id AND clone_version.version=1 AND clone_version.source_kind='v1_clone'
        AND imported_evidence.id::text=x->>'id'
    ) THEN INSERT INTO public.assess_v2_evidence_links VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x); END IF;
  END LOOP;
  UPDATE public.assess_v2_cases SET version=v.version,head_version_id=v.id,updated_at=now() WHERE id=c.id;
  result:=jsonb_build_object('id',c.id,'status','draft','version',v.version,'headVersionId',v.id,'importedFactCount',jsonb_array_length(v.imported_facts));
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version) VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment_v2.draft.upsert','assess_v2_case',c.id,'succeeded',v.version);
  UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('outcome','committed','resource',result);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%PR1B_IDEMPOTENCY_CONFLICT%' THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT');
  ELSIF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE');
  ELSIF SQLERRM LIKE '%PR1D_FEATURE_DISABLED%' THEN RETURN jsonb_build_object('errorCode','FEATURE_DISABLED');
  ELSIF SQLERRM LIKE '%PR1D_READ_ONLY%' THEN RETURN jsonb_build_object('errorCode','READ_ONLY');END IF;
  RAISE;
END
$$;

REVOKE ALL ON FUNCTION public.pr1d_upsert_assess_v2_draft(uuid,uuid,uuid,uuid,bigint,jsonb,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1d_upsert_assess_v2_draft(uuid,uuid,uuid,uuid,bigint,jsonb,uuid,text,bigint) TO service_role;

COMMENT ON FUNCTION public.pr1d_authoring_facts_valid(jsonb) IS
  'Private service-role defense-in-depth validator for author-authored PR 1D primitive and agent facts.';
COMMENT ON FUNCTION public.pr1d_upsert_assess_v2_draft(uuid,uuid,uuid,uuid,bigint,jsonb,uuid,text,bigint) IS
  'Atomically persists a validated PR 1D draft while preserving immutable trusted V1 imports.';
