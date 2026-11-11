-- Fenced, raw-key-free cleanup claim for revoked provider bind/rotation actions.

CREATE OR REPLACE FUNCTION public.enterprise_ai_claim_provider_secret_cleanup(
  p_actor UUID,
  p_org UUID,
  p_workspace UUID,
  p_operation TEXT,
  p_key TEXT,
  p_request UUID,
  p_provider_config_id UUID,
  p_execution_token UUID
)
RETURNS public.enterprise_ai_command_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  receipt public.enterprise_ai_command_receipts;
  plan JSONB;
  existing_effect public.enterprise_ai_effect_journal;
BEGIN
  IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_request IS NULL
     OR p_provider_config_id IS NULL OR p_execution_token IS NULL
     OR p_operation NOT IN ('provider.secret.bind','provider.secret.rotate')
     OR p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 8 AND 200 THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;

  SELECT * INTO receipt
  FROM public.enterprise_ai_command_receipts
  WHERE org_id=p_org AND workspace_id=p_workspace AND actor_id=p_actor
    AND command_type=p_operation AND idempotency_key=p_key
  FOR UPDATE;
  IF receipt.id IS NULL OR receipt.initial_request_id IS DISTINCT FROM p_request
     OR receipt.runtime_area IS DISTINCT FROM 'provider' THEN
    RAISE EXCEPTION 'ENTERPRISE_AI_RECEIPT_NOT_FOUND';
  END IF;

  plan:=receipt.execution_plan;
  IF plan->>'secretOwnership' IS DISTINCT FROM 'managed_write'
     OR plan->>'secretPlanReceiptId' IS DISTINCT FROM receipt.id::text
     OR plan->>'providerConfigId' IS DISTINCT FROM p_provider_config_id::text
     OR plan->>'writeState' NOT IN ('planned','written')
     OR plan->>'provider' NOT IN ('openai','azure_openai','anthropic','gemini','openai_compatible')
     OR COALESCE(plan->>'secretReference','')=''
     OR COALESCE(plan->>'safeFingerprint','') !~ '^sha256:[0-9a-f]{24}$'
     OR COALESCE((plan->>'validationSucceeded')::boolean,false)
     OR (plan->>'cleanupTerminalCode' IS NOT NULL AND plan->>'cleanupTerminalCode'<>'PERMISSION_DENIED')
     OR (p_operation='provider.secret.rotate' AND COALESCE(plan->>'protectedSecretReferenceHash','') !~ '^sha256:[0-9a-f]{24}$')
     OR (p_operation='provider.secret.bind' AND plan ? 'protectedSecretReferenceHash') THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_provider_key_refs
    WHERE org_id=p_org AND secret_ref=plan->>'secretReference' AND status='active'
  ) THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;
  IF receipt.status='blocked' THEN
    IF receipt.response#>>'{error,code}' IS DISTINCT FROM 'PERMISSION_DENIED'
       OR COALESCE((plan->>'cleanupCompleted')::boolean,false) IS NOT TRUE THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
    END IF;
    RETURN receipt;
  END IF;
  IF receipt.status<>'claimed' THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;
  SELECT * INTO existing_effect FROM public.enterprise_ai_effect_journal
  WHERE receipt_id=receipt.id AND effect_key='command' FOR SHARE;
  IF existing_effect.id IS NOT NULL THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_CLEANUP_NOT_ALLOWED';
  END IF;

  -- A cleanup worker already holding a live fence remains the sole owner.
  IF COALESCE((plan->>'cleanupRequired')::boolean,false)
     AND receipt.lease_expires_at>statement_timestamp() THEN
    RETURN receipt;
  END IF;

  UPDATE public.enterprise_ai_command_receipts SET
    last_request_id=p_request,
    execution_token=p_execution_token,
    execution_fence=execution_fence+1,
    claim_started_at=statement_timestamp(),
    lease_expires_at=statement_timestamp()+interval '1 second',
    reconciliation_count=reconciliation_count+1,
    execution_plan=execution_plan || jsonb_build_object(
      'cleanupRequired',true,
      'cleanupTerminalCode','PERMISSION_DENIED'
    )
  WHERE id=receipt.id AND status='claimed' AND execution_fence=receipt.execution_fence
  RETURNING * INTO receipt;
  IF receipt.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE'; END IF;
  RETURN receipt;
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_ai_claim_provider_secret_cleanup(
  UUID,UUID,UUID,TEXT,TEXT,UUID,UUID,UUID
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_ai_claim_provider_secret_cleanup(
  UUID,UUID,UUID,TEXT,TEXT,UUID,UUID,UUID
) TO service_role;
