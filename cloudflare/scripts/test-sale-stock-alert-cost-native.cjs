// NOTIF-V2: the stock-alert statement and the bell's feed read a handful of rows however big the catalog is.
//
// The first version joined `candidates cand JOIN products p ON p.id = cand.id`; SQLite planned that as a walk
// of idx_products_active_grouped_pg plus an automatic index over the candidates, so EVERY sale read the whole
// catalog (118 -> 166 rows on a small shop, 3,123 -> 6,172 rows with 3,000 more products) and the comment above it
// ("never the whole catalog") was false. A source-shape check cannot see that; this measures it.
//
// Native: the REAL statements run on workerd's SQLite through Miniflare's D1 binding, which reports the engine's own
// `meta.rows_read` -- the figure Cloudflare bills. The schema (tables, indexes) is copied from the REAL migration
// chain; triggers are not copied (they belong to other writes and are measured by their own tests).
//
//   * POSITIVE CONTROL: the pre-fix join order, run the same way, reads thousands of extra rows on the big catalog --
//     so a flat result for the real statement means something;
//   * the real write statement reads the same number of rows on 300 products as on 3,300 (within a small constant);
//   * the bell's feed likewise.
//
// Run: node scripts/test-sale-stock-alert-cost-native.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const modules = new Map()
function load(rel) {
  if (modules.has(rel)) return modules.get(rel).exports
  const output = ts.transpileModule(fs.readFileSync(path.join(SRC, rel), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: path.join(SRC, rel),
  }).outputText
  const mod = { exports: {} }
  modules.set(rel, mod)
  const localRequire = (request) => {
    if (request === './db') return {}
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const alerts = load('lib/saleStockAlerts.ts')
const CONFIG = { enabled: true, mode: 'product', threshold: 10 }

/** @name -> ?N, one slot per distinct name (D1 binds positionally). */
function numbered(sql, params) {
  const slots = []
  const text = sql.replace(/@(\w+)/g, (_, name) => {
    let index = slots.indexOf(name)
    if (index < 0) { slots.push(name); index = slots.length - 1 }
    return `?${index + 1}`
  })
  return { text, values: slots.map((name) => params[name]) }
}

function schemaFrom(reference, tables) {
  const wanted = new Set(tables)
  return reference.prepare('SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE \'sqlite_%\'').all()
    .filter((object) => wanted.has(object.tbl_name) && (object.type === 'table' || object.type === 'index'))
}

async function measure(productCount, { families }) {
  const reference = new DatabaseSync(':memory:')
  reference.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) reference.exec(sql)
  const objects = schemaFrom(reference, ['products', 'stock_alert_events', 'sales', 'branches'])
  const mf = new Miniflare({ modules: true, script: '', compatibilityDate: '2026-08-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch(objects.filter((object) => object.type === 'table').map((object) => db.prepare(object.sql)))
    await db.batch(objects.filter((object) => object.type === 'index').map((object) => db.prepare(object.sql)))
    const insert = db.prepare('INSERT INTO products (name, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active, is_group, parent_id, barcode) VALUES (?1, ?2, 10, 0, 1, 0, ?3, ?4)')
    // Ordinary catalog rows (healthy, single-row families) plus `families` small variant families with a parent.
    const rows = []
    for (let i = 1; i <= productCount; i += 1) rows.push(insert.bind(`Catalog ${i}`, 50, null, `C${i}`))
    for (let start = 0; start < rows.length; start += 400) await db.batch(rows.slice(start, start + 400))
    await db.prepare("INSERT INTO branches (id, name) VALUES (1, 'Main')").run()
    for (let f = 1; f <= families; f += 1) {
      const parent = await db.prepare('INSERT INTO products (name, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active, is_group, barcode) VALUES (?1, 0, 10, 0, 1, 1, ?2)').bind(`Family ${f}`, `F${f}`).run()
      const parentId = parent.meta.last_row_id
      for (let v = 1; v <= 3; v += 1) await insert.bind(`Family ${f} v${v}`, 12, parentId, `F${f}V${v}`).run()
    }
    const sold = await db.prepare("SELECT id FROM products WHERE name = 'Catalog 5'").first()
    const variant = await db.prepare("SELECT id FROM products WHERE name = 'Family 1 v1'").first()
    await db.prepare("INSERT INTO sales (id, receipt_number, sale_status, client_request_id) VALUES (1, 'R-1', 'completed', 'wk-1')").run()

    const lines = [{ product_id: sold.id, branch_id: 1, quantity: 45 }, { product_id: variant.id, branch_id: 1, quantity: 12 }]
    const write = alerts.planSaleStockAlertStatement({ lines, lowStock: CONFIG, sale: { saleId: 1 } })
    const rowsReadOf = async (sql, params) => {
      const { text, values } = numbered(sql, params)
      const result = await db.prepare(text).bind(...values).run()
      return result.meta.rows_read
    }
    const out = {}
    out.write = await rowsReadOf(write.sql, write.params)
    out.events = (await db.prepare('SELECT COUNT(*) AS n FROM stock_alert_events').first()).n
    const preFix = write.sql.replace('CROSS JOIN products p ON p.id = cand.id', 'JOIN products p ON p.id = cand.id')
    assert.notEqual(preFix, write.sql, 'the control really is the pre-fix join')
    await db.prepare('DELETE FROM stock_alert_events').run()
    out.control = await rowsReadOf(preFix, write.params)
    await db.prepare('DELETE FROM stock_alert_events').run()
    // Seed a few events so the feed has something to classify.
    await rowsReadOf(write.sql, write.params)
    out.feed = await rowsReadOf(alerts.stockAlertFeedSql(CONFIG), { since: '2000-01-01 00:00:00', limit: 10 })
    return out
  } finally {
    await mf.dispose()
    reference.close()
  }
}

async function main() {
  const small = await measure(300, { families: 10 })
  const big = await measure(3300, { families: 10 })
  console.log(`rows_read  small(300): write=${small.write} control=${small.control} feed=${small.feed}   big(3300): write=${big.write} control=${big.control} feed=${big.feed}`)

  assert.ok(big.control - small.control >= 2500, `POSITIVE CONTROL: the pre-fix join order reads the catalog (${small.control} -> ${big.control})`)
  console.log('PASS positive control: the pre-fix join order reads thousands of extra rows on the big catalog')

  assert.ok(big.write - small.write <= 12, `the write statement is catalog-size independent: ${small.write} -> ${big.write}`)
  assert.ok(big.write < 250, `and small in absolute terms: ${big.write} rows for a two-product sale`)
  console.log('PASS the sale\'s alert statement reads the same rows on 300 and on 3,300 products')

  assert.ok(big.feed - small.feed <= 12, `the bell feed is catalog-size independent: ${small.feed} -> ${big.feed}`)
  assert.ok(big.feed < 250, `and small in absolute terms: ${big.feed} rows`)
  console.log('PASS the bell\'s feed reads the same rows on 300 and on 3,300 products')
}

main().catch((error) => { console.error(error); process.exit(1) })
