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
const { disguises } = require('./harness/phone_disguises.cjs')

const sub = (needle, replacement) => (source) => {
  if (!source.includes(needle)) throw new Error(`mutant anchor missing: ${needle}`)
  return source.replace(needle, () => replacement)
}
// The review's B1 defect: the guard was decided on the RAW text, so a search whose raw text is not all digits (an accent, a
// letter o, a joiner) escaped it although the matcher reads those words as digits.
const RAW_DIGITS = '/^[\\d\\s+().-]+$/'
// A column read raw by the restricted search, as a SearchColumn whose key carries no mask (lib/phoneSearchGuard.ts restrictedColumnSql).
const RAW = (column) => `{ sql: "COALESCE(${column}, '')", key: 'raw' }`
const subAll = (needle, replacement) => (source) => {
  if (!source.includes(needle)) throw new Error(`mutant anchor missing: ${needle}`)
  return source.split(needle).join(replacement)
}
const MUTANTS = {
  'sales digit words read the phone': ['routes/sales.ts', sub('restricted ? restrictedWordHaystacks(word, RESTRICTED_HAYSTACK) : [flatHaystack]', '[flatHaystack]')],
  'sales digit words guarded only for a raw all-digit search': ['routes/sales.ts', sub('const restricted = !access.fullPhone && hasDigit(word)', `const restricted = !access.fullPhone && ${RAW_DIGITS}.test(raw) && hasDigit(word)`)],
  'sales whole number not compared': ['routes/sales.ts', sub("if (probe.kind !== 'full') return searched", 'return searched')],
  'sales number saved as a name readable': ['routes/sales.ts', sub("'s.cashier_name', 's.customer_name',", `'s.cashier_name', ${RAW('s.customer_name')},`)],
  'delivery picker matches phone fragments': ['routes/sales.ts', sub("const probe = canSeeFullPhones(user) ? ({ kind: 'none' } as const) : phoneProbeOf(search)", "const probe = ({ kind: 'none' } as const)")],
  'returns digit words read the name': ['routes/returns.ts', sub('restricted ? restrictedWordHaystacks(word, RESTRICTED_HAYSTACK) : [flatHaystack]', '[flatHaystack]')],
  'contacts only an all-digit word is guarded': ['lib/contactSearch.ts', sub('if (digitWordsAvoidPhones && hasDigit(word))', 'if (digitWordsAvoidPhones && /^[0-9]+$/.test(word))')],
  'returns digit words guarded only for a raw all-digit search': ['routes/returns.ts', sub('const guardDigitWords = !access.fullPhone', `const guardDigitWords = !access.fullPhone && ${RAW_DIGITS}.test(search)`)],
  'audit search reads phone text': ['routes/compat.ts', sub('phoneTextBlocked: !canSeeFullPhones(user),', 'phoneTextBlocked: false,')],
  'sales stats cache shared across grants': ['routes/sales.ts', sub('}, cacheIdentity(c, { scope: phoneCacheVariant(user) }))', '}, cacheIdentity(c))')],
  'contacts search ignores the grant': ['lib/contactSearch.ts', sub('if (access.fullPhone) {', 'if (true) {')],
  'contacts digit words guarded only for a raw all-digit search': ['lib/contactSearch.ts', sub('`${paramPrefix}_restricted`, true)', `\`\${paramPrefix}_restricted\`, ${RAW_DIGITS}.test(String(rawSearch ?? '')))`)],
  'reports sales list matches the phone by substring': ['routes/reports.ts', sub('rows = rows.filter(salesReportSearchMatcher(search, phoneSearchAccessOf(user)))', 'rows = rows.filter(salesReportSearchMatcher(search, { fullPhone: true }))')],
  'reports sales export matches the phone by substring': ['routes/reports.ts', sub('const cohort = salesExportCohort(snapshot, search, phoneSearchAccessOf(user))', 'const cohort = salesExportCohort(snapshot, search, { fullPhone: true })')],
  'non-ASCII digits are not folded': ['lib/phoneMask.ts', sub('code > 0x7f && DECIMAL_DIGIT.test(char)', 'false')],
  'delivery picker reads a numeric courier name': ['routes/sales.ts', sub("const nameColumn = probe.kind === 'none' ? \"lower(COALESCE(name,''))\" : `lower(${nameWithoutPhoneSql('name')})`", "const nameColumn = \"lower(COALESCE(name,''))\"")],
  // P2.8-F: the 0-to-o retry of a word that mixes letters and digits must read the raw non-phone text and nothing else.
  'sales zero-to-o retry reaches the phone column': ['routes/sales.ts', sub('restrictedWordHaystacks(word, RESTRICTED_HAYSTACK)', '[RESTRICTED_HAYSTACK, ...restrictedWordHaystacks(word, flatHaystack).slice(1)]')],
  'returns zero-to-o retry reaches the folded copy': ['routes/returns.ts', sub('restrictedWordHaystacks(word, RESTRICTED_HAYSTACK)', '[RESTRICTED_HAYSTACK, ...restrictedWordHaystacks(word, flatHaystack).slice(1)]')],
  'zero-to-o retry removed (a mixed word is lost again)': ['lib/phoneSearchGuard.ts', sub("? [rawHaystack, `replace(lower(${rawHaystack}),'o','0')`] : [rawHaystack]", '? [rawHaystack] : [rawHaystack]')],
  'zero-to-o retry also for a digit-only word': ['lib/phoneSearchGuard.ts', sub('/\\p{L}/u.test(word) && word.includes', 'word.includes')],
  'reports returns search reads a numeric name': ['routes/reports.ts', sub('const unrestricted = phoneSearchAccessOf(user).fullPhone', 'const unrestricted = true')],
  // P2.8-F S1: a number saved in a column the response masks (a note, a cashier, a supplier) must read as empty to the search. (A branch is not a
  // person: since the review's B2 it is shown as stored, so it is searched as stored.)
  'sales note that is a number readable': ['routes/sales.ts', sub("'s.payment_method', 's.notes', 'c.membership_number',", `'s.payment_method', ${RAW('s.notes')}, 'c.membership_number',`)],
  'sales cashier that is a number readable': ['routes/sales.ts', sub("'s.legacy_receipt_number', 's.cashier_name', 's.customer_name',", `'s.legacy_receipt_number', ${RAW('s.cashier_name')}, 's.customer_name',`)],
  'sales cashier filter reads the number': ['routes/sales.ts', subAll("restrictedColumnSql('s.cashier_name')", "'s.cashier_name'")],
  'returns note that is a number readable': ['routes/returns.ts', sub("'r.reason', 'r.notes', 'r.return_type'", `'r.reason', ${RAW('r.notes')}, 'r.return_type'`)],
  'returns supplier saved under a number readable': ['routes/returns.ts', sub("'r.supplier_name', 'r.reason',", `${RAW('r.supplier_name')}, 'r.reason',`)],
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

  // A customer whose phone was saved glued to letters (a legacy import): the digits are still a phone.
  await world.run("INSERT INTO customers (id, name, phone, phone_normalized, membership_number) VALUES (9301, 'Fixture Legacy', 'Tel099456789', '099456789', 'LC-P28-9301')")

  // A courier saved under its own number (its name is a number, its area is the only readable word).
  await world.run("INSERT INTO delivery_contacts (id, name, phone, area) VALUES (9201, ?, '', 'South Zone')", '014 333 777')

  // P2.8-F: Sales and Returns words that mix letters and digits (the cashier "No1", the customer "sokha2"), and the same fold pointing at
  // hidden numbers: a phone saved glued to letters, a folded copy that still holds one, a number typed with a letter O.
  const insertSale = (receipt, cashier, name, phone, folded, hoursAgo) => world.run(
    `INSERT INTO sales (receipt_number, customer_id, customer_name, customer_phone, total_usd, total_khr, sale_status, payment_method, cashier_name, search_normalized, branch_id, branch_name, created_at)
     VALUES (?, NULL, ?, ?, 5, 20000, 'completed', 'Cash', ?, ?, ?, 'Main', datetime('now', ?))`,
    receipt, name, phone, cashier, folded, world.ids.branch, `-${hoursAgo} hour`,
  )
  await insertSale('P28-0004', 'No1', 'Walk-in', '', 'p28-0004 n01 walk in main', 4)
  await insertSale('P28-0005', 'Admin', 'Fixture Legacy', 'Tel099456789', 'p28-0005 admin fixture legacy tel099456789 main', 5)
  await insertSale('P28-0006', 'Admin', 'O1988375', '', 'p28-0006 admin 01988375 main', 6)
  const insertReturn = (number, name, saleReceipt, folded) => world.run(
    `INSERT INTO returns (return_number, customer_id, customer_name, sale_id, return_scope, status, total_refund_usd, total_refund_khr, receipt_number, search_normalized, created_at)
     VALUES (?, ?, ?, (SELECT id FROM sales WHERE receipt_number = ?), 'customer', 'completed', 1, 4000, ?, ?, datetime('now'))`,
    number, world.ids.customer2, name, saleReceipt, saleReceipt, folded,
  )
  await insertReturn('P28-RET-3', 'sokha2', 'P28-0004', 'p28-ret-3 s0kha2')
  await insertReturn('P28-RET-4', 'Fixture Sophea', 'P28-0004', 'p28-ret-4 fixture sophea tel010222333')

  // P2.8-F S1 (the review's probes 6 and 7): a number saved in a column the response masks. A sale's note, cashier and branch, a return's
  // note, a supplier return saved under a number. The response shows each as `093 *** 789`; a fragment typed into the search must find nothing.
  const insertMaskedSale = (receipt, { cashier = 'Admin', notes = null, branch = 'Main' }, hoursAgo) => world.run(
    `INSERT INTO sales (receipt_number, customer_id, customer_name, customer_phone, total_usd, total_khr, sale_status, payment_method, cashier_name, notes, search_normalized, branch_id, branch_name, created_at)
     VALUES (?, NULL, 'Walk-in', '', 5, 20000, 'completed', 'Cash', ?, ?, ?, ?, ?, datetime('now', ?))`,
    receipt, cashier, notes, `${receipt.toLowerCase()} ${[cashier, notes, branch].filter(Boolean).join(' ').toLowerCase()} walk in`, world.ids.branch, branch, `-${hoursAgo} hour`,
  )
  await insertMaskedSale('P28-0007', { notes: '093 456 789' }, 7)
  await insertMaskedSale('P28-0008', { cashier: '094 555 818' }, 8)
  await insertMaskedSale('P28-0009', { branch: '095 777 626' }, 9)
  await world.run(
    `INSERT INTO returns (return_number, customer_name, return_scope, status, total_refund_usd, total_refund_khr, receipt_number, notes, search_normalized, created_at)
     VALUES ('P28-RET-5', 'Walk-in', 'customer', 'completed', 1, 4100, 'P28-0004', '093 456 789', 'p28-ret-5 walk in', datetime('now'))`,
  )
  await world.run(
    `INSERT INTO returns (return_number, supplier_name, return_scope, status, total_refund_usd, total_refund_khr, search_normalized, created_at)
     VALUES ('P28-RET-6', '094 555 818', 'supplier', 'completed', 1, 4100, 'p28-ret-6', datetime('now'))`,
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
  await check('no grant: the cached Sales totals do not say how many sales a number fragment matches (holder warms first, then the other way)', async (t) => {
    const count = (response) => (response.json && response.json.total_count)
    const holderFirst = await get(`/api/sales/stats?search=${enc('654321')}`, 'admin')
    t.ok('positive control: the holder counts the sale by a fragment of its number', count(holderFirst) >= 1, holderFirst.text.slice(0, 200))
    const denied = await get(`/api/sales/stats?search=${enc('654321')}`, 'sales_only')
    t.eq('the account without the grant counts nothing for the same URL', count(denied), 0)
    const deniedFirst = await get(`/api/sales/stats?search=${enc('999000')}`, 'sales_only')
    t.eq('warmed by the account without the grant: nothing', count(deniedFirst), 0)
    const holderAfter = await get(`/api/sales/stats?search=${enc('999000')}`, 'admin')
    t.ok('and the holder still counts the sale (its own entry)', count(holderAfter) >= 1, holderAfter.text.slice(0, 200))
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
    const numeric = await get(`/api/sales/delivery-options?search=${enc('333')}`, 'manager_granted')
    t.ok('positive control: the holder finds the courier saved under a number by a fragment of it', numeric.status === 200 && has(numeric.text, 'South Zone'), numeric.text.slice(0, 200))
    for (const q of ['555', '096', '666 777', '095', '333', '014', '777', 'o14 333', `333${String.fromCharCode(0x301)}`, `555${String.fromCharCode(0x301)}`]) {
      const r = await get(`/api/sales/delivery-options?search=${enc(q)}`, 'manager')
      t.ok(`delivery-options ${q}: status ${r.status}`, r.status === 200)
      t.ok(`delivery-options ${q}: no courier`, !has(r.text, 'Fixture Courier') && !has(r.text, 'South Zone'), snippetOf(r.text) || r.text.slice(0, 160))
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

  // ---- P2.8-F S1: a number saved in a note, a cashier, a branch or a supplier is hidden from the search as it is from the screen ----------
  await check('positive control: the holder finds a sale, a return and a supplier return by a fragment of a number saved in a note, cashier or branch', async (t) => {
    t.ok('sales 456 (note)', receiptsIn((await get(`/api/sales?search=${enc('456')}`, 'admin')).text).includes('P28-0007'))
    t.ok('sales 555 (cashier)', receiptsIn((await get(`/api/sales?search=${enc('555')}`, 'admin')).text).includes('P28-0008'))
    t.ok('sales 777 (branch)', receiptsIn((await get(`/api/sales?search=${enc('777')}`, 'admin')).text).includes('P28-0009'))
    t.ok('sales ?cashier=555', receiptsIn((await get(`/api/sales?cashier=${enc('555')}`, 'admin')).text).includes('P28-0008'))
    t.ok('returns 456 (note)', has((await get(`/api/returns?search=${enc('456')}`, 'admin')).text, 'P28-RET-5'))
    t.ok('supplier returns 555', has((await get(`/api/returns?scope=supplier&search=${enc('555')}`, 'admin')).text, 'P28-RET-6'))
    t.ok('sales totals 456', Number((await get(`/api/sales/stats?search=${enc('456')}`, 'admin')).json?.total_count) >= 1)
  })
  await check('no grant: a sale whose note or cashier is a number is not found by a fragment of it (list, totals, cashier filter, digit by digit)', async (t) => {
    for (const [receipt, queries] of [['P28-0007', ['456', '45', '4567', '093 4', '789']], ['P28-0008', ['555', '094 555', '818']]]) {
      for (const q of queries) {
        const r = await get(`/api/sales?search=${enc(q)}`, 'sales_only')
        t.ok(`sales ${q}: status ${r.status}`, r.status === 200)
        t.ok(`sales ${q}: ${receipt} must not be found`, !receiptsIn(r.text).includes(receipt), snippetOf(r.text))
        t.eq(`sales ${q}: totals`, (await get(`/api/sales/stats?search=${enc(q)}`, 'sales_only')).json?.total_count, 0)
      }
    }
    // The reviewer's bisection: the digit after a known prefix, ten requests per digit.
    const hits = []
    for (let digit = 0; digit <= 9; digit += 1) {
      if (receiptsIn((await get(`/api/sales?search=${enc(`45${digit}`)}`, 'sales_only')).text).includes('P28-0007')) hits.push(digit)
    }
    t.eq('digit by digit: no digit after "45" is told apart', hits, [])
    for (const q of ['555', '094', '818']) {
      const list = await get(`/api/sales?cashier=${enc(q)}`, 'sales_only')
      t.ok(`?cashier=${q}: P28-0008 must not be found`, !receiptsIn(list.text).includes('P28-0008'), snippetOf(list.text))
      t.eq(`?cashier=${q}: totals`, (await get(`/api/sales/stats?cashier=${enc(q)}`, 'sales_only')).json?.total_count, 0)
    }
    t.ok('the note shows masked to this account', has((await get(`/api/sales?search=${enc('P28-0007')}`, 'sales_only')).text, '093 *** 789'))
  })
  await check('no grant: a branch named by a number is shown as stored (review B2), so the search finds it by a fragment, as the holder does', async (t) => {
    const r = await get(`/api/sales?search=${enc('777')}`, 'sales_only')
    t.ok('sales 777 finds the sale at the branch named 095 777 626', receiptsIn(r.text).includes('P28-0009'), snippetOf(r.text))
    t.ok('and the branch shows in full', has(r.text, '095 777 626'), r.text.slice(0, 200))
  })
  await check('no grant: a return whose note is a number, and a supplier return saved under a number, are not found by a fragment of it', async (t) => {
    for (const q of ['456', '45', '093 4', '789']) {
      const r = await get(`/api/returns?search=${enc(q)}`, 'sales_only')
      t.ok(`returns ${q}: P28-RET-5 must not be found`, r.status === 200 && !has(r.text, 'P28-RET-5'), snippetOf(r.text))
    }
    for (const q of ['555', '094 555', '818', '0945']) {
      const r = await get(`/api/returns?scope=supplier&search=${enc(q)}`, 'sales_only')
      t.ok(`supplier returns ${q}: P28-RET-6 must not be found`, r.status === 200 && !has(r.text, 'P28-RET-6'), snippetOf(r.text))
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

  // ---- review B1: a digit search whose RAW text is not all digits but which the matcher reads as digits ----------------------
  // An accent after a digit, a letter o in place of a zero, full-width digits and a zero-width joiner are all folded away by the
  // matcher; the guard must be decided on those same words.
  const DISGUISED = ['654́', 'o8765', 'O8765', '0876́', '０８７６', '654‍', '6̅4321', '999́', 'o85 999', '222́', '010́', '333́', '111́']
  await check('positive control: the holder finds the same rows by the disguised digits as by the plain ones', async (t) => {
    t.ok('customers 654 + accent', has((await get(`/api/customers?search=${enc('654́')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Dara'))
    t.eq('sales 654 + accent', receiptsIn((await get(`/api/sales?search=${enc('654́')}`, 'admin')).text), ['P28-0001'])
    t.eq('sales o8765', receiptsIn((await get(`/api/sales?search=${enc('o8765')}`, 'admin')).text), ['P28-0001'])
    t.eq('sales 999 + accent', receiptsIn((await get(`/api/sales?search=${enc('999́')}`, 'admin')).text), ['P28-0002'])
  })
  await check('no grant: a disguised digit fragment finds nothing through Contacts, the picker, Sales, Returns and the totals', async (t) => {
    for (const q of DISGUISED) {
      for (const [route, name] of [['customers', 'Fixture Dara'], ['suppliers', 'Fixture Supplies'], ['delivery-contacts', 'Fixture Courier']]) {
        const r = await get(`/api/${route}?search=${enc(q)}&page=1&pageSize=50`, 'manager')
        t.ok(`${route} ${JSON.stringify(q)}: ${name} must not be found`, r.status === 200 && !has(r.text, name), snippetOf(r.text))
        t.eq(`${route} ${JSON.stringify(q)} leaks`, leaksIn(r.text), [])
      }
      const picker = await get(`/api/customers?fields=sales_picker&search=${enc(q)}`, 'manager')
      t.ok(`picker ${JSON.stringify(q)}`, !has(picker.text, 'Fixture Dara') && !has(picker.text, 'Fixture Sophea'), snippetOf(picker.text))
      const sales = await get(`/api/sales?search=${enc(q)}`, 'sales_only')
      t.eq(`sales ${JSON.stringify(q)}`, receiptsIn(sales.text), [])
      t.eq(`sales ${JSON.stringify(q)} leaks`, leaksIn(sales.text), [])
      const stats = await get(`/api/sales/stats?search=${enc(q)}`, 'sales_only')
      t.eq(`sales totals ${JSON.stringify(q)}`, stats.json && stats.json.total_count, 0)
      const returns = await get(`/api/returns?search=${enc(q)}`, 'sales_only')
      t.ok(`returns ${JSON.stringify(q)}: P28-RET-2 must not be found`, !has(returns.text, 'P28-RET-2'), snippetOf(returns.text))
    }
  })

  // ---- review N7: a whole number written +855 / 00855, in Khmer digits or in full-width digits finds its customer for everyone
  await check('every account finds a customer by the whole number written 00855, with Khmer digits or in full-width digits', async (t) => {
    for (const q of ['00855 87 654 321', '0085587654321', '+៨៥៥ ៨៧ ៦៥៤ ៣២១', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１']) {
      for (const as of ['manager', 'manager_granted']) {
        const customers = await get(`/api/customers?search=${enc(q)}&page=1&pageSize=50`, as)
        t.ok(`customers ${JSON.stringify(q)} as ${as}`, has(customers.text, 'Fixture Dara'), customers.text.slice(0, 160))
        const picker = await get(`/api/customers?fields=sales_picker&search=${enc(q)}`, as)
        t.ok(`picker ${JSON.stringify(q)} as ${as}`, has(picker.text, 'Fixture Dara'), picker.text.slice(0, 160))
        if (as === 'manager') t.eq(`${JSON.stringify(q)} reply is masked`, leaksIn(customers.text + picker.text), [])
      }
      for (const as of ['sales_only', 'admin']) {
        t.ok(`sales ${JSON.stringify(q)} as ${as}`, receiptsIn((await get(`/api/sales?search=${enc(q)}`, as)).text).includes('P28-0001'))
        t.ok(`reports sales ${JSON.stringify(q)} as ${as}`, receiptsIn((await get(`/api/reports/business-summary/sales?startDate=2000-01-01&endDate=2100-01-01&q=${enc(q)}`, as)).text).includes('P28-0001'))
      }
    }
  })

  // ---- re-review R1: a digit fragment glued to a mark the FTS tokenizer drops, or to letters ----------------------------------------------
  const MARKS = [0xfe0f, 0xfe00, 0x1dc0, 0x20d0, 0xfe20, 0xe31, 0x17c9, 0x20e3, 0x483, 0x5b0, 0x610, 0x93c, 0x301, 0x34f, 0x1ab0].map((cp) => String.fromCodePoint(cp))
  await check('positive control: the holder finds the same rows by the plain fragment, and the legacy phone glued to letters', async (t) => {
    t.ok('customers 654', has((await get(`/api/customers?search=${enc('654')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Dara'))
    t.ok('suppliers 333', has((await get(`/api/suppliers?search=${enc('333')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Supplies'))
    t.ok('delivery 555', has((await get(`/api/delivery-contacts?search=${enc('555')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Courier'))
    t.ok('customers tel0994 (a phone saved as Tel099456789)', has((await get(`/api/customers?search=${enc('tel0994')}&page=1&pageSize=50`, 'manager_granted')).text, 'Fixture Legacy'))
    t.ok('picker tel0994', has((await get(`/api/customers?fields=sales_picker&search=${enc('tel0994')}`, 'manager_granted')).text, 'Fixture Legacy'))
  })
  await check('no grant: a digit fragment glued to a combining mark, a variation selector or an enclosing mark finds nothing on Customers, the picker, Suppliers and Delivery contacts', async (t) => {
    for (const mark of MARKS) {
      const label = 'U+' + mark.codePointAt(0).toString(16)
      for (const frag of ['654', '0876', '6' + mark + '54']) {
        const q = frag.includes(mark) ? frag : frag + mark
        const list = await get(`/api/customers?search=${enc(q)}&page=1&pageSize=50`, 'manager')
        t.ok(`customers ${label} ${frag}`, list.status === 200 && !has(list.text, 'Fixture Dara'), snippetOf(list.text))
        const picker = await get(`/api/customers?fields=sales_picker&search=${enc(q)}`, 'manager')
        t.ok(`picker ${label} ${frag}`, !has(picker.text, 'Fixture Dara'), snippetOf(picker.text))
      }
      const supplier = await get(`/api/suppliers?search=${enc('333' + mark)}&page=1&pageSize=50`, 'manager')
      t.ok(`suppliers ${label}`, supplier.status === 200 && !has(supplier.text, 'Fixture Supplies'), snippetOf(supplier.text))
      const delivery = await get(`/api/delivery-contacts?search=${enc('555' + mark)}&page=1&pageSize=50`, 'manager')
      t.ok(`delivery contacts ${label}`, delivery.status === 200 && !has(delivery.text, 'Fixture Courier'), snippetOf(delivery.text))
      t.eq(`delivery picker ${label}`, has((await get(`/api/sales/delivery-options?search=${enc('555' + mark)}`, 'manager')).text, 'Fixture Courier'), false)
    }
  })
  await check('no grant: a mark glued to a digit fragment finds nothing in Sales, Returns and the totals either', async (t) => {
    for (const mark of MARKS) {
      const label = 'U+' + mark.codePointAt(0).toString(16)
      t.eq(`sales ${label}`, receiptsIn((await get(`/api/sales?search=${enc('654' + mark)}`, 'sales_only')).text), [])
      t.eq(`sales totals ${label}`, (await get(`/api/sales/stats?search=${enc('654' + mark)}`, 'sales_only')).json?.total_count, 0)
      t.ok(`returns ${label}`, !has((await get(`/api/returns?search=${enc('222' + mark)}`, 'sales_only')).text, 'P28-RET-2'))
    }
  })
  await check('no grant: a legacy phone saved glued to letters is not found by a fragment of its digits', async (t) => {
    for (const q of ['tel0994', 'tel09945', 'tel099456789', 'TEL0994', 'dara tel0994']) {
      const list = await get(`/api/customers?search=${enc(q)}&page=1&pageSize=50`, 'manager')
      t.ok(`customers ${q}`, list.status === 200 && !has(list.text, 'Fixture Legacy'), list.text.slice(0, 160))
      const picker = await get(`/api/customers?fields=sales_picker&search=${enc(q)}`, 'manager')
      t.ok(`picker ${q}`, !has(picker.text, 'Fixture Legacy'), picker.text.slice(0, 160))
    }
  })

  // ---- review B2: Reports > Sales and Reports > Returns search ---------------------------------------------------------------
  const REPORT_WINDOW = 'startDate=2000-01-01&endDate=2100-01-01'
  const report = (kind, q, as, extra = '') => get(`/api/reports/business-summary/${kind}?${REPORT_WINDOW}&q=${enc(q)}${extra}`, as)
  await check('positive control: the holder finds sales and returns in the reports by a fragment of the number', async (t) => {
    t.eq('reports sales 654', receiptsIn((await report('sales', '654', 'admin')).text), ['P28-0001'])
    t.eq('reports sales 999', receiptsIn((await report('sales', '999', 'admin')).text), ['P28-0002'])
    t.ok('reports returns 222 (a customer saved under a number)', has((await report('returns', '222', 'admin')).text, 'P28-RET-2'))
    t.ok('reports sales export 654', receiptsIn((await report('sales', '654', 'admin', '&intent=export')).text).includes('P28-0001'))
  })
  await check('no grant: Reports > Sales and Reports > Returns search never match a number by a fragment of it', async (t) => {
    for (const q of ['654', '65', '8765', '0876', '321', '999', '085', '222', '010', '9 000', ...DISGUISED]) {
      const list = await report('sales', q, 'sales_only')
      t.ok(`reports sales ${JSON.stringify(q)}: status ${list.status}`, list.status === 200, list.text.slice(0, 160))
      t.eq(`reports sales ${JSON.stringify(q)}`, receiptsIn(list.text), [])
      t.eq(`reports sales ${JSON.stringify(q)} leaks`, leaksIn(list.text), [])
      const exported = await report('sales', q, 'sales_only', '&intent=export')
      t.eq(`reports sales export ${JSON.stringify(q)}`, receiptsIn(exported.text), [])
      t.eq(`reports sales export ${JSON.stringify(q)} leaks`, leaksIn(exported.text), [])
      const returns = await report('returns', q, 'sales_only')
      t.ok(`reports returns ${JSON.stringify(q)}: P28-RET-2 must not be found`, !has(returns.text, 'P28-RET-2'), snippetOf(returns.text))
    }
  })
  await check('no grant: Reports > Sales finds a sale by the whole number, masked, and by receipt, name and cashier as before', async (t) => {
    const whole = await report('sales', '087 654 321', 'sales_only')
    t.eq('whole number', receiptsIn(whole.text), ['P28-0001'])
    t.eq('whole number: no leak', leaksIn(whole.text), [])
    t.eq('whole number in another form', receiptsIn((await report('sales', '+855 87 654 321', 'sales_only')).text), ['P28-0001'])
    t.eq('one digit off', receiptsIn((await report('sales', '087 654 322', 'sales_only')).text), [])
    t.eq('receipt', receiptsIn((await report('sales', 'p28-0002', 'sales_only')).text), ['P28-0002'])
    t.ok('customer name', receiptsIn((await report('sales', 'dara', 'sales_only')).text).includes('P28-0001'))
    t.eq('holder: same receipt result', receiptsIn((await report('sales', 'p28-0002', 'admin')).text), ['P28-0002'])
  })

  // ---- P2.8-F: a word that mixes letters and digits finds its row without the grant; the same fold never reaches a number ----------------
  await check('P2.8-F positive control: the holder finds the same rows by the mixed words', async (t) => {
    t.eq('sales No1', receiptsIn((await get(`/api/sales?search=${enc('No1')}`, 'admin')).text), ['P28-0004'])
    t.ok('returns sokha2', has((await get(`/api/returns?search=${enc('sokha2')}`, 'admin')).text, 'P28-RET-3'))
    t.eq('sales tel0994 (a phone saved glued to letters)', receiptsIn((await get(`/api/sales?search=${enc('tel0994')}`, 'admin')).text), ['P28-0005'])
    t.ok('returns tel0102 (the folded copy holds the number)', has((await get(`/api/returns?search=${enc('tel0102')}`, 'admin')).text, 'P28-RET-4'))
  })
  await check('no grant: Sales finds a cashier named No1, Returns a customer named sokha2, and the totals and the reports agree', async (t) => {
    for (const q of ['No1', 'no1', 'NO1']) {
      t.eq(`sales ${q}`, receiptsIn((await get(`/api/sales?search=${enc(q)}`, 'sales_only')).text), ['P28-0004'])
      t.eq(`sales totals ${q}`, (await get(`/api/sales/stats?search=${enc(q)}`, 'sales_only')).json?.total_count, 1)
    }
    t.eq('the same rows as the holder', receiptsIn((await get(`/api/sales?search=${enc('No1')}`, 'sales_only')).text), receiptsIn((await get(`/api/sales?search=${enc('No1')}`, 'admin')).text))
    for (const q of ['sokha2', 'Sokha2']) t.ok(`returns ${q}`, has((await get(`/api/returns?search=${enc(q)}`, 'sales_only')).text, 'P28-RET-3'))
    t.eq('reports > sales No1 (a raw match, as before)', receiptsIn((await get(`/api/reports/business-summary/sales?startDate=2000-01-01&endDate=2100-01-01&q=${enc('No1')}`, 'sales_only')).text), ['P28-0004'])
  })
  await check('no grant: the retry never reaches a phone, the folded copy, or a digit fragment', async (t) => {
    for (const q of ['tel0994', 'tel09945', 'TEL0994', 'tel099456789']) {
      const r = await get(`/api/sales?search=${enc(q)}`, 'sales_only')
      t.eq(`sales ${q}`, receiptsIn(r.text), [])
      t.eq(`sales ${q} leaks`, leaksIn(r.text), [])
      t.eq(`sales totals ${q}`, (await get(`/api/sales/stats?search=${enc(q)}`, 'sales_only')).json?.total_count, 0)
    }
    for (const q of ['tel0102', 'tel010222333', 'TEL0102']) {
      const r = await get(`/api/returns?search=${enc(q)}`, 'sales_only')
      t.ok(`returns ${q}: P28-RET-4 must not be found`, !has(r.text, 'P28-RET-4'), snippetOf(r.text))
    }
    for (const q of ['01988', 'o1988', 'O1988']) t.eq(`sales ${q}: a number typed with a letter O stays unreadable by its digits`, receiptsIn((await get(`/api/sales?search=${enc(q)}`, 'sales_only')).text), [])
    t.eq('positive control: the holder reads it', receiptsIn((await get(`/api/sales?search=${enc('01988')}`, 'admin')).text), ['P28-0006'])
  })

  // The security review's 42 spellings of a fragment (harness/phone_disguises.cjs) on the search surfaces, without the grant.
  await check('no grant: the reviewer\'s 42 spellings of a digit fragment find nothing on every surface (the holder finds the plain fragment)', async (t) => {
    const range = 'startDate=2026-01-01&endDate=2027-12-31'
    const SURFACES = [
      { name: 'customers list', frag: '654', as: 'manager', holder: 'manager_granted', url: (q) => `/api/customers?search=${enc(q)}&page=1&pageSize=50`, hit: (r) => has(r.text, 'Fixture Dara') },
      { name: 'POS picker', frag: '654', as: 'manager', holder: 'manager_granted', url: (q) => `/api/customers?fields=sales_picker&search=${enc(q)}`, hit: (r) => has(r.text, 'Fixture Dara') },
      { name: 'suppliers list', frag: '333', as: 'manager', holder: 'manager_granted', url: (q) => `/api/suppliers?search=${enc(q)}&page=1&pageSize=50`, hit: (r) => has(r.text, 'Fixture Supplies') },
      { name: 'delivery contacts list', frag: '555', as: 'manager', holder: 'manager_granted', url: (q) => `/api/delivery-contacts?search=${enc(q)}&page=1&pageSize=50`, hit: (r) => has(r.text, 'Fixture Courier') },
      { name: 'delivery picker', frag: '555', as: 'manager', holder: 'manager_granted', url: (q) => `/api/sales/delivery-options?search=${enc(q)}`, hit: (r) => has(r.text, 'Fixture Courier') },
      { name: 'sales list', frag: '654', as: 'sales_only', holder: 'admin', url: (q) => `/api/sales?search=${enc(q)}`, hit: (r) => receiptsIn(r.text).includes('P28-0001') },
      { name: 'sales totals', frag: '654', as: 'sales_only', holder: 'admin', url: (q) => `/api/sales/stats?search=${enc(q)}`, hit: (r) => Number(r.json && r.json.total_count) > 0 },
      { name: 'returns list', frag: '222', as: 'sales_only', holder: 'admin', url: (q) => `/api/returns?search=${enc(q)}`, hit: (r) => has(r.text, 'P28-RET-2') },
      { name: 'reports sales', frag: '654', as: 'cashier', holder: 'cashier_granted', url: (q) => `/api/reports/business-summary/sales?${range}&q=${enc(q)}`, hit: (r) => receiptsIn(r.text).includes('P28-0001') },
      { name: 'reports sales export', frag: '654', as: 'sales_only', holder: 'admin', url: (q) => `/api/reports/business-summary/sales?${range}&q=${enc(q)}&intent=export`, hit: (r) => receiptsIn(r.text).includes('P28-0001') },
      { name: 'reports returns', frag: '222', as: 'sales_only', holder: 'admin', url: (q) => `/api/reports/business-summary/returns?${range}&q=${enc(q)}`, hit: (r) => has(r.text, 'P28-RET-2') },
      { name: 'audit log', frag: '222', as: 'sales_only', holder: 'admin', url: (q) => `/api/system/audit-logs?search=${enc(q)}&pageSize=50`, hit: (r) => ((r.json && r.json.items) || []).length > 0 },
    ]
    for (const surface of SURFACES) {
      t.ok(`${surface.name}: positive control, the holder (${surface.holder}) finds the plain fragment ${surface.frag}`, surface.hit(await get(surface.url(surface.frag), surface.holder)))
      let tried = 0
      for (const [label, q] of disguises(surface.frag)) {
        tried += 1
        const r = await get(surface.url(q), surface.as)
        t.ok(`${surface.name} ${label}: status ${r.status}`, r.status === 200, r.text.slice(0, 120))
        t.ok(`${surface.name} ${label}: must find nothing`, !surface.hit(r), snippetOf(r.text) || r.text.slice(0, 120))
        t.eq(`${surface.name} ${label} leaks`, leaksIn(r.text), [])
      }
      t.ok(`${surface.name}: tried the reviewer's 42 spellings`, tried >= 42, String(tried))
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
