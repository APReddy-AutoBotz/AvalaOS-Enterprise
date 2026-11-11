-- Governed multi-source transcript PR C: Delivery and Monitor authority.
--
-- This migration is additive and forward-only. It preserves all accepted
-- Delivery/Monitor identifiers and history, backfills only exact retained
-- Studio ancestry, and keeps every new mutation path default-off.

DO $pr_c_preflight$
DECLARE dirty_relation text; missing_count bigint;
BEGIN
  SELECT name INTO dirty_relation
  FROM unnest(ARRAY[
    'enterprise_delivery_handoffs',
    'enterprise_delivery_handoff_versions',
    'enterprise_delivery_handoff_review_events',
    'enterprise_delivery_handoff_approval_events',
    'enterprise_delivery_handoff_consumptions',
    'enterprise_delivery_source_packages',
    'enterprise_delivery_manual_materials',
    'enterprise_delivery_work_item_aggregates',
    'enterprise_delivery_work_item_versions',
    'enterprise_delivery_work_item_decisions',
    'enterprise_delivery_package_review_events',
    'enterprise_delivery_package_approval_events',
    'enterprise_delivery_package_blocker_events',
    'enterprise_delivery_monitor_command_receipts',
    'enterprise_delivery_monitor_command_attempts',
    'enterprise_delivery_monitor_effects',
    'enterprise_monitor_baseline_items'
  ]) expected(name)
  WHERE to_regclass(format('public.%I', name)) IS NOT NULL
  ORDER BY name LIMIT 1;
  IF dirty_relation IS NOT NULL THEN
    RAISE EXCEPTION 'PR_C_DIRTY_SCHEMA relation=%', dirty_relation;
  END IF;

  IF to_regclass('public.enterprise_delivery_work_packages') IS NULL
     OR to_regclass('public.enterprise_delivery_work_package_versions') IS NULL
     OR to_regclass('public.enterprise_delivery_work_items') IS NULL
     OR to_regclass('public.enterprise_monitor_baselines') IS NULL
     OR to_regclass('public.studio_artifact_source_packages') IS NULL THEN
    RAISE EXCEPTION 'PR_C_PREREQUISITE_MISSING';
  END IF;

  SELECT count(*) INTO missing_count
  FROM public.enterprise_delivery_work_packages package
  LEFT JOIN public.enterprise_studio_delivery_handoffs legacy
    ON legacy.id=package.handoff_id AND legacy.org_id=package.org_id AND legacy.workspace_id=package.workspace_id
  LEFT JOIN public.studio_artifact_aggregates artifact
    ON artifact.id=legacy.studio_document_id AND artifact.org_id=package.org_id AND artifact.workspace_id=package.workspace_id
  LEFT JOIN public.studio_artifact_source_packages source_package
    ON source_package.id=artifact.source_package_id AND source_package.artifact_id=artifact.id
  LEFT JOIN public.studio_artifact_versions studio_version
    ON studio_version.id=legacy.studio_version_id AND studio_version.artifact_id=artifact.id
  WHERE legacy.id IS NULL OR artifact.id IS NULL OR source_package.id IS NULL OR studio_version.id IS NULL
     OR legacy.studio_content_hash IS DISTINCT FROM studio_version.content_hash
     OR source_package.package_hash IS DISTINCT FROM artifact.source_package_hash;
  IF missing_count<>0 THEN
    RAISE EXCEPTION 'PR_C_BACKFILL_PRECONDITION_FAILED count=%', missing_count;
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.enterprise_delivery_work_items item
    LEFT JOIN public.enterprise_delivery_work_package_versions version
      ON version.id=item.package_version_id AND version.org_id=item.org_id AND version.workspace_id=item.workspace_id
    WHERE version.id IS NULL
  ) THEN RAISE EXCEPTION 'PR_C_DIRTY_DELIVERY_ITEM_ANCESTRY'; END IF;
END
$pr_c_preflight$;

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('delivery.handoff.request','delivery','Request an exact approved Studio to Delivery handoff'),
 ('delivery.handoff.review','delivery','Resolve independent Delivery handoff review'),
 ('delivery.handoff.approve','delivery','Resolve separate Delivery handoff approval'),
 ('delivery.handoff.consume','delivery','Accept and consume a Delivery handoff into one package'),
 ('delivery.package.manage','delivery','Create and revise governed Delivery packages and items'),
 ('delivery.package.review','delivery','Resolve independent Delivery package review'),
 ('delivery.package.approve','delivery','Resolve separate Delivery package approval'),
 ('monitor.baseline.create','monitor','Create an immutable baseline from an exact approved Delivery package')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;

INSERT INTO public.role_capabilities(role_id,capability_key)
SELECT role_id,target_capability
FROM public.role_capabilities existing
CROSS JOIN LATERAL (VALUES
 ('docs.approve','delivery.handoff.request'),
 ('project.manage','delivery.handoff.consume'),
 ('project.manage','delivery.package.manage'),
 ('approvals.review','delivery.handoff.review'),
 ('approvals.review','delivery.handoff.approve'),
 ('approvals.review','delivery.package.review'),
 ('approvals.review','delivery.package.approve'),
 ('monitor.manage','monitor.baseline.create')
) mapping(source_capability,target_capability)
WHERE existing.capability_key=mapping.source_capability
ON CONFLICT DO NOTHING;

ALTER TABLE public.enterprise_transcript_workspace_flags
 ADD COLUMN direct_delivery_planning_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN delivery_item_review_enabled boolean NOT NULL DEFAULT false,
 ADD COLUMN monitor_approved_baseline_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE public.enterprise_delivery_handoffs(
 id uuid PRIMARY KEY,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 target_workspace_id uuid NOT NULL,
 studio_artifact_id uuid NOT NULL,
 studio_artifact_type text NOT NULL CHECK(studio_artifact_type IN('brd','frd','pdd')),
 studio_artifact_version_id uuid NOT NULL,
 studio_artifact_version bigint NOT NULL CHECK(studio_artifact_version>0),
 studio_artifact_hash text NOT NULL CHECK(studio_artifact_hash~'^[0-9a-f]{64}$'),
 studio_source_package_id uuid NOT NULL,
 studio_source_package_hash text NOT NULL CHECK(studio_source_package_hash~'^[0-9a-f]{64}$'),
 template_kind text NOT NULL CHECK(template_kind IN('system','tenant')),
 system_template_version_id uuid,
 tenant_template_version_id uuid,
 template_version text NOT NULL CHECK(length(btrim(template_version)) BETWEEN 1 AND 120),
 template_hash text NOT NULL CHECK(template_hash~'^[0-9a-f]{64}$'),
 lineage_classification text NOT NULL CHECK(lineage_classification IN('assessed','mixed','not_assessed')),
 planning_only boolean NOT NULL,
 route_policy_version bigint NOT NULL CHECK(route_policy_version>0),
 route_policy_hash text NOT NULL CHECK(route_policy_hash~'^[0-9a-f]{64}$'),
 target_package_hash text NOT NULL CHECK(target_package_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('requested','target_review','changes_requested','rejected','approval_ready','approved','withdrawn','stale','consumed')),
 current_version bigint NOT NULL DEFAULT 1 CHECK(current_version>0),
 requested_by uuid NOT NULL REFERENCES public.profiles(id),
 requested_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),
 UNIQUE(id,org_id,target_workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(target_workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_artifact_version_id,studio_artifact_id,org_id,workspace_id)
   REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_source_package_id,studio_artifact_id,org_id,workspace_id)
   REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_template_version_id,org_id,workspace_id)
   REFERENCES public.studio_tenant_template_versions(id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(expires_at>requested_at),
 CHECK(planning_only=(lineage_classification='not_assessed')),
 CHECK((template_kind='system' AND system_template_version_id IS NOT NULL AND tenant_template_version_id IS NULL)
    OR (template_kind='tenant' AND system_template_version_id IS NULL AND tenant_template_version_id IS NOT NULL))
);

CREATE UNIQUE INDEX enterprise_delivery_one_active_handoff_per_route
 ON public.enterprise_delivery_handoffs(org_id,workspace_id,target_workspace_id,studio_artifact_version_id)
 WHERE status IN('requested','target_review','approval_ready','approved');

CREATE TABLE public.enterprise_delivery_handoff_target_items(
 handoff_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,source_workspace_id uuid NOT NULL,target_workspace_id uuid NOT NULL,
 ordinal integer NOT NULL CHECK(ordinal>0),client_key text NOT NULL CHECK(length(btrim(client_key)) BETWEEN 1 AND 120),
 item jsonb NOT NULL CHECK(jsonb_typeof(item)='object' AND pg_column_size(item)<=262144),item_hash text NOT NULL CHECK(item_hash~'^[0-9a-f]{64}$'),
 PRIMARY KEY(handoff_id,ordinal),UNIQUE(handoff_id,client_key),
 FOREIGN KEY(handoff_id,org_id,source_workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(target_workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE RESTRICT,
 CHECK(item_hash=public.enterprise_sha256_jsonb(item))
);

CREATE TABLE public.enterprise_delivery_handoff_versions(
 id uuid PRIMARY KEY,
 handoff_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),
 status text NOT NULL CHECK(status IN('requested','target_review','changes_requested','rejected','approval_ready','approved','withdrawn','stale','consumed')),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 actor_authorization_version bigint NOT NULL CHECK(actor_authorization_version>0),
 rationale text CHECK(rationale IS NULL OR length(btrim(rationale)) BETWEEN 1 AND 4000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,handoff_id,org_id,workspace_id),UNIQUE(handoff_id,version),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_delivery_handoff_review_events(
 id uuid PRIMARY KEY,handoff_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 handoff_version bigint NOT NULL CHECK(handoff_version>0),reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL CHECK(reviewer_authorization_version>0),
 outcome text NOT NULL CHECK(outcome IN('approved','changes_requested','rejected')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id,handoff_version),UNIQUE(id,handoff_id,org_id,workspace_id),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_delivery_handoff_approval_events(
 id uuid PRIMARY KEY,handoff_id uuid NOT NULL,review_event_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 handoff_version bigint NOT NULL CHECK(handoff_version>0),requested_by uuid NOT NULL REFERENCES public.profiles(id),reviewed_by uuid NOT NULL REFERENCES public.profiles(id),approved_by uuid NOT NULL REFERENCES public.profiles(id),
 approver_authorization_version bigint NOT NULL CHECK(approver_authorization_version>0),outcome text NOT NULL CHECK(outcome IN('approved','rejected')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id),UNIQUE(id,handoff_id,org_id,workspace_id),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(review_event_id,handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoff_review_events(id,handoff_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(requested_by<>reviewed_by AND requested_by<>approved_by AND reviewed_by<>approved_by)
);

ALTER TABLE public.enterprise_delivery_work_packages
 ALTER COLUMN handoff_id DROP NOT NULL,
 ADD COLUMN delivery_handoff_id uuid,
 ADD COLUMN source_package_id uuid,
 ADD COLUMN source_package_hash text,
 ADD COLUMN current_version_id uuid,
 ADD COLUMN aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version>0);

-- Accepted guards reject additive backfill columns by design. Remove them only
-- inside this transaction; stronger PR C guards are installed below.
DROP TRIGGER enterprise_package_status_guard ON public.enterprise_delivery_work_packages;
DROP TRIGGER enterprise_delivery_version_status_guard ON public.enterprise_delivery_work_package_versions;

CREATE TABLE public.enterprise_delivery_source_packages(
 id uuid PRIMARY KEY,work_package_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),source_mode text NOT NULL CHECK(source_mode IN('studio_handoff','manual')),
 legacy_handoff_id uuid,delivery_handoff_id uuid,
 studio_workspace_id uuid,studio_artifact_id uuid,studio_artifact_type text,studio_artifact_version_id uuid,studio_artifact_version bigint,studio_artifact_hash text,
 studio_source_package_id uuid,studio_source_package_hash text,
 template_kind text,system_template_version_id uuid,tenant_template_version_id uuid,template_version text,template_hash text,
 manual_brief_hash text,lineage_classification text NOT NULL CHECK(lineage_classification IN('assessed','mixed','not_assessed')),
 planning_only boolean NOT NULL,route_policy_version bigint NOT NULL CHECK(route_policy_version>0),route_policy_hash text NOT NULL CHECK(route_policy_hash~'^[0-9a-f]{64}$'),
 package_hash text NOT NULL CHECK(package_hash~'^[0-9a-f]{64}$'),created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,work_package_id,org_id,workspace_id),UNIQUE(work_package_id,version),UNIQUE(work_package_id,package_hash),
 FOREIGN KEY(work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_packages(id,org_id,workspace_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(legacy_handoff_id,org_id,workspace_id) REFERENCES public.enterprise_studio_delivery_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(delivery_handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,target_workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_artifact_version_id,studio_artifact_id,org_id,studio_workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_source_package_id,studio_artifact_id,org_id,studio_workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_template_version_id,org_id,studio_workspace_id) REFERENCES public.studio_tenant_template_versions(id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(
  (source_mode='studio_handoff' AND (legacy_handoff_id IS NOT NULL)<>(delivery_handoff_id IS NOT NULL)
   AND studio_workspace_id IS NOT NULL AND studio_artifact_id IS NOT NULL AND studio_artifact_type IN('brd','frd','pdd') AND studio_artifact_version_id IS NOT NULL AND studio_artifact_version>0 AND studio_artifact_hash~'^[0-9a-f]{64}$'
   AND studio_source_package_id IS NOT NULL AND studio_source_package_hash~'^[0-9a-f]{64}$' AND template_kind IN('system','tenant')
   AND template_version IS NOT NULL AND template_hash~'^[0-9a-f]{64}$' AND manual_brief_hash IS NULL
   AND ((template_kind='system' AND system_template_version_id IS NOT NULL AND tenant_template_version_id IS NULL)
     OR(template_kind='tenant' AND system_template_version_id IS NULL AND tenant_template_version_id IS NOT NULL)))
  OR(source_mode='manual' AND legacy_handoff_id IS NULL AND delivery_handoff_id IS NULL AND studio_workspace_id IS NULL AND studio_artifact_id IS NULL AND studio_artifact_type IS NULL AND studio_artifact_version_id IS NULL
   AND studio_artifact_version IS NULL AND studio_artifact_hash IS NULL AND studio_source_package_id IS NULL AND studio_source_package_hash IS NULL
   AND template_kind IS NULL AND system_template_version_id IS NULL AND tenant_template_version_id IS NULL AND template_version IS NULL AND template_hash IS NULL
   AND manual_brief_hash~'^[0-9a-f]{64}$' AND lineage_classification='not_assessed' AND planning_only)
 ),
 CHECK(planning_only=(lineage_classification='not_assessed'))
);

CREATE TABLE public.enterprise_delivery_manual_materials(
 source_package_id uuid PRIMARY KEY,work_package_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 manual_brief text NOT NULL CHECK(length(btrim(manual_brief)) BETWEEN 1 AND 20000),manual_brief_hash text NOT NULL CHECK(manual_brief_hash~'^[0-9a-f]{64}$'),created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_package_id,work_package_id,org_id,workspace_id),
 FOREIGN KEY(source_package_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(manual_brief_hash=encode(public.digest(convert_to(manual_brief,'UTF8'),'sha256'),'hex'))
);

INSERT INTO public.enterprise_delivery_source_packages(
 id,work_package_id,org_id,workspace_id,version,source_mode,legacy_handoff_id,studio_workspace_id,studio_artifact_id,studio_artifact_type,studio_artifact_version_id,studio_artifact_version,studio_artifact_hash,
 studio_source_package_id,studio_source_package_hash,template_kind,system_template_version_id,tenant_template_version_id,template_version,template_hash,
 lineage_classification,planning_only,route_policy_version,route_policy_hash,package_hash,created_by,created_at
)
SELECT public.studio_pr_b_deterministic_uuid('delivery-source-package',package.id),package.id,package.org_id,package.workspace_id,1,'studio_handoff',legacy.id,package.workspace_id,
 artifact.id,artifact.artifact_type,studio_version.id,studio_version.version,studio_version.content_hash,source_package.id,source_package.package_hash,studio_version.template_kind,
 CASE WHEN studio_version.template_kind='system' THEN studio_version.template_id END,studio_version.tenant_template_version_id,studio_version.template_version,studio_version.template_hash,
 source_package.lineage_classification,source_package.planning_only,source_package.route_policy_version,source_package.route_policy_hash,
 public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-source-package-2','workPackageId',package.id,'legacyHandoffId',legacy.id,'studioArtifactVersionId',studio_version.id,
   'studioArtifactType',artifact.artifact_type,'studioArtifactHash',studio_version.content_hash,'studioSourcePackageId',source_package.id,'studioSourcePackageHash',source_package.package_hash,
   'templateKind',studio_version.template_kind,'templateVersion',studio_version.template_version,'templateHash',studio_version.template_hash,
   'lineageClassification',source_package.lineage_classification,'planningOnly',source_package.planning_only)),package.created_by,package.created_at
FROM public.enterprise_delivery_work_packages package
JOIN public.enterprise_studio_delivery_handoffs legacy ON legacy.id=package.handoff_id AND legacy.org_id=package.org_id AND legacy.workspace_id=package.workspace_id
JOIN public.studio_artifact_aggregates artifact ON artifact.id=legacy.studio_document_id AND artifact.org_id=package.org_id AND artifact.workspace_id=package.workspace_id
JOIN public.studio_artifact_versions studio_version ON studio_version.id=legacy.studio_version_id AND studio_version.artifact_id=artifact.id
JOIN public.studio_artifact_source_packages source_package ON source_package.id=studio_version.source_package_id AND source_package.artifact_id=artifact.id;

UPDATE public.enterprise_delivery_work_packages package
SET source_package_id=source.id,source_package_hash=source.package_hash
FROM public.enterprise_delivery_source_packages source
WHERE source.work_package_id=package.id AND source.org_id=package.org_id AND source.workspace_id=package.workspace_id;

ALTER TABLE public.enterprise_delivery_work_package_versions
 ADD COLUMN source_package_id uuid,
 ADD COLUMN source_package_hash text,
 ADD COLUMN lineage_classification text,
 ADD COLUMN planning_only boolean,
 ADD COLUMN studio_workspace_id uuid;

UPDATE public.enterprise_delivery_work_package_versions version
SET source_package_id=source.id,source_package_hash=source.package_hash,lineage_classification=source.lineage_classification,planning_only=source.planning_only,
 studio_workspace_id=source.studio_workspace_id
FROM public.enterprise_delivery_source_packages source
WHERE source.work_package_id=version.work_package_id AND source.org_id=version.org_id AND source.workspace_id=version.workspace_id;

UPDATE public.enterprise_delivery_work_packages package
SET current_version_id=version.id
FROM public.enterprise_delivery_work_package_versions version
WHERE version.work_package_id=package.id AND version.org_id=package.org_id AND version.workspace_id=package.workspace_id AND version.version=package.current_version;

ALTER TABLE public.enterprise_delivery_work_packages
 ALTER COLUMN source_package_id SET NOT NULL,ALTER COLUMN source_package_hash SET NOT NULL,ALTER COLUMN current_version_id SET NOT NULL,
 ADD CONSTRAINT enterprise_delivery_package_source_fk FOREIGN KEY(source_package_id,id,org_id,workspace_id) REFERENCES public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT enterprise_delivery_package_current_version_fk FOREIGN KEY(current_version_id,id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT enterprise_delivery_package_handoff_union CHECK((handoff_id IS NOT NULL AND delivery_handoff_id IS NULL) OR (handoff_id IS NULL));

ALTER TABLE public.enterprise_delivery_work_package_versions
 DROP CONSTRAINT enterprise_work_package_versions_studio_fkey,
 ALTER COLUMN source_package_id SET NOT NULL,ALTER COLUMN source_package_hash SET NOT NULL,ALTER COLUMN lineage_classification SET NOT NULL,ALTER COLUMN planning_only SET NOT NULL,
 ALTER COLUMN studio_document_id DROP NOT NULL,ALTER COLUMN artifact_type DROP NOT NULL,ALTER COLUMN studio_version_id DROP NOT NULL,
 ALTER COLUMN studio_version DROP NOT NULL,ALTER COLUMN studio_content_hash DROP NOT NULL,
 ADD CONSTRAINT enterprise_delivery_version_source_fk FOREIGN KEY(source_package_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT enterprise_delivery_version_studio_fk FOREIGN KEY(studio_version_id,studio_document_id,org_id,studio_workspace_id)
  REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT enterprise_delivery_version_lineage_check CHECK(lineage_classification IN('assessed','mixed','not_assessed') AND planning_only=(lineage_classification='not_assessed')),
 ADD CONSTRAINT enterprise_delivery_version_studio_union_check CHECK(
  (studio_workspace_id IS NULL AND studio_document_id IS NULL AND artifact_type IS NULL AND studio_version_id IS NULL AND studio_version IS NULL AND studio_content_hash IS NULL)
  OR(studio_workspace_id IS NOT NULL AND studio_document_id IS NOT NULL AND artifact_type IN('brd','frd','pdd') AND studio_version_id IS NOT NULL AND studio_version>0 AND studio_content_hash~'^[0-9a-f]{64}$'));

CREATE TABLE public.enterprise_delivery_handoff_consumptions(
 handoff_id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 work_package_id uuid NOT NULL,source_package_id uuid NOT NULL,consumed_by uuid NOT NULL REFERENCES public.profiles(id),consumer_authorization_version bigint NOT NULL CHECK(consumer_authorization_version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id,org_id,workspace_id),UNIQUE(work_package_id),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,target_workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_packages(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_package_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.enterprise_delivery_work_packages
 ADD CONSTRAINT enterprise_delivery_package_v2_handoff_fk FOREIGN KEY(delivery_handoff_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_handoffs(id,org_id,target_workspace_id) ON DELETE RESTRICT;

SET CONSTRAINTS ALL IMMEDIATE;

DO $pr_c_backfill_check$
DECLARE package_count bigint;source_count bigint;version_count bigint;bound_versions bigint;
BEGIN
 SELECT count(*) INTO package_count FROM public.enterprise_delivery_work_packages;
 SELECT count(*) INTO source_count FROM public.enterprise_delivery_source_packages;
 SELECT count(*) INTO version_count FROM public.enterprise_delivery_work_package_versions;
 SELECT count(*) INTO bound_versions FROM public.enterprise_delivery_work_package_versions WHERE source_package_id IS NOT NULL;
 IF package_count<>source_count OR version_count<>bound_versions THEN
  RAISE EXCEPTION 'PR_C_BACKFILL_CARDINALITY_MISMATCH packages=% sources=% versions=% bound=%',package_count,source_count,version_count,bound_versions;
 END IF;
END
$pr_c_backfill_check$;

-- Strong generalized authority is now installed; only now remove PR B's
-- temporary Assess-only legacy Delivery guard.
DROP TRIGGER studio_pr_b_delivery_assess_handoff_only ON public.enterprise_studio_delivery_handoffs;
DROP FUNCTION public.studio_pr_b_delivery_guard();

CREATE TABLE public.enterprise_delivery_work_item_aggregates(
 id uuid PRIMARY KEY,work_package_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 parent_aggregate_id uuid,current_version_id uuid,current_version bigint NOT NULL DEFAULT 1 CHECK(current_version>0),aggregate_version bigint NOT NULL DEFAULT 1 CHECK(aggregate_version>0),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,work_package_id,org_id,workspace_id),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_packages(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(parent_aggregate_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_item_aggregates(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_delivery_work_item_versions(
 id uuid PRIMARY KEY,item_aggregate_id uuid NOT NULL,work_package_id uuid NOT NULL,package_version_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),parent_version_id uuid,
 item_type text NOT NULL CHECK(item_type IN('Epic','Story','Task','Milestone','Dependency','Risk')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 400),description text NOT NULL CHECK(length(description)<=20000),
 acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(acceptance_criteria)='array' AND pg_column_size(acceptance_criteria)<=262144),
 non_functional_requirements jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(non_functional_requirements)='array' AND pg_column_size(non_functional_requirements)<=262144),
 delivery_source_package_id uuid NOT NULL,delivery_source_package_hash text NOT NULL CHECK(delivery_source_package_hash~'^[0-9a-f]{64}$'),
 studio_source_package_id uuid,studio_source_package_hash text,
 source_artifact_workspace_id uuid,source_artifact_id uuid,source_artifact_type text,source_artifact_version_id uuid,source_artifact_version bigint,source_artifact_hash text,source_section_locator text,
 status text NOT NULL CHECK(status IN('proposed','edited','accepted','rejected','superseded')),
 rationale text CHECK(rationale IS NULL OR length(btrim(rationale)) BETWEEN 1 AND 4000),content_hash text NOT NULL CHECK(content_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,item_aggregate_id,work_package_id,org_id,workspace_id),UNIQUE(item_aggregate_id,version),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(item_aggregate_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_item_aggregates(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(package_version_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(delivery_source_package_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(parent_version_id,item_aggregate_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_artifact_version_id,source_artifact_id,org_id,source_artifact_workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_source_package_id,source_artifact_id,org_id,source_artifact_workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((source_artifact_workspace_id IS NULL AND source_artifact_id IS NULL AND source_artifact_type IS NULL AND source_artifact_version_id IS NULL AND source_artifact_version IS NULL AND source_artifact_hash IS NULL
      AND source_section_locator IS NULL AND studio_source_package_id IS NULL AND studio_source_package_hash IS NULL)
    OR(source_artifact_workspace_id IS NOT NULL AND source_artifact_id IS NOT NULL AND source_artifact_type IN('brd','frd','pdd') AND source_artifact_version_id IS NOT NULL
      AND source_artifact_version>0 AND source_artifact_hash~'^[0-9a-f]{64}$' AND length(btrim(source_section_locator)) BETWEEN 1 AND 1000
      AND studio_source_package_id IS NOT NULL AND studio_source_package_hash~'^[0-9a-f]{64}$'))
);

ALTER TABLE public.enterprise_delivery_work_item_aggregates
 ADD CONSTRAINT enterprise_delivery_item_current_version_fk
 FOREIGN KEY(current_version_id,id,work_package_id,org_id,workspace_id)
 REFERENCES public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,org_id,workspace_id)
 DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.enterprise_delivery_work_item_decisions(
 id uuid PRIMARY KEY,item_aggregate_id uuid NOT NULL,item_version_id uuid NOT NULL,work_package_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN('accepted','rejected')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),
 decided_by uuid NOT NULL REFERENCES public.profiles(id),decider_authorization_version bigint NOT NULL CHECK(decider_authorization_version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(item_aggregate_id,item_version_id),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(item_version_id,item_aggregate_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT
);

INSERT INTO public.enterprise_delivery_work_item_aggregates(
 id,work_package_id,org_id,workspace_id,parent_aggregate_id,current_version_id,current_version,aggregate_version,created_by,created_at,updated_at
)
SELECT item.id,version.work_package_id,item.org_id,item.workspace_id,item.parent_item_id,
 NULL,1,1,item.created_by,item.created_at,item.created_at
FROM public.enterprise_delivery_work_items item
JOIN public.enterprise_delivery_work_package_versions version ON version.id=item.package_version_id AND version.org_id=item.org_id AND version.workspace_id=item.workspace_id;

INSERT INTO public.enterprise_delivery_work_item_versions(
 id,item_aggregate_id,work_package_id,package_version_id,org_id,workspace_id,version,item_type,title,description,acceptance_criteria,non_functional_requirements,
 delivery_source_package_id,delivery_source_package_hash,studio_source_package_id,studio_source_package_hash,
 source_artifact_workspace_id,source_artifact_id,source_artifact_type,source_artifact_version_id,source_artifact_version,source_artifact_hash,source_section_locator,status,content_hash,created_by,created_at
)
SELECT public.studio_pr_b_deterministic_uuid('delivery-item-version',item.id),item.id,package_version.work_package_id,item.package_version_id,item.org_id,item.workspace_id,1,
 item.item_type,item.title,item.description,item.acceptance_criteria,item.non_functional_requirements,package_version.source_package_id,package_version.source_package_hash,
 source.studio_source_package_id,source.studio_source_package_hash,item.workspace_id,package_version.studio_document_id,package_version.artifact_type,package_version.studio_version_id,package_version.studio_version,package_version.studio_content_hash,
 item.source_section_locator,'proposed',public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-item-2','type',item.item_type,'title',item.title,'description',item.description,
  'acceptanceCriteria',item.acceptance_criteria,'nonFunctionalRequirements',item.non_functional_requirements,'sourceArtifactId',package_version.studio_document_id,
   'deliverySourcePackageId',package_version.source_package_id,'deliverySourcePackageHash',package_version.source_package_hash,
   'studioSourcePackageId',source.studio_source_package_id,'studioSourcePackageHash',source.studio_source_package_hash,
   'sourceArtifactVersion',package_version.studio_version,'sourceArtifactHash',package_version.studio_content_hash,'sourceSectionLocator',item.source_section_locator)),item.created_by,item.created_at
FROM public.enterprise_delivery_work_items item
JOIN public.enterprise_delivery_work_package_versions package_version ON package_version.id=item.package_version_id AND package_version.org_id=item.org_id AND package_version.workspace_id=item.workspace_id
JOIN public.enterprise_delivery_source_packages source ON source.id=package_version.source_package_id AND source.work_package_id=package_version.work_package_id;

UPDATE public.enterprise_delivery_work_item_aggregates aggregate
SET current_version_id=version.id
FROM public.enterprise_delivery_work_item_versions version
WHERE version.item_aggregate_id=aggregate.id AND version.work_package_id=aggregate.work_package_id
 AND version.org_id=aggregate.org_id AND version.workspace_id=aggregate.workspace_id AND version.version=1;

SET CONSTRAINTS ALL IMMEDIATE;

CREATE TABLE public.enterprise_delivery_package_review_events(
 id uuid PRIMARY KEY,work_package_id uuid NOT NULL,package_version_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 package_version bigint NOT NULL CHECK(package_version>0),package_aggregate_version bigint NOT NULL CHECK(package_aggregate_version>0),package_hash text NOT NULL CHECK(package_hash~'^[0-9a-f]{64}$'),accepted_set_hash text NOT NULL CHECK(accepted_set_hash~'^[0-9a-f]{64}$'),accepted_item_count integer NOT NULL CHECK(accepted_item_count BETWEEN 0 AND 250),
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL CHECK(reviewer_authorization_version>0),
 outcome text NOT NULL CHECK(outcome IN('approved','changes_requested','rejected')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_package_id,package_version_id),UNIQUE(id,work_package_id,package_version_id,org_id,workspace_id),
 FOREIGN KEY(package_version_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_delivery_package_approval_events(
 id uuid PRIMARY KEY,work_package_id uuid NOT NULL,package_version_id uuid NOT NULL,review_event_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,package_version bigint NOT NULL CHECK(package_version>0),package_aggregate_version bigint NOT NULL CHECK(package_aggregate_version>0),
 package_hash text NOT NULL CHECK(package_hash~'^[0-9a-f]{64}$'),accepted_set_hash text NOT NULL CHECK(accepted_set_hash~'^[0-9a-f]{64}$'),accepted_item_count integer NOT NULL CHECK(accepted_item_count BETWEEN 0 AND 250),
 created_by uuid NOT NULL REFERENCES public.profiles(id),reviewed_by uuid NOT NULL REFERENCES public.profiles(id),approved_by uuid NOT NULL REFERENCES public.profiles(id),
 approver_authorization_version bigint NOT NULL CHECK(approver_authorization_version>0),outcome text NOT NULL CHECK(outcome IN('approved','rejected')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_package_id,package_version_id),UNIQUE(id,work_package_id,package_version_id,org_id,workspace_id),
 FOREIGN KEY(package_version_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(review_event_id,work_package_id,package_version_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_package_review_events(id,work_package_id,package_version_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(created_by<>reviewed_by AND created_by<>approved_by AND reviewed_by<>approved_by)
);

CREATE TABLE public.enterprise_delivery_package_blocker_events(
 id uuid PRIMARY KEY,work_package_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 blocker_key text NOT NULL CHECK(length(btrim(blocker_key)) BETWEEN 1 AND 120),sequence bigint NOT NULL CHECK(sequence>0),action text NOT NULL CHECK(action IN('opened','resolved')),
 blocker_type text NOT NULL CHECK(blocker_type IN('source_stale','item_unresolved','review_changes_requested','review_rejected','approval_rejected','manual')),
 safe_summary text NOT NULL CHECK(length(btrim(safe_summary)) BETWEEN 1 AND 500),actor_id uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_package_id,blocker_key,sequence),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_packages(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_delivery_monitor_command_receipts(
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 action text NOT NULL,idempotency_key text NOT NULL CHECK(length(btrim(idempotency_key)) BETWEEN 8 AND 128),request_id uuid NOT NULL,
 request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),binding_hash text NOT NULL CHECK(binding_hash~'^[0-9a-f]{64}$'),
 authorization_version bigint NOT NULL CHECK(authorization_version>0),execution_token uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),
 status text NOT NULL CHECK(status IN('claimed','committed','failed')),resource_id uuid,response jsonb,failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(org_id,workspace_id,actor_id,action,idempotency_key),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 CHECK((status='claimed' AND response IS NULL AND failure_code IS NULL AND completed_at IS NULL)
    OR(status='committed' AND jsonb_typeof(response)='object' AND failure_code IS NULL AND completed_at IS NOT NULL)
    OR(status='failed' AND response IS NULL AND failure_code IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE TABLE public.enterprise_delivery_monitor_command_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receipt_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL,request_id uuid NOT NULL,authorization_version bigint NOT NULL CHECK(authorization_version>0),
 execution_token uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),binding_hash text NOT NULL CHECK(binding_hash~'^[0-9a-f]{64}$'),created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT enterprise_pr_c_command_attempt_business_key UNIQUE(receipt_id,request_id,authorization_version),UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(receipt_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_monitor_command_receipts(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.enterprise_delivery_monitor_effects(
 id uuid PRIMARY KEY,receipt_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),action text NOT NULL,binding_hash text NOT NULL CHECK(binding_hash~'^[0-9a-f]{64}$'),execution_token uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),
 resource_id uuid NOT NULL,audit_id uuid NOT NULL REFERENCES public.privileged_audit_events(id) ON DELETE RESTRICT,result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(receipt_id),UNIQUE(audit_id),UNIQUE(org_id,workspace_id,actor_id,action,binding_hash),
 FOREIGN KEY(receipt_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_monitor_command_receipts(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

DROP TRIGGER enterprise_monitor_status_guard ON public.enterprise_monitor_baselines;
ALTER TABLE public.enterprise_monitor_baselines
 ALTER COLUMN studio_document_id DROP NOT NULL,ALTER COLUMN studio_version DROP NOT NULL,ALTER COLUMN studio_content_hash DROP NOT NULL,
 ADD COLUMN baseline_contract text NOT NULL DEFAULT 'delivery-monitor-2',
 ADD COLUMN package_version bigint,
 ADD COLUMN package_hash text,
 ADD COLUMN source_package_id uuid,
 ADD COLUMN source_package_hash text,
 ADD COLUMN lineage_classification text,
 ADD COLUMN planning_only boolean,
 ADD COLUMN package_approval_id uuid,
 ADD COLUMN accepted_set_hash text,
 ADD COLUMN accepted_item_count integer;

UPDATE public.enterprise_monitor_baselines baseline SET
 baseline_contract='legacy-1',package_version=version.version,package_hash=version.content_hash,
 source_package_id=version.source_package_id,source_package_hash=version.source_package_hash,
 lineage_classification=version.lineage_classification,planning_only=version.planning_only,
 package_approval_id=approval.id,
 accepted_set_hash=public.enterprise_sha256_jsonb(jsonb_build_object('contract','legacy-monitor-items-1','itemIds',baseline.approved_item_ids)),
 accepted_item_count=jsonb_array_length(baseline.approved_item_ids)
FROM public.enterprise_delivery_work_package_versions version
LEFT JOIN public.enterprise_high_impact_approvals approval ON approval.resource_type='delivery_work_package' AND approval.resource_id=version.work_package_id
 AND approval.org_id=version.org_id AND approval.workspace_id=version.workspace_id AND approval.outcome='approved'
WHERE version.id=baseline.work_package_version_id AND version.work_package_id=baseline.work_package_id;

-- Legacy approvals remain in their accepted authority. PR C approval identity is
-- reserved exclusively for delivery-monitor-2 rows.
UPDATE public.enterprise_monitor_baselines SET package_approval_id=NULL WHERE baseline_contract='legacy-1';

ALTER TABLE public.enterprise_monitor_baselines
 ALTER COLUMN package_version SET NOT NULL,ALTER COLUMN package_hash SET NOT NULL,ALTER COLUMN source_package_id SET NOT NULL,
 ALTER COLUMN source_package_hash SET NOT NULL,ALTER COLUMN lineage_classification SET NOT NULL,ALTER COLUMN planning_only SET NOT NULL,ALTER COLUMN accepted_set_hash SET NOT NULL,
 ALTER COLUMN accepted_item_count SET NOT NULL,
 ADD CONSTRAINT enterprise_monitor_package_hash_check CHECK(package_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT enterprise_monitor_source_hash_check CHECK(source_package_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT enterprise_monitor_accepted_set_hash_check CHECK(accepted_set_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT enterprise_monitor_accepted_item_count_check CHECK(accepted_item_count BETWEEN 0 AND 250),
 ADD CONSTRAINT enterprise_monitor_lineage_check CHECK(lineage_classification IN('assessed','mixed','not_assessed') AND planning_only=(lineage_classification='not_assessed')),
 ADD CONSTRAINT enterprise_monitor_contract_check CHECK((baseline_contract='legacy-1') OR (baseline_contract='delivery-monitor-2' AND package_approval_id IS NOT NULL)),
 ADD CONSTRAINT enterprise_monitor_source_package_fk FOREIGN KEY(source_package_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT enterprise_monitor_package_approval_fk FOREIGN KEY(package_approval_id,work_package_id,work_package_version_id,org_id,workspace_id)
 REFERENCES public.enterprise_delivery_package_approval_events(id,work_package_id,package_version_id,org_id,workspace_id) ON DELETE RESTRICT;

CREATE TABLE public.enterprise_monitor_baseline_items(
 baseline_id uuid NOT NULL,work_package_id uuid NOT NULL,work_package_version_id uuid NOT NULL,item_aggregate_id uuid NOT NULL,item_version_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,ordinal integer NOT NULL CHECK(ordinal>0),item_type text NOT NULL CHECK(item_type IN('Epic','Story','Task','Milestone','Dependency','Risk')),
 item_hash text NOT NULL CHECK(item_hash~'^[0-9a-f]{64}$'),PRIMARY KEY(baseline_id,item_aggregate_id),UNIQUE(baseline_id,ordinal),
 FOREIGN KEY(baseline_id) REFERENCES public.enterprise_monitor_baselines(id) ON DELETE RESTRICT,
 FOREIGN KEY(item_version_id,item_aggregate_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(work_package_version_id,work_package_id,org_id,workspace_id) REFERENCES public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id) ON DELETE RESTRICT
);

INSERT INTO public.enterprise_monitor_baseline_items(baseline_id,work_package_id,work_package_version_id,item_aggregate_id,item_version_id,org_id,workspace_id,ordinal,item_type,item_hash)
SELECT baseline.id,baseline.work_package_id,baseline.work_package_version_id,aggregate.id,version.id,baseline.org_id,baseline.workspace_id,entry.ordinality::integer,version.item_type,version.content_hash
FROM public.enterprise_monitor_baselines baseline
CROSS JOIN LATERAL jsonb_array_elements_text(baseline.approved_item_ids) WITH ORDINALITY entry(item_id,ordinality)
JOIN public.enterprise_delivery_work_item_aggregates aggregate ON aggregate.id=entry.item_id::uuid AND aggregate.work_package_id=baseline.work_package_id
JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id AND version.item_aggregate_id=aggregate.id;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_delivery_source_current(p_source_package uuid,p_org uuid,p_workspace uuid,p_lock boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE source public.enterprise_delivery_source_packages;artifact public.studio_artifact_aggregates;version public.studio_artifact_versions;studio_source public.studio_artifact_source_packages;
 delivery_handoff public.enterprise_delivery_handoffs;legacy_handoff public.enterprise_studio_delivery_handoffs;
BEGIN
 IF p_lock THEN SELECT * INTO source FROM public.enterprise_delivery_source_packages WHERE id=p_source_package AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 ELSE SELECT * INTO source FROM public.enterprise_delivery_source_packages WHERE id=p_source_package AND org_id=p_org AND workspace_id=p_workspace; END IF;
 IF source.id IS NULL THEN RETURN false; END IF;
 IF source.source_mode='manual' THEN RETURN true; END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=source.studio_artifact_id AND org_id=p_org AND workspace_id=source.studio_workspace_id FOR SHARE;
 SELECT * INTO version FROM public.studio_artifact_versions WHERE id=source.studio_artifact_version_id AND artifact_id=source.studio_artifact_id AND org_id=p_org AND workspace_id=source.studio_workspace_id FOR SHARE;
 SELECT * INTO studio_source FROM public.studio_artifact_source_packages WHERE id=source.studio_source_package_id AND artifact_id=source.studio_artifact_id AND org_id=p_org AND workspace_id=source.studio_workspace_id FOR SHARE;
 IF source.delivery_handoff_id IS NOT NULL THEN
  SELECT * INTO delivery_handoff FROM public.enterprise_delivery_handoffs WHERE id=source.delivery_handoff_id AND org_id=p_org AND target_workspace_id=p_workspace FOR SHARE;
 ELSE
  SELECT * INTO legacy_handoff FROM public.enterprise_studio_delivery_handoffs WHERE id=source.legacy_handoff_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 END IF;
 RETURN artifact.id IS NOT NULL AND artifact.lifecycle='approved'
   AND version.lifecycle IN('approved','superseded')
   AND version.version=source.studio_artifact_version AND version.content_hash=source.studio_artifact_hash
   AND version.source_package_id=studio_source.id AND version.source_package_hash=studio_source.package_hash AND studio_source.package_hash=source.studio_source_package_hash
   AND version.template_kind=source.template_kind AND version.template_version=source.template_version AND version.template_hash=source.template_hash
   AND ((source.delivery_handoff_id IS NOT NULL AND delivery_handoff.id IS NOT NULL AND delivery_handoff.status='consumed'
      AND delivery_handoff.studio_artifact_version_id=version.id AND delivery_handoff.studio_artifact_hash=version.content_hash
      AND delivery_handoff.studio_source_package_id=studio_source.id AND delivery_handoff.studio_source_package_hash=studio_source.package_hash)
    OR (source.legacy_handoff_id IS NOT NULL AND legacy_handoff.id IS NOT NULL AND legacy_handoff.studio_version_id=version.id
      AND legacy_handoff.studio_content_hash=version.content_hash));
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_handoff_source_current(p_handoff uuid,p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.enterprise_delivery_handoffs handoff
  JOIN public.studio_artifact_aggregates artifact ON artifact.id=handoff.studio_artifact_id AND artifact.org_id=handoff.org_id AND artifact.workspace_id=handoff.workspace_id
  JOIN public.studio_artifact_versions version ON version.id=handoff.studio_artifact_version_id AND version.artifact_id=artifact.id
  JOIN public.studio_artifact_source_packages source ON source.id=handoff.studio_source_package_id AND source.artifact_id=artifact.id
  WHERE handoff.id=p_handoff AND handoff.org_id=p_org AND artifact.lifecycle='approved' AND artifact.current_approved_version_id=version.id
   AND version.lifecycle='approved' AND version.version=handoff.studio_artifact_version AND version.content_hash=handoff.studio_artifact_hash
   AND artifact.source_package_id=source.id AND artifact.source_package_hash=source.package_hash AND source.package_hash=handoff.studio_source_package_hash
   AND version.template_kind=handoff.template_kind AND version.template_version=handoff.template_version AND version.template_hash=handoff.template_hash
 )
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_accepted_item_manifest(p_package uuid,p_org uuid,p_workspace uuid,p_lock boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE manifest jsonb;
BEGIN
 IF p_lock THEN
  PERFORM 1 FROM public.enterprise_delivery_work_item_aggregates aggregate
   WHERE aggregate.work_package_id=p_package AND aggregate.org_id=p_org AND aggregate.workspace_id=p_workspace
   ORDER BY aggregate.id FOR UPDATE;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('itemAggregateId',aggregate.id,'itemVersionId',version.id,'itemVersion',version.version,
   'itemHash',version.content_hash,'itemType',version.item_type) ORDER BY aggregate.id),'[]'::jsonb)
 INTO manifest
 FROM public.enterprise_delivery_work_item_aggregates aggregate
 JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id AND version.item_aggregate_id=aggregate.id
 WHERE aggregate.work_package_id=p_package AND aggregate.org_id=p_org AND aggregate.workspace_id=p_workspace AND version.status='accepted';
 RETURN manifest;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_assert_package_resolved(p_package uuid,p_org uuid,p_workspace uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE unresolved bigint;accepted bigint;
BEGIN
 SELECT count(*) FILTER(WHERE version.status NOT IN('accepted','rejected')),count(*) FILTER(WHERE version.status='accepted')
 INTO unresolved,accepted
 FROM public.enterprise_delivery_work_item_aggregates aggregate
 JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id AND version.item_aggregate_id=aggregate.id
 WHERE aggregate.work_package_id=p_package AND aggregate.org_id=p_org AND aggregate.workspace_id=p_workspace;
 IF unresolved<>0 OR accepted=0 THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_COMMAND_BLOCKED'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.enterprise_delivery_package_blocker_events event
  WHERE event.work_package_id=p_package AND event.org_id=p_org AND event.workspace_id=p_workspace
    AND event.sequence=(SELECT max(latest.sequence) FROM public.enterprise_delivery_package_blocker_events latest WHERE latest.work_package_id=event.work_package_id AND latest.blocker_key=event.blocker_key)
    AND event.action='opened'
 ) THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_COMMAND_BLOCKED'; END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_item_json_safe(p_item jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(p_item)='object'
  AND p_item->>'itemType' IN('Epic','Story','Task','Milestone','Dependency','Risk')
  AND length(btrim(COALESCE(p_item->>'title',''))) BETWEEN 1 AND 240
  AND length(COALESCE(p_item->>'description',''))<=12000
  AND jsonb_typeof(COALESCE(p_item->'acceptanceCriteria','[]'::jsonb))='array'
  AND jsonb_typeof(COALESCE(p_item->'nonFunctionalRequirements','[]'::jsonb))='array'
  AND jsonb_array_length(COALESCE(p_item->'acceptanceCriteria','[]'::jsonb))<=100
  AND jsonb_array_length(COALESCE(p_item->'nonFunctionalRequirements','[]'::jsonb))<=100
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_item->'acceptanceCriteria','[]'::jsonb)) entry
    WHERE jsonb_typeof(entry)<>'string' OR length(btrim(entry#>>'{}')) NOT BETWEEN 1 AND 2000)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(p_item->'nonFunctionalRequirements','[]'::jsonb)) entry
    WHERE jsonb_typeof(entry)<>'string' OR length(btrim(entry#>>'{}')) NOT BETWEEN 1 AND 2000)
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_text_array_safe(p_value jsonb,p_max_items integer,p_max_length integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(p_value)='array' AND jsonb_array_length(p_value)<=p_max_items
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_value) entry
   WHERE jsonb_typeof(entry)<>'string' OR length(btrim(entry#>>'{}')) NOT BETWEEN 1 AND p_max_length)
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_append_initial_items(
 p_package uuid,p_package_version uuid,p_org uuid,p_workspace uuid,p_actor uuid,p_items jsonb,p_source public.enterprise_delivery_source_packages
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE item jsonb;aggregate_id uuid;version_id uuid;parent_id uuid;ordinal integer:=0;result jsonb:='[]'::jsonb;hash text;
BEGIN
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>250 THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(p_items))<>(SELECT count(DISTINCT value->>'clientKey') FROM jsonb_array_elements(p_items))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) WHERE length(btrim(COALESCE(value->>'clientKey',''))) NOT BETWEEN 1 AND 120) THEN
  RAISE EXCEPTION 'INVALID_COMMAND';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY value->>'clientKey' LOOP
  IF NOT public.enterprise_pr_c_item_json_safe(item) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  ordinal:=ordinal+1;aggregate_id:=gen_random_uuid();version_id:=gen_random_uuid();parent_id:=NULL;
  IF NULLIF(item->>'parentClientKey','') IS NOT NULL THEN
   SELECT (entry->>'aggregateId')::uuid INTO parent_id FROM jsonb_array_elements(result) entry WHERE entry->>'clientKey'=item->>'parentClientKey';
   IF parent_id IS NULL THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  END IF;
  hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-item-2','itemType',item->>'itemType','title',item->>'title',
   'description',COALESCE(item->>'description',''),'acceptanceCriteria',COALESCE(item->'acceptanceCriteria','[]'::jsonb),
   'nonFunctionalRequirements',COALESCE(item->'nonFunctionalRequirements','[]'::jsonb),'deliverySourcePackageId',p_source.id,'deliverySourcePackageHash',p_source.package_hash,
   'studioSourcePackageId',p_source.studio_source_package_id,'studioSourcePackageHash',p_source.studio_source_package_hash,
   'sourceArtifactId',p_source.studio_artifact_id,'sourceArtifactType',p_source.studio_artifact_type,
   'sourceArtifactVersionId',p_source.studio_artifact_version_id,'sourceArtifactVersion',p_source.studio_artifact_version,
   'sourceArtifactHash',p_source.studio_artifact_hash,'sourceSectionLocator',CASE WHEN p_source.source_mode='studio_handoff' THEN item->>'sourceSectionLocator' END));
  IF p_source.source_mode='studio_handoff' AND length(btrim(COALESCE(item->>'sourceSectionLocator',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  INSERT INTO public.enterprise_delivery_work_item_aggregates(id,work_package_id,org_id,workspace_id,parent_aggregate_id,current_version_id,current_version,created_by)
   VALUES(aggregate_id,p_package,p_org,p_workspace,parent_id,version_id,1,p_actor);
  INSERT INTO public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,package_version_id,org_id,workspace_id,version,item_type,title,description,
   acceptance_criteria,non_functional_requirements,delivery_source_package_id,delivery_source_package_hash,studio_source_package_id,studio_source_package_hash,
   source_artifact_workspace_id,source_artifact_id,source_artifact_type,source_artifact_version_id,source_artifact_version,source_artifact_hash,source_section_locator,status,content_hash,created_by)
  VALUES(version_id,aggregate_id,p_package,p_package_version,p_org,p_workspace,1,item->>'itemType',item->>'title',COALESCE(item->>'description',''),
   COALESCE(item->'acceptanceCriteria','[]'::jsonb),COALESCE(item->'nonFunctionalRequirements','[]'::jsonb),p_source.id,p_source.package_hash,
   p_source.studio_source_package_id,p_source.studio_source_package_hash,p_source.studio_workspace_id,p_source.studio_artifact_id,p_source.studio_artifact_type,p_source.studio_artifact_version_id,
   p_source.studio_artifact_version,p_source.studio_artifact_hash,CASE WHEN p_source.source_mode='studio_handoff' THEN item->>'sourceSectionLocator' END,'proposed',hash,p_actor);
  result:=result||jsonb_build_array(jsonb_build_object('clientKey',item->>'clientKey','aggregateId',aggregate_id,'versionId',version_id,'version',1,'hash',hash));
 END LOOP;
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_delivery_monitor_command(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE action text;actor uuid;org uuid;workspace uuid;authorization_version bigint;receipt_id uuid;request_id uuid;idempotency_key text;execution_token uuid;execution_fence bigint;
 capability text;request_hash text;binding_hash text;receipt public.enterprise_delivery_monitor_command_receipts;flags public.enterprise_transcript_workspace_flags;
 artifact public.studio_artifact_aggregates;studio_version public.studio_artifact_versions;studio_source public.studio_artifact_source_packages;
 handoff public.enterprise_delivery_handoffs;source public.enterprise_delivery_source_packages;package public.enterprise_delivery_work_packages;package_version public.enterprise_delivery_work_package_versions;
 item_aggregate public.enterprise_delivery_work_item_aggregates;item_version public.enterprise_delivery_work_item_versions;review public.enterprise_delivery_package_review_events;
 handoff_review public.enterprise_delivery_handoff_review_events;handoff_approval public.enterprise_delivery_handoff_approval_events;approval public.enterprise_delivery_package_approval_events;
 package_id uuid;package_version_id uuid;source_id uuid;resource_id uuid;target_workspace uuid;new_version bigint;new_version_id uuid;effect_id uuid;audit_id uuid;result jsonb;items jsonb;manifest jsonb;manifest_hash text;revision jsonb;item_payload jsonb;carried_status text;carried_rationale text;selector_count integer;
 outcome text;rationale text;content_hash text;template_version_id uuid;existing_baseline public.enterprise_monitor_baselines;
 milestones jsonb;dependencies jsonb;risks jsonb;baseline_readiness text;
 target_flags public.enterprise_transcript_workspace_flags;target_record public.workspaces;
BEGIN
 IF jsonb_typeof(p_command)<>'object' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 action:=p_command->>'action';actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
 authorization_version:=(p_command->>'authorizationVersion')::bigint;receipt_id:=(p_command->>'receiptId')::uuid;request_id:=(p_command->>'requestId')::uuid;
 idempotency_key:=p_command->>'idempotencyKey';execution_token:=(p_command->>'executionToken')::uuid;execution_fence:=(p_command->>'executionFence')::bigint;
 IF action NOT IN('delivery.handoff.request','delivery.handoff.review.resolve','delivery.handoff.approval.resolve','delivery.handoff.withdraw','delivery.handoff.consume',
   'delivery.package.create.manual','delivery.item.review','delivery.package.revision.commit','delivery.package.review.resolve','delivery.package.approval.resolve','monitor.baseline.create')
   OR length(btrim(idempotency_key)) NOT BETWEEN 8 AND 128 OR execution_fence<=0 OR p_command ? 'routePolicyVersion' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 capability:=CASE action WHEN 'delivery.handoff.request' THEN 'delivery.handoff.request' WHEN 'delivery.handoff.review.resolve' THEN 'delivery.handoff.review'
  WHEN 'delivery.handoff.approval.resolve' THEN 'delivery.handoff.approve' WHEN 'delivery.handoff.withdraw' THEN 'delivery.handoff.request'
  WHEN 'delivery.handoff.consume' THEN 'delivery.handoff.consume' WHEN 'delivery.package.create.manual' THEN 'delivery.package.manage'
  WHEN 'delivery.item.review' THEN 'delivery.package.manage' WHEN 'delivery.package.revision.commit' THEN 'delivery.package.manage'
  WHEN 'delivery.package.review.resolve' THEN 'delivery.package.review' WHEN 'delivery.package.approval.resolve' THEN 'delivery.package.approve'
  ELSE 'monitor.baseline.create' END;
 BEGIN
  PERFORM public.pr1b_assert_command_authority(actor,org,workspace,capability,authorization_version);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='PR1B_AUTHORIZATION_STALE' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  IF SQLERRM='PR1B_NOT_FOUND' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_PERMISSION_DENIED'; END IF;
  RAISE;
 END;
 IF action='delivery.handoff.consume' AND p_command ? 'items' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
 IF action='delivery.handoff.request' THEN
  IF p_command ? 'expiresAt' OR p_command ? 'proposedItems' THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  target_workspace:=(p_command->>'targetWorkspaceId')::uuid;
  BEGIN
   PERFORM public.pr1b_assert_command_authority(actor,org,target_workspace,'delivery.handoff.request',authorization_version);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM='PR1B_AUTHORIZATION_STALE' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
   IF SQLERRM='PR1B_NOT_FOUND' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
   RAISE;
  END;
 END IF;
 -- Receipt identity is the canonical business request. Transport correlation and
 -- the current authorization fence are immutable attempt evidence, not command identity.
 binding_hash:=public.enterprise_sha256_jsonb(p_command-ARRAY['receiptId','requestId','authorizationVersion','executionToken','executionFence']::text[]);
 request_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('action',action,'bindingHash',binding_hash));
 -- Serialize an actor-scoped idempotency key before observing or creating its
 -- receipt. A concurrent loser waits, then reselects the committed canonical
 -- response instead of surfacing a unique-constraint transport failure.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  pg_catalog.concat_ws(':',org::text,workspace::text,actor::text,action,idempotency_key),0));
 SELECT stored.* INTO receipt FROM public.enterprise_delivery_monitor_command_receipts stored
  WHERE stored.org_id=org AND stored.workspace_id=workspace AND stored.actor_id=actor AND stored.action=action AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.request_hash<>request_hash OR receipt.binding_hash<>binding_hash THEN
   RAISE EXCEPTION 'ENTERPRISE_DELIVERY_IDEMPOTENCY_CONFLICT';
  END IF;
  INSERT INTO public.enterprise_delivery_monitor_command_attempts(receipt_id,org_id,workspace_id,actor_id,action,request_id,authorization_version,execution_token,execution_fence,binding_hash)
  VALUES(receipt.id,org,workspace,actor,action,request_id,authorization_version,execution_token,execution_fence,binding_hash)
  ON CONFLICT ON CONSTRAINT enterprise_pr_c_command_attempt_business_key DO NOTHING;
  IF receipt.status='committed' THEN RETURN receipt.response; END IF;
  RAISE EXCEPTION 'ENTERPRISE_DELIVERY_COMMAND_IN_PROGRESS';
 END IF;

 -- Mutable runtime and feature controls govern only a new durable effect. An
 -- authorized exact retry must remain able to recover its committed response
 -- after those controls change, or a lost response can lead to a duplicate
 -- business action under a fresh key.
 BEGIN
  PERFORM public.enterprise_assert_writable('delivery');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='ENTERPRISE_INTELLIGENCE_READ_ONLY' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_READ_ONLY'; END IF;
  RAISE EXCEPTION 'ENTERPRISE_DELIVERY_FEATURE_DISABLED';
 END;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF flags.org_id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_FEATURE_DISABLED'; END IF;
 IF action LIKE 'delivery.handoff.%' AND NOT flags.module_handoffs_enabled THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_FEATURE_DISABLED'; END IF;
 IF action='delivery.package.create.manual' AND NOT flags.direct_delivery_planning_enabled THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_FEATURE_DISABLED'; END IF;
 IF action IN('delivery.item.review','delivery.package.revision.commit','delivery.package.review.resolve','delivery.package.approval.resolve') AND NOT flags.delivery_item_review_enabled THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_FEATURE_DISABLED'; END IF;
 IF action='monitor.baseline.create' AND NOT flags.monitor_approved_baseline_enabled THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_FEATURE_DISABLED'; END IF;
 IF action='delivery.handoff.request' THEN
  SELECT * INTO target_record FROM public.workspaces WHERE id=target_workspace AND org_id=org FOR SHARE;
  SELECT * INTO target_flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=target_workspace FOR SHARE;
  IF target_record.id IS NULL OR target_record.status<>'active' OR target_record.deleted_at IS NOT NULL
    OR target_flags.org_id IS NULL OR NOT target_flags.module_handoffs_enabled THEN
   RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE';
  END IF;
 END IF;
 INSERT INTO public.enterprise_delivery_monitor_command_receipts(id,org_id,workspace_id,actor_id,action,idempotency_key,request_id,request_hash,binding_hash,authorization_version,execution_token,execution_fence,status)
 VALUES(receipt_id,org,workspace,actor,action,idempotency_key,request_id,request_hash,binding_hash,authorization_version,execution_token,execution_fence,'claimed') RETURNING * INTO receipt;
 INSERT INTO public.enterprise_delivery_monitor_command_attempts(receipt_id,org_id,workspace_id,actor_id,action,request_id,authorization_version,execution_token,execution_fence,binding_hash)
 VALUES(receipt.id,org,workspace,actor,action,request_id,authorization_version,execution_token,execution_fence,binding_hash);

 IF action='delivery.handoff.request' THEN
  SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=(p_command->>'studioArtifactId')::uuid AND org_id=org AND workspace_id=workspace FOR UPDATE;
  SELECT * INTO studio_version FROM public.studio_artifact_versions WHERE id=(p_command->>'studioArtifactVersionId')::uuid AND artifact_id=artifact.id AND org_id=org AND workspace_id=workspace FOR SHARE;
  SELECT * INTO studio_source FROM public.studio_artifact_source_packages WHERE id=studio_version.source_package_id AND artifact_id=artifact.id FOR SHARE;
  IF artifact.id IS NULL OR studio_version.id IS NULL OR studio_source.id IS NULL OR artifact.lifecycle<>'approved' OR studio_version.lifecycle<>'approved'
    OR artifact.current_approved_version_id<>studio_version.id OR artifact.aggregate_version<>(p_command->>'expectedAggregateVersion')::bigint
    OR artifact.current_version_id IS DISTINCT FROM (p_command->>'expectedCurrentVersionId')::uuid
    OR artifact.current_approved_version_id IS DISTINCT FROM (p_command->>'expectedApprovedVersionId')::uuid
    OR NOT public.studio_pr_b_source_package_is_current(studio_source.id,org,workspace) THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'clientKey','studio-section-'||COALESCE(NULLIF(section.value->>'id',''),section.ordinality::text),
    'itemType',CASE artifact.artifact_type WHEN 'brd' THEN 'Epic' WHEN 'frd' THEN 'Story' ELSE 'Task' END,
    'title',left(COALESCE(NULLIF(section.value->>'title',''),section.value->>'heading'),240),'description',left(COALESCE(section.value->>'body',''),12000),
    'acceptanceCriteria','[]'::jsonb,'nonFunctionalRequirements','[]'::jsonb,
    'sourceSectionLocator',artifact.artifact_type||'.sections.'||COALESCE(NULLIF(section.value->>'id',''),section.ordinality::text)) ORDER BY section.ordinality),'[]'::jsonb)
  INTO items FROM jsonb_array_elements(COALESCE(studio_version.content->'sections','[]'::jsonb)) WITH ORDINALITY section(value,ordinality);
  IF jsonb_typeof(items)<>'array' OR jsonb_array_length(items)=0 OR jsonb_array_length(items)>250
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) WHERE NOT public.enterprise_pr_c_item_json_safe(value))
    OR (SELECT count(*) FROM jsonb_array_elements(items))<>(SELECT count(DISTINCT value->>'clientKey') FROM jsonb_array_elements(items)) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  SELECT stored.* INTO handoff FROM public.enterprise_delivery_handoffs stored WHERE stored.org_id=org AND stored.workspace_id=workspace
   AND stored.target_workspace_id=target_workspace AND stored.studio_artifact_version_id=studio_version.id
   AND stored.status IN('requested','target_review','approval_ready','approved') ORDER BY stored.requested_at DESC,stored.id LIMIT 1 FOR UPDATE;
  IF handoff.id IS NOT NULL THEN
   IF handoff.expires_at>statement_timestamp() THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
   UPDATE public.enterprise_delivery_handoffs SET status='stale',current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id;
   INSERT INTO public.enterprise_delivery_handoff_versions(id,handoff_id,org_id,workspace_id,version,status,actor_id,actor_authorization_version,rationale)
    VALUES(gen_random_uuid(),handoff.id,org,workspace,handoff.current_version+1,'stale',actor,authorization_version,'Server route policy expired before replacement request.');
  END IF;
  resource_id:=gen_random_uuid();template_version_id:=COALESCE(studio_version.template_id,studio_version.tenant_template_version_id);
  INSERT INTO public.enterprise_delivery_handoffs(id,org_id,workspace_id,target_workspace_id,studio_artifact_id,studio_artifact_type,studio_artifact_version_id,studio_artifact_version,studio_artifact_hash,
   studio_source_package_id,studio_source_package_hash,template_kind,system_template_version_id,tenant_template_version_id,template_version,template_hash,
   lineage_classification,planning_only,route_policy_version,route_policy_hash,target_package_hash,status,requested_by,expires_at)
  VALUES(resource_id,org,workspace,target_workspace,artifact.id,artifact.artifact_type,studio_version.id,studio_version.version,studio_version.content_hash,studio_source.id,studio_source.package_hash,studio_version.template_kind,
   CASE WHEN studio_version.template_kind='system' THEN template_version_id END,studio_version.tenant_template_version_id,studio_version.template_version,studio_version.template_hash,
   studio_source.lineage_classification,studio_source.planning_only,1,
   public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-route-policy-1','version',1,'sourceWorkspaceId',workspace,'targetWorkspaceId',target_workspace,'approvalRequired',true,'ttlHours',24)),
   public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-handoff-target-1','sourceWorkspaceId',workspace,'targetWorkspaceId',target_workspace,'studioArtifactVersionId',studio_version.id,'items',items)),
   'requested',actor,statement_timestamp()+interval '24 hours');
  INSERT INTO public.enterprise_delivery_handoff_target_items(handoff_id,org_id,source_workspace_id,target_workspace_id,ordinal,client_key,item,item_hash)
  SELECT resource_id,org,workspace,target_workspace,ordinality::integer,value->>'clientKey',value,public.enterprise_sha256_jsonb(value)
  FROM jsonb_array_elements(items) WITH ORDINALITY proposed(value,ordinality);
  INSERT INTO public.enterprise_delivery_handoff_versions(id,handoff_id,org_id,workspace_id,version,status,actor_id,actor_authorization_version)
   VALUES(gen_random_uuid(),resource_id,org,workspace,1,'requested',actor,authorization_version);
  result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',resource_id,'resourceVersion',1,
   'sourceWorkspaceId',workspace,'targetWorkspaceId',target_workspace,'studioArtifactId',artifact.id,'studioArtifactType',artifact.artifact_type,'studioArtifactVersionId',studio_version.id,
   'studioArtifactHash',studio_version.content_hash,'lineageClassification',studio_source.lineage_classification,'planningOnly',studio_source.planning_only,
   'routePolicyVersion',1,'routePolicyHash',(SELECT route_policy_hash FROM public.enterprise_delivery_handoffs WHERE id=resource_id),
   'expiresAt',(SELECT expires_at FROM public.enterprise_delivery_handoffs WHERE id=resource_id),
   'targetPackageHash',(SELECT target_package_hash FROM public.enterprise_delivery_handoffs WHERE id=resource_id),'proposedItemCount',jsonb_array_length(items));

 ELSIF action IN('delivery.handoff.review.resolve','delivery.handoff.approval.resolve','delivery.handoff.withdraw') THEN
  IF action='delivery.handoff.withdraw' THEN
   SELECT * INTO handoff FROM public.enterprise_delivery_handoffs WHERE id=(p_command->>'handoffId')::uuid AND org_id=org AND workspace_id=workspace FOR UPDATE;
  ELSE
   SELECT * INTO handoff FROM public.enterprise_delivery_handoffs WHERE id=(p_command->>'handoffId')::uuid AND org_id=org AND target_workspace_id=workspace FOR UPDATE;
  END IF;
  IF handoff.id IS NULL OR handoff.current_version<>(p_command->>'expectedHandoffVersion')::bigint OR handoff.status IN('rejected','withdrawn','stale','consumed')
    OR handoff.expires_at<=statement_timestamp() THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  IF action<>'delivery.handoff.withdraw' AND NOT public.enterprise_pr_c_handoff_source_current(handoff.id,org) THEN
   RAISE EXCEPTION 'ENTERPRISE_DELIVERY_HANDOFF_STALE';
  END IF;
  IF action='delivery.handoff.withdraw' THEN
   IF actor<>handoff.requested_by THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;outcome:='withdrawn';
  ELSIF action='delivery.handoff.review.resolve' THEN
   outcome:=p_command->>'outcome';rationale:=p_command->>'rationale';
   IF handoff.status NOT IN('requested','target_review') OR outcome NOT IN('approved','changes_requested','rejected') OR length(btrim(rationale)) NOT BETWEEN 1 AND 4000 OR actor=handoff.requested_by THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
   INSERT INTO public.enterprise_delivery_handoff_review_events(id,handoff_id,org_id,workspace_id,handoff_version,reviewer_id,reviewer_authorization_version,outcome,rationale)
    VALUES(gen_random_uuid(),handoff.id,org,handoff.workspace_id,handoff.current_version,actor,authorization_version,outcome,rationale) RETURNING * INTO handoff_review;
   outcome:=CASE outcome WHEN 'approved' THEN 'approval_ready' ELSE outcome END;
  ELSE
   outcome:=p_command->>'outcome';rationale:=p_command->>'rationale';
   SELECT * INTO handoff_review FROM public.enterprise_delivery_handoff_review_events WHERE handoff_id=handoff.id;
   IF handoff.status<>'approval_ready' OR handoff_review.outcome<>'approved' OR outcome NOT IN('approved','rejected') OR length(btrim(rationale)) NOT BETWEEN 1 AND 4000
      OR actor IN(handoff.requested_by,handoff_review.reviewer_id) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
   INSERT INTO public.enterprise_delivery_handoff_approval_events(id,handoff_id,review_event_id,org_id,workspace_id,handoff_version,requested_by,reviewed_by,approved_by,approver_authorization_version,outcome,rationale)
    VALUES(gen_random_uuid(),handoff.id,handoff_review.id,org,handoff.workspace_id,handoff.current_version,handoff.requested_by,handoff_review.reviewer_id,actor,authorization_version,outcome,rationale);
  END IF;
  new_version:=handoff.current_version+1;
  UPDATE public.enterprise_delivery_handoffs SET status=outcome,current_version=new_version,updated_at=statement_timestamp() WHERE id=handoff.id;
  INSERT INTO public.enterprise_delivery_handoff_versions(id,handoff_id,org_id,workspace_id,version,status,actor_id,actor_authorization_version,rationale)
   VALUES(gen_random_uuid(),handoff.id,org,handoff.workspace_id,new_version,outcome,actor,authorization_version,rationale);
  resource_id:=handoff.id;result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',resource_id,'resourceVersion',new_version,'status',outcome);

 ELSIF action IN('delivery.handoff.consume','delivery.package.create.manual') THEN
  package_id:=gen_random_uuid();package_version_id:=gen_random_uuid();source_id:=gen_random_uuid();items:=COALESCE(p_command->'items','[]'::jsonb);
  IF action='delivery.handoff.consume' THEN
   SELECT * INTO handoff FROM public.enterprise_delivery_handoffs WHERE id=(p_command->>'handoffId')::uuid AND org_id=org AND target_workspace_id=workspace;
   IF handoff.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
   SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=handoff.studio_artifact_id AND org_id=org AND workspace_id=handoff.workspace_id FOR UPDATE;
   SELECT * INTO studio_version FROM public.studio_artifact_versions WHERE id=handoff.studio_artifact_version_id AND artifact_id=artifact.id FOR SHARE;
   SELECT * INTO studio_source FROM public.studio_artifact_source_packages WHERE id=handoff.studio_source_package_id AND artifact_id=artifact.id FOR SHARE;
   SELECT * INTO handoff FROM public.enterprise_delivery_handoffs WHERE id=(p_command->>'handoffId')::uuid AND org_id=org AND target_workspace_id=workspace FOR UPDATE;
   IF handoff.id IS NULL OR handoff.studio_artifact_id<>artifact.id OR handoff.studio_artifact_version_id<>studio_version.id OR handoff.studio_source_package_id<>studio_source.id
      OR handoff.status<>'approved' OR handoff.current_version<>(p_command->>'expectedHandoffVersion')::bigint OR handoff.expires_at<=statement_timestamp()
   THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
   SELECT COALESCE(jsonb_agg(target.item ORDER BY target.ordinal),'[]'::jsonb) INTO items
   FROM public.enterprise_delivery_handoff_target_items target WHERE target.handoff_id=handoff.id AND target.org_id=org
    AND target.source_workspace_id=handoff.workspace_id AND target.target_workspace_id=workspace;
   SELECT * INTO handoff_review FROM public.enterprise_delivery_handoff_review_events WHERE handoff_id=handoff.id FOR SHARE;
   SELECT * INTO handoff_approval FROM public.enterprise_delivery_handoff_approval_events WHERE handoff_id=handoff.id FOR SHARE;
   IF handoff_review.id IS NULL OR handoff_approval.id IS NULL OR actor IN(handoff.requested_by,handoff_review.reviewer_id,handoff_approval.approved_by) THEN
    RAISE EXCEPTION 'ENTERPRISE_DELIVERY_PERMISSION_DENIED';
   END IF;
   IF artifact.lifecycle<>'approved' OR artifact.current_approved_version_id<>studio_version.id OR studio_version.lifecycle<>'approved'
     OR studio_version.content_hash<>handoff.studio_artifact_hash OR studio_source.package_hash<>handoff.studio_source_package_hash
     OR NOT public.studio_pr_b_source_package_is_current(studio_source.id,org,handoff.workspace_id) THEN
    RAISE EXCEPTION 'ENTERPRISE_DELIVERY_HANDOFF_STALE';
   END IF;
   IF handoff.target_package_hash<>public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-handoff-target-1','sourceWorkspaceId',handoff.workspace_id,
      'targetWorkspaceId',workspace,'studioArtifactVersionId',studio_version.id,'items',items)) THEN
    RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE';
   END IF;
   content_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-package-content-2','sourceMode','studio_handoff','items',items));
   INSERT INTO public.enterprise_delivery_work_packages(id,org_id,workspace_id,handoff_id,delivery_handoff_id,source_package_id,source_package_hash,current_version,current_version_id,aggregate_version,status,created_by)
    VALUES(package_id,org,workspace,NULL,handoff.id,source_id,
     public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-source-package-2','workPackageId',package_id,'deliveryHandoffId',handoff.id,
      'studioArtifactType',artifact.artifact_type,'studioArtifactVersionId',studio_version.id,'studioArtifactHash',studio_version.content_hash,'studioSourcePackageId',studio_source.id,
      'studioSourcePackageHash',studio_source.package_hash,'templateKind',studio_version.template_kind,'templateVersion',studio_version.template_version,
      'templateHash',studio_version.template_hash,'sourceWorkspaceId',handoff.workspace_id,'targetWorkspaceId',workspace,
      'lineageClassification',studio_source.lineage_classification,'planningOnly',studio_source.planning_only)),
     1,package_version_id,1,'draft',actor);
   INSERT INTO public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id,version,source_mode,delivery_handoff_id,studio_workspace_id,studio_artifact_id,studio_artifact_type,
    studio_artifact_version_id,studio_artifact_version,studio_artifact_hash,studio_source_package_id,studio_source_package_hash,template_kind,system_template_version_id,
    tenant_template_version_id,template_version,template_hash,lineage_classification,planning_only,route_policy_version,route_policy_hash,package_hash,created_by)
   SELECT source_id,package_id,org,workspace,1,'studio_handoff',handoff.id,handoff.workspace_id,artifact.id,artifact.artifact_type,studio_version.id,studio_version.version,studio_version.content_hash,
    studio_source.id,studio_source.package_hash,studio_version.template_kind,CASE WHEN studio_version.template_kind='system' THEN studio_version.template_id END,
    studio_version.tenant_template_version_id,studio_version.template_version,studio_version.template_hash,studio_source.lineage_classification,studio_source.planning_only,
    handoff.route_policy_version,handoff.route_policy_hash,created.source_package_hash,actor FROM public.enterprise_delivery_work_packages created WHERE created.id=package_id;
   SELECT * INTO source FROM public.enterprise_delivery_source_packages WHERE id=source_id;
   INSERT INTO public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id,version,studio_workspace_id,studio_document_id,artifact_type,studio_version_id,studio_version,
    studio_content_hash,content,content_hash,status,created_by,source_package_id,source_package_hash,lineage_classification,planning_only)
   VALUES(package_version_id,package_id,org,workspace,1,handoff.workspace_id,artifact.id,artifact.artifact_type,studio_version.id,studio_version.version,studio_version.content_hash,
    jsonb_build_object('contractVersion','delivery-package-content-2','sourceMode','studio_handoff'),content_hash,'draft',actor,source.id,source.package_hash,source.lineage_classification,source.planning_only);
   items:=public.enterprise_pr_c_append_initial_items(package_id,package_version_id,org,workspace,actor,items,source);
   INSERT INTO public.enterprise_delivery_handoff_consumptions(handoff_id,org_id,workspace_id,work_package_id,source_package_id,consumed_by,consumer_authorization_version)
    VALUES(handoff.id,org,workspace,package_id,source.id,actor,authorization_version);
   UPDATE public.enterprise_delivery_handoffs SET status='consumed',current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id;
   INSERT INTO public.enterprise_delivery_handoff_versions(id,handoff_id,org_id,workspace_id,version,status,actor_id,actor_authorization_version)
    VALUES(gen_random_uuid(),handoff.id,org,handoff.workspace_id,handoff.current_version+1,'consumed',actor,authorization_version);
  ELSE
   IF length(btrim(COALESCE(p_command->>'manualBrief',''))) NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
   content_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-package-content-2','sourceMode','manual','items',items));
   binding_hash:=encode(public.digest(convert_to(p_command->>'manualBrief','UTF8'),'sha256'),'hex');
   request_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-source-package-2','workPackageId',package_id,'sourceMode','manual',
    'manualBriefHash',binding_hash,'lineageClassification','not_assessed','planningOnly',true));
   INSERT INTO public.enterprise_delivery_work_packages(id,org_id,workspace_id,handoff_id,delivery_handoff_id,source_package_id,source_package_hash,current_version,current_version_id,aggregate_version,status,created_by)
    VALUES(package_id,org,workspace,NULL,NULL,source_id,request_hash,1,package_version_id,1,'draft',actor);
   INSERT INTO public.enterprise_delivery_source_packages(id,work_package_id,org_id,workspace_id,version,source_mode,manual_brief_hash,lineage_classification,planning_only,
    route_policy_version,route_policy_hash,package_hash,created_by)
   VALUES(source_id,package_id,org,workspace,1,'manual',binding_hash,'not_assessed',true,1,
    public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-route-policy-1','version',1,'targetWorkspaceId',workspace,'directDelivery',true)),request_hash,actor);
   INSERT INTO public.enterprise_delivery_manual_materials(source_package_id,work_package_id,org_id,workspace_id,manual_brief,manual_brief_hash,created_by)
    VALUES(source_id,package_id,org,workspace,p_command->>'manualBrief',binding_hash,actor);
   SELECT * INTO source FROM public.enterprise_delivery_source_packages WHERE id=source_id;
   INSERT INTO public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id,version,studio_workspace_id,studio_document_id,artifact_type,studio_version_id,studio_version,
    studio_content_hash,content,content_hash,status,created_by,source_package_id,source_package_hash,lineage_classification,planning_only)
   VALUES(package_version_id,package_id,org,workspace,1,NULL,NULL,NULL,NULL,NULL,NULL,jsonb_build_object('contractVersion','delivery-package-content-2','sourceMode','manual'),
    content_hash,'draft',actor,source.id,source.package_hash,'not_assessed',true);
   items:=public.enterprise_pr_c_append_initial_items(package_id,package_version_id,org,workspace,actor,items,source);
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  resource_id:=package_id;result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',package_id,'resourceVersion',1,
   'packageVersionId',package_version_id,'packageHash',content_hash,'sourcePackageId',source.id,'sourcePackageHash',source.package_hash,
   'lineageClassification',source.lineage_classification,'planningOnly',source.planning_only,'items',items);

 ELSIF action='delivery.item.review' THEN
  SELECT aggregate.work_package_id INTO package_id FROM public.enterprise_delivery_work_item_aggregates aggregate
   WHERE aggregate.id=(p_command->>'itemAggregateId')::uuid AND aggregate.org_id=org AND aggregate.workspace_id=workspace;
  IF package_id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  SELECT * INTO package FROM public.enterprise_delivery_work_packages stored_package WHERE stored_package.id=package_id AND stored_package.org_id=org AND stored_package.workspace_id=workspace FOR UPDATE;
  SELECT * INTO item_aggregate FROM public.enterprise_delivery_work_item_aggregates aggregate
   WHERE aggregate.id=(p_command->>'itemAggregateId')::uuid AND aggregate.work_package_id=package.id AND aggregate.org_id=org AND aggregate.workspace_id=workspace FOR UPDATE;
  SELECT * INTO item_version FROM public.enterprise_delivery_work_item_versions version WHERE version.id=item_aggregate.current_version_id AND version.item_aggregate_id=item_aggregate.id FOR SHARE;
  IF package.id IS NULL OR item_version.id IS NULL OR package.status<>'draft' OR item_aggregate.aggregate_version<>(p_command->>'expectedAggregateVersion')::bigint
    OR item_aggregate.current_version_id IS DISTINCT FROM (p_command->>'expectedItemVersionId')::uuid OR NOT public.enterprise_pr_c_delivery_source_current(package.source_package_id,org,workspace,true) THEN
   RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  outcome:=p_command->>'outcome';rationale:=p_command->>'rationale';
  IF outcome NOT IN('edited','accepted','rejected')
    OR (outcome IN('accepted','rejected') AND p_command ? 'item')
    OR (outcome='edited' AND (NOT p_command ? 'item' OR NOT public.enterprise_pr_c_item_json_safe(p_command->'item') OR length(btrim(COALESCE(rationale,''))) NOT BETWEEN 1 AND 4000))
    OR (outcome='rejected' AND length(btrim(COALESCE(rationale,''))) NOT BETWEEN 1 AND 4000) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  IF outcome='accepted' THEN rationale:=COALESCE(NULLIF(rationale,''),'Accepted for canonical package.'); END IF;
  new_version:=item_aggregate.current_version+1;new_version_id:=gen_random_uuid();
  content_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-item-2','itemType',COALESCE(p_command#>>'{item,itemType}',item_version.item_type),
   'title',COALESCE(p_command#>>'{item,title}',item_version.title),'description',COALESCE(p_command#>>'{item,description}',item_version.description),
   'acceptanceCriteria',COALESCE(p_command#>'{item,acceptanceCriteria}',item_version.acceptance_criteria),
   'nonFunctionalRequirements',COALESCE(p_command#>'{item,nonFunctionalRequirements}',item_version.non_functional_requirements),
   'deliverySourcePackageId',item_version.delivery_source_package_id,'deliverySourcePackageHash',item_version.delivery_source_package_hash,
   'studioSourcePackageId',item_version.studio_source_package_id,'studioSourcePackageHash',item_version.studio_source_package_hash,
   'sourceArtifactWorkspaceId',item_version.source_artifact_workspace_id,'sourceArtifactId',item_version.source_artifact_id,'sourceArtifactType',item_version.source_artifact_type,'sourceArtifactVersionId',item_version.source_artifact_version_id,'sourceArtifactVersion',item_version.source_artifact_version,
   'sourceArtifactHash',item_version.source_artifact_hash,'sourceSectionLocator',item_version.source_section_locator));
  INSERT INTO public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,package_version_id,org_id,workspace_id,version,parent_version_id,item_type,title,description,
   acceptance_criteria,non_functional_requirements,delivery_source_package_id,delivery_source_package_hash,studio_source_package_id,studio_source_package_hash,
   source_artifact_workspace_id,source_artifact_id,source_artifact_type,source_artifact_version_id,source_artifact_version,source_artifact_hash,source_section_locator,status,rationale,content_hash,created_by)
  VALUES(new_version_id,item_aggregate.id,package.id,package.current_version_id,org,workspace,new_version,item_version.id,
   COALESCE(p_command#>>'{item,itemType}',item_version.item_type),COALESCE(p_command#>>'{item,title}',item_version.title),COALESCE(p_command#>>'{item,description}',item_version.description),
   COALESCE(p_command#>'{item,acceptanceCriteria}',item_version.acceptance_criteria),COALESCE(p_command#>'{item,nonFunctionalRequirements}',item_version.non_functional_requirements),
   item_version.delivery_source_package_id,item_version.delivery_source_package_hash,item_version.studio_source_package_id,item_version.studio_source_package_hash,
   item_version.source_artifact_workspace_id,item_version.source_artifact_id,item_version.source_artifact_type,item_version.source_artifact_version_id,item_version.source_artifact_version,item_version.source_artifact_hash,item_version.source_section_locator,
   outcome,rationale,content_hash,actor);
  UPDATE public.enterprise_delivery_work_item_aggregates SET current_version_id=new_version_id,current_version=new_version,aggregate_version=aggregate_version+1,updated_at=statement_timestamp() WHERE id=item_aggregate.id;
  UPDATE public.enterprise_delivery_work_packages SET aggregate_version=aggregate_version+1,updated_at=statement_timestamp() WHERE id=package.id;
  IF outcome IN('accepted','rejected') THEN INSERT INTO public.enterprise_delivery_work_item_decisions(id,item_aggregate_id,item_version_id,work_package_id,org_id,workspace_id,decision,rationale,decided_by,decider_authorization_version)
   VALUES(gen_random_uuid(),item_aggregate.id,new_version_id,package.id,org,workspace,outcome,rationale,actor,authorization_version); END IF;
  SET CONSTRAINTS ALL IMMEDIATE;resource_id:=item_aggregate.id;
  result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',resource_id,'resourceVersion',new_version,
   'itemVersionId',new_version_id,'itemHash',content_hash,'status',outcome,'workPackageId',package.id);

 ELSIF action='delivery.package.revision.commit' THEN
  SELECT * INTO package FROM public.enterprise_delivery_work_packages WHERE id=(p_command->>'workPackageId')::uuid AND org_id=org AND workspace_id=workspace FOR UPDATE;
  SELECT * INTO package_version FROM public.enterprise_delivery_work_package_versions WHERE id=package.current_version_id AND work_package_id=package.id FOR SHARE;
  items:=COALESCE(p_command->'itemRevisions','[]'::jsonb);
  manifest:=COALESCE(p_command->'expectedItems','[]'::jsonb);
  IF NULLIF(p_command->>'expectedPackageAggregateVersion','') IS NULL
    OR package.id IS NULL OR package.current_version<>(p_command->>'expectedPackageVersion')::bigint OR package.current_version_id IS DISTINCT FROM (p_command->>'expectedPackageVersionId')::uuid
    OR package.aggregate_version<>(p_command->>'expectedPackageAggregateVersion')::bigint OR package.status<>'blocked'
    OR jsonb_typeof(items)<>'array' OR jsonb_array_length(items)=0 OR jsonb_array_length(items)>250
    OR jsonb_typeof(manifest)<>'array' OR jsonb_array_length(manifest)=0 OR jsonb_array_length(manifest)>250
    OR NOT public.enterprise_pr_c_delivery_source_current(package.source_package_id,org,workspace,true) THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  SELECT count(*),count(DISTINCT (value->>'itemAggregateId')::uuid) INTO selector_count,new_version FROM jsonb_array_elements(items);
  IF selector_count<>new_version OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) WHERE NULLIF(value->>'itemAggregateId','') IS NULL) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  SELECT count(*),count(DISTINCT (value->>'itemAggregateId')::uuid) INTO selector_count,new_version FROM jsonb_array_elements(manifest);
  IF selector_count<>new_version OR EXISTS(SELECT 1 FROM jsonb_array_elements(manifest) WHERE NULLIF(value->>'itemAggregateId','') IS NULL
    OR NULLIF(value->>'expectedAggregateVersion','') IS NULL OR NULLIF(value->>'expectedItemVersionId','') IS NULL) THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  PERFORM 1 FROM public.enterprise_delivery_work_item_aggregates aggregate
   WHERE aggregate.work_package_id=package.id AND aggregate.org_id=org AND aggregate.workspace_id=workspace ORDER BY aggregate.id FOR UPDATE;
  IF (SELECT count(*) FROM public.enterprise_delivery_work_item_aggregates aggregate WHERE aggregate.work_package_id=package.id AND aggregate.org_id=org AND aggregate.workspace_id=workspace)<>selector_count
    OR (SELECT count(*) FROM public.enterprise_delivery_work_item_aggregates aggregate JOIN jsonb_array_elements(manifest) selected
      ON (selected.value->>'itemAggregateId')::uuid=aggregate.id
      AND (selected.value->>'expectedAggregateVersion')::bigint=aggregate.aggregate_version
      AND (selected.value->>'expectedItemVersionId')::uuid=aggregate.current_version_id
      WHERE aggregate.work_package_id=package.id AND aggregate.org_id=org AND aggregate.workspace_id=workspace)<>selector_count
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) revision_entry WHERE NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(manifest) expected_entry WHERE (expected_entry->>'itemAggregateId')::uuid=(revision_entry->>'itemAggregateId')::uuid
        AND (expected_entry->>'expectedAggregateVersion')::bigint=(revision_entry->>'expectedAggregateVersion')::bigint
        AND (expected_entry->>'expectedItemVersionId')::uuid=(revision_entry->>'expectedItemVersionId')::uuid))
  THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  new_version:=package.current_version+1;package_version_id:=gen_random_uuid();content_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-package-content-2',
   'parentVersionId',package.current_version_id,'packageContent',COALESCE(p_command->'packageContent',package_version.content),'itemRevisions',items));
  INSERT INTO public.enterprise_delivery_work_package_versions(id,work_package_id,org_id,workspace_id,version,studio_workspace_id,studio_document_id,artifact_type,studio_version_id,studio_version,studio_content_hash,
   content,content_hash,status,created_by,source_package_id,source_package_hash,lineage_classification,planning_only)
  VALUES(package_version_id,package.id,org,workspace,new_version,package_version.studio_workspace_id,package_version.studio_document_id,package_version.artifact_type,package_version.studio_version_id,
   package_version.studio_version,package_version.studio_content_hash,COALESCE(p_command->'packageContent',package_version.content),content_hash,'draft',actor,
   package_version.source_package_id,package_version.source_package_hash,package_version.lineage_classification,package_version.planning_only);
  items:='[]'::jsonb;
  FOR item_aggregate IN SELECT aggregate.* FROM public.enterprise_delivery_work_item_aggregates aggregate
    WHERE aggregate.work_package_id=package.id AND aggregate.org_id=org AND aggregate.workspace_id=workspace ORDER BY aggregate.id LOOP
   SELECT selected.value INTO revision FROM jsonb_array_elements(p_command->'itemRevisions') selected(value)
    WHERE (selected.value->>'itemAggregateId')::uuid=item_aggregate.id;
   SELECT * INTO item_version FROM public.enterprise_delivery_work_item_versions WHERE id=item_aggregate.current_version_id AND item_aggregate_id=item_aggregate.id;
   IF revision IS NOT NULL THEN
    IF item_aggregate.aggregate_version<>(revision->>'expectedAggregateVersion')::bigint OR item_aggregate.current_version_id IS DISTINCT FROM (revision->>'expectedItemVersionId')::uuid
       OR NOT public.enterprise_pr_c_item_json_safe(COALESCE(revision->'item','{}'::jsonb)) OR length(btrim(COALESCE(revision->>'rationale',''))) NOT BETWEEN 1 AND 4000
    THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
    item_payload:=revision->'item';carried_status:='edited';carried_rationale:=revision->>'rationale';
    IF item_payload->>'itemType'=item_version.item_type AND item_payload->>'title'=item_version.title AND item_payload->>'description'=item_version.description
      AND COALESCE(item_payload->'acceptanceCriteria','[]'::jsonb)=item_version.acceptance_criteria
      AND COALESCE(item_payload->'nonFunctionalRequirements','[]'::jsonb)=item_version.non_functional_requirements
    THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
   ELSE
    item_payload:=jsonb_build_object('itemType',item_version.item_type,'title',item_version.title,'description',item_version.description,
      'acceptanceCriteria',item_version.acceptance_criteria,'nonFunctionalRequirements',item_version.non_functional_requirements);
    carried_status:='proposed';carried_rationale:='Carried forward unchanged for exact package-version re-review.';
   END IF;
   new_version_id:=gen_random_uuid();manifest_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-item-2','itemType',item_payload->>'itemType',
    'title',item_payload->>'title','description',COALESCE(item_payload->>'description',''),'acceptanceCriteria',COALESCE(item_payload->'acceptanceCriteria','[]'::jsonb),
    'nonFunctionalRequirements',COALESCE(item_payload->'nonFunctionalRequirements','[]'::jsonb),
    'deliverySourcePackageId',item_version.delivery_source_package_id,'deliverySourcePackageHash',item_version.delivery_source_package_hash,
    'studioSourcePackageId',item_version.studio_source_package_id,'studioSourcePackageHash',item_version.studio_source_package_hash,
    'sourceArtifactWorkspaceId',item_version.source_artifact_workspace_id,'sourceArtifactId',item_version.source_artifact_id,'sourceArtifactType',item_version.source_artifact_type,
    'sourceArtifactVersionId',item_version.source_artifact_version_id,'sourceArtifactVersion',item_version.source_artifact_version,'sourceArtifactHash',item_version.source_artifact_hash,
    'sourceSectionLocator',item_version.source_section_locator));
   INSERT INTO public.enterprise_delivery_work_item_versions(id,item_aggregate_id,work_package_id,package_version_id,org_id,workspace_id,version,parent_version_id,item_type,title,description,
    acceptance_criteria,non_functional_requirements,delivery_source_package_id,delivery_source_package_hash,studio_source_package_id,studio_source_package_hash,
    source_artifact_workspace_id,source_artifact_id,source_artifact_type,source_artifact_version_id,source_artifact_version,source_artifact_hash,source_section_locator,status,rationale,content_hash,created_by)
   VALUES(new_version_id,item_aggregate.id,package.id,package_version_id,org,workspace,item_aggregate.current_version+1,item_version.id,item_payload->>'itemType',item_payload->>'title',
    COALESCE(item_payload->>'description',''),COALESCE(item_payload->'acceptanceCriteria','[]'::jsonb),COALESCE(item_payload->'nonFunctionalRequirements','[]'::jsonb),
    item_version.delivery_source_package_id,item_version.delivery_source_package_hash,item_version.studio_source_package_id,item_version.studio_source_package_hash,
    item_version.source_artifact_workspace_id,item_version.source_artifact_id,item_version.source_artifact_type,item_version.source_artifact_version_id,item_version.source_artifact_version,item_version.source_artifact_hash,item_version.source_section_locator,carried_status,
    carried_rationale,manifest_hash,actor);
   UPDATE public.enterprise_delivery_work_item_aggregates SET current_version_id=new_version_id,current_version=current_version+1,aggregate_version=aggregate_version+1,updated_at=statement_timestamp() WHERE id=item_aggregate.id;
   items:=items||jsonb_build_array(jsonb_build_object('itemAggregateId',item_aggregate.id,'itemVersionId',new_version_id,'version',item_aggregate.current_version+1,'itemHash',manifest_hash,'status',carried_status));
  END LOOP;
  UPDATE public.enterprise_delivery_work_packages SET current_version=new_version,current_version_id=package_version_id,aggregate_version=aggregate_version+1,status='draft',updated_at=statement_timestamp() WHERE id=package.id;
  INSERT INTO public.enterprise_delivery_package_blocker_events(id,work_package_id,org_id,workspace_id,blocker_key,sequence,action,blocker_type,safe_summary,actor_id)
  SELECT gen_random_uuid(),package.id,org,workspace,latest.blocker_key,latest.sequence+1,'resolved',latest.blocker_type,
    left('Resolved by package revision '||new_version::text||'.',500),actor
  FROM public.enterprise_delivery_package_blocker_events latest
  WHERE latest.work_package_id=package.id AND latest.org_id=org AND latest.workspace_id=workspace AND latest.action='opened'
    AND latest.blocker_type='review_changes_requested'
    AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_package_blocker_events newer
      WHERE newer.work_package_id=latest.work_package_id AND newer.blocker_key=latest.blocker_key AND newer.sequence>latest.sequence);
  SET CONSTRAINTS ALL IMMEDIATE;resource_id:=package.id;
  result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',package.id,'resourceVersion',new_version,
   'packageVersionId',package_version_id,'packageHash',content_hash,'items',items);

 ELSIF action='delivery.package.review.resolve' THEN
  SELECT * INTO package FROM public.enterprise_delivery_work_packages WHERE id=(p_command->>'workPackageId')::uuid AND org_id=org AND workspace_id=workspace FOR UPDATE;
  SELECT * INTO package_version FROM public.enterprise_delivery_work_package_versions WHERE id=package.current_version_id AND work_package_id=package.id FOR SHARE;
  outcome:=p_command->>'outcome';rationale:=p_command->>'rationale';
  IF NULLIF(p_command->>'expectedPackageAggregateVersion','') IS NULL THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  IF package.id IS NULL OR package.current_version<>(p_command->>'expectedPackageVersion')::bigint OR package.current_version_id IS DISTINCT FROM (p_command->>'expectedPackageVersionId')::uuid
    OR package.status<>'draft' OR outcome NOT IN('approved','changes_requested','rejected') OR length(btrim(rationale)) NOT BETWEEN 1 AND 4000
    OR actor=package_version.created_by
    OR EXISTS(SELECT 1 FROM public.enterprise_delivery_work_item_aggregates current_aggregate
      JOIN public.enterprise_delivery_work_item_versions current_item ON current_item.id=current_aggregate.current_version_id AND current_item.item_aggregate_id=current_aggregate.id
      LEFT JOIN public.enterprise_delivery_work_item_decisions current_decision ON current_decision.item_aggregate_id=current_aggregate.id AND current_decision.item_version_id=current_item.id
      WHERE current_aggregate.work_package_id=package.id AND current_aggregate.org_id=org AND current_aggregate.workspace_id=workspace
       AND actor IN(current_item.created_by,current_decision.decided_by))
    OR NOT public.enterprise_pr_c_delivery_source_current(package.source_package_id,org,workspace,true) THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  IF package.aggregate_version<>(p_command->>'expectedPackageAggregateVersion')::bigint THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  IF outcome='approved' THEN PERFORM public.enterprise_pr_c_assert_package_resolved(package.id,org,workspace); END IF;
  manifest:=public.enterprise_pr_c_accepted_item_manifest(package.id,org,workspace,true);selector_count:=jsonb_array_length(manifest);manifest_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-accepted-set-2','acceptedItemCount',selector_count,'items',manifest));
  resource_id:=gen_random_uuid();
  INSERT INTO public.enterprise_delivery_package_review_events(id,work_package_id,package_version_id,org_id,workspace_id,package_version,package_aggregate_version,package_hash,accepted_set_hash,accepted_item_count,
   reviewer_id,reviewer_authorization_version,outcome,rationale)
  VALUES(resource_id,package.id,package_version.id,org,workspace,package_version.version,package.aggregate_version,package_version.content_hash,manifest_hash,selector_count,actor,authorization_version,outcome,rationale);
  IF outcome IN('changes_requested','rejected') THEN
   INSERT INTO public.enterprise_delivery_package_blocker_events(id,work_package_id,org_id,workspace_id,blocker_key,sequence,action,blocker_type,safe_summary,actor_id)
   VALUES(gen_random_uuid(),package.id,org,workspace,'package-review-'||package_version.id::text,1,'opened',
    CASE outcome WHEN 'changes_requested' THEN 'review_changes_requested' ELSE 'review_rejected' END,left(rationale,500),actor);
  END IF;
  UPDATE public.enterprise_delivery_work_packages SET status=CASE outcome WHEN 'approved' THEN 'review' WHEN 'changes_requested' THEN 'blocked' ELSE 'rejected' END,updated_at=statement_timestamp() WHERE id=package.id;
  result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',resource_id,'resourceVersion',package_version.version,
   'workPackageId',package.id,'packageVersionId',package_version.id,'packageHash',package_version.content_hash,'acceptedSetHash',manifest_hash,'acceptedItemCount',selector_count,'status',outcome);

 ELSIF action='delivery.package.approval.resolve' THEN
  SELECT * INTO package FROM public.enterprise_delivery_work_packages WHERE id=(p_command->>'workPackageId')::uuid AND org_id=org AND workspace_id=workspace FOR UPDATE;
  SELECT * INTO package_version FROM public.enterprise_delivery_work_package_versions WHERE id=package.current_version_id AND work_package_id=package.id FOR SHARE;
  SELECT stored_review.* INTO review FROM public.enterprise_delivery_package_review_events stored_review
   WHERE stored_review.work_package_id=package.id AND stored_review.package_version_id=package_version.id FOR SHARE;
  outcome:=p_command->>'outcome';rationale:=p_command->>'rationale';
  IF NULLIF(p_command->>'expectedPackageAggregateVersion','') IS NULL THEN RAISE EXCEPTION 'INVALID_COMMAND'; END IF;
  IF package.id IS NULL OR package.current_version<>(p_command->>'expectedPackageVersion')::bigint OR package.current_version_id IS DISTINCT FROM (p_command->>'expectedPackageVersionId')::uuid
    OR review.package_aggregate_version<>package.aggregate_version
    OR package.status<>'review' OR review.outcome<>'approved' OR outcome NOT IN('approved','rejected') OR length(btrim(rationale)) NOT BETWEEN 1 AND 4000
    OR actor IN(package_version.created_by,review.reviewer_id)
    OR EXISTS(SELECT 1 FROM public.enterprise_delivery_work_item_aggregates current_aggregate
      JOIN public.enterprise_delivery_work_item_versions current_item ON current_item.id=current_aggregate.current_version_id AND current_item.item_aggregate_id=current_aggregate.id
      LEFT JOIN public.enterprise_delivery_work_item_decisions current_decision ON current_decision.item_aggregate_id=current_aggregate.id AND current_decision.item_version_id=current_item.id
      WHERE current_aggregate.work_package_id=package.id AND current_aggregate.org_id=org AND current_aggregate.workspace_id=workspace
       AND actor IN(current_item.created_by,current_decision.decided_by))
    OR NOT public.enterprise_pr_c_delivery_source_current(package.source_package_id,org,workspace,true) THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  IF package.aggregate_version<>(p_command->>'expectedPackageAggregateVersion')::bigint THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  PERFORM public.enterprise_pr_c_assert_package_resolved(package.id,org,workspace);
  manifest:=public.enterprise_pr_c_accepted_item_manifest(package.id,org,workspace,true);selector_count:=jsonb_array_length(manifest);manifest_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-accepted-set-2','acceptedItemCount',selector_count,'items',manifest));
  IF manifest_hash<>review.accepted_set_hash OR selector_count<>review.accepted_item_count THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  resource_id:=gen_random_uuid();
  INSERT INTO public.enterprise_delivery_package_approval_events(id,work_package_id,package_version_id,review_event_id,org_id,workspace_id,package_version,package_aggregate_version,package_hash,accepted_set_hash,accepted_item_count,
   created_by,reviewed_by,approved_by,approver_authorization_version,outcome,rationale)
  VALUES(resource_id,package.id,package_version.id,review.id,org,workspace,package_version.version,package.aggregate_version,package_version.content_hash,manifest_hash,selector_count,package_version.created_by,review.reviewer_id,actor,authorization_version,outcome,rationale);
  IF outcome='rejected' THEN
   INSERT INTO public.enterprise_delivery_package_blocker_events(id,work_package_id,org_id,workspace_id,blocker_key,sequence,action,blocker_type,safe_summary,actor_id)
   VALUES(gen_random_uuid(),package.id,org,workspace,'package-approval-'||package_version.id::text,1,'opened','approval_rejected',left(rationale,500),actor);
  END IF;
  UPDATE public.enterprise_delivery_work_packages SET status=outcome,updated_at=statement_timestamp() WHERE id=package.id;
  UPDATE public.enterprise_delivery_work_package_versions SET status=outcome WHERE id=package_version.id;
  result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',resource_id,'resourceVersion',package_version.version,
   'workPackageId',package.id,'packageVersionId',package_version.id,'packageHash',package_version.content_hash,'acceptedSetHash',manifest_hash,'acceptedItemCount',selector_count,'status',outcome);

 ELSIF action='monitor.baseline.create' THEN
  IF p_command ? 'packageApprovalId' OR p_command ? 'expectedAcceptedSetHash' OR p_command ? 'acceptedItemAggregateIds'
    OR p_command ? 'milestones' OR p_command ? 'dependencies' OR p_command ? 'blockers' OR p_command ? 'risks' OR p_command ? 'readiness' THEN
   RAISE EXCEPTION 'INVALID_COMMAND';
  END IF;
  SELECT * INTO package FROM public.enterprise_delivery_work_packages WHERE id=(p_command->>'workPackageId')::uuid AND org_id=org AND workspace_id=workspace FOR UPDATE;
  SELECT * INTO package_version FROM public.enterprise_delivery_work_package_versions WHERE id=package.current_version_id AND work_package_id=package.id FOR SHARE;
  SELECT stored_approval.* INTO approval FROM public.enterprise_delivery_package_approval_events stored_approval
   WHERE stored_approval.work_package_id=package.id AND stored_approval.package_version_id=package_version.id AND stored_approval.outcome='approved' FOR SHARE;
  IF package.id IS NULL OR package.status<>'approved' OR package.current_version<>(p_command->>'expectedPackageVersion')::bigint
    OR package.current_version_id IS DISTINCT FROM (p_command->>'expectedPackageVersionId')::uuid OR approval.id IS NULL
    OR NOT public.enterprise_pr_c_delivery_source_current(package.source_package_id,org,workspace,true) THEN
   RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE'; END IF;
  PERFORM public.enterprise_pr_c_assert_package_resolved(package.id,org,workspace);
  manifest:=public.enterprise_pr_c_accepted_item_manifest(package.id,org,workspace,true);selector_count:=jsonb_array_length(manifest);manifest_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-accepted-set-2','acceptedItemCount',selector_count,'items',manifest));
  IF manifest_hash<>approval.accepted_set_hash OR selector_count<>approval.accepted_item_count THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  SELECT COALESCE(jsonb_agg(version.title ORDER BY aggregate.id) FILTER(WHERE version.item_type='Milestone'),'[]'::jsonb),
    COALESCE(jsonb_agg(version.title ORDER BY aggregate.id) FILTER(WHERE version.item_type='Dependency'),'[]'::jsonb),
    COALESCE(jsonb_agg(version.title ORDER BY aggregate.id) FILTER(WHERE version.item_type='Risk'),'[]'::jsonb)
  INTO milestones,dependencies,risks
  FROM public.enterprise_delivery_work_item_aggregates aggregate
  JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id AND version.item_aggregate_id=aggregate.id
  WHERE aggregate.work_package_id=package.id AND aggregate.org_id=org AND aggregate.workspace_id=workspace AND version.status='accepted';
  baseline_readiness:=CASE WHEN package_version.planning_only THEN 'not_ready' ELSE 'review_required' END;
  SELECT * INTO existing_baseline FROM public.enterprise_monitor_baselines WHERE org_id=org AND workspace_id=workspace AND work_package_version_id=package_version.id FOR SHARE;
  IF existing_baseline.id IS NOT NULL THEN
   RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_UNAVAILABLE';
  ELSE
   resource_id:=gen_random_uuid();content_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contract','monitor-baseline-2','workPackageId',package.id,
    'packageVersionId',package_version.id,'packageVersion',package_version.version,'packageHash',package_version.content_hash,'packageApprovalId',approval.id,
    'acceptedSetHash',manifest_hash,'acceptedItemCount',selector_count,'milestones',milestones,'dependencies',dependencies,'risks',risks,
    'readiness',baseline_readiness,'lineageClassification',package_version.lineage_classification,'planningOnly',package_version.planning_only,'liveTelemetryConnected',false));
   SELECT * INTO source FROM public.enterprise_delivery_source_packages WHERE id=package.source_package_id;
   INSERT INTO public.enterprise_monitor_baselines(id,org_id,workspace_id,work_package_id,work_package_version_id,studio_document_id,studio_version,studio_content_hash,
    approved_item_ids,milestones,dependencies,blockers,risks,readiness,status,live_telemetry_connected,version,resource_hash,created_by,baseline_contract,package_version,
    package_hash,source_package_id,source_package_hash,lineage_classification,planning_only,package_approval_id,accepted_set_hash,accepted_item_count)
   VALUES(resource_id,org,workspace,package.id,package_version.id,source.studio_artifact_id,source.studio_artifact_version,source.studio_artifact_hash,
    (SELECT jsonb_agg(entry->>'itemAggregateId' ORDER BY entry->>'itemAggregateId') FROM jsonb_array_elements(manifest) entry),
    milestones,dependencies,'[]'::jsonb,risks,
    baseline_readiness,'approved',false,1,content_hash,actor,'delivery-monitor-2',package_version.version,package_version.content_hash,source.id,source.package_hash,
    source.lineage_classification,source.planning_only,approval.id,manifest_hash,selector_count);
   INSERT INTO public.enterprise_monitor_baseline_items(baseline_id,work_package_id,work_package_version_id,item_aggregate_id,item_version_id,org_id,workspace_id,ordinal,item_type,item_hash)
   SELECT resource_id,package.id,package_version.id,(entry->>'itemAggregateId')::uuid,(entry->>'itemVersionId')::uuid,org,workspace,ordinality::integer,entry->>'itemType',entry->>'itemHash'
   FROM jsonb_array_elements(manifest) WITH ORDINALITY selected(entry,ordinality);
   result:=jsonb_build_object('ok',true,'outcome','committed','receiptId',receipt.id,'action',action,'resourceId',resource_id,'resourceVersion',1,
    'workPackageId',package.id,'packageVersionId',package_version.id,'packageHash',package_version.content_hash,'packageApprovalId',approval.id,
    'acceptedSetHash',manifest_hash,'acceptedItemCount',selector_count,'resourceHash',content_hash,'lineageClassification',source.lineage_classification,'planningOnly',source.planning_only,
    'milestones',milestones,'dependencies',dependencies,'blockers','[]'::jsonb,'risks',risks,
    'readiness',baseline_readiness,'liveTelemetryConnected',false);
  END IF;
 END IF;

 IF result IS NULL OR resource_id IS NULL THEN RAISE EXCEPTION 'COMMAND_RESULT_MISSING'; END IF;
 -- Revocation wins immediately before the domain effect and receipt become visible.
 BEGIN
  PERFORM public.pr1b_assert_command_authority(actor,org,workspace,capability,authorization_version);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='PR1B_AUTHORIZATION_STALE' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_RESOURCE_STALE'; END IF;
  IF SQLERRM='PR1B_NOT_FOUND' THEN RAISE EXCEPTION 'ENTERPRISE_DELIVERY_PERMISSION_DENIED'; END IF;
  RAISE;
 END;
 effect_id:=gen_random_uuid();audit_id:=gen_random_uuid();
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,action,'enterprise_delivery_monitor',resource_id,'succeeded',COALESCE((result->>'resourceVersion')::bigint,1),
  jsonb_build_object('contract','enterprise-delivery-monitor-command-1','receiptId',receipt.id,'effectId',effect_id,'bindingHash',receipt.binding_hash,
   'resourceHash',COALESCE(result->>'resourceHash',result->>'packageHash',result->>'itemHash',result->>'targetPackageHash'),'status',result->>'status'));
 INSERT INTO public.enterprise_delivery_monitor_effects(id,receipt_id,org_id,workspace_id,actor_id,action,binding_hash,execution_token,execution_fence,resource_id,audit_id,result)
 VALUES(effect_id,receipt.id,org,workspace,actor,action,receipt.binding_hash,execution_token,execution_fence,resource_id,audit_id,result);
 UPDATE public.enterprise_delivery_monitor_command_receipts SET status='committed',resource_id=(result->>'resourceId')::uuid,response=result,completed_at=statement_timestamp()
 WHERE id=receipt.id AND status='claimed';
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_delivery_workspace_projection(p_org uuid,p_workspace uuid,p_query jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE jwt_actor boolean:=auth.uid() IS NOT NULL;actor uuid:=auth.uid();authorization_version bigint;projection_capability text;flags public.enterprise_transcript_workspace_flags;control public.enterprise_intelligence_runtime_control;
 package_selector uuid;cursor_version bigint:=COALESCE((p_query->>'itemCursorVersion')::bigint,0);cursor_id uuid:=COALESCE((p_query->>'itemCursorId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid);
 item_limit integer:=LEAST(GREATEST(COALESCE((p_query->>'itemLimit')::integer,50),1),100);packages jsonb;handoffs jsonb;baseline_eligibility jsonb;package_has_more boolean;handoff_has_more boolean;
 baseline_eligibility_limit integer:=LEAST(GREATEST(COALESCE((p_query->>'baselineEligibilityLimit')::integer,100),1),100);
 baseline_eligibility_cursor_updated_at timestamptz:=NULLIF(p_query->>'baselineEligibilityCursorUpdatedAt','')::timestamptz;
 baseline_eligibility_cursor_package_id uuid:=NULLIF(p_query->>'baselineEligibilityCursorPackageId','')::uuid;
 baseline_eligibility_has_more boolean;baseline_eligibility_next_cursor jsonb;
 writable boolean;can_handoff_request boolean;can_handoff_review boolean;can_handoff_approve boolean;can_handoff_consume boolean;
 can_handoff_request_read boolean;can_handoff_review_read boolean;can_handoff_approve_read boolean;can_handoff_consume_read boolean;
 can_manage boolean;can_create_manual boolean;can_review boolean;can_approve boolean;can_baseline boolean;can_project_read boolean;
BEGIN
 IF jsonb_typeof(COALESCE(p_query,'{}'::jsonb))<>'object' THEN RETURN NULL; END IF;
 IF (baseline_eligibility_cursor_updated_at IS NULL)<>(baseline_eligibility_cursor_package_id IS NULL) THEN RETURN NULL; END IF;
 IF actor IS NULL THEN actor:=(p_query->>'actorId')::uuid;authorization_version:=(p_query->>'authorizationVersion')::bigint; END IF;
 IF actor IS NULL THEN RETURN NULL; END IF;
 SELECT cap.capability_key INTO projection_capability FROM public.organization_members om
 JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
 JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
 WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL
  AND wm.status='active' AND wm.deleted_at IS NULL AND role.status='active' AND role.deleted_at IS NULL
  AND cap.capability_key IN('project.read','project.manage','delivery.handoff.request','delivery.handoff.review','delivery.handoff.approve','delivery.handoff.consume',
    'delivery.package.manage','delivery.package.review','delivery.package.approve','monitor.baseline.create')
 ORDER BY cap.capability_key LIMIT 1;
 IF projection_capability IS NULL THEN RETURN NULL; END IF;
 IF jwt_actor THEN SELECT version INTO authorization_version FROM public.authorization_versions WHERE org_id=p_org AND user_id=actor;
 ELSIF authorization_version IS NULL THEN RETURN NULL; END IF;
 PERFORM public.pr1b_assert_command_authority(actor,p_org,p_workspace,projection_capability,authorization_version);
 package_selector:=NULLIF(p_query->>'packageId','')::uuid;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 SELECT * INTO control FROM public.enterprise_intelligence_runtime_control WHERE singleton;
 writable:=COALESCE(control.enabled,false) AND COALESCE(control.delivery_enabled,false) AND NOT COALESCE(control.read_only,true);
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.handoff.request') INTO can_handoff_request;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.handoff.review') INTO can_handoff_review;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.handoff.approve') INTO can_handoff_approve;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.handoff.consume') INTO can_handoff_consume;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.package.manage') INTO can_manage;
 can_create_manual:=writable AND COALESCE(flags.direct_delivery_planning_enabled,false) AND can_manage;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.package.review') INTO can_review;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='delivery.package.approve') INTO can_approve;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key='monitor.baseline.create') INTO can_baseline;
 SELECT EXISTS(SELECT 1 FROM public.organization_members om JOIN public.workspace_memberships wm ON wm.org_id=om.org_id AND wm.user_id=om.user_id
   JOIN public.roles role ON role.id IN(om.role_id,wm.role_id) JOIN public.role_capabilities cap ON cap.role_id=role.id
   WHERE om.user_id=actor AND om.org_id=p_org AND wm.workspace_id=p_workspace AND om.status='active' AND om.deleted_at IS NULL AND wm.status='active' AND wm.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL AND cap.capability_key IN('project.read','project.manage')) INTO can_project_read;
 can_handoff_request_read:=can_handoff_request;
 can_handoff_review_read:=can_handoff_review;
 can_handoff_approve_read:=can_handoff_approve;
 can_handoff_consume_read:=can_handoff_consume;
 can_handoff_request:=writable AND COALESCE(flags.module_handoffs_enabled,false) AND can_handoff_request;
 can_handoff_review:=writable AND COALESCE(flags.module_handoffs_enabled,false) AND can_handoff_review;
 can_handoff_approve:=writable AND COALESCE(flags.module_handoffs_enabled,false) AND can_handoff_approve;
 can_handoff_consume:=writable AND COALESCE(flags.module_handoffs_enabled,false) AND can_handoff_consume;
 can_manage:=writable AND COALESCE(flags.delivery_item_review_enabled,false) AND can_manage;
 can_review:=writable AND COALESCE(flags.delivery_item_review_enabled,false) AND can_review;
 can_approve:=writable AND COALESCE(flags.delivery_item_review_enabled,false) AND can_approve;
 can_baseline:=writable AND COALESCE(flags.monitor_approved_baseline_enabled,false) AND can_baseline;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',page.id,'currentVersion',page.current_version,'currentVersionId',page.current_version_id,
  'aggregateVersion',page.aggregate_version,'status',CASE WHEN NOT page.source_current AND page.status NOT IN('approved','rejected','blocked') THEN 'stale' ELSE page.status END,
  'sourcePackage',jsonb_strip_nulls(jsonb_build_object('version',page.source_version,'sourceMode',page.source_mode,
   'lineageClassification',page.lineage_classification,'planningOnly',page.planning_only,
   'studioArtifactType',page.studio_artifact_type,'studioArtifactVersion',page.studio_artifact_version,
   'templateKind',page.template_kind,'templateVersion',page.template_version)),
   'items',page.items,'itemPage',page.item_page,'blockers',page.blockers,'blockerCount',page.blocker_count,
   'reviewHistory',page.review_history,'approvalHistory',page.approval_history,
   'acceptedItemCount',page.current_accepted_item_count,
   'historyPage',jsonb_build_object('limit',50,'reviewHasMore',page.review_count>50,'approvalHasMore',page.approval_count>50),
  'actions',(CASE WHEN page.source_current AND can_manage AND page.status='draft' THEN jsonb_build_array('delivery.item.review') ELSE '[]'::jsonb END)
    ||(CASE WHEN page.source_current AND can_manage AND page.status='blocked' THEN jsonb_build_array('delivery.package.revision.commit') ELSE '[]'::jsonb END)
    ||(CASE WHEN page.source_current AND can_review AND page.status='draft' AND page.current_version_created_by<>actor AND NOT page.current_item_actor_conflict THEN jsonb_build_array('delivery.package.review.resolve') ELSE '[]'::jsonb END)
    ||(CASE WHEN page.source_current AND can_approve AND page.status='review' AND page.current_version_created_by<>actor AND page.current_reviewer_id IS DISTINCT FROM actor AND NOT page.current_item_actor_conflict THEN jsonb_build_array('delivery.package.approval.resolve') ELSE '[]'::jsonb END)
    ||(CASE WHEN page.source_current AND can_baseline AND page.status='approved' AND page.baseline_eligible THEN jsonb_build_array('monitor.baseline.create') ELSE '[]'::jsonb END)
 ) ORDER BY page.updated_at DESC,page.id),'[]'::jsonb) INTO packages
 FROM(
  SELECT package.id,package.current_version,package.current_version_id,current_version.content_hash current_version_hash,current_version.created_by current_version_created_by,package.aggregate_version,package.status,package.updated_at,package.created_by,
   source.id source_id,source.version source_version,source.source_mode,source.lineage_classification,source.planning_only,source.package_hash source_hash,
   source.studio_artifact_id,source.studio_artifact_type,source.studio_artifact_version_id,source.studio_artifact_version,source.studio_artifact_hash,
   source.studio_source_package_id,source.studio_source_package_hash,source.template_kind,source.template_version,source.template_hash,
   public.enterprise_pr_c_delivery_source_current(source.id,p_org,p_workspace,false) source_current,
   blocker_truth.blockers,blocker_truth.blocker_count,
   item_page.items,jsonb_build_object('limit',item_limit,'hasMore',item_page.has_more,'nextCursor',item_page.next_cursor,
    'cursorApplied',cursor_version<>0 OR cursor_id<>'00000000-0000-0000-0000-000000000000'::uuid,
    'isComplete',cursor_version=0 AND cursor_id='00000000-0000-0000-0000-000000000000'::uuid AND NOT item_page.has_more) item_page,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('packageVersion',event.package_version,
    'acceptedItemCount',event.accepted_item_count,'outcome',event.outcome,
    'rationale',event.rationale,'createdAt',event.created_at) ORDER BY event.created_at,event.id)
    FROM (SELECT stored.* FROM public.enterprise_delivery_package_review_events stored WHERE stored.work_package_id=package.id ORDER BY stored.created_at DESC,stored.id DESC LIMIT 50) event),'[]'::jsonb) review_history,
   COALESCE((SELECT jsonb_agg(jsonb_build_object('packageVersion',event.package_version,
    'acceptedItemCount',event.accepted_item_count,
    'outcome',event.outcome,'rationale',event.rationale,'createdAt',event.created_at) ORDER BY event.created_at,event.id)
    FROM (SELECT stored.* FROM public.enterprise_delivery_package_approval_events stored WHERE stored.work_package_id=package.id ORDER BY stored.created_at DESC,stored.id DESC LIMIT 50) event),'[]'::jsonb) approval_history,
   (SELECT count(*) FROM public.enterprise_delivery_package_review_events event WHERE event.work_package_id=package.id) review_count,
   (SELECT count(*) FROM public.enterprise_delivery_package_approval_events event WHERE event.work_package_id=package.id) approval_count,
   (SELECT event.reviewer_id FROM public.enterprise_delivery_package_review_events event WHERE event.work_package_id=package.id
     AND event.package_version_id=package.current_version_id ORDER BY event.created_at DESC,event.id DESC LIMIT 1) current_reviewer_id,
   EXISTS(SELECT 1 FROM public.enterprise_delivery_work_item_aggregates current_aggregate
     JOIN public.enterprise_delivery_work_item_versions current_item ON current_item.id=current_aggregate.current_version_id AND current_item.item_aggregate_id=current_aggregate.id
     LEFT JOIN public.enterprise_delivery_work_item_decisions current_decision ON current_decision.item_aggregate_id=current_aggregate.id AND current_decision.item_version_id=current_item.id
     WHERE current_aggregate.work_package_id=package.id AND current_aggregate.org_id=p_org AND current_aggregate.workspace_id=p_workspace
      AND actor IN(current_item.created_by,current_decision.decided_by)) current_item_actor_conflict,
   (SELECT event.accepted_item_count FROM public.enterprise_delivery_package_approval_events event WHERE event.work_package_id=package.id
     AND event.package_version_id=package.current_version_id AND event.outcome='approved' LIMIT 1) current_accepted_item_count,
   (EXISTS(SELECT 1 FROM public.enterprise_delivery_package_approval_events approved
      WHERE approved.work_package_id=package.id AND approved.package_version_id=package.current_version_id AND approved.outcome='approved')
    AND NOT EXISTS(SELECT 1 FROM public.enterprise_monitor_baselines baseline WHERE baseline.org_id=p_org AND baseline.workspace_id=p_workspace
      AND baseline.work_package_version_id=package.current_version_id)
    AND public.enterprise_pr_c_delivery_source_current(source.id,p_org,p_workspace,false) AND blocker_truth.blocker_count=0) baseline_eligible
  FROM public.enterprise_delivery_work_packages package
  JOIN public.enterprise_delivery_source_packages source ON source.id=package.source_package_id AND source.work_package_id=package.id
  JOIN public.enterprise_delivery_work_package_versions current_version ON current_version.id=package.current_version_id AND current_version.work_package_id=package.id
  CROSS JOIN LATERAL(
   SELECT COALESCE(jsonb_agg(truth.safe_summary ORDER BY truth.blocker_key) FILTER(WHERE truth.ordinal<=250),'[]'::jsonb) blockers,count(*) blocker_count
   FROM(
    SELECT listed.*,row_number() OVER(ORDER BY listed.blocker_key) ordinal FROM(
     SELECT 'source-stale'::text blocker_key,'Delivery source is not current.'::text safe_summary
      WHERE NOT public.enterprise_pr_c_delivery_source_current(source.id,p_org,p_workspace,false)
     UNION ALL
     SELECT 'items-unresolved',left(format('%s Delivery items require a terminal decision.',count(*)),500)
      FROM public.enterprise_delivery_work_item_aggregates unresolved_aggregate
      JOIN public.enterprise_delivery_work_item_versions unresolved_version ON unresolved_version.id=unresolved_aggregate.current_version_id
      WHERE unresolved_aggregate.work_package_id=package.id AND unresolved_aggregate.org_id=p_org AND unresolved_aggregate.workspace_id=p_workspace
       AND unresolved_version.status NOT IN('accepted','rejected') HAVING count(*)>0
     UNION ALL
     SELECT event.blocker_key,left(event.safe_summary,500)
      FROM public.enterprise_delivery_package_blocker_events event
      WHERE event.work_package_id=package.id AND event.org_id=p_org AND event.workspace_id=p_workspace AND event.action='opened'
       AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_package_blocker_events newer
        WHERE newer.work_package_id=event.work_package_id AND newer.blocker_key=event.blocker_key AND newer.sequence>event.sequence)
    ) listed
   ) truth
  ) blocker_truth
  CROSS JOIN LATERAL(
   SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('itemAggregateId',listed.aggregate_id,'parentAggregateId',listed.parent_aggregate_id,
    'aggregateVersion',listed.aggregate_version,'itemVersionId',listed.version_id,'version',listed.version,'status',listed.status,'itemType',listed.item_type,
    'title',listed.title,'description',listed.description,'acceptanceCriteria',listed.acceptance_criteria,'nonFunctionalRequirements',listed.non_functional_requirements,
    'sourceCitation',CASE WHEN listed.source_artifact_id IS NULL THEN NULL ELSE jsonb_build_object('artifactType',listed.source_artifact_type,
      'artifactVersion',listed.source_artifact_version,
      'sectionLocator',listed.source_section_locator) END,'decision',listed.decision,'rationale',listed.rationale,'history',listed.history)) ORDER BY listed.version,listed.aggregate_id)
      FILTER(WHERE listed.row_number<=item_limit),'[]'::jsonb),
    count(*)>item_limit,
    CASE WHEN count(*)>item_limit THEN (jsonb_agg(jsonb_build_object('version',listed.version,'itemId',listed.aggregate_id) ORDER BY listed.version,listed.aggregate_id)->(item_limit-1)) ELSE NULL END
   FROM(
    SELECT aggregate.id aggregate_id,aggregate.parent_aggregate_id,aggregate.aggregate_version,version.id version_id,version.version,version.status,version.item_type,
     version.title,version.description,version.acceptance_criteria,version.non_functional_requirements,version.content_hash,
     version.delivery_source_package_id,version.delivery_source_package_hash,version.studio_source_package_id,version.studio_source_package_hash,
     version.source_artifact_workspace_id,version.source_artifact_id,version.source_artifact_type,
     version.source_artifact_version_id,version.source_artifact_version,version.source_artifact_hash,version.source_section_locator,
     decision.decision,decision.rationale,
     COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('version',history.version,
       'status',history.status,'itemType',history.item_type,'title',history.title,'description',history.description,'acceptanceCriteria',history.acceptance_criteria,
       'nonFunctionalRequirements',history.non_functional_requirements,'rationale',history.rationale,'createdAt',history.created_at,
       'decision',history_decision.decision,'decisionRationale',history_decision.rationale,
       'diff',CASE WHEN previous.id IS NULL THEN NULL ELSE jsonb_build_object('fromVersion',previous.version,'toVersion',history.version,
        'changedFields',(CASE WHEN previous.item_type IS DISTINCT FROM history.item_type THEN '["itemType"]'::jsonb ELSE '[]'::jsonb END)
          ||(CASE WHEN previous.title IS DISTINCT FROM history.title THEN '["title"]'::jsonb ELSE '[]'::jsonb END)
          ||(CASE WHEN previous.description IS DISTINCT FROM history.description THEN '["description"]'::jsonb ELSE '[]'::jsonb END)
          ||(CASE WHEN previous.acceptance_criteria IS DISTINCT FROM history.acceptance_criteria THEN '["acceptanceCriteria"]'::jsonb ELSE '[]'::jsonb END)
          ||(CASE WHEN previous.non_functional_requirements IS DISTINCT FROM history.non_functional_requirements THEN '["nonFunctionalRequirements"]'::jsonb ELSE '[]'::jsonb END)) END)) ORDER BY history.version)
       FROM (SELECT stored.* FROM public.enterprise_delivery_work_item_versions stored WHERE stored.item_aggregate_id=aggregate.id ORDER BY stored.version DESC LIMIT 25) history
       LEFT JOIN public.enterprise_delivery_work_item_versions previous ON previous.id=history.parent_version_id AND previous.item_aggregate_id=history.item_aggregate_id
       LEFT JOIN public.enterprise_delivery_work_item_decisions history_decision ON history_decision.item_aggregate_id=history.item_aggregate_id AND history_decision.item_version_id=history.id),'[]'::jsonb) history,
     row_number() OVER(ORDER BY version.version,aggregate.id) row_number
    FROM public.enterprise_delivery_work_item_aggregates aggregate
    JOIN public.enterprise_delivery_work_item_versions version ON version.id=aggregate.current_version_id AND version.item_aggregate_id=aggregate.id
    LEFT JOIN public.enterprise_delivery_work_item_decisions decision ON decision.item_aggregate_id=aggregate.id AND decision.item_version_id=version.id
    WHERE aggregate.work_package_id=package.id AND aggregate.org_id=p_org AND aggregate.workspace_id=p_workspace
      AND (version.version,aggregate.id)>(cursor_version,cursor_id)
    ORDER BY version.version,aggregate.id LIMIT item_limit+1
   ) listed
  ) item_page(items,has_more,next_cursor)
  WHERE package.org_id=p_org AND package.workspace_id=p_workspace AND can_project_read
   AND(package_selector IS NULL OR package.id=package_selector)
  ORDER BY package.updated_at DESC,package.id LIMIT 25
 ) page;
 SELECT count(*)>25 INTO package_has_more FROM public.enterprise_delivery_work_packages package
 JOIN public.enterprise_delivery_source_packages source ON source.id=package.source_package_id AND source.work_package_id=package.id
 WHERE package.org_id=p_org AND package.workspace_id=p_workspace AND can_project_read
  AND(package_selector IS NULL OR package.id=package_selector);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',handoff.id,'direction',CASE WHEN handoff.workspace_id=p_workspace THEN 'outbox' ELSE 'inbox' END,
   'edge','studio_to_delivery','targetWorkspaceId',handoff.target_workspace_id,'status',truth.effective_status,'currentVersion',handoff.current_version,
   'requestedAt',handoff.requested_at,'expiresAt',handoff.expires_at,
   'blockers',CASE WHEN truth.effective_status='stale' THEN jsonb_build_array(CASE WHEN handoff.expires_at<=statement_timestamp() THEN 'Handoff route expired.' ELSE 'Studio source is not current.' END)
     WHEN truth.effective_status IN('changes_requested','rejected') THEN jsonb_build_array(COALESCE((SELECT left(event.rationale,500) FROM public.enterprise_delivery_handoff_review_events event
       WHERE event.handoff_id=handoff.id ORDER BY event.created_at DESC,event.id DESC LIMIT 1),'Target review did not approve the handoff.')) ELSE '[]'::jsonb END,
   'source',jsonb_build_object('artifactType',handoff.studio_artifact_type,'studioArtifactVersion',handoff.studio_artifact_version,
    'templateKind',handoff.template_kind,'templateVersion',handoff.template_version,'lineageClassification',handoff.lineage_classification,'planningOnly',handoff.planning_only),
   'targetItems',COALESCE((SELECT jsonb_agg(target.item || jsonb_build_object('ordinal',target.ordinal) ORDER BY target.ordinal)
      FROM public.enterprise_delivery_handoff_target_items target WHERE target.handoff_id=handoff.id),'[]'::jsonb),
   'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('version',history.version,'status',history.status,
      'rationale',history.rationale,'createdAt',history.created_at) ORDER BY history.version) FROM (SELECT stored.* FROM public.enterprise_delivery_handoff_versions stored
       WHERE stored.handoff_id=handoff.id ORDER BY stored.version DESC LIMIT 50) history),'[]'::jsonb),
   'reviewHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object('handoffVersion',event.handoff_version,
      'outcome',event.outcome,'rationale',event.rationale,'createdAt',event.created_at) ORDER BY event.created_at,event.id) FROM (SELECT stored.* FROM public.enterprise_delivery_handoff_review_events stored
       WHERE stored.handoff_id=handoff.id ORDER BY stored.created_at DESC,stored.id DESC LIMIT 50) event),'[]'::jsonb),
   'approvalHistory',COALESCE((SELECT jsonb_agg(jsonb_build_object('handoffVersion',event.handoff_version,
      'outcome',event.outcome,'rationale',event.rationale,'createdAt',event.created_at) ORDER BY event.created_at,event.id)
      FROM (SELECT stored.* FROM public.enterprise_delivery_handoff_approval_events stored WHERE stored.handoff_id=handoff.id ORDER BY stored.created_at DESC,stored.id DESC LIMIT 50) event),'[]'::jsonb),
   'historyPage',jsonb_build_object('eventLimit',50,
      'historyHasMore',(SELECT count(*)>50 FROM public.enterprise_delivery_handoff_versions event WHERE event.handoff_id=handoff.id),
      'reviewHasMore',(SELECT count(*)>50 FROM public.enterprise_delivery_handoff_review_events event WHERE event.handoff_id=handoff.id),
      'approvalHasMore',(SELECT count(*)>50 FROM public.enterprise_delivery_handoff_approval_events event WHERE event.handoff_id=handoff.id)),
   'actions',(CASE WHEN can_handoff_request AND handoff.workspace_id=p_workspace AND handoff.requested_by=actor AND truth.effective_status NOT IN('rejected','withdrawn','stale','consumed') THEN jsonb_build_array('delivery.handoff.withdraw') ELSE '[]'::jsonb END)
    ||(CASE WHEN can_handoff_review AND handoff.target_workspace_id=p_workspace AND truth.effective_status IN('requested','target_review') AND handoff.requested_by<>actor THEN jsonb_build_array('delivery.handoff.review.resolve') ELSE '[]'::jsonb END)
    ||(CASE WHEN can_handoff_approve AND handoff.target_workspace_id=p_workspace AND truth.effective_status='approval_ready' AND handoff.requested_by<>actor
       AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_handoff_review_events review WHERE review.handoff_id=handoff.id AND review.reviewer_id=actor)
       THEN jsonb_build_array('delivery.handoff.approval.resolve') ELSE '[]'::jsonb END)
    ||(CASE WHEN can_handoff_consume AND handoff.target_workspace_id=p_workspace AND truth.effective_status='approved' AND handoff.requested_by<>actor
       AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_handoff_review_events review WHERE review.handoff_id=handoff.id AND review.reviewer_id=actor)
       AND NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_handoff_approval_events approval WHERE approval.handoff_id=handoff.id AND approval.approved_by=actor)
       THEN jsonb_build_array('delivery.handoff.consume') ELSE '[]'::jsonb END))
   ORDER BY handoff.updated_at DESC,handoff.id),'[]'::jsonb) INTO handoffs
 FROM (SELECT stored.* FROM public.enterprise_delivery_handoffs stored WHERE stored.org_id=p_org
   AND ((stored.workspace_id=p_workspace AND stored.requested_by=actor AND can_handoff_request_read)
     OR (stored.target_workspace_id=p_workspace AND (can_handoff_review_read OR can_handoff_approve_read OR can_handoff_consume_read)))
   ORDER BY stored.updated_at DESC,stored.id LIMIT 50) handoff
 CROSS JOIN LATERAL(SELECT CASE WHEN handoff.status NOT IN('rejected','withdrawn','stale','consumed')
   AND (handoff.expires_at<=statement_timestamp() OR NOT public.enterprise_pr_c_handoff_source_current(handoff.id,handoff.org_id))
   THEN 'stale' ELSE handoff.status END effective_status) truth
 ;
 SELECT count(*)>50 INTO handoff_has_more FROM public.enterprise_delivery_handoffs handoff
 WHERE handoff.org_id=p_org AND ((handoff.workspace_id=p_workspace AND handoff.requested_by=actor AND can_handoff_request_read)
   OR (handoff.target_workspace_id=p_workspace AND (can_handoff_review_read OR can_handoff_approve_read OR can_handoff_consume_read)));
 WITH eligible AS(
  SELECT package.id,package.current_version_id,package.current_version,package.updated_at,approved.accepted_item_count,
   source.lineage_classification,source.planning_only
  FROM public.enterprise_delivery_work_packages package
  JOIN public.enterprise_delivery_source_packages source ON source.id=package.source_package_id AND source.work_package_id=package.id
  JOIN LATERAL(SELECT event.accepted_item_count FROM public.enterprise_delivery_package_approval_events event
    WHERE event.work_package_id=package.id AND event.package_version_id=package.current_version_id AND event.outcome='approved'
    ORDER BY event.created_at DESC,event.id DESC LIMIT 1) approved ON true
  WHERE can_baseline AND package.org_id=p_org AND package.workspace_id=p_workspace AND package.status='approved'
   AND (baseline_eligibility_cursor_updated_at IS NULL
     OR (package.updated_at,package.id)<(baseline_eligibility_cursor_updated_at,baseline_eligibility_cursor_package_id))
   AND public.enterprise_pr_c_delivery_source_current(source.id,p_org,p_workspace,false)
   AND NOT EXISTS(SELECT 1 FROM public.enterprise_monitor_baselines existing WHERE existing.org_id=p_org AND existing.workspace_id=p_workspace
     AND existing.work_package_version_id=package.current_version_id)
  ORDER BY package.updated_at DESC,package.id DESC LIMIT baseline_eligibility_limit+1
 ),numbered AS(
  SELECT eligible.*,row_number() OVER(ORDER BY eligible.updated_at DESC,eligible.id DESC) ordinal FROM eligible
 )
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'workPackageId',page.id,'workPackageVersionId',page.current_version_id,'workPackageVersion',page.current_version,
    'acceptedItemCount',page.accepted_item_count,'lineageClassification',page.lineage_classification,'planningOnly',page.planning_only,
    'action','monitor.baseline.create') ORDER BY page.updated_at DESC,page.id DESC)
    FILTER(WHERE page.ordinal<=baseline_eligibility_limit),'[]'::jsonb),
   count(*)>baseline_eligibility_limit,
   CASE WHEN count(*)>baseline_eligibility_limit THEN(
    SELECT jsonb_build_object('updatedAt',cursor_page.updated_at,'workPackageId',cursor_page.id)
    FROM numbered cursor_page WHERE cursor_page.ordinal=baseline_eligibility_limit
   ) END
 INTO baseline_eligibility,baseline_eligibility_has_more,baseline_eligibility_next_cursor
 FROM numbered page;
 RETURN jsonb_build_object('contractVersion','enterprise-delivery-workspace-2','organizationId',p_org,'workspaceId',p_workspace,
  'featureFlags',jsonb_build_object('directDeliveryPlanningEnabled',COALESCE(flags.direct_delivery_planning_enabled,false),
   'deliveryItemReviewEnabled',COALESCE(flags.delivery_item_review_enabled,false),'monitorApprovedBaselineEnabled',COALESCE(flags.monitor_approved_baseline_enabled,false),
   'moduleHandoffsEnabled',COALESCE(flags.module_handoffs_enabled,false)),
  'readOnly',NOT writable,'actions',(CASE WHEN can_handoff_request THEN jsonb_build_array('delivery.handoff.request') ELSE '[]'::jsonb END)
    ||(CASE WHEN can_create_manual THEN jsonb_build_array('delivery.package.create.manual') ELSE '[]'::jsonb END),
  'page',jsonb_strip_nulls(jsonb_build_object('packageLimit',25,'packageHasMore',package_has_more,'handoffLimit',50,'handoffHasMore',handoff_has_more,
    'itemHistoryLimit',25,'eventHistoryLimit',50,'handoffTargetItemLimit',250,
    'baselineEligibilityLimit',baseline_eligibility_limit,'baselineEligibilityHasMore',baseline_eligibility_has_more,
    'baselineEligibilityCursorApplied',baseline_eligibility_cursor_updated_at IS NOT NULL,
    'baselineEligibilityNextCursor',baseline_eligibility_next_cursor)),
  'eligibleStudioArtifacts',CASE WHEN can_handoff_request THEN COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'studioArtifactId',candidate.artifact_id,'artifactType',candidate.artifact_type,'aggregateVersion',candidate.aggregate_version,
    'studioArtifactVersionId',candidate.version_id,'studioArtifactVersion',candidate.version,
    'lineageClassification',candidate.lineage_classification,'planningOnly',candidate.planning_only,
    'proposalItems',candidate.proposal_items)
    ORDER BY candidate.updated_at DESC,candidate.artifact_id) FROM(
      SELECT artifact.id artifact_id,artifact.artifact_type,artifact.aggregate_version,artifact.updated_at,version.id version_id,version.version,version.content_hash,
       source.id source_package_id,source.package_hash source_package_hash,source.lineage_classification,source.planning_only,
       (SELECT jsonb_agg(jsonb_build_object('clientKey','studio-section-'||COALESCE(NULLIF(section.value->>'id',''),section.ordinality::text),
         'itemType',CASE artifact.artifact_type WHEN 'brd' THEN 'Epic' WHEN 'frd' THEN 'Story' ELSE 'Task' END,
         'title',left(COALESCE(NULLIF(section.value->>'title',''),section.value->>'heading'),240),'description',left(COALESCE(section.value->>'body',''),12000),'acceptanceCriteria','[]'::jsonb,
         'nonFunctionalRequirements','[]'::jsonb,'sourceSectionLocator',artifact.artifact_type||'.sections.'||COALESCE(NULLIF(section.value->>'id',''),section.ordinality::text)) ORDER BY section.ordinality)
        FROM jsonb_array_elements(COALESCE(version.content->'sections','[]'::jsonb)) WITH ORDINALITY section(value,ordinality)) proposal_items
      FROM public.studio_artifact_aggregates artifact
      JOIN public.studio_artifact_versions version ON version.id=artifact.current_approved_version_id AND version.artifact_id=artifact.id
       AND version.org_id=artifact.org_id AND version.workspace_id=artifact.workspace_id
      JOIN public.studio_artifact_source_packages source ON source.id=version.source_package_id AND source.artifact_id=artifact.id
       AND source.org_id=artifact.org_id AND source.workspace_id=artifact.workspace_id
      WHERE artifact.org_id=p_org AND artifact.workspace_id=p_workspace AND artifact.lifecycle='approved' AND version.lifecycle='approved'
       AND source.package_hash=version.source_package_hash AND public.studio_pr_b_source_package_is_current(source.id,p_org,p_workspace)
      ORDER BY artifact.updated_at DESC,artifact.id LIMIT 25
    ) candidate WHERE jsonb_typeof(candidate.proposal_items)='array' AND jsonb_array_length(candidate.proposal_items) BETWEEN 1 AND 250
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate.proposal_items) proposal WHERE NOT public.enterprise_pr_c_item_json_safe(proposal))
    ),'[]'::jsonb) ELSE '[]'::jsonb END,
  'handoffs',handoffs,'packages',packages,'baselineEligibility',baseline_eligibility);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR numeric_value_out_of_range THEN RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_monitor_approved_baselines_projection(p_org uuid,p_workspace uuid,p_query jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE jwt_actor boolean:=auth.uid() IS NOT NULL;actor uuid:=auth.uid();authorization_version bigint;baseline_selector uuid;row_limit integer:=LEAST(GREATEST(COALESCE((p_query->>'limit')::integer,50),1),100);
 flags public.enterprise_transcript_workspace_flags;baselines jsonb;
BEGIN
 IF jsonb_typeof(COALESCE(p_query,'{}'::jsonb))<>'object' THEN RETURN NULL; END IF;
 IF actor IS NULL THEN actor:=(p_query->>'actorId')::uuid;authorization_version:=(p_query->>'authorizationVersion')::bigint; END IF;
 IF actor IS NULL THEN RETURN NULL; END IF;
 IF jwt_actor THEN SELECT version INTO authorization_version FROM public.authorization_versions WHERE org_id=p_org AND user_id=actor;
 ELSIF authorization_version IS NULL THEN RETURN NULL; END IF;
 PERFORM public.pr1b_assert_command_authority(actor,p_org,p_workspace,'monitor.read',authorization_version);
 baseline_selector:=NULLIF(p_query->>'baselineId','')::uuid;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',baseline.id,'version',baseline.version,'contract',baseline.baseline_contract,'status',baseline.status,
  'readiness',baseline.readiness,'lineageClassification',baseline.lineage_classification,'planningOnly',baseline.planning_only,
  'workPackageId',baseline.work_package_id,'workPackageVersion',baseline.package_version,
  'acceptedItemCount',baseline.accepted_item_count,
  'acceptedItems',baseline.items,'milestones',baseline.milestones,'dependencies',baseline.dependencies,'blockers',baseline.blockers,'risks',baseline.risks,
  'liveTelemetryConnected',false) ORDER BY baseline.created_at DESC,baseline.id),'[]'::jsonb) INTO baselines
 FROM(
  SELECT monitor.*,COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'itemVersion',version.version,'itemType',item.item_type,'title',version.title,'status',version.status) ORDER BY item.ordinal)
    FROM public.enterprise_monitor_baseline_items item
    JOIN public.enterprise_delivery_work_item_versions version ON version.id=item.item_version_id AND version.item_aggregate_id=item.item_aggregate_id
    WHERE item.baseline_id=monitor.id),'[]'::jsonb) items
  FROM public.enterprise_monitor_baselines monitor
  WHERE monitor.org_id=p_org AND monitor.workspace_id=p_workspace AND monitor.status='approved' AND monitor.baseline_contract='delivery-monitor-2'
   AND monitor.package_approval_id IS NOT NULL AND(baseline_selector IS NULL OR monitor.id=baseline_selector)
  ORDER BY monitor.created_at DESC,monitor.id LIMIT row_limit
 ) baseline;
 RETURN jsonb_build_object('contractVersion','enterprise-monitor-approved-baselines-2','organizationId',p_org,'workspaceId',p_workspace,
  'featureFlags',jsonb_build_object('monitorApprovedBaselineEnabled',COALESCE(flags.monitor_approved_baseline_enabled,false)),
  'readOnly',true,'liveTelemetryConnected',false,'baselines',baselines,'actions','[]'::jsonb);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_package_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','current_version','current_version_id','aggregate_version','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_version','current_version_id','aggregate_version','updated_at'])
   OR OLD.status IN('approved','rejected','stale') THEN RAISE EXCEPTION 'DELIVERY_PACKAGE_IMMUTABLE'; END IF;
 IF NEW.current_version<>OLD.current_version THEN
  IF NEW.current_version<>OLD.current_version+1 OR NEW.current_version_id=OLD.current_version_id OR NEW.aggregate_version<>OLD.aggregate_version+1 OR NEW.status<>'draft' THEN
   RAISE EXCEPTION 'DELIVERY_PACKAGE_VERSION_TRANSITION_INVALID'; END IF;
 ELSIF NEW.current_version_id<>OLD.current_version_id THEN
  RAISE EXCEPTION 'DELIVERY_PACKAGE_VERSION_TRANSITION_INVALID';
 ELSIF NEW.aggregate_version<>OLD.aggregate_version
   AND (NEW.aggregate_version<>OLD.aggregate_version+1 OR OLD.status<>'draft' OR NEW.status<>'draft') THEN
  RAISE EXCEPTION 'DELIVERY_PACKAGE_VERSION_TRANSITION_INVALID';
 END IF;
 IF OLD.status='blocked' AND (NEW.current_version=OLD.current_version OR NEW.status<>'draft') THEN RAISE EXCEPTION 'DELIVERY_PACKAGE_VERSION_TRANSITION_INVALID'; END IF;
 IF NEW.status NOT IN('draft','review','approved','rejected','stale','blocked') THEN RAISE EXCEPTION 'DELIVERY_PACKAGE_STATUS_INVALID'; END IF;
 RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_handoff_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','current_version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','current_version','updated_at'])
   OR OLD.status IN('rejected','withdrawn','stale','consumed') OR NEW.current_version<>OLD.current_version+1 THEN RAISE EXCEPTION 'DELIVERY_HANDOFF_IMMUTABLE'; END IF;
 RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_package_binding_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source public.enterprise_delivery_source_packages;version public.enterprise_delivery_work_package_versions;
BEGIN
 SELECT * INTO source FROM public.enterprise_delivery_source_packages WHERE id=NEW.source_package_id AND work_package_id=NEW.id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO version FROM public.enterprise_delivery_work_package_versions WHERE id=NEW.current_version_id AND work_package_id=NEW.id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF source.id IS NULL OR version.id IS NULL OR NEW.source_package_hash<>source.package_hash OR version.version<>NEW.current_version
   OR version.source_package_id<>source.id OR version.source_package_hash<>source.package_hash
   OR (source.source_mode='manual' AND (NEW.handoff_id IS NOT NULL OR NEW.delivery_handoff_id IS NOT NULL))
   OR (source.source_mode='studio_handoff' AND source.legacy_handoff_id IS NOT NULL AND NEW.handoff_id IS DISTINCT FROM source.legacy_handoff_id)
   OR (source.source_mode='studio_handoff' AND source.delivery_handoff_id IS NOT NULL AND NEW.delivery_handoff_id IS DISTINCT FROM source.delivery_handoff_id)
 THEN RAISE EXCEPTION 'DELIVERY_PACKAGE_BINDING_INVALID'; END IF;
 RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_item_aggregate_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['current_version_id','current_version','aggregate_version','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_version_id','current_version','aggregate_version','updated_at'])
   OR NEW.current_version<>OLD.current_version+1 OR NEW.aggregate_version<>OLD.aggregate_version+1 OR NEW.current_version_id=OLD.current_version_id
 THEN RAISE EXCEPTION 'DELIVERY_ITEM_AGGREGATE_IMMUTABLE'; END IF;
 RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_item_current_binding_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE version public.enterprise_delivery_work_item_versions;decision public.enterprise_delivery_work_item_decisions;
BEGIN
 SELECT stored.* INTO version FROM public.enterprise_delivery_work_item_versions stored WHERE stored.id=NEW.current_version_id
  AND stored.item_aggregate_id=NEW.id AND stored.work_package_id=NEW.work_package_id AND stored.org_id=NEW.org_id AND stored.workspace_id=NEW.workspace_id;
 IF version.id IS NULL OR version.version<>NEW.current_version OR version.delivery_source_package_id IS NULL THEN RAISE EXCEPTION 'DELIVERY_ITEM_CURRENT_BINDING_INVALID'; END IF;
 SELECT stored.* INTO decision FROM public.enterprise_delivery_work_item_decisions stored
  WHERE stored.item_aggregate_id=NEW.id AND stored.item_version_id=NEW.current_version_id;
 IF version.status IN('accepted','rejected') THEN
  IF decision.id IS NULL OR decision.decision<>version.status OR decision.rationale<>version.rationale THEN RAISE EXCEPTION 'DELIVERY_ITEM_DECISION_BINDING_INVALID'; END IF;
 ELSIF decision.id IS NOT NULL THEN RAISE EXCEPTION 'DELIVERY_ITEM_DECISION_BINDING_INVALID'; END IF;
 RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_receipt_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status<>'claimed' OR NEW.status<>'committed'
   OR (to_jsonb(NEW)-ARRAY['status','resource_id','response','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','resource_id','response','completed_at'])
   OR NOT EXISTS(SELECT 1 FROM public.enterprise_delivery_monitor_effects effect
     JOIN public.privileged_audit_events audit ON audit.id=effect.audit_id
      AND audit.org_id=effect.org_id AND audit.workspace_id=effect.workspace_id AND audit.actor_id=effect.actor_id
      AND audit.request_id=OLD.request_id AND audit.action=effect.action AND audit.resource_type='enterprise_delivery_monitor'
      AND audit.resource_id=effect.resource_id AND audit.outcome='succeeded'
      AND audit.metadata->>'receiptId'=OLD.id::text AND audit.metadata->>'effectId'=effect.id::text
      AND audit.metadata->>'bindingHash'=OLD.binding_hash
     WHERE effect.receipt_id=OLD.id AND effect.org_id=OLD.org_id AND effect.workspace_id=OLD.workspace_id
      AND effect.actor_id=OLD.actor_id AND effect.action=OLD.action AND effect.binding_hash=OLD.binding_hash
      AND effect.execution_token=OLD.execution_token AND effect.execution_fence=OLD.execution_fence
      AND effect.resource_id=NEW.resource_id AND effect.result=NEW.response)
 THEN RAISE EXCEPTION 'DELIVERY_RECEIPT_TRANSITION_INVALID'; END IF;
 RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_reject_legacy_generic_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.resource_type IN('delivery_work_package','delivery_work_package_version','monitor_baseline')
   OR EXISTS(SELECT 1 FROM public.enterprise_delivery_work_packages package WHERE package.id=NEW.resource_id)
   OR EXISTS(SELECT 1 FROM public.enterprise_delivery_work_package_versions version WHERE version.id=NEW.resource_id)
   OR EXISTS(SELECT 1 FROM public.enterprise_monitor_baselines baseline WHERE baseline.id=NEW.resource_id AND baseline.baseline_contract='delivery-monitor-2')
 THEN RAISE EXCEPTION 'ENTERPRISE_PR_C_CANONICAL_APPROVAL_REQUIRED'; END IF;
 RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_pr_c_baseline_binding_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE baseline public.enterprise_monitor_baselines;version public.enterprise_delivery_work_item_versions;manifest jsonb;manifest_ids jsonb;
BEGIN
 IF TG_TABLE_NAME='enterprise_monitor_baseline_items' THEN
  SELECT stored.* INTO baseline FROM public.enterprise_monitor_baselines stored WHERE stored.id=NEW.baseline_id AND stored.work_package_id=NEW.work_package_id
   AND stored.work_package_version_id=NEW.work_package_version_id AND stored.org_id=NEW.org_id AND stored.workspace_id=NEW.workspace_id;
  SELECT stored.* INTO version FROM public.enterprise_delivery_work_item_versions stored WHERE stored.id=NEW.item_version_id AND stored.item_aggregate_id=NEW.item_aggregate_id
   AND stored.work_package_id=NEW.work_package_id AND stored.package_version_id=NEW.work_package_version_id AND stored.org_id=NEW.org_id AND stored.workspace_id=NEW.workspace_id;
  IF baseline.id IS NULL OR version.id IS NULL OR version.status<>'accepted' OR NEW.item_type<>version.item_type OR NEW.item_hash<>version.content_hash THEN
   RAISE EXCEPTION 'MONITOR_BASELINE_ITEM_BINDING_INVALID'; END IF;
  RETURN NULL;
 END IF;
 baseline:=NEW;
 IF baseline.baseline_contract='delivery-monitor-2' THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('itemAggregateId',item.item_aggregate_id,'itemVersionId',item.item_version_id,'itemVersion',stored_version.version,
    'itemHash',item.item_hash,'itemType',item.item_type) ORDER BY item.item_aggregate_id),'[]'::jsonb),
   COALESCE(jsonb_agg(to_jsonb(item.item_aggregate_id::text) ORDER BY item.item_aggregate_id),'[]'::jsonb)
  INTO manifest,manifest_ids FROM public.enterprise_monitor_baseline_items item
  JOIN public.enterprise_delivery_work_item_versions stored_version ON stored_version.id=item.item_version_id AND stored_version.item_aggregate_id=item.item_aggregate_id
  WHERE item.baseline_id=baseline.id AND item.work_package_id=baseline.work_package_id AND item.work_package_version_id=baseline.work_package_version_id
   AND item.org_id=baseline.org_id AND item.workspace_id=baseline.workspace_id;
  IF baseline.approved_item_ids<>manifest_ids OR baseline.accepted_item_count<>jsonb_array_length(manifest)
    OR baseline.accepted_set_hash<>public.enterprise_sha256_jsonb(jsonb_build_object('contract','delivery-accepted-set-2','acceptedItemCount',baseline.accepted_item_count,'items',manifest)) THEN
   RAISE EXCEPTION 'MONITOR_BASELINE_MANIFEST_INVALID'; END IF;
 END IF;
 RETURN NULL;
END
$$;

CREATE TRIGGER enterprise_pr_c_package_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_work_packages
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_package_guard();
CREATE CONSTRAINT TRIGGER enterprise_pr_c_package_binding
 AFTER INSERT OR UPDATE ON public.enterprise_delivery_work_packages DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_package_binding_validate();
CREATE TRIGGER enterprise_pr_c_handoff_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_handoffs
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_handoff_guard();
CREATE TRIGGER enterprise_pr_c_item_aggregate_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_work_item_aggregates
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_item_aggregate_guard();
CREATE CONSTRAINT TRIGGER enterprise_pr_c_item_current_binding AFTER INSERT OR UPDATE ON public.enterprise_delivery_work_item_aggregates
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_item_current_binding_validate();
CREATE TRIGGER enterprise_pr_c_receipt_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_monitor_command_receipts
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_receipt_guard();
CREATE TRIGGER aaa_enterprise_pr_c_legacy_review_guard BEFORE INSERT ON public.enterprise_high_impact_review_events
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_reject_legacy_generic_approval();
CREATE TRIGGER aaa_enterprise_pr_c_legacy_approval_guard BEFORE INSERT ON public.enterprise_high_impact_approvals
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_reject_legacy_generic_approval();

CREATE TRIGGER enterprise_monitor_baseline_immutable BEFORE UPDATE OR DELETE ON public.enterprise_monitor_baselines
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation();
CREATE TRIGGER enterprise_delivery_version_status_guard BEFORE UPDATE OR DELETE ON public.enterprise_delivery_work_package_versions
 FOR EACH ROW EXECUTE FUNCTION public.enterprise_status_only_guard();

DO $pr_c_immutable$
DECLARE relation_name text;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY[
  'enterprise_delivery_handoff_target_items','enterprise_delivery_handoff_versions','enterprise_delivery_handoff_review_events','enterprise_delivery_handoff_approval_events','enterprise_delivery_handoff_consumptions',
  'enterprise_delivery_source_packages','enterprise_delivery_manual_materials','enterprise_delivery_work_item_versions','enterprise_delivery_work_item_decisions',
  'enterprise_delivery_package_review_events','enterprise_delivery_package_approval_events','enterprise_delivery_package_blocker_events',
  'enterprise_delivery_monitor_command_attempts','enterprise_delivery_monitor_effects','enterprise_monitor_baseline_items'
 ] LOOP
  EXECUTE format('CREATE TRIGGER enterprise_pr_c_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enterprise_reject_mutation()',relation_name,relation_name);
 END LOOP;
END
$pr_c_immutable$;

ALTER TABLE public.enterprise_monitor_baselines ADD CONSTRAINT enterprise_monitor_baseline_scope_unique UNIQUE(id,org_id,workspace_id);
ALTER TABLE public.enterprise_monitor_baselines ADD CONSTRAINT enterprise_monitor_baseline_exact_scope_unique UNIQUE(id,work_package_id,work_package_version_id,org_id,workspace_id);
ALTER TABLE public.enterprise_monitor_baseline_items DROP CONSTRAINT enterprise_monitor_baseline_items_baseline_id_fkey;
ALTER TABLE public.enterprise_monitor_baseline_items ADD CONSTRAINT enterprise_monitor_baseline_items_scope_fk
 FOREIGN KEY(baseline_id,work_package_id,work_package_version_id,org_id,workspace_id)
 REFERENCES public.enterprise_monitor_baselines(id,work_package_id,work_package_version_id,org_id,workspace_id) ON DELETE RESTRICT;
CREATE CONSTRAINT TRIGGER enterprise_pr_c_baseline_item_binding AFTER INSERT ON public.enterprise_monitor_baseline_items
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_baseline_binding_validate();
CREATE CONSTRAINT TRIGGER enterprise_pr_c_baseline_manifest_binding AFTER INSERT ON public.enterprise_monitor_baselines
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.enterprise_pr_c_baseline_binding_validate();
ALTER TABLE public.enterprise_monitor_baselines ADD CONSTRAINT enterprise_monitor_studio_union_check CHECK(
 (studio_document_id IS NULL AND studio_version IS NULL AND studio_content_hash IS NULL)
 OR(studio_document_id IS NOT NULL AND studio_version>0 AND studio_content_hash~'^[0-9a-f]{64}$'));

DO $pr_c_rls$
DECLARE relation_name text;
BEGIN
 FOREACH relation_name IN ARRAY ARRAY[
  'enterprise_delivery_handoffs','enterprise_delivery_handoff_target_items','enterprise_delivery_handoff_versions','enterprise_delivery_handoff_review_events','enterprise_delivery_handoff_approval_events',
  'enterprise_delivery_handoff_consumptions','enterprise_delivery_source_packages','enterprise_delivery_manual_materials','enterprise_delivery_work_item_aggregates',
  'enterprise_delivery_work_item_versions','enterprise_delivery_work_item_decisions','enterprise_delivery_package_review_events','enterprise_delivery_package_approval_events',
  'enterprise_delivery_package_blocker_events','enterprise_delivery_monitor_command_receipts','enterprise_delivery_monitor_command_attempts','enterprise_delivery_monitor_effects','enterprise_monitor_baseline_items'
 ] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',relation_name);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated,service_role',relation_name);
 END LOOP;
END
$pr_c_rls$;

-- PR C cuts authenticated Delivery/Monitor reads to the two safe projections.
REVOKE ALL ON TABLE public.enterprise_studio_delivery_handoffs,public.enterprise_delivery_work_packages,
 public.enterprise_delivery_work_package_versions,public.enterprise_delivery_work_items,public.enterprise_monitor_baselines
FROM PUBLIC,anon,authenticated;

REVOKE ALL ON FUNCTION public.enterprise_delivery_monitor_command(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_delivery_monitor_command(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.enterprise_commit_delivery_handoff(jsonb,jsonb,jsonb,jsonb,uuid,uuid,bigint,jsonb),
 public.enterprise_commit_monitor_baseline(jsonb,uuid,uuid,uuid,uuid,uuid,bigint,jsonb),
 public.enterprise_delivery_package_projection(uuid,uuid,uuid),public.enterprise_monitor_projection(uuid,uuid,uuid)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.enterprise_delivery_workspace_projection(uuid,uuid,jsonb),public.enterprise_monitor_approved_baselines_projection(uuid,uuid,jsonb)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_delivery_workspace_projection(uuid,uuid,jsonb),public.enterprise_monitor_approved_baselines_projection(uuid,uuid,jsonb)
 TO authenticated,service_role;

REVOKE ALL ON FUNCTION
 public.enterprise_pr_c_delivery_source_current(uuid,uuid,uuid,boolean),public.enterprise_pr_c_handoff_source_current(uuid,uuid),public.enterprise_pr_c_accepted_item_manifest(uuid,uuid,uuid,boolean),
 public.enterprise_pr_c_assert_package_resolved(uuid,uuid,uuid),public.enterprise_pr_c_item_json_safe(jsonb),
 public.enterprise_pr_c_text_array_safe(jsonb,integer,integer),
 public.enterprise_pr_c_append_initial_items(uuid,uuid,uuid,uuid,uuid,jsonb,public.enterprise_delivery_source_packages),
 public.enterprise_pr_c_package_guard(),public.enterprise_pr_c_handoff_guard(),public.enterprise_pr_c_package_binding_validate(),
 public.enterprise_pr_c_item_aggregate_guard(),public.enterprise_pr_c_item_current_binding_validate(),public.enterprise_pr_c_receipt_guard(),
 public.enterprise_pr_c_baseline_binding_validate()
FROM PUBLIC,anon,authenticated,service_role;

COMMENT ON TABLE public.enterprise_delivery_source_packages IS 'PR C immutable exclusive-union Delivery source authority. Manual sources are durably not_assessed and planning_only.';
COMMENT ON TABLE public.enterprise_monitor_baseline_items IS 'PR C exact relational accepted-item manifest for immutable read-only Monitor baselines.';
COMMENT ON FUNCTION public.enterprise_delivery_monitor_command(jsonb) IS 'Service-only PR C transactional command, idempotency, execution-fence, effect, and canonical-result authority.';

-- Repository migration-chain convergence only; not hosted/deployment proof.
ALTER TABLE public.hosted_pilot_environment_identity DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity SET migration_tip='20260831062024' WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check CHECK(migration_tip='20260831062024');
