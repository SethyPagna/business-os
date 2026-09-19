// P10-5 writer 5 (Sep 16 2026 owner ruling): "batches.ts identity check
// aligned to the same fold rule (read it first; if it only validates and
// never creates, pin that with a test and say so)."
//
// Read result: POST /api/batches (routes/batches.ts's `ReceiveBody` /
// `runReceiveBatchAction`) takes an integer `product_id` and 404s unless a
// row with that exact id already exists (`SELECT id, name FROM products
// WHERE id = ?`, routes/batches.ts). `ReceiveBody` has NO `name` field and
// NO `barcode` field at all -- there is no code path in this file, or in
// lib/productBatches.ts's `receiveBatchStock` that it calls, that inserts a
// new `products` row or compares an incoming name+barcode against existing
// ones. The name+barcode identity/fold rule (leading-zero-forgiving,
// broken/empty-barcode wildcard match, real-barcode-wins) governs CREATING a
// product, and this route can never create one -- an operator must already
// have picked (or the Fast Stock-In `create_receive` fold in
// lib/stockSession.ts must already have resolved) a real product_id before
// this endpoint is ever called. So there is nothing here to "align": the
// fold rule has no surface in this file, by construction, not by omission.
//
// This test pins that reading directly against the real route/action code
// (not a description of it) so a future change that quietly adds a
// name+barcode create path here is caught: 1) an unknown product_id 404s
// rather than creating a row, 2) a real existing row's count/identity is
// untouched by the attempt, 3) ReceiveBody genuinely carries no name/barcode
// fields for TypeScript-checked callers (lib/stockInCommit.ts's batched
// commit route) to accidentally start relying on.
//
// Run: node scripts/test-batches-no-product-identity-surface-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')

function loadRoute() {
  const cache = new Map()
  const load = (relativeFile) => {
    const normalized = relativeFile.replaceAll('\\', '/')
    if (cache.has(normalized)) return cache.get(normalized).exports
    const file = path.join(root, 'src', normalized)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(normalized, mod)
    const req = (name) => {
      if (name === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', actor); await next() } }
      if (name === './cache' || name === '../lib/cache') return { bumpVersion: async () => {} }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name.startsWith('./')) return load(`lib/${name.slice(2)}.ts`)
      if (name.startsWith('../')) return load(`${name.slice(3)}.ts`)
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load('routes/batches.ts')
}

const actor = {
  id: 9, username: 'batch-user', name: 'Batch User', organization_id: null,
  role_id: null, permissions: JSON.stringify({ inventory: true, products: true, product_cost_edit: true, product_cost_view: true }), is_active: 1,
}

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.pragma('foreign_keys = ON')
  sql.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(1, 'Rose Lip Oil', '3614274226546', 5, 0, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 0);
  `)
  const wrap = (text, params = []) => ({
    text, params,
    async first() { return sql.prepare(text).get(...params) || null },
    async all() { return { results: sql.prepare(text).all(...params) } },
    async run() {
      const result = sql.prepare(text).run(...params)
      return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    },
  })
  const env = {
    DB: {
      prepare(text) {
        const bare = wrap(text)
        return { bind(...params) { return wrap(text, params) }, first: () => bare.first(), all: () => bare.all(), run: () => bare.run() }
      },
      async batch(statements) {
        return sql.transaction(() => statements.map((statement) => {
          const result = sql.prepare(statement.text ?? statement.sql).run(...(statement.params ? (Array.isArray(statement.params) ? statement.params : Object.values(statement.params)) : []))
          return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
        }))()
      },
    },
  }
  return { sql, env }
}

function ctx(env, body) {
  let statusCode = 200
  return {
    env, get: () => actor,
    req: { json: async () => body },
    executionCtx: { waitUntil: () => {} },
    json(payload, status) { if (status) statusCode = status; return { payload, status: statusCode } },
  }
}

const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) }
  catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}

async function main() {
  const route = loadRoute()

  await check('an unknown product_id 404s instead of creating a product row', async () => {
    const f = fixture()
    const before = f.sql.prepare('SELECT COUNT(*) c FROM products').get().c
    const result = await route.runReceiveBatchAction(ctx(f.env, {
      product_id: 999, branch_id: 1, quantity: 3, unit_cost_usd: 4, supplier_name: 'Bong Long', received_date: '2026-09-17',
    }), { product_id: 999, branch_id: 1, quantity: 3, unit_cost_usd: 4, supplier_name: 'Bong Long', received_date: '2026-09-17' })
    assert.equal(result.status, 404)
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, before, 'no row was created for the unresolvable id')
  })

  await check('receiving against a real product_id never reads or writes a name/barcode field', async () => {
    const f = fixture()
    const before = f.sql.prepare('SELECT barcode, name FROM products WHERE id=1').get()
    const result = await route.runReceiveBatchAction(ctx(f.env, {}), {
      product_id: 1, branch_id: 1, quantity: 2, unit_cost_usd: 6, supplier_name: 'Bong Long', received_date: '2026-09-17',
    })
    assert.equal(result.status, 200)
    const after = f.sql.prepare('SELECT barcode, name FROM products WHERE id=1').get()
    assert.deepEqual(after, before, 'the route has no name/barcode input to fold or refuse on -- receiving stock never touches identity fields')
    assert.equal(f.sql.prepare('SELECT COUNT(*) c FROM products').get().c, 1, 'still exactly one row -- no fork, no fold, nothing to align')
  })

  await check('ReceiveBody genuinely has no name or barcode field (source-level pin)', () => {
    const source = fs.readFileSync(path.join(root, 'src/routes/batches.ts'), 'utf8')
    const typeBlock = source.slice(source.indexOf('export type ReceiveBody'), source.indexOf('export async function runReceiveBatchAction'))
    assert.equal(/\bname\??:/.test(typeBlock), false, 'ReceiveBody must not gain a name field without this test being revisited')
    assert.equal(/\bbarcode\??:/.test(typeBlock), false, 'ReceiveBody must not gain a barcode field without this test being revisited')
  })

  if (failures.length) {
    console.error(`\n${failures.length} failing: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nAll batches.ts no-product-identity-surface tests passed')
}

main()
