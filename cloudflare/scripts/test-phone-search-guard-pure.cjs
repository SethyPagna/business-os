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
  customer.run(4, 'Fixture Visal', '+855 12 777 888', null, null, 'Visal Trading', 'LC-P28-4', '012777888')
  const supplier = db.prepare('INSERT INTO suppliers (id, name, phone, address, company, contact_person) VALUES (?, ?, ?, ?, ?, ?)')
  supplier.run(1, 'Fixture Supplies', '077 333 444', option('Office', '078 444 555', 'Street 3'), 'Fixture Co', 'Vanna')
  const delivery = db.prepare('INSERT INTO delivery_contacts (id, name, phone, area, address) VALUES (?, ?, ?, ?, ?)')
  delivery.run(1, 'Fixture Courier', '096 555 666', 'North', option('Depot', '095 666 777', null))
  return db
}

const QUERIES = [
  '', '   ', 'dara', 'Fixture', 'soph', 'LC-P28-1', 'lc p28 1', 'dara@example', 'visal trading', 'vanna', 'north', 'courier',
  '087', '0876', '087 654', '654', '321', '654321', '087654321', '087 654 321', '087-654-321', '(087) 654 321', '+855 87 654 321',
  '98 111', '111', '222', '111 111 111 111', '345 345 345', '0123 0123 0123', '12345678', '1234567', '0', '1',
  'dara 087', 'dara 087 654 321', '087 *** 321', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１', 'a1', 'p28', '28', 'x'.repeat(70), "o'brien", 'dara,sophea', '"', '%', '_',
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
    for (const q of ['dara', 'LC-P28-1', 'a1', '', 'visal trading', 'dara@example']) assert.equal(kind(q), q === 'LC-P28-1' ? 'partial' : 'none', `kind(${q})`)
    for (const q of ['087', '0876', '087 654', '654321', '1234567', '12345', '0', 'dara 087', 'dara 087 654 321', '087 *** 321']) assert.equal(kind(q), 'partial', `kind(${q})`)
    for (const q of ['087654321', '087 654 321', '087-654-321', '(087) 654 321', '+855 87 654 321', '12345678', '0123 0123 0123', '345 345 345', '០៨៧ ៦៥៤ ៣២១', '０８７６５４３２１']) assert.equal(kind(q), 'full', `kind(${q})`)
    assert.equal(kind('1234567890123456'), 'partial', '16 digits is not a phone number')
    assert.deepEqual(guard.phoneProbeOf('+855 87 654 321').forms.sort(), ['085587654321'.slice(1), '087654321'].sort())
    assert.deepEqual(guard.phoneProbeOf('087 654 321').forms.sort(), ['087654321', '85587654321'])
  })
  check('bare number words', () => {
    for (const word of ['654', '+855', '(087)', '087-654', '០៨៧']) assert.ok(guard.isBareNumberWord(word), word)
    for (const word of ['dara', 'RCP-1234', 'a1', '', '-', '087a']) assert.ok(!guard.isBareNumberWord(word), word)
  })

  // ---- 2. a holder searches exactly as before -----------------------------------------------------------------------
  check('holder: byte-equal to the base commit for every query and table', () => {
    const baseContact = baseLoad('contactSearch')
    const baseSales = baseLoad('salesCustomerSearch')
    for (const table of TABLES) for (const q of QUERIES) {
      assert.deepEqual(buildContactMatchClause(table, q, 'search', OPEN), baseContact.buildContactMatchClause(table, q, 'search'), `${table} ${JSON.stringify(q)}`)
    }
    for (const q of QUERIES) assert.deepEqual(buildSalesCustomerMatchClause(q, OPEN), baseSales.buildSalesCustomerMatchClause(q), `picker ${JSON.stringify(q)}`)
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
    assert.ok(/instr\(/.test(clause.sql))
  })

  // ---- the other search surfaces --------------------------------------------------------------------------------------
  check('audit log: a bare number never matches details / old_value / new_value without the grant', () => {
    const sqlOf = (search, phoneTextBlocked) => buildAuditLogFilters({ search, phoneTextBlocked }).where
    assert.ok(/details LIKE/.test(sqlOf('654', false)) && /old_value LIKE/.test(sqlOf('654', false)) && /new_value LIKE/.test(sqlOf('654', false)), 'a holder still searches the three text columns')
    const blocked = sqlOf('654', true)
    assert.ok(!/details LIKE|old_value LIKE|new_value LIKE/.test(blocked), blocked)
    assert.ok(/user_name LIKE/.test(blocked) && /CAST\(entity_id AS TEXT\) LIKE/.test(blocked), 'ids and users still match')
    assert.ok(/details LIKE/.test(sqlOf('dara', true)), 'a word still searches details')
    assert.ok(/details LIKE/.test(sqlOf('RCP-1234', true)), 'a receipt label still searches details')
    assert.ok(!/details LIKE/.test(sqlOf('087-654-321', true)))
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
  ['the two matches share parameter names', { contactSearch: replaceOnce('`${paramPrefix}_restricted`', 'paramPrefix') }],
  ['guard ignored (every account searches open)', { contactSearch: replaceOnce("access.fullPhone ? ({ kind: 'none' } as const) : phoneProbeOf(rawSearch)", "({ kind: 'none' } as const)") }],
  ['digit words search phone columns', { contactSearch: replaceOnce('if (digitWordsAvoidPhones && isDigitWord(word))', 'if (false && isDigitWord(word))') }],
  ['trigram table kept for digit words', { contactSearch: replaceOnce('&& !(digitWordsAvoidPhones && words.some(isDigitWord))', '') }],
  ['whole-number branch without the digit comparison', { contactSearch: replaceOnce('((${open.sql} AND ${exact.sql}) OR ${restricted.sql})', '((${open.sql}) OR ${restricted.sql})') }],
  ['whole number threshold 8 -> 3 digits', { phoneSearchGuard: replaceOnce('export const FULL_NUMBER_MIN_DIGITS = 8', 'export const FULL_NUMBER_MIN_DIGITS = 3') }],
  ['mixed text and digits counts as a whole number', { phoneSearchGuard: replaceOnce('if (!wholeQueryIsANumber || digits.length < FULL_NUMBER_MIN_DIGITS', 'if (digits.length < FULL_NUMBER_MIN_DIGITS') }],
  ['digit comparison drops the Contact Option phones', { phoneSearchGuard: replaceOnce('return { sql: `(${primary.sql} OR ${options})`', 'return { sql: `(${primary.sql})`') }],
  ['a number saved as a name is readable through a digit word', { contactSearch: replaceOnce("`(${wordMatch} AND NOT ${phoneShapedSql('name')})`", 'wordMatch') }],
  ['picker keeps the fragment alternatives', { salesCustomerSearch: replaceOnce('if (!access.fullPhone && digits.length < FULL_NUMBER_MIN_DIGITS) return original', '') }],
  ['audit log keeps matching phone text', { auditLogQuery: replaceOnce("if (input.phoneTextBlocked && REDACTABLE_TEXT_COLUMNS.has(column) && isBareNumberWord(word)) return '0'", '') }],
  ['import review keeps matching the phone', { importReviewQuery: replaceOnce('!!filter.phoneTextBlocked && /\\d/.test(query)', 'false && /\\d/.test(query)') }],
]
let survivors = 0
for (const [name, mutate] of mutants) {
  const mutantFailures = run(loader({ mutate }), { baseLoad })
  if (!mutantFailures.length) { survivors += 1; console.error(`SURVIVED ${name}`) } else console.log(`killed  ${name} (${mutantFailures.length} failing checks)`)
}
if (survivors) process.exit(1)
console.log(`PASS ${mutants.length} mutants killed`)
