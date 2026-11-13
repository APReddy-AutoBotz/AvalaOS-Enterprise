/** Public, bounded contract for an isolated synthetic account roster. */
export const SYNTHETIC_ADMIN_CAPABILITY = 'admin.synthetic.users.manage' as const;
// Supabase Auth checks the bcrypt 72-byte maximum before creating a user.
// This contract accepts ASCII only, so characters and encoded bytes coincide.
export const SYNTHETIC_ADMIN_PASSWORD_MAX_LENGTH = 72;
export const SYNTHETIC_ADMIN_ROLE_PRESETS = ['author', 'reviewer', 'approver', 'viewer'] as const;
export type SyntheticAdminRolePreset = typeof SYNTHETIC_ADMIN_ROLE_PRESETS[number];
export const SYNTHETIC_ADMIN_OPERATIONS = ['reserve', 'execute', 'reconcile', 'list', 'assign_role', 'revoke'] as const;
export type SyntheticAdminOperation = typeof SYNTHETIC_ADMIN_OPERATIONS[number];
export type SyntheticAdminState = 'reserved' | 'execution_claimed' | 'reconciliation_required' | 'active' | 'revoked' | 'ban_required' | 'ban_uncertain';

export type SyntheticAdminRosterItem = {
  reservationId: string;
  label: string;
  loginId: string;
  rolePreset: SyntheticAdminRolePreset;
  state: SyntheticAdminState;
  version: number;
};

export type SyntheticAdminResult = {
  status: SyntheticAdminState | 'listed';
  reservationId?: string;
  loginId?: string;
  version?: number;
  roster?: SyntheticAdminRosterItem[];
  nextCursor?: string | null;
};

export type SyntheticAdminEnvelope = {
  operation: SyntheticAdminOperation;
  organizationId: string;
  workspaceId: string;
  expectedAuthorizationVersion: number;
  requestId?: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
};

export const SYNTHETIC_ADMIN_ERROR_CODES = [
  'INVALID_REQUEST', 'NOT_FOUND', 'PERMISSION_DENIED', 'AUTHORIZATION_STALE',
  'VERSION_CONFLICT', 'FEATURE_DISABLED', 'RECONCILIATION_REQUIRED',
  'QUOTA_EXCEEDED', 'TEMPORARY_FAILURE', 'IDEMPOTENCY_CONFLICT',
] as const;
export type SyntheticAdminErrorCode = typeof SYNTHETIC_ADMIN_ERROR_CODES[number];

export class SyntheticAdminError extends Error {
  readonly errorCode: SyntheticAdminErrorCode;
  constructor(errorCode: SyntheticAdminErrorCode) {
    super(errorCode);
    this.errorCode = errorCode;
    this.name = 'SyntheticAdminError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9._:-]{8,200}$/;
const own = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).every(key => keys.includes(key));
const validUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const validPreset = (value: unknown): value is SyntheticAdminRolePreset =>
  typeof value === 'string' && (SYNTHETIC_ADMIN_ROLE_PRESETS as readonly string[]).includes(value);

export const parseSyntheticAdminEnvelope = (input: unknown): SyntheticAdminEnvelope => {
  if (!own(input) || !exact(input, ['operation', 'organizationId', 'workspaceId',
    'expectedAuthorizationVersion', 'requestId', 'idempotencyKey', 'payload'])
    || typeof input.operation !== 'string'
    || !(SYNTHETIC_ADMIN_OPERATIONS as readonly string[]).includes(input.operation)
    || !validUuid(input.organizationId) || !validUuid(input.workspaceId)
    || !Number.isSafeInteger(input.expectedAuthorizationVersion)
    || Number(input.expectedAuthorizationVersion) < 1 || !own(input.payload)) {
    throw new SyntheticAdminError('INVALID_REQUEST');
  }
  const operation = input.operation as SyntheticAdminOperation;
  const write = operation !== 'list';
  if (write && (!validUuid(input.requestId) || typeof input.idempotencyKey !== 'string' || !KEY.test(input.idempotencyKey))
    || !write && ('requestId' in input || 'idempotencyKey' in input)) {
    throw new SyntheticAdminError('INVALID_REQUEST');
  }
  const payload = input.payload;
  const fields: Record<SyntheticAdminOperation, readonly string[]> = {
    reserve: ['label', 'rolePreset'], execute: ['reservationId', 'password'],
    reconcile: ['reservationId'], list: ['cursor', 'limit'],
    assign_role: ['reservationId', 'expectedVersion', 'rolePreset'],
    revoke: ['reservationId', 'expectedVersion'],
  };
  if (!exact(payload, fields[operation])) throw new SyntheticAdminError('INVALID_REQUEST');
  const label = payload.label;
  if (operation === 'reserve' && (typeof label !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(label)
    || !validPreset(payload.rolePreset))) throw new SyntheticAdminError('INVALID_REQUEST');
  if (['execute', 'reconcile', 'assign_role', 'revoke'].includes(operation) && !validUuid(payload.reservationId))
    throw new SyntheticAdminError('INVALID_REQUEST');
  if (operation === 'execute' && (typeof payload.password !== 'string' || payload.password.length < 12
    || payload.password.length > SYNTHETIC_ADMIN_PASSWORD_MAX_LENGTH || !/[A-Z]/.test(payload.password)
    || !/[a-z]/.test(payload.password) || !/[0-9]/.test(payload.password)
    || !/[^A-Za-z0-9\s]/.test(payload.password) || !/^[\x21-\x7e]+$/.test(payload.password)))
    throw new SyntheticAdminError('INVALID_REQUEST');
  if (operation === 'assign_role' && !validPreset(payload.rolePreset)) throw new SyntheticAdminError('INVALID_REQUEST');
  if (['assign_role', 'revoke'].includes(operation) && (!Number.isSafeInteger(payload.expectedVersion)
    || Number(payload.expectedVersion) < 1)) throw new SyntheticAdminError('INVALID_REQUEST');
  if (operation === 'list' && ((payload.limit !== undefined && (!Number.isSafeInteger(payload.limit)
    || Number(payload.limit) < 1 || Number(payload.limit) > 20))
    || (payload.cursor !== undefined && !validUuid(payload.cursor)))) throw new SyntheticAdminError('INVALID_REQUEST');
  return {
    operation, organizationId: input.organizationId, workspaceId: input.workspaceId,
    expectedAuthorizationVersion: Number(input.expectedAuthorizationVersion),
    ...(write ? { requestId: input.requestId as string, idempotencyKey: input.idempotencyKey as string } : {}), payload,
  };
};
