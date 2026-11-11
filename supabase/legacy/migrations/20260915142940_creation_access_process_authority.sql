-- Additive Assess process creation authority. Existing rows, V1 score versions,
-- Assess V2 cases and PR #264 controlled-human fixtures are unchanged.
INSERT INTO public.capabilities(capability_key,module,description)
VALUES ('assess.process.create','assess','Create a workspace-owned Assess process')
ON CONFLICT(capability_key) DO UPDATE SET module=EXCLUDED.module,description=EXCLUDED.description;

ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS creation_receipt_id uuid
 REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT;
ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS creation_request_id uuid;
ALTER TABLE public.assess_processes ADD COLUMN IF NOT EXISTS creation_idempotency_key text;

CREATE TABLE IF NOT EXISTS public.process_creation_workspace_controls(
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  read_only boolean NOT NULL DEFAULT true,
  max_active_processes integer NOT NULL DEFAULT 10 CHECK(max_active_processes BETWEEN 1 AND 1000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(org_id,workspace_id),
  FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
ALTER TABLE public.process_creation_workspace_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_creation_workspace_controls FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.process_creation_workspace_controls FROM PUBLIC,anon,authenticated;

-- Server-owned allowlist. Adding a template is an additive schema change; client
-- labels alone cannot claim a known governed template.
CREATE TABLE IF NOT EXISTS public.process_creation_template_registry(
  template_id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  department text NOT NULL,
  criticality text NOT NULL CHECK(criticality IN('Low','Medium','High','Critical'))
);
INSERT INTO public.process_creation_template_registry(template_id,name,description,department,criticality) VALUES
 ('tpl-p2p-invoice-ingestion','Invoice Ingestion & Extraction','Evaluate the process of receiving vendor invoices and extracting line-item header data into the ERP.','Finance','High'),
 ('tpl-o2c-credit-check','Customer Credit Checking','Evaluate the process of validating customer credit profiles against internal policies and external bureaus before order approval.','Finance','Critical')
ON CONFLICT(template_id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,department=EXCLUDED.department,criticality=EXCLUDED.criticality;
ALTER TABLE public.process_creation_template_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_creation_template_registry FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.process_creation_template_registry FROM PUBLIC,anon,authenticated;

-- Creation has no historical-version rewrite. The public read projection's
-- existing tenant RLS remains authoritative after command completion.
CREATE OR REPLACE FUNCTION public.create_assess_process(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_authorization_version bigint,
 p_request_id uuid,p_idempotency_key text,p_expected_version bigint,
 p_process_id uuid,p_name text,p_description text,p_department text,
 p_criticality text,p_template_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  r public.assess_command_receipts;
  c public.process_creation_workspace_controls;
  t public.process_creation_template_registry;
  p public.assess_processes;
  h text;
  result jsonb;
  active_count integer;
BEGIN
  -- The first mutation boundary rechecks and locks the caller's current
  -- profile, membership, role, capability and authorization epoch.
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.process.create',p_authorization_version);
  PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,'assess.read',p_authorization_version);
  IF p_expected_version IS DISTINCT FROM 0 OR p_process_id IS NULL OR p_request_id IS NULL
     OR p_name IS NULL OR length(p_name) NOT BETWEEN 1 AND 200 OR btrim(p_name)=''
     OR p_description IS NULL OR length(p_description)>4000
     OR p_department IS NULL OR length(p_department)>200
     OR p_criticality IS NULL OR p_criticality NOT IN('Low','Medium','High','Critical')
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  THEN RAISE EXCEPTION 'PROCESS_CREATE_INVALID_COMMAND'; END IF;
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO t FROM public.process_creation_template_registry WHERE template_id=p_template_id;
    IF t.template_id IS NULL OR p_name IS DISTINCT FROM t.name OR p_description IS DISTINCT FROM t.description
       OR p_department IS DISTINCT FROM t.department OR p_criticality IS DISTINCT FROM t.criticality
    THEN RAISE EXCEPTION 'PROCESS_CREATE_INVALID_COMMAND'; END IF;
  END IF;
  h:=encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object(
    'actorId',p_actor_id,'orgId',p_org_id,'workspaceId',p_workspace_id,'requestId',p_request_id,'expectedVersion',p_expected_version,
    'processId',p_process_id,'name',btrim(p_name),'description',p_description,
    'department',p_department,'criticality',p_criticality,'templateId',p_template_id)::text,'UTF8')),'hex');
  r:=public.pr1b_claim_command(p_actor_id,p_org_id,p_workspace_id,'process.create',p_idempotency_key,p_request_id,h);
  IF r.status='succeeded' THEN
    -- A replay is allowed only for the currently authorized exact request.
    RETURN jsonb_set(r.response,'{outcome}','"replayed"'::jsonb);
  END IF;
  IF r.status<>'in_progress' THEN RAISE EXCEPTION 'PROCESS_CREATE_IDEMPOTENCY_CONFLICT'; END IF;
  SELECT * INTO c FROM public.process_creation_workspace_controls
   WHERE org_id=p_org_id AND workspace_id=p_workspace_id FOR UPDATE;
  IF c.org_id IS NULL OR NOT c.enabled THEN RAISE EXCEPTION 'PROCESS_CREATE_FEATURE_DISABLED'; END IF;
  IF c.read_only THEN RAISE EXCEPTION 'PROCESS_CREATE_READ_ONLY'; END IF;
  SELECT count(*) INTO active_count FROM public.assess_processes
   WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND deleted_at IS NULL;
  IF active_count>=c.max_active_processes THEN RAISE EXCEPTION 'PROCESS_CREATE_QUOTA_EXCEEDED'; END IF;
  INSERT INTO public.assess_processes(id,org_id,workspace_id,name,description,owner_id,department,
    criticality,status,template_id,created_by,updated_by,creation_receipt_id,creation_request_id,creation_idempotency_key)
  VALUES(p_process_id,p_org_id,p_workspace_id,btrim(p_name),p_description,p_actor_id,p_department,
    p_criticality,'Not Started',p_template_id,p_actor_id,p_actor_id,r.id,p_request_id,p_idempotency_key) RETURNING * INTO p;
  result:=jsonb_build_object('ok',true,'outcome','committed','resource',jsonb_build_object(
    'id',p.id,'orgId',p.org_id,'workspaceId',p.workspace_id,'ownerId',p.owner_id,
    'name',p.name,'description',p.description,'department',p.department,
    'criticality',p.criticality,'status',p.status,'templateId',p.template_id,
    'version',1,'receiptId',p.creation_receipt_id,'requestId',p.creation_request_id,
    'idempotencyKey',p.creation_idempotency_key,'createdAt',p.created_at,'updatedAt',p.updated_at));
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,
    resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,'process.create','assess_process',p.id,
    'succeeded',1,jsonb_build_object('templateId',p_template_id));
  UPDATE public.assess_command_receipts SET status='succeeded',response=result,completed_at=now()
   WHERE id=r.id;
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  -- The exception subtransaction rolls back any uncommitted receipt, process,
  -- and audit. Only fixed domain codes can cross the browser boundary.
  IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','AUTHORITY_STALE')); END IF;
  IF SQLERRM LIKE '%PR1B_IDEMPOTENCY_CONFLICT%' OR SQLERRM LIKE '%PROCESS_CREATE_IDEMPOTENCY_CONFLICT%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','IDEMPOTENCY_CONFLICT')); END IF;
  IF SQLERRM LIKE '%PROCESS_CREATE_FEATURE_DISABLED%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','FEATURE_DISABLED')); END IF;
  IF SQLERRM LIKE '%PROCESS_CREATE_READ_ONLY%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','READ_ONLY')); END IF;
  IF SQLERRM LIKE '%PROCESS_CREATE_QUOTA_EXCEEDED%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','QUOTA_EXCEEDED')); END IF;
  IF SQLERRM LIKE '%PROCESS_CREATE_INVALID_COMMAND%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','INVALID_COMMAND')); END IF;
  IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','PERMISSION_DENIED')); END IF;
  RETURN jsonb_build_object('ok',false,'error',jsonb_build_object('code','COMMAND_UNAVAILABLE'));
END$$;
REVOKE EXECUTE ON FUNCTION public.create_assess_process(uuid,uuid,uuid,bigint,uuid,text,bigint,uuid,text,text,text,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_assess_process(uuid,uuid,uuid,bigint,uuid,text,bigint,uuid,text,text,text,text,text)
 TO service_role;
