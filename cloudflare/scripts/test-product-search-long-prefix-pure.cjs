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

const fullName = 'Clarins Super Restorative Decollete And Neck Concentrate 75ml'
const params = {}
const query = buildProductSearchQuery(fullName, params)

assert.ok(query.whereClause, 'the full product name must produce a catalog predicate')
assert.ok(query.matchTierSql, 'the full product name must retain relevance tiers')
assert.doesNotMatch(query.matchTierSql, /LIKE\s+@namePrefixKey/, 'full-name prefix ranking must not bind an over-limit LIKE pattern')
assert.match(query.matchTierSql, /instr\([\s\S]*@nameExactKey\) = 1/, 'prefix ranking must use a literal prefix check')
assert.equal(params.nameExactKey, fullName.toLowerCase(), 'exact and prefix ranking share the normalized literal')
assert.ok(
  Object.entries(params).every(([key, value]) => !String(query.whereClause).includes(`LIKE @${key}`) || String(value).length <= 50),
  'every bound LIKE pattern in the known full-name query stays within D1\'s ceiling',
)

const db = new Database(':memory:')
db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, name_normalized TEXT, is_active INTEGER)')
db.prepare('INSERT INTO products (id, name, name_normalized, is_active) VALUES (1, ?, ?, 1)').run(fullName, fullName.toLowerCase())
const tier = db.prepare(`SELECT ${query.matchTierSql} AS tier FROM products p WHERE p.id = 1`).get(params).tier
assert.equal(tier, 1, 'native SQLite ranks the complete Clarins name as an exact match')

const longTokenParams = {}
const longToken = 'x'.repeat(60)
const longTokenQuery = buildProductSearchQuery(`ml ${longToken}`, longTokenParams)
const longTokenSql = `${longTokenQuery.whereClause} ${longTokenQuery.matchTierSql}`
const overLimitLikeParams = Object.entries(longTokenParams)
  .filter(([key, value]) => longTokenSql.includes(`LIKE @${key}`) && String(value).length > 50)
assert.deepEqual(overLimitLikeParams, [], 'a pathological long token cannot enter any LIKE fallback')

console.log('PASS long product-name search avoids over-limit LIKE patterns and retains native exact ranking')
