import type { D1Compat } from './db'
import { RETURN_STATUSES } from './salesStatus'

export const MAX_HISTORICAL_SALE_LINES = 50

type SaleImportData = Record<string, unknown> & {
  items: Array<Record<string, unknown>>
  sale_status: string
  receipt_number: string | null
  created_at: string | null
}

export type HistoricalSaleCommitResult = { alreadyApplied: boolean; clientRequestId: string }

const pendingGuard = `(SELECT status FROM import_sales_commits WHERE job_id = @job_id AND group_key = @group_key) = 'pending'`

/** Commit one reviewed historical receipt as an indivisible, retry-safe unit. */
export async function applyHistoricalSaleImport(
  db: D1Compat,
  input: { jobId: string; rowNumber: number; data: SaleImportData; nowIso: string },
): Promise<HistoricalSaleCommitResult> {
  const jobId = String(input.jobId || '').trim()
  const rowNumber = Number(input.rowNumber)
  const d = input.data
  if (!jobId) throw new Error('Import job id is required')
  if (!Number.isSafeInteger(rowNumber) || rowNumber <= 0) throw new Error('Sale import row number is invalid')
  if (!Array.isArray(d.items) || d.items.length === 0) throw new Error(`Sale on row ${rowNumber} has no items`)
  if (d.items.length > MAX_HISTORICAL_SALE_LINES) {
    throw new Error(`Sale on row ${rowNumber} exceeds the ${MAX_HISTORICAL_SALE_LINES}-line Free-plan safety limit; split it into smaller receipts.`)
  }

  const groupKey = `row:${rowNumber}`
  const clientRequestId = `sales-import:${jobId}:${rowNumber}`
  const existing = await db.prepare(`
    SELECT status FROM import_sales_commits WHERE job_id = @job_id AND group_key = @group_key
  `).get<{ status: string }>({ job_id: jobId, group_key: groupKey })
  if (existing?.status === 'applied') return { alreadyApplied: true, clientRequestId }

  const common = { job_id: jobId, group_key: groupKey, row_number: rowNumber, client_request_id: clientRequestId }
  const statements: Array<{ sql: string; params: Record<string, unknown> }> = [{
    sql: `INSERT OR IGNORE INTO import_sales_commits (job_id, group_key, row_number, status)
          VALUES (@job_id, @group_key, @row_number, 'pending')`,
    params: common,
  }, {
    sql: `INSERT INTO sales (
            receipt_number, cashier_id, cashier_name, branch_id, branch_name,
            customer_id, customer_name, customer_phone, customer_address,
            payment_method, payment_currency, exchange_rate, notes,
            subtotal_usd, subtotal_khr, discount_usd, discount_khr, tax_usd, tax_khr,
            total_usd, total_khr, amount_paid_usd, amount_paid_khr, change_usd, change_khr,
            membership_discount_usd, membership_discount_khr, membership_points_redeemed,
            is_delivery, delivery_contact_id, delivery_contact_name, delivery_contact_phone,
            delivery_contact_address, delivery_fee_usd, delivery_fee_khr, delivery_fee_paid_by,
            loyalty_accrual, sale_status, items, created_at, client_request_id
          )
          SELECT
            @receipt_number, @cashier_id, @cashier_name, @branch_id, @branch_name,
            @customer_id, @customer_name, @customer_phone, @customer_address,
            @payment_method, @payment_currency, @exchange_rate, @notes,
            @subtotal_usd, @subtotal_khr, @discount_usd, @discount_khr, @tax_usd, @tax_khr,
            @total_usd, @total_khr, @amount_paid_usd, @amount_paid_khr, @change_usd, @change_khr,
            @membership_discount_usd, @membership_discount_khr, @membership_points_redeemed,
            @is_delivery, @delivery_contact_id, @delivery_contact_name, @delivery_contact_phone,
            @delivery_contact_address, @delivery_fee_usd, @delivery_fee_khr, @delivery_fee_paid_by,
            @loyalty_accrual, @sale_status, @items_json, @created_at, @client_request_id
          WHERE ${pendingGuard}`,
    // Imported (historical) sales never earn loyalty points -- the balance is
    // computed by summing sales, so migrated old-system receipts would
    // otherwise inflate every matched customer's balance (migration 0061).
    params: { ...common, ...d, loyalty_accrual: 0, items_json: JSON.stringify(d.items), created_at: d.created_at || input.nowIso },
  }]

  const isReturnGroup = RETURN_STATUSES.has(d.sale_status)
  for (const item of d.items) {
    statements.push({
      sql: `INSERT INTO sale_items (
              sale_id, product_id, product_name, sku, quantity,
              applied_price_usd, applied_price_khr, total_usd, total_khr,
              cost_price_usd, cost_price_khr, base_price_usd, base_price_khr,
              product_discount_type, product_discount_label, product_discount_usd, product_discount_khr,
              manual_discount_type, manual_discount_value, manual_discount_usd, manual_discount_khr,
              branch_id, batch_id, batch_label, batch_expiry_date, returned_quantity
            )
            SELECT (SELECT id FROM sales WHERE client_request_id = @client_request_id),
              @product_id, @product_name, @sku, @quantity,
              @applied_price_usd, @applied_price_khr, @total_usd, @total_khr,
              @cost_price_usd, @cost_price_khr, @base_price_usd, @base_price_khr,
              @product_discount_type, @product_discount_label, @product_discount_usd, @product_discount_khr,
              @manual_discount_type, @manual_discount_value, @manual_discount_usd, @manual_discount_khr,
              @branch_id, @batch_id, @batch_label, @batch_expiry_date, @returned_quantity
            WHERE ${pendingGuard}`,
      params: { ...common, ...item },
    })

    const returnedQuantity = Number(item.returned_quantity) || 0
    if (!isReturnGroup || returnedQuantity <= 0) continue
    const stockParams = {
      ...common,
      ...item,
      returned_quantity: returnedQuantity,
      updated_at: input.nowIso,
      reason: `Imported as ${d.sale_status}${d.receipt_number ? ` (receipt ${d.receipt_number})` : ''}`,
    }
    statements.push({
      sql: `UPDATE products SET stock_quantity = stock_quantity + @returned_quantity, updated_at = @updated_at
            WHERE id = @product_id AND ${pendingGuard}`,
      params: stockParams,
    })
    if (item.branch_id) {
      statements.push({
        sql: `INSERT INTO branch_stock (product_id, branch_id, quantity)
              SELECT @product_id, @branch_id, @returned_quantity WHERE ${pendingGuard}
              ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = branch_stock.quantity + excluded.quantity`,
        params: stockParams,
      })
      if (item.batch_id) {
        statements.push({
          sql: `INSERT INTO branch_batch_stock (batch_id, branch_id, quantity)
                SELECT @batch_id, @branch_id, @returned_quantity WHERE ${pendingGuard}
                ON CONFLICT(batch_id, branch_id) DO UPDATE SET
                  quantity = branch_batch_stock.quantity + excluded.quantity,
                  updated_at = CURRENT_TIMESTAMP`,
          params: stockParams,
        })
      }
    }
    statements.push({
      sql: `INSERT INTO inventory_movements
              (product_id, product_name, branch_id, movement_type, quantity, reason, created_at)
            SELECT @product_id, @product_name, @branch_id, 'return', @returned_quantity, @reason, @updated_at
            WHERE ${pendingGuard}`,
      params: stockParams,
    })
  }

  statements.push({
    sql: `UPDATE import_sales_commits SET status = 'applied', applied_at = CURRENT_TIMESTAMP
          WHERE job_id = @job_id AND group_key = @group_key AND status = 'pending'`,
    params: common,
  })
  await db.batch(statements)

  const committed = await db.prepare(`
    SELECT status FROM import_sales_commits WHERE job_id = @job_id AND group_key = @group_key
  `).get<{ status: string }>({ job_id: jobId, group_key: groupKey })
  if (committed?.status !== 'applied') throw new Error('Historical sale did not commit')
  return { alreadyApplied: false, clientRequestId }
}
