export const PROOF_STATUSES = [
  'demo',
  'planned',
  'configured',
  'evidence_required',
  'verified',
  'blocked',
] as const;

export type ProofStatus = typeof PROOF_STATUSES[number];

export const PROOF_BOUNDARIES = [
  'docs_only',
  'synthetic_only',
  'local_unproven',
  'hosted_unproven',
  'verified_with_evidence',
  'blocked_until_ap_approval',
] as const;

export type ProofBoundary = typeof PROOF_BOUNDARIES[number];

export const READINESS_DOMAINS = [
  'security',
  'tenant_isolation',
  'ai_controls',
  'evidence',
  'export',
  'deployment',
  'operations',
  'buyer_readiness',
  'product_readiness',
  'release_candidate',
] as const;

export type ReadinessDomain = typeof READINESS_DOMAINS[number];

export type ModuleEnabledState = 'available' | 'demo_available' | 'planned' | 'evidence_blocked';

export type BuyerAcceptanceArtifactType =
  | 'claim_map'
  | 'evidence_index'
  | 'limitation_disclosure'
  | 'acceptance_pack'
  | 'control_summary';

export interface ClaimControl {
  id: string;
  label: string;
  claimText: string;
  proofStatus: ProofStatus;
  proofBoundary: ProofBoundary;
  evidenceReference: string;
  blockedWording: string;
  owner: string;
  lastReviewedDate?: string;
  domain: ReadinessDomain;
}

export interface TrustCenterEvidence {
  id: string;
  milestone: string;
  evidenceDoc: string;
  acceptedStatus: ProofStatus;
  proofBoundary: ProofBoundary;
  lastReviewedDate?: string;
  summary: string;
  doesNotProve: readonly string[];
}

export interface ModuleCapabilityState {
  moduleKey: string;
  moduleName: string;
  enabledState: ModuleEnabledState;
  proofStatus: ProofStatus;
  proofBoundary: ProofBoundary;
  buyerSafeDescription: string;
  limitationDisclosure: string;
  evidenceReference: string;
  blockedClaims: readonly string[];
}

export interface BuyerAcceptanceArtifact {
  id: string;
  label: string;
  artifactType: BuyerAcceptanceArtifactType;
  proofStatus: ProofStatus;
  evidenceReference: string;
  limitationDisclosure: string;
  owner: string;
}

export interface TrustCenterSnapshot {
  generatedAt: string;
  statusVocabulary: readonly ProofStatus[];
  proofBoundaries: readonly ProofBoundary[];
  claimControls: readonly ClaimControl[];
  evidence: readonly TrustCenterEvidence[];
  moduleCapabilityStates: readonly ModuleCapabilityState[];
  buyerAcceptanceArtifacts: readonly BuyerAcceptanceArtifact[];
}

export const TRUST_CENTER_GENERATED_AT = '2026-07-03T00:00:00.000Z';

export const INTENTIONALLY_DEFERRED_INTERNAL_LITE_IDENTIFIERS = [
  'AvalaGovernLiteCard',
  'AvalaGovernLiteCardPanel',
  'avalaGovernLiteService',
  'buildAvalaGovernLiteCard',
  'governLite',
  'avalaGovernLite',
] as const;

export const REQUIRED_EVIDENCE_CLAIM_IDS = [
  'rls-readiness',
  'tenant-isolation-proof',
  'hosted-readiness',
  'production-readiness',
  'deployment-readiness',
  'operational-readiness',
  'security-readiness',
  'buyer-readiness',
  'product-readiness',
  'release-candidate-readiness',
  'compliance-certification',
  'local-startup-success',
  'artifact-select-isolation',
  'schema-readiness',
  'rls-helper-readiness',
] as const;

const claimControls: readonly ClaimControl[] = [
  {
    id: 'assess-deterministic-scoring',
    label: 'Avala Assess deterministic scoring',
    claimText: 'Avala Assess deterministic scoring behavior is regression-tested for the current demo baseline.',
    proofStatus: 'verified',
    proofBoundary: 'verified_with_evidence',
    evidenceReference: 'docs/quality/premium-enterprise-acceptance-roadmap-implementation-evidence.md',
    blockedWording: 'Do not describe deterministic scoring evidence as production readiness or autonomous decision approval.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'evidence',
  },
  {
    id: 'govern-control-plane-card',
    label: 'Avala Govern control-plane cards',
    claimText: 'Avala Govern provides scoped governance card and control-model capability for reviewed automation decisions.',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim bot, agent, RPA, external-system, MCP, A2A, or live runtime enforcement execution.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'evidence',
  },
  {
    id: 'studio-review-drafts',
    label: 'Avala Studio review drafts',
    claimText: 'Avala Studio produces generated document drafts for human review and sign-off workflows.',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim AI final approval, autonomous document acceptance, or production document authority.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'evidence',
  },
  {
    id: 'delivery-workbench-handoff',
    label: 'Avala Delivery governed workbench',
    claimText: 'Avala Delivery supports governed work items, owners, blockers, lineage, delivery packs, and handoff evidence.',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not position Avala Delivery as a Jira replacement or hosted Delivery runtime proof.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'operations',
  },
  {
    id: 'monitor-visibility-signals',
    label: 'Avala Monitor visibility signals',
    claimText: 'Avala Monitor can present value, risk, blocker, lineage, and visibility signals from current app state.',
    proofStatus: 'demo',
    proofBoundary: 'docs_only',
    evidenceReference: 'docs/05_IMPLEMENTATION_STATUS.md',
    blockedWording: 'Do not claim live production telemetry, runtime monitoring, or hosted operations proof.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'operations',
  },
  {
    id: 'admin-ai-controls-direction',
    label: 'Avala Admin AI controls direction',
    claimText: 'Avala Admin and AI Controls carry the server-side provider and BYOK governance direction for future enterprise hardening.',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    evidenceReference: 'docs/06_SECURITY_AND_GOVERNANCE.md',
    blockedWording: 'Do not claim production security readiness or provider governance readiness without approved evidence.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'ai_controls',
  },
  {
    id: 'export-readiness',
    label: 'Export readiness',
    claimText: 'Export workflows need future evidence before enterprise export readiness can be accepted.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/quality/readiness-gates.md',
    blockedWording: 'Do not claim enterprise export readiness until AP-approved export evidence exists.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'export',
  },
  {
    id: 'rls-readiness',
    label: 'RLS readiness',
    claimText: 'RLS readiness requires future AP-approved real evidence before acceptance.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim RLS readiness.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'tenant_isolation',
  },
  {
    id: 'tenant-isolation-proof',
    label: 'Tenant-isolation proof',
    claimText: 'Tenant isolation remains unproven until approved evidence verifies isolation behavior.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim tenant-isolation proof.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'tenant_isolation',
  },
  {
    id: 'hosted-readiness',
    label: 'Hosted readiness',
    claimText: 'Hosted readiness remains unproven until a future approved hosted validation track passes.',
    proofStatus: 'evidence_required',
    proofBoundary: 'hosted_unproven',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim hosted readiness.',
    owner: 'Operations',
    lastReviewedDate: '2026-07-03',
    domain: 'deployment',
  },
  {
    id: 'production-readiness',
    label: 'Production readiness',
    claimText: 'Production readiness is blocked until future AP-approved readiness evidence exists.',
    proofStatus: 'blocked',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/quality/readiness-gates.md',
    blockedWording: 'Do not claim production readiness.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'product_readiness',
  },
  {
    id: 'deployment-readiness',
    label: 'Deployment readiness',
    claimText: 'Deployment readiness requires future approved deployment evidence.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/quality/readiness-gates.md',
    blockedWording: 'Do not claim deployment readiness.',
    owner: 'Operations',
    lastReviewedDate: '2026-07-03',
    domain: 'deployment',
  },
  {
    id: 'operational-readiness',
    label: 'Operational readiness',
    claimText: 'Operational readiness requires future runbook, monitoring, incident, and support evidence.',
    proofStatus: 'evidence_required',
    proofBoundary: 'hosted_unproven',
    evidenceReference: 'docs/quality/readiness-gates.md',
    blockedWording: 'Do not claim operational readiness.',
    owner: 'Operations',
    lastReviewedDate: '2026-07-03',
    domain: 'operations',
  },
  {
    id: 'security-readiness',
    label: 'Security readiness',
    claimText: 'Security readiness requires future approved security evidence beyond the current static guardrails.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/06_SECURITY_AND_GOVERNANCE.md',
    blockedWording: 'Do not claim security readiness.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'security',
  },
  {
    id: 'buyer-readiness',
    label: 'Buyer readiness',
    claimText: 'Buyer readiness requires future acceptance-pack evidence and AP approval.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/planning/premium-enterprise-acceptance-roadmap.md',
    blockedWording: 'Do not claim buyer readiness.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'buyer_readiness',
  },
  {
    id: 'product-readiness',
    label: 'Product readiness',
    claimText: 'Product readiness requires future evidence that the premium enterprise baseline satisfies AP acceptance gates.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/planning/premium-enterprise-acceptance-roadmap.md',
    blockedWording: 'Do not claim product readiness.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'product_readiness',
  },
  {
    id: 'release-candidate-readiness',
    label: 'Release-candidate readiness',
    claimText: 'Release-candidate readiness requires a future AP-approved release-candidate evidence pack.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/quality/readiness-gates.md',
    blockedWording: 'Do not claim release-candidate readiness.',
    owner: 'Product Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'release_candidate',
  },
  {
    id: 'compliance-certification',
    label: 'Regulated compliance status',
    claimText: 'Regulated compliance posture requires future independent evidence before any regulated-market claim.',
    proofStatus: 'blocked',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/06_SECURITY_AND_GOVERNANCE.md',
    blockedWording: 'Do not claim compliance certification or regulated-market approval.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'security',
  },
  {
    id: 'local-startup-success',
    label: 'Local startup success',
    claimText: 'Local startup success remains unproven after the stopped local-readiness loop.',
    proofStatus: 'blocked',
    proofBoundary: 'local_unproven',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim local startup success.',
    owner: 'Operations',
    lastReviewedDate: '2026-07-03',
    domain: 'operations',
  },
  {
    id: 'artifact-select-isolation',
    label: 'Artifact SELECT isolation',
    claimText: 'Artifact SELECT isolation requires future approved evidence before acceptance.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim artifact SELECT isolation.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'tenant_isolation',
  },
  {
    id: 'schema-readiness',
    label: 'Schema readiness',
    claimText: 'Schema readiness remains unproven until future approved schema evidence exists.',
    proofStatus: 'evidence_required',
    proofBoundary: 'local_unproven',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim schema readiness.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'tenant_isolation',
  },
  {
    id: 'rls-helper-readiness',
    label: 'RLS helper readiness',
    claimText: 'RLS helper behavior requires future approved evidence before acceptance.',
    proofStatus: 'evidence_required',
    proofBoundary: 'blocked_until_ap_approval',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedWording: 'Do not claim RLS helper readiness.',
    owner: 'Security Governance',
    lastReviewedDate: '2026-07-03',
    domain: 'tenant_isolation',
  },
];

const evidence: readonly TrustCenterEvidence[] = [
  {
    id: 'premium-enterprise-full-name-slice',
    milestone: 'Premium Enterprise Acceptance Roadmap',
    evidenceDoc: 'docs/quality/premium-enterprise-acceptance-roadmap-implementation-evidence.md',
    acceptedStatus: 'configured',
    proofBoundary: 'docs_only',
    lastReviewedDate: '2026-07-03',
    summary: 'Recorded claim-safe full-name naming, onboarding copy cleanup, generated human-readable label cleanup, and copy/name guardrails.',
    doesNotProve: [
      'production readiness',
      'hosted readiness',
      'deployment readiness',
      'RLS readiness',
      'tenant isolation',
      'security readiness',
      'buyer readiness',
      'product readiness',
      'release-candidate readiness',
    ],
  },
  {
    id: 'premium-enterprise-post-merge',
    milestone: 'Premium Enterprise Acceptance Roadmap Post-Merge Verification',
    evidenceDoc: 'docs/quality/premium-enterprise-acceptance-roadmap-implementation-post-merge-verification.md',
    acceptedStatus: 'verified',
    proofBoundary: 'docs_only',
    lastReviewedDate: '2026-07-03',
    summary: 'Confirmed PR #161 merged, post-merge checks passed, and the closure tag targets the post-merge verification commit.',
    doesNotProve: [
      'production readiness',
      'hosted readiness',
      'deployment readiness',
      'RLS readiness',
      'tenant isolation',
      'security readiness',
      'buyer readiness',
      'product readiness',
      'release-candidate readiness',
    ],
  },
  {
    id: 'source-of-truth-boundary',
    milestone: 'Current Source Of Truth',
    evidenceDoc: 'docs/00_SOURCE_OF_TRUTH.md',
    acceptedStatus: 'configured',
    proofBoundary: 'docs_only',
    lastReviewedDate: '2026-07-03',
    summary: 'Defines Avala Govern and Avala Delivery naming, current proof boundaries, and stopped local-readiness loop.',
    doesNotProve: [
      'runtime execution',
      'hosted readiness',
      'production readiness',
      'tenant isolation',
      'local startup success',
    ],
  },
  {
    id: 'synthetic-rls-artifact-boundary',
    milestone: 'M5.3a-9 Synthetic Boundary',
    evidenceDoc: 'docs/quality/m5.3a-9-rls-and-artifact-evidence-harness-synthetic-boundary-implementation-evidence.md',
    acceptedStatus: 'configured',
    proofBoundary: 'synthetic_only',
    lastReviewedDate: '2026-07-03',
    summary: 'Synthetic-only boundary controls exist for the RLS and artifact evidence harness.',
    doesNotProve: [
      'real assertion execution',
      'RLS behavior',
      'artifact SELECT isolation',
      'tenant isolation',
      'schema readiness',
      'hosted readiness',
    ],
  },
  {
    id: 'fail-closed-authority-table',
    milestone: 'M5.2g-a Delivery Work Item Authority',
    evidenceDoc: 'docs/quality/m5.2g-a-delivery-work-item-authority-migration-evidence.md',
    acceptedStatus: 'configured',
    proofBoundary: 'local_unproven',
    lastReviewedDate: '2026-07-03',
    summary: 'Delivery work-item authority groundwork is recorded as fail-closed readiness only.',
    doesNotProve: [
      'tenant isolation',
      'Delivery runtime production readiness',
      'RLS policy behavior',
      'hosted readiness',
    ],
  },
];

const moduleCapabilityStates: readonly ModuleCapabilityState[] = [
  {
    moduleKey: 'assess',
    moduleName: 'Avala Assess',
    enabledState: 'demo_available',
    proofStatus: 'verified',
    proofBoundary: 'verified_with_evidence',
    buyerSafeDescription: 'Deterministic assessment and scoring behavior is regression-tested for the current demo baseline.',
    limitationDisclosure: 'This does not prove production readiness, hosted readiness, tenant isolation, or autonomous approval.',
    evidenceReference: 'docs/quality/premium-enterprise-acceptance-roadmap-implementation-evidence.md',
    blockedClaims: [
      'production readiness',
      'hosted readiness',
      'tenant-isolation proof',
      'AI final decision authority',
    ],
  },
  {
    moduleKey: 'govern',
    moduleName: 'Avala Govern',
    enabledState: 'available',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    buyerSafeDescription: 'Governance and control-plane cards help review risk, evidence, allowed actions, blocked actions, and human approval posture.',
    limitationDisclosure: 'Avala Govern does not execute bots, agents, RPA jobs, external-system actions, MCP controls, A2A controls, or live runtime enforcement in the current baseline.',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedClaims: [
      'bot execution',
      'agent execution',
      'RPA job execution',
      'external-system actions',
      'MCP controls',
      'A2A controls',
      'live runtime enforcement',
    ],
  },
  {
    moduleKey: 'studio',
    moduleName: 'Avala Studio',
    enabledState: 'available',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    buyerSafeDescription: 'Generated documents are editable review drafts that carry source context into human review workflows.',
    limitationDisclosure: 'Generated documents are editable review drafts requiring human sign-off; AI output is not final approval or autonomous document acceptance.',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedClaims: [
      'AI final approval',
      'autonomous document acceptance',
      'production document authority',
    ],
  },
  {
    moduleKey: 'delivery',
    moduleName: 'Avala Delivery',
    enabledState: 'available',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    buyerSafeDescription: 'Governed delivery workbench for approved work items, owners, blockers, handoff lineage, delivery packs, and evidence checklists.',
    limitationDisclosure: 'Avala Delivery is not a Jira replacement and does not prove hosted Delivery runtime readiness.',
    evidenceReference: 'docs/00_SOURCE_OF_TRUTH.md',
    blockedClaims: [
      'Jira replacement',
      'hosted Delivery runtime readiness',
      'production delivery readiness',
    ],
  },
  {
    moduleKey: 'monitor',
    moduleName: 'Avala Monitor',
    enabledState: 'demo_available',
    proofStatus: 'demo',
    proofBoundary: 'docs_only',
    buyerSafeDescription: 'Shows value, risk, blocker, lineage, and visibility signals from the current governed demo baseline.',
    limitationDisclosure: 'Avala Monitor does not prove live production telemetry, runtime monitoring, hosted operations, or incident readiness.',
    evidenceReference: 'docs/05_IMPLEMENTATION_STATUS.md',
    blockedClaims: [
      'live production telemetry',
      'runtime monitoring',
      'hosted operations readiness',
    ],
  },
  {
    moduleKey: 'admin-ai-controls',
    moduleName: 'Avala Admin / AI Controls',
    enabledState: 'planned',
    proofStatus: 'configured',
    proofBoundary: 'docs_only',
    buyerSafeDescription: 'Provider, BYOK, and server-side AI governance direction is documented for future enterprise hardening.',
    limitationDisclosure: 'Avala Admin / AI Controls does not prove production security readiness, provider governance readiness, or hosted control enforcement.',
    evidenceReference: 'docs/06_SECURITY_AND_GOVERNANCE.md',
    blockedClaims: [
      'production security readiness',
      'provider governance readiness',
      'hosted control enforcement',
    ],
  },
];

const buyerAcceptanceArtifacts: readonly BuyerAcceptanceArtifact[] = [
  {
    id: 'claim-map',
    label: 'Buyer claim map',
    artifactType: 'claim_map',
    proofStatus: 'planned',
    evidenceReference: 'docs/planning/premium-enterprise-trust-center-proof-status-foundation.md',
    limitationDisclosure: 'The claim map is modeled in this slice but no buyer acceptance pack is produced.',
    owner: 'Product Governance',
  },
  {
    id: 'evidence-index',
    label: 'Evidence reference index',
    artifactType: 'evidence_index',
    proofStatus: 'configured',
    evidenceReference: 'docs/quality/premium-enterprise-trust-center-proof-status-foundation-evidence.md',
    limitationDisclosure: 'The index records current evidence boundaries; it does not create new readiness evidence.',
    owner: 'Product Governance',
  },
  {
    id: 'limitation-disclosures',
    label: 'Buyer-safe limitation disclosures',
    artifactType: 'limitation_disclosure',
    proofStatus: 'configured',
    evidenceReference: 'services/trustCenterModel.ts',
    limitationDisclosure: 'Disclosures are static baseline metadata and do not validate runtime readiness.',
    owner: 'Product Governance',
  },
  {
    id: 'buyer-acceptance-pack',
    label: 'Buyer acceptance pack',
    artifactType: 'acceptance_pack',
    proofStatus: 'evidence_required',
    evidenceReference: 'docs/planning/premium-enterprise-acceptance-roadmap.md',
    limitationDisclosure: 'The buyer acceptance pack remains a future AP-approved slice.',
    owner: 'Product Governance',
  },
];

const cloneClaimControl = (control: ClaimControl): ClaimControl => ({ ...control });

const cloneEvidence = (entry: TrustCenterEvidence): TrustCenterEvidence => ({
  ...entry,
  doesNotProve: [...entry.doesNotProve],
});

const cloneModuleCapabilityState = (state: ModuleCapabilityState): ModuleCapabilityState => ({
  ...state,
  blockedClaims: [...state.blockedClaims],
});

const cloneBuyerAcceptanceArtifact = (artifact: BuyerAcceptanceArtifact): BuyerAcceptanceArtifact => ({ ...artifact });

export function buildCurrentTrustCenterSnapshot(): TrustCenterSnapshot {
  return {
    generatedAt: TRUST_CENTER_GENERATED_AT,
    statusVocabulary: [...PROOF_STATUSES],
    proofBoundaries: [...PROOF_BOUNDARIES],
    claimControls: claimControls.map(cloneClaimControl),
    evidence: evidence.map(cloneEvidence),
    moduleCapabilityStates: moduleCapabilityStates.map(cloneModuleCapabilityState),
    buyerAcceptanceArtifacts: buyerAcceptanceArtifacts.map(cloneBuyerAcceptanceArtifact),
  };
}

export const CURRENT_TRUST_CENTER_SNAPSHOT = buildCurrentTrustCenterSnapshot();