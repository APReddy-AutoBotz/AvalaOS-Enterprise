import {
  ASSESS_MAPPING_TARGET_KINDS,
  type AssessMappingJsonValue,
  type AssessMappingProposalProjection,
  type AssessMappingTargetDescriptor,
  isAssessMappingJsonValue,
} from './contracts.ts';
import {
  createUnknownAgentNecessityFacts,
  type ApplicationAsset,
  type ApplicationInteraction,
  type CaseFact,
  type DecisionPoint,
  type EvidenceLink,
  type ExceptionPath,
  type ProcessPrimitive,
} from '../assessV2/types.ts';
import type { AssessMappingDraft } from './targetRegistry.ts';

const primitiveTypes = ['Capture', 'Extract', 'Classify', 'Validate', 'Calculate', 'Reconcile', 'Retrieve', 'Investigate', 'Decide', 'Approve', 'Route', 'Execute', 'Communicate', 'Monitor', 'Audit'] as const;
const businessDispositions = ['Monitor / Do Nothing', 'Simplify', 'Redesign', 'Human-Led', 'Existing Product Configuration', 'Custom Application'] as const;
const interactionModes = ['read', 'write', 'event', 'ui', 'operational'] as const;
const dataClassifications = ['Public', 'Internal', 'Confidential', 'Restricted', 'Unknown'] as const;

export const canonicalAssessMappingValue = (value: AssessMappingJsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAssessMappingValue).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalAssessMappingValue(value[key])}`).join(',')}}`;
};

const record = (value: unknown): value is Record<string, AssessMappingJsonValue> => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && isAssessMappingJsonValue(value);
const text = (value: unknown, maximum = 4_000) => typeof value === 'string' && value.trim().length > 0 && Array.from(value).length <= maximum;
const optionalText = (value: unknown, maximum = 4_000) => value === undefined || value === null || (typeof value === 'string' && Array.from(value).length <= maximum);
const stringList = (value: unknown, maximum = 200) => Array.isArray(value) && value.length <= maximum && value.every(item => text(item, 1_000));
const exactKeys = (value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => {
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key));
};

export const validateAssessMappingValue = (target: AssessMappingTargetDescriptor, value: unknown): value is AssessMappingJsonValue => {
  if (!isAssessMappingJsonValue(value)) return false;
  if (target.allowedValues && target.valueType !== 'primitive_constructor'
    && (typeof value !== 'string' || !target.allowedValues.includes(value))) return false;
  switch (target.valueType) {
    case 'text': {
      const maximum = ['case.name', 'primitive.name', 'primitive.owner', 'asset.name', 'asset.accountableOwner', 'interaction.operationName'].includes(target.fieldId)
        ? 200 : target.fieldId === 'primitive.trigger' ? 500 : 4_000;
      return text(value, maximum);
    }
    case 'boolean': return typeof value === 'boolean';
    case 'ratio': return typeof value === 'number' && value >= 0 && value <= 1;
    case 'number': return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10_000_000;
    case 'text_list': return stringList(value);
    case 'primitive_type': return typeof value === 'string' && primitiveTypes.includes(value as typeof primitiveTypes[number]);
    case 'business_disposition': return typeof value === 'string' && businessDispositions.includes(value as typeof businessDispositions[number]);
    case 'interaction_mode': return typeof value === 'string' && interactionModes.includes(value as typeof interactionModes[number]);
    case 'data_classification': return typeof value === 'string' && dataClassifications.includes(value as typeof dataClassifications[number]);
    case 'asset_strategic_lifespan': return typeof value === 'string' && ['short', 'medium', 'long', 'unknown'].includes(value);
    case 'asset_technical_health': return typeof value === 'string' && ['healthy', 'constrained', 'end-of-life', 'unknown'].includes(value);
    case 'asset_business_criticality': return typeof value === 'string' && ['low', 'medium', 'high', 'critical', 'unknown'].includes(value);
    case 'asset_ownership_model': return typeof value === 'string' && ['source-owned', 'vendor-owned', 'shared', 'unknown'].includes(value);
    case 'asset_vendor_roadmap': return typeof value === 'string' && ['supportive', 'constrained', 'end-of-life', 'unknown'].includes(value);
    case 'asset_operating_stability': return typeof value === 'string' && ['stable', 'variable', 'unstable', 'unknown'].includes(value);
    case 'evidence': return value === null || text(value);
    case 'primitive_constructor':
      return record(value) && exactKeys(value, ['name', 'description'], ['trigger', 'inputs', 'outputs', 'owner', 'rules'])
        && text(value.name, 200) && text(value.description) && optionalText(value.trigger, 500)
        && optionalText(value.owner, 200) && (value.inputs === undefined || stringList(value.inputs, 200))
        && (value.outputs === undefined || stringList(value.outputs, 200)) && (value.rules === undefined || stringList(value.rules, 200));
    case 'asset_constructor':
      return record(value) && exactKeys(value, ['name'], ['accountableOwner']) && text(value.name, 200)
        && optionalText(value.accountableOwner, 200);
    case 'interaction_constructor':
      return record(value) && exactKeys(value, ['operationName', 'mode', 'dataClassification', 'highImpact', 'financialAction', 'untrustedContentWithTools'])
        && text(value.operationName, 200) && interactionModes.includes(value.mode as typeof interactionModes[number])
        && dataClassifications.includes(value.dataClassification as typeof dataClassifications[number])
        && typeof value.highImpact === 'boolean' && typeof value.financialAction === 'boolean'
        && typeof value.untrustedContentWithTools === 'boolean';
    case 'decision_constructor':
      return record(value) && exactKeys(value, ['name', 'ruleDescription', 'outcomeLabels'])
        && text(value.name, 200) && text(value.ruleDescription, 2_000) && stringList(value.outcomeLabels, 200);
    case 'exception_constructor':
      return record(value) && exactKeys(value, ['name', 'trigger']) && text(value.name, 200) && text(value.trigger, 2_000);
  }
};

const withEvidence = (existing: string[], evidenceId: string) => [...new Set([...existing, evidenceId])].sort();
const evidenceLink = (id: string, claimId: string): EvidenceLink => ({
  id, claimIds: [claimId], sourceType: 'document', status: 'suggested', validated: false,
});
const updatedFact = (fact: CaseFact, value: unknown, evidenceId: string): CaseFact => ({
  ...fact,
  value,
  status: 'suggested',
  source: fact.source,
  evidenceIds: withEvidence(fact.evidenceIds, evidenceId),
});

const canonicalPrimitiveFactAliases = (facts: Record<string, CaseFact>, fieldId: string) => Object.keys(facts)
  .filter(key => (key.startsWith('primitive.') ? key : `primitive.${key}`) === fieldId);

export interface AssessMappingMaterializationInput {
  draft: AssessMappingDraft;
  target: AssessMappingTargetDescriptor;
  value: AssessMappingJsonValue;
  evidenceId: string;
  claimId: string;
  createId: () => string;
}

/**
 * Reference materializer used by Edge/SQL contract tests. SQL remains the
 * transactional authority and must repeat these checks under the case lock.
 */
export const materializeAssessMappingSelection = (input: AssessMappingMaterializationInput): AssessMappingDraft => {
  const { target, value, evidenceId } = input;
  if (!ASSESS_MAPPING_TARGET_KINDS.includes(target.targetKind) || !validateAssessMappingValue(target, value)) {
    throw new Error('ASSESS_MAPPING_VALUE_INVALID');
  }
  const draft = structuredClone(input.draft);
  if (!draft.evidenceLinks.some(item => item.id === evidenceId)) draft.evidenceLinks.push(evidenceLink(evidenceId, input.claimId));
  const entity = target.entityId;
  if (target.targetKind === 'evidence_only') {
    if (target.operation !== 'link_evidence' || target.fieldId !== 'evidence' || target.entityId !== undefined) throw new Error('ASSESS_MAPPING_TARGET_INVALID');
    return draft;
  }
  if (target.targetKind === 'case_field') {
    if (target.fieldId === 'case.name') draft.name = String(value);
    else if (target.fieldId === 'case.description') draft.description = String(value);
    else throw new Error('ASSESS_MAPPING_TARGET_INVALID');
    return draft;
  }
  if (target.targetKind === 'primitive_field' || target.targetKind === 'primitive_fact') {
    const primitive = draft.primitives.find(item => item.id === entity);
    if (!primitive) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    if (target.targetKind === 'primitive_fact') {
      const aliases = canonicalPrimitiveFactAliases(primitive.facts, target.fieldId);
      if (aliases.length > 1) throw new Error('ASSESS_MAPPING_FACT_ALIAS_AMBIGUOUS');
      const key = aliases[0];
      if (key) {
        const existing = primitive.facts[key];
        if (key !== target.fieldId) delete primitive.facts[key];
        primitive.facts[target.fieldId] = {
          ...existing,
          fieldId: target.fieldId,
          value,
          evidenceIds: withEvidence(existing.evidenceIds, evidenceId),
        };
      }
      else primitive.facts[target.fieldId] = { fieldId: target.fieldId, value, status: 'suggested', source: 'system', evidenceIds: [evidenceId] };
    } else {
      const key = target.fieldId.replace('primitive.', '') as keyof ProcessPrimitive;
      if (!['name', 'description', 'trigger', 'inputs', 'outputs', 'owner', 'rules', 'businessDisposition', 'type', 'volumeShare', 'manualEffort'].includes(String(key))) throw new Error('ASSESS_MAPPING_TARGET_INVALID');
      (primitive as unknown as Record<string, unknown>)[key] = value;
      primitive.evidenceIds = withEvidence(primitive.evidenceIds, evidenceId);
    }
    return draft;
  }
  if (target.targetKind === 'agent_fact') {
    const key = target.fieldId.replace('agent.', '') as keyof typeof draft.agentNecessity;
    const existing = draft.agentNecessity[key];
    if (!existing) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    draft.agentNecessity[key] = updatedFact(existing, value, evidenceId) as never;
    return draft;
  }
  if (target.targetKind === 'asset_field') {
    const asset = draft.applicationAssets.find(item => item.id === entity);
    if (!asset) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    const key = target.fieldId.replace('asset.', '') as keyof ApplicationAsset;
    if (!['name', 'strategicLifespan', 'technicalHealth', 'businessCriticality', 'ownershipModel', 'vendorRoadmap', 'operatingStability', 'accountableOwner'].includes(String(key))) throw new Error('ASSESS_MAPPING_TARGET_INVALID');
    (asset as unknown as Record<string, unknown>)[key] = value;
    asset.evidenceIds = withEvidence(asset.evidenceIds, evidenceId);
    return draft;
  }
  if (target.targetKind === 'interaction_field' || target.targetKind === 'interaction_fact') {
    const interaction = draft.interactions.find(item => item.id === entity);
    if (!interaction) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    if (target.targetKind === 'interaction_fact') {
      const key = target.fieldId.replace('interaction.', '') as keyof ApplicationInteraction['facts'];
      if (!(key in interaction.facts)) throw new Error('ASSESS_MAPPING_TARGET_STALE');
      (interaction.facts as unknown as Record<string, unknown>)[key] = value;
    } else {
      const key = target.fieldId.replace('interaction.', '') as keyof ApplicationInteraction;
      if (!['operationName', 'mode', 'dataClassification'].includes(String(key))) throw new Error('ASSESS_MAPPING_TARGET_INVALID');
      (interaction as unknown as Record<string, unknown>)[key] = value;
    }
    interaction.evidenceIds = withEvidence(interaction.evidenceIds, evidenceId);
    return draft;
  }
  const object = value as Record<string, AssessMappingJsonValue>;
  if (target.targetKind === 'create_primitive') {
    const item: ProcessPrimitive = {
      id: input.createId(), type: target.allowedValues?.[0] as ProcessPrimitive['type'], name: String(object.name), description: String(object.description),
      ...(object.trigger ? { trigger: String(object.trigger) } : {}), inputs: (object.inputs as string[] | undefined) ?? [], outputs: (object.outputs as string[] | undefined) ?? [],
      ...(object.owner ? { owner: String(object.owner) } : {}), rules: (object.rules as string[] | undefined) ?? [], exceptionIds: [], evidenceIds: [evidenceId], facts: {},
      volumeShare: null, manualEffort: null,
    };
    draft.primitives.push(item); return draft;
  }
  if (target.targetKind === 'create_asset') {
    const item: ApplicationAsset = { id: input.createId(), name: String(object.name), strategicLifespan: 'unknown', technicalHealth: 'unknown', businessCriticality: 'unknown', ownershipModel: 'unknown', vendorRoadmap: 'unknown', operatingStability: 'unknown', accountableOwner: object.accountableOwner ? String(object.accountableOwner) : null, evidenceIds: [evidenceId] };
    draft.applicationAssets.push(item); return draft;
  }
  if (target.targetKind === 'create_interaction') {
    if (!target.entityId || !target.fieldId.startsWith('create.interaction:')) throw new Error('ASSESS_MAPPING_TARGET_INVALID');
    const [assetId, primitiveId] = target.fieldId.slice('create.interaction:'.length).split(':');
    if (!draft.applicationAssets.some(item => item.id === assetId) || !draft.primitives.some(item => item.id === primitiveId)) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    const item: ApplicationInteraction = { id: input.createId(), assetId, primitiveId, operationName: String(object.operationName), mode: object.mode as ApplicationInteraction['mode'], dataClassification: object.dataClassification as ApplicationInteraction['dataClassification'], facts: { interfaceAvailable: null, operationCovered: null, apiDocumented: null, machineIdentity: null, leastPrivilege: null, dataQuality: null, dataClassified: null, auditable: null, idempotent: null, compensatable: null, rollback: null, testEnvironment: null, monitored: null, uiStable: null, eventSemantics: null, errorContract: null, capacityKnown: null, accountableOwner: null, highImpact: object.highImpact as boolean, financialAction: object.financialAction as boolean, untrustedContentWithTools: object.untrustedContentWithTools as boolean }, evidenceIds: [evidenceId] };
    draft.interactions.push(item); return draft;
  }
  if (target.targetKind === 'create_decision_point') {
    if (!entity || !draft.primitives.some(item => item.id === entity)) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    const item: DecisionPoint = { id: input.createId(), primitiveId: entity, name: String(object.name), ruleDescription: String(object.ruleDescription), outcomeLabels: object.outcomeLabels as string[], evidenceIds: [evidenceId] };
    draft.decisionPoints.push(item); return draft;
  }
  if (target.targetKind === 'create_exception_path') {
    if (!entity || !draft.primitives.some(item => item.id === entity)) throw new Error('ASSESS_MAPPING_TARGET_STALE');
    const item: ExceptionPath = { id: input.createId(), fromPrimitiveId: entity, name: String(object.name), trigger: String(object.trigger), resolutionPrimitiveIds: [], evidenceIds: [evidenceId] };
    draft.exceptionPaths.push(item); return draft;
  }
  throw new Error('ASSESS_MAPPING_TARGET_INVALID');
};

export const effectiveAssessMappingProposalValue = (proposal: AssessMappingProposalProjection) => proposal.effectiveValue;

export const blankAgentFactsForMapping = createUnknownAgentNecessityFacts;
