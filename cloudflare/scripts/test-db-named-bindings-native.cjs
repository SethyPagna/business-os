const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Miniflare, Log, LogLevel } = require('miniflare')

function loadDb() {
  const filename = path.join(__dirname, '../src/lib/db.ts')
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)(id => id === './importMaintenanceFence' ? {} : require(id), mod, mod.exports)
  return mod.exports
}

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("local")}}',
    compatibilityDate: '2026-07-30', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const native = await mf.getD1Database('DB')
    assert.deepEqual(await native.prepare('SELECT ?1 AS a, ?1 AS repeated, ?2 AS b').bind('alpha', 'beta').first(),
      { a: 'alpha', repeated: 'alpha', b: 'beta' })
    const calls = []
    const raw = {
      prepare(sql) {
        return { bind(...values) {
          calls.push({ sql, values })
          return native.prepare(sql).bind(...values)
        } }
      },
      batch: statements => native.batch(statements),
    }
    const { getDb } = loadDb()
    const db = getDb({ DB: raw, IMPORT_DB: raw })
    const params = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, i]))
    const columns = Array.from({ length: 100 }, (_, i) => `${i === 0 || i === 99 ? `@p${i} + @p${i}` : `@p${i}`} AS c${i}`)
    const row = await db.prepare(`SELECT ${columns.join(',')}`).get(params)
    assert.equal(row.c0, 0)
    assert.equal(row.c99, 198)
    assert.equal(calls.at(-1).values.length, 100)
    assert.ok(calls.at(-1).sql.includes('?1 + ?1 AS c0'))
    const payload = "quote' @other ?1 -- កម្ពុជា"
    assert.deepEqual(await db.prepare('SELECT @value AS a,@value AS b,@missing AS missing,@nil AS nil').get({ value: payload, nil: undefined, ignored: 99 }),
      { a: payload, b: payload, missing: null, nil: null })
    assert.equal(calls.at(-1).values.length, 3)
    assert.equal(calls.at(-1).sql.includes(payload), false)
    assert.deepEqual(await db.prepare('SELECT @value AS a UNION ALL SELECT @value AS a').all({ value: 7 }), [{ a: 7 }, { a: 7 }])
    await native.prepare('CREATE TABLE binding_rows(id INTEGER PRIMARY KEY,v TEXT UNIQUE)').run()
    const inserted = await db.prepare('INSERT INTO binding_rows(id,v) VALUES(@id,@value || @value)').run({ id: 1, value: 'a' })
    assert.equal(inserted.changes, 1)
    assert.equal(inserted.lastInsertRowid, 1)
    await db.batch([{ sql: 'UPDATE binding_rows SET v=@value || @value WHERE id=@id OR id=@id', params: { value: 'b', id: 1 } },
      { sql: 'INSERT INTO binding_rows(id,v) VALUES(@id,@value || @value)', params: { id: 2, value: 'c' } }])
    await db.batchOnce([{ sql: 'UPDATE binding_rows SET v=@value || @value WHERE id=@id OR id=@id', params: { value: 'd', id: 2 } }])
    assert.deepEqual(await db.prepare('SELECT id,v FROM binding_rows ORDER BY id').all(), [{ id: 1, v: 'bb' }, { id: 2, v: 'dd' }])
    await assert.rejects(() => db.batch([{ sql: 'UPDATE binding_rows SET v=@value WHERE id=@id', params: { value: 'rollback', id: 1 } },
      { sql: 'INSERT INTO binding_rows(id,v) VALUES(@id,@value)', params: { id: 3, value: 'dd' } }]), /UNIQUE constraint failed/)
    assert.equal((await db.prepare('SELECT v FROM binding_rows WHERE id=@id OR id=@id').get({ id: 1 })).v, 'bb')
    assert.deepEqual(await db.staging.prepare('SELECT @value AS a,@value AS b').get({ value: 'staging' }), { a: 'staging', b: 'staging' })
    for (const sql of ['SELECT @named AS a,?1 AS b', 'SELECT ?1 AS a,@named AS b', 'SELECT @named AS a,? AS b']) {
      const before = calls.length
      await assert.rejects(() => db.prepare(sql).get({ named: 'named' }), /cannot mix named and positional/i)
      assert.equal(calls.length, before)
    }
    assert.deepEqual(await db.prepare("SELECT '@literal ?1' AS literal,@value AS actual /* @ignored ?2 */ -- @ignored ?3\n").get({ value: 'bound' }),
      { literal: '@literal ?1', actual: 'bound' })
    assert.deepEqual(await db.prepare('SELECT @value AS "@label ?1"').get({ value: 'quoted' }), { '@label ?1': 'quoted' })
    assert.deepEqual(await db.prepare('SELECT ?1 AS a,?1 AS b,?2 AS c').get(['one', 'two']), { a: 'one', b: 'one', c: 'two' })
    assert.deepEqual(calls.at(-1), { sql: 'SELECT ?1 AS a,?1 AS b,?2 AS c', values: ['one', 'two'] })
    assert.deepEqual(await db.prepare('SELECT ? AS a,? AS b').get(['one', 'two']), { a: 'one', b: 'two' })
    const oversized = { ...params, p100: 100 }
    const beforeOversized = calls.length
    await assert.rejects(() => db.prepare(`SELECT @p0 AS first WHERE 0 IN (${Array.from({ length: 100 }, (_, i) => `@p${i + 1}`).join(',')})`).get(oversized), /variable number must be between|too many SQL variables/)
    assert.equal(calls.length - beforeOversized, 1, 'a deterministic numbered-variable limit must not retry')
    console.log('PASS real getDb + local workerd: 100 unique slots/repeats, null/unused/payload values, get/all/run/batch/batchOnce/staging, rollback, positional collision refusal and unchanged array path')
  } finally {
    await mf.dispose()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
