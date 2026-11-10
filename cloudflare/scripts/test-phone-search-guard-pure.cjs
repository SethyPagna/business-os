'use strict'
// P2.8 (6.0.1046): search must not spell out a hidden phone number (lib/phoneSearchGuard.ts and its call sites).
//
// Real transpiled sources run against REAL SQLite FTS5 (better-sqlite3, migration 0020 applied verbatim), so a column filter
// the guard writes is parsed by the same engine family the Worker uses. Part 1 classifies a typed search. Part 2 pins the
// holder: byte-equal SQL and params to the base commit's contactSearch.ts / salesCustomerSearch.ts for every query in a
// table (nothing a holder had is lost). Part 3 is the oracle: an account without the grant gets NO row from a digit
// fragment of a hidden number (prefix, middle, suffix, option phone, repeated-word trick, +855, Khmer digits) and DOES get
// the customer from the whole number in each common format, while name, membership and e-mail searches are unchanged.
// Part 4 runs MUTANTS of the same sources through the same assertions: each must fail.
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
  const option = (label, phone, address) => JSON.stringify([{ label, name: label, phone, email: null, address, area: null }])
  const customer = db.prepare('INSERT INTO customers (id, name, phone, email, address, company, membership_number, phone_normalized) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  customer.run(1, 'Fixture Dara', '087 654 321', 'dara@example.test', option('Work', '098 111 222', 'Street 9'), null, 'LC-P28-1', '087654321')
  customer.run(2, 'Fixture Sophea', '089100200', null, null, null, 'LC-P28-2', '089100200')
  customer.run(3, '010 222 333', '010 222 333', null, null, null, 'LC-P28-3', '010222333')
  customer.run(5, 'Fixture Pairs', '12 34 56 78', null, null, null, 'LC-P28-5', '12345678')
  customer.run(6, 'Fixture Short', '1234567', null, null, null, 'LC-P28-6', '1234567')
  customer.run(7, 'Fixture Legacy', 'Tel099456789', null, null, null, 'LC-P28-7', '099456789')
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
  const ids = (table, query, access) => {
    const clause = buildContactMatchClause(table, query, 'search', access)
    if (!clause) return null
    return db.prepare(`SELECT id FROM ${table} WHERE ${clause.sql} ORDER BY id`).all(clause.params).map((row) => row.id)
  }
  const pickerIds = (query, access) => {
    const clause = buildSalesCustomerMatchClause(query, access)
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

  // ---- 2. a holder searches exactly as before -----------------------------------------------------------------------
  check('holder: byte-equal to the base commit for every query and table', () => {
    const baseContact = baseLoad('contactSearch')
    const baseSales = baseLoad('salesCustomerSearch')
    // A whole number in a form the word match cannot find (+855, 00855, another script) now also finds its contact for a holder: a superset.
    const sameOrMore = (label, table, q, lane, base) => {
      if (JSON.stringify(lane) === JSON.stringify(base)) return
      const probe = guard.phoneProbeOf(q)
      assert.ok((probe.kind === 'full' && !probe.plain) || guard.typedPhoneDigitForms(q) !== null || /[^\x00-\x7f]/.test(q), `${label}: only a typed number (whatever separators the stored phone has), or digits of another script, may differ from the base`)
      const run = (clause) => (clause ? db.prepare(`SELECT id FROM ${table} WHERE ${clause.sql} ORDER BY id`).all(clause.params).map((row) => row.id) : [])
      const laneIds = run(lane)
      assert.ok(run(base).every((id) => laneIds.includes(id)), `${label}: a holder loses nothing (${laneIds} vs ${run(base)})`)
    }
    for (const table of TABLES) for (const q of QUERIES) {
      sameOrMore(`${table} ${JSON.stringify(q)}`, table, q, buildContactMatchClause(table, q, 'search', OPEN), baseContact.buildContactMatchClause(table, q, 'search'))
    }
    for (const q of QUERIES) sameOrMore(`picker ${JSON.stringify(q)}`, 'customers', q, buildSalesCustomerMatchClause(q, OPEN), baseSales.buildSalesCustomerMatchClause(q))
  })
  check('holder: a number fragment still finds the contact', () => {
    assert.deepEqual(ids('customers', '087', OPEN), [1])
    assert.deepEqual(ids('customers', '654', OPEN), [1])
    assert.deepEqual(ids('customers', '111', OPEN), [1])
    assert.deepEqual(ids('suppliers', '444', OPEN), [1])
    assert.deepEqual(ids('delivery_contacts', '666', OPEN), [1])
    assert.deepEqual(pickerIds('0876', OPEN), [1])
    assert.deepEqual(pickerIds('876', OPEN), [1])
  })

  check('a typed number finds the contact whatever separators the stored phone has', () => {
    // 087 654 321 holds the run 7654 across its space, and +855 12 777 888 holds 012777888 only as digits: neither the word nor the trigram index can read them.
    for (const [q, expected] of [['7654', [1]], ['765432', [1]], ['0876 5432', [1]], ['12777', [4]], ['012 777 888', [4]], ['012777888', [4]]]) {
      assert.deepEqual(ids('customers', q, OPEN), expected, `holder: customers ${q}`)
      assert.deepEqual(pickerIds(q, OPEN), expected, `holder: picker ${q}`)
    }
    assert.deepEqual(ids('suppliers', '8444', OPEN), [1], 'holder: a run across the separators of a Contact Option phone')
    assert.deepEqual(ids('delivery_contacts', '5666', OPEN), [1], 'holder: a delivery contact')
    for (const q of ['087654321', '087-654-321']) assert.deepEqual(ids('customers', q, CLOSED), [1], `no grant: the whole compact number ${q} finds the customer`)
    for (const q of ['012777888', '+855 12 777 888', '85512777888']) assert.deepEqual(ids('customers', q, CLOSED), [4], `no grant: the whole number ${q} finds the +855 customer`)
    for (const q of ['7654', '765432', '12777']) assert.deepEqual(ids('customers', q, CLOSED), [], `no grant: the fragment ${q} still finds nobody`)
    db.prepare("INSERT INTO customers (id, name, phone, phone_normalized) VALUES (90, 'Cache Only', 'ask at the shop', '011222333')").run()
    assert.deepEqual(ids('customers', '011222333', OPEN), [90], 'holder: the cache column finds a customer whose phone text holds no digits')
    assert.deepEqual(ids('customers', '011222333', CLOSED), [90], 'no grant: the whole number finds it through the cache column')
    db.prepare('DELETE FROM customers WHERE id = 90').run()
  })

  // ---- 3. an account without the grant: no oracle, still finds the customer by the whole number -----------------------
  check('no grant: a digit fragment finds nothing through a phone column', () => {
    const fragments = ['087', '0876', '087 654', '654', '321', '654321', '98 111', '111', '222', '111 111 111 111', '654 654 654', '0123 0123 0123', '345 345 345', '1 2 3 4 5 6 7']
    for (const q of fragments) {
      for (const table of TABLES) assert.deepEqual(ids(table, q, CLOSED), [], `${table} ${JSON.stringify(q)}`)
      assert.deepEqual(pickerIds(q, CLOSED), [], `picker ${JSON.stringify(q)}`)
    }
    for (const [table, q] of [['suppliers', '333'], ['suppliers', '444 555'], ['suppliers', '078'], ['delivery_contacts', '555'], ['delivery_contacts', '095'], ['delivery_contacts', '666 777']]) assert.deepEqual(ids(table, q, CLOSED), [], `${table} ${q}`)
  })
  check('no grant: the whole number in a common format finds the customer', () => {
    for (const q of ['087 654 321', '(087) 654 321']) assert.deepEqual(ids('customers', q, CLOSED), [1], `customers ${q}`)
    // The directory list never found a compact number typed against a spaced one (a holder neither); the picker does.
    for (const q of ['087654321', '087-654-321']) assert.deepEqual(ids('customers', q, CLOSED), ids('customers', q, OPEN), `customers ${q} behaves as for a holder`)
    for (const q of ['087654321', '087 654 321', '087-654-321', '(087) 654 321']) assert.deepEqual(pickerIds(q, CLOSED), [1], `picker ${q}`)
    for (const q of ['+855 87 654 321', '85587654321']) assert.deepEqual(pickerIds(q, CLOSED), [1], `picker ${q}`)
    assert.deepEqual(ids('customers', '098 111 222', CLOSED), [1], 'a Contact Option number finds its customer')
    assert.deepEqual(ids('customers', '089100200', CLOSED), [2])
    assert.deepEqual(ids('customers', '010 222 333', CLOSED), [3])
    assert.deepEqual(ids('suppliers', '077 333 444', CLOSED), [1])
    // The supplier index has no address column, so a supplier's Contact Option number is not searchable for anyone (as before).
    assert.deepEqual(ids('suppliers', '078 444 555', CLOSED), ids('suppliers', '078 444 555', OPEN))
    assert.deepEqual(ids('delivery_contacts', '096 555 666', CLOSED), [1])
    assert.deepEqual(ids('delivery_contacts', '095-666-777', CLOSED), [1])
  })
  check('no grant: a whole number written in short groups finds its customer (the open word match is kept)', () => {
    assert.deepEqual(ids('customers', '12 34 56 78', OPEN), [5])
    assert.deepEqual(ids('customers', '12 34 56 78', CLOSED), [5])
    assert.deepEqual(ids('customers', '12 34 56', CLOSED), [], 'a fragment of it is still a probe')
  })
  check('no grant: a near-miss whole number finds nobody (compared as one string)', () => {
    for (const q of ['087 654 322', '087 654 320', '087 655 321', '187 654 321']) {
      assert.deepEqual(ids('customers', q, CLOSED), [], q)
      assert.deepEqual(pickerIds(q, CLOSED), [], q)
    }
  })
  check('no grant: names, membership numbers, e-mail and company search as before', () => {
    for (const [table, q] of [['customers', 'dara'], ['customers', 'soph'], ['customers', 'dara@example'], ['customers', 'visal trading'], ['suppliers', 'vanna'], ['suppliers', 'fixture co'], ['delivery_contacts', 'north'], ['delivery_contacts', 'courier']]) {
      assert.deepEqual(ids(table, q, CLOSED), ids(table, q, OPEN), `${table} ${q}`)
      assert.ok((ids(table, q, CLOSED) || []).length >= 1, `${table} ${q} finds something`)
    }
    // The digit in a membership number is a digit word: it reads the membership column, not the phone tokens a holder's search also hits.
    assert.deepEqual(ids('customers', 'LC-P28-1', CLOSED), [1], 'a membership number made of digits and letters still finds its customer')
    assert.deepEqual(ids('customers', 'lc p28 2', CLOSED), [2])
    assert.ok(ids('customers', 'LC-P28-1', OPEN).length > 1, 'positive control: the open search also matches the phone tokens that begin with 1')
    assert.deepEqual(pickerIds('dara', CLOSED), pickerIds('dara', OPEN))
  })
  check('no grant: a name that is itself a number is not a way to read that number', () => {
    assert.deepEqual(ids('customers', '010 222 333', CLOSED), [3], 'found as a whole number (its phone is the same number)')
    for (const q of ['010', '222', '333', '222 333', '0102 2']) assert.deepEqual(ids('customers', q, CLOSED), [], q)
    assert.ok(ids('customers', '222', OPEN).includes(3), 'positive control: the open search reads the numeric name')
  })
  check('no grant: a supplier whose contact person is a number is not a way to read that number (review B3)', () => {
    for (const q of ['252', '812', '097 252', '0972528', '252 812', '097 252 812']) assert.deepEqual(ids('suppliers', q, CLOSED), [], `suppliers ${JSON.stringify(q)}`)
    assert.ok(ids('suppliers', '252', OPEN).includes(2), 'positive control: the open search reads the contact person')
    assert.deepEqual(ids('suppliers', 'noted', CLOSED), [2], 'a word of the name still finds the supplier')
  })
  check('no grant: mixed text and digits never reaches a phone column', () => {
    assert.deepEqual(ids('customers', 'dara 087', CLOSED), [])
    assert.deepEqual(ids('customers', 'dara 087 654 321', CLOSED), [])
    assert.deepEqual(ids('customers', 'dara 111', CLOSED), [])
  })
  check('no grant: SQL never references the phone-only trigram table for a digit word', () => {
    for (const table of TABLES) for (const q of ['087', '654 321', '087 654 321', 'dara 087']) {
      const clause = buildContactMatchClause(table, q, 'search', CLOSED)
      assert.ok(clause && !/_fts_phone/.test(clause.sql) || /_fts_phone/.test(clause.sql) && guard.phoneProbeOf(q).kind === 'full', `${table} ${q}: ${clause && clause.sql}`)
    }
  })
  check('no grant: the whole-number branch compares ONE digit string (the repeated-word trick fails)', () => {
    const clause = buildContactMatchClause('customers', '654 654 654', 'search', CLOSED)
    assert.ok(clause.params.search_digits_0 === '654654654', JSON.stringify(clause.params))
    // The only instr() an equality clause may hold is the address prefilter: a stripped-address text test that runs before the Contact Option equality.
    const withoutPrefilter = clause.sql.replace(/instr\([^@]*?\\t[^@]*?,@search_digits_o\d+\)>0/g, 'PREFILTER')
    assert.ok(/=@search_digits_0/.test(clause.sql) && !/instr\(/.test(withoutPrefilter), 'equality, never containment')
  })
  check('no grant: a digit fragment disguised from the raw text is still a fragment (the matcher reads accents away and a letter o as a zero)', () => {
    const disguised = ['0891\u0301', '089\u03001', '0891\u200D', 'o8910', 'O8910', 'dara 0891\u0301', '089 1\u0301', '٠٨٩١', '０８９１', '0\u0301891']
    for (const q of disguised) {
      assert.equal(guard.phoneProbeOf(q).kind, 'partial', `kind(${JSON.stringify(q)}) is decided on the words the matcher searches`)
      for (const table of TABLES) assert.deepEqual(ids(table, q, CLOSED), [], `${table} ${JSON.stringify(q)}`)
      assert.deepEqual(pickerIds(q, CLOSED), [], `picker ${JSON.stringify(q)}`)
    }
    assert.deepEqual(ids('customers', '0891', OPEN), [2], 'positive control: a holder finds customer 2 by the plain fragment')
    for (const [disguise, plain] of [['0891\u0301', '0891'], ['o8910', '08910'], ['0891\u200D', '0891']]) {
      assert.deepEqual(ids('customers', disguise, OPEN), ids('customers', plain, OPEN), `a holder reads ${JSON.stringify(disguise)} as the plain digits`)
    }
  })
  check('no grant: a digit fragment glued to a combining mark, a variation selector, an enclosing mark or a letter is still a fragment', () => {
    // The FTS tokenizer (unicode61) drops these marks, so "654" + U+FE0F finds what "654" finds; each is a word that holds a digit.
    const MARKS = [0xfe0f, 0xfe00, 0x1dc0, 0x20d0, 0xfe20, 0xe31, 0x17c9, 0x20e3, 0x483, 0x5b0, 0x610, 0x93c, 0x301, 0x34f, 0x1ab0].map((cp) => String.fromCodePoint(cp))
    const FRAGMENTS = [['customers', '654'], ['customers', '0891'], ['customers', '098 111'], ['suppliers', '333'], ['suppliers', '077'], ['delivery_contacts', '555'], ['delivery_contacts', '096']]
    for (const [table, plain] of FRAGMENTS) {
      assert.ok(ids(table, plain, OPEN).length >= 1, `positive control: a holder finds ${table} by ${plain}`)
      for (const mark of MARKS) {
        for (const q of [plain + mark, plain.slice(0, 1) + mark + plain.slice(1), 'x ' + plain + mark]) {
          assert.deepEqual(ids(table, q, CLOSED), [], `${table} ${JSON.stringify(q)}`)
        }
      }
    }
    for (const mark of MARKS) {
      assert.deepEqual(pickerIds('654' + mark, CLOSED), [], `picker 654 + U+${mark.codePointAt(0).toString(16)}`)
      assert.deepEqual(pickerIds('0891' + mark, CLOSED), [])
    }
    for (const q of ['tel0994', 'tel09945', 'tel099456789', 'tel 0994', 'TEL0994', 'dara tel0994']) {
      assert.deepEqual(ids('customers', q, CLOSED), [], `legacy phone glued to letters: ${q}`)
      assert.deepEqual(pickerIds(q, CLOSED), [], `picker ${q}`)
    }
    assert.deepEqual(ids('customers', 'tel0994', OPEN), [7], 'positive control: a holder finds the legacy "Tel099456789" by the prefix')
    assert.deepEqual(ids('customers', 'tel099456789', OPEN), [7])
  })
  check('no grant: the whole number is EQUAL to the phone, never contained in it (an 8-digit tail names nobody)', () => {
    for (const q of ['87654321', '+87654321', '08765432', '(87654321)']) {
      assert.deepEqual(ids('customers', q, CLOSED), [], `customers ${q}`)
      assert.deepEqual(pickerIds(q, CLOSED), [], `picker ${q}`)
    }
    assert.deepEqual(pickerIds('87654321', OPEN), [1], 'positive control: a holder keeps the containment match of the picker')
  })
  check('every account finds a whole number written +855, 00855, in Khmer digits or in full-width digits (a holder too)', () => {
    for (const q of ['00855 87 654 321', '0085587654321', '+៨៥៥ ៨៧ ៦៥៤ ៣២១', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１', '+855 87 654 321', '855 87 654 321']) {
      for (const [label, access] of [['holder', OPEN], ['no grant', CLOSED]]) {
        assert.deepEqual(ids('customers', q, access), [1], `customers ${label} ${q}`)
        assert.deepEqual(pickerIds(q, access), [1], `picker ${label} ${q}`)
      }
    }
    assert.deepEqual(ids('suppliers', '00855 77 333 444', CLOSED), [1])
    assert.deepEqual(ids('delivery_contacts', '+៨៥៥ ៩៦ ៥៥៥ ៦៦៦', OPEN), [1])
  })
  check('Reports > Sales search: a holder matches the phone by substring; without the grant only a whole number matches', () => {
    const rows = [
      { id: 1, receipt_number: 'P28-0001', customer: 'Fixture Dara', customer_phone: '087 654 321', cashier: 'Za', branch: 'Shop', payment_method: 'Cash' },
      { id: 2, receipt_number: 'P28-0002', customer: '010 222 333', customer_phone: '010 222 333', cashier: 'Za', branch: 'Shop', payment_method: 'Cash' },
      { id: 3, receipt_number: 'P28-0003', customer: 'Fixture Sophea', customer_phone: '+855 89 100 200', cashier: 'Za', branch: 'Shop', payment_method: 'ABA' },
    ]
    const found = (search, access) => rows.filter(guard.salesReportSearchMatcher(search.trim().toLowerCase(), access)).map((row) => row.id)
    for (const q of ['654', '65', '8765', '087', '321', '054 3', '222', '010 2', '0102', '910', '100 200', '089 1']) {
      assert.deepEqual(found(q, CLOSED), [], `no grant: fragment ${JSON.stringify(q)}`)
    }
    for (const [q, expected] of [['087 654 321', [1]], ['087654321', [1]], ['+855 87 654 321', [1]], ['0085587654321', [1]], ['០៨៧ ៦៥៤ ៣២១', [1]], ['010 222 333', [2]], ['010222333', [2]], ['089100200', [3]], ['dara', [1]], ['P28-0001', [1]], ['za', [1, 2, 3]], ['aba', [3]], ['', [1, 2, 3]]]) {
      assert.deepEqual(found(q, CLOSED), expected, `no grant: ${JSON.stringify(q)}`)
    }
    for (const q of ['087 654 322', '87654321', '0102223333']) assert.deepEqual(found(q, CLOSED), [], `no grant: near miss ${q}`)
    assert.deepEqual(found('654', OPEN), [1], 'positive control: a holder matches the phone by substring')
    assert.deepEqual(found('222', OPEN), [2])
    assert.deepEqual(found('0085587654321', OPEN), [1], 'a holder finds a whole number in any form too')
    assert.deepEqual(found('dara', OPEN), found('dara', CLOSED))
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
  ['guard ignored (every account searches open)', { contactSearch: replaceOnce('if (access.fullPhone) {', 'if (true) {') }],
  ['digit words restricted only when the raw text is all digits (the disguised-search bypass)', { contactSearch: replaceOnce('`${paramPrefix}_restricted`, true)', "`${paramPrefix}_restricted`, /^[\\d\\s+().-]+$/.test(String(rawSearch ?? '')))") }],
  ['whole number classified from the raw words, not the matcher words', { phoneSearchGuard: replaceOnce('const words = tokenizeSearchWords(rawSearch)', "const words = String(rawSearch ?? '').split(/\\s+/).filter(Boolean)") }],
  ['whole number compared by containment', { phoneSearchGuard: replaceOnce('return `${digitsSql}=@${key}`', 'return `instr(${digitsSql},@${key})>0`') }],
  ['holder digit run dropped', { contactSearch: replaceOnce('if (forms) {', 'if (false) {') }],
  ['holder digit run read by the no-grant account too', { contactSearch: replaceOnce('if (access.fullPhone) {', 'if (true || access.fullPhone) {') }],
  ['holder digit run ignores the cache column', { contactSearch: replaceOnce("table === 'customers' ? 'phone_normalized' : undefined", 'undefined') }],
  ['no-grant whole number compared by containment', { phoneSearchGuard: replaceOnce('primary.push(`instr(${primaryDigits},@${key})>0`)', 'primary.push(`instr(${primaryDigits},@${key})>-1`)') }],
  ['non-ASCII digits are not folded', { phoneMask: replaceOnce('code > 0x7f && DECIMAL_DIGIT.test(char)', 'false') }],
  ['Reports > Sales search treats everyone as a holder', { phoneSearchGuard: replaceOnce('if (access.fullPhone) return (row) =>', 'if (true) return (row) =>') }],
  ['Reports > Sales search reads a numeric customer name', { phoneSearchGuard: replaceOnce('restrictedTextOf(key, row[key] || \'\').toLowerCase().includes(search)', 'text(row, key).includes(search)') }],
  ['Reports > Sales search compares the whole number by containment', { phoneSearchGuard: replaceOnce('probe.forms.includes(typed) || probe.forms.includes(phoneDigitsOf(text))', 'probe.forms.some((form) => typed.includes(form))') }],
  ['audit word guard ignores punctuation around digits', { phoneSearchGuard: replaceOnce('return !/\\p{L}/u.test(ascii) || /["{}[\\]:,\\\\]/.test(ascii)', 'return !/\\p{L}/u.test(ascii) && /^[+\\d().-]+$/.test(ascii)') }],
  ['digit words search phone columns', { contactSearch: replaceOnce('if (digitWordsAvoidPhones && hasDigit(word))', 'if (false && hasDigit(word))') }],
  ['only an all-digit word is restricted (a mark or a letter glued to the digits escapes)', { contactSearch: replaceOnce('if (digitWordsAvoidPhones && hasDigit(word))', 'if (digitWordsAvoidPhones && /^[0-9]+$/.test(word))') }],
  ['trigram table kept for digit words', { contactSearch: replaceOnce('&& !(digitWordsAvoidPhones && words.some(hasDigit))', '') }],
  ['no-grant whole number narrowed by the separator-sensitive word match again', { contactSearch: replaceOnce('let whole = exact.sql', 'let whole = open ? `(${open.sql} AND ${exact.sql})` : exact.sql') }],
  ['whole number threshold 8 -> 3 digits', { phoneSearchGuard: replaceOnce('export const FULL_NUMBER_MIN_DIGITS = 8', 'export const FULL_NUMBER_MIN_DIGITS = 3') }],
  ['mixed text and digits counts as a whole number', { phoneSearchGuard: (source) => replaceOnce("const digits = toAsciiDigits(words.join(''))", "const digits = toAsciiDigits(words.join('')).replace(/\\D/g, '')")(replaceOnce('if (!words.every(isDigitWord)) return PARTIAL_PROBE', '')(source)) }],
  ['digit comparison drops the Contact Option phones', { phoneSearchGuard: replaceOnce('return { sql: `(${primary.sql} OR ${options})`', 'return { sql: `(${primary.sql})`') }],
  ['a number saved as a name is readable through a digit word', { contactSearch: replaceOnce("`(${wordMatch} AND ${PERSON_COLUMNS[table].map((column) => `NOT ${phoneShapedSql(column)}`).join(' AND ')})`", 'wordMatch') }],
  ['a supplier contact person saved as a number is readable through a digit word', { contactSearch: replaceOnce("suppliers: ['name', 'contact_person'],", "suppliers: ['name'],") }],
  ['picker no longer shares the directory matcher', { salesCustomerSearch: replaceOnce("'picker', access)", "'picker', { fullPhone: true })") }],
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
