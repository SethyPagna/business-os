'use strict'
// POST /api/system/reset-data (sales, products, all) and POST /api/system/reset-section needed
// only the typed phrase, never the caller's password, so a hijacked or unattended admin session could wipe data
// without re-authenticating. Both now demand the current password (and so do the other destructive maintenance
// routes: finalize-migration zero_stock / park_lots and the forced import-orphan cleanup), checked through lib/currentPasswordGuard.ts
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
      const row = await world.first("SELECT user_name, entity_id, details FROM audit_logs WHERE action = 'step_up_refused' ORDER BY id DESC LIMIT 1")
      t.eq('the refusal is on the audit trail with the route and the reason', row && [row.user_name, row.entity_id, JSON.parse(row.details).reason], ['restorer', '/api/system/reset-data', 'reset_builtin_admin_only'])
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


    const FINALIZE = '/api/system/finalize-migration'
    const ORPHANS = '/api/system/import-retention/orphans'
    const seedFinalize = async () => {
      await clearRequestLimits()
      await world.run("DELETE FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM product_batches WHERE batch_key = 'BK-STEPUP-HIST')")
      await world.run("DELETE FROM product_batches WHERE batch_key = 'BK-STEPUP-HIST'")
      await world.run("UPDATE products SET stock_quantity = 0 WHERE name = 'Finalize product'")
      await world.run("DELETE FROM branch_stock WHERE product_id IN (SELECT id FROM products WHERE name = 'Finalize product')")
      await world.run("DELETE FROM products WHERE name = 'Finalize product'")
      const branch = await world.first('SELECT id FROM branches ORDER BY id LIMIT 1')
      await world.run("INSERT INTO products (name, stock_quantity) VALUES ('Finalize product', 9)")
      const product = await world.first("SELECT id FROM products WHERE name = 'Finalize product'")
      await world.run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (?, ?, 9)', product.id, branch.id)
      await world.run("INSERT INTO product_batches (variant_product_id, batch_key, lot_code, notes, is_active) VALUES (?, 'BK-STEPUP-HIST', 'LOT-STEPUP', 'Unified stock import job-1, row 1', 1)", product.id)
      const batch = await world.first("SELECT id FROM product_batches WHERE batch_key = 'BK-STEPUP-HIST'")
      await world.run('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, ?, 8)', batch.id, branch.id)
    }
    const stockSnapshot = async () => ({
      branchStock: (await world.first('SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock')).n,
      productStock: (await world.first('SELECT COALESCE(SUM(stock_quantity), 0) AS n FROM products')).n,
      lot: (await world.first("SELECT quantity FROM branch_batch_stock WHERE batch_id = (SELECT id FROM product_batches WHERE batch_key = 'BK-STEPUP-HIST')")).quantity,
    })
    async function finalizeRefused(t, label, step, extra, code) {
      await seedFinalize()
      const before = await stockSnapshot()
      t.ok(`${label}: the seeded stock is non-zero`, before.branchStock > 0 && before.productStock > 0 && before.lot > 0, before)
      const response = await world.api('POST', FINALIZE, { step, ...extra }, { as: 'restorer' })
      t.eq(`${label}: status`, response.status, 403)
      t.eq(`${label}: code`, response.json && response.json.code, code)
      t.eq(`${label}: nothing zeroed`, await stockSnapshot(), before)
    }

    await check('finalize-migration zero_stock: no password is refused and no stock is zeroed', async (t) => {
      await finalizeRefused(t, 'no password', 'zero_stock', {}, 'current_password_required')
    })

    await check('finalize-migration zero_stock: a wrong password is refused and no stock is zeroed', async (t) => {
      await finalizeRefused(t, 'wrong password', 'zero_stock', { currentPassword: 'not-the-password' }, 'incorrect_password')
    })

    await check('finalize-migration park_lots: no password is refused and no lot is parked', async (t) => {
      await finalizeRefused(t, 'no password', 'park_lots', {}, 'current_password_required')
    })

    await check('finalize-migration park_lots: a wrong password is refused and no lot is parked', async (t) => {
      await finalizeRefused(t, 'wrong password', 'park_lots', { currentPassword: 'not-the-password' }, 'incorrect_password')
    })

    await check('finalize-migration: an unknown step is still a plain 400 before any password check', async (t) => {
      await clearRequestLimits()
      const response = await world.api('POST', FINALIZE, { step: 'nuke_everything' }, { as: 'restorer' })
      t.eq('status', response.status, 400)
    })

    await check('finalize-migration park_lots: the right password still parks the historical lot', async (t) => {
      await seedFinalize()
      const before = await stockSnapshot()
      const response = await world.api('POST', FINALIZE, { step: 'park_lots', currentPassword: adminPassword }, { as: 'restorer' })
      t.eq('status', response.status, 200)
      t.eq('success', response.json && response.json.success, true)
      t.eq('lot parked', (await stockSnapshot()).lot, 0)
      t.eq('live stock untouched', { branchStock: (await stockSnapshot()).branchStock, productStock: (await stockSnapshot()).productStock }, { branchStock: before.branchStock, productStock: before.productStock })
    })

    await check('finalize-migration zero_stock: the right password still zeroes the live counts', async (t) => {
      await seedFinalize()
      const response = await world.api('POST', FINALIZE, { step: 'zero_stock', currentPassword: adminPassword }, { as: 'restorer' })
      t.eq('status', response.status, 200)
      t.eq('success', response.json && response.json.success, true)
      const after = await stockSnapshot()
      t.eq('branch stock zeroed', after.branchStock, 0)
      t.eq('product stock zeroed', after.productStock, 0)
    })

    const seedOrphan = async () => {
      await clearRequestLimits()
      await world.run("DELETE FROM import_job_files WHERE job_id = 'orphan-stepup-job'")
      await world.run("INSERT INTO import_job_files (job_id, kind, stored_path) VALUES ('orphan-stepup-job', 'upload', 'imports/orphan-stepup-job/a.csv')")
    }
    const orphanRows = async () => (await world.first("SELECT COUNT(*) AS n FROM import_job_files WHERE job_id = 'orphan-stepup-job'")).n

    await check('import-retention orphans: the dry-run report needs no password and deletes nothing', async (t) => {
      await seedOrphan()
      for (const body of [{}, { dry_run: true, force: true }, { force: true }, { dry_run: false }]) {
        const response = await world.api('POST', ORPHANS, body, { as: 'restorer' })
        t.eq(`${JSON.stringify(body)}: status`, response.status, 200)
        t.eq(`${JSON.stringify(body)}: stays a dry run`, response.json && response.json.dry_run, true)
      }
      t.eq('the orphan is still there', await orphanRows(), 1)
    })

    await check('import-retention orphans: the forced delete without a password is refused and deletes nothing', async (t) => {
      await seedOrphan()
      const response = await world.api('POST', ORPHANS, { dry_run: false, force: true }, { as: 'restorer' })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'current_password_required')
      t.eq('the orphan is still there', await orphanRows(), 1)
    })

    await check('import-retention orphans: the forced delete with a wrong password is refused and deletes nothing', async (t) => {
      await seedOrphan()
      const response = await world.api('POST', ORPHANS, { dry_run: false, force: true, currentPassword: 'not-the-password' }, { as: 'restorer' })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'incorrect_password')
      t.eq('the orphan is still there', await orphanRows(), 1)
    })

    await check('import-retention orphans: the forced delete with the right password still clears the orphan', async (t) => {
      await seedOrphan()
      const response = await world.api('POST', ORPHANS, { dry_run: false, force: true, currentPassword: adminPassword }, { as: 'restorer' })
      t.eq('status', response.status, 200)
      t.eq('applied', response.json && response.json.dry_run, false)
      t.eq('the orphan is gone', await orphanRows(), 0)
    })

    await check('import-retention orphans: an account without backup_restore is refused before anything else', async (t) => {
      await seedOrphan()
      const response = await world.api('POST', ORPHANS, { dry_run: false, force: true, currentPassword: adminPassword }, { as: 'nobody' })
      t.eq('status', response.status, 403)
      t.eq('the orphan is still there', await orphanRows(), 1)
    })

  } finally {
    finish('reset password step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
