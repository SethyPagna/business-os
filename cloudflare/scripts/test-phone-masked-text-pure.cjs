'use strict'
// 6.0.1162 (the security review's B1, B2, B3), on the real sources: lib/phoneAccess.ts, lib/phoneMask.ts, lib/phoneWriteGuard.ts.
//
//   B1  scrubMaskedInput: a value that IS the mask of a name, a note, a label or a quoted reason comes back from a form and means
//       "unchanged": it leaves the request, at any depth. Real values, phone keys (their own guard) and serialized JSON are not touched.
//       resolveAddressInput does the same for a Contact Option's name and label, against the stored option.
//   B2  a product, brand, category, unit or branch name is shown as stored; a person's is still masked.
//   B3  the people the app names under keys that do not end in "name" (contact_person, username, cashier, created_by ...) are names.
//
// Part 4 runs MUTANTS of the same sources through the same assertions: each must fail, so a green run cannot be a test that checks nothing.
// Synthetic numbers only (the 097 2xx 8xx set).
//
// Run (from cloudflare/): node scripts/test-phone-masked-text-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const read = (name) => fs.readFileSync(path.join(LIB, name), 'utf8').split('\r\n').join('\n')

// Every signed-in session reads full numbers now (owner, 12 Nov 2026), so the projection and the scrub are exercised on the
// switch-back copy: canSeeFullPhones swapped for holdsFullPhoneGrant, which makes the cashier fixture a masked account again.
// The live rule itself is pinned in test-phone-mask-pure.cjs.
const SWITCH_BACK = (source) => {
  const head = 'export function canSeeFullPhones(user: PhoneActor): boolean {'
  const at = source.indexOf(head)
  assert.ok(at >= 0, 'switch-back anchor missing')
  return source.slice(0, at) + head + ' return holdsFullPhoneGrant(user) ' + source.slice(source.indexOf('}', at))
}

function load(mutate = {}) {
  const cache = new Map()
  const load1 = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }
    cache.set(name, module)
    let source = read(`${name}.ts`)
    if (mutate[name]) source = mutate[name](source)
    if (name === 'phoneAccess') source = SWITCH_BACK(source)
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      if (id.startsWith('./')) return load1(id.slice(2))
      throw new Error(`unexpected import ${id}`)
    }, module, module.exports)
    return module.exports
  }
  return { mask: load1('phoneMask'), access: load1('phoneAccess'), guard: load1('phoneWriteGuard') }
}

const must = (source, needle) => { assert.ok(source.includes(needle), `mutation anchor missing: ${needle}`); return needle }
const replaceOnce = (needle, replacement) => (source) => source.replace(must(source, needle), replacement)

const user = (permissions = {}, role = {}, role_code = 'employee', id = 7) => ({ id, role_code, permissions: JSON.stringify(permissions), role_permissions: JSON.stringify(role) })
const cashier = user({ pos: true, contacts: true, sales: true })
const granted = user({ pos: true, contacts_full_phone: true })
const CODE = '88512345678901'
const CODE_MASK = '885 *** 901'

function run(modules) {
  const { mask, access, guard } = modules
  const failures = []
  const check = (name, fn) => { try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message || error).split('\n')[0]}`) } }
  const shown = (value, as = cashier) => access.projectPhones(value, as)
  const scrub = (value) => access.scrubMaskedInput(value)

  // ---- 1. B2: only people are masked by name -----------------------------------------------------------------------
  check('a product named by a long digit code is shown in full, on every shape a product travels in', () => {
    const product = { id: 1, name: CODE, barcode: CODE, selling_price_usd: 2, description: CODE }
    assert.deepEqual(shown(product), product, 'a products list row (name, barcode, price)')
    assert.deepEqual(shown({ id: 2, name: CODE, sku: 'S1' }), { id: 2, name: CODE, sku: 'S1' }, 'a row with a sku')
    assert.deepEqual(shown({ id: 3, name: CODE, color: '#6366f1' }), { id: 3, name: CODE, color: '#6366f1' }, 'a category or unit lookup row')
    assert.deepEqual(shown({ product_name: CODE, quantity: 1 }), { product_name: CODE, quantity: 1 }, 'a sale line, a movement, a stock-in line')
    assert.deepEqual(shown({ item_name: CODE, brand_name: CODE, category_name: CODE, unit_name: CODE, product_description: CODE }), { item_name: CODE, brand_name: CODE, category_name: CODE, unit_name: CODE, product_description: CODE })
    assert.deepEqual(shown({ source_product_name: CODE }), { source_product_name: CODE }, 'a legacy deleted line')
    assert.deepEqual(shown({ items: [{ id: 1, name: CODE, barcode: CODE }] }), { items: [{ id: 1, name: CODE, barcode: CODE }] }, 'inside a page')
  })
  check('the rows of a products list are products, whatever columns they carry; what they nest is judged on its own', () => {
    const ranking = { rankings: { products: [{ family_key: 'f1', name: CODE, qty_sold: 3 }] } }
    assert.deepEqual(shown(ranking), ranking, 'a ranking row (family_key, name, qty_sold)')
    const usage = { categories: [{ name: 'Soap', sample_products: [{ id: 1, name: CODE }] }] }
    assert.deepEqual(shown(usage), usage, 'a usage sample (id, name)')
    assert.deepEqual(shown({ topProducts: [{ name: CODE, revenue: 4 }] }), { topProducts: [{ name: CODE, revenue: 4 }] })
    assert.deepEqual(shown({ product: { id: 1, name: CODE } }), { product: { id: 1, name: CODE } }, 'a single product')
    const nested = shown({ products: [{ id: 1, name: CODE, supplier: { id: 2, name: '010 222 333' } }] })
    assert.equal(nested.products[0].name, CODE)
    assert.equal(nested.products[0].supplier.name, '010 *** 333', 'a supplier nested in a product row is still a person')
    assert.equal(shown({ customers: [{ id: 1, name: '010 222 333' }] }).customers[0].name, '010 *** 333', 'a list of anything else is not exempt')
  })
  check('a notification item of the inventory pages is labelled with a product; any other page\'s label is still a name', () => {
    const item = (pageId) => ({ id: 'n1', tone: 'warn', label: CODE, meta: 'Low stock', kind: 'low_stock', pageId })
    for (const page of ['inventory', 'products', 'catalog']) assert.deepEqual(shown(item(page)), item(page), page)
    assert.equal(shown({ ...item('sales'), label: '010 222 333' }).label, '010 *** 333')
  })
  check('a product\'s search text (name_normalized) is shown; a contact\'s is masked', () => {
    const product = { id: 1, name: CODE, barcode: CODE, name_normalized: CODE }
    assert.deepEqual(shown(product), product)
    assert.equal(shown({ id: 2, name: '010 222 333', membership_number: 'LC-1', name_normalized: '010 222 333' }).name_normalized, '010 *** 333')
    assert.equal(shown({ id: 3, receipt_number: 'R1', barcode: CODE, search_normalized: 'r1 dara 087654321' }).search_normalized, 'r1 dara 087 *** 321', 'a row that carries a barcode still has its customer digits in its search_normalized masked')
  })
  check('a branch named by a number is shown as stored; its own phone line too (the shop\'s)', () => {
    assert.deepEqual(shown({ branch_name: '095 777 626', from_branch_name: '095 777 627' }), { branch_name: '095 777 626', from_branch_name: '095 777 627' })
    const branch = { id: 1, name: '095 777 626', manager: 'Sok', location: 'Street 1', phone: '023 456 789' }
    assert.deepEqual(shown(branch), branch)
  })
  check('a person named by a number is still masked: a customer, a supplier, a courier, a bare { id, name } pick row', () => {
    assert.equal(shown({ id: 1, name: '010 222 333', membership_number: 'LC-1' }).name, '010 *** 333')
    assert.equal(shown({ id: 1, name: '010 222 333' }).name, '010 *** 333', 'a bare pick row fails closed: a missed catalog name hides, it never leaks')
    assert.equal(shown({ customer_name: '097 252 812', supplier_name: '097 252 812', recipient_name: '097 252 812' }).supplier_name, '097 *** 812')
    assert.equal(shown({ name: CODE }).name, CODE_MASK, 'a { name } with nothing that marks it a product is masked (fail closed)')
  })
  check('a holder reads every name as stored', () => {
    for (const value of [{ name: '010 222 333', membership_number: 'LC-1' }, { contact_person: '097 252 812' }, { username: '097 244 804' }]) assert.equal(shown(value, granted), value)
  })

  // ---- 2. B3: the people named under keys that do not end in "name" ----------------------------------------------------
  check('contact_person, username, cashier, created_by and the other people keys are names', () => {
    for (const key of ['contact_person', 'username', 'cashier', 'created_by', 'deleted_by', 'actor', 'owner', 'staff', 'employee', 'creator', 'reviewer', 'approver', 'seller', 'operator', 'requester', 'manager', 'person', 'user', 'author', 'agent', 'createdBy', 'contactPerson']) {
      assert.equal(access.keyMaskOf(key), 'name', key)
      assert.equal(shown({ [key]: '097 252 812' })[key], '097 *** 812', `${key} shows masked`)
      assert.equal(shown({ [key]: 'Vanna' })[key], 'Vanna', `${key} = a name is shown as stored`)
      assert.equal(shown({ [key]: '097 252 812' }, granted)[key], '097 252 812', `${key} is read in full by a holder`)
    }
  })
  check('a { key, name } pair: the key that is the name lower-cased is the name (the cashiers a report offers as a filter)', () => {
    assert.deepEqual(shown({ meta: { cashiers: [{ key: '097 248 808', name: '097 248 808', line_count: 3 }, { key: 'sok', name: 'Sok', line_count: 1 }] } }).meta.cashiers,
      [{ key: '097 *** 808', name: '097 *** 808', line_count: 3 }, { key: 'sok', name: 'Sok', line_count: 1 }])
    assert.deepEqual(shown({ key: 'theme', name: 'Theme' }), { key: 'theme', name: 'Theme' }, 'an ordinary key / name pair is untouched')
  })
  check('the account\'s own row is shown to it; an audit row that happens to share its id is not', () => {
    const own = { id: 7, username: '097 244 804', name: '097 244 804', phone: '097 244 805' }
    assert.deepEqual(shown(own, user({ pos: true }, {}, 'employee', 7)), own, 'its own username, name and phone')
    assert.deepEqual(shown(own, user({ pos: true }, {}, 'employee', 8)), { id: 7, username: '097 *** 804', name: '097 *** 804', phone: '097 *** 805' }, 'somebody else\'s row')
    assert.equal(shown({ id: 7, user_name: '097 244 804', username: '097 244 804', action: 'update' }, user({ pos: true }, {}, 'employee', 7)).username, '097 *** 804', 'an audit row with the same id')
  })
  check('the username inside a stored sale snapshot (serialized JSON) is masked too', () => {
    const text = JSON.stringify({ cashier: { id: 9, username: '097 245 805' }, actor: { id: 9, username: '097 245 805' } })
    const out = shown({ creation_snapshot_json: text }).creation_snapshot_json
    assert.ok(!out.includes('245 805') && out.includes('097 *** 805'), out)
  })

  // ---- 3. B1: a mask that comes back is "unchanged" ---------------------------------------------------------------------
  check('scrubMaskedInput removes a name, a note, a label, a description and a person that are only a mask', () => {
    assert.deepEqual(scrub({ name: '097 *** 822', notes: '097 *** 822', label: '097 *** 831', description: '097 *** 822', contact_person: '097 *** 812', email: 'a@b.test' }), { email: 'a@b.test' })
    assert.deepEqual(scrub({ name: '***', notes: '1 *** 2' }), {}, 'the short forms')
    assert.deepEqual(scrub({ name: '０９７ *** ８２２' }), {}, 'the same mask written with full-width digits')
  })
  check('scrubMaskedInput reaches into arrays and objects (a sale\'s lines, a bulk edit\'s rows)', () => {
    assert.deepEqual(scrub({ items: [{ product_id: 3, name: CODE_MASK, product_name: CODE_MASK, quantity: 1 }, { product_id: 4, name: 'Soap' }], customer: { name: '010 *** 333', id: 5 } }),
      { items: [{ product_id: 3, quantity: 1 }, { product_id: 4, name: 'Soap' }], customer: { id: 5 } })
    assert.deepEqual(scrub([{ notes: '097 *** 822' }, { notes: 'ok' }]), [{}, { notes: 'ok' }])
  })
  check('scrubMaskedInput keeps everything else: real values, phones (their own guard), serialized JSON, other keys', () => {
    const body = { name: 'Dara', notes: '097 262 822', phone: '087 *** 321', address: '[{"phone":"087 *** 321"}]', payload: '{"name":"097 *** 822"}', total: 3, sale_note: null, items: [] }
    assert.equal(scrub(body), body, 'the same object comes back when nothing was removed')
    assert.deepEqual(scrub({ name: 'Mask *** here', notes: 'a *** b' }), { name: 'Mask *** here', notes: 'a *** b' }, 'a *** that is not the mask shape is a typed value')
    assert.deepEqual(scrub({ notes: 'call *** later', label: 'ref 4471', description: '097 262 822' }), { notes: 'call *** later', label: 'ref 4471', description: '097 262 822' }, 'a note that merely contains *** or digits is a note, not a mask')
    assert.deepEqual(scrub({ name: '097 **** 822' }), { name: '097 **** 822' })
    assert.equal(scrub(null), null)
    assert.equal(scrub('097 *** 822'), '097 *** 822', 'a bare string has no key')
  })
  check('scrubMaskedInput: a reason that quotes a mask is unchanged; a quoted real number or a system message is kept', () => {
    assert.deepEqual(scrub({ reason: 'refund to "093 *** 424" requested', amount: 1 }), { amount: 1 })
    assert.deepEqual(scrub({ reason: "ref '093 *** 424'" }), {})
    assert.deepEqual(scrub({ reason: 'refund to “093 *** 424”' }), {})
    assert.deepEqual(scrub({ reason: 'refund to "093 111 424" requested' }), { reason: 'refund to "093 111 424" requested' }, 'a real number typed by the person')
    assert.deepEqual(scrub({ reason: 'broken seal batch 4471' }), { reason: 'broken seal batch 4471' })
    assert.deepEqual(scrub({ message: 'Phone "087 *** 321" is already registered' }), { message: 'Phone "087 *** 321" is already registered' }, 'a message the client reports back is not an edit')
  })
  check('scrubMaskedInput does not modify its input', () => {
    const body = { name: '097 *** 822', items: [{ name: CODE_MASK }], keep: 1 }
    const copy = JSON.stringify(body)
    scrub(body)
    assert.equal(JSON.stringify(body), copy)
  })
  check('scrubMaskedRequestText: the request text, or null when nothing was removed', () => {
    assert.equal(access.scrubMaskedRequestText('{"name":"Dara","notes":"x"}'), null, 'no *** : one substring test')
    assert.equal(access.scrubMaskedRequestText('{"phone":"087 *** 321","name":"Dara"}'), null, 'a mask under a phone key is not this layer\'s')
    assert.equal(access.scrubMaskedRequestText('not json *** at all'), null)
    assert.equal(access.scrubMaskedRequestText('{"notes":"097 *** 822","email":"a@b.test"}'), '{"email":"a@b.test"}')
    assert.equal(access.scrubMaskedRequestText('{"items":[{"name":"885 *** 901","quantity":2}]}'), '{"items":[{"quantity":2}]}')
  })
  check('hasMaskedQuote: the quoted mask shapes and nothing else', () => {
    for (const text of ['refund to "093 *** 424"', "ref '093 *** 424'", 'x “093 *** 424”', 'x "***" y', 'x ""093 *** 424""']) assert.equal(mask.hasMaskedQuote(text), true, text)
    for (const text of ['refund to "093 111 424"', 'broken seal', 'a *** b', '"093 ** 424"', '']) assert.equal(mask.hasMaskedQuote(text), false, text)
  })

  // ---- 4. B1 for a Contact Option's name and label ------------------------------------------------------------------------
  const stored = { phone: '097 252 801', address: JSON.stringify([{ label: 'Office', name: '097 252 812', phone: '097 252 801', email: null, address: 'Street 3', area: null }, { label: 'Home', name: 'Vanna', phone: '097 252 802', email: null, address: null, area: null }]) }
  const sent = (options) => JSON.stringify(options)
  check('resolveAddressInput gives a masked Contact Option name or label back the stored option\'s own value', () => {
    const out = JSON.parse(guard.resolveAddressInput(sent([
      { label: 'Office', name: '097 *** 812', phone: '097 *** 801', email: null, address: 'Street 3', area: null },
      { label: 'Home', name: 'Vanna', phone: '097 *** 802', email: null, address: null, area: null },
    ]), stored))
    assert.equal(out[0].name, '097 252 812')
    assert.equal(out[0].phone, '097 252 801')
    assert.equal(out[1].name, 'Vanna')
  })
  check('a masked Contact Option name that is not the stored option\'s mask is refused; a typed name passes', () => {
    assert.throws(() => guard.resolveAddressInput(sent([{ label: 'Office', name: '097 *** 999', phone: '097 *** 801', email: null, address: null, area: null }]), stored), (error) => guard.isMaskedPhoneInputError(error))
    assert.throws(() => guard.resolveAddressInput(sent([{ label: 'New', name: '097 *** 812', phone: '', email: null, address: null, area: null }, { label: 'X', name: 'a', phone: '', email: null, address: null, area: null }, { label: 'Y', name: 'b', phone: '', email: null, address: null, area: null }]), { phone: '', address: null }), (error) => guard.isMaskedPhoneInputError(error), 'nothing stored to take it from')
    const typed = guard.resolveAddressInput(sent([{ label: 'Office', name: 'Sok', phone: '097 252 801', email: null, address: null, area: null }]), stored)
    assert.equal(typed, sent([{ label: 'Office', name: 'Sok', phone: '097 252 801', email: null, address: null, area: null }]), 'text with no mask is returned as it arrived')
  })
  check('a create that carries a masked Contact Option name or label is refused like a masked phone', () => {
    assert.equal(guard.bodyHasMaskedPhone({ name: 'x', address: sent([{ label: 'A', name: '097 *** 812', phone: '097 252 801' }]) }), true)
    assert.equal(guard.bodyHasMaskedPhone({ name: 'x', address: sent([{ label: '097 *** 812', name: 'Vanna', phone: '097 252 801' }]) }), true)
    assert.equal(guard.bodyHasMaskedPhone({ name: 'x', address: sent([{ label: 'A', name: 'Vanna', phone: '097 252 801' }]) }), false)
  })
  return failures
}

// ---- mutants -------------------------------------------------------------------------------------------------------------------------
const MUTANTS = [
  ['scrub: any text that contains *** is taken for a mask', { phoneAccess: replaceOnce('!== 0) && isMaskedPhone(value))', "!== 0) && value.includes('***'))") }],
  ['scrub: a masked name is kept', { phoneAccess: replaceOnce('(((classify(key) & (NAME | CATALOG)) !== 0) && isMaskedPhone(value))', 'false') }],
  ['scrub: a mask under a product name is kept', { phoneAccess: replaceOnce('(NAME | CATALOG)) !== 0) && isMaskedPhone', '(NAME)) !== 0) && isMaskedPhone') }],
  ['scrub: a quoted mask is kept', { phoneAccess: replaceOnce("(mask === 'quoted' && AUTHORED_SENTENCE.test(key) && hasMaskedQuote(value))", 'false') }],
  ['scrub: every name is dropped, real or not', { phoneAccess: replaceOnce('(NAME | CATALOG)) !== 0) && isMaskedPhone(value))', '(NAME | CATALOG)) !== 0))') }],
  ['scrub: nested objects are not read', { phoneAccess: replaceOnce('next = scrubMaskedInput(value, depth + 1)', 'next = value') }],
  ['scrub: arrays are not read', { phoneAccess: replaceOnce('const next = scrubMaskedInput(node[i], depth + 1)', 'const next = node[i]') }],
  ['scrub: a system message is edited too', { phoneAccess: replaceOnce('AUTHORED_SENTENCE.test(key) && ', '') }],
  ['catalog: a product or branch name is masked like a person', { phoneAccess: replaceOnce('if (NAME_KEY.test(normalized)) kind |= CATALOG_KEY.test(normalized) ? CATALOG : NAME', 'if (NAME_KEY.test(normalized)) kind |= NAME') }],
  ['catalog: a bare name on a product row is masked', { phoneAccess: replaceOnce('(catalog ??= rowOfProducts || isCatalogRow(source))', 'false') }],
  ['catalog: a lookup row (colour) is masked', { phoneAccess: replaceOnce(", 'normalized_name', 'color']", ", 'normalized_name']") }],
  ['catalog: the rows of a products list are masked', { phoneAccess: replaceOnce('walk(value, depth + 1, actorId, PRODUCT_LIST_KEY.test(key))', 'walk(value, depth + 1, actorId, false)') }],
  ['catalog: a products-list row exempts what it nests too', { phoneAccess: replaceOnce('walk(value, depth + 1, actorId, PRODUCT_LIST_KEY.test(key))', 'walk(value, depth + 1, actorId, rowOfProducts || PRODUCT_LIST_KEY.test(key))') }],
  ['catalog: a notification item of the inventory pages is masked', { phoneAccess: replaceOnce("if (page === 'inventory' || page === 'products' || page === 'catalog') return true", '') }],
  ['catalog: a product\'s name_normalized is masked', { phoneAccess: replaceOnce("if ((kind & SEARCH_TEXT) && key === 'name_normalized'", "if (false && key === 'name_normalized'") }],
  ['catalog: any search text of a row with a barcode is shown', { phoneAccess: replaceOnce("if ((kind & SEARCH_TEXT) && key === 'name_normalized'", 'if ((kind & SEARCH_TEXT)') }],
  ['catalog: a branch row\'s name is masked', { phoneAccess: replaceOnce('  return isBranchRow(node)\n}', '  return false\n}') }],
  ['catalog: every bare name is shown (a person\'s too)', { phoneAccess: replaceOnce('(catalog ??= rowOfProducts || isCatalogRow(source))', 'true') }],
  ['people: contact_person, cashier and the rest are not names', { phoneAccess: replaceOnce('summary|person|cashier', 'summary|xperson|xcashier') }],
  ['people: a { key, name } pair\'s key is shown', { phoneAccess: replaceOnce("if (key === 'key' && typeof value === 'string' && typeof source.name === 'string'", "if (false && typeof value === 'string' && typeof source.name === 'string'") }],
  ['people: the account\'s own username is masked', { phoneAccess: replaceOnce("(key === 'phone' || key === 'username' || key === 'name')", "(key === 'phone')") }],
  ['people: an audit row is taken for the account\'s own row', { phoneAccess: replaceOnce(" && !Object.hasOwn(source, 'user_name')", '') }],
  ['options: a masked option name is saved as it came', { phoneWriteGuard: replaceOnce('if (kept == null || !isMaskOf(option[field], kept)) throw new MaskedPhoneInputError()\n      resolved[field] = kept', 'resolved[field] = option[field]') }],
  ['options: a mask of some other name is accepted', { phoneWriteGuard: replaceOnce('if (kept == null || !isMaskOf(option[field], kept)) throw new MaskedPhoneInputError()', 'if (kept == null) throw new MaskedPhoneInputError()') }],
  ['options: a create with a masked option name is accepted', { phoneWriteGuard: replaceOnce(' || OPTION_TEXT_FIELDS.some((field) => isMaskedText(option[field]))', '') }],
  ['quote: a masked quote is not recognised', { phoneMask: replaceOnce("return text.includes('***') && QUOTED_MASK.test(text)", 'return false') }],
]

const failures = run(load())
if (failures.length) {
  for (const failure of failures) console.error(`RED ${failure}`)
  console.error(`FAIL ${failures.length} check(s)`)
  process.exit(1)
}
let survivors = 0
let killed = 0
for (const [name, mutate] of MUTANTS) {
  const outcome = run(load(mutate))
  if (outcome.length) { killed += 1; console.log(`killed   ${name} (${outcome.length} red)`) } else { survivors += 1; console.error(`SURVIVED ${name}`) }
}
if (survivors) { console.error(`FAIL ${survivors} mutant(s) survived`); process.exit(1) }
console.log(`PASS phone masked text: all checks green, ${killed} mutants killed`)
