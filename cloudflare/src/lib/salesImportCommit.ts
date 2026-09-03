import type { D1Compat } from './db'
import { normalizeClientReceiptNumber, uniqueBusinessDateTimeNumber } from './receiptNumber'
import { RETURN_STATUSES } from './salesStatus'

// 100, not 50, since Part 388: the real Aug-28 sales history holds three
// genuine receipts of 86/58/55 lines (big wholesale orders) that the old
// 50-line cap rejected wholesale -- measured, the only three receipts the
// full-migration simulation could not store. 100 admits every real
// receipt seen while still bounding a malformed group; the Workers-Paid
// plan's raised cpu_ms makes the larger atomic write comfortable.
export const MAX_HISTORICAL_SALE_LINES = 100

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
  // `accrueLoyalty` is the import-time choice the operator makes on the
  // review screen (default OFF -- migrated history should not inflate
  // balances, which are summed from sales). Set true only when the operator
  // explicitly opts a sales import into earning points.
  input: { jobId: string; rowNumber: number; data: SaleImportData; nowIso: string; accrueLoyalty?: boolean },
): Promise<HistoricalSaleCommitResult> {
  const jobId = String(input.jobId || '').trim()
  const rowNumber = Number(input.rowNumber)
  const d = input.data
  if (!jobId) throw new Error('Import job id is required')
  if (!Number.isSafeInteger(rowNumber) || rowNumber <= 0) throw new Error('Sale import row number is invalid')
  if (!Array.isArray(d.items) || d.items.length === 0) throw new Error(`Sale on row ${rowNumber} has no items`)
  if (d.items.length > MAX_HISTORICAL_SALE_LINES) {
    // "Safety limit", no plan name: the constant's own comment above holds
    // the real bound (largest genuine receipt = 86 lines; malformed groups
    // stay rejected) -- naming a billing plan in the operator-facing error
    // went stale the day the plan changed (A4).
    throw new Error(`Sale on row ${rowNumber} exceeds the ${MAX_HISTORICAL_SALE_LINES}-line safety limit; split it into smaller receipts.`)
  }

  const groupKey = `row:${rowNumber}`
  const clientRequestId = `sales-import:${jobId}:${rowNumber}`
  const existing = await db.prepare(`
    SELECT status FROM import_sales_commits WHERE job_id = @job_id AND group_key = @group_key
  `).get<{ status: string }>({ job_id: jobId, group_key: groupKey })
  if (existing?.status === 'applied') return { alreadyApplied: true, clientRequestId }

  // A sales CSV's receipt_number column carries whatever the source system
  // called the order -- very often the old system's `NNNNNN@YYYY-MM-DD`
  // invoice label, which is exactly the shape the 2026-09-02 reconciliation
  // pack put on 15,004 live rows (migration 0107 repaired those). An import
  // must not be able to put it back. A foreign label is preserved in
  // legacy_receipt_number -- it is the operator's own key back to the source
  // file, and sales search folds the column into its haystack -- while the
  // sale itself gets a business receipt id minted from the sale's OWN moment,
  // so an imported 2024 receipt reads like the POS would have minted it that
  // day, not like the day the import ran.
  const createdAt = d.created_at || input.nowIso
  const suppliedReceipt = typeof d.receipt_number === 'string' ? d.receipt_number.trim() : ''
  const ownReceipt = normalizeClientReceiptNumber(suppliedReceipt)
  const mintMoment = new Date(createdAt)
  const receiptNumber = ownReceipt || await uniqueBusinessDateTimeNumber(
    '',
    async (candidate) => !!(await db.prepare('SELECT 1 AS hit FROM sales WHERE receipt_number = ? LIMIT 1').get([candidate])),
    Number.isNaN(mintMoment.getTime()) ? new Date(input.nowIso) : mintMoment,
  )
  const legacyReceiptNumber = ownReceipt ? null : suppliedReceipt || null

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
            delivery_actual_cost_usd, delivery_actual_cost_khr,
            loyalty_accrual, sale_status, items, created_at, client_request_id,
            legacy_receipt_number
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
            @delivery_actual_cost_usd, @delivery_actual_cost_khr,
            @loyalty_accrual, @sale_status, @items_json, @created_at, @client_request_id,
            @legacy_receipt_number
          WHERE ${pendingGuard}`,
    // Imported sales default to NOT earning loyalty points -- the balance is
    // computed by summing sales, so migrated old-system receipts would
    // otherwise inflate every matched customer's balance (migration 0061).
    // The operator can opt a specific import INTO accrual on the review
    // screen (input.accrueLoyalty), keeping the choice in their hands.
    params: {
      ...common,
      ...d,
      receipt_number: receiptNumber,
      legacy_receipt_number: legacyReceiptNumber,
      loyalty_accrual: input.accrueLoyalty ? 1 : 0,
      items_json: JSON.stringify(d.items),
      created_at: createdAt,
    },
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
            SELECT (SELECT id FROM sales WHERE client_request_id = @client_request_id AND client_request_id <> ''),
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
      reason: `Imported as ${d.sale_status} (receipt ${receiptNumber}${legacyReceiptNumber ? `, source ${legacyReceiptNumber}` : ''})`,
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
      // 0084: the historical line's recorded lot (when it had one) is the
      // lot the restock above bumped -- stamp it; NULL otherwise.
      sql: `INSERT INTO inventory_movements
              (product_id, product_name, branch_id, movement_type, quantity, reason, created_at, batch_id)
            SELECT @product_id, @product_name, @branch_id, 'return', @returned_quantity, @reason, @updated_at, @batch_id
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
