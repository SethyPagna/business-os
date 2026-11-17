'use strict'
// Shared world builder for the merge undo / redo tests that drive the REAL routes (preview, finalize, apply) and the REAL undo applier on
// node:sqlite: a keeper (10000) with lot 99001 and up to two duplicates (10001 lot 99002, 10002 lot 99003).
//   through: the last migration the schema is built with (310 = the production schema before the deploy: no 0311, 0312, 0313, 0315).
//   legacyWriters: the pre-0311 code never wrote product_batches.merge_deactivated_at; this strips that one assignment from every statement, so the
//     real fold / undo code records receipts exactly as the old build did on a schema without the column. Turn it off when the migrations are applied.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { openDb } = require('./d1compat.cjs')
const { loadAll } = require('./load_migrations.cjs')
const { seedStockFixture } = require('./seed-stock-fixture.cjs')
const { loadRoute, post } = require('../test-product-conflict-action-groups-sqlite.cjs')

const user = { id: 900, username: 'reviewer' }
const migrationText = (file) => fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', file), 'utf8')
// The deploy's migrations, in order (0314 does not exist).
const DEPLOY_MIGRATIONS = ['0311_product_batches_merge_deactivated_at.sql', '0312_catalog_cost_fallback_rounding.sql', '0313_cost_4dp_repair.sql', '0315_sale_return_line_batch_index.sql']
const applyDeployMigrations = (d1, files = DEPLOY_MIGRATIONS) => { for (const file of files) d1.db.exec(migrationText(file)) }

const stripMarker = (sql) => sql.replace(/merge_deactivated_at = (?:CURRENT_TIMESTAMP|NULL), /g, '')
function legacyWriters(d1, on) {
  if (on) {
    if (d1.__plain) return
    d1.__plain = { prepare: d1.prepare, batch: d1.batch }
    d1.prepare = function (sql) { return d1.__plain.prepare.call(d1, stripMarker(sql)) }
    d1.batch = function (items) { return d1.__plain.batch.call(d1, items.map((item) => ({ ...item, sql: stripMarker(item.sql) }))) }
  } else if (d1.__plain) {
    d1.prepare = d1.__plain.prepare; d1.batch = d1.__plain.batch; delete d1.__plain
  }
}

const rows = (db, sql, ...args) => db.prepare(sql).all(...args).map((r) => ({ ...r }))
const NEW_PRODUCT = (id, name, barcode, qty, cost) => `
  INSERT INTO products (id,name,name_key,barcode,category,brand,unit,is_active,is_group,stock_quantity,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,wholesale_price_usd,wholesale_price_khr,updated_at)
    VALUES (${id},'${name}','${name.toLowerCase()}','${barcode}','C','Three','pack',1,0,${qty},${cost},0,10,0,9,0,'2026-09-08 01:00:00');
  INSERT INTO branch_stock (product_id,branch_id,quantity) VALUES (${id},1,${qty});`

/**
 * lots: [{ qty, cost, date }] for keeper, duplicate A, duplicate B (B optional). Extra SQL may follow in `extra`.
 */
function seedWorld({ through, lots, extra = '' }) {
  const d1 = openDb(loadAll(through == null ? {} : { through }))
  d1.db.prepare("INSERT INTO branches(id,name,is_active) VALUES(1,'Shop',1),(2,'Warehouse',1)").run()
  const ids = [10000, 10001, 10002].slice(0, lots.length)
  const lotIds = [99001, 99002, 99003]
  let sql = ''
  ids.forEach((id, i) => {
    const { qty, cost } = lots[i]
    sql += NEW_PRODUCT(id, i === 0 ? 'Keeper' : i === 1 ? 'Alternate A' : 'Third B', ['0700000', '700000', '000700000'][i], qty, cost)
    sql += `
      INSERT INTO product_batches (id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,notes,batch_number,supplier_id,supplier_name,unit_cost_usd,payment_status,credit_due_date,received_quantity,received_branch_id,received_cost_usd)
        VALUES (${lotIds[i]},${id},'receipt-${i}','LOT-${i}','2027-0${i + 1}-01','${lots[i].date}',1,'receipt ${i}',1,${41 + i},'Supplier ${i}',${cost},'paid',NULL,${qty},1,${qty * cost});
      INSERT INTO branch_batch_stock (batch_id,branch_id,quantity) VALUES (${lotIds[i]},1,${qty});`
  })
  seedStockFixture(d1.db, () => d1.db.exec(sql + extra))
  return { d1, ids, lotIds }
}

let counter = 0
async function applyGroup(d1, f, memberIds, label) {
  counter += 1
  const groups = [{ group_key: 'barcode:700000', member_ids: memberIds }]
  const preview = await post(f.app, { manifest_version: 1, resolution_version: 2, client_request_id: `merge_world_${label.replace(/[^A-Za-z0-9]+/g, "_")}_${counter}`, merge_groups: groups, remove_rows: [] })
  assert.equal(preview.status, 200, `${label}: preview ${JSON.stringify(preview.body).slice(0, 300)}`)
  const review = preview.body
  const final = await f.app.posts.get('/possible-duplicates/merge-batch/reviews/:reviewId/finalize')({ env: {}, get: () => user, req: { param: () => review.review_id, json: async () => ({
    manifest_version: 1, resolution_version: 2, review_id: review.review_id, draft_digest: review.draft_digest,
    resolutions: [{ group_key: groups[0].group_key, keeper_id: 10000, barcode: { mode: 'canonical' }, category_source_id: 10000, brand_source_id: 10000, unit_source_id: 10000 }] }) },
    json: (body, status = 200) => ({ body, status }) })
  assert.equal(final.status, 200, `${label}: finalize ${JSON.stringify(final.body).slice(0, 300)}`)
  const projected = JSON.parse(d1.db.prepare('SELECT final_plan_json FROM product_conflict_action_groups LIMIT 1').get().final_plan_json).projected_result
  let applied
  for (let i = 0; i < 6; i += 1) {
    applied = await f.app.posts.get('/possible-duplicates/merge-batch')({ env: {}, get: () => user, executionCtx: { waitUntil() {} },
      req: { json: async () => ({ review_id: review.review_id, manifest_digest: final.body.manifest_digest, client_request_id: review.review_id }) }, json: (body, status = 200) => ({ body, status }) })
    if (applied.body.status === 'completed') break
  }
  assert.equal(applied.body.status, 'completed', `${label}: apply ${JSON.stringify(applied.body).slice(0, 300)}`)
  return { review, final, projected }
}

const groupHistory = (d1) => d1.db.prepare("SELECT id, undo_payload, redo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge.group'").get()
async function groupStep(f, d1, direction) {
  const h = groupHistory(d1)
  const p = JSON.parse(direction === 'undo' ? h.undo_payload : h.redo_payload)
  const generation = Number(d1.db.prepare('SELECT reversal_generation g FROM product_conflict_action_groups').get().g)
  try {
    const out = await f.undo.resolveUndoApplier(p).run(p, { env: {}, user, direction, historyId: h.id, generation })
    return { ok: true, complete: out.complete }
  } catch (error) { return { ok: false, code: error.code, status: error.statusCode, message: String(error.message).slice(0, 200) } }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
/** Every request of one direction until complete or refused; `gapMs` of wall clock passes before each request (CURRENT_TIMESTAMP has 1 s resolution). */
async function groupAll(f, d1, direction, gapMs = 0) {
  const steps = []
  for (let i = 0; i < 6; i += 1) {
    if (gapMs) await sleep(gapMs)
    const r = await groupStep(f, d1, direction)
    steps.push(r)
    if (!r.ok || r.complete) break
  }
  return steps
}
async function singleStep(f, d1, direction) {
  const h = d1.db.prepare("SELECT id, undo_payload, redo_payload FROM action_history WHERE json_extract(undo_payload,'$.applier')='product.merge'").get()
  const p = JSON.parse(direction === 'undo' ? h.undo_payload : h.redo_payload)
  try {
    const out = await f.undo.resolveUndoApplier(p).run(p, { env: {}, user, direction, historyId: h.id, generation: Number(p.generation ?? 0) })
    return { ok: true, complete: out.complete !== false }
  } catch (error) { return { ok: false, code: error.code, status: error.statusCode, message: String(error.message).slice(0, 200) } }
}

// Business state (no timestamps): what undo must give back exactly.
const businessState = (db, { marker = true } = {}) => JSON.stringify({
  products: rows(db, 'SELECT id,is_active,stock_quantity,cost_price_usd,purchase_price_usd,cost_price_khr,purchase_price_khr FROM products WHERE id IN (10000,10001,10002) ORDER BY id'),
  lots: rows(db, `SELECT id,variant_product_id,batch_key,batch_number,is_active,unit_cost_usd,received_cost_usd,expiry_date,received_at,${marker ? (hasMarker(db) ? 'merge_deactivated_at IS NOT NULL AS marked' : '0 AS marked') : '0 AS marked'} FROM product_batches ORDER BY id`),
  bbs: rows(db, 'SELECT batch_id,branch_id,quantity FROM branch_batch_stock ORDER BY batch_id,branch_id'),
  bs: rows(db, 'SELECT product_id,branch_id,quantity FROM branch_stock ORDER BY product_id,branch_id'),
})
const hasMarker = (db) => rows(db, "SELECT name FROM pragma_table_info('product_batches') WHERE name='merge_deactivated_at'").length === 1
const lotStamp = (db, id) => db.prepare('SELECT updated_at FROM product_batches WHERE id=?').get(id).updated_at

module.exports = { user, DEPLOY_MIGRATIONS, migrationText, applyDeployMigrations, legacyWriters, seedWorld, applyGroup, groupHistory, groupStep, groupAll, singleStep, sleep, businessState, lotStamp, rows, loadRoute, seedStockFixture, hasMarker }
