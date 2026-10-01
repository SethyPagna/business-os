const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { DatabaseSync } = require('node:sqlite')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')

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
