import type { BindParams, D1Compat } from './db'
import { branchRole, resolveActiveSuccessor, type BranchRole } from './branchRoles'
import {
  BranchRedirectRequiredError, BranchRedirectTargetInvalidError, BranchRetiredNoSuccessorError,
  branchEffectGuardPredicate, branchRedirectDetail, resolveBranchEffect,
  type BranchEffectGuard, type BranchEffectRow,
} from './branchEffect'

// Import branch authority, by IDENTITY and never by the display name.
//
// A sheet names a branch in one of four ways, and each one is answered from the
// branch rows the caller read (every row, active or retired):
//   - blank          the one active canonical default branch (unchanged);
//   - "shop" / "warehouse"
//                    the branch whose stable identity (canonical_key, else role,
//                    else name) is that word. While both branches are active this
//                    is exactly the old name test. After the branch consolidation
//                    "warehouse" is LC Store itself, and "shop" is the retired Old
//                    Shop, so it follows successor_branch_id to LC Store and the
//                    result remembers it was ADDRESSED to "Shop" (old sheets keep
//                    working; the provenance is kept, never relabelled).
//                    That redirect is never silent (owner ruling 6 Oct 2026,
//                    CUTOVER-LR): until the operator confirms where it goes
//                    (X-Branch-Redirect, kept with an import job as its
//                    policy's branch_redirect_target) the successor is only
//                    the PREVIEW (redirectPending) and no writer applies the
//                    row; with a confirmed target the stock lands on THAT
//                    branch, still addressed to "Shop";
//   - "store"        the one active branch that sells (role shop);
//   - anything else  an active branch with exactly that name (e.g. "LC Store").
// Anything ambiguous or unresolvable answers null and the caller refuses.

export type CanonicalImportBranchRow = {
  id: number
  name: string
  role?: unknown
  canonical_key?: unknown
  successor_branch_id?: number | null
  is_default?: number | null
  is_active?: number | null
}

/** The columns every import caller must read for `resolveImportBranchRequest`. */
export const IMPORT_BRANCH_COLUMNS_SQL = 'id, name, role, canonical_key, successor_branch_id, is_default, is_active'

export type CanonicalImportBranchIndex = {
  // ACTIVE branches by their operational role (role, else name).
  byRole: Map<Exclude<BranchRole, 'other'>, CanonicalImportBranchRow[]>
  uniqueDefault: CanonicalImportBranchRow | null
  // Every branch row read, retired ones included (successor lookups).
  rows: CanonicalImportBranchRow[]
}

export type ImportBranchResolution = {
  branch: CanonicalImportBranchRow
  // The label the sheet addressed ("Shop") when the stock was routed to a
  // successor branch; null when the sheet reached the branch directly.
  addressedName: string | null
  // Present only when the sheet addressed a RETIRED branch, so never while
  // every branch is active: the retired branch's id, and whether its landing
  // is still unconfirmed. Pending means `branch` is the successor shown in
  // the preview; every writer refuses such a row (branch_redirect_required).
  addressedBranchId?: number
  redirectPending?: boolean
}

export type ImportBranchRequestOptions = {
  // The active branch the operator confirmed for every row addressed to a
  // retired branch (X-Branch-Redirect). Never read for an active branch.
  redirectTarget?: number | null
}

/** The import-job policy key holding the landing branch the operator confirmed (set only by the server). */
export const IMPORT_BRANCH_REDIRECT_POLICY_KEY = 'branch_redirect_target'

/** The confirmed landing branch an import job's policy carries, or null (anything but a positive integer). */
export function importBranchRedirectTarget(policy: string | Record<string, unknown> | null | undefined): number | null {
  let parsed: unknown = policy
  if (typeof policy === 'string') {
    try { parsed = JSON.parse(policy) } catch { parsed = null }
  }
  const raw = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)[IMPORT_BRANCH_REDIRECT_POLICY_KEY] : null
  const id = typeof raw === 'number' ? raw : NaN
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

const isActiveRow = (row: CanonicalImportBranchRow) => Number(row.is_active ?? 1) === 1

function lowered(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// The stable identity word of a row: canonical_key (immutable), else role,
// else the legacy name. Never the display name once the identity is stored.
function identityKey(row: CanonicalImportBranchRow): string {
  if (row.canonical_key != null) return lowered(row.canonical_key)
  if (row.role != null) return lowered(row.role)
  return lowered(row.name)
}

export function indexCanonicalImportBranches(rows: CanonicalImportBranchRow[]): CanonicalImportBranchIndex {
  const byRole = new Map<Exclude<BranchRole, 'other'>, CanonicalImportBranchRow[]>([['shop', []], ['warehouse', []]])
  const defaults: CanonicalImportBranchRow[] = []
  for (const row of rows) {
    if (!isActiveRow(row)) continue
    const role = branchRole(row)
    if (role === 'other') continue
    byRole.get(role)!.push(row)
    if (Number(row.is_default ?? 0) === 1) defaults.push(row)
  }
  const defaultCandidate = defaults.length === 1 ? defaults[0] : null
  const defaultRole = defaultCandidate ? branchRole(defaultCandidate) : 'other'
  const uniqueDefault = defaultCandidate && defaultRole !== 'other' && byRole.get(defaultRole)!.length === 1
    ? defaultCandidate
    : null
  return { byRole, uniqueDefault, rows }
}

const ADDRESSED_LABEL: Record<string, string> = { shop: 'Shop', warehouse: 'Warehouse' }

export function resolveImportBranchRequest(index: CanonicalImportBranchIndex, requestedName: unknown, options: ImportBranchRequestOptions | null = {}): ImportBranchResolution | null {
  const name = String(requestedName ?? '').trim()
  if (!name) return index.uniqueDefault ? { branch: index.uniqueDefault, addressedName: null } : null
  const word = name.toLowerCase()
  if (word === 'store') {
    const sellers = index.byRole.get('shop') || []
    return sellers.length === 1 ? { branch: sellers[0], addressedName: null } : null
  }
  if (word === 'shop' || word === 'warehouse') {
    // Once the directory carries stored identities (canonical_key, 0229), a row WITHOUT one is a legacy leftover and is
    // never matched by its display name: a stray retired row that happens to be called "Shop" must not make the word
    // ambiguous. Before any identity is stored (today's production) every row still matches by its legacy name.
    const identified = index.rows.some((row) => row.canonical_key != null)
    const keyed = index.rows.filter((row) => identityKey(row) === word && (!identified || row.canonical_key != null))
    const active = keyed.filter(isActiveRow)
    if (active.length > 1) return null
    if (active.length === 1) return branchRole(active[0]) === 'other' ? null : { branch: active[0], addressedName: null }
    // Nothing active carries this identity: a retired branch routes to its
    // active successor, provided every retired candidate agrees on ONE target.
    const targets = new Map<number, CanonicalImportBranchRow>()
    for (const row of keyed) {
      const effect = resolveActiveSuccessor(index.rows, row.id)
      if (!effect || !effect.viaSuccessor) return null
      const target = index.rows.find((candidate) => Number(candidate.id) === effect.effectBranchId)
      if (target) targets.set(Number(target.id), target)
    }
    if (targets.size !== 1) return null
    const [successor] = [...targets.values()]
    if (branchRole(successor) === 'other') return null
    // The retired branch the sheet addressed (the lowest keyed id; the rule above proved every keyed row is retired
    // and agrees on one active successor). Without a confirmed target the successor is the preview only.
    const addressedBranchId = Math.min(...keyed.map((row) => Number(row.id)))
    const target = options?.redirectTarget ?? null
    if (target == null) return { branch: successor, addressedName: ADDRESSED_LABEL[word], addressedBranchId, redirectPending: true }
    // The confirmed target: an active branch with no successor of its own (resolveBranchEffect throws the coded
    // refusal otherwise) that is also a canonical stock branch.
    const effect = resolveBranchEffect(index.rows as BranchEffectRow[], addressedBranchId, { target })
    const landing = index.rows.find((row) => Number(row.id) === effect.effectBranchId)
    if (!landing || branchRole(landing) === 'other') {
      const detail = branchRedirectDetail(index.rows as BranchEffectRow[], addressedBranchId, { requestedTargetId: target })
      throw detail ? new BranchRedirectTargetInvalidError(detail) : new BranchRetiredNoSuccessorError()
    }
    return { branch: landing, addressedName: ADDRESSED_LABEL[word], addressedBranchId }
  }
  const named = index.rows.filter((row) => isActiveRow(row) && lowered(row.name) === word)
  return named.length === 1 && branchRole(named[0]) !== 'other' ? { branch: named[0], addressedName: null } : null
}

export function resolveCanonicalImportBranch(index: CanonicalImportBranchIndex, requestedName: unknown): CanonicalImportBranchRow | null {
  return resolveImportBranchRequest(index, requestedName)?.branch ?? null
}

/**
 * The refusal for rows addressed to a retired branch whose landing is not confirmed: branch_redirect_required with
 * the successor and every valid target (branch_retired_no_successor when no active branch could take them).
 */
export function importBranchRedirectRequired(rows: readonly BranchEffectRow[], addressedBranchId: number, options: { sells?: boolean } = {}): BranchRetiredNoSuccessorError {
  const detail = branchRedirectDetail(rows, addressedBranchId, { sells: options.sells })
  return detail ? new BranchRedirectRequiredError(detail) : new BranchRetiredNoSuccessorError()
}

/** One in-batch guard per redirected pair (addressed retired branch -> confirmed landing), de-duplicated. */
export function importBranchRedirectGuards(pairs: Array<{ addressed: unknown; effect: unknown; sells?: boolean }>): BranchEffectGuard[] {
  const guards = new Map<string, BranchEffectGuard>()
  for (const pair of pairs) {
    const addressed = Number(pair.addressed)
    const effect = Number(pair.effect)
    if (!Number.isSafeInteger(addressed) || addressed <= 0 || !Number.isSafeInteger(effect) || effect <= 0) continue
    const key = `${addressed}>${effect}`
    const previous = guards.get(key)
    guards.set(key, { addressed, effect, sells: previous?.sells === 1 || pair.sells ? 1 : 0 })
  }
  return [...guards.values()]
}

export async function validateCanonicalImportBranchIds(db: D1Compat, branchIds: number[]): Promise<string | null> {
  const requested = [...new Set(branchIds.map(Number))]
  if (!requested.length) return null
  if (requested.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return 'Import has no valid canonical branch identity.'
  }
  const rows = await db.prepare(`SELECT ${IMPORT_BRANCH_COLUMNS_SQL} FROM branches`).all<CanonicalImportBranchRow>()
  const index = indexCanonicalImportBranches(rows)
  for (const id of requested) {
    const row = rows.find((candidate) => Number(candidate.id) === id)
    const role = row ? branchRole(row) : 'other'
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
               OR lower(trim(COALESCE(selected_branch.role, selected_branch.name, ''))) NOT IN ('shop', 'warehouse')
               OR (SELECT COUNT(*)
                   FROM branches canonical_peer
                   WHERE canonical_peer.is_active = 1
                     AND lower(trim(COALESCE(canonical_peer.role, canonical_peer.name))) = lower(trim(COALESCE(selected_branch.role, selected_branch.name)))) != 1
          ) THEN 1 ELSE abs(-9223372036854775808) END AS canonical_branch_guard`,
    params: { branch_ids_json: JSON.stringify([...new Set(branchIds.map(Number))]) },
  }
}

// The in-batch re-proof of every confirmed redirect (CUTOVER-LR): each landing branch is still active with no
// successor of its own, and each addressed branch is still retired. Same deliberate abs(MIN_INT) failure as above.
function branchRedirectStatement(redirects: readonly BranchEffectGuard[]): { sql: string; params: Record<string, unknown> } {
  return {
    sql: `SELECT CASE WHEN (${branchEffectGuardPredicate('@branch_redirect_guards_json')}) THEN 1 ELSE abs(-9223372036854775808) END AS branch_redirect_guard`,
    params: { branch_redirect_guards_json: JSON.stringify(redirects) },
  }
}

/**
 * Wrap a D1 adapter so every run/batch mutation carries the branch authority
 * check in the same atomic D1Database.batch. Reads retain the original API.
 * `redirects` (rows addressed to a retired branch whose landing the operator
 * confirmed) adds their re-proof to the same batch; with none -- always, while
 * every branch is active -- the batch is exactly what it was.
 */
export function withCanonicalImportBranchWriteGuard(db: D1Compat, branchIds: number[], redirects: readonly BranchEffectGuard[] = []): D1Compat {
  const guards = redirects.length ? [branchAuthorityStatement(branchIds), branchRedirectStatement(redirects)] : [branchAuthorityStatement(branchIds)]
  const guarded = Object.create(db) as D1Compat
  guarded.batch = (async (statements: Array<{ sql: string; params?: Record<string, unknown> }>) => {
    const results = await db.batch([...guards, ...statements])
    return results.slice(guards.length)
  }) as D1Compat['batch']
  guarded.batchOnce = (async (statements: Array<{ sql: string; params?: Record<string, unknown> }>) => {
    const results = await db.batchOnce([...guards, ...statements])
    return results.slice(guards.length)
  }) as D1Compat['batchOnce']
  guarded.prepare = ((sql: string) => {
    const prepared = db.prepare(sql)
    return {
      get: prepared.get.bind(prepared),
      all: prepared.all.bind(prepared),
      run: async (params?: BindParams) => {
        const results = await db.batch([...guards, { sql, params }])
        const own = results[guards.length]
        return {
          changes: own.meta?.changes ?? 0,
          lastInsertRowid: Number(own.meta?.last_row_id ?? 0),
        }
      },
    }
  }) as D1Compat['prepare']
  return guarded
}
