-- Bind Govern authorization, projection, persistence, and Studio handoff to the
-- immutable Assess V2 decision. Installation is intentionally maintenance-only:
-- command traffic must already be drained behind the Assess V2 read-only gate.
-- The single DO statement makes source checks, history checks, helper creation,
-- function replacement, and current hosted-pilot marker advancement atomic.
DO $govern_action_authority$
DECLARE
  marker public.hosted_pilot_environment_identity;
  runtime_control public.assess_v2_runtime_control;
  marker_constraint text;
  exercise_constraint text;
  projection_definition text;
  command_definition text;
  handoff_definition text;
  final_activation_definition text;
  bootstrap_definition text;
  assert_marker_definition text;
  brd_v3_activation_definition text;
  decision_record record;
  old_projection text := 'COALESCE(g.actions,d.output_snapshot->''actionControls'',''[]'')';
  new_projection text := 'public.pr1e_normalize_govern_actions(d.input_snapshot,d.output_snapshot)';
  old_command_declaration text := 'v_reviewer_auth bigint;v_material_claims jsonb;v_required_controls jsonb;';
  new_command_declaration text := 'v_reviewer_auth bigint;v_material_claims jsonb;v_required_controls jsonb;v_actions jsonb;';
  old_command_separation text := 'IF EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(d.output_snapshot->''actionControls'',''[]'')) x WHERE x->>''category''=''approval-bound'') AND rr.reviewer_id=p_actor_id THEN RETURN public.pr1e_review_result(''INVALID_COMMAND'');END IF;';
  new_command_separation text := 'BEGIN v_actions:=public.pr1e_normalize_govern_actions(d.input_snapshot,d.output_snapshot);EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE ''%PR1E_GOVERN_ACTION_AUTHORITY_INVALID%'' THEN RETURN public.pr1e_review_result(''INVALID_COMMAND'');END IF;RAISE;END; IF rr.reviewer_id=p_actor_id AND public.pr1e_govern_requires_independent_resolver(d.input_snapshot,d.output_snapshot) THEN RETURN public.pr1e_review_result(''INVALID_COMMAND'');END IF;';
  old_command_persistence text := 'COALESCE(d.output_snapshot->''actionControls'',''[]''),p_payload->''controlDispositions''';
  new_command_persistence text := 'v_actions,p_payload->''controlDispositions''';
  old_command_handoff text := 'IF rr.id IS NULL OR g.id IS NULL OR c.status<>''govern_resolved'' OR jsonb_array_length(g.required_controls)=0';
  new_command_handoff text := 'IF rr.id IS NULL OR g.id IS NULL OR c.status<>''govern_resolved'' OR NOT public.pr1e_govern_actions_match(d.input_snapshot,d.output_snapshot,g.actions) OR (g.resolver_id=rr.reviewer_id AND public.pr1e_govern_requires_independent_resolver(d.input_snapshot,d.output_snapshot)) OR jsonb_array_length(g.required_controls)=0';
  old_not_equal text := 'marker.migration_tip<>''20261008022445''';
  new_not_equal text := 'marker.migration_tip<>''20261009162752''';
  old_equal text := 'marker.migration_tip=''20261008022445''';
  new_equal text := 'marker.migration_tip=''20261009162752''';
  old_assert text := 'marker.migration_tip = ''20261008022445''';
  new_assert text := 'marker.migration_tip = ''20261009162752''';
BEGIN
  LOCK TABLE public.assess_v2_runtime_control IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT runtime_control
  FROM public.assess_v2_runtime_control WHERE singleton FOR UPDATE;
  IF NOT runtime_control.read_only THEN
    RAISE EXCEPTION 'PR1E_GOVERN_ACTION_MAINTENANCE_REQUIRED';
  END IF;

  LOCK TABLE public.assess_v2_decision_versions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.assess_v2_review_assignments IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.assess_v2_review_resolutions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.assess_v2_govern_resolutions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.assess_v2_studio_handoffs IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO STRICT marker
  FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT marker_constraint
  FROM pg_constraint
  WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
    AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT exercise_constraint
  FROM pg_constraint
  WHERE conrelid='public.pr_c_controlled_human_exercises'::regclass
    AND conname='pr_c_controlled_human_exercises_migration_tip_check';
  SELECT replace(pg_get_functiondef('public.pr1e_review_projection(uuid,uuid,uuid,uuid)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT projection_definition;
  SELECT replace(pg_get_functiondef('public.pr1e_review_command(text,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT command_definition;
  SELECT replace(pg_get_functiondef('public.pr1e_handoff_assess_v2_studio(uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,bigint,jsonb)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT handoff_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_final_continuation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT final_activation_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT bootstrap_definition;
  SELECT replace(pg_get_functiondef('public.pr_c_controlled_human_assert_marker()'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT assert_marker_definition;
  SELECT replace(pg_get_functiondef('public.synthetic_ai_campaign_activate_brd_v3_quality_validation(uuid,uuid,uuid,bigint,text,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,uuid,text,uuid,uuid,uuid,uuid,text,text,integer)'::regprocedure),chr(13)||chr(10),chr(10))
    INTO STRICT brd_v3_activation_definition;

  IF marker.product_key<>'avalaos-core'
    OR marker.environment_class<>'hosted_nonproduction_pilot'
    OR marker.schema_contract<>'hosted-pilot-2026-08'
    OR marker.migration_tip<>'20261008022445'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
    OR marker_constraint<>'(migration_tip = ''20261008022445''::text)'
    OR exercise_constraint<>'(migration_tip = ANY (ARRAY[''20260904120000''::text, ''20260924113000''::text, ''20260926053818''::text, ''20260928060000''::text, ''20261003015246''::text, ''20261003055918''::text, ''20261003123459''::text, ''20261003150800''::text, ''20261004025101''::text, ''20261004112232''::text, ''20261008022445''::text]))'
    OR (length(projection_definition)-length(replace(projection_definition,old_projection,'')))/length(old_projection)<>1
    OR (length(command_definition)-length(replace(command_definition,old_command_declaration,'')))/length(old_command_declaration)<>1
    OR (length(command_definition)-length(replace(command_definition,old_command_separation,'')))/length(old_command_separation)<>1
    OR (length(command_definition)-length(replace(command_definition,old_command_persistence,'')))/length(old_command_persistence)<>1
    OR (length(command_definition)-length(replace(command_definition,old_command_handoff,'')))/length(old_command_handoff)<>1
    OR position('PERFORM public.pr1e_assert_current_approved_review_authority' in handoff_definition)=0
    OR position('RETURN public.pr1e_review_command' in handoff_definition)=0
    OR (length(final_activation_definition)-length(replace(final_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
    OR (length(bootstrap_definition)-length(replace(bootstrap_definition,old_equal,'')))/length(old_equal)<>1
    OR (length(assert_marker_definition)-length(replace(assert_marker_definition,old_assert,'')))/length(old_assert)<>1
    OR (length(brd_v3_activation_definition)-length(replace(brd_v3_activation_definition,old_not_equal,'')))/length(old_not_equal)<>1
    OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises WHERE lifecycle<>'deprovisioned')
  THEN
    RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_SOURCE_MISMATCH';
  END IF;

    CREATE OR REPLACE FUNCTION public.pr1e_normalize_govern_actions(
      p_input_snapshot jsonb,
      p_output_snapshot jsonb
    ) RETURNS jsonb
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path=pg_catalog
    AS $function$
    DECLARE
      input_interactions jsonb;
      decisions jsonb;
      legacy_actions jsonb;
      normalized jsonb;
    BEGIN
      IF jsonb_typeof(p_input_snapshot) IS DISTINCT FROM 'object'
        OR jsonb_typeof(p_output_snapshot) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';
      END IF;

      IF p_output_snapshot ? 'interactionDecisions' THEN
        IF p_output_snapshot ? 'actionControls'
          OR jsonb_typeof(p_input_snapshot->'interactions') IS DISTINCT FROM 'array'
          OR jsonb_typeof(p_output_snapshot->'interactionDecisions') IS DISTINCT FROM 'array'
        THEN RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';END IF;
        input_interactions:=p_input_snapshot->'interactions';
        decisions:=p_output_snapshot->'interactionDecisions';
        IF jsonb_array_length(input_interactions)<>jsonb_array_length(decisions)
          OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(input_interactions) input
            WHERE jsonb_typeof(input) IS DISTINCT FROM 'object'
              OR COALESCE(input->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              OR COALESCE(input->>'mode','') NOT IN('read','write','event','ui','operational')
              OR jsonb_typeof(input->'facts') IS DISTINCT FROM 'object'
              OR jsonb_typeof(input->'facts'->'highImpact') IS DISTINCT FROM 'boolean'
              OR jsonb_typeof(input->'facts'->'financialAction') IS DISTINCT FROM 'boolean'
          )
          OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(input_interactions) input
            GROUP BY lower(input->>'id') HAVING count(*)<>1
          )
          OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(decisions) decision
            WHERE jsonb_typeof(decision) IS DISTINCT FROM 'object'
              OR COALESCE(decision->>'interactionId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              OR jsonb_typeof(decision->'allowedActions') IS DISTINCT FROM 'array'
              OR jsonb_typeof(decision->'approvalBoundActions') IS DISTINCT FROM 'array'
              OR jsonb_typeof(decision->'prohibitedActions') IS DISTINCT FROM 'array'
              OR jsonb_array_length(CASE WHEN jsonb_typeof(decision->'allowedActions')='array' THEN decision->'allowedActions' ELSE '[]'::jsonb END)
                + jsonb_array_length(CASE WHEN jsonb_typeof(decision->'approvalBoundActions')='array' THEN decision->'approvalBoundActions' ELSE '[]'::jsonb END)
                + jsonb_array_length(CASE WHEN jsonb_typeof(decision->'prohibitedActions')='array' THEN decision->'prohibitedActions' ELSE '[]'::jsonb END)=0
              OR EXISTS(
                SELECT 1 FROM jsonb_array_elements(
                  (CASE WHEN jsonb_typeof(decision->'allowedActions')='array' THEN decision->'allowedActions' ELSE '[]'::jsonb END)
                  ||(CASE WHEN jsonb_typeof(decision->'approvalBoundActions')='array' THEN decision->'approvalBoundActions' ELSE '[]'::jsonb END)
                  ||(CASE WHEN jsonb_typeof(decision->'prohibitedActions')='array' THEN decision->'prohibitedActions' ELSE '[]'::jsonb END)
                ) action
                WHERE jsonb_typeof(action) IS DISTINCT FROM 'string' OR btrim(COALESCE(action#>>'{}',''))=''
              )
              OR EXISTS(
                SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(decision->'allowedActions')='array' THEN decision->'allowedActions' ELSE '[]'::jsonb END) action
                GROUP BY action HAVING count(*)<>1
              )
              OR EXISTS(
                SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(decision->'approvalBoundActions')='array' THEN decision->'approvalBoundActions' ELSE '[]'::jsonb END) action
                GROUP BY action HAVING count(*)<>1
              )
              OR EXISTS(
                SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(decision->'prohibitedActions')='array' THEN decision->'prohibitedActions' ELSE '[]'::jsonb END) action
                GROUP BY action HAVING count(*)<>1
              )
          )
          OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(decisions) decision
            GROUP BY lower(decision->>'interactionId') HAVING count(*)<>1
          )
          OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(input_interactions) input
            WHERE (SELECT count(*) FROM jsonb_array_elements(decisions) decision
                   WHERE lower(decision->>'interactionId')=lower(input->>'id'))<>1
          )
          OR EXISTS(
            SELECT 1 FROM jsonb_array_elements(decisions) decision
            WHERE (SELECT count(*) FROM jsonb_array_elements(input_interactions) input
                   WHERE lower(input->>'id')=lower(decision->>'interactionId'))<>1
          )
        THEN RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';END IF;

        SELECT COALESCE(jsonb_agg(
          jsonb_build_object(
            'id',(input->>'id')||':'||category.category||':'||action.ordinality,
            'actionId',(input->>'id')||':'||category.category||':'||action.ordinality,
            'label',action.value#>>'{}',
            'category',category.category,
            'highImpact',input->>'mode'='write' AND (input->'facts'->>'highImpact')::boolean,
            'financial',input->>'mode'='write' AND (input->'facts'->>'financialAction')::boolean,
            'externalCommunication',false,
            'irreversible',false
          ) ORDER BY input_ordinality,category.category_ordinality,action.ordinality
        ),'[]'::jsonb) INTO normalized
        FROM jsonb_array_elements(input_interactions) WITH ORDINALITY inputs(input,input_ordinality)
        JOIN LATERAL (
          SELECT decision FROM jsonb_array_elements(decisions) decision
          WHERE lower(decision->>'interactionId')=lower(input->>'id')
        ) matched ON true
        CROSS JOIN LATERAL (
          VALUES
            ('allowed',1,matched.decision->'allowedActions'),
            ('approval-bound',2,matched.decision->'approvalBoundActions'),
            ('prohibited',3,matched.decision->'prohibitedActions')
        ) category(category,category_ordinality,actions)
        CROSS JOIN LATERAL jsonb_array_elements(category.actions) WITH ORDINALITY action(value,ordinality);
        RETURN normalized;
      ELSIF p_output_snapshot ? 'actionControls' THEN
        IF jsonb_typeof(p_output_snapshot->'actionControls') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';
        END IF;
        legacy_actions:=p_output_snapshot->'actionControls';
        IF EXISTS(
          SELECT 1 FROM jsonb_array_elements(legacy_actions) action
          WHERE jsonb_typeof(action) IS DISTINCT FROM 'object'
            OR jsonb_typeof(action->'actionId') IS DISTINCT FROM 'string'
            OR btrim(COALESCE(action->>'actionId',''))=''
            OR jsonb_typeof(action->'category') IS DISTINCT FROM 'string'
            OR COALESCE(action->>'category','') NOT IN('allowed','approval-bound','evidence-bound','prohibited')
            OR (action ? 'highImpact' AND jsonb_typeof(action->'highImpact') IS DISTINCT FROM 'boolean')
            OR (action ? 'financial' AND jsonb_typeof(action->'financial') IS DISTINCT FROM 'boolean')
            OR (action ? 'externalCommunication' AND jsonb_typeof(action->'externalCommunication') IS DISTINCT FROM 'boolean')
            OR (action ? 'irreversible' AND jsonb_typeof(action->'irreversible') IS DISTINCT FROM 'boolean')
            OR (action ? 'id' AND (jsonb_typeof(action->'id') IS DISTINCT FROM 'string' OR btrim(COALESCE(action->>'id',''))=''))
            OR (action ? 'label' AND (jsonb_typeof(action->'label') IS DISTINCT FROM 'string' OR btrim(COALESCE(action->>'label',''))=''))
        ) OR EXISTS(
          SELECT 1 FROM jsonb_array_elements(legacy_actions) action
          GROUP BY action->>'actionId' HAVING count(*)<>1
        ) THEN RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';END IF;
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id',COALESCE(NULLIF(btrim(action->>'id'),''),action->>'actionId'),
          'actionId',action->>'actionId',
          'label',COALESCE(NULLIF(btrim(action->>'label'),''),action->>'actionId'),
          'category',action->>'category',
          'highImpact',COALESCE((action->>'highImpact')::boolean,false),
          'financial',COALESCE((action->>'financial')::boolean,false),
          'externalCommunication',COALESCE((action->>'externalCommunication')::boolean,false),
          'irreversible',COALESCE((action->>'irreversible')::boolean,false)
        ) ORDER BY ordinality),'[]'::jsonb) INTO normalized
        FROM jsonb_array_elements(legacy_actions) WITH ORDINALITY legacy(action,ordinality);
        RETURN normalized;
      END IF;
      RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';
    END
    $function$;

    CREATE OR REPLACE FUNCTION public.pr1e_govern_actions_match(
      p_input_snapshot jsonb,
      p_output_snapshot jsonb,
      p_stored_actions jsonb
    ) RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path=pg_catalog
    AS $function$
    BEGIN
      IF jsonb_typeof(p_stored_actions) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'PR1E_GOVERN_ACTION_AUTHORITY_INVALID';
      END IF;
      IF p_output_snapshot ? 'interactionDecisions' THEN
        RETURN p_stored_actions=public.pr1e_normalize_govern_actions(p_input_snapshot,p_output_snapshot);
      END IF;
      RETURN public.pr1e_normalize_govern_actions(
        '{}'::jsonb,
        jsonb_build_object('actionControls',p_stored_actions)
      )=public.pr1e_normalize_govern_actions(p_input_snapshot,p_output_snapshot);
    END
    $function$;

    CREATE OR REPLACE FUNCTION public.pr1e_govern_requires_independent_resolver(
      p_input_snapshot jsonb,
      p_output_snapshot jsonb
    ) RETURNS boolean
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path=pg_catalog
    AS $function$
    DECLARE normalized jsonb;
    BEGIN
      normalized:=public.pr1e_normalize_govern_actions(p_input_snapshot,p_output_snapshot);
      IF p_output_snapshot ? 'interactionDecisions' THEN
        RETURN EXISTS(
          SELECT 1
          FROM jsonb_array_elements(p_input_snapshot->'interactions') input
          JOIN jsonb_array_elements(p_output_snapshot->'interactionDecisions') decision
            ON lower(decision->>'interactionId')=lower(input->>'id')
          WHERE input->>'mode'='write'
            AND ((input->'facts'->>'highImpact')::boolean OR (input->'facts'->>'financialAction')::boolean)
        );
      END IF;
      RETURN EXISTS(SELECT 1 FROM jsonb_array_elements(normalized) action
        WHERE action->>'category'='approval-bound');
    END
    $function$;

  FOR decision_record IN
    SELECT d.id,d.input_snapshot,d.output_snapshot
    FROM public.assess_v2_decision_versions d
    ORDER BY d.id
  LOOP
    BEGIN
      PERFORM public.pr1e_normalize_govern_actions(decision_record.input_snapshot,decision_record.output_snapshot);
      IF EXISTS(
        SELECT 1 FROM public.assess_v2_govern_resolutions g
        WHERE g.decision_id=decision_record.id
          AND NOT public.pr1e_govern_actions_match(decision_record.input_snapshot,decision_record.output_snapshot,g.actions)
      ) OR EXISTS(
        SELECT 1 FROM public.assess_v2_govern_resolutions g
        JOIN public.assess_v2_review_resolutions rr ON rr.id=g.review_resolution_id
        WHERE g.decision_id=decision_record.id
          AND g.resolver_id=rr.reviewer_id
          AND public.pr1e_govern_requires_independent_resolver(decision_record.input_snapshot,decision_record.output_snapshot)
      ) OR EXISTS(
        SELECT 1 FROM public.assess_v2_studio_handoffs h
        WHERE h.decision_id=decision_record.id
          AND NOT public.pr1e_govern_actions_match(decision_record.input_snapshot,decision_record.output_snapshot,h.package#>'{govern,actions}')
      ) THEN
        RAISE EXCEPTION 'PR1E_GOVERN_ACTION_HISTORY_REQUIRES_REVIEW';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '%PR1E_GOVERN_ACTION_HISTORY_REQUIRES_REVIEW%' THEN RAISE;END IF;
      RAISE EXCEPTION 'PR1E_GOVERN_ACTION_HISTORY_REQUIRES_REVIEW';
    END;
  END LOOP;

  EXECUTE replace(projection_definition,old_projection,new_projection);
  command_definition:=replace(command_definition,old_command_declaration,new_command_declaration);
  command_definition:=replace(command_definition,old_command_separation,new_command_separation);
  command_definition:=replace(command_definition,old_command_persistence,new_command_persistence);
  command_definition:=replace(command_definition,old_command_handoff,new_command_handoff);
  EXECUTE command_definition;

  EXECUTE replace(final_activation_definition,old_not_equal,new_not_equal);
  EXECUTE replace(bootstrap_definition,old_equal,new_equal);
  EXECUTE replace(assert_marker_definition,old_assert,new_assert);
  EXECUTE replace(brd_v3_activation_definition,old_not_equal,new_not_equal);

  EXECUTE 'REVOKE ALL ON FUNCTION public.pr1e_normalize_govern_actions(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.pr1e_govern_actions_match(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.pr1e_govern_requires_independent_resolver(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role';

  ALTER TABLE public.pr_c_controlled_human_exercises
    DROP CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check;
  ALTER TABLE public.pr_c_controlled_human_exercises
    ADD CONSTRAINT pr_c_controlled_human_exercises_migration_tip_check
    CHECK(migration_tip IN('20260904120000','20260924113000','20260926053818','20260928060000','20261003015246','20261003055918','20261003123459','20261003150800','20261004025101','20261004112232','20261008022445','20261009162752'));
  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity
    SET migration_tip='20261009162752' WHERE singleton;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK(migration_tip='20261009162752');
END
$govern_action_authority$;
