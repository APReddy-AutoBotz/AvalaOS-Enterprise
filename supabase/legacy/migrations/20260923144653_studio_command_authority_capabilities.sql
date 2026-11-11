-- Studio's Edge command preflight used an artifact-only authority projection
-- even for separately governed handoff and template commands. The UI and SQL
-- correctly evaluated handoff capabilities, but the Edge preflight rejected
-- every such command before the atomic RPC. Include only the three Studio
-- command capability families; each emitted capability is still checked
-- against fresh server-side workspace authority. Keep the underlying command
-- capability and separation-of-duty checks intact.
DO $fix$
DECLARE
  marker public.hosted_pilot_environment_identity;
  constraint_expression text;
  definition text;
  bootstrap_definition text;
  old_family text := 'WHERE c.capability_key LIKE ''studio.artifacts.%'' AND public.pr1e_actor_has_workspace_capability';
  new_family text := 'WHERE (c.capability_key LIKE ''studio.artifacts.%'' OR c.capability_key LIKE ''studio.handoffs.%'' OR c.capability_key LIKE ''studio.templates.%'') AND public.pr1e_actor_has_workspace_capability';
  old_read text := 'AND public.pr1e_actor_has_workspace_capability(p_actor_id,p_organization_id,p_workspace_id,''studio.artifacts.read'')';
  new_read text := 'AND (public.pr1e_actor_has_workspace_capability(p_actor_id,p_organization_id,p_workspace_id,''studio.artifacts.read'') OR public.pr1e_actor_has_workspace_capability(p_actor_id,p_organization_id,p_workspace_id,''studio.handoffs.read'') OR public.pr1e_actor_has_workspace_capability(p_actor_id,p_organization_id,p_workspace_id,''studio.templates.read''))';
  old_bootstrap text := 'marker.migration_tip=''20260923142120''';
  new_bootstrap text := 'marker.migration_tip=''20260923144653''';
  old_family_count integer;
  new_family_count integer;
  old_read_count integer;
  new_read_count integer;
  old_bootstrap_count integer;
  new_bootstrap_count integer;
BEGIN
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT marker FROM public.hosted_pilot_environment_identity WHERE singleton FOR UPDATE;
  IF marker.product_key <> 'avalaos-core'
    OR marker.environment_class <> 'hosted_nonproduction_pilot'
    OR marker.schema_contract <> 'hosted-pilot-2026-08'
    OR marker.production_authorized OR marker.customer_data_authorized OR marker.real_provider_calls_authorized
  THEN RAISE EXCEPTION 'STUDIO_AUTHORITY_IDENTITY_MISMATCH'; END IF;
  SELECT pg_get_expr(conbin,conrelid,false) INTO STRICT constraint_expression FROM pg_constraint
    WHERE conrelid='public.hosted_pilot_environment_identity'::regclass
      AND conname='hosted_pilot_environment_identity_migration_tip_check';
  SELECT pg_get_functiondef('public.studio_artifact_authority(uuid,uuid,uuid)'::regprocedure)
    INTO STRICT definition;
  SELECT pg_get_functiondef('public.synthetic_ai_campaign_bootstrap(uuid,uuid,uuid,bigint,text,text,text,text,uuid,uuid,uuid,uuid,timestamptz)'::regprocedure)
    INTO STRICT bootstrap_definition;
  old_family_count := (length(definition)-length(replace(definition,old_family,'')))/length(old_family);
  new_family_count := (length(definition)-length(replace(definition,new_family,'')))/length(new_family);
  old_read_count := (length(definition)-length(replace(definition,old_read,'')))/length(old_read);
  new_read_count := (length(definition)-length(replace(definition,new_read,'')))/length(new_read);
  old_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,old_bootstrap,'')))/length(old_bootstrap);
  new_bootstrap_count := (length(bootstrap_definition)-length(replace(bootstrap_definition,new_bootstrap,'')))/length(new_bootstrap);
  IF marker.migration_tip='20260923142120'
    AND constraint_expression='(migration_tip = ''20260923142120''::text)'
    AND old_family_count=1 AND new_family_count=0
    AND old_read_count=1 AND new_read_count=0
    AND old_bootstrap_count=1 AND new_bootstrap_count=0
  THEN
    EXECUTE replace(replace(definition,old_family,new_family),old_read,new_read);
    EXECUTE replace(bootstrap_definition,old_bootstrap,new_bootstrap);
    ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
    UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260923144653' WHERE singleton;
    ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
      CHECK (migration_tip='20260923144653');
  ELSIF marker.migration_tip='20260923144653'
    AND constraint_expression='(migration_tip = ''20260923144653''::text)'
    AND old_family_count=0 AND new_family_count=1
    AND old_read_count=0 AND new_read_count=1
    AND old_bootstrap_count=0 AND new_bootstrap_count=1
  THEN
    NULL; -- exact reapplication
  ELSE
    RAISE EXCEPTION 'STUDIO_AUTHORITY_SOURCE_MISMATCH';
  END IF;
END
$fix$;
