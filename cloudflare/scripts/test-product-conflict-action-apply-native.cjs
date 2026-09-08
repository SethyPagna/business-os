const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Miniflare } = require('miniflare')
const { loadRoute } = require('./test-product-conflict-action-groups-native.cjs')

const user = { id: 77, username: 'native' }

function reset(controls) {
  Object.assign(controls, { statements: 0, maxBindings: 0, maxCompoundTerms: 0, maxBatchStatements: 0 })
}

function assertBounds(controls, label) {
  assert.ok(controls.statements <= 700, `${label} used ${controls.statements} statements`)
  assert.ok(controls.maxBindings <= 100, `${label} used ${controls.maxBindings} bindings`)
  assert.ok(controls.maxCompoundTerms <= 5, `${label} used ${controls.maxCompoundTerms} compound terms`)
  assert.ok(controls.maxBatchStatements <= 100, `${label} batch used ${controls.maxBatchStatements} statements`)
  return { statements: controls.statements, maxBindings: controls.maxBindings,
    maxCompoundTerms: controls.maxCompoundTerms, maxBatchStatements: controls.maxBatchStatements }
}

function migrationStatements(source) {
  const statements = []
  let buffer = []
  let trigger = false
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\s+--.*$/, '').trim()
    if (!line || line.startsWith('--')) continue
    if (!buffer.length) trigger = /^CREATE\s+TRIGGER\b/i.test(line)
    buffer.push(line)
    if ((trigger && /^END;$/i.test(line)) || (!trigger && /;$/.test(line))) {
      statements.push(buffer.join(' '))
      buffer = []
      trigger = false
    }
  }
  if (buffer.length) statements.push(buffer.join(' '))
  return statements
}

async function main() {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-08-01', d1Databases: ['DB'] })
  try {
    const native = await mf.getD1Database('DB')
    const migrationDir = path.join(__dirname, '..', 'migrations')
    for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort()) {
      for (const sql of migrationStatements(fs.readFileSync(path.join(migrationDir, file), 'utf8'))) {
        try { await native.prepare(sql).run() }
        catch (error) {
          if (/too many terms in compound SELECT/i.test(String(error)) && /^INSERT\b/i.test(sql)) continue
          throw new Error(`${file}: ${sql.slice(0, 160)} :: ${error}`)
        }
      }
    }
    await native.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1)").run()
    for (const [id, name, barcode, category, brand, unit, stock, cost, retail, wholesale] of [
      [4101, 'Native keeper', '000880001', 'A', 'One', 'pcs', 2, 4, 8, 7],
      [4102, 'Native member 1', '0880001', 'B', 'Two', 'box', 3, 6, 9, 8],
      [4103, 'Native member 2', '880001', 'C', 'Three', 'pack', 4, 8, 10, 9],
    ]) {
      await native.prepare(`INSERT INTO products(id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,
        cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
        VALUES(?,?,?,?,?,?,?,1,0,?,?,0,?,0,?,0,'2026-09-08 01:00:00')`)
        .bind(id, name, name.toLowerCase(), barcode, category, brand, unit, stock, cost, retail, wholesale).run()
      await native.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, 1, stock).run()
    }
    const { app, controls, db } = loadRoute(native, true)
    const group = { group_key: 'barcode:880001', member_ids: [4101, 4102, 4103] }
    const preview = await app.posts.get('/possible-duplicates/merge-batch/preview')({
      env: {}, get: () => user, executionCtx: { waitUntil: () => {} },
      req: { json: async () => ({ manifest_version: 1, resolution_version: 2, client_request_id: 'native_apply_001', merge_groups: [group], remove_rows: [] }) },
      json: (body, status = 200) => ({ body, status }),
    })
    assert.equal(preview.status, 200)
    reset(controls)
    const finalized = await app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({
      env: {}, get: () => user,
      req: { param: () => preview.body.review_id, json: async () => ({
        manifest_version: 1, resolution_version: 2, review_id: preview.body.review_id, draft_digest: preview.body.draft_digest,
        resolutions: [{ group_key: group.group_key, keeper_id: 4101, barcode: { mode: 'member', source_product_id: 4102 },
          category_source_id: 4103, brand_source_id: 4102, unit_source_id: 4103 }],
      }) },
      json: (body, status = 200) => ({ body, status }),
    })
    assert.equal(finalized.status, 200)
    const finalizeBounds = assertBounds(controls, 'native finalize')
    const applyBody = { review_id: preview.body.review_id, manifest_digest: finalized.body.manifest_digest, client_request_id: preview.body.review_id }
    const callApply = async () => app.posts.get('/possible-duplicates/merge-batch')({
      env: {}, get: () => user, executionCtx: { waitUntil: () => {} }, req: { json: async () => applyBody },
      json: (body, status = 200) => ({ body, status }),
    })
    reset(controls)
    const first = await callApply()
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(first.body.continuation_required, true)
    const firstBounds = assertBounds(controls, 'native apply first fold')
    reset(controls)
    const second = await callApply()
    assert.equal(second.status, 200, JSON.stringify(second.body))
    assert.equal(second.body.status, 'completed')
    assert.equal(second.body.continuation_required, false)
    const secondBounds = assertBounds(controls, 'native apply second fold')
    const keeper = await db.prepare(`SELECT barcode,category,brand,unit,stock_quantity,cost_price_usd,selling_price_usd,wholesale_price_usd
      FROM products WHERE id=4101`).get()
    assert.deepEqual({ ...keeper }, { barcode: '880001', category: 'C', brand: 'Two', unit: 'pack', stock_quantity: 9,
      cost_price_usd: 6, selling_price_usd: 10, wholesale_price_usd: 9 })
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()).n, 1)
    assert.equal((await db.prepare("SELECT COUNT(*) n FROM undo_snapshots WHERE kind='product.merge.group.child' AND status='applied'").get()).n, 2)
    console.log('product conflict action apply native D1 passed ' + JSON.stringify({ finalizeBounds, firstBounds, secondBounds }))
  } finally { await mf.dispose() }
}

main().catch((error) => { console.error(error); process.exit(1) })
