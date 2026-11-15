import { effectivePermissions, isAdminControlUser, type PermissionUser } from './permissions.ts'

/** Owner ruling, 15 Nov 2026: cost, profit, margin, stock value and removal loss are ADMIN ONLY. Mirrors cloudflare/src/lib/acquisitionCostAccess.ts. */
export function canViewAcquisitionCosts(user: PermissionUser): boolean {
  return isAdminControlUser(user)
}

export function canEditAcquisitionCosts(user: PermissionUser): boolean {
  return isAdminControlUser(user)
}

/** UNUSED since 15 Nov 2026: the per-account grants, kept as the way back (swap into the two functions above). */
export function holdsCostViewGrant(user: PermissionUser): boolean {
  return isAdminControlUser(user) || effectivePermissions(user).merged.product_cost_view === true
}

export function holdsCostEditGrant(user: PermissionUser): boolean {
  return isAdminControlUser(user) || effectivePermissions(user).merged.product_cost_edit === true
}

/** Omit denied inputs, rather than turning redacted values into zero writes. */
export function omitUnauthorizedCatalogCosts<T extends object>(payload: T, user: PermissionUser): T {
  const result = { ...payload }
  if (!canEditAcquisitionCosts(user)) {
    for (const key of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) delete (result as Record<string, unknown>)[key]
  }
  return result
}
