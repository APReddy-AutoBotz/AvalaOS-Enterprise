-- M5.3a-1 RLS helper and SELECT policy implementation.
-- Scope: identity, organization, workspace, role, and membership SELECT access only.
-- No artifact policies, provider policies, mutation policies, runtime behavior, seed data,
-- backfill, constraint validation, hosted target values, or secret values are introduced.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.profiles IS 'M5.3a-1 SELECT policy scope: own active non-deleted profile only. No mutation policy is created in this milestone.';
COMMENT ON TABLE public.organizations IS 'M5.3a-1 SELECT policy scope: active organization members only. Artifact and mutation policies are deferred.';
COMMENT ON TABLE public.workspaces IS 'M5.3a-1 SELECT policy scope: active workspace members only. Artifact and mutation policies are deferred.';
COMMENT ON TABLE public.roles IS 'M5.3a-1 SELECT policy scope: active organization or workspace members can read scoped non-system active roles only. System role visibility remains AP-deferred.';
COMMENT ON TABLE public.organization_members IS 'M5.3a-1 SELECT policy scope: users can read only their own active non-deleted organization memberships with active parent organization.';
COMMENT ON TABLE public.workspace_memberships IS 'M5.3a-1 SELECT policy scope: users can read only their own active non-deleted workspace memberships with active parent organization and workspace.';

-- SECURITY DEFINER is used for the two boolean membership helpers to avoid
-- recursive RLS failures when membership, organization, workspace, and role
-- SELECT policies depend on membership resolution. The helpers are boolean-only,
-- schema-qualified, search_path-hardened, and execution is restricted below.
CREATE OR REPLACE FUNCTION public.is_active_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members AS om
        JOIN public.organizations AS o
          ON o.id = om.org_id
        WHERE p_org_id IS NOT NULL
          AND auth.uid() IS NOT NULL
          AND om.org_id = p_org_id
          AND om.user_id = auth.uid()
          AND om.status = 'active'
          AND om.deleted_at IS NULL
          AND o.status = 'active'
          AND o.deleted_at IS NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.is_active_workspace_member(p_workspace_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_memberships AS wm
        JOIN public.workspaces AS w
          ON w.id = wm.workspace_id
         AND w.org_id = wm.org_id
        JOIN public.organizations AS o
          ON o.id = wm.org_id
        WHERE p_workspace_id IS NOT NULL
          AND p_org_id IS NOT NULL
          AND auth.uid() IS NOT NULL
          AND wm.workspace_id = p_workspace_id
          AND wm.org_id = p_org_id
          AND wm.user_id = auth.uid()
          AND wm.status = 'active'
          AND wm.deleted_at IS NULL
          AND w.status = 'active'
          AND w.deleted_at IS NULL
          AND o.status = 'active'
          AND o.deleted_at IS NULL
    );
$$;

COMMENT ON FUNCTION public.is_active_org_member(uuid) IS 'M5.3a-1 boolean-only RLS helper. Resolves active non-deleted organization membership and active parent organization for auth.uid(); returns no tenant metadata, role data, permission data, row payloads, counts, target values, or secrets.';
COMMENT ON FUNCTION public.is_active_workspace_member(uuid, uuid) IS 'M5.3a-1 boolean-only RLS helper. Resolves active non-deleted workspace membership plus active parent workspace and organization for auth.uid(); returns no tenant metadata, role data, permission data, row payloads, counts, target values, or secrets.';

REVOKE EXECUTE ON FUNCTION public.is_active_org_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_active_workspace_member(uuid, uuid) FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE EXECUTE ON FUNCTION public.is_active_org_member(uuid) FROM anon;
        REVOKE EXECUTE ON FUNCTION public.is_active_workspace_member(uuid, uuid) FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT EXECUTE ON FUNCTION public.is_active_org_member(uuid) TO authenticated;
        GRANT EXECUTE ON FUNCTION public.is_active_workspace_member(uuid, uuid) TO authenticated;
        GRANT SELECT ON TABLE
            public.profiles,
            public.organizations,
            public.workspaces,
            public.roles,
            public.organization_members,
            public.workspace_memberships
        TO authenticated;
    END IF;
END $$;

DROP POLICY IF EXISTS m5_3a_1_profiles_select_own_active ON public.profiles;
CREATE POLICY m5_3a_1_profiles_select_own_active
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND id = auth.uid()
        AND status = 'active'
        AND deleted_at IS NULL
    );

DROP POLICY IF EXISTS m5_3a_1_organization_members_select_own_active ON public.organization_members;
CREATE POLICY m5_3a_1_organization_members_select_own_active
    ON public.organization_members
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND user_id = auth.uid()
        AND status = 'active'
        AND deleted_at IS NULL
        AND public.is_active_org_member(org_id)
    );

DROP POLICY IF EXISTS m5_3a_1_workspace_memberships_select_own_active ON public.workspace_memberships;
CREATE POLICY m5_3a_1_workspace_memberships_select_own_active
    ON public.workspace_memberships
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IS NOT NULL
        AND user_id = auth.uid()
        AND status = 'active'
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
    );

DROP POLICY IF EXISTS m5_3a_1_organizations_select_active_member ON public.organizations;
CREATE POLICY m5_3a_1_organizations_select_active_member
    ON public.organizations
    FOR SELECT
    TO authenticated
    USING (
        status = 'active'
        AND deleted_at IS NULL
        AND public.is_active_org_member(id)
    );

DROP POLICY IF EXISTS m5_3a_1_workspaces_select_active_member ON public.workspaces;
CREATE POLICY m5_3a_1_workspaces_select_active_member
    ON public.workspaces
    FOR SELECT
    TO authenticated
    USING (
        status = 'active'
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(id, org_id)
    );

DROP POLICY IF EXISTS m5_3a_1_roles_select_scoped_active_member ON public.roles;
CREATE POLICY m5_3a_1_roles_select_scoped_active_member
    ON public.roles
    FOR SELECT
    TO authenticated
    USING (
        status = 'active'
        AND deleted_at IS NULL
        AND is_system = false
        AND (
            (
                scope = 'organization'
                AND org_id IS NOT NULL
                AND workspace_id IS NULL
                AND public.is_active_org_member(org_id)
            )
            OR (
                scope = 'workspace'
                AND org_id IS NOT NULL
                AND workspace_id IS NOT NULL
                AND public.is_active_workspace_member(workspace_id, org_id)
            )
        )
    );

COMMENT ON POLICY m5_3a_1_profiles_select_own_active ON public.profiles IS 'M5.3a-1 SELECT-only policy. Own active non-deleted profile only; no mutation access.';
COMMENT ON POLICY m5_3a_1_organization_members_select_own_active ON public.organization_members IS 'M5.3a-1 SELECT-only policy. Own active non-deleted organization membership only; parent organization must be active.';
COMMENT ON POLICY m5_3a_1_workspace_memberships_select_own_active ON public.workspace_memberships IS 'M5.3a-1 SELECT-only policy. Own active non-deleted workspace membership only; parent organization and workspace must be active.';
COMMENT ON POLICY m5_3a_1_organizations_select_active_member ON public.organizations IS 'M5.3a-1 SELECT-only policy. Organization metadata is readable only through active organization membership.';
COMMENT ON POLICY m5_3a_1_workspaces_select_active_member ON public.workspaces IS 'M5.3a-1 SELECT-only policy. Workspace metadata is readable only through active workspace membership.';
COMMENT ON POLICY m5_3a_1_roles_select_scoped_active_member ON public.roles IS 'M5.3a-1 SELECT-only policy. Active non-system organization and workspace roles are scoped by active membership. System role visibility remains AP-deferred.';