import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReturnBulkItems,
  buildReturnBulkPayload,
  countConditionalMatches,
  methodFieldForScope,
  methodValueForRow,
  RETURN_BULK_LIMIT,
} from '../src/components/returns/helpers/returnBulkAction.ts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rows = [
  { id: 1, return_scope: 'customer', status: 'completed', return_type: 'restock', updated_at: 'v1' },
  { id: 2, return_scope: 'customer', status: 'cancelled', return_type: 'refund', updated_at: 'v2' },
  { id: 3, return_scope: 'customer', status: 'completed', return_type: 'refund', updated_at: 'v3' },
]

assert.equal(countConditionalMatches(rows, 'status', 'completed'), 2)
assert.equal(countConditionalMatches(rows, 'return_type', 'refund'), 2)
assert.equal(methodFieldForScope('customer'), 'return_type')
assert.equal(methodFieldForScope('supplier'), 'supplier_settlement')
assert.equal(methodValueForRow({ id: 4, return_scope: 'supplier', supplier_settlement: 'Credit' }), 'credit')
assert.equal(methodValueForRow({ id: 5, return_scope: 'customer', return_type: null }), 'manual')
assert.equal(countConditionalMatches([
  { id: 6, return_scope: 'customer', return_type: 'refund' },
  { id: 7, return_scope: 'supplier', supplier_settlement: 'refund' },
], 'supplier_settlement', 'refund'), 1)
console.log('PASS mixed statuses and source mismatch are counted without changing unmatched rows')

const frozen = buildReturnBulkItems(rows)
rows[0].status = 'cancelled'
rows[0].updated_at = 'background-refresh'
assert.deepEqual(frozen[0], { id: 1, expected_status: 'completed', expected_method: 'restock', expected_updated_at: 'v1' })
const payload = buildReturnBulkPayload({ rows, field: 'return_type', source: 'refund', target: 'writeoff', clientRequestId: 'return-bulk-fixed' })
assert.equal(payload.client_request_id, 'return-bulk-fixed')
assert.equal(payload.items.length, 3)
assert.equal(payload.source, 'refund')
assert.equal(payload.target, 'writeoff')
console.log('PASS request freezes every selected row revision and preserves a stable retry id')

const oversized = Array.from({ length: RETURN_BULK_LIMIT + 10 }, (_, index) => ({ id: index + 1 }))
assert.throws(() => buildReturnBulkPayload({ rows: oversized, field: 'status', source: 'completed', target: 'cancelled' }), /between 1 and 25/)

const pageSource = fs.readFileSync(path.join(root, 'src/components/returns/Returns.tsx'), 'utf8')
const transportSource = fs.readFileSync(path.join(root, 'src/api/returnsTransport.ts'), 'utf8')
const statsStripStart = pageSource.indexOf('<StatsStrip')
const secondaryActionsStart = pageSource.indexOf('<div data-returns-secondary-actions', statsStripStart)
const searchToolbarStart = pageSource.indexOf('{/* Search + filter', secondaryActionsStart)
assert.ok(statsStripStart >= 0 && secondaryActionsStart > statsStripStart && searchToolbarStart > secondaryActionsStart, 'Returns should keep distinct primary stats and secondary action surfaces')
const primaryStatsRowSource = pageSource.slice(statsStripStart, secondaryActionsStart)
const secondaryActionRailSource = pageSource.slice(secondaryActionsStart, searchToolbarStart)
assert.match(pageSource, /sessionStorage\.setItem\(bulkRetryKey, JSON\.stringify\(request\)\)/)
assert.match(pageSource, /const canBulkReturns = can\('returns', 'bulk'\)/)
assert.match(pageSource, /const canExportReturns = can\('returns', 'export'\)/)
assert.match(pageSource, /if \(!canBulkReturns\) throw new Error[\s\S]*applyBulkAction\(pendingBulkRequest\)/)
assert.match(pageSource, /savePendingBulkRequest\(null\)/)
assert.match(
  primaryStatsRowSource,
  /range=\{stripRange\}[\s\S]*onRangeChange=\{setStripRange\}[\s\S]*rangeActions=\{\(\s*canExportReturns \? \(\s*<ExportMenu[\s\S]*items=\{exportItems\}[\s\S]*iconOnly[\s\S]*triggerClassName=\{toolbarIconButtonClassName\}/,
  'permission-gated Export should occupy the primary Stats/date row as its icon-only range action',
)
assert.match(
  secondaryActionRailSource,
  /data-returns-secondary-actions className="[^"]*max-w-full[^"]*min-w-0[^"]*overflow-x-auto[^"]*"[\s\S]*className="flex w-max min-w-full flex-nowrap/,
  'long Returns actions should stay inside the contained non-wrapping secondary rail',
)
assert.doesNotMatch(
  secondaryActionRailSource,
  /ExportMenu|exportItems|canExportReturns/,
  'Export must not re-enter the secondary action rail',
)
assert.match(pageSource, /selectionEnabled=\{canBulkReturns\}/)
assert.match(pageSource, /canBulkReturns && pendingBulkRequest/)
assert.match(pageSource, /canBulkReturns && bulkActionSnapshot\?\.rows\.length/)
assert.doesNotMatch(pageSource, /onClick=\{exportSelected\}>/)
assert.match(transportSource, /navigator\.onLine === false/)
assert.match(transportSource, /apiFetch\('POST', '\/api\/returns\/bulk', payload\)/)
const bulkTransport = transportSource.slice(transportSource.indexOf('export function bulkUpdateReturns'), transportSource.indexOf('export async function prepareReturnUpdateRequest'))
assert.doesNotMatch(bulkTransport, /route\(/)
console.log('PASS online-only retry, bulk selection, and client export enforce their explicit action grants')
