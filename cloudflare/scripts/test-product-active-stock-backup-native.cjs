const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createHash } = require('node:crypto')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name).exports
  const filename = path.join(__dirname, '../src/lib', `${name}.ts`)
  const mod = { exports: {} }; cache.set(name, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
  }).outputText
  const shim = id => id.startsWith('./') && fs.existsSync(path.join(__dirname, '../src/lib', `${id.slice(2)}.ts`)) ? load(id.slice(2)) : require(id)
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(mod.exports, shim, mod, filename, path.dirname(filename))
  return mod.exports
}
const backup = load('backup')
function fixture() {
  const raw = openDb(loadAll()).db
  raw.exec(`INSERT INTO branches(id,name,is_active,is_default) VALUES(991,'Probe',1,1);
    INSERT INTO products(id,name,is_active,stock_quantity) VALUES(11,'Probe',1,5);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(11,991,5);
    INSERT INTO system_flags(key,value) VALUES('maintenance','{"mode":"restore"}');`)
  let deletes = 0
  const DB = {
    prepare(sql) {
      const st = raw.prepare(sql); let params = []
      const api = {
        bind(...values) { params = values; return api },
        async first() { return st.get(...params) || null },
        async all() { return { results: st.all(...params) } },
        async run() { if (/^DELETE/.test(sql)) deletes++; const r = st.run(...params); return { success: true, meta: { changes: Number(r.changes) } } },
      }; return api
    },
    async batch(items) {
      raw.exec('BEGIN')
      try { const results = []; for (const item of items) results.push(await item.run()); raw.exec('COMMIT'); return results }
      catch (error) { raw.exec('ROLLBACK'); throw error }
    },
  }
  const tables = backup.BACKUP_TABLES.filter(name => raw.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
  const document = () => ({ format: 'business-os-cloudflare-backup', formatVersion: 1,
    tables: Object.fromEntries(tables.map(name => [name, { columns: raw.prepare(`PRAGMA table_info("${name}")`).all().map(c => c.name), rows: raw.prepare(`SELECT * FROM "${name}"`).all() }])),
    r2: { assets: [], copiedKeys: [] }, summary: {} })
  const snapshot = () => JSON.stringify(tables.map(name => [name, raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))
  const env = doc => {
    const text = JSON.stringify(doc); const etag = createHash('sha256').update(text).digest('hex')
    return { DB, ASSETS: { async get(key) {
      if (!key.endsWith('/fixture.json')) return null
      return { key, etag, version: 'fixture', size: Buffer.byteLength(text), body: new Blob([text]).stream() }
    } } }
  }
  return { raw, document, snapshot, env, deletes: () => deletes }
}
async function main() {
  {
    const f = fixture(); const doc = f.document()
    f.raw.exec('UPDATE branch_stock SET quantity=7; UPDATE products SET stock_quantity=7')
    await backup.restoreCloudflareBackup(f.env(doc), 'fixture.json')
    assert.equal(f.raw.prepare('SELECT stock_quantity FROM products WHERE id=11').get().stock_quantity, 5)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=11').get().quantity, 5)
    console.log('PASS valid stocked backup replaces live stock without bypassing invariant')
  }
  for (const ledger of ['rollup', 'branch', 'lot', 'damaged']) {
    const f = fixture(); const doc = f.document()
    const p = doc.tables.products.rows[0]; p.is_active = 0; p.stock_quantity = ledger === 'rollup' ? 5 : 0
    doc.tables.branch_stock.rows[0].quantity = ledger === 'branch' ? 5 : 0
    if (ledger === 'lot') {
      doc.tables.product_batches.rows.push({ id: 90, variant_product_id: 11, batch_key: 'probe', is_active: 1, received_at: '2026-10-01' })
      doc.tables.branch_batch_stock.rows.push({ id: 90, batch_id: 90, branch_id: 991, quantity: 5 })
    }
    if (ledger === 'damaged') doc.tables.damaged_stock_lots.rows.push({ id: 90, product_id: 11, quantity_remaining: 5 })
    const before = f.snapshot()
    await assert.rejects(() => backup.restoreCloudflareBackup(f.env(doc), 'fixture.json'), /product_has_stock/)
    assert.equal(f.snapshot(), before); assert.equal(f.deletes(), 0)
    console.log(`PASS invalid ${ledger}-only inactive backup refuses before every write`)
  }
  {
    const f = fixture(); const doc = f.document(); const before = f.snapshot()
    f.raw.exec("CREATE TRIGGER restore_delete_probe BEFORE DELETE ON products BEGIN SELECT RAISE(ABORT,'restore_delete_probe'); END")
    await assert.rejects(() => backup.restoreCloudflareBackup(f.env(doc), 'fixture.json'), /restore_delete_probe/)
    assert.equal(f.snapshot(), before, 'failed product deletion rolls back earlier ledger/history deletes')
    console.log('PASS refusal inside deletion phase rolls back its complete target-table batch')
  }
  {
    const f = fixture(); const doc = f.document()
    doc.tables.products.rows[0].is_active = 0; doc.tables.products.rows[0].stock_quantity = 0
    doc.tables.branch_stock.rows[0].quantity = 0
    await backup.restoreCloudflareBackup(f.env(doc), 'fixture.json')
    assert.equal(f.raw.prepare('SELECT is_active FROM products WHERE id=11').get().is_active, 0)
    assert.equal(f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=11').get().quantity, 0)
    console.log('PASS inactive empty backup negative control restores')
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
