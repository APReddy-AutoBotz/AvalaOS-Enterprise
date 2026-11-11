-- Disposable upgrade fixture for the relevant legacy AI audit contract.
-- This is test input only and is never a deployment migration.

CREATE TABLE public.ai_generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id),
    provider_config_id UUID REFERENCES public.ai_provider_configs(id),
    prompt_template_id UUID,
    prompt_version TEXT,
    job_type TEXT NOT NULL CHECK (job_type IN (
        'generate_document',
        'refine_section',
        'test_provider_connection',
        'extract_document_text',
        'export_document',
        'export_decision_pack',
        'other'
    )),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    model TEXT,
    input_refs JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.ai_usage_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id),
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

ALTER TABLE public.ai_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read org AI jobs" ON public.ai_generation_jobs
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM public.organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Members can create org AI jobs" ON public.ai_generation_jobs
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM public.organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Members can read org AI usage events" ON public.ai_usage_events
    FOR SELECT USING (
        org_id IN (
            SELECT org_id FROM public.organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "Members can create org AI usage events" ON public.ai_usage_events
    FOR INSERT WITH CHECK (
        org_id IN (
            SELECT org_id FROM public.organization_members
            WHERE user_id = auth.uid() AND status = 'active'
        )
    );
