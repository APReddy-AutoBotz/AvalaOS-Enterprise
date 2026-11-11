-- PR 1G post-merge authority and concurrency correction.
-- Forward-only rollback is feature disablement/read-only maintenance plus an additive forward fix.

ALTER TABLE public.assess_process_application_links
  ADD COLUMN case_id uuid,
  ADD COLUMN source_version_id uuid,
  ADD COLUMN decision_id uuid,
  ADD COLUMN govern_resolution_id uuid,
  ADD COLUMN economic_review_resolution_id uuid;

ALTER TABLE public.assess_process_application_links
  ADD CONSTRAINT pr1g_process_link_case_ancestry_fk
    FOREIGN KEY(case_id,workspace_id,org_id)
    REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
  ADD CONSTRAINT pr1g_process_link_source_ancestry_fk
    FOREIGN KEY(source_version_id,case_id,workspace_id,org_id)
    REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
  ADD CONSTRAINT pr1g_process_link_decision_ancestry_fk
    FOREIGN KEY(decision_id,case_id,workspace_id,org_id)
    REFERENCES public.assess_v2_decision_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
  ADD CONSTRAINT pr1g_process_link_govern_ancestry_fk
    FOREIGN KEY(govern_resolution_id,case_id,decision_id,workspace_id,org_id)
    REFERENCES public.assess_v2_govern_resolutions(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT,
  ADD CONSTRAINT pr1g_process_link_economics_ancestry_fk
    FOREIGN KEY(economics_ref,case_id,workspace_id,org_id)
    REFERENCES public.assess_v2_economic_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT;

ALTER TABLE public.assess_application_portfolio_snapshots
  ADD COLUMN version bigint GENERATED ALWAYS AS ((snapshot->>'version')::bigint) STORED;
ALTER TABLE public.assess_application_portfolio_snapshots
  ADD CONSTRAINT pr1g_portfolio_snapshot_version_positive CHECK(version>0),
  ADD CONSTRAINT pr1g_portfolio_snapshot_workspace_version_key UNIQUE(org_id,workspace_id,version);

DROP POLICY IF EXISTS pr1g_assess_application_assets_select ON public.assess_application_assets;
DROP POLICY IF EXISTS pr1g_assess_application_metadata_versions_select ON public.assess_application_metadata_versions;
DROP POLICY IF EXISTS pr1g_assess_application_source_evidence_select ON public.assess_application_source_evidence;
DROP POLICY IF EXISTS pr1g_assess_process_application_links_select ON public.assess_process_application_links;
DROP POLICY IF EXISTS pr1g_assess_application_dependencies_select ON public.assess_application_dependencies;
DROP POLICY IF EXISTS pr1g_assess_application_assessment_versions_select ON public.assess_application_assessment_versions;
DROP POLICY IF EXISTS pr1g_assess_application_dimension_results_select ON public.assess_application_dimension_results;
DROP POLICY IF EXISTS pr1g_assess_application_modernization_recommendations_select ON public.assess_application_modernization_recommendations;
DROP POLICY IF EXISTS pr1g_assess_application_review_resolutions_select ON public.assess_application_review_resolutions;
DROP POLICY IF EXISTS pr1g_assess_application_portfolio_snapshots_select ON public.assess_application_portfolio_snapshots;
DROP POLICY IF EXISTS pr1g_assess_application_import_receipts_select ON public.assess_application_import_receipts;
DROP POLICY IF EXISTS pr1g_assess_application_import_row_outcomes_select ON public.assess_application_import_row_outcomes;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'assess_application_assets','assess_application_metadata_versions',
    'assess_application_source_evidence','assess_process_application_links',
    'assess_application_dependencies','assess_application_assessment_versions',
    'assess_application_dimension_results','assess_application_modernization_recommendations',
    'assess_application_review_resolutions','assess_application_import_receipts',
    'assess_application_import_row_outcomes'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY pr1g_%I_select ON public.%I FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,''assess.applications.read''))',
      t,t
    );
  END LOOP;
END $$;
CREATE POLICY pr1g_assess_application_portfolio_snapshots_select
  ON public.assess_application_portfolio_snapshots
  FOR SELECT TO authenticated
  USING (public.has_workspace_capability(workspace_id,org_id,'assess.applications.portfolio.read'));

CREATE OR REPLACE FUNCTION public.pr1g_derive_process_link_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  derived_case_id uuid;
  derived_source_version_id uuid;
  derived_decision_id uuid;
  derived_govern_resolution_id uuid;
  derived_review_resolution_id uuid;
  derived_economic_review_resolution_id uuid;
  derived_economics_currency text;
  authority_count int;
BEGIN
  IF NEW.primitive_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN RAISE EXCEPTION 'PR1G_NOT_FOUND';
  END IF;
  SELECT count(*) INTO authority_count
  FROM public.assess_v2_cases candidate
  JOIN public.assess_v2_primitives primitive
    ON primitive.id=NEW.primitive_id::uuid AND primitive.version_id=candidate.head_version_id
    AND primitive.case_id=candidate.id AND primitive.org_id=candidate.org_id
    AND primitive.workspace_id=candidate.workspace_id
  JOIN public.assess_v2_decision_versions decision
    ON decision.case_id=candidate.id AND decision.source_version_id=candidate.head_version_id
    AND decision.org_id=candidate.org_id AND decision.workspace_id=candidate.workspace_id
  JOIN public.assess_v2_govern_resolutions govern
    ON govern.case_id=candidate.id AND govern.decision_id=decision.id
    AND govern.source_version_id=decision.source_version_id
    AND govern.org_id=candidate.org_id AND govern.workspace_id=candidate.workspace_id
  JOIN public.assess_v2_review_resolutions review
    ON review.id=govern.review_resolution_id AND review.case_id=candidate.id
    AND review.decision_id=decision.id AND review.source_version_id=decision.source_version_id
    AND review.resolution='approved' AND review.org_id=candidate.org_id
    AND review.workspace_id=candidate.workspace_id
  JOIN public.assess_processes process
    ON process.id=candidate.process_id AND process.org_id=candidate.org_id
    AND process.workspace_id=candidate.workspace_id AND process.deleted_at IS NULL
  WHERE candidate.org_id=NEW.org_id AND candidate.workspace_id=NEW.workspace_id
    AND candidate.process_id=NEW.process_id
    AND candidate.status IN('govern_resolved','handed_off') AND candidate.deleted_at IS NULL;
  IF authority_count<>1 THEN RAISE EXCEPTION 'PR1G_NOT_FOUND'; END IF;

  SELECT candidate.id,candidate.head_version_id,decision.id,govern.id,review.id
  INTO derived_case_id,derived_source_version_id,derived_decision_id,
    derived_govern_resolution_id,derived_review_resolution_id
  FROM public.assess_v2_cases candidate
  JOIN public.assess_v2_primitives primitive
    ON primitive.id=NEW.primitive_id::uuid AND primitive.version_id=candidate.head_version_id
    AND primitive.case_id=candidate.id AND primitive.org_id=candidate.org_id
    AND primitive.workspace_id=candidate.workspace_id
  JOIN public.assess_v2_decision_versions decision
    ON decision.case_id=candidate.id AND decision.source_version_id=candidate.head_version_id
    AND decision.org_id=candidate.org_id AND decision.workspace_id=candidate.workspace_id
  JOIN public.assess_v2_govern_resolutions govern
    ON govern.case_id=candidate.id AND govern.decision_id=decision.id
    AND govern.source_version_id=decision.source_version_id
    AND govern.org_id=candidate.org_id AND govern.workspace_id=candidate.workspace_id
  JOIN public.assess_v2_review_resolutions review
    ON review.id=govern.review_resolution_id AND review.case_id=candidate.id
    AND review.decision_id=decision.id AND review.source_version_id=decision.source_version_id
    AND review.resolution='approved' AND review.org_id=candidate.org_id
    AND review.workspace_id=candidate.workspace_id
  WHERE candidate.org_id=NEW.org_id AND candidate.workspace_id=NEW.workspace_id
    AND candidate.process_id=NEW.process_id
    AND candidate.status IN('govern_resolved','handed_off') AND candidate.deleted_at IS NULL;

  NEW.case_id:=derived_case_id;
  NEW.source_version_id:=derived_source_version_id;
  NEW.decision_id:=derived_decision_id;
  NEW.govern_resolution_id:=derived_govern_resolution_id;
  NEW.govern_state:='approved';
  NEW.economic_review_resolution_id:=NULL;
  IF NEW.economics_ref IS NOT NULL THEN
    SELECT economic_review.id,approved_economics.currency
    INTO derived_economic_review_resolution_id,derived_economics_currency
    FROM public.assess_v2_economic_versions approved_economics
    JOIN public.assess_v2_economic_review_resolutions economic_review
      ON economic_review.economic_version_id=approved_economics.prior_economic_version_id
      AND economic_review.case_id=approved_economics.case_id
      AND economic_review.decision_id=approved_economics.decision_id
      AND economic_review.org_id=approved_economics.org_id
      AND economic_review.workspace_id=approved_economics.workspace_id
      AND economic_review.resolution='approved'
    WHERE approved_economics.id=NEW.economics_ref AND approved_economics.lifecycle='approved'
      AND approved_economics.org_id=NEW.org_id AND approved_economics.workspace_id=NEW.workspace_id
      AND approved_economics.case_id=derived_case_id
      AND approved_economics.decision_id=derived_decision_id
      AND approved_economics.source_version_id=derived_source_version_id
      AND approved_economics.approved_review_id=derived_review_resolution_id;
    IF derived_economic_review_resolution_id IS NULL THEN RAISE EXCEPTION 'PR1G_NOT_FOUND'; END IF;
    NEW.economics_currency:=derived_economics_currency;
    NEW.economic_review_resolution_id:=derived_economic_review_resolution_id;
  ELSE
    NEW.economics_currency:=NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pr1g_process_link_authority ON public.assess_process_application_links;
CREATE TRIGGER trg_pr1g_process_link_authority
  BEFORE INSERT ON public.assess_process_application_links
  FOR EACH ROW EXECUTE FUNCTION public.pr1g_derive_process_link_authority();

ALTER FUNCTION public.pr1g_execute_application_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb)
  RENAME TO pr1g_execute_application_command_merged;
ALTER FUNCTION public.pr1g_read_application_portfolio_projection(uuid,uuid)
  RENAME TO pr1g_read_application_portfolio_projection_merged;

CREATE OR REPLACE FUNCTION public.pr1g_verified_process_links(p_org uuid,p_workspace uuid)
RETURNS SETOF public.assess_process_application_links
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT l.*
  FROM public.assess_process_application_links l
  JOIN public.assess_processes p
    ON p.id=l.process_id AND p.org_id=l.org_id AND p.workspace_id=l.workspace_id AND p.deleted_at IS NULL
  JOIN public.assess_v2_cases c
    ON c.id=l.case_id AND c.process_id=p.id AND c.org_id=l.org_id AND c.workspace_id=l.workspace_id
    AND c.head_version_id=l.source_version_id AND c.deleted_at IS NULL
  JOIN public.assess_v2_primitives primitive
    ON primitive.id=CASE
      WHEN l.primitive_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN l.primitive_id::uuid ELSE NULL END
    AND primitive.version_id=l.source_version_id
    AND primitive.case_id=c.id AND primitive.org_id=l.org_id AND primitive.workspace_id=l.workspace_id
  JOIN public.assess_v2_decision_versions d
    ON d.id=l.decision_id AND d.case_id=c.id AND d.source_version_id=l.source_version_id
    AND d.org_id=l.org_id AND d.workspace_id=l.workspace_id
  JOIN public.assess_v2_govern_resolutions g
    ON g.id=l.govern_resolution_id AND g.case_id=c.id AND g.decision_id=d.id
    AND g.source_version_id=d.source_version_id AND g.org_id=l.org_id AND g.workspace_id=l.workspace_id
  JOIN public.assess_v2_review_resolutions rr
    ON rr.id=g.review_resolution_id AND rr.case_id=c.id AND rr.decision_id=d.id
    AND rr.source_version_id=d.source_version_id AND rr.resolution='approved'
    AND rr.org_id=l.org_id AND rr.workspace_id=l.workspace_id
  WHERE l.org_id=p_org AND l.workspace_id=p_workspace
    AND l.govern_state='approved'
    AND (
      l.economics_ref IS NULL
      OR EXISTS(
        SELECT 1
        FROM public.assess_v2_economic_versions e
        JOIN public.assess_v2_economic_review_resolutions er
          ON er.economic_version_id=e.prior_economic_version_id
          AND er.case_id=e.case_id AND er.decision_id=e.decision_id
          AND er.org_id=e.org_id AND er.workspace_id=e.workspace_id
          AND er.resolution='approved'
        WHERE e.id=l.economics_ref AND e.lifecycle='approved'
          AND e.case_id=c.id AND e.decision_id=d.id AND e.source_version_id=d.source_version_id
          AND e.approved_review_id=rr.id AND e.currency=l.economics_currency
          AND e.org_id=l.org_id AND e.workspace_id=l.workspace_id
          AND er.id=l.economic_review_resolution_id
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.pr1g_execute_application_command(
  p_org_id uuid,p_workspace_id uuid,p_actor_id uuid,p_request_id uuid,p_command_type text,
  p_expected_version bigint,p_authorization_version bigint,p_idempotency_key text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  cap text:=public.pr1g_command_capability(p_command_type);
  sanitized jsonb:=p_payload;
  link jsonb;
  derived_links jsonb:='[]'::jsonb;
  selected_application_id uuid;
  latest_assessment_version bigint;
  target_version bigint;
  receipt public.assess_command_receipts;
  request_hash text;
  audit_id uuid:=gen_random_uuid();
  result jsonb;
BEGIN
  IF cap IS NULL THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
  PERFORM public.pr1g_assert_application_authority(
    p_actor_id,p_org_id,p_workspace_id,cap,p_authorization_version
  );
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'pr1g-receipt:'||p_org_id::text||':'||p_actor_id::text||':'||
    p_command_type||':'||p_idempotency_key,0));
  SELECT * INTO receipt FROM public.assess_command_receipts
    WHERE org_id=p_org_id AND actor_id=p_actor_id AND command_type=p_command_type
      AND idempotency_key=p_idempotency_key FOR UPDATE;
  IF receipt.id IS NOT NULL AND receipt.workspace_id<>p_workspace_id THEN
    RAISE EXCEPTION 'PR1B_IDEMPOTENCY_CONFLICT';
  END IF;

  IF p_command_type='application.assessment.save' THEN
    selected_application_id:=(p_payload->>'applicationId')::uuid;
    FOR link IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload->'processLinks','[]'::jsonb)) LOOP
      derived_links:=derived_links||jsonb_build_array(
        jsonb_build_object(
          'processId',link->>'processId','primitiveId',link->>'primitiveId',
          'applicationId',link->>'applicationId','metadataVersion',link->'metadataVersion',
          'assessmentVersionId',link->>'assessmentVersionId','interactionType',link->>'interactionType',
          'governState','Unknown','allowedAction','prohibited',
          'economicsRef',link->'economicsRef','economicsCurrency',NULL,
          'approvedEconomics',jsonb_typeof(link->'economicsRef')='string'
        )
      );
    END LOOP;
    sanitized:=jsonb_set(p_payload,'{processLinks}',derived_links,true);
    request_hash:=md5(sanitized::text);
    IF receipt.id IS NOT NULL THEN
      IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'PR1B_IDEMPOTENCY_CONFLICT'; END IF;
      IF receipt.status='succeeded' THEN RETURN receipt.response; END IF;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'pr1g-assessment:'||p_org_id::text||':'||p_workspace_id::text||':'||selected_application_id::text,0));
    SELECT COALESCE(max(version),0) INTO latest_assessment_version
    FROM public.assess_application_assessment_versions
    WHERE application_id=selected_application_id AND org_id=p_org_id AND workspace_id=p_workspace_id;
    IF p_expected_version<>latest_assessment_version
      OR (p_payload->>'assessmentVersion')::bigint<>latest_assessment_version+1
      THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT';
    END IF;
    RETURN public.pr1g_execute_application_command_merged(
      p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command_type,p_expected_version,
      p_authorization_version,p_idempotency_key,sanitized
    );
  END IF;

  IF p_command_type<>'application.portfolio.snapshot.create' THEN
    RETURN public.pr1g_execute_application_command_merged(
      p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command_type,p_expected_version,
      p_authorization_version,p_idempotency_key,p_payload
    );
  END IF;

  IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>1 OR NOT p_payload ? 'portfolioSnapshotId'
    THEN RAISE EXCEPTION 'PR1G_INVALID_COMMAND'; END IF;
  request_hash:=encode(public.digest(
    p_command_type||'|'||p_org_id||'|'||p_workspace_id||'|'||p_actor_id||'|'||
    p_expected_version||'|'||p_payload::text,'sha256'),'hex');
  IF receipt.id IS NOT NULL THEN
    IF receipt.request_hash<>request_hash OR receipt.status<>'succeeded'
      THEN RAISE EXCEPTION 'PR1G_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN jsonb_build_object('outcome','replayed','resource',receipt.response->'resource');
  END IF;
  INSERT INTO public.assess_command_receipts(
    actor_id,org_id,workspace_id,command_type,idempotency_key,request_id,request_hash,status)
  VALUES(p_actor_id,p_org_id,p_workspace_id,p_command_type,p_idempotency_key,p_request_id,request_hash,'in_progress')
  RETURNING * INTO receipt;

  PERFORM pg_advisory_xact_lock(hashtextextended('pr1g-snapshot:'||p_org_id::text||':'||p_workspace_id::text,0));
  SELECT COALESCE(max(version),0)+1 INTO target_version
    FROM public.assess_application_portfolio_snapshots
    WHERE org_id=p_org_id AND workspace_id=p_workspace_id;
  IF p_expected_version<>target_version-1 THEN RAISE EXCEPTION 'PR1G_VERSION_CONFLICT'; END IF;
  IF (SELECT count(DISTINCT economics_currency) FROM public.pr1g_verified_process_links(p_org_id,p_workspace_id)
      WHERE economics_ref IS NOT NULL)>1 THEN RAISE EXCEPTION 'PR1G_INCOMPATIBLE_CURRENCIES'; END IF;
  IF EXISTS(WITH RECURSIVE walk(start_id,node_id,path,cycle) AS (
    SELECT upstream_application_id,downstream_application_id,ARRAY[upstream_application_id,downstream_application_id],false
    FROM public.assess_application_dependencies WHERE org_id=p_org_id AND workspace_id=p_workspace_id
    UNION ALL
    SELECT w.start_id,dep.downstream_application_id,w.path||dep.downstream_application_id,
      dep.downstream_application_id=ANY(w.path)
    FROM walk w JOIN public.assess_application_dependencies dep
      ON dep.upstream_application_id=w.node_id AND dep.org_id=p_org_id AND dep.workspace_id=p_workspace_id
    WHERE NOT w.cycle)
    SELECT 1 FROM walk WHERE cycle LIMIT 1
  ) THEN RAISE EXCEPTION 'PR1G_DEPENDENCY_CYCLE'; END IF;

  INSERT INTO public.assess_application_portfolio_snapshots(
    id,org_id,workspace_id,snapshot,created_by,receipt_id,audit_event_id)
  VALUES((p_payload->>'portfolioSnapshotId')::uuid,p_org_id,p_workspace_id,
    jsonb_build_object(
      'version',target_version,'modelVersion','assess-v2-application-portfolio-2026-07',
      'approvedAutomatically',false,
      'inventoryCount',(SELECT count(*) FROM public.assess_application_assets
        WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL),
      'waves',COALESCE((
        WITH RECURSIVE ranks(application_id,wave) AS (
          SELECT asset.id,1
          FROM public.assess_application_assets asset
          WHERE asset.org_id=p_org_id AND asset.workspace_id=p_workspace_id AND asset.deleted_at IS NULL
            AND NOT EXISTS(
              SELECT 1 FROM public.assess_application_dependencies dependency
              WHERE dependency.org_id=p_org_id AND dependency.workspace_id=p_workspace_id
                AND dependency.downstream_application_id=asset.id)
          UNION
          SELECT dependency.downstream_application_id,rank_row.wave+1
          FROM ranks rank_row
          JOIN public.assess_application_dependencies dependency
            ON dependency.upstream_application_id=rank_row.application_id
            AND dependency.org_id=p_org_id AND dependency.workspace_id=p_workspace_id
        )
        SELECT jsonb_agg(jsonb_build_object(
          'applicationId',asset.id,
          'wave',COALESCE((SELECT max(wave) FROM ranks WHERE application_id=asset.id),1),
          'approvedAutomatically',false,
          'qualified',CASE WHEN latest.id IS NULL
            OR (SELECT count(*) FROM public.assess_application_dimension_results x WHERE x.assessment_version_id=latest.id)<>7
            OR (SELECT count(DISTINCT dimension) FROM public.assess_application_dimension_results x WHERE x.assessment_version_id=latest.id)<>7
            OR NOT EXISTS(SELECT 1 FROM public.assess_application_modernization_recommendations q WHERE q.assessment_version_id=latest.id)
            OR EXISTS(SELECT 1 FROM public.assess_application_dimension_results x WHERE x.assessment_version_id=latest.id AND (cardinality(x.hard_gates)>0 OR x.evidence_confidence='Insufficient Evidence'))
            THEN false ELSE true END
        ) ORDER BY COALESCE((SELECT max(wave) FROM ranks WHERE application_id=asset.id),1),asset.id)
        FROM public.assess_application_assets asset
        LEFT JOIN LATERAL(
          SELECT assessment.id FROM public.assess_application_assessment_versions assessment
          WHERE assessment.application_id=asset.id AND assessment.org_id=p_org_id
            AND assessment.workspace_id=p_workspace_id ORDER BY assessment.version DESC LIMIT 1
        ) latest ON true
        WHERE asset.org_id=p_org_id AND asset.workspace_id=p_workspace_id AND asset.deleted_at IS NULL
      ),'[]'::jsonb)
    ),p_actor_id,receipt.id,audit_id);
  result:=jsonb_build_object('outcome','committed','resource',jsonb_build_object(
    'id',(p_payload->>'portfolioSnapshotId')::uuid,'version',target_version,'status','committed'));
  INSERT INTO public.privileged_audit_events(
    id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command_type,'assess_application',
    (p_payload->>'portfolioSnapshotId')::uuid,'succeeded',target_version,jsonb_build_object('receiptId',receipt.id));
  UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=receipt.id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.pr1g_read_application_portfolio_projection(p_org_id uuid,p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  can_applications boolean:=public.has_workspace_capability(p_workspace_id,p_org_id,'assess.applications.read');
  can_portfolio boolean:=public.has_workspace_capability(p_workspace_id,p_org_id,'assess.applications.portfolio.read');
  result jsonb;
  snapshot jsonb;
BEGIN
  IF NOT can_applications AND NOT can_portfolio THEN RAISE EXCEPTION 'PR1G_NOT_FOUND'; END IF;
  IF can_portfolio THEN
    SELECT s.snapshot||jsonb_build_object('id',s.id,'orgId',s.org_id,'workspaceId',s.workspace_id)
      INTO snapshot FROM public.assess_application_portfolio_snapshots s
      WHERE s.org_id=p_org_id AND s.workspace_id=p_workspace_id ORDER BY s.version DESC LIMIT 1;
  END IF;
  IF NOT can_applications THEN
    RETURN jsonb_build_object(
      'inventory','[]'::jsonb,'metadataVersions','[]'::jsonb,'importReceipts','[]'::jsonb,
      'rowOutcomes','[]'::jsonb,'processLinks','[]'::jsonb,'dependencies','[]'::jsonb,
      'assessments','[]'::jsonb,'dimensions','[]'::jsonb,'recommendations','[]'::jsonb,
      'reviews','[]'::jsonb,'economicsReferences','[]'::jsonb,
      'portfolioSnapshot',snapshot,'waves',COALESCE(snapshot->'waves','[]'::jsonb));
  END IF;
  result:=public.pr1g_read_application_portfolio_projection_merged(p_org_id,p_workspace_id);
  result:=jsonb_set(result,'{processLinks}',COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id',l.id,'orgId',l.org_id,'workspaceId',l.workspace_id,'processId',l.process_id,
      'primitiveId',l.primitive_id,'applicationId',l.application_id,
      'metadataVersionId',l.application_metadata_version_id,'assessmentVersionId',l.assessment_version_id,
      'interactionType',l.interaction_type,'governState','approved',
      'economicsRef',l.economics_ref,'economicsCurrency',l.economics_currency
    ) ORDER BY l.created_at) FROM public.pr1g_verified_process_links(p_org_id,p_workspace_id) l
  ),'[]'::jsonb),true);
  result:=jsonb_set(result,'{economicsReferences}',COALESCE((
    SELECT jsonb_agg(DISTINCT jsonb_build_object(
      'referenceId',l.economics_ref,'orgId',l.org_id,'workspaceId',l.workspace_id,'currency',l.economics_currency))
    FROM public.pr1g_verified_process_links(p_org_id,p_workspace_id) l WHERE l.economics_ref IS NOT NULL
  ),'[]'::jsonb),true);
  result:=jsonb_set(result,'{portfolioSnapshot}',COALESCE(snapshot,'null'::jsonb),true);
  result:=jsonb_set(result,'{waves}',CASE WHEN can_portfolio THEN COALESCE(snapshot->'waves','[]'::jsonb) ELSE '[]'::jsonb END,true);
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.pr1g_execute_application_command_merged(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1g_execute_application_command_merged(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pr1g_execute_application_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1g_execute_application_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pr1g_read_application_portfolio_projection_merged(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1g_read_application_portfolio_projection_merged(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.pr1g_read_application_portfolio_projection(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pr1g_read_application_portfolio_projection(uuid,uuid) TO authenticated,service_role;

-- PR 1G RPC boundary: only the projection is client-executable. Commands and
-- renamed compatibility entry points are service-role only; helpers are owner
-- internal and receive no client or service-role direct-execution grant.
REVOKE ALL ON FUNCTION public.pr1g_reject_immutable() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_reject_finalized_metadata_update() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_error_envelope(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_assert_application_authority(uuid,uuid,uuid,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_command_capability(text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_evidence_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_metadata_valid(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_evidence_confidence(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_copy_application_decisions(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_dimension_missing_evidence(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_derive_process_link_authority() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.pr1g_verified_process_links(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
