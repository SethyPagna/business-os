// The two canonical branch roles, in one place.
//
// A branch's role comes from its explicit `branches.role` column when the
// row has one (added, seeded from the names, by the held migration
// ops/scripts/migration/held/branch_successor_role_schema.sql), and otherwise
// from its NAME, matched case-insensitively after trimming -- the rule this
// lineage has always used (stockActionCatalog.ts's
// `LOWER(TRIM(name)) IN ('shop', 'warehouse')`). `is_default` is NOT a
// role (it only says which branch a blank picker preselects), so nothing here
// may key on it.
//
// `shop` rings every sale. `warehouse` holds stock and never sells.
// Stock can move between the two canonical roles in either direction,
// while selling remains Shop-role only. Both halves of
// the app enforce that, so this file has a byte-for-byte twin at
// frontend/src/utils/branchRoles.ts -- keep the two in step (pinned by
// frontend/tests/branchRoleParity.test.ts).
export type BranchRole = 'shop' | 'warehouse' | 'other'

function roleFromText(value: unknown): BranchRole {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'shop') return 'shop'
  if (normalized === 'warehouse') return 'warehouse'
  return 'other'
}

// The role a bare branch NAME carries -- the original rule, unchanged.
export function branchRoleFromName(name: unknown): BranchRole {
  return roleFromText(name)
}

// The role of a branch, given its ROW or (still accepted) its bare name.
// A row whose explicit `role` column says 'shop' or 'warehouse' uses that;
// a row without one -- the column is absent until the held branch
// successor/role migration lands, or it is blank -- falls back to its name.
// After the consolidation the surviving branch is renamed "Store" and
// carries role 'shop', so selling checks must be handed the row.
export function branchRole(branch: unknown): BranchRole {
  if (branch !== null && typeof branch === 'object') {
    const explicit = roleFromText(Reflect.get(branch, 'role'))
    return explicit === 'other' ? roleFromText(Reflect.get(branch, 'name')) : explicit
  }
  return roleFromText(branch)
}

// A branch that may appear on a SALE line (POS, add-items-to-sale, a
// replacement line). Sales are intentionally Shop-role only: stock held at
// the Warehouse or any other/missing branch must be transferred first.
// Unknown and blank names are refused rather than guessed.
export function branchCanSell(branch: unknown): boolean {
  return branchRole(branch) === 'shop'
}

// Either canonical role can be an endpoint of a transfer. Direction is
// validated separately so two branches with the same role never become a
// valid pair. Unknown and historical branch names remain visible but cannot
// become new stock-action identities.
export function branchCanBeTransferSource(branch: unknown): boolean {
  return branchRole(branch) !== 'other'
}

export function branchCanBeTransferDestination(branch: unknown): boolean {
  return branchRole(branch) !== 'other'
}

export function branchCanTransferBetween(from: unknown, to: unknown): boolean {
  const fromRole = branchRole(from)
  const toRole = branchRole(to)
  return (fromRole === 'shop' && toRole === 'warehouse')
    || (fromRole === 'warehouse' && toRole === 'shop')
}
