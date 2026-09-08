import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteProduct } from '../src/api/productWriteTransport.ts'
import { setSyncServerUrl } from '../src/api/httpState.ts'

const here = dirname(fileURLToPath(import.meta.url))
const products = readFileSync(join(here, '..', 'src', 'components', 'products', 'Products.tsx'), 'utf8')
const transport = readFileSync(join(here, '..', 'src', 'api', 'productWriteTransport.ts'), 'utf8')

assert.match(transport, /deleteProduct[\s\S]*ensureClientRequestId\([\s\S]*withExpectedUpdatedAt\('products', id,[\s\S]*'product-remove'/,
  'direct removal always sends a server idempotency key alongside the reviewed product version')

const singleStart = products.indexOf('const runSingleDeleteConfirmed')
const singleEnd = products.indexOf('const runPendingDeleteConfirmed', singleStart)
const single = products.slice(singleStart, singleEnd)
assert.match(single, /if \(result\?\.pending === true\) \{[\s\S]*Product removal submitted for review[\s\S]*return/,
  'review-tier receipts do not hide the product or record a local deletion')
const serverReceiptAt = single.indexOf("Number(result?.action_history_id || 0) > 0")
const localUndoAt = single.indexOf('actionHistory.pushAction')
assert.ok(serverReceiptAt > 0 && localUndoAt > serverReceiptAt,
  'server history receipts are handled before the legacy recreate-based fallback')
assert.match(single.slice(serverReceiptAt, localUndoAt), /actionHistory\.refreshServerItems\(\)[\s\S]*return/,
  'server-backed removals expose the authoritative same-id Undo and skip local recreation')

const bulkStart = products.indexOf('const runBulkDeleteConfirmed')
const bulkEnd = products.indexOf('const handleBulkOutOfStock', bulkStart)
const bulk = products.slice(bulkStart, bulkEnd)
assert.match(bulk, /serverReceiptIds[\s\S]*action_history_id[\s\S]*legacyDeletedIds = deletedIds\.filter/,
  'small multi-select removal separates server receipts from cached-server legacy responses')
assert.match(bulk, /setSelectedIds\(new Set\(\[\.\.\.failedIds, \.\.\.pendingIds\]\)\)/,
  'approval-pending products remain selected because they were not deleted')
assert.match(bulk, /deletedSnapshots = snapshots\.filter\(\(snapshot\) => legacyDeletedIds\.includes/,
  'only responses without a server receipt may enter the legacy recreate-based Undo path')

const originalFetch = globalThis.fetch
const sentBodies: Array<Record<string, unknown>> = []
setSyncServerUrl('http://product-remove-fixture')
globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  sentBodies.push(JSON.parse(String(init?.body || '{}')))
  return new Response(JSON.stringify({ success: true, operation_id: 'remove-op-55', product_id: 55,
    status: 'undo_ready', action_history_id: 955, generation: 0 }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
}) as typeof fetch

try {
  const result = await deleteProduct(55, 'Independent duplicate') as Record<string, unknown>
  assert.equal(result.action_history_id, 955)
  assert.equal(sentBodies.length, 1)
  assert.equal(sentBodies[0].reason, 'Independent duplicate')
  assert.match(String(sentBodies[0].client_request_id || ''), /^product-remove_[A-Za-z0-9_-]+$/)
  assert.ok(String(sentBodies[0].client_request_id).length <= 120)
} finally {
  globalThis.fetch = originalFetch
  setSyncServerUrl('')
}

console.log('PASS product removals send stable receipts and use server-backed same-id Undo')
