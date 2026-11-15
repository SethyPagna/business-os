'use strict'
// Worker JS time of a grouped page (the Free plan allows 10 ms of CPU per request). SQLite runs in-process here, so the time spent inside the adapter's batch is subtracted:
// what is left is the Worker's own work (building the statements, mapping rows, the grouping block). Median of 15 reads after a warm-up, 100 rows per page.
//
// Run: node scripts/test-inventory-check-grouped-cpu-native.cjs
const assert = require('node:assert/strict')
const { bundle, buildWorld, adapter } = require('./harness/ic-grouped-world.cjs')
const products = bundle('inventoryCheckProducts.ts')
const lowStock = { enabled: true, mode: 'product', threshold: 10 }
const admin = { id: 1, role_code: 'admin', role_permissions: { all: true } }
const BUDGET_MS = 10
async function main() {
  const { db } = buildWorld(2)
  const results = {}
  for (const query of [{}, { groupBy: 'checked' }, { groupBy: 'category' }]) {
    const samples = []
    for (let n = 0; n < 18; n++) {
      const proxy = adapter(db); let inside = 0
      const batch = proxy.batch.bind(proxy)
      proxy.batch = async statements => { const t = process.hrtime.bigint(); try { return await batch(statements) } finally { inside += Number(process.hrtime.bigint() - t) / 1e6 } }
      const start = process.hrtime.bigint()
      await products.readInventoryCheckProductsSimple(proxy, admin, { ...query, pageSize: '100', summary: '1' }, { lowStock, check: { organizationId: 1, viewerId: 1, canSeeStaffIdentity: () => true } })
      samples.push(Number(process.hrtime.bigint() - start) / 1e6 - inside)
    }
    samples.splice(0, 3); samples.sort((a, b) => a - b)
    results[JSON.stringify(query)] = samples[Math.floor(samples.length / 2)]
  }
  console.log('Worker JS ms (median):', JSON.stringify(results))
  for (const [query, ms] of Object.entries(results)) assert.ok(ms < BUDGET_MS, `${query}: ${ms.toFixed(2)} ms over the ${BUDGET_MS} ms Free CPU budget`)
  console.log('1 passed')
}
main().catch(error => { console.error(error); process.exit(1) })
