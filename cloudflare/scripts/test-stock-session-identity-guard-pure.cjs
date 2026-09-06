// THE identity rule on the FAST STOCK-IN path (N15 repair, 2026-09-06).
//
// commitStockSession's create_receive guard was the last inflow still using
// the pre-Sep-4 identity: raw barcode AND cost. Two consequences, both live:
//
//   * a code retyped with a leading zero ("0123" beside "123") minted a
//     SECOND product row, the exact twin the merge tool then had to clean up
//     and the exact pair the owner ruled is one product;
//   * a second cost for one article forked a child row, which the Sep-4
//     ruling ("only different barcode creates new child row... rest merge")
//     reversed -- every other inflow (the product form, CSV import, transfer
//     and add-stock matching) had already dropped cost from identity.
//
// Both halves are pinned BEHAVIOURALLY below: the session is committed for
// real against a real SQLite loaded from the real migrations, and the guard
// either refuses or does not. Each case is DISCRIMINATING -- it passes on the
// repaired guard and fails on the raw-barcode-plus-cost one.
//
// The commit-time race assertions are SQL predicates inside the batch, so
// they cannot call the JS fold. identityBarcodeKeySql is the one SQL copy of
// it; the first section here runs that expression and the real
// identityBarcodeKey over the same fixture set and asserts they agree, so the
// copy cannot drift silently.
//
// Run (from cloudflare/): node scripts/test-stock-session-identity-guard-pure.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')

const user = {
  id: 7, username: 'stock-user', name: 'Stock User', organization_id: null,
  role_id: null, permissions: JSON.stringify({ inventory: true, products: true }), is_active: 1,
}

function loadModule(entry) {
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
      if (name === './cache') return { bumpVersion: async () => {} }
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
  const envDb = {
    prepare(text) {
      const bare = wrap(text)
      return {
        bind(...params) { return wrap(text, params) },
        first: () => bare.first(),
        all: () => bare.all(),
        run: () => bare.run(),
      }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((statement) => {
        const result = sql.prepare(statement.text).run(...statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  }
  return { sql, env: { DB: envDb } }
}

let seq = 0
function createRequest(product) {
  seq += 1
  return {
    client_request_id: `identity-guard-${seq}`,
    mode: 'stock_in',
    defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Bong Long' },
    items: [{
      line_id: `line-${seq}`, kind: 'create_receive', quantity: 0,
      product: { cost_price_khr: 0, selling_price_usd: 14, stock_quantity: 0, branch_id: 1, ...product },
    }],
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

async function refusal(commit, env, request) {
  try {
    await commit(env, user, request)
    return null
  } catch (error) {
    return { status: error?.statusCode ?? null, code: error?.code ?? null, message: String(error?.message || '') }
  }
}

async function main() {
  const { commitStockSession } = loadModule('lib/stockSession.ts')
  const { identityBarcodeKeySql } = loadModule('lib/productIdentity.ts')
  const { identityBarcodeKey } = loadModule('lib/productDetailRule.ts')

  // --- 1. the SQL copy of the fold and the real fold answer identically ----
  await check('identityBarcodeKeySql agrees with identityBarcodeKey on every edge case', () => {
    const probes = [
      '', ' ', '0', '00', '000', '0012', '00012', '0123', '123', '000123',
      '3614274226546', '03614274226546', '  03614274226546  ',
      'ABC0', 'abc0', '0abc12', 'SER-1', '0000000000000', '1000', '01000',
    ]
    const db = new Database(':memory:')
    db.exec('CREATE TABLE p(barcode TEXT)')
    const insert = db.prepare('INSERT INTO p(barcode) VALUES(?)')
    for (const probe of probes) insert.run(probe)
    const rows = db.prepare(`SELECT barcode, ${identityBarcodeKeySql('barcode')} AS folded FROM p`).all()
    for (const row of rows) {
      assert.equal(row.folded, identityBarcodeKey(row.barcode),
        `SQL fold disagrees with identityBarcodeKey on ${JSON.stringify(row.barcode)}`)
    }
    // A NULL column must fold to '' the same way, not to NULL.
    db.prepare('INSERT INTO p(barcode) VALUES(NULL)').run()
    const nulled = db.prepare(`SELECT ${identityBarcodeKeySql('barcode')} AS folded FROM p WHERE barcode IS NULL`).get()
    assert.equal(nulled.folded, identityBarcodeKey(null))
    // And the probes actually discriminate: at least one folds, one does not.
    assert.equal(identityBarcodeKey('03614274226546'), '3614274226546')
    assert.equal(identityBarcodeKey('0012'), '0012')
  })

  // --- 2. a leading-zero retype is the SAME product, not a new row ---------
  await check('a create_receive line whose barcode differs only by a leading zero is refused', async () => {
    const { sql, env } = fixture()
    const before = sql.prepare('SELECT COUNT(*) c FROM products').get().c
    const result = await refusal(commitStockSession, env, createRequest({
      name: 'Rose Lip Oil', barcode: '03614274226546', cost_price_usd: 5,
    }))
    assert.ok(result, 'the session must NOT mint a second row for one barcode')
    assert.equal(result.status, 409)
    assert.equal(result.code, 'duplicate_product')
    assert.match(result.message, /already exists with this barcode/)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, before, 'and nothing was written')
  })

  // --- 3. a second cost for one article is a MERGE, not a child row --------
  await check('a create_receive line that only differs in cost is refused', async () => {
    const { sql, env } = fixture()
    const result = await refusal(commitStockSession, env, createRequest({
      name: 'Rose Lip Oil', barcode: '3614274226546', cost_price_usd: 7.9,
    }))
    assert.ok(result, 'a second cost forks nothing under the Sep-4 ruling')
    assert.equal(result.code, 'duplicate_product')
    // The message may no longer promise cost was part of the decision.
    assert.doesNotMatch(result.message, /and cost/)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 1)
  })

  // --- 4. both at once: the zero-form twin bought at a second price --------
  await check('the canonical N15 line -- leading zero AND a different cost -- is refused', async () => {
    const { env } = fixture()
    const result = await refusal(commitStockSession, env, createRequest({
      name: '  rose   lip oil ', barcode: '03614274226546', cost_price_usd: 7.9,
    }))
    assert.ok(result)
    assert.equal(result.code, 'duplicate_product')
  })

  // --- 5. POSITIVE CONTROL: a genuinely different barcode still creates ----
  await check('a genuinely different barcode still creates its own child row', async () => {
    const { sql, env } = fixture()
    const result = await refusal(commitStockSession, env, createRequest({
      name: 'Rose Lip Oil', barcode: '3614274226999', cost_price_usd: 7.9,
    }))
    assert.equal(result, null, `a different barcode is a child row, not a duplicate: ${result && result.message}`)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2)
    // A short zero-padded code is NOT folded (stripping would leave < 3
    // characters), so it is also its own row -- the control for section 2.
    const short = await refusal(commitStockSession, env, createRequest({
      name: 'Tiny Balm', barcode: '0012', cost_price_usd: 1,
    }))
    assert.equal(short, null)
    const alsoShort = await refusal(commitStockSession, env, createRequest({
      name: 'Tiny Balm', barcode: '12', cost_price_usd: 1,
    }))
    assert.equal(alsoShort, null, "'0012' and '12' are NOT the same code -- the fold is bounded")
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 4)
  })

  // --- 6. two lines in ONE request are held to the same rule ---------------
  await check('two create_receive lines in one request that fold together are refused', async () => {
    const { env } = fixture()
    const request = createRequest({ name: 'Amber Balm', barcode: '9001234567890', cost_price_usd: 3 })
    request.items.push({
      line_id: 'line-twin', kind: 'create_receive', quantity: 0,
      product: {
        name: 'Amber Balm', barcode: '09001234567890', cost_price_usd: 4.5,
        cost_price_khr: 0, selling_price_usd: 9, stock_quantity: 0, branch_id: 1,
      },
    })
    const result = await refusal(commitStockSession, env, request)
    assert.ok(result, 'one request may not create the twin either')
    assert.equal(result.code, 'duplicate_product')
    assert.match(result.message, /same product identity/)
  })

  if (failures.length) {
    console.error(`\n${failures.length} failing: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nAll stock-session identity guard tests passed')
}

main()
