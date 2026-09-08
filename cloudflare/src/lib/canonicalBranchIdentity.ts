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

export type CanonicalTransferBranchRow = BranchIdentitySnapshot

export type CanonicalTransferPair = {
  shop: CanonicalTransferBranchRow
  warehouse: CanonicalTransferBranchRow
}

export const CANONICAL_BRANCH_IDENTITY_CODE = 'canonical_branch_identity_locked'
export const CANONICAL_BRANCH_IDENTITY_ERROR =
  'Branches are fixed to Shop and Warehouse. You can edit their details, but you cannot add, rename, deactivate, or delete a branch.'
export const CANONICAL_BRANCH_CONFIGURATION_CODE = 'canonical_branch_configuration_invalid'
export const CANONICAL_BRANCH_CONFIGURATION_ERROR =
  'Stock transfer is unavailable because the branch setup must contain exactly one active Shop and one active Warehouse. Ask an administrator to repair the branch records before trying again.'

export const CANONICAL_TRANSFER_BRANCHES_SQL = `
  SELECT id, name, is_active
  FROM branches
  WHERE LOWER(TRIM(name)) IN ('shop', 'warehouse')
  ORDER BY id ASC
`

export class CanonicalBranchIdentityError extends Error {
  readonly code = CANONICAL_BRANCH_IDENTITY_CODE

  constructor() {
    super(CANONICAL_BRANCH_IDENTITY_ERROR)
    this.name = 'CanonicalBranchIdentityError'
  }
}

export class CanonicalBranchConfigurationError extends Error {
  readonly code = CANONICAL_BRANCH_CONFIGURATION_CODE

  constructor() {
    super(CANONICAL_BRANCH_CONFIGURATION_ERROR)
    this.name = 'CanonicalBranchConfigurationError'
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

/**
 * Resolve the two operational identities from an authoritative branches read.
 * Legacy/inactive rows remain untouched, but duplicate or missing active
 * canonical rows make transfer authority ambiguous and therefore fail closed.
 */
export function resolveCanonicalTransferPair(rows: CanonicalTransferBranchRow[]): CanonicalTransferPair {
  const active = rows.filter((row) => toDbBool(row.is_active, 0) === 1)
  const shops = active.filter((row) => canonicalBranchName(row.name) === 'Shop')
  const warehouses = active.filter((row) => canonicalBranchName(row.name) === 'Warehouse')
  if (shops.length !== 1 || warehouses.length !== 1) throw new CanonicalBranchConfigurationError()
  return { shop: shops[0], warehouse: warehouses[0] }
}

export function isCanonicalTransferSelection(
  pair: CanonicalTransferPair,
  fromBranchId: number,
  toBranchId: number,
): boolean {
  return Number(pair.warehouse.id) === fromBranchId && Number(pair.shop.id) === toBranchId
}

/**
 * Re-check canonical uniqueness, activation, and the selected IDs inside the
 * same D1 batch as the stock movement. A concurrent identity change causes a
 * NOT NULL failure and rolls the whole transfer back.
 */
export function canonicalTransferAuthorityGuardStatement(
  fromBranchId: number,
  toBranchId: number,
): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `INSERT INTO branches (name)
      SELECT NULL
      WHERE NOT (
        (SELECT COUNT(*) FROM branches
          WHERE COALESCE(is_active, 0) = 1
            AND LOWER(TRIM(name)) = 'warehouse') = 1
        AND (SELECT COUNT(*) FROM branches
          WHERE COALESCE(is_active, 0) = 1
            AND LOWER(TRIM(name)) = 'shop') = 1
        AND EXISTS (
          SELECT 1 FROM branches
          WHERE id = @transfer_from_branch_id
            AND COALESCE(is_active, 0) = 1
            AND LOWER(TRIM(name)) = 'warehouse'
        )
        AND EXISTS (
          SELECT 1 FROM branches
          WHERE id = @transfer_to_branch_id
            AND COALESCE(is_active, 0) = 1
            AND LOWER(TRIM(name)) = 'shop'
        )
      )`,
    params: {
      transfer_from_branch_id: fromBranchId,
      transfer_to_branch_id: toBranchId,
    },
  }
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
