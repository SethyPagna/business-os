// Real-SQLite (not mocked) test of the customers_fts/suppliers_fts/
// delivery_contacts_fts (+ their _phone trigram siblings) search path
// added by migrations/0020_contacts_fts.sql and lib/contactSearch.ts's
// buildContactMatchClause -- same rigor as scripts/test-search-fts-pure.cjs
// applies to the product-side FTS5 tables: applies the real migration
// files verbatim against an in-memory better-sqlite3 database (same FTS5
// build D1 runs on), builds the exact MATCH expressions
// buildContactMatchClause produces, and runs them for real.
//
// Run: node scripts/test-contacts-fts-pure.cjs
// Requires better-sqlite3 (installed --no-save, same test-only tool
// test-search-fts-pure.cjs already uses).

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function loadModule(relPath) {
  const filePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(filePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: `${relPath}-pure.ts`,
  })
  const moduleObj = { exports: {} }
  const req = (spec) => {
    if (spec === './searchMatch') return loadModule('lib/searchMatch.ts')
    throw new Error(`unexpected require in test harness: ${spec}`)
  }
  new Function('exports', 'require', outputText)(moduleObj.exports, req)
  return moduleObj.exports
}

const { buildContactMatchClause } = loadModule('lib/contactSearch.ts')

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

// --- schema: apply the real migration file verbatim ---------------------

function freshDb() {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE customers (
    id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, address TEXT,
    company TEXT, notes TEXT, membership_number TEXT, gender TEXT,
    created_at TEXT, updated_at TEXT
  )`)
  db.exec(`CREATE TABLE suppliers (
    id INTEGER PRIMARY KEY, name TEXT, phone TEXT, email TEXT, address TEXT,
    company TEXT, contact_person TEXT, notes TEXT, created_at TEXT, updated_at TEXT
  )`)
  db.exec(`CREATE TABLE delivery_contacts (
    id INTEGER PRIMARY KEY, name TEXT, phone TEXT, area TEXT, address TEXT,
    notes TEXT, created_at TEXT, updated_at TEXT
  )`)
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0020_contacts_fts.sql'), 'utf8')
  db.exec(migration)
  return db
}

function insertCustomer(db, row) {
  db.prepare(`INSERT INTO customers (id, name, phone, email, address, company, membership_number)
    VALUES (@id, @name, @phone, @email, @address, @company, @membership_number)`).run({
    phone: null, email: null, address: null, company: null, membership_number: null,
    ...row,
  })
}

function insertSupplier(db, row) {
  db.prepare(`INSERT INTO suppliers (id, name, phone, email, address, company, contact_person)
    VALUES (@id, @name, @phone, @email, @address, @company, @contact_person)`).run({
    phone: null, email: null, address: null, company: null, contact_person: null,
    ...row,
  })
}

function insertDelivery(db, row) {
  db.prepare(`INSERT INTO delivery_contacts (id, name, phone, area, address)
    VALUES (@id, @name, @phone, @area, @address)`).run({
    phone: null, area: null, address: null,
    ...row,
  })
}

function searchIds(db, table, rawSearch) {
  const clause = buildContactMatchClause(table, rawSearch, 'search')
  if (!clause) return null
  const rows = db.prepare(`SELECT id FROM ${table} WHERE ${clause.sql} ORDER BY id`).all(clause.params)
  return rows.map((r) => r.id)
}

// --- 1. name/company prefix matching (unicode61) -------------------------

check('customer name word-prefix match', () => {
  const db = freshDb()
  insertCustomer(db, { id: 1, name: 'Sophea Chan' })
  insertCustomer(db, { id: 2, name: 'Dara Kim' })
  assert.deepStrictEqual(searchIds(db, 'customers', 'soph'), [1])
  assert.deepStrictEqual(searchIds(db, 'customers', 'chan'), [1])
})

check('supplier company + contact_person searchable', () => {
  const db = freshDb()
  insertSupplier(db, { id: 1, name: 'Glow Trading Co', contact_person: 'Bopha' })
  insertSupplier(db, { id: 2, name: 'Other Supplier' })
  assert.deepStrictEqual(searchIds(db, 'suppliers', 'bopha'), [1])
  assert.deepStrictEqual(searchIds(db, 'suppliers', 'glow'), [1])
})

// --- 2. phone-fragment substring matching (trigram), the direct parallel
// to the barcode "012" case products_fts_code was built for ---------------

check('customer phone middle-fragment substring match (trigram)', () => {
  const db = freshDb()
  insertCustomer(db, { id: 1, name: 'A', phone: '012-345-5678' })
  insertCustomer(db, { id: 2, name: 'B', phone: '099-111-2222' })
  // "5678" sits at the END of the token but not as a word-prefix of
  // "012-345-5678" as FTS5's own tokenizer would see it (unicode61 splits
  // on '-', so this one actually also works via the word table -- use a
  // truly MID-token fragment instead, same shape as the barcode case).
  assert.deepStrictEqual(searchIds(db, 'customers', '345'), [1])
})

check('supplier phone fragment matches only via trigram, not word table', () => {
  const db = freshDb()
  insertSupplier(db, { id: 1, name: 'X', phone: '0123456789' })
  insertSupplier(db, { id: 2, name: 'Y', phone: '0987654321' })
  // one unbroken digit token -- "345" is genuinely mid-token here.
  assert.deepStrictEqual(searchIds(db, 'suppliers', '345'), [1])
})

// --- 3. customer secondary phone/name embedded in the Contact Options
// JSON stored in `address` -- the exact regression risk the migration's
// own comment flags (LIKE used to substring-match this for free) ---------

check('customer secondary phone inside Contact Options JSON address matches', () => {
  const db = freshDb()
  const optionsJson = JSON.stringify([{ label: 'Home', phone: '0987776543' }])
  insertCustomer(db, { id: 1, name: 'Primary Name', phone: '012-000-0000', address: optionsJson })
  insertCustomer(db, { id: 2, name: 'Other', phone: '011-111-1111' })
  // "7776" is a mid-token fragment of the SECONDARY phone (dash-free, as
  // this app's contact-options phone entries are actually stored), not
  // the primary one, and not a word-prefix of anything -- only reachable
  // via the trigram table's inclusion of `address`.
  assert.deepStrictEqual(searchIds(db, 'customers', '7776'), [1])
})

// --- 4. delivery_contacts' `area` column stays searchable -----------------

check('delivery contact area field searchable', () => {
  const db = freshDb()
  insertDelivery(db, { id: 1, name: 'Driver A', area: 'Toul Kork' })
  insertDelivery(db, { id: 2, name: 'Driver B', area: 'Chamkarmon' })
  assert.deepStrictEqual(searchIds(db, 'delivery_contacts', 'toul'), [1])
})

// --- 5. empty/short-word edge cases ---------------------------------------

check('empty search returns no clause (caller shows all rows)', () => {
  const db = freshDb()
  assert.strictEqual(searchIds(db, 'customers', ''), null)
  assert.strictEqual(searchIds(db, 'customers', '   '), null)
})

check('short (<3 char) word still matches via word table even though trigram is skipped', () => {
  const db = freshDb()
  insertCustomer(db, { id: 1, name: 'Bo' })
  insertCustomer(db, { id: 2, name: 'Sophea' })
  // "bo" is 2 chars -- word-prefix still finds it; the trigram half of
  // the OR is simply not attached for this query (no crash, no error).
  assert.deepStrictEqual(searchIds(db, 'customers', 'bo'), [1])
})

console.log(`\n${passed} checks passed`)
