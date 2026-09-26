import type { BindParams, D1Compat } from './db'
import { branchRoleFromName, type BranchRole } from './branchRoles'

// Which branch an import row (or a stock sheet's branch column) addresses.
//
// A sheet names a branch by its CANONICAL identity -- 'shop' or 'warehouse'
// -- and, after the consolidation, by the survivor's own name ('Store'). The
// identity is `branches.canonical_key` when the held successor/role schema
// has added it (it survives a rename), else the branch name, exactly the rule
// this file always used. So after the consolidation:
//   'warehouse' -> the renamed survivor (same row, canonical_key warehouse)
//   'shop'      -> the retired Shop, whose writes follow its successor; the
//                  result carries `origin` so the import records it
//   'store'     -> the row named Store; before any Store exists it means the
//                  Shop, as the sheets' old 'store' alias always did
// Old sheets are never refused for using the old column names. While both
// branches are active every answer is the one this file gave before.
export type CanonicalImportBranchRow = {
  id: number
  name: string
  is_default?: number | null
  is_active?: number | null
  /** Present once the held schema has run (read through SELECT *). */
  canonical_key?: string | null
  successor_branch_id?: number | null
}

export type CanonicalImportBranchIndex = {
  /** ACTIVE rows by canonical identity. */
  byRole: Map<Exclude<BranchRole, 'other'>, CanonicalImportBranchRow[]>
  uniqueDefault: CanonicalImportBranchRow | null
  /** Every row, active or not -- successors and retired identities. */
  all: CanonicalImportBranchRow[]
}

export type ImportBranchResolution = {
  /** Where the row's stock lands. */
  branch: CanonicalImportBranchRow
  /** The retired branch the sheet addressed, when it was redirected. */
  origin: CanonicalImportBranchRow | null
}

const isActive = (row: CanonicalImportBranchRow | null | undefined) => !!row && Number(row.is_active ?? 1) === 1

/** The identity a row was created as: canonical_key, else its name. */
export function importBranchIdentity(row: Pick<CanonicalImportBranchRow, 'name' | 'canonical_key'>): BranchRole {
  const explicit = branchRoleFromName(row.canonical_key)
  return explicit === 'other' ? branchRoleFromName(row.name) : explicit
}

export function indexCanonicalImportBranches(rows: CanonicalImportBranchRow[]): CanonicalImportBranchIndex {
  const byRole = new Map<Exclude<BranchRole, 'other'>, CanonicalImportBranchRow[]>([['shop', []], ['warehouse', []]])
  const defaults: CanonicalImportBranchRow[] = []
  for (const row of rows) {
    if (!isActive(row)) continue
    const role = importBranchIdentity(row)
    if (role === 'other') continue
    byRole.get(role)!.push(row)
    if (Number(row.is_default ?? 0) === 1) defaults.push(row)
  }
  const defaultCandidate = defaults.length === 1 ? defaults[0] : null
  const defaultRole = defaultCandidate ? importBranchIdentity(defaultCandidate) : 'other'
  const uniqueDefault = defaultCandidate && defaultRole !== 'other' && byRole.get(defaultRole)!.length === 1
    ? defaultCandidate
    : null
  return { byRole, uniqueDefault, all: [...rows] }
}

function activeSuccessor(index: CanonicalImportBranchIndex, row: CanonicalImportBranchRow): CanonicalImportBranchRow | null {
  const seen = new Set<number>([Number(row.id)])
  let current: CanonicalImportBranchRow | null = row
  for (let hop = 0; current && hop < 8; hop += 1) {
    const nextId: number = Number(current.successor_branch_id)
    if (!Number.isSafeInteger(nextId) || nextId <= 0 || seen.has(nextId)) return null
    seen.add(nextId)
    const next: CanonicalImportBranchRow | null = index.all.find((candidate): boolean => Number(candidate.id) === nextId) || null
    if (isActive(next)) return next
    current = next
  }
  return null
}

function resolveByIdentity(index: CanonicalImportBranchIndex, role: Exclude<BranchRole, 'other'>): ImportBranchResolution | null {
  const active = index.byRole.get(role) || []
  if (active.length === 1) return { branch: active[0], origin: null }
  if (active.length > 1) return null
  // No active branch carries this identity: a retired one with an active
  // successor still takes the sheet's rows, which land at the successor.
  const retired = index.all.filter((row) => !isActive(row) && importBranchIdentity(row) === role)
  if (retired.length !== 1) return null
  const successor = activeSuccessor(index, retired[0])
  return successor ? { branch: successor, origin: retired[0] } : null
}

export function resolveCanonicalImportBranchWithOrigin(index: CanonicalImportBranchIndex, requestedName: unknown): ImportBranchResolution | null {
  const name = String(requestedName ?? '').trim()
  if (!name) return index.uniqueDefault ? { branch: index.uniqueDefault, origin: null } : null
  const role = branchRoleFromName(name)
  if (role !== 'other') return resolveByIdentity(index, role)
  // A non-canonical name addresses a branch only when it is exactly one
  // active row's own name AND that row is a canonical identity (the renamed
  // survivor): an arbitrary branch never becomes an import target.
  const key = name.toLowerCase()
  const named = index.all.filter((row) => isActive(row) && String(row.name ?? '').trim().toLowerCase() === key)
  if (named.length === 1) {
    const identity = importBranchIdentity(named[0])
    return identity !== 'other' && (index.byRole.get(identity) || []).length === 1 ? { branch: named[0], origin: null } : null
  }
  if (named.length > 1) return null
  // 'store' before a Store exists: the sheets have always read it as Shop.
  if (key === 'store') return resolveByIdentity(index, 'shop')
  return null
}

export function resolveCanonicalImportBranch(index: CanonicalImportBranchIndex, requestedName: unknown): CanonicalImportBranchRow | null {
  return resolveCanonicalImportBranchWithOrigin(index, requestedName)?.branch ?? null
}

export async function validateCanonicalImportBranchIds(db: D1Compat, branchIds: number[]): Promise<string | null> {
  const requested = [...new Set(branchIds.map(Number))]
  if (!requested.length) return null
  if (requested.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return 'Import has no valid canonical branch identity.'
  }
  // SELECT *: canonical_key (held schema) is read when present, never named.
  const rows = await db.prepare(`SELECT * FROM branches`).all<CanonicalImportBranchRow>()
  const index = indexCanonicalImportBranches(rows)
  for (const id of requested) {
    const row = rows.find((candidate) => Number(candidate.id) === id)
    const role = row ? importBranchIdentity(row) : 'other'
    if (!row || Number(row.is_active ?? 0) !== 1 || role === 'other' || index.byRole.get(role)!.length !== 1) {
      return `Branch ${id} is missing, inactive, non-canonical, or ambiguous.`
    }
  }
  return null
}

/**
 * Provenance rows for import rows whose branch was redirected from a retired
 * one (the classifier sets data.branch_origin_id / branch_origin_name). Only
 * ever non-empty once the held schema -- and with it branch_redirects --
 * exists, because a redirect needs a successor.
 */
export function importBranchRedirectStatements(
  jobId: unknown,
  jobType: string,
  rows: Array<{ rowNumber: number; data: unknown }>,
  actor: { id?: unknown; name?: unknown } = {},
): Array<{ sql: string; params: Record<string, unknown> }> {
  const out: Array<{ sql: string; params: Record<string, unknown> }> = []
  for (const row of rows) {
    const data = (row.data || {}) as Record<string, unknown>
    const originId = Number(data.branch_origin_id)
    const targetId = Number(data.branch_id)
    if (!Number.isSafeInteger(originId) || originId <= 0 || !Number.isSafeInteger(targetId) || targetId <= 0 || originId === targetId) continue
    out.push({
      sql: `INSERT INTO branch_redirects(entity_type,entity_key,origin_branch_id,origin_branch_name,target_branch_id,target_branch_name,context,created_by_id,created_by_name)
            SELECT 'import_row',@key,@origin,@originName,@target,@targetName,@context,@actorId,@actorName
            WHERE NOT EXISTS (SELECT 1 FROM branch_redirects WHERE entity_type='import_row' AND entity_key=@key)`,
      params: {
        key: `${String(jobId)}:${row.rowNumber}`,
        origin: originId,
        originName: data.branch_origin_name == null ? null : String(data.branch_origin_name),
        target: targetId,
        targetName: data.branch_name == null ? null : String(data.branch_name),
        context: jobType,
        actorId: Number.isSafeInteger(Number(actor.id)) ? Number(actor.id) : null,
        actorName: actor.name == null ? null : String(actor.name),
      },
    })
  }
  return out
}

/**
 * The same provenance for the unified stock sheet, whose rows carry one
 * branchRefs entry per effective branch (stockActionImport.ts). Only rows
 * that applied are recorded; idempotent per (job, row, branch).
 */
export function stockSheetRedirectStatements(
  jobId: unknown,
  rows: Array<{ rowNumber: number; action: string; data: unknown }>,
): Array<{ sql: string; params: Record<string, unknown> }> {
  const out: Array<{ sql: string; params: Record<string, unknown> }> = []
  for (const row of rows) {
    if (row.action === 'error' || row.action === 'skip') continue
    const refs = ((row.data || {}) as { branchRefs?: Array<Record<string, unknown>> }).branchRefs || []
    for (const ref of refs) {
      const originId = Number(ref.originBranchId)
      const targetId = Number(ref.branchId)
      if (!Number.isSafeInteger(originId) || originId <= 0 || !Number.isSafeInteger(targetId) || targetId <= 0 || originId === targetId) continue
      const key = `${String(jobId)}:${row.rowNumber}:${targetId}`
      out.push({
        sql: `INSERT INTO branch_redirects(entity_type,entity_key,origin_branch_id,origin_branch_name,target_branch_id,target_branch_name,context)
              SELECT 'stock_sheet_row',@key,@origin,@originName,@target,@targetName,@context
              WHERE NOT EXISTS (SELECT 1 FROM branch_redirects WHERE entity_type='stock_sheet_row' AND entity_key=@key)`,
        params: {
          key, origin: originId, originName: ref.originBranchName == null ? null : String(ref.originBranchName),
          target: targetId, targetName: ref.branchName == null ? null : String(ref.branchName),
          context: Array.isArray(ref.slots) ? ref.slots.join('+') : String(ref.slot ?? ''),
        },
      })
    }
  }
  return out
}

function branchAuthorityStatement(branchIds: number[]): { sql: string; params: Record<string, unknown> } {
  return {
    // abs(MIN_INT) is a deliberate SQLite error. D1Database.batch rolls the
    // whole batch back if the selected canonical identity changed after the
    // preview/pre-read. The CASE does not evaluate it for a valid identity.
    // Written without the held columns so it holds on either schema: the
    // branch is active AND carries a canonical name (Shop, Warehouse, or the
    // consolidated survivor's name Store) that no other active branch shares.
    // A renamed arbitrary branch is still refused, even when it is the only
    // active one.
    sql: `SELECT CASE WHEN NOT EXISTS (
            SELECT 1
            FROM json_each(@branch_ids_json) expected
            LEFT JOIN branches selected_branch
              ON selected_branch.id = CAST(expected.value AS INTEGER)
            WHERE selected_branch.id IS NULL
               OR COALESCE(selected_branch.is_active, 0) != 1
               OR NOT (
                    lower(trim(COALESCE(selected_branch.name, ''))) IN ('shop', 'warehouse', 'store')
                    AND (SELECT COUNT(*)
                         FROM branches canonical_peer
                         WHERE canonical_peer.is_active = 1
                           AND lower(trim(canonical_peer.name)) = lower(trim(selected_branch.name))) = 1
                  )
          ) THEN 1 ELSE abs(-9223372036854775808) END AS canonical_branch_guard`,
    params: { branch_ids_json: JSON.stringify([...new Set(branchIds.map(Number))]) },
  }
}

/**
 * Wrap a D1 adapter so every run/batch mutation carries the branch authority
 * check in the same atomic D1Database.batch. Reads retain the original API.
 */
export function withCanonicalImportBranchWriteGuard(db: D1Compat, branchIds: number[]): D1Compat {
  const guard = branchAuthorityStatement(branchIds)
  const guarded = Object.create(db) as D1Compat
  guarded.batch = (async (statements: Array<{ sql: string; params?: Record<string, unknown> }>) => {
    const results = await db.batch([guard, ...statements])
    return results.slice(1)
  }) as D1Compat['batch']
  guarded.batchOnce = (async (statements: Array<{ sql: string; params?: Record<string, unknown> }>) => {
    const results = await db.batchOnce([guard, ...statements])
    return results.slice(1)
  }) as D1Compat['batchOnce']
  guarded.prepare = ((sql: string) => {
    const prepared = db.prepare(sql)
    return {
      get: prepared.get.bind(prepared),
      all: prepared.all.bind(prepared),
      run: async (params?: BindParams) => {
        const results = await db.batch([guard, { sql, params }])
        return {
          changes: results[1].meta?.changes ?? 0,
          lastInsertRowid: Number(results[1].meta?.last_row_id ?? 0),
        }
      },
    }
  }) as D1Compat['prepare']
  return guarded
}
