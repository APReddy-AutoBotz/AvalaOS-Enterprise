-- Forward-only XLSX source-ingestion authority correction. Rollback disables
-- Assess document mapping/ingestion or enters read-only operation while
-- retaining immutable source, receipt, and Assess history for additive repair.
-- Apply this single DO statement transactionally.
DO $assess_document_xlsx_ingestion$
DECLARE
  marker public.hosted_pilot_environment_identity;
  singleton_count bigint;
  exercise_count bigint;
  recovery_count bigint;
  changed_count bigint;
  trigger_count bigint;
  old_constraint_expression text;
  source_mime_constraint_expression text;
  parser_kind_constraint_expression text;
  source_function_oid oid;
  replacement_function_oid oid;
  old_function_owner oid;
  replacement_function_owner oid;
  old_function_acl pg_catalog.aclitem[];
  replacement_function_acl pg_catalog.aclitem[];
  old_function_config text[];
  replacement_function_config text[];
  old_function_source text;
  replacement_function_source text;
  normalized_old_function_source text;
  expected_replacement_function_source text;
  normalized_replacement_function_source text;
  old_function_source_hash text;
  classifier_before pg_catalog.pg_proc;
  classifier_after pg_catalog.pg_proc;
  classifier_old_body text;
  classifier_expected_body text;
BEGIN
  -- Freeze the exact synthetic identity, controlled-human history, and source
  -- write boundary so none of the fail-closed preconditions can race commit.
  LOCK TABLE public.hosted_pilot_environment_identity IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.pr_c_controlled_human_exercises,
    public.pr_c_controlled_human_recovery_authorities IN SHARE MODE;
  LOCK TABLE public.enterprise_evidence_sources,
    public.enterprise_evidence_source_versions IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO singleton_count
  FROM public.hosted_pilot_environment_identity;
  IF singleton_count <> 1 THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  SELECT stored.* INTO STRICT marker
  FROM public.hosted_pilot_environment_identity stored
  WHERE stored.singleton IS TRUE
  FOR UPDATE;

  IF marker.product_key <> 'avalaos-core'
     OR marker.environment_class <> 'hosted_nonproduction_pilot'
     OR marker.schema_contract <> 'hosted-pilot-2026-08'
     OR marker.migration_tip <> '20260916151050'
     OR marker.production_authorized
     OR marker.customer_data_authorized
     OR marker.real_provider_calls_authorized THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO old_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.hosted_pilot_environment_identity'::regclass
    AND constraint_row.conname = 'hosted_pilot_environment_identity_migration_tip_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF old_constraint_expression IS DISTINCT FROM '(migration_tip = ''20260916151050''::text)' THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  SELECT count(*) INTO exercise_count
  FROM public.pr_c_controlled_human_exercises;
  SELECT count(*) INTO recovery_count
  FROM public.pr_c_controlled_human_recovery_authorities;
  IF exercise_count <> 0 OR recovery_count <> 0 THEN
    -- Retain only the exact completed deprovision history from the prior
    -- controlled exercise; no active or unbound authority can cross this tip.
    IF exercise_count <> 1 OR recovery_count <> 4 OR NOT EXISTS (
      SELECT 1 FROM public.pr_c_controlled_human_exercises historical
      WHERE historical.lifecycle = 'deprovisioned'
        AND historical.migration_tip = '20260904120000'
        AND historical.synthetic_only
        AND NOT historical.production_authorized
        AND NOT historical.customer_data_authorized
        AND NOT historical.real_provider_calls_authorized
        AND (
          SELECT count(*) FROM public.pr_c_controlled_human_recovery_authorities recovery
          WHERE recovery.exercise_digest = historical.exercise_digest
            AND recovery.release_sha = historical.release_sha
            AND recovery.deploy_id = historical.deploy_id
            AND recovery.target_fingerprint = historical.target_fingerprint
            AND (recovery.operation <> 'apply' OR cardinality(recovery.auth_user_ids) = 12)
            AND ((recovery.operation IN ('apply','quiesce','deprovision') AND recovery.state = 'completed')
              OR (recovery.operation = 'abort' AND recovery.state = 'prepared'))
        ) = 4
    ) THEN
      RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
    END IF;
  END IF;

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO source_mime_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.enterprise_evidence_sources'::regclass
    AND constraint_row.conname = 'enterprise_evidence_sources_mime_type_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF source_mime_constraint_expression IS DISTINCT FROM
    '(mime_type = ANY (ARRAY[''text/plain''::text, ''text/markdown''::text, ''text/csv''::text, ''text/vtt''::text, ''application/x-subrip''::text, ''text/x-srt''::text, ''text/meeting-notes''::text, ''application/pdf''::text, ''application/vnd.openxmlformats-officedocument.wordprocessingml.document''::text, ''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet''::text]))' THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO parser_kind_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.enterprise_evidence_source_versions'::regclass
    AND constraint_row.conname = 'enterprise_evidence_source_versions_parser_kind_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF parser_kind_constraint_expression IS DISTINCT FROM
    '(parser_kind = ANY (ARRAY[''text_native''::text, ''csv''::text, ''vtt''::text, ''srt''::text, ''pdf_text''::text, ''docx''::text, ''xlsx''::text]))' THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  source_function_oid := pg_catalog.to_regprocedure('public.enterprise_source_version_derive()');
  IF source_function_oid IS NULL THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;
  SELECT function_row.proowner, function_row.proacl, function_row.proconfig,
    function_row.prosrc
  INTO old_function_owner, old_function_acl, old_function_config,
    old_function_source
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = source_function_oid
    AND function_row.prokind = 'f'
    AND function_row.prorettype = 'pg_catalog.trigger'::regtype
    AND function_row.pronargs = 0
    AND function_row.prosecdef IS FALSE
    AND function_row.proleakproof IS FALSE
    AND function_row.proisstrict IS FALSE
    AND function_row.provolatile = 'v'
    AND function_row.proparallel = 'u'
    AND function_row.prolang = (
      SELECT language_row.oid
      FROM pg_catalog.pg_language language_row
      WHERE language_row.lanname = 'plpgsql'
    )
    AND function_row.proconfig = ARRAY['search_path=pg_catalog']::text[];
  normalized_old_function_source := pg_catalog.replace(old_function_source, E'\r\n', E'\n');
  old_function_source_hash := pg_catalog.encode(public.digest(
    pg_catalog.convert_to(normalized_old_function_source, 'UTF8'), 'sha256'
  ), 'hex');
  IF old_function_source IS NULL
     OR old_function_source_hash <> '7307ee85772674a28a47f2ca0a9fe099a596e864e5c4b28996a287bc04fdebc1'
     OR pg_catalog.strpos(normalized_old_function_source,
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') <> 0 THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;
  expected_replacement_function_source := pg_catalog.replace(
    normalized_old_function_source,
    E'    WHEN ''application/vnd.openxmlformats-officedocument.wordprocessingml.document'' THEN ''docx''\n',
    E'    WHEN ''application/vnd.openxmlformats-officedocument.wordprocessingml.document'' THEN ''docx''\n    WHEN ''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'' THEN ''xlsx''\n'
  );
  IF expected_replacement_function_source IS NOT DISTINCT FROM normalized_old_function_source THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  SELECT count(*) INTO trigger_count
  FROM pg_catalog.pg_trigger trigger_row
  WHERE trigger_row.tgrelid = 'public.enterprise_evidence_source_versions'::regclass
    AND trigger_row.tgname = 'enterprise_source_version_derive_before_insert'
    AND NOT trigger_row.tgisinternal
    AND trigger_row.tgenabled = 'O'
    AND trigger_row.tgtype = 7
    AND trigger_row.tgfoid = source_function_oid;
  IF trigger_count <> 1 OR (
    SELECT count(*)
    FROM pg_catalog.pg_trigger trigger_row
    WHERE trigger_row.tgrelid = 'public.enterprise_evidence_source_versions'::regclass
      AND trigger_row.tgname = 'enterprise_source_version_derive_before_insert'
      AND NOT trigger_row.tgisinternal
  ) <> 1 THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  -- Assess's native evidence classifier is a second media boundary. Validate
  -- it before either replacement so the one transaction preserves all authority.
  SELECT function_row.* INTO classifier_before
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = pg_catalog.to_regprocedure('public.enterprise_assess_v2_source_type(text,text)');
  classifier_old_body := pg_catalog.replace(classifier_before.prosrc, E'\r\n', E'\n');
  IF classifier_before.oid IS NULL
     OR classifier_before.prokind <> 'f'
     OR classifier_before.prorettype <> 'pg_catalog.text'::regtype
     OR classifier_before.pronargs <> 2
     OR classifier_before.proargtypes <> '25 25'::pg_catalog.oidvector
     OR classifier_before.proargnames IS DISTINCT FROM ARRAY['p_source_kind','p_mime_type']::text[]
     OR classifier_before.prosecdef
     OR classifier_before.proleakproof
     OR NOT classifier_before.proisstrict
     OR classifier_before.provolatile <> 'i'
     OR classifier_before.proparallel <> 'u'
     OR classifier_before.prolang <> (SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
     OR classifier_before.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(classifier_old_body,'UTF8')),'hex')
       IS DISTINCT FROM '6cbb1ff74fb00854063571ff52a4d53c0c14d3ef25a348d9a75f651a0a8f8a21' THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;
  classifier_expected_body := pg_catalog.replace(classifier_old_body,
    E'       ''application/vnd.openxmlformats-officedocument.wordprocessingml.document''\n',
    E'       ''application/vnd.openxmlformats-officedocument.wordprocessingml.document'',\n       ''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet''\n');
  IF classifier_expected_body IS NOT DISTINCT FROM classifier_old_body THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;

  EXECUTE $replacement_function$
CREATE OR REPLACE FUNCTION public.enterprise_source_version_derive()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE source public.enterprise_evidence_sources; expected_parser TEXT;
BEGIN
  SELECT * INTO source
  FROM public.enterprise_evidence_sources
  WHERE id = NEW.source_id AND org_id = NEW.org_id AND workspace_id = NEW.workspace_id
  FOR SHARE;
  IF source.id IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_SOURCE_NOT_FOUND'; END IF;
  expected_parser := CASE source.mime_type
    WHEN 'text/plain' THEN 'text_native'
    WHEN 'text/markdown' THEN 'text_native'
    WHEN 'text/meeting-notes' THEN 'text_native'
    WHEN 'text/csv' THEN 'csv'
    WHEN 'text/vtt' THEN 'vtt'
    WHEN 'application/x-subrip' THEN 'srt'
    WHEN 'text/x-srt' THEN 'srt'
    WHEN 'application/pdf' THEN 'pdf_text'
    WHEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN 'docx'
    WHEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' THEN 'xlsx'
    ELSE NULL
  END;
  IF expected_parser IS NULL THEN RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_UNSUPPORTED_FORMAT'; END IF;
  NEW.parser_kind := expected_parser;
  NEW.parser_version := COALESCE(NULLIF(btrim(NEW.parser_version), ''), 'enterprise-parser-1');
  IF NEW.storage_bucket <> 'source-uploads'
     OR NEW.storage_path <> format('%s/%s/enterprise-evidence/%s.bin', NEW.org_id, NEW.workspace_id, NEW.source_id) THEN
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_STORAGE_BINDING_INVALID';
  END IF;
  IF NEW.extracted_text_hash IS NOT NULL AND NEW.extracted_character_count IS NOT NULL THEN
    NEW.extraction_status := 'parsed'; NEW.extraction_failure_code := NULL;
  ELSIF NEW.extraction_status = 'failed_ocr_required'
        AND source.mime_type = 'application/pdf'
        AND NEW.extraction_failure_code = 'OCR_REQUIRED'
        AND NEW.extracted_text_hash IS NULL AND NEW.extracted_character_count IS NULL THEN
    NULL;
  ELSIF NEW.extraction_status IN ('failed_unsupported', 'failed_malformed')
        AND NEW.extraction_failure_code IN ('UNSUPPORTED_FORMAT', 'MALFORMED_SOURCE')
        AND NEW.extracted_text_hash IS NULL AND NEW.extracted_character_count IS NULL THEN
    NULL;
  ELSIF NEW.extraction_status = 'pending'
        AND NEW.extracted_text_hash IS NULL AND NEW.extracted_character_count IS NULL
        AND NEW.extraction_failure_code IS NULL THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'ENTERPRISE_EVIDENCE_EXTRACTION_STATE_INVALID';
  END IF;
  NEW.provenance_hash := public.enterprise_sha256_jsonb(jsonb_build_object(
    'sourceId', NEW.source_id, 'sourceVersionId', NEW.id, 'version', NEW.version,
    'organizationId', NEW.org_id, 'workspaceId', NEW.workspace_id,
    'mimeType', source.mime_type, 'contentHash', NEW.content_hash,
    'contentBytes', NEW.content_bytes, 'parserKind', NEW.parser_kind,
    'parserVersion', NEW.parser_version
  ));
  RETURN NEW;
END;
$$;
$replacement_function$;

  replacement_function_oid := pg_catalog.to_regprocedure('public.enterprise_source_version_derive()');
  SELECT function_row.proowner, function_row.proacl, function_row.proconfig,
    function_row.prosrc
  INTO replacement_function_owner, replacement_function_acl,
    replacement_function_config, replacement_function_source
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = replacement_function_oid
    AND function_row.prokind = 'f'
    AND function_row.prorettype = 'pg_catalog.trigger'::regtype
    AND function_row.pronargs = 0
    AND function_row.prosecdef IS FALSE
    AND function_row.proleakproof IS FALSE
    AND function_row.proisstrict IS FALSE
    AND function_row.provolatile = 'v'
    AND function_row.proparallel = 'u'
    AND function_row.prolang = (
      SELECT language_row.oid
      FROM pg_catalog.pg_language language_row
      WHERE language_row.lanname = 'plpgsql'
    );
  normalized_replacement_function_source := pg_catalog.replace(
    replacement_function_source, E'\r\n', E'\n'
  );
  IF replacement_function_oid IS DISTINCT FROM source_function_oid
     OR replacement_function_owner IS DISTINCT FROM old_function_owner
     OR replacement_function_acl IS DISTINCT FROM old_function_acl
     OR replacement_function_config IS DISTINCT FROM old_function_config
     OR replacement_function_source IS NULL
     OR normalized_replacement_function_source IS DISTINCT FROM expected_replacement_function_source THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_REPLACEMENT_FAILED';
  END IF;

  EXECUTE $replacement_classifier$
CREATE OR REPLACE FUNCTION public.enterprise_assess_v2_source_type(
  p_source_kind TEXT,
  p_mime_type TEXT
)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
BEGIN
  -- Enterprise sources distinguish upload/paste and parser media, not an
  -- independently governed interview/observation/test semantic. Document is
  -- therefore the only truthful Assess author-source classification.
  IF p_source_kind NOT IN ('upload', 'pasted_text')
     OR p_mime_type NOT IN (
       'text/plain', 'text/markdown', 'text/csv', 'text/vtt',
       'application/x-subrip', 'text/x-srt', 'text/meeting-notes',
       'application/pdf',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
     ) THEN
    RAISE EXCEPTION 'ENTERPRISE_ASSESS_EVIDENCE_SOURCE_INVALID';
  END IF;
  RETURN 'document';
END;
$$;
$replacement_classifier$;
  SELECT function_row.* INTO classifier_after
  FROM pg_catalog.pg_proc function_row
  WHERE function_row.oid = pg_catalog.to_regprocedure('public.enterprise_assess_v2_source_type(text,text)');
  IF (to_jsonb(classifier_after)-'prosrc') IS DISTINCT FROM (to_jsonb(classifier_before)-'prosrc')
     OR pg_catalog.replace(classifier_after.prosrc,E'\r\n',E'\n') IS DISTINCT FROM classifier_expected_body THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_REPLACEMENT_FAILED';
  END IF;

  ALTER TABLE public.hosted_pilot_environment_identity
    DROP CONSTRAINT hosted_pilot_environment_identity_migration_tip_check;
  UPDATE public.hosted_pilot_environment_identity
  SET migration_tip = '20260916181916'
  WHERE singleton IS TRUE
    AND product_key = 'avalaos-core'
    AND environment_class = 'hosted_nonproduction_pilot'
    AND schema_contract = 'hosted-pilot-2026-08'
    AND migration_tip = '20260916151050'
    AND NOT production_authorized
    AND NOT customer_data_authorized
    AND NOT real_provider_calls_authorized;
  GET DIAGNOSTICS changed_count = ROW_COUNT;
  IF changed_count <> 1 THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_PRECONDITION_FAILED';
  END IF;
  ALTER TABLE public.hosted_pilot_environment_identity
    ADD CONSTRAINT hosted_pilot_environment_identity_migration_tip_check
    CHECK (migration_tip = '20260916181916');

  SELECT pg_catalog.pg_get_expr(constraint_row.conbin, constraint_row.conrelid, false)
  INTO old_constraint_expression
  FROM pg_catalog.pg_constraint constraint_row
  WHERE constraint_row.conrelid = 'public.hosted_pilot_environment_identity'::regclass
    AND constraint_row.conname = 'hosted_pilot_environment_identity_migration_tip_check'
    AND constraint_row.contype = 'c'
    AND constraint_row.convalidated;
  IF old_constraint_expression IS DISTINCT FROM '(migration_tip = ''20260916181916''::text)' THEN
    RAISE EXCEPTION 'ASSESS_DOCUMENT_XLSX_INGESTION_REPLACEMENT_FAILED';
  END IF;
END
$assess_document_xlsx_ingestion$;
