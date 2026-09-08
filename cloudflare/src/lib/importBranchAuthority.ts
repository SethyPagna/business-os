import type { BindParams, D1Compat } from './db'
import { branchRoleFromName, type BranchRole } from './branchRoles'

export type CanonicalImportBranchRow = {
  id: number
  name: string
  is_default?: number | null
  is_active?: number | null
}

export type CanonicalImportBranchIndex = {
  byRole: Map<Exclude<BranchRole, 'other'>, CanonicalImportBranchRow[]>
  uniqueDefault: CanonicalImportBranchRow | null
}

export function indexCanonicalImportBranches(rows: CanonicalImportBranchRow[]): CanonicalImportBranchIndex {
  const byRole = new Map<Exclude<BranchRole, 'other'>, CanonicalImportBranchRow[]>([['shop', []], ['warehouse', []]])
  const defaults: CanonicalImportBranchRow[] = []
  for (const row of rows) {
    if (Number(row.is_active ?? 1) !== 1) continue
    const role = branchRoleFromName(row.name)
    if (role === 'other') continue
    byRole.get(role)!.push(row)
    if (Number(row.is_default ?? 0) === 1) defaults.push(row)
  }
  const defaultCandidate = defaults.length === 1 ? defaults[0] : null
  const defaultRole = defaultCandidate ? branchRoleFromName(defaultCandidate.name) : 'other'
  const uniqueDefault = defaultCandidate && defaultRole !== 'other' && byRole.get(defaultRole)!.length === 1
    ? defaultCandidate
    : null
  return { byRole, uniqueDefault }
}

export function resolveCanonicalImportBranch(index: CanonicalImportBranchIndex, requestedName: unknown): CanonicalImportBranchRow | null {
  const name = String(requestedName ?? '').trim()
  if (!name) return index.uniqueDefault
  const role = branchRoleFromName(name)
  if (role === 'other') return null
  const matches = index.byRole.get(role) || []
  return matches.length === 1 ? matches[0] : null
}

export async function validateCanonicalImportBranchIds(db: D1Compat, branchIds: number[]): Promise<string | null> {
  const requested = [...new Set(branchIds.map(Number))]
  if (!requested.length) return null
  if (requested.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return 'Import has no valid canonical branch identity.'
  }
  const rows = await db.prepare(`SELECT id, name, is_default, is_active FROM branches`).all<CanonicalImportBranchRow>()
  const index = indexCanonicalImportBranches(rows)
  for (const id of requested) {
    const row = rows.find((candidate) => Number(candidate.id) === id)
    const role = row ? branchRoleFromName(row.name) : 'other'
    if (!row || Number(row.is_active ?? 0) !== 1 || role === 'other' || index.byRole.get(role)!.length !== 1) {
      return `Branch ${id} is missing, inactive, non-canonical, or ambiguous.`
    }
  }
  return null
}

function branchAuthorityStatement(branchIds: number[]): { sql: string; params: Record<string, unknown> } {
  return {
    // abs(MIN_INT) is a deliberate SQLite error. D1Database.batch rolls the
    // whole batch back if the selected canonical identity changed after the
    // preview/pre-read. The CASE does not evaluate it for a valid identity.
    sql: `SELECT CASE WHEN NOT EXISTS (
            SELECT 1
            FROM json_each(@branch_ids_json) expected
            LEFT JOIN branches selected_branch
              ON selected_branch.id = CAST(expected.value AS INTEGER)
            WHERE selected_branch.id IS NULL
               OR COALESCE(selected_branch.is_active, 0) != 1
               OR lower(trim(COALESCE(selected_branch.name, ''))) NOT IN ('shop', 'warehouse')
               OR (SELECT COUNT(*)
                   FROM branches canonical_peer
                   WHERE canonical_peer.is_active = 1
                     AND lower(trim(canonical_peer.name)) = lower(trim(selected_branch.name))) != 1
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
  guarded.prepare = ((sql: string) => {
    const prepared = db.prepare(sql)
    return {
      get: prepared.get.bind(prepared),
      all: prepared.all.bind(prepared),
      run: async (params?: BindParams) => {
        const results = await db.batch([guard, { sql, params }])
        return results[1]
      },
    }
  }) as unknown as D1Compat['prepare']
  return guarded
}
