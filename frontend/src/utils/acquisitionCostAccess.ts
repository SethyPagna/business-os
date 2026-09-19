import { effectivePermissions, type PermissionUser } from './permissions.ts'

/** Independent explicit grants; product/inventory access grants neither. */
export function canViewAcquisitionCosts(user: PermissionUser): boolean {
  return effectivePermissions(user).hasPermission('product_cost_view')
}

export function canEditAcquisitionCosts(user: PermissionUser): boolean {
  return effectivePermissions(user).hasPermission('product_cost_edit')
}

/** Omit denied inputs, rather than turning redacted values into zero writes. */
export function omitUnauthorizedCatalogCosts<T extends object>(payload: T, user: PermissionUser): T {
  const result = { ...payload }
  if (!canEditAcquisitionCosts(user)) {
    for (const key of ['cost_price_usd', 'cost_price_khr', 'purchase_price_usd', 'purchase_price_khr']) delete (result as Record<string, unknown>)[key]
  }
  return result
}
