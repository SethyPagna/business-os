// P2.8-F (3 Nov 2026): a contact save sends a phone field only when the person changed it.
//
// An account without "See full phone numbers" is shown 012 *** 678 and the edit form fills its phone boxes from that. Sending the
// masks back on a notes-only save made the Worker work out which stored number each hides; two numbers that share their first and
// last three digits, on options without a unique label, cannot be told apart, so the Worker refuses the save (400
// masked_phone_input, right) although the person never touched a number. The forms now say which phone fields are untouched and the
// PUT leaves them out; the Worker reads an absent field as "unchanged" (cloudflare/scripts/test-phone-write-guard-native.cjs).
//
// Part 1 the rule itself. Part 2 the save sites: every update of a customer, supplier or delivery contact (the Contacts tabs, the
// POS / sale customer sheet, and the undo and redo of each) goes through it, and no create does. Part 3 the Worker half: an absent
// key is not picked, so it is not written.
//
// Run: node tests/contactPhoneFieldsUntouched.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ALL_PHONE_FIELDS_SENT, undoNeedsHiddenPhone, untouchedPhoneFields, withoutUntouchedPhoneFields } from '../src/components/contacts/contactPhoneFields.ts'
import { serializeContactOptions } from '../src/components/contacts/contactOptionUtils.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

// ---- Part 1: the rule ------------------------------------------------------------------------------------------------------
// Two options with no label, whose masks are the same (they share the first and last three digits): the case the Worker refuses.
const sameMaskOptions = [
  { label: '', name: 'Dara', phone: '012 *** 678', email: '', address: 'Street 1', area: '' },
  { label: '', name: 'Dara W', phone: '012 *** 678', email: '', address: 'Street 2', area: '' },
]
const loadedAddress = serializeContactOptions(sameMaskOptions)
const loaded = { phone: '012 *** 678', address: loadedAddress }

{
  const notesOnly = { name: 'Dara', phone: '012 *** 678', address: loadedAddress, notes: 'asked for a receipt', gender: 'female' }
  const untouched = untouchedPhoneFields(loaded, notesOnly)
  assert.deepEqual(untouched, { phone: true, address: true }, 'a notes-only save touches neither phone field')
  const sent = withoutUntouchedPhoneFields(notesOnly, untouched)
  assert.ok(!('phone' in sent) && !('address' in sent), 'neither phone field is sent')
  assert.deepEqual(sent, { name: 'Dara', notes: 'asked for a receipt', gender: 'female' }, 'every other field is sent as it was')
  assert.ok('phone' in notesOnly && 'address' in notesOnly, 'the caller\'s own object is not changed')
  console.log('PASS a notes-only save leaves out the phone and the Contact Options (and keeps everything else)')
}
{
  const typed = { name: 'Dara', phone: '012 345 678', address: loadedAddress }
  assert.deepEqual(untouchedPhoneFields(loaded, typed), { phone: false, address: true })
  assert.deepEqual(withoutUntouchedPhoneFields(typed, untouchedPhoneFields(loaded, typed)), { name: 'Dara', phone: '012 345 678' }, 'a typed primary phone is sent, the options are not')
  const emailEdit = { name: 'Dara', phone: '012 *** 678', address: serializeContactOptions([{ ...sameMaskOptions[0], email: 'dara@example.test' }, sameMaskOptions[1]]) }
  assert.deepEqual(untouchedPhoneFields(loaded, emailEdit), { phone: true, address: false })
  assert.ok('address' in withoutUntouchedPhoneFields(emailEdit, untouchedPhoneFields(loaded, emailEdit)), 'an edited option is sent whole, so its numbers travel with it')
  const reordered = { phone: '012 *** 678', address: serializeContactOptions([...sameMaskOptions].reverse()) }
  assert.equal(untouchedPhoneFields(loaded, reordered).address, false, 'reordering the options is a change')
  const removed = { phone: '012 *** 678', address: serializeContactOptions(sameMaskOptions.slice(1)) }
  assert.equal(untouchedPhoneFields(loaded, removed).address, false, 'removing an option is a change')
  const added = { phone: '012 *** 678', address: serializeContactOptions([...sameMaskOptions, { label: 'Shop', name: '', phone: '099 111 222', email: '', address: '', area: '' }]) }
  assert.equal(untouchedPhoneFields(loaded, added).address, false, 'adding an option is a change')
  console.log('PASS a changed phone or a changed Contact Option is still sent')
}
{
  const cleared = { phone: '', address: loadedAddress }
  const untouched = untouchedPhoneFields(loaded, cleared)
  assert.equal(untouched.phone, false, 'emptying the phone box is a change, not "unchanged"')
  assert.ok('phone' in withoutUntouchedPhoneFields(cleared, untouched), 'the empty phone is sent, so the Worker clears it')
  const wasEmpty = untouchedPhoneFields({ phone: null, address: null }, { phone: '', address: serializeContactOptions([{ label: '', name: '', phone: '', email: '', address: '', area: '' }]) })
  assert.deepEqual(wasEmpty, { phone: true, address: true }, 'a blank option row and a missing phone are the same as nothing')
  assert.deepEqual(untouchedPhoneFields({ phone: ' 012 *** 678 ', address: loadedAddress }, loaded), { phone: true, address: true }, 'stray spaces are not a change')
  console.log('PASS clearing a number is a change; blank rows and spaces are not')
}
{
  const area = JSON.stringify([{ label: 'Depot', name: 'Courier', phone: '095 *** 777', area: 'North' }])
  assert.deepEqual(untouchedPhoneFields({ phone: '096 *** 666', address: area }, { phone: '096 *** 666', address: area }, 'area'), { phone: true, address: true }, 'delivery contacts keep their options in the area mode')
  assert.deepEqual(untouchedPhoneFields({ phone: '096 *** 666', address: 'North' }, { phone: '096 *** 666', address: 'North' }, 'area'), { phone: true, address: true }, 'an old plain-text area is read the same on both sides')
  console.log('PASS delivery contacts (area mode) compare the same way')
}
{
  const payload = { name: 'x', phone: '1', address: 'y' }
  assert.equal(withoutUntouchedPhoneFields(payload, ALL_PHONE_FIELDS_SENT), payload, 'a create sends everything')
  assert.equal(withoutUntouchedPhoneFields(payload, null), payload)
  assert.equal(withoutUntouchedPhoneFields(payload, undefined), payload)
  console.log('PASS a create (or no information) sends every field')
}

// ---- Part 2: every update goes through it, no create does ---------------------------------------------------------------------
const SITES = {
  customers: { file: '../src/components/contacts/CustomersTab.tsx', update: 'updateCustomer', create: 'createCustomer', updates: 3 },
  suppliers: { file: '../src/components/contacts/SuppliersTab.tsx', update: 'updateSupplier', create: 'createSupplier', updates: 3 },
  delivery: { file: '../src/components/contacts/DeliveryTab.tsx', update: 'updateDeliveryContact', create: 'createDeliveryContact', updates: 3 },
  // The sheet builds its save payload on the line above the call (a sale source adds fields first), so two of its three updates (undo, redo) filter at the call.
  sheet: { file: '../src/components/contacts/CustomerSourceModal.tsx', update: 'updateCustomer', create: 'createCustomer', updates: 3, filteredAtTheCall: 2 },
} as const

/** The call expressions `name(...)` on lines that are calls (not the type or import lines), as written. */
function callLines(source: string, name: string): string[] {
  return source.split('\n').filter((line) => new RegExp(`[.\\s]${name}\\(`).test(line) && !/^\s*(import|export|\/\/)|=>\s*Promise<|:\s*\(/.test(line) && !new RegExp(`(function|async)\\s+${name}\\(`).test(line))
}
function updatesAreFiltered(source: string, site: (typeof SITES)[keyof typeof SITES]): { total: number; filtered: number } {
  const lines = callLines(source, site.update).filter((line) => !/updateCustomer: |updateSupplier: |updateDeliveryContact: /.test(line))
  return { total: lines.length, filtered: lines.filter((line) => line.includes('withoutUntouchedPhoneFields(')).length }
}

for (const [name, site] of Object.entries(SITES)) {
  const source = read(site.file)
  const { total, filtered } = updatesAreFiltered(source, site)
  assert.equal(total, site.updates, `${name}: the save, the undo and the redo are the update calls (${total})`)
  assert.equal(filtered, 'filteredAtTheCall' in site ? site.filteredAtTheCall : total, `${name}: every update call leaves out the untouched phone fields`)
  const creates = callLines(source, site.create).filter((line) => !/createCustomer: |createSupplier: |createDeliveryContact: /.test(line))
  assert.ok(creates.length >= 1, `${name}: has create calls to check`)
  assert.ok(creates.every((line) => !line.includes('withoutUntouchedPhoneFields(')), `${name}: no create leaves a phone field out`)
  // The same pin must fail on the code as it was: strip the wrapper and the check goes red.
  const stripped = source.split('withoutUntouchedPhoneFields(').join('(')
  const after = updatesAreFiltered(stripped, site)
  assert.ok(after.filtered < filtered, `${name}: the pin notices a missing wrapper`)
}
const sheet = read(SITES.sheet.file)
assert.ok(sheet.includes('const payload = withoutUntouchedPhoneFields(buildCustomerSourcePayload(form, loaded, source), editing ? untouched : null)'), 'the sheet filters the payload of an edit, never of a create')
console.log('PASS every update (Customers, Suppliers, Delivery contacts, the POS / sale customer sheet, and each undo and redo) leaves out untouched phone fields; no create does')

for (const [file, guard] of [
  ['../src/components/contacts/CustomerFormModal.tsx', 'customer ? untouchedPhoneFields('],
  ['../src/components/contacts/SuppliersTab.tsx', 'supplier ? untouchedPhoneFields('],
  ['../src/components/contacts/DeliveryTab.tsx', 'contact ? untouchedPhoneFields('],
] as const) {
  const source = read(file)
  assert.ok(source.includes(guard), `${file}: only an edit (a form opened on a record) computes the untouched fields`)
  assert.ok(source.includes(': ALL_PHONE_FIELDS_SENT'), `${file}: a create sends every field`)
  assert.ok(/const \[initialOptions\] = useState/.test(source), `${file}: the baseline is the Contact Options as first shown`)
  assert.ok(/onSave\(payload, /.test(source), `${file}: the form hands the Tab what it left alone`)
}
console.log('PASS the three forms compare against what they first showed, and only when editing')

// ---- Part 3: the Worker reads an absent field as unchanged -----------------------------------------------------------------------
const worker = read('../../cloudflare/src/routes/contacts.ts')
assert.match(worker, /function pickColumns\([\s\S]*?Object\.prototype\.hasOwnProperty\.call\(body, key\)/, 'a column that is not in the body is not picked')
assert.match(worker, /if \(Object\.prototype\.hasOwnProperty\.call\(payload, 'phone'\)\) payload\.phone = resolvePhoneInput\(/, 'a phone that was not sent is not resolved')
assert.match(worker, /if \(Object\.prototype\.hasOwnProperty\.call\(payload, 'address'\)\) payload\.address = resolveAddressInput\(/, 'Contact Options that were not sent are not resolved')
assert.match(worker, /const effectivePhone = Object\.prototype\.hasOwnProperty\.call\(payload, 'phone'\) \? payload\.phone : current\.phone/, 'the duplicate check reads the stored phone when none was sent')
console.log('PASS the Worker leaves a phone field it was not sent as it is stored')

// ---- Part 4 (N1): an undo that would put back a number the editor could not see is refused, never faked -----------------------------
// The snapshot an account without the grant holds is the list row it was shown: the mask. The Worker reads a mask as "the number you
// already hold", so replaying it answers 200 and keeps the NEW number when the two share their first and last three digits (the
// review's probe 8). The undo is refused with a reason and writes nothing; a holder's snapshot has real numbers and still undoes.
{
  const maskedBefore = { phone: '012 *** 678', address: serializeContactOptions([{ label: 'Shop', name: 'Dara', phone: '098 *** 222', email: '', address: '', area: '' }]) }
  const realBefore = { phone: '012 345 678', address: serializeContactOptions([{ label: 'Shop', name: 'Dara', phone: '098 111 222', email: '', address: '', area: '' }]) }
  assert.equal(undoNeedsHiddenPhone(maskedBefore, { phone: false, address: true }), true, 'the phone was changed and the snapshot holds its mask: refused')
  assert.equal(undoNeedsHiddenPhone(maskedBefore, { phone: true, address: false }), true, 'the Contact Options were changed and the snapshot holds their masks: refused')
  assert.equal(undoNeedsHiddenPhone(maskedBefore, { phone: false, address: false }), true)
  assert.equal(undoNeedsHiddenPhone(maskedBefore, { phone: true, address: true }), false, 'a notes-only edit replays no phone field: undo works')
  assert.equal(undoNeedsHiddenPhone(realBefore, { phone: false, address: false }), false, 'a holder\'s snapshot has the real numbers: undo works')
  assert.equal(undoNeedsHiddenPhone(maskedBefore, ALL_PHONE_FIELDS_SENT), true)
  assert.equal(undoNeedsHiddenPhone({ phone: '', address: '' }, { phone: false, address: false }), false, 'nothing was hidden: undo works')
  assert.equal(undoNeedsHiddenPhone(maskedBefore, null), false, 'no information about an edit: nothing to refuse')
  console.log('PASS undo is refused only when it would have to replay a mask over a changed phone field')
}
for (const [file, call] of [
  ['../src/components/contacts/CustomersTab.tsx', 'undoNeedsHiddenPhone(existingSnapshot, untouched)'],
  ['../src/components/contacts/SuppliersTab.tsx', 'undoNeedsHiddenPhone(existingSnapshot, untouched)'],
  ['../src/components/contacts/DeliveryTab.tsx', 'undoNeedsHiddenPhone(existingSnapshot, untouched)'],
  ['../src/components/contacts/CustomerSourceModal.tsx', 'undoNeedsHiddenPhone(before, untouched)'],
] as const) {
  const source = read(file)
  assert.ok(source.includes(call), `${file}: the edit's undo asks whether it would replay a hidden number`)
  assert.ok(source.includes('undoRefused: undoBlocked,'), `${file}: a refused undo is marked so that it never moves between stacks or marks the row failed`)
  assert.ok(/undo: undoBlocked \? \(\) => \{ throw new Error\(tr\((t, )?'contact_undo_phone_hidden', UNDO_PHONE_HIDDEN_FALLBACK\)\) \} : async \(\) => \{/.test(source), `${file}: the refusal says why, in the viewer's language`)
}
for (const pack of ['en', 'km']) {
  const strings = JSON.parse(read(`../src/lang/${pack}.json`)) as Record<string, string>
  assert.ok(typeof strings.contact_undo_phone_hidden === 'string' && strings.contact_undo_phone_hidden.length > 20, `${pack}: the refusal is translated`)
}
console.log('PASS the four edit sites refuse the undo with a translated reason (en and km)')
