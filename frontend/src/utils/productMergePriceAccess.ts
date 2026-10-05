import { effectivePermissions, type PermissionUser } from './permissions.ts'

// Owner, 5 Oct 2026: copying another product's selling or wholesale price during a
// merge needs the product-edit permission (merge permission alone is not enough).
// Mirrors the Worker's rule in foldDuplicateProductInto: the actor's products tier
// must be FULL and the edit action not switched off (getActionTier(user,
// 'products', 'edit') === 'full'). A Partial-access (review) user can merge only
// where no price would move, exactly like a user without the edit switch.
export function canCopyMergePrice(user: PermissionUser): boolean {
  const { isAdmin, getPermissionTier, can } = effectivePermissions(user)
  return isAdmin || (getPermissionTier('products') === 'full' && can('products', 'edit'))
}

const PRICE_FIELD = /^(selling|wholesale)_price_(usd|khr)$/

/** True when a merge preview says it would move a selling or wholesale price onto the kept product. */
export function mergeChangesPrices(changes: ReadonlyArray<{ field: string }> | null | undefined): boolean {
  return Boolean(changes?.some((change) => PRICE_FIELD.test(change.field)))
}
