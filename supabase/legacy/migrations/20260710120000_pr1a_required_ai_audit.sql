-- PR 1A: canonical required AI/privileged-operation audit authority.
-- This migration is additive, removes known legacy browser policies, and keeps
-- runtime writes service-mediated. It does not add tenant/RBAC/Assess commands.

CREATE TABLE IF NOT EXISTS public.ai_generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    provider_config_id UUID REFERENCES public.ai_provider_configs(id),
    prompt_template_id UUID,
    prompt_version TEXT,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    model TEXT,
    input_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS provider_config_id UUID;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS prompt_template_id UUID;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS job_type TEXT;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'queued';
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS input_refs JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS output_ref JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.ai_generation_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id),
    job_id UUID REFERENCES public.ai_generation_jobs(id) ON DELETE SET NULL,
    provider TEXT NOT NULL,
    model TEXT,
    prompt_template_id UUID,
    prompt_version TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_estimate NUMERIC(12,6),
    output_artifact_type TEXT,
    output_artifact_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS org_id UUID;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS job_id UUID;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS prompt_template_id UUID;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS input_tokens INTEGER DEFAULT 0;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS output_tokens INTEGER DEFAULT 0;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS total_tokens INTEGER DEFAULT 0;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC(12,6);
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS output_artifact_type TEXT;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS output_artifact_id UUID;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.ai_generation_jobs WHERE org_id IS NULL OR user_id IS NULL OR job_type IS NULL OR status IS NULL OR input_refs IS NULL OR output_ref IS NULL OR created_at IS NULL OR updated_at IS NULL) THEN
        RAISE EXCEPTION 'PR1A_PREFLIGHT_AI_JOBS_REQUIRED_FIELDS';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ai_usage_events WHERE org_id IS NULL OR user_id IS NULL OR provider IS NULL OR input_tokens IS NULL OR input_tokens < 0 OR output_tokens IS NULL OR output_tokens < 0 OR total_tokens IS NULL OR total_tokens < 0 OR total_tokens <> input_tokens + output_tokens OR metadata IS NULL OR created_at IS NULL) THEN
        RAISE EXCEPTION 'PR1A_PREFLIGHT_AI_USAGE_REQUIRED_FIELDS';
    END IF;
    IF EXISTS (SELECT 1 FROM public.ai_usage_events usage JOIN public.ai_generation_jobs job ON job.id = usage.job_id WHERE usage.job_id IS NOT NULL AND (job.org_id <> usage.org_id OR job.user_id <> usage.user_id)) THEN
        RAISE EXCEPTION 'PR1A_PREFLIGHT_AI_USAGE_JOB_AUTHORITY_MISMATCH';
    END IF;
END $$;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pr1a_ai_generation_jobs_required_check'
          AND conrelid = 'public.ai_generation_jobs'::regclass
    ) THEN
        ALTER TABLE public.ai_generation_jobs
            ADD CONSTRAINT pr1a_ai_generation_jobs_required_check
            CHECK (
                org_id IS NOT NULL
                AND user_id IS NOT NULL
                AND job_type IS NOT NULL
                AND status IS NOT NULL
                AND input_refs IS NOT NULL
                AND output_ref IS NOT NULL
                AND created_at IS NOT NULL
                AND updated_at IS NOT NULL
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pr1a_ai_generation_jobs_type_check'
          AND conrelid = 'public.ai_generation_jobs'::regclass
    ) THEN
        ALTER TABLE public.ai_generation_jobs
            ADD CONSTRAINT pr1a_ai_generation_jobs_type_check
            CHECK (job_type IN (
                'generate_document',
                'refine_section',
                'test_provider_connection',
                'extract_document_text',
                'export_document',
                'export_decision_pack',
                'other'
            )) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pr1a_ai_generation_jobs_status_check'
          AND conrelid = 'public.ai_generation_jobs'::regclass
    ) THEN
        ALTER TABLE public.ai_generation_jobs
            ADD CONSTRAINT pr1a_ai_generation_jobs_status_check
            CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pr1a_ai_generation_jobs_lifecycle_check'
          AND conrelid = 'public.ai_generation_jobs'::regclass
    ) THEN
        ALTER TABLE public.ai_generation_jobs
            ADD CONSTRAINT pr1a_ai_generation_jobs_lifecycle_check
            CHECK (
                (status IN ('queued', 'cancelled'))
                OR (status = 'running' AND started_at IS NOT NULL AND completed_at IS NULL)
                OR (status = 'succeeded' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_message IS NULL)
                OR (status = 'failed' AND started_at IS NOT NULL AND completed_at IS NOT NULL AND error_message IS NOT NULL)
            ) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pr1a_ai_generation_jobs_error_length_check'
          AND conrelid = 'public.ai_generation_jobs'::regclass
    ) THEN
        ALTER TABLE public.ai_generation_jobs
            ADD CONSTRAINT pr1a_ai_generation_jobs_error_length_check
            CHECK (error_message IS NULL OR length(error_message) <= 600) NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'pr1a_ai_usage_events_required_check'
          AND conrelid = 'public.ai_usage_events'::regclass
    ) THEN
        ALTER TABLE public.ai_usage_events
            ADD CONSTRAINT pr1a_ai_usage_events_required_check
            CHECK (
                org_id IS NOT NULL
                AND user_id IS NOT NULL
                AND provider IS NOT NULL
                AND input_tokens IS NOT NULL AND input_tokens >= 0
                AND output_tokens IS NOT NULL AND output_tokens >= 0
                AND total_tokens IS NOT NULL AND total_tokens >= 0
                AND total_tokens = input_tokens + output_tokens
                AND metadata IS NOT NULL
                AND created_at IS NOT NULL
            ) NOT VALID;
    END IF;
END $$;

ALTER TABLE public.ai_generation_jobs VALIDATE CONSTRAINT pr1a_ai_generation_jobs_required_check;
ALTER TABLE public.ai_generation_jobs VALIDATE CONSTRAINT pr1a_ai_generation_jobs_type_check;
ALTER TABLE public.ai_generation_jobs VALIDATE CONSTRAINT pr1a_ai_generation_jobs_status_check;
ALTER TABLE public.ai_generation_jobs VALIDATE CONSTRAINT pr1a_ai_generation_jobs_lifecycle_check;
ALTER TABLE public.ai_generation_jobs VALIDATE CONSTRAINT pr1a_ai_generation_jobs_error_length_check;
ALTER TABLE public.ai_usage_events VALIDATE CONSTRAINT pr1a_ai_usage_events_required_check;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr1a_ai_generation_jobs_authority_key' AND conrelid = 'public.ai_generation_jobs'::regclass) THEN
        ALTER TABLE public.ai_generation_jobs ADD CONSTRAINT pr1a_ai_generation_jobs_authority_key UNIQUE (id, org_id, user_id);
    END IF;
    ALTER TABLE public.ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_job_id_fkey;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pr1a_ai_usage_events_job_authority_fkey' AND conrelid = 'public.ai_usage_events'::regclass) THEN
        ALTER TABLE public.ai_usage_events ADD CONSTRAINT pr1a_ai_usage_events_job_authority_fkey FOREIGN KEY (job_id, org_id, user_id) REFERENCES public.ai_generation_jobs(id, org_id, user_id) ON DELETE RESTRICT NOT VALID;
    END IF;
END $$;
ALTER TABLE public.ai_usage_events VALIDATE CONSTRAINT pr1a_ai_usage_events_job_authority_fkey;
CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_org_status_created
    ON public.ai_generation_jobs(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generation_jobs_user_created
    ON public.ai_generation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_org_created
    ON public.ai_usage_events(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_events_job
    ON public.ai_usage_events(job_id)
    WHERE job_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pr1a_enforce_ai_job_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'AI audit jobs are immutable and cannot be deleted.';
    END IF;
    IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Terminal AI audit jobs are immutable.';
    END IF;
    IF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid AI audit job transition.';
    END IF;
    IF OLD.status = 'running' AND NEW.status NOT IN ('running', 'succeeded', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid AI audit job transition.';
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pr1a_ai_generation_jobs_transition ON public.ai_generation_jobs;
CREATE TRIGGER trg_pr1a_ai_generation_jobs_transition
BEFORE UPDATE OR DELETE ON public.ai_generation_jobs
FOR EACH ROW EXECUTE FUNCTION public.pr1a_enforce_ai_job_transition();

CREATE OR REPLACE FUNCTION public.pr1a_reject_ai_usage_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'AI usage audit events are immutable.';
END;
$$;
DROP TRIGGER IF EXISTS trg_pr1a_ai_usage_events_immutable ON public.ai_usage_events;
CREATE TRIGGER trg_pr1a_ai_usage_events_immutable BEFORE UPDATE OR DELETE ON public.ai_usage_events FOR EACH ROW EXECUTE FUNCTION public.pr1a_reject_ai_usage_mutation();
-- Remove the known legacy browser policies if that legacy SQL was applied.
DROP POLICY IF EXISTS "Members can read org AI jobs" ON public.ai_generation_jobs;
DROP POLICY IF EXISTS "Members can create org AI jobs" ON public.ai_generation_jobs;
DROP POLICY IF EXISTS "Members can read org AI usage events" ON public.ai_usage_events;
DROP POLICY IF EXISTS "Members can create org AI usage events" ON public.ai_usage_events;

ALTER TABLE public.ai_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ai_generation_jobs IS
    'PR 1A server-mediated required audit lifecycle for privileged AI, extraction, and export operations. Browser policies are intentionally absent.';
COMMENT ON TABLE public.ai_usage_events IS
    'PR 1A server-mediated AI usage telemetry. Required usage-log requests fail closed; supplemental token telemetry may remain best-effort only when a required job audit exists.';
