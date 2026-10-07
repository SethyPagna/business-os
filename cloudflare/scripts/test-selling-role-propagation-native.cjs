const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { createHash } = require('node:crypto')

const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const boundary = source.indexOf('async function assertNativeD1TriggerMetadata()')
assert.ok(boundary > 0)
const prefix = source.slice(0, boundary).replace("const { Miniflare, Log, LogLevel } = require('miniflare')", '')
assert.equal(prefix.includes('Miniflare'), false)
const harness = new Module(file, module)
harness.filename = file
harness.paths = module.paths
harness._compile(prefix + '\nmodule.exports={fixture,request,postSale,app,executionCtx,USER,load,setUser(value){currentUser=value}};', file)
const h = harness.exports
const user = { ...h.USER, permissions: JSON.stringify({ all: true }) }
const guards = h.load('lib/branchRoleGuards.ts')
const tables = ['sales', 'sale_items', 'sale_item_batch_allocations', 'branch_stock', 'branch_batch_stock', 'inventory_movements', 'fees', 'sale_mutation_receipts', 'sale_mutation_members', 'sale_amendments', 'sale_write_revisions', 'audit_logs']
const responseInfo = result => JSON.stringify({ status: result.status, code: result.body.code, error: result.body.error })
function fingerprint(f) {
  return createHash('sha256').update(JSON.stringify(tables.map(table => [table, f.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))).digest('hex')
}
function fixture() {
  h.setUser(user)
  const f = h.fixture()
  f.raw.db.limits.variableNumber = 100
  assert.equal(f.raw.db.limits.exprDepth, 100)
  f.raw.prepare("INSERT INTO users(id,username,name,password,is_active) VALUES(71,'sale_cashier','Sale Cashier','disposable-fixture',1)").run()
  f.raw.exec('PRAGMA foreign_keys=ON')
  return f
}
function finalIdentity(f) {
  f.raw.exec("UPDATE branches SET canonical_key='warehouse',role='shop',name='LC Store' WHERE id=1")
  f.raw.exec("INSERT INTO branches(id,name,role,canonical_key,is_active,is_default,successor_branch_id) VALUES(2,'Old Shop','shop','shop',0,0,1)")
}
async function seedSale(f, key) {
  const created = await h.postSale(f.route, { ...h.request(key), sale_status: 'awaiting_payment', amount_paid_usd: 0 })
  assert.equal(created.status, 200, responseInfo(created))
  return created.body.sale
}
async function send(f, kind, sale, key, exactRequest = null) {
  let url, method = 'POST', body
  const common = { client_request_id: key, money_precision_version: 1, expected_exchange_rate: 4000, expected_updated_at: sale.updated_at }
  if (kind === 'add') {
    url = `/${sale.id}/items`
    body = { ...common, items: [{ ...h.request(key).items[0], client_line_key: 'role-added' }] }
  } else if (kind === 'amend') {
    url = `/${sale.id}/amendments`
    body = { ...common, kind: 'line_updated', sale_item_id: sale.items[0].id, quantity: 2,
      pricing_quote: { gross_usd: 19, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 19, total_khr: 76000 } }
  } else {
    url = `/${sale.id}/status`; method = 'PATCH'
    body = { ...common, sale_status: 'cancelled', cancel_reason: 'buyer_refused', cancel_fee_usd: 3, cancel_fee_khr: 12000 }
  }
  const call = async request => {
    const response = await h.app.request(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }, { DB: f.route }, h.executionCtx)
    return { status: response.status, body: await response.json(), request }
  }
  if (exactRequest) return call(exactRequest)
  const result = await call(body)
  return result.status === 409 && result.body.code === 'sale_header_quote_conflict'
    ? call({ ...body, expected_header_quote: result.body.header_quote }) : result
}
let passed = 0
const failed = []
async function check(name, fn) {
  try { await fn(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed.push(name); console.error(`FAIL ${name}: ${error.stack}`) }
}
async function main() {
  await check('shared guard honors explicit role and legacy null fallback', async () => {
    assert.equal(guards.firstUnsellableBranch([{ id: 1, name: 'LC Store', role: 'shop' }]), null)
    assert.equal(guards.firstUnsellableBranch([{ id: 1, name: 'Shop', role: 'warehouse' }]).id, 1)
    for (const role of ['', 1, {}, 'invalid']) assert.equal(guards.firstUnsellableBranch([{ id: 1, name: 'Shop', role }]).id, 1)
    assert.equal(guards.firstUnsellableBranch([{ id: 1, name: ' Shop ', role: null }]), null)
  })
  await check('native SQL and object guards agree for Unicode whitespace, explicit invalid roles and nontext corruption', async () => {
    const f = fixture()
    f.raw.exec('PRAGMA ignore_check_constraints=ON')
    for (const [name, role, expected] of [['LC Store', 'shop', true], ['Shop', 'warehouse', false], ['Shop', '', false],
      ['\u00a0SHOP\u3000', null, true], ['LC Store', '\u00a0SHOP\u3000', true], ['Shop', Buffer.from('shop'), false]]) {
      f.raw.prepare('UPDATE branches SET name=?,role=? WHERE id=1').run([name, role])
      const row = f.raw.prepare('SELECT * FROM branches WHERE id=1').get()
      assert.equal(guards.firstUnsellableBranch([row]) === null, expected)
      assert.equal(Boolean(f.raw.prepare(`SELECT ${guards.sellingBranchConditionSql()} AS allowed FROM branches b WHERE id=1`).get().allowed), expected)
    }
    f.raw.db.close()
  })
  for (const kind of ['create', 'add', 'amend', 'fee']) {
    await check(`${kind}: active LC Store operational shop is eligible and writes exactly once`, async () => {
      const f = fixture()
      const sale = kind === 'create' ? null : await seedSale(f, `seed-${kind}`)
      finalIdentity(f)
      const body = h.request(`role-${kind}`)
      const result = kind === 'create' ? await h.postSale(f.route, body) : await send(f, kind, sale, `role-${kind}`)
      assert.equal(result.status, 200, responseInfo(result))
      assert.equal(f.raw.prepare('SELECT canonical_key FROM branches WHERE id=1').get().canonical_key, 'warehouse')
      assert.equal(f.raw.prepare('SELECT branch_id FROM sales').get().branch_id, 1)
      const stock = f.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id=10 AND branch_id=1').get().quantity
      assert.equal(stock, kind === 'create' ? 9 : kind === 'fee' ? 10 : 8)
      if (kind === 'fee') assert.equal(f.raw.prepare('SELECT branch_id FROM fees WHERE id=(SELECT cancel_fee_id FROM sales WHERE id=?)').get([sale.id]).branch_id, 1)
      const saved = fingerprint(f)
      const replay = kind === 'create' ? await h.postSale(f.route, body) : await send(f, kind, sale, `role-${kind}`, result.request)
      assert.equal(replay.status, 200, responseInfo(replay)); assert.equal(fingerprint(f), saved)
      assert.equal(f.raw.prepare('PRAGMA foreign_key_check').all().length, 0)
      f.raw.db.close()
    })
    for (const mutation of ['warehouse', 'invalid', 'inactive']) await check(`${kind}: ${mutation} preflight refuses without business writes`, async () => {
      const f = fixture()
      const sale = kind === 'create' ? null : await seedSale(f, `seed-${kind}-${mutation}`)
      f.raw.exec('PRAGMA ignore_check_constraints=ON')
      f.raw.exec(mutation === 'inactive' ? 'UPDATE branches SET is_active=0 WHERE id=1'
        : `UPDATE branches SET role='${mutation}' WHERE id=1`)
      f.raw.exec('PRAGMA ignore_check_constraints=OFF')
      const before = fingerprint(f)
      const result = kind === 'create' ? await h.postSale(f.route, h.request(`refuse-${mutation}`)) : await send(f, kind, sale, `refuse-${mutation}`)
      // CUTOVER-LR: a write on an EXISTING sale whose branch is inactive with no active successor is a coded 409
      // (branch_retired_no_successor); a brand-new sale still fails role validation with 400. Neither writes anything.
      const retiredNoSuccessor = mutation === 'inactive' && kind !== 'create'
      assert.equal(result.status, retiredNoSuccessor ? 409 : 400, responseInfo(result))
      if (retiredNoSuccessor) assert.equal(result.body.code, 'branch_retired_no_successor', responseInfo(result))
      assert.equal(fingerprint(f), before)
      f.raw.db.close()
    })
    for (const mutation of ['role', 'activity']) await check(`${kind}: ${mutation} race after preflight rolls back all effects`, async () => {
      const f = fixture()
      const sale = kind === 'create' ? null : await seedSale(f, `seed-race-${kind}-${mutation}`)
      const batch = f.route.batch.bind(f.route)
      let reached = false
      f.route.batch = async statements => {
        if (!reached) {
          reached = true
          f.raw.exec(mutation === 'role' ? "UPDATE branches SET role='warehouse' WHERE id=1" : 'UPDATE branches SET is_active=0 WHERE id=1')
        }
        return batch(statements)
      }
      const before = fingerprint(f)
      const result = kind === 'create' ? await h.postSale(f.route, h.request(`race-${mutation}`)) : await send(f, kind, sale, `race-${mutation}`)
      assert.equal(reached, true)
      assert.equal(result.status, 409, responseInfo(result)); assert.equal(fingerprint(f), before)
      f.raw.db.close()
    })
  }
  await check('retired source id2 refuses without successor redirection', async () => {
    const f = fixture(); finalIdentity(f)
    const request = h.request('retired-source')
    request.branch_id = 2; request.items[0].branch_id = 2
    const before = fingerprint(f)
    const result = await h.postSale(f.route, request)
    assert.equal(result.status, 400); assert.equal(fingerprint(f), before)
    f.raw.db.close()
  })
  await check('legacy null-role Shop retains native create behavior', async () => {
    const f = fixture()
    const result = await h.postSale(f.route, h.request('legacy-null-role'))
    assert.equal(result.status, 200, responseInfo(result))
    f.raw.db.close()
  })
  if (failed.length) throw new Error(`${failed.length}/${passed + failed.length} selling-role groups failed: ${failed.join('; ')}`)
  console.log(`PASS selling-role propagation: ${passed} groups, depth100/binds100`)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
