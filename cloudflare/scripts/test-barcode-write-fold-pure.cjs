'use strict'
// Lane 6.0.938 (spec lane S7): a barcode being WRITTEN stores ASCII digits.
//
// A scanner gun on the Windows Khmer keyboard layout types ៣ for 3. Search already folds those digits (lane S3)
// and "+ Create" prefills ASCII (lane 934), but a product saved with a Khmer-digit barcode was stored in Khmer
// numerals, so labels, exports, the old system and exact-barcode lookups disagreed. Every Worker path that writes
// products.barcode now folds ០-៩ to 0-9 (lib/searchMatch.ts foldNativeDigits) and nothing else: no trim, no case, no
// leading-zero change. A name that contains Khmer digits is not a barcode and stays as typed.
//
// Each section drives the REAL writer against a real SQLite built from the real migrations, so the check is on
// the stored row and on the duplicate verdict, not on a source string. The duplicate cases are DISCRIMINATING: a
// Khmer-digit string is not a "real" barcode (productDetailRule.isRealBarcode wants ASCII digits), so unfolded it
// is a wildcard that matches ANY same-name row. The fixtures therefore keep two real siblings of one name and put
// the Khmer spelling of the one the wildcard would NOT pick.
//
// Every check runs and the failures are listed together, so the red on the base commit names each broken writer.
//
// Run (from cloudflare/): node scripts/test-barcode-write-fold-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const Database = require('better-sqlite3')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const KHMER = '៣៣៤៨៩០១៧២៩២២២'
const ASCII = '3348901729222'
const OTHER = '5000000000001'
const OTHER_KHMER = '៥០០០០០០០០០០០១'
const DATED = '4006381333931'
const DATED_KHMER = '៤០០៦៣៨១៣៣៣៩៣១'
const KHMER_NAME = 'ទឹកអប់ផ្កាម្លិះ ១០០មល'

const failures = []
async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`RED  ${name}\n     ${String(error && error.message).split('\n')[0]}`)
  }
}

function seed(raw, sql, params = {}) {
  return seedStockFixture(raw.db, () => raw.prepare(sql).run(params))
}

// d1compat's Stmt.bind takes ONE argument (an object or an array); real D1 binds variadically, which is how
// productWrites.ts's insertRow/updateRow call it. This shim collects the spread so the positional UPDATE is real.
function d1Shim(raw) {
  return {
    prepare(sql) {
      const statement = raw.prepare(sql)
      const api = {
        sql,
        bound: undefined,
        bind: (...args) => { api.bound = args; return api },
        get: (p) => statement.get(p !== undefined ? p : api.bound),
        all: (p) => statement.all(p !== undefined ? p : api.bound) ?? [],
        run: (p) => statement.run(p !== undefined ? p : api.bound),
      }
      return api
    },
    batch: (items) => raw.batch(items.map((item) => ({ sql: item.sql, params: 'bound' in item ? item.bound : item.params }))),
  }
}
// A tiny loader for a lib module and its real siblings (lib/x.ts for './x', src/x.ts for '../x'); only the cache and
// the broadcast hub are stubbed. Used by the writers that run against a better-sqlite3 world below.
const SRC = path.join(__dirname, '..', 'src')
function loadLib(entry, stubs = {}) {
  const cache = new Map()
  const load = (relativeFile) => {
    if (cache.has(relativeFile)) return cache.get(relativeFile).exports
    const file = path.join(SRC, relativeFile)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    }).outputText
    const mod = { exports: {} }
    cache.set(relativeFile, mod)
    const req = (name) => {
      if (name in stubs) return stubs[name]
      if (name === './cache') return { bumpVersion: async () => {}, bumpVersions: async () => {} }
      if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
      if (name.startsWith('./')) return load(`lib/${name.slice(2)}.ts`)
      if (name.startsWith('../')) return load(`${name.slice(3)}.ts`)
      return require(name)
    }
    new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
    return mod.exports
  }
  return load(entry)
}

// A better-sqlite3 world over the real migrations, exposed as the D1 surface lib/ code expects (first/all/run/batch).
function sqliteWorld(seedSql) {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  const migrations = path.join(__dirname, '..', 'migrations')
  for (const file of fs.readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
  sql.pragma('foreign_keys = ON')
  if (seedSql) seedStockFixture(sql, () => sql.exec(seedSql))
  const wrap = (text, params = []) => ({
    text, params,
    async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
    async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
    async run() {
      const result = sqliteD1Call(sql.prepare(text), 'run', params)
      return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
    },
  })
  const DB = {
    prepare(text) {
      const bare = wrap(text)
      return { bind(...params) { return wrap(text, params) }, first: () => bare.first(), all: () => bare.all(), run: () => bare.run() }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((statement) => {
        const result = sqliteD1Call(sql.prepare(statement.text), 'run', statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  }
  return { sql, env: { DB } }
}

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const ctx = { waitUntil: (promise) => { promise?.catch?.(() => {}) }, passThroughOnException: () => {} }

// One products-route world: an in-memory D1 with every migration and the real routes/products.ts, called as an admin
// (every permission held, so the writer rather than a gate decides). Built once; each call starts from an empty catalog
// with one branch.
let world = null
function productsWorld() {
  if (!world) {
    const h = createProductsRouteHarness({
      user: ADMIN,
      overrides: { './cache': { bumpVersion: async () => {}, bumpVersions: async () => {} } },
    })
    const real = h.load('lib/permissions.ts')
    h.setActionTier((...args) => real.getActionTier(...args))
    const env = { DB: d1Shim(h.raw) }
    h.call = async (method, pathname, body) => {
      const res = await h.app.request(pathname, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx)
      return { status: res.status, json: await res.json().catch(() => null) }
    }
    world = h
  }
  seedStockFixture(world.raw.db, () => world.raw.db.exec(`DELETE FROM undo_snapshots; DELETE FROM branch_batch_stock; DELETE FROM product_batches;
    DELETE FROM branch_stock; DELETE FROM damaged_stock_lots; DELETE FROM inventory_movements; DELETE FROM product_images; DELETE FROM product_cost_entries;
    UPDATE products SET stock_quantity = 0; DELETE FROM products; DELETE FROM branches;
    INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Main', 1, 1);`))
  return world
}
const stored = (h, id) => h.raw.prepare('SELECT * FROM products WHERE id = @id').get({ id })
const countProducts = (h) => h.raw.prepare('SELECT COUNT(*) AS n FROM products').get().n

async function main() {
  // ---------------------------------------------------------------- products route: create / variant / update
  await check('create (POST /products) stores the barcode with ASCII digits', async () => {
    const h = productsWorld()
    const res = await h.call('POST', '/', { name: 'Fresh Serum', barcode: KHMER, branch_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(stored(h, res.json.id).barcode, ASCII)
  })

  await check('create keeps everything but the digits: no trim, no case change, no leading-zero strip; a Khmer-digit NAME is untouched', async () => {
    const h = productsWorld()
    const res = await h.call('POST', '/', { name: KHMER_NAME, barcode: ' ០០១២៣៤abC-៥ ', description: 'ក្រឡុក ១២៣', branch_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const row = stored(h, res.json.id)
    assert.equal(row.barcode, ' 001234abC-5 ')
    assert.equal(row.name, KHMER_NAME, 'the name keeps its Khmer digits')
    assert.equal(row.description, 'ក្រឡុក ១២៣', 'free text keeps its Khmer digits')
  })

  await check('create and update: a Khmer-digit barcode that folds to scientific notation is refused 400, nothing stored', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Sci Edit', @code, 1, 5)", { code: OTHER })
    const created = await h.call('POST', '/', { name: 'Sci Create', barcode: '៨.៨៥១០៧E+១២', branch_id: 1 })
    assert.equal(created.status, 400, JSON.stringify(created.json))
    assert.equal(created.json.code, 'barcode_scientific_notation')
    const edited = await h.call('PUT', '/1', { barcode: '៨.៨៥១០៧E+១២' })
    assert.equal(edited.status, 400, JSON.stringify(edited.json))
    assert.equal(edited.json.code, 'barcode_scientific_notation')
    assert.equal(countProducts(h), 1)
    assert.equal(stored(h, 1).barcode, OTHER)
  })

  await check('create: an ASCII barcode and an empty one are stored exactly as before', async () => {
    const h = productsWorld()
    const withAscii = await h.call('POST', '/', { name: 'Ascii Serum', barcode: ASCII, branch_id: 1 })
    const withNone = await h.call('POST', '/', { name: 'No Code Serum', branch_id: 1 })
    assert.equal(stored(h, withAscii.json.id).barcode, ASCII)
    assert.equal(stored(h, withNone.json.id).barcode, null)
  })

  await check('variant (POST /products/variant) stores the barcode with ASCII digits', async () => {
    const h = productsWorld()
    const res = await h.call('POST', '/variant', { name: 'Variant Serum', barcode: KHMER, branch_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(stored(h, res.json.id).barcode, ASCII)
  })

  await check('control: an edit that does not send a barcode leaves a legacy Khmer-digit barcode as stored (stored rows are rewritten only by an owner-approved repair)', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Legacy Serum', @code, 1, 5)", { code: KHMER })
    const res = await h.call('PUT', '/1', { description: 'unrelated edit' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(stored(h, 1).barcode, KHMER)
    assert.equal(stored(h, 1).description, 'unrelated edit')
  })

  await check('update (PUT /products/:id) stores the barcode with ASCII digits and leaves a Khmer-digit name alone', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, @name, '1112223334445', 1, 5)", { name: KHMER_NAME })
    const res = await h.call('PUT', '/1', { name: KHMER_NAME, barcode: KHMER })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    const row = stored(h, 1)
    assert.equal(row.barcode, ASCII)
    assert.equal(row.name, KHMER_NAME)
  })

  // ---------------------------------------------------------------- products route: duplicate verdicts on the folded value
  await check('create: a Khmer-digit barcode that EQUALS an existing ASCII barcode folds into that product, not into its same-name sibling', async () => {
    const h = productsWorld()
    // id 1 is the sibling an unfolded (wildcard) barcode would be ranked onto: lowest id, equal stock.
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Dior Backstage Highlighter', @code, 1, 5)", { code: OTHER })
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (2, 'Dior Backstage Highlighter', @code, 1, 5)", { code: ASCII })
    const res = await h.call('POST', '/', { name: 'Dior Backstage Highlighter', barcode: KHMER, branch_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.folded_into, 2, 'the duplicate is the row holding the same barcode')
    assert.equal(countProducts(h), 2, 'no twin row was saved')
    assert.equal(stored(h, 1).barcode, OTHER)
    assert.equal(stored(h, 2).barcode, ASCII)
  })

  await check('create: a Khmer-digit barcode that is a DIFFERENT real code is a new child row stored in ASCII, not folded into the wildcard match', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Dior Backstage Highlighter', @code, 1, 5)", { code: ASCII })
    const res = await h.call('POST', '/', { name: 'Dior Backstage Highlighter', barcode: OTHER_KHMER, branch_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.ok(!res.json.folded_into, 'two different real barcodes never fold together')
    assert.equal(countProducts(h), 2)
    assert.equal(stored(h, res.json.id).barcode, OTHER)
  })

  await check('create-fold: a Khmer-digit barcode folding into a zero-padded twin cleans the stored barcode to the ASCII zero-stripped code', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Dior Backstage Highlighter', @code, 1, 5)", { code: `0${ASCII}` })
    const res = await h.call('POST', '/', { name: 'Dior Backstage Highlighter', barcode: KHMER, branch_id: 1 })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.folded_into, 1)
    assert.equal(countProducts(h), 1)
    assert.equal(stored(h, 1).barcode, ASCII)
  })

  await check('update: re-barcoding a row to the Khmer spelling of a sibling code folds it into that product (edit-fold), nothing stored in Khmer', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Edit Target Cream', @code, 1, 5)", { code: ASCII })
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (2, 'Edit Target Cream', @code, 1, 5)", { code: OTHER })
    const res = await h.call('PUT', '/2', { name: 'Edit Target Cream', barcode: KHMER })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.merged_into, 1, 'the edit identifies as the row holding that barcode')
    assert.equal(stored(h, 1).is_active, 1)
    assert.equal(stored(h, 2).is_active, 0, 'the folded-away row is deactivated')
    assert.equal(h.raw.prepare("SELECT COUNT(*) AS n FROM products WHERE barcode GLOB '*[០-៩]*'").get().n, 0, 'no row holds a Khmer digit')
  })

  // ---------------------------------------------------------------- review queue: approval replays the queued request
  // A request queued before this fold (or by a client that never folded) carries the typed digits; the applier folds them
  // so the approved write and its duplicate verdict match a direct save.
  const queued = (h, actionType, entityId, payload) => {
    h.raw.prepare(`INSERT INTO pending_actions (section, action_type, entity_type, entity_id, payload_json, summary, requested_by, requested_by_name)
      VALUES ('products', @actionType, 'product', @entityId, @payload, 'queued', 7, 'Cashier')`)
      .run({ actionType, entityId, payload: JSON.stringify(payload) })
    return h.raw.prepare('SELECT * FROM pending_actions ORDER BY id DESC LIMIT 1').get()
  }
  const approve = (h, row) => h.load('lib/reviewApply.ts').applyApprovedPendingAction({ DB: d1Shim(h.raw) }, row, { id: 9, name: 'Reviewer' })

  await check('review create: an approved queued create stores the barcode with ASCII digits', async () => {
    const h = productsWorld()
    await approve(h, queued(h, 'create', null, { name: 'Queued Serum', barcode: KHMER, branch_id: 1 }))
    assert.equal(h.raw.prepare("SELECT barcode FROM products WHERE name = 'Queued Serum'").get().barcode, ASCII)
  })

  await check('review create: an approved queued create folds into the product holding the same ASCII barcode, not its same-name sibling', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Queued Twin', @code, 1, 5)", { code: OTHER })
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (2, 'Queued Twin', @code, 1, 5)", { code: ASCII })
    await approve(h, queued(h, 'create', null, { name: 'Queued Twin', barcode: KHMER, branch_id: 1 }))
    assert.equal(countProducts(h), 2, 'no twin row was saved')
    // audit_logs is not reset between checks, so the fold is found by the name this request carried.
    const fold = h.raw.prepare("SELECT entity_id FROM audit_logs WHERE action = 'fold' AND entity = 'product' AND json_extract(details, '$.requestedName') = 'Queued Twin'").get()
    assert.equal(Number(fold.entity_id), 2)
  })

  await check('review update: an approved queued edit stores the barcode with ASCII digits', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Queued Edit', @code, 1, 5)", { code: OTHER })
    await approve(h, queued(h, 'update', 1, { barcode: KHMER }))
    assert.equal(stored(h, 1).barcode, ASCII)
  })

  await check('review update: an approved queued edit onto the Khmer spelling of a sibling code is refused as an identity conflict, nothing stored', async () => {
    const h = productsWorld()
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (1, 'Queued Conflict', @code, 1, 5)", { code: ASCII })
    seed(h.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd) VALUES (2, 'Queued Conflict', @code, 1, 5)", { code: OTHER })
    await assert.rejects(() => approve(h, queued(h, 'update', 2, { name: 'Queued Conflict', barcode: KHMER })), (error) => error.code === 'review_identity_conflict')
    assert.equal(stored(h, 2).barcode, OTHER)
  })

  // ---------------------------------------------------------------- stock-in session: create_receive (create and create-fold)
  const stockUser = {
    id: 7, username: 'stock-user', name: 'Stock User', organization_id: null, role_id: null, is_active: 1,
    permissions: JSON.stringify({ inventory: true, products: true, product_cost_edit: true, product_cost_view: true }),
  }
  let sessionSeq = 0
  const sessionRequest = (product) => {
    sessionSeq += 1
    return {
      client_request_id: `barcode-fold-${sessionSeq}`, mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Bong Long' },
      items: [{ line_id: `line-${sessionSeq}`, kind: 'create_receive', quantity: 0, product: { cost_price_khr: 0, selling_price_usd: 14, stock_quantity: 0, branch_id: 1, ...product } }],
    }
  }
  const sessionWorld = (products) => sqliteWorld(`INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1);
    ${products.map(([id, name, code]) => `INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active) VALUES(${id}, '${name}', '${code}', 5, 0, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(${id}, 1, 0);`).join(' ')}`)
  const stockSession = loadLib('lib/stockSession.ts')

  await check('stock-in session create_receive: a new product is stored with the barcode in ASCII digits', async () => {
    const { sql, env } = sessionWorld([])
    const receipt = await stockSession.commitStockSession(env, stockUser, sessionRequest({ name: 'Session Serum', barcode: KHMER, cost_price_usd: 5 }))
    assert.equal(receipt.success, true)
    assert.equal(receipt.items[0].createdProduct, true)
    assert.equal(sql.prepare("SELECT barcode FROM products WHERE name = 'Session Serum'").get().barcode, ASCII)
  })

  await check('stock-in session create_receive: a Khmer-digit barcode folds onto the product holding the same ASCII barcode, not its same-name sibling', async () => {
    const { sql, env } = sessionWorld([[1, 'Session Twin', OTHER], [2, 'Session Twin', ASCII]])
    const receipt = await stockSession.commitStockSession(env, stockUser, sessionRequest({ name: 'Session Twin', barcode: KHMER, cost_price_usd: 5 }))
    assert.equal(receipt.success, true)
    assert.equal(receipt.items[0].createdProduct, false)
    assert.equal(receipt.items[0].productId, 2)
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM products').get().n, 2, 'no twin row was saved')
  })

  await check('stock-in session create_receive: folding into a zero-padded twin cleans its barcode to the ASCII zero-stripped code', async () => {
    const { sql, env } = sessionWorld([[1, 'Session Padded', `0${ASCII}`]])
    const receipt = await stockSession.commitStockSession(env, stockUser, sessionRequest({ name: 'Session Padded', barcode: KHMER, cost_price_usd: 5 }))
    assert.equal(receipt.items[0].productId, 1)
    assert.equal(sql.prepare('SELECT barcode FROM products WHERE id = 1').get().barcode, ASCII)
  })

  await check('stock-in session: a session committed with the typed Khmer digits (before the fold) still replays on a retry, no idempotency conflict', async () => {
    const { sql, env } = sessionWorld([])
    const request = sessionRequest({ name: 'Session Replay', barcode: KHMER, cost_price_usd: 5 })
    const first = await stockSession.commitStockSession(env, stockUser, JSON.parse(JSON.stringify(request)))
    assert.equal(first.success, true)
    // What an operation committed before the fold stored: the request exactly as typed.
    sql.exec('DROP TRIGGER IF EXISTS stock_session_operations_immutable')
    const stored = sql.prepare('SELECT request_json FROM stock_session_operations').get().request_json
    sql.prepare('UPDATE stock_session_operations SET request_json = ?').run(stored.replace(ASCII, KHMER))
    const retry = await stockSession.commitStockSession(env, stockUser, JSON.parse(JSON.stringify(request)))
    assert.equal(retry.replayed, true)
    assert.equal(retry.operationId, first.operationId)
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM products').get().n, 1)
  })

  await check('stock-in session: a Khmer-digit barcode that folds to scientific notation is refused, nothing created', async () => {
    const { sql, env } = sessionWorld([])
    await assert.rejects(
      () => stockSession.commitStockSession(env, stockUser, sessionRequest({ name: 'Session Sci', barcode: '៨.៨៥១០៧E+១២', cost_price_usd: 5 })),
      (error) => error.code === 'barcode_scientific_notation',
    )
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM products').get().n, 0)
  })

  // ---------------------------------------------------------------- imports: product import commit, stock-action import and its create
  // The D1Compat surface lib/importEngine.ts and lib/stockActionCommit.ts expect, over one migrated in-memory world.
  const imports = (() => {
    const raw = openDb(loadAll())
    const db = {
      prepare(sql) {
        const statement = raw.prepare(sql)
        return {
          get: (p) => statement.get(p), all: (p) => statement.all(p),
          run: async (p) => { const r = statement.run(p); return { changes: Number(r.meta.changes), lastInsertRowid: Number(r.meta.last_row_id) } },
        }
      },
      batch: (items) => raw.batch(items), batchOnce: (items) => db.batch(items), staging: null,
    }
    db.staging = db
    raw.prepare("INSERT INTO branches(id,name,role,canonical_key,is_active,is_default) VALUES(991,'Probe','shop','shop',1,1)").run()
    raw.prepare("INSERT INTO users(id,username,name,password,permissions,is_active) VALUES(91,'operator','Operator','hash','{\"all\":true}',1)").run()
    const stubs = {
      './db': { getDb: (env) => env.DB, getImportFencedDb: async (env) => env.DB, isImportMaintenanceFenceError: () => false },
      './importMaintenanceFence': { getImportFencedDb: async (env) => env.DB, isImportMaintenanceFenceError: () => false },
    }
    return { raw, db, engine: loadLib('lib/importEngine.ts', stubs), stockCommit: loadLib('lib/stockActionCommit.ts', stubs), stockImport: loadLib('lib/stockActionImport.ts', stubs) }
  })()
  const seedImported = (id, name, code) => seed(imports.raw, "INSERT INTO products (id, name, barcode, is_active, cost_price_usd, stock_quantity) VALUES (@id, @name, @code, 1, 5, 0)", { id, name, code })
  let jobSeq = 0
  async function importRows(rows) {
    jobSeq += 1
    const id = `barcode-fold-${jobSeq}`
    imports.raw.prepare(`INSERT INTO import_jobs(id,type,status,phase,policy_json,materialize_done,chunk_cursor,chunk_state_json,started_at)
      VALUES(@id,'products','applying','applying',@policy,1,0,'{}','2026-10-08')`).run({ id, policy: JSON.stringify({ apply_authorized_by_id: 91 }) })
    rows.forEach((row, index) => imports.raw.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json) VALUES(@id,@sequence,@rowNumber,@row)')
      .run({ id, sequence: index, rowNumber: index + 2, row: JSON.stringify({ _rowNumber: index + 2, ...row }) }))
    const log = console.log
    console.log = (...args) => { if (!String(args[0]).startsWith('[import-timing]')) log(...args) }
    try { await imports.engine.runImportApply({ DB: imports.db, ASSETS: { list: async () => ({ objects: [] }) } }, id) } finally { console.log = log }
    return imports.raw.prepare("SELECT result_json FROM import_job_rows WHERE job_id = @id AND phase = 'apply' ORDER BY row_number").all({ id }).map((row) => JSON.parse(row.result_json))
  }
  const byName = (name) => imports.raw.prepare('SELECT id, barcode FROM products WHERE name = @name ORDER BY id').all({ name })

  await check('product import (commit): a new product is written with the barcode in ASCII digits; a Khmer-digit name is untouched', async () => {
    const results = await importRows([{ name: KHMER_NAME, barcode: KHMER, selling_price_usd: '10' }])
    assert.equal(results[0].action, 'create', JSON.stringify(results[0]))
    assert.deepEqual(byName(KHMER_NAME).map((row) => row.barcode), [ASCII])
  })

  await check('product import (commit): a Khmer-digit barcode updates the product holding the same ASCII barcode, not its same-name sibling', async () => {
    seedImported(11, 'Import Twin', OTHER)
    seedImported(12, 'Import Twin', ASCII)
    const results = await importRows([{ name: 'Import Twin', barcode: KHMER, description: 'imported' }])
    assert.equal(results[0].action, 'update', JSON.stringify(results[0]))
    assert.deepEqual(byName('Import Twin').map((row) => [row.id, row.barcode]), [[11, OTHER], [12, ASCII]], 'no twin row, no Khmer digit stored')
    assert.equal(imports.raw.prepare("SELECT description FROM products WHERE id = 12").get().description, 'imported', 'the matched row is the one holding the code')
  })

  await check('product import (commit): a Khmer-digit barcode that is a DIFFERENT real code becomes its own child row in ASCII, not a merge into the wildcard match', async () => {
    seedImported(13, 'Import Child', ASCII)
    const results = await importRows([{ name: 'Import Child', barcode: OTHER_KHMER }])
    assert.equal(results[0].action, 'create', JSON.stringify(results[0]))
    assert.deepEqual(byName('Import Child').map((row) => row.barcode), [ASCII, OTHER])
  })

  const stockRows = (rows, products) => imports.stockImport.resolveUnifiedStockImportRows(rows, 'direct', products, [{ id: 1, name: 'Shop' }], [])

  await check('stock-action import (parse): a Khmer-digit barcode matches the catalog row holding the ASCII code, not "several products"', async () => {
    const products = [
      { id: 10, name: 'Sheet Serum', barcode: OTHER, selling_price_usd: 12, wholesale_price_usd: 10, cost_price_usd: 5 },
      { id: 11, name: 'Sheet Serum', barcode: ASCII, selling_price_usd: 12, wholesale_price_usd: 10, cost_price_usd: 5 },
    ]
    const [row] = stockRows([{ _rowNumber: 2, name: 'Sheet Serum', barcode: KHMER, shop: '3', date: '2026-08-27', action: 'add', cost_price: '5', supplier: 'Bong Long' }], products)
    assert.equal(row.productId, 11, JSON.stringify({ conflicts: row.conflicts, plan: row.plan?.kind }))
    assert.deepEqual(row.conflicts, [])
  })

  await check('stock-action import (parse): a new product row carries the barcode in ASCII digits into its create', async () => {
    const [row] = stockRows([{ _rowNumber: 2, name: 'Sheet New', barcode: KHMER, shop: '3', date: '2026-08-27', action: '' }], [])
    assert.equal(row.plan.kind, 'create')
    assert.equal(row.barcode, ASCII)
  })

  await check('stock-action import (commit): a plan sealed before the fold still creates the product with the barcode in ASCII digits', async () => {
    const created = await imports.stockCommit.ensureUnifiedStockProduct(imports.db, { jobId: 'sealed-job', identityKey: 'new:sealed|x', productName: 'Sealed Serum', barcode: KHMER })
    assert.equal(created.created, true)
    assert.equal(imports.raw.prepare('SELECT barcode FROM products WHERE id = @id').get({ id: created.productId }).barcode, ASCII)
  })

  // ---------------------------------------------------------------- dated stock count: sheet parse, match, and created products
  const datedResolve = loadLib('lib/datedStockCountResolve.ts', { './db': { getDb: (env) => env.DB } })
  const datedDecisions = loadLib('lib/datedStockCountDecisions.ts')
  const datedRow = (barcode, extra = {}) => ({ rowNumber: 1, date: '2026-08-10', branchName: 'Probe', barcode, count: 5, ...extra })

  await check('dated stock count (parse): a sheet barcode is read with ASCII digits', async () => {
    const parsed = datedResolve.parseRawDatedCountRows({ rows: [datedRow(KHMER, { productName: 'Dated Row' })] })
    assert.equal(parsed.rows[0].barcode, ASCII)
    assert.equal(parsed.rows[0].productName, 'Dated Row')
  })

  await check('dated stock count (resolve): a Khmer-digit barcode finds the catalog product holding the ASCII barcode', async () => {
    seedImported(901, 'Dated Existing', DATED)
    const parsed = datedResolve.parseRawDatedCountRows({ rows: [datedRow(DATED_KHMER)] })
    const resolution = await datedResolve.resolveDatedStockCountRows(imports.db, parsed.rows, {})
    assert.deepEqual(resolution.unresolved.map((row) => row.reason), [], JSON.stringify(resolution.unresolved))
    assert.equal(resolution.resolved[0].productId, 901)
  })

  const unresolvedCreate = (barcode, extra = {}) => ({
    rowNumber: 1, reason: 'product_not_found', suggestedActions: ['create_new'], branchId: 991,
    raw: { rowNumber: 1, date: '2026-08-10', branchName: 'Probe', productName: 'Dated Created', barcode, count: 7, ...extra },
  })
  await check('dated stock count (decisions): create_new writes the created product barcode in ASCII even from an echoed Khmer-digit row', async () => {
    const result = await datedDecisions.applyDatedStockCountDecisions(imports.db, [], [unresolvedCreate(KHMER)], [{ rowNumber: 1, action: 'create_new' }])
    assert.equal(result.productsCreated.length, 1, JSON.stringify(result.errors))
    assert.equal(imports.raw.prepare('SELECT barcode FROM products WHERE id = @id').get({ id: result.productsCreated[0].productId }).barcode, ASCII)
  })

  await check('dated stock count (decisions): create_child writes the child product barcode in ASCII even from an echoed Khmer-digit row', async () => {
    seedImported(950, 'Dated Parent', OTHER)
    const row = { ...unresolvedCreate(KHMER, { productName: 'Dated Parent' }), reason: 'ambiguous_barcode', suggestedActions: ['link_variant', 'create_child', 'create_new'], candidateProductIds: [950] }
    const result = await datedDecisions.applyDatedStockCountDecisions(imports.db, [], [row], [{ rowNumber: 1, action: 'create_child', candidateProductId: 950 }])
    assert.equal(result.productsCreated.length, 1, JSON.stringify(result.errors))
    assert.equal(imports.raw.prepare('SELECT barcode FROM products WHERE id = @id').get({ id: result.productsCreated[0].productId }).barcode, ASCII)
  })

  // ---------------------------------------------------------------- inventory add stock: the unlocked barcode edit
  // An add that edits the barcode puts the stock on the row carrying that barcode, or creates a sibling row for a new one.
  let adjustSeq = 0
  const addStockWithBarcode = (h, productId, barcode) => {
    adjustSeq += 1
    return h.inventoryCall('/adjust', {
      client_request_id: `barcode_fold_${adjustSeq}_abcdefgh`, productId, type: 'add', quantity: 2, reason: 'Stock received', supplierName: 'Bong Long',
      unitCostUsd: 17.5, branchId: 1, unlockPricing: true, pricing: { cost_usd: 17.5, barcode, selling_price_usd: 22 },
    })
  }
  const withInventory = () => {
    const h = productsWorld()
    if (!h.inventoryCall) {
      const inventory = h.load('routes/inventory.ts').default
      const env = { DB: d1Shim(h.raw) }
      h.inventoryCall = async (pathname, body) => {
        const res = await inventory.request(pathname, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx)
        return { status: res.status, json: await res.json().catch(() => null) }
      }
    }
    return h
  }

  await check('inventory add stock: an edited Khmer-digit barcode creates its sibling row with the barcode in ASCII digits', async () => {
    const h = withInventory()
    seed(h.raw, "INSERT INTO products (id, name, name_key, barcode, is_active, is_group, stock_quantity, cost_price_usd, purchase_price_usd, selling_price_usd) VALUES (4758, 'Olay Serum', 'olay serum', @code, 1, 0, 0, 17, 17, 22)", { code: OTHER })
    const res = await addStockWithBarcode(h, 4758, KHMER)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.createdSibling, true)
    assert.equal(stored(h, res.json.productId).barcode, ASCII)
  })

  await check('inventory add stock: a Khmer-digit barcode equal to the source row\'s own ASCII barcode adds to the source, no twin sibling', async () => {
    const h = withInventory()
    seed(h.raw, "INSERT INTO products (id, name, name_key, barcode, is_active, is_group, stock_quantity, cost_price_usd, purchase_price_usd, selling_price_usd) VALUES (4758, 'Olay Serum', 'olay serum', @code, 1, 0, 0, 17, 17, 22)", { code: ASCII })
    const res = await addStockWithBarcode(h, 4758, KHMER)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.equal(res.json.createdSibling, false)
    assert.equal(res.json.productId, 4758)
    assert.equal(countProducts(h), 1)
  })

  // ---------------------------------------------------------------- census query (read-only; stored rows are NOT rewritten here)
  const { pathToFileURL } = require('node:url')
  const guard = await import(pathToFileURL(path.join(__dirname, '..', '..', 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const census = guard.loadQuery('barcode-khmer-digit-census')

  await check('census query: passes the ops read-only guard as a one-row query', async () => {
    assert.deepEqual(census.rules, { minRows: 1, maxRows: 1, expectZero: null })
  })

  await check('census query: counts Khmer-digit rows and their post-fold collisions, nothing else, and returns no codes or names', async () => {
    const sql = new Database(':memory:')
    sql.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name_key TEXT DEFAULT \'\', is_active INTEGER, barcode TEXT); CREATE INDEX idx_products_barcode_pg ON products (barcode);')
    const insert = sql.prepare('INSERT INTO products (id, name_key, is_active, barcode) VALUES (?, ?, ?, ?)')
    for (const row of [
      [1, 'a', 1, KHMER], [2, 'a', 1, ASCII],              // same name, both active: a twin once rewritten
      [3, 'b', 1, OTHER_KHMER], [4, 'c', 1, OTHER],        // collides with another NAME's code
      [5, 'd', 0, DATED_KHMER],                            // inactive, no ASCII twin
      [6, 'e', 1, '៧៧៧៧៧៧៧៧'], [7, 'e', 1, '៧៧៧៧៧៧៧៧'],   // two Khmer rows that fold to one code
      [8, 'f', 1, '33៤8៩01'],                              // mixed spelling still counts
      [9, 'g', 1, '123'], [10, 'h', 1, null], [11, 'i', 1, ''], [12, 'j', 1, 'ABC-1'],
    ]) insert.run(...row)
    const rows = sql.prepare(census.sql).all()
    assert.equal(rows.length, 1)
    const { checked_at_utc: checkedAt, ...counts } = rows[0]
    assert.ok(/^\d{4}-\d{2}-\d{2} /.test(checkedAt))
    assert.deepEqual({ ...counts }, {
      khmer_digit_products: 6, khmer_digit_active: 5, collide_with_ascii: 2, collide_same_name: 1,
      collide_active_same_name: 1, fold_same_among_khmer: 2,
    })
    assert.deepEqual(Object.keys(rows[0]), ['khmer_digit_products', 'khmer_digit_active', 'collide_with_ascii', 'collide_same_name',
      'collide_active_same_name', 'fold_same_among_khmer', 'checked_at_utc'], 'counts only: no id, name or code column')
  })

  await check('census query: runs on the real products schema and finds no Khmer digit left by any writer exercised above', async () => {
    const rows = imports.raw.db.prepare(census.sql).all()
    assert.equal(rows.length, 1)
    assert.equal(Number(rows[0].khmer_digit_products), 0)
  })

  console.log('')
  if (failures.length) {
    console.log(`${failures.length} RED: ${failures.join(' | ')}`)
    process.exitCode = 1
  } else {
    console.log('all barcode write-fold checks passed')
  }
}

main().catch((error) => {
  console.error('FAIL', error && error.stack ? error.stack : error)
  process.exitCode = 1
})
