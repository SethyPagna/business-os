// Owner, 16 Nov 2026: unmerged duplicates (two records, same name, same barcode) sit next to each other on every staff list.
// This runs the REAL routes/products.ts (GET /search, the one reader behind Products, POS and the pickers) on SQLite with every
// migration applied, against a seeded world that holds synthetic twins:
//   "Zq Probe Serum":  990001 (8851111111111, oldest), 990002 (8852222222222, a real variant BETWEEN the twins by id and by date), 990003 (8851111111111, newest)
//   "Zq Probe Toner":  990004 ('0885333333333'), 990005 ('1234567890123'), 990006 ('885333333333')   (990004 and 990006 differ by a leading zero)
// Every sort, a name search, a barcode search and one-family pages must keep the twins consecutive, return every record once and
// never split a family across pages. Mutants swap the real lib/familyPagination.ts for edited copies (the id-only order back, the
// barcode fold removed) and must turn the run red.
//
// Run (from cloudflare/): node scripts/test-twins-adjacent-routes-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const SRC = path.join(__dirname, '..', 'src')
const PROBE = [990001, 990002, 990003, 990004, 990005, 990006]

function moduleFrom(text) {
  const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, mod, mod.exports)
  return mod.exports
}

function world(overrides) {
  const h = createProductsRouteHarness({ user: ADMIN, overrides })
  h.setUser(ADMIN)
  const raw = h.raw.db
  raw.exec("INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1)")
  const insert = raw.prepare(`INSERT INTO products(id, name, brand, category, barcode, sku, unit, supplier, cost_price_usd, selling_price_usd, stock_quantity, is_active, created_at)
    VALUES (?, ?, 'B', 'Skin', ?, ?, 'pcs', 'Acme', 2, 5, 0, 1, ?)`)
  const rows = [
    [990001, 'Zq Probe Serum', '8851111111111', 'S1', '2026-01-01 00:00:00'], [990002, 'Zq Probe Serum', '8852222222222', 'S2', '2026-01-02 00:00:00'], [990003, 'Zq Probe Serum', '8851111111111', 'S3', '2026-01-03 00:00:00'],
    [990004, 'Zq Probe Toner', '0885333333333', 'T1', '2026-01-04 00:00:00'], [990005, 'Zq Probe Toner', '1234567890123', 'T2', '2026-01-05 00:00:00'], [990006, 'Zq Probe Toner', '885333333333', 'T3', '2026-01-06 00:00:00'],
  ]
  seedStockFixture(raw, () => { for (const row of rows) insert.run(...row) })
  return h
}

const probeIds = (json) => (json.items || []).map((item) => item.id).filter((id) => PROBE.includes(id))
const consecutive = (ids, wanted, label) => {
  const at = wanted.map((id) => ids.indexOf(id))
  assert.ok(at.every((i) => i >= 0), `${label}: all of ${wanted} listed in ${ids}`)
  const sorted = [...at].sort((a, b) => a - b)
  assert.deepEqual(sorted, sorted.map((_, i) => sorted[0] + i), `${label}: ${wanted} consecutive in ${ids}`)
}

async function probe(overrides, label) {
  const failures = []
  const check = async (name, fn) => { try { await fn() } catch (error) { failures.push(`${label} ${name}: ${String(error.message).split('\n')[0]}`) } }
  const h = world(overrides)
  const get = async (query) => {
    const res = await h.request('GET', `/search?${new URLSearchParams({ pageSize: '50', ...query })}`)
    assert.equal(res.status, 200, `status ${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`)
    return res.json
  }
  for (const sort of ['name_asc', 'name_desc', 'created_asc', 'created_desc']) {
    await check(`sort ${sort}`, async () => {
      const ids = probeIds(await get({ query: 'zq probe', sort }))
      assert.deepEqual([...ids].sort(), PROBE, 'every probe record exactly once')
      consecutive(ids, [990001, 990003], sort)
      consecutive(ids, [990004, 990006], sort)
    })
  }
  await check('browse (no query) with a Zq name filter via the barcode search keeps both twins together', async () => {
    const ids = probeIds(await get({ query: '8851111111111' }))
    assert.ok(ids.includes(990001) && ids.includes(990003), `both twins found by their barcode: ${ids}`)
    consecutive(ids, [990001, 990003], 'barcode search')
  })
  await check('a one-family page holds the whole family, twins consecutive, nothing missing across pages', async () => {
    const seen = []
    let total = 0
    for (let page = 1; page <= 3; page++) {
      const json = await get({ query: 'zq probe', sort: 'name_asc', pageSize: '1', page: String(page) })
      total = json.total
      const ids = probeIds(json)
      if (ids.includes(990001)) { assert.deepEqual([...ids].sort(), [990001, 990002, 990003], 'the Serum family is whole on its page'); consecutive(ids, [990001, 990003], 'page') }
      if (ids.includes(990004)) { assert.deepEqual([...ids].sort(), [990004, 990005, 990006], 'the Toner family is whole on its page'); consecutive(ids, [990004, 990006], 'page') }
      seen.push(...ids)
    }
    assert.equal(total, 2, 'two families')
    assert.deepEqual([...seen].sort(), PROBE, 'every record once across the pages')
  })
  return failures
}

;(async () => {
  const real = await probe(undefined, 'real')
  assert.deepEqual(real, [], `real routes are red:\n${real.join('\n')}`)
  const source = fs.readFileSync(path.join(SRC, 'lib/familyPagination.ts'), 'utf8').replace(/\r\n/g, '\n')
  const mutants = [
    ['intra order is name, id only (no barcode)', "return `lower(trim(${nameColumn})) ASC, (${code} = '') ASC, ${identityKey} ASC`", "return `lower(trim(${nameColumn})) ASC`"],
    ['barcode order is raw (leading zeros not folded)', "NOT GLOB '*[^0-9]*' AND", "GLOB 'zzz' AND"],
  ]
  for (const [name, from, to] of mutants) {
    assert.ok(source.includes(from), `mutant "${name}" no longer matches familyPagination.ts (stale mutant)`)
    const failed = await probe({ '../lib/familyPagination': moduleFrom(source.replace(from, to)) }, name)
    assert.ok(failed.length > 0, `mutant survived: ${name}`)
  }
  console.log(`PASS twins adjacent on the real products route: 4 sorts, name and barcode search, one-family pages, leading-zero twins, ${mutants.length} mutants killed`)
})().catch((error) => { console.error(error); process.exit(1) })
