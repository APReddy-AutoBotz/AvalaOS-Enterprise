-- M5.2c Assess / Govern ownership readiness.
-- Scope: Assess-first persistence and ownership inputs only. This migration
-- promotes Assess draft tables into the migration chain and adds nullable
-- ownership columns needed for future workspace-aware RLS.
--
-- Non-scope: no standalone Govern tables, Decision Pack tables, evidence or
-- assumption authority tables, handoff ledger, audit, Studio, Delivery,
-- Monitor, export, provider ownership columns, seed data, backfill, runtime
-- dependencies, or RLS policies.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS assess_processes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    workspace_id UUID,
    name TEXT NOT NULL,
    description TEXT,
    owner_id UUID,
    department TEXT,
    criticality TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'Not Started',
    template_id TEXT,
    created_by UUID,
    updated_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS criticality TEXT DEFAULT 'Medium';
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Not Started';
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS template_id TEXT;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE assess_processes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    process_id UUID NOT NULL,
    org_id UUID NOT NULL,
    workspace_id UUID,
    status TEXT DEFAULT 'Not Started',
    metadata JSONB DEFAULT '{}'::jsonb,
    responses JSONB DEFAULT '{}'::jsonb,
    evidence_items JSONB DEFAULT '[]'::jsonb,
    assumptions JSONB DEFAULT '[]'::jsonb,
    completion_by_section JSONB DEFAULT '{}'::jsonb,
    review JSONB DEFAULT '{}'::jsonb,
    scores JSONB,
    created_by UUID,
    updated_by UUID,
    reviewer_id UUID,
    approver_id UUID,
    approved_by UUID,
    rejected_by UUID,
    audit_correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS process_id UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'Not Started';
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS responses JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS evidence_items JSONB DEFAULT '[]'::jsonb;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assumptions JSONB DEFAULT '[]'::jsonb;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS completion_by_section JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS review JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS scores JSONB;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS reviewer_id UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS approver_id UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS approved_by UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS rejected_by UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS audit_correlation_id TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS assessment_review_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    workspace_id UUID,
    assessment_id UUID NOT NULL,
    process_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL,
    section_key TEXT,
    reason TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS workspace_id UUID;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS assessment_id UUID;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS process_id UUID;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS actor_id UUID;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS section_key TEXT;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE assessment_review_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_id_org_id_key'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_id_org_id_key UNIQUE (id, org_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_id_org_id_key'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_id_org_id_key UNIQUE (id, org_id);
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_org_id_required_check'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_org_id_required_check
            CHECK (org_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_name_required_check'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_name_required_check
            CHECK (name IS NOT NULL AND length(btrim(name)) > 0) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_status_check'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_status_check
            CHECK (
                status IS NULL OR status IN (
                    'Not Started',
                    'Draft',
                    'Ready for Review',
                    'In Review',
                    'Changes Requested',
                    'Approved',
                    'Rejected',
                    'Handed Off to Docs',
                    'Handed Off to Delivery',
                    'Archived',
                    'Recalculation Required',
                    'Completed'
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_org_id_required_check'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_org_id_required_check
            CHECK (org_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_process_id_required_check'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_process_id_required_check
            CHECK (process_id IS NOT NULL) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_status_check'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_status_check
            CHECK (
                status IS NULL OR status IN (
                    'Not Started',
                    'Draft',
                    'Ready for Review',
                    'In Review',
                    'Changes Requested',
                    'Approved',
                    'Rejected',
                    'Handed Off to Docs',
                    'Handed Off to Delivery',
                    'Archived',
                    'Recalculation Required',
                    'Completed'
                )
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_required_columns_check'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_required_columns_check
            CHECK (
                org_id IS NOT NULL
                AND assessment_id IS NOT NULL
                AND process_id IS NOT NULL
                AND actor_id IS NOT NULL
                AND event_type IS NOT NULL
                AND status IS NOT NULL
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_event_type_check'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_event_type_check
            CHECK (
                event_type IN (
                    'Comment',
                    'Change Request',
                    'Approval',
                    'Rejection',
                    'Override',
                    'Handoff',
                    'Status Change'
                )
            ) NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_org_id_fkey'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_org_id_fkey
            FOREIGN KEY (org_id)
            REFERENCES organizations(id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_workspace_org_fkey'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_owner_id_fkey'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_owner_id_fkey
            FOREIGN KEY (owner_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_created_by_fkey'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assess_processes_updated_by_fkey'
          AND conrelid = 'assess_processes'::regclass
    ) THEN
        ALTER TABLE assess_processes
            ADD CONSTRAINT assess_processes_updated_by_fkey
            FOREIGN KEY (updated_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_org_id_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_org_id_fkey
            FOREIGN KEY (org_id)
            REFERENCES organizations(id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_workspace_org_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_process_org_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_process_org_fkey
            FOREIGN KEY (process_id, org_id)
            REFERENCES assess_processes(id, org_id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_created_by_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_created_by_fkey
            FOREIGN KEY (created_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_updated_by_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_updated_by_fkey
            FOREIGN KEY (updated_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_reviewer_id_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_reviewer_id_fkey
            FOREIGN KEY (reviewer_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_approver_id_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_approver_id_fkey
            FOREIGN KEY (approver_id)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_approved_by_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_approved_by_fkey
            FOREIGN KEY (approved_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessments_rejected_by_fkey'
          AND conrelid = 'assessments'::regclass
    ) THEN
        ALTER TABLE assessments
            ADD CONSTRAINT assessments_rejected_by_fkey
            FOREIGN KEY (rejected_by)
            REFERENCES profiles(id)
            ON DELETE SET NULL
            NOT VALID;
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_org_id_fkey'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_org_id_fkey
            FOREIGN KEY (org_id)
            REFERENCES organizations(id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_workspace_org_fkey'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_workspace_org_fkey
            FOREIGN KEY (workspace_id, org_id)
            REFERENCES workspaces(id, org_id)
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_assessment_org_fkey'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_assessment_org_fkey
            FOREIGN KEY (assessment_id, org_id)
            REFERENCES assessments(id, org_id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_process_org_fkey'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_process_org_fkey
            FOREIGN KEY (process_id, org_id)
            REFERENCES assess_processes(id, org_id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'assessment_review_events_actor_id_fkey'
          AND conrelid = 'assessment_review_events'::regclass
    ) THEN
        ALTER TABLE assessment_review_events
            ADD CONSTRAINT assessment_review_events_actor_id_fkey
            FOREIGN KEY (actor_id)
            REFERENCES profiles(id)
            NOT VALID;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assess_processes_org_status_deleted
    ON assess_processes(org_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_assess_processes_workspace_status_deleted
    ON assess_processes(workspace_id, status, deleted_at)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assess_processes_owner
    ON assess_processes(owner_id)
    WHERE owner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_org_status_deleted
    ON assessments(org_id, status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_assessments_workspace_status_deleted
    ON assessments(workspace_id, status, deleted_at)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_process
    ON assessments(process_id);

CREATE INDEX IF NOT EXISTS idx_assessments_reviewer
    ON assessments(reviewer_id)
    WHERE reviewer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_approver
    ON assessments(approver_id)
    WHERE approver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_audit_correlation
    ON assessments(audit_correlation_id)
    WHERE audit_correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessment_review_events_org_assessment_created
    ON assessment_review_events(org_id, assessment_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_review_events_workspace_created
    ON assessment_review_events(workspace_id, created_at DESC)
    WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessment_review_events_process_created
    ON assessment_review_events(process_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_review_events_actor_created
    ON assessment_review_events(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_review_events_correlation
    ON assessment_review_events(correlation_id)
    WHERE correlation_id IS NOT NULL;

COMMENT ON TABLE assess_processes IS 'M5.2c Assess-first persistence table promoted from draft schema. Carries nullable workspace ownership for future RLS readiness. No seed data, backfill, runtime dependency, or RLS policies are introduced.';
COMMENT ON COLUMN assess_processes.workspace_id IS 'Nullable-first workspace ownership input for future workspace-aware RLS. No backfill is performed in M5.2c.';
COMMENT ON COLUMN assess_processes.owner_id IS 'Business owner profile reference for future role and actor-aware policy design.';
COMMENT ON TABLE assessments IS 'M5.2c Assess-first assessment persistence table promoted from draft schema. Decision Pack and Govern remain runtime-derived; no standalone Govern persistence is created.';
COMMENT ON COLUMN assessments.workspace_id IS 'Nullable-first workspace ownership input for future workspace-aware RLS. No backfill is performed in M5.2c.';
COMMENT ON COLUMN assessments.evidence_items IS 'Embedded evidence references only. M5.2c does not create standalone evidence authority tables and must not store secret values.';
COMMENT ON COLUMN assessments.assumptions IS 'Embedded assessment assumptions only. M5.2c does not create standalone assumption authority tables.';
COMMENT ON COLUMN assessments.scores IS 'Deterministic scoring output, including runtime-derived Decision Pack/Handoff Pack payloads. M5.2c does not create standalone Decision Pack or Govern persistence.';
COMMENT ON COLUMN assessments.audit_correlation_id IS 'Optional safe correlation identifier for later audited server-side workflows. Must not store secret values or personal hosted-project values.';
COMMENT ON TABLE assessment_review_events IS 'M5.2c Assess review event stream for future workspace-aware RLS and append-oriented governance. RLS is enabled without policies; no tenant isolation is proven in this milestone.';
COMMENT ON COLUMN assessment_review_events.workspace_id IS 'Nullable-first workspace ownership input for future workspace-aware RLS. No backfill is performed in M5.2c.';
COMMENT ON COLUMN assessment_review_events.payload IS 'Structured review metadata only. Payloads must not contain secrets, provider keys, service-role values, raw private tokens, or personal hosted-project values.';
COMMENT ON COLUMN assessment_review_events.correlation_id IS 'Optional safe correlation identifier for later audit linkage. Must not store secret values.';

ALTER TABLE assess_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_review_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE assess_processes IS 'M5.2c Assess-first persistence table. RLS enabled without policies intentionally fails closed for browser/authenticated access until M5.3a policies and tests are approved.';
COMMENT ON TABLE assessments IS 'M5.2c Assess-first assessment persistence table. RLS enabled without policies intentionally fails closed; standalone Govern and Decision Pack persistence remains deferred.';
COMMENT ON TABLE assessment_review_events IS 'M5.2c Assess review event table. RLS enabled without policies intentionally fails closed; tenant isolation is not implemented or proven in M5.2c.';
