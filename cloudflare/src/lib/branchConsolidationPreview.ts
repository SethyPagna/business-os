/**
 * U-branch: read-only preview of the held Shop -> Store consolidation
 * (ops/scripts/migration/held/0199_branch_consolidation_shop_into_store.sql).
 *
 * Every blocker here is the SAME count the file's preflight CHECKs, so
 * `ready: true` means the file will pass its preflight on the data as read.
 * scripts/test-branch-consolidation-native.cjs runs both against the same
 * fixtures and fails if they ever disagree.
 *
 * Nothing is written. It tolerates the held schema being absent (the
 * successor/role columns are read through SELECT *), and reports that as a
 * blocker of its own, because the forward file needs those columns.
 */
import type { D1Compat } from './db'

type Reader = Pick<D1Compat, 'prepare'>

export const CONSOLIDATION_SOURCE_BRANCH_ID = 2
export const CONSOLIDATION_TARGET_BRANCH_ID = 1

export type ConsolidationBlockers = {
  held_schema_missing: number
  already_consolidated: number
  branches_not_as_expected: number
  unreleased_holds: number
  open_shifts: number
  active_jobs: number
  active_rfid_sessions: number
  lots_exceed_branch_stock: number
  restore_in_progress: number
}

export type ConsolidationPreview = {
  ready: boolean
  blockers: ConsolidationBlockers
  move: {
    products: number
    quantity: number
    lots: number
    lot_quantity: number
    untracked_quantity: number
    same_lot_at_both: number
    rfid_confirmed_quantity: number
    open_damaged_lots: number
    rfid_tags: number
    undo_entries_retired: number
  }
  lots_exceed_branch_stock_products: Array<{ product_id: number; branch_quantity: number; lot_quantity: number }>
}

const HOLDING_STATUSES_SQL = `('awaiting_payment', 'awaiting_delivery')`
const ACTIVE_IMPORT_STATUSES_SQL = `('pending','queued','running','analyzing','approved','applying','cancelling')`

function n(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

async function count(db: Reader, sql: string, params: Record<string, unknown> = {}): Promise<number> {
  const row = await db.prepare(sql).get<{ n: number }>(params)
  return n(row?.n)
}

export async function readConsolidationPreview(db: Reader): Promise<ConsolidationPreview> {
  const params = { source: CONSOLIDATION_SOURCE_BRANCH_ID, target: CONSOLIDATION_TARGET_BRANCH_ID }
  const branches = await db.prepare('SELECT * FROM branches ORDER BY id ASC').all<Record<string, unknown>>()
  const heldSchema = branches.length === 0 || ['role', 'canonical_key', 'successor_branch_id'].every((column) => column in branches[0])
  const active = branches.filter((row) => n(row.is_active) === 1)
  const byId = new Map(branches.map((row) => [n(row.id), row]))
  const name = (row: Record<string, unknown> | undefined) => String(row?.name ?? '').trim().toLowerCase()
  const source = byId.get(CONSOLIDATION_SOURCE_BRANCH_ID)
  const target = byId.get(CONSOLIDATION_TARGET_BRANCH_ID)
  const alreadyConsolidated = !!source && n(source.is_active) !== 1 && n(source.successor_branch_id) === CONSOLIDATION_TARGET_BRANCH_ID
  const branchesAsExpected = active.length === 2
    && !!target && n(target.is_active) === 1 && name(target) === 'warehouse' && target.successor_branch_id == null
    && !!source && n(source.is_active) === 1 && name(source) === 'shop' && source.successor_branch_id == null
    && !branches.some((row) => name(row) === 'store')

  const [unreleasedHolds, openShifts, importJobs, bulkJobs, rfidSessions, restore] = await Promise.all([
    count(db, `SELECT COUNT(*) AS n FROM sales WHERE branch_id = @source AND sale_status IN ${HOLDING_STATUSES_SQL}`, params),
    count(db, `SELECT COUNT(*) AS n FROM shift_sessions WHERE branch_id = @source AND closed_at IS NULL AND cancelled_at IS NULL`, params),
    count(db, `SELECT COUNT(*) AS n FROM import_jobs WHERE status IN ${ACTIVE_IMPORT_STATUSES_SQL}`),
    count(db, `SELECT COUNT(*) AS n FROM bulk_delete_jobs WHERE status IN ('pending','processing')`),
    count(db, `SELECT COUNT(*) AS n FROM rfid_scan_sessions WHERE branch_id = @source AND COALESCE(status, 'active') = 'active' AND finished_at IS NULL`, params),
    count(db, `SELECT COUNT(*) AS n FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore'`),
  ])

  const perProduct = await db.prepare(`
    SELECT s.product_id,
      COALESCE(s.quantity, 0) AS branch_quantity,
      COALESCE(s.rfid_confirmed_qty, 0) AS rfid_quantity,
      COALESCE((SELECT SUM(bs.quantity) FROM branch_batch_stock bs JOIN product_batches b ON b.id = bs.batch_id
                WHERE bs.branch_id = @source AND bs.quantity > 0 AND b.variant_product_id = s.product_id), 0) AS lot_quantity
    FROM branch_stock s WHERE s.branch_id = @source
    UNION ALL
    SELECT b.variant_product_id, 0, 0, SUM(bs.quantity)
    FROM branch_batch_stock bs JOIN product_batches b ON b.id = bs.batch_id
    WHERE bs.branch_id = @source AND bs.quantity > 0
      AND NOT EXISTS (SELECT 1 FROM branch_stock s WHERE s.branch_id = @source AND s.product_id = b.variant_product_id)
    GROUP BY b.variant_product_id
  `).all<{ product_id: number; branch_quantity: number; rfid_quantity: number; lot_quantity: number }>(params)
  const exceeding = perProduct
    .filter((row) => n(row.lot_quantity) > n(row.branch_quantity) + 0.000000001)
    .map((row) => ({ product_id: n(row.product_id), branch_quantity: n(row.branch_quantity), lot_quantity: n(row.lot_quantity) }))
  const moving = perProduct.filter((row) => n(row.branch_quantity) > 0)

  const lots = await db.prepare(`
    SELECT COUNT(*) AS lots, COALESCE(SUM(quantity), 0) AS quantity,
      SUM(CASE WHEN EXISTS (SELECT 1 FROM branch_batch_stock t WHERE t.batch_id = bs.batch_id AND t.branch_id = @target) THEN 1 ELSE 0 END) AS shared
    FROM branch_batch_stock bs WHERE bs.branch_id = @source AND bs.quantity > 0
  `).get<{ lots: number; quantity: number; shared: number }>(params)

  const [damaged, tags, undo] = await Promise.all([
    count(db, `SELECT COUNT(*) AS n FROM damaged_stock_lots WHERE branch_id = @source AND quantity_remaining > 0`, params),
    count(db, `SELECT COUNT(*) AS n FROM rfid_tags WHERE branch_id = @source`, params),
    count(db, `SELECT COUNT(*) AS n FROM action_history WHERE COALESCE(reversible, 1) = 1 AND status IN ('undoable', 'redoable')`),
  ])

  const blockers: ConsolidationBlockers = {
    held_schema_missing: heldSchema ? 0 : 1,
    already_consolidated: alreadyConsolidated ? 1 : 0,
    branches_not_as_expected: branchesAsExpected ? 0 : 1,
    unreleased_holds: unreleasedHolds,
    open_shifts: openShifts,
    active_jobs: importJobs + bulkJobs,
    active_rfid_sessions: rfidSessions,
    lots_exceed_branch_stock: exceeding.length,
    restore_in_progress: restore,
  }
  return {
    ready: Object.values(blockers).every((value) => value === 0),
    blockers,
    move: {
      products: moving.length,
      quantity: moving.reduce((sum, row) => sum + n(row.branch_quantity), 0),
      lots: n(lots?.lots),
      lot_quantity: n(lots?.quantity),
      untracked_quantity: moving.reduce((sum, row) => sum + Math.max(0, n(row.branch_quantity) - n(row.lot_quantity)), 0),
      same_lot_at_both: n(lots?.shared),
      rfid_confirmed_quantity: perProduct.reduce((sum, row) => sum + n(row.rfid_quantity), 0),
      open_damaged_lots: damaged,
      rfid_tags: tags,
      undo_entries_retired: undo,
    },
    lots_exceed_branch_stock_products: exceeding.slice(0, 50),
  }
}
