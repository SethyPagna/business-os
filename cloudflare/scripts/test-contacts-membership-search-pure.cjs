'use strict'
// A membership number typed without its hyphen (lc20, lc00020) found nobody: the word index holds the tokens lc and 00020, so only LC-00020 and
// LC matched. buildContactMatchClause now also looks the number up by equality on lower(trim(membership_number)), the expression migration 0122
// indexes. The real source runs against real SQLite with every migration applied (FTS5, the contact triggers, the index).
//
// Run (from cloudflare/): node scripts/test-contacts-membership-search-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildSync } = require('esbuild')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const bundle = buildSync({ entryPoints: [path.join(root, 'src', 'lib', 'contactSearch.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' }).outputFiles[0].text
const mod = { exports: {} }
new Function('module', 'exports', 'require', bundle)(mod, mod.exports, require)
const { buildContactMatchClause } = mod.exports

const db = new Database(':memory:')
for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
const insert = db.prepare('INSERT INTO customers (id, name, phone, membership_number, is_anonymous) VALUES (?, ?, ?, ?, 0)')
for (let i = 1; i <= 400; i++) insert.run(i, i === 20 ? 'Dara Twenty' : 'Filler Person', '', i === 20 ? 'LC-00020' : i === 2 ? 'LC-00002' : i === 200 ? 'LC-00200' : `LC-${String(i + 5000).padStart(5, '0')}`)
insert.run(401, 'Handmade', '', 'lc-21')
insert.run(402, 'Past width', '', 'LC-100000')
insert.run(403, 'Spaced', '', '  LC-00030 ')
insert.run(404, 'Vanity', '', 'LCMN-77')

const HOLDER = { fullPhone: true }
const NO_GRANT = { fullPhone: false }
const where = (clause) => `SELECT id FROM customers WHERE COALESCE(is_anonymous, 0) = 0 AND ${clause.sql} ORDER BY id`
const idsOf = (search, access) => {
  const clause = buildContactMatchClause('customers', search, 'search', access)
  return db.prepare(where(clause)).all(clause.params).map((row) => row.id)
}
const planOf = (search, access) => {
  const clause = buildContactMatchClause('customers', search, 'search', access)
  return db.prepare('EXPLAIN QUERY PLAN ' + where(clause)).all(clause.params).map((row) => row.detail).join(' / ')
}

let failed = 0
const check = (name, fn) => { try { fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log('FAIL ' + name + '\n' + (error && error.stack || error)) } }

check('lc20, lc00020, LC-00020 and lc-20 find that member, for a holder and an account without the phone grant', () => {
  for (const access of [HOLDER, NO_GRANT]) {
    for (const search of ['lc20', 'lc00020', 'LC-00020', 'lc-20', 'LC20', ' lc 20'.trim().replace(' ', ''), 'lc-00020']) assert.deepEqual(idsOf(search, access), [20], `${search} ${JSON.stringify(access)}`)
  }
})

check('a hand-typed unpadded or past-width number is found; a padded stored value with spaces is found', () => {
  assert.deepEqual(idsOf('lc21', HOLDER), [401])
  assert.deepEqual(idsOf('lc-21', NO_GRANT), [401])
  assert.deepEqual(idsOf('lc100000', HOLDER), [402])
  assert.deepEqual(idsOf('lc30', HOLDER), [403])
})

check('it is an exact match on the number: lc2 does not find LC-00020 or LC-00200, and no number is no match', () => {
  assert.deepEqual(idsOf('lc2', HOLDER), [2])
  assert.deepEqual(idsOf('lc999', HOLDER), [])
  assert.deepEqual(idsOf('lc0', HOLDER), [])
  assert.deepEqual(idsOf('lc20 dara', HOLDER), [], 'a number with another word is a plain text search')
})

check('every other search keeps its SQL: names, the bare prefix and a bare number get no membership term', () => {
  for (const search of ['dara', 'Dara Twenty', 'lc', 'lc-', '00020', '020', 'lcmn', 'lc20a', 'filler person']) {
    for (const access of [HOLDER, NO_GRANT]) {
      const clause = buildContactMatchClause('customers', search, 'search', access)
      assert.ok(!clause || !/membership_number\)/.test(clause.sql), `${search}: ${clause && clause.sql}`)
    }
  }
  assert.equal(buildContactMatchClause('suppliers', 'lc20', 'search', HOLDER).sql.includes('membership_number)'), false)
  assert.equal(buildContactMatchClause('delivery_contacts', 'lc20', 'search', HOLDER).sql.includes('membership_number)'), false)
})

check('the lookup is an index seek on idx_customers_membership_normalized, alone and inside the whole search clause', () => {
  const alone = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM customers WHERE lower(trim(membership_number)) IN (@a, @b)").all({ a: 'lc-00020', b: 'lc-20' }).map((row) => row.detail).join(' / ')
  assert.match(alone, /SEARCH customers USING (COVERING )?INDEX idx_customers_membership_normalized/)
  for (const access of [HOLDER, NO_GRANT]) {
    const plan = planOf('lc20', access)
    assert.match(plan, /idx_customers_membership_normalized/, plan)
    assert.ok(!/SCAN customers(?!\w)/.test(plan), `a membership search must not scan the table: ${plan}`)
    assert.match(plan, /MULTI-INDEX OR/)
  }
})

if (failed) { console.error(`${failed} check(s) failed`); process.exitCode = 1 } else console.log('PASS contacts membership search')
