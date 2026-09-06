import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// i18n:4 / i18n:5 -- Settings.tsx shipped two mini-sections as hardcoded
// English literals instead of t() lookups:
//
//   - Shift registration (gated on canEditSettings, not isAdmin -- reachable
//     by any full-settings role): title/description, the sr-only "Shift
//     scope" legend, the per-account/shop-wide labels+hints, and "Exempt
//     administrators" + its sentence. The shift_scope_per_account /
//     shift_scope_shop_wide keys already existed translated but were never
//     called.
//   - Telegram automation (isAdmin-gated -- that gate is not an i18n
//     exemption): title/description, the enable toggle, the chat-ID label +
//     placeholder, and the bot-token label + status text.
//
// A Khmer-language shop with either role sees raw English for all of this.
// This test fails on 6e3abfea (the literals are still inline, the keys don't
// exist / aren't wired) and passes once each string routes through t(key)
// with a real, non-English Khmer translation in both packs.

const ROOT = new URL('../', import.meta.url)
const rootPath = fileURLToPath(ROOT)

const src = fs.readFileSync(
  path.join(rootPath, 'src/components/utils-settings/Settings.tsx'),
  'utf8',
)
const en = JSON.parse(fs.readFileSync(path.join(rootPath, 'src/lang/en.json'), 'utf8')) as Record<string, unknown>
const km = JSON.parse(fs.readFileSync(path.join(rootPath, 'src/lang/km.json'), 'utf8')) as Record<string, unknown>

// --- Shift registration mini-section --------------------------------------

const shiftHardcodedLiterals = [
  'title="Shift registration"',
  'description="Configure who must register the cash drawer each business day."',
  '>Shift registration<',
  '>Choose whether each account opens its own shift or one shared branch shift covers the whole shop.<',
  '<legend className="sr-only">Shift scope</legend>',
  "['per_account', 'Per account', 'Each staff account opens and closes its own daily shift.']",
  "['shop_wide', 'Shop-wide', 'One staff member opens the branch shift and any staff member can close it.']",
  '>Exempt administrators<',
  '>Administrators can enter POS without opening a shift. Turn this off when administrators also operate a cash drawer.<',
]
for (const literal of shiftHardcodedLiterals) {
  assert.ok(!src.includes(literal), `Settings.tsx still hardcodes shift-registration text: ${JSON.stringify(literal)}`)
}

const shiftKeys = [
  'settings_shift_registration_title',
  'settings_shift_registration_desc',
  'settings_shift_scope_legend',
  'settings_shift_scope_desc',
  'shift_scope_per_account',
  'shift_scope_per_account_hint',
  'shift_scope_shop_wide',
  'shift_scope_shop_wide_hint',
  'settings_shift_exempt_admins',
  'settings_shift_exempt_admins_desc',
]

// --- Telegram automation mini-section --------------------------------------

const telegramHardcodedLiterals = [
  'title="Telegram automation"',
  'description="Send business activity to one owner/manager Telegram chat. Every category is on by default; turn off any category you do not want."',
  '>Enable Telegram automation<',
  '>Turns every selected Telegram message on or off.<',
  '>Telegram chat ID<',
  'placeholder="Example: -1001234567890"',
  '>Bot token<',
  "telegramStatus?.configured ? 'Configured securely on the server.' : 'Not configured on the server yet.'",
]
for (const literal of telegramHardcodedLiterals) {
  assert.ok(!src.includes(literal), `Settings.tsx still hardcodes Telegram-automation text: ${JSON.stringify(literal)}`)
}

const telegramKeys = [
  'telegram_automation_title',
  'telegram_automation_desc',
  'telegram_automation_enable',
  'telegram_automation_enable_desc',
  'telegram_chat_id_label',
  'telegram_chat_id_placeholder',
  'telegram_bot_token_label',
  'telegram_bot_token_configured',
  'telegram_bot_token_not_configured',
]

for (const key of [...shiftKeys, ...telegramKeys]) {
  assert.ok(
    src.includes(`t('${key}')`) || src.includes(`t("${key}")`),
    `Settings.tsx must call t('${key}')`,
  )
  const enVal = en[key]
  const kmVal = km[key]
  assert.ok(typeof enVal === 'string' && enVal.length > 0, `en.json missing non-empty '${key}'`)
  assert.ok(typeof kmVal === 'string' && kmVal.length > 0, `km.json missing non-empty '${key}'`)
  assert.notEqual(kmVal, enVal, `km.json '${key}' looks untranslated (identical to the English value)`)
}

console.log(
  'PASS Settings.tsx shift-registration and Telegram-automation mini-sections route through t() with real Khmer text (i18n:4, i18n:5)',
)
