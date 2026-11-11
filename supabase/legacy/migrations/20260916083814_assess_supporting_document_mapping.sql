-- Governed Assess supporting-document mapping.
-- Forward-only and default-off. Rollback is feature disablement/read-only use;
-- immutable mapping and Assess history is retained for audit.

ALTER TABLE public.enterprise_transcript_workspace_flags
  ADD COLUMN assess_document_mapping_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.enterprise_evidence_sources
  DROP CONSTRAINT enterprise_evidence_sources_mime_type_check,
  ADD CONSTRAINT enterprise_evidence_sources_mime_type_check CHECK (mime_type IN (
    'text/plain','text/markdown','text/csv','text/vtt','application/x-subrip',
    'text/x-srt','text/meeting-notes','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ));

ALTER TABLE public.enterprise_evidence_source_versions
  DROP CONSTRAINT enterprise_evidence_source_versions_parser_kind_check,
  ADD CONSTRAINT enterprise_evidence_source_versions_parser_kind_check
    CHECK (parser_kind IN ('text_native','csv','vtt','srt','pdf_text','docx','xlsx'));

CREATE OR REPLACE FUNCTION public.enterprise_command_runtime_area(p_command_type text,p_resource_type text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$BEGIN
 IF p_resource_type IS NOT NULL AND p_command_type NOT IN('approval.review.record','approval.record') THEN RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';END IF;
 CASE p_command_type
  WHEN 'provider.register','provider.secret.bind','provider.validate','provider.activate','provider.route.toggle','provider.secret.rotate','provider.revoke' THEN RETURN 'provider';
  WHEN 'evidence.source.create','evidence.extract','evidence.candidate.review','evidence.assess.promote',
       'transcript.source-set.create-version','transcript.input-bundle.lock','transcript.assess.extract','transcript.assess.candidate.review',
       'transcript.assess.apply.preview','transcript.assess.apply.commit','transcript.assess.conflict.resolve','transcript.journey.set-state',
       'assess.document-map.analyze','assess.document-map.proposal.review','assess.document-map.preview',
       'assess.document-map.conflict.resolve','assess.document-map.commit' THEN RETURN 'ingestion';
  WHEN 'modernization.evaluate','studio.delivery.handoff','monitor.baseline.create' THEN RETURN 'delivery';
  WHEN 'assemble.blueprint.create' THEN RETURN 'assemble';
  WHEN 'approval.review.record','approval.record' THEN
   IF p_resource_type='assemble_blueprint' THEN RETURN 'assemble';END IF;
   IF p_resource_type IN('modernization_decision','delivery_work_package','monitor_baseline','evidence_candidate') THEN RETURN 'delivery';END IF;
   RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
  ELSE RAISE EXCEPTION 'ENTERPRISE_AI_INVALID_COMMAND_AREA';
 END CASE;
END$$;

CREATE TABLE public.enterprise_assess_document_mapping_catalogs(
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 assess_case_id uuid NOT NULL,assess_case_version_id uuid NOT NULL,case_version bigint NOT NULL CHECK(case_version>0),
 assess_schema_version text NOT NULL CHECK(assess_schema_version='assess-v2-schema-2026-07'),
 contract_version text NOT NULL CHECK(contract_version='assess-supporting-document-map-v1'),
 catalog_version bigint NOT NULL CHECK(catalog_version=1),catalog_hash text NOT NULL CHECK(catalog_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('current','stale')),receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(receipt_id),UNIQUE(org_id,workspace_id,assess_case_id,case_version,catalog_hash),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(assess_case_version_id,assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_targets(
 selector_id uuid PRIMARY KEY,catalog_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 target_kind text NOT NULL CHECK(target_kind IN('case_field','primitive_field','primitive_fact','agent_fact','asset_field','interaction_field','interaction_fact','create_primitive','create_asset','create_interaction','create_decision_point','create_exception_path','evidence_only')),
 operation text NOT NULL CHECK(operation IN('set_field','set_fact','create_entity','link_evidence')),
 entity_id uuid,field_id text NOT NULL CHECK(length(btrim(field_id)) BETWEEN 1 AND 120),label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 240),
 context_label text NOT NULL DEFAULT '' CHECK(length(context_label)<=240),value_type text NOT NULL CHECK(value_type IN('text','boolean','ratio','number','text_list','primitive_type','business_disposition','interaction_mode','data_classification','asset_strategic_lifespan','asset_technical_health','asset_business_criticality','asset_ownership_model','asset_vendor_roadmap','asset_operating_stability','primitive_constructor','asset_constructor','interaction_constructor','decision_constructor','exception_constructor','evidence')),
 allowed_values jsonb CHECK(allowed_values IS NULL OR jsonb_typeof(allowed_values)='array'),current_value jsonb NOT NULL,current_value_hash text NOT NULL CHECK(current_value_hash~'^[0-9a-f]{64}$'),
 manual boolean NOT NULL,ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 2000),
 UNIQUE(catalog_id,ordinal),UNIQUE(catalog_id,selector_id),
 FOREIGN KEY(catalog_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_catalogs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_runs(
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 catalog_id uuid NOT NULL,assess_case_id uuid NOT NULL,case_version bigint NOT NULL CHECK(case_version>0),
 input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,input_bundle_version bigint NOT NULL CHECK(input_bundle_version>0),bundle_hash text NOT NULL CHECK(bundle_hash~'^[0-9a-f]{64}$'),
 route_id uuid NOT NULL,provider_config_id uuid NOT NULL,provider text NOT NULL,model text NOT NULL,prompt_version text NOT NULL,authorization_version bigint NOT NULL CHECK(authorization_version>0),
 status text NOT NULL CHECK(status IN('claimed','staged','committed','failed','blocked')),safe_result jsonb,output_hash text CHECK(output_hash IS NULL OR output_hash~'^[0-9a-f]{64}$'),staged_payload_hash text CHECK(staged_payload_hash IS NULL OR staged_payload_hash~'^[0-9a-f]{64}$'),
 claim_binding_hash text NOT NULL CHECK(claim_binding_hash~'^[0-9a-f]{64}$'),execution_token uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),
 failure_code text CHECK(failure_code IS NULL OR failure_code IN('BUDGET_EXHAUSTED','PROVIDER_UNSUPPORTED','SECRET_REFERENCE_UNSAFE','SECRET_UNAVAILABLE','ENDPOINT_UNSAFE','CAPABILITY_UNAVAILABLE','PROMPT_TOO_LARGE')),
 token_input integer CHECK(token_input IS NULL OR token_input>=0),token_output integer CHECK(token_output IS NULL OR token_output>=0),latency_ms integer CHECK(latency_ms IS NULL OR latency_ms>=0),
 receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(receipt_id),
 FOREIGN KEY(catalog_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_catalogs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(input_bundle_version_id,input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_run_sources(
 run_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,extraction_binding_id uuid NOT NULL,extraction_job_id uuid NOT NULL,
 source_set_id uuid NOT NULL,source_set_version_id uuid NOT NULL,expected_source_set_version bigint NOT NULL CHECK(expected_source_set_version>0),
 source_id uuid NOT NULL,source_version_id uuid NOT NULL,parser_version text NOT NULL CHECK(length(btrim(parser_version)) BETWEEN 1 AND 120),
 normalized_hash text NOT NULL CHECK(normalized_hash~'^[0-9a-f]{64}$'),extracted_byte_count bigint NOT NULL CHECK(extracted_byte_count BETWEEN 1 AND 120000),sheet_count integer NOT NULL DEFAULT 0 CHECK(sheet_count BETWEEN 0 AND 100),cell_count integer NOT NULL DEFAULT 0 CHECK(cell_count BETWEEN 0 AND 100000),warnings jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(warnings)='array' AND jsonb_array_length(warnings)<=100),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 20),
 PRIMARY KEY(run_id,source_version_id),UNIQUE(run_id,ordinal),UNIQUE(run_id,extraction_binding_id),
 FOREIGN KEY(run_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_runs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,source_id,org_id,workspace_id) REFERENCES public.enterprise_evidence_source_versions(id,source_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_proposals(
 id uuid PRIMARY KEY,run_id uuid NOT NULL,catalog_id uuid NOT NULL,target_selector_id uuid NOT NULL,
 org_id uuid NOT NULL,workspace_id uuid NOT NULL,proposal_version bigint NOT NULL DEFAULT 1 CHECK(proposal_version=1),
 proposed_value jsonb NOT NULL,confidence numeric(5,4) NOT NULL CHECK(confidence BETWEEN 0 AND 1),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),
 source_id uuid NOT NULL,source_version_id uuid NOT NULL,extraction_binding_id uuid NOT NULL,extraction_job_id uuid NOT NULL,parser_version text NOT NULL,source_locator text NOT NULL CHECK(length(btrim(source_locator)) BETWEEN 1 AND 400),anchor_hash text NOT NULL CHECK(anchor_hash~'^[0-9a-f]{64}$'),safe_excerpt text NOT NULL CHECK(length(safe_excerpt) BETWEEN 1 AND 1000),relationship text NOT NULL CHECK(relationship IN('neutral','supporting','contradictory')),
 status text NOT NULL DEFAULT 'suggested' CHECK(status='suggested'),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(run_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_runs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(catalog_id,target_selector_id) REFERENCES public.enterprise_assess_document_mapping_targets(catalog_id,selector_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),proposal_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN('accepted','edited','rejected')),
 reviewed_value jsonb NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),reviewer_id uuid NOT NULL REFERENCES public.profiles(id),authorization_version bigint NOT NULL CHECK(authorization_version>0),
 receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(proposal_id,version),UNIQUE(receipt_id),
 FOREIGN KEY(proposal_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_proposals(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_preview_batches(
 id uuid PRIMARY KEY,org_id uuid NOT NULL,workspace_id uuid NOT NULL,catalog_id uuid NOT NULL,catalog_hash text NOT NULL,
 assess_case_id uuid NOT NULL,expected_case_version bigint NOT NULL,input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,
 status text NOT NULL CHECK(status='previewed'),expires_at timestamptz NOT NULL,receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(receipt_id),
 FOREIGN KEY(catalog_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_catalogs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_preview_items(
 preview_batch_id uuid NOT NULL,proposal_id uuid NOT NULL,target_selector_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 proposal_version bigint NOT NULL CHECK(proposal_version>1),reviewed_value jsonb NOT NULL,
 planned_evidence_id uuid NOT NULL DEFAULT gen_random_uuid(),ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 100),binding_hash text NOT NULL CHECK(binding_hash~'^[0-9a-f]{64}$'),
 PRIMARY KEY(preview_batch_id,proposal_id),UNIQUE(preview_batch_id,ordinal),UNIQUE(preview_batch_id,target_selector_id,proposal_id),
 FOREIGN KEY(preview_batch_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_preview_batches(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(proposal_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_proposals(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_conflicts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),preview_batch_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,target_selector_id uuid NOT NULL,
 proposal_ids uuid[] NOT NULL CHECK(cardinality(proposal_ids) BETWEEN 1 AND 100),kind text NOT NULL CHECK(kind IN('manual','cross_source')),
 current_value_hash text NOT NULL CHECK(current_value_hash~'^[0-9a-f]{64}$'),current_resolution_version bigint NOT NULL DEFAULT 0 CHECK(current_resolution_version>=0),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),UNIQUE(preview_batch_id,target_selector_id,kind),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(preview_batch_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_preview_batches(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_conflict_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conflict_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),
 resolution text NOT NULL CHECK(resolution IN('choose_candidate','retain_manual','authored_resolution')),
 chosen_proposal_id uuid,authored_value jsonb,rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),
 resolver_id uuid NOT NULL REFERENCES public.profiles(id),authorization_version bigint NOT NULL CHECK(authorization_version>0),receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),UNIQUE(conflict_id,version),UNIQUE(receipt_id),
 FOREIGN KEY(conflict_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_conflicts(id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((resolution='choose_candidate')=(chosen_proposal_id IS NOT NULL)),CHECK((resolution='authored_resolution')=(authored_value IS NOT NULL))
);

CREATE TABLE public.enterprise_assess_document_mapping_preview_manifests(
 preview_batch_id uuid NOT NULL,manifest_version bigint NOT NULL CHECK(manifest_version>0),org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 catalog_id uuid NOT NULL,catalog_hash text NOT NULL CHECK(catalog_hash~'^[0-9a-f]{64}$'),
 assess_case_id uuid NOT NULL,case_version bigint NOT NULL CHECK(case_version>0),input_bundle_id uuid NOT NULL,input_bundle_version_id uuid NOT NULL,
 target_count integer NOT NULL CHECK(target_count BETWEEN 1 AND 2000),source_count integer NOT NULL CHECK(source_count BETWEEN 1 AND 20),
 item_count integer NOT NULL CHECK(item_count BETWEEN 1 AND 100),reviewed_count integer NOT NULL CHECK(reviewed_count BETWEEN 1 AND 100),
 conflict_count integer NOT NULL CHECK(conflict_count BETWEEN 0 AND 200),unresolved_conflict_count integer NOT NULL CHECK(unresolved_conflict_count BETWEEN 0 AND 200),
 item_set_hash text NOT NULL CHECK(item_set_hash~'^[0-9a-f]{64}$'),conflict_set_hash text NOT NULL CHECK(conflict_set_hash~'^[0-9a-f]{64}$'),resolution_set_hash text NOT NULL CHECK(resolution_set_hash~'^[0-9a-f]{64}$'),displayed_set_hash text NOT NULL CHECK(displayed_set_hash~'^[0-9a-f]{64}$'),
 item_bindings jsonb NOT NULL CHECK(jsonb_typeof(item_bindings)='array'),conflict_bindings jsonb NOT NULL CHECK(jsonb_typeof(conflict_bindings)='array'),resolution_bindings jsonb NOT NULL CHECK(jsonb_typeof(resolution_bindings)='array'),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(preview_batch_id,manifest_version),UNIQUE(preview_batch_id,manifest_version,org_id,workspace_id),
 FOREIGN KEY(preview_batch_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_preview_batches(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(catalog_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_catalogs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_assess_document_mapping_applications(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),preview_batch_id uuid NOT NULL,proposal_id uuid NOT NULL,target_selector_id uuid NOT NULL,
 org_id uuid NOT NULL,workspace_id uuid NOT NULL,assess_case_id uuid NOT NULL,assess_case_version_id uuid NOT NULL,assess_case_version bigint NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('applied','evidence_only','retained_manual','deduplicated')),evidence_id uuid NOT NULL,
 receipt_id uuid NOT NULL REFERENCES public.enterprise_ai_command_receipts(id) ON DELETE RESTRICT,batch_ordinal integer NOT NULL CHECK(batch_ordinal BETWEEN 1 AND 100),applied_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(preview_batch_id,proposal_id),UNIQUE(receipt_id,batch_ordinal),
 FOREIGN KEY(preview_batch_id,org_id,workspace_id) REFERENCES public.enterprise_assess_document_mapping_preview_batches(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(assess_case_version_id,assess_case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_reject_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_IMMUTABLE';END$$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['enterprise_assess_document_mapping_catalogs','enterprise_assess_document_mapping_targets','enterprise_assess_document_mapping_proposals','enterprise_assess_document_mapping_reviews','enterprise_assess_document_mapping_preview_batches','enterprise_assess_document_mapping_preview_items','enterprise_assess_document_mapping_conflict_resolutions','enterprise_assess_document_mapping_preview_manifests','enterprise_assess_document_mapping_applications'] LOOP EXECUTE format('CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enterprise_assess_document_mapping_reject_immutable()',t,t);END LOOP;END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_assert(
 p_receipt uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_command text,p_authorization_version bigint,p_execution_token uuid,p_execution_fence bigint,p_stage text
) RETURNS public.enterprise_ai_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;f public.enterprise_transcript_workspace_flags;cap text;
BEGIN
 SELECT * INTO r FROM public.enterprise_ai_command_receipts WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF r.id IS NULL OR r.status<>'claimed' OR r.actor_id IS DISTINCT FROM p_actor OR r.command_type IS DISTINCT FROM p_command OR r.execution_token IS DISTINCT FROM p_execution_token OR r.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';END IF;
 PERFORM public.enterprise_assert_writable('ingestion');
 FOREACH cap IN ARRAY CASE p_stage WHEN 'analyze' THEN ARRAY['assess.v2.read','assess.v2.draft.write','evidence.write'] WHEN 'review' THEN ARRAY['assess.v2.read','assess.v2.draft.write','evidence.write','evidence.review'] ELSE ARRAY['assess.v2.read','assess.v2.draft.write','evidence.write','evidence.review','transcript.assess.apply'] END LOOP
  PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,cap,p_authorization_version);
 END LOOP;
 SELECT * INTO f FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF f.org_id IS NULL OR NOT f.assess_document_mapping_enabled OR NOT f.transcript_source_sets_enabled OR NOT f.assess_multisource_apply_enabled OR (p_stage='analyze' AND NOT f.unified_byok_gateway_enabled) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_FEATURE_DISABLED';END IF;
 RETURN r;
END$$;

-- All source-set writers, including future service paths, serialize against the
-- source-set aggregate row before a new version can make a mapping run stale.
CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_lock_source_set_root()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM public.enterprise_source_sets root
 WHERE root.id=NEW.source_set_id AND root.org_id=NEW.org_id AND root.workspace_id=NEW.workspace_id
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';END IF;
 RETURN NEW;
END$$;
CREATE TRIGGER enterprise_assess_document_mapping_source_set_root_lock
BEFORE INSERT ON public.enterprise_source_set_versions
FOR EACH ROW EXECUTE FUNCTION public.enterprise_assess_document_mapping_lock_source_set_root();

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_assert_run_fresh(p_run uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run public.enterprise_assess_document_mapping_runs;catalog public.enterprise_assess_document_mapping_catalogs;
 c public.assess_v2_cases;b public.enterprise_module_input_bundle_versions;bundle_root public.enterprise_module_input_bundles;
BEGIN
 SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE id=p_run FOR SHARE;
 SELECT * INTO catalog FROM public.enterprise_assess_document_mapping_catalogs WHERE id=run.catalog_id FOR SHARE;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=run.assess_case_id AND org_id=run.org_id AND workspace_id=run.workspace_id FOR SHARE;
 SELECT version.* INTO b FROM public.enterprise_module_input_bundle_versions version
 WHERE version.id=run.input_bundle_version_id AND version.input_bundle_id=run.input_bundle_id
   AND version.org_id=run.org_id AND version.workspace_id=run.workspace_id FOR SHARE;
 SELECT root.* INTO bundle_root FROM public.enterprise_module_input_bundles root
 WHERE root.id=run.input_bundle_id AND root.org_id=run.org_id AND root.workspace_id=run.workspace_id FOR SHARE;
 -- This ordered aggregate-root lock conflicts with both the canonical writer's
 -- FOR UPDATE and the defensive before-insert trigger above.
 PERFORM 1 FROM public.enterprise_source_sets root
 JOIN public.enterprise_source_set_versions version ON version.source_set_id=root.id AND version.org_id=root.org_id AND version.workspace_id=root.workspace_id
 JOIN (SELECT DISTINCT source_set_id,source_set_version_id,expected_source_set_version,org_id,workspace_id FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id) bound
   ON bound.source_set_id=root.id AND bound.source_set_version_id=version.id AND bound.org_id=root.org_id AND bound.workspace_id=root.workspace_id
 ORDER BY root.id FOR SHARE OF root,version;
 IF run.id IS NULL OR catalog.id IS NULL OR catalog.status<>'current' OR catalog.assess_case_id IS DISTINCT FROM run.assess_case_id
   OR catalog.case_version IS DISTINCT FROM run.case_version OR c.id IS NULL OR c.status<>'draft' OR c.deleted_at IS NOT NULL
   OR c.version IS DISTINCT FROM run.case_version OR c.head_version_id IS DISTINCT FROM catalog.assess_case_version_id
   OR b.id IS NULL OR b.status<>'locked' OR b.version IS DISTINCT FROM run.input_bundle_version OR b.bundle_hash IS DISTINCT FROM run.bundle_hash
   OR bundle_root.id IS NULL OR bundle_root.current_version IS DISTINCT FROM run.input_bundle_version
   OR EXISTS(SELECT 1 FROM public.enterprise_transcript_staleness_events stale WHERE stale.resource_kind='input_bundle_version' AND stale.resource_id=run.input_bundle_version_id)
   OR EXISTS(
     SELECT 1 FROM public.enterprise_assess_document_mapping_run_sources source
     LEFT JOIN public.enterprise_module_input_bundle_items bundle_item ON bundle_item.input_bundle_version_id=run.input_bundle_version_id
       AND bundle_item.source_set_id=source.source_set_id AND bundle_item.source_set_version_id=source.source_set_version_id
     LEFT JOIN public.enterprise_source_set_versions set_version ON set_version.id=source.source_set_version_id AND set_version.source_set_id=source.source_set_id
       AND set_version.org_id=source.org_id AND set_version.workspace_id=source.workspace_id
     LEFT JOIN public.enterprise_source_sets root ON root.id=source.source_set_id AND root.org_id=source.org_id AND root.workspace_id=source.workspace_id
     LEFT JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=source.source_set_version_id
       AND source_item.source_set_id=source.source_set_id AND source_item.source_version_id=source.source_version_id AND source_item.source_id=source.source_id
     LEFT JOIN public.enterprise_evidence_source_versions source_version ON source_version.id=source.source_version_id AND source_version.source_id=source.source_id
       AND source_version.org_id=source.org_id AND source_version.workspace_id=source.workspace_id
     WHERE source.run_id=run.id AND (bundle_item.input_bundle_version_id IS NULL OR set_version.id IS NULL OR set_version.version IS DISTINCT FROM source.expected_source_set_version
       OR set_version.status<>'locked' OR root.id IS NULL OR root.current_version IS DISTINCT FROM source.expected_source_set_version
       OR source_item.source_version_id IS NULL OR source_version.id IS NULL OR source_version.extraction_status<>'parsed')
   )
   OR EXISTS(
     SELECT item.source_version_id FROM public.enterprise_module_input_bundle_items bundle_item
     JOIN public.enterprise_source_set_version_items item ON item.source_set_version_id=bundle_item.source_set_version_id AND item.source_set_id=bundle_item.source_set_id
     WHERE bundle_item.input_bundle_version_id=run.input_bundle_version_id
     EXCEPT SELECT source.source_version_id FROM public.enterprise_assess_document_mapping_run_sources source WHERE source.run_id=run.id
   )
 THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_SOURCE_STALE';END IF;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_preview_manifest_json(p_batch uuid,p_manifest_version bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE batch public.enterprise_assess_document_mapping_preview_batches;items jsonb;conflicts jsonb;resolutions jsonb;
 target_count int;source_count int;item_count int;reviewed_count int;conflict_count int;unresolved_count int;item_hash text;conflict_hash text;resolution_hash text;displayed_hash text;
BEGIN
 IF p_manifest_version IS NULL OR p_manifest_version<1 THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_PREVIEW_STALE';END IF;
 SELECT * INTO batch FROM public.enterprise_assess_document_mapping_preview_batches WHERE id=p_batch FOR SHARE;
 IF batch.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_PREVIEW_STALE';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('ordinal',item.ordinal,'proposalId',item.proposal_id,'proposalVersion',item.proposal_version,'targetSelectorId',item.target_selector_id,'reviewedValue',item.reviewed_value,'bindingHash',item.binding_hash) ORDER BY item.ordinal),'[]'::jsonb),count(*)::int
 INTO items,item_count FROM public.enterprise_assess_document_mapping_preview_items item WHERE item.preview_batch_id=batch.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('conflictId',conflict.id,'targetSelectorId',conflict.target_selector_id,'kind',conflict.kind,'proposalIds',to_jsonb(conflict.proposal_ids),'currentValueHash',conflict.current_value_hash,'currentResolutionVersion',conflict.current_resolution_version) ORDER BY conflict.target_selector_id,conflict.kind),'[]'::jsonb),count(*)::int,
   count(*) FILTER(WHERE conflict.current_resolution_version=0)::int
 INTO conflicts,conflict_count,unresolved_count FROM public.enterprise_assess_document_mapping_conflicts conflict WHERE conflict.preview_batch_id=batch.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('conflictId',conflict.id,'version',resolution.version,'resolution',resolution.resolution,'chosenProposalId',resolution.chosen_proposal_id,'authoredValue',resolution.authored_value,'rationale',resolution.rationale) ORDER BY conflict.target_selector_id,conflict.kind),'[]'::jsonb)
 INTO resolutions FROM public.enterprise_assess_document_mapping_conflicts conflict
 JOIN public.enterprise_assess_document_mapping_conflict_resolutions resolution ON resolution.conflict_id=conflict.id AND resolution.version=conflict.current_resolution_version
 WHERE conflict.preview_batch_id=batch.id;
 SELECT count(*)::int INTO unresolved_count FROM public.enterprise_assess_document_mapping_conflicts conflict
 LEFT JOIN public.enterprise_assess_document_mapping_conflict_resolutions resolution ON resolution.conflict_id=conflict.id AND resolution.version=conflict.current_resolution_version
 WHERE conflict.preview_batch_id=batch.id AND resolution.id IS NULL;
 SELECT count(*)::int INTO target_count FROM public.enterprise_assess_document_mapping_targets target WHERE target.catalog_id=batch.catalog_id;
 SELECT count(DISTINCT source.source_version_id)::int INTO source_count
 FROM public.enterprise_assess_document_mapping_preview_items item
 JOIN public.enterprise_assess_document_mapping_proposals proposal ON proposal.id=item.proposal_id
 JOIN public.enterprise_assess_document_mapping_run_sources source ON source.run_id=proposal.run_id
 WHERE item.preview_batch_id=batch.id;
 SELECT count(*)::int INTO reviewed_count FROM public.enterprise_assess_document_mapping_preview_items item
 JOIN public.enterprise_assess_document_mapping_reviews review ON review.proposal_id=item.proposal_id AND review.version=item.proposal_version
 WHERE item.preview_batch_id=batch.id AND review.status IN('accepted','edited');
 item_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('items',items));
 conflict_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('conflicts',conflicts));
 resolution_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('resolutions',resolutions));
 displayed_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('previewBatchId',batch.id,'manifestVersion',p_manifest_version,'catalogId',batch.catalog_id,'catalogHash',batch.catalog_hash,'caseId',batch.assess_case_id,'caseVersion',batch.expected_case_version,'inputBundleId',batch.input_bundle_id,'inputBundleVersionId',batch.input_bundle_version_id,'targetCount',target_count,'sourceCount',source_count,'itemCount',item_count,'reviewedCount',reviewed_count,'conflictCount',conflict_count,'unresolvedConflictCount',unresolved_count,'itemSetHash',item_hash,'conflictSetHash',conflict_hash,'resolutionSetHash',resolution_hash));
 RETURN jsonb_build_object('previewBatchId',batch.id,'manifestVersion',p_manifest_version,'catalogId',batch.catalog_id,'catalogHash',batch.catalog_hash,'caseId',batch.assess_case_id,'caseVersion',batch.expected_case_version,'inputBundleId',batch.input_bundle_id,'inputBundleVersionId',batch.input_bundle_version_id,'targetCount',target_count,'sourceCount',source_count,'itemCount',item_count,'reviewedCount',reviewed_count,'conflictCount',conflict_count,'unresolvedConflictCount',unresolved_count,'itemSetHash',item_hash,'conflictSetHash',conflict_hash,'resolutionSetHash',resolution_hash,'displayedSetHash',displayed_hash);
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_value_valid(p_type text,p_value jsonb,p_allowed jsonb DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE x jsonb;
BEGIN
 IF p_allowed IS NOT NULL AND p_type NOT LIKE '%_constructor' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_allowed) a WHERE a.value=p_value) THEN RETURN false;END IF;
 IF p_type='text' THEN RETURN jsonb_typeof(p_value)='string' AND length(btrim(p_value#>>'{}')) BETWEEN 1 AND 4000;
 ELSIF p_type='boolean' THEN RETURN jsonb_typeof(p_value)='boolean';
 ELSIF p_type='ratio' THEN RETURN jsonb_typeof(p_value)='number' AND (p_value#>>'{}')::numeric BETWEEN 0 AND 1;
 ELSIF p_type='number' THEN RETURN jsonb_typeof(p_value)='number' AND (p_value#>>'{}')::numeric BETWEEN 0 AND 10000000;
 ELSIF p_type='text_list' THEN RETURN jsonb_typeof(p_value)='array' AND jsonb_array_length(p_value)<=200 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>1000);
 ELSIF p_type IN('primitive_type','business_disposition','interaction_mode','data_classification','asset_strategic_lifespan','asset_technical_health','asset_business_criticality','asset_ownership_model','asset_vendor_roadmap','asset_operating_stability') THEN RETURN jsonb_typeof(p_value)='string';
 ELSIF p_type='evidence' THEN RETURN jsonb_typeof(p_value) IN('null','string');
 ELSIF p_type LIKE '%_constructor' THEN RETURN jsonb_typeof(p_value)='object' AND NOT (p_value ? 'id');
END IF;RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_target_value_valid(p_target public.enterprise_assess_document_mapping_targets,p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE maximum integer;
BEGIN
 IF public.enterprise_assess_document_mapping_value_valid(p_target.value_type,p_value,p_target.allowed_values) IS NOT TRUE THEN RETURN false;END IF;
 IF p_target.value_type<>'text' THEN RETURN true;END IF;
 maximum:=CASE p_target.field_id WHEN 'case.description' THEN 4000 WHEN 'primitive.description' THEN 4000 WHEN 'primitive.trigger' THEN 500 ELSE 200 END;
 RETURN length(p_value#>>'{}')<=maximum;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_payload_valid(p_kind text,p_value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF p_kind NOT IN('create_primitive','create_asset','create_interaction','create_decision_point','create_exception_path') THEN RETURN true;END IF;
 IF jsonb_typeof(p_value)<>'object' THEN RETURN false;END IF;
 IF p_kind='create_primitive' THEN RETURN p_value ?& ARRAY['name','description'] AND (p_value-ARRAY['name','description','trigger','inputs','outputs','owner','rules'])='{}'::jsonb AND jsonb_typeof(p_value->'name')='string' AND jsonb_typeof(p_value->'description')='string' AND length(btrim(p_value->>'name')) BETWEEN 1 AND 200 AND length(btrim(p_value->>'description')) BETWEEN 1 AND 4000 AND (NOT p_value?'trigger' OR (jsonb_typeof(p_value->'trigger')='string' AND length(p_value->>'trigger')<=500)) AND (NOT p_value?'owner' OR (jsonb_typeof(p_value->'owner')='string' AND length(p_value->>'owner')<=200)) AND (NOT p_value?'inputs' OR (jsonb_typeof(p_value->'inputs')='array' AND jsonb_array_length(p_value->'inputs')<=200 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'inputs') x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>1000))) AND (NOT p_value?'outputs' OR (jsonb_typeof(p_value->'outputs')='array' AND jsonb_array_length(p_value->'outputs')<=200 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'outputs') x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>1000))) AND (NOT p_value?'rules' OR (jsonb_typeof(p_value->'rules')='array' AND jsonb_array_length(p_value->'rules')<=200 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'rules') x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>1000)));
 ELSIF p_kind='create_asset' THEN RETURN p_value ? 'name' AND (p_value-ARRAY['name','accountableOwner'])='{}'::jsonb AND jsonb_typeof(p_value->'name')='string' AND length(btrim(p_value->>'name')) BETWEEN 1 AND 200 AND (NOT p_value?'accountableOwner' OR (jsonb_typeof(p_value->'accountableOwner')='string' AND length(p_value->>'accountableOwner')<=200));
 ELSIF p_kind='create_interaction' THEN RETURN p_value ?& ARRAY['operationName','mode','dataClassification','highImpact','financialAction','untrustedContentWithTools'] AND (p_value-ARRAY['operationName','mode','dataClassification','highImpact','financialAction','untrustedContentWithTools'])='{}'::jsonb AND jsonb_typeof(p_value->'operationName')='string' AND length(btrim(p_value->>'operationName')) BETWEEN 1 AND 200 AND p_value->>'mode' IN('read','write','event','ui','operational') AND p_value->>'dataClassification' IN('Public','Internal','Confidential','Restricted','Unknown') AND jsonb_typeof(p_value->'highImpact')='boolean' AND jsonb_typeof(p_value->'financialAction')='boolean' AND jsonb_typeof(p_value->'untrustedContentWithTools')='boolean';
 ELSIF p_kind='create_decision_point' THEN RETURN p_value ?& ARRAY['name','ruleDescription','outcomeLabels'] AND (p_value-ARRAY['name','ruleDescription','outcomeLabels'])='{}'::jsonb AND jsonb_typeof(p_value->'name')='string' AND length(btrim(p_value->>'name')) BETWEEN 1 AND 200 AND jsonb_typeof(p_value->'ruleDescription')='string' AND length(btrim(p_value->>'ruleDescription')) BETWEEN 1 AND 2000 AND jsonb_typeof(p_value->'outcomeLabels')='array' AND jsonb_array_length(p_value->'outcomeLabels')<=20 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value->'outcomeLabels') x WHERE jsonb_typeof(x.value)<>'string' OR length(x.value#>>'{}')>1000);
 ELSIF p_kind='create_exception_path' THEN RETURN p_value ?& ARRAY['name','trigger'] AND (p_value-ARRAY['name','trigger'])='{}'::jsonb AND jsonb_typeof(p_value->'name')='string' AND length(btrim(p_value->>'name')) BETWEEN 1 AND 200 AND jsonb_typeof(p_value->'trigger')='string' AND length(btrim(p_value->>'trigger')) BETWEEN 1 AND 2000;
 END IF;RETURN true;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_target_current(p_version uuid,p_kind text,p_entity uuid,p_field text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v public.assess_v2_case_versions;payload jsonb;key text;fact_key text;
BEGIN
 SELECT * INTO v FROM public.assess_v2_case_versions WHERE id=p_version;
 IF p_kind='case_field' THEN RETURN CASE p_field WHEN 'case.name' THEN to_jsonb(v.name) WHEN 'case.description' THEN to_jsonb(v.description) ELSE NULL END;END IF;
 IF p_kind='agent_fact' AND p_entity IS NULL THEN RETURN v.agent_necessity#>ARRAY[replace(p_field,'agent.',''),'value'];END IF;
 IF p_kind IN('create_primitive','create_asset','create_interaction','create_decision_point','create_exception_path','evidence_only') THEN RETURN 'null'::jsonb;END IF;
 IF p_kind IN('primitive_field','primitive_fact','agent_fact') THEN SELECT item.payload INTO payload FROM public.assess_v2_primitives item WHERE item.version_id=p_version AND item.id=p_entity;
 ELSIF p_kind='asset_field' THEN SELECT item.payload INTO payload FROM public.assess_v2_application_assets item WHERE item.version_id=p_version AND item.id=p_entity;
 ELSIF p_kind IN('interaction_field','interaction_fact') THEN SELECT item.payload INTO payload FROM public.assess_v2_application_interactions item WHERE item.version_id=p_version AND item.id=p_entity;END IF;
 IF payload IS NULL THEN RETURN NULL;END IF;
 IF p_kind='primitive_fact' THEN fact_key:=CASE WHEN payload->'facts' ? p_field THEN p_field WHEN payload->'facts' ? replace(p_field,'primitive.','') THEN replace(p_field,'primitive.','') ELSE NULL END;RETURN CASE WHEN fact_key IS NULL THEN 'null'::jsonb ELSE payload#>ARRAY['facts',fact_key,'value'] END;END IF;
 IF p_kind='agent_fact' THEN RETURN payload#>ARRAY['agentNecessity',replace(p_field,'agent.',''),'value'];END IF;
 IF p_kind='interaction_fact' THEN RETURN payload#>ARRAY['facts',replace(p_field,'interaction.','')];END IF;
 key:=replace(replace(replace(p_field,'primitive.',''),'asset.',''),'interaction.','');
 IF p_kind='primitive_field' AND key IN('trigger','owner','businessDisposition') THEN RETURN COALESCE(payload->key,'""'::jsonb);END IF;
 IF p_kind='asset_field' AND key='accountableOwner' THEN RETURN CASE WHEN jsonb_typeof(payload->key)='null' OR NOT(payload ? key) THEN '""'::jsonb ELSE payload->key END;END IF;
 RETURN payload->key;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_mapping_target_valid(p_version uuid,p_target jsonb,p_current jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE kind text:=p_target->>'targetKind';operation text:=p_target->>'operation';field text:=p_target->>'fieldId';value_type text:=p_target->>'valueType';entity uuid:=NULLIF(p_target->>'entityId','')::uuid;allowed jsonb:=p_target->'allowedValues';derived_manual boolean;primitive_type text;asset_id uuid;primitive_id uuid;
BEGIN
 IF jsonb_typeof(p_target)<>'object' OR jsonb_typeof(p_target->'manual')<>'boolean' OR p_current IS NULL THEN RETURN false;END IF;
 derived_manual:=kind NOT IN('create_primitive','create_asset','create_interaction','create_decision_point','create_exception_path','evidence_only') AND jsonb_typeof(p_current)<>'null' AND NOT(jsonb_typeof(p_current)='string' AND p_current#>>'{}'='');
 IF (p_target->>'manual')::boolean IS DISTINCT FROM derived_manual THEN RETURN false;END IF;
 IF kind='case_field' THEN RETURN entity IS NULL AND operation='set_field' AND field IN('case.name','case.description') AND value_type='text' AND allowed IS NULL;
 ELSIF kind='primitive_field' THEN
  IF entity IS NULL OR operation<>'set_field' OR NOT EXISTS(SELECT 1 FROM public.assess_v2_primitives WHERE version_id=p_version AND id=entity) THEN RETURN false;END IF;
  IF field IN('primitive.name','primitive.description','primitive.trigger','primitive.owner') THEN RETURN value_type='text' AND allowed IS NULL;
  ELSIF field IN('primitive.inputs','primitive.outputs','primitive.rules') THEN RETURN value_type='text_list' AND allowed IS NULL;
  ELSIF field='primitive.volumeShare' THEN RETURN value_type='ratio' AND allowed IS NULL;
  ELSIF field='primitive.manualEffort' THEN RETURN value_type='number' AND allowed IS NULL;
  ELSIF field='primitive.type' THEN RETURN value_type='primitive_type' AND allowed='["Capture","Extract","Classify","Validate","Calculate","Reconcile","Retrieve","Investigate","Decide","Approve","Route","Execute","Communicate","Monitor","Audit"]'::jsonb;
  ELSIF field='primitive.businessDisposition' THEN RETURN value_type='business_disposition' AND allowed='["Monitor / Do Nothing","Simplify","Redesign","Human-Led","Existing Product Configuration","Custom Application"]'::jsonb;
  END IF;RETURN false;
 ELSIF kind='primitive_fact' THEN RETURN entity IS NOT NULL AND operation='set_fact' AND value_type='boolean' AND allowed IS NULL AND field=ANY(ARRAY['primitive.documentQualityRepresentative','primitive.exceptionSamplesAvailable','primitive.rulesStable','primitive.interfaceDependencyKnown','primitive.workflowPatternKnown','primitive.ambiguityCharacterized','primitive.controlRequirementsKnown']) AND EXISTS(SELECT 1 FROM public.assess_v2_primitives WHERE version_id=p_version AND id=entity);
 ELSIF kind='agent_fact' THEN RETURN entity IS NULL AND operation='set_fact' AND value_type='boolean' AND allowed IS NULL AND field=ANY(ARRAY['agent.irreducibleAmbiguity','agent.adaptiveNextStep','agent.toolOrPathSelection','agent.incrementalValue','agent.controllable']);
 ELSIF kind='asset_field' THEN
  IF entity IS NULL OR operation<>'set_field' OR NOT EXISTS(SELECT 1 FROM public.assess_v2_application_assets WHERE version_id=p_version AND id=entity) THEN RETURN false;END IF;
  IF field IN('asset.name','asset.accountableOwner') THEN RETURN value_type='text' AND allowed IS NULL;
  ELSIF field='asset.strategicLifespan' THEN RETURN value_type='asset_strategic_lifespan' AND allowed='["short","medium","long","unknown"]'::jsonb;
  ELSIF field='asset.technicalHealth' THEN RETURN value_type='asset_technical_health' AND allowed='["healthy","constrained","end-of-life","unknown"]'::jsonb;
  ELSIF field='asset.businessCriticality' THEN RETURN value_type='asset_business_criticality' AND allowed='["low","medium","high","critical","unknown"]'::jsonb;
  ELSIF field='asset.ownershipModel' THEN RETURN value_type='asset_ownership_model' AND allowed='["source-owned","vendor-owned","shared","unknown"]'::jsonb;
  ELSIF field='asset.vendorRoadmap' THEN RETURN value_type='asset_vendor_roadmap' AND allowed='["supportive","constrained","end-of-life","unknown"]'::jsonb;
  ELSIF field='asset.operatingStability' THEN RETURN value_type='asset_operating_stability' AND allowed='["stable","variable","unstable","unknown"]'::jsonb;
  END IF;RETURN false;
 ELSIF kind='interaction_field' THEN
  IF entity IS NULL OR operation<>'set_field' OR NOT EXISTS(SELECT 1 FROM public.assess_v2_application_interactions WHERE version_id=p_version AND id=entity) THEN RETURN false;END IF;
  IF field='interaction.operationName' THEN RETURN value_type='text' AND allowed IS NULL;
  ELSIF field='interaction.mode' THEN RETURN value_type='interaction_mode' AND allowed='["read","write","event","ui","operational"]'::jsonb;
  ELSIF field='interaction.dataClassification' THEN RETURN value_type='data_classification' AND allowed='["Public","Internal","Confidential","Restricted","Unknown"]'::jsonb;
  END IF;RETURN false;
 ELSIF kind='interaction_fact' THEN RETURN entity IS NOT NULL AND operation='set_fact' AND value_type='boolean' AND allowed IS NULL AND field=ANY(ARRAY['interaction.interfaceAvailable','interaction.operationCovered','interaction.apiDocumented','interaction.machineIdentity','interaction.leastPrivilege','interaction.dataQuality','interaction.dataClassified','interaction.auditable','interaction.idempotent','interaction.compensatable','interaction.rollback','interaction.testEnvironment','interaction.monitored','interaction.uiStable','interaction.eventSemantics','interaction.errorContract','interaction.capacityKnown','interaction.accountableOwner','interaction.highImpact','interaction.financialAction','interaction.untrustedContentWithTools']) AND EXISTS(SELECT 1 FROM public.assess_v2_application_interactions WHERE version_id=p_version AND id=entity AND payload#>ARRAY['facts',replace(field,'interaction.','')] IS NOT NULL);
 ELSIF kind='create_primitive' THEN primitive_type:=split_part(field,':',2);RETURN entity IS NULL AND operation='create_entity' AND field='create.primitive:'||primitive_type AND primitive_type=ANY(ARRAY['Capture','Extract','Classify','Validate','Calculate','Reconcile','Retrieve','Investigate','Decide','Approve','Route','Execute','Communicate','Monitor','Audit']) AND value_type='primitive_constructor' AND allowed=jsonb_build_array(primitive_type);
 ELSIF kind='create_asset' THEN RETURN entity IS NULL AND operation='create_entity' AND field='create.asset' AND value_type='asset_constructor' AND allowed IS NULL;
 ELSIF kind='create_interaction' THEN asset_id:=split_part(field,':',2)::uuid;primitive_id:=split_part(field,':',3)::uuid;RETURN operation='create_entity' AND entity=asset_id AND field='create.interaction:'||asset_id::text||':'||primitive_id::text AND value_type='interaction_constructor' AND allowed IS NULL AND EXISTS(SELECT 1 FROM public.assess_v2_application_assets WHERE version_id=p_version AND id=asset_id) AND EXISTS(SELECT 1 FROM public.assess_v2_primitives WHERE version_id=p_version AND id=primitive_id);
 ELSIF kind='create_decision_point' THEN RETURN operation='create_entity' AND entity IS NOT NULL AND field='create.decision:'||entity::text AND value_type='decision_constructor' AND allowed IS NULL AND EXISTS(SELECT 1 FROM public.assess_v2_primitives WHERE version_id=p_version AND id=entity);
 ELSIF kind='create_exception_path' THEN RETURN operation='create_entity' AND entity IS NOT NULL AND field='create.exception:'||entity::text AND value_type='exception_constructor' AND allowed IS NULL AND EXISTS(SELECT 1 FROM public.assess_v2_primitives WHERE version_id=p_version AND id=entity);
 ELSIF kind='evidence_only' THEN RETURN entity IS NULL AND operation='link_evidence' AND field='evidence' AND value_type='evidence' AND allowed IS NULL AND NOT (p_target->>'manual')::boolean;
 END IF;RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;END$$;

CREATE OR REPLACE FUNCTION public.enterprise_claim_assess_document_mapping_run_v1(
 p_run uuid,p_catalog uuid,p_case uuid,p_expected_case_version bigint,p_assess_schema_version text,p_catalog_hash text,p_targets jsonb,
 p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,p_source_bindings jsonb,
 p_route_id uuid,p_provider_config_id uuid,p_provider text,p_model text,p_prompt_version text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;c public.assess_v2_cases;v public.assess_v2_case_versions;b public.enterprise_module_input_bundle_versions;catalog public.enterprise_assess_document_mapping_catalogs;run public.enterprise_assess_document_mapping_runs;t jsonb;s jsonb;sv public.enterprise_evidence_source_versions;current jsonb;normalized_target jsonb;ord int:=0;bindings jsonb:='[]'::jsonb;normalized_targets jsonb:='[]'::jsonb;persisted_targets jsonb;binding_id uuid;job_id uuid;computed text;claim_binding text;byte_total bigint:=0;derived_manual boolean;owns boolean:=false;recovery text:='none';
BEGIN
 r:=public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,'assess.document-map.analyze',p_authorization_version,p_execution_token,p_execution_fence,'analyze');
 IF p_provider NOT IN('gemini','groq','openai','azure_openai','anthropic','openai_compatible') OR length(btrim(p_model)) NOT BETWEEN 1 AND 200 OR length(btrim(p_prompt_version)) NOT BETWEEN 1 AND 120 OR jsonb_typeof(p_targets)<>'array' OR jsonb_array_length(p_targets) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(p_source_bindings)<>'array' OR jsonb_array_length(p_source_bindings) NOT BETWEEN 1 AND 20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_source_bindings) binding WHERE jsonb_typeof(binding.value)<>'object' OR NOT(binding.value ?& ARRAY['sourceSetId','sourceSetVersionId','expectedSourceSetVersion','sourceId','sourceVersionId','parserVersion','normalizedHash','extractedByteCount','sheetCount','cellCount','warnings']) OR (binding.value-ARRAY['sourceSetId','sourceSetVersionId','expectedSourceSetVersion','sourceId','sourceVersionId','parserVersion','normalizedHash','extractedByteCount','sheetCount','cellCount','warnings'])<>'{}'::jsonb) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_INVALID';END IF;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND status='draft' AND deleted_at IS NULL FOR SHARE;
 SELECT * INTO v FROM public.assess_v2_case_versions WHERE id=c.head_version_id AND case_id=c.id FOR SHARE;
 SELECT version.* INTO b FROM public.enterprise_module_input_bundle_versions version JOIN public.enterprise_module_input_bundles root ON root.id=version.input_bundle_id AND root.org_id=version.org_id AND root.workspace_id=version.workspace_id WHERE version.id=p_input_bundle_version AND version.input_bundle_id=p_input_bundle AND version.version=p_expected_input_bundle_version AND version.org_id=p_org AND version.workspace_id=p_workspace AND root.owner_module='assess' AND version.status='locked' FOR SHARE;
 IF c.id IS NULL OR c.version IS DISTINCT FROM p_expected_case_version OR c.schema_version IS DISTINCT FROM p_assess_schema_version OR v.id IS NULL OR b.id IS NULL OR EXISTS(SELECT 1 FROM public.enterprise_transcript_staleness_events WHERE resource_id=b.id) OR NOT EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route JOIN public.ai_provider_configs config ON config.id=route.provider_config_id AND config.org_id=route.org_id WHERE route.id=p_route_id AND route.org_id=p_org AND route.workspace_id=p_workspace AND route.provider_config_id=p_provider_config_id AND route.capability='assess.evidence.extract' AND route.model=p_model AND route.enabled AND route.deleted_at IS NULL AND config.provider=p_provider AND config.status='active') THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STALE';END IF;
 FOR t IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
  current:=public.enterprise_assess_document_target_current(v.id,t->>'targetKind',NULLIF(t->>'entityId','')::uuid,t->>'fieldId');
  IF t->>'catalogId' IS DISTINCT FROM p_catalog::text OR t->>'caseId' IS DISTINCT FROM c.id::text OR (t->>'caseVersion')::bigint IS DISTINCT FROM c.version OR t->>'assessSchemaVersion' IS DISTINCT FROM c.schema_version OR current IS NULL OR current IS DISTINCT FROM t->'currentValue' OR public.enterprise_assess_document_mapping_target_valid(v.id,t,current) IS NOT TRUE THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_TARGET_INVALID';END IF;
  derived_manual:=(t->>'manual')::boolean;
  normalized_target:=jsonb_build_object('selectorId',(t->>'selectorId')::uuid,'targetKind',t->>'targetKind','operation',t->>'operation','fieldId',t->>'fieldId','label',t->>'label','contextLabel',COALESCE(t->>'contextLabel',''),'valueType',t->>'valueType','currentValue',current,'currentValueHash',public.enterprise_sha256_jsonb(current),'manual',derived_manual);
  IF NULLIF(t->>'entityId','') IS NOT NULL THEN normalized_target:=normalized_target||jsonb_build_object('entityId',(t->>'entityId')::uuid);END IF;
  IF t->'allowedValues' IS NOT NULL THEN normalized_target:=normalized_target||jsonb_build_object('allowedValues',t->'allowedValues');END IF;
  normalized_targets:=normalized_targets||jsonb_build_array(normalized_target);
 END LOOP;
 computed:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','assess-supporting-document-map-v1','catalogVersion',1,'caseId',c.id,'caseVersion',c.version,'assessSchemaVersion',c.schema_version,'targets',normalized_targets));
 claim_binding:=public.enterprise_sha256_jsonb(jsonb_build_object('runId',p_run,'catalogId',p_catalog,'catalogHash',computed,'caseId',c.id,'caseVersion',c.version,'assessSchemaVersion',c.schema_version,'targets',normalized_targets,'inputBundleId',b.input_bundle_id,'inputBundleVersionId',b.id,'inputBundleVersion',b.version,'bundleHash',b.bundle_hash,'sourceBindings',p_source_bindings,'routeId',p_route_id,'providerConfigId',p_provider_config_id,'provider',p_provider,'model',p_model,'promptVersion',p_prompt_version));
 SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE receipt_id=r.id FOR UPDATE;
 IF run.id IS NOT NULL THEN
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('selectorId',target.selector_id,'catalogId',target.catalog_id,'caseId',catalog_row.assess_case_id,'caseVersion',catalog_row.case_version,'assessSchemaVersion',catalog_row.assess_schema_version,'targetKind',target.target_kind,'operation',target.operation,'entityId',target.entity_id,'fieldId',target.field_id,'label',target.label,'contextLabel',target.context_label,'valueType',target.value_type,'allowedValues',target.allowed_values,'currentValue',target.current_value,'currentValueHash',target.current_value_hash,'manual',target.manual)) ORDER BY target.ordinal),'[]'::jsonb)
  INTO persisted_targets FROM public.enterprise_assess_document_mapping_targets target JOIN public.enterprise_assess_document_mapping_catalogs catalog_row ON catalog_row.id=target.catalog_id WHERE target.catalog_id=run.catalog_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceSetId',source.source_set_id,'sourceSetVersionId',source.source_set_version_id,'expectedSourceSetVersion',source.expected_source_set_version,'sourceId',source.source_id,'sourceVersionId',source.source_version_id,'extractionBindingId',source.extraction_binding_id,'extractionJobId',source.extraction_job_id,'parserVersion',source.parser_version,'normalizedHash',source.normalized_hash,'extractedByteCount',source.extracted_byte_count,'sheetCount',source.sheet_count,'cellCount',source.cell_count,'warnings',source.warnings) ORDER BY source.ordinal),'[]'::jsonb)
  INTO bindings FROM public.enterprise_assess_document_mapping_run_sources source WHERE source.run_id=run.id;
  IF run.id IS DISTINCT FROM p_run OR run.catalog_id IS DISTINCT FROM p_catalog OR run.assess_case_id IS DISTINCT FROM p_case OR run.case_version IS DISTINCT FROM p_expected_case_version OR run.input_bundle_id IS DISTINCT FROM p_input_bundle OR run.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version OR run.input_bundle_version IS DISTINCT FROM p_expected_input_bundle_version OR run.route_id IS DISTINCT FROM p_route_id OR run.provider_config_id IS DISTINCT FROM p_provider_config_id OR run.provider IS DISTINCT FROM p_provider OR run.model IS DISTINCT FROM p_model OR run.prompt_version IS DISTINCT FROM p_prompt_version OR run.claim_binding_hash IS DISTINCT FROM claim_binding THEN RAISE EXCEPTION 'ENTERPRISE_AI_IDEMPOTENCY_CONFLICT';END IF;
  IF run.status IN('committed','failed','blocked') THEN
   RETURN jsonb_build_object('state',run.status,'ownsExecution',false,'recoveryMode','none','runId',run.id,'catalogId',run.catalog_id,'catalogHash',computed,'targets',persisted_targets,'sourceBindings',bindings,'safeResult',run.safe_result);
  END IF;
  PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(run.id);
  IF run.status='claimed' AND (run.execution_token IS DISTINCT FROM p_execution_token OR run.execution_fence IS DISTINCT FROM p_execution_fence) THEN
   IF p_execution_fence<=run.execution_fence THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';END IF;
   UPDATE public.enterprise_assess_document_mapping_runs SET execution_token=p_execution_token,execution_fence=p_execution_fence,updated_at=statement_timestamp() WHERE id=run.id RETURNING * INTO run;
   owns:=true;recovery:='execute_provider';
  ELSIF run.status='staged' THEN recovery:='finalize_staged';
  END IF;
  RETURN jsonb_build_object('state',run.status,'ownsExecution',owns,'recoveryMode',recovery,'runId',run.id,'catalogId',run.catalog_id,'catalogHash',computed,'targets',persisted_targets,'sourceBindings',bindings,'safeResult',run.safe_result);
 END IF;
 INSERT INTO public.enterprise_assess_document_mapping_catalogs(id,org_id,workspace_id,assess_case_id,assess_case_version_id,case_version,assess_schema_version,contract_version,catalog_version,catalog_hash,status,receipt_id,created_by)
 VALUES(p_catalog,p_org,p_workspace,c.id,v.id,c.version,c.schema_version,'assess-supporting-document-map-v1',1,computed,'current',r.id,p_actor) RETURNING * INTO catalog;
 FOR t IN SELECT value FROM jsonb_array_elements(normalized_targets) LOOP
  ord:=ord+1;current:=t->'currentValue';
  INSERT INTO public.enterprise_assess_document_mapping_targets(selector_id,catalog_id,org_id,workspace_id,target_kind,operation,entity_id,field_id,label,context_label,value_type,allowed_values,current_value,current_value_hash,manual,ordinal)
  VALUES((t->>'selectorId')::uuid,catalog.id,p_org,p_workspace,t->>'targetKind',t->>'operation',NULLIF(t->>'entityId','')::uuid,t->>'fieldId',t->>'label',COALESCE(t->>'contextLabel',''),t->>'valueType',t->'allowedValues',current,t->>'currentValueHash',(t->>'manual')::boolean,ord);
 END LOOP;
 INSERT INTO public.enterprise_assess_document_mapping_runs(id,org_id,workspace_id,catalog_id,assess_case_id,case_version,input_bundle_id,input_bundle_version_id,input_bundle_version,bundle_hash,route_id,provider_config_id,provider,model,prompt_version,authorization_version,status,claim_binding_hash,execution_token,execution_fence,receipt_id,created_by)
 VALUES(p_run,p_org,p_workspace,catalog.id,c.id,c.version,b.input_bundle_id,b.id,b.version,b.bundle_hash,p_route_id,p_provider_config_id,p_provider,p_model,p_prompt_version,p_authorization_version,'claimed',claim_binding,p_execution_token,p_execution_fence,r.id,p_actor) RETURNING * INTO run;
 ord:=0;
 FOR s IN SELECT value FROM jsonb_array_elements(p_source_bindings) LOOP
  ord:=ord+1;SELECT version.* INTO sv FROM public.enterprise_evidence_source_versions version JOIN public.enterprise_source_set_version_items item ON item.source_version_id=version.id JOIN public.enterprise_module_input_bundle_items bundle_item ON bundle_item.source_set_version_id=item.source_set_version_id WHERE bundle_item.input_bundle_version_id=b.id AND item.source_set_id=(s->>'sourceSetId')::uuid AND item.source_set_version_id=(s->>'sourceSetVersionId')::uuid AND version.source_id=(s->>'sourceId')::uuid AND version.id=(s->>'sourceVersionId')::uuid AND version.org_id=p_org AND version.workspace_id=p_workspace AND version.extraction_status='parsed' FOR SHARE;
  IF sv.id IS NULL OR (s->>'expectedSourceSetVersion')::bigint<>(SELECT version FROM public.enterprise_source_set_versions WHERE id=(s->>'sourceSetVersionId')::uuid) OR length(btrim(COALESCE(s->>'parserVersion',''))) NOT BETWEEN 1 AND 120 OR COALESCE(s->>'normalizedHash','')!~'^[0-9a-f]{64}$' OR COALESCE(s->>'extractedByteCount','')!~'^[1-9][0-9]*$' OR (s->>'extractedByteCount')::bigint>120000 OR COALESCE(s->>'sheetCount','0')!~'^[0-9]+$' OR (s->>'sheetCount')::int>100 OR COALESCE(s->>'cellCount','0')!~'^[0-9]+$' OR (s->>'cellCount')::int>100000 OR jsonb_typeof(COALESCE(s->'warnings','[]'::jsonb))<>'array' OR jsonb_array_length(COALESCE(s->'warnings','[]'::jsonb))>100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(s->'warnings','[]'::jsonb)) warning WHERE jsonb_typeof(warning.value)<>'string' OR length(warning.value#>>'{}')>400) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_SOURCE_STALE';END IF;
  byte_total:=byte_total+(s->>'extractedByteCount')::bigint;IF byte_total>120000 THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_PROVIDER_INPUT_TOO_LARGE';END IF;
  binding_id:=gen_random_uuid();job_id:=gen_random_uuid();
  INSERT INTO public.enterprise_assess_document_mapping_run_sources(run_id,org_id,workspace_id,extraction_binding_id,extraction_job_id,source_set_id,source_set_version_id,expected_source_set_version,source_id,source_version_id,parser_version,normalized_hash,extracted_byte_count,sheet_count,cell_count,warnings,ordinal)
  VALUES(run.id,p_org,p_workspace,binding_id,job_id,(s->>'sourceSetId')::uuid,(s->>'sourceSetVersionId')::uuid,(s->>'expectedSourceSetVersion')::bigint,sv.source_id,sv.id,s->>'parserVersion',s->>'normalizedHash',(s->>'extractedByteCount')::bigint,COALESCE((s->>'sheetCount')::int,0),COALESCE((s->>'cellCount')::int,0),COALESCE(s->'warnings','[]'::jsonb),ord);
  bindings:=bindings||jsonb_build_array(jsonb_build_object('sourceSetId',(s->>'sourceSetId')::uuid,'sourceSetVersionId',(s->>'sourceSetVersionId')::uuid,'expectedSourceSetVersion',(s->>'expectedSourceSetVersion')::bigint,'sourceId',sv.source_id,'sourceVersionId',sv.id,'extractionBindingId',binding_id,'extractionJobId',job_id,'parserVersion',s->>'parserVersion','normalizedHash',s->>'normalizedHash','extractedByteCount',(s->>'extractedByteCount')::bigint,'sheetCount',COALESCE((s->>'sheetCount')::int,0),'cellCount',COALESCE((s->>'cellCount')::int,0),'warnings',COALESCE(s->'warnings','[]'::jsonb)));
 END LOOP;
 PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(run.id);
 SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('selectorId',target.selector_id,'catalogId',catalog.id,'caseId',catalog.assess_case_id,'caseVersion',catalog.case_version,'assessSchemaVersion',catalog.assess_schema_version,'targetKind',target.target_kind,'operation',target.operation,'entityId',target.entity_id,'fieldId',target.field_id,'label',target.label,'contextLabel',target.context_label,'valueType',target.value_type,'allowedValues',target.allowed_values,'currentValue',target.current_value,'currentValueHash',target.current_value_hash,'manual',target.manual)) ORDER BY target.ordinal),'[]'::jsonb) INTO persisted_targets FROM public.enterprise_assess_document_mapping_targets target WHERE target.catalog_id=catalog.id;
 RETURN jsonb_build_object('state','claimed','ownsExecution',true,'recoveryMode','none','runId',run.id,'catalogId',catalog.id,'catalogHash',catalog.catalog_hash,'targets',persisted_targets,'sourceBindings',bindings);
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_stage_assess_document_mapping_result_v1(
 p_run uuid,p_catalog uuid,p_proposals jsonb,p_result jsonb,p_output_hash text,p_token_input integer,p_token_output integer,p_latency_ms integer,p_staged_payload_hash text,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run public.enterprise_assess_document_mapping_runs;src public.enterprise_assess_document_mapping_run_sources;target public.enterprise_assess_document_mapping_targets;x jsonb;anchor jsonb;sb jsonb;analyzed jsonb;catalog_hash text;
BEGIN
 SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE id=p_run AND catalog_id=p_catalog AND receipt_id=p_receipt FOR UPDATE;
 SELECT c.catalog_hash INTO catalog_hash FROM public.enterprise_assess_document_mapping_catalogs c WHERE c.id=p_catalog;
 IF run.id IS NULL OR run.status<>'claimed' OR run.execution_token IS DISTINCT FROM p_execution_token OR run.execution_fence IS DISTINCT FROM p_execution_fence OR jsonb_typeof(p_proposals)<>'array' OR jsonb_array_length(p_proposals) NOT BETWEEN 0 AND 100 OR jsonb_typeof(p_result)<>'object' OR NOT(p_result ?& ARRAY['resourceId','runId','catalogId','catalogHash','proposalCount','targetCount','sourceCount','sourceBindings','analyzedSources','warnings']) OR (p_result-ARRAY['resourceId','runId','catalogId','catalogHash','proposalCount','targetCount','sourceCount','sourceBindings','analyzedSources','warnings'])<>'{}'::jsonb OR p_result->>'resourceId' IS DISTINCT FROM run.id::text OR p_result->>'runId' IS DISTINCT FROM run.id::text OR p_result->>'catalogId' IS DISTINCT FROM run.catalog_id::text OR p_result->>'catalogHash' IS DISTINCT FROM catalog_hash OR COALESCE(p_result->>'proposalCount','')!~'^[0-9]+$' OR (p_result->>'proposalCount')::integer IS DISTINCT FROM jsonb_array_length(p_proposals) OR COALESCE(p_result->>'targetCount','')!~'^[1-9][0-9]*$' OR (p_result->>'targetCount')::integer IS DISTINCT FROM (SELECT count(*)::int FROM public.enterprise_assess_document_mapping_targets WHERE catalog_id=run.catalog_id) OR COALESCE(p_result->>'sourceCount','')!~'^[1-9][0-9]*$' OR (p_result->>'sourceCount')::integer IS DISTINCT FROM (SELECT count(*)::int FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id) OR jsonb_typeof(p_result->'warnings')<>'array' OR jsonb_array_length(p_result->'warnings')>200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_result->'warnings') warning WHERE jsonb_typeof(warning.value)<>'string' OR length(warning.value#>>'{}')>500) OR p_output_hash!~'^[0-9a-f]{64}$' OR p_staged_payload_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 PERFORM public.enterprise_assess_document_mapping_assert(p_receipt,run.created_by,run.org_id,run.workspace_id,'assess.document-map.analyze',run.authorization_version,p_execution_token,p_execution_fence,'analyze');
 PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(run.id);
 IF jsonb_typeof(p_result->'sourceBindings')<>'array' OR jsonb_array_length(p_result->'sourceBindings')<>(SELECT count(*) FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id) OR (SELECT count(DISTINCT value->>'extractionBindingId') FROM jsonb_array_elements(p_result->'sourceBindings'))<>jsonb_array_length(p_result->'sourceBindings') THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 FOR sb IN SELECT value FROM jsonb_array_elements(p_result->'sourceBindings') LOOP
  SELECT * INTO src FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id AND extraction_binding_id=(sb->>'extractionBindingId')::uuid AND extraction_job_id=(sb->>'extractionJobId')::uuid AND source_id=(sb->>'sourceId')::uuid AND source_version_id=(sb->>'sourceVersionId')::uuid FOR UPDATE;
  IF jsonb_typeof(sb) IS DISTINCT FROM 'object' OR NOT(sb ?& ARRAY['sourceSetId','sourceSetVersionId','expectedSourceSetVersion','sourceId','sourceVersionId','extractionBindingId','extractionJobId','parserVersion','normalizedHash','extractedByteCount','sheetCount','cellCount','warnings']) OR (sb-ARRAY['sourceSetId','sourceSetVersionId','expectedSourceSetVersion','sourceId','sourceVersionId','extractionBindingId','extractionJobId','parserVersion','normalizedHash','extractedByteCount','sheetCount','cellCount','warnings'])<>'{}'::jsonb OR src.run_id IS NULL OR sb->>'sourceSetId' IS DISTINCT FROM src.source_set_id::text OR sb->>'sourceSetVersionId' IS DISTINCT FROM src.source_set_version_id::text OR (sb->>'expectedSourceSetVersion')::bigint IS DISTINCT FROM src.expected_source_set_version OR sb->>'parserVersion' IS DISTINCT FROM src.parser_version OR sb->>'normalizedHash' IS DISTINCT FROM src.normalized_hash OR (sb->>'extractedByteCount')::bigint IS DISTINCT FROM src.extracted_byte_count OR (sb->>'sheetCount')::integer IS DISTINCT FROM src.sheet_count OR (sb->>'cellCount')::integer IS DISTINCT FROM src.cell_count OR sb->'warnings' IS DISTINCT FROM src.warnings THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 END LOOP;
 IF jsonb_typeof(p_result->'analyzedSources')<>'array' OR jsonb_array_length(p_result->'analyzedSources')<>(SELECT count(*) FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id) OR (SELECT count(DISTINCT value->>'sourceVersionId') FROM jsonb_array_elements(p_result->'analyzedSources'))<>jsonb_array_length(p_result->'analyzedSources') THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 FOR analyzed IN SELECT value FROM jsonb_array_elements(p_result->'analyzedSources') LOOP
  SELECT * INTO src FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id AND source_id=(analyzed->>'sourceId')::uuid AND source_version_id=(analyzed->>'sourceVersionId')::uuid FOR SHARE;
  IF jsonb_typeof(analyzed) IS DISTINCT FROM 'object' OR NOT(analyzed ?& ARRAY['sourceId','sourceVersionId','parserVersion','extractedByteCount','sheetCount','cellCount','warnings']) OR (analyzed-ARRAY['sourceId','sourceVersionId','parserVersion','extractedByteCount','sheetCount','cellCount','warnings'])<>'{}'::jsonb OR src.run_id IS NULL OR analyzed->>'parserVersion' IS DISTINCT FROM src.parser_version OR (analyzed->>'extractedByteCount')::bigint IS DISTINCT FROM src.extracted_byte_count OR (analyzed->>'sheetCount')::integer IS DISTINCT FROM src.sheet_count OR (analyzed->>'cellCount')::integer IS DISTINCT FROM src.cell_count OR analyzed->'warnings' IS DISTINCT FROM src.warnings THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_proposals) LOOP
  anchor:=x->'sourceAnchor';SELECT * INTO src FROM public.enterprise_assess_document_mapping_run_sources WHERE run_id=run.id AND extraction_binding_id=(x->>'extractionBindingId')::uuid AND extraction_job_id=(x->>'extractionJobId')::uuid AND source_id=(x->>'sourceId')::uuid AND source_version_id=(x->>'sourceVersionId')::uuid FOR SHARE;
  SELECT * INTO target FROM public.enterprise_assess_document_mapping_targets WHERE catalog_id=run.catalog_id AND selector_id=(x->>'targetSelectorId')::uuid FOR SHARE;
  IF jsonb_typeof(x) IS DISTINCT FROM 'object' OR NOT(x ?& ARRAY['id','version','targetSelectorId','sourceId','sourceVersionId','extractionBindingId','extractionJobId','proposedValue','confidence','rationale','sourceAnchor','relationship']) OR (x-ARRAY['id','version','targetSelectorId','sourceId','sourceVersionId','extractionBindingId','extractionJobId','proposedValue','confidence','rationale','sourceAnchor','relationship'])<>'{}'::jsonb OR (x->>'version')::bigint<>1 OR jsonb_typeof(anchor) IS DISTINCT FROM 'object' OR NOT(anchor ?& ARRAY['sourceVersionId','parserVersion','locator','anchorHash','safeExcerpt']) OR (anchor-ARRAY['sourceVersionId','parserVersion','locator','anchorHash','safeExcerpt'])<>'{}'::jsonb OR src.run_id IS NULL OR target.selector_id IS NULL OR anchor->>'sourceVersionId' IS DISTINCT FROM src.source_version_id::text OR anchor->>'parserVersion' IS DISTINCT FROM src.parser_version OR anchor->>'anchorHash' !~ '^[0-9a-f]{64}$' OR length(anchor->>'locator') NOT BETWEEN 1 AND 400 OR length(anchor->>'safeExcerpt') NOT BETWEEN 1 AND 1000 OR public.enterprise_assess_document_mapping_target_value_valid(target,x->'proposedValue') IS NOT TRUE OR public.enterprise_assess_document_mapping_payload_valid(target.target_kind,x->'proposedValue') IS NOT TRUE THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_PROPOSAL_INVALID';END IF;
  INSERT INTO public.enterprise_assess_document_mapping_proposals(id,run_id,catalog_id,target_selector_id,org_id,workspace_id,proposed_value,confidence,rationale,source_id,source_version_id,extraction_binding_id,extraction_job_id,parser_version,source_locator,anchor_hash,safe_excerpt,relationship)
  VALUES((x->>'id')::uuid,run.id,run.catalog_id,target.selector_id,run.org_id,run.workspace_id,x->'proposedValue',(x->>'confidence')::numeric,x->>'rationale',src.source_id,src.source_version_id,src.extraction_binding_id,src.extraction_job_id,src.parser_version,anchor->>'locator',anchor->>'anchorHash',anchor->>'safeExcerpt',x->>'relationship');
 END LOOP;
 UPDATE public.enterprise_assess_document_mapping_runs SET status='staged',safe_result=p_result,output_hash=p_output_hash,staged_payload_hash=p_staged_payload_hash,token_input=p_token_input,token_output=p_token_output,latency_ms=p_latency_ms,updated_at=statement_timestamp() WHERE id=run.id;
 RETURN jsonb_build_object('resourceId',run.id,'runId',run.id,'catalogId',run.catalog_id,'proposalCount',jsonb_array_length(p_proposals),'status','staged');
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_assess_document_mapping_result_v1(p_run uuid,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE run public.enterprise_assess_document_mapping_runs;result jsonb;BEGIN
 SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE id=p_run AND receipt_id=p_receipt FOR UPDATE;
 IF run.id IS NULL OR run.status NOT IN('staged','committed') THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 PERFORM public.enterprise_assess_document_mapping_assert(run.receipt_id,run.created_by,run.org_id,run.workspace_id,'assess.document-map.analyze',run.authorization_version,p_execution_token,p_execution_fence,'analyze');
 result:=run.safe_result||jsonb_build_object('resourceId',run.id,'runId',run.id,'catalogId',run.catalog_id,'status','committed');
 IF run.status='staged' THEN PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(run.id);PERFORM public.enterprise_ai_record_effect(run.receipt_id,run.org_id,run.workspace_id,p_execution_token,p_execution_fence,'assess.document-map.analyze','command',run.id,result,'committed');UPDATE public.enterprise_assess_document_mapping_runs SET status='committed',safe_result=result,execution_token=p_execution_token,execution_fence=p_execution_fence,updated_at=statement_timestamp() WHERE id=run.id;END IF;
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_fail_assess_document_mapping_run_v1(
 p_run uuid,p_result jsonb,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE run public.enterprise_assess_document_mapping_runs;failure text;terminal text;result jsonb;
BEGIN
 SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE id=p_run AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF run.id IS NULL OR run.created_by IS DISTINCT FROM p_actor OR run.authorization_version IS DISTINCT FROM p_authorization_version THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_STAGE_INVALID';END IF;
 PERFORM public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,'assess.document-map.analyze',p_authorization_version,p_execution_token,p_execution_fence,'analyze');
 failure:=p_result->>'failureCode';
 IF jsonb_typeof(p_result)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_result))<>1 OR failure IS NULL OR (failure=ANY(ARRAY['BUDGET_EXHAUSTED','PROVIDER_UNSUPPORTED','SECRET_REFERENCE_UNSAFE','SECRET_UNAVAILABLE','ENDPOINT_UNSAFE','CAPABILITY_UNAVAILABLE','PROMPT_TOO_LARGE'])) IS NOT TRUE THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_FAILURE_INVALID';END IF;
 IF run.status IN('failed','blocked') THEN IF run.failure_code IS DISTINCT FROM failure THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_FAILURE_INVALID';END IF;RETURN run.safe_result;END IF;
 IF run.status<>'claimed' THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_FAILURE_INVALID';END IF;
 terminal:=CASE failure WHEN 'BUDGET_EXHAUSTED' THEN 'blocked' ELSE 'failed' END;
 result:=jsonb_build_object('resourceId',run.id,'runId',run.id,'catalogId',run.catalog_id,'state',terminal,'status',terminal,'failureCode',failure);
 UPDATE public.enterprise_assess_document_mapping_runs SET status=terminal,failure_code=failure,safe_result=result,updated_at=statement_timestamp() WHERE id=run.id;
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_review_assess_document_mapping_proposal_v1(
 p_proposal uuid,p_expected_proposal_version bigint,p_status text,p_edited_value jsonb,p_reason text,p_target_selector uuid,p_catalog uuid,p_case uuid,p_expected_case_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;p public.enterprise_assess_document_mapping_proposals;run public.enterprise_assess_document_mapping_runs;t public.enterprise_assess_document_mapping_targets;c public.assess_v2_cases;prior bigint;value jsonb;review public.enterprise_assess_document_mapping_reviews;result jsonb;
BEGIN
 r:=public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,'assess.document-map.proposal.review',p_authorization_version,p_execution_token,p_execution_fence,'review');
 IF p_status NOT IN('accepted','edited','rejected') OR length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_REVIEW_INVALID';END IF;
 SELECT * INTO p FROM public.enterprise_assess_document_mapping_proposals WHERE id=p_proposal AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE id=p.run_id FOR SHARE;SELECT * INTO t FROM public.enterprise_assess_document_mapping_targets WHERE selector_id=p_target_selector AND catalog_id=p_catalog FOR SHARE;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND status='draft' AND deleted_at IS NULL FOR SHARE;
 SELECT COALESCE(max(version),1) INTO prior FROM public.enterprise_assess_document_mapping_reviews WHERE proposal_id=p.id;
 value:=CASE WHEN p_status='edited' THEN p_edited_value ELSE p.proposed_value END;
 IF p.id IS NULL OR run.status<>'committed' OR run.catalog_id IS DISTINCT FROM p_catalog OR run.assess_case_id IS DISTINCT FROM p_case OR c.version IS DISTINCT FROM p_expected_case_version OR c.version IS DISTINCT FROM run.case_version OR p.target_selector_id IS DISTINCT FROM p_target_selector OR t.selector_id IS NULL OR prior IS DISTINCT FROM p_expected_proposal_version OR (p_status='edited' AND p_edited_value IS NULL) OR public.enterprise_assess_document_mapping_target_value_valid(t,value) IS NOT TRUE OR public.enterprise_assess_document_mapping_payload_valid(t.target_kind,value) IS NOT TRUE THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_REVIEW_STALE';END IF;
 PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(run.id);
 INSERT INTO public.enterprise_assess_document_mapping_reviews(proposal_id,org_id,workspace_id,version,status,reviewed_value,reason,reviewer_id,authorization_version,receipt_id)
 VALUES(p.id,p_org,p_workspace,prior+1,p_status,value,btrim(p_reason),p_actor,p_authorization_version,r.id) RETURNING * INTO review;
 result:=jsonb_build_object('resourceId',p.id,'proposalId',p.id,'version',review.version,'status',review.status);
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'assess.document-map.proposal.review','command',p.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_create_assess_document_mapping_preview_v1(
 p_batch uuid,p_catalog uuid,p_catalog_hash text,p_case uuid,p_expected_case_version bigint,p_input_bundle uuid,p_input_bundle_version uuid,p_selections jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;catalog public.enterprise_assess_document_mapping_catalogs;c public.assess_v2_cases;b public.enterprise_module_input_bundle_versions;batch public.enterprise_assess_document_mapping_preview_batches;s jsonb;p public.enterprise_assess_document_mapping_proposals;run public.enterprise_assess_document_mapping_runs;t public.enterprise_assess_document_mapping_targets;review public.enterprise_assess_document_mapping_reviews;ord int:=0;binding text;conflicts int;result jsonb;manifest jsonb;
BEGIN
 r:=public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,'assess.document-map.preview',p_authorization_version,p_execution_token,p_execution_fence,'apply');
 SELECT * INTO catalog FROM public.enterprise_assess_document_mapping_catalogs WHERE id=p_catalog AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND status='draft' AND deleted_at IS NULL FOR SHARE;SELECT * INTO b FROM public.enterprise_module_input_bundle_versions WHERE id=p_input_bundle_version AND input_bundle_id=p_input_bundle AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
 IF catalog.id IS NULL OR catalog.catalog_hash IS DISTINCT FROM p_catalog_hash OR catalog.assess_case_id IS DISTINCT FROM p_case OR catalog.case_version IS DISTINCT FROM p_expected_case_version OR c.version IS DISTINCT FROM p_expected_case_version OR b.id IS NULL OR jsonb_typeof(p_selections)<>'array' OR jsonb_array_length(p_selections) NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT value->>'proposalId') FROM jsonb_array_elements(p_selections))<>jsonb_array_length(p_selections) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_PREVIEW_STALE';END IF;
 INSERT INTO public.enterprise_assess_document_mapping_preview_batches(id,org_id,workspace_id,catalog_id,catalog_hash,assess_case_id,expected_case_version,input_bundle_id,input_bundle_version_id,status,expires_at,receipt_id,created_by) VALUES(p_batch,p_org,p_workspace,catalog.id,catalog.catalog_hash,c.id,c.version,b.input_bundle_id,b.id,'previewed',statement_timestamp()+interval '30 minutes',r.id,p_actor) RETURNING * INTO batch;
 FOR s IN SELECT value FROM jsonb_array_elements(p_selections) LOOP
  ord:=ord+1;SELECT * INTO p FROM public.enterprise_assess_document_mapping_proposals WHERE id=(s->>'proposalId')::uuid AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;SELECT * INTO run FROM public.enterprise_assess_document_mapping_runs WHERE id=p.run_id FOR SHARE;SELECT * INTO t FROM public.enterprise_assess_document_mapping_targets WHERE selector_id=(s->>'targetSelectorId')::uuid AND catalog_id=catalog.id FOR SHARE;SELECT * INTO review FROM public.enterprise_assess_document_mapping_reviews WHERE proposal_id=p.id ORDER BY version DESC LIMIT 1;
  IF p.id IS NULL OR run.input_bundle_id IS DISTINCT FROM b.input_bundle_id OR run.input_bundle_version_id IS DISTINCT FROM b.id OR run.case_version IS DISTINCT FROM c.version OR t.selector_id IS NULL OR p.target_selector_id IS DISTINCT FROM t.selector_id OR review.status NOT IN('accepted','edited') OR review.version IS DISTINCT FROM (s->>'proposalVersion')::bigint OR review.reviewed_value IS DISTINCT FROM s->'effectiveValue' OR public.enterprise_assess_document_mapping_target_value_valid(t,review.reviewed_value) IS NOT TRUE THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_PREVIEW_STALE';END IF;
  PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(run.id);
  binding:=public.enterprise_sha256_jsonb(jsonb_build_object('catalogId',catalog.id,'catalogHash',catalog.catalog_hash,'caseId',c.id,'caseVersion',c.version,'bundleVersionId',b.id,'proposalId',p.id,'proposalVersion',review.version,'targetSelectorId',t.selector_id,'value',review.reviewed_value));
  INSERT INTO public.enterprise_assess_document_mapping_preview_items(preview_batch_id,proposal_id,target_selector_id,org_id,workspace_id,proposal_version,reviewed_value,ordinal,binding_hash) VALUES(batch.id,p.id,t.selector_id,p_org,p_workspace,review.version,review.reviewed_value,ord,binding);
 END LOOP;
 INSERT INTO public.enterprise_assess_document_mapping_conflicts(preview_batch_id,org_id,workspace_id,target_selector_id,proposal_ids,kind,current_value_hash)
 SELECT batch.id,p_org,p_workspace,target_row.selector_id,array_agg(i.proposal_id ORDER BY i.ordinal),'manual',target_row.current_value_hash FROM public.enterprise_assess_document_mapping_preview_items i JOIN public.enterprise_assess_document_mapping_targets target_row ON target_row.selector_id=i.target_selector_id WHERE i.preview_batch_id=batch.id AND target_row.manual AND i.reviewed_value IS DISTINCT FROM target_row.current_value GROUP BY target_row.selector_id,target_row.current_value_hash;
 INSERT INTO public.enterprise_assess_document_mapping_conflicts(preview_batch_id,org_id,workspace_id,target_selector_id,proposal_ids,kind,current_value_hash)
 SELECT batch.id,p_org,p_workspace,target_row.selector_id,array_agg(i.proposal_id ORDER BY i.ordinal),'cross_source',target_row.current_value_hash FROM public.enterprise_assess_document_mapping_preview_items i JOIN public.enterprise_assess_document_mapping_targets target_row ON target_row.selector_id=i.target_selector_id WHERE i.preview_batch_id=batch.id GROUP BY target_row.selector_id,target_row.current_value_hash HAVING count(DISTINCT i.reviewed_value)>1;
 SELECT count(*) INTO conflicts FROM public.enterprise_assess_document_mapping_conflicts WHERE preview_batch_id=batch.id;
 manifest:=public.enterprise_assess_document_mapping_preview_manifest_json(batch.id,1);
 INSERT INTO public.enterprise_assess_document_mapping_preview_manifests(preview_batch_id,manifest_version,org_id,workspace_id,catalog_id,catalog_hash,assess_case_id,case_version,input_bundle_id,input_bundle_version_id,target_count,source_count,item_count,reviewed_count,conflict_count,unresolved_conflict_count,item_set_hash,conflict_set_hash,resolution_set_hash,displayed_set_hash,item_bindings,conflict_bindings,resolution_bindings,manifest)
 SELECT batch.id,1,p_org,p_workspace,catalog.id,catalog.catalog_hash,c.id,c.version,b.input_bundle_id,b.id,(manifest->>'targetCount')::int,(manifest->>'sourceCount')::int,(manifest->>'itemCount')::int,(manifest->>'reviewedCount')::int,(manifest->>'conflictCount')::int,(manifest->>'unresolvedConflictCount')::int,manifest->>'itemSetHash',manifest->>'conflictSetHash',manifest->>'resolutionSetHash',manifest->>'displayedSetHash',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('ordinal',item.ordinal,'proposalId',item.proposal_id,'proposalVersion',item.proposal_version,'targetSelectorId',item.target_selector_id,'reviewedValue',item.reviewed_value,'bindingHash',item.binding_hash) ORDER BY item.ordinal) FROM public.enterprise_assess_document_mapping_preview_items item WHERE item.preview_batch_id=batch.id),'[]'::jsonb),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('conflictId',conflict.id,'targetSelectorId',conflict.target_selector_id,'kind',conflict.kind,'proposalIds',to_jsonb(conflict.proposal_ids),'currentValueHash',conflict.current_value_hash,'currentResolutionVersion',conflict.current_resolution_version) ORDER BY conflict.target_selector_id,conflict.kind) FROM public.enterprise_assess_document_mapping_conflicts conflict WHERE conflict.preview_batch_id=batch.id),'[]'::jsonb),'[]'::jsonb,manifest;
 result:=jsonb_build_object('resourceId',batch.id,'previewBatchId',batch.id,'status',CASE WHEN conflicts>0 THEN 'conflict_unresolved' ELSE 'previewed' END,'materialConflictCount',conflicts,'previewManifest',manifest);
 PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'assess.document-map.preview','command',batch.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_resolve_assess_document_mapping_conflict_v1(
 p_conflict uuid,p_expected_resolution_version bigint,p_resolution text,p_chosen_proposal uuid,p_authored_value jsonb,p_rationale text,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;c public.enterprise_assess_document_mapping_conflicts;v public.enterprise_assess_document_mapping_conflict_resolutions;t public.enterprise_assess_document_mapping_targets;batch public.enterprise_assess_document_mapping_preview_batches;manifest jsonb;next_manifest_version bigint;result jsonb;
BEGIN
 r:=public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,'assess.document-map.conflict.resolve',p_authorization_version,p_execution_token,p_execution_fence,'apply');
 SELECT * INTO c FROM public.enterprise_assess_document_mapping_conflicts WHERE id=p_conflict AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO batch FROM public.enterprise_assess_document_mapping_preview_batches WHERE id=c.preview_batch_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT target_row.* INTO t FROM public.enterprise_assess_document_mapping_targets target_row WHERE target_row.catalog_id=batch.catalog_id AND target_row.selector_id=c.target_selector_id;
 IF c.id IS NULL OR c.current_resolution_version IS DISTINCT FROM p_expected_resolution_version OR p_resolution NOT IN('choose_candidate','retain_manual','authored_resolution') OR length(btrim(COALESCE(p_rationale,''))) NOT BETWEEN 1 AND 2000 OR (p_resolution='choose_candidate' AND NOT p_chosen_proposal=ANY(c.proposal_ids)) OR (p_resolution='authored_resolution' AND (p_authored_value IS NULL OR public.enterprise_assess_document_mapping_target_value_valid(t,p_authored_value) IS NOT TRUE)) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_CONFLICT_STALE';END IF;
 PERFORM public.enterprise_assess_document_mapping_assert_run_fresh((SELECT proposal.run_id FROM public.enterprise_assess_document_mapping_preview_items item JOIN public.enterprise_assess_document_mapping_proposals proposal ON proposal.id=item.proposal_id WHERE item.preview_batch_id=c.preview_batch_id ORDER BY item.ordinal LIMIT 1));
 INSERT INTO public.enterprise_assess_document_mapping_conflict_resolutions(conflict_id,org_id,workspace_id,version,resolution,chosen_proposal_id,authored_value,rationale,resolver_id,authorization_version,receipt_id) VALUES(c.id,p_org,p_workspace,p_expected_resolution_version+1,p_resolution,p_chosen_proposal,p_authored_value,btrim(p_rationale),p_actor,p_authorization_version,r.id) RETURNING * INTO v;UPDATE public.enterprise_assess_document_mapping_conflicts SET current_resolution_version=v.version WHERE id=c.id;
 SELECT COALESCE(max(stored.manifest_version),0)+1 INTO next_manifest_version FROM public.enterprise_assess_document_mapping_preview_manifests stored WHERE stored.preview_batch_id=batch.id;
 manifest:=public.enterprise_assess_document_mapping_preview_manifest_json(batch.id,next_manifest_version);
 INSERT INTO public.enterprise_assess_document_mapping_preview_manifests(preview_batch_id,manifest_version,org_id,workspace_id,catalog_id,catalog_hash,assess_case_id,case_version,input_bundle_id,input_bundle_version_id,target_count,source_count,item_count,reviewed_count,conflict_count,unresolved_conflict_count,item_set_hash,conflict_set_hash,resolution_set_hash,displayed_set_hash,item_bindings,conflict_bindings,resolution_bindings,manifest)
 SELECT batch.id,next_manifest_version,p_org,p_workspace,batch.catalog_id,batch.catalog_hash,batch.assess_case_id,batch.expected_case_version,batch.input_bundle_id,batch.input_bundle_version_id,(manifest->>'targetCount')::int,(manifest->>'sourceCount')::int,(manifest->>'itemCount')::int,(manifest->>'reviewedCount')::int,(manifest->>'conflictCount')::int,(manifest->>'unresolvedConflictCount')::int,manifest->>'itemSetHash',manifest->>'conflictSetHash',manifest->>'resolutionSetHash',manifest->>'displayedSetHash',
  COALESCE((SELECT jsonb_agg(jsonb_build_object('ordinal',item.ordinal,'proposalId',item.proposal_id,'proposalVersion',item.proposal_version,'targetSelectorId',item.target_selector_id,'reviewedValue',item.reviewed_value,'bindingHash',item.binding_hash) ORDER BY item.ordinal) FROM public.enterprise_assess_document_mapping_preview_items item WHERE item.preview_batch_id=batch.id),'[]'::jsonb),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('conflictId',conflict.id,'targetSelectorId',conflict.target_selector_id,'kind',conflict.kind,'proposalIds',to_jsonb(conflict.proposal_ids),'currentValueHash',conflict.current_value_hash,'currentResolutionVersion',conflict.current_resolution_version) ORDER BY conflict.target_selector_id,conflict.kind) FROM public.enterprise_assess_document_mapping_conflicts conflict WHERE conflict.preview_batch_id=batch.id),'[]'::jsonb),
  COALESCE((SELECT jsonb_agg(jsonb_build_object('conflictId',conflict.id,'version',resolution.version,'resolution',resolution.resolution,'chosenProposalId',resolution.chosen_proposal_id,'authoredValue',resolution.authored_value,'rationale',resolution.rationale) ORDER BY conflict.target_selector_id,conflict.kind) FROM public.enterprise_assess_document_mapping_conflicts conflict JOIN public.enterprise_assess_document_mapping_conflict_resolutions resolution ON resolution.conflict_id=conflict.id AND resolution.version=conflict.current_resolution_version WHERE conflict.preview_batch_id=batch.id),'[]'::jsonb),manifest;
 result:=jsonb_build_object('resourceId',c.id,'conflictId',c.id,'version',v.version,'status','resolved','previewManifest',manifest);PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'assess.document-map.conflict.resolve','command',c.id,result,'committed');RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_fact_key(p_facts jsonb,p_field text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE alias text:=replace(p_field,'primitive.','');
BEGIN
 IF alias IS DISTINCT FROM p_field AND p_facts ? p_field AND p_facts ? alias AND p_facts->p_field IS DISTINCT FROM p_facts->alias THEN
  RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_FACT_ALIAS_CONFLICT';
 END IF;
 RETURN p_field;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_normalize_primitive_facts(p_authoring jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE result jsonb:=p_authoring;normalized jsonb:='[]'::jsonb;primitive jsonb;facts jsonb;fact jsonb;canonical text;alias text;
BEGIN
 FOR primitive IN SELECT value FROM jsonb_array_elements(result->'primitives') LOOP
  facts:=primitive->'facts';
  FOREACH canonical IN ARRAY ARRAY['primitive.documentQualityRepresentative','primitive.exceptionSamplesAvailable','primitive.rulesStable','primitive.interfaceDependencyKnown','primitive.workflowPatternKnown','primitive.ambiguityCharacterized','primitive.controlRequirementsKnown'] LOOP
   alias:=replace(canonical,'primitive.','');
   IF facts ? canonical AND facts ? alias AND facts->canonical IS DISTINCT FROM facts->alias THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_FACT_ALIAS_CONFLICT';END IF;
   IF facts ? alias THEN fact:=facts->alias;facts:=facts-alias;
   ELSIF facts ? canonical THEN fact:=facts->canonical;
   ELSE CONTINUE;END IF;
   fact:=jsonb_set(fact,'{fieldId}',to_jsonb(canonical),true);
   facts:=jsonb_set(facts,ARRAY[canonical],fact,true);
  END LOOP;
  normalized:=normalized||jsonb_build_array(jsonb_set(primitive,'{facts}',facts,false));
 END LOOP;
 RETURN jsonb_set(result,'{primitives}',normalized,false);
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_merge_fact(p_old jsonb,p_field text,p_value jsonb,p_evidence uuid)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT jsonb_build_object('fieldId',p_field,'value',p_value,'status',CASE WHEN jsonb_typeof(p_value)='null' THEN 'unknown' ELSE 'suggested' END,'evidenceIds',COALESCE(p_old->'evidenceIds','[]'::jsonb)||jsonb_build_array(p_evidence),'source',COALESCE(p_old->>'source','system'))$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_apply_target(p_authoring jsonb,p_target public.enterprise_assess_document_mapping_targets,p_value jsonb,p_evidence uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path=pg_catalog AS $$
DECLARE result jsonb:=p_authoring;key text;fact jsonb;entity jsonb;new_id uuid:=gen_random_uuid();primitive_type text;asset_id uuid;primitive_id uuid;
BEGIN
 key:=replace(replace(replace(p_target.field_id,'primitive.',''),'asset.',''),'interaction.','');
 IF p_target.target_kind='case_field' THEN RETURN jsonb_set(result,ARRAY[replace(p_target.field_id,'case.','')],p_value,true);END IF;
 IF p_target.target_kind='agent_fact' AND p_target.entity_id IS NULL THEN fact:=public.enterprise_assess_document_merge_fact(result#>ARRAY['agentNecessity',replace(p_target.field_id,'agent.','')],p_target.field_id,p_value,p_evidence);RETURN jsonb_set(result,ARRAY['agentNecessity',replace(p_target.field_id,'agent.','')],fact,true);END IF;
 IF p_target.target_kind IN('primitive_field','primitive_fact','agent_fact') THEN
  SELECT jsonb_agg(CASE WHEN item->>'id'=p_target.entity_id::text THEN CASE WHEN p_target.target_kind='primitive_field' THEN jsonb_set(jsonb_set(item,ARRAY[key],p_value,true),'{evidenceIds}',COALESCE(item->'evidenceIds','[]'::jsonb)||jsonb_build_array(p_evidence),true) WHEN p_target.target_kind='primitive_fact' THEN jsonb_set(item,ARRAY['facts',public.enterprise_assess_document_fact_key(item->'facts',p_target.field_id)],public.enterprise_assess_document_merge_fact(item#>ARRAY['facts',public.enterprise_assess_document_fact_key(item->'facts',p_target.field_id)],public.enterprise_assess_document_fact_key(item->'facts',p_target.field_id),p_value,p_evidence),true) ELSE jsonb_set(item,ARRAY['agentNecessity',replace(p_target.field_id,'agent.','')],public.enterprise_assess_document_merge_fact(item#>ARRAY['agentNecessity',replace(p_target.field_id,'agent.','')],p_target.field_id,p_value,p_evidence),true) END ELSE item END ORDER BY ord) INTO entity FROM jsonb_array_elements(result->'primitives') WITH ORDINALITY x(item,ord);RETURN jsonb_set(result,'{primitives}',entity,false);
 ELSIF p_target.target_kind='asset_field' THEN SELECT jsonb_agg(CASE WHEN item->>'id'=p_target.entity_id::text THEN jsonb_set(jsonb_set(item,ARRAY[key],p_value,true),'{evidenceIds}',COALESCE(item->'evidenceIds','[]'::jsonb)||jsonb_build_array(p_evidence),true) ELSE item END ORDER BY ord) INTO entity FROM jsonb_array_elements(result->'assets') WITH ORDINALITY x(item,ord);RETURN jsonb_set(result,'{assets}',entity,false);
 ELSIF p_target.target_kind IN('interaction_field','interaction_fact') THEN SELECT jsonb_agg(CASE WHEN item->>'id'=p_target.entity_id::text THEN jsonb_set(CASE WHEN p_target.target_kind='interaction_field' THEN jsonb_set(item,ARRAY[key],p_value,true) ELSE jsonb_set(item,ARRAY['facts',replace(p_target.field_id,'interaction.','')],p_value,true) END,'{evidenceIds}',COALESCE(item->'evidenceIds','[]'::jsonb)||jsonb_build_array(p_evidence),true) ELSE item END ORDER BY ord) INTO entity FROM jsonb_array_elements(result->'interactions') WITH ORDINALITY x(item,ord);RETURN jsonb_set(result,'{interactions}',entity,false);
 ELSIF p_target.target_kind='create_primitive' THEN primitive_type:=split_part(p_target.field_id,':',2);IF primitive_type NOT IN('Capture','Extract','Classify','Validate','Calculate','Reconcile','Retrieve','Investigate','Decide','Approve','Route','Execute','Communicate','Monitor','Audit') THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_TARGET_INVALID';END IF;entity:=jsonb_build_object('id',new_id,'type',primitive_type,'name',p_value->>'name','description',p_value->>'description','inputs',COALESCE(p_value->'inputs','[]'::jsonb),'outputs',COALESCE(p_value->'outputs','[]'::jsonb),'volumeShare',NULL,'manualEffort',NULL,'rules',COALESCE(p_value->'rules','[]'::jsonb),'exceptionIds','[]'::jsonb,'evidenceIds',jsonb_build_array(p_evidence),'facts','{}'::jsonb)||(p_value-ARRAY['name','description','inputs','outputs','rules']);RETURN jsonb_set(result,'{primitives}',(result->'primitives')||jsonb_build_array(entity),false);
 ELSIF p_target.target_kind='create_asset' THEN entity:=jsonb_build_object('id',new_id,'name',p_value->>'name','strategicLifespan','unknown','technicalHealth','unknown','businessCriticality','unknown','ownershipModel','unknown','vendorRoadmap','unknown','operatingStability','unknown','accountableOwner',p_value->'accountableOwner','evidenceIds',jsonb_build_array(p_evidence));RETURN jsonb_set(result,'{assets}',(result->'assets')||jsonb_build_array(entity),false);
 ELSIF p_target.target_kind='create_interaction' THEN asset_id:=split_part(p_target.field_id,':',2)::uuid;primitive_id:=split_part(p_target.field_id,':',3)::uuid;entity:=jsonb_build_object('id',new_id,'assetId',asset_id,'primitiveId',primitive_id,'operationName',p_value->>'operationName','mode',p_value->>'mode','dataClassification',p_value->>'dataClassification','facts',jsonb_build_object('interfaceAvailable',NULL,'operationCovered',NULL,'apiDocumented',NULL,'machineIdentity',NULL,'leastPrivilege',NULL,'dataQuality',NULL,'dataClassified',NULL,'auditable',NULL,'idempotent',NULL,'compensatable',NULL,'rollback',NULL,'testEnvironment',NULL,'monitored',NULL,'uiStable',NULL,'eventSemantics',NULL,'errorContract',NULL,'capacityKnown',NULL,'accountableOwner',NULL,'highImpact',p_value->'highImpact','financialAction',p_value->'financialAction','untrustedContentWithTools',p_value->'untrustedContentWithTools'),'evidenceIds',jsonb_build_array(p_evidence));RETURN jsonb_set(result,'{interactions}',(result->'interactions')||jsonb_build_array(entity),false);
 ELSIF p_target.target_kind='create_decision_point' THEN primitive_id:=p_target.entity_id;entity:=p_value||jsonb_build_object('id',new_id,'primitiveId',primitive_id,'evidenceIds',jsonb_build_array(p_evidence));RETURN jsonb_set(result,'{decisionPoints}',(result->'decisionPoints')||jsonb_build_array(entity),false);
 ELSIF p_target.target_kind='create_exception_path' THEN primitive_id:=p_target.entity_id;entity:=p_value||jsonb_build_object('id',new_id,'fromPrimitiveId',primitive_id,'resolutionPrimitiveIds','[]'::jsonb,'evidenceIds',jsonb_build_array(p_evidence));RETURN jsonb_set(result,'{exceptionPaths}',(result->'exceptionPaths')||jsonb_build_array(entity),false);
 END IF;RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_document_authoring_valid(p_authoring jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE x jsonb;
BEGIN
 IF jsonb_typeof(p_authoring)<>'object' OR length(btrim(COALESCE(p_authoring->>'name',''))) NOT BETWEEN 1 AND 200 OR length(COALESCE(p_authoring->>'description',''))>4000 OR public.pr1d_authoring_facts_valid(p_authoring) IS NOT TRUE THEN RETURN false;END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_authoring->'primitives') LOOP IF NOT(x ?& ARRAY['id','type','name','description','inputs','outputs','volumeShare','manualEffort','rules','exceptionIds','evidenceIds','facts']) OR (x-ARRAY['id','type','name','description','trigger','inputs','outputs','owner','volumeShare','manualEffort','rules','exceptionIds','evidenceIds','facts','businessDisposition','agentNecessity'])<>'{}'::jsonb OR COALESCE(x->>'id','')!~*'^[0-9a-f-]{36}$' OR x->>'type' NOT IN('Capture','Extract','Classify','Validate','Calculate','Reconcile','Retrieve','Investigate','Decide','Approve','Route','Execute','Communicate','Monitor','Audit') OR length(btrim(COALESCE(x->>'name',''))) NOT BETWEEN 1 AND 200 OR length(btrim(COALESCE(x->>'description',''))) NOT BETWEEN 1 AND 4000 OR (x ? 'trigger' AND (jsonb_typeof(x->'trigger')<>'string' OR length(x->>'trigger')>500)) OR (x ? 'owner' AND (jsonb_typeof(x->'owner')<>'string' OR length(x->>'owner')>200)) OR (jsonb_typeof(x->'volumeShare') NOT IN('number','null') OR (jsonb_typeof(x->'volumeShare')='number' AND (x->>'volumeShare')::numeric NOT BETWEEN 0 AND 1)) OR (jsonb_typeof(x->'manualEffort') NOT IN('number','null') OR (jsonb_typeof(x->'manualEffort')='number' AND (x->>'manualEffort')::numeric NOT BETWEEN 0 AND 10000000)) OR jsonb_typeof(x->'inputs')<>'array' OR jsonb_array_length(x->'inputs')>200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'inputs') i WHERE jsonb_typeof(i.value)<>'string' OR length(i.value#>>'{}')>1000) OR jsonb_typeof(x->'outputs')<>'array' OR jsonb_array_length(x->'outputs')>200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'outputs') i WHERE jsonb_typeof(i.value)<>'string' OR length(i.value#>>'{}')>1000) OR jsonb_typeof(x->'rules')<>'array' OR jsonb_array_length(x->'rules')>200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'rules') i WHERE jsonb_typeof(i.value)<>'string' OR length(i.value#>>'{}')>1000) OR jsonb_typeof(x->'exceptionIds')<>'array' OR jsonb_typeof(x->'evidenceIds')<>'array' OR jsonb_typeof(x->'facts')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(x->'facts'))>200 THEN RETURN false;END IF;END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_authoring->'assets') LOOP IF NOT(x ?& ARRAY['id','name','strategicLifespan','technicalHealth','businessCriticality','ownershipModel','vendorRoadmap','operatingStability','accountableOwner','evidenceIds']) OR (x-ARRAY['id','name','strategicLifespan','technicalHealth','businessCriticality','ownershipModel','vendorRoadmap','operatingStability','accountableOwner','evidenceIds'])<>'{}'::jsonb OR COALESCE(x->>'id','')!~*'^[0-9a-f-]{36}$' OR length(btrim(COALESCE(x->>'name',''))) NOT BETWEEN 1 AND 200 OR x->>'strategicLifespan' NOT IN('short','medium','long','unknown') OR x->>'technicalHealth' NOT IN('healthy','constrained','end-of-life','unknown') OR x->>'businessCriticality' NOT IN('low','medium','high','critical','unknown') OR x->>'ownershipModel' NOT IN('source-owned','vendor-owned','shared','unknown') OR x->>'vendorRoadmap' NOT IN('supportive','constrained','end-of-life','unknown') OR x->>'operatingStability' NOT IN('stable','variable','unstable','unknown') OR jsonb_typeof(x->'accountableOwner') NOT IN('string','null') OR (jsonb_typeof(x->'accountableOwner')='string' AND length(x->>'accountableOwner')>200) OR jsonb_typeof(x->'evidenceIds')<>'array' THEN RETURN false;END IF;END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_authoring->'interactions') LOOP IF NOT(x ?& ARRAY['id','assetId','primitiveId','operationName','mode','dataClassification','facts','evidenceIds']) OR (x-ARRAY['id','assetId','primitiveId','operationName','mode','dataClassification','facts','evidenceIds'])<>'{}'::jsonb OR COALESCE(x->>'id','')!~*'^[0-9a-f-]{36}$' OR COALESCE(x->>'assetId','')!~*'^[0-9a-f-]{36}$' OR COALESCE(x->>'primitiveId','')!~*'^[0-9a-f-]{36}$' OR length(btrim(COALESCE(x->>'operationName',''))) NOT BETWEEN 1 AND 200 OR x->>'mode' NOT IN('read','write','event','ui','operational') OR x->>'dataClassification' NOT IN('Public','Internal','Confidential','Restricted','Unknown') OR jsonb_typeof(x->'facts')<>'object' OR NOT(x->'facts' ?& ARRAY['interfaceAvailable','operationCovered','apiDocumented','machineIdentity','leastPrivilege','dataQuality','dataClassified','auditable','idempotent','compensatable','rollback','testEnvironment','monitored','uiStable','eventSemantics','errorContract','capacityKnown','accountableOwner','highImpact','financialAction','untrustedContentWithTools']) OR ((x->'facts')-ARRAY['interfaceAvailable','operationCovered','apiDocumented','machineIdentity','leastPrivilege','dataQuality','dataClassified','auditable','idempotent','compensatable','rollback','testEnvironment','monitored','uiStable','eventSemantics','errorContract','capacityKnown','accountableOwner','highImpact','financialAction','untrustedContentWithTools'])<>'{}'::jsonb OR jsonb_typeof(x->'facts'->'highImpact')<>'boolean' OR jsonb_typeof(x->'facts'->'financialAction')<>'boolean' OR jsonb_typeof(x->'facts'->'untrustedContentWithTools')<>'boolean' OR jsonb_typeof(x->'evidenceIds')<>'array' THEN RETURN false;END IF;END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_authoring->'decisionPoints') LOOP IF NOT(x ?& ARRAY['id','primitiveId','name','ruleDescription','outcomeLabels','evidenceIds']) OR (x-ARRAY['id','primitiveId','name','ruleDescription','outcomeLabels','evidenceIds'])<>'{}'::jsonb OR COALESCE(x->>'id','')!~*'^[0-9a-f-]{36}$' OR COALESCE(x->>'primitiveId','')!~*'^[0-9a-f-]{36}$' OR length(btrim(COALESCE(x->>'name',''))) NOT BETWEEN 1 AND 200 OR length(btrim(COALESCE(x->>'ruleDescription',''))) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(x->'outcomeLabels')<>'array' OR jsonb_array_length(x->'outcomeLabels')>200 OR EXISTS(SELECT 1 FROM jsonb_array_elements(x->'outcomeLabels') i WHERE jsonb_typeof(i.value)<>'string' OR length(i.value#>>'{}')>1000) OR jsonb_typeof(x->'evidenceIds')<>'array' THEN RETURN false;END IF;END LOOP;
 FOR x IN SELECT value FROM jsonb_array_elements(p_authoring->'exceptionPaths') LOOP IF NOT(x ?& ARRAY['id','fromPrimitiveId','name','trigger','resolutionPrimitiveIds','evidenceIds']) OR (x-ARRAY['id','fromPrimitiveId','name','trigger','resolutionPrimitiveIds','evidenceIds'])<>'{}'::jsonb OR COALESCE(x->>'id','')!~*'^[0-9a-f-]{36}$' OR COALESCE(x->>'fromPrimitiveId','')!~*'^[0-9a-f-]{36}$' OR length(btrim(COALESCE(x->>'name',''))) NOT BETWEEN 1 AND 200 OR length(btrim(COALESCE(x->>'trigger',''))) NOT BETWEEN 1 AND 2000 OR jsonb_typeof(x->'resolutionPrimitiveIds')<>'array' OR jsonb_typeof(x->'evidenceIds')<>'array' THEN RETURN false;END IF;END LOOP;
 RETURN jsonb_typeof(p_authoring->'edges')='array' AND jsonb_typeof(p_authoring->'evidence')='array';
EXCEPTION WHEN OTHERS THEN RETURN false;END$$;

CREATE OR REPLACE FUNCTION public.enterprise_commit_assess_document_mapping_preview_v1(
 p_batch uuid,p_catalog uuid,p_catalog_hash text,p_case uuid,p_expected_case_version bigint,p_input_bundle uuid,p_input_bundle_version uuid,p_preview_manifest jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;batch public.enterprise_assess_document_mapping_preview_batches;manifest_row public.enterprise_assess_document_mapping_preview_manifests;catalog public.enterprise_assess_document_mapping_catalogs;c public.assess_v2_cases;oldv public.assess_v2_case_versions;newv public.assess_v2_case_versions;item record;bound_run record;t public.enterprise_assess_document_mapping_targets;resolution record;effective jsonb;derived_manifest jsonb;apply_value jsonb;authoring jsonb;evidence jsonb;outcome text;applied jsonb:='[]'::jsonb;applications jsonb:='[]'::jsonb;app jsonb;ordinal int:=0;
BEGIN
 r:=public.enterprise_assess_document_mapping_assert(p_receipt,p_actor,p_org,p_workspace,'assess.document-map.commit',p_authorization_version,p_execution_token,p_execution_fence,'apply');
 SELECT * INTO batch FROM public.enterprise_assess_document_mapping_preview_batches WHERE id=p_batch AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO manifest_row FROM public.enterprise_assess_document_mapping_preview_manifests WHERE preview_batch_id=p_batch AND org_id=p_org AND workspace_id=p_workspace ORDER BY manifest_version DESC LIMIT 1 FOR SHARE;
 SELECT * INTO catalog FROM public.enterprise_assess_document_mapping_catalogs WHERE id=p_catalog AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case AND org_id=p_org AND workspace_id=p_workspace AND status='draft' AND deleted_at IS NULL FOR UPDATE;SELECT * INTO oldv FROM public.assess_v2_case_versions WHERE id=c.head_version_id AND case_id=c.id FOR SHARE;
 IF jsonb_typeof(p_preview_manifest)<>'object' OR NOT(p_preview_manifest ?& ARRAY['previewBatchId','manifestVersion','catalogId','catalogHash','caseId','caseVersion','inputBundleId','inputBundleVersionId','targetCount','sourceCount','itemCount','reviewedCount','conflictCount','unresolvedConflictCount','itemSetHash','conflictSetHash','resolutionSetHash','displayedSetHash']) OR (p_preview_manifest-ARRAY['previewBatchId','manifestVersion','catalogId','catalogHash','caseId','caseVersion','inputBundleId','inputBundleVersionId','targetCount','sourceCount','itemCount','reviewedCount','conflictCount','unresolvedConflictCount','itemSetHash','conflictSetHash','resolutionSetHash','displayedSetHash'])<>'{}'::jsonb OR manifest_row.preview_batch_id IS NULL OR manifest_row.manifest IS DISTINCT FROM p_preview_manifest THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_COMMIT_STALE';END IF;
 IF EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_applications WHERE preview_batch_id=p_batch AND receipt_id=r.id) THEN
  IF batch.id IS NULL OR catalog.id IS NULL OR batch.catalog_id IS DISTINCT FROM catalog.id OR batch.catalog_hash IS DISTINCT FROM p_catalog_hash OR catalog.catalog_hash IS DISTINCT FROM p_catalog_hash OR batch.assess_case_id IS DISTINCT FROM p_case OR batch.expected_case_version IS DISTINCT FROM p_expected_case_version OR batch.input_bundle_id IS DISTINCT FROM p_input_bundle OR batch.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_applications WHERE preview_batch_id=p_batch AND receipt_id=r.id AND assess_case_id IS DISTINCT FROM p_case) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_COMMIT_STALE';END IF;
  SELECT jsonb_build_object('resourceId',p_case,'caseId',p_case,'caseVersion',max(application.assess_case_version),'previewBatchId',p_batch,'appliedProposalIds',COALESCE(jsonb_agg(application.proposal_id ORDER BY application.batch_ordinal) FILTER(WHERE application.outcome IN('applied','evidence_only')),'[]'::jsonb)) INTO effective FROM public.enterprise_assess_document_mapping_applications application WHERE application.preview_batch_id=p_batch AND application.receipt_id=r.id;
  RETURN effective;
 END IF;
 derived_manifest:=public.enterprise_assess_document_mapping_preview_manifest_json(batch.id,manifest_row.manifest_version);
 IF derived_manifest IS DISTINCT FROM manifest_row.manifest THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_COMMIT_STALE';END IF;
 FOR bound_run IN SELECT DISTINCT proposal_row.run_id FROM public.enterprise_assess_document_mapping_preview_items preview_row JOIN public.enterprise_assess_document_mapping_proposals proposal_row ON proposal_row.id=preview_row.proposal_id WHERE preview_row.preview_batch_id=batch.id ORDER BY proposal_row.run_id LOOP
  PERFORM public.enterprise_assess_document_mapping_assert_run_fresh(bound_run.run_id);
 END LOOP;
 IF batch.id IS NULL OR catalog.id IS NULL OR batch.catalog_id IS DISTINCT FROM catalog.id OR batch.catalog_hash IS DISTINCT FROM p_catalog_hash OR catalog.catalog_hash IS DISTINCT FROM p_catalog_hash OR batch.assess_case_id IS DISTINCT FROM p_case OR batch.expected_case_version IS DISTINCT FROM p_expected_case_version OR c.version IS DISTINCT FROM p_expected_case_version OR batch.input_bundle_id IS DISTINCT FROM p_input_bundle OR batch.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version OR batch.expires_at<=statement_timestamp() OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_conflicts conflict LEFT JOIN public.enterprise_assess_document_mapping_conflict_resolutions cr ON cr.conflict_id=conflict.id AND cr.version=conflict.current_resolution_version WHERE conflict.preview_batch_id=batch.id AND cr.id IS NULL) OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_conflicts conflict JOIN public.enterprise_assess_document_mapping_conflict_resolutions cr ON cr.conflict_id=conflict.id AND cr.version=conflict.current_resolution_version WHERE conflict.preview_batch_id=batch.id GROUP BY conflict.target_selector_id HAVING count(DISTINCT ROW(cr.resolution,COALESCE(cr.chosen_proposal_id::text,''),COALESCE(cr.authored_value::text,'')))>1) OR EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_applications WHERE preview_batch_id=batch.id) THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_COMMIT_STALE';END IF;
 authoring:=public.enterprise_assess_document_normalize_primitive_facts(jsonb_build_object('name',oldv.name,'description',oldv.description,'agentNecessity',oldv.agent_necessity,'primitives',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_primitives WHERE version_id=oldv.id),'[]'),'edges',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_edges WHERE version_id=oldv.id),'[]'),'decisionPoints',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_decision_points WHERE version_id=oldv.id),'[]'),'exceptionPaths',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_exception_paths WHERE version_id=oldv.id),'[]'),'assets',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_application_assets WHERE version_id=oldv.id),'[]'),'interactions',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_application_interactions WHERE version_id=oldv.id),'[]'),'evidence',COALESCE((SELECT jsonb_agg(payload ORDER BY id) FROM public.assess_v2_evidence_links WHERE version_id=oldv.id),'[]')));
 FOR item IN SELECT i.*,p.source_id FROM public.enterprise_assess_document_mapping_preview_items i JOIN public.enterprise_assess_document_mapping_proposals p ON p.id=i.proposal_id WHERE i.preview_batch_id=batch.id ORDER BY i.ordinal LOOP
  ordinal:=ordinal+1;SELECT * INTO t FROM public.enterprise_assess_document_mapping_targets WHERE selector_id=item.target_selector_id;SELECT cr.resolution,cr.chosen_proposal_id,cr.authored_value INTO resolution FROM public.enterprise_assess_document_mapping_conflicts conflict JOIN public.enterprise_assess_document_mapping_conflict_resolutions cr ON cr.conflict_id=conflict.id AND cr.version=conflict.current_resolution_version WHERE conflict.preview_batch_id=batch.id AND conflict.target_selector_id=t.selector_id ORDER BY CASE conflict.kind WHEN 'cross_source' THEN 1 ELSE 2 END LIMIT 1;
  outcome:='applied';apply_value:=item.reviewed_value;
  IF resolution.resolution='retain_manual' OR (resolution.resolution='choose_candidate' AND resolution.chosen_proposal_id IS DISTINCT FROM item.proposal_id) THEN outcome:='retained_manual';
  ELSIF resolution.resolution='authored_resolution' THEN apply_value:=resolution.authored_value;IF EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_preview_items prior WHERE prior.preview_batch_id=batch.id AND prior.target_selector_id=t.selector_id AND prior.ordinal<item.ordinal) THEN outcome:='deduplicated';END IF;
  ELSIF EXISTS(SELECT 1 FROM public.enterprise_assess_document_mapping_preview_items prior WHERE prior.preview_batch_id=batch.id AND prior.target_selector_id=t.selector_id AND prior.ordinal<item.ordinal) THEN outcome:='deduplicated';END IF;
  evidence:=public.enterprise_build_assess_v2_evidence_submission(item.planned_evidence_id,'upload',(SELECT mime_type FROM public.enterprise_evidence_sources WHERE id=item.source_id));authoring:=jsonb_set(authoring,'{evidence}',(authoring->'evidence')||jsonb_build_array(evidence),false);
  IF t.target_kind='evidence_only' THEN outcome:='evidence_only';ELSIF outcome='applied' THEN authoring:=public.enterprise_assess_document_apply_target(authoring,t,apply_value,item.planned_evidence_id);END IF;
  applications:=applications||jsonb_build_array(jsonb_build_object('proposalId',item.proposal_id,'targetSelectorId',t.selector_id,'outcome',outcome,'evidenceId',item.planned_evidence_id,'ordinal',ordinal));IF outcome IN('applied','evidence_only') THEN applied:=applied||jsonb_build_array(item.proposal_id);END IF;
 END LOOP;
 IF public.enterprise_assess_document_authoring_valid(authoring) IS NOT TRUE THEN RAISE EXCEPTION 'ENTERPRISE_ASSESS_DOCUMENT_MAPPING_NATIVE_SHAPE_INVALID';END IF;
 INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,imported_facts,created_by) VALUES(c.id,p_org,p_workspace,c.version+1,authoring->>'name',authoring->>'description',authoring->'agentNecessity','draft_upsert',oldv.source_snapshot,oldv.imported_facts,p_actor) RETURNING * INTO newv;
 INSERT INTO public.assess_v2_primitives SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'primitives') x;INSERT INTO public.assess_v2_edges SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'edges') x;INSERT INTO public.assess_v2_decision_points SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'decisionPoints') x;INSERT INTO public.assess_v2_exception_paths SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'exceptionPaths') x;INSERT INTO public.assess_v2_application_assets SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'assets') x;INSERT INTO public.assess_v2_application_interactions SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'interactions') x;INSERT INTO public.assess_v2_evidence_links SELECT (x->>'id')::uuid,newv.id,c.id,p_org,p_workspace,x FROM jsonb_array_elements(authoring->'evidence') x;
 FOR app IN SELECT value FROM jsonb_array_elements(applications) LOOP INSERT INTO public.enterprise_assess_document_mapping_applications(preview_batch_id,proposal_id,target_selector_id,org_id,workspace_id,assess_case_id,assess_case_version_id,assess_case_version,outcome,evidence_id,receipt_id,batch_ordinal) VALUES(batch.id,(app->>'proposalId')::uuid,(app->>'targetSelectorId')::uuid,p_org,p_workspace,c.id,newv.id,newv.version,app->>'outcome',(app->>'evidenceId')::uuid,r.id,(app->>'ordinal')::int);END LOOP;
 UPDATE public.assess_v2_cases SET version=newv.version,head_version_id=newv.id,updated_at=statement_timestamp() WHERE id=c.id;
 effective:=jsonb_build_object('resourceId',c.id,'caseId',c.id,'caseVersion',newv.version,'previewBatchId',batch.id,'appliedProposalIds',applied);PERFORM public.enterprise_ai_record_effect(r.id,p_org,p_workspace,p_execution_token,p_execution_fence,'assess.document-map.commit','command',c.id,effective,'committed');RETURN effective;
END$$;

-- The legacy generic mapper retains only its finite native case-field and
-- evidence-link compatibility surface. Entity/fact writes must use the typed
-- catalog above and cannot reach the old minimal {id,label} constructors.
CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_assess_apply_preview_batch_v2(
 p_batch uuid,p_case uuid,p_expected_case_version bigint,p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,p_source_sets jsonb,p_selections jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE result jsonb;BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'assess.v2.read',p_authorization_version);
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'assess.v2.draft.write',p_authorization_version);
 IF jsonb_typeof(p_selections)<>'array' OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_selections) s
  WHERE NOT(
   (s.value->>'intent'='set_case_field' AND s.value->>'target' IN('name','description'))
   OR (s.value->>'intent'='link_evidence_only' AND s.value->>'target'='evidence')
  )
 ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_TYPED_MAPPING_REQUIRED';END IF;
 PERFORM public.enterprise_transcript_assert_exact_bundle_lineage(p_org,p_workspace,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,p_source_sets);
 result:=public.enterprise_transcript_create_assess_apply_preview_batch(p_batch,p_case,p_expected_case_version,p_selections,p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence);
 RETURN (result-'previewId')||jsonb_build_object('previewId',p_batch,'previewBatchId',p_batch,'inputBundleId',p_input_bundle,'inputBundleVersionId',p_input_bundle_version,'inputBundleVersion',p_expected_input_bundle_version);
END$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_commit_assess_apply_preview_batch_v2(
 p_batch uuid,p_case uuid,p_expected_case_version bigint,p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,p_source_sets jsonb,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE batch public.enterprise_assess_apply_preview_batches;result jsonb;BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'assess.v2.read',p_authorization_version);
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'assess.v2.draft.write',p_authorization_version);
 PERFORM public.enterprise_transcript_assert_exact_bundle_lineage(p_org,p_workspace,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,p_source_sets);
 SELECT * INTO batch FROM public.enterprise_assess_apply_preview_batches WHERE id=p_batch AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF batch.id IS NULL OR batch.assess_case_id IS DISTINCT FROM p_case OR batch.expected_case_version IS DISTINCT FROM p_expected_case_version OR batch.input_bundle_id IS DISTINCT FROM p_input_bundle OR batch.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version OR EXISTS(
  SELECT 1 FROM public.enterprise_assess_apply_previews p WHERE p.id=ANY(batch.preview_ids) AND NOT(
   (p.application_intent='set_case_field' AND p.target_key='name' AND p.target_id IS NULL AND jsonb_typeof(p.proposed_value)='string' AND length(btrim(p.proposed_value#>>'{}')) BETWEEN 1 AND 200)
   OR (p.application_intent='set_case_field' AND p.target_key='description' AND p.target_id IS NULL AND jsonb_typeof(p.proposed_value)='string' AND length(p.proposed_value#>>'{}')<=4000)
   OR (p.application_intent='link_evidence_only' AND p.target_key='evidence' AND p.target_id IS NULL AND p.proposed_value='{}'::jsonb)
  )
 ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_TYPED_MAPPING_REQUIRED';END IF;
 result:=public.enterprise_transcript_commit_assess_apply_preview_batch(p_batch,p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence);RETURN result||jsonb_build_object('previewBatchId',p_batch,'inputBundleId',p_input_bundle,'inputBundleVersion',p_expected_input_bundle_version);
END$$;

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['enterprise_assess_document_mapping_catalogs','enterprise_assess_document_mapping_targets','enterprise_assess_document_mapping_runs','enterprise_assess_document_mapping_run_sources','enterprise_assess_document_mapping_proposals','enterprise_assess_document_mapping_reviews','enterprise_assess_document_mapping_preview_batches','enterprise_assess_document_mapping_preview_items','enterprise_assess_document_mapping_conflicts','enterprise_assess_document_mapping_conflict_resolutions','enterprise_assess_document_mapping_preview_manifests','enterprise_assess_document_mapping_applications'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,''assess.v2.read'') AND public.has_workspace_capability(workspace_id,org_id,''transcript.sources.read''))','read_'||t,t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);END LOOP;END$$;

REVOKE ALL ON FUNCTION public.enterprise_transcript_create_assess_apply_preview_batch(uuid,uuid,bigint,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint) FROM service_role;
REVOKE ALL ON FUNCTION public.enterprise_transcript_commit_assess_apply_preview_batch(uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint) FROM service_role;

REVOKE ALL ON FUNCTION public.enterprise_assess_document_mapping_assert(uuid,uuid,uuid,uuid,text,bigint,uuid,bigint,text),public.enterprise_assess_document_mapping_lock_source_set_root(),public.enterprise_assess_document_mapping_assert_run_fresh(uuid),public.enterprise_assess_document_mapping_preview_manifest_json(uuid,bigint),public.enterprise_assess_document_mapping_value_valid(text,jsonb,jsonb),public.enterprise_assess_document_mapping_target_value_valid(public.enterprise_assess_document_mapping_targets,jsonb),public.enterprise_assess_document_mapping_payload_valid(text,jsonb),public.enterprise_assess_document_target_current(uuid,text,uuid,text),public.enterprise_assess_document_mapping_target_valid(uuid,jsonb,jsonb),public.enterprise_assess_document_fact_key(jsonb,text),public.enterprise_assess_document_normalize_primitive_facts(jsonb),public.enterprise_assess_document_merge_fact(jsonb,text,jsonb,uuid),public.enterprise_assess_document_apply_target(jsonb,public.enterprise_assess_document_mapping_targets,jsonb,uuid),public.enterprise_assess_document_authoring_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.enterprise_claim_assess_document_mapping_run_v1(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_stage_assess_document_mapping_result_v1(uuid,uuid,jsonb,jsonb,text,integer,integer,integer,text,uuid,uuid,bigint),public.enterprise_commit_assess_document_mapping_result_v1(uuid,uuid,uuid,bigint),public.enterprise_fail_assess_document_mapping_run_v1(uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_review_assess_document_mapping_proposal_v1(uuid,bigint,text,jsonb,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_create_assess_document_mapping_preview_v1(uuid,uuid,text,uuid,bigint,uuid,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_resolve_assess_document_mapping_conflict_v1(uuid,bigint,text,uuid,jsonb,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_commit_assess_document_mapping_preview_v1(uuid,uuid,text,uuid,bigint,uuid,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_claim_assess_document_mapping_run_v1(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,uuid,bigint,jsonb,uuid,uuid,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_stage_assess_document_mapping_result_v1(uuid,uuid,jsonb,jsonb,text,integer,integer,integer,text,uuid,uuid,bigint),public.enterprise_commit_assess_document_mapping_result_v1(uuid,uuid,uuid,bigint),public.enterprise_fail_assess_document_mapping_run_v1(uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_review_assess_document_mapping_proposal_v1(uuid,bigint,text,jsonb,text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_create_assess_document_mapping_preview_v1(uuid,uuid,text,uuid,bigint,uuid,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_resolve_assess_document_mapping_conflict_v1(uuid,bigint,text,uuid,jsonb,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),public.enterprise_commit_assess_document_mapping_preview_v1(uuid,uuid,text,uuid,bigint,uuid,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint) TO service_role;

COMMENT ON TABLE public.enterprise_assess_document_mapping_catalogs IS 'Immutable DB-authoritative Assess target catalog for assess-supporting-document-map-v1; feature defaults off.';
COMMENT ON FUNCTION public.enterprise_commit_assess_document_mapping_preview_v1(uuid,uuid,text,uuid,bigint,uuid,uuid,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint) IS 'Atomically applies one complete displayed, reviewed and typed mapping batch as one immutable native Assess draft version while preserving source_snapshot, imported_facts, manual values by default, and evidence ancestry.';
