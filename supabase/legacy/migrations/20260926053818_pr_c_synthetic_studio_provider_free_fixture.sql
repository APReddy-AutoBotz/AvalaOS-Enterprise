-- Admit only exact, provider-free Studio source extraction provenance for the
-- dedicated PR C synthetic exercise. Real provider execution stays prohibited.
-- CH-07's revised item returns to proposed after revision commit. Record its
-- separate, owner-approved acceptance before independent package review.
INSERT INTO public.pr_c_controlled_human_intent_catalog
 (checkpoint_id,step_id,observation_kind,action,target_family,target_version_dimension,effect_family,transition_kind,selector_schema,effect_resolver,expected_outcome,expected_denial_code,replay_of_step_id)
VALUES
 ('CH-07','decide-revised-descendant','server_event','delivery.item.review','delivery_item','aggregate_version','delivery_item_version','increment_one','delivery_item_decision','delivery_effect','accepted',NULL,NULL);

CREATE OR REPLACE FUNCTION public.pr_c_controlled_human_provider_state()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE required_relation text;
BEGIN
 FOREACH required_relation IN ARRAY ARRAY[
   'public.pr_c_controlled_human_exercises','public.ai_provider_configs','public.enterprise_ai_capability_routes',
   'public.enterprise_ai_job_ledger','public.enterprise_transcript_extraction_bindings','public.enterprise_ai_command_receipts',
   'public.enterprise_evidence_candidates','public.studio_source_extraction_runs','public.studio_source_extraction_bindings',
   'public.studio_source_candidate_decisions','public.enterprise_module_input_bundles','public.enterprise_module_input_bundle_versions',
   'public.enterprise_module_input_bundle_items','public.enterprise_source_set_version_items','public.ai_provider_key_refs',
   'public.pilot_operations_provider_bindings','public.hosted_pilot_provider_simulations','public.enterprise_ai_budget_reservations',
   'public.enterprise_provider_secret_cleanup_jobs','public.ai_provider_audit_events','public.enterprise_ai_usage_ledger',
   'public.enterprise_ai_job_attempts','public.enterprise_ai_extraction_staged_results','public.ai_generation_jobs',
   'public.ai_usage_events','public.enterprise_ai_effect_journal','public.studio_artifact_generation_attempts'
 ] LOOP
  IF pg_catalog.to_regclass(required_relation) IS NULL THEN RAISE EXCEPTION 'PR_C_CONTROLLED_HUMAN_PROVIDER_SCHEMA_MISMATCH';END IF;
 END LOOP;

 RETURN (SELECT jsonb_build_object(
  'unsafeRows',
   (SELECT count(*) FROM public.ai_provider_configs config WHERE NOT(
    config.provider='groq' AND config.status='disabled' AND config.key_ref_id IS NULL AND config.default_model='synthetic-no-provider'
    AND config.display_name='PR C controlled-human offline provenance'
    AND EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
     WHERE exercise.org_id=config.org_id AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest)))
   +(SELECT count(*) FROM public.enterprise_ai_capability_routes route WHERE NOT(
    route.enabled=false AND route.deleted_at IS NULL
    AND route.capability IN('assess.evidence.extract','studio.evidence.extract') AND route.model='synthetic-no-provider'
    AND EXISTS(SELECT 1 FROM public.ai_provider_configs config JOIN public.pr_c_controlled_human_exercises exercise
     ON exercise.org_id=config.org_id AND exercise.workspace_id=route.workspace_id
     WHERE config.id=route.provider_config_id AND config.org_id=route.org_id AND config.status='disabled'
      AND config.key_ref_id IS NULL AND config.default_model='synthetic-no-provider'
      AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest)))
   +(SELECT count(*) FROM public.enterprise_ai_job_ledger job WHERE NOT(
    (job.capability='assess.evidence.extract' AND job.provider_config_id IS NOT NULL AND job.provider='groq' AND job.model='synthetic-no-provider'
     AND job.prompt_key='controlled-human-offline' AND job.status='succeeded'
     AND job.token_input IS NULL AND job.token_output IS NULL AND job.latency_ms IS NULL AND job.failure_class IS NULL
     AND job.output_hash=repeat('b',64) AND job.approval_state='review_required'
     AND job.metadata->>'controlledHumanSyntheticNoProvider'='true' AND (SELECT count(*) FROM jsonb_object_keys(job.metadata))=2
     AND EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
      JOIN public.ai_provider_configs config ON config.id=job.provider_config_id AND config.org_id=exercise.org_id
      JOIN public.enterprise_transcript_extraction_bindings binding ON binding.job_id=job.id
       AND binding.org_id=exercise.org_id AND binding.workspace_id=exercise.workspace_id
       AND binding.provider_config_id=config.id AND binding.model='synthetic-no-provider'
      JOIN public.enterprise_ai_capability_routes route ON route.id=binding.provider_route_id
       AND route.org_id=exercise.org_id AND route.workspace_id=exercise.workspace_id AND route.provider_config_id=config.id
       AND route.capability='assess.evidence.extract' AND route.model='synthetic-no-provider' AND NOT route.enabled AND route.deleted_at IS NULL
      JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=binding.receipt_id
       AND receipt.org_id=exercise.org_id AND receipt.workspace_id=exercise.workspace_id AND receipt.actor_id=job.actor_id
       AND receipt.command_type='evidence.extract' AND receipt.runtime_area='ingestion' AND receipt.status='committed'
       AND receipt.initial_request_id=receipt.last_request_id AND receipt.request_hash=repeat('a',64)
      WHERE exercise.org_id=job.org_id AND exercise.workspace_id=job.workspace_id
       AND job.metadata->>'exerciseDigest'=exercise.exercise_digest
       AND config.provider='groq' AND config.status='disabled' AND config.key_ref_id IS NULL
       AND config.default_model='synthetic-no-provider' AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest
       AND binding.source_id=job.source_id AND binding.source_version_id=job.source_version_id
       AND EXISTS(SELECT 1 FROM public.enterprise_evidence_candidates candidate
        WHERE candidate.ai_job_id=job.id AND candidate.org_id=exercise.org_id AND candidate.workspace_id=exercise.workspace_id
         AND candidate.source_id=job.source_id AND candidate.source_version_id=job.source_version_id
         AND candidate.suggestion_status='accepted' AND candidate.reviewed_by=job.actor_id AND candidate.reviewed_at IS NOT NULL)))
    OR
    (job.capability='studio.evidence.extract' AND job.provider_config_id IS NOT NULL AND job.provider='groq' AND job.model='synthetic-no-provider'
     AND job.prompt_key='studio.evidence.extract' AND job.prompt_version='controlled-human-offline-1' AND job.status='succeeded'
     AND job.token_input IS NULL AND job.token_output IS NULL AND job.latency_ms IS NULL AND job.failure_class IS NULL
     AND job.output_hash=repeat('d',64) AND job.approval_state='review_required'
     AND job.metadata->>'controlledHumanSyntheticNoProvider'='true' AND (SELECT count(*) FROM jsonb_object_keys(job.metadata))=2
     AND EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise
      JOIN public.ai_provider_configs config ON config.id=job.provider_config_id AND config.org_id=exercise.org_id
      JOIN public.studio_source_extraction_runs run ON run.job_id=job.id AND run.org_id=exercise.org_id AND run.workspace_id=exercise.workspace_id
      JOIN public.enterprise_ai_capability_routes route ON route.id=run.route_id AND route.org_id=exercise.org_id
       AND route.workspace_id=exercise.workspace_id AND route.provider_config_id=config.id
       AND route.capability='studio.evidence.extract' AND route.model='synthetic-no-provider' AND NOT route.enabled AND route.deleted_at IS NULL
      JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=run.receipt_id AND receipt.id=job.receipt_id
       AND receipt.org_id=exercise.org_id AND receipt.workspace_id=exercise.workspace_id AND receipt.actor_id=job.actor_id
       AND receipt.command_type='studio.bundle.extract' AND receipt.runtime_area='ingestion' AND receipt.status='committed'
       AND receipt.initial_request_id=receipt.last_request_id AND receipt.request_hash=repeat('c',64)
      JOIN public.enterprise_module_input_bundles bundle ON bundle.id=run.input_bundle_id AND bundle.org_id=exercise.org_id
       AND bundle.workspace_id=exercise.workspace_id AND bundle.owner_module='studio'
      JOIN public.enterprise_module_input_bundle_versions bundle_version ON bundle_version.id=run.input_bundle_version_id
       AND bundle_version.input_bundle_id=bundle.id AND bundle_version.org_id=exercise.org_id AND bundle_version.workspace_id=exercise.workspace_id
       AND bundle_version.status='locked' AND bundle_version.bundle_hash=run.bundle_hash
      WHERE exercise.org_id=job.org_id AND exercise.workspace_id=job.workspace_id
       AND job.metadata->>'exerciseDigest'=exercise.exercise_digest
       AND config.provider='groq' AND config.status='disabled' AND config.key_ref_id IS NULL
       AND config.default_model='synthetic-no-provider' AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest
       AND run.provider_config_id=config.id AND run.provider='groq' AND run.model='synthetic-no-provider'
       AND run.prompt_key='studio.evidence.extract' AND run.prompt_version='controlled-human-offline-1'
       AND run.request_hash=repeat('c',64) AND run.status='succeeded' AND run.failure_code IS NULL
       AND run.token_input IS NULL AND run.token_output IS NULL AND run.output_hash=repeat('d',64)
       AND run.candidate_count=2 AND jsonb_array_length(run.staged_candidates)=2
       AND run.safe_result->>'controlledHumanSyntheticNoProvider'='true' AND (SELECT count(*) FROM jsonb_object_keys(run.safe_result))=2
       AND (SELECT count(*) FROM public.studio_source_extraction_bindings binding WHERE binding.job_id=run.job_id)=2
       AND (SELECT count(*) FROM public.enterprise_evidence_candidates candidate WHERE candidate.ai_job_id=run.job_id)=2
       AND (SELECT count(*) FROM public.studio_source_candidate_decisions decision
        JOIN public.studio_source_extraction_bindings binding ON binding.id=decision.binding_id AND binding.job_id=decision.job_id
        WHERE binding.job_id=run.job_id)=2
       AND NOT EXISTS(SELECT 1 FROM public.studio_source_extraction_bindings binding
        WHERE binding.job_id=run.job_id AND NOT EXISTS(
         SELECT 1 FROM public.enterprise_module_input_bundle_items bundle_item
         JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
          AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
         WHERE bundle_item.input_bundle_version_id=run.input_bundle_version_id AND bundle_item.input_bundle_id=run.input_bundle_id
          AND bundle_item.org_id=exercise.org_id AND bundle_item.workspace_id=exercise.workspace_id
          AND source_item.source_set_id=binding.source_set_id AND source_item.source_set_version_id=binding.source_set_version_id
          AND source_item.source_id=binding.source_id AND source_item.source_version_id=binding.source_version_id))
       AND NOT EXISTS(SELECT 1 FROM public.studio_source_extraction_bindings binding
        LEFT JOIN public.enterprise_evidence_candidates candidate ON candidate.ai_job_id=run.job_id
         AND candidate.source_id=binding.source_id AND candidate.source_version_id=binding.source_version_id
         AND candidate.org_id=binding.org_id AND candidate.workspace_id=binding.workspace_id
        LEFT JOIN public.studio_source_candidate_decisions decision ON decision.candidate_id=candidate.id
         AND decision.job_id=run.job_id AND decision.binding_id=binding.id
        LEFT JOIN public.enterprise_ai_command_receipts review_receipt ON review_receipt.id=decision.receipt_id
        WHERE binding.job_id=run.job_id AND (
         candidate.id IS NULL OR candidate.suggestion_status<>'accepted' OR candidate.reviewed_by IS DISTINCT FROM job.actor_id OR candidate.reviewed_at IS NULL
         OR decision.candidate_id IS NULL OR decision.input_bundle_id IS DISTINCT FROM run.input_bundle_id
         OR decision.input_bundle_version_id IS DISTINCT FROM run.input_bundle_version_id
         OR decision.source_set_id IS DISTINCT FROM binding.source_set_id OR decision.source_set_version_id IS DISTINCT FROM binding.source_set_version_id
         OR decision.source_id IS DISTINCT FROM binding.source_id OR decision.source_version_id IS DISTINCT FROM binding.source_version_id
         OR decision.decision_status<>'accepted' OR decision.candidate_version IS DISTINCT FROM candidate.version
         OR decision.candidate_provenance_hash IS DISTINCT FROM candidate.provenance_hash OR decision.excerpt_hash IS DISTINCT FROM candidate.excerpt_hash
         OR decision.value_hash IS DISTINCT FROM encode(public.digest(convert_to(candidate.value,'UTF8'),'sha256'),'hex')
         OR decision.reviewed_by IS DISTINCT FROM job.actor_id OR decision.reviewer_authorization_version IS DISTINCT FROM run.authorization_version
         OR review_receipt.id IS NULL OR review_receipt.org_id IS DISTINCT FROM exercise.org_id
         OR review_receipt.workspace_id IS DISTINCT FROM exercise.workspace_id OR review_receipt.actor_id IS DISTINCT FROM job.actor_id
         OR review_receipt.command_type<>'studio.candidate.review' OR review_receipt.runtime_area<>'ingestion' OR review_receipt.status<>'committed'
        ))))))
   +(SELECT count(*) FROM public.studio_source_extraction_runs run WHERE NOT EXISTS(
     SELECT 1 FROM public.enterprise_ai_job_ledger job
     JOIN public.pr_c_controlled_human_exercises exercise ON exercise.org_id=job.org_id AND exercise.workspace_id=job.workspace_id
     JOIN public.ai_provider_configs config ON config.id=job.provider_config_id AND config.org_id=exercise.org_id
     JOIN public.enterprise_ai_capability_routes route ON route.id=run.route_id AND route.org_id=exercise.org_id
      AND route.workspace_id=exercise.workspace_id AND route.provider_config_id=config.id
     JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=run.receipt_id AND receipt.id=job.receipt_id
      AND receipt.org_id=exercise.org_id AND receipt.workspace_id=exercise.workspace_id AND receipt.actor_id=job.actor_id
     JOIN public.enterprise_module_input_bundles bundle ON bundle.id=run.input_bundle_id AND bundle.org_id=exercise.org_id
      AND bundle.workspace_id=exercise.workspace_id AND bundle.owner_module='studio'
     JOIN public.enterprise_module_input_bundle_versions bundle_version ON bundle_version.id=run.input_bundle_version_id
      AND bundle_version.input_bundle_id=bundle.id AND bundle_version.org_id=exercise.org_id AND bundle_version.workspace_id=exercise.workspace_id
     WHERE job.id=run.job_id AND run.org_id=exercise.org_id AND run.workspace_id=exercise.workspace_id
      AND job.capability='studio.evidence.extract' AND job.provider_config_id=config.id AND job.provider='groq'
      AND job.model='synthetic-no-provider' AND job.prompt_key='studio.evidence.extract'
      AND job.prompt_version='controlled-human-offline-1' AND job.status='succeeded'
      AND job.token_input IS NULL AND job.token_output IS NULL AND job.latency_ms IS NULL AND job.failure_class IS NULL
      AND job.output_hash=repeat('d',64) AND job.metadata->>'controlledHumanSyntheticNoProvider'='true'
      AND job.metadata->>'exerciseDigest'=exercise.exercise_digest AND (SELECT count(*) FROM jsonb_object_keys(job.metadata))=2
      AND config.provider='groq' AND config.status='disabled' AND config.key_ref_id IS NULL
      AND config.default_model='synthetic-no-provider' AND config.evidence_ref='pr-c-controlled-human:'||exercise.exercise_digest
      AND route.capability='studio.evidence.extract' AND route.model='synthetic-no-provider' AND NOT route.enabled AND route.deleted_at IS NULL
      AND receipt.command_type='studio.bundle.extract' AND receipt.runtime_area='ingestion' AND receipt.status='committed'
      AND receipt.initial_request_id=receipt.last_request_id AND receipt.request_hash=repeat('c',64)
      AND run.provider_config_id=config.id AND run.provider='groq' AND run.model='synthetic-no-provider'
      AND run.prompt_key='studio.evidence.extract' AND run.prompt_version='controlled-human-offline-1'
      AND run.request_hash=repeat('c',64) AND run.status='succeeded' AND run.failure_code IS NULL
      AND run.token_input IS NULL AND run.token_output IS NULL AND run.output_hash=repeat('d',64)
      AND run.candidate_count=2 AND jsonb_array_length(run.staged_candidates)=2
      AND run.safe_result->>'controlledHumanSyntheticNoProvider'='true' AND (SELECT count(*) FROM jsonb_object_keys(run.safe_result))=2
      AND bundle_version.status='locked' AND bundle_version.bundle_hash=run.bundle_hash))
   +(SELECT count(*) FROM public.studio_source_extraction_bindings binding WHERE NOT EXISTS(
     SELECT 1 FROM public.studio_source_extraction_runs run
     JOIN public.enterprise_ai_job_ledger job ON job.id=run.job_id AND job.org_id=run.org_id AND job.workspace_id=run.workspace_id
     JOIN public.pr_c_controlled_human_exercises exercise ON exercise.org_id=run.org_id AND exercise.workspace_id=run.workspace_id
     JOIN public.enterprise_module_input_bundle_items bundle_item ON bundle_item.input_bundle_id=run.input_bundle_id
      AND bundle_item.input_bundle_version_id=run.input_bundle_version_id AND bundle_item.org_id=run.org_id AND bundle_item.workspace_id=run.workspace_id
     JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_id=binding.source_set_id
      AND source_item.source_set_version_id=bundle_item.source_set_version_id AND source_item.org_id=binding.org_id
      AND source_item.workspace_id=binding.workspace_id AND source_item.source_id=binding.source_id
      AND source_item.source_version_id=binding.source_version_id
     WHERE run.job_id=binding.job_id AND run.org_id=binding.org_id AND run.workspace_id=binding.workspace_id
      AND job.capability='studio.evidence.extract' AND job.model='synthetic-no-provider'
      AND job.metadata->>'exerciseDigest'=exercise.exercise_digest
      AND run.status='succeeded' AND run.model='synthetic-no-provider'
      AND bundle_item.source_set_id=binding.source_set_id AND bundle_item.source_set_version_id=binding.source_set_version_id))
   +(SELECT count(*) FROM public.studio_source_candidate_decisions decision WHERE NOT EXISTS(
     SELECT 1 FROM public.studio_source_extraction_bindings binding
     JOIN public.studio_source_extraction_runs run ON run.job_id=binding.job_id AND run.org_id=binding.org_id AND run.workspace_id=binding.workspace_id
     JOIN public.enterprise_ai_job_ledger job ON job.id=run.job_id AND job.org_id=run.org_id AND job.workspace_id=run.workspace_id
     JOIN public.pr_c_controlled_human_exercises exercise ON exercise.org_id=run.org_id AND exercise.workspace_id=run.workspace_id
     JOIN public.enterprise_evidence_candidates candidate ON candidate.id=decision.candidate_id AND candidate.ai_job_id=run.job_id
      AND candidate.org_id=binding.org_id AND candidate.workspace_id=binding.workspace_id
      AND candidate.source_id=binding.source_id AND candidate.source_version_id=binding.source_version_id
     JOIN public.enterprise_ai_command_receipts review_receipt ON review_receipt.id=decision.receipt_id
      AND review_receipt.org_id=exercise.org_id AND review_receipt.workspace_id=exercise.workspace_id AND review_receipt.actor_id=job.actor_id
     WHERE binding.id=decision.binding_id AND binding.job_id=decision.job_id
      AND decision.org_id=binding.org_id AND decision.workspace_id=binding.workspace_id
      AND job.capability='studio.evidence.extract' AND job.model='synthetic-no-provider'
      AND job.metadata->>'exerciseDigest'=exercise.exercise_digest
      AND decision.input_bundle_id=run.input_bundle_id AND decision.input_bundle_version_id=run.input_bundle_version_id
      AND decision.source_set_id=binding.source_set_id AND decision.source_set_version_id=binding.source_set_version_id
      AND decision.source_id=binding.source_id AND decision.source_version_id=binding.source_version_id
      AND candidate.suggestion_status='accepted' AND candidate.reviewed_by=job.actor_id AND candidate.reviewed_at IS NOT NULL
      AND decision.decision_status='accepted' AND decision.candidate_version=candidate.version
      AND decision.candidate_provenance_hash=candidate.provenance_hash AND decision.excerpt_hash=candidate.excerpt_hash
      AND decision.value_hash=encode(public.digest(convert_to(candidate.value,'UTF8'),'sha256'),'hex')
      AND decision.reviewed_by=job.actor_id AND decision.reviewer_authorization_version=run.authorization_version
      AND review_receipt.command_type='studio.candidate.review' AND review_receipt.runtime_area='ingestion'
      AND review_receipt.status='committed'))
   +(SELECT count(*) FROM public.ai_provider_key_refs)+(SELECT count(*) FROM public.pilot_operations_provider_bindings)
   +(SELECT count(*) FROM public.hosted_pilot_provider_simulations)+(SELECT count(*) FROM public.enterprise_ai_budget_reservations)
   +(SELECT count(*) FROM public.enterprise_provider_secret_cleanup_jobs)+(SELECT count(*) FROM public.ai_provider_audit_events)
   +(SELECT count(*) FROM public.enterprise_ai_usage_ledger)+(SELECT count(*) FROM public.enterprise_ai_job_attempts)
   +(SELECT count(*) FROM public.enterprise_ai_extraction_staged_results)+(SELECT count(*) FROM public.ai_generation_jobs)
   +(SELECT count(*) FROM public.ai_usage_events)
   +(SELECT count(*) FROM public.enterprise_ai_command_receipts receipt WHERE receipt.runtime_area='provider')
   +(SELECT count(*) FROM public.enterprise_ai_effect_journal effect JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=effect.receipt_id
     WHERE effect.operation_type LIKE 'provider.%' OR receipt.runtime_area='provider'
      OR receipt.command_type IN('studio.bundle.extract','studio.candidate.review')
      OR EXISTS(SELECT 1 FROM public.enterprise_ai_job_ledger job WHERE job.receipt_id=receipt.id AND job.model<>'synthetic-no-provider'))
   +(SELECT count(*) FROM public.studio_artifact_generation_attempts),
  'providerEgress',(SELECT count(*) FROM public.ai_provider_audit_events),
  'providerCalls',(SELECT count(*) FROM public.enterprise_ai_effect_journal effect JOIN public.enterprise_ai_command_receipts receipt ON receipt.id=effect.receipt_id
    WHERE effect.operation_type LIKE 'provider.%' OR receipt.runtime_area='provider'
     OR receipt.command_type IN('studio.bundle.extract','studio.candidate.review')
     OR EXISTS(SELECT 1 FROM public.enterprise_ai_job_ledger job WHERE job.receipt_id=receipt.id AND job.model<>'synthetic-no-provider'))
   +(SELECT count(*) FROM public.studio_artifact_generation_attempts)+(SELECT count(*) FROM public.enterprise_ai_usage_ledger)
   +(SELECT count(*) FROM public.enterprise_ai_job_attempts)+(SELECT count(*) FROM public.enterprise_ai_extraction_staged_results)
   +(SELECT count(*) FROM public.ai_generation_jobs)+(SELECT count(*) FROM public.ai_usage_events)
   +(SELECT count(*) FROM public.enterprise_ai_command_receipts receipt WHERE receipt.runtime_area='provider')
 ));
END
$$;

-- Advance only the dedicated hosted-nonproduction schema identity. Historical
-- exercise tips remain allowed as immutable retained evidence.
DO $pr_c_synthetic_studio_fixture_identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
 bootstrap_definition text;assert_marker_definition text;
 old_bootstrap text:='marker.migration_tip=''20260924113000''';new_bootstrap text:='marker.migration_tip=''20260926053818''';
 old_assert text:='marker.migration_tip = ''20260924113000''';new_assert text:='marker.migration_tip = ''20260926053818''';
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
 THEN RAISE EXCEPTION 'PR_C_SYNTHETIC_STUDIO_FIXTURE_IDENTITY_SOURCE_MISMATCH';END IF;
 IF marker.migration_tip='20260924113000' AND marker_constraint='(migration_tip = ''20260924113000''::text)'
  AND exercise_constraint='(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text]))'
  AND old_bootstrap_count=1 AND new_bootstrap_count=0 AND old_assert_count=1 AND new_assert_count=0
  AND NOT EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises exercise WHERE exercise.lifecycle<>'deprovisioned')
 THEN
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
   CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818'));
  ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260926053818' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260926053818');
 ELSIF marker.migration_tip='20260926053818' AND marker_constraint='(migration_tip = ''20260926053818''::text)'
  AND exercise_constraint='(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text]))'
  AND old_bootstrap_count=0 AND new_bootstrap_count=1 AND old_assert_count=0 AND new_assert_count=1
 THEN NULL;
 ELSE RAISE EXCEPTION 'PR_C_SYNTHETIC_STUDIO_FIXTURE_IDENTITY_SOURCE_MISMATCH';END IF;
END
$pr_c_synthetic_studio_fixture_identity_forward$;

REVOKE ALL ON FUNCTION public.pr_c_controlled_human_provider_state() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr_c_controlled_human_provider_state() TO service_role;
COMMENT ON FUNCTION public.pr_c_controlled_human_provider_state() IS
 'Fail-closed PR C accounting for exact disabled/keyless Assess and Studio synthetic provenance; all provider execution remains prohibited.';

-- Rollback/read-only fallback: disable Studio source integration and retain the
-- exact source, candidate, package, artifact and exercise history.
