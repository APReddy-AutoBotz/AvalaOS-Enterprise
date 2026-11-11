-- PR 1B: server-authoritative identity, normalized RBAC, workspace-complete
-- Assess lineage, permission-aware RLS, and atomic command/audit persistence.
-- Additive and forward-fix only. No score formula or score threshold is defined here.

CREATE TABLE IF NOT EXISTS public.capabilities (
    capability_key text PRIMARY KEY,
    module text NOT NULL,
    description text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pr1b_capability_key_check CHECK (capability_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

INSERT INTO public.capabilities (capability_key, module, description) VALUES
    ('assess.read', 'assess', 'Read workspace-scoped Assess records'),
    ('assess.create', 'assess', 'Create workspace-scoped assessments'),
    ('assess.response.write', 'assess', 'Persist assessment responses'),
    ('assess.finalize', 'assess', 'Persist deterministic finalized scores'),
    ('assess.audit.read', 'assess', 'Read workspace-scoped Assess audit events')
ON CONFLICT (capability_key) DO UPDATE
SET module = EXCLUDED.module, description = EXCLUDED.description;

CREATE TABLE IF NOT EXISTS public.role_capabilities (
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    capability_key text NOT NULL REFERENCES public.capabilities(capability_key) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, capability_key)
);

CREATE TABLE IF NOT EXISTS public.authorization_versions (
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (org_id, user_id)
);

-- The legacy schema allowed nullable role references and did not constrain role
-- scope across membership tables.  Fail the upgrade before installing stricter
-- triggers rather than leaving pre-existing authority under weaker rules.  A
-- roleless workspace membership remains supported: it grants workspace presence
-- only, while capabilities may still be inherited from the organization role.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.organization_members om
        LEFT JOIN public.roles r ON r.id = om.role_id
        WHERE om.role_id IS NULL
           OR r.id IS NULL
           OR r.status <> 'active'
           OR r.deleted_at IS NOT NULL
           OR r.org_id IS DISTINCT FROM om.org_id
           OR r.scope <> 'organization'
           OR r.workspace_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'PR1B_PREFLIGHT_ORGANIZATION_MEMBERSHIP_ROLE_INVALID';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.workspace_memberships wm
        JOIN public.roles r ON r.id = wm.role_id
        WHERE wm.role_id IS NOT NULL
          AND (r.status <> 'active'
            OR r.deleted_at IS NOT NULL
            OR r.org_id IS DISTINCT FROM wm.org_id
            OR r.scope <> 'workspace'
            OR r.workspace_id IS DISTINCT FROM wm.workspace_id)
    ) OR EXISTS (
        SELECT 1
        FROM public.workspace_memberships wm
        LEFT JOIN public.roles r ON r.id = wm.role_id
        WHERE wm.role_id IS NOT NULL AND r.id IS NULL
    ) THEN
        RAISE EXCEPTION 'PR1B_PREFLIGHT_WORKSPACE_MEMBERSHIP_ROLE_INVALID';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pr1b_enforce_membership_role_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_role public.roles;
BEGIN
    IF TG_TABLE_NAME = 'workspace_memberships' AND NEW.role_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT * INTO v_role FROM public.roles WHERE id = NEW.role_id FOR SHARE;
    IF v_role.id IS NULL OR v_role.status <> 'active' OR v_role.deleted_at IS NOT NULL
       OR v_role.org_id IS DISTINCT FROM NEW.org_id THEN
        RAISE EXCEPTION 'PR1B_MEMBERSHIP_ROLE_SCOPE_INVALID';
    END IF;
    IF TG_TABLE_NAME = 'organization_members' AND
       (v_role.scope <> 'organization' OR v_role.workspace_id IS NOT NULL) THEN
        RAISE EXCEPTION 'PR1B_MEMBERSHIP_ROLE_SCOPE_INVALID';
    END IF;
    IF TG_TABLE_NAME = 'workspace_memberships' AND
       (v_role.scope <> 'workspace' OR v_role.workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
        RAISE EXCEPTION 'PR1B_MEMBERSHIP_ROLE_SCOPE_INVALID';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1b_org_membership_role_scope ON public.organization_members;
CREATE TRIGGER trg_pr1b_org_membership_role_scope
BEFORE INSERT OR UPDATE OF org_id, role_id ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.pr1b_enforce_membership_role_scope();
DROP TRIGGER IF EXISTS trg_pr1b_workspace_membership_role_scope ON public.workspace_memberships;
CREATE TRIGGER trg_pr1b_workspace_membership_role_scope
BEFORE INSERT OR UPDATE OF org_id, workspace_id, role_id ON public.workspace_memberships
FOR EACH ROW EXECUTE FUNCTION public.pr1b_enforce_membership_role_scope();

-- Membership provenance is a two-sided invariant.  Membership writes lock and
-- validate the referenced role above; role structural writes lock the role row
-- and must remain compatible with every existing reference below.  Status and
-- soft-deletion changes intentionally remain available for immediate revocation.
CREATE OR REPLACE FUNCTION public.pr1b_enforce_referenced_role_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.organization_members om
        WHERE om.role_id = NEW.id
          AND (NEW.scope <> 'organization'
            OR NEW.org_id IS DISTINCT FROM om.org_id
            OR NEW.workspace_id IS NOT NULL)
    ) OR EXISTS (
        SELECT 1 FROM public.workspace_memberships wm
        WHERE wm.role_id = NEW.id
          AND (NEW.scope <> 'workspace'
            OR NEW.org_id IS DISTINCT FROM wm.org_id
            OR NEW.workspace_id IS DISTINCT FROM wm.workspace_id)
    ) THEN
        RAISE EXCEPTION 'PR1B_REFERENCED_ROLE_SCOPE_INVALID';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1b_referenced_role_scope ON public.roles;
CREATE TRIGGER trg_pr1b_referenced_role_scope
BEFORE UPDATE OF org_id, scope, workspace_id ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.pr1b_enforce_referenced_role_scope();

INSERT INTO public.authorization_versions (org_id, user_id)
SELECT om.org_id, om.user_id
FROM public.organization_members om
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Existing JSON permissions are upgrade input only. Unknown permissions fail the
-- join and are not invented as capabilities.
INSERT INTO public.role_capabilities (role_id, capability_key)
SELECT r.id, permission.value
FROM public.roles r
CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(r.permissions) = 'array' THEN r.permissions ELSE '[]'::jsonb END
) permission(value)
JOIN public.capabilities c ON c.capability_key = permission.value
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.pr1b_bump_authorization_version(p_org_id uuid, p_user_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE v_version bigint;
BEGIN
    IF p_org_id IS NULL OR p_user_id IS NULL THEN
        RETURN NULL;
    END IF;
    INSERT INTO public.authorization_versions AS av (org_id, user_id, version, updated_at)
    VALUES (p_org_id, p_user_id, 1, statement_timestamp())
    ON CONFLICT (org_id, user_id) DO UPDATE
    SET version = av.version + 1, updated_at = statement_timestamp()
    RETURNING version INTO v_version;
    RETURN v_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.pr1b_bump_membership_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.pr1b_bump_authorization_version(OLD.org_id, OLD.user_id);
        RETURN OLD;
    END IF;
    PERFORM public.pr1b_bump_authorization_version(NEW.org_id, NEW.user_id);
    IF TG_OP = 'UPDATE' AND (OLD.org_id, OLD.user_id) IS DISTINCT FROM (NEW.org_id, NEW.user_id) THEN
        PERFORM public.pr1b_bump_authorization_version(OLD.org_id, OLD.user_id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1b_org_membership_authorization ON public.organization_members;
CREATE TRIGGER trg_pr1b_org_membership_authorization
AFTER INSERT OR UPDATE OR DELETE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.pr1b_bump_membership_authorization();
DROP TRIGGER IF EXISTS trg_pr1b_workspace_membership_authorization ON public.workspace_memberships;
CREATE TRIGGER trg_pr1b_workspace_membership_authorization
AFTER INSERT OR UPDATE OR DELETE ON public.workspace_memberships
FOR EACH ROW EXECUTE FUNCTION public.pr1b_bump_membership_authorization();

CREATE OR REPLACE FUNCTION public.pr1b_bump_role_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_role uuid; v_member record;
BEGIN
    v_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
    FOR v_member IN
        SELECT org_id, user_id FROM public.organization_members WHERE role_id = v_role
        UNION SELECT org_id, user_id FROM public.workspace_memberships WHERE role_id = v_role
    LOOP PERFORM public.pr1b_bump_authorization_version(v_member.org_id, v_member.user_id); END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1b_role_authorization ON public.roles;
CREATE TRIGGER trg_pr1b_role_authorization AFTER UPDATE OR DELETE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.pr1b_bump_role_authorization();

CREATE OR REPLACE FUNCTION public.pr1b_bump_role_capability_authorization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE v_role uuid; v_member record;
BEGIN
    v_role := CASE WHEN TG_OP = 'DELETE' THEN OLD.role_id ELSE NEW.role_id END;
    FOR v_member IN
        SELECT org_id, user_id FROM public.organization_members WHERE role_id = v_role
        UNION SELECT org_id, user_id FROM public.workspace_memberships WHERE role_id = v_role
    LOOP PERFORM public.pr1b_bump_authorization_version(v_member.org_id, v_member.user_id); END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1b_role_capability_authorization ON public.role_capabilities;
CREATE TRIGGER trg_pr1b_role_capability_authorization
AFTER INSERT OR UPDATE OR DELETE ON public.role_capabilities
FOR EACH ROW EXECUTE FUNCTION public.pr1b_bump_role_capability_authorization();

CREATE OR REPLACE FUNCTION public.has_workspace_capability(p_workspace_id uuid, p_org_id uuid, p_capability_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
SELECT EXISTS (
  SELECT 1
  FROM public.organization_members om
  JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
  JOIN public.workspaces w ON w.id=wm.workspace_id AND w.org_id=wm.org_id
  JOIN public.organizations o ON o.id=om.org_id
  WHERE auth.uid() IS NOT NULL AND om.user_id=auth.uid() AND om.org_id=p_org_id
    AND wm.workspace_id=p_workspace_id AND om.status='active' AND om.deleted_at IS NULL
    AND wm.status='active' AND wm.deleted_at IS NULL AND w.status='active' AND w.deleted_at IS NULL
    AND o.status='active' AND o.deleted_at IS NULL
    AND (
      EXISTS (SELECT 1 FROM public.roles organization_role
        JOIN public.role_capabilities organization_capability
          ON organization_capability.role_id=organization_role.id
         AND organization_capability.capability_key=p_capability_key
        WHERE organization_role.id=om.role_id
          AND organization_role.scope='organization' AND organization_role.org_id=p_org_id
          AND organization_role.workspace_id IS NULL
          AND organization_role.status='active' AND organization_role.deleted_at IS NULL)
      OR EXISTS (SELECT 1 FROM public.roles workspace_role
        JOIN public.role_capabilities workspace_capability
          ON workspace_capability.role_id=workspace_role.id
         AND workspace_capability.capability_key=p_capability_key
        WHERE workspace_role.id=wm.role_id
          AND workspace_role.scope='workspace' AND workspace_role.org_id=p_org_id
          AND workspace_role.workspace_id=p_workspace_id
          AND workspace_role.status='active' AND workspace_role.deleted_at IS NULL)
    )
);
$$;

-- Replace the earlier membership-only helper so organization revocation denies
-- every existing workspace policy on the next request.
CREATE OR REPLACE FUNCTION public.is_active_workspace_member(p_workspace_id uuid, p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
SELECT EXISTS (
  SELECT 1
  FROM public.profiles p
  JOIN public.organization_members om ON om.user_id=p.id AND om.org_id=p_org_id
  JOIN public.workspace_memberships wm ON wm.user_id=p.id AND wm.org_id=om.org_id AND wm.workspace_id=p_workspace_id
  JOIN public.organizations o ON o.id=om.org_id
  JOIN public.workspaces w ON w.id=wm.workspace_id AND w.org_id=om.org_id
  WHERE p.id=auth.uid() AND p.status='active' AND p.deleted_at IS NULL
    AND om.status='active' AND om.deleted_at IS NULL
    AND wm.status='active' AND wm.deleted_at IS NULL
    AND o.status='active' AND o.deleted_at IS NULL
    AND w.status='active' AND w.deleted_at IS NULL
);
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_context(p_org_id uuid, p_workspace_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
SELECT CASE WHEN NOT public.is_active_workspace_member(p_workspace_id,p_org_id) THEN NULL ELSE jsonb_build_object(
 'userId',auth.uid(),'organizationId',p_org_id,'workspaceId',p_workspace_id,
 'authorizationVersion',COALESCE((SELECT version FROM public.authorization_versions WHERE org_id=p_org_id AND user_id=auth.uid()),1),
 'capabilities',COALESCE((SELECT jsonb_agg(x.capability_key ORDER BY x.capability_key) FROM (
   SELECT organization_capability.capability_key FROM public.organization_members om
   JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles organization_role ON organization_role.id=om.role_id
   JOIN public.role_capabilities organization_capability ON organization_capability.role_id=organization_role.id
   WHERE om.org_id=p_org_id AND wm.workspace_id=p_workspace_id AND om.user_id=auth.uid()
     AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
     AND organization_role.scope='organization' AND organization_role.org_id=p_org_id
     AND organization_role.workspace_id IS NULL
     AND organization_role.status='active' AND organization_role.deleted_at IS NULL
   UNION
   SELECT workspace_capability.capability_key FROM public.organization_members om
   JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles workspace_role ON workspace_role.id=wm.role_id
   JOIN public.role_capabilities workspace_capability ON workspace_capability.role_id=workspace_role.id
   WHERE om.org_id=p_org_id AND wm.workspace_id=p_workspace_id AND om.user_id=auth.uid()
     AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
     AND workspace_role.scope='workspace' AND workspace_role.org_id=p_org_id
     AND workspace_role.workspace_id=p_workspace_id
     AND workspace_role.status='active' AND workspace_role.deleted_at IS NULL
 ) x),'[]'::jsonb)) END;
$$;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.assess_processes WHERE workspace_id IS NULL)
 OR EXISTS (SELECT 1 FROM public.assessments WHERE workspace_id IS NULL)
 OR EXISTS (SELECT 1 FROM public.assessment_review_events WHERE workspace_id IS NULL) THEN
   RAISE EXCEPTION 'PR1B_PREFLIGHT_ASSESS_WORKSPACE_REQUIRED';
 END IF;
END $$;

ALTER TABLE public.assess_processes ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.assessments ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.assessment_review_events ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS score_version text;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pr1b_assessments_version_check' AND conrelid='public.assessments'::regclass) THEN
  ALTER TABLE public.assessments ADD CONSTRAINT pr1b_assessments_version_check CHECK (version > 0) NOT VALID;
 END IF;
END $$;
ALTER TABLE public.assessments VALIDATE CONSTRAINT pr1b_assessments_version_check;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pr1b_assess_processes_workspace_org_fkey' AND conrelid='public.assess_processes'::regclass) THEN
  ALTER TABLE public.assess_processes ADD CONSTRAINT pr1b_assess_processes_workspace_org_fkey FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pr1b_assessments_process_workspace_org_fkey' AND conrelid='public.assessments'::regclass) THEN
  ALTER TABLE public.assess_processes ADD CONSTRAINT pr1b_assess_processes_id_workspace_org_key UNIQUE(id,workspace_id,org_id);
  ALTER TABLE public.assessments ADD CONSTRAINT pr1b_assessments_process_workspace_org_fkey FOREIGN KEY(process_id,workspace_id,org_id) REFERENCES public.assess_processes(id,workspace_id,org_id);
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='pr1b_review_assessment_workspace_org_fkey' AND conrelid='public.assessment_review_events'::regclass) THEN
  ALTER TABLE public.assessments ADD CONSTRAINT pr1b_assessments_id_workspace_org_key UNIQUE(id,workspace_id,org_id);
  ALTER TABLE public.assessment_review_events ADD CONSTRAINT pr1b_review_assessment_workspace_org_fkey FOREIGN KEY(assessment_id,workspace_id,org_id) REFERENCES public.assessments(id,workspace_id,org_id);
  ALTER TABLE public.assessment_review_events ADD CONSTRAINT pr1b_review_process_workspace_org_fkey FOREIGN KEY(process_id,workspace_id,org_id) REFERENCES public.assess_processes(id,workspace_id,org_id);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.assess_command_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id), command_type text NOT NULL,
 idempotency_key text NOT NULL, request_id uuid NOT NULL, request_hash text NOT NULL,
 status text NOT NULL CHECK(status IN('in_progress','succeeded','failed')), response jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CONSTRAINT pr1b_receipt_workspace_org_fkey FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id),
 CONSTRAINT pr1b_receipt_idempotency_key_check CHECK(length(btrim(idempotency_key)) BETWEEN 1 AND 200),
 UNIQUE(org_id,actor_id,command_type,idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.privileged_audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id), request_id uuid NOT NULL,
 action text NOT NULL, resource_type text NOT NULL, resource_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('succeeded','denied','failed')), resource_version bigint,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT pr1b_audit_workspace_org_fkey FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id),
 CONSTRAINT pr1b_audit_safe_metadata_check CHECK(NOT (metadata ?| ARRAY['secret','token','signedUrl','rawContent','customerData']))
);

CREATE OR REPLACE FUNCTION public.pr1b_reject_immutable_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PR 1B audit and completed command records are immutable'; END; $$;
DROP TRIGGER IF EXISTS trg_pr1b_audit_immutable ON public.privileged_audit_events;
CREATE TRIGGER trg_pr1b_audit_immutable BEFORE UPDATE OR DELETE ON public.privileged_audit_events FOR EACH ROW EXECUTE FUNCTION public.pr1b_reject_immutable_event_mutation();

-- Canonical PR 1B upgrade/reapply cleanup.  These caller-JWT overloads existed
-- only on the unmerged PR branch and must not survive beside the server-only API.
DROP FUNCTION IF EXISTS public.pr1b_create_assessment(uuid,uuid,uuid,uuid,uuid,text,bigint);
DROP FUNCTION IF EXISTS public.pr1b_upsert_assessment_responses(uuid,uuid,uuid,jsonb,bigint,uuid,text,bigint);
DROP FUNCTION IF EXISTS public.pr1b_finalize_assessment(uuid,uuid,uuid,jsonb,text,bigint,uuid,text,bigint);
DROP FUNCTION IF EXISTS public.pr1b_assert_command_authority(uuid,uuid,text,bigint);
DROP FUNCTION IF EXISTS public.pr1b_claim_command(uuid,uuid,text,text,uuid,text);

CREATE OR REPLACE FUNCTION public.pr1b_assert_command_authority(p_actor uuid,p_org uuid,p_workspace uuid,p_capability text,p_version bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_actual bigint;
BEGIN
 IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_capability IS NULL THEN
  RAISE EXCEPTION 'PR1B_NOT_FOUND';
 END IF;

 -- This function is reached only through service-role-only mutation RPCs.  It
 -- nevertheless reauthorizes every authority row independently and locks the
 -- selected authority through transaction commit so a concurrent revocation
 -- cannot interleave ahead of the authorized mutation.
 PERFORM 1
  FROM public.profiles p
  JOIN public.organization_members om ON om.user_id=p.id AND om.org_id=p_org
  JOIN public.workspace_memberships wm ON wm.user_id=p.id AND wm.org_id=om.org_id AND wm.workspace_id=p_workspace
  JOIN public.organizations o ON o.id=om.org_id
  JOIN public.workspaces w ON w.id=wm.workspace_id AND w.org_id=wm.org_id
  WHERE p.id=p_actor AND p.status='active' AND p.deleted_at IS NULL
    AND om.status='active' AND om.deleted_at IS NULL
    AND wm.status='active' AND wm.deleted_at IS NULL
    AND o.status='active' AND o.deleted_at IS NULL
    AND w.status='active' AND w.deleted_at IS NULL
  LIMIT 1
  FOR SHARE OF p,om,wm,o,w;
 IF NOT FOUND THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;

 PERFORM 1 FROM public.organization_members om
  JOIN public.roles organization_role ON organization_role.id=om.role_id
  JOIN public.role_capabilities organization_capability
    ON organization_capability.role_id=organization_role.id AND organization_capability.capability_key=p_capability
  WHERE om.user_id=p_actor AND om.org_id=p_org
    AND organization_role.scope='organization' AND organization_role.org_id=p_org
    AND organization_role.workspace_id IS NULL
    AND organization_role.status='active' AND organization_role.deleted_at IS NULL
  FOR SHARE OF organization_role,organization_capability;
 IF NOT FOUND THEN
  PERFORM 1 FROM public.workspace_memberships wm
   JOIN public.roles workspace_role ON workspace_role.id=wm.role_id
   JOIN public.role_capabilities workspace_capability
     ON workspace_capability.role_id=workspace_role.id AND workspace_capability.capability_key=p_capability
   WHERE wm.user_id=p_actor AND wm.org_id=p_org AND wm.workspace_id=p_workspace
     AND workspace_role.scope='workspace' AND workspace_role.org_id=p_org
     AND workspace_role.workspace_id=p_workspace
     AND workspace_role.status='active' AND workspace_role.deleted_at IS NULL
   FOR SHARE OF workspace_role,workspace_capability;
  IF NOT FOUND THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
 END IF;

 SELECT version INTO v_actual FROM public.authorization_versions
 WHERE org_id=p_org AND user_id=p_actor FOR SHARE;
 IF COALESCE(v_actual,1) <> p_version THEN RAISE EXCEPTION 'PR1B_AUTHORIZATION_STALE'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.pr1b_claim_command(p_actor uuid,p_org uuid,p_workspace uuid,p_type text,p_key text,p_request uuid,p_hash text)
RETURNS public.assess_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_row public.assess_command_receipts;
BEGIN
 IF p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 1 AND 200 OR p_request IS NULL THEN
  RAISE EXCEPTION 'PR1B_INVALID_COMMAND';
 END IF;
 INSERT INTO public.assess_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(p_org,p_workspace,p_actor,p_type,p_key,p_request,p_hash,'in_progress')
 ON CONFLICT(org_id,actor_id,command_type,idempotency_key) DO NOTHING RETURNING * INTO v_row;
 IF v_row.id IS NULL THEN
  SELECT * INTO v_row FROM public.assess_command_receipts WHERE org_id=p_org AND actor_id=p_actor AND command_type=p_type AND idempotency_key=p_key FOR UPDATE;
  IF v_row.request_hash<>p_hash THEN RAISE EXCEPTION 'PR1B_IDEMPOTENCY_CONFLICT'; END IF;
 END IF;
 RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.pr1b_error_envelope(p_message text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('ok',false,'errorCode',CASE
  WHEN p_message LIKE '%PR1B_AUTHORIZATION_STALE%' THEN 'AUTHORIZATION_STALE'
  WHEN p_message LIKE '%PR1B_IDEMPOTENCY_CONFLICT%' THEN 'IDEMPOTENCY_CONFLICT'
  WHEN p_message LIKE '%PR1B_VERSION_CONFLICT%' THEN 'VERSION_CONFLICT'
  WHEN p_message LIKE '%PR1B_SCORE_VERSION_INVALID%' THEN 'INVALID_SCORE_VERSION'
  WHEN p_message LIKE '%PR1B_INVALID_COMMAND%' THEN 'INVALID_COMMAND'
  WHEN p_message LIKE '%PR1B_NOT_FOUND%' THEN 'NOT_FOUND'
  ELSE 'COMMAND_UNAVAILABLE' END);
$$;

CREATE OR REPLACE FUNCTION public.pr1b_create_assessment(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_process_id uuid,p_assessment_id uuid,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.assess_command_receipts; a public.assessments; h text:=md5(concat_ws('|',p_org_id,p_workspace_id,p_process_id,p_assessment_id)); result jsonb;
BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.create',p_authorization_version);
 r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment.create',p_idempotency_key,p_request_id,h);
 IF r.status='succeeded' THEN RETURN r.response; END IF;
 INSERT INTO public.assessments(id,process_id,org_id,workspace_id,status,created_by,updated_by)
 SELECT p_assessment_id,ap.id,p_org_id,p_workspace_id,'Draft',p_actor_id,p_actor_id
 FROM public.assess_processes ap
 WHERE ap.id=p_process_id AND ap.org_id=p_org_id AND ap.workspace_id=p_workspace_id AND ap.deleted_at IS NULL
 RETURNING * INTO a;
 IF a.id IS NULL THEN RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
 result:=jsonb_build_object('ok',true,'outcome','committed','resource',jsonb_build_object('assessmentId',a.id,'version',a.version,'status',a.status));
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version) VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment.create','assessment',a.id,'succeeded',a.version);
 UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%PR1B_%' THEN RAISE LOG 'PR1B_COMMAND_UNAVAILABLE function=pr1b_create_assessment sqlstate=%',SQLSTATE; END IF;
 RETURN public.pr1b_error_envelope(SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.pr1b_upsert_assessment_responses(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_assessment_id uuid,p_responses jsonb,p_expected_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.assess_command_receipts; a public.assessments; h text:=md5(concat_ws('|',p_org_id,p_workspace_id,p_assessment_id,p_expected_version,p_responses::text)); result jsonb;
BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.response.write',p_authorization_version);
 IF p_responses IS NULL OR jsonb_typeof(p_responses)<>'object'
    OR NOT (p_responses ?& ARRAY['responses','metadata','evidenceItems','assumptions'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_responses))<>4
    OR jsonb_typeof(p_responses->'responses')<>'object'
    OR jsonb_typeof(p_responses->'metadata')<>'object'
    OR jsonb_typeof(p_responses->'evidenceItems')<>'array'
    OR jsonb_typeof(p_responses->'assumptions')<>'array' THEN
  RAISE EXCEPTION 'PR1B_INVALID_COMMAND';
 END IF;
 r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment.response.upsert',p_idempotency_key,p_request_id,h);
 IF r.status='succeeded' THEN RETURN r.response; END IF;
 UPDATE public.assessments SET responses=p_responses,version=version+1,updated_by=p_actor_id,updated_at=now()
 WHERE id=p_assessment_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND version=p_expected_version AND deleted_at IS NULL RETURNING * INTO a;
 IF a.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.assessments WHERE id=p_assessment_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PR1B_VERSION_CONFLICT';
  ELSE RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
 END IF;
 result:=jsonb_build_object('ok',true,'outcome','committed','resource',jsonb_build_object('assessmentId',a.id,'version',a.version,'status',a.status));
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version) VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment.response.upsert','assessment',a.id,'succeeded',a.version);
 UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%PR1B_%' THEN RAISE LOG 'PR1B_COMMAND_UNAVAILABLE function=pr1b_upsert_assessment_responses sqlstate=%',SQLSTATE; END IF;
 RETURN public.pr1b_error_envelope(SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.pr1b_finalize_assessment(p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_assessment_id uuid,p_scores jsonb,p_score_version text,p_expected_version bigint,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE r public.assess_command_receipts; a public.assessments; h text:=md5(concat_ws('|',p_org_id,p_workspace_id,p_assessment_id,p_expected_version,p_score_version,p_scores::text)); result jsonb;
BEGIN
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.finalize',p_authorization_version);
 IF p_score_version IS DISTINCT FROM 'assess-core-2026-05'
    OR p_scores IS NULL OR jsonb_typeof(p_scores)<>'object'
    OR p_scores->>'scoreVersion' IS DISTINCT FROM 'assess-core-2026-05' THEN
  RAISE EXCEPTION 'PR1B_SCORE_VERSION_INVALID';
 END IF;
 r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'assessment.finalize',p_idempotency_key,p_request_id,h);
 IF r.status='succeeded' THEN RETURN r.response; END IF;
 UPDATE public.assessments SET scores=p_scores,score_version='assess-core-2026-05',status='Ready for Review',version=version+1,updated_by=p_actor_id,updated_at=now()
 WHERE id=p_assessment_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND version=p_expected_version AND deleted_at IS NULL RETURNING * INTO a;
 IF a.id IS NULL THEN
  IF EXISTS(SELECT 1 FROM public.assessments WHERE id=p_assessment_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'PR1B_VERSION_CONFLICT';
  ELSE RAISE EXCEPTION 'PR1B_NOT_FOUND'; END IF;
 END IF;
 result:=jsonb_build_object('ok',true,'outcome','committed','resource',jsonb_build_object('assessmentId',a.id,'version',a.version,'status',a.status,'scoreVersion',a.score_version));
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata) VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'assessment.finalize','assessment',a.id,'succeeded',a.version,jsonb_build_object('scoreVersion','assess-core-2026-05'));
 UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now() WHERE id=r.id;
 RETURN result;
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM NOT LIKE '%PR1B_%' THEN RAISE LOG 'PR1B_COMMAND_UNAVAILABLE function=pr1b_finalize_assessment sqlstate=%',SQLSTATE; END IF;
 RETURN public.pr1b_error_envelope(SQLERRM);
END $$;

ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY; ALTER TABLE public.capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY; ALTER TABLE public.role_capabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.authorization_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.authorization_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assess_command_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assess_command_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privileged_audit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE public.privileged_audit_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assess_processes FORCE ROW LEVEL SECURITY; ALTER TABLE public.assessments FORCE ROW LEVEL SECURITY; ALTER TABLE public.assessment_review_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS m5_3a_2_assess_processes_select_workspace_member ON public.assess_processes;
DROP POLICY IF EXISTS pr1b_assess_processes_read ON public.assess_processes;
CREATE POLICY pr1b_assess_processes_read ON public.assess_processes FOR SELECT TO authenticated USING(deleted_at IS NULL AND public.has_workspace_capability(workspace_id,org_id,'assess.read'));
DROP POLICY IF EXISTS m5_3a_2_assessments_select_workspace_member ON public.assessments;
DROP POLICY IF EXISTS pr1b_assessments_read ON public.assessments;
CREATE POLICY pr1b_assessments_read ON public.assessments FOR SELECT TO authenticated USING(deleted_at IS NULL AND public.has_workspace_capability(workspace_id,org_id,'assess.read'));
DROP POLICY IF EXISTS m5_3a_2_assessment_review_events_select_workspace_member ON public.assessment_review_events;
DROP POLICY IF EXISTS pr1b_assessment_review_events_read ON public.assessment_review_events;
CREATE POLICY pr1b_assessment_review_events_read ON public.assessment_review_events FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.audit.read'));
DROP POLICY IF EXISTS pr1b_authorization_version_own ON public.authorization_versions;
CREATE POLICY pr1b_authorization_version_own ON public.authorization_versions FOR SELECT TO authenticated USING(user_id=auth.uid() AND public.is_active_org_member(org_id));
DROP POLICY IF EXISTS pr1b_audit_read ON public.privileged_audit_events;
CREATE POLICY pr1b_audit_read ON public.privileged_audit_events FOR SELECT TO authenticated USING(public.has_workspace_capability(workspace_id,org_id,'assess.audit.read'));

REVOKE ALL ON public.capabilities,public.role_capabilities,public.authorization_versions,public.assess_command_receipts,public.privileged_audit_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.authorization_versions,public.privileged_audit_events TO authenticated;

-- PostgreSQL grants EXECUTE to PUBLIC for new functions by default.  Make the
-- complete PR 1B function privilege matrix explicit: only the two auth.uid()-
-- bound read projections are client-callable; mutation and authority internals
-- are executable solely by the server-held service role.
REVOKE EXECUTE ON FUNCTION
 public.pr1b_enforce_membership_role_scope(),
 public.pr1b_enforce_referenced_role_scope(),
 public.pr1b_bump_authorization_version(uuid,uuid),
 public.pr1b_bump_membership_authorization(),
 public.pr1b_bump_role_authorization(),
 public.pr1b_bump_role_capability_authorization(),
 public.pr1b_reject_immutable_event_mutation(),
 public.pr1b_assert_command_authority(uuid,uuid,uuid,text,bigint),
 public.pr1b_claim_command(uuid,uuid,uuid,text,text,uuid,text),
 public.pr1b_error_envelope(text),
 public.pr1b_create_assessment(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint),
 public.pr1b_upsert_assessment_responses(uuid,uuid,uuid,uuid,jsonb,bigint,uuid,text,bigint),
 public.pr1b_finalize_assessment(uuid,uuid,uuid,uuid,jsonb,text,bigint,uuid,text,bigint)
 FROM PUBLIC,anon,authenticated;
REVOKE EXECUTE ON FUNCTION
 public.has_workspace_capability(uuid,uuid,text),
 public.is_active_workspace_member(uuid,uuid),
 public.get_tenant_context(uuid,uuid)
 FROM PUBLIC,anon;

GRANT EXECUTE ON FUNCTION public.has_workspace_capability(uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_context(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pr1b_create_assessment(uuid,uuid,uuid,uuid,uuid,uuid,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pr1b_upsert_assessment_responses(uuid,uuid,uuid,uuid,jsonb,bigint,uuid,text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.pr1b_finalize_assessment(uuid,uuid,uuid,uuid,jsonb,text,bigint,uuid,text,bigint) TO service_role;

COMMENT ON TABLE public.authorization_versions IS 'Immediate server authorization invalidation epoch. Membership, role, and normalized capability changes bump affected users.';
COMMENT ON TABLE public.assess_command_receipts IS 'Server-only idempotency records. Completed success is replayed only for the same canonical request hash.';
COMMENT ON TABLE public.privileged_audit_events IS 'Append-only required audit committed in the same transaction as each PR 1B privileged Assess mutation.';
