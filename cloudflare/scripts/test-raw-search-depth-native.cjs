const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/searchMatch.ts'), 'utf8')
function load(text) {
  const mod = { exports: {} }
  const out = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('exports', 'module', out)(mod.exports, mod)
  return mod.exports
}
const current = load(source)
const legacyBody = `export function foldDiacriticsSql(expr: string): string {
  let out = expr
  for (const [accented, base] of DIACRITIC_SQL_PAIRS) out = \`REPLACE(\${out}, '\${sqlLiteral(accented)}', '\${base}')\`
  return out
}`
const legacy = load(source.replace(/export function foldDiacriticsSql\(expr: string\): string \{[\s\S]*?\n\}/, legacyBody))
const db = new DatabaseSync(':memory:')
try {
  db.exec('CREATE TABLE products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT,is_active INTEGER)')
  const insert = db.prepare('INSERT INTO products VALUES(?,?,?,1)')
  const fixtures = [null, '', 'Crème+Brûlée & ÆTHER/ØRESUND_Łódź.Þing-Đà', 'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕØÚÙÛÜÝŸÑÇŞŢÆŒßŁĐÞ', 'កម្ពុជា+សេរ៉ូម', "Quote' @value ?99 -- /* */\nTab\t MixedCASE", '100ml', '110C', 'E.l.f.']
  fixtures.forEach((value, i) => insert.run(i + 1, value, i % 2 ? 'pcs' : null))
  for (let id = 20; id < 720; id++) insert.run(id, 'Common m', 'pcs')
  db.limits.exprDepth = 1000
  const expected = db.prepare(`SELECT id,${legacy.normalizedHaystackSql('p.name')} AS normal,${legacy.compactHaystackSql('p.name')} AS compact FROM products p ORDER BY id`).all()
  assert.equal(expected[0].normal, null)
  assert.equal(expected[2].normal, 'creme brulee   aether oresund lodź thing da')
  assert.equal(expected[4].normal, 'កម្ពុជា សេរ៉ូម')
  const queries = ['m', 'ml', 'c', 'E.l.f']
  const references = queries.map(query => {
    const params = {}, groups = legacy.tokenizeSearchTermGroups(query)
    const clause = legacy.buildShortWordFallbackClause(groups, 'AND', ['p.name', 'p.unit'], params, 'shortw')
    return { query, ids: db.prepare(`SELECT id FROM products p WHERE ${clause} ORDER BY id`).all(params).map(row => row.id) }
  })
  assert.equal(references[0].ids.length, 500)
  db.limits.exprDepth = 100
  for (const [name, helper] of [['normal', 'normalizedHaystackSql'], ['compact', 'compactHaystackSql']]) {
    const actual = db.prepare(`SELECT id,${current[helper]('p.name')} AS value FROM products p ORDER BY id`).all()
    assert.deepEqual(actual.map(row => row.value), expected.map(row => row[name]))
  }
  for (const { query, ids } of references) {
    const params = {}, groups = current.tokenizeSearchTermGroups(query)
    const clause = current.buildShortWordFallbackClause(groups, 'AND', ['p.name', 'p.unit'], params, 'shortw')
    assert.deepEqual(db.prepare(`SELECT id FROM products p WHERE ${clause} ORDER BY id`).all(params).map(row => row.id), ids)
  }
  console.log('PASS raw normalization and short-word cap500 at expression100 equal legacy expression1000; null/diacritics/Khmer/joiners/quotes/control tokens')
} finally { db.close() }
