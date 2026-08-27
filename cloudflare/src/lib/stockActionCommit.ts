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
