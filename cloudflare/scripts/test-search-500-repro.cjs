// Reproduces the Part 90 live-app report against real SQLite (all
// migrations applied verbatim, same engine D1 runs on) instead of guessing
// from source alone: GET /api/products/bootstrap?query=matte&searchMode=
// AND&stockState=healthy&... 500s in the live app. Builds the exact SQL
// buildSearchFilters/paginateProductFamilies (routes/products.ts,
// lib/familyPagination.ts) produce for that exact query-string combination
// and runs it for real.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Database = require('better-sqlite3')

function loadTs(relPath) {
  const p = path.join(__dirname, '..', relPath)
  const src = fs.readFileSync(p, 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', outputText)(mod.exports, require)
  return mod.exports
}

const { tokenizeSearchTermGroups, buildFtsMatchExpression, buildTrigramMatchExpression, buildHybridMatchClause, PRODUCTS_FTS_BM25_SQL } =
  loadTs('src/lib/searchMatch.ts')

const db = new Database(':memory:')
db.pragma('foreign_keys = OFF')
const migrationsDir = path.join(__dirname, '..', 'migrations')
const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf8')
  try {
    db.exec(sql)
  } catch (err) {
    console.log(`MIGRATION FAILED: ${f}: ${err.message}`)
    process.exit(1)
  }
}
console.log(`Applied ${files.length} migrations cleanly.`)

// Seed a handful of realistic rows, including a "matte" product and one
// with a low_stock_threshold-adjacent stock_quantity, so stockState=healthy
// has something real to filter against.
const insert = db.prepare(`INSERT INTO products
  (name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
  VALUES (@name, @sku, @barcode, @brand, @category, @supplier, @description, @unit, @stock_quantity, @low_stock_threshold, @out_of_stock_threshold, 1)`)
insert.run({ name: 'MAC Matte Lipstick 617 Rebel', sku: 'MAC617', barcode: '6923644012345', brand: 'MAC', category: 'Lipstick', supplier: 'Acme', description: 'Long-wear matte', unit: 'pcs', stock_quantity: 50, low_stock_threshold: 10, out_of_stock_threshold: 0 })
insert.run({ name: 'Matte Foundation 24hr', sku: 'FND24', barcode: '6923644099999', brand: 'Maybelline', category: 'Foundation', supplier: 'Acme', description: 'Matte finish', unit: 'pcs', stock_quantity: 3, low_stock_threshold: 10, out_of_stock_threshold: 0 })
insert.run({ name: 'Glossy Lip Tint', sku: 'GLT01', barcode: '6923644011111', brand: 'NYX', category: 'Lipstick', supplier: 'Acme', description: 'Non-matte gloss', unit: 'pcs', stock_quantity: 20, low_stock_threshold: 10, out_of_stock_threshold: 0 })

// --- replicate buildSearchFilters (routes/products.ts) exactly ---------
function buildSearchFilters(query) {
  const where = ['p.is_active = 1']
  const params = {}
  const joins = []

  const branchId = Number.parseInt(String(query.branchId || query.branch_id || ''), 10)
  if (Number.isFinite(branchId) && branchId > 0) {
    params.branchId = branchId
    joins.push('LEFT JOIN branch_stock selected_bs ON selected_bs.product_id = p.id AND selected_bs.branch_id = @branchId')
  }
  const stockExpr = params.branchId ? 'COALESCE(selected_bs.quantity, 0)' : 'COALESCE(p.stock_quantity, 0)'

  const searchTermGroups = tokenizeSearchTermGroups(query.query || query.q || '', 6, 8)
  let matchRankSql
  let searchWhereClause
  const searchMode = String(query.searchMode || 'AND').toUpperCase() === 'OR' ? 'OR' : 'AND'
  const titleOnly = ['name', 'title'].includes(String(query.searchFields || query.search_fields || '').toLowerCase())
  if (searchTermGroups.length) {
    const ftsMatch = buildFtsMatchExpression(searchTermGroups, searchMode, titleOnly ? 'name' : undefined)
    const trigramMatch = titleOnly ? undefined : buildTrigramMatchExpression(searchTermGroups, searchMode)
    const matchClauses = []
    if (ftsMatch) {
      params.ftsQuery = ftsMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH @ftsQuery)')
    }
    if (trigramMatch) {
      params.codeQuery = trigramMatch
      matchClauses.push('p.id IN (SELECT rowid FROM products_fts_code WHERE products_fts_code MATCH @codeQuery)')
    }
    const hybridMatch = titleOnly ? undefined : buildHybridMatchClause(searchTermGroups, searchMode, 'hyb')
    if (hybridMatch) {
      Object.assign(params, hybridMatch.params)
      matchClauses.push(hybridMatch.sql)
    }
    if (matchClauses.length) {
      searchWhereClause = matchClauses.length > 1 ? `(${matchClauses.join(' OR ')})` : matchClauses[0]
      if (!titleOnly && ftsMatch) {
        matchRankSql = `COALESCE((SELECT ${PRODUCTS_FTS_BM25_SQL} FROM products_fts WHERE products_fts.rowid = p.id AND products_fts MATCH @ftsQuery), 0)`
      }
    }
  }

  for (const field of ['brand', 'category', 'unit', 'supplier']) {
    const values = String(query[field] || '').split(',').map((v) => v.trim()).filter((v) => v && v.toLowerCase() !== 'all')
    if (values.length === 1) {
      params[field] = values[0].toLowerCase()
      where.push(`lower(trim(COALESCE(p.${field}, ''))) = @${field}`)
    } else if (values.length > 1) {
      const keys = values.map((value, index) => {
        const key = `${field}${index}`
        params[key] = value.toLowerCase()
        return `@${key}`
      })
      where.push(`lower(trim(COALESCE(p.${field}, ''))) IN (${keys.join(', ')})`)
    }
  }

  const stockState = String(query.stockState || query.stock_state || '').toLowerCase()
  if (stockState === 'low') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0) AND ${stockExpr} <= COALESCE(p.low_stock_threshold, 10)`)
  if (stockState === 'out') where.push(`${stockExpr} <= COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'in_stock' || stockState === 'positive') where.push(`${stockExpr} > COALESCE(p.out_of_stock_threshold, 0)`)
  if (stockState === 'healthy') where.push(`${stockExpr} > COALESCE(p.low_stock_threshold, 10)`)

  const groupState = String(query.groupState || query.group_state || '').toLowerCase()
  if (groupState) {
    const groupedExpr = `(
      p.id IN (
        SELECT p2.id FROM products p2
        WHERE p2.is_active = 1
          AND lower(trim(p2.name)) = lower(trim(p.name))
          AND p2.id != p.id
      )
      OR COALESCE(p.is_grouped_cached, 0) = 1
    )`
    if (groupState === 'variant') where.push('COALESCE(p.parent_id, 0) > 0')
    else if (groupState === 'standalone') where.push(`NOT ${groupedExpr}`)
    else where.push(groupedExpr)
  }

  if (searchWhereClause) where.push(searchWhereClause)

  return { where, joins, params, stockExpr, matchRankSql, titleOnly }
}

function buildCtes({ selectColumns, joinSql, whereSql, matchRankSql }) {
  const matchRankSelect = matchRankSql ? `, (${matchRankSql}) AS __match_rank` : ''
  const matchRankAgg = matchRankSql ? ', MIN(__match_rank) AS match_rank' : ''
  return `
    WITH matched AS (
      SELECT ${selectColumns},
             COALESCE(parent.id, p.id) AS __family_root_id,
             lower(trim(COALESCE(parent.name, p.name))) AS __family_name,
             p.created_at AS __created_at${matchRankSelect}
      FROM products p
      LEFT JOIN products parent ON parent.id = p.parent_id
      ${joinSql}
      ${whereSql}
    ),
    families AS (
      SELECT __family_root_id AS family_root_id,
             MIN(__family_name) AS family_name,
             MAX(__created_at) AS latest_created_at${matchRankAgg}
      FROM matched
      GROUP BY __family_root_id
    )
  `
}

function runQuery(label, query) {
  console.log(`\n--- ${label} ---`)
  console.log('query:', JSON.stringify(query))
  try {
    const { where, joins, params, matchRankSql } = buildSearchFilters(query)
    const joinSql = joins.join('\n')
    const whereSql = `WHERE ${where.join(' AND ')}`
    const selectColumns = 'p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.stock_quantity, p.low_stock_threshold, p.out_of_stock_threshold, p.is_active, p.parent_id, p.is_group, p.created_at'
    const ctes = buildCtes({ selectColumns, joinSql, whereSql, matchRankSql })
    const familyOrderSql = matchRankSql ? 'match_rank ASC, family_name ASC' : 'family_name ASC'
    const intraFamilyOrderSql = 'lower(name) ASC, id ASC'

    const totalRow = db.prepare(`${ctes} SELECT COUNT(*) AS count FROM families`).get(params)
    const rows = db.prepare(`
      ${ctes},
      ranked AS (
        SELECT family_root_id, ROW_NUMBER() OVER (ORDER BY ${familyOrderSql}) AS family_rank
        FROM families
      )
      SELECT matched.*
      FROM matched
      JOIN ranked ON ranked.family_root_id = matched.__family_root_id
      WHERE ranked.family_rank > @__familyOffset AND ranked.family_rank <= @__familyOffsetEnd
      ORDER BY ranked.family_rank ASC, ${intraFamilyOrderSql}
    `).all({ ...params, __familyOffset: 0, __familyOffsetEnd: 20 })

    console.log('OK -- total:', totalRow.count, 'rows:', rows.map((r) => r.name))
    return { ok: true, rows, total: totalRow.count }
  } catch (err) {
    console.log('ERROR (this is the 500):', err.message)
    return { ok: false, error: err.message }
  }
}

// Exact Part 90 report: query=matte&searchMode=AND&stockState=healthy
runQuery('Part 90 exact repro', { query: 'matte', searchMode: 'AND', stockState: 'healthy' })
// Same but with a category filter also active (common real combo)
runQuery('with category + brand filter too', { query: 'matte', searchMode: 'AND', stockState: 'healthy', category: 'Lipstick', brand: 'MAC' })
// OR mode variant
runQuery('OR mode', { query: 'matte', searchMode: 'OR', stockState: 'healthy' })
// groupState combined (another live filter that touches the same WHERE)
runQuery('with groupState=group', { query: 'matte', searchMode: 'AND', stockState: 'healthy', groupState: 'group' })
// branch selected + stockState (stockExpr swaps to branch_stock join)
runQuery('with branchId + stockState', { query: 'matte', searchMode: 'AND', stockState: 'healthy', branchId: '1' })

// --- confirm the "Brand filter option vanishes when picked" report -----
// loadProductFilters (routes/products.ts) computes each dropdown's own
// option list by re-running buildSearchFilters against the SAME query the
// results list uses -- including that field's OWN currently-selected
// value. Reproducing here: seed 3 brands, pick one as the active brand
// filter, and check whether the *brand* dropdown's own option list still
// shows the other two.
function loadFilterOptions(query) {
  const { where, joins, params } = buildSearchFilters(query)
  const joinSql = joins.join('\n')
  const whereSql = `WHERE ${where.join(' AND ')}`
  const rows = db.prepare(`SELECT MIN(trim(p.brand)) AS value FROM products p ${joinSql} ${whereSql} AND trim(COALESCE(p.brand, '')) <> '' GROUP BY lower(trim(p.brand)) ORDER BY lower(value) ASC`).all(params)
  return rows.map((r) => r.value)
}

console.log('\n--- Brand-dropdown self-narrowing repro (products.ts loadProductFilters) ---')
console.log('brand options with NO brand filter active:', loadFilterOptions({}))
console.log('brand options with brand=MAC already picked (BEFORE fix would be [\'MAC\'] only):', loadFilterOptions({ brand: 'MAC' }))

// Mirrors products.ts's actual post-fix buildFilterVariants: exclude only
// the facet's OWN value, keep every other active filter.
function loadFilterOptionsFixed(query, excludeField) {
  return loadFilterOptions({ ...query, [excludeField]: '' })
}
console.log('AFTER FIX shape (brand=MAC picked, but brand-options query excludes its own field):',
  loadFilterOptionsFixed({ brand: 'MAC' }, 'brand'))

console.log('\n--- Same repro against inventory.ts appendInventoryProductFilters (pre-fix shape, to document the bug existed there too) ---')
function loadInventoryFilterOptionsUnfixed(query) {
  // Mirrors the ORIGINAL (pre-fix) inventory.ts getInventoryProductMetadata
  // shape: one shared metaFilters object (only `initial` excluded) reused
  // for both brand and category queries.
  function appendInventoryProductFiltersMini(q) {
    const where = ['p.is_active = 1']
    const params = {}
    const brand = String(q.brand || '').trim()
    if (brand && brand.toLowerCase() !== 'all') {
      params.brand = brand.toLowerCase()
      where.push("lower(trim(COALESCE(p.brand, ''))) = @brand")
    }
    const categoryValues = String(q.category || '').split(',').map((v) => v.trim()).filter((v) => v && v.toLowerCase() !== 'all')
    if (categoryValues.length === 1) {
      params.category = categoryValues[0].toLowerCase()
      where.push("lower(trim(COALESCE(p.category, ''))) = @category")
    }
    return { where, params }
  }
  const meta = appendInventoryProductFiltersMini({ ...query, initial: 'all' })
  const whereSql = `WHERE ${meta.where.join(' AND ')}`
  return db.prepare(`SELECT MIN(trim(p.brand)) AS value FROM products p ${whereSql} AND trim(COALESCE(p.brand,'')) <> '' GROUP BY lower(trim(p.brand))`).all(meta.params).map((r) => r.value)
}
console.log('(pre-fix shape) brand options with brand=MAC picked:', loadInventoryFilterOptionsUnfixed({ brand: 'MAC' }), '-- confirms the same bug pattern was present; inventory.ts fixed the same way as products.ts (per-facet exclusion)')
