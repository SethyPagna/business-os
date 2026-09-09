import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION,
  SALE_NOT_PAID_STOCK_RECOVERY_TARGET,
  validateSaleNotPaidStockRecoveryPreview,
  validateSaleNotPaidStockRecoveryResponse,
} from '../src/utils/saleNotPaidStockRecovery.ts'

const digest = 'a'.repeat(64)
const request = { target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, confirmation: SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION, manifest_sha256: digest }
const sales = [
  { id: 16952, receipt_number: '20260909-125000', status: 'awaiting_payment', line_count: 1, unit_count: 1, stock_effect: 'deduct_now' },
  { id: 16953, receipt_number: '20260909-125100', status: 'awaiting_payment', line_count: 2, unit_count: 2, stock_effect: 'deduct_now' },
  { id: 16954, receipt_number: '20260909-130228', status: 'awaiting_payment', line_count: 1, unit_count: 1, stock_effect: 'deduct_now' },
]
const previewBody = () => ({ success: true, target: SALE_NOT_PAID_STOCK_RECOVERY_TARGET, outcome: 'apply', request, sales, summary: { sales: 3, items: 4, allocations: 4, units: 4, movements: 4 } })

const preview = validateSaleNotPaidStockRecoveryPreview(previewBody())
assert.deepEqual(preview.sales.map((sale) => sale.id), [16952, 16953, 16954])
assert.equal(preview.sales.reduce((total, sale) => total + sale.unit_count, 0), 4)
assert.equal(preview.request.confirmation, SALE_NOT_PAID_STOCK_RECOVERY_CONFIRMATION)
assert.throws(() => validateSaleNotPaidStockRecoveryPreview({ ...previewBody(), sales: [...sales.slice(0, 2), { ...sales[2], stock_effect: 'released_allocation_only' }] }), /awaiting-payment stock deduction/)
assert.throws(() => validateSaleNotPaidStockRecoveryPreview({ ...previewBody(), summary: { sales: 3, items: 4, allocations: 4, units: 3, movements: 4 } }), /fixed recovery/)

const baseResponse = { operation_id: 'op-1', manifest_sha256: digest, verification_pending: false, cache_invalidated: true, refresh_pending: false, broadcast_requested: true, message: 'Applied', affected: { sales: 3, items: 4, allocations: 4, units: 4, movements: 4, histories: 3, audits: 3 } }
assert.equal(validateSaleNotPaidStockRecoveryResponse({ success: true, outcome: 'applied', ...baseResponse }).outcome, 'applied')
assert.equal(validateSaleNotPaidStockRecoveryResponse({ success: true, outcome: 'applied', ...baseResponse, verification_pending: true, refresh_pending: true }).refresh_pending, true, 'broadcast failure may leave cache invalidated and refresh pending')
assert.equal(validateSaleNotPaidStockRecoveryResponse({ success: false, outcome: 'uncertain', operation_id: 'op-1', manifest_sha256: digest, verification_pending: true, cache_invalidated: false, refresh_pending: true, broadcast_requested: false, message: 'Check receipt' }).outcome, 'uncertain')
assert.throws(() => validateSaleNotPaidStockRecoveryResponse({ success: false, outcome: 'uncertain', operation_id: 'op-1', manifest_sha256: digest, verification_pending: true, cache_invalidated: false, refresh_pending: false, broadcast_requested: false, message: 'Check receipt' }), /non-invalidated cache/)

const panel = readFileSync(new URL('../src/components/utils-settings/SaleNotPaidStockRecovery.tsx', import.meta.url), 'utf8')
const reset = readFileSync(new URL('../src/components/utils-settings/ResetData.tsx', import.meta.url), 'utf8')
assert.match(panel, /hasPermission\('backup_restore'\)/)
assert.match(panel, /typedConfirmation === preview\.request\.confirmation/)
assert.match(panel, /Replay same request/)
assert.match(panel, /beginSingleAction\(applyInFlight/)
assert.match(reset, /import SaleNotPaidStockRecovery from '\.\/SaleNotPaidStockRecovery\.tsx'/)
assert.match(reset, /<SaleNotPaidStockRecovery \/>/)

console.log('Not Paid stock recovery: all cases pass')
