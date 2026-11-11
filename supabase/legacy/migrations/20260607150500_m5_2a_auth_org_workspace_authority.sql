-- M5.2a Supabase Auth / Organization / Workspace authority foundation.
-- Scope: additive tenant-authority schema only. No seed data, artifact
-- ownership columns, runtime dependencies, or RLS policies are introduced.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE profiles ALTER COLUMN email SET NOT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_trial BOOLEAN NOT NULL DEFAULT false,
    trial_expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE organizations ALTER COLUMN name SET NOT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE organizations ALTER COLUMN slug SET NOT NULL;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    CONSTRAINT workspaces_id_org_id_key UNIQUE (id, org_id)
);

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE workspaces ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE workspaces ALTER COLUMN name SET NOT NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE workspaces ALTER COLUMN slug SET NOT NULL;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'workspaces_id_org_id_key'
          AND conrelid = 'workspaces'::regclass
    ) THEN
        ALTER TABLE workspaces
            ADD CONSTRAINT workspaces_id_org_id_key UNIQUE (id, org_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'organization',
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    is_system BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE roles ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE roles ALTER COLUMN name SET NOT NULL;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS slug TEXT;
UPDATE roles
SET slug = lower(regexp_replace(btrim(name), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL
  AND name IS NOT NULL
  AND length(btrim(name)) > 0;
UPDATE roles
SET slug = 'role-' || substring(id::text from 1 for 8)
WHERE slug IS NULL
   OR length(btrim(slug)) = 0;
ALTER TABLE roles ALTER COLUMN slug SET NOT NULL;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'organization';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id);
ALTER TABLE roles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE roles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

UPDATE roles
SET scope = 'system',
    is_system = true
WHERE scope = 'organization'
  AND org_id IS NULL
  AND workspace_id IS NULL;

UPDATE roles
SET scope = 'workspace'
WHERE workspace_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    status TEXT NOT NULL DEFAULT 'active',
    joined_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE organization_members ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE organization_members ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id);
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE organization_members ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS workspace_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    status TEXT NOT NULL DEFAULT 'active',
    joined_at TIMESTAMPTZ,
    invited_at TIMESTAMPTZ,
    disabled_at TIMESTAMPTZ,
    created_by UUID REFERENCES profiles(id),
    updated_by UUID REFERENCES profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT workspace_memberships_workspace_org_fkey
        FOREIGN KEY (workspace_id, org_id)
        REFERENCES workspaces(id, org_id)
        ON DELETE CASCADE
);

ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE workspace_memberships ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE workspace_memberships ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE workspace_memberships ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id);
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ;
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES profiles(id);
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES profiles(id);
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE workspace_memberships ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'workspace_memberships_workspace_org_fkey'
          AND conrelid = 'workspace_memberships'::regclass
    ) THEN
        ALTER TABLE workspace_memberships
            ADD CONSTRAINT workspace_memberships_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            ON DELETE CASCADE;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_status_check'
          AND conrelid = 'profiles'::regclass
    ) THEN
        ALTER TABLE profiles
            ADD CONSTRAINT profiles_status_check
            CHECK (status IN ('active', 'invited', 'disabled', 'archived', 'suspended', 'removed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organizations_status_check'
          AND conrelid = 'organizations'::regclass
    ) THEN
        ALTER TABLE organizations
            ADD CONSTRAINT organizations_status_check
            CHECK (status IN ('active', 'invited', 'disabled', 'archived', 'suspended', 'trial'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'workspaces_status_check'
          AND conrelid = 'workspaces'::regclass
    ) THEN
        ALTER TABLE workspaces
            ADD CONSTRAINT workspaces_status_check
            CHECK (status IN ('active', 'disabled', 'archived', 'suspended'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'roles_status_check'
          AND conrelid = 'roles'::regclass
    ) THEN
        ALTER TABLE roles
            ADD CONSTRAINT roles_status_check
            CHECK (status IN ('active', 'disabled', 'archived', 'retired'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'roles_scope_check'
          AND conrelid = 'roles'::regclass
    ) THEN
        ALTER TABLE roles
            ADD CONSTRAINT roles_scope_check
            CHECK (
                scope IN ('system', 'organization', 'workspace')
                AND (
                    (scope = 'system' AND org_id IS NULL AND workspace_id IS NULL)
                    OR (scope = 'organization' AND org_id IS NOT NULL AND workspace_id IS NULL)
                    OR (scope = 'workspace' AND org_id IS NOT NULL AND workspace_id IS NOT NULL)
                )
            );
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'organization_members_status_check'
          AND conrelid = 'organization_members'::regclass
    ) THEN
        ALTER TABLE organization_members
            ADD CONSTRAINT organization_members_status_check
            CHECK (status IN ('active', 'invited', 'disabled', 'archived', 'suspended', 'removed'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'workspace_memberships_status_check'
          AND conrelid = 'workspace_memberships'::regclass
    ) THEN
        ALTER TABLE workspace_memberships
            ADD CONSTRAINT workspace_memberships_status_check
            CHECK (status IN ('active', 'invited', 'disabled', 'archived', 'suspended', 'removed'));
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_profiles_active_email_lower
    ON profiles (lower(email))
    WHERE deleted_at IS NULL
      AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_profiles_status_deleted
    ON profiles(status, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_active_slug_lower
    ON organizations (lower(slug))
    WHERE deleted_at IS NULL
      AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_organizations_status_deleted
    ON organizations(status, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_active_org_slug_lower
    ON workspaces (org_id, lower(slug))
    WHERE deleted_at IS NULL
      AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_workspaces_org_status_deleted
    ON workspaces(org_id, status, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_active_system_slug
    ON roles (lower(slug))
    WHERE scope = 'system'
      AND deleted_at IS NULL
      AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_active_org_slug
    ON roles (org_id, lower(slug))
    WHERE scope = 'organization'
      AND deleted_at IS NULL
      AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_active_workspace_slug
    ON roles (workspace_id, lower(slug))
    WHERE scope = 'workspace'
      AND deleted_at IS NULL
      AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_roles_status_deleted
    ON roles(status, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_organization_members_active_org_user
    ON organization_members(org_id, user_id)
    WHERE deleted_at IS NULL
      AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_organization_members_org_status
    ON organization_members(org_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_organization_members_user_status
    ON organization_members(user_id, status)
    WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_memberships_active_workspace_user
    ON workspace_memberships(workspace_id, user_id)
    WHERE deleted_at IS NULL
      AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_org_user
    ON workspace_memberships(org_id, user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_status
    ON workspace_memberships(workspace_id, status)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_status
    ON workspace_memberships(user_id, status)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE profiles IS 'M5.2a tenant-authority profile metadata. profiles.id equals Supabase auth.users.id; role authority does not live only on this table. RLS is enabled without policies until M5.3a.';
COMMENT ON COLUMN profiles.id IS 'Supabase Auth identity key. This UUID is auth.users.id.';
COMMENT ON TABLE organizations IS 'M5.2a tenant root authority table. Organizations are the commercial and tenant root boundary. RLS is enabled without policies until M5.3a.';
COMMENT ON TABLE workspaces IS 'M5.2a workspace authority table. Workspaces are the future hosted-pilot work boundary under an organization. Artifact ownership columns are deferred to M5.2b.';
COMMENT ON CONSTRAINT workspaces_id_org_id_key ON workspaces IS 'Composite helper key for future workspace-scoped foreign keys that must also carry org_id.';
COMMENT ON TABLE roles IS 'M5.2a role authority table. Permissions remain JSONB for this milestone; normalized permission tables are deferred. No secret values belong in role records.';
COMMENT ON COLUMN roles.permissions IS 'Named permission strings only. This field must not store secrets, provider keys, auth headers, or private token values.';
COMMENT ON TABLE organization_members IS 'M5.2a organization membership authority table. Active membership is a future RLS input; invited, disabled, archived, suspended, removed, or deleted rows must not grant tenant access.';
COMMENT ON TABLE workspace_memberships IS 'M5.2a workspace membership authority table. Active workspace membership is a future RLS input; one user may belong to multiple workspaces in the same organization.';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE profiles IS 'M5.2a tenant-authority profile metadata. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
COMMENT ON TABLE organizations IS 'M5.2a tenant root authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
COMMENT ON TABLE workspaces IS 'M5.2a workspace authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
COMMENT ON TABLE roles IS 'M5.2a role authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
COMMENT ON TABLE organization_members IS 'M5.2a organization membership authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
COMMENT ON TABLE workspace_memberships IS 'M5.2a workspace membership authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
