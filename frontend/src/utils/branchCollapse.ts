// Branch UI collapses to one branch from DATA, never from a flag.
//
// After the cutover only one branch is active (LC Store); Old Shop is retired.
// Every surface that offers a branch choice, a transfer, or a branch column
// asks these helpers about the branch rows it already holds, so the same code
// shows two branches today and one tomorrow with no switch to flip.
import { branchIsActive, branchRole } from './branchRoles.ts'

type BranchRow = { is_active?: unknown; name?: unknown; role?: unknown }

// The rows that can take part in anything new. A row that does not say is
// active (COALESCE(is_active, 1)), exactly like the Worker.
export function activeBranchRows<T extends BranchRow>(rows: readonly T[] | null | undefined): T[] {
  return (Array.isArray(rows) ? rows : []).filter((row) => row != null && branchIsActive(row))
}

// More than one active branch: only then is a branch picker, branch column or
// per-branch breakdown worth showing.
export function hasMultipleActiveBranches(rows: readonly BranchRow[] | null | undefined): boolean {
  return activeBranchRows(rows).length > 1
}

// The one active branch when exactly one exists, else null. Callers preselect
// it and hide the picker.
export function soleActiveBranch<T extends BranchRow>(rows: readonly T[] | null | undefined): T | null {
  const active = activeBranchRows(rows)
  return active.length === 1 ? active[0] : null
}

// A transfer needs one active shop-role branch and one active warehouse-role
// branch (the Worker's canonical pair, decided by role). One active branch, or
// two of the same role, means there is nothing to transfer.
export function hasTransferPair(rows: readonly BranchRow[] | null | undefined): boolean {
  const active = activeBranchRows(rows)
  return active.filter((row) => branchRole(row) === 'shop').length === 1
    && active.filter((row) => branchRole(row) === 'warehouse').length === 1
}
