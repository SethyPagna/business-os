import { effectivePermissions, isAdminControlUser, type PermissionUser } from './permissions.ts'
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
  const permissions = authority.merged
  const admin = isAdminControlUser(user)
  // Counting is its own grant (owner, 21 Oct 2026); Inventory Full / Review no longer implies it.
  const canView = admin || authority.can('inventory_checks', 'view')
  const fields = Object.fromEntries(INVENTORY_CHECK_FIELDS.map(field => {
    return [field, canView && (admin || permissions[`inventory_check_show_${field}`] === true)]
  })) as Record<InventoryCheckField, boolean>
  // Cost has one switch (owner, 17 Nov): canViewAcquisitionCosts, admin by default and an editable grant once Slice A lands. The retired per-screen inventory_check_show_cost no longer gates it.
  fields.cost = canView && canViewAcquisitionCosts(user)
  return {
    canView,
    canCheck: admin || canView && authority.can('inventory_checks', 'check'),
    canViewCustomerDetails: fields.customers && authority.can('contacts', 'view'),
    fields,
  }
}
