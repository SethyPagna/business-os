import { effectivePermissions, type PermissionUser } from './permissions.ts'

// Owner, 5 Oct 2026: a merge applies the standing rule by itself (highest selling and wholesale price,
// quantity-weighted cost, the barcode without leading zeros) and needs no permission. Only a MANUAL choice
// of a price different from that rule is a product edit, and so is changing a product's default price anywhere.
// Employee default: product information and images, never the default selling or wholesale price (they adjust a
// price per sale in the POS cart).

/** May change a product's default selling or wholesale price: Edit product and the price action both on. */
export function canChangeProductPrices(user: PermissionUser): boolean {
  const { isAdmin, can } = effectivePermissions(user)
  return isAdmin || (can('products', 'edit') && can('products', 'price'))
}

/** May pick a merge price other than the rule. Mirrors the Worker's fold: Edit product at FULL tier and the price action not off. */
export function canOverrideMergePrice(user: PermissionUser): boolean {
  const { isAdmin, getPermissionTier } = effectivePermissions(user)
  return isAdmin || (getPermissionTier('products') === 'full' && canChangeProductPrices(user))
}
