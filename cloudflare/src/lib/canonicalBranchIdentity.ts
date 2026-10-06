import { toDbBool } from './db'
import { branchActiveSuccessorPath, branchRole, branchRoleFromName, resolveActiveSuccessor } from './branchRoles'

// F2 of the branch cutover design: a recorded branch id -> the active branch a
// stock effect must land on (identity for an active branch). The walker lives
// in branchRoles.ts so the till can use the same rule; this module is where
// the Worker routes import it from.
export { resolveActiveSuccessor }
export type { ActiveBranchSuccessor } from './branchRoles'

export type CanonicalBranchName = 'Shop' | 'Warehouse'

export type BranchIdentitySnapshot = {
  id: number | string
  name: unknown
  is_active: unknown
  role?: unknown
  canonical_key?: unknown
  successor_branch_id?: unknown
  is_default?: unknown
  updated_at?: unknown
}

function activeSuccessorPath(
  rows: readonly BranchIdentitySnapshot[],
  source: BranchIdentitySnapshot,
): BranchIdentitySnapshot[] | null {
  return branchActiveSuccessorPath(rows, source)
}

export type BranchIdentityFields = {
  name?: unknown
  is_active?: unknown
  role?: unknown
  canonical_key?: unknown
  successor_branch_id?: unknown
  is_default?: unknown
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
  'Stock transfer is unavailable because the branch setup does not have a selling branch and a storage branch that are both active. Ask an administrator to check the branch records before trying again.'

// The operational role of a branch row in SQL: the explicit role, else the name
// (the JS twin is branchRole() in branchRoles.ts). While role is NULL on every
// row this is exactly the old name test; once a branch is renamed (Warehouse ->
// "LC Store") the role still answers.
const BRANCH_ROLE_SQL = 'LOWER(TRIM(COALESCE(role, name)))'

export const CANONICAL_TRANSFER_BRANCHES_SQL = `
  SELECT id, name, role, is_active
  FROM branches
  WHERE ${BRANCH_ROLE_SQL} IN ('shop', 'warehouse')
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

export function canonicalBranchIdentityOf(row: BranchIdentitySnapshot): CanonicalBranchName | null {
  return canonicalBranchName(row.canonical_key == null ? row.name : row.canonical_key)
}

function metadataSuccessors(current: BranchIdentitySnapshot, rows: readonly BranchIdentitySnapshot[]): BranchIdentitySnapshot[] {
  if (!canonicalBranchIdentityOf(current)
    || (current.role != null && branchRoleFromName(current.role) === 'other')) throw new CanonicalBranchIdentityError()
  if (toDbBool(current.is_active, 0) === 1) {
    if (current.successor_branch_id != null) throw new CanonicalBranchIdentityError()
    return []
  }
  const path = activeSuccessorPath(rows, current)
  if (!path || path.some(row => !canonicalBranchIdentityOf(row)
    || (row.role != null && branchRoleFromName(row.role) === 'other'))) throw new CanonicalBranchIdentityError()
  return path
}

/**
 * Resolve the two operational identities from an authoritative branches read.
 * Legacy/inactive rows remain untouched, but duplicate or missing active
 * canonical rows make transfer authority ambiguous and therefore fail closed.
 */
export function resolveCanonicalTransferPair(rows: CanonicalTransferBranchRow[]): CanonicalTransferPair {
  const active = rows.filter((row) => toDbBool(row.is_active, 0) === 1)
  const shops = active.filter((row) => branchRole(row) === 'shop')
  const warehouses = active.filter((row) => branchRole(row) === 'warehouse')
  if (shops.length !== 1 || warehouses.length !== 1) throw new CanonicalBranchConfigurationError()
  return { shop: shops[0], warehouse: warehouses[0] }
}

export function isCanonicalTransferSelection(
  pair: CanonicalTransferPair,
  fromBranchId: number,
  toBranchId: number,
): boolean {
  const shopId = Number(pair.shop.id)
  const warehouseId = Number(pair.warehouse.id)
  return (warehouseId === fromBranchId && shopId === toBranchId)
    || (shopId === fromBranchId && warehouseId === toBranchId)
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
            AND ${BRANCH_ROLE_SQL} = 'warehouse') = 1
        AND (SELECT COUNT(*) FROM branches
          WHERE COALESCE(is_active, 0) = 1
            AND ${BRANCH_ROLE_SQL} = 'shop') = 1
        AND (
          (
            EXISTS (
              SELECT 1 FROM branches
              WHERE id = @transfer_from_branch_id
                AND COALESCE(is_active, 0) = 1
                AND ${BRANCH_ROLE_SQL} = 'warehouse'
            )
            AND EXISTS (
              SELECT 1 FROM branches
              WHERE id = @transfer_to_branch_id
                AND COALESCE(is_active, 0) = 1
                AND ${BRANCH_ROLE_SQL} = 'shop'
            )
          )
          OR (
            EXISTS (
              SELECT 1 FROM branches
              WHERE id = @transfer_from_branch_id
                AND COALESCE(is_active, 0) = 1
                AND ${BRANCH_ROLE_SQL} = 'shop'
            )
            AND EXISTS (
              SELECT 1 FROM branches
              WHERE id = @transfer_to_branch_id
                AND COALESCE(is_active, 0) = 1
                AND ${BRANCH_ROLE_SQL} = 'warehouse'
            )
          )
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
  rows: readonly BranchIdentitySnapshot[] = [],
): { name: string; is_active: number; canonicalName: CanonicalBranchName } {
  const currentCanonicalName = canonicalBranchIdentityOf(current)
  const currentActive = toDbBool(current.is_active, 0)
  if (!currentCanonicalName) throw new CanonicalBranchIdentityError()
  metadataSuccessors(current, rows)
  if (!currentActive && (toDbBool(current.is_default, 0) || toDbBool(requested.is_default, 0))) {
    throw new CanonicalBranchIdentityError()
  }
  for (const field of ['role', 'canonical_key', 'successor_branch_id'] as const) {
    if (Object.prototype.hasOwnProperty.call(requested, field) && requested[field] !== current[field]) {
      throw new CanonicalBranchIdentityError()
    }
  }

  const requestedName = requested.name == null ? current.name : requested.name
  const requestedActive = requested.is_active == null || requested.is_active === ''
    ? currentActive
    : toDbBool(requested.is_active, currentActive)
  if (String(requestedName).trim().toLowerCase() !== String(current.name).trim().toLowerCase() || requestedActive !== currentActive) {
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
export function canonicalBranchIdentityGuardStatement(current: BranchIdentitySnapshot, rows: readonly BranchIdentitySnapshot[] = []): {
  sql: string
  params: Record<string, unknown>
} {
  const snapshots = [current, ...metadataSuccessors(current, rows)]
  const params: Record<string, unknown> = {}
  const checks = snapshots.map((row, index) => {
    const prefix = `identity_${index}`
    params[`${prefix}_id`] = row.id
    params[`${prefix}_name`] = row.name
    params[`${prefix}_active`] = toDbBool(row.is_active, 0)
    const conditions = [`id = @${prefix}_id`, `name IS @${prefix}_name`, `is_active IS @${prefix}_active`]
    for (const field of ['role', 'canonical_key', 'successor_branch_id', 'is_default', 'updated_at'] as const) {
      if (Object.prototype.hasOwnProperty.call(row, field)) {
        params[`${prefix}_${field}`] = row[field] ?? null
        conditions.push(`${field} IS @${prefix}_${field}`)
      }
    }
    return `EXISTS (SELECT 1 FROM branches WHERE ${conditions.join(' AND ')})`
  })
  return {
    sql: `INSERT INTO branches (name)
      SELECT NULL
      WHERE NOT (${checks.join(' AND ')})`,
    params,
  }
}
