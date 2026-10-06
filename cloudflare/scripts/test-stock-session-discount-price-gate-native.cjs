// Delta review, 6 Oct 2026: a discount on a product CREATED by a stock session is a price, so it needs products:price to commit
// and to be undone or redone by someone else; and discount_enabled / discount_type are stored in exactly one form.
//
//   COMMIT   a no-price actor with a discounted create_receive line is refused; an unchanged (no discount) line passes
//   STORED   'fixed ' / 'FIXED' are stored as 'fixed'; an unknown kind or a non-boolean switch is a 400 invalid_request
//   REPLAY   the session recorded by someone WITH the price action cannot be undone or redone by a no-price actor
//            (refused before any state change), including a session recorded before the history flag existed
//   HISTORY  the history row carries requires_product_price and canReplayStockSessionPayload honours it
//
// Run (from cloudflare/scripts): node test-stock-session-discount-price-gate-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const PRICED = { id: 7, name: 'Operator', username: 'operator', organization_id: null, role_id: null, is_active: 1,
  permissions: JSON.stringify({ inventory: true, products: true, product_cost_edit: true, product_cost_view: true }) }
const NO_PRICE = { ...PRICED, id: 8, name: 'NoPrice', username: 'noprice', permissions: JSON.stringify({ inventory: true, products: true, 'products:price': false, product_cost_edit: true, product_cost_view: true }) }
function load(entry, overrides = {}) {
  const cache = new Map()
  function read(file) {
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      const name = id.split('/').at(-1)
      if (Object.hasOwn(overrides, name)) return overrides[name]
      if (name === 'cache') return { bumpVersion: async () => {} }
      if (name === 'broadcastHub') return { broadcast: async () => {} }
      return id.startsWith('.') ? read(path.resolve(path.dirname(file), `${id}.ts`)) : require(id)
    }, mod, mod.exports)
    return mod.exports
  }
  return read(path.join(root, 'src', entry))
}
function fixture() {
  const sql = new DatabaseSync(':memory:')
  sql.limits.exprDepth = 100
  sql.limits.variableNumber = 100
  sql.exec('PRAGMA foreign_keys=OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  sql.exec('PRAGMA foreign_keys=ON')
  sql.exec(`INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1);
    INSERT INTO products(id,name,barcode,cost_price_usd,stock_quantity,is_active) VALUES(1,'Serum','SER-1',2,0,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,0);`)
  const statement = (text, values = []) => {
    const prepared = sql.prepare(text)
    const args = Array.isArray(values) ? values : [values]
    return {
      text, values,
      async first() { return prepared.get(...args) || null },
      async all() { return { results: prepared.all(...args) } },
      async run() { const result = prepared.run(...args); return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } },
    }
  }
  const DB = {
    prepare(text) { return { bind: (...values) => statement(text, values), ...statement(text) } },
    async batch(statements) {
      sql.exec('BEGIN')
      try { const results = []; for (const item of statements) results.push(await item.run()); sql.exec('COMMIT'); return results } catch (error) { sql.exec('ROLLBACK'); throw error }
    },
  }
  return { sql, env: { DB } }
}
const session = load('lib/stockSession.ts')
const create = (key, discount = {}, name = 'Glow Serum') => ({
  client_request_id: key, mode: 'stock_in', defaults: { branch_id: 1, received_date: '2026-09-05', supplier_name: 'Supplier' },
  items: [{ line_id: 'create-1', kind: 'create_receive', quantity: 3, unit_cost_usd: 1.25,
    product: { name, barcode: `GS-${key}`, cost_price_usd: 1.25, selling_price_usd: 2.5, stock_quantity: 3, branch_id: 1, ...discount } }],
})
const CUT = { discount_enabled: true, discount_type: 'percent', discount_percent: 90 }
const refusal = async (promise) => { try { await promise } catch (error) { return error } return null }

const failures = []
async function check(name, fn) { try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.stack}`) } }

async function main() {
  await check('COMMIT: a no-price actor cannot create a discounted product through a session; a plain create passes', async () => {
    const f = fixture()
    const error = await refusal(session.commitStockSession(f.env, NO_PRICE, create('commit-nop-001', CUT)))
    assert.ok(error, 'refused')
    assert.equal(error.statusCode ?? error.status, 403)
    assert.equal(error.code, 'product_price_edit_required')
    assert.equal(f.sql.prepare("SELECT COUNT(*) AS n FROM products WHERE name='Glow Serum'").get().n, 0, 'nothing written')
    assert.equal((await session.commitStockSession(f.env, NO_PRICE, create('commit-nop-002', { discount_enabled: 0, discount_type: 'percent', discount_percent: 0 }))).success, true)
    for (const spelling of [{ discount_amount_usd: 1 }, { discount_type: 'fixed' }, { discount_starts_at: '2026-10-01' }]) {
      const again = await refusal(session.commitStockSession(f.env, NO_PRICE, create('commit-nop-' + Object.keys(spelling)[0], spelling, 'Other ' + Object.keys(spelling)[0])))
      assert.equal(again?.code, 'product_price_edit_required', JSON.stringify(spelling))
    }
    assert.equal((await session.commitStockSession(f.env, PRICED, create('commit-priced-01', CUT, 'Priced Serum'))).success, true, 'the price action holder may')
    f.sql.close()
  })

  await check("STORED: the kind is stored exactly ('fixed ' and 'FIXED' -> 'fixed'); an unknown kind or switch is a 400", async () => {
    const f = fixture()
    for (const [i, kind] of ['fixed ', ' FIXED', 'Percent '].entries()) {
      await session.commitStockSession(f.env, PRICED, create(`stored-kind-${i}001`, { discount_enabled: 1, discount_type: kind, discount_amount_usd: 0.5, discount_percent: 30 }, 'Kind ' + i))
      const row = f.sql.prepare('SELECT discount_type, discount_enabled FROM products WHERE name = ?').get('Kind ' + i)
      assert.equal(row.discount_type, kind.trim().toLowerCase(), JSON.stringify(kind))
      assert.equal(row.discount_enabled, 1)
    }
    for (const [label, extra] of [['unknown kind', { discount_type: 'bogus' }], ['numeric kind', { discount_type: 5 }], ['yes switch', { discount_enabled: 'yes' }], ['2 switch', { discount_enabled: 2 }], ['1.0 text switch', { discount_enabled: '1.0' }]]) {
      const error = await refusal(session.commitStockSession(f.env, PRICED, create('stored-bad-' + label.replace(/\W/g, ''), extra, 'Bad ' + label)))
      assert.equal(error?.statusCode ?? error?.status, 400, label)
      assert.equal(f.sql.prepare('SELECT COUNT(*) AS n FROM products WHERE name = ?').get('Bad ' + label).n, 0, label)
    }
    f.sql.close()
  })

  await check('REPLAY: a session that set a discount cannot be undone or redone by a no-price actor; the price holder can', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, PRICED, create('replay-disc-0001', CUT))
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    const undoPayload = JSON.parse(history.undo_payload)
    assert.equal(undoPayload.requires_product_price, 1, 'the history row records that a price was set')
    assert.equal(session.canReplayStockSessionPayload(NO_PRICE, undoPayload), false)
    assert.equal(session.canReplayStockSessionPayload(PRICED, undoPayload), true)
    const before = JSON.stringify(f.sql.prepare('SELECT * FROM products ORDER BY id').all())
    let error = await refusal(session.replayStockSession(f.env, NO_PRICE, 'undo', result.actionHistoryId, 0, undoPayload))
    assert.equal(error?.code, 'product_price_edit_required', 'undo refused')
    assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM products ORDER BY id').all()), before, 'a refused undo changes nothing')
    await session.replayStockSession(f.env, PRICED, 'undo', result.actionHistoryId, 0, undoPayload)
    const redoPayload = { ...JSON.parse(history.redo_payload), generation: 1 }
    const afterUndo = JSON.stringify(f.sql.prepare('SELECT * FROM products ORDER BY id').all())
    error = await refusal(session.replayStockSession(f.env, NO_PRICE, 'redo', result.actionHistoryId, 1, redoPayload))
    assert.equal(error?.code, 'product_price_edit_required', 'redo refused: the revival of a discounted create needs the price action too')
    assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM products ORDER BY id').all()), afterUndo, 'a refused redo changes nothing')
    await session.replayStockSession(f.env, PRICED, 'redo', result.actionHistoryId, 1, redoPayload)
    assert.equal(f.sql.prepare("SELECT discount_enabled FROM products WHERE name='Glow Serum'").get().discount_enabled, 1)
    f.sql.close()
  })

  await check('REPLAY: a session recorded BEFORE the history flag existed is still refused (judged from the stored request)', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, PRICED, create('replay-old-00001', CUT))
    f.sql.exec(`UPDATE action_history SET undo_payload=json_remove(undo_payload,'$.requires_product_price'), redo_payload=json_remove(redo_payload,'$.requires_product_price')`)
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    const undoPayload = JSON.parse(history.undo_payload)
    assert.equal(undoPayload.requires_product_price, undefined)
    const error = await refusal(session.replayStockSession(f.env, NO_PRICE, 'undo', result.actionHistoryId, 0, undoPayload))
    assert.equal(error?.code, 'product_price_edit_required')
    f.sql.close()
  })

  await check('REPLAY: a session with no discount is unaffected for a no-price actor', async () => {
    const f = fixture()
    const result = await session.commitStockSession(f.env, NO_PRICE, create('replay-plain-0001'))
    const history = f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(result.actionHistoryId)
    const payload = JSON.parse(history.undo_payload)
    assert.equal(payload.requires_product_price, 0)
    assert.equal(session.canReplayStockSessionPayload(NO_PRICE, payload), true)
    await session.replayStockSession(f.env, NO_PRICE, 'undo', result.actionHistoryId, 0, payload)
    f.sql.close()
  })
}
main().then(() => { if (failures.length) { console.error(`${failures.length} check(s) failed`); process.exit(1) } })
