'use strict'
// P2.8 (6.0.1046): a real Worker (every middleware, route and lib, bundled) whose database holds synthetic people with
// phone numbers in every place the app keeps one, and accounts that differ ONLY in the full-phone grant. Used by the
// leak crawl and the write-path tests. Every name and number here is invented: 087 / 098 / 077 / 096 / 085 / 010 are
// fixture prefixes and the repo is public.
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
}

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

  world.ids = ids
  world.PHONES = PHONES
  return world
}

/** The text around the first fixture number in `text`, for a failure message. */
function snippetOf(text) {
  const flat = String(text)
  for (const { regexes } of ALL_VARIANTS) for (const re of regexes) { const m = re.exec(flat); if (m) return flat.slice(Math.max(0, m.index - 70), m.index + m[0].length + 40).replace(/s+/g, ' ') }
  return ''
}

module.exports = { bootPhoneWorld, PHONES, leaksIn, variantsOf, optionJson, snippetOf }
