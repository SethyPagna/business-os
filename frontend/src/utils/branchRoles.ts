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
// return's replacement line). Only the warehouse is refused: an
// unrecognised branch name is not evidence that it is stock-only, and
// refusing it would break every deployment that names its shop
// something else.
export function branchCanSell(name: unknown): boolean {
  return branchRoleFromName(name) !== 'warehouse'
}

// Transfers move stock OUT of the warehouse and INTO the shop: the shop
// never sends stock away, the warehouse never receives it. Stated as two
// refusals rather than one whitelist so a deployment that grows a third,
// differently-named branch is left alone instead of being second-guessed
// by a rule written for two -- and so the UI's disabled options and the
// Worker's rejection are the SAME predicate, not two rules that drift.
export function branchCanBeTransferSource(name: unknown): boolean {
  return branchRoleFromName(name) !== 'shop'
}

export function branchCanBeTransferDestination(name: unknown): boolean {
  return branchRoleFromName(name) !== 'warehouse'
}
