import { effectivePermissions, isAdminControlUser, parsePermissionMap, type PermissionUser } from './permissions.ts'
import { isActionOverriddenOff } from './permissionActions.ts'
import { canViewAcquisitionCosts } from './acquisitionCostAccess.ts'

export const INVENTORY_CHECK_FIELDS = ['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers', 'cost'] as const
export type InventoryCheckField = typeof INVENTORY_CHECK_FIELDS[number]
export type InventoryCheckAccess = {
  canView: boolean
  canCheck: boolean
  canViewCustomerDetails: boolean
  fields: Record<InventoryCheckField, boolean>
}

export function getInventoryCheckAccess(user: PermissionUser): InventoryCheckAccess {
  const authority = effectivePermissions(user)
  const permissions = { ...parsePermissionMap(user?.role_permissions), ...parsePermissionMap(user?.permissions) }
  const admin = isAdminControlUser(user)
  const canView = authority.can('inventory', 'view')
  const tier = authority.getPermissionTier('inventory')
  const fields = Object.fromEntries(INVENTORY_CHECK_FIELDS.map(field => {
    const explicit = permissions[`inventory_check_show_${field}`]
    return [field, canView && (admin || (typeof explicit === 'boolean' ? explicit : tier === 'full'))]
  })) as Record<InventoryCheckField, boolean>
  fields.cost = fields.cost && canViewAcquisitionCosts(user)
  return {
    canView,
    canCheck: canView && (tier === 'full' || tier === 'review') && !isActionOverriddenOff(permissions, 'inventory', 'check'),
    canViewCustomerDetails: fields.customers && authority.can('contacts', 'view'),
    fields,
  }
}
