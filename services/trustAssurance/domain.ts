import type { ProofStatus } from '../trustCenterModel';
import type { EvidenceFreshness, EvidenceLifecycle, EvidenceRelationship } from './contracts';

export interface LinkedEvidenceState {
  relationship: EvidenceRelationship;
  lifecycle: EvidenceLifecycle;
  freshness: EvidenceFreshness;
  approved: boolean;
  result: 'performed' | 'blocked' | 'not_run';
}

export const deriveFreshness = (now: Date, reviewDueAt: string | null, expiresAt: string | null): EvidenceFreshness => {
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) return 'expired';
  if (reviewDueAt && Date.parse(reviewDueAt) <= now.getTime()) return 'review_due';
  return 'current';
};

export const deriveEffectiveProofStatus = (
  proposed: ProofStatus,
  evidence: readonly LinkedEvidenceState[],
  limitationDisclosure: string,
  doesNotProve: readonly string[],
): { status: ProofStatus; blockedReasons: string[] } => {
  if (proposed !== 'verified') return { status: proposed, blockedReasons: [] };
  const usableSupport = evidence.some(item => item.relationship === 'supports' && item.lifecycle === 'active' && item.freshness === 'current' && item.approved && item.result === 'performed');
  const contradiction = evidence.some(item => item.relationship === 'contradicts' && item.lifecycle === 'active' && item.freshness !== 'expired');
  const blockedReasons = [
    ...(!usableSupport ? ['CURRENT_APPROVED_SUPPORT_REQUIRED'] : []),
    ...(contradiction ? ['CURRENT_CONTRADICTION'] : []),
    ...(!limitationDisclosure.trim() ? ['LIMITATION_DISCLOSURE_REQUIRED'] : []),
    ...(doesNotProve.length === 0 || doesNotProve.some(item => !item.trim()) ? ['DOES_NOT_PROVE_REQUIRED'] : []),
  ];
  return blockedReasons.length ? { status: 'evidence_required', blockedReasons } : { status: 'verified', blockedReasons };
};

const canonicalize = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(',')}}`;
};

export const canonicalJson = (value: unknown): string => canonicalize(value);

export const sha256Hex = async (value: unknown): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const validateSnapshotPublication = (input: {
  creatorId: string;
  reviewerId: string | null;
  publisherId: string;
  reviewedHash: string | null;
  snapshotHash: string;
  claims: readonly { current: boolean; effectiveProofStatus: ProofStatus; selectedEvidenceCurrent: boolean; limitationDisclosure: string; doesNotProve: readonly string[] }[];
}): string[] => [
  ...(input.reviewerId === null || input.reviewedHash !== input.snapshotHash ? ['EXACT_SNAPSHOT_REVIEW_REQUIRED'] : []),
  ...(new Set([input.creatorId, input.reviewerId, input.publisherId]).size !== 3 ? ['SEPARATION_OF_DUTY_REQUIRED'] : []),
  ...(input.claims.some(claim => !claim.current) ? ['CLAIM_VERSION_CHANGED'] : []),
  ...(input.claims.some(claim => !claim.selectedEvidenceCurrent) ? ['EVIDENCE_VERSION_CHANGED'] : []),
  ...(input.claims.some(claim => claim.effectiveProofStatus === 'verified' && (!claim.limitationDisclosure.trim() || claim.doesNotProve.length === 0)) ? ['DISCLOSURE_REQUIRED'] : []),
];
