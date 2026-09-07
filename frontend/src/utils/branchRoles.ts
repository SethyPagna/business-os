// The two canonical branches, in one place.
//
// This lineage has no `kind`/`role` column on `branches`: the only
// discriminator that exists anywhere is the branch NAME, matched
// case-insensitively after trimming -- see cloudflare/src/lib/
// stockActionCatalog.ts's `LOWER(TRIM(name)) IN ('shop', 'warehouse')`,
// which is the rule the unified stock-action importer has always used.
// `is_default` is NOT that discriminator (it only says which branch a
// blank picker preselects), so nothing here may key on it.
//
// `shop` rings every sale. `warehouse` holds stock and never sells;
// stock leaves it only through a transfer to the shop. Both halves of
// the app enforce that, so this file has a byte-for-byte twin at
// cloudflare/src/lib/branchRoles.ts -- keep the two in step (pinned by
// frontend/tests/branchRoleParity.test.ts).
export type BranchRole = 'shop' | 'warehouse' | 'other'

export function branchRoleFromName(name: unknown): BranchRole {
  const normalized = String(name ?? '').trim().toLowerCase()
  if (normalized === 'shop') return 'shop'
  if (normalized === 'warehouse') return 'warehouse'
  return 'other'
}

// A branch that may appear on a SALE line (POS, add-items-to-sale, a
// replacement line). Sales are intentionally Shop-only: stock held at the
// Warehouse or any other/missing branch must be transferred to the canonical
// Shop first. Unknown and blank names are refused rather than guessed.
export function branchCanSell(name: unknown): boolean {
  return branchRoleFromName(name) === 'shop'
}

// Transfers move stock only from the canonical Warehouse to the canonical
// Shop. Unknown and historical branch names remain visible but cannot become
// new stock-action identities.
export function branchCanBeTransferSource(name: unknown): boolean {
  return branchRoleFromName(name) === 'warehouse'
}

export function branchCanBeTransferDestination(name: unknown): boolean {
  return branchRoleFromName(name) === 'shop'
}
