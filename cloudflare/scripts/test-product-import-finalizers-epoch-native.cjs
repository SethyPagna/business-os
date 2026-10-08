const assert = require('node:assert/strict')
const { bundleWorker, world, scenario } = require('./test-generic-import-invocation-budget-epoch-native.cjs')

async function finalizers(make, { tier = 'free', groups = 3, fault, inline = false }) {
  const f = await world(make, tier, { seed(sql) {
    for (let id = 2; id <= groups; id++) sql.prepare(`INSERT INTO products
      (id,name,barcode,cost_price_usd,stock_quantity,is_active,updated_at) VALUES(?,?,?,2,0,1,CURRENT_TIMESTAMP)`)
      .run(id, 'Product ' + id, 'SER-' + id)
    if (fault === 'deactivateAck' || fault === 'omitted') sql.prepare(`INSERT INTO products
      (id,name,barcode,cost_price_usd,stock_quantity,is_active,updated_at) VALUES(99,'Omitted','OMITTED',2,?,1,'2000-01-01')`)
      .run(fault === 'omitted' ? 1 : 0)
  } })
  const cap = tier === 'free' ? 50 : 1000, id = `finalizer-${tier}-${groups}-${fault || 'normal'}-${inline}`
  const pending = [], tasks = [], ctx = { waitUntil(p) { tasks.push(p) }, passThroughOnException() {} }
  f.env.ASSETS = { list: async () => ({ objects: [], truncated: false }), delete: async () => {} }
  if (!inline) f.env.IMPORT_QUEUE = { send: async body => pending.push({ body, attempts: 1 }) }
  const rows = Array.from({ length: groups * 2 }, (_, i) => ({ _rowNumber: i + 2,
    barcode: 'SER-' + (Math.floor(i / 2) + 1), name: i < 2 ? 'Serum' : 'Product ' + (Math.floor(i / 2) + 1),
    quantity: '1', branch: 'Shop', unit_cost_usd: '2', date: '2026-09-05', description: 'finalizer proof' }))
  f.sql.prepare(`INSERT INTO import_jobs(id,type,status,policy_json,materialize_done)
    VALUES(?,'products','awaiting_review',?,1)`).run(id, JSON.stringify({ import_mode: 'replace_all' }))
  for (let i = 0; i < rows.length; i++) f.sql.prepare(`INSERT INTO import_job_source_rows
    (job_id,sequence,row_number,data_json) VALUES(?,?,?,?)`).run(id, i, i + 2, JSON.stringify(rows[i]))
  const analyzed = await f.worker.classifyProducts(f.worker.getDb(f.env), rows, id, JSON.stringify({ import_mode: 'replace_all' }))
  assert.ok(analyzed.every(x => x.action === 'create' || x.action === 'update'))
  for (const r of analyzed) f.sql.prepare(`INSERT INTO import_job_rows
    (job_id,phase,row_number,action,identifier,result_json) VALUES(?,'analyze',?,?,?,?)`)
    .run(id, r.rowNumber, r.action, r.identifier, JSON.stringify(r))
  const job = () => f.sql.prepare('SELECT * FROM import_jobs WHERE id=?').get(id)
  const progress = () => JSON.parse(job().chunk_state_json || '{}').genericApply?.finalize
  const quantity = () => f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity
  let baseline = f.measured(), max = 0, injected = false, removed = false, beforeRollback, effectsBefore
  const measure = phase => {
    const now = f.measured(), physical = now.physical - baseline.physical, metered = now.metered - baseline.metered
    baseline = now; max = Math.max(max, physical)
    assert.equal(physical, metered, 'actual invocation attempts include every raw and wrapped D1 call')
    assert.ok(physical <= cap, `${phase}: ${physical}>${cap}`)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    if (progress()) assert.equal(job().processed_rows, rows.length, 'actual inline retry preserves committed source counters before terminal recomputation')
    console.log(JSON.stringify({ tier, groups, fault, inline, phase, attempts: physical,
      status: job().status, cursor: job().chunk_cursor, finalize: progress() }))
  }
  async function http(url, body) {
    const response = await f.worker.default.fetch(new Request('https://admin.business.test' + url, {
      method: 'POST', headers: { cookie: 'bos_session=branch-auth-cookie', origin: 'https://admin.business.test',
        'content-type': 'application/json' }, body: JSON.stringify(body) }), f.env, ctx)
    while (tasks.length) await Promise.all(tasks.splice(0))
    measure(url); return { status: response.status, body: await response.json() }
  }
  const raw = f.env.DB
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'batch') return async statements => {
      const p = progress()
      const finalStock = (p?.phase === 'reconcile' && p.pendingHash || p?.phase === 'replace' && fault === 'deactivateAck')
        && statements.some(s => s.text.includes("VALUES ('stock_transaction_permit'"))
      if (!injected && finalStock && ['ack', 'deactivateAck', 'rollback', 'holder', 'cancel', 'costrace', 'identityrace'].includes(fault)) {
        injected = true; effectsBefore = quantity(); beforeRollback = JSON.stringify(progress())
        if (fault === 'ack' || fault === 'deactivateAck') { await target.batch(statements); throw Error('synthetic finalizer lost acknowledgement') }
        if (fault === 'holder') f.sql.prepare('UPDATE import_jobs SET lease_token=? WHERE id=?').run('foreign-holder', id)
        if (fault === 'cancel') f.sql.prepare('UPDATE import_jobs SET cancel_requested=1 WHERE id=?').run(id)
        if (fault === 'costrace' || fault === 'identityrace') {
          const batch = f.sql.prepare('SELECT id,unit_cost_usd FROM product_batches WHERE variant_product_id=1 ORDER BY id LIMIT 1').get()
          if (fault === 'costrace') assert.equal(batch.unit_cost_usd, null, 'NULL to zero is a discriminating cost identity change')
          await f.worker.executeStockTransaction(f.worker.getDb(f.env), [{
            sql: fault === 'costrace' ? 'UPDATE product_batches SET unit_cost_usd=0 WHERE id=@id'
              : "UPDATE product_batches SET batch_key=batch_key||':changed' WHERE id=@id",
            params: { id: batch.id },
          }], 'once')
        }
        if (fault === 'rollback') statements = statements.map(s => s.text.includes("SET chunk_state_json=json_set")
          ? target.prepare("SELECT json_extract('[1]','$[late_finalizer_fault]')") : s)
      }
      return target.batch(statements)
    }
    return target[key]
  } })
  assert.equal((await http(`/api/import-jobs/${id}/approve`, {})).status, 200)
  for (let delivery = 0; !['completed', 'completed_with_errors', 'cancelled'].includes(job().status); delivery++) {
    assert.ok(delivery < 100, 'valid finalizer must advance through persisted phases')
    const p = progress()
    if (fault === 'interleave' && !removed && p?.reconciled >= 1) {
      const r = await http('/api/inventory/adjust', { client_request_id: 'finalizer-removal-proof', productId: 1,
        branchId: 1, type: 'remove', quantity: 1, reason: 'Concurrent counted removal' })
      assert.equal(r.status, 200, JSON.stringify(r)); assert.equal(quantity(), 1); removed = true
    }
    if (fault === 'digest' && !injected && p?.phase === 'reconcile' && p.pendingHash) {
      // Metadata-only label is a real lot identity/preimage change; no guard is bypassed.
      const batch = f.sql.prepare('SELECT id FROM product_batches WHERE variant_product_id=1 ORDER BY id LIMIT 1').get()
      f.sql.prepare('UPDATE product_batches SET received_branch_name=? WHERE id=?').run('Changed provenance label', batch.id)
      injected = true; effectsBefore = quantity(); beforeRollback = JSON.stringify(progress())
    }
    if (inline) assert.equal((await http(`/api/import-jobs/${id}/retry`, {})).status, 200)
    else {
      const message = pending.shift(); assert.ok(message, 'persisted continuation exists')
      await f.worker.default.queue({ queue: 'business-os-import', messages: [{ ...message, timestamp: new Date(),
        ack() {}, retry() { pending.push({ ...message, attempts: message.attempts + 1 }) } }] }, f.env)
      measure('queue-' + delivery)
    }
    if (injected && fault === 'holder') {
      assert.equal(quantity(), effectsBefore); assert.equal(JSON.stringify(progress()), beforeRollback)
      assert.equal(job().lease_token, 'foreign-holder'); return
    }
    if (fault === 'omitted' && job().status === 'failed') {
      assert.equal(f.sql.prepare('SELECT is_active,stock_quantity FROM products WHERE id=99').get().is_active, 1)
      assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=99').get().stock_quantity, 1)
      assert.equal(progress().phase, 'replace'); assert.match(job().last_error, /product_has_stock/)
      assert.equal(job().processed_rows, rows.length); return
    }
    if (injected && ['digest', 'costrace', 'identityrace'].includes(fault)) {
      assert.equal(quantity(), effectsBefore); assert.equal(JSON.stringify(progress()), beforeRollback)
      assert.equal(job().status, 'failed'); assert.match(job().last_error, /product_import_finalization_changed/)
      if (delivery > 12) return
    }
    if (injected && fault === 'rollback' && JSON.stringify(progress()) === beforeRollback) assert.equal(quantity(), effectsBefore)
    if (job().status !== 'cancelled') assert.equal(job().lease_token, null)
  }
  if (fault) assert.ok(injected || removed, 'requested schedule actually executed')
  if (fault === 'cancel') { assert.equal(quantity(), effectsBefore); return }
  assert.equal(quantity(), removed ? 1 : 2)
  assert.equal(job().processed_rows, rows.length)
  assert.equal(progress().phase, 'done'); assert.equal(progress().reconciled, groups)
  assert.equal(JSON.parse(job().summary_json).snapshotGroupsAggregated, groups)
  if (fault === 'deactivateAck') {
    assert.equal(progress().deactivated, 1); assert.equal(JSON.parse(job().summary_json).deactivated, 1)
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM audit_logs WHERE entity='product' AND entity_id=99 AND action='delete'").get().n, 1)
  }
  assert.ok(job().chunk_state_json.length < 1024, 'fixed cursors/counters/digest, not serialized catalog or plans')
  if (removed) assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='remove' AND quantity=1").get().n, 1)
  console.log(`FINALIZER PASS ${tier}/${groups}/${fault || 'normal'}/${inline} max=${max}`)
}
async function main() {
  const saved = globalThis.fetch; globalThis.fetch = async () => new Response('{"ok":true}')
  try {
    const make = await bundleWorker()
    for (const tier of ['free', 'paid']) {
      for (const groups of [2, 3, 4]) await finalizers(make, { tier, groups })
      for (const fault of ['interleave', 'ack', 'deactivateAck', 'omitted', 'rollback', 'holder', 'cancel', 'digest', 'costrace', 'identityrace']) await finalizers(make, { tier, fault })
      await finalizers(make, { tier, inline: true })
    }
    // Original three-row admission completes after adaptive window reduction.
    await scenario(make, { tier: 'free', n: 3, type: 'products', productMode: 'replace_all' })
    console.log('product finalizer actual invocation proof PASS 29 schedules')
  } finally { globalThis.fetch = saved }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
