-- Governed multi-source transcript PR A authority forward fix.
-- Additive only: preserve committed source, candidate, application, Assess,
-- receipt, audit, and evidence rows. Rollback is feature disablement/read-only
-- projection followed by another forward migration.

ALTER TABLE public.enterprise_transcript_extraction_bindings
  ADD COLUMN source_set_id uuid,
  ADD COLUMN source_set_version_id uuid;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.enterprise_transcript_extraction_bindings binding
    WHERE (
      SELECT count(*)
      FROM public.enterprise_module_input_bundle_items bundle_item
      JOIN public.enterprise_source_set_version_items item
        ON item.source_set_version_id=bundle_item.source_set_version_id
       AND item.source_version_id=binding.source_version_id
       AND item.source_id=binding.source_id
       AND item.org_id=binding.org_id
       AND item.workspace_id=binding.workspace_id
      WHERE bundle_item.input_bundle_version_id=binding.input_bundle_version_id
    )<>1
  ) THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_UPGRADE_LINEAGE_AMBIGUOUS';
  END IF;
END;
$$;

UPDATE public.enterprise_transcript_extraction_bindings binding
SET source_set_id=(
      SELECT item.source_set_id
      FROM public.enterprise_module_input_bundle_items bundle_item
      JOIN public.enterprise_source_set_version_items item
        ON item.source_set_version_id=bundle_item.source_set_version_id
       AND item.source_version_id=binding.source_version_id
       AND item.source_id=binding.source_id
       AND item.org_id=binding.org_id
       AND item.workspace_id=binding.workspace_id
      WHERE bundle_item.input_bundle_version_id=binding.input_bundle_version_id
    ),
    source_set_version_id=(
      SELECT item.source_set_version_id
      FROM public.enterprise_module_input_bundle_items bundle_item
      JOIN public.enterprise_source_set_version_items item
        ON item.source_set_version_id=bundle_item.source_set_version_id
       AND item.source_version_id=binding.source_version_id
       AND item.source_id=binding.source_id
       AND item.org_id=binding.org_id
       AND item.workspace_id=binding.workspace_id
      WHERE bundle_item.input_bundle_version_id=binding.input_bundle_version_id
    );

ALTER TABLE public.enterprise_transcript_extraction_bindings
  ALTER COLUMN source_set_id SET NOT NULL,
  ALTER COLUMN source_set_version_id SET NOT NULL,
  ADD CONSTRAINT enterprise_transcript_binding_source_set_version_fkey
    FOREIGN KEY(source_set_version_id,source_set_id,org_id,workspace_id)
    REFERENCES public.enterprise_source_set_versions(id,source_set_id,org_id,workspace_id)
    ON DELETE RESTRICT;

ALTER TABLE public.enterprise_assess_apply_preview_batches
  ADD COLUMN input_bundle_version bigint,
  ADD COLUMN source_set_version_ids uuid[];

ALTER TABLE public.enterprise_assess_apply_preview_batches
  DISABLE TRIGGER trg_enterprise_assess_apply_preview_batches_immutable;
UPDATE public.enterprise_assess_apply_preview_batches batch
SET input_bundle_version=version.version,
    source_set_version_ids=(
      SELECT array_agg(item.source_set_version_id ORDER BY item.ordinal)
      FROM public.enterprise_module_input_bundle_items item
      WHERE item.input_bundle_version_id=batch.input_bundle_version_id
    )
FROM public.enterprise_module_input_bundle_versions version
WHERE version.id=batch.input_bundle_version_id
  AND version.input_bundle_id=batch.input_bundle_id
  AND version.org_id=batch.org_id
  AND version.workspace_id=batch.workspace_id;
ALTER TABLE public.enterprise_assess_apply_preview_batches
  ENABLE TRIGGER trg_enterprise_assess_apply_preview_batches_immutable;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.enterprise_assess_apply_preview_batches
    WHERE input_bundle_version IS NULL OR source_set_version_ids IS NULL
      OR cardinality(source_set_version_ids)<1
  ) THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_UPGRADE_PREVIEW_LINEAGE_INVALID';
  END IF;
END;
$$;

ALTER TABLE public.enterprise_assess_apply_preview_batches
  ALTER COLUMN input_bundle_version SET NOT NULL,
  ALTER COLUMN source_set_version_ids SET NOT NULL,
  ADD CONSTRAINT enterprise_assess_preview_batch_bundle_version_check CHECK(input_bundle_version>0),
  ADD CONSTRAINT enterprise_assess_preview_batch_source_sets_check CHECK(cardinality(source_set_version_ids) BETWEEN 1 AND 20);

ALTER TABLE public.enterprise_assess_candidate_applications
  ADD COLUMN preview_batch_id uuid;

ALTER TABLE public.enterprise_assess_candidate_applications
  DISABLE TRIGGER trg_enterprise_assess_candidate_applications_immutable;
UPDATE public.enterprise_assess_candidate_applications application
SET preview_batch_id=batch.id
FROM public.enterprise_assess_apply_preview_batches batch
WHERE application.preview_id=ANY(batch.preview_ids)
  AND application.org_id=batch.org_id
  AND application.workspace_id=batch.workspace_id;
ALTER TABLE public.enterprise_assess_candidate_applications
  ENABLE TRIGGER trg_enterprise_assess_candidate_applications_immutable;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.enterprise_assess_candidate_applications WHERE preview_batch_id IS NULL) THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_UPGRADE_APPLICATION_BATCH_INVALID';
  END IF;
END;
$$;

ALTER TABLE public.enterprise_assess_candidate_applications
  ALTER COLUMN preview_batch_id SET NOT NULL,
  ADD CONSTRAINT enterprise_assess_application_preview_batch_fkey
    FOREIGN KEY(preview_batch_id,org_id,workspace_id)
    REFERENCES public.enterprise_assess_apply_preview_batches(id,org_id,workspace_id)
    ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_fill_preview_batch_lineage()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE bundle public.enterprise_module_input_bundle_versions;
BEGIN
  SELECT * INTO bundle FROM public.enterprise_module_input_bundle_versions
  WHERE id=NEW.input_bundle_version_id AND input_bundle_id=NEW.input_bundle_id
    AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id FOR SHARE;
  IF bundle.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE'; END IF;
  NEW.input_bundle_version:=bundle.version;
  SELECT array_agg(item.source_set_version_id ORDER BY item.ordinal)
  INTO NEW.source_set_version_ids
  FROM public.enterprise_module_input_bundle_items item
  WHERE item.input_bundle_version_id=bundle.id;
  IF NEW.source_set_version_ids IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_transcript_preview_batch_lineage
BEFORE INSERT ON public.enterprise_assess_apply_preview_batches
FOR EACH ROW EXECUTE FUNCTION public.enterprise_transcript_fill_preview_batch_lineage();

CREATE OR REPLACE FUNCTION public.enterprise_transcript_fill_application_batch()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  SELECT batch.id INTO NEW.preview_batch_id
  FROM public.enterprise_assess_apply_preview_batches batch
  WHERE NEW.preview_id=ANY(batch.preview_ids)
    AND batch.org_id=NEW.org_id AND batch.workspace_id=NEW.workspace_id
  FOR SHARE;
  IF NEW.preview_batch_id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_transcript_application_batch
BEFORE INSERT ON public.enterprise_assess_candidate_applications
FOR EACH ROW EXECUTE FUNCTION public.enterprise_transcript_fill_application_batch();

CREATE TABLE public.enterprise_transcript_staleness_events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL,
  source_set_id uuid NOT NULL,
  superseded_source_set_version_id uuid NOT NULL,
  replacement_source_set_version_id uuid NOT NULL,
  resource_kind text NOT NULL CHECK(resource_kind IN(
    'input_bundle_version','extraction_binding','apply_preview','apply_preview_batch'
  )),
  resource_id uuid NOT NULL,
  reason text NOT NULL CHECK(reason='source_set_version_advanced'),
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE(resource_kind,resource_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
  FOREIGN KEY(superseded_source_set_version_id,source_set_id,org_id,workspace_id)
    REFERENCES public.enterprise_source_set_versions(id,source_set_id,org_id,workspace_id) ON DELETE RESTRICT,
  FOREIGN KEY(replacement_source_set_version_id,source_set_id,org_id,workspace_id)
    REFERENCES public.enterprise_source_set_versions(id,source_set_id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.enterprise_transcript_staleness_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enterprise_transcript_staleness_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.enterprise_transcript_staleness_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON TABLE public.enterprise_transcript_staleness_events TO authenticated,service_role;
CREATE POLICY enterprise_transcript_staleness_read
  ON public.enterprise_transcript_staleness_events FOR SELECT TO authenticated
  USING(public.has_workspace_capability(workspace_id,org_id,'assess.v2.read'));

CREATE TRIGGER trg_enterprise_transcript_staleness_events_immutable
BEFORE UPDATE OR DELETE ON public.enterprise_transcript_staleness_events
FOR EACH ROW EXECUTE FUNCTION public.enterprise_transcript_reject_immutable();

CREATE OR REPLACE FUNCTION public.enterprise_transcript_record_selective_staleness()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE prior_version public.enterprise_source_set_versions;
BEGIN
  IF NEW.version<=1 THEN RETURN NEW; END IF;
  SELECT * INTO prior_version FROM public.enterprise_source_set_versions
  WHERE source_set_id=NEW.source_set_id AND version=NEW.version-1
    AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id FOR SHARE;
  IF prior_version.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_VERSION_GAP';
  END IF;

  INSERT INTO public.enterprise_transcript_staleness_events(
    org_id,workspace_id,source_set_id,superseded_source_set_version_id,replacement_source_set_version_id,
    resource_kind,resource_id,reason,created_by
  )
  SELECT NEW.org_id,NEW.workspace_id,NEW.source_set_id,prior_version.id,NEW.id,
    'input_bundle_version',bundle_version.id,'source_set_version_advanced',NEW.created_by
  FROM public.enterprise_module_input_bundle_items item
  JOIN public.enterprise_module_input_bundle_versions bundle_version
    ON bundle_version.id=item.input_bundle_version_id
   AND bundle_version.org_id=NEW.org_id AND bundle_version.workspace_id=NEW.workspace_id
  WHERE item.source_set_version_id=prior_version.id
    AND NOT EXISTS(
      SELECT 1 FROM public.enterprise_assess_candidate_applications application
      WHERE application.input_bundle_version_id=bundle_version.id
    )
  ON CONFLICT(resource_kind,resource_id) DO NOTHING;

  INSERT INTO public.enterprise_transcript_staleness_events(
    org_id,workspace_id,source_set_id,superseded_source_set_version_id,replacement_source_set_version_id,
    resource_kind,resource_id,reason,created_by
  )
  SELECT NEW.org_id,NEW.workspace_id,NEW.source_set_id,prior_version.id,NEW.id,
    'extraction_binding',binding.id,'source_set_version_advanced',NEW.created_by
  FROM public.enterprise_transcript_extraction_bindings binding
  JOIN public.enterprise_transcript_staleness_events stale
    ON stale.resource_kind='input_bundle_version' AND stale.resource_id=binding.input_bundle_version_id
   AND stale.replacement_source_set_version_id=NEW.id
  ON CONFLICT(resource_kind,resource_id) DO NOTHING;

  INSERT INTO public.enterprise_transcript_staleness_events(
    org_id,workspace_id,source_set_id,superseded_source_set_version_id,replacement_source_set_version_id,
    resource_kind,resource_id,reason,created_by
  )
  SELECT NEW.org_id,NEW.workspace_id,NEW.source_set_id,prior_version.id,NEW.id,
    'apply_preview',preview.id,'source_set_version_advanced',NEW.created_by
  FROM public.enterprise_assess_apply_previews preview
  JOIN public.enterprise_transcript_staleness_events stale
    ON stale.resource_kind='input_bundle_version' AND stale.resource_id=preview.input_bundle_version_id
   AND stale.replacement_source_set_version_id=NEW.id
  WHERE NOT EXISTS(
    SELECT 1 FROM public.enterprise_assess_candidate_applications application WHERE application.preview_id=preview.id
  )
  ON CONFLICT(resource_kind,resource_id) DO NOTHING;

  INSERT INTO public.enterprise_transcript_staleness_events(
    org_id,workspace_id,source_set_id,superseded_source_set_version_id,replacement_source_set_version_id,
    resource_kind,resource_id,reason,created_by
  )
  SELECT NEW.org_id,NEW.workspace_id,NEW.source_set_id,prior_version.id,NEW.id,
    'apply_preview_batch',batch.id,'source_set_version_advanced',NEW.created_by
  FROM public.enterprise_assess_apply_preview_batches batch
  JOIN public.enterprise_transcript_staleness_events stale
    ON stale.resource_kind='input_bundle_version' AND stale.resource_id=batch.input_bundle_version_id
   AND stale.replacement_source_set_version_id=NEW.id
  WHERE NOT EXISTS(
    SELECT 1 FROM public.enterprise_assess_candidate_applications application
    WHERE application.preview_batch_id=batch.id
  )
  ON CONFLICT(resource_kind,resource_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER enterprise_transcript_selective_staleness
AFTER INSERT ON public.enterprise_source_set_versions
FOR EACH ROW EXECUTE FUNCTION public.enterprise_transcript_record_selective_staleness();

CREATE OR REPLACE FUNCTION public.enterprise_transcript_assert_exact_bundle_lineage(
  p_org uuid,p_workspace uuid,p_input_bundle uuid,p_input_bundle_version uuid,
  p_expected_input_bundle_version bigint,p_source_sets jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bundle public.enterprise_module_input_bundle_versions;
BEGIN
  IF jsonb_typeof(p_source_sets)<>'array' OR jsonb_array_length(p_source_sets) NOT BETWEEN 1 AND 20
    OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(p_source_sets) entry
      WHERE jsonb_typeof(entry.value)<>'object'
        OR NOT(entry.value ?& ARRAY['sourceSetId','sourceSetVersionSelector','expectedVersion','ordinal'])
        OR (entry.value-ARRAY['sourceSetId','sourceSetVersionSelector','expectedVersion','ordinal'])<>'{}'::jsonb
        OR COALESCE(entry.value->>'sourceSetId','')!~*'^[0-9a-f-]{36}$'
        OR COALESCE(entry.value->>'sourceSetVersionSelector','')!~*'^[0-9a-f-]{36}$'
        OR COALESCE(entry.value->>'expectedVersion','')!~'^[1-9][0-9]*$'
        OR COALESCE(entry.value->>'ordinal','')!~'^[1-9][0-9]*$'
    ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE'; END IF;
  SELECT * INTO bundle FROM public.enterprise_module_input_bundle_versions
  WHERE id=p_input_bundle_version AND input_bundle_id=p_input_bundle
    AND org_id=p_org AND workspace_id=p_workspace AND version=p_expected_input_bundle_version
    AND status='locked' FOR SHARE;
  IF bundle.id IS NULL OR EXISTS(
    SELECT 1 FROM public.enterprise_transcript_staleness_events
    WHERE resource_kind='input_bundle_version' AND resource_id=bundle.id
  ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE'; END IF;
  IF EXISTS(
    (SELECT item.source_set_id,item.source_set_version_id,version.version,item.ordinal
     FROM public.enterprise_module_input_bundle_items item
     JOIN public.enterprise_source_set_versions version ON version.id=item.source_set_version_id
     WHERE item.input_bundle_version_id=bundle.id
     EXCEPT
     SELECT (entry.value->>'sourceSetId')::uuid,(entry.value->>'sourceSetVersionSelector')::uuid,
       (entry.value->>'expectedVersion')::bigint,(entry.value->>'ordinal')::integer
     FROM jsonb_array_elements(p_source_sets) entry)
    UNION ALL
    (SELECT (entry.value->>'sourceSetId')::uuid,(entry.value->>'sourceSetVersionSelector')::uuid,
       (entry.value->>'expectedVersion')::bigint,(entry.value->>'ordinal')::integer
     FROM jsonb_array_elements(p_source_sets) entry
     EXCEPT
     SELECT item.source_set_id,item.source_set_version_id,version.version,item.ordinal
     FROM public.enterprise_module_input_bundle_items item
     JOIN public.enterprise_source_set_versions version ON version.id=item.source_set_version_id
     WHERE item.input_bundle_version_id=bundle.id)
  ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_bind_assess_extraction_v2(
  p_job uuid,p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,
  p_source_set uuid,p_source_set_version uuid,p_expected_source_set_version bigint,
  p_source uuid,p_source_version uuid,p_route uuid,p_provider_config uuid,p_model text,
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.enterprise_ai_command_receipts;bundle public.enterprise_module_input_bundle_versions;
  set_version public.enterprise_source_set_versions;job public.enterprise_ai_job_ledger;
  binding public.enterprise_transcript_extraction_bindings;result jsonb;
BEGIN
  r:=public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,
    'transcript.assess.extract','evidence.write',p_authorization_version,p_execution_token,p_execution_fence,'unified_byok');
  SELECT * INTO bundle FROM public.enterprise_module_input_bundle_versions
  WHERE id=p_input_bundle_version AND input_bundle_id=p_input_bundle AND version=p_expected_input_bundle_version
    AND org_id=p_org AND workspace_id=p_workspace AND status='locked' FOR SHARE;
  SELECT * INTO set_version FROM public.enterprise_source_set_versions
  WHERE id=p_source_set_version AND source_set_id=p_source_set AND version=p_expected_source_set_version
    AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job AND receipt_id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF bundle.id IS NULL OR set_version.id IS NULL OR job.id IS NULL OR job.actor_id IS DISTINCT FROM p_actor
    OR job.source_id IS DISTINCT FROM p_source OR job.source_version_id IS DISTINCT FROM p_source_version
    OR job.route_id IS DISTINCT FROM p_route OR job.provider_config_id IS DISTINCT FROM p_provider_config
    OR job.model IS DISTINCT FROM p_model
    OR EXISTS(SELECT 1 FROM public.enterprise_transcript_staleness_events
      WHERE resource_kind='input_bundle_version' AND resource_id=bundle.id)
    OR NOT EXISTS(
      SELECT 1 FROM public.enterprise_module_input_bundle_items bundle_item
      JOIN public.enterprise_source_set_version_items source_item
        ON source_item.source_set_version_id=bundle_item.source_set_version_id
      WHERE bundle_item.input_bundle_version_id=bundle.id
        AND bundle_item.source_set_id=p_source_set AND bundle_item.source_set_version_id=p_source_set_version
        AND source_item.source_id=p_source AND source_item.source_version_id=p_source_version
    ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_EXTRACTION_BINDING_STALE'; END IF;
  INSERT INTO public.enterprise_transcript_extraction_bindings(
    org_id,workspace_id,job_id,receipt_id,input_bundle_version_id,input_bundle_id,bundle_hash,
    source_set_id,source_set_version_id,source_id,source_version_id,
    provider_route_id,provider_config_id,model,authorization_version,created_by
  ) VALUES(
    p_org,p_workspace,job.id,r.id,bundle.id,bundle.input_bundle_id,bundle.bundle_hash,
    p_source_set,p_source_set_version,p_source,p_source_version,
    p_route,p_provider_config,p_model,p_authorization_version,p_actor
  ) ON CONFLICT(receipt_id) DO NOTHING RETURNING * INTO binding;
  IF binding.id IS NULL THEN
    SELECT * INTO binding FROM public.enterprise_transcript_extraction_bindings WHERE receipt_id=r.id FOR SHARE;
  END IF;
  IF binding.job_id IS DISTINCT FROM job.id OR binding.input_bundle_id IS DISTINCT FROM p_input_bundle
    OR binding.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version
    OR binding.source_set_id IS DISTINCT FROM p_source_set OR binding.source_set_version_id IS DISTINCT FROM p_source_set_version
    OR binding.source_id IS DISTINCT FROM p_source OR binding.source_version_id IS DISTINCT FROM p_source_version
    OR binding.provider_route_id IS DISTINCT FROM p_route OR binding.provider_config_id IS DISTINCT FROM p_provider_config
    OR binding.model IS DISTINCT FROM p_model THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_EXTRACTION_BINDING_STALE';
  END IF;
  result:=jsonb_build_object(
    'jobId',job.id,'extractionBindingId',binding.id,'inputBundleId',p_input_bundle,
    'inputBundleVersionId',p_input_bundle_version,'sourceSetId',p_source_set,
    'sourceSetVersionId',p_source_set_version,'sourceId',p_source,'sourceVersionId',p_source_version,'bound',true
  );
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_review_assess_candidate_v2(
  p_candidate uuid,p_expected_candidate_version bigint,
  p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,
  p_source_set uuid,p_source_set_version uuid,p_expected_source_set_version bigint,p_source_version uuid,
  p_status text,p_value text,p_reason text,p_relationship text,p_application_intent text,p_apply_target text,
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate public.enterprise_evidence_candidates;binding public.enterprise_transcript_extraction_bindings;
  bundle public.enterprise_module_input_bundle_versions;set_version public.enterprise_source_set_versions;result jsonb;
BEGIN
  PERFORM public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,
    'transcript.assess.candidate.review','evidence.review',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
  SELECT * INTO candidate FROM public.enterprise_evidence_candidates
  WHERE id=p_candidate AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO binding FROM public.enterprise_transcript_extraction_bindings
  WHERE job_id=candidate.ai_job_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO bundle FROM public.enterprise_module_input_bundle_versions
  WHERE id=p_input_bundle_version AND input_bundle_id=p_input_bundle AND version=p_expected_input_bundle_version
    AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO set_version FROM public.enterprise_source_set_versions
  WHERE id=p_source_set_version AND source_set_id=p_source_set AND version=p_expected_source_set_version
    AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF candidate.id IS NULL OR candidate.source_version_id IS DISTINCT FROM p_source_version
    OR binding.id IS NULL OR bundle.id IS NULL OR set_version.id IS NULL
    OR binding.input_bundle_id IS DISTINCT FROM p_input_bundle OR binding.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version
    OR binding.source_set_id IS DISTINCT FROM p_source_set OR binding.source_set_version_id IS DISTINCT FROM p_source_set_version
    OR EXISTS(SELECT 1 FROM public.enterprise_transcript_staleness_events
      WHERE resource_kind IN('input_bundle_version','extraction_binding')
        AND resource_id IN(bundle.id,binding.id)) THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CANDIDATE_REVIEW_STALE';
  END IF;
  result:=public.enterprise_transcript_review_assess_candidate(
    p_candidate,p_expected_candidate_version,p_status,p_value,p_reason,p_relationship,p_application_intent,p_apply_target,
    p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence
  );
  RETURN result||jsonb_build_object(
    'inputBundleId',p_input_bundle,'inputBundleVersionId',p_input_bundle_version,
    'sourceSetId',p_source_set,'sourceSetVersionId',p_source_set_version,'sourceVersionId',p_source_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_assess_apply_preview_batch_v2(
  p_batch uuid,p_case uuid,p_expected_case_version bigint,
  p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,
  p_source_sets jsonb,p_selections jsonb,
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,
    'transcript.assess.apply.preview','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
  PERFORM public.enterprise_transcript_assert_exact_bundle_lineage(
    p_org,p_workspace,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,p_source_sets
  );
  IF EXISTS(
    SELECT 1 FROM jsonb_array_elements(p_selections) selection
    LEFT JOIN public.enterprise_evidence_candidates candidate
      ON candidate.id=(selection.value->>'candidateId')::uuid
     AND candidate.org_id=p_org AND candidate.workspace_id=p_workspace
    LEFT JOIN public.enterprise_transcript_extraction_bindings binding
      ON binding.job_id=candidate.ai_job_id AND binding.org_id=p_org AND binding.workspace_id=p_workspace
    WHERE candidate.id IS NULL OR binding.id IS NULL
      OR binding.input_bundle_id IS DISTINCT FROM p_input_bundle
      OR binding.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version
      OR NOT EXISTS(
        SELECT 1 FROM jsonb_array_elements(p_source_sets) source_set
        WHERE (source_set.value->>'sourceSetId')::uuid=binding.source_set_id
          AND (source_set.value->>'sourceSetVersionSelector')::uuid=binding.source_set_version_id
      )
  ) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_CANDIDATE_STALE'; END IF;
  result:=public.enterprise_transcript_create_assess_apply_preview_batch(
    p_batch,p_case,p_expected_case_version,p_selections,
    p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence
  );
  RETURN (result-'previewId')||jsonb_build_object(
    'previewId',p_batch,'previewBatchId',p_batch,'inputBundleId',p_input_bundle,
    'inputBundleVersionId',p_input_bundle_version,'inputBundleVersion',p_expected_input_bundle_version,
    'sourceSetVersionIds',(SELECT jsonb_agg(entry.value->'sourceSetVersionSelector' ORDER BY (entry.value->>'ordinal')::int)
      FROM jsonb_array_elements(p_source_sets) entry)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_commit_assess_apply_preview_batch_v2(
  p_batch uuid,p_case uuid,p_expected_case_version bigint,
  p_input_bundle uuid,p_input_bundle_version uuid,p_expected_input_bundle_version bigint,p_source_sets jsonb,
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE batch public.enterprise_assess_apply_preview_batches;result jsonb;submitted_source_sets uuid[];
BEGIN
  PERFORM public.enterprise_transcript_assert_receipt(p_receipt,p_actor,p_org,p_workspace,
    'transcript.assess.apply.commit','transcript.assess.apply',p_authorization_version,p_execution_token,p_execution_fence,'assess_apply');
  PERFORM public.enterprise_transcript_assert_exact_bundle_lineage(
    p_org,p_workspace,p_input_bundle,p_input_bundle_version,p_expected_input_bundle_version,p_source_sets
  );
  SELECT array_agg((entry.value->>'sourceSetVersionSelector')::uuid ORDER BY (entry.value->>'ordinal')::int)
  INTO submitted_source_sets FROM jsonb_array_elements(p_source_sets) entry;
  SELECT * INTO batch FROM public.enterprise_assess_apply_preview_batches
  WHERE id=p_batch AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF batch.id IS NULL OR batch.assess_case_id IS DISTINCT FROM p_case
    OR batch.expected_case_version IS DISTINCT FROM p_expected_case_version
    OR batch.input_bundle_id IS DISTINCT FROM p_input_bundle
    OR batch.input_bundle_version_id IS DISTINCT FROM p_input_bundle_version
    OR batch.input_bundle_version IS DISTINCT FROM p_expected_input_bundle_version
    OR batch.source_set_version_ids IS DISTINCT FROM submitted_source_sets
    OR EXISTS(SELECT 1 FROM public.enterprise_transcript_staleness_events
      WHERE resource_kind='apply_preview_batch' AND resource_id=batch.id) THEN
    RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_APPLY_BATCH_STALE';
  END IF;
  result:=public.enterprise_transcript_commit_assess_apply_preview_batch(
    p_batch,p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence
  );
  RETURN result||jsonb_build_object('previewBatchId',p_batch,'inputBundleId',p_input_bundle,
    'inputBundleVersion',p_expected_input_bundle_version,'sourceSetVersionIds',to_jsonb(submitted_source_sets));
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_assert_budget_transition_identity(
  p_row public.enterprise_ai_budget_reservations,
  p_actor uuid,p_org uuid,p_workspace uuid,p_receipt uuid,p_job uuid,
  p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text
) RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;job public.enterprise_ai_job_ledger;
BEGIN
  PERFORM public.enterprise_ai_assert_budget_identity(
    p_row,p_actor,p_org,p_workspace,p_receipt,p_job,p_route,p_provider_config,p_provider,p_capability,p_model
  );
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_receipt AND actor_id=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  SELECT * INTO job FROM public.enterprise_ai_job_ledger
  WHERE id=p_job AND actor_id=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF receipt.id IS NULL OR receipt.status<>'claimed'
    OR receipt.execution_token IS DISTINCT FROM p_execution_token OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
    OR job.id IS NULL OR job.receipt_id IS DISTINCT FROM p_receipt OR job.status<>'running'
    OR job.execution_token IS DISTINCT FROM p_execution_token OR job.execution_fence IS DISTINCT FROM p_execution_fence
    OR p_row.execution_token IS DISTINCT FROM p_execution_token OR p_row.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_settle_provider_budget_v2(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_input_tokens integer,p_output_tokens integer,p_total_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations;
BEGIN
  IF p_authorization_version<1 THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  PERFORM public.enterprise_ai_assert_budget_transition_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,
    p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.state='settled' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
  IF reservation.state NOT IN('reserved','uncertain') OR p_input_tokens<0 OR p_output_tokens<0
    OR p_total_tokens<1 OR p_total_tokens<>p_input_tokens+p_output_tokens THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='settled',actual_input_tokens=p_input_tokens,
    actual_output_tokens=p_output_tokens,actual_total_tokens=p_total_tokens,updated_at=statement_timestamp(),settled_at=statement_timestamp()
  WHERE id=reservation.id RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_mark_provider_budget_uncertain_v2(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_failure_class text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations;
BEGIN
  IF p_authorization_version<1 THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  PERFORM public.enterprise_ai_assert_budget_transition_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,
    p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.state IN('settled','uncertain') THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
  IF reservation.state<>'reserved' OR p_failure_class!~'^[a-z0-9_]{1,80}$' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='uncertain',failure_class=p_failure_class,
    updated_at=statement_timestamp() WHERE id=reservation.id RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END;
$$;

CREATE OR REPLACE FUNCTION public.enterprise_ai_release_provider_budget_v2(
  p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
  p_receipt uuid,p_job uuid,p_execution_token uuid,p_execution_fence bigint,
  p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
  p_reservation uuid,p_release_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations;
BEGIN
  IF p_authorization_version<1 THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE'; END IF;
  SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
  PERFORM public.enterprise_ai_assert_budget_transition_identity(reservation,p_actor,p_org,p_workspace,p_receipt,p_job,
    p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model);
  IF reservation.state='released' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true); END IF;
  IF p_release_reason NOT IN('before_provider_effect','reconciled_no_effect') OR reservation.state='settled'
    OR (reservation.state='uncertain' AND p_release_reason<>'reconciled_no_effect') THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
  END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='released',release_reason=p_release_reason,
    updated_at=statement_timestamp(),settled_at=statement_timestamp()
  WHERE id=reservation.id RETURNING * INTO reservation;
  RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END;
$$;

REVOKE ALL ON FUNCTION
  public.enterprise_transcript_fill_preview_batch_lineage(),
  public.enterprise_transcript_fill_application_batch(),
  public.enterprise_transcript_record_selective_staleness(),
  public.enterprise_transcript_assert_exact_bundle_lineage(uuid,uuid,uuid,uuid,bigint,jsonb),
  public.enterprise_ai_assert_budget_transition_identity(public.enterprise_ai_budget_reservations,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text)
FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION
  public.enterprise_transcript_bind_assess_extraction(uuid,uuid,text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_review_assess_candidate(uuid,bigint,text,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_create_assess_apply_preview_batch(uuid,uuid,bigint,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_commit_assess_apply_preview_batch(uuid,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_ai_settle_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_ai_mark_provider_budget_uncertain(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_ai_release_provider_budget(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
FROM PUBLIC,anon,authenticated,service_role;

REVOKE ALL ON FUNCTION
  public.enterprise_transcript_bind_assess_extraction_v2(uuid,uuid,uuid,bigint,uuid,uuid,bigint,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_review_assess_candidate_v2(uuid,bigint,uuid,uuid,bigint,uuid,uuid,bigint,uuid,text,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_create_assess_apply_preview_batch_v2(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_commit_assess_apply_preview_batch_v2(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_ai_settle_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_ai_mark_provider_budget_uncertain_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_ai_release_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION
  public.enterprise_transcript_bind_assess_extraction_v2(uuid,uuid,uuid,bigint,uuid,uuid,bigint,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_review_assess_candidate_v2(uuid,bigint,uuid,uuid,bigint,uuid,uuid,bigint,uuid,text,text,text,text,text,text,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_create_assess_apply_preview_batch_v2(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_transcript_commit_assess_apply_preview_batch_v2(uuid,uuid,bigint,uuid,uuid,bigint,jsonb,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
  public.enterprise_ai_settle_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
  public.enterprise_ai_mark_provider_budget_uncertain_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
  public.enterprise_ai_release_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
TO service_role;

COMMENT ON TABLE public.enterprise_transcript_staleness_events IS
  'Append-only selective invalidation of unconsumed bundle, extraction, and preview selectors. Consumed applications, Assess versions, candidates, and evidence remain immutable and readable.';
COMMENT ON FUNCTION public.enterprise_ai_settle_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer) IS
  'Fenced service-only post-effect settlement. Current authority is intentionally not rechecked after the provider cut point; command finalization and disclosure still require fresh authority.';
