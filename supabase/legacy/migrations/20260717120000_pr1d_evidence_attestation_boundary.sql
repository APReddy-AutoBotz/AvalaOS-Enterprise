-- PR 1D correction: authoring can submit evidence but cannot attest it.
CREATE OR REPLACE FUNCTION public.pr1d_reject_author_attestation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE payload jsonb := NEW.payload;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload->>'status' IS NULL OR payload->>'status' NOT IN ('suggested','submitted') OR payload->'validated' IS DISTINCT FROM 'false'::jsonb OR payload ? 'reviewAttestation' OR payload ? 'reviewReceipt' OR payload ? 'validationReceipt' OR (payload ? 'reviewerIds' AND (jsonb_typeof(payload->'reviewerIds') IS DISTINCT FROM 'array' OR jsonb_array_length(payload->'reviewerIds') <> 0)) OR (payload ? 'contradictory' AND payload->'contradictory' <> 'false'::jsonb) THEN RAISE EXCEPTION 'PR1D_AUTHOR_ATTESTATION_FORBIDDEN'; END IF;
  RETURN NEW;
END$$;
DROP TRIGGER IF EXISTS trg_pr1d_author_attestation ON public.assess_v2_evidence_links;
CREATE TRIGGER trg_pr1d_author_attestation BEFORE INSERT ON public.assess_v2_evidence_links FOR EACH ROW EXECUTE FUNCTION public.pr1d_reject_author_attestation();
REVOKE ALL ON FUNCTION public.pr1d_reject_author_attestation() FROM PUBLIC, anon, authenticated;
