import { toDbBool } from './db'
import { branchRoleFromName } from './branchRoles'

export type CanonicalBranchName = 'Shop' | 'Warehouse'

export type BranchIdentitySnapshot = {
  id: number | string
  name: unknown
  is_active: unknown
}

export type BranchIdentityFields = {
  name?: unknown
  is_active?: unknown
}

export const CANONICAL_BRANCH_IDENTITY_CODE = 'canonical_branch_identity_locked'
export const CANONICAL_BRANCH_IDENTITY_ERROR =
  'Branches are fixed to Shop and Warehouse. You can edit their details, but you cannot add, rename, deactivate, or delete a branch.'

export class CanonicalBranchIdentityError extends Error {
  readonly code = CANONICAL_BRANCH_IDENTITY_CODE

  constructor() {
    super(CANONICAL_BRANCH_IDENTITY_ERROR)
    this.name = 'CanonicalBranchIdentityError'
  }
}

/** Returns the display spelling for either intentional identity, or null. */
export function canonicalBranchName(value: unknown): CanonicalBranchName | null {
  const role = branchRoleFromName(value)
  if (role === 'shop') return 'Shop'
  if (role === 'warehouse') return 'Warehouse'
  return null
}

export function isCanonicalBranchName(value: unknown): boolean {
  return canonicalBranchName(value) !== null
}

/** Creation and deletion are both forbidden by the fixed two-branch model. */
export function assertCanonicalBranchSetMutationAllowed(): never {
  throw new CanonicalBranchIdentityError()
}

/**
 * Validate an update against the row that was actually read. Identity fields
 * omitted by a metadata-only request are preserved. Equivalent casing or
 * surrounding whitespace is accepted as the same identity, but the stored
 * spelling is retained so an ordinary edit never becomes a data repair.
 */
export function prepareCanonicalBranchUpdate(
  current: BranchIdentitySnapshot,
  requested: BranchIdentityFields,
): { name: string; is_active: number; canonicalName: CanonicalBranchName } {
  const currentCanonicalName = canonicalBranchName(current.name)
  const currentActive = toDbBool(current.is_active, 0)
  if (!currentCanonicalName || currentActive !== 1) throw new CanonicalBranchIdentityError()

  const requestedName = requested.name == null ? current.name : requested.name
  const requestedActive = requested.is_active == null || requested.is_active === ''
    ? currentActive
    : toDbBool(requested.is_active, currentActive)
  if (canonicalBranchName(requestedName) !== currentCanonicalName || requestedActive !== currentActive) {
    throw new CanonicalBranchIdentityError()
  }

  return {
    name: String(current.name),
    is_active: currentActive,
    canonicalName: currentCanonicalName,
  }
}

/**
 * Re-check the exact identity snapshot inside the same D1 batch as the edit.
 * On a missing or changed row, this deliberately attempts a NULL name insert;
 * branches.name is NOT NULL, so D1 throws and rolls the entire batch back.
 */
export function canonicalBranchIdentityGuardStatement(current: BranchIdentitySnapshot): {
  sql: string
  params: Record<string, unknown>
} {
  return {
    sql: `INSERT INTO branches (name)
      SELECT NULL
      WHERE NOT EXISTS (
        SELECT 1 FROM branches
        WHERE id = @identity_id
          AND name IS @identity_name
          AND is_active IS @identity_active
      )`,
    params: {
      identity_id: current.id,
      identity_name: current.name,
      identity_active: toDbBool(current.is_active, 0),
    },
  }
}
