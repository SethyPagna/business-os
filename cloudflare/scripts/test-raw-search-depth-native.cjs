const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/searchMatch.ts'), 'utf8')
function load(text, localRequire = require) {
  const mod = { exports: {} }
  const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'module', 'require', out)(mod.exports, mod, localRequire)
  return mod.exports
}
const current = load(source)
const legacyBody = `export function foldDiacriticsSql(expr: string): string {
  let out = expr
  for (const [accented, base] of DIACRITIC_SQL_PAIRS) out = \`REPLACE(\${out}, '\${sqlLiteral(accented)}', '\${base}')\`
  return out
}`
const legacy = load(source.replace(/export function foldDiacriticsSql\(expr: string\): string \{[\s\S]*?\n\}/, legacyBody))
const settingsSource = fs.readFileSync(path.join(__dirname, '../src/routes/settings.ts'), 'utf8')
const settingsSqlSource = settingsSource.slice(settingsSource.indexOf('const VALID_PAYMENT_DETAILS_SQL ='), settingsSource.indexOf('const PAYMENT_METHOD_MALFORMED_RELEVANT_SQL ='))
function paymentSql(search) {
  const out = ts.transpileModule(settingsSqlSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('normalizedHaystackSql', out + '\nreturn PAYMENT_METHOD_SEARCH_SQL;')(search.normalizedHaystackSql)
}
const fixtures = [null, '', 'Crème+Brûlée & ÆTHER/ØRESUND_Łódź.Þing-Đà', 'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕØÚÙÛÜÝŸÑÇŞŢÆŒßŁĐÞ', 'កម្ពុជា+សេរ៉ូម', "Quote' @value ?99 -- /* */\nTab\t MixedCASE", '100ml', '110C', 'E.l.f.']
let expected, references, expectedPayment, scopeReferences
const paymentParams = { identityVariants: '["ABA"]', target: 'Crème & Card' }
const paymentQuery = search => `SELECT id,${paymentSql(search)} AS normal FROM sales s ORDER BY id`
const paymentSchema = 'CREATE TABLE sales(id INTEGER PRIMARY KEY,receipt_number TEXT,cashier_name TEXT,customer_name TEXT,customer_phone TEXT,branch_name TEXT,payment_method TEXT,payment_details TEXT)'
const scopeQueries = search => [
  `SELECT ${search.normalizedHaystackSql('value')} AS normal FROM (SELECT @value AS value)`,
  `WITH search_fold_0(value) AS(SELECT @value) SELECT ${search.normalizedHaystackSql('search_fold_0.value')} AS normal FROM search_fold_0`,
  `WITH search_fold_0(value) AS(SELECT @value) SELECT ${search.normalizedHaystackSql(search.foldDiacriticsSql('search_fold_0.value'))} AS normal FROM search_fold_0`,
  `WITH outside_alias(value,note) AS(SELECT @value,@note) SELECT ${search.compactHaystackSql('outside_alias.value || outside_alias.note')} AS normal FROM outside_alias WHERE (@note IS NOT NULL AND 1=1) OR @value IS NULL`,
]
const scopeParams = (sql, value) => ({ value, ...(sql.includes('@note') ? { note: ' & Outside-Ź' } : {}) })
const db = new DatabaseSync(':memory:')
try {
  db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,is_active INTEGER)')
  const insert = db.prepare('INSERT INTO products VALUES(?,?,?,1)')
  fixtures.forEach((value, i) => insert.run(i + 1, value, i % 2 ? 'pcs' : null))
  for (let id = 20; id < 720; id++) insert.run(id, 'Common m', 'pcs')
  db.limits.exprDepth = 1000
  expected = db.prepare(`SELECT id,${legacy.normalizedHaystackSql('p.name')} AS normal,${legacy.compactHaystackSql('p.name')} AS compact FROM products p ORDER BY id`).all()
  assert.equal(expected[0].normal, null)
  assert.equal(expected[2].normal, 'creme brulee   aether oresund lodź thing da')
  assert.equal(expected[4].normal, 'កម្ពុជា សេរ៉ូម')
  const queries = ['m', 'ml', 'c', 'E.l.f', Array.from({ length: 6 }, () => Array.from({ length: 8 }, () => 'm').join(' ')).join(',')]
  references = queries.flatMap(query => ['AND', 'OR'].map(mode => {
    const params = {}, groups = legacy.tokenizeSearchTermGroups(query)
    const clause = legacy.buildShortWordFallbackClause(groups, mode, ['p.name', 'p.unit'], params, 'shortw')
    return { query, mode, ids: db.prepare(`SELECT id FROM products p WHERE ${clause} ORDER BY id`).all(params).map(row => row.id) }
  }))
  assert.equal(references[0].ids.length, 500)
  db.exec(paymentSchema)
  db.prepare('INSERT INTO sales VALUES(1,?,?,?,?,?,?,?)').run('R-1', 'José', 'កម្ពុជា', '0123', 'Shop', 'ABA + Cash', null)
  db.prepare('INSERT INTO sales VALUES(2,?,?,?,?,?,?,?)').run('R-2', null, null, null, null, 'ABA', '[{"method":"ABA"},{"method":"Cash"}]')
  expectedPayment = db.prepare(paymentQuery(legacy)).all(paymentParams)
  scopeReferences = fixtures.map(value => scopeQueries(legacy).map(sql => db.prepare(sql).all(scopeParams(sql, value))))
  db.limits.exprDepth = 100
  for (const [name, helper] of [['normal', 'normalizedHaystackSql'], ['compact', 'compactHaystackSql']]) {
    const actual = db.prepare(`SELECT id,${current[helper]('p.name')} AS value FROM products p ORDER BY id`).all()
    assert.deepEqual(actual.map(row => row.value), expected.map(row => row[name]))
  }
  for (const { query, mode, ids } of references) {
    const params = {}, groups = current.tokenizeSearchTermGroups(query)
    const clause = current.buildShortWordFallbackClause(groups, mode, ['p.name', 'p.unit'], params, 'shortw')
    assert.deepEqual(db.prepare(`SELECT id FROM products p WHERE ${clause} ORDER BY id`).all(params).map(row => row.id), ids)
  }
  assert.deepEqual(db.prepare(paymentQuery(current)).all(paymentParams), expectedPayment)
  fixtures.forEach((value, i) => scopeQueries(current).forEach((sql, q) => assert.deepEqual(db.prepare(sql).all(scopeParams(sql, value)), scopeReferences[i][q])))
  const update = db.prepare(`UPDATE sales AS s SET receipt_number=${paymentSql(current)} WHERE id=1`)
  assert.equal(update.run(paymentParams).changes, 1)
  console.log('PASS raw normalization and short-word cap500 at expression100 equal legacy expression1000; null/diacritics/Khmer/joiners/quotes/control tokens')
} finally { db.close() }

async function nativeD1() {
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("local")}}', compatibilityDate: '2026-07-30', d1Databases: ['DB'], log: new Log(LogLevel.ERROR) })
  try {
    const raw = await mf.getD1Database('DB')
    const dbSource = fs.readFileSync(path.join(__dirname, '../src/lib/db.ts'), 'utf8')
    const { getDb } = load(dbSource, id => id === './importMaintenanceFence' ? {} : require(id))
    const db = getDb({ DB: raw })
    await raw.prepare('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,is_active INTEGER)').run()
    for (const [i, value] of fixtures.entries()) await db.prepare('INSERT INTO products VALUES(@id,@name,@unit,1)').run({ id: i + 1, name: value, unit: i % 2 ? 'pcs' : null })
    await raw.prepare("WITH RECURSIVE numbers(id) AS (SELECT 20 UNION ALL SELECT id+1 FROM numbers WHERE id<719) INSERT INTO products SELECT id,'Common m','pcs',1 FROM numbers").run()
    assert.deepEqual(await db.prepare(`SELECT id,${current.normalizedHaystackSql('p.name')} AS normal,${current.compactHaystackSql('p.name')} AS compact FROM products p ORDER BY id`).all(), expected.map(row => ({ ...row })))
    for (const { query, mode, ids } of references) {
      const params = {}, clause = current.buildShortWordFallbackClause(current.tokenizeSearchTermGroups(query), mode, ['p.name', 'p.unit'], params, 'shortw')
      if (query.includes(',')) {
        const oldParams = {}, oldClause = legacy.buildShortWordFallbackClause(legacy.tokenizeSearchTermGroups(query), mode, ['p.name', 'p.unit'], oldParams, 'shortw')
        await assert.rejects(() => db.prepare(`SELECT id FROM products p WHERE ${oldClause} ORDER BY id`).all(oldParams), /statement too long/)
        await assert.rejects(() => db.prepare(`SELECT id FROM products p WHERE ${clause} ORDER BY id`).all(params), /statement too long/)
        console.log(`PASS inherited raw6x8 ${mode} length refusal in actual D1; old=${Buffer.byteLength(oldClause)} new=${Buffer.byteLength(clause)}`)
        continue
      }
      assert.deepEqual((await db.prepare(`SELECT id FROM products p WHERE ${clause} ORDER BY id`).all(params)).map(row => row.id), ids)
    }
    for (const [i, value] of fixtures.entries()) {
      for (const [q, sql] of scopeQueries(current).entries()) assert.deepEqual(await db.prepare(sql).all(scopeParams(sql, value)), scopeReferences[i][q].map(row => ({ ...row })))
    }
    await raw.prepare(paymentSchema).run()
    await raw.prepare('INSERT INTO sales VALUES(1,?,?,?,?,?,?,?)').bind('R-1', 'José', 'កម្ពុជា', '0123', 'Shop', 'ABA + Cash', null).run()
    await raw.prepare('INSERT INTO sales VALUES(2,?,?,?,?,?,?,?)').bind('R-2', null, null, null, null, 'ABA', '[{"method":"ABA"},{"method":"Cash"}]').run()
    assert.deepEqual(await db.prepare(paymentQuery(current)).all(paymentParams), expectedPayment.map(row => ({ ...row })))
    await db.prepare(`UPDATE sales AS s SET receipt_number=${paymentSql(current)} WHERE id=@id`).run({ ...paymentParams, id: 1 })
    assert.equal((await db.prepare('SELECT receipt_number FROM sales WHERE id=@id').get({ id: 1 })).receipt_number, expectedPayment[0].normal)
    console.log('PASS actual getDb/local workerd raw folds, cap500 and real settings payment-method normalization SELECT/UPDATE match legacy reference')
  } finally { await mf.dispose() }
}
nativeD1().catch(error => { console.error(error); process.exitCode = 1 })
