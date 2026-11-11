-- PR 1D blocking correction: real V1 ancestry import and database-verified decision digests.
-- Additive only. The accepted 20260714120000 migration remains immutable.

ALTER TABLE public.assess_v2_case_versions
  ALTER COLUMN agent_necessity SET DEFAULT jsonb_build_object(
    'irreducibleAmbiguity',jsonb_build_object('fieldId','agent.irreducibleAmbiguity','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'adaptiveNextStep',jsonb_build_object('fieldId','agent.adaptiveNextStep','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'toolOrPathSelection',jsonb_build_object('fieldId','agent.toolOrPathSelection','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'incrementalValue',jsonb_build_object('fieldId','agent.incrementalValue','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'controllable',jsonb_build_object('fieldId','agent.controllable','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user')
  );

ALTER TABLE public.assess_v2_case_versions
  ADD COLUMN imported_facts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.assess_v2_case_versions
  ADD CONSTRAINT pr1d_imported_facts_array_check
  CHECK (jsonb_typeof(imported_facts) = 'array');

ALTER TABLE public.assess_v2_decision_versions
  ADD COLUMN input_canonical text,
  ADD COLUMN evidence_canonical text,
  ADD COLUMN output_canonical text;

CREATE UNIQUE INDEX pr1d_one_active_case_per_process
  ON public.assess_v2_cases(org_id,workspace_id,process_id)
  WHERE deleted_at IS NULL AND status IN ('draft','reviewer_ready');

CREATE OR REPLACE FUNCTION public.pr1d_v1_import_facts(p_responses jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
WITH RECURSIVE allowed(section_order,section) AS (
  VALUES (1,'processStructure'),(2,'workPattern'),(3,'dataProfile'),(4,'judgment'),(5,'systems'),(6,'risk')
), walk(section_order,path, value) AS (
  SELECT a.section_order,a.section, COALESCE(COALESCE(p_responses, '{}'::jsonb) -> a.section,'null'::jsonb)
  FROM allowed a
  UNION ALL
  SELECT w.section_order,w.path || '.' || child.key, child.value
  FROM walk w
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(w.value)='object' THEN w.value ELSE '{}'::jsonb END) child
), leaves AS (
  SELECT section_order,path, value
  FROM walk
  WHERE value IS NOT NULL AND jsonb_typeof(value) <> 'object'
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'fieldId', 'v1.responses.' || path,
  'value', CASE WHEN value = 'null'::jsonb OR value = '""'::jsonb THEN 'null'::jsonb ELSE value END,
  'status', CASE WHEN value = 'null'::jsonb OR value = '""'::jsonb THEN 'unknown' ELSE 'assumed' END,
  'evidenceIds', '[]'::jsonb,
  'source', 'v1-import'
) ORDER BY section_order,path), '[]'::jsonb)
FROM leaves
$$;

CREATE OR REPLACE FUNCTION public.pr1d_v1_evidence_id(p_assessment_id uuid,p_evidence_id text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  source_value text := 'assess-v1-evidence|' || p_assessment_id::text || '|' || p_evidence_id;
  seeds bigint[] := ARRAY[2166136261,2654435769,2246822507,3266489909];
  seed bigint;
  hash_value bigint;
  digest_hex text := '';
  variant_nibble integer;
  char_index integer;
BEGIN
  IF p_evidence_id !~ '^[A-Za-z0-9._:-]+$' THEN RETURN NULL; END IF;
  FOREACH seed IN ARRAY seeds LOOP
    hash_value := seed;
    FOR char_index IN 1..length(source_value) LOOP
      hash_value := mod((hash_value # ascii(substr(source_value,char_index,1))) * 16777619,4294967296);
    END LOOP;
    digest_hex := digest_hex || lpad(to_hex(hash_value),8,'0');
  END LOOP;
  variant_nibble := ((strpos('0123456789abcdef',substr(digest_hex,17,1))-1) & 3) | 8;
  RETURN (substr(digest_hex,1,8) || '-' || substr(digest_hex,9,4) || '-5' || substr(digest_hex,14,3) || '-' || to_hex(variant_nibble) || substr(digest_hex,18,3) || '-' || substr(digest_hex,21,12))::uuid;
END
$$;

DROP FUNCTION public.pr1d_clone_assess_v2_from_v1(uuid,uuid,uuid,uuid,uuid,text,text,uuid,text,bigint);

CREATE OR REPLACE FUNCTION public.pr1d_clone_assess_v2_from_v1(
  p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,
  p_source_assessment_id uuid,p_name text,p_description text,p_source_process_id uuid,
  p_source_v1 jsonb,p_imported_facts jsonb,p_imported_evidence jsonb,p_agent_necessity jsonb,
  p_clone_contract_version text,p_request_id uuid,
  p_idempotency_key text,p_authorization_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  a public.assessments;
  r public.assess_command_receipts;
  control public.assess_v2_runtime_control;
  c public.assess_v2_cases;
  v public.assess_v2_case_versions;
  source_aggregate jsonb;
  source_responses jsonb;
  source_evidence jsonb;
  source_assumptions jsonb;
  expected_imported_evidence jsonb;
  expected_response_facts jsonb;
  expected_assumption_facts jsonb;
  expected_imported_facts jsonb;
  expected_agent_necessity jsonb := jsonb_build_object(
    'irreducibleAmbiguity',jsonb_build_object('fieldId','agent.irreducibleAmbiguity','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'adaptiveNextStep',jsonb_build_object('fieldId','agent.adaptiveNextStep','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'toolOrPathSelection',jsonb_build_object('fieldId','agent.toolOrPathSelection','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'incrementalValue',jsonb_build_object('fieldId','agent.incrementalValue','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'controllable',jsonb_build_object('fieldId','agent.controllable','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user')
  );
  h text := encode(public.digest(concat_ws('|',p_org_id,p_workspace_id,p_case_id,p_source_assessment_id,p_name,p_description,p_source_process_id,(p_source_v1 - 'clonedAt')::text,p_imported_facts::text,p_imported_evidence::text,p_agent_necessity::text,p_clone_contract_version),'sha256'),'hex');
  result jsonb;
BEGIN
  IF p_clone_contract_version IS DISTINCT FROM 'assess-v1-to-v2-clone-2026-07-15' THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;
  SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled THEN RAISE EXCEPTION 'PR1D_FEATURE_DISABLED'; END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.clone',p_authorization_version);
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.create',p_authorization_version);
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.read',p_authorization_version);
  SELECT * INTO r FROM public.assess_command_receipts
   WHERE org_id=p_org_id AND actor_id=p_actor_id
     AND command_type='assessment_v2.clone_from_v1' AND idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.workspace_id<>p_workspace_id OR r.request_hash<>h OR r.status<>'succeeded'
      OR r.response->>'id'<>p_case_id::text
    THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
    RETURN jsonb_build_object('outcome','replayed','resource',r.response);
  END IF;
  IF control.read_only THEN RAISE EXCEPTION 'PR1D_READ_ONLY'; END IF;
  SELECT * INTO a FROM public.assessments
   WHERE id=p_source_assessment_id AND org_id=p_org_id AND workspace_id=p_workspace_id
     AND deleted_at IS NULL AND score_version='assess-core-2026-05'
     AND status IN ('Approved','Handed Off to Docs')
   FOR SHARE;
  IF a.id IS NULL THEN RETURN jsonb_build_object('errorCode','NOT_FOUND'); END IF;
  source_aggregate := CASE WHEN jsonb_typeof(a.responses)='object' AND a.responses ? 'responses' THEN a.responses ELSE NULL END;
  source_responses := CASE WHEN source_aggregate IS NULL OR source_aggregate->'responses' IS NULL OR source_aggregate->'responses'='null'::jsonb THEN a.responses ELSE source_aggregate->'responses' END;
  source_evidence := CASE WHEN source_aggregate IS NULL OR source_aggregate->'evidenceItems' IS NULL OR source_aggregate->'evidenceItems'='null'::jsonb THEN COALESCE(a.evidence_items,'[]'::jsonb) ELSE source_aggregate->'evidenceItems' END;
  source_assumptions := CASE WHEN source_aggregate IS NULL OR source_aggregate->'assumptions' IS NULL OR source_aggregate->'assumptions'='null'::jsonb THEN COALESCE(a.assumptions,'[]'::jsonb) ELSE source_aggregate->'assumptions' END;
  IF jsonb_typeof(source_responses) IS DISTINCT FROM 'object'
    OR jsonb_typeof(source_evidence) IS DISTINCT FROM 'array'
    OR jsonb_typeof(source_assumptions) IS DISTINCT FROM 'array'
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(source_evidence) item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
        OR item->>'id' !~ '^[A-Za-z0-9._:-]+$'
        OR (item ? 'linkedField' AND item->'linkedField'<>'null'::jsonb AND jsonb_typeof(item->'linkedField') IS DISTINCT FROM 'string')
        OR (item ? 'owner' AND item->'owner'<>'null'::jsonb AND jsonb_typeof(item->'owner') IS DISTINCT FROM 'string')
    ) OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(source_assumptions) item
      WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
        OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
        OR item->>'id' !~ '^[^.]+$'
        OR jsonb_typeof(item->'description') IS DISTINCT FROM 'string'
    ) OR EXISTS (
      SELECT item->>'id' FROM jsonb_array_elements(source_evidence) item GROUP BY item->>'id' HAVING count(*)>1
    )
  THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',public.pr1d_v1_evidence_id(a.id,item->>'id'),
    'claimIds',jsonb_build_array(CASE WHEN NULLIF(item->>'linkedField','') IS NULL THEN 'v1.evidence.' || (item->>'id') ELSE 'v1.responses.' || (item->>'linkedField') END),
    'sourceType','document','status','submitted','validated',false,
    'owner',CASE WHEN jsonb_typeof(item->'owner')='string' AND btrim(item->>'owner')<>'' THEN item->>'owner' ELSE NULL END,
    'reviewerIds','[]'::jsonb,'contradictory',false
  )) ORDER BY ordinal),'[]'::jsonb)
  INTO expected_imported_evidence
  FROM jsonb_array_elements(source_evidence) WITH ORDINALITY source_item(item,ordinal);

  SELECT COALESCE(jsonb_agg(
    CASE WHEN linked.id IS NULL THEN fact ELSE jsonb_set(fact,'{evidenceIds}',jsonb_build_array(linked.id)) END
    ORDER BY fact_ordinal
  ),'[]'::jsonb)
  INTO expected_response_facts
  FROM jsonb_array_elements(public.pr1d_v1_import_facts(source_responses)) WITH ORDINALITY source_fact(fact,fact_ordinal)
  LEFT JOIN LATERAL (
    SELECT evidence->>'id' id
    FROM jsonb_array_elements(expected_imported_evidence) WITH ORDINALITY source_link(evidence,evidence_ordinal)
    WHERE evidence->'claimIds'->>0=fact->>'fieldId'
    ORDER BY evidence_ordinal DESC LIMIT 1
  ) linked ON true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'fieldId','v1.assumptions.' || (item->>'id'),'value',item->'description','status','assumed',
    'evidenceIds','[]'::jsonb,'source','v1-import'
  ) ORDER BY ordinal),'[]'::jsonb)
  INTO expected_assumption_facts
  FROM jsonb_array_elements(source_assumptions) WITH ORDINALITY source_assumption(item,ordinal);
  expected_imported_facts := expected_response_facts || expected_assumption_facts;
  IF p_source_process_id IS DISTINCT FROM a.process_id
    OR jsonb_typeof(p_source_v1) IS DISTINCT FROM 'object'
    OR p_source_v1 IS DISTINCT FROM jsonb_build_object(
      'assessmentId',a.id,
      'scoreVersion',a.score_version,
      'clonedAt',p_source_v1->>'clonedAt',
      'importedAs','unverified-source-facts'
    )
    OR NULLIF(p_source_v1->>'clonedAt','') IS NULL
    OR jsonb_typeof(p_imported_facts) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_imported_evidence) IS DISTINCT FROM 'array'
    OR p_imported_facts IS DISTINCT FROM expected_imported_facts
    OR p_imported_evidence IS DISTINCT FROM expected_imported_evidence
    OR p_agent_necessity IS DISTINCT FROM expected_agent_necessity
  THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;
  BEGIN
    PERFORM (p_source_v1->>'clonedAt')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('errorCode','INVALID_COMMAND');
  END;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imported_facts) fact
    WHERE jsonb_typeof(fact) IS DISTINCT FROM 'object'
      OR NOT (fact ?& ARRAY['fieldId','value','status','evidenceIds','source'])
      OR (fact - ARRAY['fieldId','value','status','evidenceIds','source']) <> '{}'::jsonb
      OR fact->>'source' <> 'v1-import'
      OR fact->>'status' NOT IN ('assumed','unknown')
      OR jsonb_typeof(fact->'evidenceIds') IS DISTINCT FROM 'array'
      OR NOT (
        fact->>'fieldId' ~ '^v1\.responses\.(processStructure|workPattern|dataProfile|judgment|systems|risk)(\.|$)'
        OR fact->>'fieldId' ~ '^v1\.assumptions\.[^.]+$'
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(fact->'evidenceIds') evidence_id
        WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_imported_evidence) evidence WHERE evidence->>'id'=evidence_id)
      )
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_imported_evidence) evidence
    WHERE jsonb_typeof(evidence) IS DISTINCT FROM 'object'
      OR NOT (evidence ?& ARRAY['id','claimIds','sourceType','status','validated','reviewerIds','contradictory'])
      OR (evidence - ARRAY['id','claimIds','sourceType','status','validated','owner','reviewerIds','contradictory']) <> '{}'::jsonb
      OR evidence->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
      OR jsonb_typeof(evidence->'claimIds') IS DISTINCT FROM 'array'
      OR jsonb_array_length(evidence->'claimIds') = 0
      OR evidence->>'sourceType' <> 'document'
      OR evidence->>'status' <> 'submitted'
      OR evidence->'validated' <> 'false'::jsonb
      OR jsonb_typeof(evidence->'reviewerIds') IS DISTINCT FROM 'array'
      OR evidence->'contradictory' <> 'false'::jsonb
      OR (evidence ? 'owner' AND jsonb_typeof(evidence->'owner') IS DISTINCT FROM 'string')
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(evidence->'claimIds') claim_id
        WHERE NOT (
          claim_id ~ '^v1\.responses\.(processStructure|workPattern|dataProfile|judgment|systems|risk)(\.|$)'
          OR claim_id ~ '^v1\.evidence\.[A-Za-z0-9._:-]+$'
        )
      )
  ) THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;

  r := public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment_v2.clone_from_v1',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response); END IF;

  INSERT INTO public.assess_v2_cases(id,org_id,workspace_id,process_id,owner_id,source_v1_assessment_id,source_v1_score_version)
  VALUES(p_case_id,p_org_id,p_workspace_id,p_source_process_id,p_actor_id,a.id,a.score_version)
  RETURNING * INTO c;
  INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,imported_facts,created_by)
  VALUES(c.id,p_org_id,p_workspace_id,1,p_name,p_description,p_agent_necessity,'v1_clone',
    p_source_v1 || jsonb_build_object('factCount',jsonb_array_length(p_imported_facts),'evidenceCount',jsonb_array_length(p_imported_evidence)),
    p_imported_facts,p_actor_id)
  RETURNING * INTO v;
  INSERT INTO public.assess_v2_evidence_links(id,version_id,case_id,org_id,workspace_id,payload)
  SELECT (item->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,item
  FROM jsonb_array_elements(p_imported_evidence) item;
  UPDATE public.assess_v2_cases SET head_version_id=v.id WHERE id=c.id;
  result := jsonb_build_object('id',c.id,'status','draft','version',1,'headVersionId',v.id,'importedFactCount',jsonb_array_length(p_imported_facts),'importedEvidenceCount',jsonb_array_length(p_imported_evidence),'cloneContractVersion','assess-v1-to-v2-clone-2026-07-15');
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment_v2.clone_from_v1','assess_v2_case',c.id,'succeeded',1,
    jsonb_build_object('sourceScoreVersion',a.score_version,'importedFactCount',jsonb_array_length(p_imported_facts),'importedEvidenceCount',jsonb_array_length(p_imported_evidence)));
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
  h text:=encode(public.digest(concat_ws('|',p_org_id,p_workspace_id,p_case_id,p_process_id,p_name,p_description),'sha256'),'hex');
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
    IF r.workspace_id<>p_workspace_id OR r.request_hash<>h OR r.status<>'succeeded'
      OR r.response->>'id'<>p_case_id::text
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

CREATE OR REPLACE FUNCTION public.pr1d_load_assess_v2_case(p_case_id uuid,p_org_id uuid,p_workspace_id uuid,p_expected_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  c public.assess_v2_cases;
  v public.assess_v2_case_versions;
  legacy_create_agent_necessity jsonb := jsonb_build_object(
    'irreducibleAmbiguity',NULL,'adaptiveNextStep',NULL,'toolOrPathSelection',NULL,'incrementalValue',NULL,'controllable',NULL
  );
  initial_agent_necessity jsonb := jsonb_build_object(
    'irreducibleAmbiguity',jsonb_build_object('fieldId','agent.irreducibleAmbiguity','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'adaptiveNextStep',jsonb_build_object('fieldId','agent.adaptiveNextStep','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'toolOrPathSelection',jsonb_build_object('fieldId','agent.toolOrPathSelection','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'incrementalValue',jsonb_build_object('fieldId','agent.incrementalValue','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user'),
    'controllable',jsonb_build_object('fieldId','agent.controllable','value',NULL,'status','unknown','evidenceIds','[]'::jsonb,'source','user')
  );
BEGIN
  SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR SHARE;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  IF c.version<>p_expected_version OR c.status<>'draft' THEN RAISE EXCEPTION 'PR1D_VERSION_CONFLICT'; END IF;
  SELECT * INTO v FROM public.assess_v2_case_versions WHERE id=c.head_version_id;
  RETURN jsonb_build_object('id',c.id,'organizationId',c.org_id,'workspaceId',c.workspace_id,'sourceProcessId',c.process_id,'ownerId',c.owner_id,'status','draft','version',c.version,'schemaVersion',c.schema_version,'ruleSetVersion',c.rule_set_version,
    'sourceV1',CASE WHEN c.source_v1_assessment_id IS NULL THEN NULL ELSE jsonb_build_object(
      'assessmentId',c.source_v1_assessment_id,'scoreVersion',c.source_v1_score_version,
      'clonedAt',v.source_snapshot->>'clonedAt','importedAs','unverified-source-facts',
      'importedEvidenceClaimIds',COALESCE((
        SELECT jsonb_agg(source_claim.claim_id ORDER BY source_claim.claim_id)
        FROM (
          SELECT DISTINCT imported_claim.claim_id
          FROM public.assess_v2_evidence_links imported_evidence
          JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
          CROSS JOIN LATERAL jsonb_array_elements_text(imported_evidence.payload->'claimIds') imported_claim(claim_id)
          WHERE clone_version.case_id=c.id
            AND clone_version.version=1
            AND clone_version.source_kind='v1_clone'
            AND imported_claim.claim_id ~ '^v1\.evidence\.[A-Za-z0-9._:-]+$'
        ) source_claim
      ),'[]'::jsonb)
    ) END,
    'importedFacts',v.imported_facts,
    'primitives',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_primitives WHERE version_id=v.id),'[]'),
    'edges',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_edges WHERE version_id=v.id),'[]'),
    'decisionPoints',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_decision_points WHERE version_id=v.id),'[]'),
    'exceptionPaths',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_exception_paths WHERE version_id=v.id),'[]'),
    'assets',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_application_assets WHERE version_id=v.id),'[]'),
    'interactions',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_application_interactions WHERE version_id=v.id),'[]'),
    'evidence',COALESCE((SELECT jsonb_agg(projected.payload ORDER BY projected.id)
      FROM (
        SELECT current_evidence.id,current_evidence.payload
        FROM public.assess_v2_evidence_links current_evidence
        WHERE current_evidence.version_id=v.id
          AND NOT EXISTS (
            SELECT 1
            FROM public.assess_v2_evidence_links imported_evidence
            JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
            WHERE clone_version.case_id=c.id
              AND clone_version.version=1
              AND clone_version.source_kind='v1_clone'
              AND imported_evidence.id=current_evidence.id
          )
        UNION ALL
        SELECT imported_evidence.id,imported_evidence.payload
        FROM public.assess_v2_evidence_links imported_evidence
        JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
        WHERE clone_version.case_id=c.id
          AND clone_version.version=1
          AND clone_version.source_kind='v1_clone'
      ) projected),'[]'),'agentNecessity',CASE
        WHEN v.version=1 AND v.source_kind='create' AND v.agent_necessity=legacy_create_agent_necessity
        THEN initial_agent_necessity
        ELSE v.agent_necessity
      END,'createdAt',c.created_at,'updatedAt',c.updated_at);
END
$$;

CREATE OR REPLACE FUNCTION public.pr1d_canonical_json(p_value jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path=pg_catalog
AS $pr1d_canonical$
DECLARE canonical text;
BEGIN
  CASE jsonb_typeof(p_value)
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(to_jsonb(key)::text || ':' || public.pr1d_canonical_json(value), ',' ORDER BY key COLLATE "C"), '') || '}'
      INTO canonical
      FROM jsonb_each(p_value);
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg(public.pr1d_canonical_json(value), ',' ORDER BY ordinal), '') || ']'
      INTO canonical
      FROM jsonb_array_elements(p_value) WITH ORDINALITY AS item(value, ordinal);
    ELSE canonical := p_value::text;
  END CASE;
  RETURN canonical;
END
$pr1d_canonical$;

CREATE OR REPLACE FUNCTION public.pr1d_verify_bound_canonical(
  p_domain text,p_canonical text,p_snapshot jsonb,p_hash text,
  p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_source_version bigint,
  p_schema_version text,p_rule_set_version text,p_decision_version text
)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE parsed jsonb; expected jsonb;
BEGIN
  IF p_domain NOT IN ('input','evidence','output') OR p_canonical IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  BEGIN parsed := p_canonical::jsonb; EXCEPTION WHEN OTHERS THEN RETURN false; END;
  expected := jsonb_build_object(
    'canonicalizationVersion','avala-canonical-json-1','domain',p_domain,
    'organizationId',p_org_id::text,'workspaceId',p_workspace_id::text,'caseId',p_case_id::text,
    'sourceCaseVersion',p_source_version,'schemaVersion',p_schema_version,
    'ruleSetVersion',p_rule_set_version,'decisionVersion',p_decision_version,'payload',p_snapshot);
  RETURN p_canonical=public.pr1d_canonical_json(parsed)
    AND parsed=expected
    AND encode(public.digest(convert_to(p_canonical,'UTF8'),'sha256'),'hex')=p_hash;
END
$$;

DROP FUNCTION public.pr1d_finalize_assess_v2_case(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb,text,text,text,text,text,timestamptz,uuid,text,bigint);

CREATE OR REPLACE FUNCTION public.pr1d_finalize_assess_v2_case(
  p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_expected_version bigint,
  p_source_case jsonb,p_input_canonical text,p_evidence_snapshot jsonb,p_evidence_canonical text,
  p_output_snapshot jsonb,p_output_canonical text,p_input_hash text,p_evidence_hash text,p_output_hash text,
  p_rule_set_version text,p_decision_version text,p_created_at timestamptz,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.assess_v2_cases;r public.assess_command_receipts;d public.assess_v2_decision_versions;x jsonb;
  authoritative_source jsonb;authoritative_evidence jsonb;
  h text:=encode(public.digest(concat_ws('|',p_org_id,p_workspace_id,p_case_id,p_expected_version,p_input_hash,p_evidence_hash,p_output_hash),'sha256'),'hex');result jsonb;
BEGIN
  PERFORM public.pr1d_assert_enabled();
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.finalize',p_authorization_version);
  SELECT * INTO r FROM public.assess_command_receipts WHERE org_id=p_org_id AND actor_id=p_actor_id AND command_type='assessment_v2.finalize' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.request_hash<>h THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
    IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response); END IF;
  END IF;
  SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('errorCode','NOT_FOUND'); END IF;
  -- The case lock can have waited behind a same-key commit. Recheck the receipt
  -- while holding that lock so the waiter replays instead of observing the new
  -- case status/version and incorrectly reporting a conflict.
  SELECT * INTO r FROM public.assess_command_receipts WHERE org_id=p_org_id AND actor_id=p_actor_id AND command_type='assessment_v2.finalize' AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.request_hash<>h THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
    IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response); END IF;
  END IF;
  IF c.status<>'draft' OR c.version<>p_expected_version THEN RETURN jsonb_build_object('errorCode','VERSION_CONFLICT'); END IF;
  authoritative_source:=public.pr1d_load_assess_v2_case(c.id,c.org_id,c.workspace_id,c.version);
  authoritative_evidence:=authoritative_source->'evidence';
  IF p_source_case IS DISTINCT FROM authoritative_source
    OR p_evidence_snapshot IS DISTINCT FROM authoritative_evidence
    OR p_rule_set_version<>c.rule_set_version
    OR p_output_snapshot->>'caseId'<>c.id::text
    OR p_output_snapshot->>'validationStatus'<>'reviewer-ready'
  THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;
  IF NOT public.pr1d_verify_bound_canonical('input',p_input_canonical,authoritative_source,p_input_hash,p_org_id,p_workspace_id,p_case_id,c.version,c.schema_version,p_rule_set_version,p_decision_version)
    OR NOT public.pr1d_verify_bound_canonical('evidence',p_evidence_canonical,authoritative_evidence,p_evidence_hash,p_org_id,p_workspace_id,p_case_id,c.version,c.schema_version,p_rule_set_version,p_decision_version)
    OR NOT public.pr1d_verify_bound_canonical('output',p_output_canonical,p_output_snapshot,p_output_hash,p_org_id,p_workspace_id,p_case_id,c.version,c.schema_version,p_rule_set_version,p_decision_version)
  THEN RETURN jsonb_build_object('errorCode','INVALID_COMMAND'); END IF;

  r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment_v2.finalize',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response); END IF;
  INSERT INTO public.assess_v2_decision_versions(case_id,source_version_id,org_id,workspace_id,schema_version,rule_set_version,decision_version,validation_status,input_snapshot,evidence_snapshot,output_snapshot,input_canonical,evidence_canonical,output_canonical,input_hash,evidence_hash,output_hash,receipt_id,created_by,created_at)
  VALUES(c.id,c.head_version_id,p_org_id,p_workspace_id,c.schema_version,p_rule_set_version,p_decision_version,'reviewer-ready',authoritative_source,authoritative_evidence,p_output_snapshot,p_input_canonical,p_evidence_canonical,p_output_canonical,p_input_hash,p_evidence_hash,p_output_hash,r.id,p_actor_id,p_created_at) RETURNING * INTO d;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_output_snapshot->'candidateEvaluations','[]'::jsonb)) LOOP INSERT INTO public.assess_v2_candidate_evaluations VALUES(gen_random_uuid(),d.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_output_snapshot->'gateResults','[]'::jsonb)) LOOP INSERT INTO public.assess_v2_gate_results VALUES(gen_random_uuid(),d.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_output_snapshot->'controlRequirements','[]'::jsonb)) LOOP INSERT INTO public.assess_v2_control_requirements VALUES(gen_random_uuid(),d.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_output_snapshot->'modernization','[]'::jsonb)) LOOP INSERT INTO public.assess_v2_modernization_dispositions VALUES(gen_random_uuid(),d.id,c.id,p_org_id,p_workspace_id,x);END LOOP;
  UPDATE public.assess_v2_cases SET status='reviewer_ready',version=version+1,updated_at=now() WHERE id=c.id;
  result:=jsonb_build_object('id',c.id,'status','reviewer_ready','version',c.version+1,'headVersionId',c.head_version_id,'decisionId',d.id);
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata) VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment_v2.finalize','assess_v2_case',c.id,'succeeded',c.version+1,jsonb_build_object('decisionId',d.id,'ruleSetVersion',p_rule_set_version,'decisionVersion',p_decision_version,'inputHash',p_input_hash,'evidenceHash',p_evidence_hash,'outputHash',p_output_hash));
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

CREATE OR REPLACE FUNCTION public.pr1d_replay_assess_v2_finalize(
  p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_expected_version bigint,
  p_idempotency_key text,p_authorization_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.assess_command_receipts; control public.assess_v2_runtime_control;
BEGIN
  SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled THEN
    RAISE EXCEPTION 'PR1D_FEATURE_DISABLED';
  END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.finalize',p_authorization_version);
  SELECT * INTO r FROM public.assess_command_receipts
    WHERE org_id=p_org_id AND actor_id=p_actor_id
      AND command_type='assessment_v2.finalize' AND idempotency_key=p_idempotency_key
    FOR UPDATE;
  IF r.id IS NULL THEN
    IF control.read_only THEN RAISE EXCEPTION 'PR1D_READ_ONLY'; END IF;
    RETURN jsonb_build_object('errorCode','NOT_FOUND');
  END IF;
  IF r.workspace_id<>p_workspace_id
    OR r.status<>'succeeded'
    OR r.response->>'id'<>p_case_id::text
    OR (r.response->>'version')::bigint<>p_expected_version+1
  THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('outcome','replayed','resource',r.response);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE');
  ELSIF SQLERRM LIKE '%PR1D_FEATURE_DISABLED%' THEN RETURN jsonb_build_object('errorCode','FEATURE_DISABLED');
  ELSIF SQLERRM LIKE '%PR1D_READ_ONLY%' THEN RETURN jsonb_build_object('errorCode','READ_ONLY');
  END IF;
  RAISE;
END
$$;

CREATE OR REPLACE FUNCTION public.pr1d_replay_assess_v2_clone(
  p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_source_assessment_id uuid,
  p_name text,p_description text,p_idempotency_key text,p_authorization_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  r public.assess_command_receipts;
  control public.assess_v2_runtime_control;
  v public.assess_v2_case_versions;
  imported_evidence_count bigint;
BEGIN
  SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
  IF control.singleton IS NULL OR NOT control.enabled THEN RAISE EXCEPTION 'PR1D_FEATURE_DISABLED'; END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.clone',p_authorization_version);
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.v2.create',p_authorization_version);
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.read',p_authorization_version);
  SELECT * INTO r FROM public.assess_command_receipts
   WHERE org_id=p_org_id AND actor_id=p_actor_id
     AND command_type='assessment_v2.clone_from_v1' AND idempotency_key=p_idempotency_key
   FOR UPDATE;
  IF r.id IS NULL THEN
    IF control.read_only THEN RAISE EXCEPTION 'PR1D_READ_ONLY'; END IF;
    RETURN jsonb_build_object('errorCode','NOT_FOUND');
  END IF;
  SELECT * INTO v FROM public.assess_v2_case_versions
   WHERE id::text=r.response->>'headVersionId' AND case_id=p_case_id
     AND org_id=p_org_id AND workspace_id=p_workspace_id
     AND version=1 AND source_kind='v1_clone';
  SELECT count(*) INTO imported_evidence_count FROM public.assess_v2_evidence_links WHERE version_id=v.id;
  IF r.workspace_id<>p_workspace_id OR r.status<>'succeeded'
    OR r.request_hash !~ '^[0-9a-f]{64}$'
    OR r.response->>'id'<>p_case_id::text
    OR r.response->>'status'<>'draft' OR r.response->>'version'<>'1'
    OR r.response->>'cloneContractVersion'<>'assess-v1-to-v2-clone-2026-07-15'
    OR v.id IS NULL OR v.name IS DISTINCT FROM p_name OR v.description IS DISTINCT FROM p_description
    OR v.source_snapshot->>'assessmentId' IS DISTINCT FROM p_source_assessment_id::text
    OR r.response->>'importedFactCount' IS DISTINCT FROM jsonb_array_length(v.imported_facts)::text
    OR r.response->>'importedEvidenceCount' IS DISTINCT FROM imported_evidence_count::text
  THEN RETURN jsonb_build_object('errorCode','IDEMPOTENCY_CONFLICT'); END IF;
  RETURN jsonb_build_object('outcome','replayed','resource',r.response);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE');
  ELSIF SQLERRM LIKE '%PR1D_FEATURE_DISABLED%' THEN RETURN jsonb_build_object('errorCode','FEATURE_DISABLED');
  ELSIF SQLERRM LIKE '%PR1D_READ_ONLY%' THEN RETURN jsonb_build_object('errorCode','READ_ONLY');
  END IF;
  RAISE;
END
$$;

REVOKE ALL ON FUNCTION public.pr1d_v1_import_facts(jsonb),public.pr1d_v1_evidence_id(uuid,text),public.pr1d_canonical_json(jsonb),public.pr1d_verify_bound_canonical(text,text,jsonb,text,uuid,uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
-- These SECURITY DEFINER helpers are implementation details, not callable API.
-- Keep invocation authority with the function owner so the private RPCs can use
-- them without exposing a direct bypass to any PostgREST role.
REVOKE ALL ON FUNCTION public.pr1d_assert_enabled(),public.pr1d_resource(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1d_finalize_assess_v2_case(uuid,uuid,uuid,uuid,bigint,jsonb,text,jsonb,text,jsonb,text,text,text,text,text,text,timestamptz,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pr1d_replay_assess_v2_finalize(uuid,uuid,uuid,uuid,bigint,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pr1d_replay_assess_v2_clone(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pr1d_clone_assess_v2_from_v1(uuid,uuid,uuid,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,jsonb,text,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1d_clone_assess_v2_from_v1(uuid,uuid,uuid,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb,jsonb,text,uuid,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pr1d_finalize_assess_v2_case(uuid,uuid,uuid,uuid,bigint,jsonb,text,jsonb,text,jsonb,text,text,text,text,text,text,timestamptz,uuid,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pr1d_replay_assess_v2_finalize(uuid,uuid,uuid,uuid,bigint,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pr1d_replay_assess_v2_clone(uuid,uuid,uuid,uuid,uuid,text,text,text,bigint) TO service_role;

COMMENT ON COLUMN public.assess_v2_case_versions.imported_facts IS 'Immutable allowlisted V1 facts imported as assumed/unknown with source=v1-import.';
COMMENT ON FUNCTION public.pr1d_v1_evidence_id(uuid,text) IS 'Internal deterministic V1 evidence surrogate used to compare clone projections with the locked source row.';
COMMENT ON FUNCTION public.pr1d_verify_bound_canonical(text,text,jsonb,text,uuid,uuid,uuid,bigint,text,text,text) IS 'Internal digest verifier; no role receives execute authority.';
COMMENT ON FUNCTION public.pr1d_canonical_json(jsonb) IS 'Internal deterministic JSON serializer for Assess V2 canonical snapshot verification.';
COMMENT ON FUNCTION public.pr1d_assert_enabled() IS 'Internal SECURITY DEFINER runtime-control helper; callable only by the owning role through private RPCs.';
COMMENT ON FUNCTION public.pr1d_resource(uuid,uuid,uuid) IS 'Internal SECURITY DEFINER tenant-bound resource helper; callable only by the owning role through private RPCs.';

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
  SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('errorCode','NOT_FOUND');END IF;
  -- Recheck after the case lock: a concurrent same-key writer may have completed while this call was waiting.
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
  -- A clone's imported evidence is immutable provenance. Exact copies may be
  -- round-tripped by an authoring client, but an altered same-ID payload must
  -- fail before the command receipt, version, evidence, or audit is written.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_authoring->'evidence','[]'::jsonb)) authored(payload)
    JOIN public.assess_v2_evidence_links imported_evidence ON imported_evidence.id::text=authored.payload->>'id'
    JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
    WHERE clone_version.case_id=c.id
      AND clone_version.version=1
      AND clone_version.source_kind='v1_clone'
      AND authored.payload IS DISTINCT FROM (
        imported_evidence.payload - ARRAY['reviewerIds','contradictory']
      )
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
      SELECT 1
      FROM public.assess_v2_evidence_links imported_evidence
      JOIN public.assess_v2_case_versions clone_version ON clone_version.id=imported_evidence.version_id
      WHERE clone_version.case_id=c.id
        AND clone_version.version=1
        AND clone_version.source_kind='v1_clone'
        AND imported_evidence.id::text=x->>'id'
    ) THEN
      INSERT INTO public.assess_v2_evidence_links VALUES((x->>'id')::uuid,v.id,c.id,p_org_id,p_workspace_id,x);
    END IF;
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

CREATE OR REPLACE FUNCTION public.pr1b_upsert_assessment_responses(
  p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_assessment_id uuid,p_responses jsonb,
  p_expected_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  r public.assess_command_receipts;
  a public.assessments;
  h text:=md5(concat_ws('|',p_org_id,p_workspace_id,p_assessment_id,p_expected_version,p_responses::text));
  result jsonb;
  reopen_requested_changes boolean:=false;
BEGIN
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.response.write',p_authorization_version);
  IF p_responses IS NULL OR jsonb_typeof(p_responses)<>'object'
    OR NOT (p_responses ?& ARRAY['responses','metadata','evidenceItems','assumptions'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_responses))<>4
    OR jsonb_typeof(p_responses->'responses')<>'object'
    OR jsonb_typeof(p_responses->'metadata')<>'object'
    OR jsonb_typeof(p_responses->'evidenceItems')<>'array'
    OR jsonb_typeof(p_responses->'assumptions')<>'array'
  THEN RAISE EXCEPTION 'PR1B_INVALID_COMMAND'; END IF;

  SELECT * INTO r FROM public.assess_command_receipts
  WHERE org_id=p_org_id AND actor_id=p_actor_id
    AND command_type='assessment.response.upsert' AND idempotency_key=p_idempotency_key
  FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.request_hash<>h THEN RAISE EXCEPTION 'PR1B_IDEMPOTENCY_CONFLICT'; END IF;
    IF r.status='succeeded' THEN RETURN r.response; END IF;
  END IF;

  SELECT * INTO a FROM public.assessments
  WHERE id=p_assessment_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL
  FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;

  -- A same-key writer can commit while this call waits on the assessment lock.
  SELECT * INTO r FROM public.assess_command_receipts
  WHERE org_id=p_org_id AND actor_id=p_actor_id
    AND command_type='assessment.response.upsert' AND idempotency_key=p_idempotency_key
  FOR UPDATE;
  IF r.id IS NOT NULL THEN
    IF r.request_hash<>h THEN RAISE EXCEPTION 'PR1B_IDEMPOTENCY_CONFLICT'; END IF;
    IF r.status='succeeded' THEN RETURN r.response; END IF;
  END IF;

  IF a.version<>p_expected_version OR a.status NOT IN ('Draft','Changes Requested') THEN
    RAISE EXCEPTION 'PR1B_VERSION_CONFLICT';
  END IF;
  reopen_requested_changes:=a.status='Changes Requested';

  r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment.response.upsert',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN RETURN r.response; END IF;

  UPDATE public.assessments SET
    responses=p_responses,
    status=CASE WHEN reopen_requested_changes THEN 'Draft' ELSE status END,
    scores=CASE WHEN reopen_requested_changes THEN NULL ELSE scores END,
    score_version=CASE WHEN reopen_requested_changes THEN NULL ELSE score_version END,
    version=version+1,updated_by=p_actor_id,updated_at=now()
  WHERE id=a.id
  RETURNING * INTO a;

  result:=jsonb_build_object('ok',true,'outcome','committed','resource',
    jsonb_build_object('assessmentId',a.id,'version',a.version,'status',a.status));
  INSERT INTO public.privileged_audit_events(
    org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata
  ) VALUES(
    p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment.response.upsert','assessment',a.id,'succeeded',a.version,
    CASE WHEN reopen_requested_changes THEN jsonb_build_object('reopenedFrom','Changes Requested','scoreCleared',true) ELSE '{}'::jsonb END
  );
  UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%PR1B_%' THEN
    RAISE LOG 'PR1B_COMMAND_UNAVAILABLE function=pr1b_upsert_assessment_responses sqlstate=%',SQLSTATE;
  END IF;
  RETURN public.pr1b_error_envelope(SQLERRM);
END
$$;

REVOKE ALL ON FUNCTION public.pr1b_upsert_assessment_responses(uuid,uuid,uuid,uuid,jsonb,bigint,uuid,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1b_upsert_assessment_responses(uuid,uuid,uuid,uuid,jsonb,bigint,uuid,text,bigint) TO service_role;
