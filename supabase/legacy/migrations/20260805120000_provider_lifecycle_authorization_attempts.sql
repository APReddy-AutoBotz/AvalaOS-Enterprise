-- Provider lifecycle receipt identity is stable across authorization-version attempts.
-- This additive correction distinguishes a stale-but-still-authorized attempt from
-- authority removal so the Edge worker can retain or clean a planned secret safely.

CREATE OR REPLACE FUNCTION public.enterprise_provider_lifecycle_transition(
  p_operation TEXT,p_actor UUID,p_org UUID,p_workspace UUID,p_authorization_version BIGINT,p_payload JSONB,
  p_receipt UUID,p_execution_token UUID,p_execution_fence BIGINT,p_result JSONB
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result JSONB; secret_operation BOOLEAN:=p_operation IN ('provider.secret.bind','provider.secret.rotate','provider.revoke');
  organization_operation BOOLEAN:=p_operation<>'provider.route.toggle'; resource_id UUID;
  current_authorization BIGINT; currently_authorized BOOLEAN:=false;
BEGIN
  IF p_receipt IS NULL OR p_execution_token IS NULL OR p_execution_fence IS NULL OR jsonb_typeof(p_result)<>'object' THEN
    RAISE EXCEPTION 'ENTERPRISE_PROVIDER_RECEIPT_REQUIRED';
  END IF;

  SELECT version INTO current_authorization
  FROM public.authorization_versions
  WHERE org_id=p_org AND user_id=p_actor;

  IF current_authorization IS DISTINCT FROM p_authorization_version THEN
    IF current_authorization IS NOT NULL THEN
      IF organization_operation THEN
        currently_authorized:=public.enterprise_actor_has_organization_capability(
          p_actor,p_org,'org.admin',current_authorization
        );
        IF NOT currently_authorized AND secret_operation THEN
          currently_authorized:=public.enterprise_actor_has_organization_capability(
            p_actor,p_org,'byok.manage',current_authorization
          ) AND public.enterprise_actor_has_organization_capability(
            p_actor,p_org,'security.manage',current_authorization
          );
        ELSIF NOT currently_authorized THEN
          currently_authorized:=public.enterprise_actor_has_organization_capability(
            p_actor,p_org,'byok.manage',current_authorization
          ) OR public.enterprise_actor_has_organization_capability(
            p_actor,p_org,'security.manage',current_authorization
          );
        END IF;
      ELSE
        BEGIN
          PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',current_authorization);
          currently_authorized:=true;
        EXCEPTION WHEN OTHERS THEN
          BEGIN
            PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'byok.manage',current_authorization);
            currently_authorized:=true;
          EXCEPTION WHEN OTHERS THEN
            BEGIN
              PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'security.manage',current_authorization);
              currently_authorized:=true;
            EXCEPTION WHEN OTHERS THEN
              currently_authorized:=false;
            END;
          END;
        END;
      END IF;
    END IF;
    IF currently_authorized THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_AUTHORIZATION_VERSION_STALE';
    ELSIF organization_operation THEN
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ORGANIZATION_AUTHORITY_REQUIRED';
    ELSE
      RAISE EXCEPTION 'ENTERPRISE_PROVIDER_WORKSPACE_AUTHORITY_REQUIRED';
    END IF;
  END IF;

  IF organization_operation THEN
    IF NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'org.admin',p_authorization_version) THEN
      IF secret_operation THEN
        IF NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'byok.manage',p_authorization_version)
           OR NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'security.manage',p_authorization_version) THEN
          RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ORGANIZATION_AUTHORITY_REQUIRED';
        END IF;
      ELSIF NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'byok.manage',p_authorization_version)
        AND NOT public.enterprise_actor_has_organization_capability(p_actor,p_org,'security.manage',p_authorization_version) THEN
        RAISE EXCEPTION 'ENTERPRISE_PROVIDER_ORGANIZATION_AUTHORITY_REQUIRED';
      END IF;
    END IF;
  ELSE
    BEGIN
      PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'byok.manage',p_authorization_version);
      EXCEPTION WHEN OTHERS THEN
        PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'security.manage',p_authorization_version);
      END;
    END;
  END IF;
  result:=public.enterprise_provider_lifecycle_transition(
    p_operation,p_actor,p_org,p_workspace,p_authorization_version,p_payload
  );
  resource_id:=NULLIF(p_result->>'providerConfigId','')::uuid;
  PERFORM public.enterprise_ai_record_effect(
    p_receipt,p_org,p_workspace,p_execution_token,p_execution_fence,p_operation,'command',resource_id,p_result,'committed'
  );
  RETURN p_result;
END;
$$;

REVOKE ALL ON FUNCTION public.enterprise_provider_lifecycle_transition(
  TEXT,UUID,UUID,UUID,BIGINT,JSONB,UUID,UUID,BIGINT,JSONB
) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_provider_lifecycle_transition(
  TEXT,UUID,UUID,UUID,BIGINT,JSONB,UUID,UUID,BIGINT,JSONB
) TO service_role;
