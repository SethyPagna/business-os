// The two refusals the Settings write answers for online order timing (KHQR S5, G9): each has its own sentence in English and Khmer, with the bounds the Worker enforces,
// so a rejected save says what to fix instead of the generic "view details".
//
// Run: node tests/onlineOrderSettingsErrors.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { codedRejectionText, presentWriteError } from '../src/utils/writeErrorPresentation.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const pack = (name: string) => JSON.parse(fs.readFileSync(path.join(here, '..', 'src', 'lang', `${name}.json`), 'utf8')) as Record<string, string>
const en = pack('en')
const km = pack('km')
const CODES = [
  ['invalid_online_order_payment_minutes', 'write_rejected_online_order_payment_minutes', /from 3 to 60/, /3 ដល់ 60/],
  ['invalid_online_order_request_days', 'write_rejected_online_order_request_days', /from 1 to 30/, /1 ដល់ 30/],
  ['invalid_online_order_payment_method', 'write_rejected_online_order_payment_method', /configured payment methods/, /វិធីបង់ប្រាក់/],
  ['online_method_required', 'write_rejected_online_method_required', /Turn them off before clearing/, /បិទវាសិន/],
  ['online_method_admin_only', 'write_rejected_online_method_admin_only', /Only an administrator/, /អ្នកគ្រប់គ្រង/],
  ['online_order_method_is_cash', 'write_rejected_online_order_method_is_cash', /cannot be a cash method/, /សាច់ប្រាក់/],
  ['online_method_merge_refused', 'write_rejected_online_method_merge_refused', /cannot be merged/, /បញ្ចូល/],
  ['online_method_in_use_by_sales', 'write_rejected_online_method_in_use_by_sales', /already used by recent sales/, /ការលក់/],
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

test('KHQR round 6 N4: the online_method_admin_only code has its own English and Khmer text under both keys the app looks up', () => {
  // CATCHES: the Worker's English sentence reaching a Khmer screen, because neither the code key nor the write_rejected key was in the packs.
  for (const key of ['online_method_admin_only', 'write_rejected_online_method_admin_only']) {
    assert.match(en[key], /Only an administrator/)
    assert.match(km[key], /[ក-៿]/)
  }
})

test('KHQR round 6 N4: Save and clear on the online method field ask through the shared review dialog before writing, never the native confirm()', () => {
  // CATCHES: a write with no review (the owner's convention is one compact review dialog for every mutating action), window.confirm, and a dialog that answers after the write.
  const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'utils-settings', 'Settings.tsx'), 'utf8').split('\r\n').join('\n')
  const from = source.indexOf('const saveOnlineMethod = async')
  const body = source.slice(from, source.indexOf('\n  }\n', from))
  const ask = body.indexOf('await askToConfirm(')
  const write = body.indexOf('saveSettings(')
  assert.ok(ask > -1 && write > ask, 'the dialog is awaited before the settings save')
  assert.ok(/if \(!confirmed\) return/.test(body.slice(ask, write)), 'a Cancel writes nothing')
  assert.ok(!/window\.confirm|[^.\w]confirm\(/.test(body))
  assert.ok(/danger: clearing/.test(body), 'clearing is a danger ask')
  assert.ok(source.includes('onClick={() => void saveOnlineMethod(onlineMethodDraft)}') && source.includes("onClick={() => void saveOnlineMethod('')}"), 'both buttons go through saveOnlineMethod')
  for (const key of ['online_payment_method_confirm_set_title', 'online_payment_method_confirm_clear_title', 'online_payment_method_confirm_set_note', 'online_payment_method_confirm_clear_note']) {
    assert.ok(en[key], `en ${key}`)
    assert.match(km[key], /[ក-៿]/, `km ${key}`)
  }
})

test('KHQR round 7 D4: a refused payment-method rename or merge shows the pack sentence, not the Worker English', () => {
  // CATCHES: Settings.tsx showing error.message (English) on a Khmer screen for the codes the rename route answers.
  const workerEnglish = 'Another payment method cannot be merged into the online payment method.'
  for (const code of ['online_method_admin_only', 'online_method_merge_refused', 'online_order_method_is_cash']) {
    const error = Object.assign(new Error(workerEnglish), { code })
    const khmer = codedRejectionText(error, (k) => km[k])
    assert.ok(khmer && /[ក-៿]/.test(khmer) && khmer !== workerEnglish, `${code} reads Khmer`)
    assert.equal(codedRejectionText(error, (k) => en[k]), en[`write_rejected_${code}`])
  }
  assert.equal(codedRejectionText(Object.assign(new Error('x'), { code: 'write_conflict' }), (k) => en[k]), null)
  assert.equal(codedRejectionText(new Error('plain'), (k) => en[k]), null)
  const source = fs.readFileSync(path.join(here, '..', 'src', 'components', 'utils-settings', 'Settings.tsx'), 'utf8').split('\r\n').join('\n')
  assert.ok(source.includes('stepUpRefusalText(error, t) || codedRejectionText(error, t) ||'), 'the rename catch uses the pack text')
})
