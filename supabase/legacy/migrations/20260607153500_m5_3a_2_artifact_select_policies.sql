-- M5.3a-2 artifact SELECT policy implementation.
-- Scope: SELECT-only RLS policies for six applied artifact authority tables.
-- No helper changes, permission helpers, mutation policies, schema changes,
-- seed data, backfill, constraint validation, runtime behavior, hosted target
-- values, or secret values are introduced.

ALTER TABLE public.assess_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_work_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
    public.assess_processes,
    public.assessments,
    public.assessment_review_events,
    public.projects,
    public.document_generations,
    public.delivery_work_items
FROM PUBLIC;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE
            public.assess_processes,
            public.assessments,
            public.assessment_review_events,
            public.projects,
            public.document_generations,
            public.delivery_work_items
        FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
            public.assess_processes,
            public.assessments,
            public.assessment_review_events,
            public.projects,
            public.document_generations,
            public.delivery_work_items
        FROM authenticated;

        GRANT SELECT ON TABLE
            public.assess_processes,
            public.assessments,
            public.assessment_review_events,
            public.projects,
            public.document_generations,
            public.delivery_work_items
        TO authenticated;
    END IF;
END $$;

DROP POLICY IF EXISTS m5_3a_2_assess_processes_select_workspace_member ON public.assess_processes;
CREATE POLICY m5_3a_2_assess_processes_select_workspace_member
    ON public.assess_processes
    FOR SELECT
    TO authenticated
    USING (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
    );

DROP POLICY IF EXISTS m5_3a_2_assessments_select_workspace_member ON public.assessments;
CREATE POLICY m5_3a_2_assessments_select_workspace_member
    ON public.assessments
    FOR SELECT
    TO authenticated
    USING (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
        AND process_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.assess_processes AS parent_process
            WHERE parent_process.id = assessments.process_id
              AND parent_process.org_id = assessments.org_id
              AND parent_process.workspace_id = assessments.workspace_id
              AND parent_process.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS m5_3a_2_assessment_review_events_select_workspace_member ON public.assessment_review_events;
CREATE POLICY m5_3a_2_assessment_review_events_select_workspace_member
    ON public.assessment_review_events
    FOR SELECT
    TO authenticated
    USING (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
        AND assessment_id IS NOT NULL
        AND process_id IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM public.assessments AS owning_assessment
            WHERE owning_assessment.id = assessment_review_events.assessment_id
              AND owning_assessment.org_id = assessment_review_events.org_id
              AND owning_assessment.workspace_id = assessment_review_events.workspace_id
              AND owning_assessment.deleted_at IS NULL
        )
        AND EXISTS (
            SELECT 1
            FROM public.assess_processes AS owning_process
            WHERE owning_process.id = assessment_review_events.process_id
              AND owning_process.org_id = assessment_review_events.org_id
              AND owning_process.workspace_id = assessment_review_events.workspace_id
              AND owning_process.deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS m5_3a_2_projects_select_workspace_member ON public.projects;
CREATE POLICY m5_3a_2_projects_select_workspace_member
    ON public.projects
    FOR SELECT
    TO authenticated
    USING (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
        AND (
            source_process_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.assess_processes AS source_process
                WHERE source_process.id = projects.source_process_id
                  AND source_process.org_id = projects.org_id
                  AND source_process.workspace_id = projects.workspace_id
                  AND source_process.deleted_at IS NULL
            )
        )
        AND (
            source_assessment_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.assessments AS source_assessment
                WHERE source_assessment.id = projects.source_assessment_id
                  AND source_assessment.org_id = projects.org_id
                  AND source_assessment.workspace_id = projects.workspace_id
                  AND source_assessment.deleted_at IS NULL
            )
        )
    );

DROP POLICY IF EXISTS m5_3a_2_document_generations_select_workspace_member ON public.document_generations;
CREATE POLICY m5_3a_2_document_generations_select_workspace_member
    ON public.document_generations
    FOR SELECT
    TO authenticated
    USING (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND project_id IS NOT NULL
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
        AND EXISTS (
            SELECT 1
            FROM public.projects AS owning_project
            WHERE owning_project.id = document_generations.project_id
              AND owning_project.org_id = document_generations.org_id
              AND owning_project.workspace_id = document_generations.workspace_id
              AND owning_project.deleted_at IS NULL
        )
        AND (
            source_process_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.assess_processes AS source_process
                WHERE source_process.id = document_generations.source_process_id
                  AND source_process.org_id = document_generations.org_id
                  AND source_process.workspace_id = document_generations.workspace_id
                  AND source_process.deleted_at IS NULL
            )
        )
        AND (
            source_assessment_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.assessments AS source_assessment
                WHERE source_assessment.id = document_generations.source_assessment_id
                  AND source_assessment.org_id = document_generations.org_id
                  AND source_assessment.workspace_id = document_generations.workspace_id
                  AND source_assessment.deleted_at IS NULL
            )
        )
    );

DROP POLICY IF EXISTS m5_3a_2_delivery_work_items_select_workspace_member ON public.delivery_work_items;
CREATE POLICY m5_3a_2_delivery_work_items_select_workspace_member
    ON public.delivery_work_items
    FOR SELECT
    TO authenticated
    USING (
        org_id IS NOT NULL
        AND workspace_id IS NOT NULL
        AND project_id IS NOT NULL
        AND deleted_at IS NULL
        AND public.is_active_workspace_member(workspace_id, org_id)
        AND EXISTS (
            SELECT 1
            FROM public.projects AS owning_project
            WHERE owning_project.id = delivery_work_items.project_id
              AND owning_project.org_id = delivery_work_items.org_id
              AND owning_project.workspace_id = delivery_work_items.workspace_id
              AND owning_project.deleted_at IS NULL
        )
        AND (
            document_generation_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.document_generations AS source_document
                WHERE source_document.id = delivery_work_items.document_generation_id
                  AND source_document.org_id = delivery_work_items.org_id
                  AND source_document.workspace_id = delivery_work_items.workspace_id
                  AND source_document.deleted_at IS NULL
            )
        )
        AND (
            source_process_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.assess_processes AS source_process
                WHERE source_process.id = delivery_work_items.source_process_id
                  AND source_process.org_id = delivery_work_items.org_id
                  AND source_process.workspace_id = delivery_work_items.workspace_id
                  AND source_process.deleted_at IS NULL
            )
        )
        AND (
            source_assessment_id IS NULL
            OR EXISTS (
                SELECT 1
                FROM public.assessments AS source_assessment
                WHERE source_assessment.id = delivery_work_items.source_assessment_id
                  AND source_assessment.org_id = delivery_work_items.org_id
                  AND source_assessment.workspace_id = delivery_work_items.workspace_id
                  AND source_assessment.deleted_at IS NULL
            )
        )
    );

COMMENT ON POLICY m5_3a_2_assess_processes_select_workspace_member ON public.assess_processes IS 'M5.3a-2 SELECT-only artifact policy. Requires non-null org/workspace, active workspace membership, and non-deleted process row. Source references and JSON payloads are not authorization inputs. No mutation, export, provider, service-role, hosted-readiness, or production-readiness scope.';
COMMENT ON POLICY m5_3a_2_assessments_select_workspace_member ON public.assessments IS 'M5.3a-2 SELECT-only artifact policy. Requires non-null org/workspace, active workspace membership, non-deleted assessment row, and same-workspace non-deleted parent process. Embedded evidence, assumptions, review, scores, and other JSON payloads are not authorization inputs. No mutation or hosted-readiness scope.';
COMMENT ON POLICY m5_3a_2_assessment_review_events_select_workspace_member ON public.assessment_review_events IS 'M5.3a-2 SELECT-only artifact policy. Review event table has no deleted_at column; visibility requires non-null org/workspace, active workspace membership, and same-workspace non-deleted owning assessment and process. Payload and source references are not authorization inputs. No review mutation or hosted-readiness scope.';
COMMENT ON POLICY m5_3a_2_projects_select_workspace_member ON public.projects IS 'M5.3a-2 SELECT-only artifact policy. Requires non-null org/workspace, active workspace membership, non-deleted project row, and same-workspace populated Assess source references. Metadata and source references are not authorization inputs. No delivery mutation or hosted-readiness scope.';
COMMENT ON POLICY m5_3a_2_document_generations_select_workspace_member ON public.document_generations IS 'M5.3a-2 SELECT-only artifact policy. Requires non-null org/workspace/project, active workspace membership, non-deleted document generation row, same-workspace non-deleted project, and same-workspace populated Assess source references. Artifacts JSONB is payload only. No export/storage/review mutation or hosted-readiness scope.';
COMMENT ON POLICY m5_3a_2_delivery_work_items_select_workspace_member ON public.delivery_work_items IS 'M5.3a-2 SELECT-only artifact policy. Requires non-null org/workspace/project, active workspace membership, non-deleted work item row, same-workspace non-deleted project, and same-workspace populated document/source references. Metadata and source_lineage JSONB are payload only. No delivery mutation, export, hosted-readiness, or production-readiness scope.';
