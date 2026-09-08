const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..', 'src')

function loadTs(rel, stubs = {}) {
  const file = path.join(root, rel)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_target, property) => property === 'default' ? permissive() : permissive(),
    apply: () => undefined,
    construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, main) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, main)
  }
  const mod = { exports: {} }
  try { new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod) }
  finally { Module._load = original }
  return mod.exports
}

class FakeHono {
  constructor() { this.posts = new Map(); FakeHono.instance = this }
  post(path, handler) { this.posts.set(path, handler); return this }
  get() { return this } put() { return this } patch() { return this } delete() { return this }
  use() { return this } on() { return this } all() { return this } route() { return this }
  onError() { return this } notFound() { return this }
}

function adapter(d1, controls) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql)
      return {
        get: (params) => {
          controls.statementCount += 1
          if (controls.failNextHistoryFinalize > 0
            && /SELECT\s+id,\s*reversible,\s*status,\s*CAST\(json_extract\(undo_payload/i.test(sql)) {
            controls.failNextHistoryFinalize -= 1
            throw new Error('D1 DB is overloaded: injected history finalizer failure')
          }
          return statement.get(params || {})
        },
        all: (params) => { controls.statementCount += 1; return statement.all(params || {}) },
        run: (params) => { controls.statementCount += 1; return statement.run(params || {}) },
      }
    },
    batch: async (statements) => {
      if (controls.beforeBatch) await controls.beforeBatch(statements)
      controls.statementCount += statements.length
      const readOnly = statements.every(({ sql }) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql))
      if (!readOnly) return d1.batch(statements)
      return Promise.resolve(statements.map(({ sql, params }) => ({ success: true, results: d1.prepare(sql).all(params || {}) })))
    },
  }
}

function loadRoute(d1) {
  const controls = { beforeBatch: null, failNextHistoryFinalize: 0, statementCount: 0 }
  const db = adapter(d1, controls)
  const actor = loadTs('lib/actorSnapshot.ts')
  const detail = loadTs('lib/productDetailRule.ts')
  const binding = loadTs('lib/sqlBinding.ts')
  const identity = loadTs('lib/productIdentity.ts', { './db': {}, './sqlBinding': binding, './productDetailRule': detail })
  const merge = loadTs('lib/productMerge.ts')
  const snapshot = loadTs('lib/productMergeSnapshot.ts', { './db': {} })
  const selected = loadTs('lib/productConflictMergeBatch.ts', {
    './productIdentity': identity, './productDetailRule': detail, './productMerge': merge,
  })
  const permissions = {
    getActionTier: (user, section, action) => action === 'merge_duplicates' && user.noMerge
      ? 'none'
      : action === 'image' && user.noImages ? 'none' : 'full',
    getPermissionTier: () => 'full', hasPermission: () => true, getMergedPermissions: () => ({}), isAdminControlUser: () => true,
  }
  const undo = loadTs('lib/undoAppliers.ts', {
    './actorSnapshot': actor, '../index': {}, './auth': {}, './db': { getDb: () => db }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} }, './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': permissions,
  })
  loadTs('routes/products.ts', {
    hono: { Hono: FakeHono }, '../index': {}, '../lib/db': { getDb: () => db }, '../lib/auth': { requireAuth: async () => {} },
    '../lib/actorSnapshot': actor, '../lib/productDetailRule': detail, '../lib/sqlBinding': binding,
    '../lib/productIdentity': identity, '../lib/productMerge': merge, '../lib/productMergeSnapshot': snapshot,
    '../lib/productConflictMergeBatch': selected, '../lib/undoAppliers': undo, '../lib/permissions': permissions,
    '../lib/audit': { audit: async () => {} }, '../lib/cache': { bumpVersion: async () => {}, cachedJsonResponse: async () => null, getVersionWithFallback: async () => '1' },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
  })
  return { app: FakeHono.instance, db, controls }
}

function seed() {
  const d1 = openDb(loadAll())
  d1.db.exec(`
    INSERT INTO branches(id,name,is_active) VALUES(901,'Shop',1),(902,'Warehouse',1);
    INSERT INTO products(id,name,name_key,barcode,is_active,is_group,stock_quantity,image_path,cost_price_usd,cost_price_khr,
      selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES
      (9101,'Tea Cream','tea cream','1111',1,0,5,NULL,4,16000,8,32000,7,28000,'2026-09-08 01:00:00'),
      (9102,'Tea Cream','tea cream','1111',1,0,2,NULL,6,24000,9,36000,8,32000,'2026-09-08 01:00:00'),
      (9201,'Face Wash','face wash','2222',1,0,0,NULL,3,12000,5,20000,4,16000,'2026-09-08 01:00:00'),
      (9202,'Face Wash','face wash','2222',1,0,0,NULL,4,16000,6,24000,5,20000,'2026-09-08 01:00:00');
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(9101,901,5),(9102,901,2);
    INSERT INTO product_batches(id,variant_product_id,batch_key,batch_number,lot_code,is_active)
      VALUES(9301,9101,'keeper-lot',1,'K1',1),(9302,9102,'discard-lot',1,'D1',1);
    INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(9301,901,5),(9302,901,2);
  `)
  return d1
}

function seedManyPairs(count = 12) {
  const d1 = openDb(loadAll())
  d1.db.prepare("INSERT INTO branches(id,name,is_active) VALUES(901,'Shop',1)").run()
  const cases = []
  for (let index = 0; index < count; index += 1) {
    const left = 10001 + index * 2
    const right = left + 1
    const name = `Budget Pair ${index + 1}`
    const nameKey = name.toLowerCase()
    const barcode = String(5000 + index)
    d1.db.prepare(`INSERT INTO products
      (id,name,name_key,barcode,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr)
      VALUES(@left,@name,@nameKey,@barcode,1,0,0,5,20000,8,32000,7,28000),
            (@right,@name,@nameKey,@barcode,1,0,0,5,20000,8,32000,7,28000)`).run({ left, right, name, nameKey, barcode })
    cases.push({ case_key: `barcode:${barcode}`, cluster_type: 'barcode', cluster_value: barcode, product_ids: [left, right] })
  }
  return { d1, cases }
}

async function call(app, path, body, user = { id: 900, username: 'reviewer' }) {
  const waits = []
  const response = await app.posts.get(path)({
    env: {}, req: { json: async () => body }, get: () => user,
    json: (payload, status = 200) => ({ status, body: payload }),
    executionCtx: { waitUntil: (promise) => waits.push(Promise.resolve(promise)) },
  })
  await Promise.allSettled(waits)
  return response
}

const tableCounts = (d1) => Object.fromEntries(d1.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all()
  .map(({ name }) => [name, d1.db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n]))

async function main() {
  const d1 = seed()
  const { app } = loadRoute(d1)
  const previewBody = { cases: [
    { case_key: 'barcode:1111', cluster_type: 'barcode', cluster_value: '1111', product_ids: [9101, 9102] },
    { case_key: 'barcode:2222', cluster_type: 'barcode', cluster_value: '2222', product_ids: [9201, 9202] },
  ] }
  const beforePreview = tableCounts(d1)
  const previewDenied = await call(app, '/possible-duplicates/merge-batch/preview', previewBody, { id: 901, username: 'viewer', noMerge: true })
  assert.equal(previewDenied.status, 403)
  assert.deepEqual(tableCounts(d1), beforePreview, 'permission refusal writes nothing')
  const preview = await call(app, '/possible-duplicates/merge-batch/preview', previewBody)
  assert.equal(preview.status, 200)
  assert.equal(preview.body.cases.length, 2)
  assert.equal(preview.body.skipped.length, 0)
  assert.equal(preview.body.cases[0].needs_stock_choice, true)
  assert.equal(preview.body.cases[1].needs_stock_choice, false)
  assert.deepEqual(tableCounts(d1), beforePreview, 'preview writes nothing')
  assert.equal(preview.body.cases[0].before.stock[0].discarded_quantity, 2)
  assert.equal(preview.body.cases[0].after_by_stock_choice.merge.stock[0].quantity, 7)
  assert.equal(preview.body.cases[0].after_by_stock_choice.write_off.stock[0].quantity, 5)

  // Merge permission does not imply image permission. A no-image-effect pair
  // remains allowed, while one discarded primary image blocks the complete
  // manifest before a receipt or business write.
  {
    const imageDb = seed()
    imageDb.db.prepare("UPDATE products SET image_path='/media/discarded.jpg' WHERE id=9102").run()
    const { app: imageApp } = loadRoute(imageDb)
    const imagePreview = await call(imageApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] }, { id: 902, username: 'merge-only', noImages: true })
    assert.equal(imagePreview.status, 200)
    assert.equal(imagePreview.body.cases[0].blocked.code, 'image_permission_required')
    const countsBeforeDeniedApply = tableCounts(imageDb)
    const imageApply = await call(imageApp, '/possible-duplicates/merge-batch', {
      client_request_id: 'selected_merge_image_001', manifest_version: 1, manifest_digest: imagePreview.body.manifest_digest,
      cases: imagePreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: 'merge',
      })),
    }, { id: 902, username: 'merge-only', noImages: true })
    assert.equal(imageApply.status, 403)
    assert.equal(imageApply.body.code, 'image_permission_required')
    assert.deepEqual(tableCounts(imageDb), countsBeforeDeniedApply, 'image refusal creates no receipt or merge write')
  }

  {
    const mixedDb = seed()
    mixedDb.db.prepare("UPDATE products SET image_path='/media/discarded.jpg' WHERE id=9102").run()
    mixedDb.db.exec(`INSERT INTO products
      (id,name,name_key,barcode,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr)
      VALUES(9501,'Body Lotion','body lotion','3333',1,0,0,5,20000,8,32000,7,28000),
            (9502,'Body Lotion','body lotion','3333',1,0,0,5,20000,8,32000,7,28000);`)
    const { app: mixedApp } = loadRoute(mixedDb)
    const mixedCases = [...previewBody.cases, {
      case_key: 'barcode:3333', cluster_type: 'barcode', cluster_value: '3333', product_ids: [9501, 9502],
    }]
    const mixedPreview = await call(mixedApp, '/possible-duplicates/merge-batch/preview', { cases: mixedCases }, { id: 904, username: 'merge-only', noImages: true })
    assert.equal(mixedPreview.status, 200)
    assert.equal(mixedPreview.body.cases[0].blocked.code, 'image_permission_required')
    assert.equal(mixedPreview.body.cases[1].blocked, null)
    assert.equal(mixedPreview.body.cases[2].blocked, null)
    const actionable = mixedPreview.body.cases.filter((item) => !item.blocked)
    const mixedApplyBody = {
      client_request_id: 'selected_merge_mixed_001', manifest_version: 1, manifest_digest: mixedPreview.body.manifest_digest,
      cases: actionable.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: item.needs_stock_choice ? 'merge' : null,
      })),
    }
    const mixedApply = await call(mixedApp, '/possible-duplicates/merge-batch', mixedApplyBody, { id: 904, username: 'merge-only', noImages: true })
    assert.equal(mixedApply.status, 200)
    assert.equal(mixedApply.body.complete, true)
    assert.deepEqual(mixedApply.body.processedCaseKeys, ['barcode:2222', 'barcode:3333'])
    assert.equal(mixedDb.db.prepare('SELECT is_active FROM products WHERE id=9102').get().is_active, 1, 'blocked pair stays untouched')
    assert.equal(mixedDb.db.prepare('SELECT is_active FROM products WHERE id=9202').get().is_active, 0, 'actionable pair commits')
    assert.equal(mixedDb.db.prepare('SELECT is_active FROM products WHERE id=9502').get().is_active, 0, 'second actionable pair commits')

    const allBlockedPreview = await call(mixedApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] }, { id: 904, username: 'merge-only', noImages: true })
    assert.equal(allBlockedPreview.status, 200)
    assert.equal(allBlockedPreview.body.cases.filter((item) => !item.blocked).length, 0, 'all-blocked preview has no apply manifest cases')
  }

  {
    const noImageDb = seed()
    const { app: noImageApp } = loadRoute(noImageDb)
    const noImagePreview = await call(noImageApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[1]] }, { id: 903, username: 'merge-only', noImages: true })
    const noImageApply = await call(noImageApp, '/possible-duplicates/merge-batch', {
      client_request_id: 'selected_merge_no_image_001', manifest_version: 1, manifest_digest: noImagePreview.body.manifest_digest,
      cases: noImagePreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: null,
      })),
    }, { id: 903, username: 'merge-only', noImages: true })
    assert.equal(noImageApply.status, 200)
    assert.equal(noImageApply.body.complete, true)
  }

  // A stale reviewed financial value is rejected before even the durable run
  // receipt is created. The external edit is the only database change.
  {
    const stale = seed()
    const { app: staleApp } = loadRoute(stale)
    const stalePreview = await call(staleApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] })
    stale.db.prepare('UPDATE products SET selling_price_usd=8.5 WHERE id=9101').run()
    const countsAfterExternalEdit = tableCounts(stale)
    const staleApply = await call(staleApp, '/possible-duplicates/merge-batch', {
      client_request_id: 'selected_merge_stale_001', manifest_version: 1, manifest_digest: stalePreview.body.manifest_digest,
      cases: stalePreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: 'merge',
      })),
    })
    assert.equal(staleApply.status, 409)
    assert.equal(staleApply.body.code, 'merge_state_conflict')
    assert.equal(stale.db.prepare('SELECT COUNT(*) n FROM product_conflict_merge_runs').get().n, 0)
    assert.deepEqual(tableCounts(stale), countsAfterExternalEdit, 'stale preflight writes no receipt, product, history, or audit row')
  }

  // A write between preview read phases cannot pair an old displayed price
  // with a newer fingerprint. The stable pre/post fingerprint check refuses
  // that preview so no apparently reviewed manifest can be confirmed.
  {
    const torn = seed()
    const { app: tornApp, controls } = loadRoute(torn)
    let injected = false
    controls.beforeBatch = async (statements) => {
      if (injected || !statements.some(({ sql }) => /SELECT branch_id, quantity FROM branch_batch_stock/.test(sql))) return
      injected = true
      torn.db.prepare('UPDATE products SET selling_price_usd=99 WHERE id=9102').run()
    }
    const tornPreview = await call(tornApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] })
    assert.equal(tornPreview.status, 200)
    assert.equal(tornPreview.body.cases.length, 0)
    assert.equal(tornPreview.body.skipped[0].code, 'merge_state_conflict')
  }

  const applyBody = {
    client_request_id: 'selected_merge_sqlite_001', manifest_version: 1, manifest_digest: preview.body.manifest_digest,
    cases: preview.body.cases.map((item, ordinal) => ({
      ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
      state_digest: item.state_digest, stock: item.needs_stock_choice ? 'merge' : null,
    })),
  }
  const applied = await call(app, '/possible-duplicates/merge-batch', applyBody)
  assert.equal(applied.status, 200)
  assert.equal(applied.body.complete, true)
  assert.equal(applied.body.committedCases.length, 2)
  assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=9102').get().is_active, 0)
  assert.equal(d1.db.prepare('SELECT is_active FROM products WHERE id=9202').get().is_active, 0)
  assert.equal(d1.db.prepare('SELECT quantity FROM branch_stock WHERE product_id=9101 AND branch_id=901').get().quantity, 7)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM undo_snapshots WHERE kind=\'product.merge\'').get().n, 2)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM action_history WHERE entity=\'product\'').get().n, 2)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM audit_logs WHERE action=\'merge_duplicate\'').get().n, 2)
  assert.equal(d1.db.prepare('SELECT COUNT(*) n FROM product_conflict_merge_run_cases WHERE status=\'undo_ready\'').get().n, 2)

  const countsAfter = tableCounts(d1)
  const exactRetry = await call(app, '/possible-duplicates/merge-batch', applyBody)
  assert.equal(exactRetry.status, 200)
  assert.equal(exactRetry.body.complete, true)
  assert.deepEqual(tableCounts(d1), countsAfter, 'exact retry adds no graph, stock, history, audit, or receipt row')
  const conflict = await call(app, '/possible-duplicates/merge-batch', {
    ...applyBody, cases: applyBody.cases.map((item, index) => index ? item : { ...item, stock: 'write_off' }),
  })
  assert.equal(conflict.status, 409)
  assert.equal(conflict.body.code, 'idempotency_conflict')

  d1.db.prepare('DELETE FROM action_history').run()
  const missingHistory = await call(app, '/possible-duplicates/merge-batch', applyBody)
  assert.equal(missingHistory.status, 200)
  assert.equal(missingHistory.body.interruptionCode, 'merge_history_unavailable')
  assert.equal(missingHistory.body.undoPendingOperationIds.length, 0)
  assert.ok(missingHistory.body.undoUnavailableOperationIds.length > 0)
  assert.ok(missingHistory.body.committedCases.every((item) => item.undoAvailability === 'unavailable'))
  assert.ok(missingHistory.body.committedCases.every((item) => item.undoReady === false), 'deleted history can never retain an enabled Undo')

  // A product changing after the all-case receipt preflight but before the
  // pair batch must trip the in-batch fingerprint guard. The concurrent edit
  // remains, while every merge/history/receipt transition in that batch rolls
  // back and the durable case is explicitly refused as stale.
  {
    const raced = seed()
    const { app: raceApp, controls } = loadRoute(raced)
    const racePreview = await call(raceApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] })
    const raceApply = {
      client_request_id: 'selected_merge_race_001', manifest_version: 1, manifest_digest: racePreview.body.manifest_digest,
      cases: racePreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: 'merge',
      })),
    }
    let injected = false
    controls.beforeBatch = async (statements) => {
      if (injected || !statements.some(({ sql }) => /selected_conflict_receipt_guard/.test(sql))) return
      injected = true
      raced.db.prepare('UPDATE products SET cost_price_usd=5 WHERE id=9102').run()
    }
    const result = await call(raceApp, '/possible-duplicates/merge-batch', raceApply)
    assert.equal(result.status, 200)
    assert.equal(result.body.interruptionCode, 'merge_state_conflict')
    assert.equal(result.body.refusals[0].code, 'merge_state_conflict')
    assert.equal(raced.db.prepare('SELECT cost_price_usd,is_active FROM products WHERE id=9102').get().cost_price_usd, 5)
    assert.equal(raced.db.prepare('SELECT is_active FROM products WHERE id=9102').get().is_active, 1)
    assert.equal(raced.db.prepare('SELECT quantity FROM branch_stock WHERE product_id=9101 AND branch_id=901').get().quantity, 5)
    assert.equal(raced.db.prepare("SELECT COUNT(*) n FROM product_conflict_merge_run_cases WHERE status='committed'").get().n, 0)
    assert.equal(raced.db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge'").get().n, 0)
    assert.equal(raced.db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='product'").get().n, 0)
    assert.equal(raced.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 0)
  }

  // Exact-two eligibility belongs to the pair transaction guard, not only
  // preview. A third matching active product appearing immediately before the
  // write makes the case stale and leaves the reviewed pair unchanged.
  {
    const membership = seed()
    const { app: membershipApp, controls } = loadRoute(membership)
    const membershipPreview = await call(membershipApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] })
    let injected = false
    controls.beforeBatch = async (statements) => {
      if (injected || !statements.some(({ sql }) => /selected_conflict_receipt_guard/.test(sql))) return
      injected = true
      membership.db.prepare(`INSERT INTO products
        (id,name,name_key,barcode,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr)
        VALUES(9401,'Tea Cream','tea cream','1111',1,0,0,5,20000,8,32000,7,28000)`).run()
    }
    const result = await call(membershipApp, '/possible-duplicates/merge-batch', {
      client_request_id: 'selected_merge_membership_001', manifest_version: 1, manifest_digest: membershipPreview.body.manifest_digest,
      cases: membershipPreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: 'merge',
      })),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.interruptionCode, 'merge_state_conflict')
    assert.equal(membership.db.prepare('SELECT is_active FROM products WHERE id=9102').get().is_active, 1)
    assert.equal(membership.db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='product'").get().n, 0)
  }

  // The fingerprint records each linked row's current owner. An external
  // reparent between review and fold stays external and cannot be claimed by
  // this merge's Undo snapshot.
  {
    const linked = seed()
    linked.db.prepare(`INSERT INTO inventory_movements
      (id,product_id,product_name,branch_id,branch_name,movement_type,quantity,reason)
      VALUES(9999,9102,'Tea Cream',901,'Shop','adjustment',1,'external fixture')`).run()
    const { app: linkedApp, controls } = loadRoute(linked)
    const linkedPreview = await call(linkedApp, '/possible-duplicates/merge-batch/preview', { cases: [previewBody.cases[0]] })
    let injected = false
    controls.beforeBatch = async (statements) => {
      if (injected || !statements.some(({ sql }) => /selected_conflict_receipt_guard/.test(sql))) return
      injected = true
      linked.db.prepare('UPDATE inventory_movements SET product_id=9101 WHERE id=9999').run()
    }
    const result = await call(linkedApp, '/possible-duplicates/merge-batch', {
      client_request_id: 'selected_merge_linked_001', manifest_version: 1, manifest_digest: linkedPreview.body.manifest_digest,
      cases: linkedPreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: 'merge',
      })),
    })
    assert.equal(result.status, 200)
    assert.equal(result.body.interruptionCode, 'merge_state_conflict')
    assert.equal(linked.db.prepare('SELECT product_id FROM inventory_movements WHERE id=9999').get().product_id, 9101)
    assert.equal(linked.db.prepare('SELECT is_active FROM products WHERE id=9102').get().is_active, 1)
    assert.equal(linked.db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge'").get().n, 0)
  }

  // Inject a failure at the final statement of the second pair's real SQLite
  // transaction. Pair one stays durable; every graph/stock/receipt/history
  // statement for pair two rolls back and its remaining count is unknown.
  {
    const failed = seed()
    const { app: failureApp, controls } = loadRoute(failed)
    const failurePreview = await call(failureApp, '/possible-duplicates/merge-batch/preview', previewBody)
    const failureApply = {
      client_request_id: 'selected_merge_rollback_001', manifest_version: 1, manifest_digest: failurePreview.body.manifest_digest,
      cases: failurePreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: item.needs_stock_choice ? 'merge' : null,
      })),
    }
    let pairBatch = 0
    controls.beforeBatch = async (statements) => {
      if (!statements.some(({ sql }) => /selected_conflict_receipt_guard/.test(sql))) return
      pairBatch += 1
      if (pairBatch !== 2) return
      failed.db.exec(`CREATE TRIGGER inject_selected_merge_failure BEFORE INSERT ON audit_logs
        WHEN NEW.action='merge_duplicate' AND NEW.entity_id='9202'
        BEGIN SELECT RAISE(ABORT,'D1 DB is overloaded: injected pair failure'); END;`)
    }
    const result = await call(failureApp, '/possible-duplicates/merge-batch', failureApply)
    assert.equal(result.status, 200)
    assert.equal(result.body.interruptionCode, 'merge_infrastructure_interrupted')
    assert.equal(result.body.remainingCaseCount, null)
    assert.equal(result.body.maxAdditionalRequests, null)
    assert.deepEqual(result.body.processedCaseKeys, ['barcode:1111'])
    assert.deepEqual(result.body.pendingCaseKeys, ['barcode:2222'])
    assert.equal(failed.db.prepare('SELECT is_active FROM products WHERE id=9102').get().is_active, 0)
    assert.equal(failed.db.prepare('SELECT is_active FROM products WHERE id=9202').get().is_active, 1)
    assert.equal(failed.db.prepare("SELECT COUNT(*) n FROM product_conflict_merge_run_cases WHERE status='undo_ready'").get().n, 1)
    assert.equal(failed.db.prepare("SELECT COUNT(*) n FROM product_conflict_merge_run_cases WHERE status='planned'").get().n, 1)
    assert.equal(failed.db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge'").get().n, 1)
    assert.equal(failed.db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='product'").get().n, 1)
    assert.equal(failed.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 1)
  }

  // A post-commit finalizer failure leaves the first pair visibly committed
  // and stops pair two. An exact retry finalizes the same operation and then
  // continues; it never folds the first pair a second time.
  {
    const pending = seed()
    const { app: pendingApp, controls } = loadRoute(pending)
    const pendingPreview = await call(pendingApp, '/possible-duplicates/merge-batch/preview', previewBody)
    const pendingApply = {
      client_request_id: 'selected_merge_history_001', manifest_version: 1, manifest_digest: pendingPreview.body.manifest_digest,
      cases: pendingPreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: item.needs_stock_choice ? 'merge' : null,
      })),
    }
    controls.failNextHistoryFinalize = 1
    const interrupted = await call(pendingApp, '/possible-duplicates/merge-batch', pendingApply)
    assert.equal(interrupted.status, 200)
    assert.equal(interrupted.body.complete, false)
    assert.equal(interrupted.body.interruptionCode, 'merge_history_pending')
    assert.equal(interrupted.body.committedCases.length, 1)
    assert.equal(interrupted.body.committedCases[0].undoReady, false)
    assert.deepEqual(interrupted.body.pendingCaseKeys, ['barcode:2222'])
    assert.equal(pending.db.prepare('SELECT quantity FROM branch_stock WHERE product_id=9101 AND branch_id=901').get().quantity, 7)
    const recovered = await call(pendingApp, '/possible-duplicates/merge-batch', pendingApply)
    assert.equal(recovered.status, 200)
    assert.equal(recovered.body.complete, true)
    assert.equal(recovered.body.committedCases.length, 2)
    assert.ok(recovered.body.committedCases.every((item) => item.undoReady))
    assert.equal(pending.db.prepare('SELECT quantity FROM branch_stock WHERE product_id=9101 AND branch_id=901').get().quantity, 7, 'retry does not repeat the committed stock move')
    assert.equal(pending.db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge'").get().n, 2)
    assert.equal(pending.db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='product'").get().n, 2)
    assert.equal(pending.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='merge_duplicate'").get().n, 2)
  }

  // The complete request accounting includes initial verification, receipts,
  // fold batches, history finalization, and response reconciliation. A large
  // valid manifest continues under one request id without any call exceeding
  // the 700-statement ceiling.
  {
    const { d1: budget, cases } = seedManyPairs()
    const { app: budgetApp, controls } = loadRoute(budget)
    const budgetPreview = await call(budgetApp, '/possible-duplicates/merge-batch/preview', { cases })
    const budgetApply = {
      client_request_id: 'selected_merge_budget_001', manifest_version: 1, manifest_digest: budgetPreview.body.manifest_digest,
      cases: budgetPreview.body.cases.map((item, ordinal) => ({
        ordinal, case_key: item.case_key, keep_id: item.keep_id, merge_id: item.merge_id,
        state_digest: item.state_digest, stock: null,
      })),
    }
    let result
    let requests = 0
    do {
      controls.statementCount = 0
      result = await call(budgetApp, '/possible-duplicates/merge-batch', budgetApply)
      requests += 1
      assert.ok(controls.statementCount <= 700, `request ${requests} used ${controls.statementCount} statements`)
      assert.ok(requests <= 12, 'continuation bound remains finite')
    } while (!result.body.complete)
    assert.equal(result.body.committedCases.length, 12)
    assert.equal(budget.db.prepare("SELECT COUNT(*) n FROM action_history WHERE entity='product'").get().n, 12)
  }

  console.log('test-product-conflict-merge-batch-sqlite: all checks passed')
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
