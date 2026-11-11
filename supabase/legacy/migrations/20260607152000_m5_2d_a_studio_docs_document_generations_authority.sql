-- M5.2d-a Studio / Docs document generation authority migration.
-- Scope: promote only document_generations as the first Studio/Docs
-- authority table. No Document Vault, review-event, export, storage,
-- lineage, handoff, Delivery, Monitor, provider, seed, backfill, runtime
-- dependency, or RLS policy scope is introduced.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS document_generations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID,
    workspace_id UUID,
    project_id UUID,
    template_id TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    artifacts JSONB DEFAULT '{}'::jsonb,
    status TEXT DEFAULT 'generated',
    created_by UUID,
    updated_by UUID,
    source_process_id UUID,
    source_assessment_id UUID,
    audit_correlation_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS template_id TEXT;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS artifacts JSONB DEFAULT '{}'::jsonb;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'generated';
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS source_process_id UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS source_assessment_id UUID;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS audit_correlation_id TEXT;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE document_generations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE document_generations ALTER COLUMN generated_at SET DEFAULT NOW();
ALTER TABLE document_generations ALTER COLUMN artifacts SET DEFAULT '{}'::jsonb;
ALTER TABLE document_generations ALTER COLUMN status SET DEFAULT 'generated';
ALTER TABLE document_generations ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE document_generations ALTER COLUMN updated_at SET DEFAULT NOW();

-- Remove only known legacy draft Docs policies so RLS remains fail-closed
-- after this migration. M5.2d-a does not create replacement policies.
DROP POLICY IF EXISTS "Users can see org docs" ON document_generations;
DROP POLICY IF EXISTS "Users can modify org docs" ON document_generations;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_id_org_id_key'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_id_org_id_key UNIQUE (id, org_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_org_id_required_check'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_org_id_required_check
            CHECK (org_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_project_id_required_check'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_project_id_required_check
            CHECK (project_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_template_id_required_check'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_template_id_required_check
            CHECK (template_id IS NOT NULL AND length(btrim(template_id)) > 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_status_required_check'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_status_required_check
            CHECK (status IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_status_check'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_status_check
            CHECK (
                status IS NULL OR status IN (
                    'generated',
                    'draft',
                    'archived',
                    'failed'
                )
            ) NOT VALID;
    END IF;
END $$;

DO $$
DECLARE
    legacy_constraint_name TEXT;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_project_id_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            DROP CONSTRAINT document_generations_project_id_fkey;
    END IF;

    FOREACH legacy_constraint_name IN ARRAY ARRAY[
        'document_generations_org_id_fkey',
        'document_generations_workspace_org_fkey',
        'document_generations_project_org_fkey',
        'document_generations_source_process_org_fkey',
        'document_generations_source_assessment_org_fkey'
    ] LOOP
        IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = legacy_constraint_name
              AND conrelid = 'document_generations'::regclass
              AND confdeltype = 'c'
        ) THEN
            EXECUTE format(
                'ALTER TABLE document_generations DROP CONSTRAINT %I',
                legacy_constraint_name
            );
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_org_id_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_org_id_fkey
            FOREIGN KEY (org_id)
            REFERENCES organizations(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_workspace_org_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_project_org_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_project_org_fkey
            FOREIGN KEY (project_id, org_id)
            REFERENCES projects(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_source_process_org_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_source_process_org_fkey
            FOREIGN KEY (source_process_id, org_id)
            REFERENCES assess_processes(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_source_assessment_org_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_source_assessment_org_fkey
            FOREIGN KEY (source_assessment_id, org_id)
            REFERENCES assessments(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_created_by_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'document_generations_updated_by_fkey'
          AND conrelid = 'document_generations'::regclass
    ) THEN
        ALTER TABLE document_generations
            ADD CONSTRAINT document_generations_updated_by_fkey
            FOREIGN KEY (updated_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_document_generations_org_project_generated
    ON document_generations(org_id, project_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_generations_workspace_status_deleted
    ON document_generations(workspace_id, status, deleted_at)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_generations_org_status_deleted
    ON document_generations(org_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_document_generations_template
    ON document_generations(template_id)
    WHERE template_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_generations_source_process
    ON document_generations(source_process_id)
    WHERE source_process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_generations_source_assessment
    ON document_generations(source_assessment_id)
    WHERE source_assessment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_generations_created_by
    ON document_generations(created_by)
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_generations_updated_by
    ON document_generations(updated_by)
    WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_document_generations_audit_correlation
    ON document_generations(audit_correlation_id)
    WHERE audit_correlation_id IS NOT NULL;

COMMENT ON TABLE document_generations IS 'M5.2d-a first Studio/Docs authority table. Stores document generation records under organization, nullable workspace, and project ownership. This is not Document Vault authority, review-event authority, export/storage authority, lineage/handoff authority, Delivery work-item authority, seed data, backfill, runtime dependency, or hosted-pilot readiness.';
COMMENT ON CONSTRAINT document_generations_id_org_id_key ON document_generations IS 'Composite helper key for future same-organization references from lineage, handoff, export, review, or Delivery records after AP approval.';
COMMENT ON COLUMN document_generations.workspace_id IS 'Nullable-first workspace ownership input for future workspace-aware RLS. No workspace backfill is performed in M5.2d-a.';
COMMENT ON COLUMN document_generations.project_id IS 'Applied project authority reference. The same-organization foreign key intentionally uses default delete behavior for artifact history.';
COMMENT ON COLUMN document_generations.template_id IS 'Current adapter template identifier. This is not document template authority and not provider prompt authority.';
COMMENT ON COLUMN document_generations.artifacts IS 'Generated artifact payload preserving the current adapter contract. It must not store secrets, provider keys, service-role values, raw private tokens, personal hosted-project values, or unsupported compliance claims. It is not standalone durable evidence, approval, export, storage, review-event, or lineage authority.';
COMMENT ON COLUMN document_generations.status IS 'Document generation lifecycle status for this slice only: generated, draft, archived, or failed. Review statuses are deferred until AP approves durable review-event authority.';
COMMENT ON COLUMN document_generations.source_process_id IS 'Optional same-organization Assess process source reference. Nullable until AP-approved mapping and backfill exist.';
COMMENT ON COLUMN document_generations.source_assessment_id IS 'Optional same-organization assessment source reference. Nullable until AP-approved mapping and backfill exist.';
COMMENT ON COLUMN document_generations.audit_correlation_id IS 'Optional safe correlation identifier for later audited workflows. Must not store secret values or personal hosted-project values.';

ALTER TABLE document_generations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE document_generations IS 'M5.2d-a first Studio/Docs document generation authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until future AP-approved policies and tests exist. Tenant isolation is not implemented or proven. No Document Vault, review-event, export/storage, lineage/handoff, Delivery work-item, Monitor, provider, seed, backfill, runtime dependency, or hosted-pilot readiness scope is introduced.';
