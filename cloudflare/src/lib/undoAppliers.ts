import type { Env } from '../index'
import type { SessionUser } from './auth'
import { getDb } from './db'
import { audit } from './audit'
import { broadcast } from '../durable-objects/broadcastHub'
import { branchUpdateStatements } from './branchWrites'
import { getActionTier, getPermissionTier, type PermissionTier } from './permissions'
import {
  buildAllocationStatements,
  planSaleLineAddition,
  planSaleLineRemoval,
  plannedLineFromRecord,
  saleMoneyUpdateStatement,
  type SaleAddItemsReversal,
} from './saleLineAddition'

// Server-side undo/redo appliers (K1). The action_history store has always
// held an undo_payload / redo_payload per recorded action, but historically
// the CLIENT replayed them from a live in-memory closure -- so reversibility
// died on page reload (utils/actionHistory.ts's own comment explains why a
// generic closure cannot be serialized). This registry lets the WORKER replay
// a payload instead, whenever the payload names an applier registered here, so
// an admin/user can undo or redo an action that outlives their browser tab.
//
// The contract is intentionally additive: only a payload carrying a known
// `applier` string is executed server-side; anything else falls through to the
// pre-existing status-flip-and-return-payload behavior, so every action that
// does not opt in is untouched. Each applier replays a payload through the SAME
// write path the live route uses (see branchUpdateStatements) rather than a
// second copy of the SQL, and composes its own audit + broadcast -- an undo is
// an already-authorized direct action on an existing row, so it deliberately
// does not re-enter the review queue.
//
// Scope of this first slice: branch field edits (`branch.update`). Create/
// delete reversal (which has to reconcile a changing row id across the undo/
// redo cycle) and the other action_history scopes are the roadmap in
// progress.md's K1 -- each is added here as its consumer starts emitting a
// declarative payload.

export interface UndoApplierContext {
  env: Env
  user: SessionUser | null
  direction: 'undo' | 'redo'
}

export type UndoApplier = (payload: Record<string, unknown>, ctx: UndoApplierContext) => Promise<void>

// Every applier declares the permission section its replay writes under, and
// optionally the granular ACTION within that section (merge_duplicates, say),
// so an applier is gated exactly as tightly as the live route it mirrors --
// never merely by the coarse section tier when the forward action itself is
// action-gated. This -- the server-side registry -- is the AUTHORITY the route
// checks at both record and operate time, never the row's client-supplied
// entity/scope (the Part-77 CRITICAL finding: an unrecognized entity derived an
// empty permission and gated nothing, so any account could store a payload
// naming 'branch.update' under scope 'global' and have the Worker write
// branches for it). A replay is a DIRECT write with no review queue, so the
// required tier is FULL: a review-tier user's forward edit is queued for
// approval, and their undo must not be the one path that writes the section
// directly.
type UndoApplierDef = { permission: string; action?: string; run: UndoApplier }

// The effective tier THIS user has over an applier's replay: the granular
// action tier when the applier declares one, else the coarse section tier.
// The single place the three gate sites (record, map, operate) agree on how
// an applier's permission is evaluated, so they can never drift.
export function applierPermissionTier(user: SessionUser, applier: { permission: string; action?: string }): PermissionTier {
  return applier.action
    ? getActionTier(user, applier.permission, applier.action)
    : getPermissionTier(user, applier.permission)
}

// ---------------------------------------------------------------------------
// product.merge -- reload-durable undo/redo for a duplicate-product merge.
//
// A merge (routes/products.ts foldDuplicateProductInto) folds a duplicate into
// a keeper: it sums branch stock, re-points/folds batches, carries images, and
// re-parents the dup's sale_items + inventory_movements, then soft-deletes the
// dup. Reversing that touches an unbounded number of rows, so the reversal
// snapshot lives in the undo_snapshots side table (0097), not the 20 KB
// action_history payload -- the action_history row carries only
// { applier: 'product.merge', snapshot_id }.
//
// UNDO restores both products to their exact pre-merge state from the captured
// snapshot. REDO re-runs the SAME production fold (no second copy of the merge
// SQL) -- deterministic because undo restored the exact pre-merge state -- and
// overwrites the snapshot with the fresh reversal it returns. The dup is only
// ever soft-deleted, so its id is stable across the whole undo/redo cycle.
// ---------------------------------------------------------------------------

export interface MergeReversal {
  keeperId: number
  keeperName: string | null
  dupId: number
  dupName: string | null
  mergeContext: string
  keeperImagePathBefore: string | null
  // Optional for backward compatibility with snapshots written before merge
  // cleanup began carrying the highest selling/special prices to the keeper.
  keeperPricingBefore?: {
    selling_price_usd: number
    selling_price_khr: number
    special_price_usd: number
    special_price_khr: number
    // Optional again, one layer deeper: snapshots written before Sep 4 2026
    // predate cost being merged at all, so they carry no cost to restore and
    // must leave the keeper's cost alone rather than zero it.
    cost_price_usd?: number
    cost_price_khr?: number
  }
  keeperStockBefore: Array<{ branch_id: number; quantity: number }>
  dupStockBefore: Array<{ branch_id: number; quantity: number; rfid_confirmed_qty: number }>
  dupImagesBefore: Array<{ image_path: string; sort_order: number | null }>
  imagesMovedToKeeper: string[]
  repointedBatches: Array<{ id: number; batchNumber: number | null }>
  foldedBatches: Array<{
    dupBatchId: number
    keeperBatchId: number
    dupStockBefore: Array<{ branch_id: number; quantity: number }>
    keeperStockBefore: Array<{ branch_id: number; quantity: number }>
  }>
  reparentedSaleItemIds: number[]
  reparentedMovementIds: number[]
  adjustmentMovementIds: number[]
}

// The forward fold lives in routes/products.ts; rather than have this lib
// import a route module (a lib->route dependency, and a require cycle since the
// route imports MergeReversal from here), the route REGISTERS the fold at
// module load and the redo path calls it through this seam.
export type MergeFoldFn = (
  env: Env,
  db: ReturnType<typeof getDb>,
  user: SessionUser | null,
  canonical: { id: number; name: string | null },
  dup: { id: number; name: string | null; image_path?: string | null },
  branchNameById: Map<number, string>,
  mergeContext: string,
) => Promise<{ reversal: MergeReversal }>

let mergeFoldFn: MergeFoldFn | null = null
export function registerMergeFold(fn: MergeFoldFn): void {
  mergeFoldFn = fn
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const intIds = (arr: unknown): number[] =>
  (Array.isArray(arr) ? arr : []).map(Number).filter((n) => Number.isInteger(n) && n > 0)

// Record a completed merge as an undoable/redoable action: the large reversal
// goes to undo_snapshots, and a small action_history row points at it. Returns
// both ids so the merge endpoint can hand the action id back to the client.
export async function recordMergeUndoSnapshot(
  env: Env,
  user: SessionUser | null,
  reversal: MergeReversal,
): Promise<{ snapshotId: number; actionHistoryId: number }> {
  const db = getDb(env)
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('product.merge', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify(reversal), byId: user?.id ?? null, byName: user?.name ?? null })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'product.merge', snapshot_id: snapshotId })
  const keeperName = reversal.keeperName || `#${reversal.keeperId}`
  const dupName = reversal.dupName || `#${reversal.dupId}`
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(reversal.dupId),
    label: `Merged "${dupName}" into "${keeperName}"`,
    undoLabel: `Undo merge of "${dupName}"`,
    redoLabel: `Redo merge of "${dupName}"`,
    payload,
    byId: user?.id ?? null,
    byName: user?.name ?? null,
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

// Bulk variant: the whole-catalog POST /merge-duplicates folds MANY duplicates
// (across many keepers) in one run, and the person expects to undo the whole
// cleanup with one click -- not hunt down N separate history rows, and not risk
// undoing them out of order (a later fold in a group folds into batches an
// earlier fold already moved onto the keeper, so the reversals are ORDER-
// DEPENDENT). So the run is recorded as ONE composite action: every per-fold
// reversal, in application order, in a single undo_snapshots row, behind one
// action_history row. Undo replays them in REVERSE; redo re-runs the folds
// FORWARD (see the 'product.merge.bulk' applier). Records nothing (returns
// null) when the run folded nothing, so an empty cleanup leaves no dead row.
export async function recordBulkMergeUndoSnapshot(
  env: Env,
  user: SessionUser | null,
  reversals: MergeReversal[],
): Promise<{ snapshotId: number; actionHistoryId: number } | null> {
  const list = Array.isArray(reversals) ? reversals.filter((r) => r && Number(r.dupId) > 0) : []
  if (!list.length) return null
  const db = getDb(env)
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('product.merge.bulk', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify({ reversals: list }), byId: user?.id ?? null, byName: user?.name ?? null })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'product.merge.bulk', snapshot_id: snapshotId })
  const n = list.length
  const noun = n === 1 ? 'duplicate product' : 'duplicate products'
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(list[0].keeperId),
    label: `Merged ${n} ${noun}`,
    undoLabel: `Undo merge of ${n} ${noun}`,
    redoLabel: `Redo merge of ${n} ${noun}`,
    payload,
    byId: user?.id ?? null,
    byName: user?.name ?? null,
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

// Restore both products to their exact pre-merge state from the snapshot.
async function applyMergeReversal(env: Env, r: MergeReversal): Promise<void> {
  const db = getDb(env)
  const keeperId = Number(r.keeperId)
  const dupId = Number(r.dupId)
  if (!Number.isInteger(keeperId) || keeperId <= 0 || !Number.isInteger(dupId) || dupId <= 0) {
    throw new Error('This merge cannot be undone: its saved details are missing a product id.')
  }
  const [keeper, dupRow] = await Promise.all([
    db.prepare('SELECT id FROM products WHERE id = ?').get<{ id: number }>([keeperId]),
    db.prepare('SELECT id FROM products WHERE id = ?').get<{ id: number }>([dupId]),
  ])
  if (!keeper) throw new Error('The product this merge kept no longer exists, so the merge cannot be undone.')
  if (!dupRow) throw new Error('The merged-away product record no longer exists, so the merge cannot be undone.')

  const stmts: Array<{ sql: string; params?: Record<string, unknown> }> = []

  // 1. Reactivate the merged-away product; restore keeper's image_path.
  stmts.push({ sql: 'UPDATE products SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @dupId', params: { dupId } })
  stmts.push({ sql: 'UPDATE products SET image_path = @path, updated_at = CURRENT_TIMESTAMP WHERE id = @keeperId', params: { keeperId, path: r.keeperImagePathBefore ?? null } })
  if (r.keeperPricingBefore) {
    // Cost is restored only when the snapshot recorded it. A pre-Sep-4-2026
    // snapshot has no cost_price_* in its payload, and writing `|| 0` for a
    // missing field would wipe a real cost off the keeper on undo -- so the
    // two columns join the SET list only when they are actually present.
    const hasCost = r.keeperPricingBefore.cost_price_usd !== undefined
      || r.keeperPricingBefore.cost_price_khr !== undefined
    const costSet = hasCost
      ? `,
                cost_price_usd = @costUsd,
                cost_price_khr = @costKhr`
      : ''
    const costParams = hasCost
      ? {
        costUsd: Number(r.keeperPricingBefore.cost_price_usd) || 0,
        costKhr: Number(r.keeperPricingBefore.cost_price_khr) || 0,
      }
      : {}
    stmts.push({
      sql: `UPDATE products
            SET selling_price_usd = @sellingUsd,
                selling_price_khr = @sellingKhr,
                special_price_usd = @specialUsd,
                special_price_khr = @specialKhr${costSet},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = @keeperId`,
      params: {
        keeperId,
        sellingUsd: Number(r.keeperPricingBefore.selling_price_usd) || 0,
        sellingKhr: Number(r.keeperPricingBefore.selling_price_khr) || 0,
        specialUsd: Number(r.keeperPricingBefore.special_price_usd) || 0,
        specialKhr: Number(r.keeperPricingBefore.special_price_khr) || 0,
        ...costParams,
      },
    })
  }

  // 2. branch_stock, for exactly the branches the fold touched (the dup's):
  //    the keeper keeps its row and we UPDATE only quantity back (preserving
  //    rfid_confirmed_qty, which delete+reinsert would wipe), or DELETE the row
  //    the fold created for a branch it had none in; the dup's deleted rows are
  //    re-inserted with their captured quantity AND rfid_confirmed_qty.
  const keeperQtyByBranch = new Map((r.keeperStockBefore || []).map((x) => [Number(x.branch_id), Number(x.quantity) || 0]))
  for (const d of (r.dupStockBefore || [])) {
    const b = Number(d.branch_id)
    if (keeperQtyByBranch.has(b)) {
      stmts.push({ sql: 'UPDATE branch_stock SET quantity = @q WHERE product_id = @keeperId AND branch_id = @b', params: { keeperId, b, q: keeperQtyByBranch.get(b) } })
    } else {
      stmts.push({ sql: 'DELETE FROM branch_stock WHERE product_id = @keeperId AND branch_id = @b', params: { keeperId, b } })
    }
    stmts.push({ sql: 'DELETE FROM branch_stock WHERE product_id = @dupId AND branch_id = @b', params: { dupId, b } })
    stmts.push({ sql: 'INSERT INTO branch_stock (product_id, branch_id, quantity, rfid_confirmed_qty) VALUES (@dupId, @b, @q, @rfid)', params: { dupId, b, q: Number(d.quantity) || 0, rfid: Number(d.rfid_confirmed_qty) || 0 } })
  }

  // 3. inventory_movements: delete the fold's adjustment rows (by captured id,
  //    or by the dup-specific reason fragment for a snapshot from before ids
  //    were captured); move the re-parented history back to the dup.
  const adjIds = intIds(r.adjustmentMovementIds)
  if (adjIds.length) {
    for (const grp of chunk(adjIds, 400)) stmts.push({ sql: `DELETE FROM inventory_movements WHERE id IN (${grp.join(',')})` })
  } else {
    stmts.push({ sql: `DELETE FROM inventory_movements WHERE product_id = @keeperId AND movement_type = 'adjustment' AND reason LIKE @frag`, params: { keeperId, frag: `%(#${dupId}) into this product%` } })
  }
  for (const grp of chunk(intIds(r.reparentedMovementIds), 400)) {
    stmts.push({ sql: `UPDATE inventory_movements SET product_id = @dupId WHERE id IN (${grp.join(',')})`, params: { dupId } })
  }

  // 4. sale_items back to the dup.
  for (const grp of chunk(intIds(r.reparentedSaleItemIds), 400)) {
    stmts.push({ sql: `UPDATE sale_items SET product_id = @dupId WHERE id IN (${grp.join(',')})`, params: { dupId } })
  }

  // 5. product_images: pull the moved paths off the keeper, restore the dup's
  //    gallery (the fold had deleted every dup image row).
  const movedPaths = (r.imagesMovedToKeeper || []).map(String).filter(Boolean)
  for (const grp of chunk(movedPaths, 50)) {
    if (!grp.length) continue
    // sql-bound-params: bounded by construction -- this loop caps each group
    // at 50 image paths, plus keeperId, safely below D1's 100-bind ceiling.
    const placeholders = grp.map((_, i) => `@p${i}`).join(',')
    const params: Record<string, unknown> = { keeperId }
    grp.forEach((p, i) => { params[`p${i}`] = p })
    stmts.push({ sql: `DELETE FROM product_images WHERE product_id = @keeperId AND image_path IN (${placeholders})`, params })
  }
  for (const img of (r.dupImagesBefore || [])) {
    stmts.push({ sql: 'INSERT INTO product_images (product_id, image_path, sort_order) VALUES (@dupId, @path, @order)', params: { dupId, path: String(img.image_path), order: img.sort_order == null ? 0 : Number(img.sort_order) } })
  }

  // 6. product_batches: point the re-pointed batches back at the dup with their
  //    original number; reactivate each folded batch, re-insert its per-branch
  //    stock, and restore the keeper batch's stock for the folded branches.
  for (const b of (r.repointedBatches || [])) {
    stmts.push({ sql: 'UPDATE product_batches SET variant_product_id = @dupId, batch_number = @num, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { dupId, num: b.batchNumber == null ? null : Number(b.batchNumber), id: Number(b.id) } })
  }
  for (const fb of (r.foldedBatches || [])) {
    const dupBatchId = Number(fb.dupBatchId)
    const keeperBatchId = Number(fb.keeperBatchId)
    stmts.push({ sql: 'UPDATE product_batches SET is_active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = @id', params: { id: dupBatchId } })
    const keeperBBefore = new Map((fb.keeperStockBefore || []).map((x) => [Number(x.branch_id), Number(x.quantity) || 0]))
    for (const d of (fb.dupStockBefore || [])) {
      const b = Number(d.branch_id)
      if (keeperBBefore.has(b)) {
        stmts.push({ sql: 'UPDATE branch_batch_stock SET quantity = @q, updated_at = CURRENT_TIMESTAMP WHERE batch_id = @kb AND branch_id = @b', params: { kb: keeperBatchId, b, q: keeperBBefore.get(b) } })
      } else {
        stmts.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @kb AND branch_id = @b', params: { kb: keeperBatchId, b } })
      }
      stmts.push({ sql: 'DELETE FROM branch_batch_stock WHERE batch_id = @db AND branch_id = @b', params: { db: dupBatchId, b } })
      stmts.push({ sql: 'INSERT INTO branch_batch_stock (batch_id, branch_id, quantity, updated_at) VALUES (@db, @b, @q, CURRENT_TIMESTAMP)', params: { db: dupBatchId, b, q: Number(d.quantity) || 0 } })
    }
  }

  // 7. Recompute both products' denormalized stock_quantity from the truth.
  stmts.push({ sql: 'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @keeperId), updated_at = CURRENT_TIMESTAMP WHERE id = @keeperId', params: { keeperId } })
  stmts.push({ sql: 'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @dupId), updated_at = CURRENT_TIMESTAMP WHERE id = @dupId', params: { dupId } })

  await db.batch(stmts)
}

// Undo a whole bulk merge: replay each fold's reversal in REVERSE application
// order. Order matters -- a later fold in a group folded into batches an
// earlier fold had already moved onto the keeper, so peeling the newest fold
// first restores the keeper to the exact state the next-oldest reversal was
// captured against. Each reversal runs in its own batch (validating the two
// products still exist); a cleanup undo is a rare admin op, not a hot path.
async function applyBulkMergeReversal(env: Env, reversals: MergeReversal[]): Promise<void> {
  for (let i = reversals.length - 1; i >= 0; i--) {
    await applyMergeReversal(env, reversals[i])
  }
}

// Redo a whole bulk merge: re-run the SAME production folds in FORWARD order
// (deterministic because undo restored the exact pre-bulk state), then recompute
// each distinct keeper's denormalized stock_quantity once. Returns the fresh
// reversals so the snapshot can be overwritten for a future undo. Mirrors the
// single 'product.merge' redo, extended across the run.
async function redoBulkMergeFolds(
  env: Env,
  user: SessionUser | null,
  reversals: MergeReversal[],
): Promise<MergeReversal[]> {
  if (!mergeFoldFn) throw new Error('This merge cannot be redone in the current server build.')
  const db = getDb(env)
  const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
  const branchNameById = new Map<number, string>(branchRows.map((b) => [b.id, b.name]))
  const fresh: MergeReversal[] = []
  const keeperIds = new Set<number>()
  for (const r of reversals) {
    const keeperId = Number(r.keeperId)
    const dupId = Number(r.dupId)
    const [keeper, dupRow] = await Promise.all([
      db.prepare('SELECT id, name, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; is_active: number }>([keeperId]),
      db.prepare('SELECT id, name, image_path, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; image_path: string | null; is_active: number }>([dupId]),
    ])
    if (!keeper || !dupRow) throw new Error('One of the merged products no longer exists, so this merge cannot be redone.')
    if (!keeper.is_active || !dupRow.is_active) throw new Error('One of the merged products is no longer active, so this merge cannot be redone.')
    const { reversal: one } = await mergeFoldFn!(
      env, db, user,
      { id: keeperId, name: keeper.name },
      { id: dupId, name: dupRow.name, image_path: dupRow.image_path },
      branchNameById,
      r.mergeContext || 'redo merge',
    )
    fresh.push(one)
    keeperIds.add(keeperId)
  }
  for (const keeperId of keeperIds) {
    await db.prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id: keeperId })
  }
  return fresh
}

// ---------------------------------------------------------------------------
// supplier.backfill -- reload-durable undo/redo for attributing a supplier to a
// product's blank/name-only lots after the fact.
//
// Supplier attribution lives on the LOT (product_batches.supplier_id/_name,
// migration 0062): matched by exact normalized name at receive time, so a name
// that had no suppliers-table match then keeps supplier_id NULL and "stays
// linkable later". This action does that later linking -- it sets supplier_id
// (+ the supplier's canonical name) on the chosen unattributed lots. UNDO
// restores each lot's exact prior (supplier_id, supplier_name); REDO re-applies
// the current canonical name for the supplier. The lot set is bounded per
// product but the reversal still lives in undo_snapshots (0097) for the same
// reason the merge does -- the action_history payload stays a tiny pointer.
// ---------------------------------------------------------------------------
export interface SupplierBackfillReversal {
  productId: number
  supplierId: number
  supplierName: string | null
  lots: Array<{ id: number; prevSupplierId: number | null; prevSupplierName: string | null }>
}

// Record a completed backfill as one undoable/redoable action.
export async function recordSupplierBackfillSnapshot(
  env: Env,
  user: SessionUser | null,
  reversal: SupplierBackfillReversal,
): Promise<{ snapshotId: number; actionHistoryId: number } | null> {
  const lots = Array.isArray(reversal.lots) ? reversal.lots.filter((l) => Number(l.id) > 0) : []
  if (!lots.length) return null
  const db = getDb(env)
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('supplier.backfill', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify({ ...reversal, lots }), byId: user?.id ?? null, byName: user?.name ?? null })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'supplier.backfill', snapshot_id: snapshotId })
  const supplierName = reversal.supplierName || `#${reversal.supplierId}`
  const n = lots.length
  const noun = n === 1 ? 'lot' : 'lots'
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('products', 'product', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(reversal.productId),
    label: `Attributed ${n} ${noun} to "${supplierName}"`,
    undoLabel: `Undo supplier attribution of ${n} ${noun}`,
    redoLabel: `Redo supplier attribution of ${n} ${noun}`,
    payload,
    byId: user?.id ?? null,
    byName: user?.name ?? null,
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

// UNDO: restore each lot's exact prior attribution.
async function applySupplierBackfillUndo(env: Env, r: SupplierBackfillReversal): Promise<void> {
  const db = getDb(env)
  const stmts = (r.lots || [])
    .filter((l) => Number(l.id) > 0)
    .map((l) => ({
      sql: 'UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id: Number(l.id), sid: l.prevSupplierId == null ? null : Number(l.prevSupplierId), sname: l.prevSupplierName ?? null },
    }))
  if (stmts.length) await db.batch(stmts)
}

// REDO: re-apply the supplier to the same lots, using the supplier's CURRENT
// canonical name (mirrors the forward action, which stamps the name at write
// time). Refuses if the supplier no longer exists -- guessing a name is worse.
async function applySupplierBackfillRedo(env: Env, r: SupplierBackfillReversal): Promise<string | null> {
  const db = getDb(env)
  const supplierId = Number(r.supplierId)
  const supplier = await db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get<{ id: number; name: string }>([supplierId])
  if (!supplier) throw new Error('That supplier no longer exists, so this attribution cannot be redone.')
  const name = supplier.name
  const stmts = (r.lots || [])
    .filter((l) => Number(l.id) > 0)
    .map((l) => ({
      sql: 'UPDATE product_batches SET supplier_id = @sid, supplier_name = @sname, updated_at = CURRENT_TIMESTAMP WHERE id = @id',
      params: { id: Number(l.id), sid: supplierId, sname: name },
    }))
  if (stmts.length) await db.batch(stmts)
  return name
}

// ---------------------------------------------------------------------------
// sale.add_items -- reload-durable undo/redo for "add products to an existing
// sale" (routes/sales.ts POST /:id/items, S4-24b).
//
// This is the applier the sale-STATUS action never got. Sales.tsx records a
// status change with `undo_payload: {}` (actionHistory.ts's default), and
// resolveUndoApplier({}) returns null, so that row's Undo transitions the
// history entry and moves nothing -- the button lies. An action that MOVED
// STOCK must not repeat that, so this one carries a real payload and a real
// applier, and the pure test proves the applier reverses both the line and
// its stock.
//
// Payload shape: { applier: 'sale.add_items', snapshot_id }. The reversal is
// unbounded in line count (up to 50 lines, each with its own lot takes) and
// action_history's payload is a 20 KB column, so it lives in undo_snapshots
// exactly like the merge appliers above.
//
// UNDO returns the units to the SAME lots the addition drew from, in reverse
// draw order, as new 'return' movements (never by editing the original
// movements), deletes the added sale_items and their allocation rows, and
// restores the sale's money columns from the snapshot's moneyBefore.
// REDO re-inserts the same lines through the SAME production planner
// (planSaleLineAddition -- no second copy of the deduction SQL), drawing the
// exact lots recorded rather than re-running FIFO, then restores moneyAfter.
// The new sale_item ids are written back into the snapshot so the next undo
// deletes the rows that actually exist.
// ---------------------------------------------------------------------------

export async function recordSaleAddItemsUndoSnapshot(
  env: Env,
  user: SessionUser | null,
  reversal: SaleAddItemsReversal,
): Promise<{ snapshotId: number; actionHistoryId: number } | null> {
  if (!reversal || !(Number(reversal.saleId) > 0) || !Array.isArray(reversal.lines) || !reversal.lines.length) return null
  const db = getDb(env)
  const snap = await db.prepare(`
    INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
    VALUES ('sale.add_items', 'applied', @payload, @byId, @byName)
  `).run({ payload: JSON.stringify(reversal), byId: user?.id ?? null, byName: user?.name ?? null })
  const snapshotId = Number(snap.lastInsertRowid ?? 0)
  const payload = JSON.stringify({ applier: 'sale.add_items', snapshot_id: snapshotId })
  const saleLabel = reversal.receiptNumber || `#${reversal.saleId}`
  const lineCount = reversal.lines.length
  const hist = await db.prepare(`
    INSERT INTO action_history (
      scope, entity, entity_id, label, undo_label, redo_label, reversible, status,
      undo_payload, redo_payload, created_by_id, created_by_name
    ) VALUES ('sales', 'sale', @entityId, @label, @undoLabel, @redoLabel, 1, 'undoable',
              @payload, @payload, @byId, @byName)
  `).run({
    entityId: String(reversal.saleId),
    label: `Added ${lineCount} item${lineCount === 1 ? '' : 's'} to sale ${saleLabel}`,
    undoLabel: `Undo items added to sale ${saleLabel}`,
    redoLabel: `Redo items added to sale ${saleLabel}`,
    payload,
    byId: user?.id ?? null,
    byName: user?.name ?? null,
  })
  return { snapshotId, actionHistoryId: Number(hist.lastInsertRowid ?? 0) }
}

const APPLIERS: Record<string, UndoApplierDef> = {
  // Payload shape: { applier: 'sale.add_items', snapshot_id }. Undo and redo
  // payloads are identical; the applier is direction-aware and the reversal
  // (the added lines, their exact lot takes, and both money snapshots) lives
  // in undo_snapshots[snapshot_id]. See recordSaleAddItemsUndoSnapshot above
  // for why this action needed a REAL payload instead of the `{}` the sale
  // status action records.
  //
  // Gated by the SAME granular action as the live route (sales ->
  // add_items), full tier, at record and operate time.
  'sale.add_items': {
    permission: 'sales',
    action: 'add_items',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('These added items cannot be replayed: their saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'sale.add_items'])
      if (!snap) throw new Error('The saved details for these added items are no longer available, so they cannot be reversed.')
      let reversal: SaleAddItemsReversal
      try {
        reversal = JSON.parse(snap.payload_json) as SaleAddItemsReversal
      } catch (_) {
        throw new Error('The saved details for these added items are unreadable, so they cannot be reversed.')
      }
      const saleId = Number(reversal.saleId || 0)
      const sale = await db.prepare('SELECT id, sale_status FROM sales WHERE id = ?').get<{ id: number; sale_status: string | null }>([saleId])
      if (!sale) throw new Error('The sale these items were added to no longer exists, so this cannot be reversed.')
      // The stock arithmetic recorded in the snapshot is only true for the
      // status the sale was in when the line was added -- a sale that has
      // since been cancelled has already had these units restored by the
      // cancellation, and undoing here would add them a second time.
      if (String(sale.sale_status || 'completed') !== String(reversal.saleStatus)) {
        throw new Error("This sale's status changed after the items were added, so this can no longer be undone safely. Adjust the sale directly instead.")
      }

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('These added items have already been removed.')
        const removal = planSaleLineRemoval({
          saleId,
          lines: reversal.lines || [],
          reason: `Undo: items added to sale ${reversal.receiptNumber || `#${saleId}`} removed`,
          userId: ctx.user?.id ?? null,
          userName: ctx.user?.name ?? null,
        })
        await db.batch([...removal.statements, saleMoneyUpdateStatement(saleId, reversal.moneyBefore)])
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('These items are already on the sale; there is nothing to redo.')
        // Re-add through the SAME production planner, drawing the exact lots
        // the original addition drew from (plannedLineFromRecord) rather than
        // re-running FIFO -- undo put those units back into those lots, so
        // they are the right ones, and the strict decrement aborts the redo
        // if a concurrent sale has since taken them.
        const lines = (reversal.lines || []).map(plannedLineFromRecord)
        const plan = planSaleLineAddition({
          saleId,
          saleStatus: reversal.saleStatus,
          lines,
          exchangeRate: Number(reversal.exchangeRate) || 4100,
          userId: ctx.user?.id ?? null,
          userName: ctx.user?.name ?? null,
        })
        const results = await db.batch([...plan.statements, saleMoneyUpdateStatement(saleId, reversal.moneyAfter)]) as Array<{ meta?: { last_row_id?: number } }>
        const saleItemIdByLine = plan.lines.map((_line, lineIndex) => {
          const statementIndex = plan.saleItemStatementIndexByLine[lineIndex]
          return Number(results[statementIndex]?.meta?.last_row_id || 0) || null
        })
        const allocationStatements = buildAllocationStatements(plan.lines, saleItemIdByLine)
        if (allocationStatements.length) {
          try { await db.batch(allocationStatements) } catch (allocationError) {
            console.error('[undo] sale.add_items redo: allocation rows failed (stock already moved correctly)', allocationError)
          }
        }
        // The re-inserted rows have NEW ids -- persist them so a later undo
        // deletes the rows that actually exist, not the ones this redo
        // replaced.
        const nextReversal: SaleAddItemsReversal = {
          ...reversal,
          lines: (reversal.lines || []).map((line, lineIndex) => ({
            ...line,
            saleItemId: Number(saleItemIdByLine[lineIndex] || 0) || line.saleItemId,
          })),
        }
        await db.prepare("UPDATE undo_snapshots SET payload_json = @payload, status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = @id")
          .run({ payload: JSON.stringify(nextReversal), id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, ctx.user?.name ?? null,
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'sale', saleId,
        { via: 'undo_applier', applier: 'sale.add_items', lines: (reversal.lines || []).length },
      )
      await broadcast(ctx.env, 'sales', { action: 'update', id: saleId })
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
  // Payload shape: { applier: 'branch.update', id, fields: { name, location,
  // phone, manager, notes, is_default, is_active } }. The undo_payload carries
  // the PRE-edit field values and the redo_payload the POST-edit values, so the
  // one applier serves both directions -- the direction only decides which
  // stored payload the route hands in.
  'branch.update': {
    // Same section the live PUT /branches/:id gates on (getPermissionTier
    // (user, 'branches') in routes/branches.ts).
    permission: 'branches',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const id = Number(payload.id || 0)
      if (!Number.isInteger(id) || id <= 0) {
        throw new Error('This action cannot be replayed: its saved details are missing a branch id.')
      }
      const existing = await db.prepare('SELECT id FROM branches WHERE id = ?').get<{ id: number }>([id])
      if (!existing) {
        throw new Error('The branch this action changed no longer exists, so it cannot be reversed.')
      }
      const fields = payload.fields && typeof payload.fields === 'object'
        ? (payload.fields as Record<string, unknown>)
        : {}
      await db.batch(branchUpdateStatements(id, fields))
      await audit(
        ctx.env,
        ctx.user?.id ?? null,
        ctx.user?.name ?? null,
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'branch',
        id,
        { via: 'undo_applier', applier: 'branch.update' },
      )
      await broadcast(ctx.env, 'branches', { action: 'update', id })
    },
  },
  // Payload shape: { applier: 'product.merge', snapshot_id }. Both the undo_
  // and redo_payload are identical -- the applier is direction-aware and the
  // heavy reversal data lives in undo_snapshots[snapshot_id], not the payload.
  // Gated by the SAME granular action as the live merge (products ->
  // merge_duplicates), full tier, at record and operate time.
  'product.merge': {
    permission: 'products',
    action: 'merge_duplicates',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('This merge cannot be replayed: its saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'product.merge'])
      if (!snap) throw new Error('The saved details for this merge are no longer available, so it cannot be reversed.')
      let reversal: MergeReversal
      try {
        reversal = JSON.parse(snap.payload_json) as MergeReversal
      } catch (_) {
        throw new Error('The saved details for this merge are unreadable, so it cannot be reversed.')
      }

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('This merge has already been undone.')
        await applyMergeReversal(ctx.env, reversal)
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('This merge is already in place; there is nothing to redo.')
        if (!mergeFoldFn) throw new Error('This merge cannot be redone in the current server build.')
        const keeperId = Number(reversal.keeperId)
        const dupId = Number(reversal.dupId)
        const [keeper, dupRow] = await Promise.all([
          db.prepare('SELECT id, name, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; is_active: number }>([keeperId]),
          db.prepare('SELECT id, name, image_path, is_active FROM products WHERE id = ?').get<{ id: number; name: string | null; image_path: string | null; is_active: number }>([dupId]),
        ])
        if (!keeper || !dupRow) throw new Error('One of the two products no longer exists, so the merge cannot be redone.')
        if (!keeper.is_active || !dupRow.is_active) throw new Error('One of the two products is no longer active, so the merge cannot be redone.')
        const branchRows = await db.prepare('SELECT id, name FROM branches').all<{ id: number; name: string }>({})
        const { reversal: fresh } = await mergeFoldFn(
          ctx.env, db, ctx.user,
          { id: keeperId, name: keeper.name },
          { id: dupId, name: dupRow.name, image_path: dupRow.image_path },
          new Map<number, string>(branchRows.map((b) => [b.id, b.name])),
          reversal.mergeContext || 'redo merge',
        )
        await db.prepare('UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @id), updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id: keeperId })
        await db.prepare("UPDATE undo_snapshots SET status = 'applied', payload_json = @payload, updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ payload: JSON.stringify(fresh), id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, ctx.user?.name ?? null,
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'product', reversal.dupId,
        { via: 'undo_applier', applier: 'product.merge', keeperId: reversal.keeperId },
      )
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
  // Payload shape: { applier: 'product.merge.bulk', snapshot_id }. The snapshot
  // holds { reversals: MergeReversal[] } -- every fold from one whole-catalog
  // POST /merge-duplicates run, in application order. UNDO replays them in
  // reverse (applyBulkMergeReversal); REDO re-runs the folds forward
  // (redoBulkMergeFolds) and overwrites the snapshot with the fresh reversals.
  // Same granular gate as the single merge (products -> merge_duplicates, full).
  'product.merge.bulk': {
    permission: 'products',
    action: 'merge_duplicates',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('This merge cannot be replayed: its saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'product.merge.bulk'])
      if (!snap) throw new Error('The saved details for this merge are no longer available, so it cannot be reversed.')
      let reversals: MergeReversal[]
      try {
        const parsed = JSON.parse(snap.payload_json) as { reversals?: MergeReversal[] }
        reversals = Array.isArray(parsed?.reversals) ? parsed.reversals : []
      } catch (_) {
        throw new Error('The saved details for this merge are unreadable, so it cannot be reversed.')
      }
      if (!reversals.length) throw new Error('This merge has no saved folds to replay.')

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('This merge has already been undone.')
        await applyBulkMergeReversal(ctx.env, reversals)
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('This merge is already in place; there is nothing to redo.')
        const fresh = await redoBulkMergeFolds(ctx.env, ctx.user, reversals)
        await db.prepare("UPDATE undo_snapshots SET status = 'applied', payload_json = @payload, updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ payload: JSON.stringify({ reversals: fresh }), id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, ctx.user?.name ?? null,
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'product', reversals[0]?.keeperId ?? null,
        { via: 'undo_applier', applier: 'product.merge.bulk', count: reversals.length },
      )
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
  // Payload shape: { applier: 'supplier.backfill', snapshot_id }. The snapshot
  // holds a SupplierBackfillReversal (the lots + each lot's prior attribution).
  // Gated by the products edit action (attributing a lot's supplier IS a product
  // edit), full tier, at record and operate time -- same authority model as the
  // merge appliers above.
  'supplier.backfill': {
    permission: 'products',
    action: 'edit',
    run: async (payload, ctx) => {
      const db = getDb(ctx.env)
      const snapshotId = Number(payload.snapshot_id || 0)
      if (!Number.isInteger(snapshotId) || snapshotId <= 0) {
        throw new Error('This attribution cannot be replayed: its saved snapshot reference is missing.')
      }
      const snap = await db
        .prepare('SELECT id, status, payload_json FROM undo_snapshots WHERE id = ? AND kind = ?')
        .get<{ id: number; status: string; payload_json: string }>([snapshotId, 'supplier.backfill'])
      if (!snap) throw new Error('The saved details for this attribution are no longer available, so it cannot be reversed.')
      let reversal: SupplierBackfillReversal
      try {
        reversal = JSON.parse(snap.payload_json) as SupplierBackfillReversal
      } catch (_) {
        throw new Error('The saved details for this attribution are unreadable, so it cannot be reversed.')
      }

      if (ctx.direction === 'undo') {
        if (String(snap.status) !== 'applied') throw new Error('This attribution has already been undone.')
        await applySupplierBackfillUndo(ctx.env, reversal)
        await db.prepare("UPDATE undo_snapshots SET status = 'reversed', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      } else {
        if (String(snap.status) !== 'reversed') throw new Error('This attribution is already in place; there is nothing to redo.')
        const name = await applySupplierBackfillRedo(ctx.env, reversal)
        // Keep the snapshot's cached name current for a future undo's label.
        if (name != null && name !== reversal.supplierName) {
          await db.prepare("UPDATE undo_snapshots SET payload_json = @payload, updated_at = CURRENT_TIMESTAMP WHERE id = @id")
            .run({ payload: JSON.stringify({ ...reversal, supplierName: name }), id: snapshotId })
        }
        await db.prepare("UPDATE undo_snapshots SET status = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = @id").run({ id: snapshotId })
      }

      await audit(
        ctx.env, ctx.user?.id ?? null, ctx.user?.name ?? null,
        ctx.direction === 'undo' ? 'action_undo' : 'action_redo',
        'product', reversal.productId ?? null,
        { via: 'undo_applier', applier: 'supplier.backfill', supplierId: reversal.supplierId, lots: (reversal.lots || []).length },
      )
      await broadcast(ctx.env, 'products', { action: 'update' })
      await broadcast(ctx.env, 'inventory', { action: 'update' })
    },
  },
}

// Returns the applier a payload opts into, or null when the payload names no
// registered applier (the fall-through-to-client-replay case).
export function resolveUndoApplier(payload: Record<string, unknown> | null | undefined): { name: string; permission: string; action?: string; run: UndoApplier } | null {
  if (!payload || typeof payload !== 'object') return null
  const name = typeof payload.applier === 'string' ? payload.applier : ''
  const def = name ? APPLIERS[name] : undefined
  return def ? { name, permission: def.permission, action: def.action, run: def.run } : null
}

// Whether a stored action_history row's NEXT transition can be replayed by the
// Worker itself: an 'undoable' row's next transition is an undo (replaying its
// undo_payload), a 'redoable' row's is a redo (redo_payload) -- any other
// status has no next transition. This is what lets a RELOADED page (no live
// closure) still offer a real Undo/Redo button for the row: actionability is a
// property of the stored payload, not of the tab that recorded it.
export function isServerReplayable(
  row: { reversible?: unknown; status?: unknown },
  undoPayload: Record<string, unknown> | null | undefined,
  redoPayload: Record<string, unknown> | null | undefined,
): boolean {
  if (!Number(row?.reversible || 0)) return false
  const status = String(row?.status || '').toLowerCase()
  if (status === 'undoable') return !!resolveUndoApplier(undoPayload)
  if (status === 'redoable') return !!resolveUndoApplier(redoPayload)
  return false
}

// Exposed for tests: the set of applier names the Worker can execute today.
export function registeredUndoAppliers(): string[] {
  return Object.keys(APPLIERS)
}
