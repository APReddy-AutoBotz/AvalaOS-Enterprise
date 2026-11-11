-- M5.2g-a Delivery work item authority migration.
-- Scope: promote only delivery_work_items as the first AvalaOS Delivery
-- work-item authority table. This migration does not promote draft Agile-like
-- epics, sprints, tasks, comments, activity, or timesheet tables.
--
-- Non-scope: no Delivery Pack, Monitor, lineage, handoff, export, storage,
-- Document Vault, provider, seed data, backfill, runtime dependency, or RLS
-- policies are introduced.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS delivery_work_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID,
    workspace_id UUID,
    project_id UUID,
    app_id TEXT,
    document_generation_id UUID,
    source_process_id UUID,
    source_assessment_id UUID,
    created_by UUID,
    updated_by UUID,
    owner_id UUID,
    assigned_to UUID,
    reporter_id UUID,
    title TEXT,
    description TEXT,
    status TEXT DEFAULT 'To Do',
    priority TEXT DEFAULT 'Medium',
    type TEXT DEFAULT 'Task',
    source_lineage JSONB DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    audit_correlation_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS app_id TEXT;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS document_generation_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS source_process_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS source_assessment_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS assigned_to UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS reporter_id UUID;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'To Do';
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'Medium';
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'Task';
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS source_lineage JSONB DEFAULT '{}'::jsonb;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS audit_correlation_id TEXT;
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE delivery_work_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE delivery_work_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE delivery_work_items ALTER COLUMN status SET DEFAULT 'To Do';
ALTER TABLE delivery_work_items ALTER COLUMN priority SET DEFAULT 'Medium';
ALTER TABLE delivery_work_items ALTER COLUMN type SET DEFAULT 'Task';
ALTER TABLE delivery_work_items ALTER COLUMN source_lineage SET DEFAULT '{}'::jsonb;
ALTER TABLE delivery_work_items ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;
ALTER TABLE delivery_work_items ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE delivery_work_items ALTER COLUMN updated_at SET DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_id_org_id_key'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_id_org_id_key UNIQUE (id, org_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_org_id_required_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_org_id_required_check
            CHECK (org_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_project_id_required_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_project_id_required_check
            CHECK (project_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_title_required_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_title_required_check
            CHECK (title IS NOT NULL AND length(btrim(title)) > 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_status_required_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_status_required_check
            CHECK (status IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_status_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_status_check
            CHECK (
                status IN (
                    'To Do',
                    'In Progress',
                    'In Review',
                    'Testing',
                    'Ready for Release',
                    'Done',
                    'Blocked',
                    'On Hold'
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_priority_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_priority_check
            CHECK (
                priority IS NULL OR priority IN (
                    'High',
                    'Medium',
                    'Low'
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_type_check'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_type_check
            CHECK (
                type IS NULL OR type IN (
                    'Story',
                    'Task',
                    'Bug',
                    'Subtask'
                )
            ) NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_org_id_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_org_id_fkey
            FOREIGN KEY (org_id)
            REFERENCES organizations(id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_workspace_org_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_project_org_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_project_org_fkey
            FOREIGN KEY (project_id, org_id)
            REFERENCES projects(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_document_generation_org_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_document_generation_org_fkey
            FOREIGN KEY (document_generation_id, org_id)
            REFERENCES document_generations(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_source_process_org_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_source_process_org_fkey
            FOREIGN KEY (source_process_id, org_id)
            REFERENCES assess_processes(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_source_assessment_org_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_source_assessment_org_fkey
            FOREIGN KEY (source_assessment_id, org_id)
            REFERENCES assessments(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_created_by_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_updated_by_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_updated_by_fkey
            FOREIGN KEY (updated_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_owner_id_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_owner_id_fkey
            FOREIGN KEY (owner_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_assigned_to_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_assigned_to_fkey
            FOREIGN KEY (assigned_to)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'delivery_work_items_reporter_id_fkey'
          AND conrelid = 'delivery_work_items'::regclass
    ) THEN
        ALTER TABLE delivery_work_items
            ADD CONSTRAINT delivery_work_items_reporter_id_fkey
            FOREIGN KEY (reporter_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_work_items_active_org_project_app_id
    ON delivery_work_items(org_id, project_id, app_id)
    WHERE app_id IS NOT NULL
      AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_org_project_status_deleted
    ON delivery_work_items(org_id, project_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_workspace_status_deleted
    ON delivery_work_items(workspace_id, status, deleted_at)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_status_priority_type
    ON delivery_work_items(status, priority, type);

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_document_generation
    ON delivery_work_items(document_generation_id)
    WHERE document_generation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_source_process
    ON delivery_work_items(source_process_id)
    WHERE source_process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_source_assessment
    ON delivery_work_items(source_assessment_id)
    WHERE source_assessment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_created_by
    ON delivery_work_items(created_by)
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_updated_by
    ON delivery_work_items(updated_by)
    WHERE updated_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_owner
    ON delivery_work_items(owner_id)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_assigned_to
    ON delivery_work_items(assigned_to)
    WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_reporter
    ON delivery_work_items(reporter_id)
    WHERE reporter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_work_items_audit_correlation
    ON delivery_work_items(audit_correlation_id)
    WHERE audit_correlation_id IS NOT NULL;

COMMENT ON TABLE delivery_work_items IS 'M5.2g-a first AvalaOS Delivery work-item authority table. Represents governed handoff and work-item records under organization, nullable workspace, and project ownership. This is not generic project-management replacement authority, not promotion of epics, sprints, tasks, comments, activity, or timesheet tables, and not Delivery Pack, Monitor, lineage, handoff, export, storage, Document Vault, provider, seed, backfill, runtime dependency, or hosted-runtime readiness.';
COMMENT ON CONSTRAINT delivery_work_items_id_org_id_key ON delivery_work_items IS 'Composite helper key for same-organization references from later Delivery Pack, Monitor, lineage, handoff, export, or work-item detail authority after AP approval.';
COMMENT ON COLUMN delivery_work_items.workspace_id IS 'Nullable-first workspace ownership input for future workspace-aware RLS. No workspace backfill is performed in M5.2g-a.';
COMMENT ON COLUMN delivery_work_items.project_id IS 'Applied project authority reference. The same-organization foreign key intentionally uses default delete behavior for tenant artifact history.';
COMMENT ON COLUMN delivery_work_items.app_id IS 'Nullable UI/demo compatibility bridge only. It is not tenancy authority, not globally unique, not a Supabase identifier, not a replacement for id, and not sufficient for authorization.';
COMMENT ON COLUMN delivery_work_items.document_generation_id IS 'Optional same-organization document generation source reference. Nullable until AP-approved mapping and adapter work exist.';
COMMENT ON COLUMN delivery_work_items.source_process_id IS 'Optional same-organization Assess process source reference. Nullable until AP-approved mapping and backfill exist.';
COMMENT ON COLUMN delivery_work_items.source_assessment_id IS 'Optional same-organization assessment source reference. Nullable until AP-approved mapping and backfill exist.';
COMMENT ON COLUMN delivery_work_items.status IS 'Initial compatibility status set from inspected runtime and mock values: To Do, In Progress, In Review, Testing, Ready for Release, Done, Blocked, On Hold. This is not final workflow authority.';
COMMENT ON COLUMN delivery_work_items.priority IS 'Initial compatibility priority set from inspected runtime and mock values: High, Medium, Low. This is not final prioritization authority.';
COMMENT ON COLUMN delivery_work_items.type IS 'Initial compatibility type set from inspected runtime and mock values: Story, Task, Bug, Subtask. This is not full agile methodology authority.';
COMMENT ON COLUMN delivery_work_items.source_lineage IS 'Compatibility payload only. It is not durable evidence, approval, lineage, export, storage, review, handoff, or cross-tenant reference authority and must not store secrets, provider keys, service-role values, raw private tokens, personal hosted-project values, or unsupported certification claims.';
COMMENT ON COLUMN delivery_work_items.metadata IS 'Compatibility payload only. Extra assignees, dependencies, subtasks, user stories, ordering, or UI/runtime values remain non-authority until AP approves normalized persistence. Must not store secrets, provider keys, service-role values, raw private tokens, personal hosted-project values, or unsupported certification claims.';
COMMENT ON COLUMN delivery_work_items.audit_correlation_id IS 'Optional safe correlation identifier for later audited workflows. Must not store secret values or personal hosted-project values.';

ALTER TABLE delivery_work_items ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE delivery_work_items IS 'M5.2g-a first AvalaOS Delivery work-item authority table. RLS enabled without policies intentionally fails closed for browser/authenticated access until future AP-approved policies and tests exist. Tenant isolation is not implemented or proven. No epics, sprints, tasks, comments, activity, timesheet, Delivery Pack, Monitor, lineage, handoff, export, storage, Document Vault, provider, seed, backfill, runtime dependency, or hosted-runtime readiness scope is introduced.';
