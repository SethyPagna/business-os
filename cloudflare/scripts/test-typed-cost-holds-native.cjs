// U-cost follow-up (refuter finding, 2026-09-26): the 0195 triggers re-derive
// products.cost_price_usd at every stock movement, and the derivation honours
// a typed cost only when it has a product_cost_entries row. The product form
// records one (productWrites.updateRow with an actor); every OTHER cost writer
// wrote the column bare, so the typed/imported figure silently reverted at the
// next sale. This file drives each writer, then a sale, and asserts the cost
// holds:
//   - the product form (PUT /:id) -- the reference behaviour;
//   - the catalog-wide bulk price adjust (POST /bulk-price-adjust);
//   - the per-selection bulk adjust (frontend buildProductBulkUpdatePayload
//     -> the same PUT /:id, one product at a time);
//   - an approved review-queue edit (reviewQueue approve -> reviewApply), both
//     a planned payload and a plan-less historical queue row;
//   - a product import (the ACTUAL write loop of runImportApply, extracted
//     from lib/importEngine.ts: default, override_replace, fill_blank and
//     replace_columns updates) and a legacy inventory import 'add' row;
// plus the negative controls that make the fixture discriminating: a bare
// UPDATE of the cost reverts at the sale (so "holds" is not the trigger doing
// nothing), an import receipt row (override_add with stock) still prices by
// its lot, and a same-value re-import records nothing.
//
// Real Hono routes, real lib code, the full migrated SQLite schema with the
// 0195 triggers. The "sale" is the stock write every sale makes -- one unit
// off a lot's branch_batch_stock row -- which is what fires the trigger.
//
// Run (from cloudflare/): node scripts/test-typed-cost-holds-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.resolve(__dirname, '../src')
const frontendSrc = path.resolve(__dirname, '../../frontend/src')
const database = openDb(loadAll())
const raw = database.db
const DB = {
  prepare(sql) {
    let values = []
    const statement = {
      bind(...args) { values = args; return statement },
      async all() { return { results: raw.prepare(sql).all(...values) } },
      async first() { return raw.prepare(sql).get(...values) ?? null },
      async run() {
        const result = raw.prepare(sql).run(...values)
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
      },
    }
    return statement
  },
  async batch(statements) {
    raw.exec('BEGIN IMMEDIATE')
    try { const results = []; for (const statement of statements) results.push(await statement.run()); raw.exec('COMMIT'); return results }
    catch (error) { raw.exec('ROLLBACK'); throw error }
  },
}
const env = { DB }

const real = new Set([
  'acquisitionCostAccess', 'productWrites', 'moneyPrecision', 'productMerge', 'productIdentity', 'productDetailRule', 'db',
  'sqlBinding', 'searchMatch', 'batchCode', 'actorSnapshot', 'pendingActions', 'reviewGate', 'reviewApply',
  'conflictControl', 'renameCascade', 'schemaProbe', 'catalogCostRecompute', 'productBatches',
])
const noop = new Proxy(function () {}, { get: () => noop, apply: () => undefined, construct: () => ({}) })
class ProductImageAssetError extends Error {}
const services = {
  auth: { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
  permissions: {
    getPermissionTier: (u) => u.tier || 'full', getActionTier: (u) => u.tier || 'full',
    hasPermission: (u) => u.tier !== 'none', isActionBlocked: () => false, isAdminControlUser: () => true,
  },
  audit: { audit: async () => {}, changedFields: () => null, auditChangeColumns: () => ({ old_value: null, new_value: null }), isSecretShapedAuditKey: () => false },
  cache: { bumpVersion: async () => {}, bumpVersions: async () => {} },
  broadcastHub: { broadcast: async () => {} },
  media: { sanitizeMediaList: () => [] },
  importImageMatch: { MAX_IMAGES_PER_PRODUCT: 3 },
  productImagePermission: { ProductImageAssetError, productImageFieldsChanged: () => false, productImageFieldsChangedResolved: async () => false, resolveProductImageFields: async () => {}, omitUnchangedProductImageFields: () => {} },
}
const cache = new Map()
const transpile = (source, fileName) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }, fileName }).outputText
function localRequireFor(relative) {
  return (request) => {
    if (request === 'hono') return { Hono }
    const name = request.split('/').pop()
    if (relative === 'lib/acquisitionCostAccess.ts' && name === 'permissions') return load('lib/permissions.ts')
    if (services[name]) return services[name]
    if (real.has(name)) return load(`lib/${name}.ts`)
    if (request.startsWith('.')) return noop
    return require(request)
  }
}
function load(relative) {
  if (cache.has(relative)) return cache.get(relative)
  const mod = { exports: {} }; cache.set(relative, mod.exports)
  const filename = path.join(src, relative)
  new Function('require', 'module', 'exports', transpile(fs.readFileSync(filename, 'utf8'), filename))(localRequireFor(relative), mod, mod.exports)
  cache.set(relative, mod.exports); return mod.exports
}
function loadFrontend(relative) {
  const filename = path.resolve(frontendSrc, relative)
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', transpile(fs.readFileSync(filename, 'utf8'), filename))((request) => {
    if (!request.startsWith('.')) return require(request)
    return loadFrontend(path.relative(frontendSrc, path.resolve(path.dirname(filename), request)))
  }, mod, mod.exports)
  return mod.exports
}

const products = load('routes/products.ts').default
const reviews = load('routes/reviewQueue.ts').default
const context = { waitUntil: () => {}, passThroughOnException: () => {} }
const costPermissions = JSON.stringify({ product_cost_edit: true, product_cost_view: true })
const admin = { id: 1, username: 'admin', name: 'Admin', tier: 'full', permissions: costPermissions }
const requester = { id: 2, username: 'requester', name: 'Requester', tier: 'review', permissions: costPermissions }
async function request(app, method, url, body, user = admin) {
  const response = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { ...env, TEST_USER: user }, context)
  const text = await response.text()
  return { status: response.status, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : text }
}

raw.prepare("INSERT OR IGNORE INTO branches(id, name) VALUES (1, 'Shop')").run()
const cost = (id) => raw.prepare('SELECT cost_price_usd c FROM products WHERE id = ?').get(id).c
const entries = (id) => raw.prepare('SELECT * FROM product_cost_entries WHERE product_id = ? ORDER BY id').all(id)
let seq = 0
// Two lots on hand: 2 x 3.00 and 2 x 5.00 -> the rule's figure is 4.00. A
// sale of one 3.00 unit moves the rule's figure to (3 + 10) / 3 = 4.3333, so
// a typed 9 that is not honoured is visibly overwritten.
function seed(name = `P${++seq}`, active = 1) {
  const id = Number(raw.prepare('INSERT INTO products(name, cost_price_usd, cost_price_khr, purchase_price_usd, selling_price_usd, is_active, updated_at) VALUES (?, 4, 0, 4, 20, ?, NULL)')
    .run(name, active).lastInsertRowid)
  const lot = (unit, day) => {
    const lotId = Number(raw.prepare(`INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at, received_quantity, received_branch_id)
      VALUES (?, ?, 1, ?, ?, 2, 1)`).run(id, `k${++seq}`, unit, `2026-09-${day}`).lastInsertRowid)
    raw.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES (?, 1, 2)').run(lotId)
    return lotId
  }
  const cheap = lot(3, 10); lot(5, 11)
  raw.prepare('INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES (?, 1, 4)').run(id)
  return { id, cheap }
}
function sell(product) {
  raw.prepare('UPDATE branch_batch_stock SET quantity = quantity - 1 WHERE batch_id = ? AND branch_id = 1').run(product.cheap)
}

let checks = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) }
  catch (error) { console.log(`FAIL ${name} - ${error.stack}`); process.exitCode = 1 }
}

// --- import: the real product write loop, extracted -------------------------
function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  assert.ok(start > 0 && end > start, `locate ${startMarker.slice(0, 40)}`)
  return source.slice(start, end + endMarker.length)
}
const engineSource = fs.readFileSync(path.join(src, 'lib/importEngine.ts'), 'utf8').replace(/\r\n/g, '\n')
const productLoop = extract(engineSource,
  '      for (const r of actionable) {\n        const d = r.data as Record<string, unknown> & { branch_id: number | null; branch_id_explicit: number }',
  '\n        finishProductRowWriteGroup()\n      }\n')
const inventoryLoop = extract(engineSource,
  '      for (const r of actionable) {\n        const d = r.data as Record<string, unknown> & { cost_price_usd?: number; cost_price_khr?: number }',
  '\n        guardedGroups.push(group)\n      }\n')
const composerMod = { exports: {} }
new Function('require', 'module', 'exports', transpile(`
  import { planReconcileBranchSnapshot, resolveReceiptLotTarget } from './productBatches'
  import * as catalog from './catalogCostRecompute'
  import { multiplyMoney4 } from './moneyPrecision'
  import { normalizeSearchText, compactSearchText } from './searchMatch'
  const { catalogCostRecomputeStatement } = catalog
  // Absent before the fix: the loop then simply never calls it.
  const typedCostEntryBeforeWriteStatement = (catalog as any).typedCostEntryBeforeWriteStatement
  function str(value: unknown): string { return value == null ? '' : String(value).trim() }
  export function composeProducts(ctx: any) {
    let { actionable, receiptCosts, autoMergeRecords, jobId, nowIso, productImportMode, productReplaceColumns,
      appliedRowGuards, rowGuardStatement, receiptLots, receiptBaselines, nextBatchId, productSeedBranchIds, importCostActor } = ctx
    const productStatementGroups: any[] = [], guardedGroups: any[] = [], statements: any[] = []
    ${productLoop}
    return [...productStatementGroups, ...statements.map((s: any) => [s]), ...guardedGroups]
  }
  export function composeInventory(ctx: any) {
    let { actionable, appliedRowGuards, rowGuardStatement, nowIso, importCostActor, INVENTORY_RECEIPT_PLAN_VERSION } = ctx
    const guardedGroups: any[] = []
    ${inventoryLoop}
    return guardedGroups
  }
`, 'importComposer.ts'))(localRequireFor('lib/importComposer.ts'), composerMod, composerMod.exports)
const { composeProducts, composeInventory } = composerMod.exports

const importCtx = (rows, extra = {}) => ({
  actionable: rows, receiptCosts: new Map(rows.map((r) => [r.rowNumber, r.receiptCost ?? null])), autoMergeRecords: [],
  jobId: 'job-1', nowIso: '2026-09-26T08:00:00.000Z', productImportMode: 'merge', productReplaceColumns: [],
  appliedRowGuards: new Set(), rowGuardStatement: () => ({ sql: 'SELECT 1', params: {} }),
  receiptLots: new Map(), receiptBaselines: new Map(),
  nextBatchId: Number(raw.prepare('SELECT COALESCE(MAX(id), 0) n FROM product_batches').get().n),
  productSeedBranchIds: [], importCostActor: { id: 1, name: 'admin' }, INVENTORY_RECEIPT_PLAN_VERSION: 99, ...extra,
})
// A matched row as classifyProducts leaves it: the full product row, the
// sheet's values over it, the resolved branch and received date.
function importRow(productId, overrides, rowNumber = 2, plannedMode = undefined) {
  const current = raw.prepare('SELECT * FROM products WHERE id = ?').get(productId)
  return { rowNumber, action: 'update', existingId: productId, plannedMode,
    data: { ...current, branch_id: 1, branch_id_explicit: 0, stock_quantity: 0, received_date: '2026-09-26', ...overrides } }
}
async function runGroups(groups) { for (const group of groups) await database.batch(group) }

async function main() {
  await check('control: a bare UPDATE of the cost IS reverted by the next sale (the fixture discriminates)', async () => {
    const p = seed()
    assert.equal(cost(p.id), 4, 'seeded lots: (2 x 3 + 2 x 5) / 4')
    raw.prepare('UPDATE products SET cost_price_usd = 9 WHERE id = ?').run(p.id)
    sell(p)
    assert.equal(cost(p.id), 4.3333, 'no cost entry: the rule re-derives (1 x 3 + 2 x 5) / 3')
  })

  await check('reference: the product form (PUT /:id) records an entry and the cost holds past a sale', async () => {
    const p = seed()
    const saved = await request(products, 'PUT', `/${p.id}`, { cost_price_usd: 9 })
    assert.equal(saved.status, 200, JSON.stringify(saved))
    sell(p)
    assert.equal(cost(p.id), 9)
    assert.equal(entries(p.id).length, 1)
  })

  await check('catalog-wide bulk price adjust: +5 on cost records the form\'s entry per moved row; the cost holds past a sale', async () => {
    const p = seed()
    const zero = seed()
    raw.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = ?').run(zero.id)
    // Isolate from earlier checks' rows: only these two are active.
    raw.prepare('UPDATE products SET is_active = 0 WHERE id NOT IN (?, ?)').run(p.id, zero.id)
    const adjusted = await request(products, 'POST', '/bulk-price-adjust', { direction: 'increase', amount: 5, fields: ['cost_price_usd'], skip_zero: true })
    assert.equal(adjusted.status, 200, JSON.stringify(adjusted))
    assert.equal(adjusted.body.changed, 1, 'changed still counts the products UPDATE, not the entry insert')
    assert.equal(cost(p.id), 9)
    const [entry] = entries(p.id)
    assert.ok(entry, 'an entry was recorded')
    assert.deepEqual([entry.source, entry.cost_usd, entry.previous_cost_usd, entry.user_id, entry.user_name, entry.cost_khr],
      ['manual', 9, 4, 1, 'admin', null], 'same shape as the form\'s entry (KHR not written -> NULL)')
    assert.equal(entry.baseline_batch_id, raw.prepare('SELECT MAX(id) m FROM product_batches WHERE variant_product_id = ?').get(p.id).m)
    assert.equal(entries(zero.id).length, 0, 'skip_zero row did not move: no entry')
    sell(p)
    assert.equal(cost(p.id), 9, 'typed cost holds past the sale')
    raw.prepare('UPDATE products SET is_active = 1').run()
  })

  await check('per-selection bulk adjust: buildProductBulkUpdatePayload -> PUT /:id records the entry; the cost holds', async () => {
    const { buildProductBulkUpdatePayload } = loadFrontend('components/products/helpers/productWriteHelpers.ts')
    const p = seed()
    const current = raw.prepare('SELECT * FROM products WHERE id = ?').get(p.id)
    const saved = await request(products, 'PUT', `/${p.id}`, buildProductBulkUpdatePayload({ cost_price_usd: 9 }, current, { id: 1, name: 'admin' }))
    assert.equal(saved.status, 200, JSON.stringify(saved))
    sell(p)
    assert.equal(cost(p.id), 9)
  })

  await check('review queue: an approved cost edit records the entry (requester as actor); the cost holds past a sale', async () => {
    const p = seed()
    const queued = await request(products, 'PUT', `/${p.id}`, { cost_price_usd: 9 }, requester)
    assert.equal(queued.status, 202, JSON.stringify(queued))
    assert.equal(cost(p.id), 4, 'not applied until approved')
    const approved = await request(reviews, 'POST', `/${queued.body.pendingActionId}/approve`, {})
    assert.equal(approved.status, 200, JSON.stringify(approved))
    assert.equal(cost(p.id), 9)
    const [entry] = entries(p.id)
    assert.ok(entry, 'an entry was recorded')
    assert.equal(entry.user_name, 'requester')
    sell(p)
    assert.equal(cost(p.id), 9)
  })

  await check('review queue: a plan-less historical queue row still records the entry; the cost holds past a sale', async () => {
    const p = seed()
    const pendingId = Number(raw.prepare("INSERT INTO pending_actions(section, action_type, entity_type, entity_id, payload_json, status, requested_by, requested_by_name) VALUES ('products', 'update', 'product', ?, ?, 'open', 2, 'requester')")
      .run(p.id, JSON.stringify({ cost_price_usd: 9 })).lastInsertRowid)
    const approved = await request(reviews, 'POST', `/${pendingId}/approve`, {})
    assert.equal(approved.status, 200, JSON.stringify(approved))
    assert.equal(cost(p.id), 9)
    assert.deepEqual(entries(p.id).map((e) => [e.cost_usd, e.previous_cost_usd, e.user_name]), [[9, 4, 'requester']])
    sell(p)
    assert.equal(cost(p.id), 9)
  })

  for (const [label, mode, extra] of [
    ['default (no mode)', undefined, {}],
    ['override_replace', 'override_replace', {}],
    ['replace_columns [cost_price_usd]', undefined, { productImportMode: 'replace_columns', productReplaceColumns: ['cost_price_usd'] }],
  ]) {
    await check(`product import, ${label}: an imported cost records the entry and holds past a sale`, async () => {
      const p = seed()
      await runGroups(composeProducts(importCtx([importRow(p.id, { cost_price_usd: 9 }, 2, mode)], extra)))
      assert.equal(cost(p.id), 9)
      assert.equal(entries(p.id).length, 1)
      assert.equal(raw.prepare('SELECT is_active a FROM products WHERE id = ?').get(p.id).a, 1, 'the row write itself is intact')
      sell(p)
      assert.equal(cost(p.id), 9)
    })
  }

  await check('product import, fill_blank: a blank cost filled from the file holds past a sale', async () => {
    const p = seed()
    raw.prepare('UPDATE products SET cost_price_usd = 0 WHERE id = ?').run(p.id)
    await runGroups(composeProducts(importCtx([importRow(p.id, { cost_price_usd: 9 })], { productImportMode: 'fill_blank' })))
    assert.equal(cost(p.id), 9)
    sell(p)
    assert.equal(cost(p.id), 9)
  })

  await check('product import: a same-value re-import records nothing', async () => {
    const p = seed()
    await runGroups(composeProducts(importCtx([importRow(p.id, {})])))
    assert.equal(entries(p.id).length, 0)
    sell(p)
    assert.equal(cost(p.id), 4.3333, 'no typed cost: the rule keeps deriving')
  })

  await check('product import, override_add WITH a receipt: the lot is the cost record, no override entry', async () => {
    const p = seed()
    const row = importRow(p.id, { cost_price_usd: 9, branch_id_explicit: 1, stock_quantity: 2 }, 2, 'override_add')
    row.receiptCost = 9
    await runGroups(composeProducts(importCtx([row])))
    assert.equal(entries(p.id).length, 0, 'receipt rows are priced by their lot')
    assert.equal(cost(p.id), 5.6667, '(2 x 3 + 2 x 5 + 2 x 9) / 6 -- the receipt joins the weighted rule')
  })

  await check('inventory import (legacy add row with a unit cost): the cost records the entry and holds past a sale', async () => {
    const p = seed()
    const row = { rowNumber: 2, data: { product_id: p.id, product_name: 'x', branch_id: 1, branch_name: 'Shop', movement_type: 'add', quantity: 1, signedQuantity: 1,
      unit_cost_usd: 9, unit_cost_khr: 0, total_cost_usd: 9, total_cost_khr: 0, reason: 'import', cost_price_usd: 9 } }
    await runGroups(composeInventory(importCtx([row])))
    assert.equal(cost(p.id), 9)
    assert.equal(entries(p.id).length, 1)
    sell(p)
    assert.equal(cost(p.id), 9)
  })

  console.log(`${checks} checks passed`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
