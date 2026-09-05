export type CashierVisibilityMode = 'self' | 'staff' | 'all'

export type CashierVisibilityViewer = {
  id: number | string | null | undefined
  /** Supplied by the application's canonical server permission classification. */
  isAdministrator: boolean
}

export type CashierVisibilityOwner = {
  id: number | string | null | undefined
  /** Undefined means the owner account has not been canonically resolved. */
  isAdministrator?: boolean
}

export type CashierVisibilityOption = CashierVisibilityOwner & {
  /** Selector options must always carry a canonical server classification. */
  isAdministrator: boolean
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

export function resolveCashierVisibilityMode(
  rawMode: unknown,
  viewer: CashierVisibilityViewer,
): CashierVisibilityMode {
  if (viewer.isAdministrator) return 'all'
  if (rawMode === null || rawMode === undefined || String(rawMode).trim() === '') return 'all'
  const normalized = String(rawMode).trim().toLowerCase()
  if (normalized === 'self' || normalized === 'staff' || normalized === 'all') return normalized
  return 'self'
}

/** Safe for cached/offline rows: unresolved owners are never admitted narrowly. */
export function isCashierOwnerVisible(
  rawMode: unknown,
  viewer: CashierVisibilityViewer,
  owner: CashierVisibilityOwner | null | undefined,
): boolean {
  const mode = resolveCashierVisibilityMode(rawMode, viewer)
  if (mode === 'all') return true

  const ownerId = normalizedOwnerId(owner?.id)
  if (ownerId === null) return false
  if (mode === 'self') return ownerId === normalizedOwnerId(viewer.id)
  return owner?.isAdministrator === false
}

export function filterCashierOptions<T extends CashierVisibilityOption>(
  options: readonly T[],
  rawMode: unknown,
  viewer: CashierVisibilityViewer,
): T[] {
  const mode = resolveCashierVisibilityMode(rawMode, viewer)
  return options.filter((option) => {
    if (normalizedOwnerId(option.id) === null) return false
    if (mode === 'all') return true
    if (mode === 'self') return normalizedOwnerId(option.id) === normalizedOwnerId(viewer.id)
    return option.isAdministrator === false
  })
}

export type ExactCashierFilter =
  | { allowed: true; ownerId: number }
  | { allowed: false }

/** A rejected or unresolved exact selection never degrades to no filter. */
export function resolveExactCashierFilter<T extends CashierVisibilityOption>(
  requestedOwnerId: number | string | null | undefined,
  options: readonly T[],
  rawMode: unknown,
  viewer: CashierVisibilityViewer,
): ExactCashierFilter {
  const requested = normalizedOwnerId(requestedOwnerId)
  if (requested === null) return { allowed: false }
  const allowed = filterCashierOptions(options, rawMode, viewer)
    .some((option) => normalizedOwnerId(option.id) === requested)
  return allowed ? { allowed: true, ownerId: requested } : { allowed: false }
}
