import type { ProofBoundary, ProofStatus, ReadinessDomain } from '../trustCenterModel';

export const TRUST_CAPABILITIES = ['trust.read', 'trust.manage', 'trust.review', 'trust.publish'] as const;
export const EVIDENCE_RELATIONSHIPS = ['supports', 'contradicts', 'limits'] as const;
export const EVIDENCE_LIFECYCLES = ['active', 'superseded', 'withdrawn', 'blocked', 'not_run'] as const;
export const EVIDENCE_FRESHNESS = ['current', 'review_due', 'expired'] as const;
export const ASSURANCE_LIFECYCLES = ['draft', 'under_review', 'changes_requested', 'reviewed', 'approved', 'published', 'withdrawn'] as const;
export const TRUST_OPERATIONS = ['claim.create', 'claim.revise', 'evidence.register', 'evidence.supersede', 'evidence.withdraw', 'evidence.link', 'resource.review', 'snapshot.create', 'snapshot.review', 'snapshot.publish', 'snapshot.withdraw'] as const;
export const TRUST_VERSION_FENCED_OPERATIONS = ['claim.revise', 'evidence.supersede', 'evidence.withdraw', 'snapshot.review', 'snapshot.publish', 'snapshot.withdraw'] as const;
export const TRUST_QUERY_VIEWS = ['internal', 'buyer'] as const;

export type EvidenceRelationship = typeof EVIDENCE_RELATIONSHIPS[number];
export type EvidenceLifecycle = typeof EVIDENCE_LIFECYCLES[number];
export type EvidenceFreshness = typeof EVIDENCE_FRESHNESS[number];
export type AssuranceLifecycle = typeof ASSURANCE_LIFECYCLES[number];
export type TrustOperation = typeof TRUST_OPERATIONS[number];
export type TrustVersionFencedOperation = typeof TRUST_VERSION_FENCED_OPERATIONS[number];
export type TrustQueryView = typeof TRUST_QUERY_VIEWS[number];

export const trustOperationRequiresExpectedVersion = (operation: TrustOperation): operation is TrustVersionFencedOperation =>
  (TRUST_VERSION_FENCED_OPERATIONS as readonly TrustOperation[]).includes(operation);

export interface TrustQueryRequest {
  organizationId: string;
  workspaceId: string;
  authorizationVersion: number;
  view: TrustQueryView;
}

export interface ClaimVersionProjection {
  claimVersionId: string;
  claimId: string;
  version: number;
  readinessDomain: ReadinessDomain;
  claimText: string;
  buyerSafeWording: string;
  proposedProofStatus: ProofStatus;
  effectiveProofStatus: ProofStatus;
  proofBoundary: ProofBoundary;
  limitationDisclosure: string;
  doesNotProve: readonly string[];
  canonicalHash: string;
  ownerDisplayName: string;
  lifecycle: AssuranceLifecycle;
  blockedReasons: readonly string[];
}

export interface EvidenceVersionProjection {
  evidenceVersionId: string;
  evidenceId: string;
  version: number;
  evidenceType: string;
  referenceType: 'repository_path' | 'workflow_run' | 'test_report' | 'attestation' | 'other';
  referenceValue: string;
  summary: string;
  evidenceBoundary: ProofBoundary;
  lifecycle: EvidenceLifecycle;
  freshness: EvidenceFreshness;
  observedAt: string | null;
  reviewDueAt: string | null;
  expiresAt: string | null;
  canonicalHash: string;
  approved: boolean;
  ownerDisplayName: string;
}

export interface InternalAssuranceProjection {
  mode: 'server_authoritative';
  organizationId: string;
  workspaceId: string | null;
  authorizationVersion: number;
  readOnly: boolean;
  claims: readonly ClaimVersionProjection[];
  evidence: readonly EvidenceVersionProjection[];
  relationships: readonly { claimVersionId: string; evidenceVersionId: string; relationship: EvidenceRelationship; rationale: string }[];
  reviewQueueCount: number;
  snapshotHistory: readonly { snapshotId: string; snapshotHash: string; version: number; lifecycle: AssuranceLifecycle; createdAt: string }[];
  currentPublication: null | { publicationId: string; snapshotId: string; snapshotHash: string; publishedAt: string };
}

export interface BuyerSafeProjection {
  mode: 'published_snapshot';
  publication: { publicId: string; snapshotHash: string; publishedAt: string };
  claims: readonly {
    wording: string;
    effectiveProofStatus: ProofStatus;
    proofBoundary: ProofBoundary;
    lastReviewedAt: string;
    evidence: readonly { summary: string; referenceType: string; referenceValue: string; freshness: EvidenceFreshness }[];
    limitationDisclosure: string;
    doesNotProve: readonly string[];
  }[];
}

export interface TrustCommandRequest {
  requestId: string;
  idempotencyKey: string;
  operation: TrustOperation;
  organizationId: string;
  workspaceId: string | null;
  expectedAuthorizationVersion: number;
  expectedVersion?: number;
  payload: Record<string, unknown>;
}

export type TrustCommandResponse = { ok: true; replayed: boolean; resourceId: string; version: number; body: Record<string, unknown> } |
  { ok: false; code: 'ACCESS_DENIED' | 'PERMISSION_DENIED' | 'AUTHORIZATION_STALE' | 'VALIDATION_FAILED' | 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'REVIEW_REQUIRED' | 'PUBLICATION_BLOCKED' | 'FEATURE_DISABLED' | 'PERSISTENCE_UNAVAILABLE'; message: string };
