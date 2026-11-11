-- Provider secret write intent recovery.
-- Allows the single monotonic execution-plan transition from planned to written
-- while preserving every other server-owned receipt-plan field and execution fence.

CREATE OR REPLACE FUNCTION public.enterprise_ai_plan_command(
  p_id UUID,p_org UUID,p_workspace UUID,p_execution_token UUID,
  p_execution_fence BIGINT,p_plan JSONB
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  old_write_state TEXT;
  new_write_state TEXT;
BEGIN
  IF jsonb_typeof(COALESCE(p_plan,'{}'::jsonb)) <> 'object'
     OR p_plan ?| ARRAY['providerKey','provider_key','rawKey','raw_key','apiKey','api_key','secretValue','secret_value','authorization','bearerToken'] THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EXECUTION_PLAN_INVALID';
  END IF;
  SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
  WHERE id=p_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF receipt.id IS NULL OR receipt.status<>'claimed'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;

  old_write_state:=receipt.execution_plan->>'writeState';
  new_write_state:=p_plan->>'writeState';
  IF receipt.execution_plan <> '{}'::jsonb
     AND NOT (p_plan @> (receipt.execution_plan - 'writeState')) THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EXECUTION_PLAN_CONFLICT';
  END IF;
  IF old_write_state IS NOT NULL
     AND old_write_state IS DISTINCT FROM new_write_state
     AND NOT (old_write_state='planned' AND new_write_state='written') THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_EXECUTION_PLAN_CONFLICT';
  END IF;

  UPDATE public.enterprise_ai_command_receipts SET execution_plan=p_plan
  WHERE id=receipt.id RETURNING * INTO receipt;
  RETURN receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_plan_command(
  UUID,UUID,UUID,UUID,BIGINT,JSONB
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_plan_command(
  UUID,UUID,UUID,UUID,BIGINT,JSONB
) TO service_role;
