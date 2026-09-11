const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function loadTs(relativePath, requireMap = {}) {
  const filePath = path.join(__dirname, '..', 'src', 'lib', relativePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: relativePath,
  })
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(
    moduleObj.exports,
    (id) => requireMap[id] || require(id),
    moduleObj,
  )
  return moduleObj.exports
}

const searchMatch = loadTs('searchMatch.ts')
const { buildProductSearchQuery } = loadTs('productSearchQuery.ts', { './searchMatch': searchMatch })
const { normalizeSearchText } = searchMatch
const fullName = 'Clarins Super Restorative Decollete And Neck Concentrate 75ml'
const longAscii = 'x'.repeat(60)
const longKhmer = 'ក'.repeat(17)

function usedParams(sql, params) {
  const names = new Set([...sql.matchAll(/@(\w+)/g)].map((match) => match[1]))
  return Object.fromEntries(Object.entries(params).filter(([key]) => names.has(key)))
}

function assertD1SafeLikePatterns(sql, params, label) {
  const overLimit = Object.entries(params).filter(([key, value]) => (
    sql.includes(`LIKE @${key}`) && Buffer.byteLength(String(value), 'utf8') > 50
  ))
  assert.deepEqual(overLimit, [], `${label}: every LIKE pattern must fit D1's UTF-8 byte ceiling`)
}

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name TEXT, sku TEXT, barcode TEXT, brand TEXT, category TEXT,
    supplier TEXT, description TEXT, unit TEXT,
    name_normalized TEXT, brand_compact TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  )`)
  for (const migration of [
    '0018_products_fts.sql',
    '0019_products_fts_code.sql',
    '0021_products_fts_name_trigram.sql',
  ]) db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', migration), 'utf8'))
  return db
}

function insertProduct(db, id, name) {
  db.prepare(`INSERT INTO products (
    id, name, sku, barcode, brand, category, supplier, description, unit,
    name_normalized, brand_compact, is_active
  ) VALUES (?, ?, '', '', '', '', '', '', '', ?, '', 1)`).run(id, name, normalizeSearchText(name))
}

function searchIds(db, raw, mode = 'AND') {
  const params = {}
  const query = buildProductSearchQuery(raw, params, { mode })
  assert.ok(query.whereClause, `${raw}: search must produce a predicate`)
  const sql = `SELECT p.id FROM products p WHERE ${query.whereClause} ORDER BY p.id`
  assertD1SafeLikePatterns(`${sql} ${query.matchTierSql || ''}`, params, `${mode} ${raw}`)
  return db.prepare(sql).all(usedParams(sql, params)).map((row) => row.id)
}

const tierParams = {}
const fullNameQuery = buildProductSearchQuery(fullName, tierParams)
assert.doesNotMatch(fullNameQuery.matchTierSql, /LIKE\s+@namePrefixKey/, 'full-name prefix ranking must not bind an over-limit LIKE pattern')
assert.match(fullNameQuery.matchTierSql, /instr\([\s\S]*@nameExactKey\) = 1/, 'prefix ranking must use a literal prefix check')

const directLikeParams = {}
const directLikeSql = searchMatch.buildLikeAliasClause(longKhmer, ['p.name_normalized'], directLikeParams, 'direct', true)
assert.match(directLikeSql, /instr\(lower\(COALESCE\(p\.name_normalized, ''\)\), @direct_0\) > 0/, 'the shared alias fallback must switch multibyte patterns to instr')
assertD1SafeLikePatterns(directLikeSql, directLikeParams, 'direct alias fallback')
const partialParams = {}
const partialSql = searchMatch.buildPartialWordMatchClause([['one', 'two', 'three', longKhmer]], 'AND', ['p.name_normalized'], partialParams, 'partial', 4, true)
assert.match(partialSql, /instr\([\s\S]*@partial_3\) > 0/, 'the partial-word fallback must retain a long multibyte term literally')
assertD1SafeLikePatterns(partialSql, partialParams, 'partial-word fallback')

const db = freshDb()
insertProduct(db, 1, fullName)
insertProduct(db, 2, 'plain ml lotion')
insertProduct(db, 3, `ml ${longAscii}`)

assert.deepEqual(searchIds(db, `ml,${longAscii}`, 'AND'), [3], 'AND keeps both comma groups; unrelated ml rows stay excluded')
assert.deepEqual(searchIds(db, `ml,${longAscii}`, 'OR'), [1, 2, 3], 'OR keeps either comma group without dropping the long group')
assert.deepEqual(searchIds(db, `ml ${longAscii}`, 'AND'), [3], 'a long ASCII word retains same-group AND semantics')

insertProduct(db, 4, `ml ${longKhmer}`)
assert.deepEqual(searchIds(db, `ml ${longKhmer}`, 'AND'), [4], 'a 51-byte Khmer token uses literal instr fallback and matches its row only')
assert.deepEqual(searchIds(db, `ml,${longKhmer}`, 'AND'), [4], 'a multibyte long comma group is retained under AND semantics')
assert.deepEqual(searchIds(db, `ml,${longKhmer}`, 'OR'), [1, 2, 3, 4], 'OR keeps either comma group when the long group is multibyte')

const tierSql = `SELECT ${fullNameQuery.matchTierSql} AS tier FROM products p WHERE p.id = 1`
assert.equal(db.prepare(tierSql).get(usedParams(tierSql, tierParams)).tier, 1, 'native SQLite ranks the complete Clarins name as exact')

console.log('PASS long ASCII and Khmer searches preserve AND/OR groups without over-limit LIKE patterns')
