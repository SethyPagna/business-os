'use strict'
// P2.8 (6.0.1046): search must not spell out a hidden number, on the REAL Worker (every middleware, route and lib).
//
// The account without `contacts_full_phone` types digit fragments of numbers it can only read masked (087 *** 321) into
// the Contacts search, the POS customer picker, the Sales and Returns search, the delivery-contact picker and the audit
// log, and must get nothing back through a phone; the whole number must still find the customer (masked in the reply);
// names, receipts and membership numbers must search as before; and the holder's results must be today's.
//
// Run (from cloudflare/): node scripts/test-phone-search-oracle-native.cjs
// PHONE_MUTANT=<name> applies one defect to a source file in the in-memory bundle (test-phone-leak-mutants-native.cjs runs each).
const { createReporter } = require('./harness/real_worker_world.cjs')
const { bootPhoneWorld, PHONES, leaksIn, snippetOf } = require('./harness/phone_leak_world.cjs')

const sub = (needle, replacement) => (source) => {
  if (!source.includes(needle)) throw new Error(`mutant anchor missing: ${needle}`)
  return source.replace(needle, () => replacement)
}
const MUTANTS = {
  'sales digit words read the phone': ['routes/sales.ts', sub("probe.kind !== 'none' && isDigitWord(word) ? flatHaystackWithoutPhones : flatHaystack", 'flatHaystack')],
  'sales whole number not compared': ['routes/sales.ts', sub("if (probe.kind !== 'full') return searched", 'return searched')],
  'sales number saved as a name readable': ['routes/sales.ts', sub("nameWithoutPhoneSql('s.customer_name')", "\"COALESCE(s.customer_name, '')\"")],
  'delivery picker matches phone fragments': ['routes/sales.ts', sub("const probe = canSeeFullPhones(user) ? ({ kind: 'none' } as const) : phoneProbeOf(search)", "const probe = ({ kind: 'none' } as const)")],
  'returns digit words read the name': ['routes/returns.ts', sub("guardDigitWords && isDigitWord(word) ? digitWordHaystack : flatHaystack", 'flatHaystack')],
  'audit search reads phone text': ['routes/compat.ts', sub('phoneTextBlocked: !canSeeFullPhones(user),', 'phoneTextBlocked: false,')],
  'contacts search ignores the grant': ['lib/contactSearch.ts', sub("access.fullPhone ? ({ kind: 'none' } as const) : phoneProbeOf(rawSearch)", "({ kind: 'none' } as const)")],
}

const receiptsIn = (text) => [...new Set(String(text).match(/P28-000\d/g) || [])].sort()
const has = (text, needle) => String(text).includes(needle)

async function main() {
  const mutant = process.env.PHONE_MUTANT ? MUTANTS[process.env.PHONE_MUTANT] : null
  if (process.env.PHONE_MUTANT && !mutant) throw new Error(`unknown PHONE_MUTANT ${process.env.PHONE_MUTANT}`)
  const world = await bootPhoneWorld({ transformSources: mutant ? (file, source) => (file === mutant[0] ? mutant[1](source) : source) : undefined })
  const { check, finish } = createReporter()
  const enc = encodeURIComponent
  const get = (route, as) => world.api('GET', route, undefined, { as })

  // One more return whose customer was saved under a phone number (the seeded return names a person).
  await world.run(
    `INSERT INTO returns (return_number, customer_id, customer_name, sale_id, return_scope, status, total_refund_usd, total_refund_khr, receipt_number, search_normalized, created_at)
     VALUES ('P28-RET-2', ?, ?, ?, 'customer', 'completed', 2, 8000, 'P28-0003', 'p28-ret-2 010222333', datetime('now'))`,
    world.ids.customerPhoneName, PHONES.phoneAsName, world.ids.sale2,
  )

  // ---- positive controls: the holder reads through the same boxes, or a green run proves nothing -----------------------
  await check('positive control: the holder finds contacts, sales and returns by a number fragment', async (t) => {
    t.ok('customers 654', has((await get(`/api/customers?search=${enc('654')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Dara'))
    t.ok('customers 111 (a Contact Option)', has((await get(`/api/customers?search=${enc('111')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Dara'))
    t.ok('suppliers 333', has((await get(`/api/suppliers?search=${enc('333')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Supplies'))
    t.ok('delivery 555', has((await get(`/api/delivery-contacts?search=${enc('555')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Courier'))
    t.ok('picker 0876', has((await get(`/api/customers?fields=sales_picker&search=${enc('0876')}`, 'manager_granted')).text, 'Fixture Dara'))
    t.eq('sales 654', receiptsIn((await get(`/api/sales?search=${enc('654')}`, 'admin')).text), ['P28-0001'])
    t.eq('sales 999', receiptsIn((await get(`/api/sales?search=${enc('999')}`, 'admin')).text), ['P28-0002'])
    t.ok('sales 222 reaches the sale saved under a number', receiptsIn((await get(`/api/sales?search=${enc('222')}`, 'admin')).text).includes('P28-0003'))
    t.ok('returns 222', has((await get(`/api/returns?search=${enc('222')}`, 'admin')).text, 'P28-RET-2'))
    t.ok('audit 222 (the customer saved under a number)', JSON.parse((await get(`/api/system/audit-logs?search=${enc('222')}&pageSize=50`, 'admin')).text).items.length > 0)
  })

  // ---- no grant: no digit fragment of a hidden number finds anything ----------------------------------------------------
  const FRAGMENTS = ['087', '0876', '654', '654321', '321', '98 111', '111', '222', '111 111 111 111', '654 654 654', '0123 0123 0123', '999', '085', '999 000', '999 999 999']
  await check('no grant: Contacts search (customers, suppliers, delivery contacts) returns nobody for a digit fragment', async (t) => {
    for (const [route, name] of [['customers', 'Fixture Dara'], ['suppliers', 'Fixture Supplies'], ['delivery-contacts', 'Fixture Courier']]) {
      for (const q of [...FRAGMENTS, '333', '444 555', '078', '555', '095', '666 777']) {
        const r = await get(`/api/${route}?search=${enc(q)}&page=1&pageSize=50`, 'manager')
        t.ok(`${route} ${q}: status ${r.status}`, r.status === 200)
        t.ok(`${route} ${q}: ${name} must not be found`, !has(r.text, name), snippetOf(r.text))
        t.eq(`${route} ${q}: no number leaks`, leaksIn(r.text), [])
      }
    }
    t.ok('the customer saved under a number is not found by a fragment of it', !has((await get(`/api/customers?search=${enc('222')}&page=1&pageSize=50`, 'manager')).text, 'P28-3'))
  })
  await check('no grant: the POS customer picker returns nobody for a digit fragment', async (t) => {
    for (const q of FRAGMENTS) {
      const r = await get(`/api/customers?fields=sales_picker&search=${enc(q)}`, 'manager')
      t.ok(`picker ${q}`, !has(r.text, 'Fixture Dara') && !has(r.text, 'Fixture Sophea'), snippetOf(r.text))
      t.eq(`picker ${q} leaks`, leaksIn(r.text), [])
    }
  })
  await check('no grant: Sales search returns no sale for a digit fragment of the customer number', async (t) => {
    for (const q of ['654', '654321', '0876', '999', '999 000', '085', '222', '010', '654 654 654', '999 999 999']) {
      const r = await get(`/api/sales?search=${enc(q)}`, 'sales_only')
      t.ok(`sales ${q}: status ${r.status}`, r.status === 200)
      t.eq(`sales ${q}`, receiptsIn(r.text), [])
      t.eq(`sales ${q} leaks`, leaksIn(r.text), [])
    }
  })
  await check('no grant: Returns search does not read a customer name that is a number', async (t) => {
    for (const q of ['222', '010', '010222333', '222 333']) {
      const r = await get(`/api/returns?search=${enc(q)}`, 'sales_only')
      t.ok(`returns ${q}: status ${r.status}`, r.status === 200)
      t.ok(`returns ${q}: P28-RET-2 must not be found`, !has(r.text, 'P28-RET-2'), snippetOf(r.text))
      t.eq(`returns ${q} leaks`, leaksIn(r.text), [])
    }
  })
  await check('no grant: delivery-contact picker matches no phone fragment', async (t) => {
    const holder = await get(`/api/sales/delivery-options?search=${enc('555')}`, 'manager_granted')
    t.ok(`positive control: the holder finds the courier by 555 (status ${holder.status})`, holder.status === 200 && has(holder.text, 'Fixture Courier'), holder.text.slice(0, 200))
    for (const q of ['555', '096', '666 777', '095']) {
      const r = await get(`/api/sales/delivery-options?search=${enc(q)}`, 'manager')
      t.ok(`delivery-options ${q}: status ${r.status}`, r.status === 200)
      t.ok(`delivery-options ${q}: no courier`, !has(r.text, 'Fixture Courier'), snippetOf(r.text))
      t.eq(`delivery-options ${q} leaks`, leaksIn(r.text), [])
    }
  })
  await check('no grant: the audit log does not match a number typed against recorded phone text', async (t) => {
    for (const q of ['222', '010', '333', '010 222 333']) {
      const r = await get(`/api/system/audit-logs?search=${enc(q)}&pageSize=50`, 'sales_only')
      t.ok(`audit ${q}: status ${r.status}`, r.status === 200, r.text.slice(0, 160))
      const items = (JSON.parse(r.text).items) || []
      t.eq(`audit ${q}: rows found through recorded phone text`, items.length, 0)
      t.eq(`audit ${q} leaks`, leaksIn(r.text), [])
    }
  })

  // ---- no grant: the whole number still finds the customer, and the reply is masked ----------------------------------------
  await check('no grant: the whole number finds the customer, masked', async (t) => {
    const customers = await get(`/api/customers?search=${enc('087 654 321')}&page=1&pageSize=50`, 'manager')
    t.ok('customers: Fixture Dara found by the whole number', has(customers.text, 'Fixture Dara'), customers.text.slice(0, 200))
    t.ok('customers: the number is masked', has(customers.text, '087 *** 321'))
    t.eq('customers: no leak', leaksIn(customers.text), [])
    for (const q of ['087 654 321', '087654321', '087-654-321', '+855 87 654 321']) {
      const picker = await get(`/api/customers?fields=sales_picker&search=${enc(q)}`, 'manager')
      t.ok(`picker ${q}: Fixture Dara found`, has(picker.text, 'Fixture Dara'), picker.text.slice(0, 200))
      t.eq(`picker ${q}: no leak`, leaksIn(picker.text), [])
    }
    const option = await get(`/api/customers?search=${enc('098 111 222')}&page=1&pageSize=50`, 'manager')
    t.ok('a Contact Option number finds its customer', has(option.text, 'Fixture Dara'))
    t.eq('option: no leak', leaksIn(option.text), [])
    const supplier = await get(`/api/suppliers?search=${enc('077 333 444')}&page=1&pageSize=50`, 'manager')
    t.ok('supplier found by its number', has(supplier.text, 'Fixture Supplies'))
    t.eq('supplier: no leak', leaksIn(supplier.text), [])
    const delivery = await get(`/api/delivery-contacts?search=${enc('096 555 666')}&page=1&pageSize=50`, 'manager')
    t.ok('delivery contact found by its number', has(delivery.text, 'Fixture Courier'))
    t.eq('delivery contact: no leak', leaksIn(delivery.text), [])
    const sale = await get(`/api/sales?search=${enc('085 999 000')}`, 'sales_only')
    t.eq('sale found by the number typed on it', receiptsIn(sale.text), ['P28-0002'])
    t.eq('sale: no leak', leaksIn(sale.text), [])
    const sale1 = await get(`/api/sales?search=${enc('087 654 321')}`, 'sales_only')
    t.ok('sale of the customer found by the whole number', receiptsIn(sale1.text).includes('P28-0001'))
    const options = await get(`/api/sales/delivery-options?search=${enc('096 555 666')}`, 'manager')
    t.ok('delivery picker finds the courier by the whole number', has(options.text, 'Fixture Courier'), options.text.slice(0, 200))
    t.eq('delivery picker: no leak', leaksIn(options.text), [])
  })
  await check('no grant: a number that is one digit off finds nobody', async (t) => {
    t.ok('customers', !has((await get(`/api/customers?search=${enc('087 654 322')}&page=1&pageSize=50`, 'manager')).text, 'Fixture Dara'))
    t.ok('picker', !has((await get(`/api/customers?fields=sales_picker&search=${enc('087654322')}`, 'manager')).text, 'Fixture Dara'))
    t.eq('sales', receiptsIn((await get(`/api/sales?search=${enc('085 999 001')}`, 'sales_only')).text), [])
  })

  // ---- no grant: everything that is not a phone searches as before -----------------------------------------------------------
  await check('no grant: names, receipts, membership numbers and e-mail search as before (and as the holder)', async (t) => {
    for (const [route, q, name] of [['customers', 'dara', 'Fixture Dara'], ['customers', 'LC-P28-1', 'Fixture Dara'], ['customers', 'dara@example', 'Fixture Dara'], ['suppliers', 'vanna', 'Fixture Supplies'], ['delivery-contacts', 'north', 'Fixture Courier']]) {
      const denied = await get(`/api/${route}?search=${enc(q)}&page=1&pageSize=50`, 'manager')
      t.ok(`${route} ${q}: found`, has(denied.text, name), denied.text.slice(0, 200))
    }
    const picker = await get(`/api/customers?fields=sales_picker&search=${enc('LC-P28-2')}`, 'manager')
    t.ok('picker by membership number', has(picker.text, 'Fixture Sophea'))
    t.eq('sales by receipt digits', receiptsIn((await get(`/api/sales?search=${enc('0001')}`, 'sales_only')).text), ['P28-0001'])
    t.eq('sales by receipt', receiptsIn((await get(`/api/sales?search=${enc('P28-0002')}`, 'sales_only')).text), ['P28-0002'])
    t.ok('sales by customer name', receiptsIn((await get(`/api/sales?search=${enc('dara')}`, 'sales_only')).text).includes('P28-0001'))
    t.ok('returns by return number', has((await get(`/api/returns?search=${enc('P28-RET-1')}`, 'sales_only')).text, 'P28-RET-1'))
    const audit = JSON.parse((await get(`/api/system/audit-logs?search=${enc('Fixture')}&pageSize=50`, 'sales_only')).text)
    t.ok('audit by a name still finds rows', audit.items.length > 0, 'no audit rows for the word Fixture')
  })
  await check('holder of the same role gets the same names-and-receipts results as the account without the grant', async (t) => {
    for (const q of ['dara', 'P28-0002', 'Fixture']) {
      const denied = receiptsIn((await get(`/api/sales?search=${enc(q)}`, 'sales_only')).text)
      const holder = receiptsIn((await get(`/api/sales?search=${enc(q)}`, 'admin')).text)
      t.eq(`sales ${q}`, denied, holder)
    }
  })

  // ---- source guard: no search call site can forget the access argument -----------------------------------------------------
  await check('source guard: every contact, sales and returns search call site names the access', async (t) => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = path.join(__dirname, '..', 'src')
    const read = (file) => fs.readFileSync(path.join(src, file), 'utf8')
    const callsOf = (file, name) => (read(file).match(new RegExp(`${name}\\(`, 'g')) || []).length - (new RegExp(`function ${name}\\(`).test(read(file)) ? 1 : 0)
    const argued = (file, re) => (read(file).match(re) || []).length
    t.eq('contacts.ts buildContactMatchClause calls carry the access', argued('routes/contacts.ts', /buildContactMatchClause\([^)]*phoneSearchAccessOf\(/g), callsOf('routes/contacts.ts', 'buildContactMatchClause'))
    t.eq('contacts.ts buildSalesCustomerMatchClause calls carry the access', argued('routes/contacts.ts', /buildSalesCustomerMatchClause\([^)]*phoneSearchAccessOf\(/g), callsOf('routes/contacts.ts', 'buildSalesCustomerMatchClause'))
    t.eq('sales.ts buildSalesSearchWhere calls carry the access', argued('routes/sales.ts', /buildSalesSearchWhere\(query, params, phoneSearchAccessOf\(/g), callsOf('routes/sales.ts', 'buildSalesSearchWhere'))
    t.eq('returns.ts returnsFilter calls carry the access', argued('routes/returns.ts', /returnsFilter\([\s\S]*?phoneSearchAccessOf\(/g), callsOf('routes/returns.ts', 'returnsFilter'))
  })

  finish('phone search oracle')
  world.dispose()
}

main().catch((error) => { console.error(error); process.exit(1) })
