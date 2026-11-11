-- PR 1D additive hardening: soft-deleted cases and their snapshots are not readable.
-- Rollback is V2 disable/read-only plus a later forward migration; preserve all immutable history.

DROP POLICY IF EXISTS pr1d_cases_read ON public.assess_v2_cases;
CREATE POLICY pr1d_cases_read
ON public.assess_v2_cases
FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND public.has_workspace_capability(workspace_id,org_id,'assess.v2.read')
);

DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT *
    FROM (VALUES
      ('assess_v2_case_versions','pr1d_versions_read'),
      ('assess_v2_primitives','pr1d_primitives_read'),
      ('assess_v2_edges','pr1d_edges_read'),
      ('assess_v2_application_assets','pr1d_assets_read'),
      ('assess_v2_application_interactions','pr1d_interactions_read'),
      ('assess_v2_evidence_links','pr1d_evidence_read'),
      ('assess_v2_decision_versions','pr1d_decisions_read'),
      ('assess_v2_decision_points','pr1d_assess_v2_decision_points_read'),
      ('assess_v2_exception_paths','pr1d_assess_v2_exception_paths_read'),
      ('assess_v2_candidate_evaluations','pr1d_assess_v2_candidate_evaluations_read'),
      ('assess_v2_gate_results','pr1d_assess_v2_gate_results_read'),
      ('assess_v2_control_requirements','pr1d_assess_v2_control_requirements_read'),
      ('assess_v2_modernization_dispositions','pr1d_assess_v2_modernization_dispositions_read')
    ) AS policies(table_name, old_policy_name)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_record.old_policy_name, policy_record.table_name);
    EXECUTE format('DROP POLICY IF EXISTS pr1d_active_case_read ON public.%I', policy_record.table_name);
    EXECUTE format($policy$
      CREATE POLICY pr1d_active_case_read
      ON public.%I
      FOR SELECT TO authenticated
      USING (
        public.has_workspace_capability(workspace_id,org_id,'assess.v2.read')
        AND EXISTS (
          SELECT 1
          FROM public.assess_v2_cases AS active_case
          WHERE active_case.id = %I.case_id
            AND active_case.org_id = %I.org_id
            AND active_case.workspace_id = %I.workspace_id
            AND active_case.deleted_at IS NULL
        )
      )
    $policy$, policy_record.table_name, policy_record.table_name, policy_record.table_name, policy_record.table_name);
  END LOOP;
END
$$;
