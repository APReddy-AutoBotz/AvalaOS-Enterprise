-- Receipt-owned evidence source upload recovery.
-- Keeps the exact fenced owner live longer than the bounded Storage operation.

CREATE OR REPLACE FUNCTION public.enterprise_ai_renew_external_write_lease(
  p_id UUID,
  p_org UUID,
  p_workspace UUID,
  p_execution_token UUID,
  p_execution_fence BIGINT
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
BEGIN
  SELECT * INTO receipt
  FROM public.enterprise_ai_command_receipts
  WHERE id = p_id
    AND org_id = p_org
    AND workspace_id = p_workspace
  FOR UPDATE;

  IF receipt.id IS NULL
     OR receipt.command_type <> 'evidence.source.create'
     OR receipt.status <> 'claimed'
     OR receipt.execution_token IS DISTINCT FROM p_execution_token
     OR receipt.execution_fence IS DISTINCT FROM p_execution_fence
     OR receipt.execution_plan->>'storageWriteOwnership' <> 'receipt_managed_write'
     OR receipt.execution_plan->>'storageWriteReceiptId' IS DISTINCT FROM receipt.id::TEXT
     OR receipt.execution_plan->>'writeState' NOT IN ('planned', 'written') THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;

  UPDATE public.enterprise_ai_command_receipts
  SET lease_expires_at = GREATEST(
    lease_expires_at,
    statement_timestamp() + interval '45 seconds'
  )
  WHERE id = receipt.id
    AND status = 'claimed'
    AND execution_token = p_execution_token
    AND execution_fence = p_execution_fence
  RETURNING * INTO receipt;

  IF receipt.id IS NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
  END IF;
  RETURN receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_renew_external_write_lease(
  UUID, UUID, UUID, UUID, BIGINT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_renew_external_write_lease(
  UUID, UUID, UUID, UUID, BIGINT
) TO service_role;

COMMENT ON FUNCTION public.enterprise_ai_renew_external_write_lease(
  UUID, UUID, UUID, UUID, BIGINT
) IS 'Renews only the exact fenced evidence-source upload owner; the 45-second lease exceeds the 15-second external operation deadline plus margin.';
