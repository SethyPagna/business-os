import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  getDashboardSaleStatusLabel,
  getDashboardSaleStatusTone,
  normalizeDashboardSaleStatus,
} from '../src/components/dashboard/dashboardSaleStatus.ts'

const translate = (key: string) => ({
  status_completed: 'Done',
  status_awaiting_payment: 'Not Paid',
  status_awaiting_delivery: 'Awaiting delivery',
  status_cancelled: 'Cancelled',
  status_partial_return: 'Partial return',
  status_returned: 'Returned',
}[key] || key)

assert.equal(normalizeDashboardSaleStatus('awaiting_payment'), 'awaiting_payment')
assert.equal(getDashboardSaleStatusLabel('awaiting_payment', translate), 'Not Paid')
assert.match(getDashboardSaleStatusTone('awaiting_payment'), /yellow/, 'credit receipts use a pending tone')
assert.equal(getDashboardSaleStatusLabel('awaiting_delivery'), 'Awaiting Delivery')
assert.equal(getDashboardSaleStatusLabel('cancelled'), 'Cancelled')
assert.equal(normalizeDashboardSaleStatus('refunded'), 'returned', 'legacy refunded aliases remain returned')
assert.equal(normalizeDashboardSaleStatus(undefined), 'completed', 'missing legacy status keeps the completed fallback')

const dashboard = readFileSync(new URL('../src/components/dashboard/Dashboard.tsx', import.meta.url), 'utf8')
assert.match(dashboard, /getDashboardSaleStatusLabel\(status, t\)/, 'dashboard labels use the runtime status helper')
assert.match(dashboard, /formatStatus\(sale\.sale_status\)/, 'recent-sale rows read the API sale_status field')
assert.match(dashboard, /getDashboardSaleStatusTone\(sale\.sale_status\)/, 'recent-sale tone reads the same API field')
assert.doesNotMatch(dashboard, /getDashboardSaleStatusTone\(sale\.sale_status\)[^}]*\}\s*>\s*<[^>]+Icon/, 'recent-sale status badges stay text-only')

console.log('PASS dashboard sale status presentation')
