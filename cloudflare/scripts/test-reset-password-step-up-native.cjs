'use strict'
// SEC-4 / audit B2: POST /api/system/reset-data (sales, products, all) and POST /api/system/reset-section needed
// only the typed phrase, never the caller's password, so a hijacked or unattended admin session could wipe data
// without re-authenticating. Both now demand the current password, checked through lib/currentPasswordGuard.ts
// (the same rate-limited helper factory-reset, profile saves and Google unlink use) AFTER the cheap validation and
// BEFORE the backup and any delete. reset-section also checks the typed phrase and the acknowledgement on the
// server, in the same order and with the same error codes as reset-data (phrase, acknowledgement, password).
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
    const cache = await world.mf.getKVNamespace('CACHE')
    const clearRequestLimits = async () => {
      for (const key of (await cache.list({ prefix: 'ratelimit:' })).keys) await cache.delete(key.name)
    }
    const seed = async () => {
      await clearRequestLimits()
      await world.run("INSERT INTO sales (receipt_number, total_usd) VALUES ('STEP-UP', 5)")
      await world.run("INSERT INTO products (name) VALUES ('Step-up product')")
      await world.run("INSERT INTO customers (name) VALUES ('Step-up customer')")
      await world.run("INSERT INTO suppliers (name) VALUES ('Step-up supplier')")
      await world.run("INSERT INTO audit_logs (action, entity) VALUES ('probe', 'step_up_marker')")
    }
    const phrase = { sales: 'RESET SALES', products: 'RESET PRODUCTS', all: 'DELETE ALL DATA' }
    const resetBody = (mode, extra = {}) => ({ mode, confirm: phrase[mode], acknowledged: true, ...extra })
    const sectionPhrase = { customers: 'RESET CUSTOMERS', suppliers: 'RESET SUPPLIERS', delivery_contacts: 'RESET DELIVERY CONTACTS', audit_log: 'RESET AUDIT LOG' }
    const sectionBody = (section, extra = {}) => ({ section, confirm: sectionPhrase[section], acknowledged: true, ...extra })

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
      const response = await world.api('POST', '/api/system/reset-section', sectionBody('customers', { currentPassword: adminPassword }), { as: 'nobody' })
      t.eq('status', response.status, 403)
      t.eq('nothing deleted', await counts(), before)
    })

    await check('reset-section customers: no password is refused and nothing is deleted', async (t) => {
      await refused(t, 'no password', () => world.api('POST', '/api/system/reset-section', sectionBody('customers'), { as: 'restorer' }), 'current_password_required')
    })

    await check('reset-section audit_log: a wrong password is refused and the audit trail survives', async (t) => {
      await refused(t, 'wrong password', () => world.api('POST', '/api/system/reset-section', sectionBody('audit_log', { currentPassword: 'not-the-password' }), { as: 'restorer' }), 'incorrect_password')
    })

    await check('reset-section: a password that is not text is refused', async (t) => {
      await refused(t, 'numeric password', () => world.api('POST', '/api/system/reset-section', sectionBody('suppliers', { currentPassword: 12345 }), { as: 'restorer' }), 'current_password_required')
    })

    await check('reset-section suppliers: the right password still works and only that section goes', async (t) => {
      await seed()
      const customersBefore = (await world.first('SELECT COUNT(*) AS n FROM customers')).n
      const response = await world.api('POST', '/api/system/reset-section', sectionBody('suppliers', { currentPassword: adminPassword }), { as: 'restorer' })
      t.eq('status', response.status, 200)
      t.eq('success', response.json && response.json.success, true)
      t.eq('suppliers deleted', (await world.first('SELECT COUNT(*) AS n FROM suppliers')).n, 0)
      t.eq('customers kept', (await world.first('SELECT COUNT(*) AS n FROM customers')).n, customersBefore)
    })

    await check('reset-section: the right password without the typed phrase is refused and nothing is deleted', async (t) => {
      await refused(t, 'no phrase', () => world.api('POST', '/api/system/reset-section', { section: 'customers', acknowledged: true, currentPassword: adminPassword }, { as: 'restorer' }), 'reset_confirm_required', 400)
    })

    await check('reset-section: another section\'s phrase is refused, so one phrase cannot reset a different page', async (t) => {
      await refused(t, 'wrong phrase', () => world.api('POST', '/api/system/reset-section', sectionBody('customers', { confirm: sectionPhrase.suppliers, currentPassword: adminPassword }), { as: 'restorer' }), 'reset_confirm_required', 400)
    })

    await check('reset-section: a near-miss phrase (lower case, padded) is refused like reset-data refuses it', async (t) => {
      await refused(t, 'lower case', () => world.api('POST', '/api/system/reset-section', sectionBody('suppliers', { confirm: 'reset suppliers', currentPassword: adminPassword }), { as: 'restorer' }), 'reset_confirm_required', 400)
      await refused(t, 'padded', () => world.api('POST', '/api/system/reset-section', sectionBody('suppliers', { confirm: ' RESET SUPPLIERS ', currentPassword: adminPassword }), { as: 'restorer' }), 'reset_confirm_required', 400)
    })

    await check('reset-section: the phrase without the acknowledgement is refused and nothing is deleted', async (t) => {
      await refused(t, 'not acknowledged', () => world.api('POST', '/api/system/reset-section', sectionBody('customers', { acknowledged: false, currentPassword: adminPassword }), { as: 'restorer' }), 'reset_acknowledgement_required', 400)
      await refused(t, 'acknowledgement missing', () => world.api('POST', '/api/system/reset-section', { section: 'customers', confirm: sectionPhrase.customers, currentPassword: adminPassword }, { as: 'restorer' }), 'reset_acknowledgement_required', 400)
    })

    await check('reset-section: the phrase check runs before the password check, so a wrong password with no phrase says so', async (t) => {
      await refused(t, 'no phrase, wrong password', () => world.api('POST', '/api/system/reset-section', { section: 'customers', currentPassword: 'not-the-password' }, { as: 'restorer' }), 'reset_confirm_required', 400)
    })

    const emptied = {
      customers: 'SELECT COUNT(*) AS n FROM customers',
      delivery_contacts: 'SELECT COUNT(*) AS n FROM delivery_contacts',
      audit_log: "SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'step_up_marker'",
    }
    for (const section of ['customers', 'delivery_contacts', 'audit_log']) {
      await check(`reset-section ${section}: its own phrase with the right password clears that section`, async (t) => {
        await seed()
        await world.run("INSERT INTO delivery_contacts (name) VALUES ('Step-up contact')")
        const response = await world.api('POST', '/api/system/reset-section', sectionBody(section, { currentPassword: adminPassword }), { as: 'restorer' })
        t.eq('status', response.status, 200)
        t.eq('success', response.json && response.json.success, true)
        t.eq('that section is empty', (await world.first(emptied[section])).n, 0)
      })
    }

    await check('reset-section: an unknown section is still a plain 400 before any password check', async (t) => {
      await clearRequestLimits()
      const response = await world.api('POST', '/api/system/reset-section', sectionBody('users', { currentPassword: adminPassword }), { as: 'restorer' })
      t.eq('status', response.status, 400)
    })

  } finally {
    finish('reset password step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
