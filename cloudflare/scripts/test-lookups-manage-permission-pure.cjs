// Security audit P2-e. Category and unit create / rename / merge / delete only asked for the products section, while
// every sibling lookup write (POST /products/rename-brand, POST /products/lookups/replace) needs the Full
// products:manage_lookups action. A custom role with products on and manage_lookups off, or the Employee preset
// (manage_lookups off), could rename or delete a category or unit for the whole catalog.
//
// Drives the REAL routes/lookups.ts and the REAL permission kernel over the migrated schema. Every write verb is
// refused 403 forbidden / products:manage_lookups and changes no row; the same verbs with the grant still work.
//
// Run: node scripts/test-lookups-manage-permission-pure.cjs
const assert = require('node:assert/strict')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const h = createProductsRouteHarness()
const lookups = h.load('routes/lookups.ts').default
const { getActionTier } = h.load('lib/permissions.ts')
h.setActionTier(getActionTier)

const user = (permissions) => ({ id: 7, username: 'clerk', name: 'Clerk', role_code: 'custom', permissions: JSON.stringify(permissions) })
const WITH = user({ products: true })
const WITHOUT = user({ products: true, 'products:manage_lookups': false })
const ctx = { waitUntil: (promise) => { promise?.catch?.(() => {}) }, passThroughOnException: () => {} }

async function call(as, method, path, body) {
  h.setUser(as)
  const init = { method, headers: { 'content-type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await lookups.request(`http://local${path}`, init, { DB: h.raw }, ctx)
  return { status: res.status, json: await res.json().catch(() => null) }
}
const rows = (table) => h.raw.prepare(`SELECT id, name FROM ${table} ORDER BY id`).all()

;(async () => {
  assert.equal(getActionTier(WITHOUT, 'products', 'manage_lookups'), 'none', 'control: the fixture really lacks the action')
  assert.equal(getActionTier(WITH, 'products', 'manage_lookups'), 'full', 'control: products alone leaves manage_lookups on')
  let checked = 0
  for (const [table, base] of [['categories', '/categories'], ['units', '/units']]) {
    const seeded = await call(WITH, 'POST', base, { name: `Seed ${table}` })
    assert.equal(seeded.status, 200, JSON.stringify(seeded.json))
    const second = await call(WITH, 'POST', base, { name: `Other ${table}` })
    assert.equal(second.status, 200, JSON.stringify(second.json))
    const id = seeded.json.id
    const before = JSON.stringify(rows(table))
    const audits = h.raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n

    const attempts = [
      ['create', 'POST', base, { name: `Denied ${table}` }],
      ['rename (PUT)', 'PUT', `${base}/${id}`, { name: `Renamed ${table}`, cascade: 'carry' }],
      ['rename (PATCH)', 'PATCH', `${base}/${id}`, { name: `Renamed ${table}`, cascade: 'carry' }],
      ['merge into the other row', 'PUT', `${base}/${id}`, { name: `Other ${table}`, cascade: 'carry' }],
      ['delete', 'DELETE', `${base}/${id}`, undefined],
    ]
    for (const [label, method, path, body] of attempts) {
      const res = await call(WITHOUT, method, path, body)
      assert.equal(res.status, 403, `${table} ${label}: ${JSON.stringify(res.json)}`)
      assert.equal(res.json.code, 'forbidden')
      assert.equal(res.json.permission, 'products:manage_lookups')
      checked += 1
    }
    assert.equal(JSON.stringify(rows(table)), before, `${table}: a refused write changes no row`)
    assert.equal(h.raw.prepare('SELECT COUNT(*) n FROM audit_logs').get().n, audits, `${table}: a refused write leaves no audit row`)

    // Controls: the same verbs with the grant.
    const renamed = await call(WITH, 'PUT', `${base}/${id}`, { name: `Renamed ${table}`, cascade: 'carry' })
    assert.equal(renamed.status, 200, JSON.stringify(renamed.json))
    const deleted = await call(WITH, 'DELETE', `${base}/${id}`)
    assert.equal(deleted.status, 200, JSON.stringify(deleted.json))
    // Reading the list stays open to any signed-in user.
    assert.equal((await call(user({ pos: true }), 'GET', base)).status, 200, `${table}: the list is still readable without products`)
  }
  assert.equal(checked, 10)
  console.log(`test-lookups-manage-permission-pure.cjs: ${checked} refusals and the controls passed`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
