import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { ProcessModel } from '../processModel/types.ts';
import type { IngestSegment } from '../ingest/segment.ts';
import { setStepTrait } from '../processModel/patch.ts';
import { validateModel } from '../processModel/validate.ts';
import { verifyExcerpts, validateRequest } from '../ai/gateway.ts';
import { TASKS } from '../ai/tasks.ts';
import { applyTraitFindings, batches, traitSegments, type TraitFinding } from './traits.ts';
import { evaluateStep } from './rules.ts';

const gold = (): ProcessModel => JSON.parse(readFileSync(new URL('../../eval/corpus/ap-invoice/expected.model.json', import.meta.url), 'utf8'));
const seg = (sourceId: string, n: number, text: string): IngestSegment => ({ id: `${sourceId}:${n}`, sourceId, kind: 'paragraph', text, locator: { section: `6.${n}` } });

function fixture() {
  const m = gold();
  const step = m.steps[0];
  step.sources = [{ sourceId: 'sop', locator: { section: '6.2' }, excerpt: 'check the mandatory fields' }];
  const sources = [{ key: 'sop', segments: [seg('sop', 1, 'Invoices arrive by email.'), seg('sop', 2, 'The clerk must check the mandatory fields against the PO in SAP using fixed tolerance rules.'), seg('sop', 3, 'Each check takes about 4 minutes.'), seg('sop', 4, 'Unrelated.')] }];
  return { m, step, sources };
}

test('a batch has a card per step and the passages its quotes come from, with neighbours', () => {
  const { m, step, sources } = fixture();
  const { segments, ingest } = traitSegments(m, [step], sources);
  assert.deepEqual(segments.map(s => s.id), [`step:${step.id}`, 'sop:1', 'sop:2', 'sop:3']);
  assert.match(segments[0].text, new RegExp(step.name));
  assert.equal(ingest.size, 3);
  assert.deepEqual(batches([1, 2, 3, 4, 5, 6, 7, 8], 3), [[1, 2, 3], [4, 5, 6], [7, 8]]);
  assert.equal(validateRequest({ workspaceId: '00000000-0000-4000-8000-000000000000', task: 'stepTraits', segments }, TASKS).ok, true);
});

test('verified findings become facts with their quotes, and change the recommendation', () => {
  const { m, step, sources } = fixture();
  const { segments, ingest } = traitSegments(m, [step], sources);
  const raw: TraitFinding[] = [
    { stepId: step.id, trait: 'rulesComplete', value: 'true', certainty: 'stated', segmentId: 'sop:2', excerpt: 'using fixed tolerance rules' },
    { stepId: step.id, trait: 'input', value: 'structured', certainty: 'inferred', segmentId: 'sop:2', excerpt: 'against the PO in SAP' },
    { stepId: step.id, trait: 'effortMinutes', value: '4', certainty: 'stated', segmentId: 'sop:3', excerpt: 'takes about 4 minutes' },
    { stepId: step.id, trait: 'judgment', value: 'false', certainty: 'stated', segmentId: 'sop:2', excerpt: 'not in the passage' },
    { stepId: step.id, trait: 'physical', value: 'true', certainty: 'stated', segmentId: `step:${step.id}`, excerpt: step.name.slice(0, 10) },
    { stepId: step.id, trait: 'write', value: 'catastrophic', certainty: 'stated', segmentId: 'sop:2', excerpt: 'in SAP' },
  ];
  const verified = verifyExcerpts({ findings: raw }, ['findings'], segments).data as { findings: TraitFinding[] };
  assert.equal(verified.findings.length, 5, 'the unquotable finding is dropped by verification');
  const { model, changes } = applyTraitFindings(m, verified.findings, ingest);
  assert.deepEqual(changes.map(c => c.trait).sort(), ['effortMinutes', 'input', 'rulesComplete']);
  const t = model.steps[0].traits!;
  assert.deepEqual(t.rulesComplete, { value: true, status: 'stated', sources: [{ sourceId: 'sop', locator: { section: '6.2' }, excerpt: 'using fixed tolerance rules' }] });
  assert.equal(t.input?.status, 'inferred');
  assert.equal(t.effortMinutes?.value, 4);
  assert.equal(t.physical, undefined, 'a quote from a step card is not evidence');
  assert.deepEqual(validateModel(model).issues.filter(i => i.severity === 'error'), []);
  assert.equal(evaluateStep(model, model.steps[0]).mechanism, 'rules');
});

test('a trait a person set is never changed, and disagreeing findings leave a trait unknown', () => {
  const { m, step, sources } = fixture();
  const { ingest } = traitSegments(m, [step], sources);
  const mine = setStepTrait(m, { stepId: step.id, trait: 'rulesComplete', value: false }).model;
  const findings: TraitFinding[] = [
    { stepId: step.id, trait: 'rulesComplete', value: 'true', certainty: 'stated', segmentId: 'sop:2', excerpt: 'fixed tolerance rules' },
    { stepId: step.id, trait: 'input', value: 'structured', certainty: 'stated', segmentId: 'sop:2', excerpt: 'in SAP' },
    { stepId: step.id, trait: 'input', value: 'unstructured', certainty: 'stated', segmentId: 'sop:1', excerpt: 'arrive by email' },
  ];
  const { model, changes } = applyTraitFindings(mine, findings, ingest);
  assert.deepEqual(changes, []);
  assert.equal(model.steps[0].traits?.rulesComplete?.value, false);
  assert.equal(model.steps[0].traits?.rulesComplete?.status, 'user-confirmed');
  assert.equal(model.steps[0].traits?.input, undefined);
});
