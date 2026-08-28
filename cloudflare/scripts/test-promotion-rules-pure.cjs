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
  // G1b flip: within MATCHING results, discounted items top; relevance
  // orders inside each block ("relevance still wins but if relevance also
  // have discounts, discounts top" -- relevance decides what matches at
  // all, promoted matches lead).
  assert.match(productsSrc, /family_promoted DESC, match_rank ASC/, 'search order: promoted matches top, relevance orders within each block')
  assert.match(productsSrc, /promo === 'promoted'|promoFilter === 'promoted'/, 'promoted filter must exist')
  assert.match(productsSrc, /promotion_rules: promotionRules/, 'search/bootstrap payload carries the active rules')
  pass("products.ts: promoted-first family ordering + promo filter + rules in the payload")

  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0071_promotion_rules.sql'), 'utf8')
  assert.match(migration, /CREATE TABLE promotion_rules/, 'migration 0071 creates promotion_rules')
  const migration73 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0073_promotion_rule_types.sql'), 'utf8')
  assert.match(migration73, /ADD COLUMN min_spend_usd/, '0073 adds the spend threshold')
  assert.match(migration73, /ADD COLUMN label_style/, '0073 adds the label wording style')
  pass('migrations 0071 + 0073 present')
}

// ---- 4. G1b rule types + auto-labels + cart pairing ---------------------
{
  const mk = (row) => kernel.normalizePromotionRule({ id: 5, scope_type: 'products', product_ids: '[7,8]', is_active: 1, ...row })
  const cheap = { id: 7, selling_price_usd: 10, selling_price_khr: 41000 }
  const dear = { id: 8, selling_price_usd: 30, selling_price_khr: 123000 }

  // spend_save: crosses on line gross
  const spend = mk({ rule_type: 'spend_save', min_spend_usd: 50, save_usd: 5 })
  assert.strictEqual(kernel.evaluatePromotionPricing(dear, 1, [spend]).active, false, '30 < 50: not yet')
  const spent = kernel.evaluatePromotionPricing(dear, 2, [spend])
  assert.strictEqual(spent.active, true)
  assert.strictEqual(spent.line_total_usd, 55, '60 - 5')

  // quantity_percent: threshold percent
  const qtyPct = mk({ rule_type: 'quantity_percent', min_quantity: 2, percent_off: 10 })
  assert.strictEqual(kernel.evaluatePromotionPricing(dear, 1, [qtyPct]).active, false)
  assert.strictEqual(kernel.evaluatePromotionPricing(dear, 2, [qtyPct]).line_total_usd, 54, '60 - 10%')

  // next_item per-line: buy 1 get 2nd 50% off, qty 3 -> ONE complete pair
  const bogo = mk({ rule_type: 'next_item', min_quantity: 1, percent_off: 50 })
  const perLine = kernel.evaluatePromotionPricing(dear, 3, [bogo])
  assert.strictEqual(perLine.line_discount_usd, 15, 'one 50% hit on a $30 unit; the 3rd unit starts an incomplete group')

  // next_item CROSS-line: the CHEAPEST of the pair takes the cut
  const adjustments = kernel.evaluateCartPromotionAdjustments(
    [
      { line_id: 'a', product: dear, quantity: 1 },
      { line_id: 'b', product: cheap, quantity: 1 },
    ],
    [bogo], 4100,
  )
  assert.strictEqual(adjustments.get('a').active, false, 'the dear item stays full price')
  assert.strictEqual(adjustments.get('b').line_discount_usd, 5, 'the CHEAP item gets 50% off ("only lowest of the two")')
  // two complete pairs across mixed lines -> two cheapest units hit
  const two = kernel.evaluateCartPromotionAdjustments(
    [
      { line_id: 'a', product: dear, quantity: 2 },
      { line_id: 'b', product: cheap, quantity: 2 },
    ],
    [bogo], 4100,
  )
  assert.strictEqual(two.get('b').line_discount_usd, 10, 'both cheap units discounted across two groups')
  assert.strictEqual(two.get('a').active, false)

  // auto-labels per wording style
  assert.strictEqual(kernel.promotionAutoLabel(mk({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, label_style: 'save' })), 'Buy 3+ Save $5')
  assert.strictEqual(kernel.promotionAutoLabel(mk({ rule_type: 'quantity_save', min_quantity: 3, save_usd: 5, label_style: 'get' })), 'Buy 3+ Get $5 Off')
  assert.strictEqual(kernel.promotionAutoLabel(mk({ rule_type: 'next_item', min_quantity: 1, percent_off: 100, label_style: 'free' })), 'Buy 1 Get 1 Free')
  assert.strictEqual(kernel.promotionAutoLabel(mk({ rule_type: 'spend_save', min_spend_usd: 50, save_usd: 5, label_style: 'get' })), 'Spend $50 Get $5 Off')

  // hints: a not-yet-earned spend/next deal still badges (and counts promoted)
  assert.strictEqual(kernel.promotionBadgeForProduct(dear, [bogo]).kind, 'quantity_hint')
  assert.strictEqual(kernel.isProductPromoted(dear, [spend]), true)
  pass('G1b: spend_save/quantity_percent/next_item math, cheapest-of-group pairing, style-worded auto-labels, hint coverage')
}

// ---- 5. portal surface privacy ------------------------------------------
{
  // The public portal must never expose internal fields or facets --
  // supplier names, cost prices, the operator's tag_label -- neither as
  // payload columns nor as filters (user rule, Part 397: "make sure for
  // example public portal doesn't show supplier etc").
  const portalSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
  assert.ok(!/p\.supplier|p\.cost_price|p\.tag_label/.test(portalSrc), 'portal SELECTs must not carry supplier/cost/tag columns')
  assert.ok(!/query\.supplier/.test(portalSrc), 'portal filters must not accept a supplier facet')
  assert.match(portalSrc, /query\.promo/, "portal exposes exactly the one public promo facet ('promoted')")
  pass('portal payloads and facets stay customer-only (no supplier/cost/tag), promo facet present')

  // 6.3 regression pins: settings saves bump their own cache version and
  // the portal cache key composes products+settings -- without both, every
  // portal-editor save (map embed included) served stale config until the
  // TTL died (reproduced live in Part 400's sweep).
  const settingsSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
  assert.match(settingsSrc, /bumpVersion\(c\.env, 'settings'\)/, 'settings POST must bump the settings cache version')
  assert.match(portalSrc, /getVersionWithFallback\(c\.env, 'settings'\)/, 'portal cache key must include the settings version')
  pass('6.3: settings saves invalidate the portal cache immediately (no TTL hiding)')
}

console.log(`\n${checks} check group(s) passed.`)
