// Every product-search implementation a test may compare, over one row set:
//
//   core          lib/searchCore.ts (the shared client/Worker core)
//   legacy-server lib/productSearchQuery.ts buildProductSearchQuery, run on
//                 node:sqlite with the real 0018/0019/0021 FTS migrations and
//                 D1's expression depth limit of 100
//   legacy-client frontend/src/utils/searchMatch.ts matchesSearchTermGroups
//                 + sortBySearchRelevance (the page re-filter)
//
// Each returns { ids, tierOf } with ids in ranked order. Rows are
// { id, name, brand, category, barcode, sku }.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { DatabaseSync } = require('node:sqlite')

const CF_SRC = path.join(__dirname, '..', '..', 'src')
const FE_SRC = path.join(__dirname, '..', '..', '..', 'frontend', 'src')
const MIGRATIONS = path.join(__dirname, '..', '..', 'migrations')

function loadTs(file, deps = {}) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: path.basename(file),
  }).outputText
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', output)(mod.exports, (id) => deps[id] || require(id), mod)
  return mod.exports
}

const loadWorkerCore = () => loadTs(path.join(CF_SRC, 'lib', 'searchCore.ts'))
const loadFrontendCore = () => loadTs(path.join(FE_SRC, 'utils', 'searchCore.ts'))

function coreImpl(rows, core = loadWorkerCore()) {
  const index = core.buildTermIndex(rows)
  return {
    name: 'core',
    search(query, options = {}) {
      const result = core.searchTermIndex(index, query, options)
      return { ids: result.hits.map((hit) => hit.id), tierOf: new Map(result.hits.map((hit) => [hit.id, hit.tier])) }
    },
  }
}

function legacyServerImpl(rows) {
  const workerMatch = loadTs(path.join(CF_SRC, 'lib', 'searchMatch.ts'))
  const builder = loadTs(path.join(CF_SRC, 'lib', 'productSearchQuery.ts'), { './searchMatch': workerMatch, './productStockGuard': require('./product_stock_guard.cjs') })
  const db = new DatabaseSync(':memory:')
  db.limits.exprDepth = 100
  db.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, sku TEXT, barcode TEXT, brand TEXT, category TEXT, supplier TEXT,
    description TEXT, unit TEXT, stock_quantity REAL NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, name_normalized TEXT, unit_normalized TEXT, brand_compact TEXT)`)
  db.exec(`CREATE TABLE branch_stock(product_id INTEGER,quantity REAL);
    CREATE TABLE product_batches(id INTEGER PRIMARY KEY,variant_product_id INTEGER);
    CREATE TABLE branch_batch_stock(batch_id INTEGER,quantity REAL);
    CREATE TABLE damaged_stock_lots(product_id INTEGER,quantity_remaining REAL)`)
  const insert = db.prepare('INSERT INTO products (id, name, sku, barcode, brand, category, name_normalized, brand_compact) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const row of rows) {
    insert.run(row.id, row.name ?? null, row.sku ?? null, row.barcode ?? null, row.brand ?? null, row.category ?? null,
      workerMatch.normalizeSearchText(row.name), workerMatch.compactSearchText(row.brand))
  }
  for (const file of ['0018_products_fts.sql', '0019_products_fts_code.sql', '0021_products_fts_name_trigram.sql']) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, file), 'utf8'))
  }
  return {
    name: 'legacy-server',
    db,
    search(query) {
      const params = {}
      const built = builder.buildProductSearchQuery(query, params, {})
      if (!built.whereClause) return { ids: [], tierOf: new Map() }
      const sql = `${built.rankCteSql ? `WITH ${built.rankCteSql} ` : ''}SELECT p.id, ${built.matchTierSql || 3} AS tier, ${built.matchRankSql || 0} AS rk
        FROM products p WHERE p.is_active = 1 AND ${built.whereClause} ORDER BY tier, rk, p.name`
      const used = {}
      for (const match of sql.matchAll(/@(\w+)/g)) used[match[1]] = params[match[1]] ?? null
      const out = db.prepare(sql).all(used)
      return { ids: out.map((row) => row.id), tierOf: new Map(out.map((row) => [row.id, row.tier])) }
    },
  }
}

function legacyClientImpl(rows) {
  const frontendMatch = loadTs(path.join(FE_SRC, 'utils', 'searchMatch.ts'))
  return {
    name: 'legacy-client',
    search(query) {
      const hits = rows.filter((row) => frontendMatch.matchesSearchTermGroups([row.name, row.brand, row.barcode, row.sku, row.category], [query], 'AND'))
      const ranked = frontendMatch.sortBySearchRelevance(hits, query)
      return { ids: ranked.map((row) => row.id), tierOf: new Map(ranked.map((row) => [row.id, frontendMatch.searchRelevanceTier(row, query)])) }
    },
  }
}

function makeImpl(name, rows) {
  if (name === 'legacy-server') return legacyServerImpl(rows)
  if (name === 'legacy-client') return legacyClientImpl(rows)
  return coreImpl(rows)
}

module.exports = { loadTs, loadWorkerCore, loadFrontendCore, coreImpl, legacyServerImpl, legacyClientImpl, makeImpl, CF_SRC, FE_SRC }
