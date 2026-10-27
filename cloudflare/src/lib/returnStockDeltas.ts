// Fixed-count stock writes for a return: the shared helper behind a grouped cancel/restore (lib/returnBulkAction.ts) and a manual
// edit of a current-format return's stock handling (lib/returnEditV1.ts). Moved out of returnBulkAction.ts in 6.0.997 so both
// writers move branch_stock, the lot ledger (branch_batch_stock) and the products total through ONE set of statements.
import { productStockGuardStatement } from './productStockGuard'
import type { SessionUser } from './auth'
import { actorSnapshot } from './actorSnapshot'

type Row = Record<string, unknown>
export type Statement = { sql: string; params: Record<string, unknown> }

export type StockDelta = {
  productId: number
  productName: string | null
  branchId: number
  batchId: number | null
  damagedLotId: number | null
  quantity: number
  costUsd: number | null
  costKhr: number | null
  movementType: string
  // Present only when the line was recorded at a branch that has since been retired and the stock moved at its
  // active successor (branchId is then the successor; older snapshots simply lack these): the branch the stock
  // really moved at, and the label the return was made under.
  branchName?: string | null
  addressed?: string | null
}

/** The member shape the helper needs: a return id, its scope and the stock deltas it carries (returnBulkAction.ts Member fits). */
export type StockMember = { id: number; scope: 'customer' | 'supplier'; stock: StockDelta[] }

export function guard(predicate: string, params: Row = {}): Statement {
  return { sql: `INSERT INTO return_bulk_guards(guard_value) SELECT CASE WHEN (${predicate}) THEN 1 ELSE 0 END`, params }
}

export function statusMovementType(scope: StockMember['scope'], quantity: number): string {
  if (scope === 'supplier') return quantity > 0 ? 'supplier_return_reversal' : 'supplier_return'
  return quantity > 0 ? 'return' : 'return_reversal'
}

// 6.0.966: the stock of every member moves in a FIXED number of statements (about eight), however many lines and linked take-backs the action carries.
// A Free invocation allows 50 D1 queries and the old shape spent 6-7 on every stock line, so a cancel of a 5-line exchange could not fit. Each statement
// is one set-based write over a JSON array of the deltas, grouped to the key it writes (product, product + branch, lot + branch); the movements stay one
// row per delta. The guards check the END state of each key (stock + the net delta >= 0), which is what the one-by-one order was enforcing. Damaged-stock
// lots are rare and keep their own per-lot statements.
const roundQuantity = (value: number): number => Math.round(value * 1e9) / 1e9
const j = (path: string, alias = 'x'): string => `json_extract(${alias}.value,'$.${path}')`

/** reason: the movement rows' reason text; the grouped status action keeps its own wording by default. */
export function stockStatements(members: readonly StockMember[], direction: 1 | -1, user: SessionUser, stamp: string, reason?: string): Statement[] {
  type Plain = { product: number; name: string | null; branch: number; branchName: string | null; addressed: string | null; batch: number | null; q: number; usd: number | null; khr: number | null; type: string; returnId: number }
  const plain: Plain[] = []
  const lots: Array<{ member: StockMember; delta: StockDelta; quantity: number }> = []
  for (const member of members) {
    for (const delta of member.stock) {
      const quantity = delta.quantity * direction
      if (delta.damagedLotId) { lots.push({ member, delta, quantity }); continue }
      plain.push({ product: Number(delta.productId), name: delta.productName, branch: Number(delta.branchId), branchName: delta.addressed ? delta.branchName ?? null : null, addressed: delta.addressed ?? null,
        batch: delta.batchId ? Number(delta.batchId) : null, q: quantity, usd: delta.costUsd, khr: delta.costKhr, type: statusMovementType(member.scope, quantity), returnId: member.id })
    }
  }
  const positive = new Set<number>()
  for (const row of plain) if (row.q > 0) positive.add(row.product)
  for (const lot of lots) if (lot.quantity > 0) positive.add(Number(lot.delta.productId))
  const out: Statement[] = []
  if (positive.size) out.push(productStockGuardStatement([...positive], 'active'))
  if (plain.length) {
    const products = new Map<number, number>()
    const pairs = new Map<string, { product: number; branch: number; q: number }>()
    const batches = new Map<string, { batch: number; product: number; branch: number; q: number; raise: number }>()
    for (const row of plain) {
      products.set(row.product, roundQuantity((products.get(row.product) ?? 0) + row.q))
      const pairKey = `${row.product}:${row.branch}`
      const pair = pairs.get(pairKey) ?? { product: row.product, branch: row.branch, q: 0 }
      pair.q = roundQuantity(pair.q + row.q); pairs.set(pairKey, pair)
      if (row.batch) {
        const batchKey = `${row.batch}:${row.branch}`
        const lot = batches.get(batchKey) ?? { batch: row.batch, product: row.product, branch: row.branch, q: 0, raise: 0 }
        lot.q = roundQuantity(lot.q + row.q); if (row.q > 0) lot.raise = 1; batches.set(batchKey, lot)
      }
    }
    const productRows = JSON.stringify([...products].map(([id, q]) => ({ id, q })))
    const pairRows = JSON.stringify([...pairs.values()])
    const batchRows = JSON.stringify([...batches.values()])
    const lotProducts = JSON.stringify([...new Set(plain.filter((row) => row.batch).map((row) => `${row.batch}:${row.product}`))].map((pair) => { const [batch, product] = pair.split(':').map(Number); return { batch, product } }))
    const branchIds = JSON.stringify([...new Set(plain.map((row) => row.branch))])
    out.push(guard(`NOT EXISTS(SELECT 1 FROM json_each(@products) x WHERE NOT EXISTS(SELECT 1 FROM products WHERE id=${j('id')} AND stock_quantity+${j('q')}>=0))
      AND NOT EXISTS(SELECT 1 FROM json_each(@branches) x WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=x.value))
      AND NOT EXISTS(SELECT 1 FROM json_each(@pairs) x WHERE ${j('q')}<0 AND NOT EXISTS(SELECT 1 FROM branch_stock WHERE product_id=${j('product')} AND branch_id=${j('branch')} AND quantity+${j('q')}>=0))
      AND NOT EXISTS(SELECT 1 FROM json_each(@lotProducts) x WHERE NOT EXISTS(SELECT 1 FROM product_batches WHERE id=${j('batch')} AND variant_product_id=${j('product')}))
      AND NOT EXISTS(SELECT 1 FROM json_each(@batches) x WHERE ${j('q')}<0 AND NOT EXISTS(SELECT 1 FROM branch_batch_stock WHERE batch_id=${j('batch')} AND branch_id=${j('branch')} AND quantity+${j('q')}>=0))`,
    { products: productRows, branches: branchIds, pairs: pairRows, batches: batchRows, lotProducts }))
    // A proposed row must pass CHECK(quantity >= 0) before SQLite looks for the conflict, so a negative net rides in as 0 and the conflict branch adds the real figure.
    out.push({
      sql: `INSERT INTO branch_stock(product_id,branch_id,quantity)
        SELECT ${j('product')},${j('branch')},MAX(${j('q')},0) FROM json_each(@pairs) x WHERE ${j('q')}<>0
        ON CONFLICT(product_id,branch_id) DO UPDATE SET quantity=branch_stock.quantity+(SELECT ${j('q', 'd')} FROM json_each(@pairs) d WHERE ${j('product', 'd')}=excluded.product_id AND ${j('branch', 'd')}=excluded.branch_id)`,
      params: { pairs: pairRows },
    })
    out.push({
      sql: `UPDATE products SET stock_quantity=stock_quantity+(SELECT ${j('q', 'd')} FROM json_each(@products) d WHERE ${j('id', 'd')}=products.id), updated_at=@stamp
        WHERE id IN (SELECT ${j('id', 'd')} FROM json_each(@products) d)`,
      params: { products: productRows, stamp },
    })
    if (batches.size) {
      // Customer restores and supplier-return reversals must make the exact archived lot selectable before adding stock, including undo/redo.
      if ([...batches.values()].some((lot) => lot.raise)) {
        out.push({
          sql: `UPDATE product_batches SET is_active=1 WHERE is_active IS NOT 1 AND id IN (SELECT ${j('batch', 'd')} FROM json_each(@batches) d WHERE ${j('raise', 'd')}=1)`,
          params: { batches: batchRows },
        })
      }
      out.push({
        sql: `INSERT INTO branch_batch_stock(batch_id,branch_id,quantity,updated_at)
          SELECT ${j('batch')},${j('branch')},MAX(${j('q')},0),@stamp FROM json_each(@batches) x WHERE ${j('q')}<>0
          ON CONFLICT(batch_id,branch_id) DO UPDATE SET quantity=branch_batch_stock.quantity+(SELECT ${j('q', 'd')} FROM json_each(@batches) d WHERE ${j('batch', 'd')}=excluded.batch_id AND ${j('branch', 'd')}=excluded.branch_id), updated_at=@stamp`,
        params: { batches: batchRows, stamp },
      })
    }
    out.push({
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id,branch_name,addressed_branch_name,movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
        SELECT ${j('product', 'm')},${j('name', 'm')},${j('branch', 'm')},${j('branchName', 'm')},${j('addressed', 'm')},${j('type', 'm')},${j('q', 'm')},${j('usd', 'm')},${j('khr', 'm')},
          ROUND(${j('usd', 'm')}*ABS(${j('q', 'm')}),4),ROUND(${j('khr', 'm')}*ABS(${j('q', 'm')}),4),@reason,${j('returnId', 'm')},@userId,@userName,${j('batch', 'm')}
        FROM json_each(@movements) m ORDER BY CAST(m.key AS INTEGER)`,
      params: { movements: JSON.stringify(plain), reason: reason ?? `${direction > 0 ? 'Apply' : 'Undo'} grouped return status`, userId: user.id ?? null, userName: actorSnapshot(user) },
    })
  }
  for (const { member, delta, quantity } of lots) {
    const params = { product: delta.productId, branch: delta.branchId, batch: delta.batchId, lot: delta.damagedLotId, quantity, stamp }
    out.push(guard('EXISTS(SELECT 1 FROM damaged_stock_lots WHERE id=@lot AND return_id=@returnId AND product_id=@product AND branch_id IS @branch AND (batch_id IS NULL OR EXISTS(SELECT 1 FROM product_batches WHERE id=damaged_stock_lots.batch_id AND variant_product_id=@product)) AND quantity_remaining+@quantity BETWEEN 0 AND quantity)', { ...params, returnId: member.id }))
    out.push({ sql: 'UPDATE damaged_stock_lots SET quantity_remaining=quantity_remaining+@quantity, updated_at=@stamp WHERE id=@lot', params })
    out.push({
      sql: `INSERT INTO inventory_movements(product_id,product_name,branch_id${delta.addressed ? ',branch_name,addressed_branch_name' : ''},movement_type,quantity,unit_cost_usd,unit_cost_khr,total_cost_usd,total_cost_khr,reason,reference_id,user_id,user_name,batch_id)
            VALUES(@product,@name,@branch${delta.addressed ? ',@branchName,@addressed' : ''},@type,@quantity,@usd,@khr,ROUND(@usd*ABS(@quantity),4),ROUND(@khr*ABS(@quantity),4),@reason,@returnId,@userId,@userName,@batch)`,
      params: {
        product: delta.productId,
        name: delta.productName,
        branch: delta.branchId,
        ...(delta.addressed ? { branchName: delta.branchName ?? null, addressed: delta.addressed } : {}),
        type: quantity > 0 ? 'damage_in' : 'damage_reversal',
        quantity,
        usd: delta.costUsd,
        khr: delta.costKhr,
        reason: reason ?? `${direction > 0 ? 'Apply' : 'Undo'} grouped return status`,
        returnId: member.id,
        userId: user.id ?? null,
        userName: actorSnapshot(user),
        batch: delta.batchId,
      },
    })
  }
  return out
}
