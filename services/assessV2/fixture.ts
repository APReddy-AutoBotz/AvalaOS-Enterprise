import { ASSESS_V2_RULE_SET_VERSION, ASSESS_V2_SCHEMA_VERSION } from './types.ts';
import type { AgentNecessityFacts, AssessmentCaseV2, CaseFact, InteractionFacts, ProcessPrimitive } from './types.ts';

const EV_API = '71000000-0000-4000-8000-000000000001';
const EV_OPS = '71000000-0000-4000-8000-000000000002';
const SAP = '72000000-0000-4000-8000-000000000001';
const ids = {
  intake: '73000000-0000-4000-8000-000000000001', extract: '73000000-0000-4000-8000-000000000002', validate: '73000000-0000-4000-8000-000000000003', exception: '73000000-0000-4000-8000-000000000004', route: '73000000-0000-4000-8000-000000000005', approve: '73000000-0000-4000-8000-000000000006', communicate: '73000000-0000-4000-8000-000000000007', monitor: '73000000-0000-4000-8000-000000000008', audit: '73000000-0000-4000-8000-000000000009',
} as const;

const knownFact = (fieldId: string, value = true, evidenceIds = [EV_OPS]): CaseFact<boolean> => ({ fieldId, value, status: 'known', evidenceIds, source: 'user' });
const primitiveFacts = (type: ProcessPrimitive['type']): Record<string, CaseFact> => {
  const byType: Record<ProcessPrimitive['type'], string[]> = {
    Capture: ['primitive.workflowPatternKnown'], Extract: ['primitive.documentQualityRepresentative', 'primitive.exceptionSamplesAvailable'], Classify: ['primitive.rulesStable'], Validate: ['primitive.rulesStable'], Calculate: ['primitive.rulesStable'], Reconcile: ['primitive.rulesStable', 'primitive.workflowPatternKnown'], Retrieve: ['primitive.interfaceDependencyKnown'], Investigate: ['primitive.ambiguityCharacterized'], Decide: ['primitive.rulesStable'], Approve: ['primitive.workflowPatternKnown'], Route: ['primitive.workflowPatternKnown'], Execute: ['primitive.interfaceDependencyKnown'], Communicate: ['primitive.workflowPatternKnown'], Monitor: ['primitive.controlRequirementsKnown'], Audit: ['primitive.controlRequirementsKnown'],
  };
  return Object.fromEntries(byType[type].map(fieldId => [fieldId, knownFact(fieldId)]));
};
const agentFacts = (evidenced: boolean): AgentNecessityFacts => ({
  irreducibleAmbiguity: knownFact('agent.irreducibleAmbiguity', true, evidenced ? [EV_OPS] : []),
  adaptiveNextStep: knownFact('agent.adaptiveNextStep', true, evidenced ? [EV_OPS] : []),
  toolOrPathSelection: knownFact('agent.toolOrPathSelection', true, evidenced ? [EV_OPS] : []),
  incrementalValue: knownFact('agent.incrementalValue', true, evidenced ? [EV_OPS] : []),
  controllable: knownFact('agent.controllable', true, evidenced ? [EV_OPS] : []),
});

const baseFacts: InteractionFacts = {
  interfaceAvailable: true, operationCovered: true, apiDocumented: true, machineIdentity: true, leastPrivilege: true,
  dataQuality: true, dataClassified: true, auditable: true, idempotent: true, compensatable: true, rollback: true,
  testEnvironment: true, monitored: true, uiStable: false, eventSemantics: true, errorContract: true, capacityKnown: true,
  accountableOwner: true, highImpact: false, financialAction: false, untrustedContentWithTools: false,
};

const primitive = (id: string, type: ProcessPrimitive['type'], name: string, description: string, evidenceIds = [EV_OPS]): ProcessPrimitive => ({
  id, type, name, description, inputs: [], outputs: [], volumeShare: null, manualEffort: null, rules: [], exceptionIds: [], evidenceIds, facts: primitiveFacts(type), businessDisposition: type === 'Investigate' ? 'Human-Led' : 'Existing Product Configuration',
});

export const AP_INVOICE_EXCEPTION_V2_FIXTURE: AssessmentCaseV2 = {
  id: '70000000-0000-4000-8000-000000000001',
  organizationId: '70000000-0000-4000-8000-000000000002',
  workspaceId: '70000000-0000-4000-8000-000000000003',
  sourceProcessId: '70000000-0000-4000-8000-000000000004',
  ownerId: '70000000-0000-4000-8000-000000000005',
  status: 'draft', version: 1, schemaVersion: ASSESS_V2_SCHEMA_VERSION, ruleSetVersion: ASSESS_V2_RULE_SET_VERSION,
  createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z', agentNecessity: agentFacts(true),
  evidence: [
    { id: EV_API, claimIds: ['primitive.rulesStable', 'interaction.interfaceAvailable', 'interaction.operationCovered', 'interaction.apiDocumented', 'interaction.machineIdentity', 'interaction.leastPrivilege', 'interaction.dataQuality', 'interaction.dataClassified', 'interaction.auditable', 'interaction.idempotent', 'interaction.compensatable', 'interaction.rollback', 'interaction.testEnvironment', 'interaction.monitored', 'interaction.uiStable', 'interaction.eventSemantics', 'interaction.errorContract', 'interaction.capacityKnown', 'interaction.accountableOwner', 'interaction.highImpact', 'interaction.financialAction', 'interaction.untrustedContentWithTools', 'asset.strategicLifespan', 'asset.technicalHealth', 'asset.businessCriticality', 'asset.ownershipModel', 'asset.vendorRoadmap', 'asset.operatingStability', 'asset.accountableOwner'], sourceType: 'test', status: 'submitted', validated: false, owner: 'integration-owner', capturedAt: '2026-07-14T00:00:00.000Z', validUntil: '2027-07-14T00:00:00.000Z' },
    { id: EV_OPS, claimIds: ['primitive.rulesStable', 'primitive.workflowPatternKnown', 'primitive.documentQualityRepresentative', 'primitive.exceptionSamplesAvailable', 'primitive.ambiguityCharacterized', 'primitive.controlRequirementsKnown', 'agent.irreducibleAmbiguity', 'agent.adaptiveNextStep', 'agent.toolOrPathSelection', 'agent.incrementalValue', 'agent.controllable', 'interaction.interfaceAvailable', 'interaction.operationCovered', 'interaction.apiDocumented', 'interaction.machineIdentity', 'interaction.leastPrivilege', 'interaction.dataQuality', 'interaction.dataClassified', 'interaction.auditable', 'interaction.idempotent', 'interaction.compensatable', 'interaction.rollback', 'interaction.testEnvironment', 'interaction.monitored', 'interaction.uiStable', 'interaction.eventSemantics', 'interaction.errorContract', 'interaction.capacityKnown', 'interaction.accountableOwner', 'interaction.highImpact', 'interaction.financialAction', 'interaction.untrustedContentWithTools'], sourceType: 'interview', status: 'submitted', validated: false, owner: 'ap-owner', capturedAt: '2026-07-14T00:00:00.000Z', validUntil: '2027-07-14T00:00:00.000Z' },
  ],
  primitives: [
    primitive(ids.intake, 'Capture', 'Invoice intake', 'Mailbox, API, or event intake.'),
    primitive(ids.extract, 'Extract', 'Document extraction', 'Document intelligence extracts PDF and email content.'),
    primitive(ids.validate, 'Validate', 'PO and GRN validation', 'Deterministic duplicate, tax, PO, GRN, and vendor-master validation.', [EV_API]),
    { ...primitive(ids.exception, 'Investigate', 'Exception investigation', 'Human investigation with bounded assistance.'), agentNecessity: agentFacts(true) },
    primitive(ids.route, 'Route', 'Exception queue and escalation', 'Dynamic case workflow manages waiting, routing, and escalation.'),
    primitive(ids.approve, 'Approve', 'Posting and release approval', 'A human approves posting or payment release.'),
    primitive(ids.communicate, 'Communicate', 'Vendor communication', 'A human approves external vendor communication.'),
    primitive(ids.monitor, 'Monitor', 'Operational monitoring', 'Monitor queue age, errors, controls, and capacity.'),
    primitive(ids.audit, 'Audit', 'Decision audit', 'Retain evidence and correlated decision traces.'),
  ],
  edges: [
    { id: '74000000-0000-4000-8000-000000000001', fromPrimitiveId: ids.intake, toPrimitiveId: ids.extract },
    { id: '74000000-0000-4000-8000-000000000002', fromPrimitiveId: ids.extract, toPrimitiveId: ids.validate },
    { id: '74000000-0000-4000-8000-000000000003', fromPrimitiveId: ids.validate, toPrimitiveId: ids.exception, condition: 'validation exception' },
    { id: '74000000-0000-4000-8000-000000000004', fromPrimitiveId: ids.exception, toPrimitiveId: ids.route },
    { id: '74000000-0000-4000-8000-000000000005', fromPrimitiveId: ids.route, toPrimitiveId: ids.approve },
    { id: '74000000-0000-4000-8000-000000000006', fromPrimitiveId: ids.approve, toPrimitiveId: ids.communicate },
    { id: '74000000-0000-4000-8000-000000000007', fromPrimitiveId: ids.approve, toPrimitiveId: ids.audit },
  ],
  decisionPoints: [{ id: '75000000-0000-4000-8000-000000000001', primitiveId: ids.validate, name: 'Validation outcome', ruleDescription: 'Route deterministic failures to the exception queue.', outcomeLabels: ['valid', 'exception'], evidenceIds: [EV_API] }],
  exceptionPaths: [{ id: '75000000-0000-4000-8000-000000000002', fromPrimitiveId: ids.validate, name: 'Invoice exception', trigger: 'A deterministic validation fails or remains ambiguous.', resolutionPrimitiveIds: [ids.exception, ids.route, ids.approve], evidenceIds: [EV_OPS] }],
  assets: [{ id: SAP, name: 'SAP ERP', strategicLifespan: 'long', technicalHealth: 'constrained', businessCriticality: 'critical', ownershipModel: 'vendor-owned', vendorRoadmap: 'supportive', operatingStability: 'stable', accountableOwner: 'erp-owner', evidenceIds: [EV_API] }],
  interactions: [
    { id: '76000000-0000-4000-8000-000000000001', assetId: SAP, primitiveId: ids.validate, operationName: 'Read PO, GRN, tax, and vendor-master data', mode: 'read', dataClassification: 'Confidential', facts: baseFacts, evidenceIds: [EV_API] },
    { id: '76000000-0000-4000-8000-000000000002', assetId: SAP, primitiveId: ids.approve, operationName: 'Post an approved invoice', mode: 'write', dataClassification: 'Confidential', facts: { ...baseFacts, highImpact: true, financialAction: true, rollback: false }, evidenceIds: [EV_API] },
    { id: '76000000-0000-4000-8000-000000000003', assetId: SAP, primitiveId: ids.approve, operationName: 'Release payment', mode: 'write', dataClassification: 'Restricted', facts: { ...baseFacts, highImpact: true, financialAction: true, rollback: false }, evidenceIds: [EV_API] },
    { id: '76000000-0000-4000-8000-000000000004', assetId: SAP, primitiveId: ids.communicate, operationName: 'Send vendor communication', mode: 'write', dataClassification: 'Confidential', facts: { ...baseFacts, highImpact: true, rollback: false }, evidenceIds: [EV_OPS] },
    { id: '76000000-0000-4000-8000-000000000005', assetId: SAP, primitiveId: ids.validate, operationName: 'Unsupported UI lookup', mode: 'ui', dataClassification: 'Confidential', facts: { ...baseFacts, interfaceAvailable: false, operationCovered: false, uiStable: true }, evidenceIds: [EV_API] },
  ],
};
