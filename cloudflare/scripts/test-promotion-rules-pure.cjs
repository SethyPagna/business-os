// G1 promotion engine -- backend-side checks:
//   1. the kernel (lib/promotionRules.ts) evaluates rules correctly
//      (the frontend mirror is byte-guarded + behavior-tested in
//      frontend/tests/promotionRules.test.ts);
//   2. the SQL companion (lib/promotionRulesSql.ts) agrees with the
//      kernel row-for-row on a REAL sqlite products table -- the ordering/
//      filter SQL and isProductPromoted must never disagree, or the
//      Products page would rank a product "promoted" the kernel then
//      refuses to badge (or vice versa);
//   3. source pins on the split gates in routes/promotions.ts (rules
//      manage under 'promotions', /rules/active open to any authed user,
//      the legacy strip endpoints still under 'products') and on
//      products.ts's promoted-first family ordering.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require(path.join(__dirname, '..', '..', 'frontend', 'node_modules', 'typescript'))
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  return { sourcePath, outputText }
}

function loadReal(relPath, requireOverrides = {}) {
  const { sourcePath, outputText } = transpile(relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const kernel = loadReal('lib/promotionRules.ts')
const sqlSide = loadReal('lib/promotionRulesSql.ts', { './promotionRules': kernel, './db': {} })

let checks = 0
const pass = (msg) => { checks++; console.log('PASS ' + msg) }

// ---- 1. kernel behavior -------------------------------------------------
{
  const rule = kernel.normalizePromotionRule({
    id: 1, title: 'Buy 3 Save $5', show_title: 1, rule_type: 'quantity_save',
    min_quantity: 3, save_usd: 5, scope_type: 'products', product_ids: '[7]', is_active: 1,
  })
  const product = { id: 7, selling_price_usd: 20, selling_price_khr: 82000 }
  assert.strictEqual(kernel.evaluatePromotionPricing(product, 2, [rule]).active, false)
  const at3 = kernel.evaluatePromotionPricing(product, 3, [rule])
  assert.strictEqual(at3.active, true)
  assert.strictEqual(at3.line_total_usd, 55)
  assert.strictEqual(at3.line_discount_usd, 5)
  // quantity deals count as promoted BEFORE the threshold (they must
  // surface on cards and in the promoted-first block).
  assert.strictEqual(kernel.isProductPromoted(product, [rule]), true)
  pass('kernel: quantity_save thresholds, line math, promoted-before-threshold')
}

// ---- 2. SQL <-> kernel parity on a real table ---------------------------
{
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE products (
    id INTEGER PRIMARY KEY, name TEXT, category TEXT, brand TEXT,
    categories TEXT, brands TEXT,
    selling_price_usd REAL DEFAULT 0, selling_price_khr REAL DEFAULT 0,
    discount_enabled INTEGER DEFAULT 0, discount_type TEXT DEFAULT 'percent',
    discount_percent REAL DEFAULT 0, discount_amount_usd REAL DEFAULT 0,
    discount_amount_khr REAL DEFAULT 0, discount_starts_at TEXT, discount_ends_at TEXT
  )`)
  const insert = db.prepare(`INSERT INTO products
    (id, name, category, brand, categories, brands, selling_price_usd, discount_enabled, discount_type, discount_percent, discount_starts_at, discount_ends_at)
    VALUES (@id, @name, @category, @brand, @categories, @brands, @selling_price_usd, @discount_enabled, @discount_type, @discount_percent, @discount_starts_at, @discount_ends_at)`)
  const rows = [
    { id: 1, name: 'Plain', category: 'Skincare', brand: 'A', categories: null, brands: null, selling_price_usd: 10, discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_starts_at: null, discount_ends_at: null },
    { id: 2, name: 'Discounted', category: 'Skincare', brand: 'A', categories: null, brands: null, selling_price_usd: 10, discount_enabled: 1, discount_type: 'percent', discount_percent: 15, discount_starts_at: null, discount_ends_at: null },
    { id: 3, name: 'Expired discount', category: 'Lips', brand: 'B', categories: null, brands: null, selling_price_usd: 10, discount_enabled: 1, discount_type: 'percent', discount_percent: 15, discount_starts_at: null, discount_ends_at: '2020-01-01' },
    { id: 4, name: 'Rule by id', category: 'Lips', brand: 'B', categories: null, brands: null, selling_price_usd: 10, discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_starts_at: null, discount_ends_at: null },
    { id: 5, name: 'Rule by category (multi)', category: 'Other', brand: 'B', categories: 'Other||Gift Set', brands: null, selling_price_usd: 10, discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_starts_at: null, discount_ends_at: null },
    { id: 6, name: 'Rule by brand', category: 'Other', brand: 'Dior', categories: null, brands: null, selling_price_usd: 10, discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_starts_at: null, discount_ends_at: null },
    { id: 7, name: 'Nothing', category: 'Other', brand: 'C', categories: null, brands: null, selling_price_usd: 10, discount_enabled: 0, discount_type: 'percent', discount_percent: 0, discount_starts_at: null, discount_ends_at: null },
  ]
  for (const row of rows) insert.run(row)

  const rules = [
    kernel.normalizePromotionRule({ id: 11, rule_type: 'percent_off', percent_off: 10, scope_type: 'products', product_ids: '[4]', is_active: 1 }),
    kernel.normalizePromotionRule({ id: 12, rule_type: 'fixed_off', save_usd: 2, scope_type: 'category', category: 'Gift Set', is_active: 1 }),
    kernel.normalizePromotionRule({ id: 13, rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, scope_type: 'brand', brand: 'dior', is_active: 1 }),
  ]
  const params = {}
  const promotedSql = sqlSide.productPromotedSql(rules, params)
  const translated = promotedSql.replace(/@(\w+)/g, (m, name) => {
    const value = params[name]
    return typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'`
  })
  const sqlPromoted = new Set(
    db.prepare(`SELECT id FROM products p WHERE ${translated}`).all().map((r) => r.id),
  )
  for (const row of rows) {
    const kernelSays = kernel.isProductPromoted(row, rules)
    assert.strictEqual(sqlPromoted.has(row.id), kernelSays,
      `SQL and kernel must agree on product ${row.id} (${row.name}): sql=${sqlPromoted.has(row.id)} kernel=${kernelSays}`)
  }
  assert.deepStrictEqual([...sqlPromoted].sort(), [2, 4, 5, 6])
  pass('SQL promoted-condition agrees with the kernel row-for-row (discount active/expired, id/category-multi/brand scopes)')

  const single = {}
  const oneRule = sqlSide.singleRuleAppliesSql(rules, 13, single)
  const oneTranslated = oneRule.replace(/@(\w+)/g, (m, name) => `'${String(single[name]).replace(/'/g, "''")}'`)
  assert.deepStrictEqual(db.prepare(`SELECT id FROM products p WHERE ${oneTranslated}`).all().map((r) => r.id), [6])
  pass('singleRuleAppliesSql isolates exactly the one rule\'s scope')
  db.close()
}

// ---- 3. source pins ------------------------------------------------------
{
  const promoSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'promotions.ts'), 'utf8')
  assert.match(promoSrc, /app\.get\('\/rules\/active', async/, "/rules/active must stay open to any authenticated user (POS cashiers price with it) -- no requireKey")
  for (const pin of [
    /app\.get\('\/rules', requireKey\('promotions'\)/,
    /app\.post\('\/rules', requireKey\('promotions'\)/,
    /app\.put\('\/rules\/:id', requireKey\('promotions'\)/,
    /app\.delete\('\/rules\/:id', requireKey\('promotions'\)/,
  ]) assert.match(promoSrc, pin, `rules manage endpoint must gate on 'promotions': ${pin}`)
  for (const pin of [
    /app\.get\('\/', requireKey\('products'\)/,
    /app\.post\('\/', requireKey\('products'\)/,
    /app\.put\('\/:id', requireKey\('products'\)/,
    /app\.put\('\/reorder\/all', requireKey\('products'\)/,
    /app\.delete\('\/:id', requireKey\('products'\)/,
  ]) assert.match(promoSrc, pin, `legacy strip endpoint must keep the products gate: ${pin}`)
  const rulesBlock = promoSrc.indexOf("app.get('/rules/active'")
  const legacyBlock = promoSrc.indexOf("app.get('/', requireKey('products')")
  assert.ok(rulesBlock > -1 && legacyBlock > rulesBlock, '/rules* routes must register BEFORE the legacy /:id patterns')
  pass('routes/promotions.ts gates: rules/active open, rules manage promotions-gated, strip products-gated, rules registered first')

  const productsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')
  assert.match(productsSrc, /family_promoted DESC, \$\{familyOrderSql\}/, 'browse order: promoted families lead')
  assert.match(productsSrc, /match_rank ASC, family_promoted DESC/, 'search order: relevance first, promoted breaks ties')
  assert.match(productsSrc, /promo === 'promoted'|promoFilter === 'promoted'/, 'promoted filter must exist')
  assert.match(productsSrc, /promotion_rules: promotionRules/, 'search/bootstrap payload carries the active rules')
  pass("products.ts: promoted-first family ordering + promo filter + rules in the payload")

  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0071_promotion_rules.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE promotion_rules/, 'migration 0071 creates promotion_rules')
  pass('migration 0071 present')
}

console.log(`\n${checks} check group(s) passed.`)
