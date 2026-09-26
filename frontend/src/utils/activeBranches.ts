// The one answer to "which branches can a NEW write be addressed to".
//
// A branch the owner has retired (is_active = 0 -- after the Shop/Warehouse
// consolidation that is the old Shop, whose successor is the renamed Store)
// keeps its history: old sales, movements and reports still name it. But no
// picker offers it again, and with a single active branch every picker
// collapses to that branch and the transfer entry points disappear, because
// there is nowhere to transfer to.
//
// Inert today: both canonical branches are active, so every surface keeps
// offering exactly what it offered before.
//
// The Worker enforces the same rule (lib/branchSuccession.ts): an online
// picker write to a retired branch is refused with `branch_inactive`; a
// replayed/queued write is redirected to the successor and the retired origin
// is recorded. This file only keeps the operator from choosing it.
import { branchCanSell, branchCanTransferBetween } from './branchRoles.ts'

export type BranchActivityRow = {
  id?: number | string | null
  name?: string | null
  role?: string | null
  is_active?: boolean | number | string | null
  is_default?: boolean | number | string | null
}

/** A row is active unless it explicitly says otherwise. */
export function isActiveBranch(row: BranchActivityRow | null | undefined): boolean {
  if (!row) return false
  const flag = row.is_active
  if (flag == null || flag === '') return true
  if (typeof flag === 'boolean') return flag
  const text = String(flag).trim().toLowerCase()
  return !(text === '0' || text === 'false' || text === 'no' || text === 'off')
}

/** The branches a new write may name, in their original order. */
export function activeBranches<T extends BranchActivityRow>(rows: readonly T[] | null | undefined): T[] {
  return Array.isArray(rows) ? rows.filter((row) => isActiveBranch(row)) : []
}

/** Active branches that may take a sale line (role, then name). */
export function activeSellingBranches<T extends BranchActivityRow>(rows: readonly T[] | null | undefined): T[] {
  return activeBranches(rows).filter((row) => branchCanSell(row))
}

/** True when there is at most one branch to choose: pickers collapse. */
export function isSingleBranchMode(rows: readonly BranchActivityRow[] | null | undefined): boolean {
  return activeBranches(rows).length <= 1
}

/**
 * Whether any transfer is possible: at least one ordered pair of distinct
 * ACTIVE branches the role rule accepts. False once the consolidation has
 * left a single branch -- the transfer entry points hide on this.
 */
export function canTransferBetweenActiveBranches(rows: readonly BranchActivityRow[] | null | undefined): boolean {
  const active = activeBranches(rows)
  return active.some((from) => active.some((to) => from !== to && branchCanTransferBetween(from, to)))
}

/**
 * The branch a record addressed to `id` now lives at: the row itself while it
 * is active, else its successor chain's first active row (the Worker's
 * lib/branchSuccession.ts effectiveBranchId, read-only). Null for an unknown
 * id or a retired branch with no active successor.
 */
export function effectiveBranchRow<T extends BranchActivityRow & { successor_branch_id?: number | string | null }>(
  rows: readonly T[] | null | undefined,
  id: number | string | null | undefined,
): T | null {
  if (!Array.isArray(rows) || id == null || id === '') return null
  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const seen = new Set<string>()
  let current = byId.get(String(id)) || null
  while (current && !seen.has(String(current.id))) {
    if (isActiveBranch(current)) return current
    seen.add(String(current.id))
    const next = current.successor_branch_id
    current = next == null || next === '' ? null : byId.get(String(next)) || null
  }
  return null
}

/** The branch a collapsed picker stands for: the default, else the only one. */
export function soleActiveBranch<T extends BranchActivityRow>(rows: readonly T[] | null | undefined): T | null {
  const active = activeBranches(rows)
  if (active.length !== 1) return null
  return active[0]
}
