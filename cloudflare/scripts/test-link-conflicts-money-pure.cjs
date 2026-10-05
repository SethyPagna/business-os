// GET /customers/link-conflicts (the Conflicts tab's "Sale links" section).
//
// N11: its per-group total counted a CANCELLED sale's money, while the owner's
// revenue rule is "a cancelled sale counts as $0" (lib/salesAnalytics.ts
// recognizedExpr). N5: the same endpoint printed customer spend to anyone with
// Contacts view, although the dedicated contacts:financial_history action
// exists to hide spend from cashiers (the neighbouring AR-invoice route
// enforces it). Runs the REAL route against the REAL schema (full migration
// chain, in-memory SQLite) with real permission and revenue helpers.
//
// Run (from cloudflare/): node scripts/test-link-conflicts-money-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const rawDb = openDb(loadAll())
// lib/db.ts's D1Compat flattens run() into { changes, lastInsertRowid }.
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: async (params) => stmt.get(params),
      all: async (params) => stmt.all(params) ?? [],
      run: async (params) => {
        const r = stmt.run(params)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  async batch(items) { return rawDb.batch(items) },
}

function load(file, dependencies = {}) {
  const filename = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', output)((name) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('.')) return {}
    return require(name)
  }, module.exports, module)
  return module.exports
}

let CURRENT_USER = null
const permissions = load('lib/permissions.ts')
const salesAnalytics = load('lib/salesAnalytics.ts')
const contactsApp = load('routes/contacts.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', CURRENT_USER); return next() } },
  '../lib/db': { getDb: () => db },
  '../lib/permissions': permissions,
  '../lib/salesAnalytics': salesAnalytics,
}).default

const mkUser = (id, role, rolePermissions) => ({
  id, username: `u${id}`, role_code: role, role_permissions: JSON.stringify(rolePermissions), permissions: '{}',
})
// Contacts view + the dedicated spend action.
const withSpend = mkUser(10, 'manager', { contacts: true })
// Contacts view, spend switched off, and the resolve action also off.
const cashier = mkUser(11, 'employee', { contacts: true, 'contacts:financial_history': false, 'contacts:resolve_conflicts': false })
// Same, but allowed to resolve conflicts.
const resolver = mkUser(12, 'employee', { contacts: true, 'contacts:financial_history': false })

async function get(user, pathname = '/customers/link-conflicts') {
  CURRENT_USER = user
  const res = await contactsApp.request(pathname, {}, {}, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, json: await res.json().catch(() => null) }
}

// Seed: customer 1 (phone 0111) has three sales that print phone 0222 (a link
// mismatch): $10 completed, $90 cancelled and $5 awaiting payment. Two more
// sales name an unknown contact (the "missing" class): $20 completed, $70 cancelled.
function seed() {
  rawDb.exec('DELETE FROM sales; DELETE FROM customers; DELETE FROM contact_duplicate_dismissals;')
  rawDb.prepare("INSERT INTO customers (id, name, phone) VALUES (1, 'Dara', '0111')").run()
  const sale = (customerId, name, phone, total, status, at) => rawDb.prepare(
    // subtotal_usd = total_usd: no tax, delivery or discount, so net sales == total unless a case says otherwise.
    'INSERT INTO sales (customer_id, customer_name, customer_phone, subtotal_usd, total_usd, sale_status, created_at) VALUES (@customerId,@name,@phone,@total,@total,@status,@at)',
  ).run({ customerId, name, phone, total, status, at })
  sale(1, 'Dara', '0222', 10, 'completed', '2026-09-01 10:00:00')
  sale(1, 'Dara', '0222', 90, 'cancelled', '2026-09-02 10:00:00')
  sale(1, 'Dara', '0222', 5, 'awaiting_payment', '2026-09-03 10:00:00')
  sale(null, 'Stranger', '0333', 20, 'completed', '2026-09-04 10:00:00')
  sale(null, 'Stranger', '0333', 70, 'cancelled', '2026-09-05 10:00:00')
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  seed()

  await check('N11: a cancelled sale adds $0 to the group total (revenue rule), other statuses still count', async () => {
    const { status, json } = await get(withSpend)
    assert.equal(status, 200, JSON.stringify(json))
    assert.equal(json.mismatches.length, 1)
    // completed 10 + awaiting_payment 5 (inside revenue); the cancelled $90 is out.
    assert.equal(json.mismatches[0].total_usd, 15)
    // Resolving the link still moves every sale, so the group size stays the
    // number of linked sales, cancelled included.
    assert.equal(json.mismatches[0].sale_count, 3)
    assert.equal(json.missing.length, 1)
    assert.equal(json.missing[0].total_usd, 20)
    assert.equal(json.missing[0].sale_count, 2)
  })

  await check('N11: the total is NET sales (subtotal less discounts), not gross -- tax and delivery are not revenue', async () => {
    seed()
    // A $10 sale carrying $1 tax and a $2 customer-paid delivery fee (gross total 13), and a $20 sale with a $4 discount (total 16).
    rawDb.prepare("UPDATE sales SET subtotal_usd = 10, tax_usd = 1, delivery_fee_usd = 2, total_usd = 13 WHERE total_usd = 10").run()
    rawDb.prepare("UPDATE sales SET subtotal_usd = 20, discount_usd = 4, total_usd = 16 WHERE total_usd = 20").run()
    const { json } = await get(withSpend)
    assert.equal(json.mismatches[0].total_usd, 15, 'net 10 + awaiting 5 -- old gross sum read 18')
    assert.equal(json.missing[0].total_usd, 16, 'subtotal 20 less the 4 discount')
    // A membership discount comes off too (gross total_usd is left at 16, so only the net rule reads 13), and a discount larger than the subtotal floors at 0 per sale (never negative revenue).
    rawDb.prepare("UPDATE sales SET membership_discount_usd = 3 WHERE subtotal_usd = 20").run()
    assert.equal((await get(withSpend)).json.missing[0].total_usd, 13)
    rawDb.prepare("UPDATE sales SET discount_usd = 50 WHERE subtotal_usd = 20").run()
    assert.equal((await get(withSpend)).json.missing[0].total_usd, 0)
    seed()
  })

  await check('N11: a blank status is treated as completed, exactly as every revenue surface does', async () => {
    rawDb.prepare("UPDATE sales SET sale_status = '' WHERE total_usd = 5").run()
    const { json } = await get(withSpend)
    assert.equal(json.mismatches[0].total_usd, 15)
    rawDb.prepare("UPDATE sales SET sale_status = 'awaiting_payment' WHERE total_usd = 5").run()
  })

  await check('N11: a group made only of cancelled sales shows $0, not their face value', async () => {
    rawDb.prepare("UPDATE sales SET sale_status = 'cancelled' WHERE customer_id = 1").run()
    const { json } = await get(withSpend)
    assert.equal(json.mismatches[0].total_usd, 0)
    seed()
  })

  await check('N5: a user without financial_history gets the list but no total_usd or sale_count on any row', async () => {
    seed()
    for (const user of [cashier, resolver]) {
      const { status, json } = await get(user)
      assert.equal(status, 200, JSON.stringify(json))
      assert.equal(json.mismatches.length, 1, 'the conflict itself must stay visible so it can be resolved')
      assert.equal(json.missing.length, 1)
      for (const row of [...json.mismatches, ...json.missing]) {
        assert.ok(!('total_usd' in row), 'total_usd must be omitted: ' + JSON.stringify(row))
        assert.ok(!('sale_count' in row), 'sale_count must be omitted: ' + JSON.stringify(row))
      }
      // The fields a resolver needs are intact.
      assert.equal(json.mismatches[0].customer_id, 1)
      assert.equal(json.mismatches[0].phone_key, '222')
      assert.equal(json.missing[0].name, 'Stranger')
      assert.equal(json.pagination.mismatches.total, 1)
    }
  })

  await check('N5: financial_history holders (default manager, admin) still receive spend and counts', async () => {
    seed()
    for (const user of [withSpend, mkUser(1, 'admin', {})]) {
      const { status, json } = await get(user)
      assert.equal(status, 200)
      assert.equal(json.mismatches[0].total_usd, 15)
      assert.equal(json.mismatches[0].sale_count, 3)
      assert.equal(json.missing[0].total_usd, 20)
      assert.equal(json.missing[0].sale_count, 2)
    }
  })

  await check('N5: a per-user explicit deny narrows a manager who has the section default', async () => {
    seed()
    const narrowed = { ...withSpend, id: 13, permissions: JSON.stringify({ 'contacts:financial_history': false }) }
    const { json } = await get(narrowed)
    assert.ok(!('total_usd' in json.mismatches[0]))
  })

  await check('N5: without financial_history the order cannot rank customers by how often they bought', async () => {
    seed()
    // Group B: one very recent sale; group A (Stranger) has two older ones.
    rawDb.prepare("INSERT INTO sales (customer_id, customer_name, customer_phone, total_usd, sale_status, created_at) VALUES (NULL,'Newer','0444',1,'completed','2026-09-30 10:00:00')").run()
    // A third group: one old-ish sale. Busiest-first is Stranger, Newer, Alpha (count then recency);
    // most-recent-first would be Newer, Alpha, Stranger; by name it is Alpha, Newer, Stranger.
    rawDb.prepare("INSERT INTO sales (customer_id, customer_name, customer_phone, total_usd, sale_status, created_at) VALUES (NULL,'Alpha','0555',1,'completed','2026-09-10 10:00:00')").run()
    const names = async (user) => (await get(user)).json.missing.map((row) => row.name)
    assert.deepEqual(await names(withSpend), ['Stranger', 'Newer', 'Alpha'], 'spend holders keep the busiest-first order')
    assert.deepEqual(await names(cashier), ['Alpha', 'Newer', 'Stranger'], 'others get a neutral order (by name), ranking neither by frequency nor by recency')
  })

  await check('N5: without financial_history no row carries first_at or last_at (buying recency), and the mismatch order is neutral too', async () => {
    seed()
    // A second mismatch customer whose last sale is MORE recent but whose id is higher.
    rawDb.prepare("INSERT INTO customers (id, name, phone) VALUES (2, 'Bora', '0999')").run()
    rawDb.prepare("INSERT INTO sales (customer_id, customer_name, customer_phone, subtotal_usd, total_usd, sale_status, created_at) VALUES (2,'Bora','0888',1,1,'completed','2026-09-30 10:00:00')").run()
    for (const user of [cashier, resolver]) {
      const { json } = await get(user)
      for (const row of [...json.mismatches, ...json.missing]) {
        assert.ok(!('first_at' in row) && !('last_at' in row), 'no dates: ' + JSON.stringify(row))
      }
      assert.deepEqual(json.mismatches.map((row) => row.customer_id), [1, 2], 'ordered by customer, not by recency (recency would put 2 first)')
    }
    const spend = (await get(withSpend)).json
    assert.ok(spend.mismatches.every((row) => row.first_at && row.last_at), 'financial_history holders still see the dates')
    assert.deepEqual(spend.mismatches.map((row) => row.customer_id), [2, 1], 'and keep most-recent-first')
    seed()
  })

  await check('N5: a user with no Contacts access still gets no list at all', async () => {
    const { status } = await get(mkUser(14, 'employee', { sales: true }))
    assert.equal(status, 403)
  })

  await check('N5 UI parity: the section shows spend and counts only with the same contacts:financial_history action the route checks', async () => {
    const ui = fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'components', 'contacts', 'SaleLinkConflictsSection.tsx'), 'utf8')
    assert.match(ui, /can\('contacts', 'financial_history'\)/)
    const meta = ui.slice(ui.indexOf('const groupMeta'), ui.indexOf('return (', ui.indexOf('const groupMeta')))
    assert.match(meta, /!canViewFinancialHistory[\s\S]*return range/, 'money is rendered only after the action check')
    assert.match(ui, /relink_sales_action_no_count/)
    for (const pack of ['en', 'km']) {
      const strings = JSON.parse(fs.readFileSync(path.join(root, '..', 'frontend', 'src', 'lang', pack + '.json'), 'utf8'))
      assert.ok(strings.relink_sales_action_no_count && strings.create_and_link_action_no_count, pack + ' pack carries the count-free labels')
    }
  })

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
