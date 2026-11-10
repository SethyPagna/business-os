// The two refusals the Settings write answers for online order timing (KHQR S5, G9): each has its own sentence in English and Khmer, with the bounds the Worker enforces,
// so a rejected save says what to fix instead of the generic "view details".
//
// Run: node tests/onlineOrderSettingsErrors.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { presentWriteError } from '../src/utils/writeErrorPresentation.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const pack = (name: string) => JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', `${name}.json`), 'utf8')) as Record<string, string>
const en = pack('en')
const km = pack('km')
const CODES = [
  ['invalid_online_order_payment_minutes', 'write_rejected_online_order_payment_minutes', /from 3 to 60/, /3 ដល់ 60/],
  ['invalid_online_order_request_days', 'write_rejected_online_order_request_days', /from 1 to 30/, /1 ដល់ 30/],
  ['invalid_online_order_payment_method', 'write_rejected_online_order_payment_method', /configured payment methods/, /វិធីបង់ប្រាក់/],
  ['online_method_required', 'write_rejected_online_method_required', /Turn them off before clearing/, /បិទវាសិន/],
  ['online_order_method_is_cash', 'write_rejected_online_order_method_is_cash', /cannot be a cash method/, /សាច់ប្រាក់/],
  ['online_method_merge_refused', 'write_rejected_online_method_merge_refused', /cannot be merged/, /បញ្ចូល/],
] as const

test('each settings refusal shows its own sentence in both languages, not the generic one', () => {
  // CATCHES: the generic "View details" for a refusal the operator can fix, one code sharing the other's sentence, English left in km.json.
  const generic = presentWriteError({ code: 'something_else' }, (key) => en[key]).detail
  for (const [code, key, enBounds, kmBounds] of CODES) {
    const english = presentWriteError({ code }, (k) => en[k]).detail
    const khmer = presentWriteError({ code }, (k) => km[k]).detail
    assert.notEqual(english, generic, `${code} has its own English sentence`)
    assert.match(english, enBounds)
    assert.match(khmer, /[ក-៿]/)
    assert.match(khmer, kmBounds)
    assert.equal(english, en[key])
    assert.equal(khmer, km[key])
  }
  assert.notEqual(en[CODES[0][1]], en[CODES[1][1]])
})

test('the sentences quote the bounds the Worker enforces', () => {
  // CATCHES: a pack that says 5 to 120 minutes while the Worker refuses anything outside 3 to 60. Read from the Worker source when this tree has it.
  const source = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'onlineOrders.ts')
  if (!fs.existsSync(source)) return
  const text = fs.readFileSync(source, 'utf8')
  const bound = (name: string) => Number(new RegExp(`export const ${name} = (\d+)`).exec(text)?.[1])
  if (!Number.isFinite(bound('PAYMENT_MINUTES_MAX'))) return
  assert.match(en.write_rejected_online_order_payment_minutes, new RegExp(`from ${bound('PAYMENT_MINUTES_MIN')} to ${bound('PAYMENT_MINUTES_MAX')}`))
  assert.match(en.write_rejected_online_order_request_days, new RegExp(`from 1 to ${bound('REQUEST_WINDOW_DAYS_MAX')}`))
})

test('Settings has an admin-only field that sets the online payment method through the normal settings save', () => {
  // CATCHES: online ordering that cannot be switched on because nothing in the app can store the method; a second write path around the Settings save; English-only labels.
  const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'utils-settings', 'Settings.tsx'), 'utf8').split('\r\n').join('\n')
  const sectionAt = source.indexOf("{isAdmin && showSettingsSection('business') ? (")
  const fieldAt = source.indexOf('id="settings-online-payment-method"')
  assert.ok(sectionAt > -1 && fieldAt > sectionAt, 'the field sits in the admin-only payment section')
  assert.ok(source.includes('saveSettings(\n        { online_order_payment_method: method }'), 'the field saves through saveSettings')
  assert.ok(source.includes("title={t('online_payment_method_clear')"), 'the clear button is icon-only with a translated tooltip')
  for (const key of ['online_payment_method_label', 'online_payment_method_hint', 'online_payment_method_not_set', 'online_payment_method_saved', 'online_payment_method_clear']) {
    assert.ok(en[key], `en ${key}`)
    assert.match(km[key], /[ក-៿]/, `km ${key}`)
  }
})

