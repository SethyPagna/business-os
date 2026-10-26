'use strict'
// POST /api/settings/payment-methods/replace with scope "linked" rewrites the payment method on past sales, so
// it needs the caller's current password like the other destructive routes (lib/destructiveStepUp.ts).
//   - no password / wrong password: refused 403, sales and the configured list untouched, audited as step_up_refused;
//   - right password: renames the method on the linked sale;
//   - settings_only (no sale is touched) keeps working without a password;
//   - a caller without the settings permission is refused before the password is even read.
// Drives the REAL Worker under Miniflare on a fully migrated D1.
//
// Run (from cloudflare/): node scripts/test-payment-method-replace-step-up-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const REPLACE = '/api/settings/payment-methods/replace'

async function main() {
  const adminPassword = randomBytes(12).toString('base64url')
  const world = await bootWorld({ adminPassword })
  const { check, finish } = createReporter()
  try {
    await world.account('no_settings', { roleCode: 'no_settings_role', permissions: { sales: true }, passwordHash: world.adminPasswordHash })
    await world.run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('pos_payment_methods', '["Cash","ABA","Wing"]', '2026-09-05T08:00:00.000Z')`)
    await world.run("INSERT INTO sales (receipt_number, total_usd, payment_method) VALUES ('PM-STEPUP-1', 5, 'Wing')")

    const saleMethod = async () => (await world.first("SELECT payment_method AS m FROM sales WHERE receipt_number = 'PM-STEPUP-1'"))?.m
    const configured = async () => (await world.first("SELECT value FROM settings WHERE key = 'pos_payment_methods'"))?.value
    const post = (body, as = 'admin') => world.api('POST', REPLACE, body, { as })

    await check('a linked rename without a password is refused and changes nothing', async (t) => {
      const response = await post({ from: 'Wing', to: 'Wing Bank', scope: 'linked' })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'current_password_required')
      t.eq('sale', await saleMethod(), 'Wing')
      t.eq('list', await configured(), '["Cash","ABA","Wing"]')
    })

    await check('a linked rename with a wrong password is refused and changes nothing', async (t) => {
      const response = await post({ from: 'Wing', to: 'Wing Bank', scope: 'linked', currentPassword: 'not-the-password' })
      t.eq('status', response.status, 403)
      t.eq('code', response.json && response.json.code, 'incorrect_password')
      t.eq('sale', await saleMethod(), 'Wing')
      t.eq('list', await configured(), '["Cash","ABA","Wing"]')
    })

    await check('a non-string password is refused like a missing one', async (t) => {
      for (const currentPassword of [123, true, ['x'], { p: 1 }, '']) {
        const response = await post({ from: 'Wing', to: 'Wing Bank', scope: 'linked', currentPassword })
        t.eq(`${JSON.stringify(currentPassword)}: status`, response.status, 403)
      }
      t.eq('sale', await saleMethod(), 'Wing')
    })

    await check('a caller without the settings permission is refused before the password is read', async (t) => {
      const response = await post({ from: 'Wing', to: 'Wing Bank', scope: 'linked', currentPassword: adminPassword }, 'no_settings')
      t.ok('refused', response.status === 403 || response.status === 401, response.status)
      t.eq('sale', await saleMethod(), 'Wing')
    })

    await check('the refusals are on the audit trail with the route and the reason, never the password', async (t) => {
      const rows = await world.query("SELECT entity_id, details FROM audit_logs WHERE action = 'step_up_refused' ORDER BY id")
      const mine = rows.filter((row) => row.entity_id === REPLACE)
      t.ok('refusals recorded', mine.length >= 2, rows)
      t.ok('reasons', mine.slice(0, 2).map((row) => JSON.parse(row.details).reason).join() === 'current_password_required,incorrect_password', mine)
      t.ok('no password in the trail', !JSON.stringify(rows).includes(adminPassword) && !JSON.stringify(rows).includes('not-the-password'), rows)
    })

    await check('a settings-only rename needs no password because no sale is rewritten', async (t) => {
      const response = await post({ from: 'ABA', to: 'ABA Pay', scope: 'settings_only' })
      t.eq('status', response.status, 200)
      t.eq('sale', await saleMethod(), 'Wing')
    })

    await check('control: a linked rename with the right password rewrites the sale and the list', async (t) => {
      const response = await post({ from: 'Wing', to: 'Wing Bank', scope: 'linked', currentPassword: adminPassword })
      t.eq('status', response.status, 200)
      t.eq('sale', await saleMethod(), 'Wing Bank')
      t.ok('list renamed', /Wing Bank/.test(await configured()), await configured())
    })
  } finally {
    finish('payment-method replace step-up')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
