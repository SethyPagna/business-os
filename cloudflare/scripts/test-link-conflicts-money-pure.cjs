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
    'INSERT INTO sales (customer_id, customer_name, customer_phone, total_usd, sale_status, created_at) VALUES (@customerId,@name,@phone,@total,@status,@at)',
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

  console.log(`\n${passed} check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
