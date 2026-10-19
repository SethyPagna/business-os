'use strict'
const assert = require('node:assert/strict')
const { world } = require('./test-al-stock-b-native.cjs')
const { executeRawStockTransaction } = require('../src/lib/stockTransaction.ts')
async function run(revoke) {
  const h = await world({ plan: 'paid' })
  try {
    const grants = { import: true, products: true, 'products:import': true,
      'products:import_replace_all': true, destructive_delete: true, product_cost_edit: true, product_cost_view: true }
    await h.addUser(920, 'j_executor', grants)
    await h.addSession('executor', 920)
    await executeRawStockTransaction(h.db, [
      h.db.prepare("INSERT INTO products(id,name,barcode,stock_quantity,cost_price_usd,is_active,updated_at) VALUES(9401,'J kept','J-KEPT',0,1,1,'2000-01-01')"),
      h.db.prepare("INSERT INTO products(id,name,barcode,stock_quantity,cost_price_usd,is_active,updated_at) VALUES(9402,'J omitted','J-OMITTED',0,1,1,'2000-01-01')"),
    ])
    const call = (method, url, body) => h.api(method, url, body, { as: 'executor' })
    const created = await call('POST', '/api/import-jobs', { type: 'products', policy: { import_mode: 'replace_all' } })
    assert.equal(created.status, 200, JSON.stringify(created.body))
    const id = created.body.job.id
    const upload = await h.multipart('/api/import-jobs/' + id + '/csv', 'file', 'j.csv',
      'name,barcode,description\nJ kept,J-KEPT,Updated\n', { as: 'executor' })
    assert.equal(upload.status, 200, JSON.stringify(upload.body))
    const start = await call('POST', '/api/import-jobs/' + id + '/start')
    assert.equal(start.status, 200, JSON.stringify(start.body))
    const review = await call('GET', '/api/import-jobs/' + id + '/review?pageSize=200')
    assert.equal(review.status, 200, JSON.stringify(review.body))
    console.log(JSON.stringify({ phase: 'analyzed', revoke, actions: review.body.rows?.map(row => row.action) }))
    const executor = await h.q1('SELECT updated_at FROM users WHERE id=920')
    if (revoke) await h.control('hooks', { hooks: [{
      pattern: 'UPDATE products SET is_active=0,updated_at=CURRENT_TIMESTAMP',
      request: h.hookRequest('PUT', '/api/users/920', {
        username: 'j_executor', name: 'j_executor', role_id: null,
        permissions: { ...grants, destructive_delete: false }, expected_updated_at: executor.updated_at,
      }),
    }] })
    const approved = await call('POST', '/api/import-jobs/' + id + '/approve', {})
    const hooks = await h.controlGet('hooks/result')
    const omitted = await h.q1('SELECT is_active FROM products WHERE id=9402')
    const job = await h.q1('SELECT status,phase,last_error,policy_json FROM import_jobs WHERE id=?', id)
    assert.equal(JSON.parse(job.policy_json).apply_authorized_by_id, 920, 'persisted executor must be fixture nonadmin')
    const user = await h.q1('SELECT permissions FROM users WHERE id=920')
    const audit = await h.q1("SELECT COUNT(*) AS n FROM audit_logs WHERE entity='product' AND entity_id=9402 AND json_extract(details,'$.source')='replace_all'")
    console.log(JSON.stringify({ phase: 'final', revoke, approved: approved.status,
      d1: approved.d1, hooks, omitted, job: { status: job.status, phase: job.phase, error: job.last_error }, audit,
      destructiveGrant: JSON.parse(user.permissions).destructive_delete }))
    if (revoke) {
      assert.equal(hooks.length, 1)
      assert.equal(hooks[0].fired, true, 'hook must reach finalizer after invocation authority check')
      assert.equal(hooks[0].result.status, 200, hooks[0].result.body)
      assert.equal(JSON.parse(user.permissions).destructive_delete, false)
      assert.equal(omitted.is_active, 1, 'commit must refuse a late-revoked executor')
      assert.equal(audit.n, 0, 'refused finalization cannot leave a deletion audit')
      assert.notEqual(job.status, 'completed')
      assert.equal(approved.status, 409)
      assert.equal(approved.body.code, 'import_apply_permission_revoked')
      assert.equal(approved.body.success, false)
    } else {
      assert.equal(approved.status, 200)
      assert.equal(job.status, 'completed')
      assert.equal(omitted.is_active, 0, 'authorized control must really finalize replacement')
      assert.equal(audit.n, 1)
    }
  } finally { await h.dispose() }
}
async function main() {
  await run(false)
  console.log('PASS unchanged-authority control')
  await run(true)
  console.log('PASS late-revocation finalizer')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
