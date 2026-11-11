-- M5.2f Project authority migration.
-- Scope: promote only projects as applied migration-chain authority for
-- governed Delivery projects. No work-item, Studio/Docs, Monitor, Delivery
-- Pack, export, lineage, handoff, seed data, backfill, runtime dependency, or
-- RLS policies are introduced.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    workspace_id UUID,
    app_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id UUID,
    delivery_lead_id UUID,
    created_by UUID,
    updated_by UUID,
    source_process_id UUID,
    source_assessment_id UUID,
    lifecycle_stage TEXT DEFAULT 'Planning',
    health_status TEXT DEFAULT 'On Track',
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    audit_correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS app_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS delivery_lead_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_process_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS source_assessment_id UUID;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT DEFAULT 'Planning';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS health_status TEXT DEFAULT 'On Track';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS audit_correlation_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE projects ALTER COLUMN lifecycle_stage SET DEFAULT 'Planning';
ALTER TABLE projects ALTER COLUMN health_status SET DEFAULT 'On Track';
ALTER TABLE projects ALTER COLUMN status SET DEFAULT 'active';
ALTER TABLE projects ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE projects ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE projects ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_id_org_id_key'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_id_org_id_key UNIQUE (id, org_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_org_id_required_check'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_org_id_required_check
            CHECK (org_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_name_required_check'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_name_required_check
            CHECK (name IS NOT NULL AND length(btrim(name)) > 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_lifecycle_stage_check'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_lifecycle_stage_check
            CHECK (
                lifecycle_stage IS NULL OR lifecycle_stage IN (
                    'Planning',
                    'Analysis & Design',
                    'Development',
                    'Testing',
                    'Deployment',
                    'Maintenance'
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_health_status_check'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_health_status_check
            CHECK (
                health_status IS NULL OR health_status IN (
                    'On Track',
                    'At Risk',
                    'Off Track'
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_status_required_check'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_status_required_check
            CHECK (status IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_status_check'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_status_check
            CHECK (
                status IS NULL OR status IN (
                    'active',
                    'paused',
                    'archived',
                    'completed',
                    'cancelled'
                )
            ) NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_org_id_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_org_id_fkey
            FOREIGN KEY (org_id)
            REFERENCES organizations(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_workspace_org_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_owner_id_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_owner_id_fkey
            FOREIGN KEY (owner_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_delivery_lead_id_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_delivery_lead_id_fkey
            FOREIGN KEY (delivery_lead_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_created_by_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_updated_by_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_updated_by_fkey
            FOREIGN KEY (updated_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_source_process_org_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_source_process_org_fkey
            FOREIGN KEY (source_process_id, org_id)
            REFERENCES assess_processes(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_source_assessment_org_fkey'
          AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_source_assessment_org_fkey
            FOREIGN KEY (source_assessment_id, org_id)
            REFERENCES assessments(id, org_id)
            NOT VALID;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_active_org_app_id
    ON projects(org_id, app_id)
    WHERE app_id IS NOT NULL
      AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_status_deleted
    ON projects(org_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_projects_workspace_status_deleted
    ON projects(workspace_id, status, deleted_at)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_owner
    ON projects(owner_id)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_delivery_lead
    ON projects(delivery_lead_id)
    WHERE delivery_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_source_process
    ON projects(source_process_id)
    WHERE source_process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_source_assessment
    ON projects(source_assessment_id)
    WHERE source_assessment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_audit_correlation
    ON projects(audit_correlation_id)
    WHERE audit_correlation_id IS NOT NULL;

COMMENT ON TABLE projects IS 'M5.2f project authority table. Represents an AvalaOS governed Delivery project under organization/workspace ownership. Avala Portfolio remains a view over projects. This is not generic project-management replacement authority and not live runtime or bot execution authority.';
COMMENT ON CONSTRAINT projects_id_org_id_key ON projects IS 'Composite helper key for same-organization foreign keys from later Delivery, Studio/Docs, Monitor, lineage, handoff, export, and work-item authority.';
COMMENT ON COLUMN projects.workspace_id IS 'Nullable-first workspace ownership input for future workspace-aware RLS. No backfill is performed in M5.2f.';
COMMENT ON COLUMN projects.app_id IS 'UI/demo bridge identifier only. This is not tenancy authority, not a Supabase project identifier, and not globally unique.';
COMMENT ON COLUMN projects.source_process_id IS 'Optional same-organization source Assess process reference. Nullable until AP-approved mapping and backfill exist.';
COMMENT ON COLUMN projects.source_assessment_id IS 'Optional same-organization source assessment reference. Nullable until AP-approved mapping and backfill exist.';
COMMENT ON COLUMN projects.metadata IS 'Project metadata only. Must not store secrets, provider keys, service-role values, raw private tokens, or personal hosted-project values.';
COMMENT ON COLUMN projects.audit_correlation_id IS 'Optional safe correlation identifier for later audited workflows. Must not store secret values or personal hosted-project values.';

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE projects IS 'M5.2f project authority table for AvalaOS governed Delivery projects under organization/workspace ownership. Avala Portfolio remains a view over projects. This is not generic project-management replacement authority and not live runtime or bot execution authority. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved. No child work-item, Studio/Docs, Monitor, Delivery Pack, export, lineage, handoff, seed, backfill, runtime dependency, or hosted-pilot readiness claim is introduced.';
