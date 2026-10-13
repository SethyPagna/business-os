'use strict'
// SEC-4 / audit B2: POST /api/system/reset-data (sales, products, all) and POST /api/system/reset-section needed
// only the typed phrase, never the caller's password, so a hijacked or unattended admin session could wipe data
// without re-authenticating. Both now demand the current password, checked through lib/currentPasswordGuard.ts
// (the same rate-limited helper factory-reset, profile saves and Google unlink use) AFTER the cheap validation and
// BEFORE the backup and any delete.
//
// Drives the REAL Worker (every middleware, route and lib) under Miniflare on a fully migrated D1 and asserts the
// data itself: a refusal must leave every row in place. The built-in admin is seeded by the Worker from the
// BUSINESS_OS_ADMIN_PASSWORD binding, so the right password is a real PBKDF2 hash check.
//
// Run (from cloudflare/): node scripts/test-reset-password-step-up-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const COUNTED_TABLES = ['sales', 'products', 'customers', 'suppliers']

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    await world.account('nobody', { roleCode: 'step_up_nobody', permissions: {} })
    await world.account('restorer', { roleCode: 'step_up_restorer', permissions: { backup_restore: true }, passwordHash: world.adminPasswordHash })

    const counts = async () => {
      const out = {}
      for (const table of COUNTED_TABLES) out[table] = (await world.first(`SELECT COUNT(*) AS n FROM ${table}`)).n
      out.marker = (await world.first("SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'step_up_marker'")).n
      return out
    }
    const seed = async () => {
      await world.run("INSERT INTO sales (receipt_number, total_usd) VALUES ('STEP-UP', 5)")
      await world.run("INSERT INTO products (name) VALUES ('Step-up product')")
      await world.run("INSERT INTO customers (name) VALUES ('Step-up customer')")
      await world.run("INSERT INTO suppliers (name) VALUES ('Step-up supplier')")
      await world.run("INSERT INTO audit_logs (action, entity) VALUES ('probe', 'step_up_marker')")
    }
    const phrase = { sales: 'RESET SALES', products: 'RESET PRODUCTS', all: 'DELETE ALL DATA' }
    const resetBody = (mode, extra = {}) => ({ mode, confirm: phrase[mode], acknowledged: true, ...extra })

    async function refused(t, label, call, code, status = 403) {
      await seed()
      const before = await counts()
      const response = await call()
      t.eq(`${label}: status`, response.status, status)
      t.eq(`${label}: code`, response.json && response.json.code, code)
      t.eq(`${label}: nothing deleted`, await counts(), before)
    }

    await check('control: an account with no permission cannot reset data', async (t) => {
      await seed()
      const before = await counts()
      const response = await world.api('POST', '/api/system/reset-data', resetBody('sales', { currentPassword: adminPassword }), { as: 'nobody' })
      t.eq('status', response.status, 403)
      t.eq('nothing deleted', await counts(), before)
    })

    await check('control: backup_restore without the built-in admin is still refused first', async (t) => {
      await seed()
      const before = await counts()
      const response = await world.api('POST', '/api/system/reset-data', resetBody('sales', { currentPassword: adminPassword }), { as: 'restorer' })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'reset_builtin_admin_only')
      t.eq('nothing deleted', await counts(), before)
    })

    await check('reset-data sales: the phrase alone is refused, with a distinct code, and nothing is deleted', async (t) => {
      await refused(t, 'no password', () => world.api('POST', '/api/system/reset-data', resetBody('sales')), 'current_password_required')
    })

    await check('reset-data sales: a wrong password is refused and nothing is deleted', async (t) => {
      await refused(t, 'wrong password', () => world.api('POST', '/api/system/reset-data', resetBody('sales', { currentPassword: 'not-the-password' })), 'incorrect_password')
    })

    await check('reset-data products (with the sales toggle): the phrase alone is refused', async (t) => {
      await refused(t, 'products', () => world.api('POST', '/api/system/reset-data', resetBody('products', { includeSales: true })), 'current_password_required')
    })

    await check('reset-data all: the phrase alone is refused', async (t) => {
      await refused(t, 'all', () => world.api('POST', '/api/system/reset-data', resetBody('all')), 'current_password_required')
    })

    await check('reset-data sales: the right password still works end to end', async (t) => {
      await seed()
      const response = await world.api('POST', '/api/system/reset-data', resetBody('sales', { currentPassword: adminPassword }))
      t.eq('status', response.status, 200)
      t.eq('success', response.json && response.json.success, true)
      t.eq('sales deleted', (await world.first('SELECT COUNT(*) AS n FROM sales')).n, 0)
      t.eq('products kept', (await world.first('SELECT COUNT(*) AS n FROM products')).n > 0, true)
      t.eq('the reset was audited', (await world.first("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'reset_data'")).n > 0, true)
    })

    await check('control: an account with no permission cannot reset a section', async (t) => {
      await seed()
      const before = await counts()
      const response = await world.api('POST', '/api/system/reset-section', { section: 'customers', currentPassword: adminPassword }, { as: 'nobody' })
      t.eq('status', response.status, 403)
      t.eq('nothing deleted', await counts(), before)
    })

    await check('reset-section customers: no password is refused and nothing is deleted', async (t) => {
      await refused(t, 'no password', () => world.api('POST', '/api/system/reset-section', { section: 'customers' }, { as: 'restorer' }), 'current_password_required')
    })

    await check('reset-section audit_log: a wrong password is refused and the audit trail survives', async (t) => {
      await refused(t, 'wrong password', () => world.api('POST', '/api/system/reset-section', { section: 'audit_log', currentPassword: 'not-the-password' }, { as: 'restorer' }), 'incorrect_password')
    })

    await check('reset-section: a password that is not text is refused', async (t) => {
      await refused(t, 'numeric password', () => world.api('POST', '/api/system/reset-section', { section: 'suppliers', currentPassword: 12345 }, { as: 'restorer' }), 'current_password_required')
    })

    await check('reset-section suppliers: the right password still works and only that section goes', async (t) => {
      await seed()
      const customersBefore = (await world.first('SELECT COUNT(*) AS n FROM customers')).n
      const response = await world.api('POST', '/api/system/reset-section', { section: 'suppliers', currentPassword: adminPassword }, { as: 'restorer' })
      t.eq('status', response.status, 200)
      t.eq('success', response.json && response.json.success, true)
      t.eq('suppliers deleted', (await world.first('SELECT COUNT(*) AS n FROM suppliers')).n, 0)
      t.eq('customers kept', (await world.first('SELECT COUNT(*) AS n FROM customers')).n, customersBefore)
    })

    await check('reset-section: an unknown section is still a plain 400 before any password check', async (t) => {
      const response = await world.api('POST', '/api/system/reset-section', { section: 'users', currentPassword: adminPassword }, { as: 'restorer' })
      t.eq('status', response.status, 400)
    })

  } finally {
    finish('reset password step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
