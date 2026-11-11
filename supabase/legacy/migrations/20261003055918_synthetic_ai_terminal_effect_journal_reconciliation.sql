-- Forward correction for the retained failed Assess mapping reconciliation.
-- The deployed predecessor rejected every effect-journal row. The retained
-- receipt legitimately has one terminal failed command journal, so recovery
-- now requires and canonically binds that exact immutable row. This migration
-- performs no provider effect, enables no runtime, and changes no charge.
DO $precondition$
DECLARE marker public.hosted_pilot_environment_identity;
  enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.synthetic_ai_mapping_no_effect_reconciliations IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.synthetic_ai_campaign_final_continuations IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20261003015246'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR enterprise_control.provider_enabled OR studio_control.provider_enabled
    OR EXISTS(SELECT 1 FROM public.synthetic_ai_mapping_no_effect_reconciliations)
    OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_final_continuations)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid='public.synthetic_ai_mapping_no_effect_reconciliations'::regclass
        AND attname IN('effect_journal_id','effect_journal_row_hash') AND NOT attisdropped)
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_JOURNAL_RECONCILIATION_MIGRATION_PRECONDITION_FAILED';END IF;
END
$precondition$;

ALTER TABLE public.synthetic_ai_mapping_no_effect_reconciliations
  ADD COLUMN effect_journal_id uuid NOT NULL UNIQUE
    REFERENCES public.enterprise_ai_effect_journal(id) ON DELETE RESTRICT,
  ADD COLUMN effect_journal_row_hash text NOT NULL
    CHECK(effect_journal_row_hash~'^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION public.synthetic_ai_reconcile_mapping_no_effect_once(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_target_fingerprint text,p_project_ref text,p_campaign uuid,
  p_reservation uuid,p_receipt uuid,p_mapping_run uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  target public.synthetic_admin_targets;campaign public.synthetic_ai_campaign_authorities;
  receipt public.enterprise_ai_command_receipts;mapping_run public.enterprise_assess_document_mapping_runs;
  reservation public.enterprise_ai_budget_reservations;journal public.enterprise_ai_effect_journal;
  prior public.synthetic_ai_mapping_no_effect_reconciliations;inserted public.synthetic_ai_mapping_no_effect_reconciliations;
  marker public.hosted_pilot_environment_identity;enterprise_control public.enterprise_intelligence_runtime_control;
  studio_control public.studio_artifact_runtime_control;request_host text;digest_value text;result_value jsonb;
  journal_count integer;journal_row_hash text;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_campaign IS NULL
    OR p_reservation IS NULL OR p_receipt IS NULL OR p_mapping_run IS NULL
    OR p_target_fingerprint!~'^sha256:[0-9a-f]{64}$' OR p_project_ref!~'^[a-z0-9]{20}$'
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_INVALID';END IF;
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
  target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_target_fingerprint);
  request_host:=public.synthetic_ai_campaign_request_host();
  IF request_host IS DISTINCT FROM p_project_ref||'.supabase.co'
    OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
    OR target.operator_actor_id IS DISTINCT FROM p_actor OR NOT target.enabled OR NOT target.synthetic_only
    OR target.production_authorized OR target.customer_data_authorized OR target.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_NOT_AUTHORIZED';END IF;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR SHARE;
  SELECT * INTO STRICT enterprise_control FROM public.enterprise_intelligence_runtime_control WHERE singleton FOR SHARE;
  SELECT * INTO STRICT studio_control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
  IF marker.migration_tip<>'20261003055918' OR marker.production_authorized OR marker.customer_data_authorized
    OR marker.real_provider_calls_authorized OR enterprise_control.provider_enabled OR studio_control.provider_enabled
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_RUNTIME_NOT_OFF';END IF;

  SELECT * INTO campaign FROM public.synthetic_ai_campaign_authorities authority
    WHERE authority.id=p_campaign AND authority.target_id=target.id AND authority.target_fingerprint=p_target_fingerprint
      AND authority.project_ref=p_project_ref AND authority.server_host=request_host
      AND authority.org_id=p_org AND authority.workspace_id=p_workspace AND authority.operator_actor_id=p_actor
    FOR UPDATE;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts row
    WHERE row.id=p_receipt AND row.org_id=p_org AND row.workspace_id=p_workspace FOR UPDATE;
  SELECT count(*)::integer INTO journal_count FROM public.enterprise_ai_effect_journal row WHERE row.receipt_id=p_receipt;
  IF journal_count<>1 THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_UNSAFE';END IF;
  SELECT * INTO STRICT journal FROM public.enterprise_ai_effect_journal row WHERE row.receipt_id=p_receipt FOR UPDATE;
  SELECT * INTO mapping_run FROM public.enterprise_assess_document_mapping_runs row
    WHERE row.id=p_mapping_run AND row.org_id=p_org AND row.workspace_id=p_workspace
      AND row.receipt_id=p_receipt FOR UPDATE;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations row
    WHERE row.id=p_reservation AND row.org_id=p_org AND row.workspace_id=p_workspace
      AND row.receipt_id=p_receipt AND row.assess_mapping_run_id=p_mapping_run FOR UPDATE;
  journal_row_hash:=public.enterprise_sha256_jsonb(to_jsonb(journal));

  -- Fresh Admin authority belongs to the reconciler. Historical execution
  -- identity belongs to the original author and must agree across every row.
  IF campaign.id IS NULL OR receipt.id IS NULL OR mapping_run.id IS NULL OR reservation.id IS NULL
    OR receipt.actor_id IS NULL OR mapping_run.created_by IS DISTINCT FROM receipt.actor_id
    OR reservation.actor_id IS DISTINCT FROM receipt.actor_id
    OR reservation.authorization_version IS NULL OR reservation.authorization_version<=0
    OR mapping_run.authorization_version IS DISTINCT FROM reservation.authorization_version
    OR receipt.execution_token IS NULL OR mapping_run.execution_token IS DISTINCT FROM receipt.execution_token
    OR reservation.execution_token IS DISTINCT FROM receipt.execution_token
    OR receipt.execution_fence IS NULL OR receipt.execution_fence<=0
    OR mapping_run.execution_fence IS DISTINCT FROM receipt.execution_fence
    OR reservation.execution_fence IS DISTINCT FROM receipt.execution_fence
    OR journal.execution_fence IS DISTINCT FROM receipt.execution_fence
    OR mapping_run.route_id IS DISTINCT FROM reservation.route_id
    OR mapping_run.provider_config_id IS DISTINCT FROM reservation.provider_config_id
    OR mapping_run.provider IS DISTINCT FROM reservation.provider OR mapping_run.model IS DISTINCT FROM reservation.model
    OR reservation.route_id IS DISTINCT FROM campaign.assess_route_id
    OR reservation.provider_config_id IS DISTINCT FROM campaign.provider_config_id
    OR reservation.provider IS DISTINCT FROM campaign.provider OR reservation.model IS DISTINCT FROM campaign.model
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_LINEAGE_MISMATCH';END IF;
  IF journal.id IS NULL OR journal.receipt_id IS DISTINCT FROM receipt.id
    OR journal.org_id IS DISTINCT FROM p_org OR journal.workspace_id IS DISTINCT FROM p_workspace
    OR journal.operation_type<>'assess.document-map.analyze' OR journal.effect_key<>'command'
    OR journal.terminal_status<>'failed' OR journal.resource_id IS NOT NULL
    OR journal.safe_result IS DISTINCT FROM receipt.response
    OR receipt.response_hash IS NULL OR journal.result_hash IS DISTINCT FROM receipt.response_hash
    OR journal.result_hash IS DISTINCT FROM public.enterprise_sha256_jsonb(receipt.response)
    OR journal.committed_at IS DISTINCT FROM receipt.completed_at
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_UNSAFE';END IF;

  digest_value:='sha256:'||encode(public.digest(convert_to(concat_ws('|','synthetic-ai-mapping-terminal-journal-v2',
    campaign.id::text,p_reservation::text,p_receipt::text,p_mapping_run::text,journal.id::text,journal_row_hash,
    p_actor::text,p_org::text,p_workspace::text,p_authorization_version::text,p_target_fingerprint,p_project_ref,
    reservation.failure_class,reservation.reserved_at::text,reservation.reserved_tokens::text,receipt.actor_id::text,
    reservation.authorization_version::text,receipt.execution_token::text,receipt.execution_fence::text),'UTF8'),'sha256'),'hex');
  SELECT * INTO prior FROM public.synthetic_ai_mapping_no_effect_reconciliations row
    WHERE row.reservation_id=p_reservation;
  IF prior.id IS NOT NULL THEN
    IF prior.campaign_id IS DISTINCT FROM p_campaign OR prior.receipt_id IS DISTINCT FROM p_receipt
      OR prior.mapping_run_id IS DISTINCT FROM p_mapping_run OR prior.effect_journal_id IS DISTINCT FROM journal.id
      OR prior.effect_journal_row_hash IS DISTINCT FROM journal_row_hash OR prior.actor_id IS DISTINCT FROM p_actor
      OR prior.org_id IS DISTINCT FROM p_org OR prior.workspace_id IS DISTINCT FROM p_workspace
      OR prior.authorization_version IS DISTINCT FROM p_authorization_version
      OR prior.historical_actor_id IS DISTINCT FROM receipt.actor_id
      OR prior.historical_authorization_version IS DISTINCT FROM reservation.authorization_version
      OR prior.reconciliation_digest IS DISTINCT FROM digest_value
      OR prior.target_fingerprint IS DISTINCT FROM p_target_fingerprint OR prior.project_ref IS DISTINCT FROM p_project_ref
      OR reservation.state<>'released' OR reservation.release_reason<>'reconciled_no_effect'
    THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_REPLAY_MISMATCH';END IF;
    RETURN prior.result;
  END IF;
  IF campaign.id IS NULL OR NOT campaign.enabled OR campaign.disabled_at IS NOT NULL
    OR campaign.provider<>'openai' OR campaign.endpoint<>'https://api.openai.com'
    OR campaign.model<>'gpt-4.1-mini-2025-04-14' OR campaign.campaign_cap_usd_nanos<>10000000000
    OR campaign.carried_usd_nanos<>869320000 OR campaign.fixed_debit_usd_nanos<>471459200
    OR receipt.id IS NULL OR receipt.status<>'failed' OR receipt.command_type<>'assess.document-map.analyze'
    OR receipt.runtime_area<>'ingestion' OR receipt.completed_at IS NULL
    OR receipt.response#>>'{error,code}' IS DISTINCT FROM 'COMMAND_UNAVAILABLE'
    OR mapping_run.id IS NULL OR mapping_run.status<>'claimed'
    OR mapping_run.safe_result IS NOT NULL OR mapping_run.output_hash IS NOT NULL OR mapping_run.staged_payload_hash IS NOT NULL
    OR mapping_run.token_input IS NOT NULL OR mapping_run.token_output IS NOT NULL OR mapping_run.latency_ms IS NOT NULL
    OR reservation.id IS NULL OR reservation.authority_kind<>'assess_mapping' OR reservation.job_id IS NOT NULL
    OR reservation.state<>'uncertain' OR reservation.failure_class<>'provider_request_failed'
    OR reservation.release_reason IS NOT NULL OR reservation.settled_at IS NOT NULL
    OR reservation.reserved_at IS DISTINCT FROM timestamptz '2026-09-23 05:22:54.727991+00'
    OR reservation.reserved_tokens<>34601 OR reservation.actual_input_tokens IS NOT NULL
    OR reservation.actual_output_tokens IS NOT NULL OR reservation.actual_total_tokens IS NOT NULL
    OR reservation.assess_mapping_transfer_pending
    OR reservation.route_id IS DISTINCT FROM campaign.assess_route_id
    OR reservation.provider_config_id IS DISTINCT FROM campaign.provider_config_id
    OR reservation.provider<>'openai' OR reservation.capability<>'assess.evidence.extract'
    OR reservation.model IS DISTINCT FROM campaign.model
    OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_proposals proposal WHERE proposal.run_id=p_mapping_run)
    OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_applications application
      JOIN public.enterprise_assess_document_mapping_proposals proposal ON proposal.id=application.proposal_id
      WHERE proposal.run_id=p_mapping_run)
    OR EXISTS(SELECT 1 FROM public.synthetic_ai_campaign_effect_debits debit
      WHERE debit.receipt_id=p_receipt OR debit.assess_mapping_run_id=p_mapping_run OR debit.effect_id=p_mapping_run)
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_MAPPING_RECONCILIATION_UNSAFE';END IF;
  result_value:=jsonb_build_object('status','reconciled_no_effect','campaignId',campaign.id,
    'reservationId',p_reservation,'receiptId',p_receipt,'mappingRunId',p_mapping_run,
    'effectJournalId',journal.id,'effectJournalRowHash',journal_row_hash,'reconciliationDigest',digest_value);
  INSERT INTO public.synthetic_ai_mapping_no_effect_reconciliations(campaign_id,reservation_id,receipt_id,mapping_run_id,
    effect_journal_id,effect_journal_row_hash,actor_id,historical_actor_id,historical_authorization_version,
    org_id,workspace_id,authorization_version,target_fingerprint,project_ref,retained_failure_class,
    retained_receipt_error_code,retained_reserved_at,retained_reserved_tokens,reconciliation_digest,result)
  VALUES(campaign.id,p_reservation,p_receipt,p_mapping_run,journal.id,journal_row_hash,p_actor,receipt.actor_id,
    reservation.authorization_version,p_org,p_workspace,p_authorization_version,p_target_fingerprint,p_project_ref,
    reservation.failure_class,'COMMAND_UNAVAILABLE',reservation.reserved_at,reservation.reserved_tokens,digest_value,result_value)
  RETURNING * INTO inserted;
  UPDATE public.enterprise_ai_budget_reservations SET state='released',release_reason='reconciled_no_effect',
    assess_mapping_transfer_pending=false,updated_at=statement_timestamp(),settled_at=statement_timestamp()
    WHERE id=p_reservation;
  RETURN inserted.result;
END
$$;

-- Exact-tip forwarding for activation, fresh bootstrap, and retained PR C
-- marker checks. The frozen PR C accepted tips remain allowed history.
DO $identity_forward$
DECLARE marker public.hosted_pilot_environment_identity;marker_constraint text;exercise_constraint text;
  activation_definition text;bootstrap_definition text;assert_marker_definition text;
  old_activation text:='marker.migration_tip<>''20261003015246''';
  new_activation text:='marker.migration_tip<>''20261003055918''';
  old_bootstrap text:='marker.migration_tip=''20261003015246''';
  new_bootstrap text:='marker.migration_tip=''20261003055918''';
  old_assert text:='marker.migration_tip = ''20261003015246''';
  new_assert text:='marker.migration_tip = ''20261003055918''';
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint FROM pg_constraint
    WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass
      AND conname='pr_c_controlled_human_exercises_migration_tip_check';
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure)
    INTO STRICT activation_definition;
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
    INTO STRICT bootstrap_definition;
  SELECT pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure)
    INTO STRICT assert_marker_definition;
  IF marker.migration_tip<>'20261003015246'
    OR marker_constraint<>'(migration_tip = ''20261003015246''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text]))'
    OR (length(activation_definition)-length(replace(activation_definition,old_activation,'')))/length(old_activation)<>1
    OR position(new_activation IN activation_definition)>0
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap)<>1
    OR position(new_bootstrap IN bootstrap_definition)>0
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR position(new_assert IN assert_marker_definition)>0
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN RAISE EXCEPTION 'SYNTHETIC_AI_JOURNAL_RECONCILIATION_IDENTITY_SOURCE_MISMATCH';END IF;
  EXECUTE replace(activation_definition,old_activation,new_activation);
  EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  ALTER TABLE public.pr_c_controlled_human_exercises
    DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises
    ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918'));
  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity SET migration_tip='20261003055918' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261003055918');
END
$identity_forward$;

REVOKE ALL ON FUNCTION
  public.synthetic_ai_reconcile_mapping_no_effect_once(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
  public.synthetic_ai_reconcile_mapping_no_effect_once(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid)
TO service_role;

COMMENT ON COLUMN public.synthetic_ai_mapping_no_effect_reconciliations.effect_journal_id IS
  'Exact immutable terminal failed command journal bound to the retained mapping reconciliation.';
COMMENT ON COLUMN public.synthetic_ai_mapping_no_effect_reconciliations.effect_journal_row_hash IS
  'Canonical SHA-256 of the complete enterprise_ai_effect_journal row at reconciliation and replay.';
COMMENT ON TABLE public.synthetic_ai_mapping_no_effect_reconciliations IS
  'Append-only proof that the retained failed mapping had exactly one bound terminal failed command journal and no provider effect, campaign debit, staged output, proposal, or application before release.';

-- Rollback/read-only fallback: leave both provider runtimes off or invoke the
-- existing campaign disable RPC. Retain every receipt, journal, reservation,
-- mapping, reconciliation, continuation, debit, Studio, and audit row.
