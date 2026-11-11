-- PR 1G additive Application Portfolio & AI-Assisted Modernization Assessment authority.
INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('assess.applications.read','assess','Read tenant-scoped application portfolio assessment records'),('assess.applications.write','assess','Create and update draft application metadata'),('assess.applications.import','assess','Import validated CSV/JSON application records'),('assess.applications.finalize','assess','Finalize application assessment versions for review'),('assess.applications.review','assess','Independently resolve application assessment reviews'),('assess.applications.portfolio.read','assess','Read tenant-scoped application portfolio snapshots'),('assess.applications.portfolio.write','assess','Create immutable application modernization portfolio snapshots')
ON CONFLICT(capability_key) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.assess_application_assets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,name text NOT NULL,normalized_name text NOT NULL,description text,deleted_at timestamptz,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),CONSTRAINT assess_application_assets_workspace_normalized_name_key UNIQUE(org_id,workspace_id,normalized_name));
CREATE TABLE IF NOT EXISTS public.assess_application_metadata_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,application_id uuid NOT NULL,version int NOT NULL CHECK(version>0),lifecycle text NOT NULL CHECK(lifecycle IN('draft','reviewer_ready','approved','changes_requested','rejected','superseded')),metadata jsonb NOT NULL,author_id uuid NOT NULL,receipt_id uuid REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,application_id,org_id,workspace_id),UNIQUE(application_id,org_id,workspace_id,version),FOREIGN KEY(application_id,org_id,workspace_id) REFERENCES public.assess_application_assets(id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_application_source_evidence(id uuid PRIMARY KEY,org_id uuid NOT NULL,workspace_id uuid NOT NULL,application_id uuid NOT NULL,metadata_version_id uuid NOT NULL,evidence_key text NOT NULL,claim_ids text[] NOT NULL,source_type text NOT NULL CHECK(source_type IN('manual','document','review','test','synthetic_fixture')),fresh boolean NOT NULL,independent boolean NOT NULL,accepted boolean NOT NULL,contradicts boolean NOT NULL DEFAULT false,synthetic boolean NOT NULL DEFAULT false,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,application_id,metadata_version_id,org_id,workspace_id),UNIQUE(metadata_version_id,evidence_key),FOREIGN KEY(metadata_version_id,application_id,org_id,workspace_id) REFERENCES public.assess_application_metadata_versions(id,application_id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_process_application_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,process_id uuid NOT NULL,primitive_id text NOT NULL,application_id uuid NOT NULL,application_metadata_version_id uuid NOT NULL,assessment_version_id uuid NOT NULL,interaction_type text NOT NULL,govern_state text NOT NULL CHECK(govern_state IN('approved','approval_required','rejected','Unknown')),economics_ref uuid,economics_currency char(3),created_by uuid NOT NULL,receipt_id uuid REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,process_id,primitive_id,application_id,application_metadata_version_id),FOREIGN KEY(application_id,org_id,workspace_id) REFERENCES public.assess_application_assets(id,org_id,workspace_id) ON DELETE RESTRICT,FOREIGN KEY(application_metadata_version_id,application_id,org_id,workspace_id) REFERENCES public.assess_application_metadata_versions(id,application_id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_application_dependencies(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,upstream_application_id uuid NOT NULL,downstream_application_id uuid NOT NULL,dependency_type text NOT NULL,metadata_version_id uuid NOT NULL,created_by uuid NOT NULL,receipt_id uuid REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),CHECK(upstream_application_id<>downstream_application_id),FOREIGN KEY(upstream_application_id,org_id,workspace_id) REFERENCES public.assess_application_assets(id,org_id,workspace_id) ON DELETE RESTRICT,FOREIGN KEY(downstream_application_id,org_id,workspace_id) REFERENCES public.assess_application_assets(id,org_id,workspace_id) ON DELETE RESTRICT,FOREIGN KEY(metadata_version_id,downstream_application_id,org_id,workspace_id) REFERENCES public.assess_application_metadata_versions(id,application_id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_application_assessment_versions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,application_id uuid NOT NULL,metadata_version_id uuid NOT NULL,version int NOT NULL CHECK(version>0),decision_model_version text NOT NULL CHECK(decision_model_version='assess-v2-application-portfolio-2026-07'),lifecycle text NOT NULL CHECK(lifecycle IN('draft','reviewer_ready','approved','changes_requested','rejected','superseded')),author_id uuid NOT NULL,reviewer_id uuid,authorization_version bigint NOT NULL,receipt_id uuid REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,audit_event_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,application_id,metadata_version_id,org_id,workspace_id),UNIQUE(application_id,org_id,workspace_id,version),CHECK(reviewer_id IS NULL OR reviewer_id<>author_id),FOREIGN KEY(application_id,org_id,workspace_id) REFERENCES public.assess_application_assets(id,org_id,workspace_id) ON DELETE RESTRICT,FOREIGN KEY(metadata_version_id,application_id,org_id,workspace_id) REFERENCES public.assess_application_metadata_versions(id,application_id,org_id,workspace_id) ON DELETE RESTRICT);
ALTER TABLE public.assess_process_application_links ADD CONSTRAINT assess_process_application_links_assessment_ancestry_fk FOREIGN KEY(assessment_version_id,application_id,application_metadata_version_id,org_id,workspace_id) REFERENCES public.assess_application_assessment_versions(id,application_id,metadata_version_id,org_id,workspace_id) ON DELETE RESTRICT;
CREATE TABLE IF NOT EXISTS public.assess_application_dimension_results(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,application_id uuid NOT NULL,metadata_version_id uuid NOT NULL,assessment_version_id uuid NOT NULL,dimension text NOT NULL CHECK(dimension IN('integration_accessibility','semantic_and_data_clarity','state_and_execution','security_and_control','architecture_changeability','ui_automation_readiness','ai_assisted_engineering_readiness')),readiness_band text NOT NULL,evidence_confidence text NOT NULL,hard_gates text[] NOT NULL DEFAULT '{}',evidence_refs jsonb NOT NULL DEFAULT '[]',missing_evidence text[] NOT NULL DEFAULT '{}',rationale text[] NOT NULL DEFAULT '{}',contradictions text[] NOT NULL DEFAULT '{}',remediation_requirements text[] NOT NULL DEFAULT '{}',what_would_change text[] NOT NULL DEFAULT '{}',UNIQUE(id,assessment_version_id,org_id,workspace_id),UNIQUE(assessment_version_id,dimension),FOREIGN KEY(assessment_version_id,application_id,metadata_version_id,org_id,workspace_id) REFERENCES public.assess_application_assessment_versions(id,application_id,metadata_version_id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_application_modernization_recommendations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,application_id uuid NOT NULL,metadata_version_id uuid NOT NULL,assessment_version_id uuid NOT NULL,disposition text NOT NULL,affected_processes jsonb NOT NULL DEFAULT '[]',affected_primitives jsonb NOT NULL DEFAULT '[]',why text[] NOT NULL DEFAULT '{}',alternatives_considered text[] NOT NULL DEFAULT '{}',alternatives_rejected text[] NOT NULL DEFAULT '{}',prerequisites text[] NOT NULL DEFAULT '{}',required_controls text[] NOT NULL DEFAULT '{}',migration_boundary text NOT NULL,dependency_impacts text[] NOT NULL DEFAULT '{}',rollback_strategy text NOT NULL,evidence_confidence text NOT NULL,open_evidence_gaps text[] NOT NULL DEFAULT '{}',what_would_change text[] NOT NULL DEFAULT '{}',UNIQUE(id,assessment_version_id,org_id,workspace_id),FOREIGN KEY(assessment_version_id,application_id,metadata_version_id,org_id,workspace_id) REFERENCES public.assess_application_assessment_versions(id,application_id,metadata_version_id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_application_review_resolutions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,application_id uuid NOT NULL,metadata_version_id uuid NOT NULL,assessment_version_id uuid NOT NULL,reviewer_id uuid NOT NULL,authorization_version bigint NOT NULL,resolution text NOT NULL CHECK(resolution IN('approved','changes_requested','rejected')),rationale text NOT NULL,conditions text[] NOT NULL DEFAULT '{}',receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,audit_event_id uuid,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(assessment_version_id,application_id,metadata_version_id,org_id,workspace_id) REFERENCES public.assess_application_assessment_versions(id,application_id,metadata_version_id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE IF NOT EXISTS public.assess_application_portfolio_snapshots(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,snapshot jsonb NOT NULL,created_by uuid NOT NULL,receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,audit_event_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id));
CREATE TABLE IF NOT EXISTS public.assess_application_import_receipts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL,idempotency_key text NOT NULL,payload_hash text NOT NULL,success_count int NOT NULL DEFAULT 0,rejection_count int NOT NULL DEFAULT 0,receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT,audit_event_id uuid,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,actor_id,idempotency_key));
CREATE TABLE IF NOT EXISTS public.assess_application_import_row_outcomes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,import_receipt_id uuid NOT NULL,row_number int NOT NULL,outcome text NOT NULL CHECK(outcome IN('success','rejected')),application_id uuid,error_code text,error_message text,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(import_receipt_id,org_id,workspace_id) REFERENCES public.assess_application_import_receipts(id,org_id,workspace_id) ON DELETE RESTRICT,FOREIGN KEY(application_id,org_id,workspace_id) REFERENCES public.assess_application_assets(id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE OR REPLACE FUNCTION public.pr1g_reject_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'PR1G_IMMUTABLE_RECORD'; END; $$;
CREATE OR REPLACE FUNCTION public.pr1g_reject_finalized_metadata_update() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN IF OLD.lifecycle<>'draft' THEN RAISE EXCEPTION 'PR1G_FINALIZED_METADATA_IMMUTABLE'; END IF; RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_pr1g_metadata_finalized_immutable ON public.assess_application_metadata_versions; CREATE TRIGGER trg_pr1g_metadata_finalized_immutable BEFORE UPDATE OR DELETE ON public.assess_application_metadata_versions FOR EACH ROW EXECUTE FUNCTION public.pr1g_reject_finalized_metadata_update();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assess_application_source_evidence','assess_application_assessment_versions','assess_application_dimension_results','assess_application_modernization_recommendations','assess_application_review_resolutions','assess_application_portfolio_snapshots','assess_application_import_row_outcomes'] LOOP EXECUTE format('DROP TRIGGER IF EXISTS trg_pr1g_%I_immutable ON public.%I',t,t); EXECUTE format('CREATE TRIGGER trg_pr1g_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pr1g_reject_immutable()',t,t); END LOOP; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assess_application_assets','assess_application_metadata_versions','assess_application_source_evidence','assess_process_application_links','assess_application_dependencies','assess_application_assessment_versions','assess_application_dimension_results','assess_application_modernization_recommendations','assess_application_review_resolutions','assess_application_portfolio_snapshots','assess_application_import_receipts','assess_application_import_row_outcomes'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon',t); EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated',t); END LOOP; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['assess_application_assets','assess_application_metadata_versions','assess_application_source_evidence','assess_process_application_links','assess_application_dependencies','assess_application_assessment_versions','assess_application_dimension_results','assess_application_modernization_recommendations','assess_application_review_resolutions','assess_application_portfolio_snapshots','assess_application_import_receipts','assess_application_import_row_outcomes'] LOOP EXECUTE format('DROP POLICY IF EXISTS pr1g_%I_select ON public.%I',t,t); EXECUTE format('CREATE POLICY pr1g_%I_select ON public.%I FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,''assess.applications.read'') OR public.has_workspace_capability(workspace_id,org_id,''assess.applications.portfolio.read''))',t,t); END LOOP; END $$;
CREATE OR REPLACE FUNCTION public.pr1g_error_envelope(p_message text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('ok',false,'errorCode',CASE
  WHEN p_message LIKE '%PR1G_AUTHORIZATION_STALE%' THEN 'AUTHORIZATION_STALE'
  WHEN p_message LIKE '%PR1G_IDEMPOTENCY_CONFLICT%' THEN 'IDEMPOTENCY_CONFLICT'
  WHEN p_message LIKE '%PR1G_VERSION_CONFLICT%' THEN 'VERSION_CONFLICT'
  WHEN p_message LIKE '%PR1G_PERMISSION_DENIED%' OR p_message LIKE '%PR1B_NOT_FOUND%' THEN 'PERMISSION_DENIED'
  WHEN p_message LIKE '%PR1B_AUTHORIZATION_STALE%' THEN 'AUTHORIZATION_STALE'
  WHEN p_message LIKE '%PR1G_FEATURE_DISABLED%' THEN 'FEATURE_DISABLED'
  WHEN p_message LIKE '%PR1G_READ_ONLY%' THEN 'READ_ONLY'
  WHEN p_message LIKE '%PR1G_INVALID_COMMAND%' THEN 'INVALID_COMMAND'
  WHEN p_message LIKE '%PR1G_NOT_FOUND%' THEN 'NOT_FOUND'
  ELSE 'COMMAND_UNAVAILABLE' END);
$$;
CREATE OR REPLACE FUNCTION public.pr1g_assert_application_authority(p_actor uuid,p_org uuid,p_workspace uuid,p_capability text,p_authorization_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF COALESCE(current_setting('app.pr1g_enabled',true),'on')='off' THEN RAISE EXCEPTION 'PR1G_FEATURE_DISABLED'; END IF;
 IF COALESCE(current_setting('app.pr1g_read_only',true),'off')='on' THEN RAISE EXCEPTION 'PR1G_READ_ONLY'; END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,p_capability,p_authorization_version);
END $$;
CREATE OR REPLACE FUNCTION public.pr1g_command_capability(p_command text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE p_command
  WHEN 'application.create' THEN 'assess.applications.write'
  WHEN 'application.import' THEN 'assess.applications.import'
  WHEN 'application.metadata.upsert' THEN 'assess.applications.write'
  WHEN 'application.assessment.save' THEN 'assess.applications.write'
  WHEN 'application.assessment.finalize' THEN 'assess.applications.finalize'
  WHEN 'application.assessment.review.resolve' THEN 'assess.applications.review'
  WHEN 'application.assessment.revision.start' THEN 'assess.applications.write'
  WHEN 'application.portfolio.snapshot.create' THEN 'assess.applications.portfolio.write'
  ELSE NULL END;
$$;
CREATE OR REPLACE FUNCTION public.pr1g_evidence_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(p)='array' AND NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(p) e
  WHERE jsonb_typeof(e)<>'object'
   OR NOT e ?& ARRAY['id','claimIds','sourceType','fresh','independent','accepted']
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(e) keys(key) WHERE key<>ALL(ARRAY['id','claimIds','sourceType','fresh','independent','accepted','contradicts','synthetic']))
   OR jsonb_typeof(e->'id')<>'string' OR btrim(e->>'id')=''
   OR jsonb_typeof(e->'claimIds')<>'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(e->'claimIds') claim WHERE jsonb_typeof(claim)<>'string' OR claim#>>'{}'<>ALL(ARRAY['integration_accessibility','semantic_and_data_clarity','state_and_execution','security_and_control','architecture_changeability','ui_automation_readiness','ai_assisted_engineering_readiness']))
   OR e->>'sourceType'<>ALL(ARRAY['manual','document','review','test','synthetic_fixture'])
   OR jsonb_typeof(e->'fresh')<>'boolean' OR jsonb_typeof(e->'independent')<>'boolean' OR jsonb_typeof(e->'accepted')<>'boolean'
   OR (e ? 'contradicts' AND jsonb_typeof(e->'contradicts')<>'boolean')
   OR (e ? 'synthetic' AND jsonb_typeof(e->'synthetic')<>'boolean')
 ) AND (SELECT count(*)=count(DISTINCT e->>'id') FROM jsonb_array_elements(p) e);
$$;
CREATE OR REPLACE FUNCTION public.pr1g_metadata_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(p)='object'
 AND p ?& ARRAY['name','businessCapabilities','supportedProcesses','businessCriticality','lifecycleState','sourceCode','documentationQuality','automatedTestMaturity','deploymentRepeatability','observability','dataClassifications','regulatedData','operatingRegions','interfaces','upstreamDependencies','downstreamDependencies','realTime','eventDriven','synchronous','batch','synthetic']
 AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p) AS keys(key) WHERE key<>ALL(ARRAY['name','description','businessOwner','technicalOwner','vendor','businessCapabilities','supportedProcesses','businessCriticality','lifecycleState','product','version','eolStatus','hostingModel','platform','languages','frameworks','sourceCode','documentationQuality','automatedTestMaturity','deploymentRepeatability','observability','dataClassifications','regulatedData','operatingRegions','interfaces','upstreamDependencies','downstreamDependencies','realTime','eventDriven','synchronous','batch','bridgeEvidence','aiControls','ageYears','synthetic','evidence']))
 AND jsonb_typeof(p->'name')='string' AND btrim(p->>'name')<>''
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['businessCapabilities','supportedProcesses','dataClassifications','operatingRegions','interfaces','upstreamDependencies','downstreamDependencies']) AS keys(key) WHERE jsonb_typeof(p->key)<>'array')
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['platform','languages','frameworks']) AS keys(key) WHERE p ? key AND jsonb_typeof(p->key)<>'array')
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['businessCapabilities','supportedProcesses','dataClassifications','operatingRegions','interfaces','upstreamDependencies','downstreamDependencies','platform','languages','frameworks']) AS keys(key), LATERAL jsonb_array_elements(COALESCE(p->key,'[]'::jsonb)) value WHERE jsonb_typeof(value)<>'string')
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(p->'interfaces') value WHERE value<>ALL(ARRAY['REST/GraphQL','SOAP','messaging/event','database','file/batch','command-line','UI-only','desktop/mainframe/Citrix']))
 AND p->>'businessCriticality'=ANY(ARRAY['low','medium','high','mission_critical','Unknown'])
 AND p->>'lifecycleState'=ANY(ARRAY['current','maintenance','eol','unsupported','retiring','Unknown'])
 AND p->>'sourceCode'=ANY(ARRAY['available_legal_access','available_no_legal_access','unavailable','Unknown'])
 AND p->>'documentationQuality'=ANY(ARRAY['high','medium','low','Unknown'])
 AND p->>'automatedTestMaturity'=ANY(ARRAY['executable_acceptance','unit_or_integration','manual_only','none','Unknown'])
 AND p->>'deploymentRepeatability'=ANY(ARRAY['deterministic','repeatable_manual','ad_hoc','Unknown'])
 AND p->>'observability'=ANY(ARRAY['strong','partial','weak','Unknown'])
 AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['regulatedData','realTime','eventDriven','synchronous','batch']) AS keys(key) WHERE NOT (jsonb_typeof(p->key)='boolean' OR (jsonb_typeof(p->key)='string' AND p->>key='Unknown')))
 AND (NOT p ? 'eolStatus' OR p->>'eolStatus'=ANY(ARRAY['supported','eol_announced','eol','Unknown']))
 AND (NOT p ? 'ageYears' OR (jsonb_typeof(p->'ageYears')='number' AND (p->>'ageYears')::numeric>=0))
 AND jsonb_typeof(p->'synthetic')='boolean'
 AND (NOT p ? 'bridgeEvidence' OR p->'bridgeEvidence'='null'::jsonb OR (jsonb_typeof(p->'bridgeEvidence')='object' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p->'bridgeEvidence') keys(key) WHERE key<>ALL(ARRAY['stableInterface','controlAccessibility','deterministicErrorDetection','reversibilityOrCompensation','materialActionApproval','monitoring','humanOwner'])) AND NOT EXISTS(SELECT 1 FROM jsonb_each(p->'bridgeEvidence') entry WHERE jsonb_typeof(entry.value)<>'boolean')))
 AND (NOT p ? 'aiControls' OR p->'aiControls'='null'::jsonb OR (jsonb_typeof(p->'aiControls')='object' AND NOT EXISTS(SELECT 1 FROM jsonb_object_keys(p->'aiControls') keys(key) WHERE key<>ALL(ARRAY['legalSourceRights','executableAcceptanceTests','reproducibleBuild','controlledSecurityReview','humanEngineeringOwner','controlledDeploymentRollback'])) AND NOT EXISTS(SELECT 1 FROM jsonb_each(p->'aiControls') entry WHERE jsonb_typeof(entry.value)<>'boolean')))
 AND (NOT p ? 'evidence' OR public.pr1g_evidence_valid(p->'evidence'));
$$;
CREATE OR REPLACE FUNCTION public.pr1g_evidence_confidence(p_metadata_id uuid,p_claim text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN count(*)=0 OR bool_or(contradicts) THEN 'Insufficient Evidence'
  WHEN bool_and(fresh AND independent AND accepted AND NOT synthetic AND source_type<>'synthetic_fixture') THEN 'Verified'
  WHEN bool_or(NOT fresh OR synthetic OR source_type='synthetic_fixture') THEN 'Assumption-Led'
  ELSE 'Partially Evidenced' END
 FROM public.assess_application_source_evidence WHERE metadata_version_id=p_metadata_id AND p_claim=ANY(claim_ids);
$$;
CREATE OR REPLACE FUNCTION public.pr1g_copy_application_decisions(p_source_assessment uuid,p_target_assessment uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.assess_application_dimension_results(org_id,workspace_id,application_id,metadata_version_id,assessment_version_id,dimension,readiness_band,evidence_confidence,hard_gates,evidence_refs,missing_evidence,rationale,contradictions,remediation_requirements,what_would_change)
 SELECT org_id,workspace_id,application_id,metadata_version_id,p_target_assessment,dimension,readiness_band,evidence_confidence,hard_gates,evidence_refs,missing_evidence,rationale,contradictions,remediation_requirements,what_would_change
 FROM public.assess_application_dimension_results WHERE assessment_version_id=p_source_assessment;
 INSERT INTO public.assess_application_modernization_recommendations(org_id,workspace_id,application_id,metadata_version_id,assessment_version_id,disposition,affected_processes,affected_primitives,why,alternatives_considered,alternatives_rejected,prerequisites,required_controls,migration_boundary,dependency_impacts,rollback_strategy,evidence_confidence,open_evidence_gaps,what_would_change)
 SELECT org_id,workspace_id,application_id,metadata_version_id,p_target_assessment,disposition,affected_processes,affected_primitives,why,alternatives_considered,alternatives_rejected,prerequisites,required_controls,migration_boundary,dependency_impacts,rollback_strategy,evidence_confidence,open_evidence_gaps,what_would_change
 FROM public.assess_application_modernization_recommendations WHERE assessment_version_id=p_source_assessment;
 IF (SELECT count(*) FROM public.assess_application_dimension_results WHERE assessment_version_id=p_target_assessment)<>7
  OR (SELECT count(DISTINCT dimension) FROM public.assess_application_dimension_results WHERE assessment_version_id=p_target_assessment)<>7
  OR NOT EXISTS(SELECT 1 FROM public.assess_application_modernization_recommendations WHERE assessment_version_id=p_target_assessment)
 THEN RAISE EXCEPTION 'PR1G_INCOMPLETE_DECISION_SET'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.pr1g_dimension_missing_evidence(p_metadata jsonb,p_dimension text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE p_dimension
  WHEN 'semantic_and_data_clarity' THEN CASE WHEN p_metadata->>'documentationQuality'='Unknown' THEN ARRAY['DOCUMENTATION_QUALITY'] ELSE ARRAY[]::text[] END
  WHEN 'state_and_execution' THEN CASE WHEN p_metadata->>'realTime'='Unknown' OR p_metadata->>'synchronous'='Unknown' THEN ARRAY['EXECUTION_CHARACTERISTICS'] ELSE ARRAY[]::text[] END
  WHEN 'security_and_control' THEN CASE WHEN p_metadata->>'regulatedData'='Unknown' THEN ARRAY['REGULATED_DATA_FLAGS'] ELSE ARRAY[]::text[] END
  WHEN 'architecture_changeability' THEN ARRAY(SELECT x FROM unnest(ARRAY[CASE WHEN p_metadata->>'sourceCode'='Unknown' THEN 'SOURCE_RIGHTS' END,CASE WHEN p_metadata->>'deploymentRepeatability'='Unknown' THEN 'DEPLOYMENT_REPEATABILITY' END]) x WHERE x IS NOT NULL)
  WHEN 'ui_automation_readiness' THEN CASE WHEN (p_metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] THEN ARRAY(SELECT gate FROM unnest(ARRAY['stableInterface','controlAccessibility','deterministicErrorDetection','reversibilityOrCompensation','materialActionApproval','monitoring','humanOwner']) WITH ORDINALITY controls(gate,position) WHERE COALESCE(p_metadata#>(ARRAY['bridgeEvidence',gate]),'false'::jsonb)<>'true'::jsonb ORDER BY position) ELSE ARRAY[]::text[] END
  ELSE ARRAY[]::text[] END;
$$;
CREATE OR REPLACE FUNCTION public.pr1g_execute_application_command(p_org_id uuid,p_workspace_id uuid,p_actor_id uuid,p_request_id uuid,p_command_type text,p_expected_version bigint,p_authorization_version bigint,p_idempotency_key text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE cap text:=public.pr1g_command_capability(p_command_type); h text:=md5(p_payload::text); r public.assess_command_receipts; audit_id uuid:=gen_random_uuid(); app public.assess_application_assets; meta public.assess_application_metadata_versions; ass public.assess_application_assessment_versions; source_assessment_id uuid; result jsonb; row_item jsonb; evidence_item jsonb; i int:=0; v_success_count int:=0; v_rejection_count int:=0; target_version int; v_constraint_name text;
BEGIN
 IF cap IS NULL THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
 PERFORM public.pr1g_assert_application_authority(p_actor_id,p_org_id,p_workspace_id,cap,p_authorization_version);
 r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,p_command_type,p_idempotency_key,p_request_id,h);
 IF r.status='succeeded' THEN RETURN r.response; END IF;
 IF p_command_type='application.create' THEN
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  INSERT INTO public.assess_application_assets(id,org_id,workspace_id,name,normalized_name,description,created_by)
  VALUES((p_payload->>'applicationId')::uuid,p_org_id,p_workspace_id,p_payload->>'name',lower(btrim(p_payload->>'name')),p_payload->>'description',p_actor_id) RETURNING * INTO app;
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',app.id,'version',1,'status','draft','name',app.name));
 ELSIF p_command_type='application.metadata.upsert' THEN
 SELECT * INTO app FROM public.assess_application_assets WHERE id=(p_payload->>'applicationId')::uuid AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
  IF app.id IS NULL THEN RAISE EXCEPTION 'PR1G_NOT_FOUND'; END IF;
  IF p_expected_version<>(p_payload->>'metadataVersion')::bigint-1 THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  IF NOT public.pr1g_metadata_valid(p_payload->'metadata') OR jsonb_typeof(COALESCE(p_payload->'evidence','null'::jsonb))<>'array' THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
  INSERT INTO public.assess_application_metadata_versions(id,org_id,workspace_id,application_id,version,lifecycle,metadata,author_id,receipt_id)
  VALUES((p_payload->>'metadataVersionId')::uuid,p_org_id,p_workspace_id,app.id,(p_payload->>'metadataVersion')::int,'draft',p_payload->'metadata',p_actor_id,r.id) RETURNING * INTO meta;
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_payload->'evidence') LOOP
   IF COALESCE(row_item->>'id','')='' OR jsonb_typeof(row_item->'claimIds')<>'array' OR row_item->>'sourceType' NOT IN('manual','document','review','test','synthetic_fixture') OR jsonb_typeof(row_item->'fresh')<>'boolean' OR jsonb_typeof(row_item->'independent')<>'boolean' OR jsonb_typeof(row_item->'accepted')<>'boolean' THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
   INSERT INTO public.assess_application_source_evidence(id,org_id,workspace_id,application_id,metadata_version_id,evidence_key,claim_ids,source_type,fresh,independent,accepted,contradicts,synthetic,created_by)
   VALUES(gen_random_uuid(),p_org_id,p_workspace_id,app.id,meta.id,row_item->>'id',ARRAY(SELECT jsonb_array_elements_text(row_item->'claimIds')),row_item->>'sourceType',(row_item->>'fresh')::boolean,(row_item->>'independent')::boolean,(row_item->>'accepted')::boolean,COALESCE((row_item->>'contradicts')::boolean,false),COALESCE((row_item->>'synthetic')::boolean,false),p_actor_id);
  END LOOP;
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',meta.id,'applicationId',app.id,'version',meta.version,'status',meta.lifecycle));
 ELSIF p_command_type='application.import' THEN
  IF jsonb_typeof(p_payload->'rows')<>'array' OR jsonb_array_length(p_payload->'rows')>500 OR NOT p_payload ?& ARRAY['importReceiptId','payloadHash','rows'] THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
  INSERT INTO public.assess_application_import_receipts(id,org_id,workspace_id,actor_id,idempotency_key,payload_hash,receipt_id)
  VALUES((p_payload->>'importReceiptId')::uuid,p_org_id,p_workspace_id,p_actor_id,p_idempotency_key,p_payload->>'payloadHash',r.id);
  FOR row_item IN SELECT * FROM jsonb_array_elements(p_payload->'rows') LOOP
   i:=i+1;
   BEGIN
    IF NOT public.pr1g_metadata_valid(row_item) OR NOT public.pr1g_evidence_valid(COALESCE(row_item->'evidence','[]'::jsonb)) THEN RAISE EXCEPTION 'PR1G_INVALID_IMPORT_ROW'; END IF;
    IF EXISTS(SELECT 1 FROM public.assess_application_assets WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND normalized_name=lower(btrim(row_item->>'name')) AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PR1G_DUPLICATE_IMPORT_ROW'; END IF;
    INSERT INTO public.assess_application_assets(org_id,workspace_id,name,normalized_name,description,created_by) VALUES(p_org_id,p_workspace_id,row_item->>'name',lower(btrim(row_item->>'name')),COALESCE(row_item->>'description','Imported application'),p_actor_id) RETURNING * INTO app;
    INSERT INTO public.assess_application_metadata_versions(org_id,workspace_id,application_id,version,lifecycle,metadata,author_id,receipt_id) VALUES(p_org_id,p_workspace_id,app.id,1,'draft',row_item - 'evidence',p_actor_id,r.id) RETURNING * INTO meta;
    FOR evidence_item IN SELECT * FROM jsonb_array_elements(COALESCE(row_item->'evidence','[]'::jsonb)) LOOP
     INSERT INTO public.assess_application_source_evidence(id,org_id,workspace_id,application_id,metadata_version_id,evidence_key,claim_ids,source_type,fresh,independent,accepted,contradicts,synthetic,created_by)
     VALUES(gen_random_uuid(),p_org_id,p_workspace_id,app.id,meta.id,evidence_item->>'id',ARRAY(SELECT jsonb_array_elements_text(evidence_item->'claimIds')),evidence_item->>'sourceType',(evidence_item->>'fresh')::boolean,(evidence_item->>'independent')::boolean,(evidence_item->>'accepted')::boolean,COALESCE((evidence_item->>'contradicts')::boolean,false),COALESCE((evidence_item->>'synthetic')::boolean,false),p_actor_id);
    END LOOP;
    v_success_count:=v_success_count+1;
    INSERT INTO public.assess_application_import_row_outcomes(org_id,workspace_id,import_receipt_id,row_number,outcome,application_id) VALUES(p_org_id,p_workspace_id,(p_payload->>'importReceiptId')::uuid,i,'success',app.id);
   EXCEPTION
    WHEN unique_violation THEN
     GET STACKED DIAGNOSTICS v_constraint_name=CONSTRAINT_NAME;
     IF v_constraint_name<>'assess_application_assets_workspace_normalized_name_key' THEN RAISE; END IF;
     v_rejection_count:=v_rejection_count+1;
     INSERT INTO public.assess_application_import_row_outcomes(org_id,workspace_id,import_receipt_id,row_number,outcome,error_code,error_message) VALUES(p_org_id,p_workspace_id,(p_payload->>'importReceiptId')::uuid,i,'rejected','DUPLICATE_IN_WORKSPACE','Duplicate application in this workspace.');
    WHEN raise_exception THEN
     IF SQLERRM='PR1G_INVALID_IMPORT_ROW' THEN
      v_rejection_count:=v_rejection_count+1;
      INSERT INTO public.assess_application_import_row_outcomes(org_id,workspace_id,import_receipt_id,row_number,outcome,error_code,error_message) VALUES(p_org_id,p_workspace_id,(p_payload->>'importReceiptId')::uuid,i,'rejected','INVALID_METADATA','Row failed the canonical application metadata schema.');
     ELSIF SQLERRM='PR1G_DUPLICATE_IMPORT_ROW' THEN
      v_rejection_count:=v_rejection_count+1;
      INSERT INTO public.assess_application_import_row_outcomes(org_id,workspace_id,import_receipt_id,row_number,outcome,error_code,error_message) VALUES(p_org_id,p_workspace_id,(p_payload->>'importReceiptId')::uuid,i,'rejected','DUPLICATE_IN_WORKSPACE','Duplicate application in this workspace.');
     ELSE
      RAISE;
     END IF;
   END;
  END LOOP;
  UPDATE public.assess_application_import_receipts AS receipt SET success_count=v_success_count,rejection_count=v_rejection_count,audit_event_id=audit_id WHERE receipt.id=(p_payload->>'importReceiptId')::uuid;
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',(p_payload->>'importReceiptId')::uuid,'version',1,'status','committed','successCount',v_success_count,'rejectionCount',v_rejection_count));
 ELSIF p_command_type='application.assessment.save' THEN
  IF p_payload ?| ARRAY['dimensions','recommendations','confidence','band','bands','decisionBands','gate','gates','hardGates','disposition','dispositions'] THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
  SELECT * INTO meta FROM public.assess_application_metadata_versions WHERE application_id=(p_payload->>'applicationId')::uuid AND org_id=p_org_id AND workspace_id=p_workspace_id AND version=(p_payload->>'metadataVersion')::int FOR SHARE;
  IF meta.id IS NULL THEN RAISE EXCEPTION 'PR1G_NOT_FOUND'; END IF;
  target_version:=(p_payload->>'assessmentVersion')::int; IF p_expected_version<>target_version-1 THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  INSERT INTO public.assess_application_assessment_versions(id,org_id,workspace_id,application_id,metadata_version_id,version,decision_model_version,lifecycle,author_id,authorization_version,receipt_id,audit_event_id)
  VALUES((p_payload->>'assessmentVersionId')::uuid,p_org_id,p_workspace_id,meta.application_id,meta.id,target_version,'assess-v2-application-portfolio-2026-07','draft',p_actor_id,p_authorization_version,r.id,audit_id) RETURNING * INTO ass;
  FOR row_item IN SELECT to_jsonb(d) FROM unnest(ARRAY['integration_accessibility','semantic_and_data_clarity','state_and_execution','security_and_control','architecture_changeability','ui_automation_readiness','ai_assisted_engineering_readiness']) d LOOP
   INSERT INTO public.assess_application_dimension_results(org_id,workspace_id,application_id,metadata_version_id,assessment_version_id,dimension,readiness_band,evidence_confidence,hard_gates,missing_evidence,rationale,remediation_requirements,what_would_change,evidence_refs)
   VALUES(p_org_id,p_workspace_id,ass.application_id,ass.metadata_version_id,ass.id,row_item#>>'{}',
    CASE row_item#>>'{}'
     WHEN 'integration_accessibility' THEN CASE WHEN (meta.metadata->'interfaces') ?| ARRAY['REST/GraphQL','SOAP','messaging/event'] THEN 'Ready' WHEN (meta.metadata->'interfaces') ?| ARRAY['file/batch','database','command-line'] THEN 'Conditionally Ready' WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] THEN 'Blocked' ELSE 'Unknown' END
     WHEN 'semantic_and_data_clarity' THEN CASE meta.metadata->>'documentationQuality' WHEN 'high' THEN 'Ready' WHEN 'medium' THEN 'Conditionally Ready' WHEN 'low' THEN 'Blocked' ELSE 'Unknown' END
     WHEN 'state_and_execution' THEN CASE WHEN meta.metadata->>'batch'='true' OR meta.metadata->>'realTime'='false' THEN 'Conditionally Ready' WHEN meta.metadata->>'realTime'='true' THEN 'Ready' ELSE 'Unknown' END
     WHEN 'security_and_control' THEN CASE meta.metadata->>'regulatedData' WHEN 'true' THEN 'Conditionally Ready' WHEN 'false' THEN 'Ready' ELSE 'Unknown' END
     WHEN 'architecture_changeability' THEN CASE WHEN meta.metadata->>'sourceCode'='available_legal_access' AND meta.metadata->>'deploymentRepeatability'='deterministic' THEN 'Ready' WHEN meta.metadata->>'sourceCode'='unavailable' THEN 'Blocked' ELSE 'Conditionally Ready' END
     WHEN 'ui_automation_readiness' THEN CASE WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] AND COALESCE((meta.metadata#>>'{bridgeEvidence,stableInterface}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,controlAccessibility}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,deterministicErrorDetection}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,reversibilityOrCompensation}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,materialActionApproval}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,monitoring}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,humanOwner}')::boolean,false) THEN 'Conditionally Ready' WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] THEN 'Blocked' ELSE 'Unknown' END
     WHEN 'ai_assisted_engineering_readiness' THEN CASE WHEN COALESCE((meta.metadata#>>'{aiControls,legalSourceRights}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,executableAcceptanceTests}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,reproducibleBuild}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,controlledSecurityReview}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,humanEngineeringOwner}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,controlledDeploymentRollback}')::boolean,false) THEN 'Ready' ELSE 'Blocked' END END,
    CASE WHEN cardinality(public.pr1g_dimension_missing_evidence(meta.metadata,row_item#>>'{}'))>0 THEN 'Insufficient Evidence' ELSE public.pr1g_evidence_confidence(meta.id,row_item#>>'{}') END,
    CASE row_item#>>'{}'
     WHEN 'integration_accessibility' THEN CASE WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] AND NOT (COALESCE((meta.metadata#>>'{bridgeEvidence,stableInterface}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,controlAccessibility}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,deterministicErrorDetection}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,reversibilityOrCompensation}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,materialActionApproval}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,monitoring}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,humanOwner}')::boolean,false)) THEN ARRAY['UI_BRIDGE_EVIDENCE_REQUIRED'] ELSE ARRAY[]::text[] END
     WHEN 'semantic_and_data_clarity' THEN CASE WHEN meta.metadata->>'documentationQuality'='low' THEN ARRAY['UNDOCUMENTED_SEMANTICS'] ELSE ARRAY[]::text[] END
     WHEN 'state_and_execution' THEN CASE WHEN meta.metadata->>'batch'='true' THEN ARRAY['BATCH_DELAYED_FEEDBACK'] ELSE ARRAY[]::text[] END
     WHEN 'security_and_control' THEN CASE WHEN meta.metadata->>'regulatedData'='true' THEN ARRAY['REGULATED_DATA_REQUIRES_INDEPENDENT_REVIEW'] ELSE ARRAY[]::text[] END
     WHEN 'architecture_changeability' THEN CASE WHEN meta.metadata->>'sourceCode'='unavailable' THEN ARRAY['NO_LEGAL_SOURCE_ACCESS'] ELSE ARRAY[]::text[] END
     WHEN 'ui_automation_readiness' THEN CASE WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] AND NOT (COALESCE((meta.metadata#>>'{bridgeEvidence,stableInterface}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,controlAccessibility}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,deterministicErrorDetection}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,reversibilityOrCompensation}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,materialActionApproval}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,monitoring}')::boolean,false) AND COALESCE((meta.metadata#>>'{bridgeEvidence,humanOwner}')::boolean,false)) THEN ARRAY['UI_AUTOMATION_POSITIVE_EVIDENCE_REQUIRED'] ELSE ARRAY[]::text[] END
     WHEN 'ai_assisted_engineering_readiness' THEN ARRAY(SELECT 'AI_REBUILD_REQUIRES_'||upper(gate) FROM unnest(ARRAY['legalSourceRights','executableAcceptanceTests','reproducibleBuild','controlledSecurityReview','humanEngineeringOwner','controlledDeploymentRollback']) WITH ORDINALITY controls(gate,position) WHERE COALESCE(meta.metadata#>(ARRAY['aiControls',gate]),'false'::jsonb)<>'true'::jsonb ORDER BY position)
     ELSE ARRAY[]::text[] END,
    public.pr1g_dimension_missing_evidence(meta.metadata,row_item#>>'{}'),
    CASE row_item#>>'{}'
     WHEN 'integration_accessibility' THEN ARRAY['Interfaces: '||COALESCE(NULLIF(ARRAY_TO_STRING(ARRAY(SELECT jsonb_array_elements_text(meta.metadata->'interfaces')),', '),''),'Unknown')]
     WHEN 'semantic_and_data_clarity' THEN ARRAY['Documentation quality is '||(meta.metadata->>'documentationQuality')||'.']
     WHEN 'state_and_execution' THEN ARRAY['State, feedback, reversibility and transaction boundaries are independent.']
     WHEN 'security_and_control' THEN ARRAY['Security/control readiness never follows from API availability.']
     WHEN 'architecture_changeability' THEN ARRAY['Application age alone is ignored.']
     WHEN 'ui_automation_readiness' THEN ARRAY['UI-only or absent API never automatically implies RPA/UI automation.']
     WHEN 'ai_assisted_engineering_readiness' THEN ARRAY['AI may summarize evidence but cannot approve rebuild, rewrite or deploy.'] END,
    CASE row_item#>>'{}'
     WHEN 'integration_accessibility' THEN ARRAY['Evidence native API/event, façade, semantic translation, event bridge, workflow bridge, or UI bridge controls.']
     WHEN 'semantic_and_data_clarity' THEN ARRAY['Add schema, data dictionary, canonical identifiers, field validation and source-of-truth evidence.']
     WHEN 'state_and_execution' THEN ARRAY['Document transaction boundaries, compensation and partial-failure visibility.']
     WHEN 'security_and_control' THEN ARRAY['Evidence authn/authz, service identity, SoD, audit, approvals and license controls.']
     WHEN 'architecture_changeability' THEN ARRAY['Secure source rights, tests, build, deployment and observability evidence.']
     WHEN 'ui_automation_readiness' THEN ARRAY['Prove stable interface, accessibility, deterministic errors, reversibility, approvals, monitoring and ownership.']
     WHEN 'ai_assisted_engineering_readiness' THEN ARRAY['Provide legal source rights, executable acceptance tests, reproducible build, security review, human owner, deployment/rollback.'] END,
    CASE row_item#>>'{}'
     WHEN 'integration_accessibility' THEN ARRAY['Fresh accepted interface contract would change this result.']
     WHEN 'semantic_and_data_clarity' THEN ARRAY['Accepted semantic evidence would change this result.']
     WHEN 'state_and_execution' THEN ARRAY['Executable workflow/compensation evidence would change this result.']
     WHEN 'security_and_control' THEN ARRAY['Approved controls would change this result.']
     WHEN 'architecture_changeability' THEN ARRAY['Legal source plus reproducible build evidence would change this result.']
     WHEN 'ui_automation_readiness' THEN ARRAY['Complete governed bridge evidence would change this result.']
     WHEN 'ai_assisted_engineering_readiness' THEN ARRAY['All hard gates plus independent review would change this result.'] END,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.evidence_key,'claimIds',e.claim_ids,'sourceType',e.source_type,'fresh',e.fresh,'independent',e.independent,'accepted',e.accepted,'contradicts',e.contradicts,'synthetic',e.synthetic) ORDER BY e.evidence_key) FROM public.assess_application_source_evidence e WHERE e.metadata_version_id=meta.id AND row_item#>>'{}'=ANY(e.claim_ids)),'[]'::jsonb));
  END LOOP;
  IF (SELECT count(*) FROM public.assess_application_dimension_results WHERE assessment_version_id=ass.id)<>7 THEN RAISE EXCEPTION 'PR1G_INVALID_DIMENSIONS'; END IF;
  WITH decision AS (
   SELECT
    ARRAY(SELECT gate FROM public.assess_application_dimension_results d CROSS JOIN LATERAL unnest(d.hard_gates) WITH ORDINALITY values(gate,position) WHERE d.assessment_version_id=ass.id ORDER BY array_position(ARRAY['integration_accessibility','semantic_and_data_clarity','state_and_execution','security_and_control','architecture_changeability','ui_automation_readiness','ai_assisted_engineering_readiness'],d.dimension),position) AS gates,
    ARRAY(SELECT gap FROM public.assess_application_dimension_results d CROSS JOIN LATERAL unnest(d.missing_evidence) WITH ORDINALITY values(gap,position) WHERE d.assessment_version_id=ass.id ORDER BY array_position(ARRAY['integration_accessibility','semantic_and_data_clarity','state_and_execution','security_and_control','architecture_changeability','ui_automation_readiness','ai_assisted_engineering_readiness'],d.dimension),position) AS open_gaps,
    ARRAY(SELECT change FROM public.assess_application_dimension_results d CROSS JOIN LATERAL unnest(d.what_would_change) WITH ORDINALITY values(change,position) WHERE d.assessment_version_id=ass.id ORDER BY array_position(ARRAY['integration_accessibility','semantic_and_data_clarity','state_and_execution','security_and_control','architecture_changeability','ui_automation_readiness','ai_assisted_engineering_readiness'],d.dimension),position) AS changes,
    EXISTS(SELECT 1 FROM public.assess_application_dimension_results d WHERE d.assessment_version_id=ass.id AND d.evidence_confidence='Insufficient Evidence') AS insufficient,
    EXISTS(SELECT 1 FROM public.assess_application_dimension_results d WHERE d.assessment_version_id=ass.id AND d.evidence_confidence='Assumption-Led') AS assumption_led
  ), selected AS (
   SELECT decision.*,
    CASE WHEN cardinality(open_gaps)>0 THEN 'Insufficient evidence'
     WHEN meta.metadata->>'sourceCode'='available_legal_access' AND meta.metadata->>'lifecycleState'='unsupported' AND COALESCE((meta.metadata#>>'{aiControls,legalSourceRights}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,executableAcceptanceTests}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,reproducibleBuild}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,controlledSecurityReview}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,humanEngineeringOwner}')::boolean,false) AND COALESCE((meta.metadata#>>'{aiControls,controlledDeploymentRollback}')::boolean,false) THEN 'Rebuild through controlled AI-assisted delivery'
     WHEN (meta.metadata->'interfaces') ?| ARRAY['REST/GraphQL','SOAP','messaging/event'] THEN 'Enable native API/event integration'
     WHEN (meta.metadata->'interfaces') ?| ARRAY['file/batch','database'] THEN 'Add API façade and semantic translation'
     WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] AND cardinality(gates)=0 THEN 'Use governed workflow/RPA bridge'
     WHEN (meta.metadata->'interfaces') ?| ARRAY['UI-only','desktop/mainframe/Citrix'] THEN 'Blocked pending prerequisite'
     ELSE 'Retain and monitor' END AS disposition
   FROM decision
  )
  INSERT INTO public.assess_application_modernization_recommendations(org_id,workspace_id,application_id,metadata_version_id,assessment_version_id,disposition,affected_processes,affected_primitives,why,alternatives_considered,alternatives_rejected,prerequisites,required_controls,migration_boundary,dependency_impacts,rollback_strategy,evidence_confidence,open_evidence_gaps,what_would_change)
  SELECT p_org_id,p_workspace_id,ass.application_id,ass.metadata_version_id,ass.id,disposition,
   meta.metadata->'supportedProcesses','[]'::jsonb,
   CASE disposition
    WHEN 'Insufficient evidence' THEN ARRAY['Unknown information remains Unknown.']
    WHEN 'Rebuild through controlled AI-assisted delivery' THEN ARRAY['All AI-assisted engineering hard gates pass; human review is still required.']
    WHEN 'Enable native API/event integration' THEN ARRAY['Native interface exists; autonomous agent suitability still depends on process, app and Govern gates.']
    WHEN 'Add API façade and semantic translation' THEN ARRAY['Non-native or batch/data interface needs semantic and control boundary.']
    WHEN 'Use governed workflow/RPA bridge' THEN ARRAY['Positive governed bridge evidence passed all UI automation gates.']
    WHEN 'Blocked pending prerequisite' THEN ARRAY['UI-only application lacks positive bridge evidence; RPA/UI automation is not inferred.']
    ELSE ARRAY['No deterministic modernization trigger from age or EOL alone.'] END,
   ARRAY['native API/event','API façade','event bridge','workflow/RPA bridge','governed UI bridge','refactor','replace','rebuild','retire'],
   CASE WHEN cardinality(gates)>0 THEN gates ELSE ARRAY['No rejected alternative without evidence.'] END,
   CASE disposition
    WHEN 'Insufficient evidence' THEN open_gaps
    WHEN 'Rebuild through controlled AI-assisted delivery' THEN ARRAY['controlled security review','controlled deployment and rollback']
    WHEN 'Add API façade and semantic translation' THEN ARRAY['schema/data dictionary','approval controls']
    WHEN 'Use governed workflow/RPA bridge' THEN ARRAY['material action approvals','monitoring']
    WHEN 'Blocked pending prerequisite' THEN ARRAY['complete governed bridge evidence']
    ELSE ARRAY[]::text[] END,
   ARRAY['independent human review for material decisions','authorization version','privileged audit receipt'],
   'Application-scoped modernization; no autonomous code rewrite or deployment.',
   ARRAY(SELECT dependency FROM (SELECT value#>>'{}' dependency,1 collection,ordinality FROM jsonb_array_elements(meta.metadata->'upstreamDependencies') WITH ORDINALITY UNION ALL SELECT value#>>'{}',2,ordinality FROM jsonb_array_elements(meta.metadata->'downstreamDependencies') WITH ORDINALITY) dependencies ORDER BY collection,ordinality),
   'Disable new integration path and retain prior application/process behavior; immutable assessment history remains.',
   CASE WHEN cardinality(open_gaps)>0 OR insufficient THEN 'Insufficient Evidence' WHEN assumption_led THEN 'Assumption-Led' ELSE 'Partially Evidenced' END,
   open_gaps,changes
  FROM selected;
  FOR row_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'processLinks','[]'::jsonb)) LOOP
   IF row_item->>'approvedEconomics'='false' AND row_item ? 'economicsRef' AND row_item->>'economicsRef' IS NOT NULL THEN RAISE EXCEPTION 'PR1G_UNAPPROVED_ECONOMICS'; END IF;
   INSERT INTO public.assess_process_application_links(org_id,workspace_id,process_id,primitive_id,application_id,application_metadata_version_id,assessment_version_id,interaction_type,govern_state,economics_ref,economics_currency,created_by,receipt_id) VALUES(p_org_id,p_workspace_id,(row_item->>'processId')::uuid,row_item->>'primitiveId',(row_item->>'applicationId')::uuid,ass.metadata_version_id,ass.id,row_item->>'interactionType',row_item->>'governState',NULLIF(row_item->>'economicsRef','')::uuid,NULLIF(row_item->>'economicsCurrency',''),p_actor_id,r.id);
  END LOOP;
  FOR row_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_payload->'dependencies','[]'::jsonb)) LOOP
   IF (row_item->>'upstreamApplicationId')=(row_item->>'downstreamApplicationId') THEN RAISE EXCEPTION 'PR1G_DEPENDENCY_CYCLE'; END IF;
   INSERT INTO public.assess_application_dependencies(org_id,workspace_id,upstream_application_id,downstream_application_id,dependency_type,metadata_version_id,created_by,receipt_id) VALUES(p_org_id,p_workspace_id,(row_item->>'upstreamApplicationId')::uuid,(row_item->>'downstreamApplicationId')::uuid,COALESCE(row_item->>'dependencyType','runtime'),ass.metadata_version_id,p_actor_id,r.id);
  END LOOP;
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',ass.id,'applicationId',ass.application_id,'version',ass.version,'status',ass.lifecycle));
 ELSIF p_command_type='application.assessment.finalize' THEN
  SELECT a.* INTO ass FROM public.assess_application_assessment_versions a JOIN public.assess_application_metadata_versions m ON m.id=a.metadata_version_id WHERE a.id=(p_payload->>'assessmentVersionId')::uuid AND a.application_id=(p_payload->>'applicationId')::uuid AND a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.version=p_expected_version AND m.version=(p_payload->>'metadataVersion')::int AND a.lifecycle='draft' AND NOT EXISTS(SELECT 1 FROM public.assess_application_assessment_versions newer WHERE newer.application_id=a.application_id AND newer.org_id=a.org_id AND newer.workspace_id=a.workspace_id AND newer.version>a.version) FOR UPDATE OF a;
  IF ass.id IS NULL THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  source_assessment_id:=ass.id;
  INSERT INTO public.assess_application_assessment_versions(org_id,workspace_id,application_id,metadata_version_id,version,decision_model_version,lifecycle,author_id,authorization_version,receipt_id,audit_event_id)
  VALUES(p_org_id,p_workspace_id,ass.application_id,ass.metadata_version_id,ass.version+1,ass.decision_model_version,'reviewer_ready',ass.author_id,p_authorization_version,r.id,audit_id) RETURNING * INTO ass;
  PERFORM public.pr1g_copy_application_decisions(source_assessment_id,ass.id);
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',ass.id,'applicationId',ass.application_id,'version',ass.version,'status',ass.lifecycle));
 ELSIF p_command_type='application.assessment.review.resolve' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_workspace_id::text||':'||(p_payload->>'applicationId'),0));
  SELECT a.* INTO ass FROM public.assess_application_assessment_versions a JOIN public.assess_application_metadata_versions m ON m.id=a.metadata_version_id WHERE a.id=(p_payload->>'assessmentVersionId')::uuid AND a.application_id=(p_payload->>'applicationId')::uuid AND a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.version=p_expected_version AND m.version=(p_payload->>'metadataVersion')::int AND a.lifecycle='reviewer_ready' AND NOT EXISTS(SELECT 1 FROM public.assess_application_assessment_versions newer WHERE newer.application_id=a.application_id AND newer.org_id=a.org_id AND newer.workspace_id=a.workspace_id AND newer.version>a.version) FOR UPDATE OF a;
  IF ass.id IS NULL THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF; IF ass.author_id=p_actor_id THEN RAISE EXCEPTION 'PR1G_PERMISSION_DENIED'; END IF;
  source_assessment_id:=ass.id;
  INSERT INTO public.assess_application_review_resolutions(org_id,workspace_id,application_id,metadata_version_id,assessment_version_id,reviewer_id,authorization_version,resolution,rationale,conditions,receipt_id,audit_event_id) VALUES(p_org_id,p_workspace_id,ass.application_id,ass.metadata_version_id,ass.id,p_actor_id,p_authorization_version,p_payload->>'resolution',p_payload->>'rationale',ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'conditions','[]'::jsonb))),r.id,audit_id);
  INSERT INTO public.assess_application_assessment_versions(org_id,workspace_id,application_id,metadata_version_id,version,decision_model_version,lifecycle,author_id,reviewer_id,authorization_version,receipt_id,audit_event_id)
  VALUES(p_org_id,p_workspace_id,ass.application_id,ass.metadata_version_id,ass.version+1,ass.decision_model_version,p_payload->>'resolution',ass.author_id,p_actor_id,p_authorization_version,r.id,audit_id) RETURNING * INTO ass;
  PERFORM public.pr1g_copy_application_decisions(source_assessment_id,ass.id);
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',ass.id,'applicationId',ass.application_id,'version',ass.version,'status',ass.lifecycle));
 ELSIF p_command_type='application.assessment.revision.start' THEN
  SELECT a.* INTO ass FROM public.assess_application_assessment_versions a JOIN public.assess_application_metadata_versions m ON m.id=a.metadata_version_id WHERE a.id=(p_payload->>'assessmentVersionId')::uuid AND a.application_id=(p_payload->>'applicationId')::uuid AND a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.version=p_expected_version AND m.version=(p_payload->>'metadataVersion')::int AND a.lifecycle='changes_requested' AND NOT EXISTS(SELECT 1 FROM public.assess_application_assessment_versions newer WHERE newer.application_id=a.application_id AND newer.org_id=a.org_id AND newer.workspace_id=a.workspace_id AND newer.version>a.version) FOR UPDATE OF a;
  IF ass.id IS NULL THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  source_assessment_id:=ass.id;
  INSERT INTO public.assess_application_assessment_versions(org_id,workspace_id,application_id,metadata_version_id,version,decision_model_version,lifecycle,author_id,authorization_version,receipt_id,audit_event_id)
  VALUES(p_org_id,p_workspace_id,ass.application_id,ass.metadata_version_id,ass.version+1,ass.decision_model_version,'draft',p_actor_id,p_authorization_version,r.id,audit_id) RETURNING * INTO ass;
  PERFORM public.pr1g_copy_application_decisions(source_assessment_id,ass.id);
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',ass.id,'applicationId',ass.application_id,'version',ass.version,'status',ass.lifecycle));
 ELSIF p_command_type='application.portfolio.snapshot.create' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1 OR NOT p_payload ? 'portfolioSnapshotId' THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
  target_version:=(SELECT count(*)+1 FROM public.assess_application_portfolio_snapshots WHERE org_id=p_org_id AND workspace_id=p_workspace_id);
  IF p_expected_version<>target_version-1 THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  IF (SELECT count(DISTINCT economics_currency) FROM public.assess_process_application_links WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND economics_ref IS NOT NULL)>1 THEN RAISE EXCEPTION 'PR1G_INCOMPATIBLE_CURRENCIES'; END IF;
  IF EXISTS(WITH RECURSIVE walk(start_id,node_id,path,cycle) AS (
    SELECT upstream_application_id,downstream_application_id,ARRAY[upstream_application_id,downstream_application_id],false FROM public.assess_application_dependencies WHERE org_id=p_org_id AND workspace_id=p_workspace_id
    UNION ALL SELECT w.start_id,d.downstream_application_id,w.path||d.downstream_application_id,d.downstream_application_id=ANY(w.path)
    FROM walk w JOIN public.assess_application_dependencies d ON d.upstream_application_id=w.node_id AND d.org_id=p_org_id AND d.workspace_id=p_workspace_id WHERE NOT w.cycle)
    SELECT 1 FROM walk WHERE cycle LIMIT 1) THEN RAISE EXCEPTION 'PR1G_DEPENDENCY_CYCLE'; END IF;
  INSERT INTO public.assess_application_portfolio_snapshots(id,org_id,workspace_id,snapshot,created_by,receipt_id,audit_event_id)
  VALUES((p_payload->>'portfolioSnapshotId')::uuid,p_org_id,p_workspace_id,
   jsonb_build_object('version',target_version,'modelVersion','assess-v2-application-portfolio-2026-07','approvedAutomatically',false,
    'inventoryCount',(SELECT count(*) FROM public.assess_application_assets WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL),
    'waves',COALESCE((WITH RECURSIVE ranks(application_id,wave) AS (
      SELECT a.id,1 FROM public.assess_application_assets a WHERE a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM public.assess_application_dependencies d WHERE d.org_id=p_org_id AND d.workspace_id=p_workspace_id AND d.downstream_application_id=a.id)
      UNION SELECT d.downstream_application_id,rank_row.wave+1 FROM ranks rank_row JOIN public.assess_application_dependencies d ON d.upstream_application_id=rank_row.application_id AND d.org_id=p_org_id AND d.workspace_id=p_workspace_id)
      SELECT jsonb_agg(jsonb_build_object('applicationId',a.id,'wave',COALESCE((SELECT max(wave) FROM ranks WHERE application_id=a.id),1),'approvedAutomatically',false,
       'qualified',CASE WHEN av.id IS NULL
        OR (SELECT count(*) FROM public.assess_application_dimension_results x WHERE x.assessment_version_id=av.id)<>7
        OR (SELECT count(DISTINCT dimension) FROM public.assess_application_dimension_results x WHERE x.assessment_version_id=av.id)<>7
        OR NOT EXISTS(SELECT 1 FROM public.assess_application_modernization_recommendations q WHERE q.assessment_version_id=av.id)
        OR EXISTS(SELECT 1 FROM public.assess_application_dimension_results x WHERE x.assessment_version_id=av.id AND (cardinality(x.hard_gates)>0 OR x.evidence_confidence='Insufficient Evidence')) THEN false ELSE true END)
       ORDER BY COALESCE((SELECT max(wave) FROM ranks WHERE application_id=a.id),1),a.id)
      FROM public.assess_application_assets a LEFT JOIN LATERAL(SELECT x.id FROM public.assess_application_assessment_versions x WHERE x.application_id=a.id AND x.org_id=p_org_id AND x.workspace_id=p_workspace_id ORDER BY x.version DESC LIMIT 1) av ON true
      WHERE a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.deleted_at IS NULL),'[]'::jsonb)),p_actor_id,r.id,audit_id);
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object('id',(p_payload->>'portfolioSnapshotId')::uuid,'version',target_version,'status','committed'));
 END IF;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata) VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command_type,'assess_application',COALESCE((result->'resource'->>'id')::uuid,p_request_id),'succeeded',COALESCE((result->'resource'->>'version')::bigint,1),jsonb_build_object('receiptId',r.id));
 UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF r.id IS NOT NULL THEN UPDATE public.assess_command_receipts SET status='failed',response=public.pr1g_error_envelope(SQLERRM),completed_at=now() WHERE id=r.id; END IF;
 RAISE;
END $$;
CREATE OR REPLACE FUNCTION public.pr1g_read_application_portfolio_projection(p_org_id uuid,p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT public.has_workspace_capability(p_workspace_id,p_org_id,'assess.applications.read') THEN RAISE EXCEPTION 'PR1G_NOT_FOUND'; END IF;
 RETURN jsonb_build_object(
  'inventory',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'orgId',a.org_id,'workspaceId',a.workspace_id,'version',1,'metadataVersion',COALESCE(m.version,0),'metadata',COALESCE(m.metadata,jsonb_build_object('name',a.name,'description',a.description,'businessCapabilities','[]'::jsonb,'supportedProcesses','[]'::jsonb,'businessCriticality','Unknown','lifecycleState','Unknown','sourceCode','Unknown','documentationQuality','Unknown','automatedTestMaturity','Unknown','deploymentRepeatability','Unknown','observability','Unknown','dataClassifications','[]'::jsonb,'regulatedData','Unknown','operatingRegions','[]'::jsonb,'interfaces','[]'::jsonb,'upstreamDependencies','[]'::jsonb,'downstreamDependencies','[]'::jsonb,'realTime','Unknown','eventDriven','Unknown','synchronous','Unknown','batch','Unknown','synthetic',false)),'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.evidence_key,'claimIds',e.claim_ids,'sourceType',e.source_type,'fresh',e.fresh,'independent',e.independent,'accepted',e.accepted,'contradicts',e.contradicts,'synthetic',e.synthetic) ORDER BY e.evidence_key) FROM public.assess_application_source_evidence e WHERE e.metadata_version_id=m.id),'[]'::jsonb),'authorId',COALESCE(m.author_id,a.created_by),'status',COALESCE(m.lifecycle,'draft')) ORDER BY a.name)
   FROM public.assess_application_assets a LEFT JOIN LATERAL(SELECT x.* FROM public.assess_application_metadata_versions x WHERE x.application_id=a.id AND x.org_id=a.org_id AND x.workspace_id=a.workspace_id ORDER BY x.version DESC LIMIT 1)m ON true WHERE a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.deleted_at IS NULL),'[]'::jsonb),
  'metadataVersions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',m.id,'orgId',m.org_id,'workspaceId',m.workspace_id,'applicationId',m.application_id,'version',m.version,'status',m.lifecycle,'metadata',m.metadata,'authorId',m.author_id) ORDER BY m.created_at) FROM public.assess_application_metadata_versions m WHERE m.org_id=p_org_id AND m.workspace_id=p_workspace_id),'[]'::jsonb),
  'importReceipts',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'orgId',x.org_id,'workspaceId',x.workspace_id,'actorId',x.actor_id,'successCount',x.success_count,'rejectionCount',x.rejection_count) ORDER BY x.created_at) FROM public.assess_application_import_receipts x WHERE x.org_id=p_org_id AND x.workspace_id=p_workspace_id),'[]'::jsonb),
  'rowOutcomes',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'orgId',x.org_id,'workspaceId',x.workspace_id,'importReceiptId',x.import_receipt_id,'rowNumber',x.row_number,'outcome',x.outcome,'applicationId',x.application_id,'errorCode',x.error_code,'errorMessage',x.error_message) ORDER BY x.import_receipt_id,x.row_number) FROM public.assess_application_import_row_outcomes x WHERE x.org_id=p_org_id AND x.workspace_id=p_workspace_id),'[]'::jsonb),
  'processLinks',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'orgId',l.org_id,'workspaceId',l.workspace_id,'processId',l.process_id,'primitiveId',l.primitive_id,'applicationId',l.application_id,'metadataVersionId',l.application_metadata_version_id,'assessmentVersionId',l.assessment_version_id,'interactionType',l.interaction_type,'governState',l.govern_state,'economicsRef',l.economics_ref,'economicsCurrency',l.economics_currency) ORDER BY l.created_at) FROM public.assess_process_application_links l WHERE l.org_id=p_org_id AND l.workspace_id=p_workspace_id),'[]'::jsonb),
  'dependencies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'orgId',d.org_id,'workspaceId',d.workspace_id,'upstreamApplicationId',d.upstream_application_id,'downstreamApplicationId',d.downstream_application_id,'dependencyType',d.dependency_type,'metadataVersionId',d.metadata_version_id) ORDER BY d.created_at) FROM public.assess_application_dependencies d WHERE d.org_id=p_org_id AND d.workspace_id=p_workspace_id),'[]'::jsonb),
  'assessments',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'applicationId',a.application_id,'orgId',a.org_id,'workspaceId',a.workspace_id,'metadataVersionId',a.metadata_version_id,'metadataVersion',m.version,'version',a.version,'status',a.lifecycle,'authorId',a.author_id,'reviewerId',a.reviewer_id,'authorizationVersion',a.authorization_version,'receiptId',a.receipt_id,'auditEventId',a.audit_event_id,'decisionModelVersion',a.decision_model_version,'dimensions',COALESCE((SELECT jsonb_agg(jsonb_build_object('dimension',d.dimension,'band',d.readiness_band,'confidence',d.evidence_confidence,'hardGates',d.hard_gates,'evidenceReferences',d.evidence_refs,'missingEvidence',d.missing_evidence,'rationale',d.rationale,'contradictions',d.contradictions,'remediationRequirements',d.remediation_requirements,'whatWouldChange',d.what_would_change) ORDER BY d.dimension) FROM public.assess_application_dimension_results d WHERE d.assessment_version_id=a.id),'[]'::jsonb),'recommendations',COALESCE((SELECT jsonb_agg(jsonb_build_object('disposition',q.disposition,'applicationId',q.application_id,'metadataVersion',m.version,'affectedProcesses',q.affected_processes,'affectedPrimitives',q.affected_primitives,'why',q.why,'alternativesConsidered',q.alternatives_considered,'alternativesRejected',q.alternatives_rejected,'prerequisites',q.prerequisites,'requiredControls',q.required_controls,'migrationBoundary',q.migration_boundary,'dependencyImpacts',q.dependency_impacts,'rollback',q.rollback_strategy,'confidence',q.evidence_confidence,'openEvidenceGaps',q.open_evidence_gaps,'whatWouldChange',q.what_would_change)) FROM public.assess_application_modernization_recommendations q WHERE q.assessment_version_id=a.id),'[]'::jsonb)) ORDER BY a.created_at) FROM public.assess_application_assessment_versions a JOIN public.assess_application_metadata_versions m ON m.id=a.metadata_version_id WHERE a.org_id=p_org_id AND a.workspace_id=p_workspace_id),'[]'::jsonb),
  'dimensions',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'orgId',x.org_id,'workspaceId',x.workspace_id,'applicationId',x.application_id,'metadataVersionId',x.metadata_version_id,'assessmentVersionId',x.assessment_version_id,'dimension',x.dimension,'band',x.readiness_band,'confidence',x.evidence_confidence,'hardGates',x.hard_gates,'evidenceReferences',x.evidence_refs,'missingEvidence',x.missing_evidence,'rationale',x.rationale,'contradictions',x.contradictions,'remediationRequirements',x.remediation_requirements,'whatWouldChange',x.what_would_change)) FROM public.assess_application_dimension_results x WHERE x.org_id=p_org_id AND x.workspace_id=p_workspace_id),'[]'::jsonb),
  'recommendations',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'orgId',x.org_id,'workspaceId',x.workspace_id,'applicationId',x.application_id,'metadataVersionId',x.metadata_version_id,'metadataVersion',m.version,'assessmentVersionId',x.assessment_version_id,'disposition',x.disposition,'affectedProcesses',x.affected_processes,'affectedPrimitives',x.affected_primitives,'why',x.why,'alternativesConsidered',x.alternatives_considered,'alternativesRejected',x.alternatives_rejected,'prerequisites',x.prerequisites,'requiredControls',x.required_controls,'migrationBoundary',x.migration_boundary,'dependencyImpacts',x.dependency_impacts,'rollback',x.rollback_strategy,'confidence',x.evidence_confidence,'openEvidenceGaps',x.open_evidence_gaps,'whatWouldChange',x.what_would_change)) FROM public.assess_application_modernization_recommendations x JOIN public.assess_application_metadata_versions m ON m.id=x.metadata_version_id WHERE x.org_id=p_org_id AND x.workspace_id=p_workspace_id),'[]'::jsonb),
  'reviews',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x.id,'orgId',x.org_id,'workspaceId',x.workspace_id,'applicationId',x.application_id,'metadataVersionId',x.metadata_version_id,'assessmentVersionId',x.assessment_version_id,'reviewerId',x.reviewer_id,'authorizationVersion',x.authorization_version,'resolution',x.resolution,'rationale',x.rationale,'conditions',x.conditions,'receiptId',x.receipt_id,'auditEventId',x.audit_event_id)) FROM public.assess_application_review_resolutions x WHERE x.org_id=p_org_id AND x.workspace_id=p_workspace_id),'[]'::jsonb),
  'portfolioSnapshot',(SELECT s.snapshot||jsonb_build_object('id',s.id,'orgId',s.org_id,'workspaceId',s.workspace_id) FROM public.assess_application_portfolio_snapshots s WHERE s.org_id=p_org_id AND s.workspace_id=p_workspace_id ORDER BY created_at DESC LIMIT 1),
  'waves',COALESCE((SELECT snapshot->'waves' FROM public.assess_application_portfolio_snapshots s WHERE s.org_id=p_org_id AND s.workspace_id=p_workspace_id ORDER BY created_at DESC LIMIT 1),'[]'::jsonb),
  'economicsReferences',COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('referenceId',economics_ref,'orgId',org_id,'workspaceId',workspace_id,'currency',economics_currency)) FROM public.assess_process_application_links WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND economics_ref IS NOT NULL),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.pr1g_execute_application_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.pr1g_execute_application_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pr1g_read_application_portfolio_projection(uuid,uuid) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.pr1g_read_application_portfolio_projection(uuid,uuid) TO authenticated,service_role;
