// Actual pure contracts, full migrated SQLite and native workerd/D1 SQL.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare } = require('miniflare')
const { openDb } = require('./harness/d1compat.cjs')
const dir = path.resolve(__dirname, '../migrations')
const migration = fs.readFileSync(path.join(dir, '0158_sale_return_money_precision.sql'), 'utf8')
const old = fs.readdirSync(dir).filter(f => f.endsWith('.sql') && f < '0158').sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
const statements = migration.match(/ALTER TABLE[^;]+;|CREATE TRIGGER[\s\S]*?END;/g)
assert.equal(statements.length, 10)
assert.ok(!migration.includes('\r'), 'trigger migration is LF-only')

async function main() {
  const source = `export * from './src/lib/saleMoneyPrecision'; export * from './src/lib/refundMoneyPrecision';`
  const bundle = await build({ stdin: { contents: source, resolveDir: path.resolve(__dirname, '..'), loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022' })
  const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
  const m = mod.exports
  for (const [raw, payable, adjustment] of [[1.2345,1.23,-.0045],[1.235,1.24,.005],[0.0001,0,-.0001],[0,0,0],[1e11,1e11,0],[99999999999.9949,99999999999.99,-.0049],[99999999999.995,1e11,.005]]) {
    const result = m.buildSaleMoneyPrecision(raw)
    assert.equal(result.total_usd, payable); assert.equal(result.rounding_adjustment_usd, adjustment)
    assert.equal(m.validateSaleMoneySnapshot(result), result)
  }
  for (const raw of [-.00001, -1, Infinity, NaN, null, true, '', 1e11 + 1]) assert.throws(() => m.buildSaleMoneyPrecision(raw))
  const legacy = { total_usd: 1.23456789 }
  assert.equal(m.validateSaleMoneySnapshot(legacy), legacy)
  assert.throws(() => m.validateSaleMoneySnapshot({ ...legacy, money_precision_version: 2 }))
  assert.throws(() => m.validateSaleMoneySnapshot({ ...legacy, calculated_total_usd: 1.2346 }))
  const first = m.buildRefundMoneyPrecision({ eligibleRaw: .005, originalPayable: .01, previous: [] })
  const second = m.buildRefundMoneyPrecision({ eligibleRaw: .005, originalPayable: .01, previous: [first] })
  assert.equal(first.total_refund_usd, .01); assert.equal(second.total_refund_usd, 0)
  assert.equal(first.rounding_adjustment_usd + second.rounding_adjustment_usd, 0)
  assert.throws(() => m.buildRefundMoneyPrecision({ eligibleRaw: .01, originalPayable: .01, previous: [first,second] }), /cap_exceeded/)
  assert.throws(() => m.buildRefundMoneyPrecision({ eligibleRaw: .01, originalPayable: 1, previous: [{ money_precision_version: 0, total_refund_usd: .1 }] }), /legacy_refund/)
  assert.throws(() => m.validateRefundMoneySnapshot({ ...first, calculated_refund_usd: .00501 }))
  const low = m.buildRefundMoneyPrecision({ eligibleRaw: .0049, originalPayable: .01, previous: [] })
  const crossing = m.buildRefundMoneyPrecision({ eligibleRaw: .0002, originalPayable: .01, previous: [low] })
  assert.equal(crossing.rounding_adjustment_usd,.0098)
  assert.throws(() => m.buildRefundMoneyPrecision({ eligibleRaw: .001, originalPayable: 1, previous: [{ ...low, total_refund_usd: .01, rounding_adjustment_usd: .0051 }] }), /invalid_refund_cohort/)
  console.log('PASS actual pure contracts: signed ties, range, canonical snapshots, legacy shape, cumulative refund cap')

  const sqlite = openDb(old).db
  sqlite.exec("INSERT INTO sales(id,total_usd,notes) VALUES(1,1.23456789,'legacy'); INSERT INTO returns(id,sale_id,total_refund_usd,notes) VALUES(1,1,-0.000012345,'legacy')")
  const tables = ['sales','returns','sale_write_revisions']
  const before = tables.map(t => sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())
  sqlite.exec('BEGIN'); sqlite.exec(migration); sqlite.exec('ROLLBACK')
  assert.equal(sqlite.prepare('PRAGMA table_info(sales)').all().some(c => c.name === 'money_precision_version'), false)
  sqlite.exec(migration)
  for (const [i,t] of tables.entries()) {
    const rows = sqlite.prepare(`SELECT * FROM ${t} ORDER BY 1`).all().map(row => {
      if (t !== 'sale_write_revisions') { assert.equal(row.money_precision_version,0); assert.equal(row.rounding_adjustment_usd,0); assert.equal(row[t === 'sales' ? 'calculated_total_usd' : 'calculated_refund_usd'],null) }
      return Object.fromEntries(Object.keys(before[i][0] || {}).map(k => [k,row[k]]))
    })
    assert.deepEqual(rows.map(r => ({...r})), before[i].map(r => ({...r})))
  }
  sqlite.exec("UPDATE sales SET notes='metadata only' WHERE id=1")
  sqlite.exec('BEGIN')
  sqlite.exec("UPDATE sales SET notes='must rollback' WHERE id=1")
  assert.throws(() => sqlite.exec('UPDATE sales SET money_precision_version=1,calculated_total_usd=1,total_usd=2 WHERE id=1'), /money_precision/)
  sqlite.exec('ROLLBACK')
  assert.equal(sqlite.prepare('SELECT notes FROM sales WHERE id=1').get().notes,'metadata only')
  // Full-column JSON backup/restore into the actual migrated table schema.
  const backup = JSON.parse(JSON.stringify(sqlite.prepare('SELECT * FROM sales').all()))
  const restored = openDb([...old,migration]).db
  for (const row of backup) restored.prepare(`INSERT INTO sales (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row))
  assert.deepEqual(JSON.parse(JSON.stringify(restored.prepare('SELECT * FROM sales').all())), backup)
  restored.close(); sqlite.close()
  console.log('PASS full migrated SQLite: old-column/revision invariance, migration rollback, metadata, batch rollback, backup shape')

  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("fixture")}}', d1Databases: ['DB'], compatibilityDate: '2026-08-01' })
  try {
    const db = await mf.getD1Database('DB')
    await db.batch([db.prepare('CREATE TABLE sales(id INTEGER PRIMARY KEY,total_usd REAL,notes TEXT)'), db.prepare('CREATE TABLE returns(id INTEGER PRIMARY KEY,total_refund_usd REAL,notes TEXT)')])
    await assert.rejects(db.batch([...statements.map(s => db.prepare(s)), db.prepare('SELECT missing_column FROM sales')]))
    assert.equal((await db.prepare('PRAGMA table_info(sales)').all()).results.some(c => c.name === 'money_precision_version'), false)
    await db.batch(statements.map(s => db.prepare(s)))
    let id = 1
    for (const raw of [0,.0001,.0049,.005,.0051,1.2345,1.235,1e11,99999999999.9949,99999999999.995]) {
      const row = m.buildSaleMoneyPrecision(raw)
      await db.prepare('INSERT INTO sales(id,money_precision_version,calculated_total_usd,rounding_adjustment_usd,total_usd) VALUES(?,1,?,?,?)').bind(id++,row.calculated_total_usd,row.rounding_adjustment_usd,row.total_usd).run()
    }
    // Exercise every four-decimal tick in the final cent below the cap.
    for (let offset = 1; offset <= 100; offset++) {
      const units = 1000000000000000n - BigInt(offset)
      const text = String(units); const raw = text.slice(0,-4) + '.' + text.slice(-4)
      const row = m.buildSaleMoneyPrecision(raw)
      await db.prepare('INSERT INTO sales(money_precision_version,calculated_total_usd,rounding_adjustment_usd,total_usd) VALUES(1,?,?,?)').bind(row.calculated_total_usd,row.rounding_adjustment_usd,row.total_usd).run()
    }
    for (const [raw,adjustment,payable,version] of [[1,.0001,1,1],[1.00001,0,1,1],[1,0,1.001,1],[1,0,1,2],[null,0,1,1],[1e11+.01,0,1e11+.01,1],[-.0001,.0001,0,1],[1,.01,1.01,1]]) {
      await assert.rejects(db.prepare('INSERT INTO sales(money_precision_version,calculated_total_usd,rounding_adjustment_usd,total_usd) VALUES(?,?,?,?)').bind(version,raw,adjustment,payable).run(), /money_precision/)
    }
    for (const row of [first,second,low,crossing]) await db.prepare('INSERT INTO returns(money_precision_version,calculated_refund_usd,rounding_adjustment_usd,total_refund_usd) VALUES(1,?,?,?)').bind(row.calculated_refund_usd,row.rounding_adjustment_usd,row.total_refund_usd).run()
    await assert.rejects(db.batch([db.prepare("UPDATE sales SET notes='partial' WHERE id=1"),db.prepare('UPDATE sales SET total_usd=total_usd+0.01 WHERE id=2')]), /money_precision/)
    assert.equal((await db.prepare('SELECT notes FROM sales WHERE id=1').first()).notes,null)
    await db.prepare('UPDATE sales SET money_precision_version=0,calculated_total_usd=NULL,rounding_adjustment_usd=0,total_usd=1.23456789 WHERE id=1').run()
    assert.equal((await db.prepare('SELECT total_usd FROM sales WHERE id=1').first()).total_usd,1.23456789)
    console.log('PASS native workerd/D1: additive batch rollback, integer-scale 1e11 goldens, invalid equations, cumulative returns, exact v0 restoration')
  } finally { await mf.dispose() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
