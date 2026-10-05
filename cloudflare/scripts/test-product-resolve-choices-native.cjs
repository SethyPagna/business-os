// Products Resolve grid: the per-field choices (UI-CONFLICTS B1, owner 30 Sep
// 2026: "we should be able to select the segments we want, and the final
// column should show the final how it looks like").
//
//   LIB    lib/productResolveChoices.ts against the shared parity table
//          scripts/fixtures/product-resolve-choices-parity.json, which
//          frontend/tests/productResolveAdapter.test.ts reads too: parse, the
//          Final values from the frozen reviewed rows, the survivor UPDATE,
//          the before-image, the merge_failed answer.
//   ROUTE  the real preview/merge routes and the real fold, full migration
//          chain: picks from merged records survive every step of a
//          three-product group (a chosen lower selling price is not replaced
//          by the group's highest), a retry with other choices is refused,
//          invalid or plan-less choices write nothing, undo restores the
//          survivor exactly and redo repeats the choice. These need the
//          products.ts wiring (UI-CONFLICTS-2 HANDOFF to PERM-WORKER).
//
// Run (from cloudflare/scripts): node test-product-resolve-choices-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { Hono } = require('hono')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '../src')
const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'product-resolve-choices-parity.json'), 'utf8'))

let inertKeys = 0
function inert() {
  const key = `inert-${inertKeys += 1}`
  return new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => key : inert()),
    apply: () => inert(),
    construct: () => inert(),
  })
}
function load(file, overrides = {}) {
  const full = path.join(SRC, file)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const original = Module._load
  Module._load = (request, parent, isMain) => Object.hasOwn(overrides, request) ? overrides[request] : request.startsWith('.') ? inert() : original(request, parent, isMain)
  const mod = { exports: {} }
  try { new Function('require', 'module', 'exports', '__filename', '__dirname', code)(require, mod, mod.exports, full, path.dirname(full)) } finally { Module._load = original }
  return mod.exports
}

const state = { native: null, user: null, tier: 'paid', queries: 0 }
const adapter = {
  prepare(sql) {
    const st = state.native.prepare(sql)
    return {
      get: (p) => { state.queries += 1; return st.get(p == null ? {} : p) },
      all: (p) => { state.queries += 1; return st.all(p == null ? {} : p) },
      run: (p) => {
        state.queries += 1
        const r = st.run(p == null ? {} : p)
        return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  batch: (statements) => { state.queries += statements.length; return state.native.batch(statements) },
}

const moneyPrecision = load('lib/moneyPrecision.ts')
const searchMatch = load('lib/searchMatch.ts')
const choicesLib = load('lib/productResolveChoices.ts', { './moneyPrecision': moneyPrecision, './searchMatch': searchMatch })
const permissions = load('lib/permissions.ts')
const planTier = load('lib/planTier.ts')
const actorSnapshot = load('lib/actorSnapshot.ts')
const sqlBinding = load('lib/sqlBinding.ts')
const detailRule = load('lib/productDetailRule.ts', { './moneyPrecision': moneyPrecision })
const productIdentity = load('lib/productIdentity.ts', { './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule })
const productMerge = load('lib/productMerge.ts', { './moneyPrecision': moneyPrecision })
const productMergeSnapshot = load('lib/productMergeSnapshot.ts', { './db': {} })
const acquisitionCostAccess = load('lib/acquisitionCostAccess.ts', { './permissions': permissions })
const noAudit = { audit: async () => {} }
const broadcastHub = { broadcast: async () => {} }
const catalogCost = load('lib/catalogCostRecompute.ts', { './moneyPrecision': moneyPrecision })
const undoAppliers = load('lib/undoAppliers.ts', {
  './actorSnapshot': actorSnapshot,
  './db': { getDb: () => adapter },
  './audit': noAudit,
  '../durable-objects/broadcastHub': broadcastHub,
  './permissions': permissions,
  './productMerge': productMerge,
  './productMergeSnapshot': productMergeSnapshot,
  './sqlBinding': sqlBinding,
  './moneyPrecision': moneyPrecision,
  './productIdentity': productIdentity,
  './productDetailRule': detailRule,
  './branchWrites': { branchUpdateStatements: () => [] },
  './catalogCostRecompute': catalogCost,
})
const products = load('routes/products.ts', {
  '../lib/catalogCostRecompute': catalogCost,
  '../lib/db': { getDb: () => adapter },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
  '../lib/permissions': permissions,
  '../lib/planTier': planTier,
  '../lib/actorSnapshot': actorSnapshot,
  '../lib/acquisitionCostAccess': acquisitionCostAccess,
  '../lib/audit': noAudit,
  '../lib/undoAppliers': undoAppliers,
  '../lib/productDetailRule': detailRule,
  '../lib/productIdentity': productIdentity,
  '../lib/productMerge': productMerge,
  '../lib/productMergeSnapshot': productMergeSnapshot,
  '../lib/productResolveChoices': choicesLib,
  '../lib/searchMatch': searchMatch,
  '../lib/sqlBinding': sqlBinding,
  '../lib/moneyPrecision': moneyPrecision,
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {}, cachedJsonResponse: async () => null, getVersionWithFallback: async () => '1' },
  '../durable-objects/broadcastHub': broadcastHub,
}).default
const app = new Hono()
app.route('/api/products', products)

const ADMIN = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{}' }
// products Full with the Edit product switch OFF: may merge, may not edit.
const MERGER = { id: 2, username: 'merger', name: 'Merger', role_code: 'manager', permissions: JSON.stringify({ products: true, 'products:edit': false }) }
const EDITOR = { id: 3, username: 'editor', name: 'Editor', role_code: 'manager', permissions: JSON.stringify({ products: true }) }
const [KEEP, M1, M2] = FIXTURE.groupIds
const CHOICE_COLUMNS = ['name', 'name_normalized', 'barcode', 'brand', 'brands', 'brand_compact', 'category', 'categories', 'unit', 'unit_normalized',
  'selling_price_usd', 'selling_price_khr', 'wholesale_price_usd', 'wholesale_price_khr', 'image_path']

function sqlValue(value) { return value == null ? 'NULL' : typeof value === 'number' ? String(value) : `'${String(value).replace(/'/g, "''")}'` }
function fresh() {
  state.native = openDb(loadAll())
  const db = state.native.db
  db.exec("INSERT INTO branches (id, name) VALUES (1, 'shop'), (2, 'warehouse')")
  for (const row of FIXTURE.rows) {
    const columns = ['id', 'name', 'barcode', 'brand', 'brands', 'category', 'categories', 'unit', 'selling_price_usd', 'selling_price_khr',
      'wholesale_price_usd', 'wholesale_price_khr', 'cost_price_usd', 'cost_price_khr', 'image_path']
    db.exec(`INSERT INTO products (${columns.join(', ')}, is_active) VALUES (${columns.map((column) => sqlValue(row[column])).join(', ')}, 1)`)
  }
  // The survivor's own sale keeps its name in step with the product.
  db.exec(`INSERT INTO sales (id, receipt_number, branch_id, total_usd, sale_status) VALUES (900, 'R-900', 1, 12, 'completed')`)
  db.exec(`INSERT INTO sale_items (id, sale_id, product_id, product_name, quantity, applied_price_usd, total_usd, branch_id) VALUES (700, 900, ${KEEP}, 'Glow Serum 30ml', 1, 12, 12, 1)`)
  state.user = ADMIN
  state.tier = 'paid'
}
const one = (sql, ...params) => { const row = state.native.db.prepare(sql).get(...params); return row ? { ...row } : row }
const rows = (sql, ...params) => state.native.db.prepare(sql).all(...params).map((row) => ({ ...row }))
const dump = () => JSON.stringify(['products', 'branch_stock', 'product_batches', 'sale_items', 'audit_logs', 'action_history', 'undo_snapshots'].map((table) => rows(`SELECT * FROM ${table} ORDER BY rowid`)))
const keeperColumns = () => one(`SELECT ${CHOICE_COLUMNS.join(', ')} FROM products WHERE id = ?`, KEEP)

async function request(method, url, body) {
  state.queries = 0
  planTier.__resetPlanTierCacheForTests()
  const init = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await app.request(url, init, { DB: {}, PLAN_TIER: state.tier }, { waitUntil: () => {}, passThroughOnException: () => {} })
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { throw new Error(`${method} ${url} ${res.status}: ${text}`) }
}
const merge = (body) => request('POST', '/api/products/possible-duplicates/merge', body)
const preview = (keepId, mergeId, extra = '') => request('GET', `/api/products/possible-duplicates/merge-preview?keepId=${keepId}&mergeId=${mergeId}&keep=1${extra}`)

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 10).join('\n  ')}`) }
}

async function reviewGroup(requestId, choices) {
  const seen = await preview(KEEP, M1, `&groupIds=${FIXTURE.groupIds.join(',')}`)
  assert.equal(seen.status, 200, JSON.stringify(seen.body))
  const resolve = { requestId, reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId: M1 }, { mergeId: M2 }] }
  return { seen, resolve, body: (mergeId) => ({ keepId: KEEP, mergeId, keep: true, resolve, choices }) }
}

async function main() {
  // ---- LIB: the shared parity table -----------------------------------------
  await check('LIB: every parity case parses to its canonical choices and resolves to its Final and server columns', async () => {
    assert.ok(FIXTURE.cases.length >= 3)
    for (const item of FIXTURE.cases) {
      const parsed = choicesLib.parseProductResolveChoices({ choices: item.choices }, FIXTURE.groupIds)
      assert.equal(parsed.ok, true, `${item.label}: ${JSON.stringify(parsed)}`)
      assert.deepEqual(parsed.choices, item.parsed, item.label)
      const columns = choicesLib.resolveChoiceValues(parsed.choices, FIXTURE.rows)
      assert.deepEqual(columns, item.columns, item.label)
      for (const [field, value] of Object.entries(item.final)) assert.equal(columns[field], value, `${item.label}: Final ${field}`)
    }
  })

  await check('LIB: every invalid case is invalid_resolve_choices; absent or null choices are no choices', async () => {
    for (const item of FIXTURE.invalid) {
      const parsed = choicesLib.parseProductResolveChoices({ choices: item.choices }, FIXTURE.groupIds)
      assert.deepEqual([parsed.ok, parsed.code], [false, 'invalid_resolve_choices'], item.label)
      assert.equal(typeof parsed.error, 'string')
    }
    assert.deepEqual(choicesLib.parseProductResolveChoices({}, FIXTURE.groupIds), { ok: true, choices: {} })
    assert.deepEqual(choicesLib.parseProductResolveChoices({ choices: null }, FIXTURE.groupIds), { ok: true, choices: {} })
  })

  await check('LIB: values come only from the reviewed rows; a group member that was not reviewed is refused', async () => {
    const reviewed = FIXTURE.rows.filter((row) => row.id !== M2)
    assert.throws(() => choicesLib.resolveChoiceValues({ barcode: { source_id: M2 } }, reviewed),
      (error) => error.code === 'invalid_resolve_choices' && error.status === 400)
    const live = FIXTURE.rows.map((row) => row.id === M1 ? { ...row, selling_price_usd: 99 } : row)
    assert.equal(choicesLib.resolveChoiceValues({ selling_price_usd: { source_id: M1 } }, FIXTURE.rows).selling_price_usd, 9.5)
    assert.equal(choicesLib.resolveChoiceValues({ selling_price_usd: { source_id: M1 } }, live).selling_price_usd, 99, 'the rows passed in are the only source')
  })

  await check('LIB: the survivor UPDATE writes exactly the chosen columns, after a highest-price write, on every step', async () => {
    fresh()
    const values = FIXTURE.cases[0].columns
    const statements = choicesLib.keeperChoiceStatements(KEEP, values)
    assert.equal(statements.length, 1)
    const untouched = one('SELECT cost_price_usd, cost_price_khr, is_active, stock_quantity FROM products WHERE id = ?', KEEP)
    const economics = { sql: 'UPDATE products SET selling_price_usd = 14, selling_price_khr = 57400, wholesale_price_usd = 11 WHERE id = @id', params: { id: KEEP } }
    for (let step = 0; step < 2; step += 1) {
      await state.native.batch([economics, ...statements])
      const after = keeperColumns()
      for (const column of CHOICE_COLUMNS) {
        if (column in values) assert.equal(after[column], values[column], `step ${step + 1}: ${column}`)
      }
      assert.equal(after.selling_price_usd, 9.5, 'the chosen lower price stands after the highest-price write')
    }
    assert.deepEqual(one('SELECT cost_price_usd, cost_price_khr, is_active, stock_quantity FROM products WHERE id = ?', KEEP), untouched)
    assert.deepEqual(choicesLib.keeperChoiceStatements(KEEP, {}), [])
    const hostile = choicesLib.keeperChoiceStatements(KEEP, { 'name = 1; DROP TABLE products; --': 'x', unit: 'box' })
    assert.doesNotMatch(hostile[0].sql, /DROP/)
    assert.match(hostile[0].sql, /SET unit = @choice_unit, updated_at/)
  })

  await check('LIB: the before-image covers name and catalog only when chosen; merge_failed says nothing was changed', async () => {
    const keeperRow = { name: 'Glow Serum 30ml', name_normalized: 'glow serum 30ml', category: 'Serum', categories: 'Serum', brand: 'Glowy', brands: 'Glowy', brand_compact: 'glowy', unit: 'pcs', unit_normalized: 'pcs' }
    assert.deepEqual(choicesLib.keeperChoiceBefore(keeperRow, { selling_price_usd: 1, selling_price_khr: 0 }), {})
    assert.deepEqual(choicesLib.keeperChoiceBefore(keeperRow, { name: 'X', name_normalized: 'x' }), { keeperNameBefore: 'Glow Serum 30ml', keeperNameNormalizedBefore: 'glow serum 30ml' })
    assert.deepEqual(choicesLib.keeperChoiceBefore(keeperRow, { unit: 'box', unit_normalized: 'box' }).keeperCatalogBefore,
      { category: 'Serum', categories: 'Serum', brand: 'Glowy', brands: 'Glowy', unit: 'pcs', unit_normalized: 'pcs', brand_compact: 'glowy' })
    const body = choicesLib.mergeFailedBody('0b0e3f39-0000-4000-8000-000000000000')
    assert.deepEqual({ ...body, error: undefined }, { success: false, code: 'merge_failed', outcome: 'not_applied', errorId: '0b0e3f39-0000-4000-8000-000000000000', error: undefined })
    assert.match(body.error, /Nothing was changed/)
  })

  await check('LIB: typing is any custom entry, read from the raw body before validation; picks and absent choices are not typing', async () => {
    const typing = choicesLib.resolveChoicesTypeValues
    assert.equal(typing({ choices: { name: { custom: 'x' } } }), true)
    assert.equal(typing({ choices: { name: { source_id: 70 }, unit: { custom: '' } } }), true)
    assert.equal(typing({ choices: { barcode: { custom: '1' } } }), true, 'an invalid typed barcode is still an attempt to type')
    assert.equal(typing({ choices: { name: { source_id: 70 }, image: { source_id: 71 } } }), false)
    for (const body of [{}, { choices: null }, { choices: [] }, { choices: 'x' }, null, undefined]) assert.equal(typing(body), false)
  })

  // ---- ROUTE: the real preview/merge with choices (needs the wiring) --------
  await check('ROUTE: the fixture group is one current conflict and the preview says the server applies choices', async () => {
    fresh()
    const seen = await preview(KEEP, M1, `&groupIds=${FIXTURE.groupIds.join(',')}`)
    assert.equal(seen.status, 200, JSON.stringify(seen.body))
    assert.equal(seen.body.cluster, true, 'the three fixture rows are one similar-name cluster')
    assert.equal(seen.body.blocked, null)
    assert.equal(seen.body.choicesSupported, true, 'preview must answer choicesSupported:true (products.ts wiring)')
  })

  await check('ROUTE: picks from merged records survive BOTH steps; the chosen lower selling price is not replaced by the highest', async () => {
    fresh()
    const expected = FIXTURE.cases[0].columns
    const group = await reviewGroup('choices-two-steps', FIXTURE.cases[0].choices)
    for (const mergeId of [M1, M2]) {
      const done = await merge(group.body(mergeId))
      assert.equal(done.status, 200, `step ${mergeId}: ${JSON.stringify(done.body)}`)
      const after = keeperColumns()
      // The barcode is chosen from #72, so it is written at the step that merges #72 (P1).
      const barcodeWritten = mergeId === M2
      for (const [column, value] of Object.entries(expected)) assert.equal(after[column], column === 'barcode' && !barcodeWritten ? '8850000000070' : value, `after step ${mergeId}: ${column}`)
      assert.equal(done.body.keeper.name, expected.name)
      assert.equal(done.body.keeper.barcode, barcodeWritten ? expected.barcode : '8850000000070')
      assert.equal(done.body.keeper.selling_price_usd, 9.5)
      assert.equal(one('SELECT product_name FROM sale_items WHERE id = 700').product_name, expected.name, `step ${mergeId}: the survivor's history follows the chosen name`)
    }
    assert.equal(rows('SELECT id FROM products WHERE id IN (?, ?) AND is_active = 0', M1, M2).length, 2)
  })

  await check('ROUTE: a retry of the same request with different choices is refused and writes nothing', async () => {
    fresh()
    const group = await reviewGroup('choices-retry', FIXTURE.cases[0].choices)
    assert.equal((await merge(group.body(M1))).status, 200)
    const before = dump()
    const altered = await merge({ ...group.body(M1), choices: FIXTURE.cases[1].choices })
    assert.equal(altered.status, 409, JSON.stringify(altered.body))
    assert.equal(altered.body.code, 'resolve_request_conflict')
    const dropped = await merge({ ...group.body(M2), choices: undefined })
    assert.equal(dropped.body.code, 'resolve_request_conflict', 'dropping the choices is a different request too')
    assert.equal(dump(), before)
  })

  await check('ROUTE: invalid choices, and choices without a reviewed plan, are 400 invalid_resolve_choices and write nothing', async () => {
    fresh()
    const before = dump()
    const group = await reviewGroup('choices-invalid', FIXTURE.invalid[0].choices)
    const invalid = await merge(group.body(M1))
    assert.equal(invalid.status, 400, JSON.stringify(invalid.body))
    assert.equal(invalid.body.code, 'invalid_resolve_choices')
    const planless = await merge({ keepId: KEEP, mergeId: M1, keep: true, choices: FIXTURE.cases[0].choices })
    assert.equal(planless.status, 400, JSON.stringify(planless.body))
    assert.equal(planless.body.code, 'invalid_resolve_choices')
    assert.equal(dump(), before)
  })

  // P11: a typed Final value is a product edit; merging alone does not allow it.
  const TYPED = {
    name: { custom: 'Anything I type' }, brand: { custom: 'New Brand' }, category: { custom: 'New Category' }, unit: { custom: 'box' },
    selling_price_usd: { custom: 0.01 }, wholesale_price_usd: { custom: '0.02' },
  }
  await check('ROUTE: a merge-only user (Edit product OFF) cannot type any Final value; each field is 403 and writes nothing', async () => {
    fresh()
    state.user = MERGER
    const control = await request('PUT', `/api/products/${KEEP}`, { name: 'Edited by merger' })
    assert.equal(control.status, 403, 'the same user cannot edit the product directly')
    for (const [field, choice] of Object.entries(TYPED)) {
      const before = dump()
      const group = await reviewGroup(`typed-${field}`, { [field]: choice })
      const refused = await merge(group.body(M1))
      assert.equal(refused.status, 403, `${field}: ${JSON.stringify(refused.body)}`)
      assert.equal(refused.body.code, 'product_edit_permission_required', field)
      assert.equal(dump(), before, `${field}: nothing written`)
    }
    const mixed = await reviewGroup('typed-mixed', { name: { source_id: M1 }, unit: { custom: 'box' } })
    const before = dump()
    assert.equal((await merge(mixed.body(M1))).status, 403, 'one typed value among picks still refuses the whole request')
    assert.equal(dump(), before)
  })

  // Owner, 5 Oct 2026 (evening): the merge rule gives the HIGHEST price; only a price other than the rule needs Edit product
  // (test-merge-price-rule-native.cjs). Picking the record that already holds the highest price is the rule, not an override.
  await check('ROUTE: the same user may pick among the reviewed records\' values (prices on the rule\'s highest), and a user with Edit product may type', async () => {
    fresh()
    state.user = MERGER
    const highest = (field) => FIXTURE.rows.filter((row) => FIXTURE.groupIds.includes(row.id)).reduce((best, row) => Number(row[field]) > Number(best[field]) ? row : best).id
    const lowest = (field) => FIXTURE.rows.filter((row) => FIXTURE.groupIds.includes(row.id)).reduce((best, row) => Number(row[field]) < Number(best[field]) ? row : best).id
    assert.notEqual(highest('selling_price_usd'), lowest('selling_price_usd'), 'the fixture prices differ, so the rule is distinguishable from another pick')
    const lowPick = await reviewGroup('picks-lower-price', { selling_price_usd: { source_id: lowest('selling_price_usd') } })
    const beforeLow = dump()
    const refusedLow = await merge(lowPick.body(M1))
    assert.equal(refusedLow.status, 403, 'a pick of a lower price is an override: ' + JSON.stringify(refusedLow.body))
    assert.equal(refusedLow.body.code, 'product_edit_permission_required')
    assert.equal(dump(), beforeLow)
    const picks = { name: { source_id: M1 }, barcode: { source_id: M1 }, brand: { source_id: M1 }, category: { source_id: M2 }, unit: { source_id: M2 },
      selling_price_usd: { source_id: highest('selling_price_usd') }, wholesale_price_usd: { source_id: highest('wholesale_price_usd') } }
    const group = await reviewGroup('picks-only', picks)
    const done = await merge(group.body(M1))
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const expected = choicesLib.resolveChoiceValues(choicesLib.parseProductResolveChoices({ choices: picks }, FIXTURE.groupIds).choices, FIXTURE.rows)
    for (const [column, value] of Object.entries(expected)) assert.equal(keeperColumns()[column], value, column)
    fresh()
    state.user = EDITOR
    const typed = await reviewGroup('editor-typed', TYPED)
    const ok = await merge(typed.body(M1))
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(keeperColumns().name, 'Anything I type')
  })

  const replay = (history, direction) => {
    const payload = JSON.parse(direction === 'undo' ? history.undo_payload : history.redo_payload)
    return undoAppliers.resolveUndoApplier(payload).run(payload, { env: { DB: {} }, user: ADMIN, direction, historyId: history.id })
  }
  const undoableHistories = () => rows("SELECT id, undo_payload, redo_payload FROM action_history WHERE status = 'undoable' AND entity = 'product' ORDER BY id DESC")

  // Each undo below reverses the newest step only: undoing an older step
  // after a newer one depends on products.updated_at matching to the second
  // (a separate, pre-existing finding in the UI-CONFLICTS-2 log).
  await check('ROUTE: undo restores the survivor exactly, its history name included; redo repeats the choice', async () => {
    fresh()
    const original = keeperColumns()
    const pairChoices = { name: { source_id: M1 }, barcode: { source_id: M1 }, brand: { source_id: M1 }, category: { custom: 'Face Care' },
      selling_price_usd: { source_id: M1 }, wholesale_price_usd: { custom: '7.123' } }
    const seen = await preview(KEEP, M1, `&groupIds=${KEEP},${M1}`)
    const resolve = { requestId: 'choices-undo-pair', reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId: M1 }] }
    const done = await merge({ keepId: KEEP, mergeId: M1, keep: true, resolve, choices: pairChoices })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    const expected = choicesLib.resolveChoiceValues(choicesLib.parseProductResolveChoices({ choices: pairChoices }, [KEEP, M1]).choices, FIXTURE.rows)
    const merged = keeperColumns()
    for (const [column, value] of Object.entries(expected)) assert.equal(merged[column], value, `merged: ${column}`)
    assert.equal(one('SELECT product_name FROM sale_items WHERE id = 700').product_name, expected.name)
    const [history] = undoableHistories()
    await replay(history, 'undo')
    assert.deepEqual(keeperColumns(), original)
    assert.equal(one('SELECT product_name FROM sale_items WHERE id = 700').product_name, original.name, 'the survivor\'s own sale reads its name again')
    await replay(history, 'redo')
    assert.deepEqual(keeperColumns(), merged, 'redo repeats every chosen value')
  })

  await check('ROUTE: undoing the second step of a group leaves the first step\'s choices exactly', async () => {
    fresh()
    const group = await reviewGroup('choices-undo-step', FIXTURE.cases[0].choices)
    assert.equal((await merge(group.body(M1))).status, 200)
    const afterFirst = keeperColumns()
    assert.equal((await merge(group.body(M2))).status, 200)
    const [newest] = undoableHistories()
    await replay(newest, 'undo')
    assert.deepEqual(keeperColumns(), afterFirst)
    assert.equal(one('SELECT is_active FROM products WHERE id = ?', M2).is_active, 1)
  })

  // P1: a barcode picked from a merged record displaces the survivor's own; that
  // one must stay on a record (N1) and be named in the audit, undone exactly.
  const OWN = { [KEEP]: '8850000000070', [M1]: '8850000000071', [M2]: '8850000000072' }
  const barcodeOf = (id) => one('SELECT barcode FROM products WHERE id = ?', id).barcode
  const allBarcodes = () => rows('SELECT barcode FROM products WHERE barcode IS NOT NULL').map((row) => row.barcode)
  const mergeAudits = () => rows("SELECT details FROM audit_logs WHERE action = 'merge_duplicate' ORDER BY id").map((row) => JSON.parse(row.details))

  await check('ROUTE: a barcode picked from the merged record moves the survivor\'s own onto that record, is audited, and undo/redo restore both', async () => {
    fresh()
    const seen = await preview(KEEP, M1, `&groupIds=${KEEP},${M1}`)
    const resolve = { requestId: 'barcode-swap', reviewedDigest: seen.body.reviewedDigest, steps: [{ mergeId: M1 }] }
    const done = await merge({ keepId: KEEP, mergeId: M1, keep: true, resolve, choices: { barcode: { source_id: M1 } } })
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(barcodeOf(KEEP), OWN[M1])
    assert.equal(barcodeOf(M1), OWN[KEEP], 'the survivor\'s displaced barcode stays on the merged (deactivated) record')
    assert.deepEqual(done.body.keeper.absorbed_barcodes, [OWN[KEEP]])
    const [audit] = mergeAudits()
    assert.deepEqual(audit.absorbedBarcodes, [OWN[KEEP]], 'the audit names the barcode that did not survive, not the one that did')
    assert.deepEqual(audit.barcodes, { keeper: { before: OWN[KEEP], after: OWN[M1] }, merged: { before: OWN[M1], after: OWN[KEEP] } })
    const [history] = undoableHistories()
    const snapshot = JSON.parse(one("SELECT payload_json FROM undo_snapshots WHERE kind = 'product.merge' ORDER BY id DESC").payload_json)
    assert.deepEqual([snapshot.keeperBarcodeBefore, snapshot.dupBarcodeBefore], [OWN[KEEP], OWN[M1]], 'the undo payload carries both old barcodes')
    await replay(history, 'undo')
    assert.deepEqual([barcodeOf(KEEP), barcodeOf(M1)], [OWN[KEEP], OWN[M1]], 'undo puts each barcode back on its own record')
    assert.equal(one('SELECT is_active FROM products WHERE id = ?', M1).is_active, 1)
    await replay(history, 'redo')
    assert.deepEqual([barcodeOf(KEEP), barcodeOf(M1)], [OWN[M1], OWN[KEEP]], 'redo repeats the swap')
  })

  await check('ROUTE: across a three-product group no barcode is lost at any step, whichever record the barcode is picked from', async () => {
    fresh()
    const group = await reviewGroup('barcode-group', { barcode: { source_id: M2 } })
    for (const mergeId of [M1, M2]) {
      const done = await merge(group.body(mergeId))
      assert.equal(done.status, 200, JSON.stringify(done.body))
      // Written at the step that merges the record it came from, so no step needs two homes for barcodes.
      assert.equal(barcodeOf(KEEP), mergeId === M1 ? OWN[KEEP] : OWN[M2], `after step ${mergeId}`)
      for (const original of Object.values(OWN)) assert.ok(allBarcodes().includes(original), `after step ${mergeId}: ${original} is still on a record`)
    }
    assert.deepEqual([barcodeOf(M1), barcodeOf(M2)], [OWN[M1], OWN[KEEP]], 'the merged record keeps its own barcode; the source record takes the survivor own')
    const [newest] = undoableHistories()
    await replay(newest, 'undo')
    assert.deepEqual([barcodeOf(KEEP), barcodeOf(M1), barcodeOf(M2)], [OWN[KEEP], OWN[M1], OWN[M2]], 'undo puts every barcode back on its own record')
  })

  await check('ROUTE: only a barcode picked from a merged record swaps; picking it, or having none, displaces nothing; a leading-zero twin keeps both spellings', async () => {
    fresh()
    const own = await reviewGroup('barcode-own', { barcode: { source_id: KEEP } })
    assert.equal((await merge(own.body(M1))).status, 200)
    assert.deepEqual([barcodeOf(KEEP), barcodeOf(M1)], [OWN[KEEP], OWN[M1]])
    assert.deepEqual(mergeAudits()[0].absorbedBarcodes, [OWN[M1]])
    fresh()
    state.native.db.exec(`UPDATE products SET barcode = '0${OWN[KEEP]}' WHERE id = ${M1}`)
    const twin = await reviewGroup('barcode-twin', { barcode: { source_id: M1 } })
    assert.equal((await merge(twin.body(M1))).status, 200)
    assert.deepEqual([barcodeOf(KEEP), barcodeOf(M1)], [`0${OWN[KEEP]}`, OWN[KEEP]], 'each exact spelling stays on a record; by the leading-zero rule neither barcode is lost')
    assert.deepEqual(mergeAudits()[0].absorbedBarcodes, [])
    fresh()
    state.native.db.exec(`UPDATE products SET barcode = NULL WHERE id = ${KEEP}`)
    const blank = await reviewGroup('barcode-blank', { barcode: { source_id: M1 } })
    assert.equal((await merge(blank.body(M1))).status, 200)
    assert.deepEqual([barcodeOf(KEEP), barcodeOf(M1)], [OWN[M1], OWN[M1]])
    assert.deepEqual(mergeAudits()[0].absorbedBarcodes, [])
  })

  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
