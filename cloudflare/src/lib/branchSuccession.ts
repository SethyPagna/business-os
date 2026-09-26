// Where a stock write actually lands, in one place.
//
// Every stock writer (sales, returns, sale edits and status changes, imports,
// adjustments, receipts) resolves the branch it was asked to write through
// resolveStockBranch() below, and nowhere else. The rule:
//
//   active branch                      -> written as asked
//   inactive, with an active successor -> ADDITIVE writes are redirected to
//                                         the successor and the redirect is
//                                         recorded (branch_redirects), so the
//                                         record keeps the branch it was
//                                         addressed to; REPLACING writes
//                                         ("set this branch to N") are refused,
//                                         because the successor's quantity is
//                                         not the retired branch's quantity
//   inactive, no successor             -> refused
//   unknown id                         -> passed through untouched, so each
//                                         writer keeps its own not-found answer
//
// The successor is DATA (`branches.successor_branch_id`), never an id written
// in code. That column, and the explicit `branches.role`, arrive with
// migration 0198 (cloudflare/migrations/0198_branch_successor_role.sql).
// Until it is applied the columns do not exist, so this file never names them
// in SQL: the directory is read with `SELECT *`, fresh on every call, and a row
// simply has no successor. Nothing is cached per isolate, so the moment the
// held migration lands every request sees it -- a stale "column absent" answer
// cannot keep a retired branch writable.
//
// While both branches are active nothing here changes a write: every branch
// resolves to itself and no redirect row is ever produced.
import type { D1Compat } from './db'
import { branchRole, type BranchRole } from './branchRoles'

export type BranchDirectoryRow = {
  id: number
  name: string | null
  is_active: number | null
  is_default: number | null
  /** Explicit role once the held schema is applied; absent/null before. */
  role: string | null
  /** The branch a retired branch's writes move to; absent/null before. */
  successor_branch_id: number | null
}

export type BranchDirectory = {
  readonly rows: readonly BranchDirectoryRow[]
  readonly byId: ReadonlyMap<number, BranchDirectoryRow>
  /** True when the held successor/role columns exist on `branches`. */
  readonly hasSuccessionSchema: boolean
}

// 'additive'    -- adds/subtracts units on a record that may have been made
//                  before the branch was retired (a queued sale, a return, a
//                  sale edit or hold release, an import add): follows the
//                  successor, and the redirect is recorded.
// 'replacing'   -- states an absolute figure ("set to N", a count target):
//                  refused at a retired branch.
// 'interactive' -- an online operator write aimed from a live branch picker
//                  (adjust, receive, move, stock-in, tagged-lot actions): a
//                  retired branch there is a stale screen, so it is refused
//                  and the message names where the stock went.
export type StockWriteKind = 'additive' | 'replacing' | 'interactive'

export type StockBranchResolution = {
  /** Where the stock actually moves. */
  readonly branchId: number
  readonly branch: BranchDirectoryRow | null
  /** The retired branch this write was addressed to, when it was redirected. */
  readonly originBranchId: number | null
  readonly origin: BranchDirectoryRow | null
}

export const BRANCH_INACTIVE_CODE = 'branch_inactive'
export const BRANCH_RETIRED_SET_CODE = 'branch_retired_set_refused'
export const BRANCH_INACTIVE_ERROR = 'This branch is closed. Refresh the app and choose an open branch.'

export class InactiveBranchError extends Error {
  readonly status = 409
  constructor(readonly code: string, message: string, readonly branchId: number) {
    super(message)
    this.name = 'InactiveBranchError'
  }
}

export function isInactiveBranchError(error: unknown): error is InactiveBranchError {
  return error instanceof InactiveBranchError
    || (!!error && typeof error === 'object' && (error as { name?: unknown }).name === 'InactiveBranchError')
}

/** The client-facing body for a refused write, or null for any other error. */
export function inactiveBranchErrorBody(error: unknown): { error: string; code: string; branch_id: number } | null {
  if (!isInactiveBranchError(error)) return null
  return { error: error.message, code: error.code, branch_id: error.branchId }
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function flag(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  if (value === true) return 1
  if (value === false) return 0
  return Number(value) === 0 ? 0 : 1
}

export function buildBranchDirectory(rawRows: readonly Record<string, unknown>[]): BranchDirectory {
  const list = Array.isArray(rawRows) ? rawRows : []
  const hasSuccessionSchema = list.some((row) => Object.prototype.hasOwnProperty.call(row, 'successor_branch_id'))
  const rows: BranchDirectoryRow[] = list
    .map((row) => ({
      id: Number(row.id),
      name: row.name == null ? null : String(row.name),
      // A missing is_active column/value reads as active, matching the
      // column's own DEFAULT 1 and every existing `COALESCE(is_active,1)`.
      is_active: flag(row.is_active, 1),
      is_default: flag(row.is_default, 0),
      role: row.role == null ? null : String(row.role),
      successor_branch_id: numberOrNull(row.successor_branch_id),
    }))
    .filter((row) => Number.isSafeInteger(row.id) && row.id > 0)
  return { rows, byId: new Map(rows.map((row) => [row.id, row])), hasSuccessionSchema }
}

type DirectoryReader = Pick<D1Compat, 'prepare'>

/** Fresh on every call -- see the header for why this is never cached. */
export async function readBranchDirectory(db: DirectoryReader): Promise<BranchDirectory> {
  const rows = await db.prepare('SELECT * FROM branches ORDER BY id ASC').all<Record<string, unknown>>()
  return buildBranchDirectory(rows)
}

export function isBranchRowActive(row: BranchDirectoryRow | null | undefined): boolean {
  return !!row && row.is_active !== 0
}

// A successor chain longer than this is a data error, not a design.
const MAX_SUCCESSOR_HOPS = 8

/** The active branch an inactive one's writes move to, or null. Cycle-safe. */
export function activeSuccessorOf(directory: BranchDirectory, branchId: number): BranchDirectoryRow | null {
  const seen = new Set<number>([branchId])
  let current = directory.byId.get(branchId) || null
  for (let hop = 0; current && hop < MAX_SUCCESSOR_HOPS; hop += 1) {
    const nextId = current.successor_branch_id
    if (nextId == null || seen.has(nextId)) return null
    seen.add(nextId)
    const next = directory.byId.get(nextId) || null
    if (!next) return null
    if (isBranchRowActive(next)) return next
    current = next
  }
  return null
}

function displayName(row: BranchDirectoryRow | null, fallbackId: number): string {
  const name = String(row?.name ?? '').trim()
  return name || `Branch ${fallbackId}`
}

/**
 * THE redirect. `kind` says whether the write adds/subtracts units
 * ('additive': a sale, a return, a receipt, a cancellation restock, an
 * import add) or states an absolute figure ('replacing': "set this branch to
 * N", a reconcile/count target). Only additive writes may follow a successor.
 */
export function resolveStockBranch(
  directory: BranchDirectory,
  requestedBranchId: unknown,
  kind: StockWriteKind = 'additive',
): StockBranchResolution {
  const id = Number(requestedBranchId)
  const requested = Number.isSafeInteger(id) && id > 0 ? directory.byId.get(id) || null : null
  // Unknown or malformed: not this helper's call. The writer's own validation
  // answers exactly as it did before this helper existed.
  if (!requested) return { branchId: id, branch: null, originBranchId: null, origin: null }
  if (isBranchRowActive(requested)) return { branchId: id, branch: requested, originBranchId: null, origin: null }
  const successor = activeSuccessorOf(directory, id)
  if (!successor) throw new InactiveBranchError(BRANCH_INACTIVE_CODE, BRANCH_INACTIVE_ERROR, id)
  if (kind === 'replacing') {
    throw new InactiveBranchError(
      BRANCH_RETIRED_SET_CODE,
      `${displayName(requested, id)} has moved into ${displayName(successor, successor.id)}. Set the ${displayName(successor, successor.id)} quantity instead.`,
      id,
    )
  }
  if (kind === 'interactive') {
    throw new InactiveBranchError(
      BRANCH_INACTIVE_CODE,
      `${displayName(requested, id)} has moved into ${displayName(successor, successor.id)}. Refresh the app and choose ${displayName(successor, successor.id)}.`,
      id,
    )
  }
  return { branchId: successor.id, branch: successor, originBranchId: id, origin: requested }
}

/** resolveStockBranch for a list; one entry per distinct requested id. */
export function resolveStockBranchIds(
  directory: BranchDirectory,
  requestedBranchIds: readonly unknown[],
  kind: StockWriteKind = 'additive',
): Map<number, StockBranchResolution> {
  const out = new Map<number, StockBranchResolution>()
  for (const raw of requestedBranchIds) {
    const id = Number(raw)
    if (out.has(id)) continue
    out.set(id, resolveStockBranch(directory, raw, kind))
  }
  return out
}

/**
 * The route-level guard for writers that never redirect: reads the
 * directory fresh and returns the 409 body for the first requested branch
 * that is retired, or null when every one may be written. Blank/unknown ids
 * pass (the writer's own validation answers them).
 */
export async function inactiveStockBranchRefusal(
  db: DirectoryReader,
  requestedBranchIds: readonly unknown[],
  kind: Exclude<StockWriteKind, 'additive'> = 'interactive',
): Promise<{ error: string; code: string; branch_id: number } | null> {
  const ids = requestedBranchIds.filter((value) => value !== null && value !== undefined && value !== '')
  if (!ids.length) return null
  const directory = await readBranchDirectory(db)
  for (const raw of ids) {
    try {
      resolveStockBranch(directory, raw, kind)
    } catch (error) {
      const body = inactiveBranchErrorBody(error)
      if (body) return body
      throw error
    }
  }
  return null
}

/** The effective id for one requested id (null/blank stays null). */
export function effectiveBranchId(
  directory: BranchDirectory,
  requestedBranchId: unknown,
  kind: StockWriteKind = 'additive',
): number | null {
  if (requestedBranchId === null || requestedBranchId === undefined || requestedBranchId === '') return null
  return resolveStockBranch(directory, requestedBranchId, kind).branchId
}

/** A row's role (explicit column, else its name). */
export function directoryBranchRole(directory: BranchDirectory, branchId: unknown): BranchRole {
  return branchRole(directory.byId.get(Number(branchId)) || null)
}

/**
 * The same role rule as branchRoles.ts, as a SQL expression over a joined
 * `branches` alias -- for the in-batch guards that re-check a branch inside
 * the write itself. It names `role` only when this very request's directory
 * read saw the column, so it can never reference a column that is absent.
 */
export function branchRoleSql(directory: BranchDirectory, alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw new Error('Invalid SQL alias')
  const byName = `lower(trim(COALESCE(${alias}.name,'')))`
  if (!directory.hasSuccessionSchema) return byName
  const explicit = `lower(trim(COALESCE(${alias}.role,'')))`
  return `(CASE WHEN ${explicit} IN ('shop','warehouse') THEN ${explicit} ELSE ${byName} END)`
}

/** SQL: the joined branch row may carry a sale line (role 'shop'). */
export function sellingBranchSql(directory: BranchDirectory, alias: string): string {
  return `(${branchRoleSql(directory, alias)} = 'shop')`
}

/**
 * SQL: exactly one ACTIVE branch holds the selling role. The in-batch twin of
 * the "one active Shop" rule the sales writers already enforce, written over
 * whichever role source this request's directory saw.
 */
export function singleActiveSellingBranchSql(directory: BranchDirectory, alias = 'active_shop'): string {
  return `((SELECT COUNT(*) FROM branches ${alias} WHERE COALESCE(${alias}.is_active,1)=1 AND ${sellingBranchSql(directory, alias)}) = 1)`
}

/** The directory row for an id (null when unknown). */
export function directoryRow(directory: BranchDirectory, branchId: unknown): BranchDirectoryRow | null {
  return directory.byId.get(Number(branchId)) || null
}

/**
 * The POS bootstrap's branch list: ACTIVE rows only, default first then id,
 * projected to the fields POS consumes. The role is included only when the held
 * schema has given the row one -- the renamed Store sells by role, and the
 * product payloads POS pairs this with carry only branch names.
 */
export function posBootstrapBranches(directory: BranchDirectory): Array<{ id: number; name: string | null; is_default: number | null; is_active: number | null; role?: string }> {
  return directory.rows
    .filter((row) => isBranchRowActive(row))
    .sort((a, b) => Number(b.is_default ?? 0) - Number(a.is_default ?? 0) || a.id - b.id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      is_default: row.is_default,
      is_active: row.is_active,
      ...(row.role ? { role: row.role } : {}),
    }))
}

export type BranchRedirectRecord = {
  /** What kind of record the write produced: 'sale', 'return', 'stock_adjust', ... */
  entityType: string
  /** Its natural key (client request id, receipt number, id, import job id). */
  entityKey: string
  resolution: StockBranchResolution
  actorId?: unknown
  actorName?: unknown
  /** Free-form, e.g. the sheet slot a stock import row came from. */
  context?: string | null
}

type Statement = { sql: string; params: Record<string, unknown> }

/**
 * The provenance rows for the writes that were actually redirected; empty for
 * every write that was not. `branch_redirects` is created by the same held
 * migration that adds `successor_branch_id`, and a redirect can only happen
 * once a successor exists, so this never names a table that is absent.
 */
export function branchRedirectStatements(records: readonly BranchRedirectRecord[]): Statement[] {
  const statements: Statement[] = []
  const seen = new Set<string>()
  for (const record of records) {
    const { resolution } = record
    if (resolution.originBranchId == null) continue
    const dedupe = `${record.entityType}|${record.entityKey}|${resolution.originBranchId}|${resolution.branchId}|${record.context ?? ''}`
    if (seen.has(dedupe)) continue
    seen.add(dedupe)
    statements.push({
      sql: `INSERT INTO branch_redirects(entity_type,entity_key,origin_branch_id,origin_branch_name,target_branch_id,target_branch_name,context,created_by_id,created_by_name)
        VALUES(@entity_type,@entity_key,@origin_branch_id,@origin_branch_name,@target_branch_id,@target_branch_name,@context,@created_by_id,@created_by_name)`,
      params: {
        entity_type: record.entityType,
        entity_key: String(record.entityKey),
        origin_branch_id: resolution.originBranchId,
        origin_branch_name: resolution.origin?.name ?? null,
        target_branch_id: resolution.branchId,
        target_branch_name: resolution.branch?.name ?? null,
        context: record.context ?? null,
        created_by_id: numberOrNull(record.actorId),
        created_by_name: record.actorName == null ? null : String(record.actorName),
      },
    })
  }
  return statements
}
