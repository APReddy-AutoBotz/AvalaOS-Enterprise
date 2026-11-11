-- Studio governed artifacts (PR A). Structured JSON is the sole canonical rendition.
-- Rollback is mutation/provider disablement, read-only projection, and additive forward fixes.

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('studio.artifacts.read','docs','Read canonical governed Studio artifacts'),
 ('studio.artifacts.generate','docs','Request governed Studio artifact drafts'),
 ('studio.artifacts.edit','docs','Create immutable human-authored draft revisions'),
 ('studio.artifacts.review','docs','Assign and independently resolve artifact reviews'),
 ('studio.artifacts.approve','docs','Independently approve or reject reviewed artifacts')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

CREATE TABLE public.studio_artifact_runtime_control(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT true,
 read_only boolean NOT NULL DEFAULT false,provider_enabled boolean NOT NULL DEFAULT true,updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.studio_artifact_runtime_control(singleton) VALUES(true);

CREATE TABLE public.studio_system_template_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_type text NOT NULL CHECK(artifact_type IN('brd','frd','pdd')),
 template_version text NOT NULL,content_schema_version text NOT NULL,provider_instructions jsonb NOT NULL CHECK(jsonb_typeof(provider_instructions)='object'),
 template_hash text NOT NULL CHECK(template_hash~'^[0-9a-f]{64}$'),renderer_version text NOT NULL,renderer_hash text NOT NULL CHECK(renderer_hash~'^[0-9a-f]{64}$'),
 active_from timestamptz NOT NULL DEFAULT now(),superseded_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(artifact_type,template_version),CHECK(superseded_at IS NULL OR superseded_at>=active_from)
);
CREATE UNIQUE INDEX studio_one_active_template_per_type ON public.studio_system_template_versions(artifact_type) WHERE superseded_at IS NULL;

INSERT INTO public.studio_system_template_versions(artifact_type,template_version,content_schema_version,provider_instructions,template_hash,renderer_version,renderer_hash) VALUES
 ('brd','studio-brd-1','studio-artifact-1','{"artifactType":"brd","sections":["summary","objectives","scope","requirements","risks"]}',encode(public.digest('studio-brd-1','sha256'),'hex'),'studio-json-projection-1',encode(public.digest('studio-json-projection-1','sha256'),'hex')),
 ('frd','studio-frd-1','studio-artifact-1','{"artifactType":"frd","sections":["summary","functionalRequirements","rules","interfaces","acceptanceCriteria"]}',encode(public.digest('studio-frd-1','sha256'),'hex'),'studio-json-projection-1',encode(public.digest('studio-json-projection-1','sha256'),'hex')),
 ('pdd','studio-pdd-1','studio-artifact-1','{"artifactType":"pdd","sections":["summary","process","roles","controls","exceptions"]}',encode(public.digest('studio-pdd-1','sha256'),'hex'),'studio-json-projection-1',encode(public.digest('studio-json-projection-1','sha256'),'hex'));

CREATE TABLE public.studio_artifact_aggregates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,case_id uuid NOT NULL,
 source_version_id uuid NOT NULL,source_case_version bigint NOT NULL,decision_id uuid NOT NULL,decision_version text NOT NULL,
 review_resolution_id uuid NOT NULL,govern_resolution_id uuid NOT NULL,handoff_id uuid NOT NULL,source_package_hash text NOT NULL CHECK(source_package_hash~'^[0-9a-f]{64}$'),
 source_schema_version text NOT NULL,rule_set_version text NOT NULL,review_schema_version text NOT NULL,review_sequence bigint NOT NULL,
 artifact_type text NOT NULL CHECK(artifact_type IN('brd','frd','pdd')),aggregate_version bigint NOT NULL DEFAULT 0 CHECK(aggregate_version>=0),
 current_version_id uuid,current_approved_version_id uuid,lifecycle text NOT NULL DEFAULT 'draft' CHECK(lifecycle IN('draft','reviewer_ready','in_review','changes_requested','review_rejected','approval_ready','approved','approval_rejected','superseded')),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,workspace_id,handoff_id,artifact_type),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(handoff_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_studio_handoffs(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_case_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(govern_resolution_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_govern_resolutions(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(review_resolution_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_review_resolutions(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_artifact_generation_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,handoff_id uuid NOT NULL,
 requested_by uuid NOT NULL REFERENCES public.profiles(id),request_id uuid NOT NULL,provider_operation_id text,template_id uuid NOT NULL REFERENCES public.studio_system_template_versions(id),
 input_hash text NOT NULL CHECK(input_hash~'^[0-9a-f]{64}$'),state text NOT NULL CHECK(state IN('requested','generating','completed','failed')),
 failure_code text CHECK(failure_code IS NULL OR failure_code~'^[A-Z0-9_]{1,64}$'),created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz,
 UNIQUE(id,artifact_id,org_id,workspace_id),UNIQUE(org_id,requested_by,request_id),
 FOREIGN KEY(artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_artifact_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),
 parent_version_id uuid,template_id uuid NOT NULL REFERENCES public.studio_system_template_versions(id),content_schema_version text NOT NULL,renderer_version text NOT NULL,
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object' AND pg_column_size(content)<=1048576),content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
 lifecycle text NOT NULL CHECK(lifecycle IN('draft','reviewer_ready','in_review','changes_requested','review_rejected','approval_ready','approved','approval_rejected','superseded')),
 generation_attempt_id uuid,author_id uuid NOT NULL REFERENCES public.profiles(id),author_authorization_version bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(artifact_id,version),UNIQUE(id,artifact_id,org_id,workspace_id),
 FOREIGN KEY(artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(parent_version_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(generation_attempt_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_generation_attempts(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);
ALTER TABLE public.studio_artifact_aggregates ADD CONSTRAINT studio_current_version_fk FOREIGN KEY(current_version_id,id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.studio_artifact_aggregates ADD CONSTRAINT studio_current_approved_version_fk FOREIGN KEY(current_approved_version_id,id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.studio_artifact_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 command_type text NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),request_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('claimed','committed','failed')),resource_id uuid,response jsonb,failure_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(org_id,actor_id,command_type,idempotency_key)
);

CREATE TABLE public.studio_artifact_review_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL,artifact_version_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL,assigned_by uuid NOT NULL REFERENCES public.profiles(id),assigned_at timestamptz NOT NULL DEFAULT now(),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.studio_artifact_command_receipts(id),audit_event_id uuid NOT NULL,
 UNIQUE(artifact_version_id),UNIQUE(id,artifact_id,org_id,workspace_id),FOREIGN KEY(artifact_version_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE TABLE public.studio_artifact_review_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL,artifact_id uuid NOT NULL,artifact_version_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL,outcome text NOT NULL CHECK(outcome IN('approved','changes_requested','rejected')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),conditions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(conditions)='array'),resolved_at timestamptz NOT NULL DEFAULT now(),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.studio_artifact_command_receipts(id),audit_event_id uuid NOT NULL,UNIQUE(assignment_id),UNIQUE(id,artifact_id,artifact_version_id,org_id,workspace_id),
 FOREIGN KEY(assignment_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_review_assignments(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(artifact_version_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);
CREATE TABLE public.studio_artifact_approval_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),review_resolution_id uuid NOT NULL,artifact_id uuid NOT NULL,artifact_version_id uuid NOT NULL,org_id uuid NOT NULL,workspace_id uuid NOT NULL,
 approver_id uuid NOT NULL REFERENCES public.profiles(id),approver_authorization_version bigint NOT NULL,outcome text NOT NULL CHECK(outcome IN('approved','rejected')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),conditions jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(conditions)='array'),superseded_version_id uuid,resolved_at timestamptz NOT NULL DEFAULT now(),
 receipt_id uuid NOT NULL UNIQUE REFERENCES public.studio_artifact_command_receipts(id),audit_event_id uuid NOT NULL,UNIQUE(artifact_version_id),
 FOREIGN KEY(review_resolution_id,artifact_id,artifact_version_id,org_id,workspace_id) REFERENCES public.studio_artifact_review_resolutions(id,artifact_id,artifact_version_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(superseded_version_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.studio_reject_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN RAISE EXCEPTION 'STUDIO_IMMUTABLE';END$$;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['studio_system_template_versions','studio_artifact_review_assignments','studio_artifact_review_resolutions','studio_artifact_approval_resolutions'] LOOP
 EXECUTE format('CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.studio_reject_immutable()',t,t);
END LOOP;END$$;
CREATE OR REPLACE FUNCTION public.studio_version_content_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$BEGIN
 IF (to_jsonb(NEW)-'lifecycle') IS DISTINCT FROM (to_jsonb(OLD)-'lifecycle') THEN RAISE EXCEPTION 'STUDIO_IMMUTABLE';END IF;RETURN NEW;
END$$;
CREATE TRIGGER trg_studio_artifact_version_content_immutable BEFORE UPDATE OR DELETE ON public.studio_artifact_versions FOR EACH ROW EXECUTE FUNCTION public.studio_version_content_immutable();

CREATE OR REPLACE FUNCTION public.studio_artifact_projection(p_org uuid,p_workspace uuid,p_artifact uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'id',a.id,'artifactType',a.artifact_type,'aggregateVersion',a.aggregate_version,'lifecycle',a.lifecycle,
  'ancestry',jsonb_build_object('organizationId',a.org_id,'workspaceId',a.workspace_id,'caseId',a.case_id,
   'sourceCaseVersionId',a.source_version_id,'sourceCaseVersion',a.source_case_version,'decisionId',a.decision_id,
   'decisionVersion',a.decision_version,'reviewResolutionId',a.review_resolution_id,'governResolutionId',a.govern_resolution_id,
   'studioHandoffId',a.handoff_id,'sourcePackageHash',a.source_package_hash,'sourceSchemaVersion',a.source_schema_version,
   'ruleSetVersion',a.rule_set_version,'reviewSchemaVersion',a.review_schema_version,'reviewSequence',a.review_sequence),
  'currentVersion',cv.dto,'currentApprovedVersion',cav.dto,'versions',COALESCE(vs.items,'[]'::jsonb),
  'review',CASE WHEN ra.id IS NULL THEN NULL ELSE jsonb_build_object('assignmentId',ra.id,'reviewerId',ra.reviewer_id,
   'outcome',rr.outcome,'rationale',rr.rationale,'conditions',COALESCE(rr.conditions,'[]'::jsonb)) END,
  'approval',CASE WHEN ar.id IS NULL THEN NULL ELSE jsonb_build_object('approverId',ar.approver_id,'outcome',ar.outcome,
   'rationale',ar.rationale,'conditions',ar.conditions,'supersededVersionId',ar.superseded_version_id) END,
  'readOnly',NOT ctl.enabled OR ctl.read_only)
 FROM public.studio_artifact_aggregates a CROSS JOIN public.studio_artifact_runtime_control ctl
 LEFT JOIN LATERAL (SELECT jsonb_build_object('id',v.id,'version',v.version,'parentVersionId',v.parent_version_id,
  'lifecycle',v.lifecycle,'templateVersion',t.template_version,'contentSchemaVersion',v.content_schema_version,
  'projectionVersion',v.renderer_version,'content',v.content,'contentHash',v.content_hash,'authorId',v.author_id,'createdAt',v.created_at) dto
  FROM public.studio_artifact_versions v JOIN public.studio_system_template_versions t ON t.id=v.template_id
  WHERE v.id=a.current_version_id AND v.artifact_id=a.id) cv ON true
 LEFT JOIN LATERAL (SELECT jsonb_build_object('id',v.id,'version',v.version,'parentVersionId',v.parent_version_id,
  'lifecycle',v.lifecycle,'templateVersion',t.template_version,'contentSchemaVersion',v.content_schema_version,
  'projectionVersion',v.renderer_version,'content',v.content,'contentHash',v.content_hash,'authorId',v.author_id,'createdAt',v.created_at) dto
  FROM public.studio_artifact_versions v JOIN public.studio_system_template_versions t ON t.id=v.template_id
  WHERE v.id=a.current_approved_version_id AND v.artifact_id=a.id) cav ON true
 LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'parentVersionId',v.parent_version_id,
  'lifecycle',v.lifecycle,'templateVersion',t.template_version,'contentSchemaVersion',v.content_schema_version,
  'projectionVersion',v.renderer_version,'content',v.content,'contentHash',v.content_hash,'authorId',v.author_id,'createdAt',v.created_at)
  ORDER BY v.version) items FROM public.studio_artifact_versions v JOIN public.studio_system_template_versions t ON t.id=v.template_id
  WHERE v.artifact_id=a.id AND v.org_id=a.org_id AND v.workspace_id=a.workspace_id) vs ON true
 LEFT JOIN public.studio_artifact_review_assignments ra ON ra.artifact_version_id=a.current_version_id
 LEFT JOIN public.studio_artifact_review_resolutions rr ON rr.assignment_id=ra.id
 LEFT JOIN public.studio_artifact_approval_resolutions ar ON ar.artifact_version_id=a.current_version_id
 WHERE ctl.singleton AND a.id=p_artifact AND a.org_id=p_org AND a.workspace_id=p_workspace
$$;
CREATE OR REPLACE FUNCTION public.studio_read_artifact(p_org_id uuid,p_workspace_id uuid,p_artifact_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN public.has_workspace_capability(p_workspace_id,p_org_id,'studio.artifacts.read') THEN public.studio_artifact_projection(p_org_id,p_workspace_id,p_artifact_id) ELSE NULL END
$$;

CREATE OR REPLACE FUNCTION public.studio_assert_actor(p_actor uuid,p_org uuid,p_workspace uuid,p_capability text,p_authorization bigint) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_version bigint;BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,p_capability,p_authorization);
 SELECT version INTO current_version FROM public.authorization_versions WHERE org_id=p_org AND user_id=p_actor;
 IF current_version IS DISTINCT FROM p_authorization THEN RAISE EXCEPTION 'STUDIO_AUTHORIZATION_STALE';END IF;
END$$;

CREATE OR REPLACE FUNCTION public.studio_claim_receipt(p_command text,p_actor uuid,p_org uuid,p_workspace uuid,p_request uuid,p_key text,p_hash text) RETURNS public.studio_artifact_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.studio_artifact_command_receipts;BEGIN
 -- Authorization is deliberately required by each caller before receipt inspection.
 SELECT * INTO r FROM public.studio_artifact_command_receipts WHERE org_id=p_org AND actor_id=p_actor AND command_type=p_command AND idempotency_key=p_key FOR UPDATE;
 IF r.id IS NOT NULL THEN IF r.workspace_id<>p_workspace OR r.request_hash<>p_hash THEN RAISE EXCEPTION 'STUDIO_IDEMPOTENCY_CONFLICT';END IF;RETURN r;END IF;
 INSERT INTO public.studio_artifact_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status) VALUES(p_org,p_workspace,p_actor,p_command,p_key,p_request,p_hash,'claimed') RETURNING * INTO r;RETURN r;
END$$;

CREATE OR REPLACE FUNCTION public.studio_request_generation(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_handoff_id uuid,p_artifact_type text,p_expected_aggregate_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h public.assess_v2_studio_handoffs;g public.assess_v2_govern_resolutions;r public.studio_artifact_command_receipts;a public.studio_artifact_aggregates;t public.studio_system_template_versions;attempt public.studio_artifact_generation_attempts;control public.studio_artifact_runtime_control;request_hash text;audit_id uuid:=gen_random_uuid();BEGIN
 PERFORM public.studio_assert_actor(p_actor_id,p_org_id,p_workspace_id,'studio.artifacts.generate',p_authorization_version);
 request_hash:=encode(public.digest(concat_ws('|','studio.artifact.generation.request',p_handoff_id,p_artifact_type,p_expected_aggregate_version),'sha256'),'hex');
 r:=public.studio_claim_receipt('studio.artifact.generation.request',p_actor_id,p_org_id,p_workspace_id,p_request_id,p_idempotency_key,request_hash);
 IF r.status='committed' THEN RETURN jsonb_build_object('ok',true,'outcome','replayed','receiptId',r.id,'resourceId',r.resource_id,'resource',r.response);END IF;
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;IF NOT control.enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;IF control.read_only OR NOT control.provider_enabled THEN RAISE EXCEPTION 'STUDIO_READ_ONLY';END IF;
 SELECT * INTO h FROM public.assess_v2_studio_handoffs WHERE id=p_handoff_id AND org_id=p_org_id AND workspace_id=p_workspace_id FOR SHARE;
 SELECT * INTO g FROM public.assess_v2_govern_resolutions WHERE id=h.govern_resolution_id AND case_id=h.case_id AND decision_id=h.decision_id AND org_id=h.org_id AND workspace_id=h.workspace_id FOR SHARE;
 IF h.id IS NULL OR g.id IS NULL OR h.review_resolution_id<>g.review_resolution_id OR encode(public.digest(convert_to(h.package::text,'UTF8'),'sha256'),'hex')<>h.package_hash THEN RAISE EXCEPTION 'STUDIO_NOT_FOUND';END IF;
 SELECT * INTO t FROM public.studio_system_template_versions WHERE artifact_type=p_artifact_type AND superseded_at IS NULL FOR SHARE;IF t.id IS NULL THEN RAISE EXCEPTION 'STUDIO_INVALID_COMMAND';END IF;
 INSERT INTO public.studio_artifact_aggregates(org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,decision_version,review_resolution_id,govern_resolution_id,handoff_id,source_package_hash,source_schema_version,rule_set_version,review_schema_version,review_sequence,artifact_type,created_by)
 VALUES(h.org_id,h.workspace_id,h.case_id,h.source_version_id,h.source_case_version,h.decision_id,h.decision_version,h.review_resolution_id,h.govern_resolution_id,h.id,h.package_hash,h.schema_version,h.rule_set_version,h.review_schema_version,h.review_sequence,p_artifact_type,p_actor_id)
 ON CONFLICT(org_id,workspace_id,handoff_id,artifact_type) DO NOTHING;
 SELECT * INTO a FROM public.studio_artifact_aggregates WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND handoff_id=p_handoff_id AND artifact_type=p_artifact_type FOR UPDATE;
 IF a.aggregate_version IS DISTINCT FROM p_expected_aggregate_version OR a.lifecycle IN('reviewer_ready','in_review','approval_ready') THEN RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT';END IF;
 INSERT INTO public.studio_artifact_generation_attempts(artifact_id,org_id,workspace_id,handoff_id,requested_by,request_id,template_id,input_hash,state) VALUES(a.id,a.org_id,a.workspace_id,a.handoff_id,p_actor_id,p_request_id,t.id,encode(public.digest(h.package_hash||t.template_hash,'sha256'),'hex'),'requested') RETURNING * INTO attempt;
 UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,updated_at=now() WHERE id=a.id RETURNING * INTO a;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata) VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,'studio.artifact.generation.request','studio_artifact',a.id,'succeeded',a.aggregate_version,jsonb_build_object('attemptId',attempt.id,'receiptId',r.id,'templateId',t.id));
 UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=a.id,response=jsonb_build_object('artifactId',a.id,'attemptId',attempt.id,'state','requested'),completed_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'outcome','committed','receiptId',r.id,'resourceId',a.id,'resource',jsonb_build_object('attemptId',attempt.id,'artifactId',a.id,'state','requested'));
END$$;

CREATE OR REPLACE FUNCTION public.studio_complete_generation(p_attempt_id uuid,p_provider_operation_id text,p_content jsonb,p_failure_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x public.studio_artifact_generation_attempts; a public.studio_artifact_aggregates;t public.studio_system_template_versions;
 v public.studio_artifact_versions; next_version bigint; safe_code text; audit_id uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO x FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE='RESOURCE_NOT_AVAILABLE'; END IF;
 IF x.state IN ('completed','failed') THEN RETURN jsonb_build_object('ok',true,'outcome','replayed','resourceId',x.artifact_id,'resource',jsonb_build_object('attemptId',x.id,'state',x.state,'failureCode',x.failure_code)); END IF;
 IF x.state IS DISTINCT FROM 'generating' THEN RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT'; END IF;
 SELECT * INTO a FROM public.studio_artifact_aggregates WHERE id=x.artifact_id AND org_id=x.org_id AND workspace_id=x.workspace_id FOR UPDATE;
 IF p_failure_code IS NOT NULL THEN
  safe_code:=CASE WHEN p_failure_code IN ('PROVIDER_GOVERNANCE_BLOCKED','PROVIDER_REQUEST_FAILED','PROVIDER_OUTPUT_INVALID','PROVIDER_OUTPUT_OVERSIZED','GENERATION_COMPLETION_CONFLICT','GENERATION_START_CONFLICT') THEN p_failure_code ELSE 'GENERATION_FAILED' END;
  INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
   VALUES(audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,'studio.artifact.generation.fail','studio_generation_attempt',x.id,'failed',a.aggregate_version,jsonb_build_object('attemptId',x.id,'failureCode',safe_code));
  UPDATE public.studio_artifact_generation_attempts SET state='failed',failure_code=safe_code,provider_operation_id=left(p_provider_operation_id,200),completed_at=now() WHERE id=x.id;
  RETURN jsonb_build_object('ok',true,'outcome','generation_failed','resourceId',a.id,'resource',jsonb_build_object('attemptId',x.id,'state','failed','failureCode',safe_code));
 END IF;
 IF jsonb_typeof(p_content) IS DISTINCT FROM 'object' OR pg_column_size(p_content)>1048576 OR jsonb_typeof(p_content->'title') IS DISTINCT FROM 'string' OR jsonb_typeof(p_content->'sections') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING MESSAGE='INVALID_COMMAND'; END IF;
 SELECT * INTO t FROM public.studio_system_template_versions WHERE id=x.template_id;
 next_version:=COALESCE((SELECT max(version) FROM public.studio_artifact_versions WHERE artifact_id=a.id),0)+1;
 INSERT INTO public.studio_artifact_versions(artifact_id,org_id,workspace_id,version,parent_version_id,template_id,content_schema_version,renderer_version,content,content_hash,lifecycle,generation_attempt_id,author_id,author_authorization_version)
 VALUES(a.id,a.org_id,a.workspace_id,next_version,a.current_version_id,t.id,t.content_schema_version,t.renderer_version,p_content,encode(public.digest(convert_to(p_content::text,'UTF8'),'sha256'),'hex'),'draft',x.id,x.requested_by,(SELECT version FROM public.authorization_versions WHERE org_id=a.org_id AND user_id=x.requested_by)) RETURNING * INTO v;
 UPDATE public.studio_artifact_aggregates SET current_version_id=v.id,aggregate_version=aggregate_version+1,lifecycle='draft',updated_at=now() WHERE id=a.id;
 UPDATE public.studio_artifact_generation_attempts SET state='completed',provider_operation_id=left(p_provider_operation_id,200),completed_at=now() WHERE id=x.id;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,'studio.artifact.generation.complete','studio_artifact',a.id,'succeeded',a.aggregate_version+1,jsonb_build_object('attemptId',x.id,'versionId',v.id));
 RETURN jsonb_build_object('ok',true,'outcome','generation_completed','resourceId',a.id,'resource',public.studio_artifact_projection(a.org_id,a.workspace_id,a.id));
END$$;

-- One transactional human command boundary. Only exact current rows are actionable.
CREATE OR REPLACE FUNCTION public.studio_artifact_command(p_command text,p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_artifact_id uuid,p_expected_aggregate_version bigint,p_expected_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE capability text;request_hash text;r public.studio_artifact_command_receipts;a public.studio_artifact_aggregates;v public.studio_artifact_versions;parent public.studio_artifact_versions;assignment public.studio_artifact_review_assignments;review public.studio_artifact_review_resolutions;prior uuid;new_version bigint;target_actor uuid;audit_id uuid:=gen_random_uuid();result jsonb;BEGIN
 capability:=CASE p_command WHEN 'studio.artifact.draft.revise' THEN 'studio.artifacts.edit' WHEN 'studio.artifact.review.submit' THEN 'studio.artifacts.edit' WHEN 'studio.artifact.review.assign' THEN 'studio.artifacts.review' WHEN 'studio.artifact.review.resolve' THEN 'studio.artifacts.review' WHEN 'studio.artifact.approval.resolve' THEN 'studio.artifacts.approve' ELSE 'invalid' END;
 PERFORM public.studio_assert_actor(p_actor_id,p_org_id,p_workspace_id,capability,p_authorization_version);
 request_hash:=encode(public.digest(concat_ws('|',p_command,p_artifact_id,p_expected_aggregate_version,p_expected_version,p_payload::text),'sha256'),'hex');r:=public.studio_claim_receipt(p_command,p_actor_id,p_org_id,p_workspace_id,p_request_id,p_idempotency_key,request_hash);IF r.status='committed' THEN RETURN jsonb_build_object('ok',true,'outcome','replayed','receiptId',r.id,'resourceId',r.resource_id,'resource',r.response);END IF;
 IF NOT (SELECT enabled AND NOT read_only FROM public.studio_artifact_runtime_control WHERE singleton) THEN RAISE EXCEPTION 'STUDIO_READ_ONLY';END IF;
 SELECT * INTO a FROM public.studio_artifact_aggregates WHERE id=p_artifact_id AND org_id=p_org_id AND workspace_id=p_workspace_id FOR UPDATE;SELECT * INTO v FROM public.studio_artifact_versions WHERE id=a.current_version_id AND artifact_id=a.id FOR UPDATE;
 IF a.id IS NULL THEN RAISE EXCEPTION USING MESSAGE='RESOURCE_NOT_AVAILABLE';END IF; IF p_expected_version IS NULL OR a.aggregate_version IS DISTINCT FROM p_expected_aggregate_version OR v.version IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT';END IF; IF (p_payload->>'artifactId')::uuid IS DISTINCT FROM a.id THEN RAISE EXCEPTION USING MESSAGE='RESOURCE_NOT_AVAILABLE'; END IF; IF p_command='studio.artifact.draft.revise' THEN IF (p_payload->>'parentVersionId')::uuid IS DISTINCT FROM v.id THEN RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT'; END IF; ELSIF (p_payload->>'artifactVersionId')::uuid IS DISTINCT FROM v.id THEN RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT'; END IF;
 IF p_command='studio.artifact.draft.revise' THEN
  IF v.lifecycle NOT IN('draft','changes_requested','review_rejected','approval_rejected','approved') OR jsonb_typeof(p_payload->'content')<>'object' OR pg_column_size(p_payload->'content')>1048576 THEN RAISE EXCEPTION 'STUDIO_INVALID_COMMAND';END IF;
  new_version:=v.version+1;INSERT INTO public.studio_artifact_versions(artifact_id,org_id,workspace_id,version,parent_version_id,template_id,content_schema_version,renderer_version,content,content_hash,lifecycle,author_id,author_authorization_version) VALUES(a.id,a.org_id,a.workspace_id,new_version,v.id,v.template_id,v.content_schema_version,v.renderer_version,p_payload->'content',encode(public.digest(convert_to((p_payload->'content')::text,'UTF8'),'sha256'),'hex'),'draft',p_actor_id,p_authorization_version) RETURNING * INTO v;UPDATE public.studio_artifact_aggregates SET current_version_id=v.id,aggregate_version=aggregate_version+1,lifecycle='draft',updated_at=now() WHERE id=a.id;
 ELSIF p_command='studio.artifact.review.submit' THEN IF v.lifecycle<>'draft' OR v.author_id<>p_actor_id THEN RAISE EXCEPTION 'STUDIO_INVALID_COMMAND';END IF;UPDATE public.studio_artifact_versions SET lifecycle='reviewer_ready' WHERE id=v.id;UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,lifecycle='reviewer_ready',updated_at=now() WHERE id=a.id;
 ELSIF p_command='studio.artifact.review.assign' THEN target_actor:=(p_payload->>'reviewerId')::uuid;IF v.lifecycle<>'reviewer_ready' OR (target_actor=v.author_id OR target_actor=a.created_by) THEN RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';END IF;PERFORM public.studio_assert_actor(target_actor,p_org_id,p_workspace_id,'studio.artifacts.review',(p_payload->>'reviewerAuthorizationVersion')::bigint);INSERT INTO public.studio_artifact_review_assignments(artifact_id,artifact_version_id,org_id,workspace_id,reviewer_id,reviewer_authorization_version,assigned_by,receipt_id,audit_event_id) VALUES(a.id,v.id,a.org_id,a.workspace_id,target_actor,(p_payload->>'reviewerAuthorizationVersion')::bigint,p_actor_id,r.id,audit_id) RETURNING * INTO assignment;UPDATE public.studio_artifact_versions SET lifecycle='in_review' WHERE id=v.id;UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,lifecycle='in_review',updated_at=now() WHERE id=a.id;
 ELSIF p_command='studio.artifact.review.resolve' THEN SELECT * INTO assignment FROM public.studio_artifact_review_assignments WHERE artifact_version_id=v.id;IF v.lifecycle<>'in_review' OR assignment.reviewer_id<>p_actor_id THEN RAISE EXCEPTION 'STUDIO_INVALID_COMMAND';END IF;INSERT INTO public.studio_artifact_review_resolutions(assignment_id,artifact_id,artifact_version_id,org_id,workspace_id,reviewer_id,reviewer_authorization_version,outcome,rationale,conditions,receipt_id,audit_event_id) VALUES(assignment.id,a.id,v.id,a.org_id,a.workspace_id,p_actor_id,p_authorization_version,CASE p_payload->>'outcome' WHEN 'approve' THEN 'approved' WHEN 'reject' THEN 'rejected' ELSE 'changes_requested' END,p_payload->>'rationale',p_payload->'conditions',r.id,audit_id) RETURNING * INTO review;UPDATE public.studio_artifact_versions SET lifecycle=CASE review.outcome WHEN 'approved' THEN 'approval_ready' WHEN 'changes_requested' THEN 'changes_requested' ELSE 'review_rejected' END WHERE id=v.id;UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,lifecycle=CASE review.outcome WHEN 'approved' THEN 'approval_ready' WHEN 'changes_requested' THEN 'changes_requested' ELSE 'review_rejected' END,updated_at=now() WHERE id=a.id;
 ELSE SELECT rr.* INTO review FROM public.studio_artifact_review_resolutions rr WHERE rr.artifact_version_id=v.id;SELECT * INTO assignment FROM public.studio_artifact_review_assignments WHERE id=review.assignment_id;IF v.lifecycle<>'approval_ready' OR v.author_id=p_actor_id OR a.created_by=p_actor_id OR assignment.reviewer_id=p_actor_id THEN RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';END IF;prior:=a.current_approved_version_id;INSERT INTO public.studio_artifact_approval_resolutions(review_resolution_id,artifact_id,artifact_version_id,org_id,workspace_id,approver_id,approver_authorization_version,outcome,rationale,conditions,superseded_version_id,receipt_id,audit_event_id) VALUES(review.id,a.id,v.id,a.org_id,a.workspace_id,p_actor_id,p_authorization_version,CASE p_payload->>'outcome' WHEN 'approve' THEN 'approved' ELSE 'rejected' END,p_payload->>'rationale',p_payload->'conditions',CASE WHEN p_payload->>'outcome'='approve' THEN prior END,r.id,audit_id);IF p_payload->>'outcome'='approve' THEN IF prior IS NOT NULL THEN UPDATE public.studio_artifact_versions SET lifecycle='superseded' WHERE id=prior;END IF;UPDATE public.studio_artifact_versions SET lifecycle='approved' WHERE id=v.id;UPDATE public.studio_artifact_aggregates SET current_approved_version_id=v.id,aggregate_version=aggregate_version+1,lifecycle='approved',updated_at=now() WHERE id=a.id;ELSE UPDATE public.studio_artifact_versions SET lifecycle='approval_rejected' WHERE id=v.id;UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,lifecycle='approval_rejected',updated_at=now() WHERE id=a.id;END IF;
 END IF;
 result:=public.studio_artifact_projection(p_org_id,p_workspace_id,a.id);INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata) VALUES(audit_id,p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command,'studio_artifact',a.id,'succeeded',a.aggregate_version+1,jsonb_build_object('receiptId',r.id,'versionId',v.id));UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=a.id,response=result,completed_at=now() WHERE id=r.id;RETURN jsonb_build_object('ok',true,'outcome','committed','receiptId',r.id,'resourceId',a.id,'resource',result);
END$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_authority(p_actor_id uuid,p_organization_id uuid,p_workspace_id uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('actorId',p_actor_id,'authorizationVersion',av.version,'capabilities',COALESCE((SELECT jsonb_agg(c.capability_key ORDER BY c.capability_key) FROM public.capabilities c WHERE c.capability_key LIKE 'studio.artifacts.%' AND public.pr1e_actor_has_workspace_capability(p_actor_id,p_organization_id,p_workspace_id,c.capability_key)),'[]'))
 FROM public.authorization_versions av WHERE av.org_id=p_organization_id AND av.user_id=p_actor_id AND public.pr1e_actor_has_workspace_capability(p_actor_id,p_organization_id,p_workspace_id,'studio.artifacts.read')
$$;
CREATE OR REPLACE FUNCTION public.studio_artifact_handoffs(p_org_id uuid,p_workspace_id uuid) RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',h.id,'caseId',h.case_id,'label',COALESCE(h.package#>>'{process,name}','Accepted Studio source'),'sourcePackageHash',h.package_hash) FROM public.assess_v2_studio_handoffs h
 JOIN public.assess_v2_govern_resolutions g ON g.id=h.govern_resolution_id AND g.review_resolution_id=h.review_resolution_id AND g.case_id=h.case_id AND g.decision_id=h.decision_id AND g.org_id=h.org_id AND g.workspace_id=h.workspace_id
 WHERE h.org_id=p_org_id AND h.workspace_id=p_workspace_id AND public.has_workspace_capability(p_workspace_id,p_org_id,'studio.artifacts.read') ORDER BY h.handed_off_at DESC,h.id
$$;
CREATE OR REPLACE FUNCTION public.studio_artifact_projection(p_org_id uuid,p_workspace_id uuid,p_handoff_id uuid,p_artifact_type text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.studio_artifact_projection(p_org_id,p_workspace_id,a.id) FROM public.studio_artifact_aggregates a WHERE a.org_id=p_org_id AND a.workspace_id=p_workspace_id AND a.handoff_id=p_handoff_id AND a.artifact_type=p_artifact_type AND public.has_workspace_capability(p_workspace_id,p_org_id,'studio.artifacts.read')
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_start(p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE x public.studio_artifact_generation_attempts; audit_id uuid:=gen_random_uuid(); BEGIN
 SELECT * INTO x FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF x.id IS NULL THEN RAISE EXCEPTION USING MESSAGE='RESOURCE_NOT_AVAILABLE'; END IF;
 IF x.state='generating' THEN RETURN jsonb_build_object('ok',true,'outcome','replayed','resourceId',x.artifact_id,'resource',jsonb_build_object('attemptId',x.id,'state',x.state)); END IF;
 IF x.state IS DISTINCT FROM 'requested' THEN RAISE EXCEPTION USING MESSAGE='VERSION_CONFLICT'; END IF;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,x.org_id,x.workspace_id,x.requested_by,x.request_id,'studio.artifact.generation.start','studio_generation_attempt',x.id,'succeeded',1,jsonb_build_object('attemptId',x.id));
 UPDATE public.studio_artifact_generation_attempts SET state='generating',started_at=now() WHERE id=x.id;
 RETURN jsonb_build_object('ok',true,'outcome','committed','resourceId',x.artifact_id,'resource',jsonb_build_object('attemptId',x.id,'state','generating'));
END$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_eligible_reviewers(p_org_id uuid,p_workspace_id uuid,p_artifact_id uuid,p_artifact_version_id uuid)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('actorId',p.id,'displayName',COALESCE(NULLIF(btrim(p.email),''),p.id::text))
 FROM public.studio_artifact_aggregates a
 JOIN public.studio_artifact_versions v ON v.id=p_artifact_version_id AND v.artifact_id=a.id AND v.org_id=a.org_id AND v.workspace_id=a.workspace_id
 JOIN public.profiles p ON p.id<>a.created_by AND p.id<>v.author_id
 WHERE a.id=p_artifact_id AND a.org_id=p_org_id AND a.workspace_id=p_workspace_id
  AND a.current_version_id=v.id AND v.lifecycle='reviewer_ready'
  AND public.has_workspace_capability(p_workspace_id,p_org_id,'studio.artifacts.review')
  AND p.status='active' AND p.deleted_at IS NULL
  AND public.pr1e_actor_has_workspace_capability(p.id,p_org_id,p_workspace_id,'studio.artifacts.review')
 ORDER BY COALESCE(NULLIF(btrim(p.email),''),p.id::text),p.id
$$;
CREATE OR REPLACE FUNCTION public.studio_artifact_command_claim(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; receipt uuid; resource uuid; attempt public.studio_artifact_generation_attempts;
 a public.studio_artifact_aggregates; h public.assess_v2_studio_handoffs; t public.studio_system_template_versions; reviewer_auth bigint; BEGIN
 IF p_command->>'commandType'='studio.artifact.generation.request' THEN
  IF p_command->'expectedArtifactVersion' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION USING MESSAGE='INVALID_COMMAND'; END IF;
  result:=public.studio_request_generation((p_command->>'actorId')::uuid,(p_command->>'organizationId')::uuid,(p_command->>'workspaceId')::uuid,(p_command#>>'{payload,studioHandoffId}')::uuid,p_command#>>'{payload,artifactType}',(p_command->>'expectedAggregateVersion')::bigint,(p_command->>'requestId')::uuid,p_command->>'idempotencyKey',(p_command->>'authorizationVersion')::bigint);
  resource:=(result->>'resourceId')::uuid;
  IF result->>'outcome'='replayed' THEN RETURN result-'ok'; END IF;
  SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=(result#>>'{resource,attemptId}')::uuid;
  SELECT * INTO a FROM public.studio_artifact_aggregates WHERE id=resource;
  SELECT * INTO h FROM public.assess_v2_studio_handoffs WHERE id=a.handoff_id;
  SELECT * INTO t FROM public.studio_system_template_versions WHERE id=attempt.template_id;
  RETURN (result-'ok')||jsonb_build_object('generationClaim',jsonb_build_object(
   'attemptId',attempt.id,'artifactId',a.id,'organizationId',a.org_id,'workspaceId',a.workspace_id,
   'actorId',attempt.requested_by,'requestId',attempt.request_id,'sourcePackage',h.package,
   'sourcePackageHash',h.package_hash,'artifactType',a.artifact_type,'templateVersion',t.template_version,
   'templatePayload',t.provider_instructions::text,'templateHash',t.template_hash,
   'contentSchemaVersion',t.content_schema_version,'projectionVersion',t.renderer_version));
 END IF;
 IF p_command->'expectedArtifactVersion' IS NULL OR jsonb_typeof(p_command->'expectedArtifactVersion')<>'number' OR (p_command->>'expectedArtifactVersion')::bigint<1 THEN RAISE EXCEPTION USING MESSAGE='INVALID_COMMAND'; END IF;
 IF p_command->>'commandType'='studio.artifact.review.assign' THEN
  SELECT version INTO reviewer_auth FROM public.authorization_versions WHERE org_id=(p_command->>'organizationId')::uuid AND user_id=(p_command#>>'{payload,reviewerId}')::uuid;
  IF reviewer_auth IS NULL THEN RAISE EXCEPTION USING MESSAGE='RESOURCE_NOT_AVAILABLE'; END IF;
  p_command:=jsonb_set(p_command,'{payload,reviewerAuthorizationVersion}',to_jsonb(reviewer_auth));
 END IF;
 resource:=(p_command#>>'{payload,artifactId}')::uuid;
 result:=public.studio_artifact_command(p_command->>'commandType',(p_command->>'actorId')::uuid,(p_command->>'organizationId')::uuid,(p_command->>'workspaceId')::uuid,resource,(p_command->>'expectedAggregateVersion')::bigint,(p_command->>'expectedArtifactVersion')::bigint,(p_command->>'requestId')::uuid,p_command->>'idempotencyKey',(p_command->>'authorizationVersion')::bigint,p_command->'payload');
 SELECT id INTO receipt FROM public.studio_artifact_command_receipts WHERE org_id=(p_command->>'organizationId')::uuid AND actor_id=(p_command->>'actorId')::uuid AND command_type=p_command->>'commandType' AND idempotency_key=p_command->>'idempotencyKey';
 RETURN jsonb_build_object('outcome',result->>'outcome','receiptId',receipt,'resourceId',resource,'resource',result->'resource');
END$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_complete(p_attempt_id uuid,p_content jsonb,p_provider_operation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.studio_complete_generation(p_attempt_id,p_provider_operation_id,p_content,NULL)
$$;
CREATE OR REPLACE FUNCTION public.studio_artifact_generation_fail(p_attempt_id uuid,p_failure_code text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.studio_complete_generation(p_attempt_id,NULL,NULL,p_failure_code)
$$;

DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['studio_artifact_runtime_control','studio_system_template_versions','studio_artifact_aggregates','studio_artifact_generation_attempts','studio_artifact_versions','studio_artifact_command_receipts','studio_artifact_review_assignments','studio_artifact_review_resolutions','studio_artifact_approval_resolutions'] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);END LOOP;END$$;
CREATE POLICY studio_artifacts_read ON public.studio_artifact_aggregates FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'studio.artifacts.read'));
CREATE POLICY studio_versions_read ON public.studio_artifact_versions FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'studio.artifacts.read'));
GRANT SELECT ON TABLE public.studio_artifact_aggregates,public.studio_artifact_versions TO authenticated;

COMMENT ON TABLE public.document_generations IS 'Legacy/unverified only: not accepted PR 1E ancestry or canonical Studio authority; enterprise paths must not write, review, approve, export, or deliver these rows.';


CREATE UNIQUE INDEX studio_one_active_generation_attempt
 ON public.studio_artifact_generation_attempts(artifact_id)
 WHERE state IN ('requested','generating');

CREATE OR REPLACE FUNCTION public.studio_conditions_valid(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(value)='array' AND jsonb_array_length(value)<=20
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) item
   WHERE jsonb_typeof(item)<>'string' OR length(btrim(item#>>'{}')) NOT BETWEEN 1 AND 500)
$$;
ALTER TABLE public.studio_artifact_review_resolutions
 ADD CONSTRAINT studio_review_conditions_bounded CHECK(public.studio_conditions_valid(conditions));
ALTER TABLE public.studio_artifact_approval_resolutions
 ADD CONSTRAINT studio_approval_conditions_bounded CHECK(public.studio_conditions_valid(conditions));


-- Final ACL authority. No Studio function is executable through PostgreSQL's
-- default PUBLIC grant; only the explicitly listed projections and private
-- service entry points are exposed.
REVOKE ALL ON FUNCTION
 public.studio_reject_immutable(),public.studio_version_content_immutable(),
 public.studio_artifact_projection(uuid,uuid,uuid),public.studio_assert_actor(uuid,uuid,uuid,text,bigint),
 public.studio_claim_receipt(text,uuid,uuid,uuid,uuid,text,text),
 public.studio_request_generation(uuid,uuid,uuid,uuid,text,bigint,uuid,text,bigint),
 public.studio_complete_generation(uuid,text,jsonb,text),
 public.studio_artifact_command(text,uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,bigint,jsonb),
 public.studio_conditions_valid(jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 public.studio_read_artifact(uuid,uuid,uuid),public.studio_artifact_handoffs(uuid,uuid),
 public.studio_artifact_projection(uuid,uuid,uuid,text),public.studio_artifact_eligible_reviewers(uuid,uuid,uuid,uuid),
 public.studio_artifact_authority(uuid,uuid,uuid),public.studio_artifact_command_claim(jsonb),
 public.studio_artifact_generation_start(uuid),public.studio_artifact_generation_complete(uuid,jsonb,text),
 public.studio_artifact_generation_fail(uuid,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.studio_read_artifact(uuid,uuid,uuid),public.studio_artifact_handoffs(uuid,uuid),
 public.studio_artifact_projection(uuid,uuid,uuid,text),public.studio_artifact_eligible_reviewers(uuid,uuid,uuid,uuid)
 TO authenticated;
GRANT EXECUTE ON FUNCTION
 public.studio_artifact_authority(uuid,uuid,uuid),public.studio_artifact_command_claim(jsonb),
 public.studio_artifact_generation_start(uuid),public.studio_artifact_generation_complete(uuid,jsonb,text),
 public.studio_artifact_generation_fail(uuid,text)
 TO service_role;
