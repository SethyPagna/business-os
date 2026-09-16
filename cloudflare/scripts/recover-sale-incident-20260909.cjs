// Validates and freezes a browser-downloaded preview. This tool deliberately
// does not accept credentials or call production; the normal Admin UI submits
// the exact request through the authenticated same-origin Worker route.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/recover-sale-incident-20260909.cjs <preview-response.json>')
  process.exit(2)
}
const preview = JSON.parse(fs.readFileSync(file, 'utf8'))
assert.equal(preview.success, true)
assert.equal(preview.target, 'sale-zero-items-20260909-v1')
assert.ok(preview.outcome === 'apply' || preview.outcome === 'already_applied')
assert.deepEqual(Object.keys(preview.request).sort(), ['confirmation', 'manifest_sha256', 'target'])
assert.equal(preview.request.target, 'sale-zero-items-20260909-v1')
assert.equal(preview.request.confirmation, 'RECOVER SALES 16951 16952 16953')
assert.match(preview.request.manifest_sha256, /^[a-f0-9]{64}$/)
assert.deepEqual(preview.sales.map((sale) => sale.id), [16951, 16952, 16953])
assert.deepEqual(preview.blocked_sales, [{ id: 16954, receipt_number: '20260909-130228', reason: 'sale_time_cost_not_proven' }])
assert.equal(preview.sales.reduce((sum, sale) => sum + sale.line_count, 0), 4)
process.stdout.write(`${JSON.stringify(preview.request, null, 2)}\n`)
