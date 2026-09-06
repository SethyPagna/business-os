import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// i18n:9, i18n:10, i18n:11, i18n:15 — the OptionEditor-shaped contact-option
// block in DeliveryTab.tsx, SuppliersTab.tsx, and CustomerFormModal.tsx (and
// the contacts select-all checkbox in shared.tsx) hardcoded English
// placeholders, labels and aria text instead of routing them through t().
// SuppliersTab in particular never called t() in that block at all, so
// Khmer mode fell back to raw English for every field. This test pins the
// fix at the source level (no hardcoded literal survives) and confirms both
// language packs carry a real value for every key the fix introduces.
//
// Against base 6e3abfea this test is RED: the literals are hardcoded and
// none of the contact_option_ / delivery_option_ / *_option_address keys
// exist in either pack yet.

const FRONTEND = fileURLToPath(new URL('..', import.meta.url))
const read = (rel: string): string => fs.readFileSync(path.join(FRONTEND, rel), 'utf8')

const enPack = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const kmPack = JSON.parse(read('src/lang/km.json')) as Record<string, string>

function assertTranslated(key: string, expectedEnglish: string): void {
  assert.equal(enPack[key], expectedEnglish, `en.json['${key}'] should hold the original English copy`)
  const km = kmPack[key]
  assert.ok(typeof km === 'string' && km.trim().length > 0, `km.json must carry a non-empty '${key}'`)
  assert.notEqual(km, expectedEnglish, `km.json['${key}'] must be real Khmer, not the English fallback`)
  assert.ok(/[ក-៿]/.test(km), `km.json['${key}'] must contain Khmer script, got: ${km}`)
}

// --- DeliveryTab.tsx: the six hardcoded strings named in the audit -------
const deliveryTab = read('src/components/contacts/DeliveryTab.tsx')

assert.ok(!deliveryTab.includes('>Delivery option label<') && !/className="sr-only">Delivery option label</.test(deliveryTab),
  'DeliveryTab option-label sr-only text must not be hardcoded English')
assert.ok(deliveryTab.includes("t('delivery_option_label_sr')"), 'DeliveryTab must translate the option-label sr-only text')

assert.ok(!deliveryTab.includes('placeholder="Label (e.g. Morning Shift, Zone A)"'),
  'DeliveryTab label placeholder must not be hardcoded English')
assert.ok(deliveryTab.includes("t('delivery_option_label_placeholder')"), 'DeliveryTab must translate the label placeholder')

assert.ok(!deliveryTab.includes('aria-label="Remove delivery option"'),
  'DeliveryTab remove-option aria-label must not be hardcoded English')
assert.ok(deliveryTab.includes("t('delivery_option_remove_aria')"), 'DeliveryTab must translate the remove-option aria-label')

assert.ok(!deliveryTab.includes('placeholder="Driver / rider name"'),
  'DeliveryTab driver-name placeholder must not be hardcoded English')
assert.ok(deliveryTab.includes("t('delivery_option_name_placeholder')"), 'DeliveryTab must translate the driver-name placeholder')

assert.ok(!deliveryTab.includes('placeholder="Coverage area or zone"'),
  'DeliveryTab area placeholder must not be hardcoded English')
assert.ok(deliveryTab.includes("t('delivery_option_area_placeholder')"), 'DeliveryTab must translate the area placeholder')

assert.ok(!deliveryTab.includes('<p className="text-xs text-gray-400">Provide driver name or phone number.</p>'),
  'DeliveryTab hint text must not be hardcoded English')
assert.ok(deliveryTab.includes("t('delivery_option_hint')"), 'DeliveryTab must translate the hint text')

// The OptionEditor sub-component must actually receive `t` to translate with.
assert.ok(/function OptionEditor\(\{[^}]*\bt\b[^}]*\}: OptionEditorProps\)/.test(deliveryTab),
  'DeliveryTab OptionEditor must accept a t prop')

assertTranslated('delivery_option_label_sr', 'Delivery option label')
assertTranslated('delivery_option_label_placeholder', 'Label (e.g. Morning Shift, Zone A)')
assertTranslated('delivery_option_remove_aria', 'Remove delivery option')
assertTranslated('delivery_option_name_placeholder', 'Driver / rider name')
assertTranslated('delivery_option_area_placeholder', 'Coverage area or zone')
assertTranslated('delivery_option_hint', 'Provide driver name or phone number.')

// --- SuppliersTab.tsx: the file never called t() in this block at all ----
const suppliersTab = read('src/components/contacts/SuppliersTab.tsx')

for (const literal of [
  'placeholder="Option label"',
  '>Remove</button>',
  'placeholder="Contact name"',
  'placeholder="Email address"',
  'placeholder="Office or pickup address"',
]) {
  assert.ok(!suppliersTab.includes(literal), `SuppliersTab must not hardcode ${literal}`)
}
assert.ok(suppliersTab.includes("t('contact_option_label')"), 'SuppliersTab must translate the option label placeholder')
assert.ok(suppliersTab.includes("t('remove')"), 'SuppliersTab must translate the Remove button')
assert.ok(suppliersTab.includes("t('contact_option_name')"), 'SuppliersTab must translate the contact-name placeholder')
assert.ok(suppliersTab.includes("t('contact_option_email')"), 'SuppliersTab must translate the email placeholder')
assert.ok(suppliersTab.includes("t('supplier_option_address')"), 'SuppliersTab must translate the address placeholder')

assertTranslated('contact_option_label', 'Option label')
assertTranslated('contact_option_name', 'Contact name')
assertTranslated('contact_option_email', 'Email address')
assertTranslated('supplier_option_address', 'Office or pickup address')

// --- CustomerFormModal.tsx: same shape, file already uses tr() elsewhere --
const customerForm = read('src/components/contacts/CustomerFormModal.tsx')

for (const literal of [
  'placeholder="Option label"',
  'placeholder="Contact name"',
  'placeholder="Email address"',
  'placeholder="Delivery or billing address"',
]) {
  assert.ok(!customerForm.includes(literal), `CustomerFormModal must not hardcode ${literal}`)
}
assert.ok(customerForm.includes("tr(t, 'contact_option_label', 'Option label')"), 'CustomerFormModal must translate the option label placeholder')
assert.ok(customerForm.includes("tr(t, 'remove', 'Remove')"), 'CustomerFormModal must translate the Remove button')
assert.ok(customerForm.includes("tr(t, 'contact_option_name', 'Contact name')"), 'CustomerFormModal must translate the contact-name placeholder')
assert.ok(customerForm.includes("tr(t, 'contact_option_email', 'Email address')"), 'CustomerFormModal must translate the email placeholder')
assert.ok(customerForm.includes("tr(t, 'customer_option_address', 'Delivery or billing address')"), 'CustomerFormModal must translate the address placeholder')

// OptionEditor must receive t and the call site must pass it through.
assert.ok(/function OptionEditor\(\{[^}]*\bt\b[^}]*\}: OptionEditorProps\)/.test(customerForm),
  'CustomerFormModal OptionEditor must accept a t prop')
assert.match(customerForm, /<OptionEditor[\s\S]{0,400}?t=\{t\}/, 'CustomerFormModal must pass t into OptionEditor')

assertTranslated('customer_option_address', 'Delivery or billing address')

// --- shared.tsx:424 — the contacts select-all checkbox aria-label --------
const sharedContacts = read('src/components/contacts/shared.tsx')
assert.ok(!sharedContacts.includes('aria-label="Select all contacts"'),
  'shared.tsx select-all checkbox aria-label must not be hardcoded English')
assert.ok(sharedContacts.includes("aria-label={t?.('select_all')"), "shared.tsx must translate the select-all checkbox via t('select_all')")

console.log('contactsOptionEditorI18n tests passed')
