'use strict'
// GET /api/settings/payment-methods/unregistered and GET .../impact answered any
// signed-in account, while their write twins (POST .../backfill and .../replace) need `sales_policy` or `settings`.
// The reads disclose which payment labels the shop's sales use and the count and ids of sales with malformed payment
// details, so they now ask for at least the VIEW tier of `sales_policy` or `settings`. The writes keep needing the full grant.
//
// Drives the REAL Worker under Miniflare on a fully migrated D1, with a zero-permission account, the seeded Employee
// preset, a `sales_policy` holder, a `settings` holder and the built-in admin.
//
// Run (from cloudflare/): node scripts/test-payment-method-read-gate-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const UNREGISTERED = '/api/settings/payment-methods/unregistered'
const IMPACT = '/api/settings/payment-methods/impact?from=Cash&to=Bank'

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url') })
  const { check, finish } = createReporter()
  try {
    await world.account('nobody', { roleCode: 'pm_nobody', permissions: {} })
    await world.account('cashier', { roleCode: 'employee' })
    await world.account('pricer', { roleCode: 'pm_sales_policy', permissions: { sales_policy: true } })
    await world.account('configurer', { roleCode: 'pm_settings', permissions: { settings: true } })
    await world.account('auditor', { roleCode: 'pm_settings_view', permissions: { settings: 'view' } })
    await world.account('pricer_view', { roleCode: 'pm_sales_policy_view', permissions: { sales_policy: 'view' } })
    await world.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('pos_payment_methods', '[\"Cash\",\"ABA\"]', '2026-10-01 00:00:00')")
    await world.run("INSERT INTO sales (receipt_number, payment_method, total_usd) VALUES ('PM-1', 'Wing', 5)")

    for (const [label, as] of [['an account with no permission', 'nobody'], ['the Employee preset', 'cashier']]) {
      await check(`${label} cannot list unregistered payment methods`, async (t) => {
        const response = await world.api('GET', UNREGISTERED, undefined, { as })
        t.eq('status', response.status, 403)
        t.ok('no payment label in the body', !/Wing/.test(response.text), response.text)
      })
      await check(`${label} cannot read the payment-method rename impact`, async (t) => {
        const response = await world.api('GET', IMPACT, undefined, { as })
        t.eq('status', response.status, 403)
      })
    }

    for (const [label, as] of [['a sales_policy holder', 'pricer'], ['a settings holder', 'configurer'], ['a view-only settings account', 'auditor'], ['the built-in admin', 'admin']]) {
      await check(`${label} still lists unregistered payment methods`, async (t) => {
        const response = await world.api('GET', UNREGISTERED, undefined, { as })
        t.eq('status', response.status, 200)
        t.eq('configured', response.json && response.json.configured, ['Cash', 'ABA'])
        t.eq('missing', response.json && response.json.missing, ['Wing'])
      })
      await check(`${label} still reads the rename impact`, async (t) => {
        const response = await world.api('GET', IMPACT, undefined, { as })
        t.eq('status', response.status, 200)
        t.eq('from', response.json && response.json.from, 'Cash')
        t.eq('to', response.json && response.json.to, 'Bank')
      })
    }

    await check('a view-only settings account still cannot change payment methods', async (t) => {
      const backfill = await world.api('POST', '/api/settings/payment-methods/backfill', {}, { as: 'auditor' })
      t.eq('backfill status', backfill.status, 403)
      const replace = await world.api('POST', '/api/settings/payment-methods/replace', { from: 'Cash', to: 'Bank', scope: 'settings_only' }, { as: 'auditor' })
      t.eq('replace status', replace.status, 403)
      const stored = await world.first("SELECT value FROM settings WHERE key = 'pos_payment_methods'")
      t.eq('configured list untouched', stored && stored.value, '["Cash","ABA"]')
    })

    await check('sales_policy has no view tier, so a stored view value grants nothing', async (t) => {
      const response = await world.api('GET', UNREGISTERED, undefined, { as: 'pricer_view' })
      t.eq('status', response.status, 403)
    })
  } finally {
    finish('payment-method read gate')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
