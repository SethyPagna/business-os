import { isAdminControlUser, type PermissionUser } from './permissions'

export type CashierVisibilityMode = 'self' | 'staff' | 'all'

export type CashierVisibilityUser = Exclude<PermissionUser, null | undefined> & {
  id?: number | string | null
}

export type CashierVisibilityWhere = {
  mode: CashierVisibilityMode
  sql: string
  params: Record<string, number | string>
}

function comparableId(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
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

export function getAdministratorOwnerIds(users: readonly CashierVisibilityUser[]): Array<number | string> {
  return users
    .filter((user) => user.id !== null && user.id !== undefined && isAdminControlUser(user))
    .map((user) => user.id as number | string)
}

export function isCashierOwnerVisible(
  mode: CashierVisibilityMode,
  viewer: CashierVisibilityUser,
  owner: CashierVisibilityUser | null | undefined,
): boolean {
  if (isAdminControlUser(viewer) || mode === 'all') return true
  const ownerId = comparableId(owner?.id)
  if (ownerId === null) return false
  if (mode === 'self') return ownerId === comparableId(viewer.id)
  return !isAdminControlUser(owner)
}

function safeSqlIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(value)) throw new Error('Invalid cashier owner column')
  return value
}

function safeParamPrefix(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error('Invalid cashier parameter prefix')
  return value
}

/**
 * Builds only the cashier-policy predicate. Callers must AND it with their
 * existing branch, access, date, and search predicates; this helper never
 * replaces or broadens those scopes.
 */
export function buildCashierVisibilityWhere(options: {
  rawMode: unknown
  viewer: CashierVisibilityUser
  ownerColumn: string
  administratorOwnerIds?: readonly (number | string)[]
  exactOwnerId?: number | string | null
  paramPrefix?: string
}): CashierVisibilityWhere {
  const mode = resolveCashierVisibilityMode(options.rawMode, options.viewer)
  const column = safeSqlIdentifier(options.ownerColumn)
  const prefix = safeParamPrefix(options.paramPrefix || 'cashierVisibility')
  const params: Record<string, number | string> = {}
  const clauses: string[] = []

  if (mode === 'self') {
    const viewerId = comparableId(options.viewer.id)
    if (viewerId === null) return { mode, sql: '0=1', params }
    params[`${prefix}ViewerId`] = options.viewer.id as number | string
    clauses.push(`${column} = @${prefix}ViewerId`)
  } else if (mode === 'staff') {
    clauses.push(`${column} IS NOT NULL`)
    const adminIds = [...new Map((options.administratorOwnerIds || []).map((id) => [String(id), id])).values()]
    if (adminIds.length > 0) {
      const placeholders = adminIds.map((id, index) => {
        const key = `${prefix}Admin${index}`
        params[key] = id
        return `@${key}`
      })
      clauses.push(`${column} NOT IN (${placeholders.join(', ')})`)
    }
  }

  if (options.exactOwnerId !== null && options.exactOwnerId !== undefined) {
    const key = `${prefix}ExactId`
    params[key] = options.exactOwnerId
    clauses.push(`${column} = @${key}`)
  }

  return { mode, sql: clauses.length > 0 ? clauses.join(' AND ') : '1=1', params }
}
