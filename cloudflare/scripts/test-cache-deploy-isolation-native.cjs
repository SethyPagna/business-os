'use strict'
// CACHE-LIFECYCLE T-CL1 and the server part of T-CL3 (lane 6.0.1048): a deploy or a rollback must never read another build's cached body.
// On the P0.1 read-budget world (the real Worker under Miniflare over a seeded D1, with a persisted Cache API), every server-cached GET is
// warmed under deployment A, then the Worker is restarted as deployment B on the SAME D1 and the SAME cache directory with no write in
// between (versions equal: the worst case). Every shape must miss once under B and then hit. A rollback to A after a write under B must
// return the write, never A's older entry. Positive control in the same run: under A the second request of every shape IS a hit, so the
// "miss" under B is the deployment id and not a cache that never works.
//
// Run (from cloudflare/): node scripts/test-cache-deploy-isolation-native.cjs
const assert = require('node:assert/strict')
const { bootWorld, runShape } = require('./read-budget/world.cjs')
const { getShapes } = require('./read-budget/shapes.cjs')
const { prepareWorld, resolveUrl } = require('./read-budget/runner.cjs')

const IDS = [
  'sales-list-today', 'sales-stats-today', 'sales-stats-strip-today', 'customers-list', 'suppliers-list', 'delivery-contacts-list',
  'products-search-pos-text', 'products-search-index', 'products-filters-facets-category-brand-supplier-lists',
  'batches-tracked-product-ids-active-or-stock-batch-catalog', 'notifications-summary-bell',
]

async function main() {
  const reds = []
  const red = (message) => { reds.push(message); console.error(`RED ${message}`) }
  const world = await bootWorld({ tier: 'free' })
  try {
    await prepareWorld(world)
    const shapes = getShapes(world.ctx).filter((s) => IDS.includes(s.id))
    if (shapes.length !== IDS.length) red(`the sample names ${IDS.length} shapes, ${shapes.length} exist: ${IDS.filter((id) => !shapes.some((s) => s.id === id)).join(', ')}`)
    const urls = new Map()
    for (const shape of shapes) urls.set(shape.id, await resolveUrl(world, shape.url))
    const get = (shape) => runShape(world, { method: 'GET', url: urls.get(shape.id), anon: shape.anon }, { cold: false, cacheMiss: false })

    // Deployment A, then every shape twice.
    await world.restart({ CF_VERSION_METADATA: { id: 'build-A' } })
    const cached = []
    for (const shape of shapes) {
      const first = await get(shape)
      const second = await get(shape)
      if (first.status !== 200) { red(`${shape.id}: status ${first.status} under A`); continue }
      if (second.cache === 'hit') cached.push(shape)
      else console.log(`note ${shape.id} is not served from the shared cache here (cache=${second.cache})`)
    }
    if (cached.length < 6) red(`positive control: only ${cached.length} of ${shapes.length} shapes hit the cache under A; the test would prove nothing`)

    // Deployment B: same data, same cache directory.
    await world.restart({ CF_VERSION_METADATA: { id: 'build-B' } })
    for (const shape of cached) {
      const first = await get(shape)
      const second = await get(shape)
      if (first.cache !== 'miss') red(`${shape.id}: the first request under deployment B was a "${first.cache}", not a miss (it read deployment A's entry)`)
      if (second.cache !== 'hit') red(`${shape.id}: the second request under deployment B was a "${second.cache}", not a hit`)
    }

    // Rollback to A after a write under B: the write must show, never A's older entry.
    const customers = shapes.find((s) => s.id === 'customers-list')
    if (customers) {
      const before = await get(customers)
      const total = (r) => Number((r.json && (r.json.total ?? (r.json.items || r.json.customers || []).length)) ?? NaN)
      const created = await world.send('POST', '/api/customers', { name: 'Rollback Probe Customer', phone: '0990000001' })
      if (created.status !== 200 && created.status !== 201) red(`creating the probe customer answered ${created.status}: ${created.text.slice(0, 160)}`)
      await world.restart({ CF_VERSION_METADATA: { id: 'build-A' } })
      const after = await get(customers)
      if (!(total(after) > total(before))) red(`customers-list after rollback to A does not show the write made under B (total ${total(before)} -> ${total(after)})`)
    }
  } finally { await world.dispose() }
  console.log(reds.length ? `test-cache-deploy-isolation-native: ${reds.length} RED` : 'test-cache-deploy-isolation-native: GREEN')
  if (reds.length) process.exitCode = 1
}

main().catch((error) => { console.error(`test-cache-deploy-isolation-native: crashed: ${error && error.stack}`); process.exitCode = 1 })
