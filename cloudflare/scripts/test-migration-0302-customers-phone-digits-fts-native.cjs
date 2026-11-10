'use strict'
// Pins migration 0302 (customers_phone_digits_fts, the digits of every customer's phones) on the REAL migration chain:
//   - the file is LF-only, splits into whole statements with the splitter wrangler uses, holds no comment-only statement and no compound SELECT;
//   - the view is the digit rule of lib/phoneSearchGuard.ts (contactPhoneDigitsSql) written out: the same replace chain, read from the source, not copied;
//   - the backfill gives every customer one document and equals an independent JavaScript recomputation, including the primary phone, the cached key,
//     the first three Contact Options of a valid array, no-break spaces, Khmer digits, 00855, a malformed address and a scalar option;
//   - triggers keep it exact through insert, update of the phone, update of the address, update of the cached key, delete, and a save that changes none of
//     them writes nothing to the index (drift test);
//   - the PRE check aborts a second run, a search is an FTS SEARCH of customers, and the table is a rowid table;
//   - cost: the index rows one backfill over a production-sized table writes, and the rows one customer save writes (Miniflare's rows_written leaves the FTS shadow rows out, so the rows that changed are counted).
//
// Run (from cloudflare/): node scripts/test-migration-0302-customers-phone-digits-fts-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')
const { unstable_splitSqlQuery: split } = require('wrangler')

const root = path.resolve(__dirname, '..')
const directory = path.join(root, 'migrations')
const migration = '0302_customers_phone_digits_fts.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const previous = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const f of previous) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); return db }

const guard = { exports: {} }
new Function('module', 'exports', 'require', buildSync({ entryPoints: [path.join(root, 'src', 'lib', 'phoneSearchGuard.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' }).outputFiles[0].text)(guard, guard.exports, require)

let passed = 0
const check = async (name, run) => { await run(); passed += 1; console.log(`PASS ${name}`) }
const khmer = (text) => text.replace(/[០-៩]/g, (ch) => String(ch.charCodeAt(0) - 0x17e0))
const digitsOf = (value) => khmer(String(value ?? '')).replace(/[ \-().+\t\n\r ]/g, '')
const expectedDoc = (row) => {
  let options = []
  try { const parsed = JSON.parse(row.address); if (Array.isArray(parsed)) options = parsed.slice(0, 3).map((o) => (o && typeof o === 'object' && !Array.isArray(o) && typeof o.phone === 'string' ? digitsOf(o.phone) : '')) } catch { /* not JSON */ }
  return `${digitsOf(row.phone)} ${row.phone_normalized ?? ''} ${options.join(' ')}`
}
const khmerDigits = (text) => text.replace(/\d/g, (d) => String.fromCharCode(0x17e0 + Number(d)))

const fixtures = [
  [1, 'Plain', '012345678', '012345678', null],
  [2, 'Spaced', '012 345 678', '012345678', null],
  [3, 'Plus855', '+855 (12) 345-679', '012345679', null],
  [4, 'Nbsp', '012 333 555', null, null],
  [5, 'Khmer', khmerDigits('012 333 666'), null, null],
  [6, 'Double zero', '00855 12 345 690', null, null],
  [7, 'Options', '', null, JSON.stringify([{ label: 'A', phone: '012 777 888' }, { label: 'B', phone: '+855 12 999 000' }, { label: 'C', phone: '096 111 222' }, { label: 'D', phone: '097 000 111' }])],
  [8, 'Scalars', '098 000 111', '098000111', JSON.stringify(['012 333 444', 12333444, null, { phone: 12333444 }, { phone: '011 222 333' }])],
  [9, 'Not json', '099 000 111', '099000111', 'not JSON 012 333 444'],
  [10, 'Object address', '', null, JSON.stringify({ phone: '012 333 444' })],
  [11, 'Tab', '', null, JSON.stringify([{ phone: '012\t333\t999' }])],
  [12, 'Blank', null, null, null],
]
const insert = (db, rows) => { for (const [id, name, phone, normalized, address] of rows) db.prepare('INSERT INTO customers (id,name,phone,phone_normalized,address) VALUES (?,?,?,?,?)').run(id, name, phone, normalized, address) }
const index = (db) => Object.fromEntries(db.prepare('SELECT rowid AS id, digits FROM customers_phone_digits_fts ORDER BY rowid').all().map((r) => [r.id, r.digits]))
const wanted = (db) => Object.fromEntries(db.prepare('SELECT id, phone, phone_normalized, address FROM customers ORDER BY id').all().map((r) => [r.id, expectedDoc(r)]))
const found = (db, digits) => db.prepare('SELECT rowid AS id FROM customers_phone_digits_fts WHERE customers_phone_digits_fts MATCH ? ORDER BY rowid').all(`"${digits}"`).map((r) => r.id)

;(async () => {
  await check('the file is LF-only and splits into whole statements (no comment-only statement, no compound SELECT, every trigger closed)', () => {
    assert.equal(sql.includes('\r'), false)
    assert.equal(/[^\x00-\x7f]/.test(sql), false, 'ASCII only: the Khmer digits are written with char()')
    const statements = split(sql).filter((s) => s.trim())
    assert.ok(statements.length === 8)
    for (const statement of statements) {
      assert.ok(/^(SELECT|CREATE|INSERT)/.test(statement.trim().replace(/^(--[^\n]*\n\s*)+/, '')), `a statement that is only a comment: ${statement.slice(0, 60)}`)
      assert.equal((statement.match(/\bUNION\b/gi) || []).length, 0)
    }
    const triggers = statements.filter((s) => /CREATE TRIGGER/.test(s))
    assert.equal(triggers.length, 3)
    for (const trigger of triggers) assert.match(trigger.trim(), /\sEND;?$/)
    assert.equal(/WITHOUT ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  })

  await check('the view applies the digit rule of lib/phoneSearchGuard.ts to the primary phone and to each option phone', () => {
    const source = guard.exports.contactPhoneDigitsSql('X').replace(/'([០-៩])'/g, (_, ch) => `char(${ch.charCodeAt(0)})`)
    const rule = (value) => source.replace('X', value)
    const compact = (text) => text.replace(/\s+/g, ' ')
    assert.ok(compact(sql).includes(rule("COALESCE(c.phone,'')")), 'the primary phone is stripped by the guard rule')
    assert.ok(compact(sql).includes(`group_concat(${rule('option_phone')},' ')`), 'each option phone is stripped by the guard rule')
  })

  const db = chain()
  insert(db, fixtures)

  await check('the PRE check holds on the chain, the backfill gives every customer one document equal to an independent recomputation', () => {
    db.exec(sql)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM customers_phone_digits_fts').get().n, fixtures.length)
    assert.deepEqual(index(db), wanted(db))
    assert.equal(index(db)[7], '  012777888 85512999000 096111222')
  })

  await check('a number is found whatever separators, digit script or country prefix it was stored with', () => {
    assert.deepEqual(found(db, '345678'), [1, 2])
    assert.deepEqual(found(db, '12345679'), [3])
    assert.deepEqual(found(db, '85512345679'), [3])
    assert.deepEqual(found(db, '012333555'), [4])
    assert.deepEqual(found(db, '012333666'), [5])
    assert.deepEqual(found(db, '85512345690'), [6])
    assert.deepEqual(found(db, '012777888'), [7])
    assert.deepEqual(found(db, '85512999000'), [7], 'an option phone with +855 is read as digits (a typed 012 999 000 asks for this form too)')
    assert.deepEqual(found(db, '097000111'), [], 'the fourth Contact Option is not searched (CONTACT_OPTION_LIMIT)')
    assert.deepEqual(found(db, '011222333'), [], 'an option behind scalars is the fifth entry')
    assert.deepEqual(found(db, '012333444'), [], 'a scalar, a number, a bad address and an object address hold no Contact Option phone')
    assert.deepEqual(found(db, '012333999'), [11], 'the tab of a stored option phone is not part of the digits')
    assert.deepEqual(found(db, '0123'), [1, 2, 3, 4, 5, 11], 'the cached key holds the local form of a +855 number')
  })

  await check('drift test: insert, update of the phone, of the address and of the cached key, and delete leave the index equal to a recomputation', () => {
    db.prepare("INSERT INTO customers (id,name,phone,phone_normalized,address) VALUES (20,'New','070 121 232','070121232',?)").run(JSON.stringify([{ phone: '071 333 444' }]))
    assert.deepEqual(index(db), wanted(db))
    assert.deepEqual(found(db, '121232'), [20])
    db.prepare("UPDATE customers SET phone='070 999 222', phone_normalized='070999222' WHERE id=20").run()
    assert.deepEqual(index(db), wanted(db))
    assert.deepEqual(found(db, '121232'), [])
    assert.deepEqual(found(db, '999222'), [20])
    db.prepare('UPDATE customers SET address=? WHERE id=20').run(JSON.stringify([{ phone: '072 555 666' }, { phone: '073 777 888' }]))
    assert.deepEqual(index(db), wanted(db))
    assert.deepEqual(found(db, '333444'), [])
    assert.deepEqual(found(db, '073777888'), [20])
    db.prepare("UPDATE customers SET phone_normalized='070999223' WHERE id=20").run()
    db.prepare("UPDATE customers SET phone_normalized=NULL WHERE id=20").run()
    assert.deepEqual(index(db), wanted(db))
    db.prepare("UPDATE customers SET address='broken' WHERE id=20").run()
    assert.deepEqual(index(db), wanted(db))
    db.prepare('UPDATE customers SET id=21 WHERE id=20').run()
    assert.deepEqual(index(db), wanted(db), 'a changed id moves the document')
    assert.equal(index(db)[20], undefined)
    db.prepare('INSERT OR REPLACE INTO customers (id,name,phone) VALUES (21,?,?)').run('Replaced', '080 123 456')
    assert.deepEqual(index(db), wanted(db))
    db.prepare('DELETE FROM customers WHERE id IN (21, 1)').run()
    assert.deepEqual(index(db), wanted(db))
    assert.deepEqual(found(db, '080123456'), [])
    db.prepare('DELETE FROM customers').run()
    assert.deepEqual(index(db), {})
  })

  await check('a save that changes no phone, address or cached key leaves the document row untouched', () => {
    const fresh = chain()
    insert(fresh, fixtures)
    fresh.exec(sql)
    const before = fresh.prepare('SELECT id FROM customers_phone_digits_fts_docsize ORDER BY id').all().length
    fresh.exec("UPDATE customers SET name='Renamed', email='a@b.c' WHERE id=2")
    fresh.exec('UPDATE customers SET phone = phone, address = address, phone_normalized = phone_normalized WHERE id=2')
    assert.deepEqual(index(fresh), wanted(fresh))
    assert.equal(fresh.prepare('SELECT COUNT(*) AS n FROM customers_phone_digits_fts_docsize').get().n, before)
    const plan = (statement) => fresh.prepare(`EXPLAIN QUERY PLAN ${statement}`).all().map((r) => r.detail).join(' | ')
    assert.match(plan("UPDATE customers SET name='x' WHERE id=2"), /SEARCH customers/)
    assert.equal(/customers_phone_digits_fts/.test(plan("UPDATE customers SET name='x' WHERE id=2")), false)
  })

  await check('a second run aborts on the PRE check, and the search plan is an FTS lookup of customers by rowid, never a customer scan', () => {
    assert.throws(() => chain().exec(sql + '\n' + sql), /customers_phone_digits_0302_pre|malformed JSON path/)
    const fresh = chain()
    fresh.exec(sql)
    const plan = fresh.prepare('EXPLAIN QUERY PLAN SELECT * FROM customers WHERE id IN (SELECT rowid FROM customers_phone_digits_fts WHERE customers_phone_digits_fts MATCH ?)').all('"123"').map((r) => r.detail).join(' | ')
    assert.match(plan, /SEARCH customers USING INTEGER PRIMARY KEY/)
    assert.match(plan, /customers_phone_digits_fts VIRTUAL TABLE/)
    assert.doesNotMatch(plan, /SCAN customers\b/)
    assert.equal(fresh.prepare("SELECT sql FROM sqlite_master WHERE name='customers_phone_digits_fts'").get().sql.includes('WITHOUT ROWID'), false)
  })

  await check('cost: the one-time backfill and the rows one customer save writes to the index (the shadow rows D1 bills, counted as rows that changed)', () => {
    const sized = chain()
    const CUSTOMERS = 5000
    sized.exec('BEGIN')
    for (let i = 1; i <= CUSTOMERS; i++) {
      const local = `09${String(i * 7919 % 100000000).padStart(8, '0')}`
      const phone = i % 2 ? local.replace(/^(d{3})(d{3})(d+)$/, '$1 $2 $3') : local
      const address = i % 5 === 0 ? JSON.stringify([{ label: 'Home', phone: `01${String(i * 104729 % 10000000).padStart(7, '0')}` }]) : null
      sized.prepare('INSERT INTO customers (id,name,phone,phone_normalized,address) VALUES (?,?,?,?,?)').run(i, `Customer ${i}`, phone, local, address)
    }
    sized.exec('COMMIT')
    sized.exec(sql)
    const shadow = ['data', 'idx', 'docsize', 'content', 'config'].map((part) => `customers_phone_digits_fts_${part}`)
    const snapshot = () => { const rows = new Set(); for (const table of shadow) for (const row of sized.prepare(`SELECT * FROM ${table}`).all()) rows.add(table + JSON.stringify(Object.values(row).map((v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : v)))); return rows }
    const written = (run) => { const before = snapshot(); run(); const after = snapshot(); return Math.max([...after].filter((r) => !before.has(r)).length, [...before].filter((r) => !after.has(r)).length) }
    const backfillRows = snapshot().size
    const save = {
      insertWithOption: written(() => sized.exec("INSERT INTO customers (id,name,phone,phone_normalized,address) VALUES (9001,'New','012 345 678','012345678','[{\"phone\":\"096 111 222\"}]')")),
      insertPlain: written(() => sized.exec("INSERT INTO customers (id,name,phone,phone_normalized) VALUES (9002,'New','012345679','012345679')")),
      insertBare: written(() => sized.exec("INSERT INTO customers (id,name) VALUES (9003,'Bare')")),
      rename: written(() => sized.exec("UPDATE customers SET name='Renamed', phone=phone, address=address, phone_normalized=phone_normalized WHERE id=9001")),
      changePhone: written(() => sized.exec("UPDATE customers SET phone='012 345 000', phone_normalized='012345000' WHERE id=9001")),
      remove: written(() => sized.exec('DELETE FROM customers WHERE id=9001')),
    }
    console.log(`     backfill: ${CUSTOMERS} customers write ${backfillRows} index rows (${(backfillRows / CUSTOMERS).toFixed(2)} per customer), once`)
    console.log(`     index rows written by one save: ${Object.entries(save).map(([key, rows]) => `${key} ${rows}`).join(', ')}`)
    assert.ok(backfillRows <= CUSTOMERS * 2 + 500, `${backfillRows} index rows for ${CUSTOMERS} customers`)
    assert.equal(save.rename, 0, 'a save that changes no phone, address or cached key writes nothing to the index')
    for (const key of ['insertWithOption', 'insertPlain', 'changePhone', 'remove']) assert.ok(save[key] <= 10, `${key} wrote ${save[key]} index rows`)
  })

  console.log(`PASS migration 0302 (${passed} checks)`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
