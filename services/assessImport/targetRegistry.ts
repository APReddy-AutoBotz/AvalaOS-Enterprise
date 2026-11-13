import { FIELD_REGISTRY } from '../assessV2/registry.ts';
import type { AgentNecessityFacts, ApplicationAsset, ApplicationInteraction, DecisionPoint, EvidenceLink, ExceptionPath, ProcessEdge, ProcessPrimitive } from '../assessV2/types.ts';
import type { AssessMappingJsonValue, AssessMappingOperation, AssessMappingTargetKind, AssessMappingValueType } from './contracts.ts';

export interface AssessMappingTargetBlueprint {
  targetKind: AssessMappingTargetKind;
  operation: AssessMappingOperation;
  entityId?: string;
  fieldId: string;
  label: string;
  contextLabel: string;
  valueType: AssessMappingValueType;
  allowedValues?: string[];
  currentValue?: AssessMappingJsonValue;
  manual: boolean;
}

export interface AssessMappingDraft {
  caseId: string; name: string; description: string; primitives: ProcessPrimitive[]; edges: ProcessEdge[];
  decisionPoints: DecisionPoint[]; exceptionPaths: ExceptionPath[]; applicationAssets: ApplicationAsset[];
  interactions: ApplicationInteraction[]; evidenceLinks: EvidenceLink[]; agentNecessity: AgentNecessityFacts;
  candidateEvaluations: []; gateResults: []; controlRequirements: []; modernizationDispositions: [];
}

const primitiveTypes = ['Capture', 'Extract', 'Classify', 'Validate', 'Calculate', 'Reconcile', 'Retrieve', 'Investigate', 'Decide', 'Approve', 'Route', 'Execute', 'Communicate', 'Monitor', 'Audit'];
const businessDispositions = ['Monitor / Do Nothing', 'Simplify', 'Redesign', 'Human-Led', 'Existing Product Configuration', 'Custom Application'];
const title = (value: string) => value.replace(/([A-Z])/g, ' $1').replace(/[._]/g, ' ').replace(/^./, character => character.toUpperCase()).trim();
const scalar = (input: Omit<AssessMappingTargetBlueprint, 'operation' | 'manual'> & { manual?: boolean }): AssessMappingTargetBlueprint => ({ ...input, operation: input.targetKind.endsWith('_fact') ? 'set_fact' : 'set_field', manual: input.manual ?? (input.currentValue !== null && input.currentValue !== undefined && input.currentValue !== '') });

const fieldValueType = (fieldId: string): AssessMappingValueType => {
  const contract = FIELD_REGISTRY.find(item => item.fieldId === fieldId);
  if (!contract) return 'text';
  if (contract.unit === 'boolean') return 'boolean';
  if (contract.unit === 'ratio') return 'ratio';
  if (fieldId === 'primitive.type') return 'primitive_type';
  if (fieldId === 'primitive.businessDisposition') return 'business_disposition';
  if (fieldId === 'interaction.mode') return 'interaction_mode';
  return contract.unit === 'text' || contract.unit === 'category' ? 'text' : 'text';
};

const canonicalFactFieldId = (layer: 'primitive' | 'agent', key: string) => key.startsWith(`${layer}.`) ? key : `${layer}.${key}`;
const interactionFactIsApplicable = (interaction: ApplicationInteraction, fieldId: string) => {
  const contract = FIELD_REGISTRY.find(item => item.fieldId === fieldId);
  if (!contract?.applicability) return Boolean(contract);
  const controllerKey = contract.applicability.fieldId.replace('interaction.', '') as keyof ApplicationInteraction['facts'] | 'mode';
  const controllerValue = controllerKey === 'mode' ? interaction.mode : interaction.facts[controllerKey as keyof ApplicationInteraction['facts']];
  return controllerValue === contract.applicability.equals;
};

export interface AssessMappingTargetCatalogBlueprints {
  targets: AssessMappingTargetBlueprint[];
  warnings: string[];
}

/** Produces finite server-catalog inputs from one exact current draft. */
export const buildAssessMappingTargetCatalogBlueprints = (draft: AssessMappingDraft): AssessMappingTargetCatalogBlueprints => {
  const targets: AssessMappingTargetBlueprint[] = [
    scalar({ targetKind: 'case_field', fieldId: 'case.name', label: 'Assessment name', contextLabel: draft.name, valueType: 'text', currentValue: draft.name }),
    scalar({ targetKind: 'case_field', fieldId: 'case.description', label: 'Assessment description', contextLabel: draft.name, valueType: 'text', currentValue: draft.description }),
    { targetKind: 'evidence_only', operation: 'link_evidence', fieldId: 'evidence', label: 'Supporting evidence only', contextLabel: draft.name, valueType: 'evidence', currentValue: null, manual: false },
  ];
  for (const primitive of draft.primitives) {
    const fields: Array<[string, unknown, AssessMappingValueType, string[]?]> = [
      ['primitive.type', primitive.type, 'primitive_type', primitiveTypes], ['primitive.name', primitive.name, 'text'],
      ['primitive.description', primitive.description, 'text'], ['primitive.trigger', primitive.trigger ?? '', 'text'],
      ['primitive.inputs', primitive.inputs, 'text_list'], ['primitive.outputs', primitive.outputs, 'text_list'],
      ['primitive.owner', primitive.owner ?? '', 'text'], ['primitive.rules', primitive.rules, 'text_list'],
      ['primitive.volumeShare', primitive.volumeShare ?? null, 'ratio'], ['primitive.manualEffort', primitive.manualEffort ?? null, 'number'],
      ['primitive.businessDisposition', primitive.businessDisposition ?? '', 'business_disposition', businessDispositions],
    ];
    fields.forEach(([fieldId, currentValue, valueType, allowedValues]) => targets.push(scalar({ targetKind: 'primitive_field', entityId: primitive.id, fieldId, label: title(fieldId.replace('primitive.', '')), contextLabel: primitive.name, valueType, ...(allowedValues ? { allowedValues } : {}), currentValue: currentValue as AssessMappingJsonValue })));
    FIELD_REGISTRY.filter(item => item.layer === 'primitive' && item.fieldId.startsWith('primitive.')
      && !['primitive.type', 'primitive.businessDisposition'].includes(item.fieldId)).forEach(contract => {
      const aliases = Object.entries(primitive.facts).filter(([key]) => canonicalFactFieldId('primitive', key) === contract.fieldId);
      if (aliases.length > 1) throw new Error('ASSESS_MAPPING_FACT_ALIAS_AMBIGUOUS');
      const existing = aliases[0]?.[1];
      targets.push(scalar({ targetKind: 'primitive_fact', entityId: primitive.id, fieldId: contract.fieldId,
        label: title(contract.fieldId.replace('primitive.', '')), contextLabel: primitive.name,
        valueType: fieldValueType(contract.fieldId), currentValue: (existing?.value ?? null) as AssessMappingJsonValue,
        manual: Boolean(existing && existing.value !== null && existing.value !== undefined) }));
    });
    targets.push({ targetKind: 'create_decision_point', operation: 'create_entity', entityId: primitive.id, fieldId: `create.decision:${primitive.id}`, label: 'New decision point', contextLabel: primitive.name, valueType: 'decision_constructor', manual: false });
    targets.push({ targetKind: 'create_exception_path', operation: 'create_entity', entityId: primitive.id, fieldId: `create.exception:${primitive.id}`, label: 'New exception path', contextLabel: primitive.name, valueType: 'exception_constructor', manual: false });
  }
  Object.entries(draft.agentNecessity).forEach(([key, fact]) => {
    const fieldId = canonicalFactFieldId('agent', key);
    if (!FIELD_REGISTRY.some(item => item.fieldId === fieldId)) return;
    targets.push(scalar({ targetKind: 'agent_fact', fieldId, label: title(key.replace('agent.', '')), contextLabel: 'Agent necessity', valueType: 'boolean', currentValue: fact.value }));
  });
  for (const asset of draft.applicationAssets) {
    const fields: Array<[string, AssessMappingJsonValue, AssessMappingValueType, string[]?]> = [
      ['asset.name', asset.name, 'text'], ['asset.strategicLifespan', asset.strategicLifespan, 'asset_strategic_lifespan', ['short', 'medium', 'long', 'unknown']],
      ['asset.technicalHealth', asset.technicalHealth, 'asset_technical_health', ['healthy', 'constrained', 'end-of-life', 'unknown']],
      ['asset.businessCriticality', asset.businessCriticality, 'asset_business_criticality', ['low', 'medium', 'high', 'critical', 'unknown']],
      ['asset.ownershipModel', asset.ownershipModel, 'asset_ownership_model', ['source-owned', 'vendor-owned', 'shared', 'unknown']],
      ['asset.vendorRoadmap', asset.vendorRoadmap, 'asset_vendor_roadmap', ['supportive', 'constrained', 'end-of-life', 'unknown']],
      ['asset.operatingStability', asset.operatingStability, 'asset_operating_stability', ['stable', 'variable', 'unstable', 'unknown']],
      ['asset.accountableOwner', asset.accountableOwner ?? '', 'text'],
    ];
    fields.forEach(([fieldId, currentValue, valueType, allowedValues]) => targets.push(scalar({ targetKind: 'asset_field', entityId: asset.id, fieldId, label: title(fieldId.replace('asset.', '')), contextLabel: asset.name, valueType, ...(allowedValues ? { allowedValues } : {}), currentValue })));
  }
  for (const interaction of draft.interactions) {
    const context = `${interaction.operationName} (${interaction.mode})`;
    targets.push(scalar({ targetKind: 'interaction_field', entityId: interaction.id, fieldId: 'interaction.operationName', label: 'Operation name', contextLabel: context, valueType: 'text', currentValue: interaction.operationName }));
    targets.push(scalar({ targetKind: 'interaction_field', entityId: interaction.id, fieldId: 'interaction.mode', label: 'Interaction mode', contextLabel: context, valueType: 'interaction_mode', allowedValues: ['read', 'write', 'event', 'ui', 'operational'], currentValue: interaction.mode }));
    targets.push(scalar({ targetKind: 'interaction_field', entityId: interaction.id, fieldId: 'interaction.dataClassification', label: 'Data classification', contextLabel: context, valueType: 'data_classification', allowedValues: ['Public', 'Internal', 'Confidential', 'Restricted', 'Unknown'], currentValue: interaction.dataClassification }));
    Object.entries(interaction.facts).forEach(([key, currentValue]) => {
      const fieldId = `interaction.${key}`;
      if (!interactionFactIsApplicable(interaction, fieldId)) return;
      targets.push(scalar({ targetKind: 'interaction_fact', entityId: interaction.id, fieldId, label: title(key), contextLabel: context, valueType: 'boolean', currentValue }));
    });
  }
  primitiveTypes.forEach(type => targets.push({ targetKind: 'create_primitive', operation: 'create_entity', fieldId: `create.primitive:${type}`, label: `New ${type} primitive`, contextLabel: draft.name, valueType: 'primitive_constructor', allowedValues: [type], manual: false }));
  targets.push({ targetKind: 'create_asset', operation: 'create_entity', fieldId: 'create.asset', label: 'New application asset', contextLabel: draft.name, valueType: 'asset_constructor', manual: false });
  const warnings: string[] = [];
  if (draft.primitives.length * draft.applicationAssets.length <= 100) for (const asset of draft.applicationAssets) for (const primitive of draft.primitives) targets.push({ targetKind: 'create_interaction', operation: 'create_entity', entityId: asset.id, fieldId: `create.interaction:${asset.id}:${primitive.id}`, label: 'New application interaction', contextLabel: `${asset.name} / ${primitive.name}`, valueType: 'interaction_constructor', manual: false });
  else warnings.push('CREATE_INTERACTION_TARGETS_OMITTED_LIMIT');
  if (targets.length > 2_000) throw new Error('ASSESS_MAPPING_TARGET_CATALOG_LIMIT');
  return { targets, warnings };
};

export const buildAssessMappingTargetBlueprints = (draft: AssessMappingDraft): AssessMappingTargetBlueprint[] => buildAssessMappingTargetCatalogBlueprints(draft).targets;
