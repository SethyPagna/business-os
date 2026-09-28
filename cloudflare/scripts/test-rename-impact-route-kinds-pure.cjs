// DC-12: GET /api/products/rename-impact must accept every rename kind the
// engine implements and the app asks for, and nothing else.
//
// Manage Units asks for kind 'unit' before every rename; the route's own
// whitelist listed category/brand/supplier/product_name only, so the preview
// answered 400 "Unknown rename kind" and no unit could ever be renamed. The
// engine test (test-rename-cascade-pure.cjs) calls computeRenameImpact
// directly and cannot see a route gate, so this drives the REAL route.
//
// The gate is the ONLY guard: computeRenameImpact reads any kind it has no
// branch for as a product-name rename, so an unlisted kind must stay a 400.
//
// Run (from cloudflare/): node scripts/test-rename-impact-route-kinds-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const REPO = path.join(__dirname, '..', '..')
const h = createProductsRouteHarness()

let passed = 0
let failed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name} -- ${error.message}`)
  }
}

function listFiles(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function engineKinds() {
  const src = fs.readFileSync(path.join(REPO, 'cloudflare', 'src', 'lib', 'renameCascade.ts'), 'utf8')
  const match = src.match(/export type RenameKind\s*=\s*([^\n]+)/)
  assert.ok(match, 'renameCascade.ts declares export type RenameKind')
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}

function clientKinds() {
  const kinds = new Set()
  for (const file of listFiles(path.join(REPO, 'frontend', 'src'))) {
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/\bgetRenameImpact\(\s*'([a-z_]+)'/g)) kinds.add(m[1])
  }
  return [...kinds].sort()
}

const impact = (kind, from = 'Bottle', to = 'Btl') =>
  h.request('GET', `/rename-impact?${new URLSearchParams({ kind, from, to }).toString()}`)

async function main() {
  const engine = engineKinds()
  const client = clientKinds()

  await check('the kind lists enumerate (engine and every frontend caller)', async () => {
    assert.ok(engine.length >= 5, `engine kinds: ${engine.join(', ')}`)
    assert.ok(client.includes('unit'), `ManageUnitsModal's 'unit' preview is found among callers: ${client.join(', ')}`)
    assert.ok(client.length >= 4, `frontend callers: ${client.join(', ')}`)
  })

  await check('every kind a frontend caller sends is a kind the engine implements', async () => {
    const unknown = client.filter((kind) => !engine.includes(kind))
    assert.deepEqual(unknown, [], `callers send kinds the engine would read as a product-name rename: ${unknown.join(', ')}`)
  })

  for (const kind of engine) {
    await check(`GET /rename-impact accepts engine kind '${kind}'`, async () => {
      const res = await impact(kind)
      assert.equal(res.status, 200, `kind=${kind} -> ${res.status} ${JSON.stringify(res.json)}`)
      assert.equal(res.json.kind, kind)
    })
  }

  await check('a unit preview reaches the real engine: counts products by unit and sees the target unit', async () => {
    h.raw.exec('DELETE FROM products; DELETE FROM units;')
    h.raw.exec(`INSERT INTO products (id, name, unit, is_active) VALUES
      (1, 'Rose Serum', 'Bottle', 1),
      (2, 'Lip Balm', ' bottle ', 1),
      (3, 'Night Cream', 'Box', 1)`)
    h.raw.exec("INSERT INTO units (name) VALUES ('Btl')")
    const res = await impact('unit', 'Bottle', 'Btl')
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.products_primary, 2, 'both Bottle rows, trimmed and case-folded; not the Box row')
    assert.equal(res.json.target_exists, true, 'Btl already exists as a unit')
    assert.equal(res.json.group_rows, 0, 'a unit preview must not be answered as a product-name preview')
  })

  // 'customer', 'delivery_contact' and 'user' are in the frontend transport's
  // type but have no engine branch; the object-prototype names catch a gate
  // written with `in`.
  for (const kind of ['bogus', 'units', 'customer', 'delivery_contact', 'user', 'constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf']) {
    await check(`GET /rename-impact still refuses kind '${kind}'`, async () => {
      const res = await impact(kind)
      assert.equal(res.status, 400, `kind=${kind} -> ${res.status} ${JSON.stringify(res.json)}`)
      assert.equal(res.json.error, 'Unknown rename kind')
    })
  }

  await check('a missing kind is refused', async () => {
    const res = await h.request('GET', '/rename-impact?from=Bottle&to=Btl')
    assert.equal(res.status, 400, JSON.stringify(res.json))
  })

  await check('a unit preview still needs from and to', async () => {
    const res = await h.request('GET', '/rename-impact?kind=unit&from=Bottle')
    assert.equal(res.status, 400, JSON.stringify(res.json))
    assert.equal(res.json.error, 'from and to are required')
  })

  await check('the products edit permission gate still answers first', async () => {
    h.setActionTier((_user, area, action) => (area === 'products' && action === 'edit' ? 'none' : 'full'))
    try {
      const res = await impact('unit')
      assert.equal(res.status, 403, JSON.stringify(res.json))
    } finally {
      h.setActionTier(() => 'full')
    }
  })

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
