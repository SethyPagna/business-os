'use strict'
// P2.8 (6.0.1046): a real Worker (every middleware, route and lib, bundled) whose database holds synthetic people with
// phone numbers in every place the app keeps one, and accounts that differ ONLY in the full-phone grant. Used by the
// leak crawl and the write-path tests. Every name and number here is invented: 087 / 098 / 077 / 096 / 085 / 010 are
// fixture prefixes and the repo is public.
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { bootWorld } = require('./real_worker_world.cjs')

// Each fixture number is used in exactly one role, so a leak names its source.
const PHONES = {
  customer: '087 654 321',
  customerOption: '098 111 222',
  customerOptionPlus855: '+855 97 222 333',
  supplier: '077 333 444',
  supplierOption: '078 444 555',
  delivery: '096 555 666',
  deliveryOption: '095 666 777',
  saleTyped: '085 999 000',
  phoneAsName: '010 222 333',
  driver: '092 101 202',
  user: '081 700 800',
  portal: '086 313 414',
  duplicate: '011 888 999',
  supplierDuplicate: '012 777 111',
  deliveryDuplicate: '013 666 222',
  // 6.0.1162 (the security review's B1-B3): a number as the WHOLE value of every person-name and free-text field the API returns
  // (the 097 2xx 8xx set), so the crawl names the key a full number leaves under and a write test has a real value to lose.
  contactPerson: '097 252 812',
  staffName: '097 244 804',
  cashierName: '097 245 805',
  customerNote: '097 262 822',
  supplierNote: '097 267 827',
  feeLabel: '097 271 831',
  feeNote: '097 272 832',
  saleNote: '097 254 814',
  moveActor: '097 251 811',
  shiftUser: '097 253 813',
  legacyCashier: '097 248 808',
  // Quoted inside a sentence (a reason): the response masks the quoted number, not the sentence.
  returnReason: '097 243 803',
  legacyReason: '097 247 807',
  moveReason: '097 249 809',
}

// A product NAMED by a long digit code (a supplier's item code): not a person, so it is shown to everybody as it is stored.
const PRODUCT_CODE = '88512345678901'
const PRODUCT_CODE_MASK = '885 *** 901'

const PROBES = [
  "app.get('/api/__routes', (c) => c.json(app.routes.map((route) => ({ method: route.method, path: route.path }))))",
].join('\n')
const PROBE_ANCHOR = "app.route('/api/internal/branch-cutover'"
const addProbeRoutes = (source) => {
  if (!source.includes(PROBE_ANCHOR)) throw new Error('src/index.ts no longer mounts the branch-cutover route where this test injects its probe')
  return source.replace(PROBE_ANCHOR, () => `${PROBES}\n${PROBE_ANCHOR}`)
}

const optionJson = (options) => JSON.stringify(options)

// A phone as it can appear on the wire: plain, compact, dashed, +855, Khmer digits. Returns regexes that must NOT match a
// body, with a digit guard on both sides so an id or a total next to the number cannot make a false hit.
const KHMER = '០១២៣៤៥៦៧៨៩'
function variantsOf(phone) {
  const digits = phone.replace(/\D/g, '')
  const national = digits.startsWith('855') ? `0${digits.slice(3)}` : digits
  const bare = national.replace(/^0/, '')
  const forms = new Set([national, `855${bare}`, `00855${bare}`, bare.length >= 8 ? bare : national])
  const sep = '[\\s().\\-]*'
  const regexes = []
  for (const form of forms) {
    const khmer = [...form].map((d) => KHMER[Number(d)]).join('')
    for (const text of [form, khmer]) regexes.push(new RegExp(`(?<![\\d${KHMER}])\\+?${[...text].join(sep)}(?![\\d${KHMER}])`))
  }
  return regexes
}
const ALL_VARIANTS = Object.entries(PHONES).filter(([key]) => key !== 'portal').map(([key, phone]) => ({ key, phone, regexes: variantsOf(phone) }))

/** Names of every fixture number readable in `text`, JSON escapes and nested JSON text included. */
function leaksIn(text) {
  const flat = String(text).replace(/\\\\/g, '\\').replace(/\\"/g, '"').replace(/\\u0022/gi, '"')
  const found = []
  for (const { key, regexes } of ALL_VARIANTS) if (regexes.some((re) => re.test(flat) || re.test(text))) found.push(key)
  return found
}

async function bootPhoneWorld({ extraTransform, transformSources } = {}) {
  const world = await bootWorld({
    adminPassword: randomBytes(12).toString('base64url'),
    transformEntry: (source) => (extraTransform ? extraTransform(addProbeRoutes(source)) : addProbeRoutes(source)),
    transformSources,
  })
  const ids = {}

  async function must(label, response, ok = [200, 201]) {
    if (!ok.includes(response.status)) throw new Error(`seed ${label}: ${response.status} ${response.text.slice(0, 300)}`)
    return response
  }

  // ---- accounts: identical except for the grant -------------------------------------------------------------------
  const employeeRole = await world.first("SELECT permissions FROM roles WHERE code = 'employee'")
  const managerRole = await world.first("SELECT permissions FROM roles WHERE code = 'manager'")
  const employeePermissions = JSON.parse(employeeRole.permissions)
  const managerPermissions = JSON.parse(managerRole.permissions)
  world.employeePermissions = employeePermissions
  await world.account('cashier', { roleCode: 'employee' })
  await world.account('cashier_granted', { roleCode: 'ph_employee_granted', permissions: { ...employeePermissions, contacts_full_phone: true } })
  await world.account('manager', { roleCode: 'manager' })
  await world.account('manager_granted', { roleCode: 'ph_manager_granted', permissions: { ...managerPermissions, contacts_full_phone: true } })
  await world.account('pos_only', { roleCode: 'ph_pos_only', permissions: { pos: true } })
  await world.account('sales_only', { roleCode: 'ph_sales_only', permissions: { sales: true, returns: true, dashboard: true, audit_log: true, review: true, settings: true } })
  // The grant given to ONE PERSON on top of a role that has none, and the grant taken away from one person.
  await world.account('person_granted', { roleCode: 'employee' })
  await world.run('UPDATE users SET permissions = ? WHERE username = ?', JSON.stringify({ contacts_full_phone: true }), 'person_granted')
  await world.account('person_revoked', { roleCode: 'ph_manager_granted' })
  await world.run('UPDATE users SET permissions = ? WHERE username = ?', JSON.stringify({ contacts_full_phone: false }), 'person_revoked')
  world.accounts = {
    denied: ['cashier', 'manager', 'pos_only', 'sales_only', 'person_revoked'],
    allowed: ['admin', 'cashier_granted', 'manager_granted', 'person_granted'],
  }

  // ---- people, written the way the app writes them (so audit rows, undo payloads and records exist too) ----------------
  const customer = await must('customer', await world.api('POST', '/api/customers', {
    name: 'Fixture Dara', phone: PHONES.customer, email: 'dara@example.test', membership_number: 'LC-P28-1',
    address: optionJson([
      { label: 'Home', name: 'Dara', phone: PHONES.customer, email: null, address: 'Street 271', area: null },
      { label: 'Work', name: 'Dara W', phone: PHONES.customerOption, email: null, address: 'Street 9', area: null },
      { label: 'Shop', name: 'Dara S', phone: PHONES.customerOptionPlus855, email: null, address: 'Street 11', area: null },
    ]),
  }))
  ids.customer = customer.json.id
  const second = await must('customer 2', await world.api('POST', '/api/customers', { name: 'Fixture Sophea', phone: '089 100 200', membership_number: 'LC-P28-2' }))
  ids.customer2 = second.json.id
  const asName = await must('customer by number', await world.api('POST', '/api/customers', { name: PHONES.phoneAsName, phone: PHONES.phoneAsName, membership_number: 'LC-P28-3' }))
  ids.customerPhoneName = asName.json.id
  const supplier = await must('supplier', await world.api('POST', '/api/suppliers', {
    name: 'Fixture Supplies', phone: PHONES.supplier, company: 'Fixture Co', contact_person: 'Vanna',
    address: optionJson([{ label: 'Office', name: 'Vanna', phone: PHONES.supplierOption, email: null, address: 'Street 3', area: null }]),
  }))
  ids.supplier = supplier.json.id
  const delivery = await must('delivery contact', await world.api('POST', '/api/delivery-contacts', {
    name: 'Fixture Courier', phone: PHONES.delivery,
    address: optionJson([{ label: 'Depot', name: 'Courier', phone: PHONES.deliveryOption, email: null, address: null, area: 'North' }]),
    area: 'North',
  }))
  ids.delivery = delivery.json.id
  // An edit and a second edit, so the audit log, the undo payloads and the record views hold before/after phones.
  await must('edit customer', await world.api('PUT', `/api/customers/${ids.customer}`, {
    name: 'Fixture Dara', phone: PHONES.customer, email: 'dara@example.test', notes: 'edited once',
    address: optionJson([
      { label: 'Home', name: 'Dara', phone: PHONES.customer, email: null, address: 'Street 271', area: null },
      { label: 'Work', name: 'Dara W', phone: PHONES.customerOption, email: null, address: 'Street 9', area: null },
      { label: 'Shop', name: 'Dara S', phone: PHONES.customerOptionPlus855, email: null, address: 'Street 11', area: null },
    ]),
  }))

  // ---- a branch, a product and sales (SQL: a sale write needs a stock world this test does not build) ------------------
  const branch = await world.first('SELECT id FROM branches ORDER BY is_default DESC, id LIMIT 1')
  ids.branch = branch.id
  await world.run('UPDATE branches SET phone = ? WHERE id = ?', '023 456 789', ids.branch)
  await world.run("UPDATE users SET phone = ?, phone_lookup = ? WHERE username = 'cashier'", PHONES.user, PHONES.user.replace(/\D/g, ''))
  const snapshot = JSON.stringify({ customer_phone: PHONES.customer, customer: { phone: PHONES.customer, address: 'Street 271' }, driver_phone: PHONES.driver, nested: { delivery_contact_phone: PHONES.delivery } })
  for (const [index, row] of [
    { receipt: 'P28-0001', customer: ids.customer, name: 'Fixture Dara', phone: PHONES.customer, delivery: 1 },
    { receipt: 'P28-0002', customer: null, name: 'Walk-in', phone: PHONES.saleTyped, delivery: 0 },
    { receipt: 'P28-0003', customer: ids.customerPhoneName, name: PHONES.phoneAsName, phone: PHONES.phoneAsName, delivery: 0 },
  ].entries()) {
    await world.run(
      `INSERT INTO sales (receipt_number, customer_id, customer_name, customer_phone, customer_address, total_usd, total_khr, sale_status, payment_method,
         is_delivery, delivery_contact_id, delivery_contact_name, delivery_contact_phone, delivery_contact_address, creation_snapshot_json, search_normalized, branch_id, branch_name, created_at)
       VALUES (?, ?, ?, ?, ?, 12.5, 51250, 'completed', 'Cash', ?, ?, ?, ?, ?, ?, ?, ?, 'Main', datetime('now', ?))`,
      row.receipt, row.customer, row.name, row.phone, optionJson([{ label: 'Home', name: 'x', phone: row.phone, address: 'Street 271' }]), row.delivery,
      row.delivery ? ids.delivery : null, row.delivery ? 'Fixture Courier' : null, row.delivery ? PHONES.driver : null, row.delivery ? 'North' : null,
      snapshot, `${row.receipt} ${row.name} ${row.phone.replace(/\D/g, '')}`, ids.branch, `-${index} hour`,
    )
  }
  ids.sale = (await world.first("SELECT id FROM sales WHERE receipt_number = 'P28-0001'")).id
  ids.sale2 = (await world.first("SELECT id FROM sales WHERE receipt_number = 'P28-0002'")).id
  await world.run(
    `INSERT INTO returns (return_number, customer_id, customer_name, sale_id, return_scope, status, total_refund_usd, total_refund_khr, receipt_number, search_normalized, created_at)
     VALUES ('P28-RET-1', ?, 'Fixture Dara', ?, 'customer', 'completed', 3, 12000, 'P28-0001', 'p28-ret-1 fixture dara', datetime('now'))`,
    ids.customer, ids.sale,
  )
  ids.return = (await world.first("SELECT id FROM returns WHERE return_number = 'P28-RET-1'")).id

  // ---- possible duplicates: two contacts of each kind that share one number (the Duplicates tab names the number) -----------
  const twin = (table, id, name, phone) => world.run(
    table === 'customers'
      ? 'INSERT INTO customers (id, name, phone, phone_normalized, membership_number) VALUES (?, ?, ?, ?, ?)'
      : table === 'suppliers'
        ? 'INSERT INTO suppliers (id, name, phone) VALUES (?, ?, ?)'
        : 'INSERT INTO delivery_contacts (id, name, phone) VALUES (?, ?, ?)',
    ...(table === 'customers' ? [id, name, phone, phone.replace(/\D/g, ''), `LC-P28-${id}`] : [id, name, phone]),
  )
  await twin('customers', 9101, 'Fixture Twin A', PHONES.duplicate)
  await twin('customers', 9102, 'Fixture Twin B', PHONES.duplicate)
  await twin('suppliers', 9101, 'Fixture Twin Supplier A', PHONES.supplierDuplicate)
  await twin('suppliers', 9102, 'Fixture Twin Supplier B', PHONES.supplierDuplicate)
  await twin('delivery_contacts', 9101, 'Fixture Twin Courier A', PHONES.deliveryDuplicate)
  await twin('delivery_contacts', 9102, 'Fixture Twin Courier B', PHONES.deliveryDuplicate)

  // ---- a number as the whole value of every person-name and free-text field (review B1-B3) -------------------------------
  await world.run("INSERT INTO customers (id, name, membership_number, notes) VALUES (9103, 'Fixture Noted', 'LC-P28-9103', ?)", PHONES.customerNote)
  await world.run('INSERT INTO suppliers (id, name, contact_person, notes) VALUES (9103, ?, ?, ?)', 'Fixture Noted Supplies', PHONES.contactPerson, PHONES.supplierNote)
  ids.notedCustomer = 9103
  ids.notedSupplier = 9103
  // A staff account whose display name is a number: its audit rows, its sales and its shift carry that name.
  await world.account('numbered', { roleCode: 'manager' })
  await world.run('UPDATE users SET name = ? WHERE username = ?', PHONES.staffName, 'numbered')
  await world.run(`INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, created_at) VALUES (NULL, ?, 'p28_probe', 'product', '91', '{}', datetime('now'))`, PHONES.staffName)
  await world.run(
    `INSERT INTO sales (receipt_number, customer_name, cashier_name, notes, total_usd, total_khr, sale_status, payment_method, search_normalized, branch_id, branch_name, created_at)
     VALUES ('P28-0030', 'Walk-in', ?, ?, 5, 20500, 'completed', 'Cash', 'p28-0030 walk in', ?, 'Main', datetime('now', '-3 hour'))`,
    PHONES.cashierName, PHONES.saleNote, ids.branch,
  )
  await world.run(
    `INSERT INTO returns (return_number, customer_name, return_scope, status, total_refund_usd, total_refund_khr, receipt_number, reason, search_normalized, created_at)
     VALUES ('P28-RET-7', 'Walk-in', 'customer', 'completed', 1, 4100, 'P28-0030', ?, 'p28-ret-7 walk in', datetime('now'))`,
    `Customer "${PHONES.returnReason}" asked for it back`,
  )
  await world.run(`INSERT INTO fees (fee_type, label, notes, amount_usd, amount_khr, fee_date, branch_id) VALUES ('other', ?, ?, 1, 0, date('now'), ?)`, PHONES.feeLabel, PHONES.feeNote, ids.branch)
  ids.numberedFee = (await world.first('SELECT id FROM fees WHERE label = ?', PHONES.feeLabel)).id
  await world.run(
    `INSERT INTO inventory_movements (product_id, product_name, branch_id, branch_name, movement_type, quantity, reason, user_id, user_name, created_at)
     VALUES (NULL, 'Fixture Toner', ?, 'Main', 'adjustment', 1, ?, NULL, ?, datetime('now'))`,
    ids.branch, `Count of "${PHONES.moveReason}"`, PHONES.moveActor,
  )
  await world.run(
    `INSERT INTO legacy_deleted_sale_items (event_key, invoice_no, cashier_name, deletion_reason, deleted_at, source_product_name, product_name, source_file, source_row)
     VALUES ('p28-ev', 'P28-INV-1', ?, ?, datetime('now'), 'Fixture Cream', 'Fixture Cream', 'p28.xls', 1)`,
    PHONES.legacyCashier, `Customer "${PHONES.legacyReason}" refused`,
  )
  await world.run(
    `INSERT INTO shift_sessions (shift_code, user_id, user_name, branch_id, branch_name, business_date, opened_at) VALUES ('P28-S1', ?, ?, ?, 'Main', date('now'), datetime('now'))`,
    world.adminId, PHONES.shiftUser, ids.branch,
  )
  const code = await world.api('POST', '/api/products', { name: PRODUCT_CODE, barcode: PRODUCT_CODE, selling_price_usd: 2, price_usd: 2, cost_price_usd: 1, category: 'P28 Codes' }, { as: 'admin' })
  await must('product named by a digit code', code, [200, 201])
  ids.digitProduct = code.json && (code.json.id || (code.json.product && code.json.product.id))

  world.ids = ids
  world.PHONES = PHONES
  world.placeSale = (options) => placeSale(world, options)
  return world
}

let stockKernelPromise
function stockKernel() {
  return stockKernelPromise ||= require('esbuild').build({
    stdin: { contents: "export { executeRawStockTransaction } from './src/lib/stockTransaction'", resolveDir: path.resolve(__dirname, '..', '..'), loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022',
  }).then((bundle) => {
    const mod = { exports: {} }
    new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports)
    return mod.exports
  })
}

let saleSeq = 0
/**
 * A real POS sale (POST /api/sales) for an existing customer, with the customer_phone the till sends. A form filled from a masked
 * read sends the mask back; the Worker resolves it to the stored number and the reply is the sale it saved. Returns the response.
 */
async function placeSale(world, { as = 'manager', customerId, customerName, customerPhone, productName, lineName }) {
  const { executeRawStockTransaction } = await stockKernel()
  const sell = world.ids.branch
  await world.run("UPDATE branches SET role = 'shop', canonical_key = 'shop' WHERE id = ?", sell)
  saleSeq += 1
  const id = 9300 + saleSeq
  const lot = id * 10 + 1
  const price = 10
  await executeRawStockTransaction(world.db, [
    world.db.prepare('INSERT INTO products(id,name,barcode,sku,cost_price_usd,cost_price_khr,selling_price_usd,selling_price_khr,stock_quantity,is_active) VALUES(?,?,?,?,4,0,?,?,?,1)')
      .bind(id, productName || `Fixture Soap ${id}`, `88710${String(id).padStart(8, '0')}`, `P28-SKU-${id}`, price, price * 4000, 20),
    world.db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,?,?)').bind(id, sell, 20),
    world.db.prepare("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,batch_number,unit_cost_usd,is_active) VALUES(?,?,?,?,'2026-09-02',1,4,1)").bind(lot, id, `P28${id}`, `P28${id}`),
    world.db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').bind(lot, sell, 20),
  ])
  const actor = await world.first('SELECT id, organization_id FROM users WHERE username = ?', as)
  const key = `p28-sale-${id}`
  const body = {
    branch_id: sell, money_precision_version: 1, sale_status: 'completed', exchange_rate: 4000, payment_currency: 'USD', client_request_id: key,
    offline_owner: { version: 1, actor_id: actor.id, organization_id: actor.organization_id ?? null, authority: 'http://localhost', runtime: 'cloudflare-workers' },
    payment_details: [{ method: 'Cash', amount_usd: price, amount_khr: 0 }], payment_method: 'Cash', amount_paid_usd: price, amount_paid_khr: 0,
    customer_id: customerId, customer_name: customerName, customer_phone: customerPhone,
    items: [{ product_id: id, ...(lineName ? { name: lineName, product_name: lineName } : {}), quantity: 1, branch_id: sell, batch_id: lot, client_line_key: `${key}-line-1`, pricing_source: 'selling',
      pricing_quote: { gross_usd: 0, product_discount_usd: 0, manual_discount_usd: 0, total_usd: 0, total_khr: 0 } }],
  }
  // The first answer to a zero quote is the server's own quote (the till's review step); the real request carries it.
  const first = await world.api('POST', '/api/sales', body, { as })
  if (first.status !== 409 || !first.json || !Array.isArray(first.json.pricing_quotes)) return first
  const quote = first.json.pricing_quotes.find((q) => q.client_line_key === `${key}-line-1`)
  body.items[0].pricing_quote = Object.fromEntries(['gross_usd', 'product_discount_usd', 'manual_discount_usd', 'total_usd', 'total_khr'].map((name) => [name, quote[name]]))
  return world.api('POST', '/api/sales', body, { as })
}

/**
 * Where a fixture number leaves: the key path of every string in `json` that holds one (array indexes folded to []), nested JSON text
 * included. The crawl prints these so a leak names the KEY, not just the route.
 */
function leakPathsIn(json, ignore = []) {
  const found = new Set()
  const visit = (node, at) => {
    if (typeof node === 'string') { if (leaksIn(node).some((key) => !ignore.includes(key))) found.add(at) }
    else if (Array.isArray(node)) for (const item of node) visit(item, `${at}[]`)
    else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) visit(value, `${at}.${key}`)
  }
  visit(json, '$')
  return [...found]
}

/** The text around the first fixture number in `text`, for a failure message. */
function snippetOf(text) {
  const flat = String(text)
  for (const { regexes } of ALL_VARIANTS) for (const re of regexes) { const m = re.exec(flat); if (m) return flat.slice(Math.max(0, m.index - 70), m.index + m[0].length + 40).replace(/s+/g, ' ') }
  return ''
}

module.exports = { bootPhoneWorld, PHONES, PRODUCT_CODE, PRODUCT_CODE_MASK, leaksIn, variantsOf, optionJson, snippetOf, leakPathsIn }
