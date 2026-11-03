'use strict'
// P2.8 (6.0.1046): the one phone mask (lib/phoneMask.ts) and the projection that applies it (lib/phoneAccess.ts).
//
// Real transpiled sources. Part 1 pins the format (Khmer digits, +855 forms, short numbers, idempotence). Part 2 pins
// who holds the grant (admin implicit, role and user overrides, nothing implies it). Part 3 pins the projection over
// every shape a phone travels in (picker row, sale row, Contact Options JSON, serialized envelopes, phone-shaped
// names, arrays, nested records) and that it is a pure function (input untouched, same reference when nothing to
// hide, same reference for a holder). Part 4 runs MUTANTS of the same sources through the same assertions: each one
// must fail, so a green run cannot be a test that checks nothing.
//
// Run (from cloudflare/): node scripts/test-phone-mask-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const read = (name) => fs.readFileSync(path.join(LIB, name), 'utf8').split('\r\n').join('\n')

function load(mutate = {}) {
  const cache = new Map()
  const load1 = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }
    cache.set(name, module)
    let source = read(`${name}.ts`)
    if (mutate[name]) source = mutate[name](source)
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      if (id.startsWith('./')) return load1(id.slice(2))
      throw new Error(`unexpected import ${id}`)
    }, module, module.exports)
    return module.exports
  }
  return { mask: load1('phoneMask'), access: load1('phoneAccess') }
}

const must = (source, needle) => { assert.ok(source.includes(needle), `mutation anchor missing: ${needle}`); return needle }
const replaceOnce = (needle, replacement) => (source) => source.replace(must(source, needle), replacement)

const synthetic = '087654321'
const user = (permissions = {}, role = {}, role_code = 'employee', id = 7) => ({ id, role_code, permissions: JSON.stringify(permissions), role_permissions: JSON.stringify(role) })
const admin = user({}, {}, 'admin', 1)
const cashier = user({ pos: true, contacts: true, sales: true })
const granted = user({ pos: true, contacts_full_phone: true })

function run(modules) {
  const { mask, access } = modules
  const failures = []
  const check = (name, fn) => { try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message || error).split('\n')[0]}`) } }

  // ---- 1. the format -------------------------------------------------------------------------------------------
  check('format table', () => {
    const table = [
      ['012 345 678', '012 *** 678'], ['012345678', '012 *** 678'], ['012-345-678', '012 *** 678'], ['(012) 345 678', '012 *** 678'],
      ['0123456789', '012 *** 789'], ['+855 12 345 678', '012 *** 678'], ['85512345678', '012 *** 678'], ['0085512345678', '012 *** 678'],
      ['+855 12 3456 789', '012 *** 789'], ['០១២ ៣៤៥ ៦៧៨', '012 *** 678'], ['+៨៥៥ ១២ ៣៤៥ ៦៧៨', '012 *** 678'], ['０８７６５４３２１', '087 *** 321'],
      ['+1 415 555 0132', '141 *** 132'], ['12345678', '12 *** 78'], ['1234567', '12 *** 67'], ['123456', '1 *** 6'],
      ['12345', '1 *** 5'], ['1234', '***'], ['123', '***'], ['7', '***'],
    ]
    for (const [input, expected] of table) assert.equal(mask.maskPhone(input), expected, `maskPhone(${JSON.stringify(input)})`)
  })
  check('every Unicode decimal digit is folded before masking and matching', () => {
    const scripts = {
      thai: '๐๘๗๖๕๔๓๒๑', devanagari: '०८७६५४३२१', myanmar: '၀၈၇၆၅၄၃၂၁', lao: '໐໘໗໖໕໔໓໒໑', arabicIndic: '٠٨٧٦٥٤٣٢١',
      extendedArabic: '۰۸۷۶۵۴۳۲۱', mathematicalBold: '𝟎𝟖𝟕𝟔𝟓𝟒𝟑𝟐𝟏', superscript: '⁰⁸⁷⁶⁵⁴³²¹', fullWidth: '０８７６５４３２１', khmer: '០៨៧៦៥៤៣២១',
    }
    for (const [script, digits] of Object.entries(scripts)) {
      assert.equal(mask.toAsciiDigits(digits), '087654321', script)
      assert.equal(mask.maskPhone(digits), '087 *** 321', script)
      assert.equal(mask.isMaskOf('087 *** 321', digits), true, script)
      if (script === 'superscript') continue
      assert.equal(mask.maskPhonesInText(`call ${digits} now`), 'call 087 *** 321 now', script)
      assert.equal(mask.isPhoneShaped(digits), true, script)
    }
    assert.equal(mask.toAsciiDigits('Soap 100ml'), 'Soap 100ml')
  })
  check('hidden digits: at least three, never the whole number visible', () => {
    for (let length = 1; length <= 15; length += 1) {
      const digits = Array.from({ length }, (_, index) => String((index + 1) % 10)).join('')
      const masked = mask.maskPhone(digits)
      const shown = masked.replace(/\D/g, '').length
      assert.ok(length - shown >= 3 || masked === '***', `length ${length}: shows ${shown} digits (${masked})`)
      assert.ok(!masked.replace(/[^\d]/g, '').includes(digits.slice(3, 6)) || length < 6, `length ${length} leaks the middle: ${masked}`)
    }
  })
  check('no digit, null and empty pass through; non-strings untouched', () => {
    assert.equal(mask.maskPhone(null), null)
    assert.equal(mask.maskPhone(''), '')
    assert.equal(mask.maskPhone('N/A'), 'N/A')
    assert.equal(mask.maskPhone(undefined), undefined)
    assert.equal(mask.maskPhone(12), 12)
  })
  check('idempotent', () => {
    for (const input of ['012 345 678', '+855 12 345 678', '1234', 'N/A', '']) {
      const once = mask.maskPhone(input)
      assert.equal(mask.maskPhone(once), once, `twice(${input})`)
    }
  })
  check('mixed text keeps no readable number', () => {
    const out = mask.maskPhone('call Dara 012 345 678 after 5')
    assert.ok(!/345/.test(out), out)
  })
  check('isMaskOf / resolveIncomingPhone', () => {
    assert.equal(mask.isMaskOf('012 *** 678', '+855 12 345 678'), true)
    assert.equal(mask.isMaskOf('០១២ *** ៦៧៨', '012345678'), true)
    assert.equal(mask.isMaskOf('012 *** 679', '012345678'), false)
    assert.equal(mask.isMaskOf('012345678', '012345678'), false)
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', ['099 111 222', '012 345 678']), { ok: true, phone: '012 345 678' })
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', ['099 111 222']), { ok: false, reason: 'masked_no_match' })
    assert.deepEqual(mask.resolveIncomingPhone('070 123 456', []), { ok: true, phone: '070 123 456' })
    assert.deepEqual(mask.resolveIncomingPhone(null, []), { ok: true, phone: null })
  })
  check('an asterisk anywhere but in the exact mask shape is a number to hide, not a mask', () => {
    for (const note of ['012 345 678 *', '*012345678', '012345678 (*main)', '012 345 678 ***', '*** 012 345 678', '012 **** 678', '0*12 345 678']) {
      assert.equal(mask.isMaskedPhone(note), false, note)
      assert.ok(!/345/.test(String(mask.maskPhone(note))), `maskPhone(${note}) = ${mask.maskPhone(note)}`)
      assert.equal(mask.isMaskOf(note, '012345678'), false, note)
      assert.deepEqual(mask.resolveIncomingPhone(note, ['012 345 678']), { ok: false, reason: 'masked_no_match' }, 'an asterisk is never typed: refused, never saved')
      assert.deepEqual(mask.resolveIncomingPhone(note, ['099 111 222', note]), { ok: true, phone: note }, 'the stored value sent back unchanged is not a write')
      assert.deepEqual(mask.resolveIncomingPhone(note, [], note), { ok: true, phone: note })
    }
    for (const shown of ['012 *** 678', '***', '1 *** 5', '٠١٢ *** ៦៧៨', '012  ***  678']) assert.equal(mask.isMaskedPhone(shown), true, shown)
    const out = access.projectPhones({ phone: '012 345 678 *', customer_phone: '*012345678', delivery_contact_phone: '012345678 (*main)' }, cashier)
    assert.deepEqual(out, { phone: '012 *** 678', customer_phone: '012 *** 678', delivery_contact_phone: '012 *** 678' })
  })
  check('a mask that fits two different stored numbers is refused; the number at the same place wins', () => {
    const left = '012 345 678'
    const right = '012 999 678'
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, right]), { ok: false, reason: 'masked_ambiguous' })
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, right], right), { ok: true, phone: right })
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, right], left), { ok: true, phone: left })
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, '+855 12 345 678']), { ok: true, phone: left }, 'the same number in two formats is one number')
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left], '099 111 222'), { ok: true, phone: left }, 'a preferred number that does not fit falls back to the stored ones')
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, right], '099 111 222'), { ok: false, reason: 'masked_ambiguous' })
  })
  check('maskPhonesInText', () => {
    assert.equal(mask.maskPhonesInText('Phone "012 345 678" is already registered to "Dara".'), 'Phone "012 *** 678" is already registered to "Dara".')
    assert.equal(mask.maskPhonesInText('receipt R-12 qty 3 total 14.50'), 'receipt R-12 qty 3 total 14.50')
    assert.equal(mask.maskPhonesInText('call +855 12 345 678 or ០១២៣៤៥៦៧៨'), 'call 012 *** 678 or 012 *** 678')
  })

  // ---- 2. who holds the grant ---------------------------------------------------------------------------------
  check('grant: administrator implicit, others off until granted, nothing else implies it', () => {
    assert.equal(access.canSeeFullPhones(admin), true)
    assert.equal(access.canSeeFullPhones(user({ all: true }, {}, 'manager')), true)
    assert.equal(access.canSeeFullPhones(cashier), false)
    assert.equal(access.canSeeFullPhones(null), false)
    assert.equal(access.canSeeFullPhones(undefined), false)
    assert.equal(access.canSeeFullPhones(granted), true)
    assert.equal(access.canSeeFullPhones(user({}, { contacts_full_phone: true })), true, 'granted through the role')
    assert.equal(access.canSeeFullPhones(user({ contacts_full_phone: false }, { contacts_full_phone: true })), false, 'a person override beats the role')
    assert.equal(access.canSeeFullPhones(user({ contacts_full_phone: true }, { contacts_full_phone: false })), true, 'a person grant beats the role')
    for (const key of ['contacts', 'sales', 'settings', 'pos', 'returns', 'dashboard', 'audit_log', 'review']) {
      assert.equal(access.canSeeFullPhones(user({ [key]: true })), false, `${key}: true must not imply the grant`)
    }
    assert.equal(access.canSeeFullPhones(user({ contacts: 'review', contacts_full_phone: 'review' })), false, 'a non-boolean value is not a grant')
    assert.equal(access.canSeeFullPhones(user({ contacts_full_phone: 'true' })), false)
  })

  // ---- 3. the projection ---------------------------------------------------------------------------------------
  const FULL = '087 654 321'
  const MASKED = '087 *** 321'
  const optionsJson = JSON.stringify([{ label: 'Default', name: 'Dara', phone: '087 654 321', email: null, address: 'St 271', area: null }, { label: 'Work', name: 'Dara', phone: '+855 98 111 222', email: null, address: 'St 9', area: null }])
  const customerJson = JSON.stringify({ id: 5, name: 'Dara', phone: FULL, phone_normalized: '087654321', address: optionsJson, email: null, membership_number: 'M-1' })
  const customer = () => JSON.parse(customerJson)
  const saleJson = JSON.stringify({
    id: 9, receipt_number: 'R-1', customer_id: 5, customer_name: 'Dara', customer_phone: FULL, customer_address: optionsJson,
    delivery_contact_name: '012345678', delivery_contact_phone: '098 111 222', delivery_contact_address: 'Area 3', driver_phone: '012 000 111',
    creation_snapshot_json: JSON.stringify({ customer_phone: FULL, nested: { delivery_contact_phone: '098 111 222' } }),
  })
  const sale = () => JSON.parse(saleJson)
  const hasFull = (value) => /087[\s-]?654[\s-]?321|098[\s-]?111[\s-]?222|012[\s-]?345[\s-]?678|012[\s-]?000[\s-]?111|\+855 98/.test(JSON.stringify(value).replace(/\\"/g, '"'))

  check('a customer row is masked in every phone-bearing field', () => {
    const out = access.projectPhones(customer(), cashier)
    assert.equal(out.phone, MASKED)
    assert.equal(out.phone_normalized, MASKED)
    assert.equal(out.name, 'Dara')
    assert.equal(out.membership_number, 'M-1')
    assert.ok(!hasFull(out), JSON.stringify(out))
    assert.equal(JSON.parse(out.address)[0].phone, MASKED)
    assert.equal(JSON.parse(out.address)[1].phone, '098 *** 222')
    assert.equal(JSON.parse(out.address)[0].address, 'St 271', 'non-phone option fields stay')
  })
  check('a sale row: header, snapshot JSON, driver, phone-shaped name', () => {
    const out = access.projectPhones({ items: [sale()] }, cashier)
    assert.ok(!hasFull(out), JSON.stringify(out))
    assert.equal(out.items[0].customer_phone, MASKED)
    assert.equal(out.items[0].delivery_contact_name, '012 *** 678', 'a contact saved under its number is a number')
    assert.equal(JSON.parse(out.items[0].creation_snapshot_json).nested.delivery_contact_phone, '098 *** 222')
    assert.equal(out.items[0].receipt_number, 'R-1')
  })
  check('keys: phone_key, camelCase, arrays, numbers, nested envelopes', () => {
    const out = access.projectPhones({
      matchedPhone: FULL, phone_key: '87654321', phones: [FULL, '098 111 222'], customerPhone: FULL, phone: 87654321,
      details: JSON.stringify({ before: { phone: FULL }, after: { phone: '098 111 222' } }),
      undo_payload: JSON.stringify({ rows: [{ customer_phone: FULL }] }),
      doubly: JSON.stringify({ inner: JSON.stringify({ phone: FULL }) }),
    }, cashier)
    assert.ok(!hasFull(out), JSON.stringify(out))
    assert.deepEqual(out.phones, [MASKED, '098 *** 222'])
    assert.equal(out.matchedPhone, MASKED)
  })
  check('a mask matched only by position must fit exactly one distinct stored number', () => {
    const left = '012 345 678'
    const right = '012 999 678'
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, right], left, true), { ok: false, reason: 'masked_ambiguous' }, 'delete the first option, rename the survivor: the position now points at the wrong number')
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, right], left), { ok: true, phone: left }, 'identified by label: the preferred number stands')
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left], left, true), { ok: true, phone: left }, 'a mask no other stored number shares is safe by position')
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [left, '+855 12 345 678'], left, true), { ok: true, phone: left }, 'the same number written twice is one number')
    assert.deepEqual(mask.resolveIncomingPhone('012 *** 678', [right], '099 111 222', true), { ok: true, phone: right }, 'a position number that does not fit falls back to the one stored number that does')
  })
  check('a phone sent as a JSON number is masked; a count or an id under a phone key is not', () => {
    const out = access.projectPhones({ customer_phone: 12345678, driver_phone: 87654321, phones: [12345678, 87654321], phone: 855123456789, phone_count: 3, phones_total: 12, phone_id: 4021 }, cashier)
    assert.deepEqual(out, { customer_phone: '12 *** 78', driver_phone: '87 *** 21', phones: ['12 *** 78', '87 *** 21'], phone: '012 *** 789', phone_count: 3, phones_total: 12, phone_id: 4021 })
    assert.ok(!/12345678|87654321/.test(JSON.stringify(out)), JSON.stringify(out))
  })
  check('a phone under a generic key: the duplicates list { type, value } and the gender restoration { kind, key }', () => {
    const out = access.projectPhones({
      groups: [
        { type: 'phone', value: '087654321', ids: [4, 9], names: ['Dara', 'Sok'] },
        { type: 'name', value: 'Dara Sok', ids: [4, 9] },
        { type: 'barcode', value: '8851234567890', ids: [2, 3] },
        { kind: 'unique_phone', key: '098111222', id: 4 },
        { kind: 'unique_name', key: 'dara sok', id: 4 },
      ],
    }, cashier)
    assert.deepEqual(out.groups[0], { type: 'phone', value: '087 *** 321', ids: [4, 9], names: ['Dara', 'Sok'] })
    assert.equal(out.groups[1].value, 'Dara Sok')
    assert.equal(out.groups[2].value, '8851234567890')
    assert.deepEqual(out.groups[3], { kind: 'unique_phone', key: '098 *** 222', id: 4 })
    assert.equal(out.groups[4].key, 'dara sok')
    assert.ok(!hasFull(out), JSON.stringify(out))
    assert.equal(access.projectPhones({ type: 'phone', value: '087654321' }, granted).value, '087654321', 'a holder reads it as written')
  })
  check('an import-review row named by its number: the identifier is masked beside the phone cell', () => {
    const out = access.projectPhones({ rows: [
      { row_number: 3, identifier: '087654321', action: 'create', data: { name: 'Dara', phone: '087654321' } },
      { row_number: 4, identifier: '+855 98 111 222', action: 'update', data: { name: 'Sok', phone: '098111222' } },
      { row_number: 5, identifier: '8851234567890', action: 'create', data: { name: 'Soap', barcode: '8851234567890' } },
      { row_number: 6, identifier: 'Dara Sok', action: 'create', data: { name: 'Dara Sok', phone: '087654321' } },
    ] }, cashier)
    assert.equal(out.rows[0].identifier, '087 *** 321')
    assert.equal(out.rows[0].data.phone, '087 *** 321')
    assert.equal(out.rows[1].identifier, '098 *** 222')
    assert.equal(out.rows[2].identifier, '8851234567890', 'a barcode row keeps its identifier')
    assert.equal(out.rows[3].identifier, 'Dara Sok')
    assert.ok(!hasFull(out), JSON.stringify(out))
  })
  check('a contact saved under its number is masked wherever it is written, even inside JSON without the word phone', () => {
    const out = access.projectPhones({
      customer: '010 222 333', supplier: '077333444', details: JSON.stringify({ name: '010 222 333', note: 'x' }),
      old_value: JSON.stringify([{ id: 4, name: '+855 10 222 333' }]), search_normalized: 'p28-0001 fixture dara 087654321 cash',
    }, cashier)
    assert.ok(!/222[\s-]?333|333444|087654321/.test(JSON.stringify(out).replace(/\\"/g, '"')), JSON.stringify(out))
    assert.equal(out.customer, '010 *** 333')
    assert.equal(out.search_normalized, 'p28-0001 fixture dara 087 *** 321 cash')
    assert.equal(JSON.parse(out.details).note, 'x')
  })
  check('JSON text with nothing to hide keeps its exact text', () => {
    const text = '{ "rows": [ {"id":1}, {"id":2} ], "ok": true }'
    assert.equal(access.projectPhones({ details: text, other: text }, cashier).details, text)
    assert.equal(access.projectPhones({ details: text, other: text }, cashier).other, text)
  })
  check('numbers that are not phones stay: barcode, receipt number, totals, dates', () => {
    const row = { barcode: '8851234567890', receipt_number: '20261102001234', total_usd: 12345678, created_at: '2026-11-02 12:00:00', sku: '12345678', name: 'Soap 100ml' }
    assert.equal(access.projectPhones(row, cashier), row)
  })
  check('phone-free payload: same reference, nothing copied', () => {
    const payload = { rows: [{ id: 1, name: 'Soap', price: 3.5, tags: ['a', 'b'] }], total: 1 }
    assert.equal(access.projectPhones(payload, cashier), payload)
  })
  check('a holder of the grant gets the same object back', () => {
    for (const holder of [admin, granted]) { const row = customer(); assert.equal(access.projectPhones(row, holder), row) }
  })
  check('the input is never modified', () => {
    const row = customer()
    access.projectPhones(row, cashier)
    assert.deepEqual(row, customer())
  })
  check('idempotent: a second pass changes nothing', () => {
    const once = access.projectPhones(sale(), cashier)
    assert.deepEqual(access.projectPhones(once, cashier), once)
  })
  check('no actor is masked, never open', () => {
    assert.equal(access.projectPhones({ phone: FULL }, null).phone, MASKED)
    assert.equal(access.projectPhones({ phone: FULL }, undefined).phone, MASKED)
  })
  check("the shop's own numbers keep showing", () => {
    const branch = { id: 1, name: 'Main', location: 'Phnom Penh', phone: '023 456 789', manager: 'Sok', notes: null }
    assert.equal(access.projectPhones({ branches: [branch] }, cashier).branches[0].phone, '023 456 789')
    assert.equal(access.projectPhones({ business_phone: '023 456 789', customer_portal_contact_phone: '023 456 789' }, cashier).business_phone, '023 456 789')
    assert.equal(access.projectPhones({ customer_portal_contact_phone: '023 456 789' }, cashier).customer_portal_contact_phone, '023 456 789')
    assert.equal(access.projectPhones({ id: 3, name: 'Dara', phone: FULL, location: 'x', customer_id: 3 }, cashier).phone, MASKED, 'a customer row is not a branch row')
  })
  check('a signed-in person sees their own number, nobody else does', () => {
    const me = { id: 7, username: 'sok', phone: FULL }
    const other = { id: 8, username: 'dara', phone: '098 111 222' }
    const out = access.projectPhones({ user: me, users: [me, other] }, cashier)
    assert.equal(out.user.phone, FULL)
    assert.equal(out.users[0].phone, FULL)
    assert.equal(out.users[1].phone, '098 *** 222')
    assert.equal(access.projectPhones({ id: 7, phone: FULL }, cashier).phone, MASKED, 'a row without username is not the account')
  })
  check('legacy plain-text and non-option addresses are left alone', () => {
    assert.equal(access.projectPhones({ address: 'St 271, Phnom Penh' }, cashier).address, 'St 271, Phnom Penh')
    assert.equal(access.projectPhones({ address: '[broken' }, cashier).address, '[broken')
  })
  check('unparseable envelope text that names a phone is scrubbed', () => {
    const out = access.projectPhones({ details: '{"phone":"087 654 321", truncated' }, cashier)
    assert.ok(!hasFull(out), JSON.stringify(out))
  })
  check('a number a message quotes is masked; a receipt number or an amount in running text is not', () => {
    const duplicate = 'Phone "087 654 321" is already registered to "Fixture Dara". Each phone number can only belong to one customer.'
    const out = access.projectPhones({ error: duplicate, code: 'phone_conflict' }, cashier)
    assert.equal(out.error, 'Phone "087 *** 321" is already registered to "Fixture Dara". Each phone number can only belong to one customer.')
    assert.equal(out.code, 'phone_conflict')
    const csvCell = access.projectPhones({ message: 'Phone ""087 654 321"" already belongs to a different customer' }, cashier)
    assert.equal(csvCell.message, 'Phone ""087 *** 321"" already belongs to a different customer')
    const nested = access.projectPhones({ warnings: [{ kind: 'name_match', message: 'Phone "+855 87 654 321" matches "Dara"' }], errors: ['Phone "087654321" taken'] }, cashier)
    assert.ok(!hasFull(nested), JSON.stringify(nested))
    const plain = { message: 'Receipt 20261102-100405 total 1234567.89 for row 12345678', error: 'Row 1234567 is invalid' }
    assert.equal(access.projectPhones(plain, cashier), plain, 'unquoted digits in a sentence are not a phone and the input comes back as is')
    assert.equal(access.projectPhones({ error: duplicate }, granted).error, duplicate, 'a holder reads the message as written')
    assert.equal(mask.maskQuotedPhones('see "Dara" and 5 items'), 'see "Dara" and 5 items')
  })
  check('depth is bounded and fails closed', () => {
    let deep = { phone: FULL }
    for (let i = 0; i < 80; i += 1) deep = { child: deep }
    const out = access.projectPhones(deep, cashier)
    assert.ok(!hasFull(out))
  })
  check('synthetic fixture is not a real number', () => {
    assert.equal(mask.maskPhone(synthetic), '087 *** 321')
  })
  return failures
}

const real = run(load())
assert.deepEqual(real, [], `real sources must pass every check:\n${real.join('\n')}`)
console.log('PASS phone mask + projection: every check on the real sources')

// ---- 4. mutants: the same assertions must fail on each defective copy ---------------------------------------------
const mutants = {
  'masks nothing': { phoneMask: replaceOnce("  if (isMaskedPhone(value)) return value\n  const digits", "  return value\n  const digits") },
  'keeps the middle digits': { phoneMask: replaceOnce('Math.min(3, Math.floor((length - 3) / 2))', 'Math.min(3, Math.floor((length - 1) / 2))') },
  'not idempotent': { phoneMask: replaceOnce("  if (isMaskedPhone(value)) return value\n  const digits", "  const digits") },
  'non-ASCII digits not folded': { phoneMask: replaceOnce('code > 0x7f && DECIMAL_DIGIT.test(char)', 'false') },
  'only Khmer digits folded': { phoneMask: replaceOnce('code > 0x7f && DECIMAL_DIGIT.test(char)', 'code >= 0x17e0 && code <= 0x17e9') },
  'an asterisk anywhere is a mask': { phoneMask: replaceOnce("&& MASK_SHAPE.test(toAsciiDigits(value).replace(/\\s+/g, ' ').trim())", '') },
  'ambiguous mask resolved to the first number': { phoneMask: replaceOnce("if (hits.size > 1) return { ok: false, reason: 'masked_ambiguous' }", "if (false) return { ok: false, reason: 'masked_ambiguous' }") },
  'number at the same place ignored': { phoneMask: replaceOnce('if (preferred != null && isMaskOf(text, preferred)) {', 'if (false) {') },
  'position match trusted without a uniqueness check': { phoneMask: replaceOnce('if (!requireUnique) return { ok: true, phone: String(preferred) }', 'if (true) return { ok: true, phone: String(preferred) }') },
  'JSON number phones kept': { phoneAccess: replaceOnce("else if (typeof value === 'number' && !exempt && (kind & PHONE))", 'else if (false)') },
  'counts under a phone key masked': { phoneAccess: replaceOnce('Math.abs(value) >= PHONE_NUMBER_MIN', 'Math.abs(value) >= 0') },
  'typed phone value kept': { phoneAccess: replaceOnce("if (phoneTyped && (key === 'value' || key === 'key')) kind |= PHONE", '') },
  'import identifier kept': { phoneAccess: replaceOnce("if (phoneRow && key === 'identifier') kind |= NAME", '') },
  '+855 not folded': { phoneMask: replaceOnce('if (/^(?:00)?855\\d{8,9}$/.test(digits))', 'if (false)') },
  'admin not implicit': { phoneAccess: replaceOnce("return !!user && hasPermission(user, 'contacts_full_phone')", "return !!user && JSON.parse((user as any).permissions || '{}').contacts_full_phone === true") },
  'Contacts Full implies the grant': { phoneAccess: replaceOnce("return !!user && hasPermission(user, 'contacts_full_phone')", "return !!user && (hasPermission(user, 'contacts_full_phone') || hasPermission(user, 'contacts'))") },
  'everybody sees full': { phoneAccess: replaceOnce('  if (canSeeFullPhones(user)) return value', '  return value') },
  'phone_key not recognised': { phoneAccess: replaceOnce('/(^|_)(phone|phones|mobile|telephone)(_|$)/', '/^(phone|customer_phone|delivery_contact_phone)$/') },
  'arrays of phones skipped': { phoneAccess: replaceOnce("if ((kind & PHONE) && !exempt && Array.isArray(value)) next = (next as unknown[]).map(maskValue)", '') },
  'envelope JSON not decoded': { phoneAccess: replaceOnce('((kind & ENVELOPE) !== 0 || /phone/i.test(trimmed))', 'false') },
  'envelope keys not always decoded': { phoneAccess: replaceOnce('((kind & ENVELOPE) !== 0 || /phone/i.test(trimmed))', '/phone/i.test(trimmed)') },
  'search helper text kept': { phoneAccess: replaceOnce('if (kind & SEARCH_TEXT) return maskPhonesInText(text)', '') },
  'customer label kept': { phoneAccess: replaceOnce('|customer|supplier|contact|', '|') },
  'phone-shaped name kept': { phoneAccess: replaceOnce('if ((kind & NAME) && isPhoneShaped(text)) return maskPhone(text) as string', '') },
  'branch rows masked': { phoneAccess: replaceOnce('(branch && (kind & PHONE) !== 0) || ', '') },
  'own record not exempt': { phoneAccess: replaceOnce('|| (own && (key === \'phone\' || key === \'username\' || key === \'name\'))', '') },
  'other people exempt as own': { phoneAccess: replaceOnce("String(source.id) === actorId", "true") },
  'input mutated': { phoneAccess: replaceOnce('let out: Record<string, unknown> | null = null\n  let catalog: boolean | null = null\n  for (const key in source)', 'let out: Record<string, unknown> | null = source\n  let catalog: boolean | null = null\n  for (const key in source)') },
  'always copies': { phoneAccess: replaceOnce('return out ?? node\n}\n\n// The quoted sentences', 'return { ...source, ...(out ?? {}) }\n}\n\n// The quoted sentences') },
  'quoted number in a message kept': { phoneAccess: replaceOnce('  if (kind & MESSAGE) return maskQuotedPhones(text)\n', '') },
  'message arrays kept': { phoneAccess: replaceOnce('if ((kind & MESSAGE) && !exempt && Array.isArray(value))', 'if (false && Array.isArray(value))') },
  'no actor sees full': { phoneAccess: replaceOnce('return !!user && hasPermission', 'return !user || hasPermission') },
}
let missed = 0
for (const [name, mutate] of Object.entries(mutants)) {
  let result
  try { result = run(load(mutate)) } catch (error) { if (/mutation anchor missing/.test(error.message)) { missed += 1; console.error(`STALE ANCHOR in ${name}: ${error.message}`); continue } result = [`threw: ${error.message}`] }
  if (result.length === 0) { missed += 1; console.error(`MUTANT SURVIVED: ${name}`) } else console.log(`killed  ${name} (${result.length} failing check${result.length === 1 ? '' : 's'})`)
}
assert.equal(missed, 0, `${missed} mutant(s) survived`)
console.log(`PASS ${Object.keys(mutants).length} mutants killed`)
