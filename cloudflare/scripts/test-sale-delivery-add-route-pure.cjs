// Drives the real sales route and full migrated schema through the bounded
// "add delivery" mutation. This is intentionally an HTTP/D1 test: the pure
// planner tests cannot prove the picker permission, request shape, guarded
// batch, durable receipt, or idempotent replay contract.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
const FULL_USER = {
  id: 91,
  username: 'delivery_cashier',
  name: 'Delivery Cashier',
  // Deliberately no contacts grant. Both the picker and mutation belong to
  // the sales amendment action and must work without disclosing Contacts.
  permissions: JSON.stringify({ sales: true }),
}
const DENIED_USER = {
  id: 92,
  username: 'sales_viewer',
  name: 'Sales Viewer',
  permissions: JSON.stringify({ sales: 'view' }),
}

const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': {
    requireAuth: async (c, next) => {
      c.set('user', c.env.TEST_USER || FULL_USER)
      return next()
    },
  },
  '../lib/audit': { audit: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': {
    bumpVersion: async () => {},
    getVersionWithFallback: async () => 0,
    cachedJsonResponse: async (_request, _context, _key, _ttl, loader) => loader(),
  },
  '../lib/telegram': {
    formatSaleTelegramLines: () => [],
    sendTelegramEvent: async () => {},
    telegramMoney: (value) => String(value ?? ''),
  },
}

function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const app = load('routes/sales.ts').default
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }

function run(db, sql, params = {}) { return db.prepare(sql).run(params) }
function get(db, sql, params = {}) { return db.prepare(sql).get(params) }

async function request(db, pathname, method = 'GET', body, user = FULL_USER) {
  const response = await app.request(pathname, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: db, TEST_USER: user }, executionCtx)
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

function createFixture({ status = 'completed', isDelivery = 0, old = false, withReturn = false } = {}) {
  const db = openDb(loadAll())
  const stamp = old ? '2026-01-01T00:00:00.000Z' : new Date(Date.now() - 60_000).toISOString()
  run(db, `INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)`)
  for (const [key, value] of [
    ['exchange_rate', '4000'],
    ['change_exchange_rate', '4000'],
    ['tax_enabled', 'false'],
    ['tax_rate', '0'],
    ['sale_amendment_window_minutes', '120'],
  ]) {
    run(db, 'INSERT INTO settings(key,value,updated_at) VALUES(@key,@value,@stamp)', { key, value, stamp })
  }
  run(db, `INSERT INTO delivery_contacts(id,name,phone,area,address,notes,created_at,updated_at)
    VALUES(7,'Dara Driver','010-777','Central','Street 7','trusted',@stamp,@stamp)`, { stamp })
  run(db, `INSERT INTO delivery_contacts(id,name,phone,area,address,notes,created_at,updated_at)
    VALUES(8,'Sokha Rider','010-888','South','Street 8','secondary',@stamp,@stamp)`, { stamp })
  run(db, `INSERT INTO sales(
      id,receipt_number,cashier_id,cashier_name,branch_id,branch_name,
      payment_method,payment_currency,exchange_rate,subtotal_usd,subtotal_khr,
      discount_usd,discount_khr,tax_usd,tax_khr,total_usd,total_khr,
      amount_paid_usd,amount_paid_khr,change_usd,change_khr,
      is_delivery,delivery_fee_usd,delivery_fee_khr,delivery_fee_paid_by,
      sale_status,items,created_at,updated_at,stock_skipped
    ) VALUES(
      101,'SALE-101',91,'delivery_cashier',1,'Shop',
      'Cash','USD',4000,10,40000,
      0,0,0,0,10,40000,
      10,0,0,0,
      @isDelivery,0,0,'customer',
      @status,'[]',@stamp,@stamp,0
    )`, { isDelivery, status, stamp })
  run(db, `INSERT INTO sale_items(
      id,sale_id,product_id,product_name,sku,quantity,unit,
      applied_price_usd,applied_price_khr,total_usd,total_khr,branch_id,
      product_discount_usd,product_discount_khr,base_price_usd,base_price_khr,
      manual_discount_usd,manual_discount_khr
    ) VALUES(201,101,301,'Tea','TEA',1,'each',10,40000,10,40000,1,0,0,10,40000,0,0)`)
  if (withReturn) {
    run(db, `INSERT INTO returns(id,return_number,sale_id,receipt_number,cashier_id,cashier_name,
      branch_id,branch_name,total_refund_usd,total_refund_khr,exchange_rate,status,created_at)
      VALUES(401,'RET-401',101,'SALE-101',91,'delivery_cashier',1,'Shop',1,4000,4000,'completed',@stamp)`, { stamp })
    run(db, `INSERT INTO return_items(id,return_id,sale_item_id,product_id,product_name,quantity,
      applied_price_usd,applied_price_khr,total_usd,total_khr,return_to_stock,branch_id)
      VALUES(501,401,201,301,'Tea',1,10,40000,10,40000,1,1)`)
  }
  return { db, stamp }
}

function addDeliveryBody(stamp, suffix = 'base') {
  return {
    kind: 'delivery_added',
    delivery_contact_id: 7,
    delivery_fee_usd: 2,
    delivery_actual_cost_usd: 1.25,
    client_request_id: `delivery-add-${suffix}`,
    expected_exchange_rate: 4000,
    expected_updated_at: stamp,
    notes: 'Customer requested delivery',
  }
}

function counts(db) {
  return {
    amendments: get(db, "SELECT COUNT(*) AS n FROM sale_amendments WHERE sale_id=101").n,
    deliveryAdded: get(db, "SELECT COUNT(*) AS n FROM sale_amendments WHERE sale_id=101 AND kind='delivery_added'").n,
    receipts: get(db, "SELECT COUNT(*) AS n FROM sale_mutation_receipts WHERE sale_id=101 AND mutation_kind='amendment'").n,
    stock: get(db, 'SELECT COUNT(*) AS n FROM inventory_movements').n,
    fees: get(db, 'SELECT COUNT(*) AS n FROM fees').n,
  }
}

function racingDb(db, mutate) {
  let fired = false
  return {
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    get staging() { return this },
    async batch(statements) {
      if (!fired) {
        fired = true
        mutate()
      }
      return db.batch(statements)
    },
  }
}

async function assertRefused(fixtureOptions, expectedCode, label) {
  const { db, stamp } = createFixture(fixtureOptions)
  const before = counts(db)
  const result = await request(db, '/101/amendments', 'POST', addDeliveryBody(stamp, label))
  assert.equal(result.status, 400, label)
  if (expectedCode) assert.equal(result.body.code, expectedCode, label)
  assert.deepEqual(counts(db), before, `${label} must not partially write`)
  assert.equal(get(db, 'SELECT is_delivery FROM sales WHERE id=101').is_delivery, Number(fixtureOptions.isDelivery || 0), label)
}

;(async () => {
  // The driver picker is part of sales:amend/full. A user with no Contacts
  // permission can search it, while a sales view-only user cannot enumerate it.
  {
    const { db } = createFixture()
    const picker = await request(db, '/delivery-options?search=dara')
    assert.equal(picker.status, 200)
    assert.deepEqual(picker.body.items.map((row) => row.id), [7])
    assert.deepEqual(Object.keys(picker.body.items[0]).sort(), ['address', 'area', 'id', 'name', 'phone'])
    assert.equal('notes' in picker.body.items[0], false)
    const deniedPicker = await request(db, '/delivery-options?search=dara', 'GET', undefined, DENIED_USER)
    assert.equal(deniedPicker.status, 403)

    const before = counts(db)
    const deniedMutation = await request(db, '/101/amendments', 'POST', addDeliveryBody(get(db, 'SELECT updated_at FROM sales WHERE id=101').updated_at, 'denied'), DENIED_USER)
    assert.equal(deniedMutation.status, 403)
    assert.deepEqual(counts(db), before)
  }

  // Both currently editable recorded-sale statuses accept the same atomic
  // conversion. The completed case below additionally proves exact money,
  // driver snapshot, durable history and retry behavior.
  for (const status of ['completed', 'awaiting_delivery', 'awaiting_payment']) {
    const { db, stamp } = createFixture({ status })
    const body = addDeliveryBody(stamp, status)
    const before = counts(db)
    const first = await request(db, '/101/amendments', 'POST', body)
    assert.equal(first.status, 200, `${status}: ${JSON.stringify(first.body)}`)
    assert.equal(first.body.isDelivery, 1)
    assert.equal(first.body.deliveryContactId, 7)
    assert.equal(first.body.deliveryFeeUsd, 2)
    assert.equal(first.body.deliveryActualCostUsd, 1.25)
    assert.equal(first.body.totalUsd, 12)
    assert.equal(first.body.totalKhr, 48000)
    assert.equal(first.body.stockMoved, false)
    assert.equal(first.body.unitsMoved, 0)

    const sale = get(db, `SELECT is_delivery,delivery_contact_id,delivery_contact_name,
      delivery_contact_phone,delivery_contact_address,delivery_fee_usd,delivery_fee_khr,
      delivery_fee_paid_by,delivery_actual_cost_usd,delivery_actual_cost_khr,total_usd,total_khr
      FROM sales WHERE id=101`)
    assert.deepEqual({ ...sale }, {
      is_delivery: 1,
      delivery_contact_id: 7,
      delivery_contact_name: 'Dara Driver',
      delivery_contact_phone: '010-777',
      delivery_contact_address: 'Street 7',
      delivery_fee_usd: 2,
      delivery_fee_khr: 8000,
      delivery_fee_paid_by: 'customer',
      delivery_actual_cost_usd: 1.25,
      delivery_actual_cost_khr: 5000,
      total_usd: 12,
      total_khr: 48000,
    })
    assert.deepEqual(counts(db), {
      amendments: before.amendments + 1,
      deliveryAdded: before.deliveryAdded + 1,
      receipts: before.receipts + 1,
      stock: before.stock,
      fees: before.fees,
    })
    const ledger = get(db, `SELECT kind,user_id,user_name,before_json,after_json,created_at
      FROM sale_amendments WHERE sale_id=101`)
    assert.equal(ledger.kind, 'delivery_added')
    assert.equal(ledger.user_id, FULL_USER.id)
    assert.equal(ledger.user_name, FULL_USER.username)
    assert.ok(ledger.created_at)
    assert.deepEqual(JSON.parse(ledger.before_json), {
      is_delivery: false,
      delivery_contact_id: null,
      delivery_contact_name: null,
      delivery_contact_phone: null,
      delivery_contact_address: null,
      delivery_fee_usd: 0,
      delivery_fee_khr: 0,
      delivery_fee_paid_by: 'customer',
      delivery_actual_cost_usd: null,
      delivery_actual_cost_khr: null,
      exchange_rate: 4000,
      total_usd: 10,
      total_khr: 40000,
    })
    assert.equal(JSON.parse(ledger.after_json).delivery_contact_name, 'Dara Driver')
    const receipt = get(db, `SELECT actor_id,request_id,request_json,before_json,after_json,response_json
      FROM sale_mutation_receipts WHERE sale_id=101`)
    assert.equal(receipt.actor_id, FULL_USER.id)
    assert.equal(receipt.request_id, body.client_request_id)
    assert.equal(JSON.parse(receipt.request_json).kind, 'delivery_added')
    assert.equal(JSON.parse(receipt.before_json).delivery.is_delivery, false)
    assert.equal(JSON.parse(receipt.after_json).delivery.is_delivery, true)

    const retry = await request(db, '/101/amendments', 'POST', body)
    assert.equal(retry.status, 200)
    assert.deepEqual(retry.body, first.body)
    assert.deepEqual(counts(db), {
      amendments: before.amendments + 1,
      deliveryAdded: before.deliveryAdded + 1,
      receipts: before.receipts + 1,
      stock: before.stock,
      fees: before.fees,
    })
    const reused = await request(db, '/101/amendments', 'POST', { ...body, delivery_fee_usd: 3 })
    assert.equal(reused.status, 409)
    assert.equal(reused.body.code, 'idempotency_conflict')
    assert.deepEqual(counts(db), {
      amendments: before.amendments + 1,
      deliveryAdded: before.deliveryAdded + 1,
      receipts: before.receipts + 1,
      stock: before.stock,
      fees: before.fees,
    })
  }

  await assertRefused({ isDelivery: 1 }, null, 'already-delivery')
  await assertRefused({ status: 'cancelled' }, 'status', 'cancelled')
  await assertRefused({ status: 'returned' }, 'returns', 'returned-status')
  await assertRefused({ withReturn: true }, 'returns', 'recorded-return')
  await assertRefused({ old: true }, 'window', 'outside-window')

  // JSON scalar/container coercion is forbidden for all three reviewed
  // values. Each invalid shape is tested on a fresh sale so one false accept
  // cannot hide another behind the "already delivery" guard.
  for (const field of ['delivery_contact_id', 'delivery_fee_usd', 'delivery_actual_cost_usd']) {
    for (const value of [true, [], {}]) {
      const { db, stamp } = createFixture()
      const before = counts(db)
      const result = await request(db, '/101/amendments', 'POST', {
        ...addDeliveryBody(stamp, `shape-${field}-${typeof value}-${Array.isArray(value)}`),
        [field]: value,
      })
      assert.equal(result.status, 400, `${field} must reject ${JSON.stringify(value)}`)
      assert.deepEqual(counts(db), before)
      assert.equal(get(db, 'SELECT is_delivery FROM sales WHERE id=101').is_delivery, 0)
    }
  }

  // An already stale browser snapshot is rejected before planning.
  {
    const { db, stamp } = createFixture()
    const before = counts(db)
    const result = await request(db, '/101/amendments', 'POST', {
      ...addDeliveryBody(stamp, 'stale-upfront'),
      expected_updated_at: '2026-01-01T00:00:00.000Z',
    })
    assert.equal(result.status, 409)
    assert.equal(result.body.code, 'write_conflict')
    assert.deepEqual(counts(db), before)
  }

  // Races after every authoritative read but before the D1 batch must fail
  // atomically. The concurrent writer's change remains; no part of the
  // reviewed delivery act survives.
  for (const race of [
    {
      label: 'sale',
      mutate: (db) => run(db, "UPDATE sales SET notes='concurrent sale edit' WHERE id=101"),
    },
    {
      label: 'settings',
      mutate: (db) => run(db, "UPDATE settings SET value='4100' WHERE key='exchange_rate'"),
    },
    {
      label: 'contact',
      mutate: (db) => run(db, "UPDATE delivery_contacts SET phone='010-new' WHERE id=7"),
    },
  ]) {
    const { db, stamp } = createFixture()
    const before = counts(db)
    const raced = await request(racingDb(db, () => race.mutate(db)), '/101/amendments', 'POST', addDeliveryBody(stamp, `race-${race.label}`))
    assert.equal(raced.status, 409, `${race.label}: ${JSON.stringify(raced.body)}`)
    assert.equal(raced.body.code, 'write_conflict')
    assert.deepEqual(counts(db), before, `${race.label} race must roll back the delivery batch`)
    assert.equal(get(db, 'SELECT is_delivery FROM sales WHERE id=101').is_delivery, 0)
  }

  console.log('sale delivery-add route: permission, validation, guards, atomic history, and retry PASS')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
