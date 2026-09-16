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
  const { commitStockSession, sessionProductDuplicateReason } = loadModule('lib/stockSession.ts')
  const { identityBarcodeKeySql, identityBarcodeIsRealSql } = loadModule('lib/productIdentity.ts')
  const { identityBarcodeKey, identityBarcodeClassKey, isRealBarcode } = loadModule('lib/productDetailRule.ts')

  // --- 1. the SQL copy of the CLASS fold and the real one answer identically
  // (Sep 15 2026: identityBarcodeKeySql now folds to the barcode's CLASS
  // key -- the real folded key, or '' for anything broken/short/a word --
  // not the raw leading-zero fold identityBarcodeKey alone gives).
  await check('identityBarcodeKeySql agrees with identityBarcodeClassKey on every edge case', () => {
    const probes = [
      '', ' ', '0', '00', '000', '0012', '00012', '0123', '123', '000123',
      '3614274226546', '03614274226546', '  03614274226546  ',
      'ABC0', 'abc0', '0abc12', 'SER-1', '0000000000000', '1000', '01000',
      // Broken by the Sep 15 2026 class test (all-digit but short of
      // MIN_REAL_BARCODE_DIGITS=6): must fold to '' now, unlike the old
      // raw fold which kept these as themselves.
      '1234', '12345', '99999',
      // Real (>=6 digits): must fold through the leading-zero strip.
      '123456', '0123456',
    ]
    const db = new Database(':memory:')
    db.exec('CREATE TABLE p(barcode TEXT)')
    const insert = db.prepare('INSERT INTO p(barcode) VALUES(?)')
    for (const probe of probes) insert.run(probe)
    const rows = db.prepare(`SELECT barcode, ${identityBarcodeKeySql('barcode')} AS folded, ${identityBarcodeIsRealSql('barcode')} AS is_real FROM p`).all()
    for (const row of rows) {
      assert.equal(row.folded, identityBarcodeClassKey(row.barcode),
        `SQL class fold disagrees with identityBarcodeClassKey on ${JSON.stringify(row.barcode)}`)
      assert.equal(Boolean(row.is_real), isRealBarcode(row.barcode),
        `SQL isReal disagrees with isRealBarcode on ${JSON.stringify(row.barcode)}`)
    }
    // A NULL column must fold to '' the same way, not to NULL.
    db.prepare('INSERT INTO p(barcode) VALUES(NULL)').run()
    const nulled = db.prepare(`SELECT ${identityBarcodeKeySql('barcode')} AS folded FROM p WHERE barcode IS NULL`).get()
    assert.equal(nulled.folded, identityBarcodeClassKey(null))
    // And the probes actually discriminate: at least one folds, one does not.
    assert.equal(identityBarcodeClassKey('03614274226546'), '3614274226546')
    assert.equal(identityBarcodeClassKey('0012'), '')
    // A short numeric ('1234') is broken -- not real -- so it folds to '',
    // unlike the raw leading-zero-only fold identityBarcodeKey still gives it.
    assert.equal(identityBarcodeKey('1234'), '1234')
    assert.equal(identityBarcodeClassKey('1234'), '')
  })

  // --- 2. a leading-zero retype is the SAME product, not a new row ---------
  // Sep 16 2026 owner ruling / P10-5 writer 4: this used to be refused with
  // 409 duplicate_product; it now FOLDS into the existing row instead (never
  // a twin, never a 409) -- same rule as products.ts's foldCreateIntoExisting.
  await check('a create_receive line whose barcode differs only by a leading zero FOLDS into the existing row', async () => {
    const { sql, env } = fixture()
    const before = sql.prepare('SELECT COUNT(*) c FROM products').get().c
    const receipt = await commitStockSession(env, user, createRequest({
      name: 'Rose Lip Oil', barcode: '03614274226546', cost_price_usd: 5,
    }))
    assert.equal(receipt.success, true)
    assert.equal(receipt.items[0].productId, 1, 'the line landed on the existing row, not a new one')
    assert.equal(receipt.items[0].createdProduct, false)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, before, 'no second row was minted')
    // the real (zero-stripped) barcode wins on the survivor
    assert.equal(sql.prepare('SELECT barcode FROM products WHERE id=1').get().barcode, '3614274226546')
    assert.equal(sql.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='fold' AND entity_id='1'").get().c, 1,
      'a fold audit row is left for undo evidence')
  })

  // --- 3. a second cost for one article is a MERGE, not a child row --------
  // A quantity=0 line has no lot to receive, so there is nothing for
  // catalogCostRecompute to weight against -- the incoming cost is simply
  // not applied (the stored cost is untouched), same as it always was for a
  // quantity=0 create before this line existed at all.
  await check('a create_receive line that only differs in cost FOLDS without forking a second row', async () => {
    const { sql, env } = fixture()
    const receipt = await commitStockSession(env, user, createRequest({
      name: 'Rose Lip Oil', barcode: '3614274226546', cost_price_usd: 7.9,
    }))
    assert.equal(receipt.success, true)
    assert.equal(receipt.items[0].productId, 1)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 1)
    assert.equal(sql.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd, 5,
      'quantity=0: no lot received, so the incoming cost is not applied')
  })

  // --- 4. both at once: the zero-form twin bought at a second price --------
  await check('the canonical N15 line -- leading zero AND a different cost -- FOLDS, not refused', async () => {
    const { sql, env } = fixture()
    const receipt = await commitStockSession(env, user, createRequest({
      name: '  rose   lip oil ', barcode: '03614274226546', cost_price_usd: 7.9,
    }))
    assert.equal(receipt.success, true)
    assert.equal(receipt.items[0].productId, 1)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 1)
    assert.equal(sql.prepare('SELECT barcode FROM products WHERE id=1').get().barcode, '3614274226546')
  })

  // --- 4b. the same fold on a RECEIVE line (quantity>0): the lot lands on
  // the survivor and the survivor's catalog cost re-derives from its lots,
  // through the exact same catalogCostRecomputeStatement every other receive
  // line already gets -- not a hand-merged average.
  await check('a create_receive line with quantity>0 FOLDS and receives the lot onto the survivor', async () => {
    const { sql, env } = fixture()
    const request = createRequest({ name: 'Rose Lip Oil', barcode: '03614274226546', cost_price_usd: 7, stock_quantity: 4 })
    request.items[0].quantity = 4
    request.items[0].unit_cost_usd = 7
    const receipt = await commitStockSession(env, user, request)
    assert.equal(receipt.success, true)
    assert.equal(receipt.createdCount, 0, 'nothing was created -- this folded onto row 1')
    assert.equal(receipt.receivedCount, 1)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 1)
    assert.equal(sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 4,
      'the received quantity landed on the survivor, not a phantom second row')
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM product_batches WHERE variant_product_id=1').get().c, 1,
      'one lot was opened on the survivor')
    assert.equal(sql.prepare('SELECT barcode FROM products WHERE id=1').get().barcode, '3614274226546')
    // catalogCostRecomputeStatement re-derives products.cost_price_usd from
    // the survivor's active lots (weighted), not a hand-merged average of
    // the old 5 and the incoming 7 -- with a single lot at 7, that IS 7.
    assert.equal(sql.prepare('SELECT cost_price_usd FROM products WHERE id=1').get().cost_price_usd, 7)
  })

  // --- 4c. idempotent: replaying the exact same client_request_id must not
  // fold (or receive) a second time.
  await check('a folded create_receive is idempotent on retry with the same client_request_id', async () => {
    const { sql, env } = fixture()
    const request = createRequest({ name: 'Rose Lip Oil', barcode: '03614274226546', cost_price_usd: 5 })
    const first = await commitStockSession(env, user, request)
    const second = await commitStockSession(env, user, request)
    assert.equal(second.operationId, first.operationId)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 1)
    assert.equal(sql.prepare("SELECT COUNT(*) c FROM audit_logs WHERE action='fold'").get().c, 1,
      'the retry replayed the stored receipt -- it did not fold a second time')
  })

  // --- 5. POSITIVE CONTROL: a genuinely different barcode still creates ----
  await check('a genuinely different barcode still creates its own child row', async () => {
    const { sql, env } = fixture()
    const result = await refusal(commitStockSession, env, createRequest({
      name: 'Rose Lip Oil', barcode: '3614274226999', cost_price_usd: 7.9,
    }))
    assert.equal(result, null, `a different barcode is a child row, not a duplicate: ${result && result.message}`)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 2)
    // A short numeric code (below MIN_REAL_BARCODE_DIGITS=6) is BROKEN, not
    // a real barcode, under the Sep 15 2026 ruling -- a wildcard, so a
    // SECOND broken/short code on the SAME name is the SAME identity, and
    // (Sep 16 2026) now FOLDS into the first row instead of either minting a
    // second row or refusing.
    const short = await refusal(commitStockSession, env, createRequest({
      name: 'Tiny Balm', barcode: '0012', cost_price_usd: 1,
    }))
    assert.equal(short, null)
    const tinyBalmId = sql.prepare("SELECT id FROM products WHERE name='Tiny Balm'").get().id
    const alsoShortReceipt = await commitStockSession(env, user, createRequest({
      name: 'Tiny Balm', barcode: '12', cost_price_usd: 1,
    }))
    assert.equal(alsoShortReceipt.success, true, "'0012' and '12' are both broken/short codes -- a wildcard match, so this folds rather than refuses")
    assert.equal(alsoShortReceipt.items[0].productId, tinyBalmId, 'folded onto the SAME wildcard-matched row, not a second one')
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 3, 'still 2 + this one row -- no third "Tiny Balm" row was minted')
    // Two DIFFERENT REAL (>=6 digit) barcodes on the same name remain two
    // genuinely different child rows -- the actual positive control for the
    // wildcard rule (only a real-vs-real mismatch stays a sibling).
    const realOne = await refusal(commitStockSession, env, createRequest({
      name: 'Real Code Balm', barcode: '600123', cost_price_usd: 1,
    }))
    assert.equal(realOne, null)
    const realTwo = await refusal(commitStockSession, env, createRequest({
      name: 'Real Code Balm', barcode: '700456', cost_price_usd: 1,
    }))
    assert.equal(realTwo, null, 'two different REAL barcodes remain two child rows')
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM products').get().c, 5)
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
    assert.equal(result.code, 'duplicate_session_item')
    assert.equal(result.message, 'Duplicate: You added this item already.')
  })

  await check('session warning parity is name OR guarded barcode identity', () => {
    assert.equal(sessionProductDuplicateReason(
      { name: ' Rose   Lip Oil ', barcode: '111' },
      { name: 'rose lip oil', barcode: '222' },
    ), 'name')
    assert.equal(sessionProductDuplicateReason(
      { name: 'First', barcode: '748485110011' },
      { name: 'Second', barcode: '0748485110011' },
    ), 'barcode')
    assert.equal(sessionProductDuplicateReason({ name: 'A', barcode: '' }, { name: 'B', barcode: '' }), null)
    assert.equal(sessionProductDuplicateReason({ name: 'A', barcode: '0' }, { name: 'B', barcode: '000' }), null)
    assert.equal(sessionProductDuplicateReason(
      { name: 'UPC-E article', barcode: '01234565' },
      { name: 'Internal-code article', barcode: '1234565' },
    ), null, 'a valid UPC-E must not collide with its stripped seven-digit text')
    assert.equal(sessionProductDuplicateReason(
      { name: 'UPC-E article', barcode: '01234565' },
      { name: 'UPC-A article', barcode: '012345000065' },
    ), 'barcode', 'the actual UPC-E / UPC-A pair remains the same session item')
  })

  await check('valid UPC-E and unrelated seven-digit internal codes can be received together', async () => {
    const { sql, env } = fixture()
    sql.exec(`
      UPDATE products SET name='UPC-E article', barcode='01234565' WHERE id=1;
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active)
        VALUES(2,'Internal-code article','1234565',4,0,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0);
    `)
    const request = {
      client_request_id: 'session-upce-internal-control', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Bong Long' },
      items: [1, 2].map((productId) => ({
        line_id: `line-upce-control-${productId}`, kind: 'receive', product_id: productId,
        quantity: 1, unit_cost_usd: 5,
      })),
    }
    const receipt = await commitStockSession(env, user, request)
    assert.equal(receipt.memberCount, 2)
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c, 2)
  })

  await check('actual UPC-E and UPC-A pair is refused before any session write', async () => {
    const { sql, env } = fixture()
    sql.exec(`
      UPDATE products SET name='UPC-E article', barcode='01234565' WHERE id=1;
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active)
        VALUES(2,'UPC-A article','012345000065',4,0,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0);
    `)
    const request = {
      client_request_id: 'session-upce-upca-duplicate', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Bong Long' },
      items: [1, 2].map((productId) => ({
        line_id: `line-upc-pair-${productId}`, kind: 'receive', product_id: productId,
        quantity: 1, unit_cost_usd: 5,
      })),
    }
    const result = await refusal(commitStockSession, env, request)
    assert.equal(result?.status, 409)
    assert.equal(result?.code, 'duplicate_session_item')
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c, 0)
  })

  await check('two existing products with the same normalized name are refused before any write', async () => {
    const { sql, env } = fixture()
    sql.exec(`
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active)
        VALUES(2,'  rose   lip oil ','9999999999999',4,0,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0);
    `)
    const request = {
      client_request_id: 'session-name-duplicate', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Bong Long' },
      items: [1, 2].map((productId) => ({
        line_id: `line-${productId}`, kind: 'receive', product_id: productId,
        quantity: 1, unit_cost_usd: 5,
      })),
    }
    const result = await refusal(commitStockSession, env, request)
    assert.deepEqual(result, {
      status: 409,
      code: 'duplicate_session_item',
      message: 'Duplicate: You added this item already.',
    })
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c, 0)
  })

  await check('two existing products with folded-equal barcodes are refused even when names differ', async () => {
    const { sql, env } = fixture()
    sql.exec(`
      INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active)
        VALUES(2,'Other label','03614274226546',4,0,0,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0);
    `)
    const request = {
      client_request_id: 'session-barcode-duplicate', mode: 'stock_in',
      defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Bong Long' },
      items: [1, 2].map((productId) => ({
        line_id: `line-${productId}`, kind: 'receive', product_id: productId,
        quantity: 1, unit_cost_usd: 5,
      })),
    }
    const result = await refusal(commitStockSession, env, request)
    assert.equal(result?.status, 409)
    assert.equal(result?.code, 'duplicate_session_item')
    assert.equal(result?.message, 'Duplicate: You added this item already.')
    assert.equal(sql.prepare('SELECT COUNT(*) c FROM inventory_movements').get().c, 0)
  })

  if (failures.length) {
    console.error(`\n${failures.length} failing: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('\nAll stock-session identity guard tests passed')
}

main()
