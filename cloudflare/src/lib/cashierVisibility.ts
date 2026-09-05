import { isAdminControlUser, type PermissionUser } from './permissions'

export type CashierVisibilityMode = 'self' | 'staff' | 'all'

export type CashierVisibilityUser = Exclude<PermissionUser, null | undefined> & {
  id?: number | string | null
}

export type CashierVisibilityWhere = {
  mode: CashierVisibilityMode
  sql: string
  params: Record<string, number>
}

function normalizedOwnerId(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const parsed = Number(text)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function hasCanonicalAdministratorFields(owner: CashierVisibilityUser): boolean {
  return ['username', 'role_code', 'permissions', 'role_permissions']
    .every((key) => Object.prototype.hasOwnProperty.call(owner, key))
}

export function resolveCashierVisibilityMode(
  rawMode: unknown,
  viewer: CashierVisibilityUser,
): CashierVisibilityMode {
  if (isAdminControlUser(viewer)) return 'all'
  if (rawMode === null || rawMode === undefined || String(rawMode).trim() === '') return 'all'
  const normalized = String(rawMode).trim().toLowerCase()
  if (normalized === 'self' || normalized === 'staff' || normalized === 'all') return normalized
  return 'self'
}

export function isCashierOwnerVisible(
  rawMode: unknown,
  viewer: CashierVisibilityUser,
  owner: CashierVisibilityUser | null | undefined,
): boolean {
  const mode = resolveCashierVisibilityMode(rawMode, viewer)
  if (mode === 'all') return true

  const ownerId = normalizedOwnerId(owner?.id)
  if (ownerId === null) return false
  if (mode === 'self') return ownerId === normalizedOwnerId(viewer.id)
  if (!owner) return false
  if (isAdminControlUser(owner)) return false
  return hasCanonicalAdministratorFields(owner)
}

function safeSqlIdentifier(value: string, label: string): string {
  if (value.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function safeParamPrefix(value: string): string {
  if (value.length > 64 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error('Invalid cashier parameter prefix')
  }
  return value
}

/** SQL equivalent of JavaScript truthiness for one JSON `all` value. */
function jsonAllTruthySql(jsonColumn: string): string {
  return `(CASE
    WHEN json_valid(COALESCE(${jsonColumn}, '')) <> 1 THEN 0
    ELSE CASE json_type(${jsonColumn}, '$.all')
      WHEN 'true' THEN 1
      WHEN 'integer' THEN CASE WHEN json_extract(${jsonColumn}, '$.all') <> 0 THEN 1 ELSE 0 END
      WHEN 'real' THEN CASE WHEN json_extract(${jsonColumn}, '$.all') <> 0 THEN 1 ELSE 0 END
      WHEN 'text' THEN CASE WHEN length(json_extract(${jsonColumn}, '$.all')) > 0 THEN 1 ELSE 0 END
      WHEN 'array' THEN 1
      WHEN 'object' THEN 1
      ELSE 0
    END
  END)`
}

/** Whether a valid user-level permissions object explicitly owns `all`. */
function jsonHasAllKeySql(jsonColumn: string): string {
  return `(CASE
    WHEN json_valid(COALESCE(${jsonColumn}, '')) = 1
      THEN CASE WHEN json_type(${jsonColumn}, '$.all') IS NULL THEN 0 ELSE 1 END
    ELSE 0
  END)`
}

function canonicalAdministratorSql(userAlias: string, roleAlias: string): string {
  const userPermissions = `${userAlias}.permissions`
  const rolePermissions = `${roleAlias}.permissions`
  return `(
    lower(trim(COALESCE(${userAlias}.username, ''))) = 'admin'
    OR lower(trim(COALESCE(${roleAlias}.code, ''))) = 'admin'
    OR ${jsonAllTruthySql(userPermissions)} = 1
    OR (${jsonHasAllKeySql(userPermissions)} = 0 AND ${jsonAllTruthySql(rolePermissions)} = 1)
  )`
}

function staffOwnerSql(ownerColumn: string, prefix: string): string {
  const userAlias = safeSqlIdentifier(`${prefix}User`, 'cashier user alias')
  const roleAlias = safeSqlIdentifier(`${prefix}Role`, 'cashier role alias')
  return `${ownerColumn} IS NOT NULL AND EXISTS (
    SELECT 1
    FROM users AS ${userAlias}
    LEFT JOIN roles AS ${roleAlias} ON ${roleAlias}.id = ${userAlias}.role_id
    WHERE ${userAlias}.id = ${ownerColumn}
      AND NOT ${canonicalAdministratorSql(userAlias, roleAlias)}
  )`
}

function exactOwnerSql(ownerColumn: string, prefix: string, paramName: string): string {
  const userAlias = safeSqlIdentifier(`${prefix}ExactUser`, 'exact cashier user alias')
  return `${ownerColumn} = @${paramName} AND EXISTS (
    SELECT 1
    FROM users AS ${userAlias}
    WHERE ${userAlias}.id = @${paramName}
  )`
}

/**
 * Builds only a cashier-policy predicate. Callers must AND it with their
 * existing permission, branch, date, search, status, and other predicates.
 * The SQL shape is independent of the number of administrator accounts.
 */
export function buildCashierVisibilityWhere(options: {
  rawMode: unknown
  viewer: CashierVisibilityUser
  ownerColumn: string
  exactOwnerId?: number | string | null
  paramPrefix?: string
}): CashierVisibilityWhere {
  const mode = resolveCashierVisibilityMode(options.rawMode, options.viewer)
  const ownerColumn = safeSqlIdentifier(options.ownerColumn, 'cashier owner column')
  const prefix = safeParamPrefix(options.paramPrefix || 'cashierVisibility')
  const params: Record<string, number> = {}
  const clauses: string[] = []

  if (mode === 'self') {
    const viewerId = normalizedOwnerId(options.viewer.id)
    if (viewerId === null) clauses.push('0=1')
    else {
      const key = `${prefix}ViewerId`
      params[key] = viewerId
      clauses.push(`${ownerColumn} = @${key}`)
    }
  } else if (mode === 'staff') {
    clauses.push(staffOwnerSql(ownerColumn, prefix))
  }

  // `undefined` means no exact filter. Explicit null, malformed, zero, and
  // unsafe numeric IDs fail closed instead of becoming an unfiltered query.
  if (options.exactOwnerId !== undefined) {
    const exactOwnerId = normalizedOwnerId(options.exactOwnerId)
    if (exactOwnerId === null) clauses.push('0=1')
    else {
      const key = `${prefix}ExactId`
      params[key] = exactOwnerId
      clauses.push(exactOwnerSql(ownerColumn, prefix, key))
    }
  }

  return {
    mode,
    sql: clauses.length > 0 ? clauses.map((clause) => `(${clause})`).join(' AND ') : '1=1',
    params,
  }
}
