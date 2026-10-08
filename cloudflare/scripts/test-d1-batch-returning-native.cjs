const assert = require('node:assert/strict')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { openDb } = require('./harness/d1compat.cjs')

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }',
    compatibilityDate: '2026-08-01', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  const schema = [
    'CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT)',
    'CREATE TABLE history(item_id INTEGER)',
    'CREATE TABLE guards(ok INTEGER CHECK(ok=1))',
    'CREATE TRIGGER item_history AFTER INSERT ON items BEGIN INSERT INTO history VALUES(NEW.id); END',
  ]
  const local = openDb(schema)
  try {
    const remote = await mf.getD1Database('DB')
    for (const sql of schema) await remote.prepare(sql).run()
    for (const sql of [
      "INSERT INTO items(value) VALUES('one'),('two') RETURNING id,value",
      "UPDATE items SET value=value || '-updated' RETURNING id,value",
      'DELETE FROM items WHERE id=2 RETURNING id,value',
      "UPDATE items SET value='absent' WHERE id=999 RETURNING id,value",
    ]) {
      const [expected] = await remote.batch([remote.prepare(sql)])
      const [observed] = await local.batch([{ sql }])
      assert.deepEqual(JSON.parse(JSON.stringify(observed.results)), expected.results)
      assert.equal(observed.meta.changes, expected.meta.changes)
      assert.equal(observed.meta.last_row_id, expected.meta.last_row_id)
    }
    const failed = [
      "INSERT INTO items(value) VALUES('rolled back') RETURNING id,value",
      'INSERT INTO guards VALUES(0)',
    ]
    await assert.rejects(remote.batch(failed.map(sql => remote.prepare(sql))))
    await assert.rejects(local.batch(failed.map(sql => ({ sql }))))
    assert.deepEqual(JSON.parse(JSON.stringify(local.prepare('SELECT * FROM items').all())),
      (await remote.prepare('SELECT * FROM items').all()).results)
    assert.equal(local.prepare('SELECT COUNT(*) n FROM history').get().n, 2)
    assert.equal(await remote.prepare('SELECT COUNT(*) n FROM history').first('n'), 2)
    console.log('PASS native D1 batch RETURNING rows, trigger-inclusive metadata, zero matches and atomic rollback match SQLite harness')
  } finally {
    local.db.close()
    await mf.dispose()
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
