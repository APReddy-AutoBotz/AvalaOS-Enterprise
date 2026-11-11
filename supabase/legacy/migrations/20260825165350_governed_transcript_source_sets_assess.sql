-- PR A: governed multi-source transcript authority for Assess.
-- Default-off, additive and forward-only. Existing single-source ingestion and
-- Assess promotion history remain canonical and unchanged.

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('transcript.sources.read','assess','Read governed workspace transcript source-set projections'),
 ('transcript.sources.manage','assess','Create and lock governed transcript source sets and input bundles'),
 ('transcript.assess.apply','assess','Preview and atomically apply reviewed transcript evidence to Assess drafts'),
 ('transcript.journeys.manage','assess','Create, stop, and resume governed Assess journeys')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

CREATE TABLE public.enterprise_transcript_workspace_flags(
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 transcript_source_sets_enabled boolean NOT NULL DEFAULT false,
 assess_multisource_apply_enabled boolean NOT NULL DEFAULT false,
 unified_byok_gateway_enabled boolean NOT NULL DEFAULT false,
 governed_journeys_enabled boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 updated_by uuid REFERENCES public.profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.enterprise_source_sets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 owner_module text NOT NULL CHECK(owner_module IN('assess','studio')),
 display_label text NOT NULL CHECK(length(btrim(display_label)) BETWEEN 1 AND 160),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 current_version bigint NOT NULL DEFAULT 0 CHECK(current_version>=0),
 lifecycle_version bigint NOT NULL DEFAULT 1 CHECK(lifecycle_version>0),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','locked','superseded','archived')),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.enterprise_source_set_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 source_set_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 purpose text NOT NULL CHECK(length(btrim(purpose)) BETWEEN 1 AND 1000),
 manifest_hash text NOT NULL CHECK(manifest_hash~'^[0-9a-f]{64}$'),
 parser_contract_version text NOT NULL DEFAULT 'transcript-source-set-1' CHECK(parser_contract_version='transcript-source-set-1'),
 source_count integer NOT NULL CHECK(source_count BETWEEN 1 AND 20),
 extracted_character_count bigint NOT NULL CHECK(extracted_character_count BETWEEN 0 AND 2000000),
 status text NOT NULL CHECK(status IN('draft','locked','superseded')),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,source_set_id,org_id,workspace_id),
 UNIQUE(source_set_id,version),
 FOREIGN KEY(source_set_id,org_id,workspace_id) REFERENCES public.enterprise_source_sets(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_source_set_version_items(
 source_set_version_id uuid NOT NULL,
 source_set_id uuid NOT NULL,
 source_version_id uuid NOT NULL,
 source_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 semantic_role text NOT NULL CHECK(semantic_role IN('primary','supporting','contradictory','reference')),
 user_note text CHECK(user_note IS NULL OR length(user_note)<=1000),
 content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
 extracted_text_hash text NOT NULL CHECK(extracted_text_hash~'^[0-9a-f]{64}$'),
 extracted_character_count integer NOT NULL CHECK(extracted_character_count BETWEEN 0 AND 500000),
 PRIMARY KEY(source_set_version_id,source_version_id),
 UNIQUE(source_set_version_id,ordinal),
 FOREIGN KEY(source_set_version_id,source_set_id,org_id,workspace_id) REFERENCES public.enterprise_source_set_versions(id,source_set_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_module_input_bundles(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 owner_module text NOT NULL CHECK(owner_module IN('assess','studio')),
 current_version bigint NOT NULL DEFAULT 0 CHECK(current_version>=0),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.enterprise_module_input_bundle_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 input_bundle_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),
 manual_brief_hash text CHECK(manual_brief_hash IS NULL OR manual_brief_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('draft','locked','superseded')),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,input_bundle_id,org_id,workspace_id),
 UNIQUE(input_bundle_id,version),
 FOREIGN KEY(input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundles(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_module_input_bundle_items(
 input_bundle_version_id uuid NOT NULL,
 input_bundle_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 item_kind text NOT NULL CHECK(item_kind='source_set'),
 source_set_version_id uuid NOT NULL,
 source_set_id uuid NOT NULL,
 resource_hash text NOT NULL CHECK(resource_hash~'^[0-9a-f]{64}$'),
 declared_purpose text NOT NULL CHECK(length(btrim(declared_purpose)) BETWEEN 1 AND 500),
 PRIMARY KEY(input_bundle_version_id,ordinal),
 UNIQUE(input_bundle_version_id,source_set_version_id),
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_set_version_id,source_set_id,org_id,workspace_id) REFERENCES public.enterprise_source_set_versions(id,source_set_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_governed_journeys(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 entry_module text NOT NULL CHECK(entry_module='assess'),
 desired_exit_module text NOT NULL CHECK(desired_exit_module IN('assess','studio','delivery','monitor')),
 current_module text NOT NULL CHECK(current_module='assess'),
 lineage_classification text NOT NULL CHECK(lineage_classification IN('assessed','not_assessed','mixed')),
 planning_only boolean NOT NULL,
 route_policy_version bigint NOT NULL CHECK(route_policy_version>0),
 status text NOT NULL CHECK(status IN('active','stopped','completed','blocked','archived')),
 version bigint NOT NULL CHECK(version>0),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.enterprise_governed_journey_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),journey_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN('active','stopped','completed','blocked','archived')),
 desired_exit_module text NOT NULL CHECK(desired_exit_module IN('assess','studio','delivery','monitor')),
 reason text CHECK(reason IS NULL OR length(reason)<=2000),created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,journey_id,org_id,workspace_id),UNIQUE(journey_id,version),
 FOREIGN KEY(journey_id,org_id,workspace_id) REFERENCES public.enterprise_governed_journeys(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_apply_previews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 assess_case_id uuid NOT NULL,expected_case_version bigint NOT NULL CHECK(expected_case_version>0),
 input_bundle_version_id uuid NOT NULL,input_bundle_id uuid NOT NULL,bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),
 candidate_id uuid NOT NULL,source_id uuid NOT NULL,source_version_id uuid NOT NULL,
 candidate_version bigint NOT NULL CHECK(candidate_version>0),candidate_provenance_hash text NOT NULL CHECK(candidate_provenance_hash~'^[0-9a-f]{64}$'),
 application_intent text NOT NULL CHECK(application_intent IN('set_case_field','create_primitive','create_application_asset','create_interaction','create_decision_point','create_exception_path','set_registered_fact','link_evidence_only')),
 target_key text NOT NULL CHECK(length(btrim(target_key)) BETWEEN 1 AND 120),target_id uuid,
 proposed_value jsonb NOT NULL,planned_evidence_link_id uuid NOT NULL DEFAULT gen_random_uuid(),binding_hash text NOT NULL CHECK(binding_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,binding_hash),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(candidate_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_candidates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_apply_preview_batches(
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 assess_case_id uuid NOT NULL,expected_case_version bigint NOT NULL CHECK(expected_case_version>0),
 input_bundle_version_id uuid NOT NULL,input_bundle_id uuid NOT NULL,bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),
 preview_ids uuid[] NOT NULL CHECK(cardinality(preview_ids) BETWEEN 1 AND 100),created_by uuid NOT NULL REFERENCES public.profiles(id),
 receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(receipt_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_candidate_applications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 preview_id uuid NOT NULL,assess_case_id uuid NOT NULL,assess_case_version_id uuid NOT NULL,assess_case_version bigint NOT NULL CHECK(assess_case_version>0),
 input_bundle_version_id uuid NOT NULL,input_bundle_id uuid NOT NULL,bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),
 candidate_id uuid NOT NULL,source_id uuid NOT NULL,source_version_id uuid NOT NULL,candidate_version bigint NOT NULL CHECK(candidate_version>0),
 candidate_provenance_hash text NOT NULL CHECK(candidate_provenance_hash~'^[0-9a-f]{64}$'),application_intent text NOT NULL,
 target_key text NOT NULL,target_id uuid,application_outcome text NOT NULL CHECK(application_outcome IN('applied','evidence_only','not_applied')),
 applied_by uuid NOT NULL REFERENCES public.profiles(id),receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 batch_ordinal integer NOT NULL CHECK(batch_ordinal BETWEEN 1 AND 100),applied_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(preview_id),UNIQUE(receipt_id,batch_ordinal),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(preview_id,org_id,workspace_id) REFERENCES public.enterprise_assess_apply_previews(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(assess_case_version_id,assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(candidate_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_candidates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_evidence_candidate_relationship_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 candidate_id uuid NOT NULL,source_id uuid NOT NULL,source_version_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,input_bundle_id uuid NOT NULL,
 candidate_version bigint NOT NULL CHECK(candidate_version>0),relationship text NOT NULL CHECK(relationship IN('neutral','supporting','contradictory')),
 suggested_application_intent text CHECK(suggested_application_intent IS NULL OR suggested_application_intent IN('set_case_field','create_primitive','create_application_asset','create_interaction','create_decision_point','create_exception_path','set_registered_fact','link_evidence_only')),
 suggested_apply_target text CHECK(suggested_apply_target IS NULL OR length(btrim(suggested_apply_target)) BETWEEN 1 AND 160),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),reviewer_id uuid NOT NULL REFERENCES public.profiles(id),
 authorization_version bigint NOT NULL CHECK(authorization_version>0),receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),UNIQUE(receipt_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(candidate_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_candidates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_evidence_conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 assess_case_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,input_bundle_id uuid NOT NULL,
 application_intent text NOT NULL CHECK(application_intent IN('set_case_field','create_primitive','create_application_asset','create_interaction','create_decision_point','create_exception_path','set_registered_fact','link_evidence_only')),
 target_key text NOT NULL CHECK(length(btrim(target_key)) BETWEEN 1 AND 120),target_id uuid,candidate_ids uuid[] NOT NULL CHECK(cardinality(candidate_ids) BETWEEN 1 AND 100),
 candidate_binding_hash text NOT NULL CHECK(candidate_binding_hash~'^[0-9a-f]{64}$'),manual_value_hash text CHECK(manual_value_hash IS NULL OR manual_value_hash~'^[0-9a-f]{64}$'),
 manual_case_version bigint CHECK(manual_case_version IS NULL OR manual_case_version>0),is_material boolean NOT NULL DEFAULT true,current_resolution_version bigint NOT NULL DEFAULT 0 CHECK(current_resolution_version>=0),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,assess_case_id,candidate_binding_hash),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_evidence_conflict_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conflict_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),resolution text NOT NULL CHECK(resolution IN('choose_candidate','retain_manual','authored_resolution','unresolved')),
 chosen_candidate_id uuid,authored_value jsonb,rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),
 resolver_id uuid NOT NULL REFERENCES public.profiles(id),authorization_version bigint NOT NULL CHECK(authorization_version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,conflict_id,org_id,workspace_id),UNIQUE(conflict_id,version),
 FOREIGN KEY(conflict_id,org_id,workspace_id) REFERENCES public.enterprise_assess_evidence_conflicts(id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((resolution='choose_candidate')=(chosen_candidate_id IS NOT NULL)),
 CHECK((resolution='authored_resolution')=(authored_value IS NOT NULL))
);

CREATE TABLE public.enterprise_transcript_extraction_bindings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 job_id uuid NOT NULL,receipt_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,input_bundle_id uuid NOT NULL,bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),
 source_id uuid NOT NULL,source_version_id uuid NOT NULL,provider_route_id uuid NOT NULL,provider_config_id uuid NOT NULL,model text NOT NULL CHECK(length(btrim(model)) BETWEEN 1 AND 200),
 authorization_version bigint NOT NULL CHECK(authorization_version>0),created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(job_id),UNIQUE(receipt_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(job_id,org_id) REFERENCES public.enterprise_ai_job_ledger(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(receipt_id) REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enterprise_transcript_reject_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_IMMUTABLE';END$$;

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY[
 'enterprise_source_set_versions','enterprise_source_set_version_items','enterprise_module_input_bundle_versions','enterprise_module_input_bundle_items',
 'enterprise_governed_journey_versions','enterprise_assess_apply_previews','enterprise_assess_apply_preview_batches','enterprise_assess_candidate_applications',
 'enterprise_evidence_candidate_relationship_reviews','enterprise_assess_evidence_conflict_resolutions','enterprise_transcript_extraction_bindings'
] LOOP EXECUTE format('CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enterprise_transcript_reject_immutable()',t,t);END LOOP;END$$;

CREATE OR REPLACE FUNCTION public.enterprise_command_runtime_area(p_command_type text,p_resource_type text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$BEGIN
 IF p_resource_type IS NOT NULL AND p_command_type NOT IN('approval.review.record','approval.record') THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';END IF;
 CASE p_command_type
  WHEN 'provider.register','provider.secret.bind','provider.validate','provider.activate','provider.route.toggle','provider.secret.rotate','provider.revoke' THEN RETURN 'provider';
  WHEN 'evidence.source.create','evidence.extract','evidence.candidate.review','evidence.assess.promote',
       'transcript.source-set.create-version','transcript.input-bundle.lock','transcript.assess.extract','transcript.assess.candidate.review',
       'transcript.assess.apply.preview','transcript.assess.apply.commit','transcript.assess.conflict.resolve','transcript.journey.set-state' THEN RETURN 'ingestion';
  WHEN 'modernization.evaluate','studio.delivery.handoff','monitor.baseline.create' THEN RETURN 'delivery';
  WHEN 'assemble.blueprint.create' THEN RETURN 'assemble';
  WHEN 'approval.review.record','approval.record' THEN
   IF p_resource_type='assemble_blueprint' THEN RETURN 'assemble';END IF;
   IF p_resource_type IN('modernization_decision','delivery_work_package','monitor_baseline','evidence_candidate') THEN RETURN 'delivery';END IF;
   RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
  ELSE RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
 END CASE;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_assert_receipt(
 p_receipt uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_command text,p_capability text,p_authorization_version bigint,
 p_execution_token uuid,p_execution_fence bigint,p_flag text
) RETURNS public.enterprise_ai_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;f public.enterprise_transcript_workspace_flags;enabled boolean;
BEGIN
 SELECT * INTO r FROM public.enterprise_ai_command_receipts WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF r.id IS NULL OR r.status<>'claimed' OR r.actor_id IS DISTINCT FROM p_actor OR r.command_type IS DISTINCT FROM p_command
    OR r.execution_token IS DISTINCT FROM p_execution_token OR r.execution_fence IS DISTINCT FROM p_execution_fence THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
 END IF;
 PERFORM public.enterprise_assert_writable('ingestion');
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,p_capability,p_authorization_version);
 SELECT * INTO f FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 enabled:=CASE p_flag WHEN 'source_sets' THEN f.transcript_source_sets_enabled WHEN 'assess_apply' THEN f.assess_multisource_apply_enabled
  WHEN 'journeys' THEN f.governed_journeys_enabled WHEN 'unified_byok' THEN f.unified_byok_gateway_enabled ELSE false END;
 IF f.org_id IS NULL OR NOT COALESCE(enabled,false) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_FEATURE_DISABLED';END IF;
 RETURN r;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_source_set_version(
 p_source_set uuid,p_owner_module text,p_display_label text,p_description text,p_purpose text,p_items jsonb,p_lock boolean,p_expected_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;s public.enterprise_source_sets;v public.enterprise_source_set_versions;item jsonb;sv public.enterprise_evidence_source_versions;
 source public.enterprise_evidence_sources;actual_count int;total_chars bigint:=0;manifest jsonb:='[]'::jsonb;manifest_hash text;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.source-set.create-version','transcript.sources.manage',p_authorization_version,p_execution_token,p_execution_fence,'source_sets');
 IF p_owner_module NOT IN('assess','studio') OR length(btrim(COALESCE(p_display_label,''))) NOT BETWEEN 1 AND 160
    OR length(COALESCE(p_description,''))>2000 OR length(btrim(COALESCE(p_purpose,''))) NOT BETWEEN 1 AND 1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 OR p_expected_version<0 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_SOURCE_SET';END IF;
 SELECT * INTO s FROM public.enterprise_source_sets WHERE id=p_source_set FOR UPDATE;
 IF s.id IS NULL THEN
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';END IF;
  INSERT INTO public.enterprise_source_sets(id,org_id,workspace_id,owner_module,display_label,description,created_by)
  VALUES(p_source_set,p_org,p_workspace,p_owner_module,btrim(p_display_label),COALESCE(p_description,''),p_actor) RETURNING * INTO s;
 ELSE
  IF s.org_id IS DISTINCT FROM p_org OR s.workspace_id IS DISTINCT FROM p_workspace OR s.owner_module IS DISTINCT FROM p_owner_module
     OR s.status='archived' OR s.current_version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';END IF;
 END IF;
 SELECT count(*)::int INTO actual_count FROM (SELECT DISTINCT value->>'sourceVersionId' id FROM jsonb_array_elements(p_items))x;
 IF actual_count<>jsonb_array_length(p_items) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE jsonb_typeof(x.value)<>'object'
  OR NOT(x.value ?& ARRAY['sourceVersionId','ordinal','role']) OR (x.value-ARRAY['sourceVersionId','ordinal','role','note'])<>'{}'::jsonb
  OR COALESCE(x.value->>'sourceVersionId','')!~*'^[0-9a-f-]{36}$' OR COALESCE(x.value->>'ordinal','')!~'^[1-9][0-9]*$'
  OR (x.value->>'ordinal')::int NOT BETWEEN 1 AND jsonb_array_length(p_items) OR x.value->>'role' NOT IN('primary','supporting','contradictory','reference')
  OR length(COALESCE(x.value->>'note',''))>1000) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_SOURCE_SET';END IF;
 IF (SELECT count(DISTINCT (value->>'ordinal')::int) FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_SOURCE_SET';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'ordinal')::int LOOP
  SELECT * INTO sv FROM public.enterprise_evidence_source_versions WHERE id=(item->>'sourceVersionId')::uuid FOR SHARE;
  SELECT * INTO source FROM public.enterprise_evidence_sources WHERE id=sv.source_id FOR SHARE;
  IF sv.id IS NULL OR sv.org_id IS DISTINCT FROM p_org OR sv.workspace_id IS DISTINCT FROM p_workspace OR sv.extraction_status<>'parsed'
     OR sv.extracted_text_hash IS NULL OR sv.extracted_character_count IS NULL OR sv.extracted_character_count NOT BETWEEN 0 AND 500000
     OR source.id IS NULL OR source.org_id IS DISTINCT FROM p_org OR source.workspace_id IS DISTINCT FROM p_workspace OR source.deleted_at IS NOT NULL THEN
   RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_VERSION_NOT_READY';
  END IF;
  total_chars:=total_chars+sv.extracted_character_count;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('ordinal',(item->>'ordinal')::int,'sourceVersionId',sv.id,'sourceId',sv.source_id,
   'contentHash',sv.content_hash,'extractedTextHash',sv.extracted_text_hash,'role',item->>'role','contractVersion','transcript-source-set-1'));
 END LOOP;
 IF total_chars>2000000 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_LIMIT_EXCEEDED';END IF;
 manifest_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','transcript-source-set-1','orderedItems',manifest));
 INSERT INTO public.enterprise_source_set_versions(source_set_id,org_id,workspace_id,version,purpose,manifest_hash,source_count,extracted_character_count,status,created_by)
 VALUES(s.id,p_org,p_workspace,p_expected_version+1,btrim(p_purpose),manifest_hash,jsonb_array_length(p_items),total_chars,CASE WHEN p_lock THEN 'locked' ELSE 'draft' END,p_actor) RETURNING * INTO v;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'ordinal')::int LOOP
  SELECT * INTO sv FROM public.enterprise_evidence_source_versions WHERE id=(item->>'sourceVersionId')::uuid;
  INSERT INTO public.enterprise_source_set_version_items(source_set_version_id,source_set_id,source_version_id,source_id,org_id,workspace_id,ordinal,semantic_role,user_note,content_hash,extracted_text_hash,extracted_character_count)
  VALUES(v.id,s.id,sv.id,sv.source_id,p_org,p_workspace,(item->>'ordinal')::int,item->>'role',NULLIF(item->>'note',''),sv.content_hash,sv.extracted_text_hash,sv.extracted_character_count);
 END LOOP;
 UPDATE public.enterprise_source_sets SET current_version=v.version,status=v.status,lifecycle_version=lifecycle_version+1,display_label=btrim(p_display_label),description=COALESCE(p_description,''),updated_at=statement_timestamp() WHERE id=s.id;
 result:=jsonb_build_object('resourceId',s.id,'sourceSetId',s.id,'sourceSetVersionId',v.id,'version',v.version,'status',v.status,'sourceCount',v.source_count,'extractedCharacterCount',v.extracted_character_count);
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.source-set.create-version','command',s.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_lock_input_bundle(
 p_input_bundle uuid,p_items jsonb,p_manual_brief_hash text,p_expected_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;b public.enterprise_module_input_bundles;v public.enterprise_module_input_bundle_versions;item jsonb;
 set_version public.enterprise_source_set_versions;source_set public.enterprise_source_sets;manifest jsonb:='[]'::jsonb;bundle_hash text;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.input-bundle.lock','transcript.sources.manage',p_authorization_version,p_execution_token,p_execution_fence,'source_sets');
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 OR p_expected_version<0
    OR (p_manual_brief_hash IS NOT NULL AND p_manual_brief_hash!~'^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_BUNDLE';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items)x WHERE jsonb_typeof(x.value)<>'object' OR NOT(x.value ?& ARRAY['sourceSetVersionId','ordinal','purpose'])
    OR (x.value-ARRAY['sourceSetVersionId','ordinal','purpose'])<>'{}'::jsonb OR COALESCE(x.value->>'sourceSetVersionId','')!~*'^[0-9a-f-]{36}$'
    OR COALESCE(x.value->>'ordinal','')!~'^[1-9][0-9]*$' OR (x.value->>'ordinal')::int NOT BETWEEN 1 AND jsonb_array_length(p_items)
    OR length(btrim(COALESCE(x.value->>'purpose',''))) NOT BETWEEN 1 AND 500)
    OR (SELECT count(DISTINCT value->>'sourceSetVersionId') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
    OR (SELECT count(DISTINCT (value->>'ordinal')::int) FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_BUNDLE';END IF;
 SELECT * INTO b FROM public.enterprise_module_input_bundles WHERE id=p_input_bundle FOR UPDATE;
 IF b.id IS NULL THEN
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE';END IF;
  INSERT INTO public.enterprise_module_input_bundles(id,org_id,workspace_id,owner_module,created_by) VALUES(p_input_bundle,p_org,p_workspace,'assess',p_actor) RETURNING * INTO b;
 ELSIF b.org_id IS DISTINCT FROM p_org OR b.workspace_id IS DISTINCT FROM p_workspace OR b.owner_module<>'assess' OR b.current_version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'ordinal')::int LOOP
  SELECT * INTO set_version FROM public.enterprise_source_set_versions WHERE id=(item->>'sourceSetVersionId')::uuid FOR SHARE;
  SELECT * INTO source_set FROM public.enterprise_source_sets WHERE id=set_version.source_set_id FOR SHARE;
  IF set_version.id IS NULL OR set_version.org_id IS DISTINCT FROM p_org OR set_version.workspace_id IS DISTINCT FROM p_workspace OR set_version.status<>'locked'
     OR source_set.id IS NULL OR source_set.owner_module<>'assess' OR source_set.status='archived' OR source_set.current_version IS DISTINCT FROM set_version.version THEN
   RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';
  END IF;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('ordinal',(item->>'ordinal')::int,'sourceSetVersionId',set_version.id,'manifestHash',set_version.manifest_hash,'purpose',item->>'purpose'));
 END LOOP;
 bundle_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','transcript-input-bundle-1','ownerModule','assess','sourceSets',manifest,'manualBriefHash',p_manual_brief_hash));
 INSERT INTO public.enterprise_module_input_bundle_versions(input_bundle_id,org_id,workspace_id,version,bundle_hash,manual_brief_hash,status,created_by)
 VALUES(b.id,p_org,p_workspace,p_expected_version+1,bundle_hash,p_manual_brief_hash,'locked',p_actor) RETURNING * INTO v;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY (value->>'ordinal')::int LOOP
  SELECT * INTO set_version FROM public.enterprise_source_set_versions WHERE id=(item->>'sourceSetVersionId')::uuid;
  INSERT INTO public.enterprise_module_input_bundle_items(input_bundle_version_id,input_bundle_id,org_id,workspace_id,ordinal,item_kind,source_set_version_id,source_set_id,resource_hash,declared_purpose)
  VALUES(v.id,b.id,p_org,p_workspace,(item->>'ordinal')::int,'source_set',set_version.id,set_version.source_set_id,set_version.manifest_hash,btrim(item->>'purpose'));
 END LOOP;
 UPDATE public.enterprise_module_input_bundles SET current_version=v.version,updated_at=statement_timestamp() WHERE id=b.id;
 result:=jsonb_build_object('resourceId',b.id,'inputBundleId',b.id,'inputBundleVersionId',v.id,'version',v.version,'status','locked');
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.input-bundle.lock','command',b.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_set_journey_state(
 p_journey uuid,p_action text,p_desired_exit_module text,p_reason text,p_expected_version bigint,p_route_policy_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;j public.enterprise_governed_journeys;v public.enterprise_governed_journey_versions;next_status text;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.journey.set-state','transcript.journeys.manage',p_authorization_version,p_execution_token,p_execution_fence,'journeys');
 IF p_action NOT IN('create','stop','resume') OR p_desired_exit_module NOT IN('assess','studio','delivery','monitor') OR p_expected_version<0 OR p_route_policy_version<1 OR length(COALESCE(p_reason,''))>2000 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_JOURNEY';END IF;
 SELECT * INTO j FROM public.enterprise_governed_journeys WHERE id=p_journey FOR UPDATE;
 IF p_action='create' THEN
  IF j.id IS NOT NULL OR p_expected_version<>0 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_JOURNEY_STALE';END IF;next_status:='active';
  INSERT INTO public.enterprise_governed_journeys(id,org_id,workspace_id,entry_module,desired_exit_module,current_module,lineage_classification,planning_only,route_policy_version,status,version,created_by)
  VALUES(p_journey,p_org,p_workspace,'assess',p_desired_exit_module,'assess','assessed',false,p_route_policy_version,next_status,1,p_actor) RETURNING * INTO j;
 ELSE
  IF j.id IS NULL OR j.org_id IS DISTINCT FROM p_org OR j.workspace_id IS DISTINCT FROM p_workspace OR j.version IS DISTINCT FROM p_expected_version
     OR j.route_policy_version IS DISTINCT FROM p_route_policy_version OR (p_action='stop' AND j.status<>'active') OR (p_action='resume' AND j.status<>'stopped') THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_JOURNEY_STALE';END IF;
  next_status:=CASE p_action WHEN 'stop' THEN 'stopped' ELSE 'active' END;
  UPDATE public.enterprise_governed_journeys SET status=next_status,desired_exit_module=p_desired_exit_module,version=version+1,updated_at=statement_timestamp() WHERE id=j.id RETURNING * INTO j;
 END IF;
 INSERT INTO public.enterprise_governed_journey_versions(journey_id,org_id,workspace_id,version,status,desired_exit_module,reason,created_by)
 VALUES(j.id,p_org,p_workspace,j.version,j.status,j.desired_exit_module,NULLIF(btrim(COALESCE(p_reason,'')),''),p_actor) RETURNING * INTO v;
 result:=jsonb_build_object('resourceId',j.id,'journeyId',j.id,'version',j.version,'status',j.status,'entryModule','assess','currentModule','assess','desiredExitModule',j.desired_exit_module,'lineageClassification','assessed','planningOnly',false);
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.journey.set-state','command',j.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_review_assess_candidate(
 p_candidate uuid,p_expected_version bigint,p_status text,p_value text,p_reason text,p_relationship text,p_application_intent text,p_apply_target text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;b public.enterprise_module_input_bundle_versions;c public.enterprise_evidence_candidates;
 binding public.enterprise_transcript_extraction_bindings;reviewed jsonb;next_value text;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.candidate.review','evidence.review',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
 IF p_expected_version<1 OR p_status NOT IN('accepted','rejected','edited') OR p_relationship NOT IN('neutral','supporting','contradictory')
    OR (p_application_intent IS NULL) IS DISTINCT FROM (p_apply_target IS NULL)
    OR (p_application_intent IS NOT NULL AND (p_application_intent NOT IN('set_case_field','create_primitive','create_application_asset','create_interaction','create_decision_point','create_exception_path','set_registered_fact','link_evidence_only') OR length(btrim(p_apply_target)) NOT BETWEEN 1 AND 160))
    OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 2000
    OR (p_status='edited' AND length(btrim(COALESCE(p_value,''))) NOT BETWEEN 1 AND 12000)
    OR (p_status<>'edited' AND p_value IS NOT NULL) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CANDIDATE_REVIEW_INVALID';END IF;
 SELECT * INTO c FROM public.enterprise_evidence_candidates
 WHERE id=p_candidate AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO binding FROM public.enterprise_transcript_extraction_bindings
 WHERE job_id=c.ai_job_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO b FROM public.enterprise_module_input_bundle_versions
 WHERE id=binding.input_bundle_version_id AND input_bundle_id=binding.input_bundle_id AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
 IF b.id IS NULL OR binding.id IS NULL OR binding.bundle_hash IS DISTINCT FROM b.bundle_hash OR c.id IS NULL
    OR c.version IS DISTINCT FROM p_expected_version
    OR c.suggestion_status IN('accepted','rejected')
    OR NOT EXISTS(
      SELECT 1 FROM public.enterprise_module_input_bundle_items bi
      JOIN public.enterprise_source_set_version_items si ON si.source_set_version_id=bi.source_set_version_id
      WHERE bi.input_bundle_version_id=b.id AND si.source_id=c.source_id AND si.source_version_id=c.source_version_id
    ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CANDIDATE_REVIEW_STALE';END IF;
 next_value:=CASE WHEN p_status='edited' THEN p_value ELSE c.value END;
 reviewed:=public.enterprise_review_evidence_candidate(
   c.id,p_org,p_workspace,next_value,c.excerpt_hash,p_status,p_actor,c.value,p_reason
 );
 INSERT INTO public.enterprise_evidence_candidate_relationship_reviews(
  org_id,workspace_id,candidate_id,source_id,source_version_id,input_bundle_version_id,input_bundle_id,candidate_version,
  relationship,suggested_application_intent,suggested_apply_target,rationale,reviewer_id,authorization_version,receipt_id
 ) VALUES(
  p_org,p_workspace,c.id,c.source_id,c.source_version_id,b.id,b.input_bundle_id,(reviewed->>'version')::bigint,
  p_relationship,p_application_intent,NULLIF(btrim(p_apply_target),''),btrim(p_reason),p_actor,p_authorization_version,r.id
 );
 result:=jsonb_build_object(
   'resourceId',c.id,'candidateId',c.id,'status',reviewed->>'status','reviewedBy',reviewed->>'reviewedBy',
   'version',(reviewed->>'version')::bigint,
   'inputBundleVersionId',b.id,'sourceId',c.source_id,'sourceVersionId',c.source_version_id,'relationship',p_relationship,
   'applicationIntent',p_application_intent,'applyTarget',p_apply_target
 );
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.assess.candidate.review','command',c.id,result,'committed');
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_assess_apply_preview(
 p_preview uuid,p_case uuid,p_expected_case_version bigint,p_bundle_version uuid,p_candidate uuid,p_intent text,p_target_key text,p_target_id uuid,p_proposed_value jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;c public.assess_v2_cases;cv public.assess_v2_case_versions;b public.enterprise_module_input_bundle_versions;
 candidate public.enterprise_evidence_candidates;sv public.enterprise_evidence_source_versions;p public.enterprise_assess_apply_previews;conflict public.enterprise_assess_evidence_conflicts;
 manual_value jsonb;manual_hash text;v_binding_hash text;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.apply.preview','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
 IF p_intent NOT IN('set_case_field','create_primitive','create_application_asset','create_interaction','create_decision_point','create_exception_path','set_registered_fact','link_evidence_only')
    OR length(btrim(COALESCE(p_target_key,''))) NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_proposed_value) IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';END IF;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND deleted_at IS NULL FOR SHARE;
 SELECT * INTO cv FROM public.assess_v2_case_versions WHERE id=c.head_version_id AND case_id=c.id FOR SHARE;
 IF c.id IS NULL OR c.status<>'draft' OR c.version IS DISTINCT FROM p_expected_case_version OR cv.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_ASSESS_STALE';END IF;
 SELECT * INTO b FROM public.enterprise_module_input_bundle_versions WHERE id=p_bundle_version AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
 IF b.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.enterprise_module_input_bundle_items bi JOIN public.enterprise_source_set_version_items si ON si.source_set_version_id=bi.source_set_version_id
    WHERE bi.input_bundle_version_id=b.id AND si.source_version_id=(SELECT source_version_id FROM public.enterprise_evidence_candidates WHERE id=p_candidate)) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE';END IF;
 SELECT * INTO candidate FROM public.enterprise_evidence_candidates WHERE id=p_candidate FOR SHARE;
 SELECT * INTO sv FROM public.enterprise_evidence_source_versions WHERE id=candidate.source_version_id FOR SHARE;
 IF candidate.id IS NULL OR candidate.org_id IS DISTINCT FROM p_org OR candidate.workspace_id IS DISTINCT FROM p_workspace OR candidate.suggestion_status NOT IN('accepted','edited')
    OR candidate.reviewed_by IS NULL OR candidate.reviewed_at IS NULL OR sv.id IS NULL OR sv.extraction_status<>'parsed' OR sv.extracted_text_hash IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CANDIDATE_STALE';END IF;
 IF p_intent='set_case_field' AND (p_target_key NOT IN('name','description') OR jsonb_typeof(p_proposed_value)<>'string'
    OR (p_target_key='name' AND length(btrim(p_proposed_value#>>'{}')) NOT BETWEEN 1 AND 200)
    OR (p_target_key='description' AND length(p_proposed_value#>>'{}')>4000)) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';
 ELSIF p_intent='link_evidence_only' AND (p_target_key<>'evidence' OR p_target_id IS NOT NULL OR p_proposed_value<>'{}'::jsonb) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';
 ELSIF p_intent='set_registered_fact' AND (p_target_id IS NULL OR jsonb_typeof(p_proposed_value)<>'object' OR p_proposed_value->>'status' NOT IN('known','unknown','suggested','assumed')) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';
 ELSIF p_intent LIKE 'create_%' AND (p_target_id IS NULL OR jsonb_typeof(p_proposed_value)<>'object' OR p_proposed_value->>'id' IS DISTINCT FROM p_target_id::text) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';END IF;
 v_binding_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('caseId',c.id,'caseVersion',c.version,'bundleVersionId',b.id,'bundleHash',b.bundle_hash,
  'candidateId',candidate.id,'candidateVersion',candidate.version,'candidateProvenanceHash',candidate.provenance_hash,'intent',p_intent,'targetKey',p_target_key,'targetId',p_target_id,'proposedValue',p_proposed_value));
 INSERT INTO public.enterprise_assess_apply_previews(id,org_id,workspace_id,assess_case_id,expected_case_version,input_bundle_version_id,input_bundle_id,bundle_hash,
  candidate_id,source_id,source_version_id,candidate_version,candidate_provenance_hash,application_intent,target_key,target_id,proposed_value,binding_hash,created_by,expires_at)
 VALUES(p_preview,p_org,p_workspace,c.id,c.version,b.id,b.input_bundle_id,b.bundle_hash,candidate.id,candidate.source_id,candidate.source_version_id,candidate.version,candidate.provenance_hash,
  p_intent,btrim(p_target_key),p_target_id,p_proposed_value,v_binding_hash,p_actor,statement_timestamp()+interval '30 minutes')
 ON CONFLICT(org_id,workspace_id,binding_hash) DO NOTHING RETURNING * INTO p;
 IF p.id IS NULL THEN SELECT * INTO p FROM public.enterprise_assess_apply_previews preview WHERE preview.org_id=p_org AND preview.workspace_id=p_workspace AND preview.binding_hash=v_binding_hash FOR SHARE;END IF;
 IF p.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';END IF;
 IF p_intent='set_case_field' THEN manual_value:=CASE p_target_key WHEN 'name' THEN to_jsonb(cv.name) ELSE to_jsonb(cv.description) END;
 ELSIF p_intent='set_registered_fact' THEN SELECT primitive.payload#>ARRAY['facts',p_target_key] INTO manual_value FROM public.assess_v2_primitives primitive WHERE primitive.version_id=cv.id AND primitive.id=p_target_id;
 ELSE SELECT x.payload INTO manual_value FROM (
  SELECT payload,id FROM public.assess_v2_primitives WHERE version_id=cv.id UNION ALL SELECT payload,id FROM public.assess_v2_application_assets WHERE version_id=cv.id
  UNION ALL SELECT payload,id FROM public.assess_v2_application_interactions WHERE version_id=cv.id UNION ALL SELECT payload,id FROM public.assess_v2_decision_points WHERE version_id=cv.id
  UNION ALL SELECT payload,id FROM public.assess_v2_exception_paths WHERE version_id=cv.id)x WHERE x.id=p_target_id LIMIT 1;END IF;
 IF manual_value IS NOT NULL AND manual_value IS DISTINCT FROM p_proposed_value THEN
  manual_hash:=public.enterprise_sha256_jsonb(manual_value);
  INSERT INTO public.enterprise_assess_evidence_conflicts(org_id,workspace_id,assess_case_id,input_bundle_version_id,input_bundle_id,application_intent,target_key,target_id,candidate_ids,candidate_binding_hash,manual_value_hash,manual_case_version,is_material,created_by)
  VALUES(p_org,p_workspace,c.id,b.id,b.input_bundle_id,p_intent,p_target_key,p_target_id,ARRAY[candidate.id],v_binding_hash,manual_hash,c.version,true,p_actor)
  ON CONFLICT(org_id,workspace_id,assess_case_id,candidate_binding_hash) DO NOTHING RETURNING * INTO conflict;
  IF conflict.id IS NULL THEN SELECT * INTO conflict FROM public.enterprise_assess_evidence_conflicts
    WHERE org_id=p_org AND workspace_id=p_workspace AND assess_case_id=c.id AND candidate_binding_hash=v_binding_hash FOR SHARE;END IF;
 END IF;
 result:=jsonb_build_object('resourceId',p.id,'previewId',p.id,'assessDraftId',c.id,'expectedVersion',c.version,'inputBundleVersionId',b.id,
  'candidateId',candidate.id,'candidateVersion',candidate.version,'applicationIntent',p.application_intent,'targetKey',p.target_key,'targetId',p.target_id,
  'conflictId',conflict.id,'status',CASE WHEN conflict.id IS NULL THEN 'ready' ELSE 'conflict_unresolved' END,'expiresAt',p.expires_at);
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_assess_apply_preview_batch(
 p_batch uuid,p_case uuid,p_expected_case_version bigint,p_selections jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;c public.assess_v2_cases;selection jsonb;candidate public.enterprise_evidence_candidates;
 binding public.enterprise_transcript_extraction_bindings;b public.enterprise_module_input_bundle_versions;first_bundle uuid;preview_result jsonb;
 cross_target record;preview_id uuid;preview_ids uuid[]:='{}'::uuid[];results jsonb:='[]'::jsonb;intent text;target text;target_key text;target_id uuid;
 proposed jsonb;cross_binding_hash text;material_conflict_count integer:=0;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.apply.preview','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
 IF jsonb_typeof(p_selections)<>'array' OR jsonb_array_length(p_selections) NOT BETWEEN 1 AND 100
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_selections)x WHERE jsonb_typeof(x.value)<>'object'
      OR NOT(x.value ?& ARRAY['candidateId','candidateVersion','intent','target'])
      OR (x.value-ARRAY['candidateId','candidateVersion','intent','target'])<>'{}'::jsonb
      OR COALESCE(x.value->>'candidateId','')!~*'^[0-9a-f-]{36}$' OR COALESCE(x.value->>'candidateVersion','')!~'^[1-9][0-9]*$'
      OR length(btrim(COALESCE(x.value->>'target',''))) NOT BETWEEN 1 AND 160)
    OR (SELECT count(DISTINCT value->>'candidateId') FROM jsonb_array_elements(p_selections))<>jsonb_array_length(p_selections)
 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';END IF;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND status='draft' AND deleted_at IS NULL FOR SHARE;
 IF c.id IS NULL OR c.version IS DISTINCT FROM p_expected_case_version THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_ASSESS_STALE';END IF;
 FOR selection IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
  SELECT * INTO candidate FROM public.enterprise_evidence_candidates WHERE id=(selection->>'candidateId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO binding FROM public.enterprise_transcript_extraction_bindings WHERE job_id=candidate.ai_job_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO b FROM public.enterprise_module_input_bundle_versions WHERE id=binding.input_bundle_version_id AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
  IF candidate.id IS NULL OR candidate.version IS DISTINCT FROM (selection->>'candidateVersion')::bigint OR candidate.suggestion_status NOT IN('accepted','edited')
     OR binding.id IS NULL OR b.id IS NULL OR binding.bundle_hash IS DISTINCT FROM b.bundle_hash OR (first_bundle IS NOT NULL AND b.id IS DISTINCT FROM first_bundle)
  THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CANDIDATE_STALE';END IF;
  first_bundle:=COALESCE(first_bundle,b.id);intent:=selection->>'intent';target:=btrim(selection->>'target');target_id:=NULL;
  IF intent='set_case_field' AND target IN('name','description') THEN target_key:=target;proposed:=to_jsonb(candidate.value);
  ELSIF intent='link_evidence_only' AND target='evidence' THEN target_key:='evidence';proposed:='{}'::jsonb;
  ELSIF intent IN('create_primitive','create_application_asset','create_interaction','create_decision_point','create_exception_path') AND target~*'^[0-9a-f-]{36}$' THEN
   target_id:=target::uuid;target_key:=substring(intent from 8);proposed:=jsonb_build_object('id',target_id,'label',candidate.value,'evidenceIds','[]'::jsonb);
  ELSIF intent='set_registered_fact' AND split_part(target,'/',1)~*'^[0-9a-f-]{36}$' AND length(split_part(target,'/',2)) BETWEEN 1 AND 120 THEN
   target_id:=split_part(target,'/',1)::uuid;target_key:=split_part(target,'/',2);proposed:=jsonb_build_object('value',candidate.value,'status','known');
  ELSE RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_INVALID';END IF;
  preview_id:=gen_random_uuid();
  preview_result:=public.enterprise_transcript_create_assess_apply_preview(preview_id,c.id,c.version,b.id,candidate.id,intent,target_key,target_id,proposed,
    p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence);
  preview_ids:=array_append(preview_ids,(preview_result->>'previewId')::uuid);results:=results||jsonb_build_array(preview_result);
 END LOOP;
 -- Different candidate values aimed at the same target become one explicit,
 -- material cross-source conflict. Identical values are deduplicated later by
 -- enterprise_transcript_preview_resolution while every candidate keeps its
 -- own evidence link and immutable application record.
 FOR cross_target IN
  SELECT p.application_intent,p.target_key,p.target_id,array_agg(p.candidate_id ORDER BY p.candidate_id) AS candidate_ids,
   jsonb_agg(jsonb_build_object('candidateId',p.candidate_id,'candidateVersion',p.candidate_version,'bindingHash',p.binding_hash,
    'proposedValue',p.proposed_value) ORDER BY p.candidate_id) AS candidate_bindings
  FROM public.enterprise_assess_apply_previews p
  WHERE p.id=ANY(preview_ids) AND p.application_intent<>'link_evidence_only'
  GROUP BY p.application_intent,p.target_key,p.target_id
  HAVING count(*)>1 AND count(DISTINCT p.proposed_value)>1
 LOOP
  cross_binding_hash:=public.enterprise_sha256_jsonb(jsonb_build_object(
   'caseId',c.id,'caseVersion',c.version,'bundleVersionId',b.id,'bundleHash',b.bundle_hash,
   'applicationIntent',cross_target.application_intent,'targetKey',cross_target.target_key,'targetId',cross_target.target_id,
   'candidateBindings',cross_target.candidate_bindings
  ));
  INSERT INTO public.enterprise_assess_evidence_conflicts(
   org_id,workspace_id,assess_case_id,input_bundle_version_id,input_bundle_id,application_intent,target_key,target_id,
   candidate_ids,candidate_binding_hash,manual_value_hash,manual_case_version,is_material,created_by
  ) VALUES(
   p_org,p_workspace,c.id,b.id,b.input_bundle_id,cross_target.application_intent,cross_target.target_key,cross_target.target_id,
   cross_target.candidate_ids,cross_binding_hash,NULL,NULL,true,p_actor
  ) ON CONFLICT(org_id,workspace_id,assess_case_id,candidate_binding_hash) DO NOTHING;
 END LOOP;
 INSERT INTO public.enterprise_assess_apply_preview_batches(id,org_id,workspace_id,assess_case_id,expected_case_version,input_bundle_version_id,input_bundle_id,bundle_hash,preview_ids,created_by,receipt_id)
 SELECT p_batch,p_org,p_workspace,c.id,c.version,b.id,b.input_bundle_id,b.bundle_hash,preview_ids,p_actor,r.id;
 SELECT count(*)::integer INTO material_conflict_count
 FROM public.enterprise_assess_evidence_conflicts conflict
 LEFT JOIN public.enterprise_assess_evidence_conflict_resolutions resolution
  ON resolution.conflict_id=conflict.id AND resolution.version=conflict.current_resolution_version
 WHERE conflict.org_id=p_org AND conflict.workspace_id=p_workspace AND conflict.assess_case_id=c.id AND conflict.is_material
  AND (resolution.id IS NULL OR resolution.resolution='unresolved')
  AND EXISTS(
   SELECT 1 FROM public.enterprise_assess_apply_previews preview
   WHERE preview.id=ANY(preview_ids) AND (
    conflict.candidate_binding_hash=preview.binding_hash OR (
     preview.candidate_id=ANY(conflict.candidate_ids) AND conflict.application_intent=preview.application_intent
     AND conflict.target_key=preview.target_key AND conflict.target_id IS NOT DISTINCT FROM preview.target_id
    )
   )
  );
 result:=jsonb_build_object('resourceId',p_batch,'previewId',p_batch,'assessDraftId',c.id,'expectedVersion',c.version,
  'inputBundleVersionId',b.id,'previewIds',to_jsonb(preview_ids),'candidateCount',cardinality(preview_ids),'previews',results,
  'materialConflictCount',material_conflict_count,'status',CASE WHEN material_conflict_count>0 THEN 'conflict_unresolved' ELSE 'previewed' END);
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.assess.apply.preview','command',p_batch,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_resolve_assess_conflict(
 p_conflict uuid,p_expected_version bigint,p_resolution text,p_chosen_candidate uuid,p_authored_value jsonb,p_rationale text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;c public.enterprise_assess_evidence_conflicts;v public.enterprise_assess_evidence_conflict_resolutions;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.conflict.resolve','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
 IF p_resolution NOT IN('choose_candidate','retain_manual','authored_resolution','unresolved') OR length(btrim(COALESCE(p_rationale,''))) NOT BETWEEN 1 AND 2000
    OR (p_resolution='choose_candidate') IS DISTINCT FROM (p_chosen_candidate IS NOT NULL) OR (p_resolution='authored_resolution') IS DISTINCT FROM (p_authored_value IS NOT NULL) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CONFLICT_INVALID';END IF;
 SELECT * INTO c FROM public.enterprise_assess_evidence_conflicts WHERE id=p_conflict FOR UPDATE;
 IF c.id IS NULL OR c.org_id IS DISTINCT FROM p_org OR c.workspace_id IS DISTINCT FROM p_workspace OR c.current_resolution_version IS DISTINCT FROM p_expected_version
    OR (p_chosen_candidate IS NOT NULL AND NOT p_chosen_candidate=ANY(c.candidate_ids)) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CONFLICT_STALE';END IF;
 INSERT INTO public.enterprise_assess_evidence_conflict_resolutions(conflict_id,org_id,workspace_id,version,resolution,chosen_candidate_id,authored_value,rationale,resolver_id,authorization_version)
 VALUES(c.id,p_org,p_workspace,p_expected_version+1,p_resolution,p_chosen_candidate,p_authored_value,btrim(p_rationale),p_actor,p_authorization_version) RETURNING * INTO v;
 UPDATE public.enterprise_assess_evidence_conflicts SET current_resolution_version=v.version WHERE id=c.id;
 result:=jsonb_build_object('resourceId',c.id,'conflictId',c.id,'version',v.version,'resolution',v.resolution,'status',CASE WHEN v.resolution='unresolved' THEN 'unresolved' ELSE 'resolved' END);
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.assess.conflict.resolve','command',c.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_preview_resolution(p_preview uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.enterprise_assess_apply_previews;conflict_count integer;unresolved_count integer;retain_count integer;excluded_count integer;
 authored_count integer;authored_distinct_count integer;group_authored_excluded_count integer;authored_value jsonb;has_prior_identical boolean;
BEGIN
 SELECT * INTO p FROM public.enterprise_assess_apply_previews WHERE id=p_preview;
 IF p.id IS NULL THEN RETURN NULL;END IF;
 SELECT count(*)::integer,
  count(*) FILTER(WHERE resolution.id IS NULL OR resolution.resolution='unresolved')::integer,
  count(*) FILTER(WHERE resolution.resolution='retain_manual')::integer,
  count(*) FILTER(WHERE resolution.resolution='choose_candidate' AND resolution.chosen_candidate_id IS DISTINCT FROM p.candidate_id)::integer,
  count(*) FILTER(WHERE resolution.resolution='authored_resolution')::integer,
  count(DISTINCT resolution.authored_value) FILTER(WHERE resolution.resolution='authored_resolution')::integer,
  count(*) FILTER(WHERE resolution.resolution='authored_resolution' AND cardinality(conflict.candidate_ids)>1
   AND conflict.candidate_ids[1] IS DISTINCT FROM p.candidate_id)::integer,
  (jsonb_agg(resolution.authored_value ORDER BY cardinality(conflict.candidate_ids) DESC)
   FILTER(WHERE resolution.resolution='authored_resolution'))->0
 INTO conflict_count,unresolved_count,retain_count,excluded_count,authored_count,authored_distinct_count,group_authored_excluded_count,authored_value
 FROM public.enterprise_assess_evidence_conflicts conflict
 LEFT JOIN public.enterprise_assess_evidence_conflict_resolutions resolution
  ON resolution.conflict_id=conflict.id AND resolution.version=conflict.current_resolution_version
 WHERE conflict.org_id=p.org_id AND conflict.workspace_id=p.workspace_id AND conflict.assess_case_id=p.assess_case_id AND conflict.is_material
  AND (
   conflict.candidate_binding_hash=p.binding_hash OR (
    p.candidate_id=ANY(conflict.candidate_ids) AND cardinality(conflict.candidate_ids)>1
    AND conflict.application_intent=p.application_intent AND conflict.target_key=p.target_key
    AND conflict.target_id IS NOT DISTINCT FROM p.target_id
   )
  );
 IF unresolved_count>0 OR authored_distinct_count>1 THEN RETURN jsonb_build_object('apply',false,'unresolved',true,'value',NULL);END IF;
 IF retain_count>0 OR excluded_count>0 OR group_authored_excluded_count>0 THEN RETURN jsonb_build_object('apply',false,'value',NULL);END IF;
 IF authored_count>0 THEN RETURN jsonb_build_object('apply',true,'value',authored_value);END IF;
 -- Equivalent proposals to one target do not create competing writes. The
 -- first candidate applies the value; all candidates still produce evidence.
 SELECT EXISTS(
  SELECT 1 FROM public.enterprise_assess_apply_preview_batches batch
  JOIN public.enterprise_assess_apply_previews peer ON peer.id=ANY(batch.preview_ids)
  WHERE p.id=ANY(batch.preview_ids) AND p.application_intent<>'link_evidence_only' AND peer.id<>p.id
   AND peer.application_intent=p.application_intent AND peer.target_key=p.target_key AND peer.target_id IS NOT DISTINCT FROM p.target_id
   AND peer.proposed_value=p.proposed_value AND peer.candidate_id<p.candidate_id
 ) INTO has_prior_identical;
 IF conflict_count=0 AND has_prior_identical THEN RETURN jsonb_build_object('apply',false,'value',NULL);END IF;
 RETURN jsonb_build_object('apply',true,'value',p.proposed_value);
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_commit_assess_apply_batch(
 p_case uuid,p_expected_case_version bigint,p_bundle_version uuid,p_bundle_hash text,p_preview_ids jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;c public.assess_v2_cases;oldv public.assess_v2_case_versions;newv public.assess_v2_case_versions;
 b public.enterprise_module_input_bundle_versions;p public.enterprise_assess_apply_previews;candidate public.enterprise_evidence_candidates;item jsonb;ordinal bigint;
 effective jsonb;next_name text;next_description text;evidence_ids jsonb:='[]'::jsonb;application_ids jsonb:='[]'::jsonb;evidence_id uuid;application_id uuid;
 selected_count int;distinct_count int;applied_count int:=0;v_application_outcome text;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.apply.commit','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
 IF jsonb_typeof(p_preview_ids)<>'array' OR jsonb_array_length(p_preview_ids) NOT BETWEEN 1 AND 100 OR p_bundle_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_INVALID';END IF;
 SELECT count(*)::int,count(DISTINCT value #>> '{}')::int INTO selected_count,distinct_count FROM jsonb_array_elements(p_preview_ids);
 IF selected_count<>distinct_count OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_preview_ids)x WHERE jsonb_typeof(x.value)<>'string' OR (x.value#>>'{}')!~*'^[0-9a-f-]{36}$') THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_INVALID';END IF;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO oldv FROM public.assess_v2_case_versions WHERE id=c.head_version_id AND case_id=c.id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO b FROM public.enterprise_module_input_bundle_versions WHERE id=p_bundle_version AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF c.id IS NULL OR c.status<>'draft' OR c.version IS DISTINCT FROM p_expected_case_version OR oldv.id IS NULL OR b.id IS NULL OR b.status<>'locked' OR b.bundle_hash IS DISTINCT FROM p_bundle_hash THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE';END IF;
 -- Lock and validate the entire batch before the first version/child write.
 FOR item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(p_preview_ids) WITH ORDINALITY ORDER BY ordinality LOOP
  SELECT * INTO p FROM public.enterprise_assess_apply_previews WHERE id=(item#>>'{}')::uuid FOR SHARE;
  SELECT * INTO candidate FROM public.enterprise_evidence_candidates WHERE id=p.candidate_id FOR SHARE;
  effective:=public.enterprise_transcript_preview_resolution(p.id);
  IF p.id IS NULL OR p.org_id IS DISTINCT FROM p_org OR p.workspace_id IS DISTINCT FROM p_workspace OR p.assess_case_id IS DISTINCT FROM c.id
     OR p.expected_case_version IS DISTINCT FROM c.version OR p.input_bundle_version_id IS DISTINCT FROM b.id OR p.bundle_hash IS DISTINCT FROM b.bundle_hash OR p.expires_at<=statement_timestamp()
     OR candidate.id IS NULL OR candidate.org_id IS DISTINCT FROM p_org OR candidate.workspace_id IS DISTINCT FROM p_workspace OR candidate.version IS DISTINCT FROM p.candidate_version
     OR candidate.provenance_hash IS DISTINCT FROM p.candidate_provenance_hash OR candidate.suggestion_status NOT IN('accepted','edited')
     OR EXISTS(SELECT 1 FROM public.enterprise_assess_candidate_applications a WHERE a.preview_id=p.id)
     OR COALESCE((effective->>'unresolved')::boolean,false) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE';END IF;
 END LOOP;
 next_name:=oldv.name;next_description:=oldv.description;
 FOR item IN SELECT value FROM jsonb_array_elements(p_preview_ids) LOOP
  SELECT * INTO p FROM public.enterprise_assess_apply_previews WHERE id=(item#>>'{}')::uuid;effective:=public.enterprise_transcript_preview_resolution(p.id);
  IF COALESCE((effective->>'apply')::boolean,false) AND p.application_intent='set_case_field' THEN
   IF p.target_key='name' THEN next_name:=effective->>'value';ELSE next_description:=effective->>'value';END IF;
  END IF;
 END LOOP;
 IF length(btrim(COALESCE(next_name,''))) NOT BETWEEN 1 AND 200 OR length(COALESCE(next_description,''))>4000 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_INVALID';END IF;
 INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,imported_facts,created_by)
 VALUES(c.id,p_org,p_workspace,c.version+1,next_name,next_description,oldv.agent_necessity,'draft_upsert',oldv.source_snapshot,oldv.imported_facts,p_actor) RETURNING * INTO newv;
 INSERT INTO public.assess_v2_primitives(id,version_id,case_id,org_id,workspace_id,payload)
 SELECT old.id,newv.id,old.case_id,old.org_id,old.workspace_id,
  COALESCE((SELECT jsonb_set(old.payload,ARRAY['facts',preview.target_key],resolution.value->'value',true) FROM jsonb_array_elements(p_preview_ids)x
   JOIN public.enterprise_assess_apply_previews preview ON preview.id=(x.value#>>'{}')::uuid CROSS JOIN LATERAL public.enterprise_transcript_preview_resolution(preview.id) resolution(value)
   WHERE preview.application_intent='set_registered_fact' AND preview.target_id=old.id AND COALESCE((resolution.value->>'apply')::boolean,false) LIMIT 1),old.payload)
 FROM public.assess_v2_primitives old WHERE old.version_id=oldv.id
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_preview_ids)x JOIN public.enterprise_assess_apply_previews preview ON preview.id=(x.value#>>'{}')::uuid
  CROSS JOIN LATERAL public.enterprise_transcript_preview_resolution(preview.id) resolution(value) WHERE preview.application_intent='create_primitive' AND preview.target_id=old.id AND COALESCE((resolution.value->>'apply')::boolean,false));
 INSERT INTO public.assess_v2_edges SELECT id,newv.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_edges WHERE version_id=oldv.id;
 INSERT INTO public.assess_v2_application_assets SELECT id,newv.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_application_assets old WHERE version_id=oldv.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_preview_ids)x JOIN public.enterprise_assess_apply_previews preview ON preview.id=(x.value#>>'{}')::uuid CROSS JOIN LATERAL public.enterprise_transcript_preview_resolution(preview.id) resolution(value) WHERE preview.application_intent='create_application_asset' AND preview.target_id=old.id AND COALESCE((resolution.value->>'apply')::boolean,false));
 INSERT INTO public.assess_v2_application_interactions SELECT id,newv.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_application_interactions old WHERE version_id=oldv.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_preview_ids)x JOIN public.enterprise_assess_apply_previews preview ON preview.id=(x.value#>>'{}')::uuid CROSS JOIN LATERAL public.enterprise_transcript_preview_resolution(preview.id) resolution(value) WHERE preview.application_intent='create_interaction' AND preview.target_id=old.id AND COALESCE((resolution.value->>'apply')::boolean,false));
 INSERT INTO public.assess_v2_decision_points SELECT id,newv.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_decision_points old WHERE version_id=oldv.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_preview_ids)x JOIN public.enterprise_assess_apply_previews preview ON preview.id=(x.value#>>'{}')::uuid CROSS JOIN LATERAL public.enterprise_transcript_preview_resolution(preview.id) resolution(value) WHERE preview.application_intent='create_decision_point' AND preview.target_id=old.id AND COALESCE((resolution.value->>'apply')::boolean,false));
 INSERT INTO public.assess_v2_exception_paths SELECT id,newv.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_exception_paths old WHERE version_id=oldv.id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_preview_ids)x JOIN public.enterprise_assess_apply_previews preview ON preview.id=(x.value#>>'{}')::uuid CROSS JOIN LATERAL public.enterprise_transcript_preview_resolution(preview.id) resolution(value) WHERE preview.application_intent='create_exception_path' AND preview.target_id=old.id AND COALESCE((resolution.value->>'apply')::boolean,false));
 INSERT INTO public.assess_v2_evidence_links SELECT id,newv.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_evidence_links WHERE version_id=oldv.id;
 FOR item,ordinal IN SELECT value,ordinality FROM jsonb_array_elements(p_preview_ids) WITH ORDINALITY ORDER BY ordinality LOOP
  SELECT * INTO p FROM public.enterprise_assess_apply_previews WHERE id=(item#>>'{}')::uuid;effective:=public.enterprise_transcript_preview_resolution(p.id);
  evidence_id:=p.planned_evidence_link_id;
  INSERT INTO public.assess_v2_evidence_links(id,version_id,case_id,org_id,workspace_id,payload) VALUES(evidence_id,newv.id,c.id,p_org,p_workspace,public.enterprise_build_assess_v2_evidence_submission(evidence_id,'upload','text/plain'));
  IF COALESCE((effective->>'apply')::boolean,false) AND p.application_intent LIKE 'create_%' THEN
   IF p.application_intent='create_primitive' THEN INSERT INTO public.assess_v2_primitives VALUES(p.target_id,newv.id,c.id,p_org,p_workspace,jsonb_set(effective->'value','{evidenceIds}',jsonb_build_array(evidence_id),true));
   ELSIF p.application_intent='create_application_asset' THEN INSERT INTO public.assess_v2_application_assets VALUES(p.target_id,newv.id,c.id,p_org,p_workspace,jsonb_set(effective->'value','{evidenceIds}',jsonb_build_array(evidence_id),true));
   ELSIF p.application_intent='create_interaction' THEN INSERT INTO public.assess_v2_application_interactions VALUES(p.target_id,newv.id,c.id,p_org,p_workspace,jsonb_set(effective->'value','{evidenceIds}',jsonb_build_array(evidence_id),true));
   ELSIF p.application_intent='create_decision_point' THEN INSERT INTO public.assess_v2_decision_points VALUES(p.target_id,newv.id,c.id,p_org,p_workspace,jsonb_set(effective->'value','{evidenceIds}',jsonb_build_array(evidence_id),true));
   ELSIF p.application_intent='create_exception_path' THEN INSERT INTO public.assess_v2_exception_paths VALUES(p.target_id,newv.id,c.id,p_org,p_workspace,jsonb_set(effective->'value','{evidenceIds}',jsonb_build_array(evidence_id),true));END IF;
  END IF;
  v_application_outcome:=CASE WHEN NOT COALESCE((effective->>'apply')::boolean,false) THEN 'not_applied' WHEN p.application_intent='link_evidence_only' THEN 'evidence_only' ELSE 'applied' END;
  IF v_application_outcome<>'not_applied' THEN applied_count:=applied_count+1;END IF;
  application_id:=gen_random_uuid();INSERT INTO public.enterprise_assess_candidate_applications(id,org_id,workspace_id,preview_id,assess_case_id,assess_case_version_id,assess_case_version,input_bundle_version_id,input_bundle_id,bundle_hash,candidate_id,source_id,source_version_id,candidate_version,candidate_provenance_hash,application_intent,target_key,target_id,application_outcome,applied_by,receipt_id,batch_ordinal)
  VALUES(application_id,p_org,p_workspace,p.id,c.id,newv.id,newv.version,b.id,b.input_bundle_id,b.bundle_hash,p.candidate_id,p.source_id,p.source_version_id,p.candidate_version,p.candidate_provenance_hash,p.application_intent,p.target_key,p.target_id,v_application_outcome,p_actor,r.id,ordinal);
  evidence_ids:=evidence_ids||jsonb_build_array(evidence_id);application_ids:=application_ids||jsonb_build_array(application_id);
 END LOOP;
 UPDATE public.assess_v2_cases SET version=newv.version,head_version_id=newv.id,updated_at=statement_timestamp() WHERE id=c.id;
 result:=jsonb_build_object('resourceId',c.id,'assessDraftId',c.id,'startVersion',c.version,'finalVersion',newv.version,'caseVersionId',newv.id,'inputBundleVersionId',b.id,
  'previewIds',p_preview_ids,'selectedCandidateCount',selected_count,'appliedCandidateCount',applied_count,'applicationIds',application_ids,'evidenceLinkIds',evidence_ids,'status','applied');
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.assess.apply.commit','command',c.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_commit_assess_apply_preview_batch(
 p_batch uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;batch public.enterprise_assess_apply_preview_batches;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.apply.commit','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
 SELECT * INTO batch FROM public.enterprise_assess_apply_preview_batches WHERE id=p_batch AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF batch.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE';END IF;
 result:=public.enterprise_transcript_commit_assess_apply_batch(
  batch.assess_case_id,batch.expected_case_version,batch.input_bundle_version_id,batch.bundle_hash,to_jsonb(batch.preview_ids),
  p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence
 );
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_block_unresolved_material_conflicts()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF OLD.status='draft' AND NEW.status<>'draft' AND EXISTS(
  SELECT 1 FROM public.enterprise_assess_evidence_conflicts c
  LEFT JOIN public.enterprise_assess_evidence_conflict_resolutions r ON r.conflict_id=c.id AND r.version=c.current_resolution_version
  WHERE c.assess_case_id=OLD.id AND c.org_id=OLD.org_id AND c.workspace_id=OLD.workspace_id AND c.is_material
    AND (r.id IS NULL OR r.resolution='unresolved')
 ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_MATERIAL_CONFLICT_UNRESOLVED';END IF;RETURN NEW;
END$$;
CREATE TRIGGER enterprise_transcript_assess_finalize_guard BEFORE UPDATE OF status ON public.assess_v2_cases
FOR EACH ROW EXECUTE FUNCTION public.enterprise_transcript_block_unresolved_material_conflicts();

CREATE OR REPLACE FUNCTION public.enterprise_transcript_assess_projection(p_org uuid,p_workspace uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE flags public.enterprise_transcript_workspace_flags;sets jsonb;bundles jsonb;journeys jsonb;conflicts jsonb;relationships jsonb;
 can_sources boolean:=public.has_workspace_capability(p_workspace,p_org,'transcript.sources.read');
 can_assess boolean:=public.has_workspace_capability(p_workspace,p_org,'assess.v2.read');
BEGIN
 IF auth.uid() IS NULL OR NOT (can_sources OR can_assess) THEN RETURN NULL;END IF;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceSetId',s.id,'ownerModule',s.owner_module,'displayLabel',s.display_label,'description',s.description,
  'currentVersion',s.current_version,'lifecycleVersion',s.lifecycle_version,'status',s.status,'sourceCount',v.source_count,'extractedCharacterCount',v.extracted_character_count,
  'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',i.source_id,'sourceVersionId',i.source_version_id,'ordinal',i.ordinal,'role',i.semantic_role,'note',i.user_note) ORDER BY i.ordinal)
    FROM public.enterprise_source_set_version_items i WHERE i.source_set_version_id=v.id),'[]'::jsonb),
  'createdAt',s.created_at,'updatedAt',s.updated_at) ORDER BY s.updated_at DESC),'[]'::jsonb) INTO sets
 FROM public.enterprise_source_sets s LEFT JOIN public.enterprise_source_set_versions v ON v.source_set_id=s.id AND v.version=s.current_version
 WHERE can_sources AND s.org_id=p_org AND s.workspace_id=p_workspace AND s.owner_module='assess';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('inputBundleId',b.id,'currentVersion',b.current_version,'inputBundleVersionId',v.id,'status',v.status,'createdAt',v.created_at,
  'sourceSetVersions',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceSetVersionId',i.source_set_version_id,'ordinal',i.ordinal,'purpose',i.declared_purpose) ORDER BY i.ordinal) FROM public.enterprise_module_input_bundle_items i WHERE i.input_bundle_version_id=v.id),'[]'::jsonb),
  'sourceVersions',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',si.source_id,'sourceVersionId',si.source_version_id,'bundleOrdinal',bi.ordinal,'sourceOrdinal',si.ordinal,'role',si.semantic_role)
    ORDER BY bi.ordinal,si.ordinal) FROM public.enterprise_module_input_bundle_items bi JOIN public.enterprise_source_set_version_items si ON si.source_set_version_id=bi.source_set_version_id
    WHERE bi.input_bundle_version_id=v.id),'[]'::jsonb)) ORDER BY b.updated_at DESC),'[]'::jsonb) INTO bundles
 FROM public.enterprise_module_input_bundles b LEFT JOIN public.enterprise_module_input_bundle_versions v ON v.input_bundle_id=b.id AND v.version=b.current_version
 WHERE can_sources AND b.org_id=p_org AND b.workspace_id=p_workspace AND b.owner_module='assess';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('journeyId',j.id,'entryModule',j.entry_module,'desiredExitModule',j.desired_exit_module,'currentModule',j.current_module,
  'lineageClassification',j.lineage_classification,'planningOnly',j.planning_only,'routePolicyVersion',j.route_policy_version,'status',j.status,'version',j.version,'updatedAt',j.updated_at) ORDER BY j.updated_at DESC),'[]'::jsonb) INTO journeys
 FROM public.enterprise_governed_journeys j WHERE can_assess AND j.org_id=p_org AND j.workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('conflictId',c.id,'assessDraftId',c.assess_case_id,'applicationIntent',c.application_intent,'targetKey',c.target_key,
  'targetId',c.target_id,'candidateIds',to_jsonb(c.candidate_ids),'isMaterial',c.is_material,'version',c.current_resolution_version,'resolution',COALESCE(r.resolution,'unresolved'),
  'rationale',r.rationale,'createdAt',c.created_at) ORDER BY c.created_at DESC),'[]'::jsonb) INTO conflicts
 FROM public.enterprise_assess_evidence_conflicts c LEFT JOIN public.enterprise_assess_evidence_conflict_resolutions r ON r.conflict_id=c.id AND r.version=c.current_resolution_version
 WHERE can_assess AND c.org_id=p_org AND c.workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('candidateId',x.candidate_id,'candidateVersion',x.candidate_version,'sourceId',x.source_id,'sourceVersionId',x.source_version_id,
  'inputBundleVersionId',x.input_bundle_version_id,'relationship',x.relationship,'applicationIntent',x.suggested_application_intent,'applyTarget',x.suggested_apply_target,
  'rationale',x.rationale,'reviewedAt',x.created_at) ORDER BY x.created_at DESC),'[]'::jsonb)
 INTO relationships FROM (SELECT DISTINCT ON(candidate_id) * FROM public.enterprise_evidence_candidate_relationship_reviews
  WHERE can_assess AND org_id=p_org AND workspace_id=p_workspace ORDER BY candidate_id,created_at DESC,id DESC)x;
 RETURN jsonb_build_object('mode','server_authoritative','organizationId',p_org,'workspaceId',p_workspace,'flags',jsonb_build_object(
  'transcriptSourceSetsEnabled',COALESCE(flags.transcript_source_sets_enabled,false),'assessMultisourceApplyEnabled',COALESCE(flags.assess_multisource_apply_enabled,false),
  'unifiedByokGatewayEnabled',COALESCE(flags.unified_byok_gateway_enabled,false),'governedJourneysEnabled',COALESCE(flags.governed_journeys_enabled,false)),
  'sourceSets',sets,'inputBundles',bundles,'journeys',journeys,'conflicts',conflicts,'candidateRelationships',relationships);
END$$;

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY[
 'enterprise_transcript_workspace_flags','enterprise_source_sets','enterprise_source_set_versions','enterprise_source_set_version_items',
 'enterprise_module_input_bundles','enterprise_module_input_bundle_versions','enterprise_module_input_bundle_items','enterprise_governed_journeys','enterprise_governed_journey_versions',
 'enterprise_assess_apply_previews','enterprise_assess_apply_preview_batches','enterprise_assess_candidate_applications','enterprise_evidence_candidate_relationship_reviews','enterprise_assess_evidence_conflicts','enterprise_assess_evidence_conflict_resolutions','enterprise_transcript_extraction_bindings'
] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);END LOOP;END$$;

CREATE POLICY enterprise_source_sets_read ON public.enterprise_source_sets FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'transcript.sources.read'));
CREATE POLICY enterprise_source_set_versions_read ON public.enterprise_source_set_versions FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'transcript.sources.read'));
CREATE POLICY enterprise_source_set_items_read ON public.enterprise_source_set_version_items FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'transcript.sources.read'));
CREATE POLICY enterprise_input_bundles_read ON public.enterprise_module_input_bundles FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'transcript.sources.read'));
CREATE POLICY enterprise_input_bundle_versions_read ON public.enterprise_module_input_bundle_versions FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'transcript.sources.read'));
CREATE POLICY enterprise_input_bundle_items_read ON public.enterprise_module_input_bundle_items FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'transcript.sources.read'));
CREATE POLICY enterprise_journeys_read ON public.enterprise_governed_journeys FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_journey_versions_read ON public.enterprise_governed_journey_versions FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_assess_previews_read ON public.enterprise_assess_apply_previews FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_assess_preview_batches_read ON public.enterprise_assess_apply_preview_batches FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_assess_applications_read ON public.enterprise_assess_candidate_applications FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_candidate_relationship_reviews_read ON public.enterprise_evidence_candidate_relationship_reviews FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_assess_conflicts_read ON public.enterprise_assess_evidence_conflicts FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));
CREATE POLICY enterprise_assess_conflict_resolutions_read ON public.enterprise_assess_evidence_conflict_resolutions FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));

REVOKE ALL ON FUNCTION public.enterprise_transcript_reject_immutable(),public.enterprise_transcript_assert_receipt(uuid,uuid,uuid,uuid,text,text,bigint,uuid,bigint,text),
 public.enterprise_transcript_preview_resolution(uuid),public.enterprise_transcript_block_unresolved_material_conflicts() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.enterprise_transcript_create_source_set_version(uuid,text,text,text,text,jsonb,boolean,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_lock_input_bundle(uuid,jsonb,text,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_set_journey_state(uuid,text,text,text,bigint,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_review_assess_candidate(uuid,bigint,text,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_create_assess_apply_preview(uuid,uuid,bigint,uuid,uuid,text,text,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_create_assess_apply_preview_batch(uuid,uuid,bigint,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_resolve_assess_conflict(uuid,bigint,text,uuid,jsonb,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_commit_assess_apply_batch(uuid,bigint,uuid,text,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_commit_assess_apply_preview_batch(uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_transcript_create_source_set_version(uuid,text,text,text,text,jsonb,boolean,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_lock_input_bundle(uuid,jsonb,text,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_set_journey_state(uuid,text,text,text,bigint,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_review_assess_candidate(uuid,bigint,text,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_create_assess_apply_preview_batch(uuid,uuid,bigint,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_resolve_assess_conflict(uuid,bigint,text,uuid,jsonb,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_commit_assess_apply_preview_batch(uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint)
 TO service_role;
REVOKE ALL ON FUNCTION public.enterprise_transcript_assess_projection(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.enterprise_transcript_assess_projection(uuid,uuid) TO authenticated;

COMMENT ON TABLE public.enterprise_transcript_workspace_flags IS 'Default-off workspace rollout controls. Client visibility never grants authority.';
COMMENT ON TABLE public.enterprise_source_set_versions IS 'Immutable ordered Assess/Studio-owned source-set versions over reusable existing source versions.';
COMMENT ON TABLE public.enterprise_module_input_bundle_versions IS 'Exact locked module input lineage; unselected sources cannot enter extraction or application.';
COMMENT ON FUNCTION public.enterprise_transcript_commit_assess_apply_batch(uuid,bigint,uuid,text,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint)
 IS 'Service-only authorization-first all-or-nothing application of 1-100 bound previews into exactly one immutable Assess draft version.';

-- Extend the accepted fenced extraction claim without forking its recovery
-- state machine. Fail migration atomically if the accepted definition drifts.
DO $$DECLARE original text;patched text;signature regprocedure:=
 'public.enterprise_claim_or_resume_evidence_extraction_job_v2(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,uuid,bigint)'::regprocedure;
BEGIN
 SELECT pg_get_functiondef(signature) INTO original;
 patched:=replace(original,'receipt.command_type<>''evidence.extract''','receipt.command_type NOT IN (''evidence.extract'',''transcript.assess.extract'')');
 patched:=replace(patched,'receipt.command_type <> ''evidence.extract''','receipt.command_type NOT IN (''evidence.extract'',''transcript.assess.extract'')');
 IF patched=original THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_EXTRACTION_AUTHORITY_PATCH_REQUIRED';END IF;
 EXECUTE patched;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_bind_assess_extraction(
 p_job uuid,p_bundle_version uuid,p_bundle_hash text,p_source uuid,p_source_version uuid,p_route uuid,p_provider_config uuid,p_model text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;b public.enterprise_module_input_bundle_versions;j public.enterprise_ai_job_ledger;binding public.enterprise_transcript_extraction_bindings;result jsonb;
BEGIN
 r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.assess.extract','evidence.write',p_authorization_version,p_execution_token,p_execution_fence,'unified_byok');
 SELECT * INTO b FROM public.enterprise_module_input_bundle_versions WHERE id=p_bundle_version AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
 SELECT * INTO j FROM public.enterprise_ai_job_ledger WHERE id=p_job AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF b.id IS NULL OR b.bundle_hash IS DISTINCT FROM p_bundle_hash OR j.id IS NULL OR j.actor_id IS DISTINCT FROM p_actor OR j.source_id IS DISTINCT FROM p_source
    OR j.source_version_id IS DISTINCT FROM p_source_version OR j.route_id IS DISTINCT FROM p_route OR j.provider_config_id IS DISTINCT FROM p_provider_config OR j.model IS DISTINCT FROM p_model
    OR NOT EXISTS(SELECT 1 FROM public.enterprise_module_input_bundle_items bi JOIN public.enterprise_source_set_version_items si ON si.source_set_version_id=bi.source_set_version_id
      WHERE bi.input_bundle_version_id=b.id AND si.source_id=p_source AND si.source_version_id=p_source_version) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_EXTRACTION_BINDING_STALE';END IF;
 INSERT INTO public.enterprise_transcript_extraction_bindings(org_id,workspace_id,job_id,receipt_id,input_bundle_version_id,input_bundle_id,bundle_hash,source_id,source_version_id,
  provider_route_id,provider_config_id,model,authorization_version,created_by)
 VALUES(p_org,p_workspace,j.id,r.id,b.id,b.input_bundle_id,b.bundle_hash,p_source,p_source_version,p_route,p_provider_config,p_model,p_authorization_version,p_actor)
 ON CONFLICT(receipt_id) DO NOTHING RETURNING * INTO binding;
 IF binding.id IS NULL THEN SELECT * INTO binding FROM public.enterprise_transcript_extraction_bindings WHERE receipt_id=r.id FOR SHARE;END IF;
 IF binding.job_id IS DISTINCT FROM j.id OR binding.input_bundle_version_id IS DISTINCT FROM b.id OR binding.bundle_hash IS DISTINCT FROM b.bundle_hash
    OR binding.source_version_id IS DISTINCT FROM p_source_version OR binding.provider_route_id IS DISTINCT FROM p_route OR binding.provider_config_id IS DISTINCT FROM p_provider_config
    OR binding.model IS DISTINCT FROM p_model THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_EXTRACTION_BINDING_STALE';END IF;
 result:=jsonb_build_object('jobId',j.id,'inputBundleVersionId',b.id,'bundleHash',b.bundle_hash,'sourceId',p_source,'sourceVersionId',p_source_version,'bound',true);
 RETURN result;
END$$;
REVOKE ALL ON FUNCTION public.enterprise_transcript_bind_assess_extraction(uuid,uuid,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_transcript_bind_assess_extraction(uuid,uuid,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint) TO service_role;

COMMENT ON FUNCTION public.enterprise_transcript_bind_assess_extraction(uuid,uuid,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint)
 IS 'Service-only authorization-first exact locked-bundle binding before the unified budget reservation and provider effect.';
