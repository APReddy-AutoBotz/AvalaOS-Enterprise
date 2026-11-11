-- Additive forward correction for the PR 1B membership role-scope trigger.
-- The original shared trigger function addressed NEW.workspace_id even when
-- invoked for organization_members, whose row type has no workspace_id.

CREATE OR REPLACE FUNCTION public.pr1b_enforce_organization_membership_role_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_role public.roles;
BEGIN
    SELECT *
    INTO v_role
    FROM public.roles
    WHERE id = NEW.role_id
    FOR SHARE;

    IF v_role.id IS NULL
       OR v_role.status <> 'active'
       OR v_role.deleted_at IS NOT NULL
       OR v_role.org_id IS DISTINCT FROM NEW.org_id
       OR v_role.scope <> 'organization'
       OR v_role.workspace_id IS NOT NULL THEN
        RAISE EXCEPTION 'PR1B_MEMBERSHIP_ROLE_SCOPE_INVALID';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.pr1b_enforce_workspace_membership_role_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
    v_role public.roles;
BEGIN
    -- A roleless row is the accepted presence-only workspace membership.
    IF NEW.role_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT *
    INTO v_role
    FROM public.roles
    WHERE id = NEW.role_id
    FOR SHARE;

    IF v_role.id IS NULL
       OR v_role.status <> 'active'
       OR v_role.deleted_at IS NOT NULL
       OR v_role.org_id IS DISTINCT FROM NEW.org_id
       OR v_role.scope <> 'workspace'
       OR v_role.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
        RAISE EXCEPTION 'PR1B_MEMBERSHIP_ROLE_SCOPE_INVALID';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1b_org_membership_role_scope
ON public.organization_members;
CREATE TRIGGER trg_pr1b_org_membership_role_scope
BEFORE INSERT OR UPDATE OF org_id, role_id ON public.organization_members
FOR EACH ROW
EXECUTE FUNCTION public.pr1b_enforce_organization_membership_role_scope();

DROP TRIGGER IF EXISTS trg_pr1b_workspace_membership_role_scope
ON public.workspace_memberships;
CREATE TRIGGER trg_pr1b_workspace_membership_role_scope
BEFORE INSERT OR UPDATE OF org_id, workspace_id, role_id ON public.workspace_memberships
FOR EACH ROW
EXECUTE FUNCTION public.pr1b_enforce_workspace_membership_role_scope();

-- Trigger execution does not require a caller to hold EXECUTE on the helper.
-- Retain the detached legacy helper privately for forward-migration safety.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_trigger
        WHERE NOT tgisinternal
          AND tgfoid = 'public.pr1b_enforce_membership_role_scope()'::regprocedure
    ) THEN
        RAISE EXCEPTION 'PR1B_LEGACY_MEMBERSHIP_TRIGGER_STILL_ATTACHED';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.pr1b_enforce_membership_role_scope()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pr1b_enforce_organization_membership_role_scope()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.pr1b_enforce_workspace_membership_role_scope()
FROM PUBLIC, anon, authenticated, service_role;
