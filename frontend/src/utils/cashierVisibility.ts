export type CashierVisibilityMode = 'self' | 'staff' | 'all'

export type CashierVisibilityViewer = {
  id: number | string | null | undefined
  /** Supplied by the application's canonical permission classification. */
  isAdministrator: boolean
}

export type CashierVisibilityOption = {
  id: number | string | null | undefined
  /** Supplied by the server/canonical permission classification. */
  isAdministrator: boolean
}

function comparableId(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return String(value)
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

export function filterCashierOptions<T extends CashierVisibilityOption>(
  options: readonly T[],
  rawMode: unknown,
  viewer: CashierVisibilityViewer,
): T[] {
  const mode = resolveCashierVisibilityMode(rawMode, viewer)
  if (mode === 'all') return [...options]
  if (mode === 'self') {
    const viewerId = comparableId(viewer.id)
    return viewerId === null ? [] : options.filter((option) => comparableId(option.id) === viewerId)
  }
  return options.filter((option) => comparableId(option.id) !== null && !option.isAdministrator)
}

export type ExactCashierFilter =
  | { allowed: true; ownerId: number | string }
  | { allowed: false }

/** A rejected exact selection is explicit, never converted to an unfiltered request. */
export function resolveExactCashierFilter<T extends CashierVisibilityOption>(
  requestedOwnerId: number | string | null | undefined,
  options: readonly T[],
  rawMode: unknown,
  viewer: CashierVisibilityViewer,
): ExactCashierFilter {
  const requested = comparableId(requestedOwnerId)
  if (requested === null) return { allowed: false }
  const allowed = filterCashierOptions(options, rawMode, viewer)
    .some((option) => comparableId(option.id) === requested)
  return allowed
    ? { allowed: true, ownerId: requestedOwnerId as number | string }
    : { allowed: false }
}
