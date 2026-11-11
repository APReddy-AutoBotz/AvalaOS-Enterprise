-- Trust Assurance Evidence Hub. Additive source authority; no readiness claim or tenant seed data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE FUNCTION public.trust_assurance_hash(p_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,public AS $$ SELECT encode(public.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex') $$;
INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('trust.read','trust','Read scoped Trust Assurance projections'),('trust.manage','trust','Manage claims, evidence, links and snapshots'),
 ('trust.review','trust','Independently review exact Trust Assurance versions'),('trust.publish','trust','Publish or withdraw reviewed assurance snapshots')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

CREATE TABLE public.trust_claims(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 workspace_id uuid, owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 readiness_domain text NOT NULL CHECK(readiness_domain IN('security','tenant_isolation','ai_controls','evidence','export','deployment','operations','buyer_readiness','product_readiness','release_candidate')),
 current_version_id uuid, lifecycle text NOT NULL DEFAULT 'draft' CHECK(lifecycle IN('draft','under_review','changes_requested','reviewed','approved','published','withdrawn')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id), FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.trust_claim_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), claim_id uuid NOT NULL REFERENCES public.trust_claims(id) ON DELETE RESTRICT,
 org_id uuid NOT NULL, workspace_id uuid, version bigint NOT NULL CHECK(version>0), claim_text text NOT NULL CHECK(length(btrim(claim_text)) BETWEEN 1 AND 4000),
 proposed_proof_status text NOT NULL CHECK(proposed_proof_status IN('demo','planned','configured','evidence_required','verified','blocked')),
 proof_boundary text NOT NULL CHECK(proof_boundary IN('docs_only','synthetic_only','local_unproven','hosted_unproven','verified_with_evidence','blocked_until_ap_approval')),
 buyer_safe_wording text NOT NULL CHECK(length(btrim(buyer_safe_wording)) BETWEEN 1 AND 2000), limitation_disclosure text NOT NULL CHECK(length(limitation_disclosure)<=4000),
 does_not_prove jsonb NOT NULL CHECK(jsonb_typeof(does_not_prove)='array' AND jsonb_array_length(does_not_prove)>0), canonical_hash text NOT NULL CHECK(canonical_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(), supersedes_version_id uuid REFERENCES public.trust_claim_versions(id) ON DELETE RESTRICT,
 UNIQUE(claim_id,version), UNIQUE(id,org_id,workspace_id), UNIQUE(claim_id,canonical_hash), FOREIGN KEY(claim_id,org_id,workspace_id) REFERENCES public.trust_claims(id,org_id,workspace_id) ON DELETE RESTRICT);
ALTER TABLE public.trust_claims ADD CONSTRAINT trust_claim_current_version_fk FOREIGN KEY(current_version_id,org_id,workspace_id) REFERENCES public.trust_claim_versions(id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.trust_evidence(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT, workspace_id uuid,
 owner_id uuid NOT NULL REFERENCES public.profiles(id), evidence_type text NOT NULL CHECK(length(btrim(evidence_type)) BETWEEN 1 AND 80), current_version_id uuid,
 lifecycle text NOT NULL DEFAULT 'active' CHECK(lifecycle IN('active','superseded','withdrawn','blocked','not_run')), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.trust_evidence_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),evidence_id uuid NOT NULL REFERENCES public.trust_evidence(id) ON DELETE RESTRICT,org_id uuid NOT NULL,workspace_id uuid,version bigint NOT NULL CHECK(version>0),
 reference_type text NOT NULL CHECK(reference_type IN('repository_path','workflow_run','test_report','attestation','other')),reference_value text NOT NULL CHECK(length(btrim(reference_value)) BETWEEN 1 AND 512 AND reference_value!~*'(token=|signature=|/storage/v1/object/)'),
 digest text CHECK(digest IS NULL OR digest~'^[0-9a-f]{64}$'),summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 1 AND 2000),
 evidence_boundary text NOT NULL CHECK(evidence_boundary IN('docs_only','synthetic_only','local_unproven','hosted_unproven','verified_with_evidence','blocked_until_ap_approval')),
 result text NOT NULL CHECK(result IN('performed','blocked','not_run')),observed_at timestamptz,review_due_at timestamptz,expires_at timestamptz,
 lifecycle text NOT NULL CHECK(lifecycle IN('active','superseded','withdrawn','blocked','not_run')),canonical_hash text NOT NULL CHECK(canonical_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),supersedes_version_id uuid REFERENCES public.trust_evidence_versions(id) ON DELETE RESTRICT,
 UNIQUE(evidence_id,version),UNIQUE(id,org_id,workspace_id),UNIQUE(evidence_id,canonical_hash),FOREIGN KEY(evidence_id,org_id,workspace_id) REFERENCES public.trust_evidence(id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((result='performed' AND observed_at IS NOT NULL) OR result IN('blocked','not_run')));
ALTER TABLE public.trust_evidence ADD CONSTRAINT trust_evidence_current_version_fk FOREIGN KEY(current_version_id,org_id,workspace_id) REFERENCES public.trust_evidence_versions(id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.trust_claim_evidence_links(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid,claim_version_id uuid NOT NULL,evidence_version_id uuid NOT NULL,
 relationship text NOT NULL CHECK(relationship IN('supports','contradicts','limits')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),canonical_hash text NOT NULL CHECK(canonical_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),supersedes_link_id uuid REFERENCES public.trust_claim_evidence_links(id) ON DELETE RESTRICT,
 UNIQUE(claim_version_id,evidence_version_id,relationship,canonical_hash),UNIQUE(id,org_id,workspace_id),FOREIGN KEY(claim_version_id,org_id,workspace_id) REFERENCES public.trust_claim_versions(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(evidence_version_id,org_id,workspace_id) REFERENCES public.trust_evidence_versions(id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE TABLE public.trust_review_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id),workspace_id uuid,resource_type text NOT NULL CHECK(resource_type IN('claim_version','evidence_version','snapshot')),
 resource_id uuid NOT NULL,resource_hash text NOT NULL CHECK(resource_hash~'^[0-9a-f]{64}$'),reviewer_id uuid NOT NULL REFERENCES public.profiles(id),decision text NOT NULL CHECK(decision IN('changes_requested','reviewed','approved')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 2000),authorization_version bigint NOT NULL CHECK(authorization_version>0),review_ordinal bigint NOT NULL CHECK(review_ordinal>0),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE UNIQUE INDEX trust_review_event_exact_order ON public.trust_review_events(org_id,COALESCE(workspace_id,'00000000-0000-0000-0000-000000000000'::uuid),resource_type,resource_id,resource_hash,review_ordinal);
CREATE TABLE public.trust_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id),workspace_id uuid,selection jsonb NOT NULL CHECK(jsonb_typeof(selection)='object'),canonical_hash text NOT NULL CHECK(canonical_hash~'^[0-9a-f]{64}$'),
 lifecycle text NOT NULL DEFAULT 'draft' CHECK(lifecycle IN('draft','under_review','changes_requested','reviewed','approved','published','withdrawn')),creator_id uuid NOT NULL REFERENCES public.profiles(id),version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 reviewed_by uuid REFERENCES public.profiles(id),reviewed_hash text CHECK(reviewed_hash IS NULL OR reviewed_hash~'^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,canonical_hash),FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,CHECK(reviewed_by IS NULL OR reviewed_by<>creator_id));
CREATE TABLE public.trust_publication_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid,snapshot_id uuid NOT NULL,snapshot_hash text NOT NULL CHECK(snapshot_hash~'^[0-9a-f]{64}$'),
 event_type text NOT NULL CHECK(event_type IN('published','withdrawn','superseded')),publisher_id uuid NOT NULL REFERENCES public.profiles(id),supersedes_publication_id uuid REFERENCES public.trust_publication_events(id) ON DELETE RESTRICT,
 is_current boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,org_id,workspace_id),FOREIGN KEY(snapshot_id,org_id,workspace_id) REFERENCES public.trust_snapshots(id,org_id,workspace_id) ON DELETE RESTRICT);
CREATE UNIQUE INDEX trust_one_current_publication ON public.trust_publication_events(org_id,COALESCE(workspace_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_current;
CREATE TABLE public.trust_current_publications(org_id uuid NOT NULL REFERENCES public.organizations(id),workspace_scope uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',publication_id uuid NOT NULL REFERENCES public.trust_publication_events(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,workspace_scope));
CREATE TABLE public.trust_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id),workspace_id uuid,actor_id uuid NOT NULL REFERENCES public.profiles(id),operation text NOT NULL,
 idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 1 AND 200),request_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),status text NOT NULL CHECK(status='committed'),
 http_status integer NOT NULL CHECK(http_status BETWEEN 200 AND 499),response_body jsonb NOT NULL CHECK(jsonb_typeof(response_body)='object'),resource_id uuid NOT NULL,resource_version bigint NOT NULL CHECK(resource_version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,actor_id,operation,idempotency_key),FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);
CREATE TABLE public.trust_audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id),workspace_id uuid,actor_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL,resource_type text NOT NULL,resource_id uuid NOT NULL,
 resource_version bigint NOT NULL CHECK(resource_version>0),result text NOT NULL CHECK(result IN('committed','denied')),request_id uuid NOT NULL,receipt_id uuid REFERENCES public.trust_command_receipts(id),metadata jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(metadata)='object' AND pg_column_size(metadata)<=4096),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT);

CREATE FUNCTION public.trust_assurance_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'TRUST_ASSURANCE_IMMUTABLE'; END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['trust_claim_versions','trust_evidence_versions','trust_claim_evidence_links','trust_review_events','trust_publication_events','trust_command_receipts','trust_audit_events'] LOOP EXECUTE format('CREATE TRIGGER %I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trust_assurance_immutable()',t,t); END LOOP; END $$;

-- Canonical tables are service-owned. Query access is only through scoped SECURITY DEFINER functions added below.
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['trust_claims','trust_claim_versions','trust_evidence','trust_evidence_versions','trust_claim_evidence_links','trust_review_events','trust_snapshots','trust_publication_events','trust_current_publications','trust_command_receipts','trust_audit_events'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t); END LOOP; END $$;
REVOKE ALL ON FUNCTION public.trust_assurance_hash(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_hash(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.trust_assurance_immutable() FROM PUBLIC,anon,authenticated;

-- One deterministic evidence law serves publication and both projections.
CREATE FUNCTION public.trust_assurance_evidence_freshness(p_review_due_at timestamptz,p_expires_at timestamptz,p_as_of timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_expires_at IS NOT NULL AND p_expires_at<=p_as_of THEN 'expired' WHEN p_review_due_at IS NOT NULL AND p_review_due_at<=p_as_of THEN 'review_due' ELSE 'current' END
$$;
CREATE FUNCTION public.trust_assurance_append_review_event(p_org_id uuid,p_workspace_id uuid,p_resource_type text,p_resource_id uuid,p_resource_hash text,p_reviewer_id uuid,p_decision text,p_rationale text,p_authorization_version bigint)
RETURNS public.trust_review_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE next_ordinal bigint;inserted public.trust_review_events;BEGIN
 IF p_resource_type NOT IN('claim_version','evidence_version','snapshot') OR p_decision NOT IN('changes_requested','reviewed','approved') THEN RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('trust-review:'||p_org_id::text||':'||COALESCE(p_workspace_id,'00000000-0000-0000-0000-000000000000'::uuid)::text||':'||p_resource_type||':'||p_resource_id::text||':'||p_resource_hash,0));
 SELECT COALESCE(max(review_ordinal),0)+1 INTO next_ordinal FROM public.trust_review_events WHERE org_id=p_org_id AND workspace_id IS NOT DISTINCT FROM p_workspace_id AND resource_type=p_resource_type AND resource_id=p_resource_id AND resource_hash=p_resource_hash;
 INSERT INTO public.trust_review_events(org_id,workspace_id,resource_type,resource_id,resource_hash,reviewer_id,decision,rationale,authorization_version,review_ordinal)
 VALUES(p_org_id,p_workspace_id,p_resource_type,p_resource_id,p_resource_hash,p_reviewer_id,p_decision,p_rationale,p_authorization_version,next_ordinal) RETURNING * INTO inserted;
 RETURN inserted;
END $$;
CREATE FUNCTION public.trust_assurance_current_review_disposition(p_org_id uuid,p_workspace_id uuid,p_resource_type text,p_resource_id uuid,p_resource_hash text)
RETURNS public.trust_review_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT review FROM public.trust_review_events review
 WHERE review.org_id=p_org_id AND review.workspace_id IS NOT DISTINCT FROM p_workspace_id AND review.resource_type=p_resource_type AND review.resource_id=p_resource_id AND review.resource_hash=p_resource_hash
 ORDER BY review.review_ordinal DESC LIMIT 1
$$;
CREATE FUNCTION public.trust_assurance_effective_claim_law(p_claim_version_id uuid,p_selected_links jsonb,p_as_of timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public AS $$
DECLARE proposed text;limitation text;does_not_prove jsonb;usable_support boolean;active_contradiction boolean;claim_changes_requested boolean;blocked_reasons jsonb:='[]'::jsonb;BEGIN
 SELECT cv.proposed_proof_status,cv.limitation_disclosure,cv.does_not_prove INTO proposed,limitation,does_not_prove FROM public.trust_claim_versions cv WHERE cv.id=p_claim_version_id;
 IF proposed IS NULL THEN RETURN NULL; END IF;
 IF proposed<>'verified' THEN RETURN jsonb_build_object('effectiveProofStatus',proposed,'blockedReasons',blocked_reasons,'usableSupport',false,'activeContradiction',false); END IF;
 SELECT EXISTS(SELECT 1 FROM public.trust_claim_versions cv CROSS JOIN LATERAL public.trust_assurance_current_review_disposition(cv.org_id,cv.workspace_id,'claim_version',cv.id,cv.canonical_hash) review WHERE cv.id=p_claim_version_id AND review.decision='changes_requested') INTO claim_changes_requested;
 WITH linked AS(
  SELECT l.relationship,ev.id evidence_version_id,ev.org_id evidence_org_id,ev.workspace_id evidence_workspace_id,ev.canonical_hash,ev.lifecycle evidence_lifecycle,ev.result,ev.review_due_at,ev.expires_at,e.lifecycle aggregate_lifecycle,e.current_version_id
  FROM public.trust_claim_evidence_links l JOIN public.trust_evidence_versions ev ON ev.id=l.evidence_version_id JOIN public.trust_evidence e ON e.id=ev.evidence_id
  WHERE l.claim_version_id=p_claim_version_id AND (p_selected_links IS NULL OR EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_selected_links) selected WHERE (selected->>'linkId')::uuid=l.id AND selected->>'linkHash'=l.canonical_hash AND (selected->>'evidenceVersionId')::uuid=ev.id AND selected->>'evidenceHash'=ev.canonical_hash
  ))
 ) SELECT
  COALESCE(bool_or(relationship='supports' AND aggregate_lifecycle='active' AND evidence_lifecycle='active' AND current_version_id=evidence_version_id AND result='performed' AND public.trust_assurance_evidence_freshness(review_due_at,expires_at,p_as_of)='current' AND EXISTS(SELECT 1 FROM public.trust_assurance_current_review_disposition(evidence_org_id,evidence_workspace_id,'evidence_version',evidence_version_id,canonical_hash) review WHERE review.decision IN('reviewed','approved'))),false),
  COALESCE(bool_or(relationship='contradicts' AND aggregate_lifecycle='active' AND evidence_lifecycle='active' AND current_version_id=evidence_version_id AND public.trust_assurance_evidence_freshness(review_due_at,expires_at,p_as_of)<>'expired'),false)
 INTO usable_support,active_contradiction FROM linked;
 IF NOT usable_support THEN blocked_reasons:=blocked_reasons||jsonb_build_array('CURRENT_APPROVED_SUPPORT_REQUIRED'); END IF;
 IF active_contradiction THEN blocked_reasons:=blocked_reasons||jsonb_build_array('CURRENT_CONTRADICTION'); END IF;
 IF claim_changes_requested THEN blocked_reasons:=blocked_reasons||jsonb_build_array('CURRENT_CLAIM_REVIEW_REQUIRED'); END IF;
 IF length(btrim(limitation))=0 THEN blocked_reasons:=blocked_reasons||jsonb_build_array('LIMITATION_DISCLOSURE_REQUIRED'); END IF;
 IF jsonb_array_length(does_not_prove)=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(does_not_prove) item WHERE jsonb_typeof(item)<>'string' OR length(btrim(item#>>'{}'))=0) THEN blocked_reasons:=blocked_reasons||jsonb_build_array('DOES_NOT_PROVE_REQUIRED'); END IF;
 RETURN jsonb_build_object('effectiveProofStatus',CASE WHEN jsonb_array_length(blocked_reasons)>0 THEN 'evidence_required' ELSE 'verified' END,'blockedReasons',blocked_reasons,'usableSupport',usable_support,'activeContradiction',active_contradiction);
END $$;
REVOKE ALL ON FUNCTION public.trust_assurance_evidence_freshness(timestamptz,timestamptz,timestamptz),public.trust_assurance_effective_claim_law(uuid,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_evidence_freshness(timestamptz,timestamptz,timestamptz),public.trust_assurance_effective_claim_law(uuid,jsonb,timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.trust_assurance_append_review_event(uuid,uuid,text,uuid,text,uuid,text,text,bigint),public.trust_assurance_current_review_disposition(uuid,uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_append_review_event(uuid,uuid,text,uuid,text,uuid,text,text,bigint),public.trust_assurance_current_review_disposition(uuid,uuid,text,uuid,text) TO service_role;

-- Publication revalidates historical creator/reviewer identities as current
-- exact-scope participants. These are participation locks only; capability and
-- authorization-version authority remain independently owned by PR1B.
CREATE FUNCTION public.trust_assurance_assert_active_participant(p_user_id uuid,p_org_id uuid,p_workspace_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_user_id IS NULL OR p_org_id IS NULL OR p_workspace_id IS NULL THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
 PERFORM 1
 FROM public.profiles p
 JOIN public.organization_members om ON om.user_id=p.id AND om.org_id=p_org_id
 JOIN public.workspace_memberships wm ON wm.user_id=p.id AND wm.org_id=om.org_id AND wm.workspace_id=p_workspace_id
 JOIN public.organizations o ON o.id=om.org_id
 JOIN public.workspaces w ON w.id=wm.workspace_id AND w.org_id=wm.org_id
 WHERE p.id=p_user_id AND p.status='active' AND p.deleted_at IS NULL
   AND om.status='active' AND om.deleted_at IS NULL
   AND wm.status='active' AND wm.deleted_at IS NULL
   AND o.status='active' AND o.deleted_at IS NULL
   AND w.status='active' AND w.deleted_at IS NULL
 LIMIT 1
 FOR SHARE OF p,om,wm,o,w;
 IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.trust_assurance_assert_active_participant(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_assert_active_participant(uuid,uuid,uuid) TO service_role;

-- Publication locks every mutable aggregate named by the immutable selection
-- before it recomputes lineage or evidence law. Deterministic UUID ordering is
-- shared with link mutation so currentness cannot change between validation
-- and the buyer-publication effect.
CREATE FUNCTION public.trust_assurance_lock_snapshot_selection(p_snapshot_id uuid,p_org_id uuid,p_workspace_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE expected_claims integer;locked_claims integer;expected_evidence integer;locked_evidence integer;BEGIN
 SELECT jsonb_array_length(s.selection->'claims') INTO expected_claims
 FROM public.trust_snapshots s WHERE s.id=p_snapshot_id AND s.org_id=p_org_id AND s.workspace_id IS NOT DISTINCT FROM p_workspace_id;
 IF expected_claims IS NULL OR expected_claims<1 THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
 PERFORM c.id
 FROM public.trust_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.selection->'claims') selected
 JOIN public.trust_claims c ON c.id=(selected->>'claimId')::uuid
 WHERE s.id=p_snapshot_id AND c.org_id=p_org_id AND c.workspace_id IS NOT DISTINCT FROM p_workspace_id
   AND c.current_version_id=(selected->>'claimVersionId')::uuid
 ORDER BY c.id FOR SHARE OF c;
 GET DIAGNOSTICS locked_claims=ROW_COUNT;
 IF locked_claims<>expected_claims THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
 SELECT COALESCE(sum(jsonb_array_length(selected->'links')),0)::integer INTO expected_evidence
 FROM public.trust_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.selection->'claims') selected
 WHERE s.id=p_snapshot_id;
 PERFORM e.id
 FROM public.trust_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.selection->'claims') selected
 CROSS JOIN LATERAL jsonb_array_elements(selected->'links') selected_link
 JOIN public.trust_claim_evidence_links l ON l.id=(selected_link->>'linkId')::uuid
   AND l.claim_version_id=(selected->>'claimVersionId')::uuid AND l.canonical_hash=selected_link->>'linkHash'
 JOIN public.trust_evidence_versions ev ON ev.id=(selected_link->>'evidenceVersionId')::uuid
   AND ev.id=l.evidence_version_id AND ev.canonical_hash=selected_link->>'evidenceHash'
 JOIN public.trust_evidence e ON e.id=ev.evidence_id
 WHERE s.id=p_snapshot_id AND l.org_id=p_org_id AND l.workspace_id IS NOT DISTINCT FROM p_workspace_id
   AND ev.org_id=p_org_id AND ev.workspace_id IS NOT DISTINCT FROM p_workspace_id
   AND e.org_id=p_org_id AND e.workspace_id IS NOT DISTINCT FROM p_workspace_id
   AND e.current_version_id=ev.id AND e.lifecycle='active' AND ev.lifecycle='active'
 ORDER BY e.id,ev.id FOR SHARE OF e;
 GET DIAGNOSTICS locked_evidence=ROW_COUNT;
 IF locked_evidence<>expected_evidence THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.trust_assurance_lock_snapshot_selection(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_lock_snapshot_selection(uuid,uuid,uuid) TO service_role;

-- Mutation dispatcher remains private; every operation is validated and committed by one transaction.
CREATE FUNCTION public.trust_assurance_command(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_operation text,p_idempotency_key text,p_request_id uuid,p_request_hash text,p_authorization_version bigint,p_mutations_enabled boolean,p_expected_version bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.trust_command_receipts; actual bigint; cap text; selection_value jsonb; derived_hash text; resource_hash text; current_publication_id uuid; current_snapshot_id uuid; snapshot_creator_id uuid; snapshot_reviewer_id uuid; BEGIN
 IF p_operation NOT IN('claim.create','claim.revise','evidence.register','evidence.supersede','evidence.withdraw','evidence.link','resource.review','snapshot.create','snapshot.review','snapshot.publish','snapshot.withdraw') OR jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'ACCESS_DENIED'; END IF;
 cap:=CASE WHEN p_operation IN('resource.review','snapshot.review') THEN 'trust.review' WHEN p_operation IN('snapshot.publish','snapshot.withdraw') THEN 'trust.publish' ELSE 'trust.manage' END;
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,cap,p_authorization_version);
 IF p_operation IN('claim.revise','evidence.supersede','evidence.withdraw','snapshot.review','snapshot.publish','snapshot.withdraw') AND (p_expected_version IS NULL OR p_expected_version<1) THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_actor_id::text||':'||p_operation||':'||p_idempotency_key,0));
 SELECT * INTO r FROM public.trust_command_receipts WHERE org_id=p_org_id AND actor_id=p_actor_id AND operation=p_operation AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF FOUND THEN IF r.request_hash<>p_request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF; RETURN jsonb_set(r.response_body,'{replayed}','true'::jsonb,false); END IF;
 IF NOT COALESCE(p_mutations_enabled,false) THEN RAISE EXCEPTION 'FEATURE_DISABLED'; END IF;
 IF p_operation IN('snapshot.publish','snapshot.withdraw') THEN PERFORM pg_advisory_xact_lock(hashtextextended('trust-current-publication:'||p_org_id::text||':'||COALESCE(p_workspace_id,'00000000-0000-0000-0000-000000000000'::uuid)::text,0)); END IF;
 -- Feature-owned typed Edge layer supplies canonical validated payload. Operation-specific state transitions are deliberately explicit.
 IF p_operation='snapshot.publish' THEN
   SELECT version,creator_id,reviewed_by INTO actual,snapshot_creator_id,snapshot_reviewer_id FROM public.trust_snapshots WHERE id=(p_payload->>'snapshotId')::uuid AND org_id=p_org_id AND workspace_id IS NOT DISTINCT FROM p_workspace_id FOR UPDATE;
   IF actual IS NULL OR actual<>p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   IF snapshot_reviewer_id IS NULL OR snapshot_creator_id=p_actor_id OR snapshot_reviewer_id=p_actor_id THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
   PERFORM public.trust_assurance_lock_snapshot_selection((p_payload->>'snapshotId')::uuid,p_org_id,p_workspace_id);
   IF EXISTS(SELECT 1 FROM public.trust_snapshots s WHERE s.id=(p_payload->>'snapshotId')::uuid AND (s.lifecycle<>'reviewed' OR s.reviewed_hash IS DISTINCT FROM s.canonical_hash OR NOT EXISTS(SELECT 1 FROM public.trust_assurance_current_review_disposition(s.org_id,s.workspace_id,'snapshot',s.id,s.canonical_hash) review WHERE review.decision IN('reviewed','approved') AND review.reviewer_id=s.reviewed_by))) THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
   SELECT public.trust_assurance_hash(jsonb_build_object('claims',jsonb_agg(jsonb_build_object('claimId',c.id,'claimVersionId',cv.id,'claimHash',cv.canonical_hash,'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('linkId',l.id,'linkHash',l.canonical_hash,'evidenceVersionId',ev.id,'evidenceHash',ev.canonical_hash) ORDER BY l.id) FROM public.trust_claim_evidence_links l JOIN public.trust_evidence_versions ev ON ev.id=l.evidence_version_id WHERE l.claim_version_id=cv.id),'[]'::jsonb)) ORDER BY c.id))) INTO derived_hash FROM public.trust_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.selection->'claims') x JOIN public.trust_claims c ON c.id=(x->>'claimId')::uuid JOIN public.trust_claim_versions cv ON cv.id=c.current_version_id WHERE s.id=(p_payload->>'snapshotId')::uuid;
   IF derived_hash IS DISTINCT FROM (SELECT canonical_hash FROM public.trust_snapshots WHERE id=(p_payload->>'snapshotId')::uuid) OR EXISTS(SELECT 1 FROM public.trust_snapshots s CROSS JOIN LATERAL jsonb_array_elements(s.selection->'claims') x JOIN public.trust_claim_versions cv ON cv.id=(x->>'claimVersionId')::uuid WHERE s.id=(p_payload->>'snapshotId')::uuid AND (NOT EXISTS(SELECT 1 FROM public.trust_assurance_current_review_disposition(cv.org_id,cv.workspace_id,'claim_version',cv.id,cv.canonical_hash) review WHERE review.decision IN('reviewed','approved')) OR (cv.proposed_proof_status='verified' AND public.trust_assurance_effective_claim_law(cv.id,x->'links',now())->>'effectiveProofStatus'<>'verified'))) THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
   PERFORM public.trust_assurance_assert_active_participant(snapshot_creator_id,p_org_id,p_workspace_id);
   PERFORM public.trust_assurance_assert_active_participant(snapshot_reviewer_id,p_org_id,p_workspace_id);
   SELECT cp.publication_id,old.snapshot_id INTO current_publication_id,current_snapshot_id FROM public.trust_current_publications cp JOIN public.trust_publication_events old ON old.id=cp.publication_id WHERE cp.org_id=p_org_id AND cp.workspace_scope=COALESCE(p_workspace_id,'00000000-0000-0000-0000-000000000000') FOR UPDATE OF cp;
   INSERT INTO public.trust_publication_events(org_id,workspace_id,snapshot_id,snapshot_hash,event_type,publisher_id,supersedes_publication_id,is_current) SELECT old.org_id,old.workspace_id,old.snapshot_id,old.snapshot_hash,'superseded',p_actor_id,old.id,false FROM public.trust_publication_events old WHERE old.id=current_publication_id;
   INSERT INTO public.trust_publication_events(org_id,workspace_id,snapshot_id,snapshot_hash,event_type,publisher_id,is_current) SELECT p_org_id,p_workspace_id,s.id,s.canonical_hash,'published',p_actor_id,false FROM public.trust_snapshots s WHERE s.id=(p_payload->>'snapshotId')::uuid RETURNING id INTO r.id;
   INSERT INTO public.trust_current_publications(org_id,workspace_scope,publication_id) VALUES(p_org_id,COALESCE(p_workspace_id,'00000000-0000-0000-0000-000000000000'),r.id) ON CONFLICT(org_id,workspace_scope) DO UPDATE SET publication_id=excluded.publication_id,updated_at=now();
   UPDATE public.trust_snapshots SET lifecycle='published',version=version+1,updated_at=now() WHERE id=(p_payload->>'snapshotId')::uuid RETURNING version INTO actual;
 ELSIF p_operation='snapshot.create' THEN
   SELECT jsonb_build_object('claims',jsonb_agg(jsonb_build_object('claimId',c.id,'claimVersionId',cv.id,'claimHash',cv.canonical_hash,'links',COALESCE((SELECT jsonb_agg(jsonb_build_object('linkId',l.id,'linkHash',l.canonical_hash,'evidenceVersionId',ev.id,'evidenceHash',ev.canonical_hash) ORDER BY l.id) FROM public.trust_claim_evidence_links l JOIN public.trust_evidence_versions ev ON ev.id=l.evidence_version_id WHERE l.claim_version_id=cv.id),'[]'::jsonb)) ORDER BY c.id)) INTO selection_value FROM public.trust_claims c JOIN public.trust_claim_versions cv ON cv.id=c.current_version_id WHERE c.id=ANY(ARRAY(SELECT jsonb_array_elements_text(p_payload->'claimIds')::uuid)) AND c.org_id=p_org_id AND c.workspace_id IS NOT DISTINCT FROM p_workspace_id AND c.lifecycle<>'withdrawn';
   IF selection_value IS NULL OR jsonb_array_length(selection_value->'claims')<>jsonb_array_length(p_payload->'claimIds') THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF; derived_hash:=public.trust_assurance_hash(selection_value);
   INSERT INTO public.trust_snapshots(org_id,workspace_id,selection,canonical_hash,creator_id) VALUES(p_org_id,p_workspace_id,selection_value,derived_hash,p_actor_id) RETURNING id,version INTO r.resource_id,actual;
 ELSIF p_operation='snapshot.review' THEN
   UPDATE public.trust_snapshots SET lifecycle=CASE WHEN p_payload->>'decision'='changes_requested' THEN 'changes_requested' ELSE 'reviewed' END,reviewed_by=p_actor_id,reviewed_hash=canonical_hash,version=version+1,updated_at=now() WHERE id=(p_payload->>'snapshotId')::uuid AND org_id=p_org_id AND workspace_id IS NOT DISTINCT FROM p_workspace_id AND creator_id<>p_actor_id AND lifecycle IN('draft','under_review','changes_requested','reviewed') AND version=p_expected_version RETURNING id,version INTO r.resource_id,actual;
   IF actual IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   PERFORM public.trust_assurance_append_review_event(p_org_id,p_workspace_id,'snapshot',s.id,s.canonical_hash,p_actor_id,p_payload->>'decision',p_payload->>'rationale',p_authorization_version) FROM public.trust_snapshots s WHERE s.id=r.resource_id;
 ELSIF p_operation='claim.create' THEN
   INSERT INTO public.trust_claims(org_id,workspace_id,owner_id,readiness_domain) VALUES(p_org_id,p_workspace_id,p_actor_id,p_payload->>'readinessDomain') RETURNING id,version INTO r.resource_id,actual;
   INSERT INTO public.trust_claim_versions(claim_id,org_id,workspace_id,version,claim_text,proposed_proof_status,proof_boundary,buyer_safe_wording,limitation_disclosure,does_not_prove,canonical_hash,created_by) VALUES(r.resource_id,p_org_id,p_workspace_id,1,p_payload->>'claimText',p_payload->>'proposedProofStatus',p_payload->>'proofBoundary',p_payload->>'buyerSafeWording',p_payload->>'limitationDisclosure',p_payload->'doesNotProve',public.trust_assurance_hash(jsonb_build_object('buyerSafeWording',p_payload->>'buyerSafeWording','claimText',p_payload->>'claimText','doesNotProve',p_payload->'doesNotProve','limitationDisclosure',p_payload->>'limitationDisclosure','proofBoundary',p_payload->>'proofBoundary','proposedProofStatus',p_payload->>'proposedProofStatus')),p_actor_id) RETURNING id INTO r.id;
   UPDATE public.trust_claims SET current_version_id=r.id WHERE id=r.resource_id;
 ELSIF p_operation='claim.revise' THEN
   UPDATE public.trust_claims SET version=version+1,lifecycle='draft',updated_at=now() WHERE id=(p_payload->>'claimId')::uuid AND org_id=p_org_id AND workspace_id IS NOT DISTINCT FROM p_workspace_id AND lifecycle<>'withdrawn' AND version=p_expected_version RETURNING id,version,current_version_id INTO r.resource_id,actual,r.id;
   IF actual IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   INSERT INTO public.trust_claim_versions(claim_id,org_id,workspace_id,version,claim_text,proposed_proof_status,proof_boundary,buyer_safe_wording,limitation_disclosure,does_not_prove,canonical_hash,created_by,supersedes_version_id) VALUES(r.resource_id,p_org_id,p_workspace_id,actual,p_payload->>'claimText',p_payload->>'proposedProofStatus',p_payload->>'proofBoundary',p_payload->>'buyerSafeWording',p_payload->>'limitationDisclosure',p_payload->'doesNotProve',public.trust_assurance_hash(jsonb_build_object('buyerSafeWording',p_payload->>'buyerSafeWording','claimText',p_payload->>'claimText','doesNotProve',p_payload->'doesNotProve','limitationDisclosure',p_payload->>'limitationDisclosure','proofBoundary',p_payload->>'proofBoundary','proposedProofStatus',p_payload->>'proposedProofStatus')),p_actor_id,r.id) RETURNING id INTO r.id;
   UPDATE public.trust_claims SET current_version_id=r.id WHERE id=r.resource_id;
 ELSIF p_operation='evidence.register' THEN
   INSERT INTO public.trust_evidence(org_id,workspace_id,owner_id,evidence_type,lifecycle) VALUES(p_org_id,p_workspace_id,p_actor_id,p_payload->>'evidenceType',CASE p_payload->>'result' WHEN 'blocked' THEN 'blocked' WHEN 'not_run' THEN 'not_run' ELSE 'active' END) RETURNING id,version INTO r.resource_id,actual;
   INSERT INTO public.trust_evidence_versions(evidence_id,org_id,workspace_id,version,reference_type,reference_value,digest,summary,evidence_boundary,result,observed_at,review_due_at,expires_at,lifecycle,canonical_hash,created_by) VALUES(r.resource_id,p_org_id,p_workspace_id,1,p_payload->>'referenceType',p_payload->>'referenceValue',p_payload->>'digest',p_payload->>'summary',p_payload->>'evidenceBoundary',p_payload->>'result',(p_payload->>'observedAt')::timestamptz,(p_payload->>'reviewDueAt')::timestamptz,(p_payload->>'expiresAt')::timestamptz,CASE p_payload->>'result' WHEN 'blocked' THEN 'blocked' WHEN 'not_run' THEN 'not_run' ELSE 'active' END,public.trust_assurance_hash(jsonb_build_object('digest',p_payload->'digest','evidenceBoundary',p_payload->>'evidenceBoundary','evidenceType',p_payload->>'evidenceType','expiresAt',p_payload->'expiresAt','observedAt',p_payload->'observedAt','referenceType',p_payload->>'referenceType','referenceValue',p_payload->>'referenceValue','result',p_payload->>'result','reviewDueAt',p_payload->'reviewDueAt','summary',p_payload->>'summary')),p_actor_id) RETURNING id INTO r.id;
   UPDATE public.trust_evidence SET current_version_id=r.id WHERE id=r.resource_id;
 ELSIF p_operation IN('evidence.supersede','evidence.withdraw') THEN
   UPDATE public.trust_evidence SET lifecycle=CASE WHEN p_operation='evidence.supersede' THEN 'superseded' ELSE 'withdrawn' END,version=version+1,updated_at=now() WHERE id=(p_payload->>'evidenceId')::uuid AND org_id=p_org_id AND workspace_id IS NOT DISTINCT FROM p_workspace_id AND lifecycle IN('active','blocked','not_run') AND version=p_expected_version RETURNING id,version INTO r.resource_id,actual;
   IF actual IS NULL THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
 ELSIF p_operation='evidence.link' THEN
   PERFORM c.id FROM public.trust_claims c WHERE c.current_version_id=(p_payload->>'claimVersionId')::uuid AND c.org_id=p_org_id AND c.workspace_id IS NOT DISTINCT FROM p_workspace_id AND c.lifecycle<>'withdrawn' ORDER BY c.id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
   PERFORM e.id FROM public.trust_evidence e WHERE e.current_version_id=(p_payload->>'evidenceVersionId')::uuid AND e.org_id=p_org_id AND e.workspace_id IS NOT DISTINCT FROM p_workspace_id AND e.lifecycle<>'withdrawn' ORDER BY e.id FOR SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_BLOCKED'; END IF;
   INSERT INTO public.trust_claim_evidence_links(org_id,workspace_id,claim_version_id,evidence_version_id,relationship,rationale,canonical_hash,created_by) VALUES(p_org_id,p_workspace_id,(p_payload->>'claimVersionId')::uuid,(p_payload->>'evidenceVersionId')::uuid,p_payload->>'relationship',p_payload->>'rationale',public.trust_assurance_hash(jsonb_build_object('claimVersionId',p_payload->>'claimVersionId','evidenceVersionId',p_payload->>'evidenceVersionId','rationale',p_payload->>'rationale','relationship',p_payload->>'relationship')),p_actor_id) RETURNING id INTO r.resource_id; actual:=1;
 ELSIF p_operation='resource.review' THEN
   IF p_payload->>'resourceType'='claim_version' THEN SELECT cv.canonical_hash INTO resource_hash FROM public.trust_claim_versions cv JOIN public.trust_claims c ON c.current_version_id=cv.id WHERE cv.id=(p_payload->>'resourceId')::uuid AND cv.org_id=p_org_id AND cv.workspace_id IS NOT DISTINCT FROM p_workspace_id AND c.lifecycle<>'withdrawn' AND cv.created_by<>p_actor_id FOR SHARE;
   ELSIF p_payload->>'resourceType'='evidence_version' THEN SELECT ev.canonical_hash INTO resource_hash FROM public.trust_evidence_versions ev JOIN public.trust_evidence e ON e.current_version_id=ev.id WHERE ev.id=(p_payload->>'resourceId')::uuid AND ev.org_id=p_org_id AND ev.workspace_id IS NOT DISTINCT FROM p_workspace_id AND e.lifecycle='active' AND ev.lifecycle='active' AND ev.result='performed' AND ev.created_by<>p_actor_id FOR SHARE; ELSE RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
   IF resource_hash IS NULL THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
   SELECT (public.trust_assurance_append_review_event(p_org_id,p_workspace_id,p_payload->>'resourceType',(p_payload->>'resourceId')::uuid,resource_hash,p_actor_id,p_payload->>'decision',p_payload->>'rationale',p_authorization_version)).id INTO r.resource_id; actual:=1;
 ELSIF p_operation='snapshot.withdraw' THEN
   SELECT cp.publication_id,pe.snapshot_id INTO current_publication_id,current_snapshot_id FROM public.trust_current_publications cp JOIN public.trust_publication_events pe ON pe.id=cp.publication_id AND pe.event_type='published' WHERE cp.org_id=p_org_id AND cp.workspace_scope=COALESCE(p_workspace_id,'00000000-0000-0000-0000-000000000000') FOR UPDATE OF cp;
   IF current_publication_id IS NULL OR current_snapshot_id IS DISTINCT FROM (p_payload->>'snapshotId')::uuid THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   SELECT s.id,s.version INTO r.resource_id,actual FROM public.trust_snapshots s WHERE s.id=current_snapshot_id AND s.org_id=p_org_id AND s.workspace_id IS NOT DISTINCT FROM p_workspace_id AND s.lifecycle='published' FOR UPDATE;
   IF actual IS NULL OR actual<>p_expected_version THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   INSERT INTO public.trust_publication_events(org_id,workspace_id,snapshot_id,snapshot_hash,event_type,publisher_id,supersedes_publication_id,is_current) SELECT p_org_id,p_workspace_id,s.id,s.canonical_hash,'withdrawn',p_actor_id,current_publication_id,false FROM public.trust_snapshots s WHERE s.id=r.resource_id;
   DELETE FROM public.trust_current_publications WHERE org_id=p_org_id AND workspace_scope=COALESCE(p_workspace_id,'00000000-0000-0000-0000-000000000000') AND publication_id=current_publication_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'VERSION_CONFLICT'; END IF;
   UPDATE public.trust_snapshots SET lifecycle='withdrawn',version=version+1,updated_at=now() WHERE id=r.resource_id RETURNING version INTO actual;
 ELSE RAISE EXCEPTION 'VALIDATION_FAILED'; END IF;
 INSERT INTO public.trust_command_receipts(org_id,workspace_id,actor_id,operation,idempotency_key,request_id,request_hash,status,http_status,response_body,resource_id,resource_version)
 VALUES(p_org_id,p_workspace_id,p_actor_id,p_operation,p_idempotency_key,p_request_id,p_request_hash,'committed',200,jsonb_build_object('ok',true,'replayed',false,'resourceId',COALESCE(r.resource_id,(p_payload->>'snapshotId')::uuid),'version',actual,'body','{}'::jsonb),COALESCE(r.resource_id,(p_payload->>'snapshotId')::uuid),actual) RETURNING * INTO r;
 INSERT INTO public.trust_audit_events(org_id,workspace_id,actor_id,action,resource_type,resource_id,resource_version,result,request_id,receipt_id) VALUES(p_org_id,p_workspace_id,p_actor_id,p_operation,split_part(p_operation,'.',1),COALESCE(r.resource_id,(p_payload->>'snapshotId')::uuid),actual,'committed',p_request_id,r.id);
 RETURN r.response_body;
END $$;
REVOKE ALL ON FUNCTION public.trust_assurance_command(uuid,uuid,uuid,text,text,uuid,text,bigint,boolean,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_command(uuid,uuid,uuid,text,text,uuid,text,bigint,boolean,bigint,jsonb) TO service_role;

CREATE FUNCTION public.trust_assurance_internal_projection(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_claims jsonb;v_evidence jsonb;v_relationships jsonb;v_snapshots jsonb;v_publication jsonb;BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'trust.read',p_authorization_version);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('claimVersionId',cv.id,'claimId',c.id,'version',cv.version,'readinessDomain',c.readiness_domain,'claimText',cv.claim_text,'buyerSafeWording',cv.buyer_safe_wording,'proposedProofStatus',cv.proposed_proof_status,'effectiveProofStatus',law.value->>'effectiveProofStatus','proofBoundary',cv.proof_boundary,'limitationDisclosure',cv.limitation_disclosure,'doesNotProve',cv.does_not_prove,'canonicalHash',cv.canonical_hash,'ownerDisplayName','Assigned owner','lifecycle',COALESCE((SELECT CASE review.decision WHEN 'changes_requested' THEN 'changes_requested' WHEN 'approved' THEN 'approved' ELSE 'reviewed' END FROM public.trust_assurance_current_review_disposition(cv.org_id,cv.workspace_id,'claim_version',cv.id,cv.canonical_hash) review),c.lifecycle),'blockedReasons',law.value->'blockedReasons') ORDER BY c.created_at),'[]'::jsonb) INTO v_claims FROM public.trust_claims c JOIN public.trust_claim_versions cv ON cv.id=c.current_version_id CROSS JOIN LATERAL public.trust_assurance_effective_claim_law(cv.id,NULL,now()) law(value) WHERE c.org_id=p_org_id AND c.workspace_id=p_workspace_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('evidenceVersionId',ev.id,'evidenceId',e.id,'version',ev.version,'evidenceType',e.evidence_type,'referenceType',ev.reference_type,'referenceValue',ev.reference_value,'summary',ev.summary,'evidenceBoundary',ev.evidence_boundary,'lifecycle',e.lifecycle,'freshness',public.trust_assurance_evidence_freshness(ev.review_due_at,ev.expires_at,now()),'observedAt',ev.observed_at,'reviewDueAt',ev.review_due_at,'expiresAt',ev.expires_at,'canonicalHash',ev.canonical_hash,'approved',EXISTS(SELECT 1 FROM public.trust_assurance_current_review_disposition(ev.org_id,ev.workspace_id,'evidence_version',ev.id,ev.canonical_hash) review WHERE review.decision IN('reviewed','approved')),'ownerDisplayName','Assigned owner') ORDER BY e.created_at),'[]'::jsonb) INTO v_evidence FROM public.trust_evidence e JOIN public.trust_evidence_versions ev ON ev.id=e.current_version_id WHERE e.org_id=p_org_id AND e.workspace_id=p_workspace_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('claimVersionId',l.claim_version_id,'evidenceVersionId',l.evidence_version_id,'relationship',l.relationship,'rationale',l.rationale) ORDER BY l.created_at),'[]'::jsonb) INTO v_relationships FROM public.trust_claim_evidence_links l WHERE l.org_id=p_org_id AND l.workspace_id=p_workspace_id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('snapshotId',s.id,'snapshotHash',s.canonical_hash,'version',s.version,'lifecycle',s.lifecycle,'createdAt',s.created_at) ORDER BY s.created_at DESC),'[]'::jsonb) INTO v_snapshots FROM public.trust_snapshots s WHERE s.org_id=p_org_id AND s.workspace_id=p_workspace_id;
 SELECT jsonb_build_object('publicationId',pe.id,'snapshotId',pe.snapshot_id,'snapshotHash',pe.snapshot_hash,'publishedAt',pe.created_at) INTO v_publication FROM public.trust_current_publications cp JOIN public.trust_publication_events pe ON pe.id=cp.publication_id WHERE cp.org_id=p_org_id AND cp.workspace_scope=p_workspace_id;
 RETURN jsonb_build_object('mode','server_authoritative','organizationId',p_org_id,'workspaceId',p_workspace_id,'authorizationVersion',p_authorization_version,'readOnly',false,'claims',v_claims,'evidence',v_evidence,'relationships',v_relationships,'reviewQueueCount',(SELECT count(*) FROM public.trust_claims c JOIN public.trust_claim_versions cv ON cv.id=c.current_version_id WHERE c.org_id=p_org_id AND c.workspace_id=p_workspace_id AND NOT EXISTS(SELECT 1 FROM public.trust_assurance_current_review_disposition(cv.org_id,cv.workspace_id,'claim_version',cv.id,cv.canonical_hash) review WHERE review.decision IN('reviewed','approved'))),'snapshotHistory',v_snapshots,'currentPublication',v_publication);
END $$;

CREATE FUNCTION public.trust_assurance_buyer_projection(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_publication public.trust_publication_events;v_snapshot public.trust_snapshots;v_claims jsonb;BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'trust.read',p_authorization_version);
 SELECT pe.* INTO v_publication FROM public.trust_current_publications cp JOIN public.trust_publication_events pe ON pe.id=cp.publication_id WHERE cp.org_id=p_org_id AND cp.workspace_scope=p_workspace_id AND pe.event_type='published';
 IF v_publication.id IS NULL THEN RETURN NULL; END IF; SELECT * INTO v_snapshot FROM public.trust_snapshots WHERE id=v_publication.snapshot_id AND lifecycle='published' AND canonical_hash=v_publication.snapshot_hash;
 IF v_snapshot.id IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_agg(jsonb_build_object('wording',cv.buyer_safe_wording,'effectiveProofStatus',law.value->>'effectiveProofStatus','proofBoundary',cv.proof_boundary,'lastReviewedAt',(SELECT review.created_at FROM public.trust_assurance_current_review_disposition(cv.org_id,cv.workspace_id,'claim_version',cv.id,cv.canonical_hash) review),'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('summary',ev.summary,'referenceType',ev.reference_type,'referenceValue',ev.reference_value,'freshness',public.trust_assurance_evidence_freshness(ev.review_due_at,ev.expires_at,now())) ORDER BY ev.id) FROM jsonb_array_elements(x->'links') selected JOIN public.trust_claim_evidence_links l ON l.id=(selected->>'linkId')::uuid AND l.canonical_hash=selected->>'linkHash' JOIN public.trust_evidence_versions ev ON ev.id=(selected->>'evidenceVersionId')::uuid AND ev.id=l.evidence_version_id AND ev.canonical_hash=selected->>'evidenceHash' JOIN public.trust_evidence e ON e.id=ev.evidence_id AND e.current_version_id=ev.id WHERE l.claim_version_id=cv.id AND l.relationship IN('supports','limits') AND e.lifecycle='active' AND ev.lifecycle='active' AND ev.result='performed' AND public.trust_assurance_evidence_freshness(ev.review_due_at,ev.expires_at,now())='current' AND EXISTS(SELECT 1 FROM public.trust_assurance_current_review_disposition(ev.org_id,ev.workspace_id,'evidence_version',ev.id,ev.canonical_hash) review WHERE review.decision IN('reviewed','approved'))),'[]'::jsonb),'limitationDisclosure',cv.limitation_disclosure,'doesNotProve',cv.does_not_prove) ORDER BY cv.id) INTO v_claims FROM jsonb_array_elements(v_snapshot.selection->'claims') x JOIN public.trust_claim_versions cv ON cv.id=(x->>'claimVersionId')::uuid CROSS JOIN LATERAL public.trust_assurance_effective_claim_law(cv.id,x->'links',now()) law(value);
 RETURN jsonb_build_object('mode','published_snapshot','publication',jsonb_build_object('publicId',v_publication.id,'snapshotHash',v_publication.snapshot_hash,'publishedAt',v_publication.created_at),'claims',COALESCE(v_claims,'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.trust_assurance_internal_projection(uuid,uuid,uuid,bigint),public.trust_assurance_buyer_projection(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.trust_assurance_internal_projection(uuid,uuid,uuid,bigint),public.trust_assurance_buyer_projection(uuid,uuid,uuid,bigint) TO service_role;
