'use strict'
// 6.0.1162 (the security review's B1, B2, B3, E2 and E4), on the REAL Worker.
//
// The projection hides a value from an account without `contacts_full_phone` when the WHOLE value is a number (a note, a label, a
// contact saved under its number) or when a sentence quotes one. Three things went wrong around that rule, all present since the
// lane's first head:
//
//   B1  The forms send back what they were shown, so the mask came back and was SAVED over the real value (a note, an expense label,
//       a product name, a sale line's name). Every writer now reads a mask as "unchanged".
//   B2  A product named by a long digit code (a supplier's item code) was masked as if it were a person. Only people and contacts are
//       masked by name; product, branch and category names are shown as stored.
//   B3  Full numbers left under keys the rule did not know (contact_person, username, cashier, the cashier filter's key).
//   E2  The Legacy deleted sales search read a reason that quotes a number.
//   E4  A contact saved under its number could not be edited by an account without the grant (409 rename_choice_required, an answer it
//       cannot give). A mask now means "unchanged", so the save goes through.
//
// Every check names a fixture that holds a real number, and a positive control proves the account WITH the grant reads it, or a green
// run would prove nothing. Each was red on 21137933b. Synthetic numbers only (the 097 2xx 8xx set).
//
// Run (from cloudflare/): node scripts/test-phone-masked-text-native.cjs
// PHONE_MUTANT=<name> applies one defect to a source file in the in-memory bundle (test-phone-leak-mutants-{crawl,oracle}-native.cjs runs each).
const { createReporter } = require('./harness/real_worker_world.cjs')
const { bootPhoneWorld, PHONES, PRODUCT_CODE, PRODUCT_CODE_MASK, leaksIn, leakPathsIn } = require('./harness/phone_leak_world.cjs')

const sub = (needle, replacement) => (source) => {
  if (!source.includes(needle)) throw new Error(`mutant anchor missing: ${needle}`)
  return source.replace(needle, () => replacement)
}
const MUTANTS = {
  'write: the masked values are not taken out of the request': ['lib/phoneMaskMiddleware.ts', sub('if (sessionActor && !canSeeFullPhones(sessionActor)) await scrubMaskedWrite(c)', '')],
  'write: the masked values are also taken out of an account that holds the grant': ['lib/phoneMaskMiddleware.ts', sub('if (sessionActor && !canSeeFullPhones(sessionActor)) await scrubMaskedWrite(c)', 'if (sessionActor) await scrubMaskedWrite(c)')],
  'write: any text that contains *** is taken for a mask': ['lib/phoneAccess.ts', sub('!== 0) && isMaskedPhone(value))', '!== 0) && value.includes(\'***\'))')],
  'catalog: a product or branch name is masked like a person': ['lib/phoneAccess.ts', sub('kind |= CATALOG_KEY.test(normalized) ? CATALOG : NAME', 'kind |= NAME')],
  'people: contact_person and cashier are not names': ['lib/phoneAccess.ts', sub('summary|person|cashier', 'summary|xperson|xcashier')],
  'people: username is not a name': ['lib/phoneAccess.ts', sub('|cashier|username|user|', '|cashier|xusername|user|')],
  'people: the cashiers list key is shown': ['lib/phoneAccess.ts', sub("if (key === 'key' && typeof value === 'string' && typeof source.name === 'string'", "if (false && typeof value === 'string' && typeof source.name === 'string'")],
  'search: the legacy deleted reason is read raw': ['routes/compat.ts', sub("lower(COALESCE(${searchableColumnSql('d.deletion_reason', phoneAccess)}, '')) LIKE @search", "lower(COALESCE(d.deletion_reason, '')) LIKE @search")],
  'search: the legacy deleted cashier filter reads the number': ['routes/compat.ts', sub("lower(trim(${searchableColumnSql({ sql: \"COALESCE(d.cashier_name, d.deleted_by, '')\", key: 'cashier_name' }, phoneAccess)})) = lower(trim(@cashier))", "lower(trim(COALESCE(d.cashier_name, d.deleted_by, ''))) = lower(trim(@cashier))")],
}

const enc = encodeURIComponent
const WINDOW = 'startDate=2000-01-01&endDate=2100-01-01'
const SOLD_CODE = '88598765432101'
const SOLD_CODE_MASK = '885 *** 101'

async function main() {
  const mutant = process.env.PHONE_MUTANT ? MUTANTS[process.env.PHONE_MUTANT] : null
  if (process.env.PHONE_MUTANT && !mutant) throw new Error(`unknown PHONE_MUTANT ${process.env.PHONE_MUTANT}`)
  const world = await bootPhoneWorld({ transformSources: mutant ? (file, source) => (file === mutant[0] ? mutant[1](source) : source) : undefined })
  const { check, finish } = createReporter()
  const { ids } = world
  let reads = 0
  const get = (route, as) => world.api('GET', route, undefined, { as })
  const itemsOf = (response) => (response.json && (response.json.items || response.json.rows || response.json.fees || response.json.products || response.json.data || (Array.isArray(response.json) ? response.json : []))) || []
  const rowOf = async (route, as, id) => itemsOf(await get(`${route}${route.includes('?') ? '&' : '?'}ids=${id}&page=1&pageSize=200&cb=${++reads}`, as)).find((row) => Number(row.id) === Number(id))

  const productRow = async (as) => itemsOf(await get(`/api/products?search=${enc(PRODUCT_CODE)}&page=1&pageSize=5&cb=${++reads}`, as)).find((item) => Number(item.id) === Number(ids.digitProduct))

  // ---------------------------------------------------------------- B1: the mask is never saved over the real value
  await check('B1 customers.notes: a note that is a number, sent back as shown by an account without the grant, is kept', async (t) => {
    const row = await rowOf('/api/customers', 'manager', ids.notedCustomer)
    t.eq('positive control: the note is shown masked', row && row.notes, '097 *** 822')
    t.eq('positive control: the account with the grant reads it', (await rowOf('/api/customers', 'manager_granted', ids.notedCustomer) || {}).notes, PHONES.customerNote)
    const put = await world.api('PUT', `/api/customers/${ids.notedCustomer}`, { ...row, email: 'noted@example.test' }, { as: 'manager' })
    t.ok(`status ${put.status}`, put.status === 200, put.text.slice(0, 200))
    const after = await world.first('SELECT notes, email FROM customers WHERE id = ?', ids.notedCustomer)
    t.eq('the edit happened (the email)', after.email, 'noted@example.test')
    t.eq('the stored note is still the real number', after.notes, PHONES.customerNote)
  })

  await check('B1 suppliers.notes and contact_person: sent back as shown, both are kept', async (t) => {
    const row = await rowOf('/api/suppliers', 'manager', ids.notedSupplier)
    t.eq('positive control: the note is shown masked', row && row.notes, '097 *** 827')
    t.eq('positive control: the contact person is shown masked', row && row.contact_person, '097 *** 812')
    const put = await world.api('PUT', `/api/suppliers/${ids.notedSupplier}`, { ...row, email: 'noted-supplier@example.test' }, { as: 'manager' })
    t.ok(`status ${put.status}`, put.status === 200, put.text.slice(0, 200))
    const after = await world.first('SELECT notes, contact_person, email FROM suppliers WHERE id = ?', ids.notedSupplier)
    t.eq('the edit happened (the email)', after.email, 'noted-supplier@example.test')
    t.eq('the stored note is still the real number', after.notes, PHONES.supplierNote)
    t.eq('the stored contact person is still the real number', after.contact_person, PHONES.contactPerson)
  })

  await check('B1 fees.label and notes: editing only the amount keeps a label and a note that are numbers', async (t) => {
    const row = await rowOf('/api/fees', 'manager', ids.numberedFee)
    t.eq('positive control: the label is shown masked', row && row.label, '097 *** 831')
    const put = await world.api('PUT', `/api/fees/${ids.numberedFee}`, { ...row, amount_usd: 2 }, { as: 'manager' })
    t.ok(`status ${put.status}`, put.status === 200, put.text.slice(0, 200))
    const after = await world.first('SELECT label, notes, amount_usd FROM fees WHERE id = ?', ids.numberedFee)
    t.eq('the amount changed (the edit happened)', after.amount_usd, 2)
    t.eq('the stored label is still the real number', after.label, PHONES.feeLabel)
    t.eq('the stored note is still the real number', after.notes, PHONES.feeNote)
  })

  await check('B1 products.name: a mask sent as the name of a product is never saved (an old till, a cached list)', async (t) => {
    const product = await productRow('manager')
    t.ok('the product is in the list', !!product)
    const put = await world.api('PUT', `/api/products/${ids.digitProduct}`, { ...product, name: PRODUCT_CODE_MASK, selling_price_usd: 3 }, { as: 'manager' })
    t.ok(`status ${put.status}`, put.status === 200, put.text.slice(0, 200))
    const after = await world.first('SELECT name, selling_price_usd FROM products WHERE id = ?', ids.digitProduct)
    t.eq('the price changed (the edit happened)', after.selling_price_usd, 3)
    t.eq('the stored name is still the code', after.name, PRODUCT_CODE)
  })

  await check('B1 sale_items.product_name: a cashier whose till holds a masked name sells the product under its real name', async (t) => {
    const sold = await world.placeSale({ as: 'cashier', customerId: null, customerName: 'Walk-in', customerPhone: '', productName: SOLD_CODE, lineName: SOLD_CODE_MASK })
    t.ok(`the sale is created (status ${sold.status})`, sold.status === 200 || sold.status === 201, sold.text.slice(0, 300))
    const saleId = sold.json && (sold.json.id ?? (sold.json.sale && sold.json.sale.id))
    const line = await world.first('SELECT product_name FROM sale_items WHERE sale_id = ? ORDER BY id LIMIT 1', saleId)
    t.eq('the stored line carries the product row\'s name', line && line.product_name, SOLD_CODE)
  })

  // ---------------------------------------------------------------- the scrub reads only the exact mask, and only for an account without the grant
  await check('B1 the scrub drops only a value that IS the mask, and only for an account without the grant: "call *** later" is saved as typed', async (t) => {
    const made = await world.api('POST', '/api/customers', { name: 'B1 Typed Notes', phone: '097 280 880', membership_number: 'LC-B1-TYPED' }, { as: 'admin' })
    t.ok(`fixture created (status ${made.status})`, made.status === 200 || made.status === 201, made.text.slice(0, 200))
    const id = made.json && made.json.id
    const save = (notes, as) => world.api('PUT', `/api/customers/${id}`, { name: 'B1 Typed Notes', notes }, { as })
    const stored = async () => (await world.first('SELECT notes FROM customers WHERE id = ?', id)).notes
    // An account without the grant: text that merely contains *** or digits is a note, not a mask.
    for (const notes of ['call *** later', 'a *** b', '097 **** 822', '097 ** 822', 'ref 4471', '097 262 822']) {
      const put = await save(notes, 'manager')
      t.ok(`manager saves "${notes}" (status ${put.status})`, put.status === 200, put.text.slice(0, 200))
      t.eq(`manager: "${notes}" is stored as typed`, await stored(), notes)
    }
    // A value that IS the mask means "unchanged": the stored note stays.
    await save('keep this note', 'manager')
    const masked = await save('097 *** 822', 'manager')
    t.ok(`manager sends back the mask (status ${masked.status})`, masked.status === 200, masked.text.slice(0, 200))
    t.eq('manager: the mask did not replace the stored note', await stored(), 'keep this note')
    // The scrub does not run for an account that holds the grant: it is never shown a mask, so a mask-shaped note is what it typed.
    const holder = await save('097 *** 822', 'manager_granted')
    t.ok(`manager_granted saves a mask-shaped note (status ${holder.status})`, holder.status === 200, holder.text.slice(0, 200))
    t.eq('manager_granted: stored as typed', await stored(), '097 *** 822')
  })

  // ---------------------------------------------------------------- E4: a contact saved under its number can be edited
  await check('E4 a contact saved under its number: the form sent back as shown saves (no rename question it cannot answer)', async (t) => {
    await world.run("INSERT INTO delivery_contacts (id, name, phone, area) VALUES (9202, ?, '', 'East')", '097 268 828')
    for (const [label, route, id, table] of [['customer', '/api/customers', ids.customerPhoneName, 'customers'], ['delivery contact', '/api/delivery-contacts', 9202, 'delivery_contacts']]) {
      const row = await rowOf(route, 'manager', id)
      t.ok(`${label}: the name is shown masked`, !!row && /\*\*\*/.test(String(row.name)), row && row.name)
      const before = await world.first(`SELECT name FROM ${table} WHERE id = ?`, id)
      const put = await world.api('PUT', `${route}/${id}`, { ...row, email: `${label.replace(' ', '-')}@example.test` }, { as: 'manager' })
      t.eq(`${label}: status`, put.status, 200)
      t.ok(`${label}: no rename_choice_required`, !(put.json && put.json.code === 'rename_choice_required'), put.text.slice(0, 200))
      t.eq(`${label}: the stored name is untouched`, (await world.first(`SELECT name FROM ${table} WHERE id = ?`, id)).name, before.name)
    }
  })

  // ---------------------------------------------------------------- B2: only people are masked by name
  await check('B2 a product named by a digit code is shown in full to everybody (list, detail, POS search); a contact named by digits is still masked', async (t) => {
    for (const as of ['manager', 'cashier', 'manager_granted']) {
      const row = await productRow(as)
      t.eq(`products list as ${as}`, row && row.name, PRODUCT_CODE)
    }
    for (const as of ['cashier']) {
      const search = await get(`/api/products/search?query=${enc('8851234')}`, as)
      t.ok(`POS search as ${as} shows the code (status ${search.status})`, search.text.includes(`"name":"${PRODUCT_CODE}"`), search.text.slice(0, 160))
    }
    // The same name under a prefixed key (a movement's product_name and branch_name): shown as stored too.
    await world.run(
      `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
       VALUES (NULL, ?, ?, '095 777 626', 'adjustment', 1, 'code recount', NULL, 'Sok', datetime('now'))`,
      PRODUCT_CODE, ids.branch,
    )
    for (const as of ['manager']) {
      const movements = await get(`/api/inventory/movements?search=${enc('code recount')}&cb=${++reads}`, as)
      t.ok(`movement log as ${as}: product_name shows the code (status ${movements.status})`, movements.text.includes(`"product_name":"${PRODUCT_CODE}"`), movements.text.slice(0, 200))
      t.ok(`movement log as ${as}: branch_name shows the number it is named by`, movements.text.includes('"branch_name":"095 777 626"'), movements.text.slice(0, 200))
    }
    const person = await rowOf('/api/customers', 'manager', ids.customerPhoneName)
    t.ok('a customer saved under digits is still masked', !!person && /\*\*\*/.test(String(person.name)) && !String(person.name).includes('222'), person && person.name)
  })

  // ---------------------------------------------------------------- B3: no person-name or free-text key carries a full number
  await check('B3 contact_person, username, cashier and the cashier filter key are masked; the holder still reads them', async (t) => {
    const probes = [
      ['suppliers list: contact_person', `/api/suppliers?ids=${ids.notedSupplier}&page=1&pageSize=50`, 'manager'],
      ['audit log: username / user_name', '/api/system/audit-logs?limit=200&pageSize=200', 'sales_only'],
      ['Reports > Sales: cashier', `/api/reports/business-summary/sales?${WINDOW}`, 'cashier'],
      ['Legacy deleted sales: cashier and meta.cashiers key', '/api/system/legacy-deleted-sales', 'manager'],
    ]
    for (const [label, route, as] of probes) {
      const denied = await get(route, as)
      const holder = await get(route, 'admin')
      t.ok(`${label}: positive control, the administrator reads the number (status ${holder.status})`, holder.status === 200 && leaksIn(holder.text).length > 0 && JSON.stringify(leakPathsIn(holder.json)).length > 2, holder.text.slice(0, 160))
      t.eq(`${label}: ${as} reads no full number (status ${denied.status})`, leakPathsIn(denied.json || {}), [])
      t.ok(`${label}: ${as} still reads the masked form`, /\d{3} \*\*\* \d{3}/.test(denied.text), denied.text.slice(0, 160))
    }
    const own = await get('/api/auth/me', 'cashier')
    t.ok('an account still reads its own display name and username in full', own.status === 200 && own.text.includes('"username":"cashier"'), own.text.slice(0, 200))
  })

  await check('B3 a supplier whose contact person is a number is found by a fragment of it (owner decision of 10 Nov 2026), and the reply shows it masked', async (t) => {
    for (const fragment of ['252', '812', '097 252']) {
      const response = await get(`/api/suppliers?search=${enc(fragment)}&page=1&pageSize=50&cb=${++reads}`, 'manager')
      t.eq(`manager searching "${fragment}"`, itemsOf(response).some((row) => Number(row.id) === ids.notedSupplier), true)
      t.ok(`manager searching "${fragment}": the number is not in the reply`, !response.text.includes(PHONES.contactPerson))
    }
    t.eq('positive control: the administrator finds it by "252"', itemsOf(await get(`/api/suppliers?search=${enc('252')}&page=1&pageSize=50&cb=${++reads}`, 'admin')).some((row) => Number(row.id) === ids.notedSupplier), true)
  })

  // ---------------------------------------------------------------- E2: the Legacy deleted sales search
  await check('E2 Legacy deleted sales: a reason that quotes a number, and a cashier saved under one, are not searchable without the grant', async (t) => {
    const count = async (query, as) => ((await get(`/api/system/legacy-deleted-sales?${query}`, as)).json || { items: [] }).items.length
    t.eq('positive control: the administrator finds the row by a fragment of the quoted number', await count('search=247', 'admin'), 1)
    t.eq('manager: the quoted number is not searchable', await count('search=247', 'manager'), 0)
    t.eq('manager: nor by the rest of it', await count('search=807', 'manager'), 0)
    await world.run(`INSERT INTO legacy_deleted_sale_items (event_key, invoice_no, cashier_name, deletion_reason, deleted_at, source_product_name, product_name, source_file, source_row)
      VALUES ('p28-ev2', 'P28-INV-2', 'Sok', 'broken seal batch 4471', datetime('now'), 'Fixture Soap', 'Fixture Soap', 'p28.xls', 2)`)
    t.eq('manager: an ordinary reason is still found, digits and all', await count('search=4471', 'manager'), 1)
    t.eq('manager: a word of an ordinary reason is found', await count('search=broken', 'manager'), 1)
    t.eq('positive control: the administrator finds both by "p28-inv"', await count('search=p28-inv', 'admin'), 2)
    t.eq('positive control: the administrator filters on the cashier saved under a number', await count(`cashier=${enc(PHONES.legacyCashier)}`, 'admin'), 1)
    t.eq('manager: the cashier filter does not take the number', await count(`cashier=${enc(PHONES.legacyCashier)}`, 'manager'), 0)
  })

  finish(`phone masked text${process.env.PHONE_MUTANT ? ` [mutant ${process.env.PHONE_MUTANT}]` : ''}`)
  await world.dispose()
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
