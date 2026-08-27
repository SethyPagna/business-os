import type { D1Compat } from './db'
import { dateToBatchCode, normalizeToIsoDate } from './batchCode'

export interface UnifiedStockAddInput {
  jobId: string
  rowNumber: number
  productId: number
  productName: string
  branchId: number
  branchName: string
  quantity: number
  date: string
  batchLabel?: string | null
  sellingPriceUsd?: number | null
  vipPriceUsd?: number | null
  costPriceUsd?: number | null
}

export interface UnifiedStockCommitResult {
  actionKey: string
  applied: boolean
  alreadyApplied: boolean
}

export interface UnifiedStockSaleLine {
  rowNumber: number
  productId: number
  productName: string
  branchId: number
  branchName: string
  quantity: number
  sellingPriceUsd: number
  costPriceUsd?: number | null
  batchLabel?: string | null
}

export interface UnifiedStockSaleInput {
  jobId: string
  saleGroupKey: string
  date: string
  lines: UnifiedStockSaleLine[]
}

const MAX_SALE_LINES = 8
const MAX_SALE_ALLOCATIONS = 12
const MAX_ALLOCATIONS_PER_LINE = 8

export interface UnifiedStockCreateProductInput {
  jobId: string
  identityKey: string
  productName: string
  barcode?: string | null
  sellingPriceUsd?: number | null
  vipPriceUsd?: number | null
  costPriceUsd?: number | null
}

function positiveFinite(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be greater than 0`)
  return parsed
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = positiveFinite(value, field)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`)
  return parsed
}

function optionalMoney(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Price must be a non-negative finite number')
  return Math.round(parsed * 100) / 100
}

function requiredMoney(value: unknown, field: string): number {
  const parsed = optionalMoney(value)
  if (parsed == null) throw new Error(`${field} is required`)
  return parsed
}

function normalizedBatchLabel(value: unknown): string {
  return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 120).toLowerCase().replace(/\s+/g, ' ')
}

function batchIdentity(date: string, label: string | null | undefined): { batchKey: string; lotCode: string; receivedAt: string } {
  const receivedAt = normalizeToIsoDate(date)
  if (!receivedAt) throw new Error('Stock action date is invalid')
  const datedCode = dateToBatchCode(receivedAt)
  const explicit = String(label || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 120)
  const lotCode = explicit || String(datedCode)
  // Keys are normalized only for identity; retain the person's label for
  // display in lot_code. Same label with case/spacing differences is one lot.
  const batchKey = lotCode.toLowerCase().replace(/\s+/g, ' ')
  return { batchKey, lotCode, receivedAt }
}

function pendingGuard(): string {
  return `EXISTS (
    SELECT 1 FROM import_stock_action_commits
    WHERE job_id = @jobId AND action_key = @actionKey AND status = 'pending'
  )`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function ensureUnifiedStockProduct(db: D1Compat, input: UnifiedStockCreateProductInput): Promise<{ productId: number; created: boolean; clientRequestId: string }> {
  const jobId = String(input.jobId || '').trim()
  const identityKey = String(input.identityKey || '').trim()
  const productName = String(input.productName || '').trim()
  if (!jobId) throw new Error('Import job id is required')
  if (!identityKey) throw new Error('Product identity is required')
  if (!productName) throw new Error('Product name is required')

  const identityHash = await sha256Hex(`${jobId}\n${identityKey}`)
  const clientRequestId = `stock-import:${jobId}:${identityHash}`
  let product = await db.prepare(`
    SELECT id FROM products WHERE client_request_id = @clientRequestId
  `).get<{ id: number }>({ clientRequestId })
  let created = false
  if (!product) {
    const inserted = await db.prepare(`
      INSERT OR IGNORE INTO products (
        name, barcode, unit, selling_price_usd, special_price_usd, cost_price_usd,
        stock_quantity, is_active, client_request_id, created_at, updated_at
      ) VALUES (
        @productName, @barcode, 'pcs', @sellingPriceUsd, @vipPriceUsd, @costPriceUsd,
        0, 1, @clientRequestId, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `).run({
      productName,
      barcode: String(input.barcode || '').trim() || null,
      sellingPriceUsd: optionalMoney(input.sellingPriceUsd) ?? 0,
      vipPriceUsd: optionalMoney(input.vipPriceUsd) ?? 0,
      costPriceUsd: optionalMoney(input.costPriceUsd) ?? 0,
      clientRequestId,
    })
    created = inserted.changes === 1
    product = await db.prepare(`
      SELECT id FROM products WHERE client_request_id = @clientRequestId
    `).get<{ id: number }>({ clientRequestId })
  }
  const productId = Number(product?.id || 0)
  if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Could not resolve the imported product after creation')

  // Safe to repeat after any interruption. This is deliberately separate
  // from the product INSERT because the generated id must be read first;
  // INSERT OR IGNORE makes the second half retry-idempotent as well.
  await db.prepare(`
    INSERT OR IGNORE INTO branch_stock (product_id, branch_id, quantity)
    SELECT @productId, id, 0 FROM branches WHERE is_active = 1
  `).run({ productId })
  return { productId, created, clientRequestId }
}

export async function applyUnifiedStockAdd(db: D1Compat, input: UnifiedStockAddInput): Promise<UnifiedStockCommitResult> {
  const jobId = String(input.jobId || '').trim()
  if (!jobId) throw new Error('Import job id is required')
  const rowNumber = positiveInteger(input.rowNumber, 'Row number')
  const productId = positiveInteger(input.productId, 'Product id')
  const branchId = positiveInteger(input.branchId, 'Branch id')
  const quantity = positiveFinite(input.quantity, 'Quantity')
  const productName = String(input.productName || '').trim()
  const branchName = String(input.branchName || '').trim()
  if (!productName) throw new Error('Product name is required')
  if (!branchName) throw new Error('Branch name is required')

  const actionKey = `row:${rowNumber}:add:branch:${branchId}`
  const existing = await db.prepare(`
    SELECT status FROM import_stock_action_commits WHERE job_id = @jobId AND action_key = @actionKey
  `).get<{ status: string }>({ jobId, actionKey })
  if (existing?.status === 'applied') return { actionKey, applied: true, alreadyApplied: true }

  const { batchKey, lotCode, receivedAt } = batchIdentity(input.date, input.batchLabel)
  const nextBatch = await db.prepare(`
    SELECT COALESCE(MAX(batch_number), 0) + 1 AS next
    FROM product_batches WHERE variant_product_id = @productId
  `).get<{ next: number }>({ productId })
  const batchNumber = Math.max(1, Number(nextBatch?.next || 1))
  const guard = pendingGuard()
  const params = {
    jobId, actionKey, rowNumber, productId, productName, branchId, branchName,
    quantity, batchKey, lotCode, receivedAt, batchNumber,
    sellingPriceUsd: optionalMoney(input.sellingPriceUsd),
    vipPriceUsd: optionalMoney(input.vipPriceUsd),
    costPriceUsd: optionalMoney(input.costPriceUsd),
    reason: `Unified stock import ${jobId}, row ${rowNumber}`,
  }

  await db.batch([
    {
      sql: `INSERT OR IGNORE INTO import_stock_action_commits
              (job_id, action_key, row_number, action_kind, status)
            VALUES (@jobId, @actionKey, @rowNumber, 'add', 'pending')`,
      params,
    },
    {
      sql: `INSERT OR IGNORE INTO product_batches
              (variant_product_id, batch_key, lot_code, received_at, is_active, notes, batch_number)
            SELECT @productId, @batchKey, @lotCode, @receivedAt, 1, @reason, @batchNumber
            WHERE ${guard}`,
      params,
    },
    {
      sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
            SELECT id, @branchId, @quantity FROM product_batches
            WHERE variant_product_id = @productId AND batch_key = @batchKey AND ${guard}
            ON CONFLICT(batch_id, branch_id) DO UPDATE SET
              quantity = branch_batch_stock.quantity + excluded.quantity,
              updated_at = CURRENT_TIMESTAMP`,
      params,
    },
    {
      sql: `INSERT INTO branch_stock (product_id, branch_id, quantity)
            SELECT @productId, @branchId, @quantity WHERE ${guard}
            ON CONFLICT(product_id, branch_id) DO UPDATE SET
              quantity = branch_stock.quantity + excluded.quantity`,
      params,
    },
    {
      sql: `UPDATE products SET
              stock_quantity = COALESCE(stock_quantity, 0) + @quantity,
              selling_price_usd = COALESCE(@sellingPriceUsd, selling_price_usd),
              special_price_usd = COALESCE(@vipPriceUsd, special_price_usd),
              cost_price_usd = COALESCE(@costPriceUsd, cost_price_usd),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = @productId AND ${guard}`,
      params,
    },
    {
      sql: `INSERT INTO inventory_movements
              (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, created_at)
            SELECT @productId, @productName, @branchId, @branchName, 'add', @quantity, @reason, @receivedAt
            WHERE ${guard}`,
      params,
    },
    {
      sql: `UPDATE import_stock_action_commits SET status = 'applied', applied_at = CURRENT_TIMESTAMP
            WHERE job_id = @jobId AND action_key = @actionKey AND status = 'pending'`,
      params,
    },
  ])

  const committed = await db.prepare(`
    SELECT status FROM import_stock_action_commits WHERE job_id = @jobId AND action_key = @actionKey
  `).get<{ status: string }>({ jobId, actionKey })
  if (committed?.status !== 'applied') throw new Error('Stock action did not commit')
  return { actionKey, applied: true, alreadyApplied: false }
}

interface AvailableBatch {
  id: number
  batch_key: string
  lot_code: string | null
  expiry_date: string | null
  received_at: string | null
  quantity: number
  cost_price_usd: number
}

interface SaleAllocation {
  batchId: number
  quantity: number
  lotCode: string | null
  expiryDate: string | null
}

interface NormalizedSaleLine extends UnifiedStockSaleLine {
  rowNumber: number
  productId: number
  productName: string
  branchId: number
  branchName: string
  quantity: number
  sellingPriceUsd: number
  costPriceUsd: number | null
  batchLabel: string
  allocations: SaleAllocation[]
}

/**
 * Atomically commits one `sale`/`saleN` import group.
 *
 * The strict bounds are intentional Free-plan safeguards: parsing may accept
 * a large file, but one D1 transaction never grows without limit. Callers can
 * report the rejected group and ask the operator to split it rather than
 * risking Worker CPU exhaustion or a partially recorded sale.
 */
export async function applyUnifiedStockSale(db: D1Compat, input: UnifiedStockSaleInput): Promise<UnifiedStockCommitResult> {
  const jobId = String(input.jobId || '').trim()
  const saleGroupKey = String(input.saleGroupKey || '').trim().slice(0, 120)
  if (!jobId) throw new Error('Import job id is required')
  if (!saleGroupKey) throw new Error('Sale group is required')
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new Error('Sale group has no lines')
  if (input.lines.length > MAX_SALE_LINES) throw new Error(`Sale group exceeds the ${MAX_SALE_LINES}-line safety limit`)
  const soldAt = normalizeToIsoDate(input.date)
  if (!soldAt) throw new Error('Sale date is invalid')

  const groupHash = await sha256Hex(saleGroupKey)
  const actionKey = `sale:${groupHash.slice(0, 32)}`
  const clientRequestId = `stock-import-sale:${jobId}:${groupHash}`
  const existing = await db.prepare(`
    SELECT status FROM import_stock_action_commits WHERE job_id = @jobId AND action_key = @actionKey
  `).get<{ status: string }>({ jobId, actionKey })
  if (existing?.status === 'applied') return { actionKey, applied: true, alreadyApplied: true }

  const seenRows = new Set<number>()
  const lines: NormalizedSaleLine[] = input.lines.map((line) => {
    const rowNumber = positiveInteger(line.rowNumber, 'Row number')
    if (seenRows.has(rowNumber)) throw new Error(`Sale group repeats row ${rowNumber}`)
    seenRows.add(rowNumber)
    const productName = String(line.productName || '').trim().slice(0, 240)
    const branchName = String(line.branchName || '').trim().slice(0, 160)
    if (!productName) throw new Error(`Product name is required on row ${rowNumber}`)
    if (!branchName) throw new Error(`Branch name is required on row ${rowNumber}`)
    return {
      ...line,
      rowNumber,
      productId: positiveInteger(line.productId, 'Product id'),
      productName,
      branchId: positiveInteger(line.branchId, 'Branch id'),
      branchName,
      quantity: positiveFinite(line.quantity, 'Quantity'),
      sellingPriceUsd: requiredMoney(line.sellingPriceUsd, 'Selling price'),
      costPriceUsd: optionalMoney(line.costPriceUsd),
      batchLabel: normalizedBatchLabel(line.batchLabel),
      allocations: [],
    }
  })

  // Read each product/branch once, then reserve its available lots in memory
  // in row order. The live quantities are asserted again *inside* db.batch;
  // these reads decide allocation shape, not transaction safety.
  const pools = new Map<string, AvailableBatch[]>()
  const productCosts = new Map<number, number>()
  const poolKeys = [...new Set(lines.map((line) => `${line.productId}:${line.branchId}`))]
  for (const poolKey of poolKeys) {
    const [productId, branchId] = poolKey.split(':').map(Number)
    const rows = await db.prepare(`
      SELECT pb.id, pb.batch_key, pb.lot_code, pb.expiry_date, pb.received_at,
             COALESCE(bbs.quantity, 0) AS quantity,
             COALESCE(p.cost_price_usd, 0) AS cost_price_usd
      FROM products p
      LEFT JOIN product_batches pb ON pb.variant_product_id = p.id AND pb.is_active = 1
      LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = @branchId
      WHERE p.id = @productId
      ORDER BY (COALESCE(bbs.quantity, 0) > 0) DESC,
               (pb.expiry_date IS NULL), pb.expiry_date, pb.received_at, pb.id
      LIMIT 25
    `).all<AvailableBatch>({ productId, branchId })
    if (rows.length === 0) throw new Error(`Product ${productId} does not exist`)
    productCosts.set(productId, Number(rows[0]?.cost_price_usd || 0))
    pools.set(poolKey, rows.filter((row) => Number(row.id) > 0).map((row) => ({ ...row, quantity: Math.max(0, Number(row.quantity || 0)) })))
  }

  let allocationCount = 0
  // Explicit operator choices reserve their named batch before automatic
  // FIFO lines draw from the same pool. Otherwise an earlier unlabelled row
  // could consume that stock and make a valid explicit choice fail.
  const allocationOrder = [
    ...lines.filter((line) => line.batchLabel),
    ...lines.filter((line) => !line.batchLabel),
  ]
  for (const line of allocationOrder) {
    const pool = pools.get(`${line.productId}:${line.branchId}`) || []
    if (pool.length === 0) continue // Legacy product without batch history: aggregate stock is authoritative.
    let remaining = line.quantity
    const candidates = line.batchLabel
      ? pool.filter((batch) => normalizedBatchLabel(batch.batch_key || batch.lot_code) === line.batchLabel)
      : pool
    if (line.batchLabel && candidates.length === 0) throw new Error(`Row ${line.rowNumber} batch was not found`)
    for (const batch of candidates) {
      if (remaining <= 0) break
      if (batch.quantity <= 0) continue
      const take = Math.min(remaining, batch.quantity)
      line.allocations.push({ batchId: Number(batch.id), quantity: take, lotCode: batch.lot_code, expiryDate: batch.expiry_date })
      batch.quantity -= take
      remaining -= take
    }
    if (remaining > 0.0000001) throw new Error(`Row ${line.rowNumber} has insufficient batch stock`)
    if (line.allocations.length > MAX_ALLOCATIONS_PER_LINE) throw new Error(`Row ${line.rowNumber} exceeds the ${MAX_ALLOCATIONS_PER_LINE}-batch safety limit`)
    allocationCount += line.allocations.length
    if (allocationCount > MAX_SALE_ALLOCATIONS) throw new Error(`Sale group exceeds the ${MAX_SALE_ALLOCATIONS}-allocation safety limit`)
  }

  type Aggregate = { productId: number; productName: string; branchId: number; branchName: string; quantity: number }
  const branchAggregates = new Map<string, Aggregate>()
  const productTotals = new Map<number, number>()
  for (const line of lines) {
    const key = `${line.productId}:${line.branchId}`
    const aggregate = branchAggregates.get(key) || { productId: line.productId, productName: line.productName, branchId: line.branchId, branchName: line.branchName, quantity: 0 }
    aggregate.quantity += line.quantity
    branchAggregates.set(key, aggregate)
    productTotals.set(line.productId, (productTotals.get(line.productId) || 0) + line.quantity)
  }
  const subtotalUsd = Math.round(lines.reduce((sum, line) => sum + line.quantity * line.sellingPriceUsd, 0) * 100) / 100
  const uniqueBranches = [...new Set(lines.map((line) => line.branchId))]
  const firstRow = Math.min(...lines.map((line) => line.rowNumber))
  const guard = pendingGuard()
  const common = { jobId, actionKey, clientRequestId }
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [{
    sql: `INSERT OR IGNORE INTO import_stock_action_commits
            (job_id, action_key, row_number, action_kind, status)
          VALUES (@jobId, @actionKey, @rowNumber, 'sale', 'pending')`,
    params: { ...common, rowNumber: firstRow },
  }]

  for (const aggregate of branchAggregates.values()) {
    const guardKey = `stock:${aggregate.productId}:${aggregate.branchId}`
    statements.push({
      sql: `INSERT INTO import_stock_action_guards (job_id, action_key, guard_key, guard_value)
            SELECT @jobId, @actionKey, @guardKey,
              CASE WHEN COALESCE((SELECT quantity FROM branch_stock
                WHERE product_id = @productId AND branch_id = @branchId), 0) >= @quantity THEN 1 ELSE 0 END
            WHERE ${guard}`,
      params: { ...common, guardKey, ...aggregate },
    })
  }
  const batchGuardTotals = new Map<string, { batchId: number; branchId: number; quantity: number }>()
  for (const line of lines) {
    for (const allocation of line.allocations) {
      const key = `${allocation.batchId}:${line.branchId}`
      const total = batchGuardTotals.get(key) || { batchId: allocation.batchId, branchId: line.branchId, quantity: 0 }
      total.quantity += allocation.quantity
      batchGuardTotals.set(key, total)
    }
  }
  for (const total of batchGuardTotals.values()) {
    const guardKey = `batch:${total.batchId}:${total.branchId}`
    statements.push({
      sql: `INSERT INTO import_stock_action_guards (job_id, action_key, guard_key, guard_value)
            SELECT @jobId, @actionKey, @guardKey,
              CASE WHEN COALESCE((SELECT quantity FROM branch_batch_stock
                WHERE batch_id = @batchId AND branch_id = @branchId), 0) >= @quantity THEN 1 ELSE 0 END
            WHERE ${guard}`,
      params: { ...common, guardKey, ...total },
    })
  }

  const itemSnapshot = JSON.stringify(lines.map((line) => ({
    row: line.rowNumber, product_id: line.productId, product_name: line.productName,
    branch_id: line.branchId, quantity: line.quantity, price_usd: line.sellingPriceUsd,
  })))
  statements.push({
    sql: `INSERT INTO sales (
            receipt_number, client_request_id, cashier_name, branch_id, branch_name,
            payment_method, payment_currency, subtotal_usd, total_usd, amount_paid_usd,
            sale_status, notes, items, created_at, updated_at
          )
          SELECT @receiptNumber, @clientRequestId, 'Unified stock import', @branchId, @branchName,
            'Cash', 'USD', @subtotalUsd, @subtotalUsd, @subtotalUsd,
            'completed', @notes, @items, @soldAt, CURRENT_TIMESTAMP
          WHERE ${guard}`,
    params: {
      ...common,
      receiptNumber: `IMP-${soldAt.replace(/-/g, '')}-${groupHash.slice(0, 8).toUpperCase()}`,
      branchId: uniqueBranches.length === 1 ? uniqueBranches[0] : null,
      branchName: uniqueBranches.length === 1 ? lines[0].branchName : 'Multiple branches',
      subtotalUsd,
      notes: `Unified stock import ${jobId}, group ${saleGroupKey}`,
      items: itemSnapshot,
      soldAt,
    },
  })

  for (const line of lines) {
    const costPriceUsd = line.costPriceUsd ?? productCosts.get(line.productId) ?? 0
    const totalUsd = Math.round(line.quantity * line.sellingPriceUsd * 100) / 100
    const primaryAllocation = line.allocations[0]
    statements.push({
      sql: `INSERT INTO sale_items (
              sale_id, product_id, product_name, quantity, unit, applied_price_usd,
              cost_price_usd, total_usd, branch_id, price_mode, base_price_usd,
              batch_id, batch_label, batch_expiry_date
            )
            SELECT (SELECT id FROM sales WHERE client_request_id = @clientRequestId),
              @productId, @productName, @quantity, 'pcs', @sellingPriceUsd,
              @costPriceUsd, @totalUsd, @branchId, 'selling', @sellingPriceUsd,
              @batchId, @batchLabel, @batchExpiryDate
            WHERE ${guard}`,
      params: {
        ...common, ...line, costPriceUsd, totalUsd,
        batchId: primaryAllocation?.batchId ?? null,
        batchLabel: primaryAllocation?.lotCode ?? null,
        batchExpiryDate: primaryAllocation?.expiryDate ?? null,
      },
    })
    for (const allocation of line.allocations) {
      statements.push({
        sql: `INSERT INTO sale_item_batch_allocations
                (sale_item_id, batch_id, branch_id, quantity, lot_code, expiry_date)
              SELECT (
                  SELECT si.id FROM sale_items si
                  WHERE si.sale_id = (SELECT id FROM sales WHERE client_request_id = @clientRequestId)
                  ORDER BY si.id DESC LIMIT 1
                ), @batchId, @branchId, @quantity, @lotCode, @expiryDate
              WHERE ${guard}`,
        params: { ...common, ...allocation, branchId: line.branchId },
      })
      statements.push({
        sql: `UPDATE branch_batch_stock SET quantity = quantity - @quantity, updated_at = CURRENT_TIMESTAMP
              WHERE batch_id = @batchId AND branch_id = @branchId AND ${guard}`,
        params: { ...common, ...allocation, branchId: line.branchId },
      })
    }
    statements.push({
      sql: `INSERT INTO inventory_movements (
              product_id, product_name, branch_id, branch_name, movement_type,
              quantity, unit_cost_usd, total_cost_usd, reason, reference_id, created_at
            )
            SELECT @productId, @productName, @branchId, @branchName, 'sale',
              -@quantity, @costPriceUsd, @totalCostUsd, @reason,
              (SELECT id FROM sales WHERE client_request_id = @clientRequestId), @soldAt
            WHERE ${guard}`,
      params: {
        ...common, ...line, costPriceUsd,
        totalCostUsd: Math.round(costPriceUsd * line.quantity * 100) / 100,
        reason: `Unified stock import ${jobId}, group ${saleGroupKey}, row ${line.rowNumber}`,
        soldAt,
      },
    })
  }

  for (const aggregate of branchAggregates.values()) {
    statements.push({
      sql: `UPDATE branch_stock SET quantity = quantity - @quantity
            WHERE product_id = @productId AND branch_id = @branchId AND ${guard}`,
      params: { ...common, ...aggregate },
    })
  }
  for (const productId of productTotals.keys()) {
    statements.push({
      sql: `UPDATE products SET
              stock_quantity = COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id = @productId), 0),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = @productId AND ${guard}`,
      params: { ...common, productId },
    })
  }
  statements.push(
    {
      sql: `DELETE FROM import_stock_action_guards WHERE job_id = @jobId AND action_key = @actionKey AND ${guard}`,
      params: common,
    },
    {
      sql: `UPDATE import_stock_action_commits SET status = 'applied', applied_at = CURRENT_TIMESTAMP
            WHERE job_id = @jobId AND action_key = @actionKey AND status = 'pending'`,
      params: common,
    },
  )

  await db.batch(statements)
  const committed = await db.prepare(`
    SELECT status FROM import_stock_action_commits WHERE job_id = @jobId AND action_key = @actionKey
  `).get<{ status: string }>({ jobId, actionKey })
  if (committed?.status !== 'applied') throw new Error('Grouped sale did not commit')
  return { actionKey, applied: true, alreadyApplied: false }
}
