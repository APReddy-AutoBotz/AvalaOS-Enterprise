-- PR 1F additive Assess V2 economics, outcomes, calibration and portfolio authority.
INSERT INTO public.capabilities(capability_key,module,description) VALUES
 ('assess.v2.economics.read','assess','Read Assess V2 approved economics projections'),
 ('assess.v2.economics.write','assess','Create or update Assess V2 economic drafts'),
 ('assess.v2.economics.finalize','assess','Finalize immutable Assess V2 economic versions'),
 ('assess.v2.economics.review','assess','Independently review Assess V2 economics'),
 ('assess.v2.outcomes.record','assess','Record append-only realized outcomes'),
 ('assess.v2.outcomes.review','assess','Independently review realized outcomes'),
 ('assess.v2.calibration.read','assess','Read bounded calibration snapshots'),
 ('assess.v2.calibration.write','assess','Create bounded calibration snapshots'),
 ('assess.v2.portfolio.read','assess','Read workspace-scoped Assess V2 portfolio intelligence')
ON CONFLICT(capability_key) DO UPDATE SET module=excluded.module,description=excluded.description;
CREATE TABLE IF NOT EXISTS public.assess_v2_economic_versions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, case_id uuid NOT NULL,
 source_version_id uuid NOT NULL, decision_id uuid NOT NULL, approved_review_id uuid NOT NULL,
 model_version text NOT NULL CHECK(model_version='assess-v2-economics-model-2026-07'), formula_version text NOT NULL CHECK(formula_version='assess-v2-economics-formulas-2026-07'),
 lifecycle text NOT NULL CHECK(lifecycle IN('draft','reviewer_ready','in_review','approved','changes_requested','rejected','superseded')),
 version bigint NOT NULL CHECK(version>0), currency char(3) NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), baseline_period text NOT NULL,
 analysis_horizon_years int NOT NULL CHECK(analysis_horizon_years>0), implementation_horizon_months int NOT NULL CHECK(implementation_horizon_months>0), discount_rate numeric,
 author_id uuid NOT NULL, reviewer_id uuid, assumptions jsonb NOT NULL DEFAULT '{}'::jsonb, scenario_results jsonb NOT NULL DEFAULT '[]'::jsonb,
 confidence text NOT NULL CHECK(confidence IN('Verified','Partially Evidenced','Assumption-Led','Insufficient Evidence')),
 prior_economic_version_id uuid REFERENCES public.assess_v2_economic_versions(id) ON DELETE RESTRICT,
 receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,workspace_id,case_id,version), UNIQUE(id,case_id,workspace_id,org_id), FOREIGN KEY(case_id,workspace_id,org_id) REFERENCES public.assess_v2_cases(id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(decision_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_decision_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(approved_review_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_review_resolutions(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT,
 CHECK(reviewer_id IS NULL OR reviewer_id<>author_id)
);
CREATE TABLE IF NOT EXISTS public.assess_v2_realized_outcomes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, case_id uuid NOT NULL, economic_version_id uuid NOT NULL REFERENCES public.assess_v2_economic_versions(id) ON DELETE RESTRICT,
 observation_period text NOT NULL, project_reference text NOT NULL, owner_id uuid NOT NULL, collection_method text NOT NULL,
 actuals jsonb NOT NULL, evidence_ids text[] NOT NULL DEFAULT '{}', observation_completeness numeric NOT NULL CHECK(observation_completeness>=0 AND observation_completeness<=1),
 estimated boolean NOT NULL DEFAULT false CHECK(estimated=false), synthetic boolean NOT NULL DEFAULT false, receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(owner_id IS NOT NULL), UNIQUE(id,economic_version_id,case_id,workspace_id,org_id), FOREIGN KEY(economic_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_economic_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS public.assess_v2_outcome_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, case_id uuid NOT NULL, decision_id uuid NOT NULL, economic_version_id uuid NOT NULL, outcome_id uuid NOT NULL, reviewer_id uuid NOT NULL, reviewer_authorization_version bigint NOT NULL, resolution text NOT NULL CHECK(resolution IN('accepted','rejected')), rationale text NOT NULL, receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT, audit_event_id uuid, reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(economic_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_economic_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(outcome_id,economic_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_realized_outcomes(id,economic_version_id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
 CHECK(reviewer_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.assess_v2_economic_review_resolutions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, case_id uuid NOT NULL, decision_id uuid NOT NULL, economic_version_id uuid NOT NULL, approved_review_id uuid NOT NULL, reviewer_id uuid NOT NULL, reviewer_authorization_version bigint NOT NULL, resolution text NOT NULL CHECK(resolution IN('approved','changes_requested','rejected')), rationale text NOT NULL, conditions text[] NOT NULL DEFAULT '{}', receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT, audit_event_id uuid, reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(economic_version_id,case_id,workspace_id,org_id) REFERENCES public.assess_v2_economic_versions(id,case_id,workspace_id,org_id) ON DELETE RESTRICT,
 FOREIGN KEY(approved_review_id,case_id,decision_id,workspace_id,org_id) REFERENCES public.assess_v2_review_resolutions(id,case_id,decision_id,workspace_id,org_id) ON DELETE RESTRICT,
 CHECK(reviewer_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS public.assess_v2_calibration_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, workspace_id uuid NOT NULL, formula_version text NOT NULL,
 cohort_definition jsonb NOT NULL, sample_count int NOT NULL CHECK(sample_count>=0), status text NOT NULL CHECK(status IN('Insufficient Data','Indicative Only','Calibrated for Defined Cohort')),
 metrics jsonb NOT NULL, synthetic_excluded_count int NOT NULL DEFAULT 0, approved_policy_version text, created_by uuid NOT NULL, receipt_id uuid UNIQUE REFERENCES public.assess_command_receipts(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'Calibrated for Defined Cohort' OR (approved_policy_version IS NOT NULL AND sample_count>=5))
);
CREATE OR REPLACE FUNCTION public.pr1f_reject_immutable() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'PR1F_IMMUTABLE_RECORD';END$$;
DROP TRIGGER IF EXISTS trg_pr1f_economic_versions_immutable ON public.assess_v2_economic_versions;
CREATE TRIGGER trg_pr1f_economic_versions_immutable BEFORE UPDATE OR DELETE ON public.assess_v2_economic_versions FOR EACH ROW EXECUTE FUNCTION public.pr1f_reject_immutable();
DROP TRIGGER IF EXISTS trg_pr1f_realized_outcomes_immutable ON public.assess_v2_realized_outcomes;
CREATE TRIGGER trg_pr1f_realized_outcomes_immutable BEFORE UPDATE OR DELETE ON public.assess_v2_realized_outcomes FOR EACH ROW EXECUTE FUNCTION public.pr1f_reject_immutable();
DROP TRIGGER IF EXISTS trg_pr1f_outcome_reviews_immutable ON public.assess_v2_outcome_reviews;
CREATE TRIGGER trg_pr1f_outcome_reviews_immutable BEFORE UPDATE OR DELETE ON public.assess_v2_outcome_reviews FOR EACH ROW EXECUTE FUNCTION public.pr1f_reject_immutable();
DROP TRIGGER IF EXISTS trg_pr1f_economic_review_resolutions_immutable ON public.assess_v2_economic_review_resolutions;
CREATE TRIGGER trg_pr1f_economic_review_resolutions_immutable BEFORE UPDATE OR DELETE ON public.assess_v2_economic_review_resolutions FOR EACH ROW EXECUTE FUNCTION public.pr1f_reject_immutable();
ALTER TABLE public.assess_v2_economic_versions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assess_v2_economic_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assess_v2_realized_outcomes ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assess_v2_realized_outcomes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assess_v2_calibration_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assess_v2_calibration_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assess_v2_outcome_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assess_v2_outcome_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.assess_v2_economic_review_resolutions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.assess_v2_economic_review_resolutions FORCE ROW LEVEL SECURITY;
CREATE POLICY pr1f_economics_read ON public.assess_v2_economic_versions FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,'assess.v2.economics.read') AND EXISTS(SELECT 1 FROM public.assess_v2_cases c JOIN public.assess_v2_decision_versions d ON d.case_id=c.id AND d.org_id=c.org_id AND d.workspace_id=c.workspace_id WHERE c.id=assess_v2_economic_versions.case_id AND c.org_id=assess_v2_economic_versions.org_id AND c.workspace_id=assess_v2_economic_versions.workspace_id AND c.deleted_at IS NULL AND d.id=assess_v2_economic_versions.decision_id));
CREATE POLICY pr1f_outcomes_read ON public.assess_v2_realized_outcomes FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,'assess.v2.economics.read') AND EXISTS(SELECT 1 FROM public.assess_v2_cases c JOIN public.assess_v2_economic_versions e ON e.case_id=c.id AND e.org_id=c.org_id AND e.workspace_id=c.workspace_id WHERE c.id=assess_v2_realized_outcomes.case_id AND c.org_id=assess_v2_realized_outcomes.org_id AND c.workspace_id=assess_v2_realized_outcomes.workspace_id AND c.deleted_at IS NULL AND e.id=assess_v2_realized_outcomes.economic_version_id));
CREATE POLICY pr1f_economic_reviews_read ON public.assess_v2_economic_review_resolutions FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,'assess.v2.economics.read') AND EXISTS(SELECT 1 FROM public.assess_v2_cases c WHERE c.id=assess_v2_economic_review_resolutions.case_id AND c.org_id=assess_v2_economic_review_resolutions.org_id AND c.workspace_id=assess_v2_economic_review_resolutions.workspace_id AND c.deleted_at IS NULL));
CREATE POLICY pr1f_calibration_read ON public.assess_v2_calibration_snapshots FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,'assess.v2.calibration.read'));
CREATE POLICY pr1f_outcome_reviews_read ON public.assess_v2_outcome_reviews FOR SELECT TO authenticated USING (public.has_workspace_capability(workspace_id,org_id,'assess.v2.economics.read') AND EXISTS(SELECT 1 FROM public.assess_v2_cases c JOIN public.assess_v2_economic_versions e ON e.case_id=c.id AND e.org_id=c.org_id AND e.workspace_id=c.workspace_id WHERE c.id=assess_v2_outcome_reviews.case_id AND c.org_id=assess_v2_outcome_reviews.org_id AND c.workspace_id=assess_v2_outcome_reviews.workspace_id AND c.deleted_at IS NULL AND e.id=assess_v2_outcome_reviews.economic_version_id AND e.decision_id=assess_v2_outcome_reviews.decision_id));
REVOKE ALL ON public.assess_v2_economic_versions, public.assess_v2_realized_outcomes, public.assess_v2_outcome_reviews, public.assess_v2_calibration_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assess_v2_economic_versions TO authenticated; GRANT SELECT ON public.assess_v2_realized_outcomes TO authenticated; GRANT SELECT ON public.assess_v2_outcome_reviews TO authenticated; GRANT SELECT ON public.assess_v2_economic_review_resolutions TO authenticated; GRANT SELECT ON public.assess_v2_calibration_snapshots TO authenticated;
COMMENT ON TABLE public.assess_v2_economic_versions IS 'PR 1F additive exact-version-linked economics; capacity is not cash without explicit evidence-backed realization.';
COMMENT ON TABLE public.assess_v2_calibration_snapshots IS 'PR 1F transparent calibration reporting only; synthetic records excluded and formulas are never tuned automatically.';

CREATE OR REPLACE FUNCTION public.pr1f_derive_confidence(p_assumptions jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE item jsonb; has_items boolean:=false;
BEGIN
 FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_assumptions->'benefits','[]'::jsonb)||COALESCE(p_assumptions->'costs','[]'::jsonb)) LOOP
  has_items:=true;
  IF COALESCE(jsonb_array_length(COALESCE(item->'evidenceIds','[]'::jsonb)),0)=0 OR COALESCE(item->>'owner','')='' THEN RETURN 'Insufficient Evidence'; END IF;
  IF item->>'confidence'='Insufficient Evidence' THEN RETURN 'Insufficient Evidence'; END IF;
  IF item->>'confidence'='Assumption-Led' THEN RETURN 'Assumption-Led'; END IF;
 END LOOP;
 IF NOT has_items THEN RETURN 'Insufficient Evidence'; END IF;
 RETURN 'Partially Evidenced';
END$$;

CREATE OR REPLACE FUNCTION public.pr1f_calculate_economics(p_assumptions jsonb,p_horizon int,p_discount numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE scenarios text[]:=ARRAY['low','base','high']; s text; b jsonb; c jsonb; cash numeric; capacity numeric; revenue numeric; risk_value numeric; quality_value numeric; multiplier numeric; one_time numeric; recurring numeric; annual numeric; tco numeric; cumulative numeric; payback numeric; roi numeric; npv numeric; result jsonb:='[]'::jsonb;
BEGIN
 FOREACH s IN ARRAY scenarios LOOP
  cash:=0; capacity:=0; revenue:=0; risk_value:=0; quality_value:=0; one_time:=0; recurring:=0;
  FOR b IN SELECT * FROM jsonb_array_elements(COALESCE(p_assumptions->'benefits','[]'::jsonb)) LOOP
   multiplier:=CASE b#>>'{range,period}' WHEN 'monthly' THEN 12 WHEN 'quarterly' THEN 4 ELSE 1 END;
   IF b->>'category'='capacity_released' THEN capacity:=capacity+(COALESCE((b#>>ARRAY['range',s])::numeric,0)*multiplier); END IF;
   IF b->>'category'='avoidable_cash_expenditure' AND COALESCE((b->>'includeInCash')::boolean,false) THEN cash:=cash+(COALESCE((b#>>ARRAY['range',s])::numeric,0)*multiplier); END IF;
   IF b->>'category' IN('revenue_protected','revenue_enabled') THEN revenue:=revenue+(COALESCE((b#>>ARRAY['range',s])::numeric,0)*multiplier); END IF;
   IF b->>'category'='risk_avoided' THEN risk_value:=risk_value+CASE WHEN b?'risk' THEN COALESCE((b#>>ARRAY['risk','probability',s])::numeric,0)*COALESCE((b#>>ARRAY['risk','exposure',s])::numeric,0)*COALESCE((b#>>ARRAY['risk','controlEffectiveness',s])::numeric,0) ELSE COALESCE((b#>>ARRAY['range',s])::numeric,0)*multiplier END; END IF;
   IF b->>'category' IN('quality_value','sla_cycle_time_value','safety_protection_value','other_typed_value') THEN quality_value:=quality_value+(COALESCE((b#>>ARRAY['range',s])::numeric,0)*multiplier); END IF;
  END LOOP;
  FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_assumptions->'costs','[]'::jsonb)) LOOP
   multiplier:=CASE c#>>'{range,period}' WHEN 'monthly' THEN 12 WHEN 'quarterly' THEN 4 ELSE 1 END;
   IF c#>>'{range,period}'='one_time' THEN one_time:=one_time+COALESCE((c#>>ARRAY['range',s])::numeric,0); ELSE recurring:=recurring+(COALESCE((c#>>ARRAY['range',s])::numeric,0)*multiplier); END IF;
  END LOOP;
  annual:=cash+revenue+risk_value+quality_value-recurring; tco:=one_time+(recurring*p_horizon); cumulative:=(annual*p_horizon)-one_time; payback:=CASE WHEN annual>0 THEN CEIL(one_time/(annual/12)) ELSE NULL END; roi:=CASE WHEN tco>0 THEN ROUND(cumulative/tco,4) ELSE 0 END; npv:=CASE WHEN p_discount IS NULL THEN NULL ELSE ROUND((annual/(1+p_discount))-one_time,2) END;
  result:=result||jsonb_build_array(jsonb_build_object('scenario',s,'capacityReleased',capacity,'annualAvoidableCashBenefit',cash,'annualRevenueValue',revenue,'annualExpectedRiskAdjustedValue',risk_value,'qualitySlaSafetyValue',quality_value,'oneTimeCost',one_time,'annualRecurringCost',recurring,'tco',tco,'netAnnualBenefit',annual,'cumulativeNetValue',cumulative,'paybackPeriodMonths',COALESCE(to_jsonb(payback),'"not reached"'::jsonb),'roi',roi,'npv',npv,'sensitivity',jsonb_build_array(jsonb_build_object('input','avoidable_cash_expenditure','breakEven',one_time+recurring,'trace','server formula assess-v2-economics-formulas-2026-07')))) ;
 END LOOP;
 RETURN result;
END$$;

CREATE OR REPLACE FUNCTION public.pr1f_execute_assess_v2_economics_command(
 p_actor_id uuid,p_org_id uuid,p_workspace_id uuid,p_request_id uuid,p_idempotency_key text,p_authorization_version bigint,p_expected_version bigint,p_command_type text,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE control public.assess_v2_runtime_control; r public.assess_command_receipts; h text:=encode(public.digest(p_command_type||'|'||p_org_id||'|'||p_workspace_id||'|'||p_payload::text,'sha256'),'hex'); econ public.assess_v2_economic_versions; recorded_outcome public.assess_v2_realized_outcomes; res jsonb; next_version bigint; rr public.assess_v2_review_resolutions; scenarios jsonb;
BEGIN
 SELECT * INTO control FROM public.assess_v2_runtime_control WHERE singleton=true FOR SHARE;
 IF control.enabled IS NOT TRUE THEN RAISE EXCEPTION 'PR1F_FEATURE_DISABLED'; END IF;
 PERFORM public.pr1b_assert_command_authority(p_actor_id,p_org_id,p_workspace_id,
  CASE WHEN p_command_type IN('assessment_v2.economics.create','assessment_v2.economics.draft.upsert','assessment_v2.economics.revision.start') THEN 'assess.v2.economics.write'
       WHEN p_command_type='assessment_v2.economics.finalize' THEN 'assess.v2.economics.finalize'
       WHEN p_command_type='assessment_v2.economics.review.resolve' THEN 'assess.v2.economics.review'
       WHEN p_command_type='assessment_v2.outcomes.record' THEN 'assess.v2.outcomes.record'
       WHEN p_command_type='assessment_v2.outcomes.review' THEN 'assess.v2.outcomes.review'
       WHEN p_command_type='assessment_v2.calibration.snapshot.create' THEN 'assess.v2.calibration.write' ELSE 'invalid' END, p_authorization_version);
 SELECT * INTO r FROM public.assess_command_receipts WHERE actor_id=p_actor_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND command_type=p_command_type AND idempotency_key=p_idempotency_key FOR UPDATE;
 IF r.id IS NOT NULL THEN IF r.request_hash<>h THEN RAISE EXCEPTION 'PR1F_IDEMPOTENCY_CONFLICT'; END IF; IF r.status='succeeded' THEN RETURN jsonb_build_object('outcome','replayed','resource',r.response); END IF; RAISE EXCEPTION 'PR1F_IDEMPOTENCY_CONFLICT'; END IF;
 IF control.read_only THEN RAISE EXCEPTION 'PR1F_READ_ONLY'; END IF;
 INSERT INTO public.assess_command_receipts(actor_id,org_id,workspace_id,command_type,idempotency_key,request_id,request_hash,status)
 VALUES(p_actor_id,p_org_id,p_workspace_id,p_command_type,p_idempotency_key,p_request_id,h,'in_progress') RETURNING * INTO r;
 IF p_command_type='assessment_v2.economics.create' THEN
   SELECT rv.* INTO rr FROM public.assess_v2_cases c JOIN public.assess_v2_decision_versions d ON d.case_id=c.id AND d.org_id=c.org_id AND d.workspace_id=c.workspace_id JOIN public.assess_v2_review_resolutions rv ON rv.case_id=c.id AND rv.decision_id=d.id AND rv.source_version_id=d.source_version_id AND rv.org_id=c.org_id AND rv.workspace_id=c.workspace_id WHERE c.id=(p_payload->>'caseId')::uuid AND d.id=(p_payload->>'decisionId')::uuid AND c.org_id=p_org_id AND c.workspace_id=p_workspace_id AND c.deleted_at IS NULL AND rv.resolution='approved' ORDER BY rv.resolved_at DESC LIMIT 1;
   IF rr.id IS NULL THEN RAISE EXCEPTION 'PR1F_APPROVED_REVIEW_REQUIRED'; END IF;
   INSERT INTO public.assess_v2_economic_versions(id,org_id,workspace_id,case_id,source_version_id,decision_id,approved_review_id,model_version,formula_version,lifecycle,version,currency,baseline_period,analysis_horizon_years,implementation_horizon_months,author_id,confidence,receipt_id)
   SELECT (p_payload->>'economicVersionId')::uuid,p_org_id,p_workspace_id,(p_payload->>'caseId')::uuid,d.source_version_id,d.id,rr.id,'assess-v2-economics-model-2026-07','assess-v2-economics-formulas-2026-07','draft',1,(p_payload->>'currency')::char(3),p_payload->>'baselinePeriod',1,1,p_actor_id,'Insufficient Evidence',r.id FROM public.assess_v2_decision_versions d WHERE d.id=(p_payload->>'decisionId')::uuid AND d.org_id=p_org_id AND d.workspace_id=p_workspace_id RETURNING * INTO econ;
 ELSIF p_command_type='assessment_v2.economics.draft.upsert' THEN
   SELECT * INTO econ FROM public.assess_v2_economic_versions WHERE id=(p_payload->>'economicVersionId')::uuid AND org_id=p_org_id AND workspace_id=p_workspace_id AND lifecycle IN('draft','changes_requested') FOR SHARE; IF econ.id IS NULL OR econ.version<>p_expected_version THEN RAISE EXCEPTION 'PR1F_VERSION_CONFLICT'; END IF;
   next_version:=econ.version+1; INSERT INTO public.assess_v2_economic_versions(org_id,workspace_id,case_id,source_version_id,decision_id,approved_review_id,model_version,formula_version,lifecycle,version,currency,baseline_period,analysis_horizon_years,implementation_horizon_months,discount_rate,author_id,assumptions,confidence,prior_economic_version_id,receipt_id)
   VALUES(p_org_id,p_workspace_id,econ.case_id,econ.source_version_id,econ.decision_id,econ.approved_review_id,econ.model_version,econ.formula_version,'draft',next_version,econ.currency,econ.baseline_period,(p_payload->>'analysisHorizonYears')::int,(p_payload->>'implementationHorizonMonths')::int,NULLIF(p_payload->>'discountRate','')::numeric,p_actor_id,p_payload,public.pr1f_derive_confidence(p_payload),econ.id,r.id) RETURNING * INTO econ;
 ELSIF p_command_type IN('assessment_v2.economics.finalize','assessment_v2.economics.review.resolve','assessment_v2.economics.revision.start') THEN
   SELECT * INTO econ FROM public.assess_v2_economic_versions WHERE id=(p_payload->>'economicVersionId')::uuid AND org_id=p_org_id AND workspace_id=p_workspace_id FOR SHARE; IF econ.id IS NULL OR econ.version<>p_expected_version THEN RAISE EXCEPTION 'PR1F_VERSION_CONFLICT'; END IF;
   IF p_command_type='assessment_v2.economics.review.resolve' AND econ.lifecycle<>'reviewer_ready' THEN RAISE EXCEPTION 'PR1F_INVALID_LIFECYCLE'; END IF;
   IF p_command_type='assessment_v2.economics.review.resolve' AND econ.author_id=p_actor_id THEN RAISE EXCEPTION 'PR1F_PERMISSION_DENIED'; END IF;
   SELECT * INTO rr FROM public.assess_v2_review_resolutions WHERE id=econ.approved_review_id AND case_id=econ.case_id AND decision_id=econ.decision_id AND org_id=p_org_id AND workspace_id=p_workspace_id AND resolution='approved'; IF rr.id IS NULL THEN RAISE EXCEPTION 'PR1F_APPROVED_REVIEW_REQUIRED'; END IF;
   IF p_command_type='assessment_v2.economics.finalize' AND econ.lifecycle<>'draft' THEN RAISE EXCEPTION 'PR1F_INVALID_LIFECYCLE'; END IF;
   IF p_command_type='assessment_v2.economics.revision.start' AND econ.lifecycle<>'changes_requested' THEN RAISE EXCEPTION 'PR1F_INVALID_LIFECYCLE'; END IF;
   scenarios:=CASE WHEN p_command_type='assessment_v2.economics.finalize' THEN public.pr1f_calculate_economics(econ.assumptions,econ.analysis_horizon_years,econ.discount_rate) ELSE econ.scenario_results END;
   IF p_command_type='assessment_v2.economics.review.resolve' AND p_payload->>'resolution'='approved' AND (econ.confidence='Insufficient Evidence' OR jsonb_array_length(econ.scenario_results)<>3) THEN RAISE EXCEPTION 'PR1F_INCOMPLETE_ECONOMICS'; END IF;
   IF p_command_type='assessment_v2.economics.review.resolve' THEN INSERT INTO public.assess_v2_economic_review_resolutions(org_id,workspace_id,case_id,decision_id,economic_version_id,approved_review_id,reviewer_id,reviewer_authorization_version,resolution,rationale,conditions,receipt_id) VALUES(p_org_id,p_workspace_id,econ.case_id,econ.decision_id,econ.id,econ.approved_review_id,p_actor_id,p_authorization_version,p_payload->>'resolution',p_payload->>'rationale',ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'conditions','[]'::jsonb))),r.id); END IF;
   next_version:=econ.version+1; INSERT INTO public.assess_v2_economic_versions(org_id,workspace_id,case_id,source_version_id,decision_id,approved_review_id,model_version,formula_version,lifecycle,version,currency,baseline_period,analysis_horizon_years,implementation_horizon_months,discount_rate,author_id,reviewer_id,assumptions,scenario_results,confidence,prior_economic_version_id,receipt_id)
   VALUES(p_org_id,p_workspace_id,econ.case_id,econ.source_version_id,econ.decision_id,econ.approved_review_id,econ.model_version,econ.formula_version,CASE WHEN p_command_type='assessment_v2.economics.finalize' THEN 'reviewer_ready' WHEN p_command_type='assessment_v2.economics.revision.start' THEN 'draft' WHEN p_payload->>'resolution'='approved' THEN 'approved' WHEN p_payload->>'resolution'='changes_requested' THEN 'changes_requested' ELSE 'rejected' END,next_version,econ.currency,econ.baseline_period,econ.analysis_horizon_years,econ.implementation_horizon_months,econ.discount_rate,econ.author_id,CASE WHEN p_command_type='assessment_v2.economics.review.resolve' THEN p_actor_id ELSE NULL END,econ.assumptions,scenarios,CASE WHEN p_command_type='assessment_v2.economics.finalize' AND jsonb_array_length(scenarios)=3 THEN public.pr1f_derive_confidence(econ.assumptions) ELSE econ.confidence END,econ.id,r.id) RETURNING * INTO econ;
 ELSIF p_command_type='assessment_v2.outcomes.record' THEN
   SELECT * INTO econ FROM public.assess_v2_economic_versions WHERE id=(p_payload->>'economicVersionId')::uuid AND org_id=p_org_id AND workspace_id=p_workspace_id AND lifecycle='approved' FOR SHARE; IF econ.id IS NULL THEN RAISE EXCEPTION 'PR1F_NOT_FOUND'; END IF;
   INSERT INTO public.assess_v2_realized_outcomes(org_id,workspace_id,case_id,economic_version_id,observation_period,project_reference,owner_id,collection_method,actuals,evidence_ids,observation_completeness,receipt_id) VALUES(p_org_id,p_workspace_id,econ.case_id,econ.id,p_payload->>'observationPeriod',p_payload->>'projectReference',p_actor_id,p_payload->>'collectionMethod',p_payload->'actuals',ARRAY(SELECT jsonb_array_elements_text(p_payload->'evidenceIds')),(p_payload->>'observationCompleteness')::numeric,r.id) RETURNING * INTO recorded_outcome;
 ELSIF p_command_type='assessment_v2.outcomes.review' THEN
   INSERT INTO public.assess_v2_outcome_reviews(org_id,workspace_id,case_id,decision_id,economic_version_id,outcome_id,reviewer_id,reviewer_authorization_version,resolution,rationale,receipt_id) SELECT p_org_id,p_workspace_id,o.case_id,e.decision_id,e.id,o.id,p_actor_id,p_authorization_version,p_payload->>'resolution',p_payload->>'rationale',r.id FROM public.assess_v2_realized_outcomes o JOIN public.assess_v2_economic_versions e ON e.id=o.economic_version_id AND e.case_id=o.case_id AND e.org_id=o.org_id AND e.workspace_id=o.workspace_id WHERE o.id=(p_payload->>'outcomeId')::uuid AND o.economic_version_id=(p_payload->>'economicVersionId')::uuid AND o.case_id=(p_payload->>'caseId')::uuid AND o.org_id=p_org_id AND o.workspace_id=p_workspace_id AND o.owner_id<>p_actor_id; IF NOT FOUND THEN RAISE EXCEPTION 'PR1F_NOT_FOUND'; END IF;
 ELSIF p_command_type='assessment_v2.calibration.snapshot.create' THEN
   INSERT INTO public.assess_v2_calibration_snapshots(org_id,workspace_id,formula_version,cohort_definition,sample_count,status,metrics,synthetic_excluded_count,created_by,receipt_id) VALUES(p_org_id,p_workspace_id,p_payload->>'formulaVersion',p_payload->'cohortDefinition',0,'Insufficient Data',jsonb_build_object('missingDataRate',1),0,p_actor_id,r.id);
 ELSE RAISE EXCEPTION 'PR1F_INVALID_COMMAND'; END IF;
 res:=jsonb_build_object('id',COALESCE(econ.id,(p_payload->>'economicVersionId')::uuid),'status',COALESCE(econ.lifecycle::text,'committed'),'version',COALESCE(econ.version,p_expected_version+1),'scenarioResults',econ.scenario_results,'confidence',econ.confidence)||CASE WHEN recorded_outcome.id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('outcomeId',recorded_outcome.id) END;
 UPDATE public.assess_command_receipts SET status='succeeded',response=res WHERE id=r.id;
 INSERT INTO public.privileged_audit_events(org_id,workspace_id,actor_id,request_id,action,resource_type,resource_id,outcome,resource_version) VALUES(p_org_id,p_workspace_id,p_actor_id,p_request_id,p_command_type,'assess_v2_economics',COALESCE(econ.id,(p_payload->>'economicVersionId')::uuid),'succeeded',COALESCE(econ.version,p_expected_version+1));
 RETURN jsonb_build_object('outcome','committed','resource',res);
END$$;

CREATE OR REPLACE FUNCTION public.pr1f_read_assess_v2_economics_projection(p_org_id uuid,p_workspace_id uuid,p_case_id uuid,p_decision_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE econ public.assess_v2_economic_versions; outc public.assess_v2_realized_outcomes; outrev public.assess_v2_outcome_reviews; cal public.assess_v2_calibration_snapshots;
BEGIN
 IF NOT public.has_workspace_capability(p_workspace_id,p_org_id,'assess.v2.economics.read') THEN RAISE EXCEPTION 'PR1F_NOT_FOUND'; END IF;
 SELECT e.* INTO econ FROM public.assess_v2_economic_versions e JOIN public.assess_v2_cases c ON c.id=e.case_id AND c.org_id=e.org_id AND c.workspace_id=e.workspace_id WHERE e.org_id=p_org_id AND e.workspace_id=p_workspace_id AND e.case_id=p_case_id AND e.decision_id=p_decision_id AND c.deleted_at IS NULL ORDER BY e.version DESC LIMIT 1;
 IF econ.id IS NULL THEN RETURN jsonb_build_object('version',NULL,'calibrationStatus','Insufficient Data'); END IF;
 SELECT * INTO outc FROM public.assess_v2_realized_outcomes WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND case_id=p_case_id AND economic_version_id=econ.id ORDER BY created_at DESC LIMIT 1;
 IF outc.id IS NOT NULL THEN SELECT * INTO outrev FROM public.assess_v2_outcome_reviews WHERE org_id=p_org_id AND workspace_id=p_workspace_id AND case_id=p_case_id AND economic_version_id=econ.id AND outcome_id=outc.id ORDER BY reviewed_at DESC LIMIT 1; END IF;
 SELECT * INTO cal FROM public.assess_v2_calibration_snapshots WHERE org_id=p_org_id AND workspace_id=p_workspace_id ORDER BY created_at DESC LIMIT 1;
 RETURN jsonb_build_object('version',COALESCE(econ.assumptions,'{}'::jsonb)||jsonb_build_object('id',econ.id,'organizationId',econ.org_id,'workspaceId',econ.workspace_id,'caseId',econ.case_id,'sourceAuthoringVersionId',econ.source_version_id,'decisionVersionId',econ.decision_id,'approvedReviewId',econ.approved_review_id,'modelVersion',econ.model_version,'formulaVersion',econ.formula_version,'status',econ.lifecycle,'version',econ.version,'currency',econ.currency,'baselinePeriod',econ.baseline_period,'analysisHorizonYears',econ.analysis_horizon_years,'implementationHorizonMonths',econ.implementation_horizon_months,'discountRate',econ.discount_rate,'authorId',econ.author_id,'reviewerId',econ.reviewer_id,'benefits',COALESCE(econ.assumptions->'benefits','[]'::jsonb),'costs',COALESCE(econ.assumptions->'costs','[]'::jsonb),'scenarioResults',econ.scenario_results,'confidenceDerived',econ.confidence),'approvedReviewAncestry',jsonb_build_object('approvedReviewId',econ.approved_review_id,'caseId',econ.case_id,'decisionId',econ.decision_id),'technicalReady',true,'governanceApproved',true,'latestOutcome',CASE WHEN outc.id IS NULL THEN NULL ELSE jsonb_build_object('id',outc.id,'period',outc.observation_period) END,'latestOutcomeReview',CASE WHEN outrev.id IS NULL THEN NULL ELSE jsonb_build_object('id',outrev.id,'resolution',outrev.resolution) END,'calibrationStatus',COALESCE(cal.status,'Insufficient Data'),'portfolioDisposition','Validate assumptions first');
END$$;
REVOKE ALL ON FUNCTION public.pr1f_execute_assess_v2_economics_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.pr1f_execute_assess_v2_economics_command(uuid,uuid,uuid,uuid,text,bigint,bigint,text,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.pr1f_read_assess_v2_economics_projection(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pr1f_read_assess_v2_economics_projection(uuid,uuid,uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.pr1f_outcome_review_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'PR1F_IMMUTABLE_RECORD'; END IF;
 IF NEW.id=OLD.id AND NEW.org_id=OLD.org_id AND NEW.workspace_id=OLD.workspace_id AND NEW.case_id=OLD.case_id AND NEW.economic_version_id=OLD.economic_version_id AND NEW.observation_period=OLD.observation_period AND NEW.project_reference=OLD.project_reference AND NEW.owner_id=OLD.owner_id AND NEW.collection_method=OLD.collection_method AND NEW.actuals=OLD.actuals AND NEW.evidence_ids=OLD.evidence_ids AND NEW.observation_completeness=OLD.observation_completeness AND NEW.estimated=OLD.estimated AND NEW.synthetic=OLD.synthetic AND NEW.receipt_id=OLD.receipt_id AND NEW.created_at=OLD.created_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'PR1F_IMMUTABLE_RECORD';
END$$;
DROP TRIGGER IF EXISTS trg_pr1f_realized_outcomes_immutable ON public.assess_v2_realized_outcomes;
CREATE TRIGGER trg_pr1f_realized_outcomes_review_only BEFORE UPDATE OR DELETE ON public.assess_v2_realized_outcomes FOR EACH ROW EXECUTE FUNCTION public.pr1f_outcome_review_only();
