-- Governed multi-source transcript PR B: independent Studio sources,
-- immutable templates, optional Assess handoffs, and fenced generation.
--
-- Rollback is default-off mutation disablement/read-only operation. Durable
-- records are never destructively rewritten; corrections are additive.

-- Fail before the first mutation when accepted Studio ancestry cannot support
-- an exact assess_handoff package. The surrounding migration transaction makes
-- every later failure atomic as well.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.studio_artifact_aggregates artifact
    LEFT JOIN public.assess_v2_studio_handoffs handoff
      ON handoff.id=artifact.handoff_id
     AND handoff.org_id=artifact.org_id
     AND handoff.workspace_id=artifact.workspace_id
     AND handoff.case_id=artifact.case_id
     AND handoff.decision_id=artifact.decision_id
    LEFT JOIN public.assess_v2_case_versions source_version
      ON source_version.id=artifact.source_version_id
     AND source_version.case_id=artifact.case_id
     AND source_version.workspace_id=artifact.workspace_id
     AND source_version.org_id=artifact.org_id
    LEFT JOIN public.assess_v2_review_resolutions review_resolution
      ON review_resolution.id=artifact.review_resolution_id
     AND review_resolution.case_id=artifact.case_id
     AND review_resolution.decision_id=artifact.decision_id
     AND review_resolution.workspace_id=artifact.workspace_id
     AND review_resolution.org_id=artifact.org_id
    LEFT JOIN public.assess_v2_govern_resolutions govern_resolution
      ON govern_resolution.id=artifact.govern_resolution_id
     AND govern_resolution.case_id=artifact.case_id
     AND govern_resolution.decision_id=artifact.decision_id
     AND govern_resolution.workspace_id=artifact.workspace_id
     AND govern_resolution.org_id=artifact.org_id
    WHERE handoff.id IS NULL OR source_version.id IS NULL
       OR review_resolution.id IS NULL OR govern_resolution.id IS NULL
       OR artifact.source_package_hash IS DISTINCT FROM handoff.package_hash
       OR artifact.source_case_version IS DISTINCT FROM handoff.source_case_version
       OR artifact.decision_version IS DISTINCT FROM handoff.decision_version
       OR artifact.review_schema_version IS DISTINCT FROM handoff.review_schema_version
       OR artifact.review_sequence IS DISTINCT FROM handoff.review_sequence
       OR artifact.source_version_id IS DISTINCT FROM handoff.source_version_id
       OR artifact.review_resolution_id IS DISTINCT FROM handoff.review_resolution_id
       OR artifact.govern_resolution_id IS DISTINCT FROM handoff.govern_resolution_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE='STUDIO_PR_B_BACKFILL_REVIEW_REQUIRED';
  END IF;
END
$$;

INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('studio.sources.read','docs','Read safe Studio-owned source-set and input-bundle projections'),
 ('studio.sources.manage','docs','Create immutable Studio-owned source-set and input-bundle versions'),
 ('studio.templates.read','docs','Read safe governed tenant-template projections'),
 ('studio.templates.manage','docs','Create and revise governed tenant templates'),
 ('studio.templates.review','docs','Independently review governed tenant templates'),
 ('studio.templates.approve','docs','Independently approve, reject, or deprecate governed tenant templates'),
 ('studio.handoffs.read','docs','Read safe Assess to Studio handoff projections'),
 ('studio.handoffs.request','docs','Request or withdraw an optional Assess to Studio handoff'),
 ('studio.handoffs.review','docs','Independently review an optional Assess to Studio handoff'),
 ('studio.handoffs.approve','docs','Independently approve or reject an optional Assess to Studio handoff'),
 ('studio.handoffs.consume','docs','Accept an approved handoff into exactly one Studio artifact')
ON CONFLICT(capability_key) DO UPDATE
SET module=excluded.module,description=excluded.description;

CREATE UNIQUE INDEX assess_v2_studio_handoff_pr_b_tenant_key
 ON public.assess_v2_studio_handoffs(id,org_id,workspace_id);

ALTER TABLE public.enterprise_transcript_workspace_flags
  ADD COLUMN studio_multisource_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN studio_tenant_templates_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN module_handoffs_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN direct_studio_planning_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.studio_pr_b_json_structure_safe(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE entry record;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) NOT IN('object','array') OR pg_column_size(value)>262144 THEN
    RETURN false;
  END IF;
  IF value::text~*'https?://' THEN RETURN false;END IF;
  IF jsonb_typeof(value)='object' THEN
    FOR entry IN SELECT key,val FROM jsonb_each(value) AS item(key,val) LOOP
      IF entry.key~*'(system.?instruction|provider|endpoint|tool|header|secret|api.?key|authorization|credential|model.?route|prompt)' THEN
        RETURN false;
      END IF;
      IF jsonb_typeof(entry.val) IN('object','array') AND NOT public.studio_pr_b_json_structure_safe(entry.val) THEN
        RETURN false;
      END IF;
    END LOOP;
  ELSE
    FOR entry IN SELECT NULL::text AS key,val FROM jsonb_array_elements(value) AS item(val) LOOP
      IF jsonb_typeof(entry.val) IN('object','array') AND NOT public.studio_pr_b_json_structure_safe(entry.val) THEN
        RETURN false;
      END IF;
    END LOOP;
  END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_deterministic_uuid(namespace text, identity uuid)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT (
   substr(md5(namespace||':'||identity::text),1,8)||'-'||
   substr(md5(namespace||':'||identity::text),9,4)||'-4'||
   substr(md5(namespace||':'||identity::text),14,3)||'-8'||
   substr(md5(namespace||':'||identity::text),18,3)||'-'||
   substr(md5(namespace||':'||identity::text),21,12)
 )::uuid
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_template_sections_safe(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(value)='array' AND jsonb_array_length(value) BETWEEN 1 AND 100
  AND public.studio_pr_b_json_structure_safe(value)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(value) AS sections(section)
   WHERE jsonb_typeof(section)<>'object' OR NOT(section?&ARRAY['id','title','required','fieldKind'])
    OR(section-ARRAY['id','title','required','fieldKind'])<>'{}'::jsonb
    OR length(btrim(COALESCE(section->>'id',''))) NOT BETWEEN 1 AND 80
    OR length(btrim(COALESCE(section->>'title',''))) NOT BETWEEN 1 AND 160
    OR jsonb_typeof(section->'required')<>'boolean'
    OR section->>'fieldKind' NOT IN('narrative','requirements','rules','controls','risks','interfaces','acceptance_criteria'))
  AND(SELECT count(DISTINCT section->>'id') FROM jsonb_array_elements(value) AS sections(section))=jsonb_array_length(value)
$$;

CREATE TABLE public.studio_tenant_template_aggregates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 workspace_id uuid NOT NULL,
 safe_name text NOT NULL CHECK(length(btrim(safe_name)) BETWEEN 1 AND 160),
 safe_description text NOT NULL DEFAULT '' CHECK(length(safe_description)<=2000),
 artifact_class text NOT NULL CHECK(artifact_class IN('brd','frd','pdd','custom')),
 current_version bigint NOT NULL DEFAULT 0 CHECK(current_version>=0),
 current_version_id uuid,
 current_approved_version_id uuid,
 lifecycle text NOT NULL DEFAULT 'draft' CHECK(lifecycle IN('draft','reviewer_ready','in_review','changes_requested','rejected','approval_ready','approved','deprecated','replaced')),
 lifecycle_version bigint NOT NULL DEFAULT 1 CHECK(lifecycle_version>0),
 created_by uuid NOT NULL REFERENCES public.profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,org_id,workspace_id),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.studio_tenant_template_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),parent_version_id uuid,
 artifact_class text NOT NULL CHECK(artifact_class IN('brd','frd','pdd','custom')),
 section_definitions jsonb NOT NULL CHECK(public.studio_pr_b_template_sections_safe(section_definitions)),
 field_schema jsonb NOT NULL CHECK(jsonb_typeof(field_schema)='object' AND public.studio_pr_b_json_structure_safe(field_schema)),
 renderer_compatibility_version text NOT NULL CHECK(length(btrim(renderer_compatibility_version)) BETWEEN 1 AND 80),
 content_schema_version text NOT NULL CHECK(length(btrim(content_schema_version)) BETWEEN 1 AND 80),
 template_hash text NOT NULL CHECK(template_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('draft','reviewer_ready','in_review','changes_requested','rejected','approval_ready','approved','deprecated','replaced')),
 authored_by uuid NOT NULL REFERENCES public.profiles(id),author_authorization_version bigint NOT NULL CHECK(author_authorization_version>0),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,template_id,org_id,workspace_id),UNIQUE(id,org_id,workspace_id),UNIQUE(template_id,version),UNIQUE(template_id,template_hash),
 FOREIGN KEY(template_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(parent_version_id,template_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_versions(id,template_id,org_id,workspace_id) ON DELETE RESTRICT
);

ALTER TABLE public.studio_tenant_template_aggregates
 ADD CONSTRAINT studio_tenant_template_current_fk FOREIGN KEY(current_version_id,id,org_id,workspace_id)
 REFERENCES public.studio_tenant_template_versions(id,template_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT studio_tenant_template_approved_fk FOREIGN KEY(current_approved_version_id,id,org_id,workspace_id)
 REFERENCES public.studio_tenant_template_versions(id,template_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.studio_tenant_template_review_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid NOT NULL,template_version_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL CHECK(reviewer_authorization_version>0),
 outcome text NOT NULL CHECK(outcome IN('approved','changes_requested','rejected')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),conditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(conditions)='array' AND public.studio_pr_b_json_structure_safe(conditions)),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_version_id),UNIQUE(id,template_id,template_version_id,org_id,workspace_id),
 FOREIGN KEY(template_version_id,template_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_versions(id,template_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_tenant_template_approval_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),template_id uuid NOT NULL,template_version_id uuid NOT NULL,review_event_id uuid NOT NULL,
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 approver_id uuid NOT NULL REFERENCES public.profiles(id),approver_authorization_version bigint NOT NULL CHECK(approver_authorization_version>0),
 outcome text NOT NULL CHECK(outcome IN('approved','rejected','deprecated','replaced')),
 rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),conditions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(conditions)='array' AND public.studio_pr_b_json_structure_safe(conditions)),replacement_template_id uuid,replacement_version_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_version_id,outcome),UNIQUE(id,template_id,template_version_id,org_id,workspace_id),
 FOREIGN KEY(review_event_id,template_id,template_version_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_review_events(id,template_id,template_version_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(replacement_version_id,replacement_template_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_versions(id,template_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((outcome='replaced' AND replacement_version_id IS NOT NULL AND replacement_template_id IS NOT NULL)
    OR(outcome<>'replaced' AND replacement_version_id IS NULL AND replacement_template_id IS NULL))
);

CREATE TABLE public.studio_tenant_template_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 command_type text NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),request_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('claimed','committed','failed')),resource_id uuid,response jsonb,failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(org_id,actor_id,command_type,idempotency_key),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

CREATE TABLE public.enterprise_module_handoffs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 from_module text NOT NULL CHECK(from_module='assess'),to_module text NOT NULL CHECK(to_module='studio'),
 upstream_handoff_id uuid NOT NULL,upstream_version bigint NOT NULL DEFAULT 1 CHECK(upstream_version=1),upstream_package_hash text NOT NULL CHECK(upstream_package_hash~'^[0-9a-f]{64}$'),
 target_input_bundle_id uuid,target_input_bundle_version_id uuid,target_input_bundle_version bigint,target_input_bundle_hash text,
 artifact_type text NOT NULL CHECK(artifact_type IN('brd','frd','pdd')),
 lineage_classification text NOT NULL CHECK(lineage_classification IN('assessed','mixed')),
 planning_only boolean NOT NULL CHECK(NOT planning_only),route_policy_version bigint NOT NULL CHECK(route_policy_version>0),
 route_policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(route_policy_snapshot)='object' AND pg_column_size(route_policy_snapshot)<=65536),
 route_policy_hash text NOT NULL CHECK(route_policy_hash~'^[0-9a-f]{64}$'),target_package_hash text NOT NULL CHECK(target_package_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('requested','target_review','changes_requested','rejected','approval_ready','approved','withdrawn','stale','expired','consumed')),
 current_version bigint NOT NULL DEFAULT 1 CHECK(current_version>0),requested_by uuid NOT NULL REFERENCES public.profiles(id),requested_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),CHECK(expires_at>requested_at),
 UNIQUE(id,org_id,workspace_id),UNIQUE(org_id,workspace_id,upstream_handoff_id,target_package_hash),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE,
 FOREIGN KEY(upstream_handoff_id,org_id,workspace_id) REFERENCES public.assess_v2_studio_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(target_input_bundle_version_id,target_input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK((target_input_bundle_id IS NULL AND target_input_bundle_version_id IS NULL AND target_input_bundle_version IS NULL AND target_input_bundle_hash IS NULL)
    OR (target_input_bundle_id IS NOT NULL AND target_input_bundle_version_id IS NOT NULL AND target_input_bundle_version>0 AND target_input_bundle_hash~'^[0-9a-f]{64}$')),
 CHECK((lineage_classification='mixed')=(target_input_bundle_version_id IS NOT NULL))
);

CREATE TABLE public.enterprise_module_handoff_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),status text NOT NULL CHECK(status IN('requested','target_review','changes_requested','rejected','approval_ready','approved','withdrawn','stale','expired','consumed')),
 actor_id uuid NOT NULL REFERENCES public.profiles(id),actor_authorization_version bigint NOT NULL CHECK(actor_authorization_version>0),
 reason text CHECK(reason IS NULL OR length(reason)<=4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,handoff_id,org_id,workspace_id),UNIQUE(handoff_id,version),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_module_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_module_handoff_review_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES public.profiles(id),reviewer_authorization_version bigint NOT NULL CHECK(reviewer_authorization_version>0),
 outcome text NOT NULL CHECK(outcome IN('approved','changes_requested','rejected')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id),UNIQUE(id,handoff_id,org_id,workspace_id),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_module_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_module_handoff_approval_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL,review_event_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 approver_id uuid NOT NULL REFERENCES public.profiles(id),approver_authorization_version bigint NOT NULL CHECK(approver_authorization_version>0),
 outcome text NOT NULL CHECK(outcome IN('approved','rejected')),rationale text NOT NULL CHECK(length(btrim(rationale)) BETWEEN 1 AND 4000),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id),UNIQUE(id,handoff_id,org_id,workspace_id),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_module_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(review_event_id,handoff_id,org_id,workspace_id) REFERENCES public.enterprise_module_handoff_review_events(id,handoff_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_module_handoff_command_receipts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,workspace_id uuid NOT NULL,actor_id uuid NOT NULL REFERENCES public.profiles(id),
 command_type text NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),request_id uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN('claimed','committed','failed')),resource_id uuid,response jsonb,failure_code text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(org_id,actor_id,command_type,idempotency_key),
 FOREIGN KEY(workspace_id,org_id) REFERENCES public.workspaces(id,org_id) ON DELETE CASCADE
);

-- Source packages are immutable and versioned. The aggregate points at the
-- currently selected package; every attempt/version copies its exact binding.
CREATE TABLE public.studio_artifact_source_packages(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),artifact_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 version bigint NOT NULL CHECK(version>0),replaces_source_package_id uuid,
 source_mode text NOT NULL CHECK(source_mode IN('assess_handoff','direct_transcript_bundle','assess_plus_transcript_bundle','manual_brief')),
 assess_handoff_id uuid,assess_package_hash text,
 studio_input_bundle_id uuid,studio_input_bundle_version_id uuid,studio_input_bundle_version bigint,studio_bundle_hash text,
 manual_brief_hash text,
 lineage_classification text NOT NULL CHECK(lineage_classification IN('assessed','not_assessed','mixed')),
 planning_only boolean NOT NULL,route_policy_version bigint NOT NULL CHECK(route_policy_version>0),
 route_policy_snapshot jsonb NOT NULL CHECK(jsonb_typeof(route_policy_snapshot)='object' AND pg_column_size(route_policy_snapshot)<=65536),
 route_policy_hash text NOT NULL CHECK(route_policy_hash~'^[0-9a-f]{64}$'),package_hash text NOT NULL CHECK(package_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,artifact_id,org_id,workspace_id),UNIQUE(artifact_id,version),UNIQUE(artifact_id,package_hash),
 FOREIGN KEY(artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(replaces_source_package_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(assess_handoff_id,org_id,workspace_id) REFERENCES public.assess_v2_studio_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(studio_input_bundle_version_id,studio_input_bundle_id,org_id,workspace_id) REFERENCES public.enterprise_module_input_bundle_versions(id,input_bundle_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(
   (source_mode='assess_handoff' AND assess_handoff_id IS NOT NULL AND assess_package_hash~'^[0-9a-f]{64}$' AND studio_input_bundle_id IS NULL AND studio_input_bundle_version_id IS NULL AND studio_input_bundle_version IS NULL AND studio_bundle_hash IS NULL AND manual_brief_hash IS NULL AND lineage_classification='assessed' AND NOT planning_only)
 OR(source_mode='direct_transcript_bundle' AND assess_handoff_id IS NULL AND assess_package_hash IS NULL AND studio_input_bundle_id IS NOT NULL AND studio_input_bundle_version_id IS NOT NULL AND studio_input_bundle_version>0 AND studio_bundle_hash~'^[0-9a-f]{64}$' AND manual_brief_hash IS NULL AND lineage_classification='not_assessed' AND planning_only)
 OR(source_mode='assess_plus_transcript_bundle' AND assess_handoff_id IS NOT NULL AND assess_package_hash~'^[0-9a-f]{64}$' AND studio_input_bundle_id IS NOT NULL AND studio_input_bundle_version_id IS NOT NULL AND studio_input_bundle_version>0 AND studio_bundle_hash~'^[0-9a-f]{64}$' AND manual_brief_hash IS NULL AND lineage_classification='mixed' AND NOT planning_only)
 OR(source_mode='manual_brief' AND assess_handoff_id IS NULL AND assess_package_hash IS NULL AND studio_input_bundle_id IS NULL AND studio_input_bundle_version_id IS NULL AND studio_input_bundle_version IS NULL AND studio_bundle_hash IS NULL AND manual_brief_hash~'^[0-9a-f]{64}$' AND lineage_classification='not_assessed' AND planning_only)
 )
);

CREATE TABLE public.studio_artifact_manual_brief_materials(
 source_package_id uuid PRIMARY KEY,artifact_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 manual_brief text NOT NULL CHECK(length(manual_brief) BETWEEN 1 AND 20000),manual_brief_hash text NOT NULL CHECK(manual_brief_hash~'^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_package_id,artifact_id,org_id,workspace_id),
 FOREIGN KEY(source_package_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 CHECK(manual_brief_hash=encode(public.digest(convert_to(manual_brief,'UTF8'),'sha256'),'hex'))
);

ALTER TABLE public.studio_artifact_aggregates
 ADD COLUMN source_package_id uuid,
 ADD COLUMN source_mode text,
 ADD COLUMN lineage_classification text,
 ADD COLUMN planning_only boolean,
 ALTER COLUMN case_id DROP NOT NULL,
 ALTER COLUMN source_version_id DROP NOT NULL,
 ALTER COLUMN source_case_version DROP NOT NULL,
 ALTER COLUMN decision_id DROP NOT NULL,
 ALTER COLUMN decision_version DROP NOT NULL,
 ALTER COLUMN review_resolution_id DROP NOT NULL,
 ALTER COLUMN govern_resolution_id DROP NOT NULL,
 ALTER COLUMN handoff_id DROP NOT NULL;

INSERT INTO public.studio_artifact_source_packages(
 id,artifact_id,org_id,workspace_id,version,source_mode,assess_handoff_id,assess_package_hash,
 lineage_classification,planning_only,route_policy_version,route_policy_snapshot,route_policy_hash,package_hash,created_by,created_at
)
SELECT public.studio_pr_b_deterministic_uuid('legacy-assess-source-package',artifact.id),artifact.id,artifact.org_id,artifact.workspace_id,1,
 'assess_handoff',artifact.handoff_id,artifact.source_package_hash,'assessed',false,1,
 jsonb_build_object('policy','accepted_assess_handoff','version',1,'migrationBackfill',true),
 public.enterprise_sha256_jsonb(jsonb_build_object('policy','accepted_assess_handoff','version',1,'migrationBackfill',true)),
 artifact.source_package_hash,artifact.created_by,artifact.created_at
FROM public.studio_artifact_aggregates artifact;

UPDATE public.studio_artifact_aggregates artifact
SET source_package_id=package.id,source_mode=package.source_mode,lineage_classification=package.lineage_classification,planning_only=package.planning_only
FROM public.studio_artifact_source_packages package
WHERE package.artifact_id=artifact.id AND package.org_id=artifact.org_id AND package.workspace_id=artifact.workspace_id AND package.version=1;

ALTER TABLE public.studio_artifact_aggregates
 ALTER COLUMN source_package_id SET NOT NULL,
 ALTER COLUMN source_mode SET NOT NULL,
 ALTER COLUMN lineage_classification SET NOT NULL,
 ALTER COLUMN planning_only SET NOT NULL,
 ADD CONSTRAINT studio_artifact_source_package_fk
 FOREIGN KEY(source_package_id,id,org_id,workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) DEFERRABLE INITIALLY DEFERRED,
 ADD CONSTRAINT studio_artifact_source_mode_check CHECK(source_mode IN('assess_handoff','direct_transcript_bundle','assess_plus_transcript_bundle','manual_brief')),
 ADD CONSTRAINT studio_artifact_lineage_check CHECK(lineage_classification IN('assessed','not_assessed','mixed')),
 ADD CONSTRAINT studio_artifact_legacy_ancestry_union_check CHECK(
   (source_mode IN('assess_handoff','assess_plus_transcript_bundle') AND case_id IS NOT NULL AND source_version_id IS NOT NULL AND source_case_version IS NOT NULL AND decision_id IS NOT NULL AND decision_version IS NOT NULL AND review_resolution_id IS NOT NULL AND govern_resolution_id IS NOT NULL AND handoff_id IS NOT NULL)
 OR(source_mode IN('direct_transcript_bundle','manual_brief') AND case_id IS NULL AND source_version_id IS NULL AND source_case_version IS NULL AND decision_id IS NULL AND decision_version IS NULL AND review_resolution_id IS NULL AND govern_resolution_id IS NULL AND handoff_id IS NULL)
 );

-- Historical attempts and versions copy the exact package and template
-- identities. Tenant versions may be selected only by new PR B paths.
ALTER TABLE public.studio_artifact_generation_attempts
 ADD COLUMN source_package_id uuid,
 ADD COLUMN source_package_hash text,
 ADD COLUMN template_kind text,
 ADD COLUMN tenant_template_version_id uuid,
 ADD COLUMN template_version text,
 ADD COLUMN template_hash text,
 ADD COLUMN expected_aggregate_version bigint,
 ADD COLUMN expected_current_version_id uuid,
 ADD COLUMN expected_approved_version_id uuid,
 ADD COLUMN requester_authorization_version bigint,
 ADD COLUMN provider_plan_state text NOT NULL DEFAULT 'legacy_unverified',
 ADD COLUMN provider_route_id uuid,
 ADD COLUMN provider_config_id uuid,
 ADD COLUMN provider_name text,
 ADD COLUMN provider_model text,
 ADD COLUMN prompt_key text,
 ADD COLUMN prompt_version text,
 ADD COLUMN provider_plan_hash text,
 ADD COLUMN execution_token uuid,
 ADD COLUMN execution_fence bigint NOT NULL DEFAULT 0 CHECK(execution_fence>=0),
 ADD COLUMN execution_lease_expires_at timestamptz,
 ADD COLUMN provider_effect_key text,
 ADD COLUMN response_hash text,
 ADD COLUMN cancellation_requested_at timestamptz,
 ADD COLUMN timeout_at timestamptz,
 ADD COLUMN stale_completion boolean NOT NULL DEFAULT false,
 ALTER COLUMN handoff_id DROP NOT NULL,
 ALTER COLUMN template_id DROP NOT NULL;

UPDATE public.studio_artifact_generation_attempts attempt
SET source_package_id=artifact.source_package_id,source_package_hash=artifact.source_package_hash,
    template_kind='system',template_version=template.template_version,template_hash=template.template_hash,
    expected_aggregate_version=artifact.aggregate_version,
    expected_current_version_id=artifact.current_version_id,expected_approved_version_id=artifact.current_approved_version_id,
    requester_authorization_version=(SELECT authority.version FROM public.authorization_versions authority WHERE authority.org_id=attempt.org_id AND authority.user_id=attempt.requested_by),
    provider_effect_key=encode(public.digest('studio-generation:'||attempt.id::text,'sha256'),'hex')
FROM public.studio_artifact_aggregates artifact,public.studio_system_template_versions template
WHERE artifact.id=attempt.artifact_id AND artifact.org_id=attempt.org_id AND artifact.workspace_id=attempt.workspace_id AND template.id=attempt.template_id;

ALTER TABLE public.studio_artifact_generation_attempts
 ALTER COLUMN source_package_id SET NOT NULL,ALTER COLUMN source_package_hash SET NOT NULL,ALTER COLUMN template_kind SET NOT NULL,
 ALTER COLUMN template_version SET NOT NULL,ALTER COLUMN template_hash SET NOT NULL,ALTER COLUMN expected_aggregate_version SET NOT NULL,
 ALTER COLUMN requester_authorization_version SET NOT NULL,ALTER COLUMN provider_effect_key SET NOT NULL,
 ADD CONSTRAINT studio_generation_requester_authorization_check CHECK(requester_authorization_version>0),
 ADD CONSTRAINT studio_generation_provider_plan_check CHECK(
  (provider_plan_state='legacy_unverified' AND provider_route_id IS NULL AND provider_config_id IS NULL AND provider_name IS NULL AND provider_model IS NULL AND prompt_key IS NULL AND prompt_version IS NULL AND provider_plan_hash IS NULL)
  OR(provider_plan_state='bound' AND provider_route_id IS NOT NULL AND provider_config_id IS NOT NULL AND provider_name IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    AND length(btrim(provider_model)) BETWEEN 1 AND 200 AND prompt_key='studio-multisource-generation' AND prompt_version='studio-pr-b-1' AND provider_plan_hash~'^[0-9a-f]{64}$')
 ),
 ADD CONSTRAINT studio_generation_source_package_hash_check CHECK(source_package_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT studio_generation_template_kind_check CHECK(template_kind IN('system','tenant')),
 ADD CONSTRAINT studio_generation_template_hash_check CHECK(template_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT studio_generation_template_union_check CHECK((template_kind='system' AND template_id IS NOT NULL AND tenant_template_version_id IS NULL) OR(template_kind='tenant' AND template_id IS NULL AND tenant_template_version_id IS NOT NULL)),
 ADD CONSTRAINT studio_generation_source_package_fk FOREIGN KEY(source_package_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_generation_provider_route_fk FOREIGN KEY(provider_route_id,org_id,workspace_id) REFERENCES public.enterprise_ai_capability_routes(id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_generation_provider_config_fk FOREIGN KEY(provider_config_id,org_id) REFERENCES public.ai_provider_configs(id,org_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_generation_tenant_template_fk FOREIGN KEY(tenant_template_version_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_versions(id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_generation_expected_current_fk FOREIGN KEY(expected_current_version_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_generation_expected_approved_fk FOREIGN KEY(expected_approved_version_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_versions(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_generation_provider_effect_unique UNIQUE(org_id,workspace_id,provider_effect_key);

ALTER TABLE public.studio_artifact_generation_attempts DROP CONSTRAINT studio_artifact_generation_attempts_state_check;
ALTER TABLE public.studio_artifact_generation_attempts ADD CONSTRAINT studio_artifact_generation_attempts_state_check
 CHECK(state IN('requested','claimed','generating','response_staged','reconciling','completed','stale_completed','failed','cancel_requested','cancelled','timed_out'));
DROP INDEX public.studio_one_active_generation_attempt;
CREATE UNIQUE INDEX studio_one_active_generation_attempt ON public.studio_artifact_generation_attempts(artifact_id)
 WHERE state IN('requested','claimed','generating','response_staged','reconciling','cancel_requested');

ALTER TABLE public.studio_artifact_versions
 ADD COLUMN source_package_id uuid,
 ADD COLUMN source_package_hash text,
 ADD COLUMN template_kind text,
 ADD COLUMN tenant_template_version_id uuid,
 ADD COLUMN template_version text,
 ADD COLUMN template_hash text,
 ADD COLUMN is_stale_completion boolean NOT NULL DEFAULT false,
 ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.studio_artifact_versions DISABLE TRIGGER trg_studio_artifact_version_content_immutable;
UPDATE public.studio_artifact_versions version
SET source_package_id=artifact.source_package_id,source_package_hash=artifact.source_package_hash,
    template_kind='system',template_version=template.template_version,template_hash=template.template_hash
FROM public.studio_artifact_aggregates artifact,public.studio_system_template_versions template
WHERE artifact.id=version.artifact_id AND artifact.org_id=version.org_id AND artifact.workspace_id=version.workspace_id AND template.id=version.template_id;
ALTER TABLE public.studio_artifact_versions ENABLE TRIGGER trg_studio_artifact_version_content_immutable;

ALTER TABLE public.studio_artifact_versions
 ALTER COLUMN source_package_id SET NOT NULL,ALTER COLUMN source_package_hash SET NOT NULL,ALTER COLUMN template_kind SET NOT NULL,
 ALTER COLUMN template_version SET NOT NULL,ALTER COLUMN template_hash SET NOT NULL,
 ADD CONSTRAINT studio_version_source_package_hash_check CHECK(source_package_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT studio_version_template_kind_check CHECK(template_kind IN('system','tenant')),
 ADD CONSTRAINT studio_version_template_hash_check CHECK(template_hash~'^[0-9a-f]{64}$'),
 ADD CONSTRAINT studio_version_template_union_check CHECK((template_kind='system' AND template_id IS NOT NULL AND tenant_template_version_id IS NULL) OR(template_kind='tenant' AND template_id IS NULL AND tenant_template_version_id IS NOT NULL)),
 ADD CONSTRAINT studio_version_source_package_fk FOREIGN KEY(source_package_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT,
 ADD CONSTRAINT studio_version_tenant_template_fk FOREIGN KEY(tenant_template_version_id,org_id,workspace_id) REFERENCES public.studio_tenant_template_versions(id,org_id,workspace_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX studio_one_version_per_generation_attempt
 ON public.studio_artifact_versions(generation_attempt_id) WHERE generation_attempt_id IS NOT NULL;

CREATE TABLE public.studio_generation_staged_responses(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL,artifact_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 execution_token uuid NOT NULL,execution_fence bigint NOT NULL CHECK(execution_fence>0),provider_operation_id text CHECK(provider_operation_id IS NULL OR length(provider_operation_id)<=200),
 response_content jsonb NOT NULL CHECK(jsonb_typeof(response_content)='object' AND pg_column_size(response_content)<=1048576),response_hash text NOT NULL CHECK(response_hash~'^[0-9a-f]{64}$'),
 schema_status text NOT NULL CHECK(schema_status IN('validated','invalid')),staged_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(attempt_id),UNIQUE(org_id,workspace_id,response_hash,attempt_id),
 FOREIGN KEY(attempt_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_generation_attempts(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.studio_generation_recovery_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),attempt_id uuid NOT NULL,artifact_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 execution_fence bigint NOT NULL CHECK(execution_fence>=0),event_type text NOT NULL CHECK(event_type IN('lease_claimed','response_staged','response_replayed','reconciliation_claimed','cancel_requested','cancelled','timed_out','completed','stale_completed','failed')),
 failure_code text CHECK(failure_code IS NULL OR failure_code~'^[A-Z0-9_]{1,64}$'),audit_event_id uuid,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,attempt_id,org_id,workspace_id),
 FOREIGN KEY(attempt_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_generation_attempts(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE TABLE public.enterprise_module_handoff_consumptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),handoff_id uuid NOT NULL,org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,workspace_id uuid NOT NULL,
 artifact_id uuid NOT NULL,source_package_id uuid NOT NULL,source_package_hash text NOT NULL CHECK(source_package_hash~'^[0-9a-f]{64}$'),
 consumed_by uuid NOT NULL REFERENCES public.profiles(id),consumer_authorization_version bigint NOT NULL CHECK(consumer_authorization_version>0),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(handoff_id),UNIQUE(artifact_id),UNIQUE(id,handoff_id,org_id,workspace_id),
 FOREIGN KEY(handoff_id,org_id,workspace_id) REFERENCES public.enterprise_module_handoffs(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_aggregates(id,org_id,workspace_id) ON DELETE RESTRICT,
 FOREIGN KEY(source_package_id,artifact_id,org_id,workspace_id) REFERENCES public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION public.enterprise_transcript_assert_module_receipt(
 p_receipt uuid,p_actor uuid,p_org uuid,p_workspace uuid,p_command text,p_owner_module text,
 p_authorization_version bigint,p_execution_token uuid,p_execution_fence bigint
) RETURNS public.enterprise_ai_command_receipts LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;flags public.enterprise_transcript_workspace_flags;capability text;enabled boolean;
BEGIN
 IF p_owner_module NOT IN('assess','studio') THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_MODULE';END IF;
 capability:=CASE p_owner_module WHEN 'assess' THEN 'transcript.sources.manage' ELSE 'studio.sources.manage' END;
 SELECT * INTO receipt FROM public.enterprise_ai_command_receipts
 WHERE id=p_receipt AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF receipt.id IS NULL OR receipt.status<>'claimed' OR receipt.actor_id IS DISTINCT FROM p_actor
    OR receipt.command_type IS DISTINCT FROM p_command OR receipt.execution_token IS DISTINCT FROM p_execution_token
    OR receipt.execution_fence IS DISTINCT FROM p_execution_fence THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_STALE_EXECUTION_FENCE';
 END IF;
 PERFORM public.enterprise_assert_writable('ingestion');
 PERFORM public.pr1b_assert_command_authority(p_actor,p_org,p_workspace,capability,p_authorization_version);
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 enabled:=CASE p_owner_module WHEN 'assess' THEN flags.transcript_source_sets_enabled ELSE flags.studio_multisource_enabled END;
 IF flags.org_id IS NULL OR NOT COALESCE(enabled,false) THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_FEATURE_DISABLED';END IF;
 RETURN receipt;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_source_set_version_v2(
 p_source_set uuid,p_owner_module text,p_display_label text,p_description text,p_purpose text,p_items jsonb,p_lock boolean,p_expected_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;source_set public.enterprise_source_sets;set_version public.enterprise_source_set_versions;
 item jsonb;source_version public.enterprise_evidence_source_versions;source public.enterprise_evidence_sources;
 actual_count integer;total_chars bigint:=0;manifest jsonb:='[]'::jsonb;manifest_hash text;result jsonb;
BEGIN
 receipt:=public.enterprise_transcript_assert_module_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.source-set.create-version',p_owner_module,p_authorization_version,p_execution_token,p_execution_fence);
 IF p_owner_module NOT IN('assess','studio') OR length(btrim(COALESCE(p_display_label,''))) NOT BETWEEN 1 AND 160
    OR length(COALESCE(p_description,''))>2000 OR length(btrim(COALESCE(p_purpose,''))) NOT BETWEEN 1 AND 1000
    OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 OR p_expected_version<0 THEN
  RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_SOURCE_SET';
 END IF;
 SELECT * INTO source_set FROM public.enterprise_source_sets WHERE id=p_source_set FOR UPDATE;
 IF source_set.id IS NULL THEN
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';END IF;
  INSERT INTO public.enterprise_source_sets(id,org_id,workspace_id,owner_module,display_label,description,created_by)
  VALUES(p_source_set,p_org,p_workspace,p_owner_module,btrim(p_display_label),COALESCE(p_description,''),p_actor) RETURNING * INTO source_set;
 ELSIF source_set.org_id IS DISTINCT FROM p_org OR source_set.workspace_id IS DISTINCT FROM p_workspace
    OR source_set.owner_module IS DISTINCT FROM p_owner_module OR source_set.status='archived'
    OR source_set.current_version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';
 END IF;
 SELECT count(*)::integer INTO actual_count FROM(SELECT DISTINCT value->>'sourceVersionId' FROM jsonb_array_elements(p_items)) distinct_sources;
 IF actual_count<>jsonb_array_length(p_items) OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(p_items) entry
  WHERE jsonb_typeof(entry.value)<>'object' OR NOT(entry.value?&ARRAY['sourceVersionId','ordinal','role'])
   OR(entry.value-ARRAY['sourceVersionId','ordinal','role','note'])<>'{}'::jsonb
   OR COALESCE(entry.value->>'sourceVersionId','')!~*'^[0-9a-f-]{36}$' OR COALESCE(entry.value->>'ordinal','')!~'^[1-9][0-9]*$'
   OR(entry.value->>'ordinal')::integer NOT BETWEEN 1 AND jsonb_array_length(p_items)
   OR entry.value->>'role' NOT IN('primary','supporting','contradictory','reference') OR length(COALESCE(entry.value->>'note',''))>1000
 ) OR(SELECT count(DISTINCT(value->>'ordinal')::integer) FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN
  RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_SOURCE_SET';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY(value->>'ordinal')::integer LOOP
  SELECT * INTO source_version FROM public.enterprise_evidence_source_versions WHERE id=(item->>'sourceVersionId')::uuid FOR SHARE;
  SELECT * INTO source FROM public.enterprise_evidence_sources WHERE id=source_version.source_id FOR SHARE;
  IF source_version.id IS NULL OR source_version.org_id IS DISTINCT FROM p_org OR source_version.workspace_id IS DISTINCT FROM p_workspace
     OR source_version.extraction_status<>'parsed' OR source_version.extracted_text_hash IS NULL OR source_version.extracted_character_count IS NULL
     OR source_version.extracted_character_count NOT BETWEEN 0 AND 500000 OR source.id IS NULL OR source.org_id IS DISTINCT FROM p_org
     OR source.workspace_id IS DISTINCT FROM p_workspace OR source.deleted_at IS NOT NULL THEN
   RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_VERSION_NOT_READY';
  END IF;
  total_chars:=total_chars+source_version.extracted_character_count;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('ordinal',(item->>'ordinal')::integer,'sourceVersionId',source_version.id,
   'sourceId',source_version.source_id,'contentHash',source_version.content_hash,'extractedTextHash',source_version.extracted_text_hash,
   'role',item->>'role','contractVersion','transcript-source-set-1'));
 END LOOP;
 IF total_chars>2000000 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_LIMIT_EXCEEDED';END IF;
 manifest_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','transcript-source-set-1','ownerModule',p_owner_module,'orderedItems',manifest));
 INSERT INTO public.enterprise_source_set_versions(source_set_id,org_id,workspace_id,version,purpose,manifest_hash,source_count,extracted_character_count,status,created_by)
 VALUES(source_set.id,p_org,p_workspace,p_expected_version+1,btrim(p_purpose),manifest_hash,jsonb_array_length(p_items),total_chars,CASE WHEN p_lock THEN 'locked' ELSE 'draft' END,p_actor)
 RETURNING * INTO set_version;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY(value->>'ordinal')::integer LOOP
  SELECT * INTO source_version FROM public.enterprise_evidence_source_versions WHERE id=(item->>'sourceVersionId')::uuid;
  INSERT INTO public.enterprise_source_set_version_items(source_set_version_id,source_set_id,source_version_id,source_id,org_id,workspace_id,ordinal,semantic_role,user_note,content_hash,extracted_text_hash,extracted_character_count)
  VALUES(set_version.id,source_set.id,source_version.id,source_version.source_id,p_org,p_workspace,(item->>'ordinal')::integer,item->>'role',NULLIF(item->>'note',''),source_version.content_hash,source_version.extracted_text_hash,source_version.extracted_character_count);
 END LOOP;
 UPDATE public.enterprise_source_sets SET current_version=set_version.version,status=set_version.status,lifecycle_version=lifecycle_version+1,
  display_label=btrim(p_display_label),description=COALESCE(p_description,''),updated_at=statement_timestamp() WHERE id=source_set.id;
 result:=jsonb_build_object('resourceId',source_set.id,'sourceSetId',source_set.id,'sourceSetVersionId',set_version.id,
  'version',set_version.version,'status',set_version.status,'ownerModule',p_owner_module,'sourceCount',set_version.source_count,
  'extractedCharacterCount',set_version.extracted_character_count,'manifestHash',set_version.manifest_hash);
 PERFORM public.enterprise_ai_record_effect(receipt.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.source-set.create-version','command',source_set.id,result,'committed');
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_create_source_set_version(
 p_source_set uuid,p_owner_module text,p_display_label text,p_description text,p_purpose text,p_items jsonb,p_lock boolean,p_expected_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.enterprise_transcript_create_source_set_version_v2(p_source_set,p_owner_module,p_display_label,p_description,p_purpose,p_items,p_lock,p_expected_version,
  p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_execution_token,p_execution_fence)
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_lock_input_bundle_v2(
 p_input_bundle uuid,p_owner_module text,p_items jsonb,p_manual_brief_hash text,p_expected_version bigint,
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_execution_token uuid,p_execution_fence bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.enterprise_ai_command_receipts;bundle public.enterprise_module_input_bundles;bundle_version public.enterprise_module_input_bundle_versions;
 item jsonb;set_version public.enterprise_source_set_versions;source_set public.enterprise_source_sets;manifest jsonb:='[]'::jsonb;bundle_hash text;result jsonb;
BEGIN
 receipt:=public.enterprise_transcript_assert_module_receipt(p_receipt,p_actor,p_org,p_workspace,'transcript.input-bundle.lock',p_owner_module,p_authorization_version,p_execution_token,p_execution_fence);
 IF p_owner_module NOT IN('assess','studio') OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 20 OR p_expected_version<0
    OR(p_manual_brief_hash IS NOT NULL AND p_manual_brief_hash!~'^[0-9a-f]{64}$') THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_BUNDLE';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items)entry WHERE jsonb_typeof(entry.value)<>'object'
  OR NOT(entry.value?&ARRAY['sourceSetVersionId','ordinal','purpose']) OR(entry.value-ARRAY['sourceSetVersionId','ordinal','purpose'])<>'{}'::jsonb
  OR COALESCE(entry.value->>'sourceSetVersionId','')!~*'^[0-9a-f-]{36}$' OR COALESCE(entry.value->>'ordinal','')!~'^[1-9][0-9]*$'
  OR(entry.value->>'ordinal')::integer NOT BETWEEN 1 AND jsonb_array_length(p_items) OR length(btrim(COALESCE(entry.value->>'purpose',''))) NOT BETWEEN 1 AND 500)
  OR(SELECT count(DISTINCT value->>'sourceSetVersionId') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items)
  OR(SELECT count(DISTINCT(value->>'ordinal')::integer) FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN
  RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_INVALID_BUNDLE';
 END IF;
 SELECT * INTO bundle FROM public.enterprise_module_input_bundles WHERE id=p_input_bundle FOR UPDATE;
 IF bundle.id IS NULL THEN
  IF p_expected_version<>0 THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE';END IF;
  INSERT INTO public.enterprise_module_input_bundles(id,org_id,workspace_id,owner_module,created_by)
  VALUES(p_input_bundle,p_org,p_workspace,p_owner_module,p_actor) RETURNING * INTO bundle;
 ELSIF bundle.org_id IS DISTINCT FROM p_org OR bundle.workspace_id IS DISTINCT FROM p_workspace
    OR bundle.owner_module IS DISTINCT FROM p_owner_module OR bundle.current_version IS DISTINCT FROM p_expected_version THEN
  RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_BUNDLE_STALE';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY(value->>'ordinal')::integer LOOP
  SELECT * INTO set_version FROM public.enterprise_source_set_versions WHERE id=(item->>'sourceSetVersionId')::uuid FOR SHARE;
  SELECT * INTO source_set FROM public.enterprise_source_sets WHERE id=set_version.source_set_id FOR SHARE;
  IF set_version.id IS NULL OR set_version.org_id IS DISTINCT FROM p_org OR set_version.workspace_id IS DISTINCT FROM p_workspace OR set_version.status<>'locked'
     OR source_set.id IS NULL OR source_set.owner_module IS DISTINCT FROM p_owner_module OR source_set.status='archived'
     OR source_set.current_version IS DISTINCT FROM set_version.version THEN RAISE EXCEPTION 'ENTERPRISE_TRANSCRIPT_SOURCE_SET_STALE';END IF;
  manifest:=manifest||jsonb_build_array(jsonb_build_object('ordinal',(item->>'ordinal')::integer,'sourceSetVersionId',set_version.id,
   'manifestHash',set_version.manifest_hash,'purpose',item->>'purpose'));
 END LOOP;
 bundle_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','transcript-input-bundle-1','ownerModule',p_owner_module,
  'sourceSets',manifest,'manualBriefHash',p_manual_brief_hash));
 INSERT INTO public.enterprise_module_input_bundle_versions(input_bundle_id,org_id,workspace_id,version,bundle_hash,manual_brief_hash,status,created_by)
 VALUES(bundle.id,p_org,p_workspace,p_expected_version+1,bundle_hash,p_manual_brief_hash,'locked',p_actor) RETURNING * INTO bundle_version;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) ORDER BY(value->>'ordinal')::integer LOOP
  SELECT * INTO set_version FROM public.enterprise_source_set_versions WHERE id=(item->>'sourceSetVersionId')::uuid;
  INSERT INTO public.enterprise_module_input_bundle_items(input_bundle_version_id,input_bundle_id,org_id,workspace_id,ordinal,item_kind,source_set_version_id,source_set_id,resource_hash,declared_purpose)
  VALUES(bundle_version.id,bundle.id,p_org,p_workspace,(item->>'ordinal')::integer,'source_set',set_version.id,set_version.source_set_id,set_version.manifest_hash,btrim(item->>'purpose'));
 END LOOP;
 UPDATE public.enterprise_module_input_bundles SET current_version=bundle_version.version,updated_at=statement_timestamp() WHERE id=bundle.id;
 result:=jsonb_build_object('resourceId',bundle.id,'inputBundleId',bundle.id,'inputBundleVersionId',bundle_version.id,
  'version',bundle_version.version,'status','locked','ownerModule',p_owner_module,'bundleHash',bundle_version.bundle_hash);
 PERFORM public.enterprise_ai_record_effect(receipt.id,p_org,p_workspace,p_execution_token,p_execution_fence,'transcript.input-bundle.lock','command',bundle.id,result,'committed');
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_transcript_module_projection(p_org uuid,p_workspace uuid,p_owner_module text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE capability text;allowed boolean;flags public.enterprise_transcript_workspace_flags;sets jsonb;bundles jsonb;source_versions jsonb;
BEGIN
 IF p_owner_module NOT IN('assess','studio') OR auth.uid() IS NULL THEN RETURN NULL;END IF;
 capability:=CASE p_owner_module WHEN 'assess' THEN 'transcript.sources.read' ELSE 'studio.sources.read' END;
 allowed:=public.has_workspace_capability(p_workspace,p_org,capability);
 IF NOT allowed THEN RETURN NULL;END IF;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'sourceId',available.source_id,'sourceVersionId',available.source_version_id,'version',available.version,
  'label',available.display_name,'sourceKind',available.source_kind,'mimeType',available.mime_type,
  'characterCount',available.extracted_character_count,'createdAt',available.created_at)
  ORDER BY available.display_name,available.version DESC,available.source_version_id),'[]'::jsonb) INTO source_versions
 FROM(
  SELECT source.id source_id,version.id source_version_id,version.version,
   left(source.display_name,240) display_name,source.source_kind,source.mime_type,
   version.extracted_character_count,version.created_at
  FROM public.enterprise_evidence_sources source
  JOIN public.enterprise_evidence_source_versions version
   ON version.source_id=source.id AND version.org_id=source.org_id AND version.workspace_id=source.workspace_id
  WHERE source.org_id=p_org AND source.workspace_id=p_workspace AND source.deleted_at IS NULL
   AND version.extraction_status='parsed' AND version.extracted_text_hash IS NOT NULL
   AND version.extracted_character_count BETWEEN 1 AND 500000
  ORDER BY source.display_name,version.version DESC,version.id
  LIMIT 200
 ) available;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('sourceSetId',source_set.id,'ownerModule',source_set.owner_module,
  'displayLabel',source_set.display_label,'description',NULLIF(source_set.description,''),'currentVersion',source_set.current_version,
  'currentVersionId',set_version.id,'manifestHash',set_version.manifest_hash,
  'status',source_set.status,'sourceCount',set_version.source_count,'extractedCharacterCount',set_version.extracted_character_count,
  'members',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',item.source_id,'sourceVersionId',item.source_version_id,
   'ordinal',item.ordinal,'role',item.semantic_role,'note',item.user_note) ORDER BY item.ordinal)
   FROM public.enterprise_source_set_version_items item WHERE item.source_set_version_id=set_version.id),'[]'::jsonb),
  'createdAt',source_set.created_at,'updatedAt',source_set.updated_at) ORDER BY source_set.updated_at DESC),'[]'::jsonb) INTO sets
 FROM public.enterprise_source_sets source_set LEFT JOIN public.enterprise_source_set_versions set_version
  ON set_version.source_set_id=source_set.id AND set_version.version=source_set.current_version
 WHERE source_set.org_id=p_org AND source_set.workspace_id=p_workspace AND source_set.owner_module=p_owner_module;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('inputBundleId',bundle.id,'ownerModule',bundle.owner_module,'currentVersion',bundle.current_version,
  'inputBundleVersionId',bundle_version.id,'bundleHash',bundle_version.bundle_hash,'status',bundle_version.status,
  'sourceSetVersions',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'sourceSetId',item.source_set_id,'sourceSetVersionId',item.source_set_version_id,'sourceSetVersion',set_version.version,
   'manifestHash',set_version.manifest_hash,'ordinal',item.ordinal,'purpose',item.declared_purpose) ORDER BY item.ordinal)
   FROM public.enterprise_module_input_bundle_items item
   JOIN public.enterprise_source_set_versions set_version ON set_version.id=item.source_set_version_id AND set_version.source_set_id=item.source_set_id
   WHERE item.input_bundle_version_id=bundle_version.id),'[]'::jsonb),
  'createdAt',bundle.created_at,'updatedAt',bundle.updated_at) ORDER BY bundle.updated_at DESC),'[]'::jsonb) INTO bundles
 FROM public.enterprise_module_input_bundles bundle LEFT JOIN public.enterprise_module_input_bundle_versions bundle_version
  ON bundle_version.input_bundle_id=bundle.id AND bundle_version.version=bundle.current_version
 WHERE bundle.org_id=p_org AND bundle.workspace_id=p_workspace AND bundle.owner_module=p_owner_module;
 RETURN jsonb_build_object('mode','server_authoritative','organizationId',p_org,'workspaceId',p_workspace,'ownerModule',p_owner_module,
  'flags',jsonb_build_object('studioMultisourceEnabled',COALESCE(flags.studio_multisource_enabled,false),
   'studioTenantTemplatesEnabled',COALESCE(flags.studio_tenant_templates_enabled,false),'moduleHandoffsEnabled',COALESCE(flags.module_handoffs_enabled,false),
   'directStudioPlanningEnabled',COALESCE(flags.direct_studio_planning_enabled,false)),
  'sourceVersions',source_versions,'sourceSets',sets,'inputBundles',bundles);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_tenant_template_command(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE actor uuid;org uuid;workspace uuid;request_id uuid;template_id uuid;authorization_version bigint;expected_version bigint;
 command_type text;capability text;idempotency_key text;request_hash text;payload jsonb;flags public.enterprise_transcript_workspace_flags;
 receipt public.studio_tenant_template_command_receipts;aggregate public.studio_tenant_template_aggregates;
 template_version public.studio_tenant_template_versions;review public.studio_tenant_template_review_events;
 replacement_aggregate public.studio_tenant_template_aggregates;replacement_version public.studio_tenant_template_versions;
 template_hash text;outcome text;next_status text;result jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR NOT(p_command?&ARRAY['actorId','organizationId','workspaceId','requestId','authorizationVersion','expectedVersion','idempotencyKey','commandType','templateId','payload'])
    OR(p_command-ARRAY['actorId','organizationId','workspaceId','requestId','authorizationVersion','expectedVersion','idempotencyKey','commandType','templateId','payload'])<>'{}'::jsonb THEN
  RAISE EXCEPTION 'INVALID_COMMAND';
 END IF;
 BEGIN
  actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  request_id:=(p_command->>'requestId')::uuid;authorization_version:=(p_command->>'authorizationVersion')::bigint;
  expected_version:=(p_command->>'expectedVersion')::bigint;template_id:=(p_command->>'templateId')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_COMMAND';END;
 command_type:=p_command->>'commandType';idempotency_key:=p_command->>'idempotencyKey';payload:=p_command->'payload';
 capability:=CASE command_type WHEN 'studio.template.create' THEN 'studio.templates.manage' WHEN 'studio.template.revise' THEN 'studio.templates.manage'
  WHEN 'studio.template.review.submit' THEN 'studio.templates.manage'
  WHEN 'studio.template.review.resolve' THEN 'studio.templates.review' WHEN 'studio.template.approval.resolve' THEN 'studio.templates.approve'
  WHEN 'studio.template.deprecate' THEN 'studio.templates.approve' WHEN 'studio.template.replace' THEN 'studio.templates.approve' ELSE NULL END;
 IF capability IS NULL OR jsonb_typeof(payload)<>'object' OR length(idempotency_key) NOT BETWEEN 8 AND 128 OR expected_version<0 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 -- Authorization and default-off server policy precede receipt/resource disclosure.
 PERFORM public.pr1b_assert_command_authority(actor,org,workspace,capability,authorization_version);
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF flags.org_id IS NULL OR NOT flags.studio_tenant_templates_enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 request_hash:=public.enterprise_sha256_jsonb(p_command-'requestId');
 SELECT * INTO receipt FROM public.studio_tenant_template_command_receipts stored
 WHERE stored.org_id=org AND stored.actor_id=actor AND stored.command_type=command_type AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.workspace_id IS DISTINCT FROM workspace OR receipt.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF receipt.status='committed' THEN RETURN receipt.response||jsonb_build_object('outcome','replayed');END IF;
  RAISE EXCEPTION 'COMMAND_IN_PROGRESS';
 END IF;
 INSERT INTO public.studio_tenant_template_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(org,workspace,actor,command_type,idempotency_key,request_id,request_hash,'claimed') RETURNING * INTO receipt;

 SELECT * INTO aggregate FROM public.studio_tenant_template_aggregates WHERE id=template_id FOR UPDATE;
 IF command_type IN('studio.template.create','studio.template.revise') THEN
  IF NOT(payload?&ARRAY['name','description','artifactClass','sectionDefinitions','fieldSchema','rendererCompatibilityVersion','contentSchemaVersion'])
     OR(payload-ARRAY['name','description','artifactClass','sectionDefinitions','fieldSchema','rendererCompatibilityVersion','contentSchemaVersion'])<>'{}'::jsonb
     OR length(btrim(COALESCE(payload->>'name',''))) NOT BETWEEN 1 AND 160 OR length(COALESCE(payload->>'description',''))>2000
     OR payload->>'artifactClass' NOT IN('brd','frd','pdd','custom') OR NOT public.studio_pr_b_template_sections_safe(payload->'sectionDefinitions')
     OR jsonb_typeof(payload->'fieldSchema')<>'object' OR NOT public.studio_pr_b_json_structure_safe(payload->'fieldSchema')
     OR length(btrim(COALESCE(payload->>'rendererCompatibilityVersion',''))) NOT BETWEEN 1 AND 80
     OR length(btrim(COALESCE(payload->>'contentSchemaVersion',''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_TEMPLATE_STRUCTURE';END IF;
  IF command_type='studio.template.create' THEN
   IF aggregate.id IS NOT NULL OR expected_version<>0 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
   INSERT INTO public.studio_tenant_template_aggregates(id,org_id,workspace_id,safe_name,safe_description,artifact_class,created_by)
   VALUES(template_id,org,workspace,btrim(payload->>'name'),COALESCE(payload->>'description',''),payload->>'artifactClass',actor) RETURNING * INTO aggregate;
  ELSIF aggregate.id IS NULL OR aggregate.org_id IS DISTINCT FROM org OR aggregate.workspace_id IS DISTINCT FROM workspace
     OR aggregate.current_version IS DISTINCT FROM expected_version OR aggregate.lifecycle NOT IN('draft','changes_requested','rejected','approved','deprecated') THEN
   RAISE EXCEPTION 'VERSION_CONFLICT';
  END IF;
  template_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('artifactClass',payload->>'artifactClass','sectionDefinitions',payload->'sectionDefinitions',
   'fieldSchema',payload->'fieldSchema','rendererCompatibilityVersion',payload->>'rendererCompatibilityVersion','contentSchemaVersion',payload->>'contentSchemaVersion'));
  INSERT INTO public.studio_tenant_template_versions(template_id,org_id,workspace_id,version,parent_version_id,artifact_class,section_definitions,field_schema,
   renderer_compatibility_version,content_schema_version,template_hash,status,authored_by,author_authorization_version)
  VALUES(template_id,org,workspace,expected_version+1,aggregate.current_version_id,payload->>'artifactClass',payload->'sectionDefinitions',payload->'fieldSchema',
   payload->>'rendererCompatibilityVersion',payload->>'contentSchemaVersion',template_hash,'draft',actor,authorization_version) RETURNING * INTO template_version;
  UPDATE public.studio_tenant_template_aggregates SET safe_name=btrim(payload->>'name'),safe_description=COALESCE(payload->>'description',''),
   artifact_class=payload->>'artifactClass',current_version=template_version.version,current_version_id=template_version.id,lifecycle='draft',
   lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp() WHERE id=template_id RETURNING * INTO aggregate;
 ELSIF command_type='studio.template.review.submit' THEN
  IF aggregate.id IS NULL OR aggregate.org_id IS DISTINCT FROM org OR aggregate.workspace_id IS DISTINCT FROM workspace
     OR aggregate.current_version IS DISTINCT FROM expected_version OR aggregate.created_by IS DISTINCT FROM actor
     OR(payload-ARRAY['templateId','templateVersionId'])<>'{}'::jsonb OR NOT(payload?&ARRAY['templateId','templateVersionId'])
     OR payload->>'templateId' IS DISTINCT FROM aggregate.id::text OR payload->>'templateVersionId' IS DISTINCT FROM aggregate.current_version_id::text THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO template_version FROM public.studio_tenant_template_versions current_template
   WHERE current_template.id=aggregate.current_version_id AND current_template.template_id=aggregate.id FOR UPDATE;
  IF template_version.status<>'draft' OR template_version.authored_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE public.studio_tenant_template_versions SET status='reviewer_ready' WHERE id=template_version.id;
  UPDATE public.studio_tenant_template_aggregates SET lifecycle='reviewer_ready',lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp()
   WHERE id=aggregate.id RETURNING * INTO aggregate;
 ELSIF command_type='studio.template.review.resolve' THEN
  IF aggregate.id IS NULL OR aggregate.org_id IS DISTINCT FROM org OR aggregate.workspace_id IS DISTINCT FROM workspace
     OR aggregate.current_version IS DISTINCT FROM expected_version OR payload->>'outcome' NOT IN('approve','changes_requested','reject')
     OR(payload-ARRAY['templateId','templateVersionId','outcome','rationale','conditions'])<>'{}'::jsonb OR NOT(payload?&ARRAY['templateId','templateVersionId','outcome','rationale','conditions'])
     OR payload->>'templateId' IS DISTINCT FROM aggregate.id::text OR payload->>'templateVersionId' IS DISTINCT FROM aggregate.current_version_id::text
     OR jsonb_typeof(payload->'conditions')<>'array' OR NOT public.studio_pr_b_json_structure_safe(payload->'conditions')
     OR length(btrim(COALESCE(payload->>'rationale',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO template_version FROM public.studio_tenant_template_versions current_template WHERE current_template.id=aggregate.current_version_id AND current_template.template_id=aggregate.id FOR UPDATE;
  IF template_version.status NOT IN('reviewer_ready','in_review') OR actor IN(aggregate.created_by,template_version.authored_by) THEN RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';END IF;
  outcome:=CASE payload->>'outcome' WHEN 'approve' THEN 'approved' WHEN 'changes_requested' THEN 'changes_requested' ELSE 'rejected' END;
  next_status:=CASE outcome WHEN 'approved' THEN 'approval_ready' ELSE outcome END;
  INSERT INTO public.studio_tenant_template_review_events(template_id,template_version_id,org_id,workspace_id,reviewer_id,reviewer_authorization_version,outcome,rationale,conditions)
  VALUES(aggregate.id,template_version.id,org,workspace,actor,authorization_version,outcome,btrim(payload->>'rationale'),payload->'conditions') RETURNING * INTO review;
  UPDATE public.studio_tenant_template_versions SET status=next_status WHERE id=template_version.id;
  UPDATE public.studio_tenant_template_aggregates SET lifecycle=next_status,lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp()
   WHERE id=aggregate.id RETURNING * INTO aggregate;
 ELSIF command_type='studio.template.approval.resolve' THEN
  IF aggregate.id IS NULL OR aggregate.org_id IS DISTINCT FROM org OR aggregate.workspace_id IS DISTINCT FROM workspace
     OR aggregate.current_version IS DISTINCT FROM expected_version OR payload->>'outcome' NOT IN('approve','reject')
     OR(payload-ARRAY['templateId','templateVersionId','outcome','rationale','conditions'])<>'{}'::jsonb OR NOT(payload?&ARRAY['templateId','templateVersionId','outcome','rationale','conditions'])
     OR payload->>'templateId' IS DISTINCT FROM aggregate.id::text OR payload->>'templateVersionId' IS DISTINCT FROM aggregate.current_version_id::text
     OR jsonb_typeof(payload->'conditions')<>'array' OR NOT public.studio_pr_b_json_structure_safe(payload->'conditions')
     OR length(btrim(COALESCE(payload->>'rationale',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO template_version FROM public.studio_tenant_template_versions current_template WHERE current_template.id=aggregate.current_version_id AND current_template.template_id=aggregate.id FOR UPDATE;
  SELECT * INTO review FROM public.studio_tenant_template_review_events WHERE template_version_id=template_version.id;
  IF template_version.status<>'approval_ready' OR review.id IS NULL OR actor IN(aggregate.created_by,template_version.authored_by,review.reviewer_id) THEN RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';END IF;
  outcome:=CASE payload->>'outcome' WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
  INSERT INTO public.studio_tenant_template_approval_events(template_id,template_version_id,review_event_id,org_id,workspace_id,approver_id,approver_authorization_version,outcome,rationale,conditions)
  VALUES(aggregate.id,template_version.id,review.id,org,workspace,actor,authorization_version,outcome,btrim(payload->>'rationale'),payload->'conditions');
  UPDATE public.studio_tenant_template_versions SET status=outcome WHERE id=template_version.id;
  UPDATE public.studio_tenant_template_aggregates SET current_approved_version_id=CASE WHEN outcome='approved' THEN template_version.id ELSE current_approved_version_id END,
   lifecycle=outcome,lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp() WHERE id=aggregate.id RETURNING * INTO aggregate;
 ELSIF command_type='studio.template.deprecate' THEN
  IF aggregate.id IS NULL OR aggregate.org_id IS DISTINCT FROM org OR aggregate.workspace_id IS DISTINCT FROM workspace
     OR aggregate.current_version IS DISTINCT FROM expected_version OR aggregate.lifecycle<>'approved'
     OR(payload-ARRAY['templateId','templateVersionId','rationale'])<>'{}'::jsonb OR NOT(payload?&ARRAY['templateId','templateVersionId','rationale'])
     OR payload->>'templateId' IS DISTINCT FROM aggregate.id::text OR payload->>'templateVersionId' IS DISTINCT FROM aggregate.current_approved_version_id::text
     OR length(btrim(COALESCE(payload->>'rationale',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO template_version FROM public.studio_tenant_template_versions approved_template WHERE approved_template.id=aggregate.current_approved_version_id AND approved_template.template_id=aggregate.id FOR UPDATE;
  SELECT * INTO review FROM public.studio_tenant_template_review_events WHERE template_version_id=template_version.id;
  IF actor IN(aggregate.created_by,template_version.authored_by,review.reviewer_id) THEN RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';END IF;
  INSERT INTO public.studio_tenant_template_approval_events(template_id,template_version_id,review_event_id,org_id,workspace_id,approver_id,approver_authorization_version,outcome,rationale)
  VALUES(aggregate.id,template_version.id,review.id,org,workspace,actor,authorization_version,'deprecated',btrim(payload->>'rationale'));
  UPDATE public.studio_tenant_template_versions SET status='deprecated' WHERE id=template_version.id;
  UPDATE public.studio_tenant_template_aggregates SET lifecycle='deprecated',lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp() WHERE id=aggregate.id RETURNING * INTO aggregate;
 ELSE
  IF aggregate.id IS NULL OR aggregate.org_id IS DISTINCT FROM org OR aggregate.workspace_id IS DISTINCT FROM workspace
     OR aggregate.current_version IS DISTINCT FROM expected_version OR aggregate.lifecycle<>'approved'
     OR(payload-ARRAY['templateId','templateVersionId','replacementTemplateId','replacementTemplateVersionId','rationale'])<>'{}'::jsonb
     OR NOT(payload?&ARRAY['templateId','templateVersionId','replacementTemplateId','replacementTemplateVersionId','rationale'])
     OR payload->>'templateId' IS DISTINCT FROM aggregate.id::text OR payload->>'templateVersionId' IS DISTINCT FROM aggregate.current_approved_version_id::text
     OR payload->>'replacementTemplateId'=aggregate.id::text OR length(btrim(COALESCE(payload->>'rationale',''))) NOT BETWEEN 1 AND 4000 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO template_version FROM public.studio_tenant_template_versions approved_template
   WHERE approved_template.id=aggregate.current_approved_version_id AND approved_template.template_id=aggregate.id FOR UPDATE;
  SELECT * INTO review FROM public.studio_tenant_template_review_events WHERE template_version_id=template_version.id;
  SELECT * INTO replacement_version FROM public.studio_tenant_template_versions replacement
   WHERE replacement.id=(payload->>'replacementTemplateVersionId')::uuid AND replacement.template_id=(payload->>'replacementTemplateId')::uuid
    AND replacement.org_id=org AND replacement.workspace_id=workspace AND replacement.status='approved' FOR SHARE;
  SELECT * INTO replacement_aggregate FROM public.studio_tenant_template_aggregates replacement
   WHERE replacement.id=replacement_version.template_id AND replacement.org_id=org AND replacement.workspace_id=workspace FOR SHARE;
  IF replacement_version.id IS NULL OR replacement_aggregate.current_approved_version_id IS DISTINCT FROM replacement_version.id
     OR replacement_version.artifact_class IS DISTINCT FROM template_version.artifact_class
     OR actor IN(aggregate.created_by,template_version.authored_by,review.reviewer_id,replacement_aggregate.created_by,replacement_version.authored_by) THEN RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';END IF;
  INSERT INTO public.studio_tenant_template_approval_events(template_id,template_version_id,review_event_id,org_id,workspace_id,approver_id,approver_authorization_version,outcome,rationale,replacement_template_id,replacement_version_id)
  VALUES(aggregate.id,template_version.id,review.id,org,workspace,actor,authorization_version,'replaced',btrim(payload->>'rationale'),replacement_aggregate.id,replacement_version.id);
  UPDATE public.studio_tenant_template_versions SET status='replaced' WHERE id=template_version.id;
  UPDATE public.studio_tenant_template_aggregates SET lifecycle='replaced',lifecycle_version=lifecycle_version+1,updated_at=statement_timestamp() WHERE id=aggregate.id RETURNING * INTO aggregate;
 END IF;
 SELECT * INTO template_version FROM public.studio_tenant_template_versions WHERE id=aggregate.current_version_id;
 result:=jsonb_build_object('outcome','committed','templateId',aggregate.id,'templateVersionId',template_version.id,'version',aggregate.current_version,
  'status',aggregate.lifecycle,'templateHash',template_version.template_hash);
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,command_type,'studio_tenant_template',aggregate.id,'succeeded',aggregate.lifecycle_version,
  jsonb_build_object('receiptId',receipt.id,'templateVersionId',template_version.id,'templateHash',template_version.template_hash));
 UPDATE public.studio_tenant_template_command_receipts SET status='committed',resource_id=aggregate.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_tenant_template_projection(p_org uuid,p_workspace uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();can_manage boolean;can_review boolean;can_approve boolean;can_generate boolean;
 flags public.enterprise_transcript_workspace_flags;templates jsonb;
BEGIN
 IF actor IS NULL OR NOT public.has_workspace_capability(p_workspace,p_org,'studio.templates.read') THEN RETURN NULL;END IF;
 can_manage:=public.has_workspace_capability(p_workspace,p_org,'studio.templates.manage');
 can_review:=public.has_workspace_capability(p_workspace,p_org,'studio.templates.review');
 can_approve:=public.has_workspace_capability(p_workspace,p_org,'studio.templates.approve');
 can_generate:=public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.generate');
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(projected.item ORDER BY projected.ownership,projected.artifact_class,projected.safe_name),'[]'::jsonb) INTO templates
 FROM(
  SELECT 'system'::text ownership,system.artifact_type artifact_class,('System '||upper(system.artifact_type)) safe_name,
   jsonb_build_object('ownership','system','templateId',system.id,'templateVersionId',system.id,'version',system.template_version,
    'name','System '||upper(system.artifact_type),'description','AvalaOS governed system '||upper(system.artifact_type)||' compatibility template',
    'artifactClass',system.artifact_type,'lifecycle','approved','templateHash',system.template_hash,'rendererVersion',system.renderer_version,
    'contentSchemaVersion',system.content_schema_version,'sections',CASE system.artifact_type
      WHEN 'brd' THEN jsonb_build_array(jsonb_build_object('id','summary','title','Summary','required',true,'fieldKind','narrative'),jsonb_build_object('id','objectives','title','Objectives','required',true,'fieldKind','requirements'),jsonb_build_object('id','scope','title','Scope','required',true,'fieldKind','narrative'),jsonb_build_object('id','requirements','title','Requirements','required',true,'fieldKind','requirements'),jsonb_build_object('id','risks','title','Risks','required',true,'fieldKind','risks'))
      WHEN 'frd' THEN jsonb_build_array(jsonb_build_object('id','summary','title','Summary','required',true,'fieldKind','narrative'),jsonb_build_object('id','functionalRequirements','title','Functional requirements','required',true,'fieldKind','requirements'),jsonb_build_object('id','rules','title','Rules','required',true,'fieldKind','rules'),jsonb_build_object('id','interfaces','title','Interfaces','required',true,'fieldKind','interfaces'),jsonb_build_object('id','acceptanceCriteria','title','Acceptance criteria','required',true,'fieldKind','acceptance_criteria'))
      ELSE jsonb_build_array(jsonb_build_object('id','summary','title','Summary','required',true,'fieldKind','narrative'),jsonb_build_object('id','process','title','Process','required',true,'fieldKind','narrative'),jsonb_build_object('id','roles','title','Roles','required',true,'fieldKind','controls'),jsonb_build_object('id','controls','title','Controls','required',true,'fieldKind','controls'),jsonb_build_object('id','exceptions','title','Exceptions','required',true,'fieldKind','risks')) END,
    'replacement',NULL,'actions',to_jsonb(array_remove(ARRAY[CASE WHEN can_generate THEN 'studio.generation.request' END]::text[],NULL))) item
  FROM public.studio_system_template_versions system WHERE system.superseded_at IS NULL
  UNION ALL
  SELECT 'tenant',aggregate.artifact_class,aggregate.safe_name,
   jsonb_build_object('ownership','tenant','templateId',aggregate.id,'templateVersionId',version.id,'version',version.version,
    'name',aggregate.safe_name,'description',aggregate.safe_description,'artifactClass',aggregate.artifact_class,'lifecycle',aggregate.lifecycle,
    'templateHash',version.template_hash,'rendererVersion',version.renderer_compatibility_version,'contentSchemaVersion',version.content_schema_version,
    'sections',version.section_definitions,'replacement',(SELECT jsonb_build_object('templateId',replacement.template_id,'templateVersionId',replacement.id,'version',replacement.version)
      FROM public.studio_tenant_template_approval_events resolution JOIN public.studio_tenant_template_versions replacement ON replacement.id=resolution.replacement_version_id
      WHERE resolution.template_version_id=version.id AND resolution.outcome='replaced' LIMIT 1),
    'actions',to_jsonb(array_remove(ARRAY[
      CASE WHEN can_manage AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status IN('draft','changes_requested','rejected','approved','deprecated') THEN 'studio.template.revise' END,
      CASE WHEN can_manage AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status='draft' AND version.authored_by=actor THEN 'studio.template.review.submit' END,
      CASE WHEN can_review AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status IN('reviewer_ready','in_review') AND version.authored_by<>actor THEN 'studio.template.review.resolve' END,
      CASE WHEN can_approve AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status='approval_ready' AND version.authored_by<>actor
        AND NOT EXISTS(SELECT 1 FROM public.studio_tenant_template_review_events review WHERE review.template_version_id=version.id AND review.reviewer_id=actor) THEN 'studio.template.approval.resolve' END,
      CASE WHEN can_approve AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status='approved' AND version.authored_by<>actor THEN 'studio.template.deprecate' END,
      CASE WHEN can_approve AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status='approved' AND version.authored_by<>actor AND EXISTS(
        SELECT 1 FROM public.studio_tenant_template_versions replacement JOIN public.studio_tenant_template_aggregates target ON target.id=replacement.template_id
        WHERE replacement.org_id=p_org AND replacement.workspace_id=p_workspace AND replacement.status='approved' AND replacement.template_id<>aggregate.id
          AND replacement.artifact_class=version.artifact_class AND target.current_approved_version_id=replacement.id AND replacement.authored_by<>actor) THEN 'studio.template.replace' END,
      CASE WHEN can_generate AND COALESCE(flags.studio_tenant_templates_enabled,false) AND version.status='approved' AND aggregate.current_approved_version_id=version.id THEN 'studio.generation.request' END
    ]::text[],NULL))) item
  FROM public.studio_tenant_template_aggregates aggregate JOIN public.studio_tenant_template_versions version ON version.id=aggregate.current_version_id
  WHERE aggregate.org_id=p_org AND aggregate.workspace_id=p_workspace
 )projected;
 RETURN jsonb_build_object('organizationId',p_org,'workspaceId',p_workspace,'templates',templates);
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_studio_route_policy()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policyVersion',1,'edge','assess_to_studio','targetReviewRequired',true,
  'independentApprovalRequired',true,'oneTimeConsumption',true,'directDeliveryAllowed',false,
  'expiryPolicy','fixed_from_request','handoffTtlSeconds',604800)
$$;

CREATE OR REPLACE FUNCTION public.enterprise_direct_studio_route_policy()
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('policyVersion',1,'entry','direct_studio','planningOnly',true,'assessmentClaimAllowed',false,
  'deliveryHandoffAllowed',false,'executionAllowed',false)
$$;

-- Extend the accepted unified provider-budget ledger with an exclusive Studio
-- identity union. Existing Enterprise rows and RPCs retain their exact
-- receipt/job foreign keys and behavior; Studio uses its committed command
-- receipt plus the exact fenced generation attempt.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.enterprise_ai_budget_reservations
 ALTER COLUMN receipt_id DROP NOT NULL,
 ALTER COLUMN job_id DROP NOT NULL,
 ADD COLUMN authority_kind text NOT NULL DEFAULT 'enterprise'
   CHECK(authority_kind IN('enterprise','studio')),
 ADD COLUMN studio_receipt_id uuid,
 ADD COLUMN studio_attempt_id uuid,
 ADD COLUMN studio_transfer_count bigint NOT NULL DEFAULT 0 CHECK(studio_transfer_count>=0),
 ADD COLUMN studio_last_transfer_at timestamptz,
 ADD COLUMN studio_transfer_pending boolean NOT NULL DEFAULT false,
 ADD CONSTRAINT enterprise_ai_budget_studio_receipt_fkey
   FOREIGN KEY(studio_receipt_id) REFERENCES public.studio_artifact_command_receipts(id) ON DELETE RESTRICT,
 ADD CONSTRAINT enterprise_ai_budget_studio_attempt_fkey
   FOREIGN KEY(studio_attempt_id)
   REFERENCES public.studio_artifact_generation_attempts(id) ON DELETE RESTRICT,
 ADD CONSTRAINT enterprise_ai_budget_authority_union_check CHECK(
   (authority_kind='enterprise' AND receipt_id IS NOT NULL AND job_id IS NOT NULL
     AND studio_receipt_id IS NULL AND studio_attempt_id IS NULL)
   OR(authority_kind='studio' AND receipt_id IS NULL AND job_id IS NULL
     AND studio_receipt_id IS NOT NULL AND studio_attempt_id IS NOT NULL)
 );
CREATE UNIQUE INDEX enterprise_ai_budget_studio_receipt_unique
 ON public.enterprise_ai_budget_reservations(studio_receipt_id) WHERE studio_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX enterprise_ai_budget_studio_attempt_unique
 ON public.enterprise_ai_budget_reservations(studio_attempt_id) WHERE studio_attempt_id IS NOT NULL;

-- Exact human-accepted extraction material is bound into each immutable source
-- package. No raw source/candidate text is stored in this manifest.
CREATE OR REPLACE FUNCTION public.studio_pr_b_anchor_manifest_safe(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_typeof(value)='array' AND jsonb_array_length(value)<=2001
  AND NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(value) anchor
   WHERE jsonb_typeof(anchor)<>'object'
    OR NOT(anchor?&ARRAY['sourceVersionId','locator','anchorHash'])
    OR(anchor-ARRAY['sourceVersionId','locator','anchorHash'])<>'{}'::jsonb
    OR COALESCE(anchor->>'sourceVersionId','')!~*'^[0-9a-f-]{36}$'
    OR length(btrim(COALESCE(anchor->>'locator',''))) NOT BETWEEN 1 AND 500
    OR COALESCE(anchor->>'anchorHash','')!~'^[0-9a-f]{64}$'
  )
  AND(SELECT count(*) FROM(
   SELECT DISTINCT anchor->>'sourceVersionId',anchor->>'locator',anchor->>'anchorHash'
   FROM jsonb_array_elements(value) anchor
  ) distinct_anchor)=jsonb_array_length(value)
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_anchor_manifest(
 p_candidate_manifest jsonb,p_assess_source_version uuid,p_assess_package_hash text
) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'sourceVersionId',anchor.source_version_id,'locator',anchor.locator,'anchorHash',anchor.anchor_hash
  ) ORDER BY anchor.source_version_id,anchor.locator,anchor.anchor_hash),'[]'::jsonb)
 FROM(
  SELECT DISTINCT source_version_id,locator,anchor_hash
  FROM(
   SELECT p_assess_source_version::text source_version_id,'assess:accepted-handoff'::text locator,p_assess_package_hash anchor_hash
   WHERE p_assess_source_version IS NOT NULL AND p_assess_package_hash~'^[0-9a-f]{64}$'
   UNION ALL
   SELECT candidate->>'sourceVersionId',candidate->>'locator',candidate->>'anchorHash'
   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_candidate_manifest)='array' THEN p_candidate_manifest ELSE '[]'::jsonb END) candidate
  ) raw_anchor
 ) anchor
$$;

ALTER TABLE public.studio_artifact_source_packages
 ADD COLUMN candidate_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
   CHECK(jsonb_typeof(candidate_manifest)='array' AND jsonb_array_length(candidate_manifest)<=2000),
 ADD COLUMN candidate_manifest_hash text NOT NULL DEFAULT encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
   CHECK(candidate_manifest_hash~'^[0-9a-f]{64}$'),
 ADD COLUMN candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 2000),
 ADD COLUMN anchor_manifest jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(public.studio_pr_b_anchor_manifest_safe(anchor_manifest)),
 ADD COLUMN anchor_manifest_hash text NOT NULL DEFAULT encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
   CHECK(anchor_manifest_hash~'^[0-9a-f]{64}$'),
 ADD COLUMN anchor_count integer NOT NULL DEFAULT 0 CHECK(anchor_count BETWEEN 0 AND 2001),
 ADD CONSTRAINT studio_source_package_candidate_count_check
   CHECK(candidate_count=jsonb_array_length(candidate_manifest)),
 ADD CONSTRAINT studio_source_package_anchor_count_check CHECK(anchor_count=jsonb_array_length(anchor_manifest)),
 ADD CONSTRAINT studio_source_package_anchor_hash_check CHECK(anchor_manifest_hash=public.enterprise_sha256_jsonb(anchor_manifest));
ALTER TABLE public.enterprise_module_handoffs
 ADD COLUMN candidate_manifest jsonb NOT NULL DEFAULT '[]'::jsonb
   CHECK(jsonb_typeof(candidate_manifest)='array' AND jsonb_array_length(candidate_manifest)<=2000),
 ADD COLUMN candidate_manifest_hash text NOT NULL DEFAULT encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
   CHECK(candidate_manifest_hash~'^[0-9a-f]{64}$'),
 ADD COLUMN candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 2000),
 ADD COLUMN anchor_manifest jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(public.studio_pr_b_anchor_manifest_safe(anchor_manifest)),
 ADD COLUMN anchor_manifest_hash text NOT NULL DEFAULT encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
   CHECK(anchor_manifest_hash~'^[0-9a-f]{64}$'),
 ADD COLUMN anchor_count integer NOT NULL DEFAULT 0 CHECK(anchor_count BETWEEN 0 AND 2001),
 ADD CONSTRAINT enterprise_handoff_candidate_count_check
   CHECK(candidate_count=jsonb_array_length(candidate_manifest)),
 ADD CONSTRAINT enterprise_handoff_anchor_count_check CHECK(anchor_count=jsonb_array_length(anchor_manifest)),
 ADD CONSTRAINT enterprise_handoff_anchor_hash_check CHECK(anchor_manifest_hash=public.enterprise_sha256_jsonb(anchor_manifest));
ALTER TABLE public.studio_artifact_generation_attempts
 ADD COLUMN candidate_manifest_hash text NOT NULL DEFAULT encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
   CHECK(candidate_manifest_hash~'^[0-9a-f]{64}$'),
 ADD COLUMN candidate_count integer NOT NULL DEFAULT 0 CHECK(candidate_count BETWEEN 0 AND 2000);
ALTER TABLE public.studio_artifact_generation_attempts
 ADD COLUMN anchor_manifest_hash text NOT NULL DEFAULT encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
   CHECK(anchor_manifest_hash~'^[0-9a-f]{64}$'),
 ADD COLUMN anchor_count integer NOT NULL DEFAULT 0 CHECK(anchor_count BETWEEN 0 AND 2001);

UPDATE public.studio_artifact_source_packages package
SET anchor_manifest=public.studio_pr_b_anchor_manifest(package.candidate_manifest,upstream.source_version_id,upstream.package_hash),
    anchor_manifest_hash=public.enterprise_sha256_jsonb(public.studio_pr_b_anchor_manifest(package.candidate_manifest,upstream.source_version_id,upstream.package_hash)),
    anchor_count=jsonb_array_length(public.studio_pr_b_anchor_manifest(package.candidate_manifest,upstream.source_version_id,upstream.package_hash))
FROM public.assess_v2_studio_handoffs upstream
WHERE package.assess_handoff_id=upstream.id AND package.org_id=upstream.org_id AND package.workspace_id=upstream.workspace_id;

UPDATE public.studio_artifact_generation_attempts attempt
SET anchor_manifest_hash=package.anchor_manifest_hash,anchor_count=package.anchor_count
FROM public.studio_artifact_source_packages package
WHERE package.id=attempt.source_package_id AND package.artifact_id=attempt.artifact_id
 AND package.org_id=attempt.org_id AND package.workspace_id=attempt.workspace_id;

CREATE OR REPLACE FUNCTION public.studio_pr_b_candidate_manifest(
 p_org uuid,p_workspace uuid,p_bundle_version uuid
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE manifest jsonb;source_count integer;
BEGIN
 SELECT count(DISTINCT source_item.source_version_id)::integer INTO source_count
 FROM public.enterprise_module_input_bundle_items bundle_item
 JOIN public.enterprise_source_set_version_items source_item
   ON source_item.source_set_version_id=bundle_item.source_set_version_id
  AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
 WHERE bundle_item.input_bundle_version_id=p_bundle_version
   AND bundle_item.org_id=p_org AND bundle_item.workspace_id=p_workspace;
 IF source_count<1 OR source_count>20 THEN RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';END IF;
 IF EXISTS(
   SELECT 1
   FROM public.enterprise_module_input_bundle_items bundle_item
   JOIN public.enterprise_source_set_version_items source_item
     ON source_item.source_set_version_id=bundle_item.source_set_version_id
    AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
   WHERE bundle_item.input_bundle_version_id=p_bundle_version
     AND bundle_item.org_id=p_org AND bundle_item.workspace_id=p_workspace
     AND NOT EXISTS(
       SELECT 1 FROM public.enterprise_transcript_extraction_bindings binding
       JOIN public.enterprise_evidence_candidates candidate
         ON candidate.ai_job_id=binding.job_id AND candidate.source_id=binding.source_id
        AND candidate.source_version_id=binding.source_version_id
        AND candidate.org_id=binding.org_id AND candidate.workspace_id=binding.workspace_id
       WHERE binding.input_bundle_version_id=p_bundle_version
         AND binding.source_version_id=source_item.source_version_id
         AND binding.org_id=p_org AND binding.workspace_id=p_workspace
         AND candidate.suggestion_status='accepted' AND candidate.reviewed_by IS NOT NULL
         AND candidate.reviewed_at IS NOT NULL
     )
 ) THEN RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'candidateId',candidate.id,'candidateVersion',candidate.version,
   'candidateProvenanceHash',candidate.provenance_hash,'anchorHash',candidate.excerpt_hash,
   'sourceId',candidate.source_id,'sourceVersionId',candidate.source_version_id,
   'extractionJobId',binding.job_id,'fieldKey',candidate.field_key,'locator',candidate.source_locator
 ) ORDER BY candidate.source_version_id,candidate.field_key,candidate.id),'[]'::jsonb) INTO manifest
 FROM public.enterprise_transcript_extraction_bindings binding
 JOIN public.enterprise_evidence_candidates candidate
   ON candidate.ai_job_id=binding.job_id AND candidate.source_id=binding.source_id
  AND candidate.source_version_id=binding.source_version_id
  AND candidate.org_id=binding.org_id AND candidate.workspace_id=binding.workspace_id
 WHERE binding.input_bundle_version_id=p_bundle_version
   AND binding.org_id=p_org AND binding.workspace_id=p_workspace
   AND candidate.suggestion_status='accepted' AND candidate.reviewed_by IS NOT NULL
   AND candidate.reviewed_at IS NOT NULL
   AND EXISTS(
     SELECT 1 FROM public.enterprise_module_input_bundle_items bundle_item
     JOIN public.enterprise_source_set_version_items source_item
       ON source_item.source_set_version_id=bundle_item.source_set_version_id
      AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
     WHERE bundle_item.input_bundle_version_id=p_bundle_version
       AND bundle_item.org_id=p_org AND bundle_item.workspace_id=p_workspace
       AND source_item.source_version_id=candidate.source_version_id
   );
 IF jsonb_array_length(manifest)<source_count OR jsonb_array_length(manifest)>2000 THEN
  RAISE EXCEPTION 'SOURCE_COVERAGE_INCOMPLETE';
 END IF;
 RETURN manifest;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_upstream_handoff_is_current(p_upstream uuid,p_org uuid,p_workspace uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.assess_v2_studio_handoffs current_handoff
  JOIN public.assess_v2_cases current_case
    ON current_case.id=current_handoff.case_id AND current_case.org_id=current_handoff.org_id
   AND current_case.workspace_id=current_handoff.workspace_id
  WHERE current_handoff.id=p_upstream AND current_handoff.org_id=p_org AND current_handoff.workspace_id=p_workspace
    AND current_case.head_version_id=current_handoff.source_version_id
    AND EXISTS(
      SELECT 1 FROM public.assess_v2_case_versions head_version
      WHERE head_version.id=current_case.head_version_id AND head_version.case_id=current_case.id
        AND head_version.org_id=current_case.org_id AND head_version.workspace_id=current_case.workspace_id
        AND head_version.version=current_handoff.source_case_version
    )
    AND NOT EXISTS(
      SELECT 1 FROM public.assess_v2_studio_handoffs newer
      WHERE newer.org_id=current_handoff.org_id AND newer.workspace_id=current_handoff.workspace_id
        AND newer.case_id=current_handoff.case_id AND newer.id<>current_handoff.id
        AND(newer.source_case_version>current_handoff.source_case_version
          OR(newer.source_case_version=current_handoff.source_case_version
             AND(newer.handed_off_at,newer.id)>(current_handoff.handed_off_at,current_handoff.id)))
    )
 )
$$;

-- One predicate owns currentness for every exclusive source-package mode.
-- Read projections call the stable predicate directly. Mutation paths first
-- acquire the exact upstream rows through the lock helper below, then call the
-- same predicate while those rows cannot advance beneath the decision.
CREATE OR REPLACE FUNCTION public.studio_pr_b_source_package_is_current(
 p_source_package uuid,p_org uuid,p_workspace uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE package.source_mode
  WHEN 'assess_handoff' THEN
   package.assess_handoff_id IS NOT NULL
   AND EXISTS(
    SELECT 1 FROM public.assess_v2_studio_handoffs upstream
    WHERE upstream.id=package.assess_handoff_id AND upstream.org_id=package.org_id
      AND upstream.workspace_id=package.workspace_id AND upstream.package_hash=package.assess_package_hash
   )
   AND public.studio_pr_b_upstream_handoff_is_current(package.assess_handoff_id,package.org_id,package.workspace_id)
  WHEN 'direct_transcript_bundle' THEN
   package.studio_input_bundle_version_id IS NOT NULL
   AND EXISTS(
    SELECT 1 FROM public.enterprise_module_input_bundle_versions bundle_version
    JOIN public.enterprise_module_input_bundles bundle
      ON bundle.id=bundle_version.input_bundle_id AND bundle.org_id=bundle_version.org_id
     AND bundle.workspace_id=bundle_version.workspace_id
    WHERE bundle_version.id=package.studio_input_bundle_version_id
      AND bundle_version.input_bundle_id=package.studio_input_bundle_id
      AND bundle_version.org_id=package.org_id AND bundle_version.workspace_id=package.workspace_id
      AND bundle_version.version=package.studio_input_bundle_version
      AND bundle_version.bundle_hash=package.studio_bundle_hash AND bundle_version.status='locked'
      AND bundle.owner_module='studio' AND bundle.current_version=bundle_version.version
   )
  WHEN 'assess_plus_transcript_bundle' THEN
   package.assess_handoff_id IS NOT NULL AND package.studio_input_bundle_version_id IS NOT NULL
   AND EXISTS(
    SELECT 1 FROM public.assess_v2_studio_handoffs upstream
    WHERE upstream.id=package.assess_handoff_id AND upstream.org_id=package.org_id
      AND upstream.workspace_id=package.workspace_id AND upstream.package_hash=package.assess_package_hash
   )
   AND public.studio_pr_b_upstream_handoff_is_current(package.assess_handoff_id,package.org_id,package.workspace_id)
   AND EXISTS(
    SELECT 1 FROM public.enterprise_module_input_bundle_versions bundle_version
    JOIN public.enterprise_module_input_bundles bundle
      ON bundle.id=bundle_version.input_bundle_id AND bundle.org_id=bundle_version.org_id
     AND bundle.workspace_id=bundle_version.workspace_id
    WHERE bundle_version.id=package.studio_input_bundle_version_id
      AND bundle_version.input_bundle_id=package.studio_input_bundle_id
      AND bundle_version.org_id=package.org_id AND bundle_version.workspace_id=package.workspace_id
      AND bundle_version.version=package.studio_input_bundle_version
      AND bundle_version.bundle_hash=package.studio_bundle_hash AND bundle_version.status='locked'
      AND bundle.owner_module='studio' AND bundle.current_version=bundle_version.version
   )
  WHEN 'manual_brief' THEN
   package.manual_brief_hash IS NOT NULL
   AND EXISTS(
    SELECT 1 FROM public.studio_artifact_manual_brief_materials material
    WHERE material.source_package_id=package.id AND material.artifact_id=package.artifact_id
      AND material.org_id=package.org_id AND material.workspace_id=package.workspace_id
      AND material.manual_brief_hash=package.manual_brief_hash
      AND material.manual_brief_hash=encode(public.digest(convert_to(material.manual_brief,'UTF8'),'sha256'),'hex')
   )
  ELSE false END
 FROM public.studio_artifact_source_packages package
 WHERE package.id=p_source_package AND package.org_id=p_org AND package.workspace_id=p_workspace
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_lock_source_package_current(
 p_source_package uuid,p_org uuid,p_workspace uuid
) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE package public.studio_artifact_source_packages;upstream public.assess_v2_studio_handoffs;
BEGIN
 SELECT * INTO package FROM public.studio_artifact_source_packages
  WHERE id=p_source_package AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 IF package.id IS NULL THEN RETURN false;END IF;

 -- Established mutation lock order: exact Assess case first, then the Studio
 -- bundle aggregate/version, then private manual material. Upstream Assess
 -- writers take the same case row and never acquire Studio generation locks;
 -- Studio bundle writers take only the bundle aggregate after their receipt.
 IF package.assess_handoff_id IS NOT NULL THEN
  SELECT * INTO upstream FROM public.assess_v2_studio_handoffs
   WHERE id=package.assess_handoff_id AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF upstream.id IS NULL THEN RETURN false;END IF;
  PERFORM 1 FROM public.assess_v2_cases
   WHERE id=upstream.case_id AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND THEN RETURN false;END IF;
 END IF;
 IF package.studio_input_bundle_version_id IS NOT NULL THEN
  PERFORM 1 FROM public.enterprise_module_input_bundles
   WHERE id=package.studio_input_bundle_id AND org_id=p_org AND workspace_id=p_workspace AND owner_module='studio' FOR UPDATE;
  IF NOT FOUND THEN RETURN false;END IF;
  PERFORM 1 FROM public.enterprise_module_input_bundle_versions
   WHERE id=package.studio_input_bundle_version_id AND input_bundle_id=package.studio_input_bundle_id
     AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF NOT FOUND THEN RETURN false;END IF;
 END IF;
 IF package.source_mode='manual_brief' THEN
  PERFORM 1 FROM public.studio_artifact_manual_brief_materials
   WHERE source_package_id=package.id AND artifact_id=package.artifact_id
     AND org_id=p_org AND workspace_id=p_workspace FOR SHARE;
  IF NOT FOUND THEN RETURN false;END IF;
 END IF;
 RETURN public.studio_pr_b_source_package_is_current(package.id,p_org,p_workspace);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_reserve_provider_budget_v2(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_receipt uuid,p_attempt uuid,p_execution_token uuid,p_execution_fence bigint,
 p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
 p_estimated_input_tokens integer,p_maximum_output_tokens integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE receipt public.studio_artifact_command_receipts;attempt public.studio_artifact_generation_attempts;
 route public.enterprise_ai_capability_routes;config public.ai_provider_configs;flags public.enterprise_transcript_workspace_flags;
 reservation public.enterprise_ai_budget_reservations;daily_limit bigint;monthly_limit bigint;daily_used bigint;monthly_used bigint;
 day_value date:=(statement_timestamp() AT TIME ZONE 'UTC')::date;
 month_value date:=date_trunc('month',statement_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF p_capability<>'studio.document.generate' OR p_provider NOT IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
    OR length(btrim(COALESCE(p_model,''))) NOT BETWEEN 1 AND 200 OR p_estimated_input_tokens<1 OR p_maximum_output_tokens<1
    OR p_execution_fence<1 THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
 PERFORM public.studio_assert_actor(p_actor,p_org,p_workspace,'studio.artifacts.generate',p_authorization_version);
 PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','enterprise-ai-budget',p_org,p_workspace,p_provider,p_capability),0));
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace FOR SHARE;
 SELECT * INTO receipt FROM public.studio_artifact_command_receipts
  WHERE id=p_receipt AND actor_id=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts
  WHERE id=p_attempt AND requested_by=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 IF attempt.id IS NOT NULL AND NOT public.studio_pr_b_lock_source_package_current(attempt.source_package_id,p_org,p_workspace) THEN
  RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';
 END IF;
 SELECT * INTO route FROM public.enterprise_ai_capability_routes
  WHERE id=p_route AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO config FROM public.ai_provider_configs WHERE id=p_provider_config AND org_id=p_org FOR UPDATE;
 IF flags.org_id IS NULL OR NOT flags.unified_byok_gateway_enabled
    OR receipt.id IS NULL OR receipt.status<>'committed' OR receipt.command_type<>'studio.artifact.generation.request.v2'
    OR receipt.resource_id IS DISTINCT FROM attempt.artifact_id OR receipt.response->>'attemptId' IS DISTINCT FROM attempt.id::text
    OR attempt.id IS NULL OR attempt.requester_authorization_version IS DISTINCT FROM p_authorization_version
    OR attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_fence IS DISTINCT FROM p_execution_fence
    OR attempt.state<>'generating' OR attempt.provider_route_id IS DISTINCT FROM p_route
    OR attempt.provider_config_id IS DISTINCT FROM p_provider_config OR attempt.provider_name IS DISTINCT FROM p_provider
    OR attempt.provider_model IS DISTINCT FROM p_model OR route.id IS NULL OR NOT route.enabled OR route.deleted_at IS NOT NULL
    OR route.provider_config_id IS DISTINCT FROM p_provider_config OR route.capability IS DISTINCT FROM p_capability
    OR route.model IS DISTINCT FROM p_model OR config.id IS NULL OR config.status<>'active' OR config.deleted_at IS NOT NULL
    OR config.provider IS DISTINCT FROM p_provider OR NOT(p_model=ANY(config.model_allowlist))
    OR config.last_validated_at IS NULL OR config.last_validated_at>statement_timestamp()
    OR config.last_validated_at<statement_timestamp()-interval '24 hours' THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
 END IF;
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
  WHERE studio_receipt_id=p_receipt OR studio_attempt_id=p_attempt FOR UPDATE;
 IF reservation.id IS NOT NULL THEN
  IF reservation.authority_kind<>'studio' OR reservation.actor_id IS DISTINCT FROM p_actor
     OR reservation.org_id IS DISTINCT FROM p_org OR reservation.workspace_id IS DISTINCT FROM p_workspace
     OR reservation.studio_receipt_id IS DISTINCT FROM p_receipt OR reservation.studio_attempt_id IS DISTINCT FROM p_attempt
     OR reservation.route_id IS DISTINCT FROM p_route OR reservation.provider_config_id IS DISTINCT FROM p_provider_config
     OR reservation.provider IS DISTINCT FROM p_provider OR reservation.capability IS DISTINCT FROM p_capability
     OR reservation.model IS DISTINCT FROM p_model
     OR reservation.execution_token IS DISTINCT FROM p_execution_token
     OR reservation.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
  IF reservation.state='reserved' AND reservation.studio_transfer_pending THEN
   UPDATE public.enterprise_ai_budget_reservations SET studio_transfer_pending=false,updated_at=statement_timestamp()
   WHERE id=reservation.id RETURNING * INTO reservation;
   RETURN public.enterprise_ai_budget_result(reservation,true,false);
  END IF;
  RETURN public.enterprise_ai_budget_result(reservation,false,true);
 END IF;
 daily_limit:=CASE WHEN(config.budget_policy->>'dailyRequests')~'^[1-9][0-9]*$' THEN(config.budget_policy->>'dailyRequests')::bigint END;
 monthly_limit:=CASE WHEN(config.budget_policy->>'monthlyTokens')~'^[1-9][0-9]*$' THEN(config.budget_policy->>'monthlyTokens')::bigint END;
 SELECT count(*) FILTER(WHERE day_bucket=day_value),
  COALESCE(sum(CASE WHEN state='settled' THEN actual_total_tokens ELSE reserved_tokens END) FILTER(WHERE month_bucket=month_value),0)
 INTO daily_used,monthly_used FROM public.enterprise_ai_budget_reservations
 WHERE org_id=p_org AND workspace_id=p_workspace AND provider=p_provider AND capability=p_capability
  AND state IN('reserved','settled','uncertain');
 IF(daily_limit IS NOT NULL AND daily_used+1>daily_limit)
    OR(monthly_limit IS NOT NULL AND monthly_used+p_estimated_input_tokens+p_maximum_output_tokens>monthly_limit) THEN
  RETURN jsonb_build_object('errorCode','BUDGET_EXHAUSTED');
 END IF;
 INSERT INTO public.enterprise_ai_budget_reservations(
  receipt_id,job_id,authority_kind,studio_receipt_id,studio_attempt_id,org_id,workspace_id,actor_id,authorization_version,
  route_id,provider_config_id,provider,capability,model,state,estimated_input_tokens,maximum_output_tokens,
  execution_token,execution_fence,day_bucket,month_bucket
 ) VALUES(NULL,NULL,'studio',p_receipt,p_attempt,p_org,p_workspace,p_actor,p_authorization_version,p_route,p_provider_config,
  p_provider,p_capability,p_model,'reserved',p_estimated_input_tokens,p_maximum_output_tokens,p_execution_token,p_execution_fence,
  day_value,month_value) RETURNING * INTO reservation;
 RETURN public.enterprise_ai_budget_result(reservation,true,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN
 IF SQLERRM LIKE '%PR1B_AUTHORIZATION_STALE%' THEN RETURN jsonb_build_object('errorCode','AUTHORIZATION_STALE');END IF;
 IF SQLERRM LIKE '%PR1B_NOT_FOUND%' THEN RETURN jsonb_build_object('errorCode','PERMISSION_DENIED');END IF;
 RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_provider_budget_transition_v2(
 p_operation text,p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,
 p_receipt uuid,p_attempt uuid,p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,
 p_provider text,p_capability text,p_model text,p_reservation uuid,p_input_tokens integer,p_output_tokens integer,
 p_total_tokens integer,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE reservation public.enterprise_ai_budget_reservations;attempt public.studio_artifact_generation_attempts;
BEGIN
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts
  WHERE id=p_attempt AND requested_by=p_actor AND org_id=p_org AND workspace_id=p_workspace FOR UPDATE;
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations WHERE id=p_reservation FOR UPDATE;
 IF p_authorization_version<1 OR reservation.id IS NULL OR reservation.authority_kind<>'studio'
    OR reservation.actor_id IS DISTINCT FROM p_actor OR reservation.org_id IS DISTINCT FROM p_org
    OR reservation.workspace_id IS DISTINCT FROM p_workspace OR reservation.studio_receipt_id IS DISTINCT FROM p_receipt
    OR reservation.studio_attempt_id IS DISTINCT FROM p_attempt OR reservation.route_id IS DISTINCT FROM p_route
    OR reservation.provider_config_id IS DISTINCT FROM p_provider_config OR reservation.provider IS DISTINCT FROM p_provider
    OR reservation.capability IS DISTINCT FROM p_capability OR reservation.model IS DISTINCT FROM p_model
    OR reservation.execution_token IS DISTINCT FROM p_execution_token OR reservation.execution_fence IS DISTINCT FROM p_execution_fence
    OR attempt.id IS NULL OR attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_fence IS DISTINCT FROM p_execution_fence THEN
  RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';
 END IF;
 IF p_operation='settle' THEN
  IF reservation.state='settled' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true);END IF;
  IF reservation.state NOT IN('reserved','uncertain') OR p_input_tokens<0 OR p_output_tokens<0 OR p_total_tokens<1
     OR p_total_tokens<>p_input_tokens+p_output_tokens THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='settled',actual_input_tokens=p_input_tokens,
   actual_output_tokens=p_output_tokens,actual_total_tokens=p_total_tokens,studio_transfer_pending=false,
   updated_at=statement_timestamp(),settled_at=statement_timestamp()
  WHERE id=reservation.id RETURNING * INTO reservation;
 ELSIF p_operation='uncertain' THEN
  IF reservation.state IN('settled','uncertain') THEN RETURN public.enterprise_ai_budget_result(reservation,false,true);END IF;
  IF reservation.state<>'reserved' OR p_reason!~'^[a-z0-9_]{1,80}$' THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='uncertain',failure_class=p_reason,studio_transfer_pending=false,updated_at=statement_timestamp()
  WHERE id=reservation.id RETURNING * INTO reservation;
 ELSIF p_operation='release' THEN
  IF reservation.state='released' THEN RETURN public.enterprise_ai_budget_result(reservation,false,true);END IF;
  IF p_reason NOT IN('before_provider_effect','reconciled_no_effect') OR reservation.state='settled'
     OR(reservation.state='uncertain' AND p_reason<>'reconciled_no_effect') THEN RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
  UPDATE public.enterprise_ai_budget_reservations SET state='released',release_reason=p_reason,studio_transfer_pending=false,
   updated_at=statement_timestamp(),settled_at=statement_timestamp() WHERE id=reservation.id RETURNING * INTO reservation;
 ELSE RAISE EXCEPTION 'ENTERPRISE_AI_PROVIDER_ROUTE_STALE';END IF;
 RETURN public.enterprise_ai_budget_result(reservation,false,false);
EXCEPTION WHEN SQLSTATE 'P0001' THEN RETURN jsonb_build_object('errorCode','PROVIDER_ROUTE_STALE');
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_settle_provider_budget_v2(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_attempt uuid,
 p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
 p_reservation uuid,p_input_tokens integer,p_output_tokens integer,p_total_tokens integer
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.studio_artifact_provider_budget_transition_v2('settle',p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_attempt,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model,p_reservation,
  p_input_tokens,p_output_tokens,p_total_tokens,NULL)
$$;
CREATE OR REPLACE FUNCTION public.studio_artifact_mark_provider_budget_uncertain_v2(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_attempt uuid,
 p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
 p_reservation uuid,p_failure_class text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.studio_artifact_provider_budget_transition_v2('uncertain',p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_attempt,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model,p_reservation,NULL,NULL,NULL,p_failure_class)
$$;
CREATE OR REPLACE FUNCTION public.studio_artifact_release_provider_budget_v2(
 p_actor uuid,p_org uuid,p_workspace uuid,p_authorization_version bigint,p_receipt uuid,p_attempt uuid,
 p_execution_token uuid,p_execution_fence bigint,p_route uuid,p_provider_config uuid,p_provider text,p_capability text,p_model text,
 p_reservation uuid,p_release_reason text
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT public.studio_artifact_provider_budget_transition_v2('release',p_actor,p_org,p_workspace,p_authorization_version,p_receipt,p_attempt,
  p_execution_token,p_execution_fence,p_route,p_provider_config,p_provider,p_capability,p_model,p_reservation,NULL,NULL,NULL,p_release_reason)
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_source_package_create(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE actor uuid;org uuid;workspace uuid;artifact_id uuid;source_package_id uuid;request_id uuid;authorization_version bigint;
 payload jsonb;source_mode text;artifact_type text;flags public.enterprise_transcript_workspace_flags;bundle public.enterprise_module_input_bundles;
 bundle_version public.enterprise_module_input_bundle_versions;artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;
 material public.studio_artifact_manual_brief_materials;receipt public.studio_artifact_command_receipts;
 route_snapshot jsonb;route_hash text;package_hash text;manual_brief_hash text;candidate_manifest jsonb:='[]'::jsonb;
 candidate_manifest_hash text;anchor_manifest jsonb;anchor_manifest_hash text;
 idempotency_key text;request_hash text;result jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR NOT(p_command?&ARRAY['actorId','organizationId','workspaceId','artifactId','sourcePackageId','requestId','idempotencyKey','authorizationVersion','payload'])
    OR(p_command-ARRAY['actorId','organizationId','workspaceId','artifactId','sourcePackageId','requestId','idempotencyKey','authorizationVersion','payload'])<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 BEGIN actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  artifact_id:=(p_command->>'artifactId')::uuid;source_package_id:=(p_command->>'sourcePackageId')::uuid;request_id:=(p_command->>'requestId')::uuid;
  authorization_version:=(p_command->>'authorizationVersion')::bigint;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_COMMAND';END;
 payload:=p_command->'payload';source_mode:=payload->>'sourceMode';artifact_type:=payload->>'artifactType';idempotency_key:=p_command->>'idempotencyKey';
 IF jsonb_typeof(payload)<>'object' OR source_mode NOT IN('direct_transcript_bundle','manual_brief') OR artifact_type NOT IN('brd','frd','pdd')
    OR length(idempotency_key) NOT BETWEEN 8 AND 200
    OR(payload-ARRAY['sourceMode','artifactType','studioInputBundleId','studioInputBundleVersionId','studioInputBundleVersion','manualBrief'])<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 PERFORM public.pr1b_assert_command_authority(actor,org,workspace,'studio.artifacts.generate',authorization_version);
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF flags.org_id IS NULL OR NOT flags.direct_studio_planning_enabled OR NOT flags.studio_multisource_enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF source_mode='direct_transcript_bundle' THEN
  IF NOT(payload?&ARRAY['studioInputBundleId','studioInputBundleVersionId','studioInputBundleVersion']) OR payload?'manualBrief' THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
  SELECT * INTO bundle_version FROM public.enterprise_module_input_bundle_versions WHERE id=(payload->>'studioInputBundleVersionId')::uuid
   AND input_bundle_id=(payload->>'studioInputBundleId')::uuid AND version=(payload->>'studioInputBundleVersion')::bigint
   AND org_id=org AND workspace_id=workspace AND status='locked' FOR SHARE;
  SELECT * INTO bundle FROM public.enterprise_module_input_bundles WHERE id=bundle_version.input_bundle_id AND org_id=org AND workspace_id=workspace AND owner_module='studio' FOR SHARE;
  IF bundle_version.id IS NULL OR bundle.id IS NULL OR bundle.current_version IS DISTINCT FROM bundle_version.version THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
  candidate_manifest:=public.studio_pr_b_candidate_manifest(org,workspace,bundle_version.id);
 ELSE
  IF NOT(payload?'manualBrief') OR length(payload->>'manualBrief') NOT BETWEEN 1 AND 20000 OR payload?'studioInputBundleId' OR payload?'studioInputBundleVersionId' OR payload?'studioInputBundleVersion' THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
  manual_brief_hash:=encode(public.digest(convert_to(payload->>'manualBrief','UTF8'),'sha256'),'hex');
 END IF;
 request_hash:=public.enterprise_sha256_jsonb(p_command-'requestId');
 SELECT * INTO receipt FROM public.studio_artifact_command_receipts stored
  WHERE stored.org_id=org AND stored.actor_id=actor AND stored.command_type='studio.source-package.create' AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.workspace_id IS DISTINCT FROM workspace OR receipt.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF receipt.status='committed' THEN RETURN receipt.response||jsonb_build_object('outcome','replayed');END IF;
  RAISE EXCEPTION 'COMMAND_IN_PROGRESS';
 END IF;
 INSERT INTO public.studio_artifact_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(org,workspace,actor,'studio.source-package.create',idempotency_key,request_id,request_hash,'claimed') RETURNING * INTO receipt;
 candidate_manifest_hash:=public.enterprise_sha256_jsonb(candidate_manifest);
 anchor_manifest:=public.studio_pr_b_anchor_manifest(candidate_manifest,NULL,NULL);
 anchor_manifest_hash:=public.enterprise_sha256_jsonb(anchor_manifest);
 route_snapshot:=public.enterprise_direct_studio_route_policy();route_hash:=public.enterprise_sha256_jsonb(route_snapshot);
 package_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','studio-source-package-1','sourceMode',source_mode,
  'upstreamHandoffId',NULL,'upstreamPackageHash',NULL,'studioInputBundleVersionId',bundle_version.id,'studioBundleHash',bundle_version.bundle_hash,'manualBriefHash',manual_brief_hash,
  'candidateManifestHash',candidate_manifest_hash,'anchorManifestHash',anchor_manifest_hash,
  'artifactType',artifact_type,'routePolicyVersion',1,'routePolicyHash',route_hash));
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=artifact_id FOR UPDATE;
 IF artifact.id IS NOT NULL THEN
  SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=source_package_id AND artifact_id=artifact.id;
  IF source_mode='manual_brief' THEN SELECT * INTO material FROM public.studio_artifact_manual_brief_materials WHERE source_package_id=package.id;END IF;
  IF artifact.org_id IS DISTINCT FROM org OR artifact.workspace_id IS DISTINCT FROM workspace OR package.package_hash IS DISTINCT FROM package_hash
     OR package.source_mode IS DISTINCT FROM source_mode OR(source_mode='manual_brief' AND material.manual_brief_hash IS DISTINCT FROM manual_brief_hash) THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  result:=jsonb_build_object('outcome','replayed','receiptId',receipt.id,'resourceId',artifact.id,'artifactId',artifact.id,'sourcePackageId',package.id,
   'sourcePackageHash',package.package_hash,'sourceMode',package.source_mode,'lineageClassification','not_assessed','planningOnly',true);
  UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=artifact.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
  RETURN result;
 END IF;
 INSERT INTO public.studio_artifact_aggregates(id,org_id,workspace_id,source_package_hash,source_schema_version,rule_set_version,review_schema_version,review_sequence,
  artifact_type,aggregate_version,lifecycle,created_by,source_package_id,source_mode,lineage_classification,planning_only)
 VALUES(artifact_id,org,workspace,package_hash,'studio-source-package-1','not-assessed-planning-only-1','studio-artifact-review-1',0,
  artifact_type,0,'draft',actor,source_package_id,source_mode,'not_assessed',true) RETURNING * INTO artifact;
 INSERT INTO public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id,version,source_mode,studio_input_bundle_id,studio_input_bundle_version_id,
  studio_input_bundle_version,studio_bundle_hash,manual_brief_hash,lineage_classification,planning_only,route_policy_version,route_policy_snapshot,route_policy_hash,package_hash,
  candidate_manifest,candidate_manifest_hash,candidate_count,anchor_manifest,anchor_manifest_hash,anchor_count,created_by)
 VALUES(source_package_id,artifact.id,org,workspace,1,source_mode,bundle.id,bundle_version.id,bundle_version.version,bundle_version.bundle_hash,
  CASE WHEN source_mode='manual_brief' THEN manual_brief_hash END,'not_assessed',true,1,route_snapshot,route_hash,package_hash,
  candidate_manifest,candidate_manifest_hash,jsonb_array_length(candidate_manifest),anchor_manifest,anchor_manifest_hash,jsonb_array_length(anchor_manifest),actor) RETURNING * INTO package;
 IF source_mode='manual_brief' THEN
  INSERT INTO public.studio_artifact_manual_brief_materials(source_package_id,artifact_id,org_id,workspace_id,manual_brief,manual_brief_hash,created_by)
  VALUES(package.id,artifact.id,org,workspace,payload->>'manualBrief',manual_brief_hash,actor);
 END IF;
 result:=jsonb_build_object('outcome','committed','receiptId',receipt.id,'resourceId',artifact.id,'artifactId',artifact.id,'sourcePackageId',package.id,
  'sourcePackageHash',package.package_hash,'sourceMode',package.source_mode,'lineageClassification','not_assessed','planningOnly',true);
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,'studio.source-package.create','studio_artifact',artifact.id,'succeeded',0,
  jsonb_build_object('sourcePackageId',package.id,'sourceMode',package.source_mode,'planningOnly',true));
 UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=artifact.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_manual_brief_material_retrieve(
 p_org uuid,p_workspace uuid,p_source_package uuid
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object(
  'sourcePackageId',material.source_package_id,
  'manualBrief',material.manual_brief,
  'manualBriefHash',material.manual_brief_hash
 )
 FROM public.studio_artifact_manual_brief_materials material
 JOIN public.studio_artifact_source_packages package
   ON package.id=material.source_package_id AND package.artifact_id=material.artifact_id
  AND package.org_id=material.org_id AND package.workspace_id=material.workspace_id
 WHERE material.org_id=p_org AND material.workspace_id=p_workspace
   AND material.source_package_id=p_source_package AND package.source_mode='manual_brief'
$$;
REVOKE ALL ON FUNCTION public.studio_artifact_manual_brief_material_retrieve(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.studio_artifact_manual_brief_material_retrieve(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enterprise_assess_studio_handoff_command(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE actor uuid;org uuid;workspace uuid;request_id uuid;handoff_id uuid;authorization_version bigint;expected_version bigint;
 command_type text;capability text;idempotency_key text;request_hash text;payload jsonb;flags public.enterprise_transcript_workspace_flags;
 receipt public.enterprise_module_handoff_command_receipts;handoff public.enterprise_module_handoffs;handoff_version public.enterprise_module_handoff_versions;
 upstream public.assess_v2_studio_handoffs;assess_case public.assess_v2_cases;
 bundle public.enterprise_module_input_bundles;bundle_version public.enterprise_module_input_bundle_versions;
 review public.enterprise_module_handoff_review_events;source_package public.studio_artifact_source_packages;artifact public.studio_artifact_aggregates;
 artifact_id uuid;source_package_id uuid;target_hash text;route_hash text;route_snapshot jsonb;candidate_manifest jsonb:='[]'::jsonb;
 candidate_manifest_hash text;anchor_manifest jsonb;anchor_manifest_hash text;
 next_status text;outcome text;result jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR NOT(p_command?&ARRAY['actorId','organizationId','workspaceId','requestId','authorizationVersion','expectedVersion','idempotencyKey','commandType','handoffId','payload'])
    OR(p_command-ARRAY['actorId','organizationId','workspaceId','requestId','authorizationVersion','expectedVersion','idempotencyKey','commandType','handoffId','payload'])<>'{}'::jsonb THEN
  RAISE EXCEPTION 'INVALID_COMMAND';
 END IF;
 BEGIN
  actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  request_id:=(p_command->>'requestId')::uuid;authorization_version:=(p_command->>'authorizationVersion')::bigint;
  expected_version:=(p_command->>'expectedVersion')::bigint;handoff_id:=(p_command->>'handoffId')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_COMMAND';END;
 command_type:=p_command->>'commandType';idempotency_key:=p_command->>'idempotencyKey';payload:=p_command->'payload';
 capability:=CASE command_type WHEN 'handoff.request' THEN 'studio.handoffs.request' WHEN 'handoff.review.resolve' THEN 'studio.handoffs.review'
  WHEN 'handoff.approval.resolve' THEN 'studio.handoffs.approve' WHEN 'handoff.withdraw' THEN 'studio.handoffs.request'
  WHEN 'handoff.consume' THEN 'studio.handoffs.consume' ELSE NULL END;
 IF capability IS NULL OR jsonb_typeof(payload)<>'object' OR length(idempotency_key) NOT BETWEEN 8 AND 128 OR expected_version<0 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 PERFORM public.pr1b_assert_command_authority(actor,org,workspace,capability,authorization_version);
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF flags.org_id IS NULL OR NOT flags.module_handoffs_enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 request_hash:=public.enterprise_sha256_jsonb(p_command-'requestId');
 SELECT * INTO receipt FROM public.enterprise_module_handoff_command_receipts stored
 WHERE stored.org_id=org AND stored.actor_id=actor AND stored.command_type=command_type AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.workspace_id IS DISTINCT FROM workspace OR receipt.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF receipt.status='committed' THEN RETURN receipt.response||jsonb_build_object('outcome','replayed');END IF;
  RAISE EXCEPTION 'COMMAND_IN_PROGRESS';
 END IF;
 INSERT INTO public.enterprise_module_handoff_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(org,workspace,actor,command_type,idempotency_key,request_id,request_hash,'claimed') RETURNING * INTO receipt;
 SELECT * INTO handoff FROM public.enterprise_module_handoffs WHERE id=handoff_id FOR UPDATE;

 IF command_type='handoff.request' THEN
  IF handoff.id IS NOT NULL OR expected_version<>0 OR NOT(payload?&ARRAY['upstreamHandoffId','artifactType'])
     OR(payload-ARRAY['upstreamHandoffId','artifactType','targetInputBundleId','targetInputBundleVersion','targetInputBundleVersionId'])<>'{}'::jsonb
     OR payload->>'artifactType' NOT IN('brd','frd','pdd') THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
  SELECT * INTO upstream FROM public.assess_v2_studio_handoffs
   WHERE id=(payload->>'upstreamHandoffId')::uuid AND org_id=org AND workspace_id=workspace FOR SHARE;
  IF upstream.id IS NULL OR NOT public.studio_pr_b_upstream_handoff_is_current(upstream.id,org,workspace) THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
  IF EXISTS(SELECT 1 FROM public.studio_artifact_aggregates existing WHERE existing.org_id=org AND existing.workspace_id=workspace AND existing.handoff_id=upstream.id) THEN
   RAISE EXCEPTION 'HANDOFF_ALREADY_CONSUMED_LEGACY';
  END IF;
  bundle:=NULL;bundle_version:=NULL;
  IF payload?'targetInputBundleVersionId' THEN
   IF NOT(payload?&ARRAY['targetInputBundleId','targetInputBundleVersion','targetInputBundleVersionId'])
      OR COALESCE(payload->>'targetInputBundleVersion','')!~'^[1-9][0-9]*$' THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
   SELECT * INTO bundle_version FROM public.enterprise_module_input_bundle_versions
    WHERE id=(payload->>'targetInputBundleVersionId')::uuid AND input_bundle_id=(payload->>'targetInputBundleId')::uuid
      AND version=(payload->>'targetInputBundleVersion')::bigint AND org_id=org AND workspace_id=workspace AND status='locked' FOR SHARE;
   SELECT * INTO bundle FROM public.enterprise_module_input_bundles
    WHERE id=bundle_version.input_bundle_id AND org_id=org AND workspace_id=workspace AND owner_module='studio' FOR SHARE;
   IF bundle_version.id IS NULL OR bundle.id IS NULL OR bundle.current_version IS DISTINCT FROM bundle_version.version THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
   candidate_manifest:=public.studio_pr_b_candidate_manifest(org,workspace,bundle_version.id);
  END IF;
  candidate_manifest_hash:=public.enterprise_sha256_jsonb(candidate_manifest);
  anchor_manifest:=public.studio_pr_b_anchor_manifest(candidate_manifest,upstream.source_version_id,upstream.package_hash);
  anchor_manifest_hash:=public.enterprise_sha256_jsonb(anchor_manifest);
  route_snapshot:=public.enterprise_assess_studio_route_policy();
  route_hash:=public.enterprise_sha256_jsonb(route_snapshot);
  target_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','studio-source-package-1','sourceMode',CASE WHEN bundle_version.id IS NULL THEN 'assess_handoff' ELSE 'assess_plus_transcript_bundle' END,
   'upstreamHandoffId',upstream.id,'upstreamPackageHash',upstream.package_hash,'studioInputBundleVersionId',bundle_version.id,
   'studioBundleHash',bundle_version.bundle_hash,'manualBriefHash',NULL,'candidateManifestHash',candidate_manifest_hash,
   'anchorManifestHash',anchor_manifest_hash,
   'artifactType',payload->>'artifactType','routePolicyVersion',1,'routePolicyHash',route_hash));
  INSERT INTO public.enterprise_module_handoffs(id,org_id,workspace_id,from_module,to_module,upstream_handoff_id,upstream_package_hash,
   target_input_bundle_id,target_input_bundle_version_id,target_input_bundle_version,target_input_bundle_hash,artifact_type,lineage_classification,planning_only,
   route_policy_version,route_policy_snapshot,route_policy_hash,target_package_hash,candidate_manifest,candidate_manifest_hash,candidate_count,
   anchor_manifest,anchor_manifest_hash,anchor_count,
   status,current_version,requested_by,expires_at)
  VALUES(handoff_id,org,workspace,'assess','studio',upstream.id,upstream.package_hash,bundle.id,bundle_version.id,bundle_version.version,bundle_version.bundle_hash,
   payload->>'artifactType',CASE WHEN bundle_version.id IS NULL THEN 'assessed' ELSE 'mixed' END,false,1,
   route_snapshot,route_hash,target_hash,candidate_manifest,candidate_manifest_hash,jsonb_array_length(candidate_manifest),
   anchor_manifest,anchor_manifest_hash,jsonb_array_length(anchor_manifest),'requested',1,actor,
   statement_timestamp()+make_interval(secs=>(route_snapshot->>'handoffTtlSeconds')::double precision)) RETURNING * INTO handoff;
 ELSIF handoff.id IS NULL OR handoff.org_id IS DISTINCT FROM org OR handoff.workspace_id IS DISTINCT FROM workspace OR handoff.current_version IS DISTINCT FROM expected_version THEN
  RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';
 ELSIF command_type IN('handoff.review.resolve','handoff.approval.resolve','handoff.consume') AND handoff.status<>'consumed'
    AND handoff.expires_at<=statement_timestamp() THEN
  RAISE EXCEPTION 'HANDOFF_EXPIRED';
 ELSIF command_type='handoff.review.resolve' THEN
  IF handoff.status NOT IN('requested','target_review','changes_requested') OR actor=handoff.requested_by
     OR payload->>'outcome' NOT IN('approve','changes_requested','reject') OR length(btrim(COALESCE(payload->>'rationale',''))) NOT BETWEEN 1 AND 4000 THEN
   RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';
  END IF;
  outcome:=CASE payload->>'outcome' WHEN 'approve' THEN 'approved' WHEN 'changes_requested' THEN 'changes_requested' ELSE 'rejected' END;
  next_status:=CASE outcome WHEN 'approved' THEN 'approval_ready' ELSE outcome END;
  INSERT INTO public.enterprise_module_handoff_review_events(handoff_id,org_id,workspace_id,reviewer_id,reviewer_authorization_version,outcome,rationale)
  VALUES(handoff.id,org,workspace,actor,authorization_version,outcome,btrim(payload->>'rationale')) RETURNING * INTO review;
  UPDATE public.enterprise_module_handoffs SET status=next_status,current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id RETURNING * INTO handoff;
 ELSIF command_type='handoff.approval.resolve' THEN
  SELECT * INTO review FROM public.enterprise_module_handoff_review_events handoff_review WHERE handoff_review.handoff_id=handoff.id;
  IF handoff.status<>'approval_ready' OR review.id IS NULL OR actor IN(handoff.requested_by,review.reviewer_id)
     OR payload->>'outcome' NOT IN('approve','reject') OR length(btrim(COALESCE(payload->>'rationale',''))) NOT BETWEEN 1 AND 4000 THEN
   RAISE EXCEPTION 'STUDIO_SEPARATION_OF_DUTY';
  END IF;
  next_status:=CASE payload->>'outcome' WHEN 'approve' THEN 'approved' ELSE 'rejected' END;
  INSERT INTO public.enterprise_module_handoff_approval_events(handoff_id,review_event_id,org_id,workspace_id,approver_id,approver_authorization_version,outcome,rationale)
  VALUES(handoff.id,review.id,org,workspace,actor,authorization_version,next_status,btrim(payload->>'rationale'));
  UPDATE public.enterprise_module_handoffs SET status=next_status,current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id RETURNING * INTO handoff;
 ELSIF command_type='handoff.withdraw' THEN
  IF handoff.requested_by<>actor OR handoff.status NOT IN('requested','changes_requested') OR length(COALESCE(payload->>'reason',''))>4000 THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  UPDATE public.enterprise_module_handoffs SET status='withdrawn',current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id RETURNING * INTO handoff;
 ELSIF command_type='handoff.consume' THEN
  IF handoff.status='consumed' THEN
   SELECT * INTO source_package FROM public.studio_artifact_source_packages WHERE id=(SELECT consumed.source_package_id FROM public.enterprise_module_handoff_consumptions consumed WHERE consumed.handoff_id=handoff.id);
   SELECT * INTO handoff_version FROM public.enterprise_module_handoff_versions WHERE handoff_id=handoff.id AND version=handoff.current_version;
   result:=jsonb_build_object('outcome','replayed','handoffId',handoff.id,'version',handoff.current_version,'status',handoff.status,
    'handoffVersionId',handoff_version.id,'expiresAt',handoff.expires_at,
    'resourceId',source_package.artifact_id,'sourcePackageId',source_package.id,'sourcePackageHash',source_package.package_hash);
   UPDATE public.enterprise_module_handoff_command_receipts SET status='committed',resource_id=source_package.artifact_id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
   RETURN result;
  END IF;
  IF handoff.status<>'approved' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
  SELECT * INTO upstream FROM public.assess_v2_studio_handoffs
   WHERE id=handoff.upstream_handoff_id AND org_id=org AND workspace_id=workspace;
  -- Assess writers lock the exact case before appending a newer accepted
  -- handoff. Holding that same case lock makes the currentness recheck and the
  -- target Studio effect one serial order with every governed Assess transition.
  SELECT * INTO assess_case FROM public.assess_v2_cases
   WHERE id=upstream.case_id AND org_id=org AND workspace_id=workspace FOR UPDATE;
  SELECT * INTO upstream FROM public.assess_v2_studio_handoffs
   WHERE id=handoff.upstream_handoff_id AND org_id=org AND workspace_id=workspace FOR SHARE;
  IF assess_case.id IS NULL OR upstream.id IS NULL OR upstream.package_hash IS DISTINCT FROM handoff.upstream_package_hash
     OR NOT public.studio_pr_b_upstream_handoff_is_current(upstream.id,org,workspace) THEN
   UPDATE public.enterprise_module_handoffs SET status='stale',current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id RETURNING * INTO handoff;
  ELSIF handoff.target_input_bundle_version_id IS NOT NULL THEN
   SELECT * INTO bundle_version FROM public.enterprise_module_input_bundle_versions
    WHERE id=handoff.target_input_bundle_version_id AND input_bundle_id=handoff.target_input_bundle_id AND version=handoff.target_input_bundle_version
      AND org_id=org AND workspace_id=workspace AND status='locked' AND bundle_hash=handoff.target_input_bundle_hash FOR SHARE;
   SELECT * INTO bundle FROM public.enterprise_module_input_bundles
    WHERE id=handoff.target_input_bundle_id AND org_id=org AND workspace_id=workspace AND owner_module='studio' FOR SHARE;
   IF bundle_version.id IS NULL OR bundle.id IS NULL OR bundle.current_version IS DISTINCT FROM bundle_version.version THEN
    UPDATE public.enterprise_module_handoffs SET status='stale',current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id RETURNING * INTO handoff;
   END IF;
  END IF;
  IF handoff.status='stale' THEN
   result:=jsonb_build_object('outcome','committed','handoffId',handoff.id,'version',handoff.current_version,'status','stale');
  ELSE
   artifact_id:=public.studio_pr_b_deterministic_uuid('assess-studio-handoff-artifact',handoff.id);
   source_package_id:=public.studio_pr_b_deterministic_uuid('assess-studio-handoff-package',handoff.id);
   INSERT INTO public.studio_artifact_aggregates(id,org_id,workspace_id,case_id,source_version_id,source_case_version,decision_id,decision_version,
    review_resolution_id,govern_resolution_id,handoff_id,source_package_hash,source_schema_version,rule_set_version,review_schema_version,review_sequence,
    artifact_type,aggregate_version,lifecycle,created_by,source_package_id,source_mode,lineage_classification,planning_only)
   VALUES(artifact_id,org,workspace,upstream.case_id,upstream.source_version_id,upstream.source_case_version,upstream.decision_id,upstream.decision_version,
    upstream.review_resolution_id,upstream.govern_resolution_id,upstream.id,handoff.target_package_hash,upstream.schema_version,upstream.rule_set_version,
    upstream.review_schema_version,upstream.review_sequence,handoff.artifact_type,0,'draft',actor,source_package_id,
    CASE WHEN handoff.target_input_bundle_version_id IS NULL THEN 'assess_handoff' ELSE 'assess_plus_transcript_bundle' END,handoff.lineage_classification,false)
   RETURNING * INTO artifact;
   INSERT INTO public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id,version,source_mode,assess_handoff_id,assess_package_hash,
    studio_input_bundle_id,studio_input_bundle_version_id,studio_input_bundle_version,studio_bundle_hash,lineage_classification,planning_only,
    route_policy_version,route_policy_snapshot,route_policy_hash,package_hash,candidate_manifest,candidate_manifest_hash,candidate_count,
    anchor_manifest,anchor_manifest_hash,anchor_count,created_by)
   VALUES(source_package_id,artifact.id,org,workspace,1,artifact.source_mode,upstream.id,upstream.package_hash,handoff.target_input_bundle_id,
    handoff.target_input_bundle_version_id,handoff.target_input_bundle_version,handoff.target_input_bundle_hash,handoff.lineage_classification,false,
    handoff.route_policy_version,handoff.route_policy_snapshot,handoff.route_policy_hash,handoff.target_package_hash,
    handoff.candidate_manifest,handoff.candidate_manifest_hash,handoff.candidate_count,
    handoff.anchor_manifest,handoff.anchor_manifest_hash,handoff.anchor_count,actor) RETURNING * INTO source_package;
   INSERT INTO public.enterprise_module_handoff_consumptions(handoff_id,org_id,workspace_id,artifact_id,source_package_id,source_package_hash,consumed_by,consumer_authorization_version)
   VALUES(handoff.id,org,workspace,artifact.id,source_package.id,source_package.package_hash,actor,authorization_version);
   UPDATE public.enterprise_module_handoffs SET status='consumed',current_version=current_version+1,updated_at=statement_timestamp() WHERE id=handoff.id RETURNING * INTO handoff;
   result:=jsonb_build_object('outcome','committed','handoffId',handoff.id,'version',handoff.current_version,'status','consumed',
    'resourceId',artifact.id,'sourcePackageId',source_package.id,'sourcePackageHash',source_package.package_hash);
  END IF;
 END IF;
 INSERT INTO public.enterprise_module_handoff_versions(handoff_id,org_id,workspace_id,version,status,actor_id,actor_authorization_version,reason)
 VALUES(handoff.id,org,workspace,handoff.current_version,handoff.status,actor,authorization_version,NULLIF(btrim(COALESCE(payload->>'rationale',payload->>'reason','')),''))
 RETURNING * INTO handoff_version;
 IF result IS NULL THEN result:=jsonb_build_object('outcome','committed','handoffId',handoff.id,'version',handoff.current_version,'status',handoff.status);END IF;
 result:=result||jsonb_build_object('handoffVersionId',handoff_version.id,'expiresAt',handoff.expires_at);
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,command_type,'enterprise_module_handoff',handoff.id,'succeeded',handoff.current_version,
  jsonb_build_object('receiptId',receipt.id,'status',handoff.status,'artifactId',result->>'resourceId'));
 UPDATE public.enterprise_module_handoff_command_receipts SET status='committed',resource_id=COALESCE((result->>'resourceId')::uuid,handoff.id),response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.enterprise_assess_studio_handoff_projection(p_org uuid,p_workspace uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();enabled boolean:=false;handoffs jsonb;eligible jsonb;
BEGIN
 IF actor IS NULL OR NOT public.has_workspace_capability(p_workspace,p_org,'studio.handoffs.read') THEN RETURN NULL;END IF;
 SELECT flags.module_handoffs_enabled INTO enabled FROM public.enterprise_transcript_workspace_flags flags
  WHERE flags.org_id=p_org AND flags.workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'handoffId',handoff.id,'handoffVersionId',version.id,'upstreamHandoffId',handoff.upstream_handoff_id,
   'direction',CASE WHEN handoff.requested_by=actor THEN 'outbox' ELSE 'inbox' END,
   'lifecycle',CASE WHEN handoff.expires_at<=statement_timestamp() AND handoff.status<>'consumed' THEN 'expired'
     WHEN handoff.status IN('requested','target_review') THEN 'reviewer_ready' ELSE handoff.status END,
   'status',handoff.status,'version',handoff.current_version,'sourceModule',handoff.from_module,'targetModule',handoff.to_module,
   'artifactType',handoff.artifact_type,'lineageClassification',handoff.lineage_classification,'planningOnly',handoff.planning_only,
   'hasStudioTranscriptBundle',handoff.target_input_bundle_version_id IS NOT NULL,
   'resourceLabel','Assess '||upper(handoff.artifact_type)||' handoff v'||handoff.current_version::text,
   'requestorLabel',handoff.requested_by::text,'targetWorkspaceLabel','Studio workspace',
   'requestedAt',handoff.requested_at,'updatedAt',handoff.updated_at,'expiresAt',handoff.expires_at,
   'actions',to_jsonb(array_remove(ARRAY[
    CASE WHEN enabled AND handoff.expires_at>statement_timestamp() AND public.has_workspace_capability(p_workspace,p_org,'studio.handoffs.review')
      AND handoff.status IN('requested','target_review','changes_requested') AND handoff.requested_by<>actor THEN 'studio.handoff.review.resolve' END,
    CASE WHEN enabled AND handoff.expires_at>statement_timestamp() AND public.has_workspace_capability(p_workspace,p_org,'studio.handoffs.approve')
      AND handoff.status='approval_ready' AND handoff.requested_by<>actor
      AND NOT EXISTS(SELECT 1 FROM public.enterprise_module_handoff_review_events review WHERE review.handoff_id=handoff.id AND review.reviewer_id=actor) THEN 'studio.handoff.approval.resolve' END,
    CASE WHEN enabled AND handoff.expires_at>statement_timestamp() AND public.has_workspace_capability(p_workspace,p_org,'studio.handoffs.request')
      AND handoff.status IN('requested','changes_requested') AND handoff.requested_by=actor THEN 'studio.handoff.withdraw' END,
    CASE WHEN enabled AND handoff.expires_at>statement_timestamp() AND public.has_workspace_capability(p_workspace,p_org,'studio.handoffs.consume')
      AND handoff.status='approved' THEN 'studio.handoff.consume' END
   ]::text[],NULL))) ORDER BY handoff.updated_at DESC,handoff.id),'[]'::jsonb) INTO handoffs
 FROM public.enterprise_module_handoffs handoff
 JOIN public.enterprise_module_handoff_versions version ON version.handoff_id=handoff.id AND version.version=handoff.current_version
 WHERE handoff.org_id=p_org AND handoff.workspace_id=p_workspace;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'upstreamHandoffId',upstream.id,'direction','inbox','lifecycle','eligible','sourceModule','assess','targetModule','studio',
   'sourceVersion',upstream.source_case_version,'resourceLabel','Accepted Assess handoff v'||upstream.source_case_version::text,
   'requestorLabel',upstream.handed_off_by::text,'targetWorkspaceLabel','Studio workspace','handedOffAt',upstream.handed_off_at,
   'artifactTypes',jsonb_build_array('brd','frd','pdd'),'actions',CASE WHEN enabled AND public.has_workspace_capability(p_workspace,p_org,'studio.handoffs.request')
    THEN jsonb_build_array('studio.handoff.request') ELSE '[]'::jsonb END) ORDER BY upstream.handed_off_at DESC,upstream.id),'[]'::jsonb) INTO eligible
 FROM public.assess_v2_studio_handoffs upstream
 WHERE upstream.org_id=p_org AND upstream.workspace_id=p_workspace
  AND NOT EXISTS(SELECT 1 FROM public.enterprise_module_handoffs existing WHERE existing.org_id=p_org AND existing.workspace_id=p_workspace AND existing.upstream_handoff_id=upstream.id)
  AND public.studio_pr_b_upstream_handoff_is_current(upstream.id,p_org,p_workspace)
  AND NOT EXISTS(SELECT 1 FROM public.studio_artifact_aggregates legacy WHERE legacy.org_id=p_org AND legacy.workspace_id=p_workspace AND legacy.handoff_id=upstream.id);
 RETURN jsonb_build_object('organizationId',p_org,'workspaceId',p_workspace,'eligibleHandoffs',eligible,'handoffs',handoffs);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_request_v2(p_command jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE actor uuid;org uuid;workspace uuid;request_id uuid;artifact_id uuid;source_package_id uuid;template_version_id uuid;
 authorization_version bigint;expected_aggregate_version bigint;expected_current_version_id uuid;expected_approved_version_id uuid;
 idempotency_key text;template_kind text;request_hash text;provider_plan_hash text;input_hash text;
 artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;system_template public.studio_system_template_versions;
 tenant_template public.studio_tenant_template_versions;tenant_aggregate public.studio_tenant_template_aggregates;
 route public.enterprise_ai_capability_routes;config public.ai_provider_configs;flags public.enterprise_transcript_workspace_flags;
 control public.studio_artifact_runtime_control;receipt public.studio_artifact_command_receipts;attempt public.studio_artifact_generation_attempts;
 result jsonb;plan jsonb;audit_id uuid:=gen_random_uuid();
BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object'
    OR NOT(p_command?&ARRAY['actorId','organizationId','workspaceId','requestId','idempotencyKey','authorizationVersion','artifactId','sourcePackageId','templateKind','templateVersionId','expectedAggregateVersion','expectedCurrentVersionId','expectedApprovedVersionId'])
    OR(p_command-ARRAY['actorId','organizationId','workspaceId','requestId','idempotencyKey','authorizationVersion','artifactId','sourcePackageId','templateKind','templateVersionId','expectedAggregateVersion','expectedCurrentVersionId','expectedApprovedVersionId'])<>'{}'::jsonb THEN
  RAISE EXCEPTION 'INVALID_COMMAND';
 END IF;
 BEGIN
  actor:=(p_command->>'actorId')::uuid;org:=(p_command->>'organizationId')::uuid;workspace:=(p_command->>'workspaceId')::uuid;
  request_id:=(p_command->>'requestId')::uuid;artifact_id:=(p_command->>'artifactId')::uuid;source_package_id:=(p_command->>'sourcePackageId')::uuid;
  template_version_id:=(p_command->>'templateVersionId')::uuid;authorization_version:=(p_command->>'authorizationVersion')::bigint;
  expected_aggregate_version:=(p_command->>'expectedAggregateVersion')::bigint;
  expected_current_version_id:=NULLIF(p_command->>'expectedCurrentVersionId','')::uuid;
  expected_approved_version_id:=NULLIF(p_command->>'expectedApprovedVersionId','')::uuid;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INVALID_COMMAND';END;
 idempotency_key:=p_command->>'idempotencyKey';template_kind:=p_command->>'templateKind';
 IF length(idempotency_key) NOT BETWEEN 8 AND 128 OR template_kind NOT IN('system','tenant') OR expected_aggregate_version<0 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 PERFORM public.studio_assert_actor(actor,org,workspace,'studio.artifacts.generate',authorization_version);
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton FOR SHARE;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=org AND workspace_id=workspace FOR SHARE;
 IF control.singleton IS NULL OR NOT control.enabled OR control.read_only OR NOT control.provider_enabled THEN RAISE EXCEPTION 'STUDIO_READ_ONLY';END IF;
 request_hash:=public.enterprise_sha256_jsonb(p_command);
 SELECT * INTO receipt FROM public.studio_artifact_command_receipts stored
  WHERE stored.org_id=org AND stored.actor_id=actor AND stored.command_type='studio.artifact.generation.request.v2' AND stored.idempotency_key=idempotency_key FOR UPDATE;
 IF receipt.id IS NOT NULL THEN
  IF receipt.workspace_id IS DISTINCT FROM workspace OR receipt.request_hash IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'STUDIO_IDEMPOTENCY_CONFLICT';END IF;
  IF receipt.status='committed' THEN
   SELECT * INTO attempt FROM public.studio_artifact_generation_attempts existing WHERE existing.request_id=receipt.request_id AND existing.org_id=org AND existing.requested_by=actor;
   RETURN receipt.response||jsonb_build_object('outcome','replayed','generationPlan',jsonb_build_object(
    'attemptId',attempt.id,'providerRouteId',attempt.provider_route_id,'providerConfigId',attempt.provider_config_id,'provider',attempt.provider_name,
    'model',attempt.provider_model,'capability','studio.document.generate','promptKey',attempt.prompt_key,'promptVersion',attempt.prompt_version,
    'providerPlanHash',attempt.provider_plan_hash,'providerEffectKey',attempt.provider_effect_key,'sourcePackageId',attempt.source_package_id,
    'sourcePackageHash',attempt.source_package_hash,'templateKind',attempt.template_kind,'templateVersionId',COALESCE(attempt.template_id,attempt.tenant_template_version_id),
    'templateVersion',attempt.template_version,'templateHash',attempt.template_hash));
  END IF;
  RAISE EXCEPTION 'COMMAND_IN_PROGRESS';
 END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=artifact_id AND org_id=org AND workspace_id=workspace FOR UPDATE;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=source_package_id AND artifact_id=artifact.id AND org_id=org AND workspace_id=workspace FOR SHARE;
 IF artifact.id IS NULL OR package.id IS NULL OR artifact.source_package_id IS DISTINCT FROM package.id OR artifact.source_package_hash IS DISTINCT FROM package.package_hash
    OR artifact.aggregate_version IS DISTINCT FROM expected_aggregate_version OR artifact.current_version_id IS DISTINCT FROM expected_current_version_id
    OR artifact.current_approved_version_id IS DISTINCT FROM expected_approved_version_id THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF NOT public.studio_pr_b_lock_source_package_current(package.id,org,workspace) THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF package.source_mode<>'assess_handoff' AND(flags.org_id IS NULL OR NOT flags.studio_multisource_enabled) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF package.source_mode='assess_handoff' AND NOT COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false)
    AND(flags.org_id IS NULL OR NOT flags.module_handoffs_enabled) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=template_version_id AND artifact_type=artifact.artifact_type AND superseded_at IS NULL FOR SHARE;
  IF system_template.id IS NULL THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 ELSE
  IF flags.org_id IS NULL OR NOT flags.studio_tenant_templates_enabled THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions WHERE id=template_version_id AND org_id=org AND workspace_id=workspace AND status='approved' FOR SHARE;
  SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates WHERE id=tenant_template.template_id AND org_id=org AND workspace_id=workspace FOR SHARE;
  IF tenant_template.id IS NULL OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id
     OR(tenant_template.artifact_class<>'custom' AND tenant_template.artifact_class IS DISTINCT FROM artifact.artifact_type) THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 END IF;
 SELECT provider_route.* INTO route
 FROM public.enterprise_ai_capability_routes provider_route
 JOIN public.ai_provider_configs provider_config ON provider_config.id=provider_route.provider_config_id AND provider_config.org_id=provider_route.org_id
 WHERE provider_route.org_id=org AND provider_route.workspace_id=workspace AND provider_route.capability='studio.document.generate'
  AND provider_route.enabled AND provider_route.deleted_at IS NULL AND provider_config.status='active' AND provider_config.deleted_at IS NULL
  AND provider_config.provider IN('openai','azure_openai','anthropic','gemini','groq','openai_compatible')
  AND provider_route.model=ANY(provider_config.model_allowlist) AND provider_config.last_validated_at>=statement_timestamp()-interval '24 hours'
  AND provider_config.key_ref_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ai_provider_key_refs key_ref
   WHERE key_ref.id=provider_config.key_ref_id AND key_ref.org_id=org AND key_ref.provider=provider_config.provider
    AND key_ref.resolver_type='server_reference' AND key_ref.status='active' AND key_ref.deleted_at IS NULL
    AND(key_ref.expires_at IS NULL OR key_ref.expires_at>statement_timestamp()))
  AND cardinality(provider_route.allowed_roles)>0 AND EXISTS(
   SELECT 1 FROM public.organization_members member JOIN public.roles role ON role.id=member.role_id AND role.org_id=org
   WHERE member.user_id=actor AND member.org_id=org AND member.status='active' AND member.deleted_at IS NULL AND role.status='active' AND role.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM unnest(provider_route.allowed_roles) allowed(value) WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
   UNION ALL
   SELECT 1 FROM public.workspace_memberships member JOIN public.roles role ON role.id=member.role_id AND role.org_id=org AND role.workspace_id=workspace
   WHERE member.user_id=actor AND member.org_id=org AND member.workspace_id=workspace AND member.status='active' AND member.deleted_at IS NULL
    AND role.status='active' AND role.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM unnest(provider_route.allowed_roles) allowed(value) WHERE lower(allowed.value)=lower(role.name) OR lower(allowed.value)=lower(role.id::text))
 )
 ORDER BY provider_route.version DESC,provider_route.id LIMIT 1 FOR SHARE OF provider_route,provider_config;
 IF route.id IS NULL THEN RAISE EXCEPTION 'PROVIDER_ROUTE_UNAVAILABLE';END IF;
 SELECT * INTO config FROM public.ai_provider_configs provider_config
  WHERE provider_config.id=route.provider_config_id AND provider_config.org_id=org FOR SHARE;
 IF config.id IS NULL THEN RAISE EXCEPTION 'PROVIDER_ROUTE_UNAVAILABLE';END IF;
 provider_plan_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('routeId',route.id,'routeVersion',route.version,'providerConfigId',config.id,
  'provider',config.provider,'model',route.model,'capability','studio.document.generate','promptKey','studio-multisource-generation','promptVersion','studio-pr-b-1','maximumOutputTokens',4000));
 input_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('sourcePackageId',package.id,'sourcePackageHash',package.package_hash,
  'candidateManifestHash',package.candidate_manifest_hash,'anchorManifestHash',package.anchor_manifest_hash,
  'templateKind',template_kind,'templateVersionId',template_version_id,
  'templateHash',CASE template_kind WHEN 'system' THEN system_template.template_hash ELSE tenant_template.template_hash END,
  'providerPlanHash',provider_plan_hash,'expectedAggregateVersion',expected_aggregate_version,'expectedCurrentVersionId',expected_current_version_id,'expectedApprovedVersionId',expected_approved_version_id));
 INSERT INTO public.studio_artifact_command_receipts(org_id,workspace_id,actor_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(org,workspace,actor,'studio.artifact.generation.request.v2',idempotency_key,request_id,request_hash,'claimed') RETURNING * INTO receipt;
 INSERT INTO public.studio_artifact_generation_attempts(artifact_id,org_id,workspace_id,handoff_id,requested_by,request_id,template_id,tenant_template_version_id,
  input_hash,state,source_package_id,source_package_hash,template_kind,template_version,template_hash,expected_aggregate_version,expected_current_version_id,
  expected_approved_version_id,requester_authorization_version,provider_plan_state,provider_route_id,provider_config_id,provider_name,provider_model,
  prompt_key,prompt_version,provider_plan_hash,provider_effect_key,candidate_manifest_hash,candidate_count,
  anchor_manifest_hash,anchor_count,timeout_at)
 VALUES(artifact.id,org,workspace,artifact.handoff_id,actor,request_id,CASE WHEN template_kind='system' THEN system_template.id END,
  CASE WHEN template_kind='tenant' THEN tenant_template.id END,input_hash,'requested',package.id,package.package_hash,template_kind,
  CASE template_kind WHEN 'system' THEN system_template.template_version ELSE tenant_template.version::text END,
  CASE template_kind WHEN 'system' THEN system_template.template_hash ELSE tenant_template.template_hash END,
  expected_aggregate_version+1,expected_current_version_id,expected_approved_version_id,authorization_version,'bound',route.id,config.id,config.provider,route.model,
  'studio-multisource-generation','studio-pr-b-1',provider_plan_hash,encode(public.digest('studio-generation:'||receipt.id::text,'sha256'),'hex'),
  package.candidate_manifest_hash,package.candidate_count,package.anchor_manifest_hash,package.anchor_count,
  statement_timestamp()+interval '10 minutes') RETURNING * INTO attempt;
 UPDATE public.studio_artifact_aggregates SET aggregate_version=aggregate_version+1,updated_at=statement_timestamp() WHERE id=artifact.id RETURNING * INTO artifact;
 plan:=jsonb_build_object('attemptId',attempt.id,'artifactId',artifact.id,'providerRouteId',route.id,'providerRouteVersion',route.version,
  'providerConfigId',config.id,'provider',config.provider,'model',route.model,'capability','studio.document.generate','promptKey',attempt.prompt_key,
  'promptVersion',attempt.prompt_version,'maximumOutputTokens',4000,'providerPlanHash',provider_plan_hash,'providerEffectKey',attempt.provider_effect_key,
  'sourcePackageId',package.id,'sourcePackageHash',package.package_hash,'candidateManifestHash',package.candidate_manifest_hash,
  'candidateCount',package.candidate_count,'anchorManifestHash',package.anchor_manifest_hash,'anchorCount',package.anchor_count,
  'templateKind',template_kind,'templateVersionId',template_version_id,
  'templateVersion',attempt.template_version,'templateHash',attempt.template_hash,'expectedAggregateVersion',attempt.expected_aggregate_version,
  'expectedCurrentVersionId',attempt.expected_current_version_id,'expectedApprovedVersionId',attempt.expected_approved_version_id);
 result:=jsonb_build_object('outcome','committed','receiptId',receipt.id,'resourceId',artifact.id,'attemptId',attempt.id,'state','requested');
 UPDATE public.studio_artifact_command_receipts SET status='committed',resource_id=artifact.id,response=result,completed_at=statement_timestamp() WHERE id=receipt.id;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,org,workspace,actor,request_id,'studio.artifact.generation.request.v2','studio_generation_attempt',attempt.id,'succeeded',artifact.aggregate_version,
  jsonb_build_object('receiptId',receipt.id,'artifactId',artifact.id,'sourcePackageId',package.id,'templateVersionId',template_version_id,
   'providerRouteId',route.id,'providerPlanHash',provider_plan_hash));
 RETURN result||jsonb_build_object('generationPlan',plan);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_claim_v2(p_attempt_id uuid,p_execution_token uuid,p_lease_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;artifact public.studio_artifact_aggregates;source_package public.studio_artifact_source_packages;
 system_template public.studio_system_template_versions;tenant_template public.studio_tenant_template_versions;tenant_aggregate public.studio_tenant_template_aggregates;
 staged public.studio_generation_staged_responses;reservation public.enterprise_ai_budget_reservations;
 flags public.enterprise_transcript_workspace_flags;reconcile_only boolean:=false;reservation_authoritative boolean:=false;
 transfer_released_before_effect boolean:=false;result jsonb;
BEGIN
 IF p_execution_token IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 PERFORM public.studio_assert_actor(attempt.requested_by,attempt.org_id,attempt.workspace_id,'studio.artifacts.generate',attempt.requester_authorization_version);
 IF attempt.state IN('completed','stale_completed') THEN
  RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state',attempt.state,'providerAllowed',false,'reconcileOnly',false);
 END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates
  WHERE id=attempt.artifact_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
 SELECT * INTO source_package FROM public.studio_artifact_source_packages
  WHERE id=attempt.source_package_id AND artifact_id=artifact.id AND org_id=artifact.org_id AND workspace_id=artifact.workspace_id FOR SHARE;
 IF artifact.id IS NULL OR source_package.id IS NULL OR source_package.package_hash IS DISTINCT FROM attempt.source_package_hash
    OR artifact.source_package_id IS DISTINCT FROM source_package.id OR artifact.source_package_hash IS DISTINCT FROM source_package.package_hash THEN
  RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';
 END IF;
 IF artifact.aggregate_version IS DISTINCT FROM attempt.expected_aggregate_version
    OR artifact.current_version_id IS DISTINCT FROM attempt.expected_current_version_id
    OR artifact.current_approved_version_id IS DISTINCT FROM attempt.expected_approved_version_id THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF NOT public.studio_pr_b_lock_source_package_current(source_package.id,attempt.org_id,attempt.workspace_id) THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 -- Global deadlock-safe Studio order is attempt -> source currentness locks ->
 -- optional budget reservation. Reserve uses the same source-before-reservation
 -- edge after its scoped advisory/receipt locks; no source producer waits on a
 -- Studio attempt or reservation.
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
  WHERE studio_attempt_id=attempt.id FOR UPDATE;
 reservation_authoritative:=reservation.id IS NOT NULL AND reservation.state IN('reserved','uncertain','settled','released');
 transfer_released_before_effect:=reservation.id IS NOT NULL AND reservation.state='released'
  AND reservation.release_reason='before_provider_effect' AND NOT reservation.studio_transfer_pending;
 IF attempt.template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=attempt.template_id FOR SHARE;
  IF system_template.id IS NULL OR system_template.superseded_at IS NOT NULL OR system_template.template_hash IS DISTINCT FROM attempt.template_hash
     OR system_template.template_version IS DISTINCT FROM attempt.template_version OR system_template.artifact_type IS DISTINCT FROM artifact.artifact_type THEN
   RAISE EXCEPTION 'TEMPLATE_STALE';
  END IF;
 ELSE
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions
   WHERE id=attempt.tenant_template_version_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
  SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates
   WHERE id=tenant_template.template_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
  IF tenant_template.id IS NULL OR tenant_template.status<>'approved' OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id
     OR tenant_template.template_hash IS DISTINCT FROM attempt.template_hash OR tenant_template.version::text IS DISTINCT FROM attempt.template_version
     OR(tenant_template.artifact_class<>'custom' AND tenant_template.artifact_class IS DISTINCT FROM artifact.artifact_type) THEN
   RAISE EXCEPTION 'TEMPLATE_STALE';
  END IF;
 END IF;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
 IF source_package.source_mode<>'assess_handoff' AND(flags.org_id IS NULL OR NOT flags.studio_multisource_enabled) THEN RAISE EXCEPTION 'STUDIO_FEATURE_DISABLED';END IF;
 IF attempt.state='response_staged' THEN
  SELECT * INTO staged FROM public.studio_generation_staged_responses
   WHERE attempt_id=attempt.id AND response_hash=attempt.response_hash FOR UPDATE;
  IF staged.id IS NULL THEN RAISE EXCEPTION 'GENERATION_RESPONSE_NOT_AVAILABLE';END IF;
  reconcile_only:=true;
 ELSIF attempt.state='reconciling' THEN
  SELECT * INTO staged FROM public.studio_generation_staged_responses
   WHERE attempt_id=attempt.id AND response_hash=attempt.response_hash FOR UPDATE;
  IF staged.id IS NULL AND NOT reservation_authoritative THEN RAISE EXCEPTION 'GENERATION_RESPONSE_NOT_AVAILABLE';END IF;
  IF attempt.execution_token=p_execution_token AND attempt.execution_lease_expires_at>statement_timestamp() THEN
   RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'executionToken',attempt.execution_token,'executionFence',attempt.execution_fence,
    'leaseExpiresAt',attempt.execution_lease_expires_at,'providerAllowed',false,'reconcileOnly',true,'responseHash',staged.response_hash);
  END IF;
  IF attempt.execution_lease_expires_at>statement_timestamp() THEN RAISE EXCEPTION 'COMMAND_IN_PROGRESS';END IF;
  reconcile_only:=true;
 ELSIF attempt.state='generating' THEN
  IF attempt.execution_token=p_execution_token AND attempt.execution_lease_expires_at>statement_timestamp() THEN
   RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'executionToken',attempt.execution_token,'executionFence',attempt.execution_fence,
    'leaseExpiresAt',attempt.execution_lease_expires_at,'providerAllowed',true,'reconcileOnly',false,'providerEffectKey',attempt.provider_effect_key);
  END IF;
  IF attempt.execution_lease_expires_at>statement_timestamp() THEN RAISE EXCEPTION 'COMMAND_IN_PROGRESS';END IF;
  reconcile_only:=reservation_authoritative AND NOT transfer_released_before_effect;
 ELSIF attempt.state='requested' THEN
  reconcile_only:=reservation_authoritative AND NOT transfer_released_before_effect;
 ELSE RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 UPDATE public.studio_artifact_generation_attempts SET execution_token=p_execution_token,execution_fence=execution_fence+1,
  execution_lease_expires_at=statement_timestamp()+make_interval(secs=>p_lease_seconds),state=CASE WHEN reconcile_only THEN 'reconciling' ELSE 'generating' END,
  started_at=COALESCE(started_at,statement_timestamp()) WHERE id=attempt.id RETURNING * INTO attempt;
 IF transfer_released_before_effect AND NOT reconcile_only THEN
  UPDATE public.enterprise_ai_budget_reservations SET state='reserved',execution_token=attempt.execution_token,
   execution_fence=attempt.execution_fence,release_reason=NULL,settled_at=NULL,failure_class=NULL,
   studio_transfer_count=studio_transfer_count+1,studio_last_transfer_at=statement_timestamp(),studio_transfer_pending=true,
   updated_at=statement_timestamp()
  WHERE id=reservation.id AND state='released' AND release_reason='before_provider_effect'
  RETURNING * INTO reservation;
  IF reservation.id IS NULL THEN RAISE EXCEPTION 'GENERATION_RESERVATION_TRANSFER_CONFLICT';END IF;
 END IF;
 IF reconcile_only THEN
  UPDATE public.studio_generation_staged_responses
   SET execution_token=attempt.execution_token,execution_fence=attempt.execution_fence
   WHERE id=staged.id AND attempt_id=attempt.id AND response_hash=attempt.response_hash;
 END IF;
 INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,attempt.execution_fence,CASE WHEN reconcile_only THEN 'reconciliation_claimed' ELSE 'lease_claimed' END);
 result:=jsonb_build_object('outcome','committed','attemptId',attempt.id,'artifactId',attempt.artifact_id,'organizationId',attempt.org_id,'workspaceId',attempt.workspace_id,
  'executionToken',attempt.execution_token,'executionFence',attempt.execution_fence,'leaseExpiresAt',attempt.execution_lease_expires_at,
  'providerAllowed',NOT reconcile_only,'reconcileOnly',reconcile_only,'providerEffectKey',attempt.provider_effect_key,
  'sourcePackageId',attempt.source_package_id,'sourcePackageHash',attempt.source_package_hash,'templateKind',attempt.template_kind,
  'anchorManifestHash',attempt.anchor_manifest_hash,'anchorCount',attempt.anchor_count,
  'templateVersionId',COALESCE(attempt.template_id,attempt.tenant_template_version_id),'templateVersion',attempt.template_version,'templateHash',attempt.template_hash,
  'expectedAggregateVersion',attempt.expected_aggregate_version,'expectedCurrentVersionId',attempt.expected_current_version_id,
  'expectedApprovedVersionId',attempt.expected_approved_version_id);
 RETURN result;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_stage_v2(
 p_attempt_id uuid,p_execution_token uuid,p_execution_fence bigint,p_provider_operation_id text,p_response jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;staged public.studio_generation_staged_responses;staged_response_hash text;
BEGIN
 IF jsonb_typeof(p_response)<>'object' OR pg_column_size(p_response)>1048576 OR(p_provider_operation_id IS NOT NULL AND length(p_provider_operation_id)>200) THEN RAISE EXCEPTION 'INVALID_GENERATION_RESPONSE';END IF;
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 IF attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'STALE_EXECUTION_FENCE';END IF;
 staged_response_hash:=public.enterprise_sha256_jsonb(p_response);
 SELECT * INTO staged FROM public.studio_generation_staged_responses WHERE attempt_id=attempt.id;
 IF staged.id IS NOT NULL THEN
  IF staged.response_hash IS DISTINCT FROM staged_response_hash OR staged.provider_operation_id IS DISTINCT FROM p_provider_operation_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state',attempt.state,'responseHash',staged_response_hash);
 END IF;
 IF attempt.state NOT IN('generating','reconciling','cancel_requested') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 INSERT INTO public.studio_generation_staged_responses(attempt_id,artifact_id,org_id,workspace_id,execution_token,execution_fence,provider_operation_id,response_content,response_hash,schema_status)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,p_execution_token,p_execution_fence,p_provider_operation_id,p_response,staged_response_hash,'validated') RETURNING * INTO staged;
 UPDATE public.studio_artifact_generation_attempts SET state='response_staged',provider_operation_id=p_provider_operation_id,response_hash=staged_response_hash WHERE id=attempt.id;
 INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,p_execution_fence,'response_staged');
 RETURN jsonb_build_object('outcome','committed','attemptId',attempt.id,'state','response_staged','responseHash',staged_response_hash);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_finalize_v2(p_attempt_id uuid,p_execution_token uuid,p_execution_fence bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;artifact public.studio_artifact_aggregates;staged public.studio_generation_staged_responses;
 version public.studio_artifact_versions;system_template public.studio_system_template_versions;tenant_template public.studio_tenant_template_versions;
 tenant_aggregate public.studio_tenant_template_aggregates;next_version bigint;template_stale boolean:=false;source_current boolean:=false;stale boolean;audit_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 SELECT * INTO version FROM public.studio_artifact_versions WHERE generation_attempt_id=attempt.id;
 IF attempt.state IN('completed','stale_completed') AND version.id IS NOT NULL THEN
  RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state',attempt.state,'artifactId',attempt.artifact_id,'versionId',version.id,'stale',attempt.stale_completion);
 END IF;
 IF attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_fence IS DISTINCT FROM p_execution_fence THEN RAISE EXCEPTION 'STALE_EXECUTION_FENCE';END IF;
 SELECT * INTO staged FROM public.studio_generation_staged_responses WHERE attempt_id=attempt.id FOR SHARE;
 IF attempt.state NOT IN('response_staged','reconciling') OR staged.id IS NULL OR staged.execution_token IS DISTINCT FROM p_execution_token OR staged.execution_fence IS DISTINCT FROM p_execution_fence THEN
  RAISE EXCEPTION 'VERSION_CONFLICT';
 END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=attempt.artifact_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR UPDATE;
 IF artifact.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 source_current:=public.studio_pr_b_lock_source_package_current(attempt.source_package_id,attempt.org_id,attempt.workspace_id);
 IF attempt.template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=attempt.template_id FOR SHARE;
  template_stale:=system_template.id IS NULL OR system_template.superseded_at IS NOT NULL
   OR system_template.template_hash IS DISTINCT FROM attempt.template_hash
   OR system_template.template_version IS DISTINCT FROM attempt.template_version
   OR system_template.artifact_type IS DISTINCT FROM artifact.artifact_type;
 ELSE
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions
   WHERE id=attempt.tenant_template_version_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
  SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates
   WHERE id=tenant_template.template_id AND org_id=attempt.org_id AND workspace_id=attempt.workspace_id FOR SHARE;
  template_stale:=tenant_template.id IS NULL OR tenant_template.status<>'approved'
   OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id
   OR tenant_template.template_hash IS DISTINCT FROM attempt.template_hash
   OR tenant_template.version::text IS DISTINCT FROM attempt.template_version
   OR(tenant_template.artifact_class<>'custom' AND tenant_template.artifact_class IS DISTINCT FROM artifact.artifact_type);
 END IF;
 stale:=artifact.aggregate_version IS DISTINCT FROM attempt.expected_aggregate_version
  OR artifact.current_version_id IS DISTINCT FROM attempt.expected_current_version_id
  OR artifact.current_approved_version_id IS DISTINCT FROM attempt.expected_approved_version_id
  OR artifact.source_package_id IS DISTINCT FROM attempt.source_package_id OR artifact.source_package_hash IS DISTINCT FROM attempt.source_package_hash
  OR attempt.cancellation_requested_at IS NOT NULL OR template_stale OR NOT source_current;
 SELECT COALESCE(max(existing.version),0)+1 INTO next_version FROM public.studio_artifact_versions existing WHERE existing.artifact_id=artifact.id;
 INSERT INTO public.studio_artifact_versions(artifact_id,org_id,workspace_id,version,parent_version_id,template_id,content_schema_version,renderer_version,
  content,content_hash,lifecycle,generation_attempt_id,author_id,author_authorization_version,source_package_id,source_package_hash,template_kind,
  tenant_template_version_id,template_version,template_hash,is_stale_completion)
 VALUES(artifact.id,artifact.org_id,artifact.workspace_id,next_version,attempt.expected_current_version_id,attempt.template_id,
  CASE attempt.template_kind WHEN 'system' THEN(SELECT template.content_schema_version FROM public.studio_system_template_versions template WHERE template.id=attempt.template_id)
   ELSE(SELECT template.content_schema_version FROM public.studio_tenant_template_versions template WHERE template.id=attempt.tenant_template_version_id)END,
  CASE attempt.template_kind WHEN 'system' THEN(SELECT template.renderer_version FROM public.studio_system_template_versions template WHERE template.id=attempt.template_id)
   ELSE(SELECT template.renderer_compatibility_version FROM public.studio_tenant_template_versions template WHERE template.id=attempt.tenant_template_version_id)END,
  staged.response_content,staged.response_hash,'draft',attempt.id,attempt.requested_by,attempt.requester_authorization_version,attempt.source_package_id,attempt.source_package_hash,
  attempt.template_kind,attempt.tenant_template_version_id,attempt.template_version,attempt.template_hash,stale) RETURNING * INTO version;
 IF NOT stale THEN
  UPDATE public.studio_artifact_aggregates SET current_version_id=version.id,aggregate_version=aggregate_version+1,lifecycle='draft',updated_at=statement_timestamp()
   WHERE id=artifact.id RETURNING * INTO artifact;
 END IF;
 UPDATE public.studio_artifact_generation_attempts SET state=CASE WHEN stale THEN 'stale_completed' ELSE 'completed' END,stale_completion=stale,
  completed_at=statement_timestamp(),execution_lease_expires_at=NULL WHERE id=attempt.id RETURNING * INTO attempt;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,attempt.org_id,attempt.workspace_id,attempt.requested_by,attempt.request_id,'studio.artifact.generation.finalize','studio_generation_attempt',attempt.id,
  'succeeded',attempt.execution_fence,jsonb_build_object('artifactId',artifact.id,'versionId',version.id,'stale',stale,
   'sourcePackageId',attempt.source_package_id,'templateVersionId',COALESCE(attempt.template_id,attempt.tenant_template_version_id)));
 INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type,audit_event_id)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,attempt.execution_fence,CASE WHEN stale THEN 'stale_completed' ELSE 'completed' END,audit_id);
 RETURN jsonb_build_object('outcome','committed','attemptId',attempt.id,'state',attempt.state,'artifactId',artifact.id,'versionId',version.id,'stale',stale);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_fail_v2(
 p_attempt_id uuid,p_execution_token uuid,p_fence bigint,p_failure_code text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;reservation public.enterprise_ai_budget_reservations;
 safe_code text;audit_id uuid:=gen_random_uuid();released_before_effect boolean:=false;
BEGIN
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 IF attempt.execution_token IS DISTINCT FROM p_execution_token OR attempt.execution_fence IS DISTINCT FROM p_fence THEN
  RAISE EXCEPTION 'STALE_EXECUTION_FENCE';
 END IF;
 -- Uncertain means the provider effect or finalization may already have occurred.
 -- It remains reconciliation-owned and must never be converted to terminal failed.
 IF p_failure_code='GENERATION_UNCERTAIN' THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 safe_code:=CASE WHEN p_failure_code IN(
  'PROVIDER_GOVERNANCE_BLOCKED','PROVIDER_REQUEST_FAILED','PROVIDER_RATE_LIMITED','PROVIDER_TIMEOUT','PROVIDER_CANCELLED',
  'PROVIDER_OUTPUT_INVALID','PROVIDER_OUTPUT_OVERSIZED','PROVIDER_MODEL_MISMATCH','PROVIDER_USAGE_INVALID','SOURCE_COVERAGE_INCOMPLETE',
  'GENERATION_COMPLETION_CONFLICT','GENERATION_START_CONFLICT'
 ) THEN p_failure_code ELSE 'GENERATION_FAILED' END;
 IF attempt.state='failed' THEN
  IF attempt.failure_code IS DISTINCT FROM safe_code THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state','failed','failureCode',attempt.failure_code,'executionFence',attempt.execution_fence);
 END IF;
 IF attempt.state<>'generating' OR attempt.response_hash IS NOT NULL
    OR EXISTS(SELECT 1 FROM public.studio_generation_staged_responses staged WHERE staged.attempt_id=attempt.id) THEN
  RAISE EXCEPTION 'VERSION_CONFLICT';
 END IF;
 IF attempt.execution_lease_expires_at IS NULL OR attempt.execution_lease_expires_at<=statement_timestamp() THEN RAISE EXCEPTION 'STALE_EXECUTION_FENCE';END IF;
 -- Terminal failure is safe only before provider authority exists or after an
 -- exact before-effect release. Preserve attempt -> reservation lock order so
 -- reserve/transition/claim/fail cannot deadlock or race terminalization.
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
  WHERE studio_attempt_id=attempt.id FOR UPDATE;
 released_before_effect:=reservation.id IS NOT NULL AND reservation.state='released'
  AND reservation.release_reason='before_provider_effect' AND NOT reservation.studio_transfer_pending;
 IF reservation.id IS NOT NULL AND NOT released_before_effect THEN
  RAISE EXCEPTION 'GENERATION_RECONCILIATION_REQUIRED';
 END IF;
 UPDATE public.studio_artifact_generation_attempts
 SET state='failed',failure_code=safe_code,completed_at=statement_timestamp(),execution_lease_expires_at=NULL
 WHERE id=attempt.id RETURNING * INTO attempt;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,attempt.org_id,attempt.workspace_id,attempt.requested_by,attempt.request_id,'studio.artifact.generation.fail.v2','studio_generation_attempt',attempt.id,
  'failed',attempt.execution_fence,jsonb_build_object('artifactId',attempt.artifact_id,'failureCode',safe_code,'terminalState','failed','executionFence',attempt.execution_fence));
 INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type,failure_code,audit_event_id)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,attempt.execution_fence,'failed',safe_code,audit_id);
 RETURN jsonb_build_object('outcome','committed','attemptId',attempt.id,'state','failed','failureCode',safe_code,'executionFence',attempt.execution_fence);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_cancel_v2(p_attempt_id uuid,p_actor uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;authorization_version bigint;next_state text;
BEGIN
 IF length(btrim(COALESCE(p_reason,''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'INVALID_COMMAND';END IF;
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL OR attempt.requested_by IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 SELECT version INTO authorization_version FROM public.authorization_versions WHERE org_id=attempt.org_id AND user_id=p_actor;
 PERFORM public.pr1b_assert_command_authority(p_actor,attempt.org_id,attempt.workspace_id,'studio.artifacts.generate',authorization_version);
 IF attempt.state IN('cancelled','timed_out') THEN RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state',attempt.state);END IF;
 IF attempt.state IN('completed','stale_completed','failed','response_staged') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 next_state:=CASE WHEN attempt.state='requested' THEN 'cancelled' ELSE 'cancel_requested' END;
 UPDATE public.studio_artifact_generation_attempts SET state=next_state,cancellation_requested_at=statement_timestamp(),
  completed_at=CASE WHEN next_state='cancelled' THEN statement_timestamp() ELSE completed_at END WHERE id=attempt.id RETURNING * INTO attempt;
 INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,attempt.execution_fence,CASE WHEN next_state='cancelled' THEN 'cancelled' ELSE 'cancel_requested' END);
 RETURN jsonb_build_object('outcome','committed','attemptId',attempt.id,'state',attempt.state);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_timeout_v2(p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;reservation public.enterprise_ai_budget_reservations;
 audit_id uuid:=gen_random_uuid();released_before_effect boolean:=false;
BEGIN
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 IF attempt.state='timed_out' THEN RETURN jsonb_build_object('outcome','replayed','attemptId',attempt.id,'state',attempt.state);END IF;
 IF attempt.state NOT IN('requested','generating','cancel_requested') THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 IF attempt.timeout_at IS NULL OR attempt.timeout_at>statement_timestamp() THEN RAISE EXCEPTION 'GENERATION_TIMEOUT_NOT_DUE';END IF;
 -- Preserve the global attempt -> reservation lock order. A reservation is the
 -- authoritative provider-effect boundary: terminal timeout is safe only when
 -- no reservation exists or release explicitly proves no provider effect began.
 SELECT * INTO reservation FROM public.enterprise_ai_budget_reservations
  WHERE studio_attempt_id=attempt.id FOR UPDATE;
 released_before_effect:=reservation.id IS NOT NULL AND reservation.state='released'
  AND reservation.release_reason='before_provider_effect' AND NOT reservation.studio_transfer_pending;
 IF reservation.id IS NOT NULL AND NOT released_before_effect THEN
  RAISE EXCEPTION 'GENERATION_RECONCILIATION_REQUIRED';
 END IF;
 UPDATE public.studio_artifact_generation_attempts SET state='timed_out',failure_code='GENERATION_TIMEOUT',completed_at=statement_timestamp(),
  execution_lease_expires_at=NULL WHERE id=attempt.id RETURNING * INTO attempt;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,attempt.org_id,attempt.workspace_id,attempt.requested_by,attempt.request_id,'studio.artifact.generation.timeout','studio_generation_attempt',attempt.id,
  'succeeded',attempt.execution_fence,jsonb_build_object('artifactId',attempt.artifact_id,'sourcePackageId',attempt.source_package_id,'templateVersionId',COALESCE(attempt.template_id,attempt.tenant_template_version_id),'terminalState','timed_out'));
 INSERT INTO public.studio_generation_recovery_events(attempt_id,artifact_id,org_id,workspace_id,execution_fence,event_type,failure_code,audit_event_id)
 VALUES(attempt.id,attempt.artifact_id,attempt.org_id,attempt.workspace_id,attempt.execution_fence,'timed_out','GENERATION_TIMEOUT',audit_id);
 RETURN jsonb_build_object('outcome','committed','attemptId',attempt.id,'state',attempt.state);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_fill_generation_attempt_binding()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;template public.studio_system_template_versions;
BEGIN
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=NEW.artifact_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF artifact.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 IF NEW.source_package_id IS NULL THEN NEW.source_package_id:=artifact.source_package_id;END IF;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=NEW.source_package_id AND artifact_id=artifact.id AND org_id=artifact.org_id AND workspace_id=artifact.workspace_id;
 IF package.id IS NULL THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 NEW.source_package_hash:=COALESCE(NEW.source_package_hash,package.package_hash);
 IF NEW.source_package_hash IS DISTINCT FROM package.package_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 NEW.candidate_manifest_hash:=COALESCE(NEW.candidate_manifest_hash,package.candidate_manifest_hash);
 NEW.candidate_count:=COALESCE(NEW.candidate_count,package.candidate_count);
 -- Accepted Assess-only compatibility callers predate anchor fields and therefore
 -- receive the column defaults. Replace only those known legacy defaults; every
 -- governed PR B attempt must arrive with the exact persisted binding.
 IF NEW.provider_plan_state='legacy_unverified' AND package.source_mode='assess_handoff'
    AND(COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false)
      OR COALESCE((package.route_policy_snapshot->>'legacyAssessCompatibility')::boolean,false))
    AND NEW.anchor_manifest_hash=encode(public.digest(convert_to('[]','UTF8'),'sha256'),'hex')
    AND NEW.anchor_count=0 THEN
  NEW.anchor_manifest_hash:=package.anchor_manifest_hash;NEW.anchor_count:=package.anchor_count;
 END IF;
 NEW.anchor_manifest_hash:=COALESCE(NEW.anchor_manifest_hash,package.anchor_manifest_hash);
 NEW.anchor_count:=COALESCE(NEW.anchor_count,package.anchor_count);
 IF NEW.candidate_manifest_hash IS DISTINCT FROM package.candidate_manifest_hash
    OR NEW.candidate_count IS DISTINCT FROM package.candidate_count
    OR NEW.anchor_manifest_hash IS DISTINCT FROM package.anchor_manifest_hash
    OR NEW.anchor_count IS DISTINCT FROM package.anchor_count THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF NEW.template_kind IS NULL THEN NEW.template_kind:=CASE WHEN NEW.template_id IS NOT NULL THEN 'system' ELSE 'tenant' END;END IF;
 IF NEW.template_kind='system' THEN
  SELECT * INTO template FROM public.studio_system_template_versions WHERE id=NEW.template_id;
  IF template.id IS NULL THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
  NEW.template_version:=COALESCE(NEW.template_version,template.template_version);NEW.template_hash:=COALESCE(NEW.template_hash,template.template_hash);
  IF NEW.template_version IS DISTINCT FROM template.template_version OR NEW.template_hash IS DISTINCT FROM template.template_hash THEN RAISE EXCEPTION 'TEMPLATE_STALE';END IF;
 END IF;
 NEW.expected_aggregate_version:=COALESCE(NEW.expected_aggregate_version,artifact.aggregate_version);
 NEW.expected_current_version_id:=COALESCE(NEW.expected_current_version_id,artifact.current_version_id);
 NEW.expected_approved_version_id:=COALESCE(NEW.expected_approved_version_id,artifact.current_approved_version_id);
 IF NEW.requester_authorization_version IS NULL THEN
  SELECT authority.version INTO NEW.requester_authorization_version FROM public.authorization_versions authority WHERE authority.org_id=NEW.org_id AND authority.user_id=NEW.requested_by;
 END IF;
 NEW.provider_effect_key:=COALESCE(NEW.provider_effect_key,encode(public.digest('studio-generation:'||NEW.id::text,'sha256'),'hex'));
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_generation_attempt_binding BEFORE INSERT ON public.studio_artifact_generation_attempts
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_fill_generation_attempt_binding();

CREATE OR REPLACE FUNCTION public.studio_pr_b_structured_artifact_content_safe(
 p_content jsonb,p_package public.studio_artifact_source_packages
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE section jsonb;anchor jsonb;labels jsonb;
BEGIN
 IF p_content IS NULL OR jsonb_typeof(p_content)<>'object' OR pg_column_size(p_content)>1048576 THEN RETURN false;END IF;
 IF NOT(p_content?'contractVersion') THEN
  RETURN p_package.source_mode='assess_handoff'
   AND(COALESCE((p_package.route_policy_snapshot->>'migrationBackfill')::boolean,false)
     OR COALESCE((p_package.route_policy_snapshot->>'legacyAssessCompatibility')::boolean,false));
 END IF;
 IF p_content->>'contractVersion'<>'studio-artifact-2' OR NOT(p_content?&ARRAY['contractVersion','title','summary','sections','coverage'])
    OR(p_content-ARRAY['contractVersion','title','summary','sections','coverage'])<>'{}'::jsonb
    OR length(btrim(COALESCE(p_content->>'title',''))) NOT BETWEEN 1 AND 300
    OR length(COALESCE(p_content->>'summary',''))>5000
    OR jsonb_typeof(p_content->'sections')<>'array' OR jsonb_array_length(p_content->'sections') NOT BETWEEN 1 AND 100
    OR jsonb_typeof(p_content->'coverage')<>'object'
    OR NOT((p_content->'coverage')?&ARRAY['selectedSourceVersionIds','coveredSourceVersionIds','complete'])
    OR((p_content->'coverage')-ARRAY['selectedSourceVersionIds','coveredSourceVersionIds','complete'])<>'{}'::jsonb
    OR(p_content#>>'{coverage,complete}')::boolean IS DISTINCT FROM true
    OR jsonb_typeof(p_content#>'{coverage,selectedSourceVersionIds}')<>'array'
    OR jsonb_typeof(p_content#>'{coverage,coveredSourceVersionIds}')<>'array' THEN RETURN false;END IF;
 IF NOT public.studio_pr_b_anchor_manifest_safe(p_package.anchor_manifest)
    OR p_package.anchor_manifest_hash IS DISTINCT FROM public.enterprise_sha256_jsonb(p_package.anchor_manifest)
    OR p_package.anchor_count IS DISTINCT FROM jsonb_array_length(p_package.anchor_manifest) THEN RETURN false;END IF;
 IF jsonb_array_length(p_content#>'{coverage,selectedSourceVersionIds}')
      <>(SELECT count(DISTINCT manifest_anchor->>'sourceVersionId') FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor)
    OR jsonb_array_length(p_content#>'{coverage,coveredSourceVersionIds}')
      <>(SELECT count(DISTINCT manifest_anchor->>'sourceVersionId') FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor)
    OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_content#>'{coverage,selectedSourceVersionIds}')item(value))
      <>jsonb_array_length(p_content#>'{coverage,selectedSourceVersionIds}')
    OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_content#>'{coverage,coveredSourceVersionIds}')item(value))
      <>jsonb_array_length(p_content#>'{coverage,coveredSourceVersionIds}')
    OR EXISTS(
      (SELECT manifest_anchor->>'sourceVersionId' FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor
       EXCEPT SELECT value FROM jsonb_array_elements_text(p_content#>'{coverage,selectedSourceVersionIds}')item(value))
      UNION ALL
      (SELECT value FROM jsonb_array_elements_text(p_content#>'{coverage,selectedSourceVersionIds}')item(value)
       EXCEPT SELECT manifest_anchor->>'sourceVersionId' FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor)
    )
    OR EXISTS(
      (SELECT manifest_anchor->>'sourceVersionId' FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor
       EXCEPT SELECT value FROM jsonb_array_elements_text(p_content#>'{coverage,coveredSourceVersionIds}')item(value))
      UNION ALL
      (SELECT value FROM jsonb_array_elements_text(p_content#>'{coverage,coveredSourceVersionIds}')item(value)
       EXCEPT SELECT manifest_anchor->>'sourceVersionId' FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor)
    ) THEN RETURN false;END IF;
 FOR section IN SELECT value FROM jsonb_array_elements(p_content->'sections') LOOP
  IF jsonb_typeof(section)<>'object' OR NOT(section?&ARRAY['id','title','body','sourceAnchors','labels'])
     OR(section-ARRAY['id','title','body','sourceAnchors','labels'])<>'{}'::jsonb
     OR COALESCE(section->>'id','')!~'^[a-z][a-z0-9_.-]{0,79}$'
     OR length(btrim(COALESCE(section->>'title',''))) NOT BETWEEN 1 AND 300 OR length(COALESCE(section->>'body',''))>20000
     OR jsonb_typeof(section->'sourceAnchors')<>'array' OR jsonb_array_length(section->'sourceAnchors')>200
     OR jsonb_typeof(section->'labels')<>'array' OR jsonb_array_length(section->'labels')>3 THEN RETURN false;END IF;
  labels:=section->'labels';
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(labels)value WHERE value NOT IN('human_authored','template_required','assumption'))
     OR(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(labels))<>jsonb_array_length(labels)
     OR(jsonb_array_length(section->'sourceAnchors')=0 AND jsonb_array_length(labels)=0) THEN RETURN false;END IF;
  FOR anchor IN SELECT value FROM jsonb_array_elements(section->'sourceAnchors') LOOP
   IF jsonb_typeof(anchor)<>'object' OR NOT(anchor?&ARRAY['sourceVersionId','locator','anchorHash'])
      OR(anchor-ARRAY['sourceVersionId','locator','anchorHash'])<>'{}'::jsonb
      OR COALESCE(anchor->>'sourceVersionId','')!~*'^[0-9a-f-]{36}$'
      OR length(btrim(COALESCE(anchor->>'locator',''))) NOT BETWEEN 1 AND 500
      OR COALESCE(anchor->>'anchorHash','')!~'^[0-9a-f]{64}$'
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_package.anchor_manifest) allowed
        WHERE allowed->>'sourceVersionId'=anchor->>'sourceVersionId'
          AND allowed->>'locator'=anchor->>'locator'
          AND allowed->>'anchorHash'=anchor->>'anchorHash') THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM(
    SELECT DISTINCT manifest_anchor->>'sourceVersionId' source_id FROM jsonb_array_elements(p_package.anchor_manifest)manifest_anchor
   ) selected WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(p_content->'sections')section_item(value)
   CROSS JOIN LATERAL jsonb_array_elements(section_item.value->'sourceAnchors')anchor_item(value)
   WHERE anchor_item.value->>'sourceVersionId'=selected.source_id
 )) THEN RETURN false;END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_fill_artifact_version_binding()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE artifact public.studio_artifact_aggregates;attempt public.studio_artifact_generation_attempts;parent public.studio_artifact_versions;
 system_template public.studio_system_template_versions;tenant_template public.studio_tenant_template_versions;package public.studio_artifact_source_packages;
BEGIN
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=NEW.artifact_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF NEW.generation_attempt_id IS NOT NULL THEN SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=NEW.generation_attempt_id AND artifact_id=NEW.artifact_id;END IF;
 IF NEW.parent_version_id IS NOT NULL THEN SELECT * INTO parent FROM public.studio_artifact_versions WHERE id=NEW.parent_version_id AND artifact_id=NEW.artifact_id;END IF;
 NEW.source_package_id:=COALESCE(NEW.source_package_id,attempt.source_package_id,parent.source_package_id,artifact.source_package_id);
 NEW.source_package_hash:=COALESCE(NEW.source_package_hash,attempt.source_package_hash,parent.source_package_hash,artifact.source_package_hash);
 NEW.template_kind:=COALESCE(NEW.template_kind,attempt.template_kind,parent.template_kind,CASE WHEN NEW.template_id IS NOT NULL THEN 'system' ELSE 'tenant' END);
 NEW.tenant_template_version_id:=COALESCE(NEW.tenant_template_version_id,attempt.tenant_template_version_id,parent.tenant_template_version_id);
 IF NEW.template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=NEW.template_id;
  NEW.template_version:=COALESCE(NEW.template_version,attempt.template_version,parent.template_version,system_template.template_version);
  NEW.template_hash:=COALESCE(NEW.template_hash,attempt.template_hash,parent.template_hash,system_template.template_hash);
 ELSE
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions WHERE id=NEW.tenant_template_version_id;
  NEW.template_version:=COALESCE(NEW.template_version,attempt.template_version,parent.template_version,tenant_template.version::text);
  NEW.template_hash:=COALESCE(NEW.template_hash,attempt.template_hash,parent.template_hash,tenant_template.template_hash);
 END IF;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=NEW.source_package_id AND artifact_id=NEW.artifact_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF package.id IS NULL OR package.package_hash IS DISTINCT FROM NEW.source_package_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF NOT public.studio_pr_b_structured_artifact_content_safe(NEW.content,package) THEN
  RAISE EXCEPTION 'STUDIO_STRUCTURED_CONTENT_INVALID';
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_artifact_version_binding BEFORE INSERT ON public.studio_artifact_versions
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_fill_artifact_version_binding();

CREATE OR REPLACE FUNCTION public.studio_pr_b_attempt_binding_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF(to_jsonb(NEW)-ARRAY['state','provider_operation_id','failure_code','started_at','completed_at','execution_token','execution_fence','execution_lease_expires_at','response_hash','cancellation_requested_at','timeout_at','stale_completion'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['state','provider_operation_id','failure_code','started_at','completed_at','execution_token','execution_fence','execution_lease_expires_at','response_hash','cancellation_requested_at','timeout_at','stale_completion']) THEN
  RAISE EXCEPTION 'STUDIO_IMMUTABLE';
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_attempt_binding_immutable BEFORE UPDATE OR DELETE ON public.studio_artifact_generation_attempts
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_attempt_binding_immutable();

CREATE OR REPLACE FUNCTION public.studio_pr_b_template_version_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR(to_jsonb(NEW)-'status') IS DISTINCT FROM(to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'STUDIO_IMMUTABLE';END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_tenant_template_version_immutable BEFORE UPDATE OR DELETE ON public.studio_tenant_template_versions
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_template_version_immutable();

CREATE OR REPLACE FUNCTION public.studio_pr_b_handoff_binding_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR(to_jsonb(NEW)-ARRAY['status','current_version','updated_at'])
   IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['status','current_version','updated_at']) THEN RAISE EXCEPTION 'STUDIO_IMMUTABLE';END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_handoff_binding_immutable BEFORE UPDATE OR DELETE ON public.enterprise_module_handoffs
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_handoff_binding_immutable();

DO $$DECLARE table_name text;BEGIN FOREACH table_name IN ARRAY ARRAY[
 'studio_tenant_template_review_events','studio_tenant_template_approval_events','enterprise_module_handoff_versions',
 'enterprise_module_handoff_review_events','enterprise_module_handoff_approval_events','enterprise_module_handoff_consumptions',
 'studio_artifact_source_packages','studio_artifact_manual_brief_materials','studio_generation_recovery_events'
] LOOP EXECUTE format('CREATE TRIGGER trg_%I_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.studio_reject_immutable()',table_name,table_name);END LOOP;END$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_staged_response_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR(to_jsonb(NEW)-ARRAY['execution_token','execution_fence']) IS DISTINCT FROM(to_jsonb(OLD)-ARRAY['execution_token','execution_fence']) THEN
  RAISE EXCEPTION 'STUDIO_IMMUTABLE';
 END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_staged_response_immutable BEFORE UPDATE OR DELETE ON public.studio_generation_staged_responses
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_staged_response_immutable();

CREATE OR REPLACE FUNCTION public.studio_pr_b_validate_aggregate_package()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE package public.studio_artifact_source_packages;
BEGIN
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=NEW.source_package_id AND artifact_id=NEW.id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF package.id IS NULL OR package.package_hash IS DISTINCT FROM NEW.source_package_hash OR package.source_mode IS DISTINCT FROM NEW.source_mode
    OR package.lineage_classification IS DISTINCT FROM NEW.lineage_classification OR package.planning_only IS DISTINCT FROM NEW.planning_only THEN
  RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';
 END IF;
 RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_fill_legacy_aggregate_package()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE upstream public.assess_v2_studio_handoffs;package_id uuid;route_snapshot jsonb;route_hash text;
 anchor_manifest jsonb;anchor_manifest_hash text;
BEGIN
 IF NEW.source_package_id IS NOT NULL THEN RETURN NEW;END IF;
 IF NEW.handoff_id IS NULL THEN RAISE EXCEPTION 'SOURCE_PACKAGE_REQUIRED';END IF;
 SELECT * INTO upstream FROM public.assess_v2_studio_handoffs WHERE id=NEW.handoff_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF upstream.id IS NULL OR upstream.package_hash IS DISTINCT FROM NEW.source_package_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 package_id:=public.studio_pr_b_deterministic_uuid('legacy-assess-source-package',NEW.id);
 route_snapshot:=jsonb_build_object('policy','accepted_assess_handoff','version',1,'legacyAssessCompatibility',true);
 route_hash:=public.enterprise_sha256_jsonb(route_snapshot);
 anchor_manifest:=public.studio_pr_b_anchor_manifest('[]'::jsonb,upstream.source_version_id,upstream.package_hash);
 anchor_manifest_hash:=public.enterprise_sha256_jsonb(anchor_manifest);
 NEW.source_package_id:=package_id;NEW.source_mode:='assess_handoff';NEW.lineage_classification:='assessed';NEW.planning_only:=false;
 INSERT INTO public.studio_artifact_source_packages(id,artifact_id,org_id,workspace_id,version,source_mode,assess_handoff_id,assess_package_hash,
  lineage_classification,planning_only,route_policy_version,route_policy_snapshot,route_policy_hash,package_hash,
  anchor_manifest,anchor_manifest_hash,anchor_count,created_by,created_at)
 VALUES(package_id,NEW.id,NEW.org_id,NEW.workspace_id,1,'assess_handoff',upstream.id,upstream.package_hash,'assessed',false,1,
  route_snapshot,route_hash,upstream.package_hash,anchor_manifest,anchor_manifest_hash,jsonb_array_length(anchor_manifest),
  NEW.created_by,COALESCE(NEW.created_at,statement_timestamp()));
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_fill_legacy_aggregate_package BEFORE INSERT ON public.studio_artifact_aggregates
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_fill_legacy_aggregate_package();

CREATE CONSTRAINT TRIGGER studio_pr_b_aggregate_package_exact AFTER INSERT OR UPDATE OF source_package_id,source_package_hash,source_mode,lineage_classification,planning_only
ON public.studio_artifact_aggregates DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_validate_aggregate_package();

CREATE OR REPLACE FUNCTION public.studio_pr_b_validate_source_package()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE artifact public.studio_artifact_aggregates;upstream public.assess_v2_studio_handoffs;bundle public.enterprise_module_input_bundles;
 bundle_version public.enterprise_module_input_bundle_versions;expected_hash text;expected_anchor_manifest jsonb;
BEGIN
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=NEW.artifact_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 IF artifact.id IS NULL OR NEW.route_policy_hash IS DISTINCT FROM public.enterprise_sha256_jsonb(NEW.route_policy_snapshot) THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 IF NEW.assess_handoff_id IS NOT NULL THEN
  SELECT * INTO upstream FROM public.assess_v2_studio_handoffs WHERE id=NEW.assess_handoff_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
  IF upstream.id IS NULL OR upstream.package_hash IS DISTINCT FROM NEW.assess_package_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 END IF;
 IF NEW.studio_input_bundle_version_id IS NOT NULL THEN
  SELECT * INTO bundle_version FROM public.enterprise_module_input_bundle_versions WHERE id=NEW.studio_input_bundle_version_id
   AND input_bundle_id=NEW.studio_input_bundle_id AND version=NEW.studio_input_bundle_version AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id AND status='locked';
  SELECT * INTO bundle FROM public.enterprise_module_input_bundles WHERE id=NEW.studio_input_bundle_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id AND owner_module='studio';
  IF bundle_version.id IS NULL OR bundle.id IS NULL OR bundle_version.bundle_hash IS DISTINCT FROM NEW.studio_bundle_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 END IF;
 expected_anchor_manifest:=public.studio_pr_b_anchor_manifest(NEW.candidate_manifest,upstream.source_version_id,upstream.package_hash);
 IF NEW.anchor_manifest IS DISTINCT FROM expected_anchor_manifest
    OR NEW.anchor_manifest_hash IS DISTINCT FROM public.enterprise_sha256_jsonb(expected_anchor_manifest)
    OR NEW.anchor_count IS DISTINCT FROM jsonb_array_length(expected_anchor_manifest) THEN
  RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';
 END IF;
 IF COALESCE((NEW.route_policy_snapshot->>'migrationBackfill')::boolean,false) OR COALESCE((NEW.route_policy_snapshot->>'legacyAssessCompatibility')::boolean,false) THEN
  IF NEW.source_mode<>'assess_handoff' OR NEW.package_hash IS DISTINCT FROM NEW.assess_package_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 ELSE
  expected_hash:=public.enterprise_sha256_jsonb(jsonb_build_object('contractVersion','studio-source-package-1','sourceMode',NEW.source_mode,
   'upstreamHandoffId',NEW.assess_handoff_id,'upstreamPackageHash',NEW.assess_package_hash,
   'studioInputBundleVersionId',NEW.studio_input_bundle_version_id,'studioBundleHash',NEW.studio_bundle_hash,'manualBriefHash',NEW.manual_brief_hash,
   'candidateManifestHash',NEW.candidate_manifest_hash,'anchorManifestHash',NEW.anchor_manifest_hash,
   'artifactType',artifact.artifact_type,'routePolicyVersion',NEW.route_policy_version,'routePolicyHash',NEW.route_policy_hash));
  IF expected_hash IS DISTINCT FROM NEW.package_hash THEN RAISE EXCEPTION 'SOURCE_PACKAGE_STALE';END IF;
 END IF;
 RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER studio_pr_b_source_package_exact AFTER INSERT ON public.studio_artifact_source_packages
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_validate_source_package();

-- Preserve the accepted Assess-derived entry points. New direct/hybrid/manual
-- attempts must use the fenced v2 claim/stage/finalize lifecycle.
CREATE OR REPLACE FUNCTION public.studio_artifact_generation_start(p_attempt_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;package public.studio_artifact_source_packages;audit_id uuid:=gen_random_uuid();
BEGIN
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=attempt.source_package_id;
 IF package.source_mode<>'assess_handoff' OR NOT(COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false) OR COALESCE((package.route_policy_snapshot->>'legacyAssessCompatibility')::boolean,false)) THEN RAISE EXCEPTION 'STUDIO_PR_B_FENCED_GENERATION_REQUIRED';END IF;
 IF attempt.state='generating' THEN RETURN jsonb_build_object('ok',true,'outcome','replayed','resourceId',attempt.artifact_id,'resource',jsonb_build_object('attemptId',attempt.id,'state',attempt.state));END IF;
 IF attempt.state<>'requested' THEN RAISE EXCEPTION 'VERSION_CONFLICT';END IF;
 INSERT INTO public.privileged_audit_events(id,org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version,metadata)
 VALUES(audit_id,attempt.org_id,attempt.workspace_id,attempt.requested_by,attempt.request_id,'studio.artifact.generation.start','studio_generation_attempt',attempt.id,'succeeded',1,jsonb_build_object('attemptId',attempt.id));
 UPDATE public.studio_artifact_generation_attempts SET state='generating',started_at=statement_timestamp() WHERE id=attempt.id;
 RETURN jsonb_build_object('ok',true,'outcome','committed','resourceId',attempt.artifact_id,'resource',jsonb_build_object('attemptId',attempt.id,'state','generating'));
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_generation_complete(p_attempt_id uuid,p_content jsonb,p_provider_operation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE attempt public.studio_artifact_generation_attempts;package public.studio_artifact_source_packages;
BEGIN
 SELECT * INTO attempt FROM public.studio_artifact_generation_attempts WHERE id=p_attempt_id;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'RESOURCE_NOT_AVAILABLE';END IF;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=attempt.source_package_id;
 IF package.source_mode<>'assess_handoff' OR NOT(COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false) OR COALESCE((package.route_policy_snapshot->>'legacyAssessCompatibility')::boolean,false)) THEN RAISE EXCEPTION 'STUDIO_PR_B_FENCED_GENERATION_REQUIRED';END IF;
 RETURN public.studio_complete_generation(p_attempt_id,p_provider_operation_id,p_content,NULL);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_pr_b_delivery_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;
BEGIN
 SELECT * INTO artifact FROM public.studio_artifact_aggregates WHERE id=NEW.studio_document_id AND org_id=NEW.org_id AND workspace_id=NEW.workspace_id;
 SELECT * INTO package FROM public.studio_artifact_source_packages WHERE id=artifact.source_package_id AND artifact_id=artifact.id;
 IF artifact.id IS NULL OR package.id IS NULL OR package.source_mode<>'assess_handoff' THEN RAISE EXCEPTION 'STUDIO_PR_B_DELIVERY_PATH_DISABLED';END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER studio_pr_b_delivery_assess_handoff_only BEFORE INSERT OR UPDATE ON public.enterprise_studio_delivery_handoffs
FOR EACH ROW EXECUTE FUNCTION public.studio_pr_b_delivery_guard();

-- A separate v2 projection preserves the accepted studio_artifact_projection
-- byte/shape contract while representing planning-only ancestry truthfully.
CREATE OR REPLACE FUNCTION public.studio_artifact_projection_v2(p_org uuid,p_workspace uuid,p_artifact uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;
 current_version public.studio_artifact_versions;system_template public.studio_system_template_versions;
 tenant_template public.studio_tenant_template_versions;tenant_aggregate public.studio_tenant_template_aggregates;
 module_handoff public.enterprise_module_handoffs;upstream public.assess_v2_studio_handoffs;
 flags public.enterprise_transcript_workspace_flags;control public.studio_artifact_runtime_control;
 ancestry jsonb;current_dto jsonb;approved_dto jsonb;versions_dto jsonb;review_dto jsonb;approval_dto jsonb;
 source_package_dto jsonb;template_dto jsonb;artifact_sections jsonb;template_sections jsonb;replacement jsonb;
 bundle_source_count integer:=0;bundle_source_labels jsonb:='[]'::jsonb;selected_sources integer:=0;
 package_stale boolean:=false;template_stale boolean:=false;can_generate boolean:=false;
BEGIN
 IF actor IS NULL OR NOT public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.read') THEN RETURN NULL;END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates
  WHERE id=p_artifact AND org_id=p_org AND workspace_id=p_workspace;
 SELECT * INTO package FROM public.studio_artifact_source_packages
  WHERE id=artifact.source_package_id AND artifact_id=artifact.id AND org_id=p_org AND workspace_id=p_workspace;
 SELECT * INTO current_version FROM public.studio_artifact_versions
  WHERE id=artifact.current_version_id AND artifact_id=artifact.id AND org_id=p_org AND workspace_id=p_workspace;
 IF artifact.id IS NULL OR package.id IS NULL OR current_version.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton;
 package_stale:=NOT public.studio_pr_b_source_package_is_current(package.id,p_org,p_workspace);

 IF package.assess_handoff_id IS NOT NULL THEN
  SELECT * INTO upstream FROM public.assess_v2_studio_handoffs
   WHERE id=package.assess_handoff_id AND org_id=p_org AND workspace_id=p_workspace;
  SELECT handoff.* INTO module_handoff FROM public.enterprise_module_handoffs handoff
   LEFT JOIN public.enterprise_module_handoff_consumptions consumption ON consumption.handoff_id=handoff.id
   WHERE handoff.org_id=p_org AND handoff.workspace_id=p_workspace AND handoff.upstream_handoff_id=package.assess_handoff_id
    AND(consumption.artifact_id=artifact.id OR consumption.id IS NULL)
   ORDER BY(consumption.artifact_id=artifact.id) DESC,handoff.updated_at DESC LIMIT 1;
 END IF;
 IF package.studio_input_bundle_version_id IS NOT NULL THEN
  SELECT count(*)::integer,COALESCE(jsonb_agg(selected.display_name ORDER BY selected.display_name,selected.source_version_id),'[]'::jsonb)
   INTO bundle_source_count,bundle_source_labels
  FROM(
   SELECT DISTINCT source.display_name,source_item.source_version_id
   FROM public.enterprise_module_input_bundle_items bundle_item
   JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
   JOIN public.enterprise_evidence_sources source ON source.id=source_item.source_id AND source.org_id=bundle_item.org_id AND source.workspace_id=bundle_item.workspace_id
   WHERE bundle_item.input_bundle_version_id=package.studio_input_bundle_version_id
  ) selected;
 END IF;
 package_stale:=package_stale OR artifact.source_package_id IS DISTINCT FROM package.id OR artifact.source_package_hash IS DISTINCT FROM package.package_hash;

 ancestry:=jsonb_build_object(
  'contractVersion','studio-artifact-2','organizationId',artifact.org_id,'workspaceId',artifact.workspace_id,
  'sourceMode',package.source_mode,'assessmentLabel',package.lineage_classification,
  'planningLabel',CASE WHEN package.planning_only THEN 'planning_only' ELSE 'governed_assessed' END,
  'sourcePackageId',package.id,'sourcePackageVersion',package.version,'sourcePackageHash',package.package_hash,
  'sourceSchemaVersion',artifact.source_schema_version,'ruleSetVersion',artifact.rule_set_version,
  'studioInputBundleId',package.studio_input_bundle_id,'studioInputBundleVersionId',package.studio_input_bundle_version_id,
  'studioInputBundleVersion',package.studio_input_bundle_version,
  'caseId',artifact.case_id,'sourceCaseVersionId',artifact.source_version_id,'sourceCaseVersion',artifact.source_case_version,
  'decisionId',artifact.decision_id,'decisionVersion',artifact.decision_version,'reviewResolutionId',artifact.review_resolution_id,
  'governResolutionId',artifact.govern_resolution_id,'studioHandoffId',artifact.handoff_id,
  'reviewSchemaVersion',CASE WHEN package.lineage_classification='not_assessed' THEN NULL ELSE artifact.review_schema_version END,
  'reviewSequence',CASE WHEN package.lineage_classification='not_assessed' THEN NULL ELSE artifact.review_sequence END);

 SELECT jsonb_build_object('id',version.id,'version',version.version,'parentVersionId',version.parent_version_id,
  'lifecycle',version.lifecycle,'templateVersion',version.template_version,'contentSchemaVersion',version.content_schema_version,
  'projectionVersion',version.renderer_version,'content',version.content,'contentHash',version.content_hash,
  'authorId',version.author_id,'createdAt',version.created_at) INTO current_dto
 FROM public.studio_artifact_versions version WHERE version.id=current_version.id;
 SELECT jsonb_build_object('id',version.id,'version',version.version,'parentVersionId',version.parent_version_id,
  'lifecycle',version.lifecycle,'templateVersion',version.template_version,'contentSchemaVersion',version.content_schema_version,
  'projectionVersion',version.renderer_version,'content',version.content,'contentHash',version.content_hash,
  'authorId',version.author_id,'createdAt',version.created_at) INTO approved_dto
 FROM public.studio_artifact_versions version WHERE version.id=artifact.current_approved_version_id AND version.artifact_id=artifact.id;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',version.id,'version',version.version,'parentVersionId',version.parent_version_id,
  'lifecycle',version.lifecycle,'templateVersion',version.template_version,'contentSchemaVersion',version.content_schema_version,
  'projectionVersion',version.renderer_version,'content',version.content,'contentHash',version.content_hash,
  'authorId',version.author_id,'createdAt',version.created_at) ORDER BY version.version),'[]'::jsonb) INTO versions_dto
 FROM public.studio_artifact_versions version WHERE version.artifact_id=artifact.id AND version.org_id=p_org AND version.workspace_id=p_workspace;
 SELECT jsonb_build_object('assignmentId',assignment.id,'reviewerId',assignment.reviewer_id,'outcome',resolution.outcome,
  'rationale',resolution.rationale,'conditions',COALESCE(resolution.conditions,'[]'::jsonb)) INTO review_dto
 FROM public.studio_artifact_review_assignments assignment
 LEFT JOIN public.studio_artifact_review_resolutions resolution ON resolution.assignment_id=assignment.id
 WHERE assignment.artifact_version_id=current_version.id;
 SELECT jsonb_build_object('approverId',approval.approver_id,'outcome',approval.outcome,'rationale',approval.rationale,
  'conditions',approval.conditions,'supersededVersionId',approval.superseded_version_id) INTO approval_dto
 FROM public.studio_artifact_approval_resolutions approval WHERE approval.artifact_version_id=current_version.id;

 IF package.source_mode='manual_brief' THEN
  selected_sources:=0;
 ELSIF package.source_mode='assess_plus_transcript_bundle' THEN
  SELECT count(DISTINCT anchor->>'sourceVersionId')::integer INTO selected_sources
  FROM jsonb_array_elements(package.anchor_manifest) anchor;
 ELSE
  selected_sources:=CASE package.source_mode WHEN 'assess_handoff' THEN 1
   WHEN 'direct_transcript_bundle' THEN bundle_source_count ELSE 1 END;
 END IF;
 source_package_dto:=jsonb_build_object(
  'contractVersion','studio-artifact-2','id',package.id,'version',package.version,'sourceMode',package.source_mode,
  'assessmentLabel',package.lineage_classification,'planningLabel',CASE WHEN package.planning_only THEN 'planning_only' ELSE 'governed_assessed' END,
  'assessHandoff',CASE WHEN package.assess_handoff_id IS NULL THEN NULL ELSE jsonb_build_object('id',package.assess_handoff_id,
   'version',COALESCE(module_handoff.upstream_version,1),'status',COALESCE(module_handoff.status,'accepted'),'sourceLabel','Accepted Assess handoff') END,
  'studioInputBundle',CASE WHEN package.studio_input_bundle_id IS NULL THEN NULL ELSE jsonb_build_object('id',package.studio_input_bundle_id,
   'version',package.studio_input_bundle_version,'sourceCount',bundle_source_count,'sourceLabels',bundle_source_labels) END,
  'manualBriefPresent',package.manual_brief_hash IS NOT NULL,
  'coverage',jsonb_build_object('selectedSources',selected_sources,'coveredSources',CASE WHEN package_stale THEN 0 ELSE selected_sources END,
   'complete',NOT package_stale,'blockers',CASE WHEN package_stale THEN jsonb_build_array('SOURCE_PACKAGE_STALE') ELSE '[]'::jsonb END),
  'stale',package_stale);

 IF current_version.template_kind='system' THEN
  SELECT * INTO system_template FROM public.studio_system_template_versions WHERE id=current_version.template_id;
  template_stale:=system_template.id IS NULL OR system_template.template_hash IS DISTINCT FROM current_version.template_hash
   OR system_template.template_version IS DISTINCT FROM current_version.template_version OR system_template.superseded_at IS NOT NULL;
  template_sections:=CASE artifact.artifact_type
   WHEN 'brd' THEN jsonb_build_array(jsonb_build_object('id','summary','title','Summary','required',true,'fieldKind','narrative'),jsonb_build_object('id','objectives','title','Objectives','required',true,'fieldKind','requirements'),jsonb_build_object('id','scope','title','Scope','required',true,'fieldKind','narrative'),jsonb_build_object('id','requirements','title','Requirements','required',true,'fieldKind','requirements'),jsonb_build_object('id','risks','title','Risks','required',true,'fieldKind','risks'))
   WHEN 'frd' THEN jsonb_build_array(jsonb_build_object('id','summary','title','Summary','required',true,'fieldKind','narrative'),jsonb_build_object('id','functionalRequirements','title','Functional requirements','required',true,'fieldKind','requirements'),jsonb_build_object('id','rules','title','Rules','required',true,'fieldKind','rules'),jsonb_build_object('id','interfaces','title','Interfaces','required',true,'fieldKind','interfaces'),jsonb_build_object('id','acceptanceCriteria','title','Acceptance criteria','required',true,'fieldKind','acceptance_criteria'))
   ELSE jsonb_build_array(jsonb_build_object('id','summary','title','Summary','required',true,'fieldKind','narrative'),jsonb_build_object('id','process','title','Process','required',true,'fieldKind','narrative'),jsonb_build_object('id','roles','title','Roles','required',true,'fieldKind','controls'),jsonb_build_object('id','controls','title','Controls','required',true,'fieldKind','controls'),jsonb_build_object('id','exceptions','title','Exceptions','required',true,'fieldKind','risks')) END;
  template_dto:=jsonb_build_object('ownership','system','templateId',system_template.id,'templateVersionId',system_template.id,
   'version',current_version.template_version,'name','System '||upper(artifact.artifact_type),'description','AvalaOS governed system '||upper(artifact.artifact_type)||' compatibility template',
   'artifactClass',artifact.artifact_type,'lifecycle',CASE WHEN system_template.superseded_at IS NULL THEN 'approved' ELSE 'replaced' END,
   'templateHash',current_version.template_hash,'rendererVersion',current_version.renderer_version,'contentSchemaVersion',current_version.content_schema_version,
   'sections',template_sections,'replacement',NULL,'actions','[]'::jsonb);
 ELSE
  SELECT * INTO tenant_template FROM public.studio_tenant_template_versions WHERE id=current_version.tenant_template_version_id;
  SELECT * INTO tenant_aggregate FROM public.studio_tenant_template_aggregates WHERE id=tenant_template.template_id;
  SELECT jsonb_build_object('templateId',replacement_version.template_id,'templateVersionId',replacement_version.id,'version',replacement_version.version)
   INTO replacement FROM public.studio_tenant_template_approval_events resolution
   JOIN public.studio_tenant_template_versions replacement_version ON replacement_version.id=resolution.replacement_version_id
   WHERE resolution.template_version_id=tenant_template.id AND resolution.outcome='replaced' LIMIT 1;
  template_stale:=tenant_template.id IS NULL OR tenant_aggregate.id IS NULL OR tenant_template.template_hash IS DISTINCT FROM current_version.template_hash
   OR tenant_template.version::text IS DISTINCT FROM current_version.template_version OR tenant_template.status<>'approved'
   OR tenant_aggregate.current_approved_version_id IS DISTINCT FROM tenant_template.id;
  template_dto:=jsonb_build_object('ownership','tenant','templateId',tenant_aggregate.id,'templateVersionId',tenant_template.id,
   'version',tenant_template.version,'name',tenant_aggregate.safe_name,'description',tenant_aggregate.safe_description,
   'artifactClass',tenant_template.artifact_class,'lifecycle',tenant_template.status,'templateHash',current_version.template_hash,
   'rendererVersion',current_version.renderer_version,'contentSchemaVersion',current_version.content_schema_version,
   'sections',tenant_template.section_definitions,'replacement',replacement,'actions','[]'::jsonb);
 END IF;
 can_generate:=public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.generate') AND control.enabled AND NOT control.read_only
  AND control.provider_enabled AND NOT package_stale AND NOT template_stale AND(
   (package.source_mode='assess_handoff' AND(COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false) OR COALESCE(flags.module_handoffs_enabled,false)))
   OR(package.source_mode='assess_plus_transcript_bundle' AND COALESCE(flags.module_handoffs_enabled,false) AND COALESCE(flags.studio_multisource_enabled,false))
   OR(package.source_mode IN('direct_transcript_bundle','manual_brief') AND COALESCE(flags.direct_studio_planning_enabled,false) AND COALESCE(flags.studio_multisource_enabled,false)));
 IF can_generate THEN template_dto:=jsonb_set(template_dto,'{actions}',jsonb_build_array('studio.generation.request'));END IF;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',CASE WHEN jsonb_typeof(section.value)='object' AND length(btrim(COALESCE(section.value->>'id','')))>0 THEN left(section.value->>'id',80) ELSE 'section-'||section.ordinality::text END,
  'title',CASE WHEN jsonb_typeof(section.value)='object' AND length(btrim(COALESCE(section.value->>'title','')))>0 THEN left(section.value->>'title',160) ELSE 'Section '||section.ordinality::text END,
  'body',CASE WHEN jsonb_typeof(section.value)='object' THEN COALESCE(section.value->>'body',section.value->>'content','') WHEN jsonb_typeof(section.value)='string' THEN trim(both '"' from section.value::text) ELSE '' END,
  'sourceAnchors',CASE WHEN jsonb_typeof(section.value->'sourceAnchors')='array' THEN section.value->'sourceAnchors' ELSE '[]'::jsonb END,
  'labels',CASE WHEN jsonb_typeof(section.value->'labels')='array' THEN section.value->'labels'
    WHEN package.planning_only THEN jsonb_build_array('assumption') ELSE jsonb_build_array('template_required') END)
  ORDER BY section.ordinality),'[]'::jsonb) INTO artifact_sections
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(current_version.content->'sections')='array' THEN current_version.content->'sections' ELSE '[]'::jsonb END)
  WITH ORDINALITY section(value,ordinality);

 RETURN jsonb_build_object('id',artifact.id,'artifactType',artifact.artifact_type,'aggregateVersion',artifact.aggregate_version,
  'lifecycle',artifact.lifecycle,'ancestry',ancestry,'currentVersion',current_dto,'currentApprovedVersion',approved_dto,
  'versions',versions_dto,'review',review_dto,'approval',approval_dto,'readOnly',NOT control.enabled OR control.read_only,
  'contractVersion','studio-artifact-2','sourcePackage',source_package_dto,'template',template_dto,'sections',artifact_sections,
  'assessmentLabel',package.lineage_classification,'planningLabel',CASE WHEN package.planning_only THEN 'planning_only' ELSE 'governed_assessed' END);
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_source_package_projection(p_org uuid,p_workspace uuid,p_artifact uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN auth.uid() IS NULL OR NOT public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.read') THEN NULL ELSE
  (SELECT jsonb_build_object('artifactId',artifact.id,'aggregateVersion',artifact.aggregate_version,
   'currentVersionId',artifact.current_version_id,'currentApprovedVersionId',artifact.current_approved_version_id,
   'sourcePackageId',package.id,'sourcePackageVersion',package.version,'sourcePackageHash',package.package_hash,
   'sourceMode',package.source_mode,'version',package.version,
   'lineageClassification',package.lineage_classification,'planningOnly',package.planning_only,
   'hasAssessAncestry',package.assess_handoff_id IS NOT NULL,'hasStudioTranscriptBundle',package.studio_input_bundle_version_id IS NOT NULL,
   'hasManualBrief',package.manual_brief_hash IS NOT NULL,'routePolicyVersion',package.route_policy_version,'createdAt',package.created_at)
   FROM public.studio_artifact_aggregates artifact
   JOIN public.studio_artifact_source_packages package
    ON package.id=artifact.source_package_id AND package.artifact_id=artifact.id
     AND package.org_id=artifact.org_id AND package.workspace_id=artifact.workspace_id
   WHERE artifact.id=p_artifact AND artifact.org_id=p_org AND artifact.workspace_id=p_workspace) END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_workspace_projection_v2(
 p_org uuid,p_workspace uuid,p_artifact uuid,p_source_offset integer DEFAULT 0,p_source_limit integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();artifact public.studio_artifact_aggregates;package public.studio_artifact_source_packages;
 current_version public.studio_artifact_versions;control public.studio_artifact_runtime_control;flags public.enterprise_transcript_workspace_flags;
 selected_page jsonb;selected_ids jsonb;covered_ids jsonb;uncovered_ids jsonb;citations jsonb;conflicts jsonb;sections jsonb;
 selected_total integer;package_stale boolean:=false;template_available boolean:=false;route_available boolean:=false;
 provider_available boolean:=false;provider_reason text;actions jsonb:='[]'::jsonb;
BEGIN
 IF actor IS NULL OR p_source_offset<0 OR p_source_limit NOT BETWEEN 1 AND 50
    OR NOT public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.read') THEN RETURN NULL;END IF;
 SELECT * INTO artifact FROM public.studio_artifact_aggregates
  WHERE id=p_artifact AND org_id=p_org AND workspace_id=p_workspace;
 IF artifact.id IS NULL THEN RETURN NULL;END IF;
 SELECT * INTO package FROM public.studio_artifact_source_packages
  WHERE id=artifact.source_package_id AND artifact_id=artifact.id AND org_id=p_org AND workspace_id=p_workspace;
 IF package.id IS NULL OR package.package_hash IS DISTINCT FROM artifact.source_package_hash THEN RETURN NULL;END IF;
 SELECT * INTO current_version FROM public.studio_artifact_versions
  WHERE id=artifact.current_version_id AND artifact_id=artifact.id AND org_id=p_org AND workspace_id=p_workspace;
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton;
 SELECT * INTO flags FROM public.enterprise_transcript_workspace_flags WHERE org_id=p_org AND workspace_id=p_workspace;
 package_stale:=NOT public.studio_pr_b_source_package_is_current(package.id,p_org,p_workspace)
  OR artifact.source_package_id IS DISTINCT FROM package.id OR artifact.source_package_hash IS DISTINCT FROM package.package_hash;

 WITH selected_raw AS(
  SELECT artifact.case_id AS source_id,upstream.source_version_id,upstream.source_case_version::integer AS source_version,
   'Accepted Assess handoff'::text AS label,'assess_handoff'::text AS source_kind,ARRAY['primary']::text[] AS semantic_roles,0 AS sort_group
  FROM public.assess_v2_studio_handoffs upstream WHERE package.assess_handoff_id IS NOT NULL
   AND upstream.id=package.assess_handoff_id AND upstream.org_id=p_org AND upstream.workspace_id=p_workspace
  UNION ALL
  SELECT source.id,source_version.id,source_version.version,source.display_name,source.source_kind,
   array_agg(DISTINCT source_item.semantic_role ORDER BY source_item.semantic_role),1
  FROM public.enterprise_module_input_bundle_items bundle_item
  JOIN public.enterprise_source_set_version_items source_item ON source_item.source_set_version_id=bundle_item.source_set_version_id
   AND source_item.org_id=bundle_item.org_id AND source_item.workspace_id=bundle_item.workspace_id
  JOIN public.enterprise_evidence_source_versions source_version ON source_version.id=source_item.source_version_id
   AND source_version.org_id=source_item.org_id AND source_version.workspace_id=source_item.workspace_id
  JOIN public.enterprise_evidence_sources source ON source.id=source_version.source_id
   AND source.org_id=source_version.org_id AND source.workspace_id=source_version.workspace_id
  WHERE package.studio_input_bundle_version_id IS NOT NULL
   AND bundle_item.input_bundle_version_id=package.studio_input_bundle_version_id
   AND bundle_item.org_id=p_org AND bundle_item.workspace_id=p_workspace
  GROUP BY source.id,source_version.id,source_version.version,source.display_name,source.source_kind
 ),selected AS(
  SELECT DISTINCT ON(source_version_id) source_id,source_version_id,source_version,label,source_kind,semantic_roles,sort_group
  FROM selected_raw ORDER BY source_version_id,sort_group,label,source_id
 ),paged AS(SELECT * FROM selected ORDER BY sort_group,label,source_version_id OFFSET p_source_offset LIMIT p_source_limit)
 SELECT(SELECT count(*) FROM selected),COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'sourceId',source_id,'sourceVersionId',source_version_id,'sourceVersion',source_version,'label',label,
   'sourceKind',source_kind,'semanticRoles',to_jsonb(semantic_roles)
  ) ORDER BY sort_group,label,source_version_id) FROM paged),'[]'::jsonb),
  COALESCE((SELECT jsonb_agg(source_version_id ORDER BY sort_group,label,source_version_id) FROM selected),'[]'::jsonb)
 INTO selected_total,selected_page,selected_ids;

 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',section.value->>'id','title',section.value->>'title','body',section.value->>'body',
   'sourceAnchors',CASE WHEN jsonb_typeof(section.value->'sourceAnchors')='array' THEN section.value->'sourceAnchors' ELSE '[]'::jsonb END,
   'labels',CASE WHEN jsonb_typeof(section.value->'labels')='array' THEN section.value->'labels' ELSE '[]'::jsonb END
  ) ORDER BY section.ordinality),'[]'::jsonb) INTO sections
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(current_version.content->'sections')='array'
  AND current_version.content->>'contractVersion'='studio-artifact-2' THEN current_version.content->'sections' ELSE '[]'::jsonb END)
 WITH ORDINALITY section(value,ordinality);

 SELECT COALESCE(jsonb_agg(jsonb_build_object('sectionId',section.value->>'id','sourceVersionId',anchor.value->>'sourceVersionId',
  'locator',anchor.value->>'locator','anchorHash',anchor.value->>'anchorHash') ORDER BY section.ordinality,anchor.ordinality),'[]'::jsonb)
 INTO citations
 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(current_version.content->'sections')='array'
  AND current_version.content->>'contractVersion'='studio-artifact-2' THEN current_version.content->'sections' ELSE '[]'::jsonb END)
 WITH ORDINALITY section(value,ordinality)
 CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(section.value->'sourceAnchors')='array' THEN section.value->'sourceAnchors' ELSE '[]'::jsonb END)
 WITH ORDINALITY anchor(value,ordinality);
 SELECT COALESCE(jsonb_agg(value ORDER BY value),'[]'::jsonb) INTO covered_ids
 FROM(SELECT DISTINCT citation->>'sourceVersionId' value FROM jsonb_array_elements(citations)citation)x;
 SELECT COALESCE(jsonb_agg(value ORDER BY ordinality),'[]'::jsonb) INTO uncovered_ids
 FROM jsonb_array_elements_text(selected_ids) WITH ORDINALITY selected(value,ordinality)
 WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(covered_ids)covered(value) WHERE covered.value=selected.value);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('conflictKey',public.enterprise_sha256_jsonb(jsonb_build_object(
   'sourcePackageId',package.id,'fieldKey',candidate.field_key)),
   'sourceVersionIds',candidate.source_ids,'status','unresolved') ORDER BY candidate.field_key),'[]'::jsonb) INTO conflicts
 FROM(
  SELECT c.field_key,jsonb_agg(DISTINCT c.source_version_id ORDER BY c.source_version_id)source_ids
  FROM jsonb_array_elements(package.candidate_manifest)binding
  JOIN public.enterprise_evidence_candidates c ON c.id=(binding->>'candidateId')::uuid
   AND c.org_id=p_org AND c.workspace_id=p_workspace AND c.suggestion_status='accepted'
  GROUP BY c.field_key HAVING count(DISTINCT c.value)>1
 )candidate;

 template_available:=current_version.id IS NULL OR(current_version.template_kind='system' AND EXISTS(
  SELECT 1 FROM public.studio_system_template_versions template WHERE template.id=current_version.template_id
   AND template.template_hash=current_version.template_hash AND template.superseded_at IS NULL))
  OR(current_version.template_kind='tenant' AND EXISTS(SELECT 1 FROM public.studio_tenant_template_versions template
   JOIN public.studio_tenant_template_aggregates aggregate ON aggregate.id=template.template_id
   WHERE template.id=current_version.tenant_template_version_id AND template.org_id=p_org AND template.workspace_id=p_workspace
    AND template.template_hash=current_version.template_hash AND template.status='approved' AND aggregate.current_approved_version_id=template.id));
 route_available:=EXISTS(SELECT 1 FROM public.enterprise_ai_capability_routes route
  JOIN public.ai_provider_configs config ON config.id=route.provider_config_id AND config.org_id=route.org_id
  WHERE route.org_id=p_org AND route.workspace_id=p_workspace AND route.capability='studio.document.generate'
   AND route.enabled AND route.deleted_at IS NULL AND config.status='active' AND config.deleted_at IS NULL
   AND config.last_validated_at BETWEEN statement_timestamp()-interval '24 hours' AND statement_timestamp());
 provider_available:=public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.generate')
  AND control.enabled AND NOT control.read_only AND control.provider_enabled AND COALESCE(flags.unified_byok_gateway_enabled,false)
  AND NOT package_stale AND template_available AND route_available
  AND((package.source_mode='assess_handoff' AND(COALESCE((package.route_policy_snapshot->>'migrationBackfill')::boolean,false) OR COALESCE(flags.module_handoffs_enabled,false)))
   OR(package.source_mode='assess_plus_transcript_bundle' AND COALESCE(flags.module_handoffs_enabled,false) AND COALESCE(flags.studio_multisource_enabled,false))
   OR(package.source_mode IN('direct_transcript_bundle','manual_brief') AND COALESCE(flags.direct_studio_planning_enabled,false) AND COALESCE(flags.studio_multisource_enabled,false)));
 provider_reason:=CASE WHEN provider_available THEN 'available'
  WHEN NOT public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.generate') THEN 'permission_denied'
  WHEN NOT control.enabled OR control.read_only OR NOT control.provider_enabled THEN 'read_only'
  WHEN package_stale THEN 'source_stale' WHEN NOT template_available THEN 'template_unavailable'
  WHEN NOT route_available THEN 'route_unavailable' ELSE 'feature_disabled' END;
 IF control.singleton IS NOT NULL AND control.enabled AND NOT control.read_only
    AND current_version.id IS NOT NULL AND public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.edit')
    AND current_version.lifecycle IN('draft','changes_requested','review_rejected','approval_rejected','approved') THEN
  actions:=actions||jsonb_build_array('studio.artifact.draft.revise');
 END IF;
 IF provider_available THEN actions:=actions||jsonb_build_array('studio.generation.request');END IF;
 RETURN jsonb_build_object('contractVersion','studio-workspace-2','organizationId',p_org,'workspaceId',p_workspace,
  'artifact',jsonb_build_object('id',artifact.id,'artifactType',artifact.artifact_type,'aggregateVersion',artifact.aggregate_version,
   'lifecycle',artifact.lifecycle,'currentVersionId',artifact.current_version_id,'currentApprovedVersionId',artifact.current_approved_version_id,'sections',sections),
  'sourcePackage',jsonb_build_object('id',package.id,'version',package.version,'hash',package.package_hash,'mode',package.source_mode,
   'lineageClassification',package.lineage_classification,'planningOnly',package.planning_only,
   'inputBundle',CASE WHEN package.studio_input_bundle_version_id IS NULL THEN NULL ELSE jsonb_build_object('id',package.studio_input_bundle_id,
    'versionId',package.studio_input_bundle_version_id,'version',package.studio_input_bundle_version)END),
  'selectedSources',jsonb_build_object('items',selected_page,'total',selected_total,'offset',p_source_offset,'limit',p_source_limit,
   'hasMore',p_source_offset+p_source_limit<selected_total),
  'coverage',jsonb_build_object('selectedSourceVersionIds',selected_ids,'coveredSourceVersionIds',covered_ids,
   'uncoveredSourceVersionIds',uncovered_ids,'complete',jsonb_array_length(uncovered_ids)=0,'citations',citations,'conflicts',conflicts),
  'providerAvailability',jsonb_build_object('available',provider_available,'reason',provider_reason),'actions',actions);
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.studio_artifact_summary_projection_v2(
 p_org uuid,p_workspace uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor uuid:=auth.uid();items jsonb;total integer;can_edit boolean:=false;
 control public.studio_artifact_runtime_control;
BEGIN
 IF actor IS NULL OR p_offset<0 OR p_limit NOT BETWEEN 1 AND 50
    OR NOT public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.read') THEN RETURN NULL;END IF;
 SELECT * INTO control FROM public.studio_artifact_runtime_control WHERE singleton;
 can_edit:=control.singleton IS NOT NULL AND control.enabled AND NOT control.read_only
  AND public.has_workspace_capability(p_workspace,p_org,'studio.artifacts.edit');
 SELECT count(*)::integer INTO total
 FROM public.studio_artifact_aggregates artifact
 JOIN public.studio_artifact_source_packages package
  ON package.id=artifact.source_package_id AND package.artifact_id=artifact.id
   AND package.org_id=artifact.org_id AND package.workspace_id=artifact.workspace_id
 WHERE artifact.org_id=p_org AND artifact.workspace_id=p_workspace
  AND package.package_hash=artifact.source_package_hash;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id',page.id,'artifactType',page.artifact_type,'aggregateVersion',page.aggregate_version,
  'lifecycle',page.lifecycle,'currentVersionId',page.current_version_id,
  'currentApprovedVersionId',page.current_approved_version_id,'sourceMode',page.source_mode,
  'lineageClassification',page.lineage_classification,'planningOnly',page.planning_only,
  'displayLabel',upper(page.artifact_type)||' artifact v'||page.aggregate_version::text,
  'updatedAt',page.updated_at,'actions',to_jsonb(array_remove(ARRAY[
   CASE WHEN can_edit AND page.current_version_id IS NOT NULL
    AND page.lifecycle IN('draft','changes_requested','review_rejected','approval_rejected','approved')
    THEN 'studio.artifact.draft.revise' END
  ]::text[],NULL))
 ) ORDER BY page.updated_at DESC,page.id),'[]'::jsonb) INTO items
 FROM(
  SELECT artifact.id,artifact.artifact_type,artifact.aggregate_version,artifact.lifecycle,
   artifact.current_version_id,artifact.current_approved_version_id,artifact.updated_at,
   package.source_mode,package.lineage_classification,package.planning_only
  FROM public.studio_artifact_aggregates artifact
  JOIN public.studio_artifact_source_packages package
   ON package.id=artifact.source_package_id AND package.artifact_id=artifact.id
    AND package.org_id=artifact.org_id AND package.workspace_id=artifact.workspace_id
  WHERE artifact.org_id=p_org AND artifact.workspace_id=p_workspace
   AND package.package_hash=artifact.source_package_hash
  ORDER BY artifact.updated_at DESC,artifact.id OFFSET p_offset LIMIT p_limit
 ) page;
 RETURN jsonb_build_object('contractVersion','studio-artifact-summary-2','organizationId',p_org,'workspaceId',p_workspace,
  'items',items,'total',total,'offset',p_offset,'limit',p_limit,'hasMore',p_offset+p_limit<total);
END
$$;

-- Flush the intentionally deferred cyclic aggregate/source-package bindings
-- before subsequent ALTER TABLE statements require no pending trigger events.
SET CONSTRAINTS ALL IMMEDIATE;

DO $$DECLARE table_name text;BEGIN FOREACH table_name IN ARRAY ARRAY[
 'studio_tenant_template_aggregates','studio_tenant_template_versions','studio_tenant_template_review_events','studio_tenant_template_approval_events',
 'studio_tenant_template_command_receipts','enterprise_module_handoffs','enterprise_module_handoff_versions','enterprise_module_handoff_review_events',
 'enterprise_module_handoff_approval_events','enterprise_module_handoff_consumptions','enterprise_module_handoff_command_receipts',
 'studio_artifact_source_packages','studio_artifact_manual_brief_materials','studio_generation_staged_responses','studio_generation_recovery_events'
] LOOP EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',table_name);
 EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',table_name);END LOOP;END$$;

-- No direct authenticated table grants exist. Authenticated callers receive
-- only capability-scoped safe SECURITY DEFINER projections.
REVOKE ALL ON FUNCTION
 public.studio_pr_b_json_structure_safe(jsonb),public.studio_pr_b_template_sections_safe(jsonb),public.studio_pr_b_deterministic_uuid(text,uuid),
 public.studio_pr_b_anchor_manifest_safe(jsonb),public.studio_pr_b_anchor_manifest(jsonb,uuid,text),
 public.enterprise_assess_studio_route_policy(),public.enterprise_direct_studio_route_policy(),public.studio_artifact_source_package_create(jsonb),
 public.studio_artifact_manual_brief_material_retrieve(uuid,uuid,uuid),
 public.enterprise_transcript_assert_module_receipt(uuid,uuid,uuid,uuid,text,text,bigint,uuid,bigint),
 public.enterprise_transcript_create_source_set_version_v2(uuid,text,text,text,text,jsonb,boolean,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_lock_input_bundle_v2(uuid,text,jsonb,text,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_artifact_source_package_create(jsonb),public.studio_tenant_template_command(jsonb),public.enterprise_assess_studio_handoff_command(jsonb),
 public.studio_artifact_generation_request_v2(jsonb),
 public.studio_artifact_generation_claim_v2(uuid,uuid,integer),public.studio_artifact_generation_stage_v2(uuid,uuid,bigint,text,jsonb),
 public.studio_artifact_generation_finalize_v2(uuid,uuid,bigint),public.studio_artifact_generation_fail_v2(uuid,uuid,bigint,text),public.studio_artifact_generation_cancel_v2(uuid,uuid,text),
 public.studio_artifact_generation_timeout_v2(uuid),
 public.studio_pr_b_fill_generation_attempt_binding(),public.studio_pr_b_fill_artifact_version_binding(),public.studio_pr_b_attempt_binding_immutable(),
 public.studio_pr_b_template_version_immutable(),public.studio_pr_b_handoff_binding_immutable(),public.studio_pr_b_staged_response_immutable(),public.studio_pr_b_fill_legacy_aggregate_package(),public.studio_pr_b_validate_aggregate_package(),public.studio_pr_b_delivery_guard()
 ,public.studio_pr_b_validate_source_package()
FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION
 public.enterprise_transcript_module_projection(uuid,uuid,text),public.studio_tenant_template_projection(uuid,uuid),
 public.enterprise_assess_studio_handoff_projection(uuid,uuid),public.studio_artifact_source_package_projection(uuid,uuid,uuid),
 public.studio_artifact_projection_v2(uuid,uuid,uuid),public.studio_artifact_workspace_projection_v2(uuid,uuid,uuid,integer,integer),
 public.studio_artifact_summary_projection_v2(uuid,uuid,integer,integer)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.enterprise_transcript_create_source_set_version_v2(uuid,text,text,text,text,jsonb,boolean,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.enterprise_transcript_lock_input_bundle_v2(uuid,text,jsonb,text,bigint,uuid,uuid,uuid,bigint,uuid,uuid,bigint),
 public.studio_artifact_source_package_create(jsonb),public.studio_artifact_manual_brief_material_retrieve(uuid,uuid,uuid),public.studio_tenant_template_command(jsonb),public.enterprise_assess_studio_handoff_command(jsonb),public.studio_artifact_generation_request_v2(jsonb),
 public.studio_artifact_generation_claim_v2(uuid,uuid,integer),public.studio_artifact_generation_stage_v2(uuid,uuid,bigint,text,jsonb),
 public.studio_artifact_generation_finalize_v2(uuid,uuid,bigint),public.studio_artifact_generation_fail_v2(uuid,uuid,bigint,text),public.studio_artifact_generation_cancel_v2(uuid,uuid,text)
 ,public.studio_artifact_generation_timeout_v2(uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION
 public.enterprise_transcript_module_projection(uuid,uuid,text),public.studio_tenant_template_projection(uuid,uuid),
 public.enterprise_assess_studio_handoff_projection(uuid,uuid),public.studio_artifact_source_package_projection(uuid,uuid,uuid),
 public.studio_artifact_projection_v2(uuid,uuid,uuid),public.studio_artifact_workspace_projection_v2(uuid,uuid,uuid,integer,integer),
 public.studio_artifact_summary_projection_v2(uuid,uuid,integer,integer)
TO authenticated;

REVOKE ALL ON FUNCTION
 public.studio_pr_b_candidate_manifest(uuid,uuid,uuid),public.studio_pr_b_upstream_handoff_is_current(uuid,uuid,uuid),
 public.studio_pr_b_source_package_is_current(uuid,uuid,uuid),public.studio_pr_b_lock_source_package_current(uuid,uuid,uuid),
 public.studio_pr_b_structured_artifact_content_safe(jsonb,public.studio_artifact_source_packages),
 public.studio_artifact_provider_budget_transition_v2(text,uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer,text),
 public.studio_artifact_reserve_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer),
 public.studio_artifact_settle_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
 public.studio_artifact_mark_provider_budget_uncertain_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
 public.studio_artifact_release_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION
 public.studio_artifact_reserve_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,integer,integer),
 public.studio_artifact_settle_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,integer,integer,integer),
 public.studio_artifact_mark_provider_budget_uncertain_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text),
 public.studio_artifact_release_provider_budget_v2(uuid,uuid,uuid,bigint,uuid,uuid,uuid,bigint,uuid,uuid,text,text,text,uuid,text)
TO service_role;

-- The accepted wrapper remains service-only after replacement.
REVOKE ALL ON FUNCTION public.studio_artifact_generation_start(uuid),public.studio_artifact_generation_complete(uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.studio_artifact_generation_start(uuid),public.studio_artifact_generation_complete(uuid,jsonb,text) TO service_role;

COMMENT ON TABLE public.document_generations IS 'Legacy/unverified only: not canonical Studio PR B source-package, template, handoff, or generation authority.';
COMMENT ON TABLE public.studio_artifact_source_packages IS 'Immutable exclusive-union Studio source authority. Direct and manual modes are durably not_assessed/planning_only.';
COMMENT ON TRIGGER studio_pr_b_delivery_assess_handoff_only ON public.enterprise_studio_delivery_handoffs IS 'Temporary PR B fail-closed guard. PR C must replace it only with approved generalized Delivery lineage authority.';

-- Repository migration-chain convergence only. This does not assert that any
-- hosted environment has applied this migration or authorize a deployment.
ALTER TABLE public.hosted_pilot_environment_identity
  DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
UPDATE public.hosted_pilot_environment_identity
SET migration_tip = '20260828120000'
WHERE singleton;
ALTER TABLE public.hosted_pilot_environment_identity
  ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
  CHECK (migration_tip = '20260828120000');
