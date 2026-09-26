// The last branch rows this tab read from GET /api/branches (or its offline
// mirror), by id -- so a surface that only has a product's branch_stock
// entry ({branch_id, branch_name}) can still ask the ROW whether it sells.
//
// Why it exists: a branch's selling role comes from its explicit `role`
// column when present and only falls back to its name (utils/branchRoles.ts).
// After the Shop/Warehouse consolidation the surviving branch is named
// "Store" with role 'shop', and product payloads carry only the name, so a
// name-only check would stop every sale. api/branchTransport.ts getBranches
// feeds this; nothing else writes it.
//
// Until the first non-empty read every answer is the name rule this lineage
// always used. After it, a known row answers by its own role and activity and
// an id the read did not include is refused. While both canonical branches
// are active and named Shop / Warehouse that is the same answer as before.
import { branchCanSell } from './branchRoles.ts'
import { isActiveBranch, type BranchActivityRow } from './activeBranches.ts'

const known = new Map<string, BranchActivityRow>()
let loaded = false

/**
 * Replace the directory with a fresh read. Callers pass either every branch
 * (GET /api/branches) or every ACTIVE branch (the POS bootstrap); either way
 * an id missing from the read is not a branch a new sale may name.
 */
export function rememberBranchRows(rows: unknown): void {
  // An empty read (a cold offline mirror) says nothing; keep what we had.
  if (!Array.isArray(rows) || rows.length === 0) return
  known.clear()
  loaded = true
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const id = (row as BranchActivityRow).id
    if (id == null || id === '') continue
    known.set(String(id), row as BranchActivityRow)
  }
}

/** Test seam: forget every read. */
export function resetBranchDirectory(): void {
  known.clear()
  loaded = false
}

export function knownBranchRow(id: unknown): BranchActivityRow | null {
  if (id == null || id === '') return null
  return known.get(String(id)) || null
}

/**
 * Whether a NEW sale line may be booked at this branch id. A known row
 * answers by its own role and activity; an id missing from a loaded read is
 * refused; before any read, the name the caller's payload carries decides
 * (null name = refused, fail-closed).
 */
export function branchIdCanSell(id: unknown, fallbackName: unknown): boolean {
  const row = knownBranchRow(id)
  if (row) return isActiveBranch(row) && branchCanSell(row)
  if (loaded) return false
  return fallbackName != null && branchCanSell(fallbackName)
}
