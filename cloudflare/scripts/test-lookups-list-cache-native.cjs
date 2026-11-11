'use strict'
// S10 (11 Nov D1 audit): GET /api/categories and /api/units built their list from a GROUP BY over every product (about 17k rows) on every call. They are now cached
// under the products and lookups versions for getPlanLimits(env).productListCacheSeconds, and every writer of a lookup row advances the lookups version
// (create, the rename "copy" path, rename/merge, delete). Product writers that can introduce or retire a category or unit already advance `products`.
//
// End to end on the real Worker (Miniflare, every migration applied, real session): after EVERY writer the next read equals what a fresh computation returns
// (an oracle written here in SQL, not the route's own code), a warm read costs fewer D1 statements than a cold one, and an unrelated settings write keeps the
// list a hit.
//
// Run (from cloudflare/):  node scripts/test-lookups-list-cache-native.cjs
// Negative controls rewrite source text in memory at bundle time (--wrong=<name>); each must turn the run red:
//   no-bump-create    POST does not advance the lookups version (a created lookup is invisible until the entry expires)
//   no-bump-copy      the rename "copy" path does not advance it
//   no-products-key   the key drops the products version (a product's new category is invisible)
//   no-cache          the list is never cached (the cost this removes: the warm-read check goes red)
const assert = require('node:assert/strict')
const H = require('./harness/al_money_native.cjs')

const ROUTE = 'src/routes/lookups.ts'
const patchFor = (name) => ({
  'no-bump-create': [{ name, file: ROUTE, from: "    await bumpVersions(c.env, [LOOKUP_CACHE_NAMESPACE])\n    c.executionCtx.waitUntil(broadcast(c.env, table, { action: 'create', id }))", to: "    c.executionCtx.waitUntil(broadcast(c.env, table, { action: 'create', id }))" }],
  'no-bump-copy': [{ name, file: ROUTE, from: "      await bumpVersions(c.env, [LOOKUP_CACHE_NAMESPACE])\n      c.executionCtx.waitUntil(broadcast(c.env, table, { action: 'create', id: copyId }))", to: "      c.executionCtx.waitUntil(broadcast(c.env, table, { action: 'create', id: copyId }))" }],
  'no-products-key': [{ name, file: ROUTE, from: "export const LOOKUP_LIST_VERSION_NAMESPACES = ['products', LOOKUP_CACHE_NAMESPACE] as const", to: 'export const LOOKUP_LIST_VERSION_NAMESPACES = [LOOKUP_CACHE_NAMESPACE] as const' }],
  'no-cache': [{ name, file: ROUTE, from: 'if (!version) return c.json(await readList(c.env))', to: 'if (true) return c.json(await readList(c.env))' }],
})[name]
const flag = (name) => (process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`)) || '').slice(name.length + 3)
const WRONG = flag('wrong')
if (WRONG && !patchFor(WRONG)) throw new Error(`unknown --wrong=${WRONG}`)

async function main() {
  const h = await H.startWorker({ patches: WRONG ? patchFor(WRONG) : [] })
  const r = H.recorder('LKP')
  try {
    const kinds = [['categories', 'category'], ['units', 'unit']]
    const product = async (id, name, category, unit, active = 1) => {
      await h.db.batch([
        h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
        h.db.prepare('INSERT INTO products(id,name,barcode,sku,category,unit,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES(?,?,?,?,?,?,0,1,1,?)').bind(id, name, `88600${id}`, `LKP-${id}`, category, unit, active),
        h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
      ])
    }
    await product(7001, 'LKP A', 'Skin', 'pcs')
    await product(7002, 'LKP B', 'Hair', 'box')
    await product(7003, 'LKP C', 'Retired', 'old', 0)
    await h.db.prepare("INSERT INTO categories(name,color) VALUES('Managed','#112233')").run()
    await h.db.prepare("INSERT INTO units(name,color) VALUES('Managed unit','#112233')").run()

    // The oracle: the list a fresh computation must return, written in SQL and plain JS.
    const oracle = async (table, column) => {
      const lookup = (await h.all(`SELECT name FROM ${table} ORDER BY lower(name) ASC`)).map((row) => String(row.name).trim()).filter(Boolean)
      const taken = new Set(lookup.map((name) => name.toLowerCase()))
      const used = new Map()
      for (const row of await h.all(`SELECT ${column} AS v, COALESCE(is_active, 1) AS a FROM products WHERE trim(COALESCE(${column}, '')) <> ''`)) {
        const name = String(row.v).trim(); const key = name.toLowerCase()
        if (taken.has(key)) continue
        const entry = used.get(key) || { name, active: 0 }
        if (Number(row.a) === 1) entry.active = 1
        used.set(key, entry)
      }
      const byName = (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0)
      const entries = [...used.values()]
      return [...lookup.map((name) => ({ name, source: 'lookup' })), ...entries.filter((e) => e.active).sort(byName).map((e) => ({ name: e.name, source: 'products' })),
        ...entries.filter((e) => !e.active).sort(byName).map((e) => ({ name: e.name, source: 'products' }))]
    }
    const read = async (table, label) => {
      const res = await h.call('GET', `/api/${table}`, undefined, label)
      assert.equal(res.status, 200, `${label} answered ${res.status}`)
      return { rows: res.body, shape: res.body.map((row) => ({ name: row.name, source: row.source })), statements: h.metrics[h.metrics.length - 1].statements }
    }
    const observed = []
    const equalsFresh = async (table, column, label) => { observed.push({ label, got: (await read(table, label)).shape, want: await oracle(table, column) }) }

    // ---- cold then warm, per table -------------------------------------------------------------------------------------------------------------------------
    const cold = {}
    const warm = {}
    for (const [table, column] of kinds) {
      cold[table] = await read(table, `cold ${table}`)
      warm[table] = await read(table, `warm ${table}`)
      observed.push({ label: `${table}: the cold list is the fresh list (managed first, active used, then inactive used)`, got: cold[table].shape, want: await oracle(table, column) })
      observed.push({ label: `${table}: the warm list is identical to the cold list, row for row`, got: warm[table].rows, want: cold[table].rows })
    }
    await h.db.prepare("INSERT INTO settings(key,value) VALUES('lkp_unrelated','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run()
    const stillWarm = await read('categories', 'warm after unrelated write')

    // ---- every writer, then the next read equals a fresh computation ---------------------------------------------------------------------------------------
    for (const [table, column] of kinds) {
      const api = `/api/${table}`
      await read(table, `prime ${table}`)
      const created = await h.call('POST', api, { name: `New ${column}` }, `create ${table}`)
      assert.equal(created.status, 200, JSON.stringify(created.body).slice(0, 200))
      await equalsFresh(table, column, `${table}: a created lookup shows on the very next read`)

      await read(table, `prime ${table} after create`)
      const copied = await h.call('PUT', `${api}/${created.body.id}`, { name: `Copy ${column}`, cascade: 'copy' }, `copy ${table}`)
      assert.equal(copied.status, 200, JSON.stringify(copied.body).slice(0, 200))
      await equalsFresh(table, column, `${table}: the rename "copy" path shows its new row on the very next read`)

      await read(table, `prime ${table} after copy`)
      const carried = await h.call('PUT', `${api}/${created.body.id}`, { name: `Carried ${column}`, cascade: 'carry', updated_at: created.body.updated_at }, `rename carry ${table}`)
      assert.equal(carried.status, 200, JSON.stringify(carried.body).slice(0, 200))
      await equalsFresh(table, column, `${table}: a rename (carry) shows on the very next read`)

      await read(table, `prime ${table} after rename`)
      const copyRow = (await h.all(`SELECT id FROM ${table} WHERE name = ?`, `Copy ${column}`))[0]
      const merged = await h.call('PUT', `${api}/${carried.body.id}`, { name: `Copy ${column}`, cascade: 'carry', updated_at: carried.body.updated_at }, `rename merge ${table}`)
      assert.equal(merged.status, 200, JSON.stringify(merged.body).slice(0, 200))
      assert.equal(merged.body.merged, true)
      await equalsFresh(table, column, `${table}: a rename that merges into an existing row shows on the very next read`)

      await read(table, `prime ${table} after merge`)
      const gone = await h.call('DELETE', `${api}/${copyRow.id}`, undefined, `delete ${table}`)
      assert.equal(gone.status, 200, JSON.stringify(gone.body).slice(0, 200))
      await equalsFresh(table, column, `${table}: a delete shows on the very next read`)
    }

    // ---- product writers (they bump `products`, which the key carries) --------------------------------------------------------------------------------------
    await read('categories', 'prime for product writers')
    await read('units', 'prime units for product writers')
    const made = await h.call('POST', '/api/products', { name: 'LKP Created', barcode: '8860099991', selling_price_usd: 2, price_usd: 2, cost_price_usd: 1, category: 'Brand new category', unit: 'brand new unit' }, 'create product')
    assert.equal(made.status, 200, JSON.stringify(made.body).slice(0, 300))
    await equalsFresh('categories', 'category', 'a product created with a new category shows it on the very next read')
    await equalsFresh('units', 'unit', 'a product created with a new unit shows it on the very next read')
    const productId = made.body.id || (made.body.product && made.body.product.id)
    assert.ok(productId, JSON.stringify(made.body).slice(0, 200))
    await read('categories', 'prime after product create')
    await read('units', 'prime units after product create')
    const edited = await h.call('PUT', `/api/products/${productId}`, { category: 'Edited category', unit: 'edited unit', updated_at: made.body.updated_at || (made.body.product && made.body.product.updated_at) }, 'edit product')
    assert.equal(edited.status, 200, JSON.stringify(edited.body).slice(0, 300))
    await equalsFresh('categories', 'category', 'a product edit to another category shows the new value and drops the old one on the very next read')
    await equalsFresh('units', 'unit', 'a product edit to another unit shows the new value and drops the old one on the very next read')

    for (const entry of observed) r.check(entry.label, () => assert.deepEqual(entry.got, entry.want))
    r.check('a warm list costs fewer D1 statements than a cold one (the GROUP BY over products is not run again)', () => {
      for (const [table] of kinds) assert.ok(warm[table].statements < cold[table].statements, `${table}: warm ${warm[table].statements}, cold ${cold[table].statements}`)
    })
    r.check('a write to an unrelated table (settings) leaves the cached list a hit', () => {
      assert.ok(stillWarm.statements <= warm.categories.statements, `statements ${stillWarm.statements} vs warm ${warm.categories.statements}`)
    })
    r.check('the list hides nothing: inactive-only values stay last and the managed row keeps its colour column', () => {
      assert.deepEqual(cold.categories.shape.map((row) => row.name), ['Managed', 'Hair', 'Skin', 'Retired'])
      assert.equal(cold.categories.rows[0].color, '#112233')
    })
  } finally {
    await h.mf.dispose?.()
  }
  const failed = r.results.filter((entry) => !entry.ok)
  console.log(`\n${failed.length ? 'RED' : 'GREEN'} lookups list cache: ${r.results.length - failed.length}/${r.results.length} checks hold${WRONG ? ` (mutant --wrong=${WRONG})` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}

main().then(() => process.exit(process.exitCode || 0)).catch((error) => { console.error(error); process.exit(1) })
