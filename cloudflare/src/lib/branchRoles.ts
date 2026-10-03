// Explicit roles survive display-name changes; legacy rows use the name.
// Keep the frontend twin identical, verified by branchRoleParity.test.ts.
export type BranchRole = 'shop' | 'warehouse' | 'other'

export function branchRoleFromName(name: unknown): BranchRole {
  const normalized = String(name ?? '').trim().toLowerCase()
  if (normalized === 'shop') return 'shop'
  if (normalized === 'warehouse') return 'warehouse'
  return 'other'
}

export function branchRole(branch: unknown): BranchRole {
  if (branch !== null && typeof branch === 'object') {
    const role = Reflect.get(branch, 'role')
    return branchRoleFromName(role == null ? Reflect.get(branch, 'name') : role)
  }
  return branchRoleFromName(branch)
}

// A branch that may appear on a SALE line (POS, add-items-to-sale, a
// replacement line). Sales require the shop role: stock held at the
// Warehouse or any other/missing branch must be transferred to the canonical
// Shop first. Unknown and blank names are refused rather than guessed.
export function branchCanSell(name: unknown): boolean {
  return branchRole(name) === 'shop'
}

// Either canonical branch can be an endpoint of a transfer. Direction is
// validated separately so two branches with the same role never become a
// valid pair. Unknown and historical branch names remain visible but cannot
// become new stock-action identities.
export function branchCanBeTransferSource(name: unknown): boolean {
  return branchRole(name) !== 'other'
}

export function branchCanBeTransferDestination(name: unknown): boolean {
  return branchRole(name) !== 'other'
}

export function branchCanTransferBetween(fromName: unknown, toName: unknown): boolean {
  const fromRole = branchRole(fromName)
  const toRole = branchRole(toName)
  return (fromRole === 'shop' && toRole === 'warehouse')
    || (fromRole === 'warehouse' && toRole === 'shop')
}
