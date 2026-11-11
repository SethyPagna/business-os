'use strict'
// Pins the customers duplicate check's narrowing through the 0302 digits index (lib/contactDuplicates.ts customerPhoneNarrowing).
//   - differential: for EVERY value any fixture row can match today (canonical primary, cached key, canonical option phones) plus absent values, the rows the new phone
//     statement returns equal the rows today's statement returns (today's statement is written out below, from the base commit);
//   - a partial number never matches (the exact comparison stays): subject 12345678 against stored 012 345 678 returns nothing;
//   - the two fallbacks (over 15 digits, fragment under 3 characters) run today's statement;
//   - EXPLAIN: the narrowed statement is driven by the FTS index and a key seek, not a customers scan; the write guard's name subquery is the plain expression for customers.
// The one shape the narrowing cannot see (a slashed field of 15 digits or fewer) is pinned as a KNOWN GAP so a change to it is noticed.
// Run (from cloudflare/): node scripts/test-contact-duplicates-digits-index-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const mod = { exports: {} }
new Function('module', 'exports', 'require', buildSync({ entryPoints: [path.join(root, 'src', 'lib', 'contactDuplicates.ts')], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2022', logLevel: 'error' }).outputFiles[0].text)(mod, mod.exports, require)
const lib = mod.exports

const dir = path.join(root, 'migrations')
const db = new DatabaseSync(':memory:')
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(dir, f), 'utf8'))

const khmer = (t) => t.replace(/\d/g, (d) => String.fromCharCode(0x17e0 + Number(d)))
const opt = (...phones) => JSON.stringify(phones.map((phone, i) => ({ label: `O${i}`, phone })))
const rows = [
  ['Plain', '012345678', '012345678', null],
  ['Spaced', '012 345 679', '012345679', null],
  ['Plus855', '+855 (12) 345-680', '012345680', null],
  ['Stale key', '012 345 681', '12345681', null],
  ['Digits855', '85512345682', null, null],
  ['Digits855long', '855123456789', null, null],
  ['Double zero', '00855 12 345 683', null, null],
  ['Nbsp', '012 333 555', null, null],
  ['Tab', '012\t333\t556', null, null],
  ['Khmer', khmer('012 333 666'), null, null],
  ['Dual glued', '012 345 700 / 098 765 432', '012345700/098765432', null],
  ['Dual option', 'x', null, opt('012 345 701 / 098 765 433')],
  ['Dual short', '012 / 345678', null, null],
  ['Dot', '012345678.1234567', null, null],
  ['Two digit', '12', null, null],
  ['One digit', '7', null, null],
  ['Three digit', '012', '012', null],
  ['Options', '', null, opt('012 777 888', '+855 12 999 000', '096 111 222')],
  ['Fourth option', '', null, opt('010 100 100', '010 100 101', '010 100 102', '010 100 103')],
  ['Numeric option', '', null, JSON.stringify([{ label: 'N', phone: 12555001 }])],
  ['Not json', '099 000 111', '099000111', 'not JSON 012 333 444'],
  ['Foreign', '+44 20 7946 0958', '442079460958', null],
  ['Anonymous', '012 999 999', '012999999', null],
  ['Same phone other name', '012 345 678', '012345678', null],
  ['Blank', null, null, null],
]
rows.forEach(([name, phone, key, address], i) => db.prepare('INSERT INTO customers (id,name,phone,phone_normalized,address,is_anonymous) VALUES (?,?,?,?,?,?)').run(i + 1, name, phone, key, address, name === 'Anonymous' ? 1 : 0))

const canonicalSql = (column) => {
  const digits = `replace(replace(replace(replace(replace(replace(replace(COALESCE(${column}, ''), ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', ''), '/', '')`
  return `(CASE WHEN substr(${digits}, 1, 3) = '855' AND length(${digits}) IN (11, 12) THEN '0' || substr(${digits}, 4) ELSE ${digits} END)`
}
// today's phone statement (base commit), written out
const oldSql = (phones) => {
  const c = phones.map((_, i) => `phone_normalized = @phone${i} OR ${canonicalSql('phone')} = @phone${i} OR EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN json_valid(address) THEN CASE WHEN json_type(address) = 'array' THEN address ELSE '[]' END ELSE '[]' END) AS option
      WHERE ${canonicalSql("json_extract(option.value, '$.phone')")} = @phone${i}
    )`)
  return `SELECT id FROM customers WHERE (${c.join(' OR ')}) ORDER BY id`
}
const params = (phones) => Object.fromEntries(phones.map((p, i) => [`phone${i}`, p]))

// the real module's statement, captured through a shim database
const newSql = async (phones, excludeId) => {
  const seen = []
  const shim = { prepare: (sql) => ({ all: async (p) => { seen.push({ sql, p }); return [] }, run: async () => ({}), get: async () => null }) }
  await lib.findContactDuplicateState(shim, 'customers', { id: excludeId, name: '', phones })
  return seen[0]
}
const run = (sql, p) => db.prepare(sql).all(p).map((r) => r.id).sort((a, b) => a - b)
const idsOnly = (sql) => sql.replace(/SELECT [^]*? FROM customers WHERE/, 'SELECT id FROM customers WHERE')

let passed = 0
const check = async (name, body) => { await body(); passed += 1; console.log(`PASS ${name}`) }

;(async () => {
  const everyValue = new Set()
  for (const r of db.prepare('SELECT phone, phone_normalized, address FROM customers').all()) {
    for (const v of lib.collectContactPhones(r)) everyValue.add(v)
    if (r.phone_normalized) everyValue.add(r.phone_normalized)
  }
  for (const v of ['999888777', '0555000111', '12345678']) everyValue.add(v)
  const probes = [...new Set([...everyValue].map((v) => lib.normalizePhone(v)).filter(Boolean))]
  // the glued 18-digit pair a customer field with a slash carries today
  probes.push('012345700098765432', '012345701098765433')

  await check('differential: new phone rows == today\'s phone rows for every probe value, but the pinned gap', async () => {
    const lostBy = []
    for (const p of probes) {
      const n = await newSql([p])
      const before = run(oldSql([p]), params([p]))
      const after = run(idsOnly(n.sql), n.p)
      assert.deepEqual(after.filter((id) => !before.includes(id)), [], `new returns rows today's does not for ${p}`)
      const lost = before.filter((id) => !after.includes(id))
      if (lost.length) lostBy.push([p, lost])
    }
    const at = (name) => rows.findIndex((r) => r[0] === name) + 1
    // KNOWN GAPS (none present in production data): a slashed field of 15 digits or fewer, and an option phone stored as a JSON number (the view reads text only)
    assert.deepEqual(lostBy, [['012345678', [at('Dual short')]], ['12555001', [at('Numeric option')]]], `known gaps only: ${JSON.stringify(lostBy)}`)
  })

  await check('beyond the classifier: a 4th-option phone is found by the SQL of today only, and the classifier drops it anyway', async () => {
    for (const p of ['010100103']) {
      const n = await newSql([p])
      const before = run(oldSql([p]), params([p]))
      assert.equal(before.length, 1, 'control: the SQL of today returns the row')
      assert.deepEqual(run(idsOnly(n.sql), n.p), [])
      const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(before[0])
      assert.deepEqual(lib.classifyContactDuplicates({ name: 'Someone else', phones: [p] }, [row]), [], 'no match is ever reported for it')
    }
  })

  await check('differential holds for two typed numbers and with an excluded id (the gap value left out)', async () => {
    const list = probes.filter((p) => p !== '012345678' && p !== '12555001')
    for (let i = 0; i + 1 < list.length; i += 1) {
      const pair = [list[i], list[i + 1]]
      const n = await newSql(pair, 5)
      const before = run(oldSql(pair).replace('ORDER BY id', 'AND id != 5 ORDER BY id'), params(pair))
      assert.deepEqual(run(idsOnly(n.sql), n.p), before, `pair ${pair}`)
    }
  })

  await check('the 18-digit dual number and a 16-digit number take the fallback and are still found', async () => {
    for (const p of ['012345700098765432', '0123456781234567']) {
      const n = await newSql([p])
      assert.ok(!n.sql.includes('customers_phone_digits_fts'), 'fallback is today\'s statement')
      assert.deepEqual(run(idsOnly(n.sql), n.p), run(oldSql([p]), params([p])))
    }
    assert.equal(run(oldSql(['012345700098765432']), params(['012345700098765432'])).length, 1)
  })

  await check('fragment under 3 characters takes the fallback; 3 is narrowed', async () => {
    for (const p of ['12', '7', '012', '0']) {
      const n = await newSql([p])
      assert.ok(!n.sql.includes('customers_phone_digits_fts'), p)
      assert.deepEqual(run(idsOnly(n.sql), n.p), run(oldSql([p]), params([p])))
    }
    assert.notEqual(lib.customerPhoneNarrowing(['0123']), null)
    assert.equal(lib.customerPhoneNarrowing(['012']), null)
  })

  await check('privacy: a partial number never matches (the exact comparison stays)', async () => {
    for (const p of ['12345678', '345678', '123456']) {
      const n = await newSql([p])
      assert.deepEqual(run(idsOnly(n.sql), n.p), [], p)
    }
    const n = await newSql(['012345678'])
    assert.deepEqual(run(idsOnly(n.sql), n.p), [1, rows.findIndex((r) => r[0] === 'Same phone other name') + 1], 'the whole number finds both owners')
  })

  await check('EXPLAIN: the narrowed statement searches the FTS index and the key index, never scans customers', async () => {
    const n = await newSql(['012345678'])
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${idsOnly(n.sql)}`).all(n.p).map((r) => r.detail).join('\n')
    assert.match(plan, /customers_phone_digits_fts/)
    assert.match(plan, /idx_customers_phone_normalized/)
    assert.doesNotMatch(plan, /^SCAN customers$/m, plan)
    const old = db.prepare(`EXPLAIN QUERY PLAN ${oldSql(['012345678'])}`).all(params(['012345678'])).map((r) => r.detail).join('\n')
    assert.match(old, /^SCAN customers$/m, 'control: today\'s statement scans')
  })

  await check('write guard name subquery is the plain expression for customers, COALESCE kept for the other tables', async () => {
    const decision = { action: 'create_separate', candidateIds: [], candidateVersions: [], fingerprint: 'v1|' }
    const c = lib.contactDuplicateWriteGuardStatement('customers', { name: 'A', phones: ['012345678'] }, decision, [])
    assert.match(c.sql, /lower\(trim\(named\.name\)\) = @nameKey/)
    assert.doesNotMatch(c.sql, /COALESCE\(named\.name/)
    const s = lib.contactDuplicateWriteGuardStatement('suppliers', { name: 'A', phones: ['012345678'] }, decision, [])
    assert.match(s.sql, /COALESCE\(named\.name, ''\)/)
  })

  await check('suppliers and delivery contacts keep today\'s statement', async () => {
    for (const table of ['suppliers', 'delivery_contacts']) {
      const seen = []
      const shim = { prepare: (sql) => ({ all: async () => { seen.push(sql); return [] } }) }
      await lib.findContactDuplicateState(shim, table, { name: '', phones: ['012345678'] })
      assert.ok(!seen[0].includes('customers_phone_digits_fts'))
    }
  })

  console.log(`${passed} passed`)
})().catch((e) => { console.error(e); process.exit(1) })
