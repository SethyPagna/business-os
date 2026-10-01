const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { DatabaseSync } = require('node:sqlite')
const { sqliteD1Call, preflightSqliteD1, prepareSqliteControl } = require('./harness/sqlite_d1_bindings.cjs')

const queries = [
  ['SELECT ?1 AS a,?1 AS repeated,?2 AS b', [7, 9]],
  ['SELECT ?2 AS b,?1 AS a,?2 AS repeated', [0, null]],
  ['SELECT ?2 AS b,? AS c,?1 AS a', [7, 9, 11]],
  ['SELECT ?5 AS a', [1, 2, 3, 4, 5]],
  ['SELECT ? AS a,?1 AS repeated', [7]],
  ['SELECT ?01 AS a,?01 AS repeated', [7]],
  ['SELECT hex(?1) AS a,hex(?1) AS repeated,hex(?2) AS b', [new Uint8Array([0, 127, 255, 0]), new Uint8Array([0, 127, 255, 0])]],
  ["SELECT '?91 '' ?92' AS literal,?1 AS \"quoted ?93\",?1 AS `tick ?94`,hex(?2) AS [bracket ?95] /* ?96 */ -- ?97\n", ['ខ្មែរ', "quote'\u0000tail"]],
  ['SELECT ? AS a,? AS b', [0, null]],
  ['SELECT 42 AS answer', []],
]

async function main() {
  const better = new Database(':memory:')
  const node = new DatabaseSync(':memory:')
  node.limits.exprDepth = 100
  node.limits.variableNumber = 100
  let mf
  try {
    const first = queries[0]
    assert.throws(() => better.prepare(first[0]).get(...first[1]), /Too many parameter values/)
    assert.deepEqual(sqliteD1Call(better.prepare(first[0]), 'get', first[1]), { a: 7, repeated: 7, b: 9 })
    for (const [sql, values] of queries) {
      const expected = { ...sqliteD1Call(better.prepare(sql), 'get', values) }
      assert.deepEqual({ ...sqliteD1Call(node.prepare(sql), 'get', values) }, expected)
      assert.deepEqual(sqliteD1Call(better.prepare(sql), 'all', values), [expected])
    }
    for (const driver of [better, node]) {
      for (const values of [[], [1], [1, 2, 3]]) {
        assert.throws(() => sqliteD1Call(driver.prepare('SELECT ?1 AS a,?2 AS b'), 'get', values), /number of parameters|parameter count|parameter values/)
      }
      driver.exec('CREATE TABLE ledger(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
      sqliteD1Call(driver.prepare('INSERT INTO ledger VALUES(?1,?2 || ?2)'), 'run', [1, 'x'])
      assert.equal(sqliteD1Call(driver.prepare('SELECT value FROM ledger WHERE id=?1 OR id=?1'), 'get', [1]).value, 'xx')
      driver.exec('BEGIN')
      assert.throws(() => {
        sqliteD1Call(driver.prepare('UPDATE ledger SET value=?1 WHERE id=?2'), 'run', ['changed', 1])
        sqliteD1Call(driver.prepare('INSERT INTO ledger VALUES(?1,?2)'), 'run', [1, 'bad'])
      }, /UNIQUE/)
      driver.exec('ROLLBACK')
      assert.equal(driver.prepare('SELECT value FROM ledger').get().value, 'xx')
    }
    const wideSql = `SELECT ${Array.from({ length: 100 }, (_, i) => `?${i + 1} + ?${i + 1} AS c${i}`).join(',')}`
    const wideValues = Array.from({ length: 100 }, (_, i) => i)
    assert.equal(sqliteD1Call(node.prepare(wideSql), 'get', wideValues).c99, 198)
    for (const sql of [`${wideSql},?101 AS excess`, `SELECT ${Array.from({ length: 101 }, (_, i) => `? AS c${i}`).join(',')}`]) {
      assert.throws(() => sqliteD1Call(better.prepare(sql), 'get', [...wideValues, 100]), /too many SQL variables|variable number/)
    }
    const deepPredicate = Array.from({ length: 110 }, () => 'id=1').join(' AND ')
    const deepSql = `SELECT id FROM ledger WHERE ${deepPredicate}`
    assert.doesNotThrow(() => prepareSqliteControl(better, deepSql))
    assert.throws(() => preflightSqliteD1(better.prepare(deepSql)), /Expression tree is too large/)
    const before = better.serialize()
    preflightSqliteD1(better.prepare('SELECT * FROM ledger'))
    preflightSqliteD1(better.prepare('SELECT value COLLATE NOCASE FROM ledger'))
    assert.deepEqual(better.serialize(), before)
    better.exec(`CREATE VIEW deep_view AS ${deepSql}`)
    assert.throws(() => preflightSqliteD1(better.prepare('SELECT * FROM deep_view')), /Expression tree is too large/)
    better.exec('DROP VIEW deep_view')
    better.exec(`CREATE TRIGGER deep_trigger BEFORE UPDATE ON ledger WHEN ${deepPredicate.replaceAll('id=1', 'NEW.id=1')} BEGIN SELECT 1;END`)
    assert.throws(() => preflightSqliteD1(better.prepare("UPDATE ledger SET value='z' WHERE id=1")), /Expression tree is too large/)
    better.exec('DROP TRIGGER deep_trigger')
    preflightSqliteD1(better.prepare("UPDATE ledger SET value='z' WHERE id=1"))
    better.exec('BEGIN;CREATE VIEW volatile AS SELECT * FROM ledger')
    const version = better.pragma('schema_version', { simple: true })
    preflightSqliteD1(better.prepare('SELECT * FROM volatile'))
    better.exec(`ROLLBACK;BEGIN;CREATE VIEW volatile AS ${deepSql}`)
    assert.equal(better.pragma('schema_version', { simple: true }), version)
    assert.throws(() => preflightSqliteD1(better.prepare('SELECT * FROM volatile')), /Expression tree is too large/)
    better.exec('ROLLBACK')
    better.exec('CREATE TEMP TABLE "temp.cache"(id INTEGER);CREATE UNIQUE INDEX "cache index" ON "temp.cache"(id);CREATE TEMP VIEW "cache view" AS SELECT * FROM "temp.cache"')
    preflightSqliteD1(better.prepare('SELECT * FROM "cache view"'))
    better.exec('CREATE TEMP TRIGGER "cache trigger" AFTER INSERT ON "temp.cache" BEGIN SELECT 1;END')
    preflightSqliteD1(better.prepare('INSERT INTO "temp.cache" VALUES(1)'))
    better.exec('BEGIN;CREATE TEMP VIEW temp_volatile AS SELECT * FROM ledger')
    const tempVersion = better.pragma('temp.schema_version', { simple: true })
    preflightSqliteD1(better.prepare('SELECT * FROM temp_volatile'))
    better.exec(`ROLLBACK;BEGIN;CREATE TEMP VIEW temp_volatile AS ${deepSql}`)
    assert.equal(better.pragma('temp.schema_version', { simple: true }), tempVersion)
    assert.throws(() => preflightSqliteD1(better.prepare('SELECT * FROM temp_volatile')), /Expression tree is too large/)
    better.exec('ROLLBACK')
    let functionCalls = 0
    better.function('custom_scale', { deterministic: true }, value => { functionCalls++; return value * 2 })
    better.exec('CREATE INDEX custom_index ON ledger(custom_scale(id))')
    const customBefore = better.serialize(), callsBefore = functionCalls
    preflightSqliteD1(better.prepare('SELECT custom_scale(id) FROM ledger'))
    better.aggregate('custom_sum', { start: 0, step: (sum, value) => sum + value })
    preflightSqliteD1(better.prepare('SELECT custom_sum(id) FROM ledger'))
    assert.equal(functionCalls, callsBefore)
    assert.deepEqual(better.serialize(), customBefore)
    better.exec('CREATE VIRTUAL TABLE docs USING fts5(content);CREATE VIRTUAL TABLE temp.temp_docs USING fts5(content)')
    preflightSqliteD1(better.prepare('SELECT rowid FROM docs WHERE docs MATCH ?1'))
    preflightSqliteD1(better.prepare('SELECT rowid FROM temp.temp_docs WHERE temp_docs MATCH ?1'))
    better.exec('CREATE TABLE parent_bad(id INTEGER);CREATE TABLE child_bad(id INTEGER REFERENCES parent_bad(id))')
    better.pragma('foreign_keys=OFF')
    const foreignKeyStatement = better.prepare('INSERT INTO child_bad VALUES(1)')
    preflightSqliteD1(foreignKeyStatement)
    better.pragma('foreign_keys=ON')
    assert.throws(() => preflightSqliteD1(foreignKeyStatement), /foreign key mismatch/)
    better.pragma('foreign_keys=OFF')
    better.table('custom_rows', { columns: ['id'], rows: function* () { yield [1] } })
    assert.deepEqual(prepareSqliteControl(better, 'SELECT * FROM custom_rows').get(), { id: 1 })
    assert.throws(() => preflightSqliteD1(better.prepare('SELECT * FROM custom_rows')), /unsupported native capability/)
    preflightSqliteD1(better.prepare(`${wideSql},?101 AS excess`), { variableNumber: 32766 })
    assert.throws(() => preflightSqliteD1(better.prepare(`${wideSql},?101 AS excess`)), /variable number|too many SQL variables/)
    preflightSqliteD1(better.prepare(`${wideSql},?101 AS excess`), { variableNumber: 32766 })
    assert.throws(() => preflightSqliteD1(better.prepare(`${wideSql},?101 AS excess`)), /variable number|too many SQL variables/)
    console.log('PASS native expression100 preflight for direct/view/trigger SQL, main/temp rollback version reuse, custom scalar/aggregate and source-byte preservation')
    if (!process.argv.includes('--sqlite-only')) {
      const { Miniflare, Log, LogLevel } = require('miniflare')
      mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("fixture")}}', compatibilityDate: '2026-07-30', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
      const d1 = await mf.getD1Database('DB')
      for (const [sql, values] of queries) {
        const expected = await d1.prepare(sql).bind(...values).first()
        assert.deepEqual({ ...sqliteD1Call(better.prepare(sql), 'get', values) }, expected)
        assert.deepEqual({ ...sqliteD1Call(node.prepare(sql), 'get', values) }, expected)
      }
      for (const values of [[], [1], [1, 2, 3]]) {
        await assert.rejects(() => d1.prepare('SELECT ?1 AS a,?2 AS b').bind(...values).first())
      }
      await assert.rejects(() => d1.prepare(`${wideSql},?101 AS excess`).bind(...wideValues, 100).first(), /too many SQL variables|variable number/)
      await assert.rejects(() => d1.prepare(`SELECT ${Array.from({ length: 101 }, (_, i) => `? AS c${i}`).join(',')}`).bind(...wideValues, 100).first(), /too many SQL variables|variable number/)
      assert.deepEqual({ ...sqliteD1Call(node.prepare(wideSql), 'get', wideValues) }, await d1.prepare(wideSql).bind(...wideValues).first())
      console.log('PASS real-workerd D1 reference for repeated/reordered/mixed/sparse/quoted/zero/NULL/Khmer/NUL and 100 unique slots')
    }
    console.log('PASS both native SQLite driver bridges; legacy positional calls, bind-count refusals, writes and rollback')
  } finally {
    if (mf) await mf.dispose()
    better.close()
    node.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
