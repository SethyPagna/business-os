// Explicit roles survive display-name changes; legacy rows use the name.
// Keep the frontend twin identical, verified by branchRoleParity.test.ts.
export type BranchRole = 'shop' | 'warehouse' | 'other'

export function branchRoleFromName(name: unknown): BranchRole {
  const normalized = String(name ?? '').trim().toLowerCase()
  if (normalized === 'shop') return 'shop'
  if (normalized === 'warehouse') return 'warehouse'
  return 'other'
}

// The ONE reader of a branch's operational role. A row (a `branches` read, a
// Dexie mirror row, or a product payload's branch_stock entry mapped to
// { name, role }) answers from its explicit `role`; only a row whose role is
// NULL/absent falls back to the name, exactly as before the identity backfill.
// A bare string is the legacy name-only call and stays supported, but a caller
// that holds the row must pass the row: after the Warehouse is renamed
// "LC Store" only the role still says it sells.
export function branchRole(branch: unknown): BranchRole {
  if (branch !== null && typeof branch === 'object') {
    const role = Reflect.get(branch, 'role')
    if (role != null && typeof role !== 'string') return 'other'
    return branchRoleFromName(role == null ? Reflect.get(branch, 'name') : role)
  }
  return branchRoleFromName(branch)
}

// A branch row as any layer holds it. Every field is optional because the
// rows arrive from SQL, Dexie and product payloads with different subsets.
export type BranchLike = {
  id?: unknown
  name?: unknown
  role?: unknown
  is_active?: unknown
  successor_branch_id?: unknown
}

// JS twin of SQL `COALESCE(is_active, 1) = 1`: a row that does not say is
// active (payload entries from before the field existed), a retired branch
// says 0/false.
export function branchIsActive(branch: BranchLike | null | undefined): boolean {
  if (branch === null || typeof branch !== 'object') return false
  const flag = branch.is_active
  return flag == null || flag === true || flag === 1 || flag === '1'
}

// A branch that may appear on a SALE line (POS, add-items-to-sale, a
// replacement line). Sales require the shop role: stock held at the
// Warehouse or any other/missing branch must be transferred to the canonical
// Shop first. Unknown and blank names are refused rather than guessed.
export function branchCanSell(name: unknown): boolean {
  return branchRole(name) === 'shop'
}

// Role AND active: the JS twin of the Worker's sellingBranchConditionSql.
// A retired branch keeps the role it had (Old Shop stays role "shop") but can
// never take a new sale line.
export function branchCanSellNow(branch: BranchLike | null | undefined): boolean {
  return branchIsActive(branch) && branchRole(branch) === 'shop'
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

type SuccessorRow = { id?: unknown; is_active?: unknown; successor_branch_id?: unknown }

function branchRowsById<T extends SuccessorRow>(rows: readonly T[]): Map<number, T> | null {
  const byId = new Map<number, T>()
  for (const row of rows) {
    const id = Number(row.id)
    if (!Number.isSafeInteger(id) || id <= 0 || byId.has(id)) return null
    byId.set(id, row)
  }
  return byId
}

// The chain of retired branches from `source` to the first active branch, or
// null when the chain is broken: a missing row, a cycle, more than eight hops,
// a hop that is neither active nor retired, or a final branch that is not a
// clean active end (an active row never carries a successor).
export function branchActiveSuccessorPath<T extends SuccessorRow>(rows: readonly T[], source: T): T[] | null {
  const byId = branchRowsById(rows)
  if (!byId || !byId.has(Number(source.id))) return null
  const seen = new Set<number>([Number(source.id)])
  const path: T[] = []
  let current = source
  for (let hop = 0; current && hop < 8; hop += 1) {
    const nextId = Number(current.successor_branch_id)
    if (!Number.isSafeInteger(nextId) || nextId <= 0 || seen.has(nextId)) return null
    seen.add(nextId)
    const next = byId.get(nextId)
    if (!next) return null
    path.push(next)
    if (Number(next.is_active) === 1) return next.successor_branch_id == null ? path : null
    if (Number(next.is_active) !== 0) return null
    current = next
  }
  return null
}

export type ActiveBranchSuccessor = {
  // Where a stock effect recorded against `addressedBranchId` must land.
  effectBranchId: number
  addressedBranchId: number
  // False for an active branch (the identity answer).
  viaSuccessor: boolean
}

// A recorded branch id -> the branch its stock effect lands on. An active
// branch answers itself, so while both branches are active this is the
// identity function and nothing changes. A retired branch answers its active
// successor. Anything unresolvable (unknown id, duplicate ids in the read, a
// cycle, a missing or inactive successor, an active row that names a
// successor) answers null and the caller refuses.
export function resolveActiveSuccessor(rows: readonly SuccessorRow[], branchId: unknown): ActiveBranchSuccessor | null {
  const id = Number(branchId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  const source = branchRowsById(rows)?.get(id)
  if (!source) return null
  if (Number(source.is_active) === 1) {
    return source.successor_branch_id == null
      ? { effectBranchId: id, addressedBranchId: id, viaSuccessor: false }
      : null
  }
  const path = branchActiveSuccessorPath(rows, source)
  if (!path) return null
  return { effectBranchId: Number(path[path.length - 1].id), addressedBranchId: id, viaSuccessor: true }
}

// resolveActiveSuccessor for a SALE: the landing branch must also be able to
// sell (shop role, active). Used where a stale cart line or queued payload
// still names a retired selling branch.
export function resolveSellingSuccessor<T extends SuccessorRow & BranchLike>(rows: readonly T[], branchId: unknown): ActiveBranchSuccessor | null {
  const resolved = resolveActiveSuccessor(rows, branchId)
  if (!resolved) return null
  const landing = rows.find((row) => Number(row.id) === resolved.effectBranchId)
  return landing && branchCanSellNow(landing) ? resolved : null
}
