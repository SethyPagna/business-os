'use strict'
// GET /api/settings returned the whole settings table (minus secret-suffixed keys) to
// any signed-in account, so a role with nothing granted read the Telegram chat and topic ids, the Telegram report
// switches, the audit-retention window, Google Drive sync configuration and the website assistant's prompt.
//
// The fix is a DENYLIST (lib/settingsVisibility.ts), never an allowlist, because the POS, receipts, sales, returns,
// shifts, inventory, notifications bell, theme and storefront-loyalty displays all read the same map. Every key
// named below as VISIBLE has a non-Settings reader in frontend/src (see Records/Lanes/2026-10-13/
// CLAUDE-SEC-SETTINGS-RESET.md for the sweep table). A key is withheld from an account only when that account has
// no Settings access (tier full or view) and, for the website assistant's two private keys, no `customer_portal`
// grant either.
//
// Drives the REAL Worker under Miniflare on a fully migrated D1.
//
// Run (from cloudflare/): node scripts/test-settings-visibility-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const WITHHELD_FROM_NON_SETTINGS = {
  telegram_chat_id: '-1001234567890',
  telegram_topic_sales: '12',
  telegram_topic_shift: '7',
  telegram_automation_enabled: 'true',
  telegram_language: 'en',
  telegram_returns_enabled: 'true',
  telegram_summary_sales_enabled: 'true',
  audit_log_retention_days: '30',
  drive_sync_enabled: 'true',
  drive_sync_folder_name: 'BOS Backups',
  drive_sync_account_email: 'owner@example.test',
  customer_portal_ai_prompt: 'You are the shop assistant.',
  customer_portal_ai_provider_id: '3',
}
const PORTAL_PRIVATE = ['customer_portal_ai_prompt', 'customer_portal_ai_provider_id']

const VISIBLE_TO_EVERYONE = {
  business_name: 'Leang Cosmetics',
  business_phone: '012 345 678',
  business_address: 'Phnom Penh',
  business_email: 'shop@example.test',
  tax_id: 'K001-123456789',
  tax_rate: '10',
  tax_enabled: 'true',
  exchange_rate: '4100',
  change_exchange_rate: '4000',
  currency_usd_symbol: '$',
  currency_khr_symbol: 'R',
  display_currency: 'both',
  display_timezone: 'Asia/Phnom_Penh',
  language: 'km',
  default_landing_page: 'pos',
  receipt_template: '{"text_contrast":"normal"}',
  receipt_footer: 'Thank you',
  receipt_print_settings: '{"pageSizeMode":"driver-forms"}',
  pos_payment_methods: '["Cash","ABA"]',
  pos_show_item_discount: 'true',
  pos_wholesale_auto_enabled: 'true',
  sale_amendment_window_minutes: '0',
  low_stock_alert_enabled: 'true',
  low_stock_threshold_default: '5',
  low_stock_threshold_mode: 'global',
  ui_accent_color: '#2563eb',
  ui_font_size: '14',
  notifications_inventory_enabled: 'true',
  notifications_realert_minutes: '10',
  customer_portal_redeem_points: '100',
  customer_portal_redeem_value_usd: '1',
  customer_portal_points_per_usd: '1',
  customer_portal_logo_image: '/uploads/logo.png',
  product_brand_options: '["A"]',
  shift_scope_mode: 'per_account',
  shift_admin_exempt: 'true',
  loyalty_points_enabled: 'true',
}

const hasAll = (map, keys) => keys.every((key) => Object.prototype.hasOwnProperty.call(map || {}, key))
const hasAny = (map, keys) => keys.some((key) => Object.prototype.hasOwnProperty.call(map || {}, key))

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url') })
  const { check, finish } = createReporter()
  try {
    await world.account('nobody', { roleCode: 'sv_nobody', permissions: {} })
    await world.account('cashier', { roleCode: 'employee' })
    await world.account('configurer', { roleCode: 'sv_settings', permissions: { settings: true } })
    await world.account('auditor', { roleCode: 'sv_settings_view', permissions: { settings: 'view' } })
    await world.account('webmaster', { roleCode: 'sv_portal', permissions: { customer_portal: true } })
    await world.account('posts_editor', { roleCode: 'sv_portal_posts', permissions: { portal_posts: true } })
    for (const [key, value] of Object.entries({ ...WITHHELD_FROM_NON_SETTINGS, ...VISIBLE_TO_EVERYONE })) {
      await world.run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', key, value, '2026-01-01 00:00:00')
    }
    await world.run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'drive_sync_refresh_token', 'refresh-secret', '2026-01-01 00:00:00')
    await world.run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', 'telegram_chat_id', '-1001234567890', '2099-01-01 00:00:00')

    const withheld = Object.keys(WITHHELD_FROM_NON_SETTINGS)
    const visible = Object.keys(VISIBLE_TO_EVERYONE)

    for (const [label, as] of [['an account with no permission', 'nobody'], ['the Employee preset', 'cashier'], ['a portal-posts editor', 'posts_editor']]) {
      await check(`${label} gets no Telegram, audit-retention, Drive-sync or assistant-prompt setting`, async (t) => {
        const response = await world.api('GET', '/api/settings', undefined, { as })
        t.eq('status', response.status, 200)
        t.eq('withheld keys present', withheld.filter((key) => hasAny(response.json, [key])), [])
      })
      await check(`${label} still gets every key the POS, receipts, shifts, bell and theme read`, async (t) => {
        const response = await world.api('GET', '/api/settings', undefined, { as })
        t.eq('missing visible keys', visible.filter((key) => !hasAll(response.json, [key])), [])
        t.eq('values are intact', { business_name: response.json.business_name, exchange_rate: response.json.exchange_rate, receipt_footer: response.json.receipt_footer }, { business_name: 'Leang Cosmetics', exchange_rate: '4100', receipt_footer: 'Thank you' })
        t.ok('the version stamp is still there', typeof response.json.updatedAt === 'string', response.json.updatedAt)
      })
    }

    for (const [label, as] of [['a settings holder', 'configurer'], ['a view-only settings account', 'auditor'], ['the built-in admin', 'admin']]) {
      await check(`${label} still gets the full configuration`, async (t) => {
        const response = await world.api('GET', '/api/settings', undefined, { as })
        t.eq('status', response.status, 200)
        t.eq('missing withheld keys', withheld.filter((key) => !hasAll(response.json, [key])), [])
        t.eq('missing visible keys', visible.filter((key) => !hasAll(response.json, [key])), [])
        t.eq('secrets still never leave the Worker', hasAny(response.json, ['drive_sync_refresh_token']), false)
      })
    }

    // GET /api/auth/bootstrap hands the settings map to the same accounts at login, and must follow the same rule:
    // it once applied only the secret redaction, so every cashier received the Telegram ids, the report switches,
    // the Drive-sync configuration and the audit-retention window at sign-in.
    const bootstrapSettings = async (as) => {
      const response = await world.api('GET', '/api/auth/bootstrap', undefined, { as })
      return { status: response.status, settings: response.json && response.json.settings }
    }
    for (const [label, as] of [['an account with no permission', 'nobody'], ['the Employee preset', 'cashier'], ['a portal-posts editor', 'posts_editor']]) {
      await check(`bootstrap: ${label} gets no telegram_*, drive_sync_*, audit-retention or assistant-prompt setting`, async (t) => {
        const { status, settings } = await bootstrapSettings(as)
        t.eq('status', status, 200)
        t.eq('withheld keys present', withheld.filter((key) => hasAny(settings, [key])), [])
        t.eq('any telegram_/drive_sync_ key present', Object.keys(settings || {}).filter((key) => /^(telegram_|drive_sync_)/.test(key)), [])
      })
      await check(`bootstrap: ${label} still gets every key the POS, receipts, shifts, bell and theme read`, async (t) => {
        const { settings } = await bootstrapSettings(as)
        t.eq('missing visible keys', visible.filter((key) => !hasAll(settings, [key])), [])
        t.eq('values are intact', { business_name: settings.business_name, exchange_rate: settings.exchange_rate, receipt_footer: settings.receipt_footer }, { business_name: 'Leang Cosmetics', exchange_rate: '4100', receipt_footer: 'Thank you' })
      })
    }
    for (const [label, as] of [['a settings holder', 'configurer'], ['a view-only settings account', 'auditor'], ['the built-in admin', 'admin']]) {
      await check(`bootstrap: ${label} still gets the full configuration`, async (t) => {
        const { status, settings } = await bootstrapSettings(as)
        t.eq('status', status, 200)
        t.eq('missing withheld keys', withheld.filter((key) => !hasAll(settings, [key])), [])
        t.eq('missing visible keys', visible.filter((key) => !hasAll(settings, [key])), [])
        t.eq('secrets still never leave the Worker', hasAny(settings, ['drive_sync_refresh_token']), false)
      })
    }
    await check('bootstrap: a customer_portal holder keeps the website assistant keys and nothing else withheld', async (t) => {
      const { settings } = await bootstrapSettings('webmaster')
      t.eq('assistant keys present', hasAll(settings, PORTAL_PRIVATE), true)
      t.eq('other withheld keys present', withheld.filter((key) => !PORTAL_PRIVATE.includes(key) && hasAny(settings, [key])), [])
    })
    await check('bootstrap and GET /api/settings carry the same keys for every account (one rule, no drift)', async (t) => {
      for (const as of ['nobody', 'cashier', 'posts_editor', 'webmaster', 'configurer', 'auditor', 'admin']) {
        const boot = Object.keys((await bootstrapSettings(as)).settings || {}).sort()
        const direct = Object.keys((await world.api('GET', '/api/settings', undefined, { as })).json || {}).filter((key) => key !== 'updatedAt').sort()
        t.eq(`${as}: bootstrap keys equal settings keys`, boot, direct)
      }
    })

    await check('a customer_portal holder keeps the website assistant keys the Website Editor edits, and nothing else withheld', async (t) => {
      const response = await world.api('GET', '/api/settings', undefined, { as: 'webmaster' })
      t.eq('assistant keys present', hasAll(response.json, PORTAL_PRIVATE), true)
      t.eq('other withheld keys present', withheld.filter((key) => !PORTAL_PRIVATE.includes(key) && hasAny(response.json, [key])), [])
    })

    await check('/api/settings/meta does not echo the version of a withheld key to an account without Settings access', async (t) => {
      const asEmployee = await world.api('GET', '/api/settings/meta?keys=telegram_chat_id,business_name', undefined, { as: 'cashier' })
      t.eq('status', asEmployee.status, 200)
      t.eq('employee sees the visible key stamp only', asEmployee.json && asEmployee.json.updatedAt, '2026-01-01 00:00:00')
      const asAdmin = await world.api('GET', '/api/settings/meta?keys=telegram_chat_id,business_name', undefined, { as: 'admin' })
      t.eq('admin sees the newest of both', asAdmin.json && asAdmin.json.updatedAt, '2099-01-01 00:00:00')
    })

    await check('an Employee can still save a visible setting they were granted (receipt settings)', async (t) => {
      const response = await world.api('POST', '/api/settings', { receipt_footer: 'See you again' }, { as: 'cashier' })
      t.eq('status', response.status, 200)
      const after = await world.api('GET', '/api/settings', undefined, { as: 'cashier' })
      t.eq('read back', after.json && after.json.receipt_footer, 'See you again')
    })
  } finally {
    finish('settings visibility')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
