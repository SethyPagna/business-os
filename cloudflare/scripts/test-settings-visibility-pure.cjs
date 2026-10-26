'use strict'
// lib/settingsVisibility.ts decides which settings rows an account may READ. The rule is a
// denylist, so the contract worth pinning is both halves: rows only the Settings screen reads are withheld from
// accounts without Settings access (tier full or view), and EVERY other key passes untouched, including keys that
// merely look related (a lookalike prefix, a longer name, the notification-bell switches).
//
// Real transpiled lib/settingsVisibility.ts over the real lib/permissions.ts, no engine.
// Run (from cloudflare/): node scripts/test-settings-visibility-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, dependencies = {}) {
  const filename = path.join(__dirname, '..', 'src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`unexpected dependency ${name} for ${relative}`)
  }, module, module.exports)
  return module.exports
}

const permissions = load('lib/permissions.ts')
const { canReadSettingKey, settingsReadableBy } = load('lib/settingsVisibility.ts', { './permissions': permissions, './settingsSensitive': load('lib/settingsSensitive.ts') })

const account = (granted, roleCode = 'staff') => ({ username: 'someone', role_code: roleCode, permissions: '{}', role_permissions: JSON.stringify(granted) })
const nobody = account({})
const cashier = account({ pos: true, sales: true, receipt_settings: true })
const settingsHolder = account({ settings: true })
const settingsViewer = account({ settings: 'view' })
const portalEditor = account({ customer_portal: true })
const portalPostsEditor = account({ portal_posts: true })
const admin = account({ all: true }, 'admin')

const SETTINGS_ONLY = ['telegram_chat_id', 'telegram_topic_sales', 'telegram_automation_enabled', 'telegram_language', 'telegram_summary_sales_enabled', 'audit_log_retention_days', 'drive_sync_enabled', 'drive_sync_folder_name', 'drive_sync_account_email']
const PORTAL_ASSISTANT = ['customer_portal_ai_prompt', 'customer_portal_ai_provider_id']
const NEVER_WITHHELD = ['business_name', 'tax_id', 'exchange_rate', 'receipt_template', 'pos_payment_methods', 'shift_scope_mode', 'loyalty_points_enabled', 'notifications_inventory_enabled', 'customer_portal_ai_enabled', 'customer_portal_ai_title', 'customer_portal_redeem_points', 'audit_log_page_size', 'telegramish_note', 'my_telegram_chat_id', 'drive_syncing']

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('an account with no Settings access cannot read any settings-only row or the assistant keys', () => {
  for (const who of [nobody, cashier, portalPostsEditor]) {
    for (const key of [...SETTINGS_ONLY, ...PORTAL_ASSISTANT]) assert.equal(canReadSettingKey(who, key), false, key)
  }
})

check('Settings access (full or view) and administrators read everything', () => {
  for (const who of [settingsHolder, settingsViewer, admin]) {
    for (const key of [...SETTINGS_ONLY, ...PORTAL_ASSISTANT, ...NEVER_WITHHELD]) assert.equal(canReadSettingKey(who, key), true, key)
  }
})

check('the customer_portal grant keeps only the two assistant keys it edits', () => {
  for (const key of PORTAL_ASSISTANT) assert.equal(canReadSettingKey(portalEditor, key), true, key)
  for (const key of SETTINGS_ONLY) assert.equal(canReadSettingKey(portalEditor, key), false, key)
})

check('a denylist never withholds a key it does not name, whoever asks', () => {
  for (const who of [nobody, cashier, portalEditor, portalPostsEditor]) {
    for (const key of NEVER_WITHHELD) assert.equal(canReadSettingKey(who, key), true, `${key} for a restricted account`)
  }
})

check('case and whitespace aliases of a withheld key are withheld too', () => {
  for (const key of ['Telegram_Chat_ID', ' telegram_topic_sales ', 'AUDIT_LOG_RETENTION_DAYS', 'Drive_Sync_Enabled', ' Customer_Portal_AI_Prompt ']) {
    assert.equal(canReadSettingKey(nobody, key), false, JSON.stringify(key))
  }
})

check('settingsReadableBy keeps values, drops only withheld rows, and does not touch its input', () => {
  const map = { business_name: 'Leang', telegram_chat_id: '-100', exchange_rate: '4100', customer_portal_ai_prompt: 'p', drive_sync_enabled: 'true' }
  const frozen = JSON.stringify(map)
  assert.deepEqual(settingsReadableBy(cashier, map), { business_name: 'Leang', exchange_rate: '4100' })
  assert.deepEqual(settingsReadableBy(portalEditor, map), { business_name: 'Leang', exchange_rate: '4100', customer_portal_ai_prompt: 'p' })
  assert.deepEqual(settingsReadableBy(settingsHolder, map), map)
  assert.equal(JSON.stringify(map), frozen)
  assert.deepEqual(settingsReadableBy(null, map), { business_name: 'Leang', exchange_rate: '4100' })
})

console.log(`\n${passed} check(s) passed.`)
