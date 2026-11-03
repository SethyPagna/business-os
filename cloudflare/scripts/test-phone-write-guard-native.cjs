'use strict'
// P2.8 (6.0.1046): a mask must never be written over a real number, on the REAL Worker.
//
// An account without `contacts_full_phone` reads 087 *** 321. The Edit Customer form, the POS customer pick, the merge and
// link-conflict screens send back what they were shown. A Worker that saved it would replace a real phone with a mask (and
// every later search, receipt and duplicate check would then be wrong). So a masked phone comes back resolved against the
// record it belongs to, or is refused with `masked_phone_input`; a number the person really typed passes untouched.
//
// Run (from cloudflare/): node scripts/test-phone-write-guard-native.cjs
// PHONE_MUTANT=<name> applies one defect to a source file in the in-memory bundle (test-phone-leak-mutants-native.cjs runs each).
const { createReporter } = require('./harness/real_worker_world.cjs')
const { bootPhoneWorld, PHONES, optionJson } = require('./harness/phone_leak_world.cjs')

const sub = (needle, replacement) => (source) => {
  if (!source.includes(needle)) throw new Error(`mutant anchor missing: ${needle}`)
  return source.replace(needle, () => replacement)
}
const MUTANTS = {
  'edit saves the mask it was shown': ['routes/contacts.ts', sub('if (Object.prototype.hasOwnProperty.call(payload, \'phone\')) payload.phone = resolvePhoneInput(payload.phone, storedPhones, current?.phone)', '')],
  'edit saves masked Contact Options': ['routes/contacts.ts', sub('payload.address = resolveAddressInput(payload.address, current, config.optionMode)', 'payload.address = payload.address')],
  'mask matched against any stored number, first hit wins': ['lib/phoneMask.ts', (source) => sub("if (hits.size > 1) return { ok: false, reason: 'masked_ambiguous' }", '')(sub('if (preferred != null && isMaskOf(text, preferred)) {', 'if (false) {')(source))],
  'option mask resolved against all stored options': ['lib/phoneWriteGuard.ts', sub('resolvePhoneInput(option.phone, counterpart?.byPosition ? everyStored : [], counterpart?.phone, counterpart?.byPosition === true)', 'resolvePhoneInput(option.phone, storedOptions.map((stored) => stored.phone))')],
  'position match trusted without a uniqueness check': ['lib/phoneWriteGuard.ts', sub('counterpart?.phone, counterpart?.byPosition === true)', 'counterpart?.phone, false)')],
  'duplicate dismissal accepts a mask': ['routes/contacts.ts', (source) => source.replace(/(a dismissal no list ever shows\)\.\r?\n)\s*if \(isMaskedPhone\(value\)\) return [^\n]*\n/g, '$1')],
  'asterisk phone that is not a mask saved as typed': ['lib/phoneMask.ts', sub("if (!text.includes('*')) return { ok: true, phone: text }", 'if (!isMaskedPhone(text)) return { ok: true, phone: text }')],
  'create accepts a mask': ['routes/contacts.ts', sub('if (bodyHasMaskedPhone(payload)) return c.json({ error: MASKED_PHONE_MESSAGE, code: MASKED_PHONE_CODE }, 400)', '')],
  'resolver accepts a mask of another number': ['lib/phoneMask.ts', sub('export function isMaskOf(incoming: unknown, stored: unknown): boolean {', 'export function isMaskOf(incoming: unknown, stored: unknown): boolean {\n  return true')],
  'merge accepts a masked custom phone': ['routes/contacts.ts', sub("if ((column === 'phone' || column === 'address') && bodyHasMaskedPhone({ [column]: choice.custom })) return { error: MASKED_PHONE_MESSAGE, code: MASKED_PHONE_CODE }", '')],
}

const digitsOf = (value) => String(value ?? '').replace(/\D/g, '')
const phonesOfAddress = (text) => { try { return JSON.parse(text).map((option) => digitsOf(option.phone)) } catch { return [] } }

async function main() {
  const mutant = process.env.PHONE_MUTANT ? MUTANTS[process.env.PHONE_MUTANT] : null
  if (process.env.PHONE_MUTANT && !mutant) throw new Error(`unknown PHONE_MUTANT ${process.env.PHONE_MUTANT}`)
  const world = await bootPhoneWorld({ transformSources: mutant ? (file, source) => (file === mutant[0] ? mutant[1](source) : source) : undefined })
  const { check, finish } = createReporter()
  const { ids } = world
  const stored = () => world.first('SELECT name, phone, phone_normalized, address, notes FROM customers WHERE id = ?', ids.customer)
  const original = await stored()
  const originalPhones = phonesOfAddress(original.address)
  let reads = 0
  const listRow = async (as) => {
    const response = await world.api('GET', `/api/customers?search=Fixture%20Dara&page=1&pageSize=50&cb=${++reads}`, undefined, { as })
    const rows = (response.json && (response.json.items || response.json.customers || response.json.data)) || []
    return rows.find((row) => Number(row.id) === ids.customer)
  }

  await check('positive control: the account without the grant is shown a mask (the form is filled from it)', async (t) => {
    const row = await listRow('manager')
    t.ok('row found', !!row)
    t.eq('phone masked', row && row.phone, '087 *** 321')
    t.ok('Contact Option phones masked', row && phonesOfAddress(row.address).length === 3 && JSON.stringify(row.address).includes('***'), row && row.address)
  })

  await check('edit: the form sends back exactly what it was shown (masked phone + masked Contact Options): the stored numbers stay', async (t) => {
    const row = await listRow('manager')
    const response = await world.api('PUT', `/api/customers/${ids.customer}`, { ...row, name: 'Fixture Dara', notes: 'edited by a cashier' }, { as: 'manager' })
    t.ok(`status ${response.status}`, response.status === 200, response.text.slice(0, 300))
    const after = await stored()
    t.eq('notes changed (the edit really happened)', after.notes, 'edited by a cashier')
    t.eq('phone unchanged', digitsOf(after.phone), digitsOf(original.phone))
    t.eq('phone has no asterisk', /\*/.test(String(after.phone)), false)
    t.eq('phone_normalized unchanged', after.phone_normalized, original.phone_normalized)
    t.eq('Contact Option phones unchanged', phonesOfAddress(after.address), originalPhones)
    t.eq('address has no asterisk', /\*/.test(String(after.address)), false)
  })

  await check('edit: a mask that is not this contact\'s own number is refused, nothing is written', async (t) => {
    const before = await stored()
    const response = await world.api('PUT', `/api/customers/${ids.customer}`, { name: 'Fixture Dara', phone: '099 *** 111' }, { as: 'manager' })
    t.eq('status', response.status, 400)
    t.eq('code', response.json && response.json.code, 'masked_phone_input')
    t.eq('phone unchanged', await stored(), before)
    const hand = await world.api('PUT', `/api/customers/${ids.customer}`, { name: 'Fixture Dara', phone: '087 ** 321' }, { as: 'manager' })
    t.eq('a hand-edited mask is refused too', hand.status, 400)
    const option = await world.api('PUT', `/api/customers/${ids.customer}`, { name: 'Fixture Dara', phone: '087 *** 321', address: optionJson([{ label: 'Home', name: 'x', phone: '011 *** 000', email: null, address: 'Street 1', area: null }]) }, { as: 'manager' })
    t.eq('a mask of an unknown Contact Option phone is refused', option.status, 400)
    t.eq('still unchanged', await stored(), before)
  })

  await check('edit: numbers that share their first and last three digits keep their own place when the form is saved unchanged', async (t) => {
    const made = await world.api('POST', '/api/customers', {
      name: 'Fixture Triplet', phone: '087 999 321',
      address: optionJson([
        { label: 'Home', name: 'Triplet H', phone: '087 111 321', email: null, address: 'Street 1', area: null },
        { label: 'Work', name: 'Triplet W', phone: '087 222 321', email: null, address: 'Street 2', area: null },
      ]),
    }, { as: 'admin' })
    t.ok(`fixture created (status ${made.status})`, made.status === 201 || made.status === 200, made.text.slice(0, 200))
    const id = made.json.id
    const triplet = () => world.first('SELECT phone, address FROM customers WHERE id = ?', id)
    const read = async () => ((await world.api('GET', `/api/customers?search=Triplet&page=1&pageSize=50&cb=${++reads}`, undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === id)
    const row = await read()
    t.eq('all three numbers show the same mask', [row.phone, ...JSON.parse(row.address).map((option) => option.phone)], ['087 *** 321', '087 *** 321', '087 *** 321'])
    const saved = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Triplet', notes: 'saved unchanged' }, { as: 'manager' })
    t.ok(`unchanged form: status ${saved.status}`, saved.status === 200, saved.text.slice(0, 300))
    const after = await triplet()
    t.eq('primary phone kept', digitsOf(after.phone), '087999321')
    t.eq('each option keeps its own number', phonesOfAddress(after.address), ['087111321', '087222321'])
    const options = JSON.parse(row.address)
    const swapped = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Triplet', address: JSON.stringify([options[1], options[0]]) }, { as: 'manager' })
    t.ok(`options sent in the other order: status ${swapped.status}`, swapped.status === 200, swapped.text.slice(0, 300))
    t.eq('a label follows its own number', JSON.parse((await triplet()).address).map((option) => [option.label, digitsOf(option.phone)]), [['Work', '087222321'], ['Home', '087111321']])
    const fresh = await triplet()
    const extra = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Triplet', address: JSON.stringify([...options, { label: 'New', name: 'x', phone: '087 *** 321', email: null, address: null, area: null }]) }, { as: 'manager' })
    t.eq('a new option whose mask fits two stored numbers is refused', extra.status, 400)
    t.eq('refusal code', extra.json && extra.json.code, 'masked_phone_input')
    t.eq('nothing written', await triplet(), fresh)
    const typed = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Triplet', address: JSON.stringify([options[0], options[1], { label: 'New', name: 'x', phone: '087 333 321', email: null, address: null, area: null }]) }, { as: 'manager' })
    t.ok(`a new option typed in full is saved (status ${typed.status})`, typed.status === 200, typed.text.slice(0, 200))
    t.eq('typed number kept beside the others', phonesOfAddress((await triplet()).address).slice().sort(), ['087111321', '087222321', '087333321'])
    const hand = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Triplet', address: JSON.stringify([{ ...options[0], phone: '087 ** 321' }]) }, { as: 'manager' })
    t.eq('a hand-edited option mask is refused', hand.status, 400)
  })

  await check("edit: delete the first option and rename the survivor: the first option's number never moves onto it", async (t) => {
    const options = (home, work) => optionJson([
      { label: 'Home', name: 'Pair H', phone: home, email: null, address: 'Street 1', area: null },
      { label: 'Work', name: 'Pair W', phone: work, email: null, address: 'Street 2', area: null },
    ])
    const made = await world.api('POST', '/api/customers', { name: 'Fixture Pair', phone: '090 123 456', address: options('012 345 678', '012 999 678') }, { as: 'admin' })
    t.ok(`fixture created (status ${made.status})`, made.status === 200 || made.status === 201, made.text.slice(0, 200))
    const id = made.json.id
    const pair = () => world.first('SELECT phone, address FROM customers WHERE id = ?', id)
    const read = async () => ((await world.api('GET', `/api/customers?search=Fixture%20Pair&page=1&pageSize=50&cb=${++reads}`, undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === id)
    const shown = JSON.parse((await read()).address)
    t.eq('both options show the same mask', shown.map((option) => option.phone), ['012 *** 678', '012 *** 678'])
    const before = await pair()
    const renamed = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Pair', address: JSON.stringify([{ ...shown[1], label: 'Cell' }]) }, { as: 'manager' })
    t.eq('Home deleted, Work renamed Cell: refused (position 0 is Home, the mask fits two numbers)', renamed.status, 400)
    t.eq('refusal code', renamed.json && renamed.json.code, 'masked_phone_input')
    t.eq('nothing written', await pair(), before)
    const kept = await world.api('PUT', `/api/customers/${id}`, { ...(await read()), name: 'Fixture Pair', address: JSON.stringify([shown[1]]) }, { as: 'manager' })
    t.ok(`Home deleted, Work kept under its label: saved (status ${kept.status})`, kept.status === 200, kept.text.slice(0, 200))
    t.eq('the survivor keeps its own number', JSON.parse((await pair()).address).map((option) => [option.label, digitsOf(option.phone)]), [['Work', '012999678']])
    const solo = await world.api('POST', '/api/customers', { name: 'Fixture Solo', phone: '090 765 432', address: optionJson([{ label: 'Home', name: 'Solo', phone: '012 345 000', email: null, address: 'Street 3', area: null }]) }, { as: 'admin' })
    const soloId = solo.json.id
    const soloRow = ((await world.api('GET', `/api/customers?search=Fixture%20Solo&page=1&pageSize=50&cb=${++reads}`, undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === soloId)
    const relabelled = await world.api('PUT', `/api/customers/${soloId}`, { ...soloRow, name: 'Fixture Solo', address: JSON.stringify([{ ...JSON.parse(soloRow.address)[0], label: 'Cell' }]) }, { as: 'manager' })
    t.ok(`a rename whose mask no other stored number shares is saved (status ${relabelled.status})`, relabelled.status === 200, relabelled.text.slice(0, 200))
    t.eq('and keeps the number', JSON.parse((await world.first('SELECT address FROM customers WHERE id = ?', soloId)).address).map((option) => [option.label, digitsOf(option.phone)]), [['Cell', '012345000']])
  })

  await check('duplicates: dismissing or undismissing a group by a masked value is refused and writes nothing', async (t) => {
    const count = async () => (await world.first('SELECT COUNT(*) AS n FROM contact_duplicate_dismissals')).n
    const before = await count()
    for (const route of ['customers', 'suppliers', 'delivery-contacts']) {
      for (const action of ['dismiss', 'undismiss']) {
        for (const value of ['087 *** 321', '***']) {
          const response = await world.api('POST', `/api/${route}/duplicates/${action}`, { type: 'phone', value }, { as: 'admin' })
          t.eq(`${route} ${action} ${value}`, response.status, 400)
          t.eq(`${route} ${action} ${value} code`, response.json && response.json.code, 'masked_phone_input')
        }
      }
    }
    t.eq('no dismissal row written', await count(), before)
    const real = await world.api('POST', '/api/customers/duplicates/dismiss', { type: 'name', value: 'fixture twin' }, { as: 'admin' })
    t.ok(`a real value still dismisses (status ${real.status})`, real.status === 200, real.text.slice(0, 160))
    t.eq('one row for the real value', await count(), before + 1)
  })

  await check('edit: a number the person types is saved as typed (the mask guard only stops masks)', async (t) => {
    const response = await world.api('PUT', `/api/customers/${ids.customer}`, { name: 'Fixture Dara', phone: '087 654 999' }, { as: 'manager' })
    t.ok(`status ${response.status}`, response.status === 200, response.text.slice(0, 300))
    t.eq('typed number stored', digitsOf((await stored()).phone), '087654999')
    const back = await world.api('PUT', `/api/customers/${ids.customer}`, { name: 'Fixture Dara', phone: original.phone, address: original.address }, { as: 'manager_granted' })
    t.ok(`the holder restores the fixture (status ${back.status})`, back.status === 200, back.text.slice(0, 200))
    t.eq('restored', digitsOf((await stored()).phone), digitsOf(original.phone))
  })

  await check('create: a masked phone is refused, no contact is created', async (t) => {
    const before = (await world.first('SELECT COUNT(*) AS n FROM customers')).n
    for (const body of [{ name: 'Masked Newcomer', phone: '087 *** 321' }, { name: 'Masked Newcomer', phone: '087 654 321', address: optionJson([{ label: 'Work', name: 'x', phone: '098 *** 222', email: null, address: null, area: null }]) }]) {
      const response = await world.api('POST', '/api/customers', body, { as: 'manager' })
      t.eq(`status for ${JSON.stringify(body).slice(0, 60)}`, response.status, 400)
      t.eq('code', response.json && response.json.code, 'masked_phone_input')
    }
    t.eq('no row created', (await world.first('SELECT COUNT(*) AS n FROM customers')).n, before)
    const supplier = await world.api('POST', '/api/suppliers', { name: 'Masked Supplier', phone: '077 *** 444' }, { as: 'manager' })
    t.eq('supplier create refused', supplier.status, 400)
    const delivery = await world.api('POST', '/api/delivery-contacts', { name: 'Masked Courier', phone: '096 *** 666' }, { as: 'manager' })
    t.eq('delivery contact create refused', delivery.status, 400)
  })

  await check('edit: supplier and delivery contact masks resolve against their own record too', async (t) => {
    const supplierBefore = await world.first('SELECT phone FROM suppliers WHERE id = ?', ids.supplier)
    const supplierRow = ((await world.api('GET', `/api/suppliers?search=Fixture&page=1&pageSize=50&cb=${++reads}`, undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === ids.supplier)
    const supplier = await world.api('PUT', `/api/suppliers/${ids.supplier}`, { ...supplierRow, name: 'Fixture Supplies', notes: 'edited' }, { as: 'manager' })
    t.ok(`supplier status ${supplier.status}`, supplier.status === 200, supplier.text.slice(0, 200))
    t.eq('supplier phone unchanged', (await world.first('SELECT phone FROM suppliers WHERE id = ?', ids.supplier)).phone, supplierBefore.phone)
    const deliveryBefore = await world.first('SELECT phone FROM delivery_contacts WHERE id = ?', ids.delivery)
    const deliveryRow = ((await world.api('GET', `/api/delivery-contacts?search=Fixture&page=1&pageSize=50&cb=${++reads}`, undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === ids.delivery)
    const delivery = await world.api('PUT', `/api/delivery-contacts/${ids.delivery}`, { ...deliveryRow, name: 'Fixture Courier' }, { as: 'manager' })
    t.ok(`delivery status ${delivery.status}`, delivery.status === 200, delivery.text.slice(0, 200))
    t.eq('delivery phone unchanged', (await world.first('SELECT phone FROM delivery_contacts WHERE id = ?', ids.delivery)).phone, deliveryBefore.phone)
  })

  await check('merge and link-conflict screens refuse a masked value', async (t) => {
    const [keep, other] = [ids.customer, ids.customer2]
    const rows = await world.query('SELECT id, updated_at FROM customers WHERE id IN (?, ?)', keep, other)
    const merge = await world.api('POST', '/api/customers/merge', {
      keepId: keep, mergeIds: [other], expected: rows.map((row) => ({ id: row.id, updated_at: row.updated_at })),
      choices: { phone: { custom: '087 *** 321' } },
    }, { as: 'admin' })
    t.eq('merge with a masked custom phone', merge.status, 400)
    t.eq('merge code', merge.json && merge.json.code, 'masked_phone_input')
    t.eq('both customers still exist', (await world.first('SELECT COUNT(*) AS n FROM customers WHERE id IN (?, ?)', keep, other)).n, 2)
    for (const [route, body] of [
      ['relink', { customer_id: keep, phone_key: '087 *** 321', value: '087 *** 321' }],
      ['resolve-missing', { name: 'Fixture Dara', phone_key: '087 *** 321', value: '087 *** 321' }],
      ['dismiss', { kind: 'mismatch', value: '087 *** 321' }],
      ['undismiss', { kind: 'mismatch', value: '087 *** 321' }],
    ]) {
      const response = await world.api('POST', `/api/customers/link-conflicts/${route}`, body, { as: 'admin' })
      t.eq(`${route} with a masked value`, response.status, 400)
      t.eq(`${route} code`, response.json && response.json.code, 'masked_phone_input')
    }
  })

  await check('check-duplicate ignores a mask (it can never match, so it can never name a stranger as the owner)', async (t) => {
    const response = await world.api('GET', `/api/customers/check-duplicate?name=Someone%20New&phone=${encodeURIComponent('087 *** 321')}`, undefined, { as: 'manager' })
    t.ok(`status ${response.status}`, response.status === 200, response.text.slice(0, 200))
    t.eq('no candidate for the mask', JSON.stringify(response.json).includes('Fixture Dara'), false)
  })

  finish('phone write guard')
  world.dispose()
}

main().catch((error) => { console.error(error); process.exit(1) })
