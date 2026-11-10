'use strict'
// Owner decision of 10 Nov 2026 ("Allow partial"): an account without `contacts_full_phone` finds a customer or contact by PART of a number, the
// same as a holder (this reverses the closed-fragment rule of P2.8, 6.0.1046, for customer lookups); only the response masks the phone.
//
// Real transpiled sources run against REAL SQLite FTS5 (better-sqlite3, migration 0020 applied verbatim). Part 1 classifies a typed search.
// Part 2 pins the one search every account shares: base-commit parity (or a superset), fragments, whole numbers in every format, and
// the Reports > Sales matcher, where a number in a cashier column stays closed without the grant. Part 3 covers the audit log and import
// review, which stay closed. Part 4 runs MUTANTS of the same sources through the same assertions: each must fail.
//
// Run (from cloudflare/): node scripts/test-phone-search-guard-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const Database = require('better-sqlite3')

const LIB = path.join(__dirname, '..', 'src', 'lib')
const BASE_COMMIT = 'cbff55c8e'
const readLib = (name) => fs.readFileSync(path.join(LIB, `${name}.ts`), 'utf8').split('\r\n').join('\n')
const readBase = (name) => execFileSync('git', ['show', `${BASE_COMMIT}:cloudflare/src/lib/${name}.ts`], { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\r\n').join('\n')

function loader({ mutate = {}, base = [] } = {}) {
  const cache = new Map()
  const load1 = (name) => {
    if (cache.has(name)) return cache.get(name).exports
    const module = { exports: {} }
    cache.set(name, module)
    let source = base.includes(name) ? readBase(name) : readLib(name)
    if (mutate[name]) source = mutate[name](source)
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
    new Function('require', 'module', 'exports', output)((id) => {
      if (id.startsWith('./')) return load1(id.slice(2))
      throw new Error(`unexpected import ${id}`)
    }, module, module.exports)
    return module.exports
  }
  return load1
}

const must = (source, needle) => { assert.ok(source.includes(needle), `mutation anchor missing: ${needle}`); return needle }
const replaceOnce = (needle, replacement) => (source) => source.replace(must(source, needle), () => replacement)

const OPEN = { fullPhone: true }
const CLOSED = { fullPhone: false }

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, address TEXT, company TEXT, notes TEXT, membership_number TEXT, gender TEXT, phone_normalized TEXT, created_at TEXT, updated_at TEXT)`)
  db.exec(`CREATE TABLE suppliers (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, address TEXT, company TEXT, contact_person TEXT, notes TEXT, created_at TEXT, updated_at TEXT)`)
  db.exec(`CREATE TABLE delivery_contacts (id INTEGER PRIMARY KEY, name TEXT, phone TEXT, area TEXT, address TEXT, notes TEXT, created_at TEXT, updated_at TEXT)`)
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0020_contacts_fts.sql'), 'utf8'))
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', '0302_customers_phone_digits_fts.sql'), 'utf8'))
  const option = (label, phone, address) => JSON.stringify([{ label, name: label, phone, email: null, address, area: null }])
  const customer = db.prepare('INSERT INTO customers (id, name, phone, email, address, company, membership_number, phone_normalized) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  customer.run(1, 'Fixture Dara', '087 654 321', 'dara@example.test', option('Work', '098 111 222', 'Street 9'), null, 'LC-P28-1', '087654321')
  customer.run(2, 'Fixture Sophea', '089100200', null, null, null, 'LC-P28-2', '089100200')
  customer.run(3, '010 222 333', '010 222 333', null, null, null, 'LC-P28-3', '010222333')
  customer.run(5, 'Fixture Pairs', '12 34 56 78', null, null, null, 'LC-P28-5', '12345678')
  customer.run(6, 'Fixture Short', '1234567', null, null, null, 'LC-P28-6', '1234567')
  customer.run(7, 'Fixture Legacy', 'Tel099456789', null, null, null, 'LC-P28-7', '099456789')
  customer.run(8, 'Fixture Option', '', null, option('Home', '+855 97 333 444', 'Street 5'), null, 'LC-P28-8', null)
  customer.run(4, 'Fixture Visal', '+855 12 777 888', null, null, 'Visal Trading', 'LC-P28-4', '012777888')
  const supplier = db.prepare('INSERT INTO suppliers (id, name, phone, address, company, contact_person) VALUES (?, ?, ?, ?, ?, ?)')
  supplier.run(1, 'Fixture Supplies', '077 333 444', option('Office', '078 444 555', 'Street 3'), 'Fixture Co', 'Vanna')
  // A contact person saved as a number (the supplier form fills it from the primary Contact Option's name): masked in the response, so unreadable to a digit word.
  supplier.run(2, 'Fixture Noted Supplies', null, null, 'Noted Co', '097 252 812')
  const delivery = db.prepare('INSERT INTO delivery_contacts (id, name, phone, area, address) VALUES (?, ?, ?, ?, ?)')
  delivery.run(1, 'Fixture Courier', '096 555 666', 'North', option('Depot', '095 666 777', null))
  return db
}

const QUERIES = [
  '', '   ', 'dara', 'Fixture', 'soph', 'LC-P28-1', 'lc p28 1', 'dara@example', 'visal trading', 'vanna', 'north', 'courier',
  '087', '0876', '087 654', '654', '321', '654321', '087654321', '087 654 321', '087-654-321', '(087) 654 321', '+855 87 654 321',
  '98 111', '111', '222', '111 111 111 111', '345 345 345', '0123 0123 0123', '12345678', '1234567', '0', '1',
  'dara 087', 'dara 087 654 321', '087 *** 321', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１', 'a1', 'p28', '28',
  '0891\u0301', '089\u03001', '0891\u200D', 'o8910', 'O8910', 'dara 0891\u0301', '٠٨٩١', '０８９１', '+87654321', '87654321', '00855 87 654 321', '0085587654321', '+៨៥៥ ៨៧ ៦៥៤ ៣២១', '855 87 654 321', 'x'.repeat(70), "o'brien", 'dara,sophea', '"', '%', '_',
]
const TABLES = ['customers', 'suppliers', 'delivery_contacts']

function run(load, { baseLoad }) {
  const failures = []
  const check = (name, fn) => { try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message || error).split('\n')[0]}`) } }
  const guard = load('phoneSearchGuard')
  const { buildContactMatchClause } = load('contactSearch')
  const { buildSalesCustomerMatchClause } = load('salesCustomerSearch')
  const { buildAuditLogFilters } = load('auditLogQuery')
  const { buildImportReviewWhere } = load('importReviewQuery')
  const db = freshDb()
  const ids = (table, query) => {
    const clause = buildContactMatchClause(table, query, 'search')
    if (!clause) return null
    return db.prepare(`SELECT id FROM ${table} WHERE ${clause.sql} ORDER BY id`).all(clause.params).map((row) => row.id)
  }
  const pickerIds = (query) => {
    const clause = buildSalesCustomerMatchClause(query)
    if (!clause) return null
    return db.prepare(`SELECT id FROM customers WHERE ${clause.sql} ORDER BY id`).all(clause.params).map((row) => row.id)
  }

  // ---- 1. what a typed search does to a hidden number ---------------------------------------------------------------
  check('probe classification', () => {
    const kind = (q) => guard.phoneProbeOf(q).kind
    for (const q of ['dara', '', 'visal trading', 'dara@example']) assert.equal(kind(q), 'none', `kind(${q})`)
    for (const q of ['LC-P28-1', 'a1', 'tel0876', 'tel087612345']) assert.equal(kind(q), 'partial', `a word that holds a digit is at least a partial probe: kind(${q})`)
    for (const q of ['087', '0876', '087 654', '654321', '1234567', '12345', '0', 'dara 087', 'dara 087 654 321', '087 *** 321']) assert.equal(kind(q), 'partial', `kind(${q})`)
    for (const q of ['087654321', '087 654 321', '087-654-321', '(087) 654 321', '+855 87 654 321', '12345678', '0123 0123 0123', '345 345 345', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１']) assert.equal(kind(q), 'full', `kind(${q})`)
    assert.equal(kind('1234567890123456'), 'partial', '16 digits is not a phone number')
    assert.deepEqual(guard.phoneProbeOf('+855 87 654 321').forms.sort(), ['085587654321'.slice(1), '087654321'].sort())
    assert.deepEqual(guard.phoneProbeOf('087 654 321').forms.sort(), ['087654321', '85587654321'])
  })
  check('bare number words', () => {
    for (const word of ['654', '+855', '(087)', '087-654', '០៨៧', '654"', '"0876', ':654321', '654,', 'e":"087654', '#654', '٦٥٤', '๐๘๗']) assert.ok(guard.isBareNumberWord(word), word)
    for (const word of ['dara', 'RCP-1234', 'a1', '', '-', '087a', 'p28-0001']) assert.ok(!guard.isBareNumberWord(word), word)
  })

  // ---- 2. every account searches exactly like the holder did before --------------------------------------------------------
  check('every account: byte-equal to the base commit for every query and table, or a superset of it', () => {
    const baseContact = baseLoad('contactSearch')
    const baseSales = baseLoad('salesCustomerSearch')
    // A typed number (whatever separators the stored phone has), or digits of another script, now also finds its contact: a superset.
    const sameOrMore = (label, table, q, lane, base) => {
      if (JSON.stringify(lane) === JSON.stringify(base)) return
      const probe = guard.phoneProbeOf(q)
      assert.ok((probe.kind === 'full' && !probe.plain) || guard.typedPhoneDigitForms(q) !== null || /[^\x00-\x7f]/.test(q), `${label}: only a typed number (whatever separators the stored phone has), or digits of another script, may differ from the base`)
      const run = (clause) => (clause ? db.prepare(`SELECT id FROM ${table} WHERE ${clause.sql} ORDER BY id`).all(clause.params).map((row) => row.id) : [])
      const laneIds = run(lane)
      assert.ok(run(base).every((id) => laneIds.includes(id)), `${label}: nothing the base found is lost (${laneIds} vs ${run(base)})`)
    }
    for (const table of TABLES) for (const q of QUERIES) {
      sameOrMore(`${table} ${JSON.stringify(q)}`, table, q, buildContactMatchClause(table, q, 'search'), baseContact.buildContactMatchClause(table, q, 'search'))
    }
    for (const q of QUERIES) sameOrMore(`picker ${JSON.stringify(q)}`, 'customers', q, buildSalesCustomerMatchClause(q), baseSales.buildSalesCustomerMatchClause(q))
  })
  check('a number fragment finds the contact (owner decision of 10 Nov 2026: the same for an account without the grant)', () => {
    assert.deepEqual(ids('customers', '087'), [1])
    assert.deepEqual(ids('customers', '654'), [1])
    assert.deepEqual(ids('customers', '111'), [1])
    assert.deepEqual(ids('customers', '0876'), [1])
    assert.deepEqual(ids('suppliers', '444'), [1])
    assert.deepEqual(ids('delivery_contacts', '666'), [1])
    assert.deepEqual(pickerIds('0876'), [1])
    assert.deepEqual(pickerIds('876'), [1])
    assert.deepEqual(ids('customers', '98 111'), [1], 'a Contact Option phone')
    assert.deepEqual(ids('suppliers', '333'), [1])
    assert.deepEqual(ids('suppliers', '444 555'), [1])
    assert.deepEqual(ids('delivery_contacts', '555'), [1])
    assert.deepEqual(ids('delivery_contacts', '666 777'), [1])
    assert.deepEqual(ids('customers', '0891'), [2])
    assert.deepEqual(ids('customers', '12345').sort(), [5, 6])
  })
  check('the last digits and the first digits find the customer, across the separators the stored phone has', () => {
    for (const [q, expected] of [['7654', [1]], ['765432', [1]], ['0876 5432', [1]], ['4321', [1]], ['321', [1]], ['12777', [4]], ['7888', [4]], ['012 777 888', [4]], ['012777888', [4]], ['+855 12 777 888', [4]], ['85512777888', [4]]]) {
      assert.deepEqual(ids('customers', q), expected, `customers ${q}`)
      assert.deepEqual(pickerIds(q), expected, `picker ${q}`)
    }
    assert.deepEqual(ids('suppliers', '8444'), [1], 'a run across the separators of a Contact Option phone')
    assert.deepEqual(ids('delivery_contacts', '5666'), [1], 'a delivery contact')
    assert.deepEqual(ids('customers', '1234'), [5, 6])
    db.prepare("INSERT INTO customers (id, name, phone, phone_normalized) VALUES (90, 'Cache Only', 'ask at the shop', '011222333')").run()
    assert.deepEqual(ids('customers', '011222333'), [90], 'the cache column finds a customer whose phone text holds no digits')
    assert.deepEqual(ids('customers', '222333'), [3], 'the cache column is compared whole: a fragment of it finds nobody')
    db.prepare('DELETE FROM customers WHERE id = 90').run()
  })
  check('a number typed with other punctuation is compared as one whole number (equality, never containment)', () => {
    assert.deepEqual(ids('customers', '087/654/321'), [1])
    assert.deepEqual(ids('customers', '098/111/222'), [1], 'a Contact Option number finds its customer')
    assert.deepEqual(ids('customers', '87/654/321'), [], 'a tail typed with such punctuation is not read as a fragment')
    assert.deepEqual(ids('customers', '98/111/222'), [], 'the same for a Contact Option number')
    assert.deepEqual(ids('customers', '097/333/444'), [8], 'a Contact Option number saved with +855 (the digits are held as 85597333444)')
    assert.deepEqual(ids('delivery_contacts', '096/555/666'), [1])
  })
  check('the whole number in a common format finds the customer', () => {
    for (const q of ['087 654 321', '(087) 654 321', '087654321', '087-654-321']) {
      assert.deepEqual(ids('customers', q), [1], `customers ${q}`)
      assert.deepEqual(pickerIds(q), [1], `picker ${q}`)
    }
    for (const q of ['+855 87 654 321', '85587654321']) assert.deepEqual(pickerIds(q), [1], `picker ${q}`)
    assert.deepEqual(ids('customers', '098 111 222'), [1], 'a Contact Option number finds its customer')
    assert.deepEqual(ids('customers', '089100200'), [2])
    assert.deepEqual(ids('customers', '010 222 333'), [3])
    assert.deepEqual(ids('suppliers', '077 333 444'), [1])
    assert.deepEqual(ids('suppliers', '078 444 555'), [1], 'a supplier Contact Option number finds the supplier')
    assert.deepEqual(ids('delivery_contacts', '096 555 666'), [1])
    assert.deepEqual(ids('delivery_contacts', '095-666-777'), [1])
    assert.deepEqual(ids('customers', '12 34 56 78'), [5])
    assert.deepEqual(ids('customers', '12 34 56'), [5, 6])
  })
  check('a near-miss number finds nobody', () => {
    for (const q of ['087 654 322', '087 654 320', '087 655 321', '187 654 321']) {
      assert.deepEqual(ids('customers', q), [], q)
      assert.deepEqual(pickerIds(q), [], q)
    }
  })
  check('names, membership numbers, e-mail and company search as before', () => {
    for (const [table, q] of [['customers', 'dara'], ['customers', 'soph'], ['customers', 'dara@example'], ['customers', 'visal trading'], ['suppliers', 'vanna'], ['suppliers', 'fixture co'], ['delivery_contacts', 'north'], ['delivery_contacts', 'courier']]) {
      assert.ok((ids(table, q) || []).length >= 1, `${table} ${q} finds something`)
    }
    assert.ok(ids('customers', 'LC-P28-1').includes(1), 'a membership number made of digits and letters finds its customer')
    assert.ok(ids('customers', 'lc p28 2').includes(2))
  })
  check('a customer saved under its number, and a supplier whose contact person is one, are found by a fragment of it', () => {
    assert.deepEqual(ids('customers', '0102 2'), [3])
    assert.ok(ids('customers', '222').includes(3))
    assert.ok(ids('suppliers', '252').includes(2))
    assert.ok(ids('suppliers', '097 252').includes(2))
    assert.deepEqual(ids('suppliers', 'noted'), [2])
  })
  check('mixed text and digits searches the words together', () => {
    assert.deepEqual(ids('customers', 'dara 087'), [1])
    assert.deepEqual(ids('customers', 'dara 111'), [1])
    assert.deepEqual(ids('customers', 'sophea 087'), [])
  })
  check('a digit fragment disguised from the raw text finds what the plain fragment finds (the matcher reads accents away and a letter o as a zero)', () => {
    for (const q of ['0891́', '089̀1', '0891‍', 'o8910', 'O8910', 'dara 0891́', '089 1́', '٠٨٩١', '０８９１', '0́891']) {
      assert.equal(guard.phoneProbeOf(q).kind, 'partial', `kind(${JSON.stringify(q)}) is decided on the words the matcher searches`)
    }
    assert.deepEqual(ids('customers', '0891'), [2])
    for (const [disguise, plain] of [['0891́', '0891'], ['o8910', '08910'], ['0891‍', '0891'], ['٠٨٩١', '0891'], ['０８９１', '0891']]) {
      assert.deepEqual(ids('customers', disguise), ids('customers', plain), `${JSON.stringify(disguise)} reads as the plain digits`)
      assert.deepEqual(pickerIds(disguise), pickerIds(plain), `picker ${JSON.stringify(disguise)}`)
    }
  })
  check('a legacy phone saved glued to letters is found by its digits', () => {
    for (const q of ['tel0994', 'tel09945', 'tel099456789', 'tel 0994', 'TEL0994']) {
      assert.deepEqual(ids('customers', q), [7], q)
      assert.deepEqual(pickerIds(q), [7], `picker ${q}`)
    }
    assert.deepEqual(ids('customers', '099456789'), [7], 'the whole number finds it through the cache column')
    assert.deepEqual(ids('customers', '56789'), [7])
  })
  check('a fragment of eight digits or more is contained in the phone, not only equal to it', () => {
    for (const q of ['87654321', '+87654321', '08765432', '(87654321)']) {
      assert.deepEqual(ids('customers', q), [1], `customers ${q}`)
      assert.deepEqual(pickerIds(q), [1], `picker ${q}`)
    }
  })
  check('a whole number written +855, 00855, in Khmer digits or in full-width digits finds its customer', () => {
    for (const q of ['00855 87 654 321', '0085587654321', '+៨៥៥ ៨៧ ៦៥៤ ៣២១', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１', '+855 87 654 321', '855 87 654 321']) {
      assert.deepEqual(ids('customers', q), [1], `customers ${q}`)
      assert.deepEqual(pickerIds(q), [1], `picker ${q}`)
    }
    assert.deepEqual(ids('suppliers', '00855 77 333 444'), [1])
    assert.deepEqual(ids('delivery_contacts', '+៨៥៥ ៩៦ ៥៥៥ ៦៦៦'), [1])
  })
  check('the contact search takes no account: the phone is searched as stored and only the response masks it', () => {
    const source = readLib('contactSearch') + readLib('salesCustomerSearch')
    assert.ok(!/fullPhone|PhoneSearchAccess/.test(source), 'no branch on the access level is left in the contact search')
    assert.equal(buildContactMatchClause.length, 3)
    assert.equal(buildSalesCustomerMatchClause.length, 1)
  })
  check('Reports > Sales search: the customer is found by a fragment of the name or phone, for every account; a number in another column stays closed without the grant', () => {
    const rows = [
      { id: 1, receipt_number: 'P28-0001', customer: 'Fixture Dara', customer_phone: '087 654 321', cashier: 'Za', branch: 'Shop', payment_method: 'Cash' },
      { id: 2, receipt_number: 'P28-0002', customer: '010 222 333', customer_phone: '010 222 333', cashier: 'Za', branch: 'Shop', payment_method: 'Cash' },
      { id: 3, receipt_number: 'P28-0003', customer: 'Fixture Sophea', customer_phone: '+855 89 100 200', cashier: 'Za', branch: 'Shop', payment_method: 'ABA' },
      { id: 4, receipt_number: 'P28-0004', customer: 'Walk-in', customer_phone: '', cashier: '093 456 789', branch: 'Shop', payment_method: 'Cash' },
    ]
    const found = (search, access) => rows.filter(guard.salesReportSearchMatcher(search.trim().toLowerCase(), access)).map((row) => row.id)
    for (const [q, expected] of [['654', [1]], ['65', [1]], ['087', [1]], ['321', [1]], ['054 3', []], ['222', [2]], ['010 2', [2]], ['100 200', [3]], ['87654321', []], ['087 654 321', [1]], ['087654321', [1]], ['+855 87 654 321', [1]], ['0085587654321', [1]], ['០៨៧ ៦៥៤ ៣២១', [1]], ['010 222 333', [2]], ['010222333', [2]], ['089100200', [3]], ['dara', [1]], ['P28-0001', [1]], ['za', [1, 2, 3]], ['aba', [3]], ['', [1, 2, 3, 4]]]) {
      for (const [label, access] of [['holder', OPEN], ['no grant', CLOSED]]) assert.deepEqual(found(q, access), expected, `${label}: ${JSON.stringify(q)}`)
    }
    for (const q of ['087 654 322', '0102223333']) assert.deepEqual(found(q, CLOSED), [], `no grant: near miss ${q}`)
    assert.deepEqual(found('456', OPEN), [4], 'positive control: a holder finds the sale by the number its cashier was saved under')
    assert.deepEqual(found('456', CLOSED), [], 'without the grant a number saved as a cashier is not searchable (the response masks it)')
  })

  // ---- the other search surfaces --------------------------------------------------------------------------------------
  check('audit log: a bare number never matches details / old_value / new_value without the grant', () => {
    const sqlOf = (search, phoneTextBlocked) => buildAuditLogFilters({ search, phoneTextBlocked }).where
    assert.ok(/details LIKE/.test(sqlOf('654', false)) && /old_value LIKE/.test(sqlOf('654', false)) && /new_value LIKE/.test(sqlOf('654', false)), 'a holder still searches the three text columns')
    const blocked = sqlOf('654', true)
    assert.ok(!/details LIKE|old_value LIKE|new_value LIKE/.test(blocked), blocked)
    // The user name is a name column: a user saved under a number reads as empty (restrictedColumnSql), any other name is read as stored.
    assert.ok(/COALESCE\(user_name,''\) END LIKE/.test(blocked) && /CAST\(entity_id AS TEXT\) LIKE/.test(blocked), 'ids and users still match')
    assert.ok(sqlOf('654', false).includes('user_name LIKE') && !sqlOf('654', false).includes('CASE WHEN'), 'a holder reads the user name as stored')
    assert.ok(/details LIKE/.test(sqlOf('dara', true)), 'a word still searches details')
    assert.ok(/details LIKE/.test(sqlOf('RCP-1234', true)), 'a receipt label still searches details')
    assert.ok(!/details LIKE/.test(sqlOf('087-654-321', true)))
  })
  check('audit log: an account without the grant still finds a money figure, as that whole figure, and no part of a dotted phone', () => {
    const audit = new Database(':memory:')
    audit.exec(`CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, user_name TEXT, action TEXT, entity TEXT, table_name TEXT, details TEXT, old_value TEXT, new_value TEXT, device_name TEXT, entity_id TEXT, record_id TEXT, created_at TEXT)`)
    const insert = audit.prepare('INSERT INTO audit_logs (id, user_name, action, details, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)')
    insert.run(1, 'fixture', 'sale_amend', '{"actual_cost_before":7.13,"actual_cost_after":8.27}', null, null)
    insert.run(2, 'fixture', 'sale_amend', '{"actual_cost_after":18.27}', null, null)
    insert.run(3, 'fixture', 'sale_amend', '{"actual_cost_after":8.271}', null, null)
    insert.run(4, 'fixture', 'contact_edit', '{"phone":"12.345.678"}', '12.345.678', '87.654.321')
    insert.run(5, 'fixture', 'contact_edit', '{"phone":"087 654 321"}', '087 654 321', '087654321')
    insert.run(6, 'fixture', 'sale_amend', 'note 8.27.', null, null)
    const found = (search, phoneTextBlocked) => {
      const { where, params } = buildAuditLogFilters({ search, phoneTextBlocked })
      return audit.prepare(`SELECT id FROM audit_logs ${where} ORDER BY id`).all(params).map((row) => row.id)
    }
    assert.deepEqual(found('8.27', true), [1, 6], 'the whole figure, wherever it stands as a figure')
    assert.deepEqual(found('7.13', true), [1])
    assert.deepEqual(found('8.27', false), [1, 2, 3, 6], 'a holder keeps the substring search')
    for (const probe of ['12.345', '12.3', '2.34', '345.678', '45.67', '5.678', '87.654', '7.654', '54.32', '87.6']) {
      assert.deepEqual(found(probe, true), [], `blocked probe ${probe}`)
    }
    assert.deepEqual(found('12.345', false), [4], 'a holder still finds the dotted phone')
    for (const probe of ['654', '087', '087 654', '321', '12.345.678', '87.654.321']) assert.deepEqual(found(probe, true), [], `blocked ${probe}`)
    assert.deepEqual(found('contact_edit', true), [4, 5], 'words are untouched')
  })
  check('import review: a number never matches the phone or the identifier without the grant', () => {
    const where = (query, phoneTextBlocked) => buildImportReviewWhere({ jobId: 'job', query, phoneTextBlocked }).sql
    assert.ok(/\$\.data\.phone/.test(where('654', false)) && /identifier, ''\)\) LIKE @query/.test(where('654', false)))
    assert.ok(!/\$\.data\.phone/.test(where('654', true)))
    assert.ok(!/identifier, ''\)\) LIKE @query /.test(where('654', true)))
    assert.ok(/\$\.data\.phone/.test(where('dara', true)))
    assert.ok(/\$\.data\.phone/.test(where('654', undefined)), 'a caller that does not set the flag is unchanged')
  })
  return failures
}

const baseLoad = loader({ base: ['contactSearch', 'salesCustomerSearch'] })
const failures = run(loader(), { baseLoad })
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}
console.log('PASS phone search guard: classification, holder parity, no-oracle, whole-number search, audit and import review')

// ---- 4. mutants ------------------------------------------------------------------------------------------------------
const mutants = [
  ['whole number classified from the raw words, not the matcher words', { phoneSearchGuard: replaceOnce('const words = tokenizeSearchWords(rawSearch)', "const words = String(rawSearch ?? '').split(/\\s+/).filter(Boolean)") }],
  ['whole number compared by containment', { phoneSearchGuard: replaceOnce('return `${digitsSql}=@${key}`', 'return `instr(${digitsSql},@${key})>0`') }],
  ['digit run dropped', { contactSearch: replaceOnce('if (forms) {', 'if (false) {') }],
  ['digit run ignores the cache column', { contactSearch: replaceOnce('withKey ? `${runs} OR ${keys}` : runs', 'runs') }],
  ['digit run matches every row with a primary phone (containment test always true)', { phoneSearchGuard: replaceOnce('primary.push(`instr(${primaryDigits},@${key})>0`)', 'primary.push(`instr(${primaryDigits},@${key})>-1`)') }],
  ['whole number compared to a Contact Option phone by containment', { phoneSearchGuard: replaceOnce('return `${optionDigits}=@${key}`', 'return `instr(${optionDigits},@${key})>0`') }],
  ['non-ASCII digits are not folded', { phoneMask: replaceOnce('code > 0x7f && DECIMAL_DIGIT.test(char)', 'false') }],
  ['Reports > Sales search treats everyone as a holder', { phoneSearchGuard: replaceOnce('if (access.fullPhone) return (row) =>', 'if (true) return (row) =>') }],
  ['Reports > Sales search reads a cashier saved as a number', { phoneSearchGuard: replaceOnce('restrictedTextOf(key, row[key] || \'\').toLowerCase().includes(search)', 'text(row, key).includes(search)') }],
  ['Reports > Sales search compares the whole number by containment', { phoneSearchGuard: replaceOnce('probe.forms.includes(typed) || probe.forms.includes(phoneDigitsOf(text))', 'probe.forms.some((form) => typed.includes(form))') }],
  ['audit word guard ignores punctuation around digits', { phoneSearchGuard: replaceOnce('return !/\\p{L}/u.test(ascii) || /["{}[\\]:,\\\\]/.test(ascii)', 'return !/\\p{L}/u.test(ascii) && /^[+\\d().-]+$/.test(ascii)') }],
  ['whole number threshold 8 -> 3 digits', { phoneSearchGuard: replaceOnce('export const FULL_NUMBER_MIN_DIGITS = 8', 'export const FULL_NUMBER_MIN_DIGITS = 3') }],
  ['mixed text and digits counts as a whole number', { phoneSearchGuard: (source) => replaceOnce("const digits = toAsciiDigits(words.join(''))", "const digits = toAsciiDigits(words.join('')).replace(/\\D/g, '')")(replaceOnce('if (!words.every(isDigitWord)) return PARTIAL_PROBE', '')(source)) }],
  ['digit comparison drops the Contact Option phones', { phoneSearchGuard: replaceOnce('return { sql: `(${primary.sql} OR ${options})`', 'return { sql: `(${primary.sql})`') }],
  ['picker no longer shares the directory matcher', { salesCustomerSearch: replaceOnce("return buildContactMatchClause('customers', rawSearch, 'picker')", 'return undefined') }],
  ['a fragment of fewer than eight digits finds nobody (fragments closed again)', { contactSearch: replaceOnce('if (forms) {', 'if (forms && forms[0].length >= 8) {') }],
  ['the digit run reads the primary phone only', { phoneSearchGuard: replaceOnce("return { sql: `(${primary.join(' OR ')} OR ${optionExists})`, params }", "return { sql: `(${primary.join(' OR ')})`, params }") }],
  ['Reports > Sales search drops the customer name and phone', { phoneSearchGuard: replaceOnce('SALES_REPORT_CUSTOMER_KEYS.some((key) => text(row, key).includes(search))', 'false') }],
  ['audit log keeps matching phone text', { auditLogQuery: replaceOnce("if (figureOnly && !isMoneyShapedWord(word)) return '0'", '') }],
  ['audit log blocks money figures too', { auditLogQuery: replaceOnce("if (figureOnly && !isMoneyShapedWord(word)) return '0'", "if (figureOnly) return '0'") }],
  ['audit log money figure matches inside a longer number', { auditLogQuery: replaceOnce('...(figureOnly ? [wholeFigure(column, `@searchFigure${index}`)] : []),', '') }],
  ['audit log money figure not bounded on the dotted side', { auditLogQuery: replaceOnce("`'*' || ${figure} || '.[0-9]*'`, `'*[0-9].' || ${figure} || '*'`,", '') }],
  ['import review keeps matching the phone', { importReviewQuery: replaceOnce('!!filter.phoneTextBlocked && /\\p{Nd}/u.test(query)', 'false && /\\p{Nd}/u.test(query)') }],
]
let survivors = 0
for (const [name, mutate] of mutants) {
  const mutantFailures = run(loader({ mutate }), { baseLoad })
  if (!mutantFailures.length) { survivors += 1; console.error(`SURVIVED ${name}`) } else console.log(`killed  ${name} (${mutantFailures.length} failing checks)`)
}
if (survivors) process.exit(1)
console.log(`PASS ${mutants.length} mutants killed`)
