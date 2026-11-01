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
  'edit saves the mask it was shown': ['routes/contacts.ts', sub('if (Object.prototype.hasOwnProperty.call(payload, \'phone\')) payload.phone = resolvePhoneInput(payload.phone, storedPhones)', '')],
  'edit saves masked Contact Options': ['routes/contacts.ts', sub('payload.address = resolveAddressInput(payload.address, storedPhones, config.optionMode)', 'payload.address = payload.address')],
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
  const listRow = async (as) => {
    const response = await world.api('GET', '/api/customers?search=Fixture%20Dara&page=1&pageSize=50', undefined, { as })
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
    const supplierRow = ((await world.api('GET', '/api/suppliers?search=Fixture&page=1&pageSize=50', undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === ids.supplier)
    const supplier = await world.api('PUT', `/api/suppliers/${ids.supplier}`, { ...supplierRow, name: 'Fixture Supplies', notes: 'edited' }, { as: 'manager' })
    t.ok(`supplier status ${supplier.status}`, supplier.status === 200, supplier.text.slice(0, 200))
    t.eq('supplier phone unchanged', (await world.first('SELECT phone FROM suppliers WHERE id = ?', ids.supplier)).phone, supplierBefore.phone)
    const deliveryBefore = await world.first('SELECT phone FROM delivery_contacts WHERE id = ?', ids.delivery)
    const deliveryRow = ((await world.api('GET', '/api/delivery-contacts?search=Fixture&page=1&pageSize=50', undefined, { as: 'manager' })).json.items || []).find((row) => Number(row.id) === ids.delivery)
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
