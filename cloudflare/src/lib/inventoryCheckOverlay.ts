import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getDb } from './db'
import { getInventoryCheckAccess, InventoryCheckQueryError } from './inventoryCheckAccess'
import { canSeeStaffIdentity, waitingLineSql } from './inventoryCheckSessions'
import { getPlanLimits } from './planTier'

// The Inventory overlay (INV-A S4a, behind `ic_wired`): the only reads Inventory makes besides the shared Products list. They are scoped to the window's ids
// (at most inventoryOverlayMaxRows), run in ONE batch, and read nothing about stock itself -- no ledger, no verification, no sales:
//
//   1. the users' count entries: the latest done/issue observation per product at the branch, through index 0285 (product_id, branch_id, updated_at)
//   2. the products with a count line still waiting for approval (index inventory_check_approvals_pending)
//   3. the last recorded stock change of each product, in two index steps on idx_inventory_movements_product_created_pg (product_id, created_at DESC, id DESC):
//      the newest day, then that day's newest rows by julianday -- created_at mixes 'YYYY-MM-DD HH:MM:SS' and ISO 'YYYY-MM-DDTHH:MM:SS.sssZ', and plain text order puts
//      ISO 09:00 above 14:00 of the same day. Bounded at inventoryLastChangeMaxRows rows per product and labelled "last recorded movement".
//
// Writers that leave no movement (branch cutover, merge undo, restore, reset, integrity repair) show the previous movement; test-inventory-last-change-writers-native.cjs
// checks every write shape against that allowlist.

const COUNT_ENTRIES_SQL = `SELECT i.product_id AS product_id, i.state AS state, i.counted_quantity AS counted_quantity, i.baseline_quantity AS baseline_quantity, i.reason AS reason,
    i.updated_by AS updated_by, i.updated_at AS updated_at, i.session_id AS session_id, i.revision AS revision, s.created_by AS created_by, u.username AS by_name
  FROM json_each(@ids) wanted
  JOIN inventory_check_items i ON i.product_id = wanted.value AND i.branch_id = @branchId AND i.session_id = (
    SELECT x.session_id FROM inventory_check_items x JOIN inventory_check_sessions sx ON sx.id = x.session_id
    WHERE x.product_id = wanted.value AND x.branch_id = @branchId AND x.state IN ('done', 'issue') AND sx.organization_id IS @organization AND sx.branch_id = x.branch_id
    ORDER BY x.updated_at DESC, x.session_id DESC LIMIT 1)
  JOIN inventory_check_sessions s ON s.id = i.session_id
  LEFT JOIN users u ON u.id = i.updated_by`
const PENDING_LINES_SQL = `SELECT DISTINCT i.product_id AS product_id FROM inventory_check_approvals a JOIN inventory_check_items i ON i.session_id = a.session_id
  WHERE a.organization_id IS @organization AND i.branch_id = @branchId AND i.product_id IN (SELECT value FROM json_each(@ids)) AND ${waitingLineSql('a', 'i')}`
export const LAST_CHANGE_SQL = `WITH newest AS (
    SELECT CAST(wanted.value AS INTEGER) AS product_id,
           (SELECT substr(m.created_at, 1, 10) FROM inventory_movements m WHERE m.product_id = wanted.value ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS day
    FROM json_each(@ids) wanted)
  SELECT newest.product_id AS product_id,
         (SELECT recent.created_at FROM (SELECT m.created_at AS created_at FROM inventory_movements m WHERE m.product_id = newest.product_id AND m.created_at >= newest.day
            ORDER BY m.created_at DESC, m.id DESC LIMIT @lastChangeRows) recent
          ORDER BY julianday(recent.created_at) DESC LIMIT 1) AS last_at
  FROM newest WHERE newest.day IS NOT NULL`

type CountRow = { product_id: number; state: string; counted_quantity: number | null; baseline_quantity: number | null; reason: string | null; updated_by: number | null; updated_at: string | null
  session_id: string; revision: number; created_by: number; by_name: string | null }

export type OverlayEntry = {
  product_id: number
  /** The latest recorded movement of the product (text as stored), or null when it has none. */
  last_change_at: string | null
  check?: { state: 'ok' | 'issue'; counted_quantity?: number; seen_quantity?: number; note: string | null; by?: string; at: string | null; session_id: string; revision: number }
  pending?: true
}

export function parseOverlayIds(raw: string | undefined, env: Env): number[] {
  const text = (raw ?? '').trim()
  const invalid = (): never => { throw new InventoryCheckQueryError(400, 'inventory_check_invalid_query', 'ids') }
  if (!text) return invalid()
  const ids = [...new Set(text.split(',').map((part) => part.trim()))]
  if (ids.length > getPlanLimits(env).inventoryOverlayMaxRows || ids.some((id) => !/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) return invalid()
  return ids.map(Number)
}

export async function readInventoryOverlay(env: Env, user: SessionUser, request: { branchId: number; ids: number[]; pendingAvailable: boolean }): Promise<OverlayEntry[]> {
  const access = getInventoryCheckAccess(user)
  if (!access.canView) throw new InventoryCheckQueryError(403, 'inventory_check_view_required', '')
  const { branchId, ids } = request
  if (!ids.length) return []
  const organization = user.organization_id ?? null
  const params = { ids: JSON.stringify(ids), branchId, organization }
  const withPending = request.pendingAvailable && access.fields.stock
  const results = await getDb(env).batch([
    { sql: COUNT_ENTRIES_SQL, params },
    ...(withPending ? [{ sql: PENDING_LINES_SQL, params }] : []),
    { sql: LAST_CHANGE_SQL, params: { ids: params.ids, lastChangeRows: getPlanLimits(env).inventoryLastChangeMaxRows } },
  ])
  const rows = (results[0]?.results ?? []) as CountRow[]
  const pending = new Set(withPending ? ((results[1]?.results ?? []) as Array<{ product_id: number }>).map((row) => Number(row.product_id)) : [])
  const lastRows = (results[withPending ? 2 : 1]?.results ?? []) as Array<{ product_id: number; last_at: string | null }>
  const lastChange = new Map(lastRows.map((row) => [Number(row.product_id), row.last_at ?? null]))
  const counts = new Map(rows.map((row) => [Number(row.product_id), row]))
  const viewer = { ...user, tokenHash: '' }
  return ids.map((id): OverlayEntry => {
    const row = counts.get(id)
    const entry: OverlayEntry = { product_id: id, last_change_at: lastChange.get(id) ?? null }
    if (row) {
      const byId = row.updated_by == null ? null : Number(row.updated_by)
      entry.check = { state: row.state === 'issue' ? 'issue' : 'ok', note: row.reason ?? null, at: row.updated_at ?? null, session_id: row.session_id, revision: Number(row.revision),
        // The counted figure follows the stock field or the session's creator (as the Issues list always did); the figure seen when counting is stock.
        ...(row.counted_quantity != null && (access.fields.stock || Number(row.created_by) === user.id) ? { counted_quantity: Number(row.counted_quantity) } : {}),
        ...(access.fields.stock && row.baseline_quantity != null ? { seen_quantity: Number(row.baseline_quantity) } : {}),
        ...(byId !== null && row.by_name != null && canSeeStaffIdentity(viewer, byId) ? { by: String(row.by_name) } : {}) }
    }
    if (pending.has(id)) entry.pending = true
    return entry
  })
}
