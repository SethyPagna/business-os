const assert = require('node:assert/strict')
const path = require('node:path')
const root = process.env.DESTRUCTIVE_IMPORT_TEST_ROOT
const { bundleWorker, world } = require(root
  ? path.join(root, 'cloudflare/scripts/test-generic-import-invocation-budget-epoch-native.cjs')
  : './test-generic-import-invocation-budget-epoch-native.cjs')

const grants = { products: true, product_cost_view: true, product_cost_edit: true, destructive_delete: true }

async function fixture(make, tier, mode, faults = {}) {
  const f = await world(make, tier, { failAttempt(sql) { faults.failAttempt?.(sql) }, seed(sql) {
    sql.prepare("INSERT INTO products(id,name,barcode,stock_quantity,is_active,updated_at) VALUES(99,'Omitted','OMITTED',0,1,'2000-01-01')").run()
  } })
  f.sql.prepare("INSERT INTO roles(id,name,code,permissions,is_system) VALUES(99,'Importer','native-importer','{}',0)").run()
  f.sql.prepare('UPDATE users SET role_id=99,permissions=? WHERE id=7').run(JSON.stringify(grants))
  const pending = [], tasks = [], id = 'destructive-authority'
  let beforeCommit
  const rawDb = f.env.DB
  f.env.DB = new Proxy(rawDb, { get(target, key) {
    if (key === 'batch') return statements => {
      if (beforeCommit && statements.some(statement => /INSERT INTO import_stock_action_guards|UPDATE products SET/.test(statement.text))) {
        const callback = beforeCommit
        beforeCommit = undefined
        callback()
      }
      return target.batch(statements)
    }
    return target[key]
  } })
  f.env.ASSETS = { list: async () => ({ objects: [], truncated: false }), delete: async () => {} }
  f.env.IMPORT_QUEUE = { send: async body => pending.push({ body, attempts: 1 }) }
  const policy = { import_mode: mode, replace_columns: ['description'] }
  const rows = [{ _rowNumber: 2, barcode: 'SER-1', name: 'Serum', quantity: '10000',
    branch: 'Shop', unit_cost_usd: '2', date: '2026-09-05', description: 'authorized replacement' }]
  f.sql.prepare("INSERT INTO import_jobs(id,type,status,policy_json,materialize_done) VALUES(?,'products','awaiting_review',?,1)")
    .run(id, JSON.stringify(policy))
  f.sql.prepare('INSERT INTO import_job_source_rows(job_id,sequence,row_number,data_json) VALUES(?,0,2,?)')
    .run(id, JSON.stringify(rows[0]))
  const analyzed = await f.worker.classifyProducts(f.worker.getDb(f.env), rows, id, JSON.stringify(policy))
  assert.equal(analyzed[0].action, 'update')
  f.sql.prepare("INSERT INTO import_job_rows(job_id,phase,row_number,action,identifier,result_json) VALUES(?,'analyze',2,?,?,?)")
    .run(id, analyzed[0].action, analyzed[0].identifier, JSON.stringify(analyzed[0]))
  const job = () => f.sql.prepare('SELECT * FROM import_jobs WHERE id=?').get(id)
  const progress = () => JSON.parse(job().chunk_state_json || '{}').genericApply?.finalize
  const business = () => JSON.stringify(Object.fromEntries(['products', 'branch_stock', 'branch_batch_stock',
    'product_batches', 'product_cost_entries', 'inventory_movements', 'audit_logs', 'import_auto_merges',
    'file_assets'].map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
  let max = 0
  function measure(before, phase) {
    const after = f.measured(), physical = after.physical - before.physical, metered = after.metered - before.metered
    assert.equal(physical, metered, 'all physical adapter calls are metered')
    assert.ok(physical <= (tier === 'free' ? 50 : 1000), `${phase}: ${physical} physical calls`)
    max = Math.max(max, physical)
  }
  async function http(action, body = {}) {
    const before = f.measured()
    const response = await f.worker.default.fetch(new Request('https://admin.business.test/api/import-jobs' +
      (action === 'create' ? '' : `/${id}${action === 'read' ? '' : '/' + action}`), {
      method: action === 'read' ? 'GET' : 'POST',
      headers: { cookie: 'bos_session=branch-auth-cookie', origin: 'https://admin.business.test', 'content-type': 'application/json' },
      ...(action === 'read' ? {} : { body: JSON.stringify(body) }),
    }), f.env, { waitUntil(p) { tasks.push(p) }, passThroughOnException() {} })
    while (tasks.length) await Promise.all(tasks.splice(0))
    measure(before, action)
    return { status: response.status, body: await response.json() }
  }
  async function deliver() {
    const message = pending.shift()
    assert.ok(message, 'saved continuation exists')
    const before = f.measured()
    await f.worker.default.queue({ queue: 'business-os-import', messages: [{ ...message, timestamp: new Date(),
      ack() {}, retry() { pending.push({ ...message, attempts: message.attempts + 1 }) },
    }] }, f.env)
    measure(before, 'queue')
  }
  function revoke(permission) {
    f.sql.prepare('UPDATE users SET permissions=? WHERE id=7').run(JSON.stringify({ ...grants, [permission]: false }))
  }
  return { ...f, id, policy, pending, job, progress, business, http, deliver, revoke,
    beforeCommit(callback) { beforeCommit = callback }, max: () => max }
}

async function routeCase(make, tier, mode, permission, boundary) {
  const f = await fixture(make, tier, mode)
  if (boundary === 'retry') {
    f.sql.prepare("UPDATE import_jobs SET status='failed',phase='applying',chunk_state_json='{\"genericApply\":{\"window\":1}}',policy_json=json_set(policy_json,'$.apply_authorized_by_id',7) WHERE id=?").run(f.id)
  }
  f.revoke(permission)
  const before = f.business(), saved = JSON.stringify(f.job()), queued = f.pending.length
  const result = await f.http(boundary, { type: 'products', policy: f.policy })
  assert.equal(result.status, 403, JSON.stringify(result))
  assert.equal(result.body.permission, permission, JSON.stringify(result))
  assert.equal(f.business(), before, 'denied HTTP request has no business effects')
  assert.equal(JSON.stringify(f.job()), saved, 'denied request leaves saved policy and job unchanged')
  assert.equal(f.pending.length, queued, 'denied request cannot enqueue')
  assert.equal((await f.http('read')).status, 200, 'revocation does not hide the saved job')
  assert.equal((await f.http('cancel')).status, 200, 'revocation does not prevent cancellation')
  return f.max()
}

async function workerCase(make, tier, mode, permission, boundary) {
  const f = await fixture(make, tier, mode)
  assert.equal((await f.http('approve')).status, 200)
  if (boundary === 'finalize') {
    for (let n = 0; f.progress()?.phase !== 'replace' && n < 20; n++) await f.deliver()
    assert.equal(f.progress()?.phase, 'replace', 'reach a real saved finalization-only continuation')
  }
  f.revoke(permission)
  const before = f.business()
  await f.deliver()
  assert.equal(f.business(), before, 'revoked worker cannot change catalog, stock or audit')
  assert.equal(f.job().status, 'failed')
  assert.match(f.job().last_error, new RegExp(permission))
  assert.equal(f.job().lease_token, null)
  if (boundary === 'finalize') assert.equal((await f.http('retry')).status, 403)
  else {
    assert.equal((await f.http('retry')).status, 200, 'retry before any apply state restarts analysis only')
    assert.equal(f.pending.at(-1).body.kind, 'analyze')
  }
  return f.max()
}

async function allowedCase(make, tier, mode) {
  const f = await fixture(make, tier, mode)
  if (mode === 'merge' || mode === 'fill_blank') f.revoke('destructive_delete')
  assert.equal((await f.http('approve')).status, 200)
  for (let n = 0; !['completed', 'completed_with_errors', 'failed'].includes(f.job().status) && n < 25; n++) await f.deliver()
  assert.equal(f.job().status, 'completed', f.job().last_error)
  assert.equal(f.sql.prepare('SELECT description FROM products WHERE id=1').get().description, 'authorized replacement')
  assert.equal(f.sql.prepare('SELECT is_active FROM products WHERE id=99').get().is_active, mode === 'replace_all' ? 0 : 1)
  const before = f.business()
  f.pending.push({ body: { jobId: f.id, kind: 'apply' }, attempts: 2 })
  await f.deliver()
  assert.equal(f.business(), before, 'completed delivery cannot repeat business effects')
  return f.max()
}

async function raceCase(make, tier, mode, permission, boundary) {
  const f = await fixture(make, tier, mode)
  assert.equal((await f.http('approve')).status, 200)
  if (boundary === 'finalize') {
    for (let n = 0; f.progress()?.phase !== 'replace' && n < 20; n++) await f.deliver()
    assert.equal(f.progress()?.phase, 'replace')
  }
  const before = f.business()
  let raced = false
  f.beforeCommit(() => { raced = true; f.revoke(permission) })
  await f.deliver()
  assert.equal(raced, true, 'revocation occurs after actor read and just before the real transaction')
  assert.equal(f.business(), before, 'same-batch authority guard rolls back all business effects')
  assert.equal(f.job().status, 'failed')
  assert.match(f.job().last_error, /authority changed/)
  assert.equal(f.job().lease_token, null)
  assert.equal(f.pending.length, 0, 'permanent refusal is acknowledged, not automatically retried')
  return f.max()
}

async function imageRenameCase(make, mode, permission) {
  const f = await fixture(make, 'paid', mode)
  f.sql.prepare("INSERT INTO file_assets(id,original_name,stored_name,public_path) VALUES(101,'raw-original.jpg','raw.jpg','/uploads/raw.jpg')").run()
  f.sql.prepare("INSERT INTO import_job_files(id,job_id,kind,original_name,stored_path,file_asset_id) VALUES(101,?,'image','raw-original.jpg','raw.jpg',101)").run(f.id)
  f.sql.prepare("UPDATE import_jobs SET policy_json=json_set(policy_json,'$.wire_images',json('true'),'$.imageOverrides',json('{\"101\":2}')) WHERE id=?").run(f.id)
  assert.equal((await f.http('approve')).status, 200)
  const before = f.business()
  const raw = f.env.DB
  let fired = false
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'batch') return statements => {
      if (!fired && statements.some(statement => statement.text.includes('UPDATE file_assets SET original_name'))) {
        fired = true
        if (permission) f.revoke(permission)
      }
      return target.batch(statements)
    }
    return target[key]
  } })
  await f.deliver()
  assert.equal(fired, true, 'actual pre-row image rename transaction reached')
  const names = () => [f.sql.prepare('SELECT original_name FROM file_assets WHERE id=101').get().original_name,
    f.sql.prepare('SELECT original_name FROM import_job_files WHERE id=101').get().original_name]
  if (permission) {
    assert.equal(f.business(), before, 'revocation also preserves library metadata before product row writes')
    assert.deepEqual(names(), ['raw-original.jpg', 'raw-original.jpg'], 'the rename pair rolls back together')
    assert.equal(f.job().status, 'failed')
    assert.match(f.job().last_error, /authority changed/)
    assert.equal(f.pending.length, 0)
  } else {
    for (let n = 0; !['completed', 'failed'].includes(f.job().status) && n < 25; n++) await f.deliver()
    assert.equal(f.job().status, 'completed', f.job().last_error)
    assert.deepEqual(names(), ['Serum_1.jpg', 'Serum_1.jpg'], 'authorized rename is retained')
  }
  assert.equal(f.job().lease_token, null)
  return f.max()
}

async function imageContinuationCase(make, tier, mode, revokeOnResume) {
  let failNext = false
  const f = await fixture(make, tier, mode, { failAttempt() {
    if (failNext) { failNext = false; throw new Error('D1_ERROR: CPU time limit') }
  } })
  for (const id of [101, 102]) {
    f.sql.prepare('INSERT INTO file_assets(id,original_name,stored_name,public_path) VALUES(?,?,?,?)')
      .run(id, `raw-${id}.jpg`, `raw-${id}.jpg`, `/uploads/raw-${id}.jpg`)
    f.sql.prepare("INSERT INTO import_job_files(id,job_id,kind,original_name,stored_path,file_asset_id) VALUES(?,?,'image',?,?,?)")
      .run(id, f.id, `raw-${id}.jpg`, `raw-${id}.jpg`, id)
  }
  f.sql.prepare("UPDATE import_jobs SET policy_json=json_set(policy_json,'$.wire_images',json('true'),'$.imageOverrides',json('{\"101\":2,\"102\":2}')) WHERE id=?").run(f.id)
  assert.equal((await f.http('approve')).status, 200)
  const raw = f.env.DB
  let attempts = 0, resuming = false
  f.env.DB = new Proxy(raw, { get(target, key) {
    if (key === 'batch') return statements => {
      const renamed = statements.filter(statement => statement.text.includes('UPDATE file_assets SET original_name'))
      if (renamed.length) {
        attempts++
        if (attempts === 1) failNext = true
        if (resuming) {
          for (const statement of renamed) {
            assert.ok(!statement.params.includes(101), 'already committed image pair is not replayed on continuation')
          }
        }
      }
      return target.batch(statements)
    }
    return target[key]
  } })
  await f.deliver()
  const names = () => [101, 102].map(id => {
    const name = f.sql.prepare('SELECT original_name FROM file_assets WHERE id=?').get(id).original_name
    assert.equal(f.sql.prepare('SELECT original_name FROM import_job_files WHERE id=?').get(id).original_name, name)
    return name
  })
  if (tier === 'free') {
    assert.deepEqual(names(), ['Serum_1.jpg', 'raw-102.jpg'])
    assert.equal(f.job().status, 'applying')
    assert.equal(f.job().chunk_cursor, 0)
    resuming = true
    if (revokeOnResume) {
      f.revoke('products:import_replace_all')
      const before = f.business()
      await f.deliver()
      assert.equal(f.job().status, 'failed')
      assert.equal(f.business(), before, 'revoked continuation preserves prior authorized pair and untouched suffix')
      f.sql.prepare('UPDATE users SET permissions=? WHERE id=7').run(JSON.stringify(grants))
      assert.equal((await f.http('retry')).status, 200)
    }
  }
  for (let n = 0; !['completed', 'failed'].includes(f.job().status) && n < 30; n++) await f.deliver()
  assert.equal(f.job().status, 'completed', f.job().last_error)
  assert.deepEqual(names(), ['Serum_1.jpg', 'Serum_2.jpg'], 'authorized deferred suffix must complete before job completes')
  assert.ok(attempts >= 3)
  const before = f.business()
  f.pending.push({ body: { jobId: f.id, kind: 'apply' }, attempts: 2 })
  await f.deliver()
  assert.equal(f.business(), before)
  return f.max()
}

async function main() {
  const savedFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"ok":true}')
  try {
    const make = await bundleWorker(), cases = []
    for (const tier of ['free', 'paid']) {
      for (const mode of ['replace_all', 'replace_columns']) {
        for (const permission of ['destructive_delete', 'products:import_replace_all']) {
          for (const boundary of ['create', 'approve', 'retry', 'apply', 'finalize']) {
            cases.push({ name: `${tier}/${mode}/${permission}/${boundary}`, run: () =>
              ['apply', 'finalize'].includes(boundary) ? workerCase(make, tier, mode, permission, boundary)
                : routeCase(make, tier, mode, permission, boundary) })
          }
          for (const boundary of ['apply', 'finalize']) {
            cases.push({ name: `${tier}/${mode}/${permission}/race-${boundary}`,
              run: () => raceCase(make, tier, mode, permission, boundary) })
          }
        }
      }
      for (const mode of ['replace_all', 'replace_columns', 'merge', 'fill_blank']) {
        cases.push({ name: `${tier}/${mode}/allowed`, run: () => allowedCase(make, tier, mode) })
      }
    }
    for (const mode of ['replace_all', 'replace_columns']) {
      for (const permission of ['destructive_delete', 'products:import_replace_all', null]) {
        cases.push({ name: `paid/${mode}/${permission || 'allowed'}/image-rename`,
          run: () => imageRenameCase(make, mode, permission) })
      }
      for (const tier of ['free', 'paid']) for (const revoke of tier === 'free' ? [false, true] : [false]) {
        cases.push({ name: `${tier}/${mode}/image-continuation${revoke ? '-revoked-retry' : ''}`,
          run: () => imageContinuationCase(make, tier, mode, revoke) })
      }
    }
    let count = 0
    for (const test of cases.filter(test => !process.env.IMPORT_AUTHORITY_CASE || test.name.includes(process.env.IMPORT_AUTHORITY_CASE))) {
      const max = await test.run()
      console.log(JSON.stringify({ case: test.name, result: 'PASS', maxPhysicalQueries: max }))
      count++
    }
    assert.ok(count > 0, 'case selection must run a test')
    console.log(`Destructive import actual HTTP/queue authority PASS ${count} cases`)
  } finally { globalThis.fetch = savedFetch }
}

module.exports = { fixture, routeCase, workerCase, allowedCase, raceCase, imageRenameCase }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
