-- PR 1E: additive Assess V2 independent review, approval, Govern and Studio-source authority.
-- V1 and immutable PR 1D decisions are intentionally untouched. Rollback is read-only/disable plus an additive forward fix.

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('assess.v2.review','assess','Assign and resolve an independent Assess V2 review'),
 ('assess.v2.evidence.attest','assess','Independently attest exact Assess V2 evidence claims'),
 ('assess.v2.approve','assess','Approve or reject a current independently reviewed V2 decision'),
 ('assess.v2.govern.resolve','govern','Resolve action-specific controls for an approved V2 decision'),
 ('assess.v2.studio.handoff','docs','Create a governed durable Studio source package from V2')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

ALTER TABLE public.assess_v2_cases DROP CONSTRAINT IF EXISTS assess_v2_cases_status_check;
ALTER TABLE public.assess_v2_cases ADD CONSTRAINT assess_v2_cases_status_check CHECK(status IN('draft','reviewer_ready','in_review','approved','changes_requested','rejected','govern_resolved','handed_off','superseded'));

CREATE TABLE public.assess_v2_review_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,source_version_id uuid NOT NULL,source_case_version bigint NOT NULL,
 decision_id uuid NOT NULL,decision_version text NOT NULL,review_schema_version text NOT NULL,review_sequence bigint NOT NULL,
 material_claims jsonb NOT NULL CHECK(jsonb_typeof(material_claims)='array'),reviewer_id uuid NOT NULL REFERENCES public.profiles(id),assigned_by uuid NOT NULL REFERENCES public.profiles(id),
 assigned_reviewer_authorization_version bigint NOT NULL,assigned_by_authorization_version bigint NOT NULL,assigned_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.assess_command_receipts(id),audit_event_id uuid NOT NULL,
 UNIQUE(id,case_id,decision_id,workspace_id,org_id),UNIQUE(decision_id,review_sequence),
 FOREIGN KEY(decision_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_decision_versions(id,case_id,workspace_id,org_id),
 FOREIGN KEY(source_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id)
);
CREATE TABLE public.assess_v2_evidence_attestations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,source_version_id uuid NOT NULL,source_case_version bigint NOT NULL,
 decision_id uuid NOT NULL,decision_version text NOT NULL,review_id uuid NOT NULL,review_schema_version text NOT NULL,review_sequence bigint NOT NULL,
 evidence_id uuid NOT NULL,claim_ids text[] NOT NULL CHECK(cardinality(claim_ids)>0),evidence_submitter_id uuid NOT NULL REFERENCES public.profiles(id),
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL,outcome text NOT NULL CHECK(outcome IN('accepted','rejected','needs-more-information')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),reviewed_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,receipt_id uuid NOT NULL UNIQUE REFERENCES public.assess_command_receipts(id),audit_event_id uuid NOT NULL,
 UNIQUE(id,case_id,decision_id,workspace_id,org_id),FOREIGN KEY(review_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_review_assignments(id,case_id,decision_id,workspace_id,org_id),
 FOREIGN KEY(source_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id),CHECK(reviewer_id<>evidence_submitter_id)
);
CREATE TABLE public.assess_v2_review_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,source_version_id uuid NOT NULL,source_case_version bigint NOT NULL,
 decision_id uuid NOT NULL,decision_version text NOT NULL,review_id uuid NOT NULL,review_schema_version text NOT NULL,review_sequence bigint NOT NULL,
 resolution text NOT NULL CHECK(resolution IN('approved','changes_requested','rejected')),reviewed_confidence text NOT NULL CHECK(reviewed_confidence IN('Verified','Partially Evidenced','Assumption-Led','Insufficient Evidence')),
 conditions jsonb NOT NULL DEFAULT '[]',rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL,
 resolved_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,receipt_id uuid NOT NULL UNIQUE REFERENCES public.assess_command_receipts(id),audit_event_id uuid NOT NULL,
 UNIQUE(id,case_id,decision_id,workspace_id,org_id),UNIQUE(review_id,review_sequence),FOREIGN KEY(review_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_review_assignments(id,case_id,decision_id,workspace_id,org_id),
 FOREIGN KEY(source_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id)
);
CREATE TABLE public.assess_v2_govern_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,source_version_id uuid NOT NULL,source_case_version bigint NOT NULL,
 decision_id uuid NOT NULL,decision_version text NOT NULL,review_resolution_id uuid NOT NULL,review_schema_version text NOT NULL,review_sequence bigint NOT NULL,
 actions jsonb NOT NULL,required_controls jsonb NOT NULL CHECK(jsonb_typeof(required_controls)='array'),rollback_requirements jsonb NOT NULL DEFAULT '[]',monitoring_requirements jsonb NOT NULL DEFAULT '[]',review_frequency text NOT NULL,accountable_owner text NOT NULL,
 rationale text NOT NULL,resolver_id uuid NOT NULL REFERENCES public.profiles(id),resolver_authorization_version bigint NOT NULL,resolved_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,receipt_id uuid NOT NULL UNIQUE REFERENCES public.assess_command_receipts(id),audit_event_id uuid NOT NULL,
 UNIQUE(id,case_id,decision_id,workspace_id,org_id),UNIQUE(decision_id,review_resolution_id),FOREIGN KEY(review_resolution_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_review_resolutions(id,case_id,decision_id,workspace_id,org_id),
 FOREIGN KEY(source_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id)
);
CREATE TABLE public.assess_v2_studio_handoffs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,source_version_id uuid NOT NULL,source_case_version bigint NOT NULL,
 decision_id uuid NOT NULL,review_resolution_id uuid NOT NULL,govern_resolution_id uuid NOT NULL,package jsonb NOT NULL,package_hash text NOT NULL CHECK(package_hash~'^[0-9a-f]{64}$'),
 schema_version text NOT NULL,rule_set_version text NOT NULL,decision_version text NOT NULL,review_schema_version text NOT NULL,review_sequence bigint NOT NULL,
 handed_off_by uuid NOT NULL REFERENCES public.profiles(id),handoff_authorization_version bigint NOT NULL,handed_off_at timestamptz NOT NULL DEFAULT now(),request_id uuid NOT NULL,receipt_id uuid NOT NULL UNIQUE REFERENCES public.assess_command_receipts(id),audit_event_id uuid NOT NULL,
 UNIQUE(id,case_id,decision_id,workspace_id,org_id),UNIQUE(decision_id,govern_resolution_id),FOREIGN KEY(govern_resolution_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_govern_resolutions(id,case_id,decision_id,workspace_id,org_id),
 FOREIGN KEY(source_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id)
);
CREATE TABLE public.assess_v2_studio_sources(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,decision_id uuid NOT NULL,handoff_id uuid NOT NULL,
 source_context jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(handoff_id),FOREIGN KEY(handoff_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_studio_handoffs(id,case_id,decision_id,workspace_id,org_id)
);

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['assess_v2_review_assignments','assess_v2_evidence_attestations','assess_v2_review_resolutions','assess_v2_govern_resolutions','assess_v2_studio_handoffs','assess_v2_studio_sources'] LOOP
 EXECUTE format('CREATE TRIGGER trg_pr1e_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.pr1d_reject_immutable()',t,t);
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
END LOOP;END$$;

CREATE OR REPLACE FUNCTION public.pr1e_can_read_lineage(p_org uuid,p_workspace uuid,p_case uuid,p_decision uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.has_workspace_capability(p_workspace,p_org,'assess.v2.read') AND EXISTS(
  SELECT 1 FROM public.assess_v2_cases c JOIN public.assess_v2_decision_versions d ON d.id=p_decision AND d.case_id=c.id AND d.org_id=c.org_id AND d.workspace_id=c.workspace_id
  JOIN public.assess_v2_case_versions v ON v.id=d.source_version_id AND v.case_id=c.id AND v.org_id=c.org_id AND v.workspace_id=c.workspace_id
  WHERE c.id=p_case AND c.org_id=p_org AND c.workspace_id=p_workspace AND c.deleted_at IS NULL
 )$$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['assess_v2_review_assignments','assess_v2_evidence_attestations','assess_v2_review_resolutions','assess_v2_govern_resolutions','assess_v2_studio_handoffs','assess_v2_studio_sources'] LOOP
 EXECUTE format('CREATE POLICY pr1e_%I_read ON public.%I FOR SELECT TO authenticated USING(public.pr1e_can_read_lineage(org_id,workspace_id,case_id,decision_id))',t,t);
END LOOP;END$$;

CREATE OR REPLACE FUNCTION public.pr1e_review_result(p_error text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$SELECT jsonb_build_object('errorCode',p_error)$$;
CREATE OR REPLACE FUNCTION public.pr1e_actor_has_workspace_capability(p_actor uuid,p_org uuid,p_workspace uuid,p_capability text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
SELECT EXISTS(
 SELECT 1 FROM public.profiles p
 JOIN public.organization_members om ON om.user_id=p.id AND om.org_id=p_org
 JOIN public.workspace_memberships wm ON wm.user_id=p.id AND wm.org_id=om.org_id AND wm.workspace_id=p_workspace
 JOIN public.organizations o ON o.id=om.org_id JOIN public.workspaces w ON w.id=wm.workspace_id AND w.org_id=om.org_id
 WHERE p.id=p_actor AND p.status='active' AND p.deleted_at IS NULL AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL AND w.status='active' AND w.deleted_at IS NULL
 AND (EXISTS(SELECT 1 FROM public.roles r JOIN public.role_capabilities rc ON rc.role_id=r.id AND rc.capability_key=p_capability WHERE r.id=om.role_id AND r.scope='organization' AND r.org_id=p_org AND r.workspace_id IS NULL AND r.status='active' AND r.deleted_at IS NULL)
   OR EXISTS(SELECT 1 FROM public.roles r JOIN public.role_capabilities rc ON rc.role_id=r.id AND rc.capability_key=p_capability WHERE r.id=wm.role_id AND r.scope='workspace' AND r.org_id=p_org AND r.workspace_id=p_workspace AND r.status='active' AND r.deleted_at IS NULL))
)$$;
CREATE OR REPLACE FUNCTION public.pr1e_review_projection(p_org uuid,p_workspace uuid,p_case uuid,p_decision uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
SELECT jsonb_build_object(
 'assignmentId',COALESCE(a.id::text,''),'caseId',c.id,'caseName',v.name,'caseVersion',c.version,'sourceCaseVersion',sv.version,'sourceVersionId',d.source_version_id,'decisionId',d.id,'decisionVersion',d.decision_version,
 'reviewSchemaVersion',COALESCE(a.review_schema_version,'assess-v2-review-2026-07'),'reviewSequence',COALESCE(a.review_sequence,1),'status',CASE WHEN c.status IN('govern_resolved','handed_off') THEN 'approved' ELSE c.status END,
 'authorLabel',c.owner_id::text,'reviewerLabel',COALESCE(a.reviewer_id::text,''),
 'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'claimIds',e.payload->'claimIds','sourceType',COALESCE(e.payload->>'sourceType','unknown'),'submitterLabel',COALESCE(e.payload->>'owner',e.payload->>'submittedBy','submitted'),'capturedAt',COALESCE(e.payload->>'capturedAt',sv.created_at::text),'expiresAt',e.payload->>'validUntil','status',COALESCE(t.outcome,'submitted'),'rationale',t.rationale) ORDER BY e.id) FROM public.assess_v2_evidence_links e LEFT JOIN LATERAL(SELECT x.outcome,x.rationale FROM public.assess_v2_evidence_attestations x WHERE x.review_id=a.id AND x.evidence_id=e.id ORDER BY x.reviewed_at DESC,x.id DESC LIMIT 1)t ON true WHERE e.version_id=d.source_version_id),'[]'),
 'requiredClaimIds',COALESCE((SELECT jsonb_agg(x->>'claimId' ORDER BY x->>'claimId') FROM jsonb_array_elements(COALESCE(a.material_claims,'[]')) x),'[]'),
 'confidence',COALESCE(rr.reviewed_confidence,d.output_snapshot->>'confidence','Partially Evidenced'),'conditions',COALESCE(rr.conditions,'[]'),
 'actions',COALESCE(g.actions,d.output_snapshot->'actionControls','[]'),'controls',COALESCE(g.required_controls,(SELECT COALESCE(jsonb_agg(control ORDER BY control->>'controlId'),'[]') FROM (SELECT jsonb_build_object('controlId',x->>'id','label',COALESCE(x->>'control',x->>'id'),'status','unresolved') control FROM jsonb_array_elements(COALESCE(d.output_snapshot->'controlRequirements','[]')) x WHERE COALESCE((x->>'required')::boolean,false) UNION SELECT jsonb_build_object('controlId',value,'label',value,'status','unresolved') FROM jsonb_array_elements_text(COALESCE(d.output_snapshot->'controls','[]')) value) required_controls)),
 'governStatus',CASE WHEN g.id IS NULL THEN 'pending' ELSE 'resolved' END,'handoffStatus',CASE WHEN h.id IS NOT NULL THEN 'committed' WHEN g.id IS NOT NULL THEN 'ready' ELSE 'not_ready' END,'handedOffAt',h.handed_off_at)
FROM public.assess_v2_cases c JOIN public.assess_v2_decision_versions d ON d.id=p_decision AND d.case_id=c.id AND d.org_id=c.org_id AND d.workspace_id=c.workspace_id
JOIN public.assess_v2_case_versions sv ON sv.id=d.source_version_id AND sv.case_id=c.id JOIN public.assess_v2_case_versions v ON v.id=c.head_version_id
LEFT JOIN public.assess_v2_review_assignments a ON a.decision_id=d.id LEFT JOIN public.assess_v2_review_resolutions rr ON rr.review_id=a.id LEFT JOIN public.assess_v2_govern_resolutions g ON g.review_resolution_id=rr.id LEFT JOIN public.assess_v2_studio_handoffs h ON h.govern_resolution_id=g.id
WHERE c.id=p_case AND c.org_id=p_org AND c.workspace_id=p_workspace AND c.deleted_at IS NULL ORDER BY a.assigned_at DESC LIMIT 1$$;

CREATE OR REPLACE FUNCTION public.pr1e_review_command(
 p_command text,p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_decision_id uuid,p_expected_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.assess_v2_cases;d public.assess_v2_decision_versions;sv public.assess_v2_case_versions;r public.assess_command_receipts;a public.assess_v2_review_assignments;rr public.assess_v2_review_resolutions;g public.assess_v2_govern_resolutions;e public.assess_v2_evidence_links;att public.assess_v2_evidence_attestations;control public.assess_v2_runtime_control;h text;result jsonb;v_conf text;v_package jsonb;v_handoff public.assess_v2_studio_handoffs;v_audit uuid:=gen_random_uuid();v_submitter uuid;v_new public.assess_v2_case_versions;v_reviewer_auth bigint;v_material_claims jsonb;v_required_controls jsonb;
BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,CASE p_command WHEN 'assessment_v2.review.assign' THEN 'assess.v2.review' WHEN 'assessment_v2.evidence.attest' THEN 'assess.v2.evidence.attest' WHEN 'assessment_v2.review.resolve' THEN 'assess.v2.approve' WHEN 'assessment_v2.revision.start' THEN 'assess.v2.draft.write' WHEN 'assessment_v2.govern.resolve' THEN 'assess.v2.govern.resolve' WHEN 'assessment_v2.studio.handoff' THEN 'assess.v2.studio.handoff' ELSE 'invalid' END,p_authorization_version);
 h:=encode(public.digest(concat_ws('|',p_command,p_org_id,p_workspace_id,p_case_id,p_decision_id,p_expected_version,p_payload::text),'sha256'),'hex');
 SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
 IF NOT control.enabled THEN RETURN public.pr1e_review_result('FEATURE_DISABLED');END IF;
 SELECT * INTO r FROM public.assess_command_receipts WHERE org_id=p_org_id AND actor_id=p_actor_id AND command_type=p_command AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF r.id IS NOT NULL THEN IF r.request_hash<>h OR r.workspace_id<>p_workspace_id OR r.status<>'succeeded' THEN RETURN public.pr1e_review_result('IDEMPOTENCY_CONFLICT');END IF;RETURN jsonb_build_object('outcome','replayed','resource',r.response);END IF;
 IF control.read_only THEN RETURN public.pr1e_review_result('READ_ONLY');END IF;
 SELECT * INTO c FROM public.assess_v2_cases WHERE id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL FOR UPDATE;
 SELECT * INTO d FROM public.assess_v2_decision_versions WHERE id=p_decision_id AND case_id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id FOR SHARE;
 SELECT * INTO sv FROM public.assess_v2_case_versions WHERE id=d.source_version_id AND case_id=p_case_id AND org_id=p_org_id AND workspace_id=p_workspace_id FOR SHARE;
 IF c.id IS NULL OR d.id IS NULL OR sv.id IS NULL THEN RETURN public.pr1e_review_result('NOT_FOUND');END IF;
 IF c.version<>p_expected_version OR d.source_version_id<>c.head_version_id THEN RETURN public.pr1e_review_result('VERSION_CONFLICT');END IF;

 -- All command-specific validation is complete before a receipt can be claimed.
 IF p_command='assessment_v2.review.assign' THEN
   IF c.status<>'reviewer_ready' OR c.owner_id=(p_payload->>'reviewerId')::uuid OR (p_payload->>'reviewSequence')::bigint<>1 THEN RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;
   SELECT version INTO v_reviewer_auth FROM public.authorization_versions WHERE org_id=p_org_id AND user_id=(p_payload->>'reviewerId')::uuid;
   IF v_reviewer_auth IS NULL THEN RETURN public.pr1e_review_result('NOT_FOUND');END IF;
   PERFORM public.pr1b_assert_command_authority((p_payload->>'reviewerId')::uuid,p_org_id,p_workspace_id,'assess.v2.review',v_reviewer_auth);
   PERFORM public.pr1b_assert_command_authority((p_payload->>'reviewerId')::uuid,p_org_id,p_workspace_id,'assess.v2.evidence.attest',v_reviewer_auth);
   PERFORM public.pr1b_assert_command_authority((p_payload->>'reviewerId')::uuid,p_org_id,p_workspace_id,'assess.v2.approve',v_reviewer_auth);
   SELECT COALESCE(jsonb_agg(jsonb_build_object('claimId',claim_id,'evidenceIds',evidence_ids) ORDER BY claim_id),'[]') INTO v_material_claims FROM (
    SELECT claim_id,COALESCE((SELECT jsonb_agg(el.id ORDER BY el.id) FROM public.assess_v2_evidence_links el WHERE el.version_id=d.source_version_id AND COALESCE(el.payload->'claimIds','[]') ? claim_id),'[]') evidence_ids
    FROM (SELECT DISTINCT jsonb_array_elements_text(COALESCE(trace_item->'fieldIds','[]')) claim_id FROM jsonb_array_elements(COALESCE(d.output_snapshot->'trace','[]')) trace_item) claims WHERE claim_id<>'evidence.coverage'
   ) material;
   IF jsonb_array_length(v_material_claims)=0 THEN RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;
 ELSIF p_command='assessment_v2.evidence.attest' THEN
   SELECT * INTO a FROM public.assess_v2_review_assignments WHERE review_sequence=(p_payload->>'reviewSequence')::bigint AND case_id=c.id AND decision_id=d.id AND source_version_id=d.source_version_id AND decision_version=d.decision_version AND org_id=p_org_id AND workspace_id=p_workspace_id;
   SELECT * INTO e FROM public.assess_v2_evidence_links WHERE id=(p_payload->>'evidenceId')::uuid AND version_id=d.source_version_id AND case_id=c.id AND org_id=p_org_id AND workspace_id=p_workspace_id;
   -- Evidence is persisted by the immutable source authoring command.  Human-readable
   -- payload owner labels are presentation data and are never actor authority.
   v_submitter:=sv.created_by;
   IF a.id IS NULL OR e.id IS NULL OR a.reviewer_id<>p_actor_id OR c.owner_id=p_actor_id OR v_submitter IS NULL OR v_submitter=p_actor_id OR c.status<>'in_review' OR COALESCE(e.payload->>'status','')<>'submitted' OR NOT (e.payload->'claimIds' @> p_payload->'claimIds' AND e.payload->'claimIds' <@ p_payload->'claimIds') THEN RETURN public.pr1e_review_result('NOT_FOUND');END IF;
 ELSIF p_command='assessment_v2.review.resolve' THEN
   SELECT * INTO a FROM public.assess_v2_review_assignments WHERE review_sequence=(p_payload->>'reviewSequence')::bigint AND case_id=c.id AND decision_id=d.id AND source_version_id=d.source_version_id AND decision_version=d.decision_version AND org_id=p_org_id AND workspace_id=p_workspace_id;
   IF a.id IS NULL OR a.reviewer_id<>p_actor_id OR c.owner_id=p_actor_id OR c.status NOT IN('reviewer_ready','in_review') THEN RETURN public.pr1e_review_result('NOT_FOUND');END IF;
   v_conf:='Partially Evidenced';
   IF p_payload->>'resolution'='approved' THEN
    IF jsonb_array_length(a.material_claims)=0 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(a.material_claims) claim WHERE jsonb_array_length(claim->'evidenceIds')=0 OR NOT EXISTS(
       SELECT 1 FROM public.assess_v2_evidence_links el WHERE el.version_id=a.source_version_id AND el.id IN(SELECT value::uuid FROM jsonb_array_elements_text(claim->'evidenceIds'))
       AND COALESCE(el.payload->>'status','')='submitted' AND (el.payload->>'validUntil' IS NULL OR (el.payload->>'validUntil')::timestamptz>now()) AND COALESCE((el.payload->>'contradictory')::boolean,false)=false AND COALESCE(el.payload->'claimIds','[]') ? (claim->>'claimId')
       AND (SELECT latest.outcome FROM public.assess_v2_evidence_attestations latest WHERE latest.review_id=a.id AND latest.evidence_id=el.id AND latest.claim_ids @> ARRAY[claim->>'claimId'] ORDER BY latest.reviewed_at DESC,latest.id DESC LIMIT 1)='accepted'
      )
    ) OR EXISTS(
      SELECT 1 FROM public.assess_v2_evidence_links el JOIN LATERAL(SELECT latest.outcome FROM public.assess_v2_evidence_attestations latest WHERE latest.review_id=a.id AND latest.evidence_id=el.id ORDER BY latest.reviewed_at DESC,latest.id DESC LIMIT 1) latest ON true
      WHERE el.version_id=a.source_version_id AND latest.outcome<>'accepted' AND EXISTS(SELECT 1 FROM jsonb_array_elements(a.material_claims) claim WHERE COALESCE(el.payload->'claimIds','[]') ? (claim->>'claimId'))
    ) THEN RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;
    v_conf:='Verified';
   END IF;
 ELSIF p_command='assessment_v2.revision.start' THEN
   SELECT x.* INTO rr FROM public.assess_v2_review_resolutions x JOIN public.assess_v2_review_assignments y ON y.id=x.review_id WHERE y.review_sequence=(p_payload->>'reviewSequence')::bigint AND x.case_id=c.id AND x.decision_id=d.id AND x.source_version_id=d.source_version_id AND x.resolution='changes_requested';
   IF rr.id IS NULL OR c.status<>'changes_requested' OR c.owner_id<>p_actor_id THEN RETURN public.pr1e_review_result('NOT_FOUND');END IF;
 ELSIF p_command='assessment_v2.govern.resolve' THEN
   SELECT x.* INTO rr FROM public.assess_v2_review_resolutions x JOIN public.assess_v2_review_assignments y ON y.id=x.review_id WHERE y.review_sequence=(p_payload->>'reviewSequence')::bigint AND x.case_id=c.id AND x.decision_id=d.id AND x.source_version_id=d.source_version_id AND x.resolution='approved';
   SELECT COALESCE(jsonb_agg(control ORDER BY control->>'controlId'),'[]') INTO v_required_controls FROM (
    SELECT jsonb_build_object('controlId',x->>'id') control FROM jsonb_array_elements(COALESCE(d.output_snapshot->'controlRequirements','[]')) x WHERE COALESCE((x->>'required')::boolean,false)
    UNION SELECT jsonb_build_object('controlId',value) FROM jsonb_array_elements_text(COALESCE(d.output_snapshot->'controls','[]')) value
   ) required;
   IF rr.id IS NULL OR c.status<>'approved' OR c.owner_id=p_actor_id OR jsonb_array_length(v_required_controls)=0 OR jsonb_array_length(p_payload->'controlDispositions')<>jsonb_array_length(v_required_controls)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_required_controls) required WHERE (SELECT count(*) FROM jsonb_array_elements(p_payload->'controlDispositions') supplied WHERE supplied->>'controlId'=required->>'controlId')<>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'controlDispositions') supplied WHERE supplied->>'status' NOT IN('resolved','conditionally-resolved') OR (supplied->>'status'='conditionally-resolved' AND (COALESCE((supplied->>'conditionSatisfied')::boolean,false)=false OR btrim(COALESCE(supplied->>'condition',''))='' OR btrim(COALESCE(supplied->>'owner',''))='' OR btrim(COALESCE(supplied->>'dueDate',''))='')))
   THEN RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(d.output_snapshot->'actionControls','[]')) x WHERE x->>'category'='approval-bound') AND rr.reviewer_id=p_actor_id THEN RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;
 ELSIF p_command='assessment_v2.studio.handoff' THEN
   SELECT * INTO rr FROM public.assess_v2_review_resolutions WHERE case_id=c.id AND decision_id=d.id AND source_version_id=d.source_version_id AND review_sequence=(p_payload->>'reviewSequence')::bigint AND resolution='approved' ORDER BY resolved_at DESC LIMIT 1;
   SELECT * INTO g FROM public.assess_v2_govern_resolutions WHERE case_id=c.id AND decision_id=d.id AND source_version_id=d.source_version_id AND review_resolution_id=rr.id;
   IF rr.id IS NULL OR g.id IS NULL OR c.status<>'govern_resolved' OR jsonb_array_length(g.required_controls)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(g.required_controls) x WHERE x->>'status' NOT IN('resolved','conditionally-resolved') OR (x->>'status'='conditionally-resolved' AND (COALESCE((x->>'conditionSatisfied')::boolean,false)=false OR btrim(COALESCE(x->>'condition',''))='' OR btrim(COALESCE(x->>'owner',''))='' OR btrim(COALESCE(x->>'dueDate',''))=''))) THEN RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;
 ELSE RETURN public.pr1e_review_result('INVALID_COMMAND');END IF;

 r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,p_command,p_idempotency_key,p_request_id,h);
 IF p_command='assessment_v2.review.assign' THEN
   INSERT INTO public.assess_v2_review_assignments(org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,decision_version,review_schema_version,review_sequence,material_claims,reviewer_id,assigned_by,assigned_reviewer_authorization_version,assigned_by_authorization_version,request_id,receipt_id,audit_event_id)
   VALUES(p_org_id,p_workspace_id,c.id,d.source_version_id,sv.version,d.id,d.decision_version,'assess-v2-review-2026-07',(p_payload->>'reviewSequence')::bigint,v_material_claims,(p_payload->>'reviewerId')::uuid,p_actor_id,v_reviewer_auth,p_authorization_version,p_request_id,r.id,v_audit) RETURNING * INTO a;
   UPDATE public.assess_v2_cases SET status='in_review',version=version+1,updated_at=now() WHERE id=c.id;result:=jsonb_build_object('id',c.id,'status','in_review','version',c.version+1,'reviewId',a.id,'decisionId',d.id);
 ELSIF p_command='assessment_v2.evidence.attest' THEN
   INSERT INTO public.assess_v2_evidence_attestations(org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,decision_version,review_id,review_schema_version,review_sequence,evidence_id,claim_ids,evidence_submitter_id,reviewer_id,reviewer_authorization_version,outcome,rationale,request_id,receipt_id,audit_event_id)
   VALUES(p_org_id,p_workspace_id,c.id,d.source_version_id,sv.version,d.id,d.decision_version,a.id,a.review_schema_version,a.review_sequence,e.id,ARRAY(SELECT jsonb_array_elements_text(p_payload->'claimIds')),v_submitter,p_actor_id,p_authorization_version,p_payload->>'outcome',p_payload->>'rationale',p_request_id,r.id,v_audit) RETURNING * INTO att;
   result:=jsonb_build_object('id',c.id,'status','in_review','version',c.version,'reviewId',a.id,'attestationId',att.id,'outcome',att.outcome);
 ELSIF p_command='assessment_v2.review.resolve' THEN
   INSERT INTO public.assess_v2_review_resolutions(org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,decision_version,review_id,review_schema_version,review_sequence,resolution,reviewed_confidence,conditions,rationale,reviewer_id,reviewer_authorization_version,request_id,receipt_id,audit_event_id)
   VALUES(p_org_id,p_workspace_id,c.id,d.source_version_id,sv.version,d.id,d.decision_version,a.id,a.review_schema_version,a.review_sequence,p_payload->>'resolution',v_conf,p_payload->'conditions',p_payload->>'rationale',p_actor_id,p_authorization_version,p_request_id,r.id,v_audit) RETURNING * INTO rr;
   UPDATE public.assess_v2_cases SET status=p_payload->>'resolution',version=version+1,updated_at=now() WHERE id=c.id;result:=jsonb_build_object('id',c.id,'status',rr.resolution,'version',c.version+1,'reviewId',a.id,'reviewResolutionId',rr.id,'reviewedConfidence',v_conf);
 ELSIF p_command='assessment_v2.revision.start' THEN
   INSERT INTO public.assess_v2_case_versions(case_id,org_id,workspace_id,version,name,description,agent_necessity,source_kind,source_snapshot,imported_facts,created_by)
   SELECT c.id,p_org_id,p_workspace_id,c.version+1,sv.name,sv.description,sv.agent_necessity,'draft_upsert',sv.source_snapshot,sv.imported_facts,p_actor_id RETURNING * INTO v_new;
   INSERT INTO public.assess_v2_primitives SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_primitives WHERE version_id=d.source_version_id;INSERT INTO public.assess_v2_edges SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_edges WHERE version_id=d.source_version_id;INSERT INTO public.assess_v2_decision_points SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_decision_points WHERE version_id=d.source_version_id;INSERT INTO public.assess_v2_exception_paths SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_exception_paths WHERE version_id=d.source_version_id;INSERT INTO public.assess_v2_application_assets SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_application_assets WHERE version_id=d.source_version_id;INSERT INTO public.assess_v2_application_interactions SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_application_interactions WHERE version_id=d.source_version_id;INSERT INTO public.assess_v2_evidence_links SELECT id,v_new.id,case_id,org_id,workspace_id,payload FROM public.assess_v2_evidence_links WHERE version_id=d.source_version_id;
   UPDATE public.assess_v2_cases SET status='draft',version=v_new.version,head_version_id=v_new.id,updated_at=now() WHERE id=c.id;result:=jsonb_build_object('id',c.id,'status','draft','version',v_new.version,'headVersionId',v_new.id,'supersedesDecisionId',d.id);
 ELSIF p_command='assessment_v2.govern.resolve' THEN
   INSERT INTO public.assess_v2_govern_resolutions(org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,decision_version,review_resolution_id,review_schema_version,review_sequence,actions,required_controls,review_frequency,accountable_owner,rationale,resolver_id,resolver_authorization_version,request_id,receipt_id,audit_event_id)
   VALUES(p_org_id,p_workspace_id,c.id,d.source_version_id,sv.version,d.id,d.decision_version,rr.id,rr.review_schema_version,rr.review_sequence,COALESCE(d.output_snapshot->'actionControls','[]'),p_payload->'controlDispositions','on material change',COALESCE(d.output_snapshot->>'accountableOwner',c.owner_id::text),p_payload->>'rationale',p_actor_id,p_authorization_version,p_request_id,r.id,v_audit) RETURNING * INTO g;
   UPDATE public.assess_v2_cases SET status='govern_resolved',version=version+1,updated_at=now() WHERE id=c.id;result:=jsonb_build_object('id',c.id,'status','govern_resolved','version',c.version+1,'governResolutionId',g.id);
 ELSE
   v_package:=jsonb_build_object('lineage',jsonb_build_object('organizationId',p_org_id,'workspaceId',p_workspace_id,'caseId',c.id,'sourceCaseVersion',sv.version,'sourceVersionId',d.source_version_id,'decisionId',d.id,'decisionVersion',d.decision_version),'process',d.input_snapshot,'decision',d.output_snapshot,'evidenceSubmissions',d.evidence_snapshot,'attestations',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY reviewed_at),'[]') FROM public.assess_v2_evidence_attestations x WHERE x.review_id=rr.review_id),'approval',to_jsonb(rr),'govern',to_jsonb(g),'versions',jsonb_build_object('schema',d.schema_version,'ruleSet',d.rule_set_version,'decision',d.decision_version,'reviewSchema',rr.review_schema_version,'reviewSequence',rr.review_sequence),'canonicalHashes',jsonb_build_object('input',d.input_hash,'evidence',d.evidence_hash,'output',d.output_hash));
   INSERT INTO public.assess_v2_studio_handoffs(org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,review_resolution_id,govern_resolution_id,package,package_hash,schema_version,rule_set_version,decision_version,review_schema_version,review_sequence,handed_off_by,handoff_authorization_version,request_id,receipt_id,audit_event_id)
   VALUES(p_org_id,p_workspace_id,c.id,d.source_version_id,sv.version,d.id,rr.id,g.id,v_package,encode(public.digest(convert_to(v_package::text,'UTF8'),'sha256'),'hex'),d.schema_version,d.rule_set_version,d.decision_version,rr.review_schema_version,rr.review_sequence,p_actor_id,p_authorization_version,p_request_id,r.id,v_audit) RETURNING * INTO v_handoff;
   INSERT INTO public.assess_v2_studio_sources(org_id,workspace_id,case_id,decision_id,handoff_id,source_context) VALUES(p_org_id,p_workspace_id,c.id,d.id,v_handoff.id,v_package);
   UPDATE public.assess_v2_cases SET status='handed_off',version=version+1,updated_at=now() WHERE id=c.id;result:=jsonb_build_object('id',c.id,'status','handed_off','version',c.version+1,'handoffId',v_handoff.id,'packageHash',v_handoff.package_hash);
 END IF;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata) VALUES(v_audit,p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command,'assess_v2_case',c.id,'succeeded',COALESCE((result->>'version')::bigint,c.version),jsonb_build_object('decisionId',d.id,'sourceVersionId',d.source_version_id,'receiptId',r.id));
 result:=public.pr1e_review_projection(p_org_id,p_workspace_id,c.id,d.id);
 UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;RETURN jsonb_build_object('outcome','committed','resource',result);
EXCEPTION WHEN unique_violation THEN RETURN public.pr1e_review_result('VERSION_CONFLICT');WHEN OTHERS THEN IF SQLERRM LIKE '%PR1B_IDEMPOTENCY_CONFLICT%' THEN RETURN public.pr1e_review_result('IDEMPOTENCY_CONFLICT');ELSIF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN public.pr1e_review_result('AUTHORIZATION_STALE');ELSIF SQLERRM LIKE '%PR1D_FEATURE_DISABLED%' THEN RETURN public.pr1e_review_result('FEATURE_DISABLED');ELSIF SQLERRM LIKE '%PR1D_READ_ONLY%' THEN RETURN public.pr1e_review_result('READ_ONLY');END IF;RAISE;END$$;

DO $$DECLARE n text;command_name text;BEGIN FOREACH n IN ARRAY ARRAY['assign_assess_v2_review','attest_assess_v2_evidence','resolve_assess_v2_review','start_assess_v2_revision','resolve_assess_v2_govern','handoff_assess_v2_studio'] LOOP command_name:=CASE n WHEN 'assign_assess_v2_review' THEN 'assessment_v2.review.assign' WHEN 'attest_assess_v2_evidence' THEN 'assessment_v2.evidence.attest' WHEN 'resolve_assess_v2_review' THEN 'assessment_v2.review.resolve' WHEN 'start_assess_v2_revision' THEN 'assessment_v2.revision.start' WHEN 'resolve_assess_v2_govern' THEN 'assessment_v2.govern.resolve' ELSE 'assessment_v2.studio.handoff' END;EXECUTE format('CREATE OR REPLACE FUNCTION public.pr1e_%I(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_decision_id uuid,p_expected_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint,p_payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS %L',n,format('SELECT public.pr1e_review_command(%L,p_actor_id,p_org_id,p_workspace_id,p_case_id,p_decision_id,p_expected_version,p_request_id,p_idempotency_key,p_authorization_version,p_payload)',command_name));END LOOP;END$$;

CREATE OR REPLACE FUNCTION public.assess_v2_review_queue(p_org_id uuid,p_workspace_id uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT jsonb_build_object('assignmentId',a.id,'caseId',c.id,'caseName',v.name,'status',CASE WHEN c.status IN('govern_resolved','handed_off') THEN 'approved' ELSE c.status END) FROM public.assess_v2_review_assignments a JOIN public.assess_v2_cases c ON c.id=a.case_id AND c.org_id=a.org_id AND c.workspace_id=a.workspace_id JOIN public.assess_v2_decision_versions d ON d.id=a.decision_id AND d.source_version_id=a.source_version_id JOIN public.assess_v2_case_versions v ON v.id=d.source_version_id WHERE a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.reviewer_id=auth.uid() AND c.deleted_at IS NULL AND public.has_workspace_capability(p_workspace_id,p_org_id,'assess.v2.read') ORDER BY a.assigned_at$$;
CREATE OR REPLACE FUNCTION public.assess_v2_review_workspace(p_org_id uuid,p_workspace_id uuid,p_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT CASE WHEN NOT public.has_workspace_capability(p_workspace_id,p_org_id,'assess.v2.read') THEN NULL ELSE (SELECT public.pr1e_review_projection(p_org_id,p_workspace_id,c.id,d.id) FROM public.assess_v2_cases c JOIN public.assess_v2_decision_versions d ON d.case_id=c.id AND d.org_id=c.org_id AND d.workspace_id=c.workspace_id JOIN public.assess_v2_case_versions v ON v.id=d.source_version_id AND v.case_id=c.id WHERE c.id=p_case_id AND c.org_id=p_org_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL ORDER BY d.created_at DESC LIMIT 1) END$$;
CREATE OR REPLACE FUNCTION public.assess_v2_eligible_reviewers(p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_decision_id uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('actorId',p.id,'label',COALESCE(NULLIF(btrim(p.full_name),''),p.email),'authorizationVersion',av.version)
 FROM public.assess_v2_cases c JOIN public.assess_v2_decision_versions d ON d.id=p_decision_id AND d.case_id=c.id AND d.source_version_id=c.head_version_id AND d.org_id=c.org_id AND d.workspace_id=c.workspace_id
 JOIN public.profiles p ON p.id<>c.owner_id JOIN public.authorization_versions av ON av.org_id=c.org_id AND av.user_id=p.id
 WHERE c.id=p_case_id AND c.org_id=p_org_id AND c.workspace_id=p_workspace_id AND c.status='reviewer_ready' AND c.deleted_at IS NULL
 AND public.has_workspace_capability(p_workspace_id,p_org_id,'assess.v2.review')
 AND public.pr1e_actor_has_workspace_capability(p.id,p_org_id,p_workspace_id,'assess.v2.review')
 AND public.pr1e_actor_has_workspace_capability(p.id,p_org_id,p_workspace_id,'assess.v2.evidence.attest')
 AND public.pr1e_actor_has_workspace_capability(p.id,p_org_id,p_workspace_id,'assess.v2.approve')
 ORDER BY COALESCE(NULLIF(btrim(p.full_name),''),p.email),p.id
$$;

REVOKE ALL ON FUNCTION public.pr1e_can_read_lineage(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.pr1e_actor_has_workspace_capability(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.pr1e_review_command(text,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1e_can_read_lineage(uuid,uuid,uuid,uuid) TO authenticated;
DO $$DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['assign_assess_v2_review','attest_assess_v2_evidence','resolve_assess_v2_review','start_assess_v2_revision','resolve_assess_v2_govern','handoff_assess_v2_studio'] LOOP EXECUTE format('REVOKE ALL ON FUNCTION public.pr1e_%I(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb) FROM PUBLIC,anon,authenticated',n);EXECUTE format('GRANT EXECUTE ON FUNCTION public.pr1e_%I(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb) TO service_role',n);END LOOP;END$$;
REVOKE ALL ON FUNCTION public.assess_v2_review_queue(uuid,uuid),public.assess_v2_review_workspace(uuid,uuid,uuid),public.assess_v2_eligible_reviewers(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.assess_v2_review_queue(uuid,uuid),public.assess_v2_review_workspace(uuid,uuid,uuid),public.assess_v2_eligible_reviewers(uuid,uuid,uuid,uuid) TO authenticated;
