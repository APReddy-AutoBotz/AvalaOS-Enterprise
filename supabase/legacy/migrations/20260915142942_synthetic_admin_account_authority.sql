-- Isolated, opt-in exploratory synthetic Admin accounts. This does not alter
-- the fixed PR #264 human exercise, its personas, or any production authority.
INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('admin.synthetic.users.manage','admin','Manage only target-owned exploratory synthetic accounts'),
 ('assess.process.create','assess','Create a workspace-scoped Assess process')
ON CONFLICT(capability_key) DO NOTHING;

CREATE TABLE public.synthetic_admin_targets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_fingerprint text NOT NULL UNIQUE CHECK(target_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
 workspace_id uuid NOT NULL,
 operator_actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 organization_member_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
 environment_class text NOT NULL CHECK(environment_class='hosted_nonproduction_pilot'),
 enabled boolean NOT NULL DEFAULT false,
 synthetic_only boolean NOT NULL DEFAULT true CHECK(synthetic_only),
 production_authorized boolean NOT NULL DEFAULT false CHECK(NOT production_authorized),
 customer_data_authorized boolean NOT NULL DEFAULT false CHECK(NOT customer_data_authorized),
 real_provider_calls_authorized boolean NOT NULL DEFAULT false CHECK(NOT real_provider_calls_authorized),
 max_accounts integer NOT NULL DEFAULT 20 CHECK(max_accounts BETWEEN 1 AND 20),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX synthetic_admin_one_target ON public.synthetic_admin_targets((true));

CREATE TABLE public.synthetic_admin_preset_roles (
 target_id uuid NOT NULL REFERENCES public.synthetic_admin_targets(id) ON DELETE RESTRICT,
 preset text NOT NULL CHECK(preset IN('author','reviewer','approver','viewer')),
 role_id uuid NOT NULL UNIQUE REFERENCES public.roles(id) ON DELETE RESTRICT,
 PRIMARY KEY(target_id,preset)
);

CREATE TABLE public.synthetic_admin_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_id uuid NOT NULL,
 org_id uuid NOT NULL,
 workspace_id uuid NOT NULL,
 auth_user_id uuid NOT NULL UNIQUE,
 synthetic_email text NOT NULL UNIQUE CHECK(synthetic_email ~ '^synthetic-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}@avalaos\.invalid$'),
 label text NOT NULL CHECK(label ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$'),
 preset text NOT NULL CHECK(preset IN('author','reviewer','approver','viewer')),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','execution_claimed','reconciliation_required','active','revoked','ban_required','ban_uncertain')),
 version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 reserved_by uuid NOT NULL REFERENCES public.profiles(id),
 reserve_request_id uuid NOT NULL,
 reserve_key text NOT NULL CHECK(length(reserve_key) BETWEEN 8 AND 200),
 execution_request_id uuid,
 execution_key text,
 auth_effect_at timestamptz,
 activated_at timestamptz,
 revoked_at timestamptz,
 ban_request_id uuid,
 ban_claim_id uuid,
 ban_claim_request_id uuid,
 ban_claim_key text,
 ban_claim_expires_at timestamptz,
 ban_attempts integer NOT NULL DEFAULT 0 CHECK(ban_attempts BETWEEN 0 AND 3),
 ban_completed_claim_id uuid,
 ban_completed_request_id uuid,
 ban_completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(target_id,reserved_by,reserve_key),
 UNIQUE(target_id,execution_request_id),
 FOREIGN KEY(target_id,org_id,workspace_id) REFERENCES public.synthetic_admin_targets(id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((execution_request_id IS NULL AND execution_key IS NULL) OR (execution_request_id IS NOT NULL AND execution_key IS NOT NULL))
);
CREATE INDEX synthetic_admin_accounts_roster ON public.synthetic_admin_accounts(target_id,id);

ALTER TABLE public.synthetic_admin_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_admin_targets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_admin_preset_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_admin_preset_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_admin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_admin_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.synthetic_admin_targets,public.synthetic_admin_preset_roles,public.synthetic_admin_accounts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.synthetic_admin_targets,public.synthetic_admin_preset_roles,public.synthetic_admin_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.synthetic_admin_assert_target(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_fingerprint text
) RETURNS public.synthetic_admin_targets LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets;
BEGIN
 -- Canonical actor/role/version locks precede the single target lock. All
 -- roster operations then take target FOR UPDATE before any account row, so
 -- concurrent reservations serialize quota without a SHARE→UPDATE upgrade.
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'admin.synthetic.users.manage',p_authorization_version);
 SELECT * INTO target FROM public.synthetic_admin_targets WHERE target_fingerprint=p_fingerprint AND enabled FOR UPDATE;
 IF target.id IS NULL OR target.org_id IS DISTINCT FROM p_org OR target.workspace_id IS DISTINCT FROM p_workspace
   OR target.operator_actor_id IS DISTINCT FROM p_actor
   OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises)
   OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_recovery_authorities)
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_FEATURE_DISABLED'; END IF;
 RETURN target;
END $$;

-- Operator-only bootstrap. The explicit operator UUID and target fingerprint
-- are supplied by private tooling after validating a genuinely separate empty
-- backend. This is never called from the browser or the Admin Edge endpoint.
CREATE OR REPLACE FUNCTION public.synthetic_admin_configure_target(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; member_role public.roles; preset text; workspace_role public.roles; admin_role_id uuid;
        desired text[]; cap text; expected_count integer;
BEGIN
 IF p_fingerprint IS NULL OR p_fingerprint !~ '^sha256:[0-9a-f]{64}$' OR EXISTS(SELECT 1 FROM public.synthetic_admin_targets)
   OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises)
   OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_recovery_authorities)
   OR (SELECT count(*) FROM public.organizations WHERE status='active' AND deleted_at IS NULL)<>1
   OR (SELECT count(*) FROM public.workspaces WHERE status='active' AND deleted_at IS NULL)<>1
   OR (SELECT count(*) FROM public.profiles WHERE status='active' AND deleted_at IS NULL)<>1
   OR (SELECT count(*) FROM auth.users)<>1
   OR EXISTS(SELECT 1 FROM public.profiles WHERE id<>p_actor)
   OR EXISTS(SELECT 1 FROM public.ai_provider_configs)
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_TARGET_NOT_EMPTY'; END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,'org.admin',p_authorization_version);
 SELECT r.* INTO member_role FROM public.organization_members om JOIN public.roles r ON r.id=om.role_id
 WHERE om.org_id=p_org AND om.user_id=p_actor AND om.status='active' AND om.deleted_at IS NULL FOR SHARE OF om,r;
 IF member_role.id IS NULL OR member_role.scope<>'organization' OR member_role.org_id IS DISTINCT FROM p_org
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_TARGET_NOT_EMPTY'; END IF;
 admin_role_id:=member_role.id;
 INSERT INTO public.roles(org_id,name,slug,scope,permissions,status,is_system,created_by)
 VALUES(p_org,'Synthetic exploratory member','synthetic-exploratory-member','organization','[]'::jsonb,'active',false,p_actor)
 RETURNING * INTO member_role;
 INSERT INTO public.synthetic_admin_targets(target_fingerprint,org_id,workspace_id,operator_actor_id,organization_member_role_id,environment_class)
 VALUES(p_fingerprint,p_org,p_workspace,p_actor,member_role.id,'hosted_nonproduction_pilot') RETURNING * INTO target;

 FOREACH preset IN ARRAY ARRAY['author','reviewer','approver','viewer'] LOOP
  desired := CASE preset
   WHEN 'author' THEN ARRAY['project.read','assess.read','assess.process.create','assess.create','assess.response.write','assess.v2.read','assess.v2.create','assess.v2.draft.write','studio.artifacts.read','studio.artifacts.edit','studio.artifacts.generate','studio.sources.manage','delivery.package.manage']
   WHEN 'reviewer' THEN ARRAY['project.read','assess.read','assess.v2.read','assess.v2.review','assess.v2.evidence.attest','studio.artifacts.read','studio.artifacts.review','delivery.package.review']
   WHEN 'approver' THEN ARRAY['project.read','assess.read','assess.v2.read','assess.v2.approve','studio.artifacts.read','studio.artifacts.approve','delivery.handoff.approve','delivery.package.approve']
   ELSE ARRAY['project.read','assess.read','assess.v2.read','studio.artifacts.read'] END;
  SELECT count(*) INTO expected_count FROM public.capabilities c WHERE c.capability_key=ANY(desired);
  IF expected_count<>cardinality(desired) THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_CAPABILITY_INVENTORY_INCOMPLETE'; END IF;
  INSERT INTO public.roles(org_id,workspace_id,name,slug,scope,permissions,status,is_system,created_by)
  VALUES(p_org,p_workspace,'Synthetic exploratory '||preset,'synthetic-exploratory-'||preset,'workspace',to_jsonb(desired),'active',false,p_actor)
  RETURNING * INTO workspace_role;
  INSERT INTO public.synthetic_admin_preset_roles(target_id,preset,role_id) VALUES(target.id,preset,workspace_role.id);
  FOREACH cap IN ARRAY desired LOOP
   INSERT INTO public.role_capabilities(role_id,capability_key) VALUES(workspace_role.id,cap);
  END LOOP;
 END LOOP;

 -- Explicitly equip this one pre-existing operator role; all runtime calls
 -- additionally bind the actor to target.operator_actor_id.
 INSERT INTO public.role_capabilities(role_id,capability_key) VALUES(admin_role_id,'admin.synthetic.users.manage') ON CONFLICT DO NOTHING;
 INSERT INTO public.process_creation_workspace_controls(org_id,workspace_id,enabled,read_only,max_active_processes,updated_at)
 VALUES(p_org,p_workspace,true,false,10,statement_timestamp())
 ON CONFLICT(org_id,workspace_id) DO UPDATE SET enabled=true,read_only=false,max_active_processes=10,updated_at=statement_timestamp();
 UPDATE public.synthetic_admin_targets SET enabled=true WHERE id=target.id;
 RETURN jsonb_build_object('status','configured','targetId',target.id);
END $$;

REVOKE ALL ON FUNCTION public.synthetic_admin_configure_target(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.synthetic_admin_configure_target(uuid,uuid,uuid,bigint,text) TO service_role;
REVOKE ALL ON FUNCTION public.synthetic_admin_assert_target(uuid,uuid,uuid,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.synthetic_admin_assert_target(uuid,uuid,uuid,bigint,text) TO service_role;

-- Private operator bootstrap after an independently pinned, empty exploratory
-- backend has received exactly one explicitly approved Auth user UUID. Neither
-- email nor Auth/user metadata is consulted to choose who receives authority.
CREATE OR REPLACE FUNCTION public.synthetic_admin_bootstrap_operator(
 p_actor uuid,p_org uuid,p_workspace uuid,p_fingerprint text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE auth_row auth.users; admin_role_id uuid; actual_version bigint;
BEGIN
 IF p_actor IS NULL OR p_org IS NULL OR p_workspace IS NULL OR p_fingerprint IS NULL OR p_fingerprint !~ '^sha256:[0-9a-f]{64}$'
   OR (SELECT count(*) FROM auth.users)<>1
   OR EXISTS(SELECT 1 FROM public.profiles)
   OR EXISTS(SELECT 1 FROM public.organizations)
   OR EXISTS(SELECT 1 FROM public.workspaces)
   OR EXISTS(SELECT 1 FROM public.synthetic_admin_targets)
   OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_exercises)
   OR EXISTS(SELECT 1 FROM public.pr_c_controlled_human_recovery_authorities)
   OR EXISTS(SELECT 1 FROM public.ai_provider_configs)
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_TARGET_NOT_EMPTY'; END IF;
 SELECT * INTO auth_row FROM auth.users WHERE id=p_actor FOR SHARE;
 IF auth_row.id IS NULL OR auth_row.email IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_TARGET_NOT_EMPTY'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.capabilities WHERE capability_key='org.admin')
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_CAPABILITY_INVENTORY_INCOMPLETE'; END IF;

 INSERT INTO public.profiles(id,email,status,metadata)
 VALUES(p_actor,auth_row.email,'active',jsonb_build_object('syntheticOperator',true));
 INSERT INTO public.organizations(id,name,slug,status,created_by)
 VALUES(p_org,'Exploratory synthetic testing','exploratory-synthetic-testing','active',p_actor);
 INSERT INTO public.workspaces(id,org_id,name,slug,status,created_by)
 VALUES(p_workspace,p_org,'Exploratory workspace','exploratory-workspace','active',p_actor);
 INSERT INTO public.roles(org_id,name,slug,scope,permissions,status,is_system,created_by)
 VALUES(p_org,'Exploratory operator Admin','exploratory-operator-admin','organization',jsonb_build_array('org.admin'),'active',false,p_actor)
 RETURNING id INTO admin_role_id;
 INSERT INTO public.role_capabilities(role_id,capability_key) VALUES(admin_role_id,'org.admin');
 INSERT INTO public.organization_members(org_id,user_id,role_id,status,joined_at,created_by)
 VALUES(p_org,p_actor,admin_role_id,'active',statement_timestamp(),p_actor);
 INSERT INTO public.workspace_memberships(org_id,workspace_id,user_id,status,joined_at,created_by)
 VALUES(p_org,p_workspace,p_actor,'active',statement_timestamp(),p_actor);
 SELECT version INTO actual_version FROM public.authorization_versions
 WHERE org_id=p_org AND user_id=p_actor;
 IF actual_version IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_TARGET_NOT_EMPTY'; END IF;
 RETURN public.synthetic_admin_configure_target(p_actor,p_org,p_workspace,actual_version,p_fingerprint);
END $$;
REVOKE ALL ON FUNCTION public.synthetic_admin_bootstrap_operator(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.synthetic_admin_bootstrap_operator(uuid,uuid,uuid,text) TO service_role;

CREATE TABLE public.synthetic_admin_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), target_id uuid NOT NULL REFERENCES public.synthetic_admin_targets(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES public.profiles(id), operation text NOT NULL CHECK(operation IN('assign_role','revoke','ban_claim')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
 request_id uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
 response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 UNIQUE(target_id,actor_id,operation,idempotency_key)
);
ALTER TABLE public.synthetic_admin_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.synthetic_admin_commands FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.synthetic_admin_commands FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.synthetic_admin_commands TO service_role;
CREATE TRIGGER synthetic_admin_commands_immutable BEFORE UPDATE OR DELETE ON public.synthetic_admin_commands
 FOR EACH ROW EXECUTE FUNCTION public.pr1b_reject_immutable_event_mutation();
CREATE UNIQUE INDEX synthetic_admin_ban_claim_request ON public.synthetic_admin_commands(target_id,actor_id,request_id)
 WHERE operation='ban_claim';

CREATE OR REPLACE FUNCTION public.synthetic_admin_reserve(
 p_actor uuid,p_org uuid,p_workspace uuid,p_version bigint,p_fingerprint text,
 p_request_id uuid,p_key text,p_label text,p_preset text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts; new_auth_id uuid; new_reservation_id uuid;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_version,p_fingerprint);
 IF p_request_id IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,200}$'
   OR p_label !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$'
   OR p_preset NOT IN('author','reviewer','approver','viewer')
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_INVALID_REQUEST'; END IF;
 SELECT * INTO account FROM public.synthetic_admin_accounts
 WHERE target_id=target.id AND reserved_by=p_actor AND reserve_key=p_key FOR UPDATE;
 IF account.id IS NOT NULL THEN
  IF account.reserve_request_id IS DISTINCT FROM p_request_id OR account.label IS DISTINCT FROM p_label
    OR account.preset IS DISTINCT FROM p_preset THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version,'loginId',account.synthetic_email);
 END IF;
 IF (SELECT count(*) FROM public.synthetic_admin_accounts WHERE target_id=target.id)>=target.max_accounts
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_QUOTA_EXCEEDED'; END IF;
 new_auth_id:=gen_random_uuid();
 new_reservation_id:=gen_random_uuid();
 INSERT INTO public.synthetic_admin_accounts(id,target_id,org_id,workspace_id,auth_user_id,synthetic_email,label,preset,reserved_by,reserve_request_id,reserve_key)
 VALUES(new_reservation_id,target.id,p_org,p_workspace,new_auth_id,'synthetic-'||new_reservation_id::text||'@avalaos.invalid',p_label,p_preset,p_actor,p_request_id,p_key)
 RETURNING * INTO account;
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version)
 VALUES(p_org,p_workspace,p_actor,p_request_id,'synthetic_admin.reserve','synthetic_admin_account',account.id,'succeeded',account.version);
 RETURN jsonb_build_object('status','reserved','reservationId',account.id,'version',account.version,'loginId',account.synthetic_email);
END $$;

-- The durable claim commits before the external Auth call. A repeated execute
-- can never receive a new external-create fence or a second Auth identity.
CREATE OR REPLACE FUNCTION public.synthetic_admin_claim_execution(
 p_actor uuid,p_org uuid,p_workspace uuid,p_version bigint,p_fingerprint text,
 p_request_id uuid,p_key text,p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_version,p_fingerprint);
 IF p_request_id IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR p_reservation_id IS NULL
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_INVALID_REQUEST'; END IF;
 SELECT * INTO account FROM public.synthetic_admin_accounts
 WHERE id=p_reservation_id AND target_id=target.id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF account.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_NOT_FOUND'; END IF;
 IF account.state<>'reserved' THEN
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version,'externalCreateAllowed',false);
 END IF;
 UPDATE public.synthetic_admin_accounts SET state='execution_claimed',version=version+1,
  execution_request_id=p_request_id,execution_key=p_key,updated_at=statement_timestamp()
 WHERE id=account.id RETURNING * INTO account;
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version)
 VALUES(p_org,p_workspace,p_actor,p_request_id,'synthetic_admin.execution.claim','synthetic_admin_account',account.id,'succeeded',account.version);
 RETURN jsonb_build_object('status','execution_claimed','reservationId',account.id,'version',account.version,
  'externalCreateAllowed',true,'authUserId',account.auth_user_id,'syntheticEmail',account.synthetic_email);
END $$;

-- Exact-ID reconciliation reads auth.users from a service-role-only RPC. The
-- browser never receives the Auth id, generated email, password or raw row.
CREATE OR REPLACE FUNCTION public.synthetic_admin_reconcile(
 p_actor uuid,p_org uuid,p_workspace uuid,p_version bigint,p_fingerprint text,p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts;
        auth_row auth.users; role_id uuid;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_version,p_fingerprint);
 SELECT * INTO account FROM public.synthetic_admin_accounts WHERE id=p_reservation_id AND target_id=target.id
  AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF account.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_NOT_FOUND'; END IF;
 IF account.state IN('ban_required','ban_uncertain') THEN
  SELECT * INTO auth_row FROM auth.users WHERE id=account.auth_user_id FOR SHARE;
  IF auth_row.id IS NOT NULL AND auth_row.email=account.synthetic_email
    AND auth_row.raw_app_meta_data->>'synthetic_admin_reservation_id'=account.id::text
    AND auth_row.raw_app_meta_data->>'synthetic_admin_target'=p_fingerprint
    AND auth_row.banned_until>statement_timestamp()+interval '30 seconds' THEN
   UPDATE public.synthetic_admin_accounts SET state='revoked',version=version+1,
    ban_completed_claim_id=ban_claim_id,ban_completed_request_id=ban_claim_request_id,
    ban_completed_at=statement_timestamp(),updated_at=statement_timestamp()
   WHERE id=account.id RETURNING * INTO account;
   INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
   VALUES(p_org,p_workspace,p_actor,account.ban_request_id,'synthetic_admin.auth.ban.confirm','synthetic_admin_account',account.id,'succeeded',account.version,
    jsonb_build_object('originalBanRequestId',account.ban_request_id,
     'banClaimRequestId',account.ban_claim_request_id,'banAttempt',account.ban_attempts));
  END IF;
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version);
 END IF;
 IF account.state IN('active','revoked') THEN
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version);
 END IF;
 IF account.state='reserved' THEN
  RETURN jsonb_build_object('status','reserved','reservationId',account.id,'version',account.version);
 END IF;
 SELECT * INTO auth_row FROM auth.users WHERE id=account.auth_user_id FOR SHARE;
 IF auth_row.id IS NULL THEN
  UPDATE public.synthetic_admin_accounts SET state='reconciliation_required',version=version+1,updated_at=statement_timestamp()
  WHERE id=account.id AND state<>'reconciliation_required' RETURNING * INTO account;
  RETURN jsonb_build_object('status','reconciliation_required','reservationId',account.id,'version',account.version);
 END IF;
 IF auth_row.email IS DISTINCT FROM account.synthetic_email
   OR auth_row.raw_app_meta_data->>'synthetic_admin_reservation_id' IS DISTINCT FROM account.id::text
   OR auth_row.raw_app_meta_data->>'synthetic_admin_target' IS DISTINCT FROM p_fingerprint
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 SELECT preset_role.role_id INTO role_id FROM public.synthetic_admin_preset_roles preset_role
 WHERE preset_role.target_id=target.id AND preset_role.preset=account.preset FOR SHARE;
 IF role_id IS NULL OR EXISTS(SELECT 1 FROM public.profiles WHERE id=account.auth_user_id)
   OR EXISTS(SELECT 1 FROM public.organization_members WHERE org_id=p_org AND user_id=account.auth_user_id)
   OR EXISTS(SELECT 1 FROM public.workspace_memberships WHERE org_id=p_org AND user_id=account.auth_user_id)
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 INSERT INTO public.profiles(id,email,status,metadata) VALUES(account.auth_user_id,account.synthetic_email,'active',jsonb_build_object('syntheticAdminReservationId',account.id));
 INSERT INTO public.organization_members(org_id,user_id,role_id,status,joined_at,created_by)
 VALUES(p_org,account.auth_user_id,target.organization_member_role_id,'active',statement_timestamp(),p_actor);
 INSERT INTO public.workspace_memberships(org_id,workspace_id,user_id,role_id,status,joined_at,created_by)
 VALUES(p_org,p_workspace,account.auth_user_id,role_id,'active',statement_timestamp(),p_actor);
 UPDATE public.synthetic_admin_accounts SET state='active',version=version+1,auth_effect_at=statement_timestamp(),
  activated_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=account.id RETURNING * INTO account;
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version)
 VALUES(p_org,p_workspace,p_actor,account.execution_request_id,'synthetic_admin.activate','synthetic_admin_account',account.id,'succeeded',account.version);
 RETURN jsonb_build_object('status','active','reservationId',account.id,'version',account.version);
END $$;

CREATE OR REPLACE FUNCTION public.synthetic_admin_list(
 p_actor uuid,p_org uuid,p_workspace uuid,p_version bigint,p_fingerprint text,p_cursor uuid,p_limit integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; rows jsonb; cursor_id uuid;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_version,p_fingerprint);
 IF p_limit IS NULL THEN p_limit:=20; END IF;
 IF p_limit NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_INVALID_REQUEST'; END IF;
 SELECT COALESCE(jsonb_agg(item.safe_row ORDER BY item.id),'[]'::jsonb),max(item.id::text)::uuid
 INTO rows,cursor_id FROM (
  SELECT account.id,jsonb_build_object('reservationId',account.id,'label',account.label,'loginId',account.synthetic_email,'rolePreset',account.preset,
    'state',account.state,'version',account.version) AS safe_row
  FROM public.synthetic_admin_accounts account WHERE account.target_id=target.id
   AND account.org_id=p_org AND account.workspace_id=p_workspace AND (p_cursor IS NULL OR account.id>p_cursor)
  ORDER BY account.id LIMIT p_limit
 ) item;
 RETURN jsonb_build_object('status','listed','roster',rows,'nextCursor',cursor_id);
END $$;

CREATE OR REPLACE FUNCTION public.synthetic_admin_assign_role(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_fingerprint text,
 p_request_id uuid,p_key text,p_reservation_id uuid,p_expected_version bigint,p_preset text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts;
        v_role_id uuid; request_hash text; receipt public.synthetic_admin_commands; response jsonb;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_fingerprint);
 IF p_request_id IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR p_reservation_id IS NULL
   OR p_expected_version<1 OR p_preset NOT IN('author','reviewer','approver','viewer')
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_INVALID_REQUEST'; END IF;
 request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('requestId',p_request_id,'reservationId',p_reservation_id,
  'expectedVersion',p_expected_version,'rolePreset',p_preset)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.synthetic_admin_commands WHERE target_id=target.id AND actor_id=p_actor
  AND operation='assign_role' AND idempotency_key=p_key FOR SHARE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN receipt.response;
 END IF;
 SELECT * INTO account FROM public.synthetic_admin_accounts WHERE id=p_reservation_id AND target_id=target.id
  AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF account.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_NOT_FOUND'; END IF;
 IF account.state<>'active' OR account.version<>p_expected_version
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_VERSION_CONFLICT'; END IF;
 SELECT preset_role.role_id INTO v_role_id FROM public.synthetic_admin_preset_roles preset_role
 WHERE preset_role.target_id=target.id AND preset_role.preset=p_preset FOR SHARE;
 IF v_role_id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_FEATURE_DISABLED'; END IF;
 UPDATE public.workspace_memberships SET role_id=v_role_id,updated_by=p_actor,updated_at=statement_timestamp()
 WHERE org_id=p_org AND workspace_id=p_workspace AND user_id=account.auth_user_id AND status='active' AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 UPDATE public.synthetic_admin_accounts SET preset=p_preset,version=version+1,updated_at=statement_timestamp()
 WHERE id=account.id RETURNING * INTO account;
 response:=jsonb_build_object('status','active','reservationId',account.id,'version',account.version);
 INSERT INTO public.synthetic_admin_commands(target_id,actor_id,operation,idempotency_key,request_id,request_hash,response)
 VALUES(target.id,p_actor,'assign_role',p_key,p_request_id,request_hash,response);
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(p_org,p_workspace,p_actor,p_request_id,'synthetic_admin.role.assign','synthetic_admin_account',account.id,'succeeded',account.version,
  jsonb_build_object('rolePreset',p_preset));
 RETURN response;
END $$;

CREATE OR REPLACE FUNCTION public.synthetic_admin_revoke(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_fingerprint text,
 p_request_id uuid,p_key text,p_reservation_id uuid,p_expected_version bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts;
        request_hash text; receipt public.synthetic_admin_commands; response jsonb;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_fingerprint);
 IF p_request_id IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR p_reservation_id IS NULL
   OR p_expected_version<1 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_INVALID_REQUEST'; END IF;
 request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('requestId',p_request_id,'reservationId',p_reservation_id,
  'expectedVersion',p_expected_version)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.synthetic_admin_commands WHERE target_id=target.id AND actor_id=p_actor
  AND operation='revoke' AND idempotency_key=p_key FOR SHARE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN receipt.response;
 END IF;
 SELECT * INTO account FROM public.synthetic_admin_accounts WHERE id=p_reservation_id AND target_id=target.id
  AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF account.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_NOT_FOUND'; END IF;
 IF account.state<>'active' OR account.version<>p_expected_version
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_VERSION_CONFLICT'; END IF;
 UPDATE public.organization_members SET status='disabled',disabled_at=statement_timestamp(),updated_by=p_actor,updated_at=statement_timestamp()
 WHERE org_id=p_org AND user_id=account.auth_user_id AND status='active' AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 UPDATE public.workspace_memberships SET status='disabled',disabled_at=statement_timestamp(),updated_by=p_actor,updated_at=statement_timestamp()
 WHERE org_id=p_org AND workspace_id=p_workspace AND user_id=account.auth_user_id AND status='active' AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 UPDATE public.profiles SET status='disabled',updated_at=statement_timestamp() WHERE id=account.auth_user_id AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 UPDATE public.synthetic_admin_accounts SET state='ban_required',version=version+1,
  ban_request_id=p_request_id,ban_claim_id=gen_random_uuid(),ban_claim_request_id=p_request_id,
  ban_claim_key=p_key,ban_claim_expires_at=statement_timestamp()+interval '30 seconds',ban_attempts=1,
  revoked_at=statement_timestamp(),updated_at=statement_timestamp()
 WHERE id=account.id RETURNING * INTO account;
 response:=jsonb_build_object('status','ban_required','reservationId',account.id,'version',account.version);
 INSERT INTO public.synthetic_admin_commands(target_id,actor_id,operation,idempotency_key,request_id,request_hash,response)
 VALUES(target.id,p_actor,'revoke',p_key,p_request_id,request_hash,response);
 INSERT INTO public.synthetic_admin_commands(target_id,actor_id,operation,idempotency_key,request_id,request_hash,response)
 VALUES(target.id,p_actor,'ban_claim',p_key,p_request_id,
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('requestId',p_request_id,
   'reservationId',p_reservation_id)::text,'UTF8')),'hex'),response);
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version)
 VALUES(p_org,p_workspace,p_actor,p_request_id,'synthetic_admin.revoke','synthetic_admin_account',account.id,'succeeded',account.version);
 RETURN response||jsonb_build_object('externalBanAllowed',true,'authUserId',account.auth_user_id,
  'syntheticEmail',account.synthetic_email,'banClaimId',account.ban_claim_id);
END $$;

-- A fresh, currently authorized reconciliation can claim at most two further
-- exact-ID Auth ban attempts. An active lease blocks overlapping calls; the
-- previous token cannot complete after a newer fenced claim replaces it.
CREATE OR REPLACE FUNCTION public.synthetic_admin_claim_ban_retry(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_fingerprint text,
 p_request_id uuid,p_key text,p_reservation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts; auth_row auth.users;
        receipt public.synthetic_admin_commands; request_hash text; response jsonb;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_fingerprint);
 IF p_request_id IS NULL OR p_key !~ '^[A-Za-z0-9._:-]{8,200}$' OR p_reservation_id IS NULL
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_INVALID_REQUEST'; END IF;
 SELECT * INTO account FROM public.synthetic_admin_accounts WHERE id=p_reservation_id AND target_id=target.id
  AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF account.id IS NULL THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_NOT_FOUND'; END IF;
 IF account.state NOT IN('ban_required','ban_uncertain') THEN
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version);
 END IF;
 SELECT * INTO auth_row FROM auth.users WHERE id=account.auth_user_id FOR SHARE;
 IF auth_row.id IS NULL OR auth_row.email IS DISTINCT FROM account.synthetic_email
   OR auth_row.raw_app_meta_data->>'synthetic_admin_reservation_id' IS DISTINCT FROM account.id::text
   OR auth_row.raw_app_meta_data->>'synthetic_admin_target' IS DISTINCT FROM p_fingerprint
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 IF auth_row.banned_until>statement_timestamp()+interval '30 seconds' THEN
  UPDATE public.synthetic_admin_accounts SET state='revoked',version=version+1,
   ban_completed_claim_id=ban_claim_id,ban_completed_request_id=ban_claim_request_id,
   ban_completed_at=statement_timestamp(),updated_at=statement_timestamp()
  WHERE id=account.id RETURNING * INTO account;
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org,p_workspace,p_actor,account.ban_request_id,'synthetic_admin.auth.ban.confirm','synthetic_admin_account',account.id,'succeeded',account.version,
   jsonb_build_object('originalBanRequestId',account.ban_request_id,
    'banClaimRequestId',account.ban_claim_request_id,'banAttempt',account.ban_attempts));
  RETURN jsonb_build_object('status','revoked','reservationId',account.id,'version',account.version);
 END IF;
 request_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('requestId',p_request_id,
  'reservationId',p_reservation_id)::text,'UTF8')),'hex');
 SELECT * INTO receipt FROM public.synthetic_admin_commands WHERE target_id=target.id AND actor_id=p_actor
  AND operation='ban_claim' AND idempotency_key=p_key FOR SHARE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_IDEMPOTENCY_CONFLICT'; END IF;
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version);
 END IF;
 IF EXISTS(SELECT 1 FROM public.synthetic_admin_commands WHERE target_id=target.id AND actor_id=p_actor
  AND operation='ban_claim' AND request_id=p_request_id)
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_IDEMPOTENCY_CONFLICT'; END IF;
 IF account.ban_attempts>=3 OR account.state='ban_required' AND account.ban_claim_expires_at>statement_timestamp() THEN
  RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version);
 END IF;
 UPDATE public.synthetic_admin_accounts SET state='ban_required',version=version+1,
  ban_claim_id=gen_random_uuid(),ban_claim_request_id=p_request_id,ban_claim_key=p_key,
  ban_claim_expires_at=statement_timestamp()+interval '30 seconds',ban_attempts=ban_attempts+1,
  updated_at=statement_timestamp() WHERE id=account.id RETURNING * INTO account;
 response:=jsonb_build_object('status','ban_required','reservationId',account.id,'version',account.version);
 INSERT INTO public.synthetic_admin_commands(target_id,actor_id,operation,idempotency_key,request_id,request_hash,response)
 VALUES(target.id,p_actor,'ban_claim',p_key,p_request_id,request_hash,response);
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(p_org,p_workspace,p_actor,p_request_id,'synthetic_admin.auth.ban.claim','synthetic_admin_account',account.id,'succeeded',account.version,
  jsonb_build_object('originalBanRequestId',account.ban_request_id,'banAttempt',account.ban_attempts));
 RETURN jsonb_build_object('status','ban_required','reservationId',account.id,'version',account.version,
  'externalBanAllowed',true,'authUserId',account.auth_user_id,
  'syntheticEmail',account.synthetic_email,'banClaimId',account.ban_claim_id);
END $$;

CREATE OR REPLACE FUNCTION public.synthetic_admin_complete_ban(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_fingerprint text,
 p_request_id uuid,p_reservation_id uuid,p_auth_user_id uuid,p_claim_id uuid,p_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target public.synthetic_admin_targets; account public.synthetic_admin_accounts; auth_row auth.users;
BEGIN
 target:=public.synthetic_admin_assert_target(p_actor,p_org,p_workspace,p_authorization_version,p_fingerprint);
 SELECT * INTO account FROM public.synthetic_admin_accounts WHERE id=p_reservation_id AND target_id=target.id
  AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF account.id IS NULL OR account.auth_user_id IS DISTINCT FROM p_auth_user_id OR p_request_id IS NULL OR p_claim_id IS NULL
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_NOT_FOUND'; END IF;
 IF account.state='revoked' AND account.ban_completed_claim_id=p_claim_id AND account.ban_completed_request_id=p_request_id
 THEN RETURN jsonb_build_object('status','revoked','reservationId',account.id,'version',account.version); END IF;
 IF account.state NOT IN('ban_required','ban_uncertain') OR account.ban_claim_id IS DISTINCT FROM p_claim_id
   OR account.ban_claim_request_id IS DISTINCT FROM p_request_id
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 SELECT * INTO auth_row FROM auth.users WHERE id=p_auth_user_id FOR SHARE;
 IF auth_row.id IS NULL OR auth_row.email IS DISTINCT FROM account.synthetic_email
   OR auth_row.raw_app_meta_data->>'synthetic_admin_reservation_id' IS DISTINCT FROM account.id::text
   OR auth_row.raw_app_meta_data->>'synthetic_admin_target' IS DISTINCT FROM p_fingerprint
 THEN RAISE EXCEPTION 'SYNTHETIC_ADMIN_RECONCILIATION_REQUIRED'; END IF;
 IF p_confirmed IS TRUE AND auth_row.banned_until>statement_timestamp()+interval '30 seconds' THEN
  UPDATE public.synthetic_admin_accounts SET state='revoked',version=version+1,
   ban_completed_claim_id=p_claim_id,ban_completed_request_id=p_request_id,ban_completed_at=statement_timestamp(),
   updated_at=statement_timestamp() WHERE id=account.id RETURNING * INTO account;
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org,p_workspace,p_actor,account.ban_request_id,'synthetic_admin.auth.ban.confirm','synthetic_admin_account',account.id,'succeeded',account.version,
   jsonb_build_object('originalBanRequestId',account.ban_request_id,
    'banClaimRequestId',account.ban_claim_request_id,'banAttempt',account.ban_attempts));
 ELSE
  IF account.state='ban_uncertain' THEN
   RETURN jsonb_build_object('status','ban_uncertain','reservationId',account.id,'version',account.version);
  END IF;
  UPDATE public.synthetic_admin_accounts SET state='ban_uncertain',version=version+1,
   ban_claim_expires_at=statement_timestamp(),updated_at=statement_timestamp() WHERE id=account.id RETURNING * INTO account;
  INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
  VALUES(p_org,p_workspace,p_actor,p_request_id,'synthetic_admin.auth.ban.uncertain','synthetic_admin_account',account.id,'failed',account.version,
   jsonb_build_object('originalBanRequestId',account.ban_request_id,
    'banClaimRequestId',account.ban_claim_request_id,'banAttempt',account.ban_attempts));
 END IF;
 RETURN jsonb_build_object('status',account.state,'reservationId',account.id,'version',account.version);
END $$;

DO $$DECLARE fn regprocedure;BEGIN
 FOREACH fn IN ARRAY ARRAY[
  'public.synthetic_admin_reserve(uuid,uuid,uuid,bigint,text,uuid,text,text,text)'::regprocedure,
  'public.synthetic_admin_claim_execution(uuid,uuid,uuid,bigint,text,uuid,text,uuid)'::regprocedure,
  'public.synthetic_admin_reconcile(uuid,uuid,uuid,bigint,text,uuid)'::regprocedure,
  'public.synthetic_admin_list(uuid,uuid,uuid,bigint,text,uuid,integer)'::regprocedure,
  'public.synthetic_admin_assign_role(uuid,uuid,uuid,bigint,text,uuid,text,uuid,bigint,text)'::regprocedure,
  'public.synthetic_admin_revoke(uuid,uuid,uuid,bigint,text,uuid,text,uuid,bigint)'::regprocedure,
  'public.synthetic_admin_claim_ban_retry(uuid,uuid,uuid,bigint,text,uuid,text,uuid)'::regprocedure,
  'public.synthetic_admin_complete_ban(uuid,uuid,uuid,bigint,text,uuid,uuid,uuid,uuid,boolean)'::regprocedure
 ] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',fn);
 END LOOP;
END $$;
