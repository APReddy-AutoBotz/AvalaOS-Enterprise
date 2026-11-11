-- Generate the exact CH-10 direct planning PDD without a provider call. The
-- historical Assess-derived CH-03 contract remains a separate implementation.
ALTER FUNCTION public.pr_c_controlled_human_synthetic_studio_generate(jsonb)
 RENAME TO pr_c_controlled_human_synthetic_assess_studio_generate;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_synthetic_direct_studio_generate(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE
 exercise public.pr_c_controlled_human_exercises;
 persona public.pr_c_controlled_human_persona_bindings;
 catalog_binding public.pr_c_controlled_human_action_bindings;
 catalog_anchor public.pr_c_controlled_human_action_anchors;
 source_receipt public.studio_artifact_command_receipts;
 artifact public.studio_artifact_aggregates;
 package public.studio_artifact_source_packages;
 system_template public.studio_system_template_versions;
 tenant_template public.studio_tenant_template_versions;
 tenant_aggregate public.studio_tenant_template_aggregates;
 receipt public.pr_c_controlled_human_synthetic_generation_receipts;
 runtime public.studio_artifact_runtime_control;
 enterprise_runtime public.enterprise_intelligence_runtime_control;
 actor uuid;org uuid;workspace uuid;request_id uuid;artifact_id uuid;source_package_id uuid;
 authorization_version bigint;expected_aggregate bigint;expected_current uuid;expected_approved uuid;
 request_hash text;template_value jsonb;template_kind text;template_version_id uuid;template_version text;template_hash text;
 content_schema_version text;renderer_version text;version_id uuid;next_version bigint;content jsonb;content_hash text;
 audit_id uuid:=gen_random_uuid();result jsonb;selected_source_ids jsonb;candidate_manifest jsonb;anchor_manifest jsonb;
 existing_keys text[];required_keys text[]:=ARRAY[
  'actorId','artifactId','authorizationVersion','catalogBindingToken','contractVersion','deployId','deployOrigin','environmentClass','exerciseDigest',
  'expectedAggregateVersion','expectedApprovedVersionId','expectedCurrentVersionId','idempotencyKey','organizationId','prNumber','releaseSha','requestId',
  'reviewHeadSha','sourcePackageHash','sourcePackageId','sourcePackageVersion','targetFingerprint','template','workspaceId'];
BEGIN
 PERFORM public.pr_c_controlled_human_assert_marker();
 IF jsonb_typeof(p_command)<>'object' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
 SELECT array_agg(key ORDER BY key) INTO existing_keys FROM jsonb_object_keys(p_command) key;
 SELECT array_agg(value ORDER BY value) INTO required_keys FROM unnest(required_keys) value;
 IF existing_keys IS DISTINCT FROM required_keys
  OR p_command->>'contractVersion'<>'pr-c-controlled-human-synthetic-studio-direct-generation-1'
  OR p_command->>'environmentClass'<>'hosted_nonproduction_pilot' OR p_command->>'prNumber'<>'264'
  OR p_command->>'releaseSha'!~'^[0-9a-f]{40}$' OR p_command->>'reviewHeadSha' IS DISTINCT FROM p_command->>'releaseSha'
  OR p_command->>'deployId'!~'^[0-9a-f]{24}$' OR p_command->>'deployOrigin'<>'https://deploy-preview-264--avalaos-pilot.netlify.app'
  OR p_command->>'exerciseDigest'!~'^sha256:[0-9a-f]{64}$' OR p_command->>'targetFingerprint'!~'^sha256:[0-9a-f]{64}$'
  OR p_command->>'catalogBindingToken'!~'^sha256:[0-9a-f]{64}$'
  OR COALESCE(p_command->>'idempotencyKey','')!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
 BEGIN
  actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  request_id:=(p_command->>'requestId')::uuid;artifact_id:=(p_command->>'artifactId')::uuid;source_package_id:=(p_command->>'sourcePackageId')::uuid;
  authorization_version:=(p_command->>'authorizationVersion')::bigint;expected_aggregate:=(p_command->>'expectedAggregateVersion')::bigint;
  expected_current:=(p_command->>'expectedCurrentVersionId')::uuid;expected_approved:=(p_command->>'expectedApprovedVersionId')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END;
 IF authorization_version<1 OR expected_aggregate<>0 OR expected_current IS NOT NULL OR expected_approved IS NOT NULL
  OR (p_command->>'sourcePackageVersion')::bigint<>1
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;

 SELECT stored.* INTO exercise FROM public.pr_c_controlled_human_exercises stored
  WHERE stored.exercise_digest=p_command->>'exerciseDigest' FOR UPDATE;
 IF exercise.id IS NULL OR exercise.lifecycle<>'active' OR exercise.org_id<>org OR exercise.workspace_id<>workspace
  OR exercise.pull_request_number<>264 OR exercise.environment_class<>'hosted_nonproduction_pilot'
  OR exercise.release_sha<>p_command->>'releaseSha' OR exercise.review_head_sha<>p_command->>'reviewHeadSha'
  OR exercise.deploy_id<>p_command->>'deployId' OR exercise.deploy_origin<>p_command->>'deployOrigin'
  OR exercise.target_fingerprint<>p_command->>'targetFingerprint' OR NOT exercise.synthetic_only
  OR exercise.production_authorized OR exercise.customer_data_authorized OR exercise.real_provider_calls_authorized
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
 SELECT stored.* INTO persona FROM public.pr_c_controlled_human_persona_bindings stored
  WHERE stored.exercise_id=exercise.id AND stored.persona_key='requester' AND stored.auth_user_id=actor AND stored.expected_state='active';
 IF persona.exercise_id IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';END IF;
 PERFORM public.pr1b_assert_command_authority(actor,org,workspace,'studio.artifacts.generate',authorization_version);

 SELECT stored.* INTO catalog_binding FROM public.pr_c_controlled_human_action_bindings stored
  WHERE stored.exercise_id=exercise.id AND stored.checkpoint_id='CH-10' AND stored.step_id='create-direct-studio-plan'
   AND stored.persona_key='requester' AND stored.actor_id=actor AND stored.observation_kind='server_event'
   AND stored.action='studio.source-package.create' AND stored.result='succeeded' AND stored.denial_proof_kind='not_applicable'
   AND stored.resource_family='studio_source_package' AND stored.resource_id=source_package_id
   AND stored.observed_version=1 AND stored.binding_token=p_command->>'catalogBindingToken';
 SELECT stored.* INTO catalog_anchor FROM public.pr_c_controlled_human_action_anchors stored
  WHERE stored.id=catalog_binding.anchor_id AND stored.exercise_id=exercise.id AND stored.checkpoint_id='CH-10'
   AND stored.step_id='create-direct-studio-plan' AND stored.persona_key='requester' AND stored.actor_id=actor
   AND stored.action='studio.source-package.create' AND stored.target_family='input_bundle'
   AND stored.expected_version>0 AND stored.transition_kind='create_one' AND stored.created_family='studio_source_package';
 SELECT stored.* INTO source_receipt FROM public.studio_artifact_command_receipts stored
  WHERE stored.id=catalog_binding.receipt_id AND stored.org_id=org AND stored.workspace_id=workspace AND stored.actor_id=actor
   AND stored.command_type='studio.source-package.create' AND stored.request_id=catalog_binding.request_id
   AND stored.status='committed' AND stored.resource_id=artifact_id;
 IF catalog_binding.exercise_id IS NULL OR catalog_anchor.id IS NULL OR source_receipt.id IS NULL
  OR catalog_binding.expected_version IS DISTINCT FROM catalog_anchor.expected_version
  OR catalog_binding.receipt_source<>'studio'
  OR catalog_anchor.selector_bindings IS DISTINCT FROM jsonb_build_object(
    'sourceMode','direct_transcript_bundle','artifactType','pdd','studioInputBundleId',catalog_anchor.target_id,
    'studioInputBundleVersionId',catalog_anchor.selector_bindings->'studioInputBundleVersionId','studioInputBundleVersion',catalog_anchor.expected_version)
  OR source_receipt.response->>'artifactId' IS DISTINCT FROM artifact_id::text
  OR source_receipt.response->>'sourcePackageId' IS DISTINCT FROM source_package_id::text
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_STALE_SOURCE';END IF;

 SELECT * INTO runtime FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
 SELECT * INTO enterprise_runtime FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
 PERFORM public.pr_c_controlled_human_assert_provider_state();
 IF runtime.singleton IS NULL OR enterprise_runtime.singleton IS NULL OR NOT runtime.enabled OR runtime.read_only OR runtime.provider_enabled
  OR NOT enterprise_runtime.enabled OR enterprise_runtime.read_only OR enterprise_runtime.provider_enabled
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_PROVIDER_STATE_REJECTED';END IF;

 request_hash:=public.enterprise_sha256_jsonb(p_command);
 SELECT stored.* INTO receipt FROM public.pr_c_controlled_human_synthetic_generation_receipts stored
  WHERE stored.exercise_id=exercise.id AND stored.actor_id=actor AND stored.idempotency_key=p_command->>'idempotencyKey' FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.request_hash<>request_hash OR receipt.status<>'committed' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REPLAY_REJECTED';END IF;
  RETURN jsonb_set(receipt.response,'{outcome}','"replayed"'::jsonb);
 END IF;
 INSERT INTO public.pr_c_controlled_human_synthetic_generation_receipts(
  exercise_id,org_id,workspace_id,actor_id,request_id,idempotency_key,request_hash,artifact_id,source_package_id,source_package_hash,status)
 VALUES(exercise.id,org,workspace,actor,request_id,p_command->>'idempotencyKey',request_hash,artifact_id,source_package_id,p_command->>'sourcePackageHash','claimed')
 RETURNING * INTO receipt;

 SELECT stored.* INTO artifact FROM public.studio_artifact_aggregates stored
  WHERE stored.id=artifact_id AND stored.org_id=org AND stored.workspace_id=workspace FOR UPDATE;
 SELECT stored.* INTO package FROM public.studio_artifact_source_packages stored
  WHERE stored.id=source_package_id AND stored.artifact_id=artifact_id AND stored.org_id=org AND stored.workspace_id=workspace FOR SHARE;
 IF artifact.id IS NULL OR package.id IS NULL OR artifact.source_package_id<>package.id
  OR artifact.artifact_type<>'pdd' OR artifact.source_mode<>'direct_transcript_bundle'
  OR artifact.lineage_classification<>'not_assessed' OR NOT artifact.planning_only OR artifact.lifecycle<>'draft'
  OR artifact.aggregate_version<>0 OR artifact.current_version_id IS NOT NULL OR artifact.current_approved_version_id IS NOT NULL
  OR package.version<>1 OR package.package_hash<>p_command->>'sourcePackageHash' OR artifact.source_package_hash<>package.package_hash
  OR package.source_mode<>'direct_transcript_bundle' OR package.lineage_classification<>'not_assessed' OR NOT package.planning_only
  OR package.assess_handoff_id IS NOT NULL OR package.assess_package_hash IS NOT NULL OR package.manual_brief_hash IS NOT NULL
  OR package.studio_input_bundle_id IS DISTINCT FROM catalog_anchor.target_id
  OR package.studio_input_bundle_version IS DISTINCT FROM catalog_anchor.expected_version
  OR package.studio_input_bundle_version_id::text IS DISTINCT FROM catalog_anchor.selector_bindings->>'studioInputBundleVersionId'
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_STALE_SOURCE';END IF;
 IF NOT public.studio_pr_b_lock_source_package_current(package.id,org,workspace)
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_STALE_SOURCE';END IF;
 candidate_manifest:=public.studio_pr_b_candidate_manifest(org,workspace,package.studio_input_bundle_version_id);
 anchor_manifest:=public.studio_pr_b_anchor_manifest(candidate_manifest,NULL,NULL);
 IF jsonb_array_length(candidate_manifest)<1 OR jsonb_array_length(anchor_manifest)<1
  OR package.candidate_manifest IS DISTINCT FROM candidate_manifest
  OR package.candidate_manifest_hash<>public.enterprise_sha256_jsonb(candidate_manifest)
  OR package.candidate_count<>jsonb_array_length(candidate_manifest)
  OR package.anchor_manifest IS DISTINCT FROM anchor_manifest
  OR package.anchor_manifest_hash<>public.enterprise_sha256_jsonb(anchor_manifest)
  OR package.anchor_count<>jsonb_array_length(anchor_manifest)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(anchor_manifest) anchor WHERE anchor->>'locator'='assess:accepted-handoff')
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_STALE_SOURCE';END IF;

 template_value:=p_command->'template';
 IF jsonb_typeof(template_value)<>'object' OR NOT(template_value?'kind') THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
 BEGIN template_version_id:=(template_value->>'versionId')::uuid;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END;
 template_kind:=template_value->>'kind';template_hash:=template_value->>'hash';
 IF template_kind='system' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(template_value))<>4 OR NOT(template_value?&ARRAY['kind','versionId','version','hash']) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
  SELECT stored.* INTO system_template FROM public.studio_system_template_versions stored WHERE stored.id=template_version_id AND stored.superseded_at IS NULL;
  template_version:=template_value->>'version';
  IF system_template.id IS NULL OR system_template.template_version<>template_version OR system_template.template_hash<>template_hash
   OR system_template.artifact_type<>'pdd' THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
  content_schema_version:=system_template.content_schema_version;renderer_version:=system_template.renderer_version;
 ELSIF template_kind='tenant' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(template_value))<>5 OR NOT(template_value?&ARRAY['kind','templateId','versionId','version','hash']) THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
  SELECT version.* INTO tenant_template FROM public.studio_tenant_template_versions version
   WHERE version.id=template_version_id AND version.template_id=(template_value->>'templateId')::uuid AND version.org_id=org AND version.workspace_id=workspace;
  SELECT aggregate.* INTO tenant_aggregate FROM public.studio_tenant_template_aggregates aggregate
   WHERE aggregate.id=(template_value->>'templateId')::uuid AND aggregate.org_id=org AND aggregate.workspace_id=workspace;
  template_version:=template_value->>'version';
  IF tenant_template.id IS NULL OR tenant_template.version::text<>template_version OR tenant_template.template_hash<>template_hash
   OR tenant_template.status<>'approved' OR tenant_template.artifact_class NOT IN('custom','pdd') OR tenant_aggregate.artifact_class NOT IN('custom','pdd')
   OR tenant_aggregate.current_version<>tenant_template.version OR tenant_aggregate.current_version_id<>tenant_template.id
   OR tenant_aggregate.current_approved_version_id<>tenant_template.id OR tenant_aggregate.lifecycle<>'approved'
  THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;
  content_schema_version:=tenant_template.content_schema_version;renderer_version:=tenant_template.renderer_compatibility_version;
 ELSE RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_TEMPLATE_REJECTED';END IF;

 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO selected_source_ids
 FROM(SELECT DISTINCT anchor->>'sourceVersionId' value FROM jsonb_array_elements(anchor_manifest) anchor) selected;
 content:=jsonb_build_object('contractVersion','studio-artifact-2',
  'title','SYNTHETIC DIRECT PLANNING PDD — NOT CUSTOMER OR PROVIDER CONTENT',
  'summary','Provider-free synthetic PDD for the exact approved CH-10 direct Studio source package.',
  'sections',jsonb_build_array(jsonb_build_object('id','synthetic-direct-planning','title','Direct planning verification',
   'body','SYNTHETIC DIRECT PLANNING PDD — NOT CUSTOMER OR PROVIDER CONTENT','sourceAnchors',anchor_manifest,'labels',jsonb_build_array('template_required'))),
  'coverage',jsonb_build_object('selectedSourceVersionIds',selected_source_ids,'coveredSourceVersionIds',selected_source_ids,'complete',true));
 IF NOT public.studio_pr_b_structured_artifact_content_safe(content,package)
 THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_CONTENT_REJECTED';END IF;
 SELECT COALESCE(max(stored.version),0)+1 INTO next_version FROM public.studio_artifact_versions stored WHERE stored.artifact_id=artifact.id;
 version_id:=public.studio_pr_b_deterministic_uuid('pr264-controlled-human-synthetic-direct-generation',receipt.id);
 content_hash:=public.enterprise_sha256_jsonb(content);
 INSERT INTO public.studio_artifact_versions(
  id,artifact_id,org_id,workspace_id,version,parent_version_id,template_id,content_schema_version,renderer_version,content,content_hash,lifecycle,
  generation_attempt_id,author_id,author_authorization_version,source_package_id,source_package_hash,template_kind,tenant_template_version_id,template_version,template_hash)
 VALUES(version_id,artifact.id,org,workspace,next_version,NULL,CASE WHEN template_kind='system' THEN template_version_id END,
  content_schema_version,renderer_version,content,content_hash,'draft',NULL,actor,authorization_version,package.id,package.package_hash,
  template_kind,CASE WHEN template_kind='tenant' THEN template_version_id END,template_version,template_hash);
 UPDATE public.studio_artifact_aggregates SET current_version_id=version_id,aggregate_version=1,lifecycle='draft',updated_at=statement_timestamp()
  WHERE id=artifact.id;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,'pr_c.controlled_human.synthetic_studio_generate','studio_artifact',artifact.id,'succeeded',1,
  jsonb_build_object('generationKind','synthetic_controlled_human','directPlanning',true,'exerciseDigest',exercise.exercise_digest,
   'catalogBindingToken',catalog_binding.binding_token,'sourcePackageId',package.id,'sourcePackageHash',package.package_hash,
   'templateVersionId',template_version_id,'templateHash',template_hash));
 result:=jsonb_build_object('outcome','committed','receiptId',receipt.id,'resourceId',artifact.id,'resource',jsonb_build_object(
  'artifactId',artifact.id,'versionId',version_id,'version',next_version,'sourcePackageId',package.id,'sourcePackageVersion',package.version,
  'sourcePackageHash',package.package_hash,'templateVersionId',template_version_id,
  'templateVersion',CASE WHEN template_kind='tenant' THEN to_jsonb(template_version::bigint) ELSE to_jsonb(template_version) END,
  'templateHash',template_hash,'generationKind','synthetic_controlled_human','synthetic',true));
 UPDATE public.pr_c_controlled_human_synthetic_generation_receipts
  SET status='committed',version_id=version_id,output_hash=content_hash,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_synthetic_studio_generate(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_command->>'contractVersion'='pr-c-controlled-human-synthetic-studio-generation-1' THEN
  RETURN public.pr_c_controlled_human_synthetic_assess_studio_generate(p_command);
 ELSIF p_command->>'contractVersion'='pr-c-controlled-human-synthetic-studio-direct-generation-1' THEN
  RETURN public.pr_c_controlled_human_synthetic_direct_studio_generate(p_command);
 END IF;
 RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_SYNTHETIC_GENERATION_REJECTED';
END
$$;

REVOKE ALL ON FUNCTION
 public.pr_c_controlled_human_synthetic_assess_studio_generate(jsonb),
 public.pr_c_controlled_human_synthetic_direct_studio_generate(jsonb),
 public.pr_c_controlled_human_synthetic_studio_generate(jsonb)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr_c_controlled_human_synthetic_studio_generate(jsonb) TO service_role;

-- Advance only the dedicated hosted-nonproduction schema identity. Historical
-- exercise tips remain valid as immutable retained evidence.
DO $pr_c_synthetic_direct_generation_identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
 bootstrap_definition text;assert_marker_definition text;
 old_bootstrap text:='marker.migration_tip=''20260926053818''';new_bootstrap text:='marker.migration_tip=''20260928060000''';
 old_assert text:='marker.migration_tip = ''20260926053818''';new_assert text:='marker.migration_tip = ''20260928060000''';
 old_bootstrap_count integer;new_bootstrap_count integer;old_assert_count integer;new_assert_count integer;
BEGIN
 LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
  WHERE conrelid='public.hosted_pilot_environment_identity'::regclass AND conname='hosted_pilot_environment_identity_migration_tip_check';
 SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
  WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass AND conname='pr_c_controlled_human_exercises_migration_tip_check';
 SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure) INTO STRICT bootstrap_definition;
 SELECT pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure) INTO STRICT assert_marker_definition;
 old_bootstrap_count:=(length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
 new_bootstrap_count:=(length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
 old_assert_count:=(length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert);
 new_assert_count:=(length(assert_marker_definition)-length(replace(assert_marker_definition,new_assert,'')))/length(new_assert);
 IF marker.product_key<>'avalaos-core' OR marker.environment_class<>'hosted_nonproduction_pilot'
  OR marker.schema_contract<>'hosted-pilot-2026-08' OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
 THEN RAISE EXCEPTION 'PR_C_SYNTHETIC_DIRECT_GENERATION_IDENTITY_SOURCE_MISMATCH';END IF;
 IF marker.migration_tip='20260926053818' AND marker_constraint='(migration_tip = ''20260926053818''::text)'
  AND exercise_constraint='(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text]))'
  AND old_bootstrap_count=1 AND new_bootstrap_count=0 AND old_assert_count=1 AND new_assert_count=0
  AND NOT EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise WHERE exercise.lifecycle<>'deprovisioned')
 THEN
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
   CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000'));
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260928060000' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260928060000');
 ELSIF marker.migration_tip='20260928060000' AND marker_constraint='(migration_tip = ''20260928060000''::text)'
  AND exercise_constraint='(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text]))'
  AND old_bootstrap_count=0 AND new_bootstrap_count=1 AND old_assert_count=0 AND new_assert_count=1
 THEN NULL;
 ELSE RAISE EXCEPTION 'PR_C_SYNTHETIC_DIRECT_GENERATION_IDENTITY_SOURCE_MISMATCH';END IF;
END
$pr_c_synthetic_direct_generation_identity_forward$;

COMMENT ON FUNCTION public.pr_c_controlled_human_synthetic_direct_studio_generate(jsonb) IS
 'Provider-free PR C CH-10 direct PDD generation, bound to the exact completed source-package catalog action and active synthetic exercise.';

-- Rollback/read-only fallback: revoke the dispatcher from service_role and
-- disable Studio mutations. Retain immutable exercise, package, PDD and audit
-- history for a forward fix; do not restore provider execution.
