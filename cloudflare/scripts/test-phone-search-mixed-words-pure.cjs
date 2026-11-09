'use strict'
// P2.8-F (3 Nov 2026): an account WITHOUT "See full phone numbers" still finds a sale or a return by a word that mixes letters
// and digits ("No1", "sokha2"), and still finds nothing through a digit fragment of a hidden number.
//
// Why a word was lost: the matcher reads a letter o beside a digit as zero ("No1" is searched as "n01"). Sales and Returns kept
// that spelling in search_normalized, the write-time folded copy. The copy also holds the customer's digits, so the restricted
// search (lib/phoneSearchGuard.ts) skips it and reads the raw columns only, where the cashier still says "No1": "n01" matched
// nothing. The fix reads the same raw, non-phone haystack a second time with every o turned into 0 (restrictedWordHaystacks),
// for a restricted word that has a letter and a zero.
//
// The REAL route code runs here: buildSalesSearchWhere (routes/sales.ts) and returnsFilter (routes/returns.ts) are sliced out
// of the source files and executed against real SQLite (better-sqlite3), with the real lib/searchMatch.ts and
// lib/phoneSearchGuard.ts. Part 1 positive cases (found), Part 2 the security cases (still not found: a legacy phone glued to
// letters, a folded copy holding a phone, a number typed with a letter O, and the reviewer's 42 disguise spellings of a
// fragment), Part 3 the holder and every other word are byte-equal to the base commit, Part 4 MUTANTS: each must fail.
//
// Run (from cloudflare/): node scripts/test-phone-search-mixed-words-pure.cjs
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { disguises } = require('./harness/phone_disguises.cjs')
const { replaceOnce, build, OPEN, CLOSED, SCHEMA, freshDb: freshWorld, finders } = require('./harness/phone_route_slices.cjs')

function freshDb(normalize) {
  // Every row is invented. search_normalized is written the way the app writes it: the folded text of the row's own fields.
  return freshWorld(normalize, ({ addSale, addReturn }) => {
    addSale(1, 'P28-0101', { cashier: 'No1', phone: '087 654 321' })
    addSale(2, 'P28-0102', { cashier: 'SOKHA2' })
    addSale(3, 'P28-0103', { cashier: 'Sovann2024' })
    addSale(4, 'P28-0104', { name: 'Fixture Legacy', phone: 'Tel099456789' })
    addSale(5, 'P28-0105', { name: 'O1988375' })
    addSale(6, 'P28-0106', { branch: 'Room1' })
    addSale(7, 'P28-0107', { name: '010 222 333', phone: '010 222 333' })
    addReturn(1, 'P28-RET-AA', { name: 'sokha2' })
    addReturn(2, 'P28-RET-BB', { name: 'Fixture Sophea', folded: 'p28-ret-bb tel010222333' })
    addReturn(3, 'P28-RET-CC', { name: '010 222 333' })
    addReturn(4, 'P28-RET-DD', { name: 'MIMO10' })
  })
}

function run(world) {
  const failures = []
  const check = (name, fn) => { try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message || error).split('\n')[0]}`) } }
  const { guard, match, buildSalesSearchWhere, returnsFilter } = world
  const db = freshDb(match.normalizeSearchText)
  const { sales, returns } = finders(db, world)

  // ---- 1. a word that mixes letters and digits is found again, without the grant ----------------------------------------------
  check('no grant: a cashier named No1 is found by "No1", "no1" and "NO1" (the o beside the digit is read as a zero)', () => {
    for (const q of ['No1', 'no1', 'NO1']) assert.deepEqual(sales(q, CLOSED), ['P28-0101'], q)
  })
  check('no grant: an upper-case cashier name is found by the lower-case word', () => assert.deepEqual(sales('sokha2', CLOSED), ['P28-0102']))
  check('no grant: a word with a real zero AND an o is found (Sovann2024)', () => {
    assert.deepEqual(sales('sovann2024', CLOSED), ['P28-0103'])
    assert.deepEqual(sales('Sovann2024', CLOSED), ['P28-0103'])
  })
  check('no grant: a branch named Room1 is found (two o letters)', () => assert.deepEqual(sales('room1', CLOSED), ['P28-0106']))
  check('no grant: a mixed word beside another word and across comma groups', () => {
    assert.deepEqual(sales('no1 walk', CLOSED), ['P28-0101'])
    assert.deepEqual(sales('no1, room1', CLOSED, 'OR'), ['P28-0101', 'P28-0106'])
    assert.deepEqual(sales('no1, room1', CLOSED), [])
  })
  check('no grant: a return for a customer named sokha2 is found by "sokha2", "Sokha2"', () => {
    for (const q of ['sokha2', 'Sokha2', 'SOKHA2']) assert.deepEqual(returns(q, CLOSED), ['P28-RET-AA'], q)
  })
  check('no grant: a return for MIMO10 (o letters plus a real zero) is found', () => assert.deepEqual(returns('mimo10', CLOSED), ['P28-RET-DD']))
  check('the holder finds the same rows', () => {
    assert.deepEqual(sales('No1', OPEN), ['P28-0101'])
    assert.deepEqual(sales('sovann2024', OPEN), ['P28-0103'])
    assert.deepEqual(returns('sokha2', OPEN), ['P28-RET-AA'])
    assert.deepEqual(returns('mimo10', OPEN), ['P28-RET-DD'])
  })
  check('restrictedWordHaystacks: a letter and a zero get the folded copy of the haystack that was passed in; nothing else does', () => {
    const fold = (h) => `replace(lower(${h}),'o','0')`
    for (const word of ['n01', 's0kha2', 'tel0994', 'x0', 'r001']) assert.deepEqual(guard.restrictedWordHaystacks(word, 'H'), ['H', fold('H')], word)
    for (const word of ['08765', '0', '654', 'x12', 'abc', '654️', '๐๘๗', 'x๐']) assert.deepEqual(guard.restrictedWordHaystacks(word, 'H'), ['H'], JSON.stringify(word))
    assert.deepEqual(guard.restrictedWordHaystacks('n01', 'H'), ['H', fold('H')], 'the retry has no word cap: the haystack is written once per statement')
  })

  // ---- 2. the security cases: still nothing through a phone, the folded copy, or a digit fragment ---------------------------------
  check('no grant: a legacy phone glued to letters is not found by a fragment of its digits (the retry cannot read the phone column)', () => {
    for (const q of ['tel0994', 'tel09945', 'tel099456789', 'TEL0994']) assert.deepEqual(sales(q, CLOSED), [], q)
    assert.deepEqual(sales('tel0994', OPEN), ['P28-0104'], 'positive control: the holder finds it')
  })
  check('no grant: a return whose folded copy holds a phone glued to letters is not found by its digits (the retry cannot read search_normalized)', () => {
    for (const q of ['tel0102', 'tel010222333', 'TEL0102']) assert.deepEqual(returns(q, CLOSED), [], q)
    assert.deepEqual(returns('tel0102', OPEN), ['P28-RET-BB'], 'positive control: the holder finds it')
  })
  check('no grant: a digit-only word never gets the retry (a number typed with a letter O in a name stays unreadable by its digits)', () => {
    for (const q of ['01988', '0198', 'o1988', 'O1988', '01988375']) assert.deepEqual(sales(q, CLOSED), [], q)
    assert.deepEqual(sales('01988', OPEN), ['P28-0105'], 'positive control: the holder reads the folded copy')
  })
  check('no grant: a fragment of a number typed on a sale or saved as a name finds nothing; the whole number still finds its sale', () => {
    for (const q of ['087', '0876', '654', '654321', '222', '2 333', '0994', '09945']) {
      assert.deepEqual(sales(q, CLOSED), [], `sales ${q}`)
      assert.deepEqual(returns(q, CLOSED), [], `returns ${q}`)
    }
    assert.deepEqual(sales('087 654 321', CLOSED), ['P28-0101'])
    assert.deepEqual(sales('010222333', CLOSED), ['P28-0107'])
    assert.deepEqual(returns('010222333', CLOSED), [], 'a return has no phone column: a whole number finds nothing there')
  })
  check('no grant: the reviewer\'s 42 spellings of a fragment find no sale and no return', () => {
    // Each fragment is searched where a fixture row holds it (0102 is also the receipt of one fixture sale, so it is a returns-only fragment).
    for (const [frag, surfaces] of [['654', ['sales']], ['0876', ['sales']], ['222', ['sales', 'returns']], ['0102', ['returns']]]) {
      const spellings = disguises(frag)
      assert.ok(spellings.length >= 42, `at least the reviewer's 42 spellings of ${frag} (${spellings.length})`)
      for (const [label, q] of spellings) {
        if (surfaces.includes('sales')) assert.deepEqual(sales(q, CLOSED), [], `sales ${frag} ${label}`)
        if (surfaces.includes('returns')) assert.deepEqual(returns(q, CLOSED), [], `returns ${frag} ${label}`)
      }
      for (const surface of surfaces) assert.ok((surface === 'sales' ? sales(frag, OPEN) : returns(frag, OPEN)).length > 0, `positive control: the holder finds ${frag} in ${surface}`)
    }
  })

  check('the statement stays inside D1 (expression depth 100, 100 KB) for 12 mixed words and for the 48-word maximum, beside the route filters', () => {
    const d1 = new DatabaseSync(':memory:', { limits: { exprDepth: 100, sqlLength: 100000 } })
    for (const ddl of SCHEMA) d1.exec(ddl)
    const group = (start, count) => Array.from({ length: count }, (_, i) => `x0${start + i}`).join(' ')
    const search = (words) => Array.from({ length: Math.ceil(words / 8) }, (_, g) => group(g * 8 + 11, Math.min(8, words - g * 8))).join(',')
    const salesStatement = (words) => {
      const params = {}
      return `SELECT s.id FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE 1=1 AND s.cashier_name LIKE '%x%' AND s.branch_name = 'Main' AND s.payment_method = 'Cash' AND ${buildSalesSearchWhere({ search: search(words) }, params, CLOSED)}`
    }
    const returnsStatement = (words) => `SELECT r.id FROM returns r WHERE ${returnsFilter({ search: search(words) }, { sql: "r.created_at >= '2026-01-01'", params: {} }, CLOSED).where.join(' AND ')}`
    for (const [label, statement] of [['sales', salesStatement], ['returns', returnsStatement]]) {
      for (const words of [1, 12, 13, 48]) assert.doesNotThrow(() => d1.prepare(statement(words)), `${label}: ${words} mixed words`)
      for (const words of [1, 12, 13, 48]) assert.ok(statement(words).includes("replace(lower("), `${label}: the retry is on at ${words} words`)
    }
  })

  // ---- 3. nothing else moved: the holder is byte-equal to the base commit; without the grant a word only gains rows when it is mixed, and
  //         only loses rows in a column the projection masks (test-phone-search-masked-columns-pure.cjs owns that half) --------------------
  check('holder: SQL and parameters equal the base commit; no grant: this fixture finds the same rows, a mixed word only adds rows', () => {
    const baseWorld = build({ base: true })
    const queries = ['', 'dara', 'No1', 'sokha2', 'room1', 'sovann2024', 'tel0994', '654', '0876', 'o8765', '087 654 321', '085 999 000', 'P28-0101', 'p28 0101', 'rcp-1234, jane',
      'no1 walk', 'a1', 'x12', 'lc-p28-1', '0001', '12.5', 'ក១', 'dara,sophea', 'mimo10', 'tel0102', 'O1988375', "o'brien", '%', '_', 'x'.repeat(70), '654́', 'ｎｏ１']
    const mixedWord = (q) => match.tokenizeSearchTermGroups(q).some((words) => words.some((word) => /\p{L}/u.test(word) && word.includes('0')))
    for (const q of queries) {
      for (const [name, access] of [['holder', OPEN], ['no grant', CLOSED]]) {
        const lane = { params: {} }
        lane.sql = world.buildSalesSearchWhere({ search: q }, lane.params, access)
        const before = { params: {} }
        before.sql = baseWorld.buildSalesSearchWhere({ search: q }, before.params, access)
        const laneReturns = world.returnsFilter({ search: q }, { sql: '1=1', params: {} }, access)
        const baseReturns = baseWorld.returnsFilter({ search: q }, { sql: '1=1', params: {} }, access)
        if (name === 'holder') {
          assert.deepEqual(lane, before, `sales ${name} ${JSON.stringify(q)}`)
          assert.deepEqual({ where: laneReturns.where, params: laneReturns.params }, { where: baseReturns.where, params: baseReturns.params }, `returns ${name} ${JSON.stringify(q)}`)
        } else {
          const salesOf = (sql, params) => (sql ? db.prepare(`SELECT s.id FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE ${sql}`).all(params).map((row) => row.id) : [])
          const returnsOf = (filter) => db.prepare(`SELECT r.id FROM returns r WHERE ${filter.where.join(' AND ')}`).all(filter.params).map((row) => row.id)
          for (const [label, laneRows, baseRows] of [['sales', salesOf(lane.sql, lane.params), salesOf(before.sql, before.params)], ['returns', returnsOf(laneReturns), returnsOf(baseReturns)]]) {
            if (mixedWord(q)) assert.ok(baseRows.every((id) => laneRows.includes(id)), `${label} ${JSON.stringify(q)}: the retry only adds rows`)
            else assert.deepEqual(laneRows, baseRows, `${label} ${JSON.stringify(q)}: same rows as the base commit`)
          }
        }
      }
    }
  })
  return failures
}

// ---- 4. mutants: a defect in the retry must turn this test red -------------------------------------------------------------------
const MUTANTS = [
  ['retry removed (a mixed word is lost again)', { lib: { phoneSearchGuard: replaceOnce('? [rawHaystack, `replace(lower(${rawHaystack}),\'o\',\'0\')`] : [rawHaystack]', '? [rawHaystack] : [rawHaystack]') } }],
  ['retry also for a digit-only word', { lib: { phoneSearchGuard: replaceOnce('/\\p{L}/u.test(word) && word.includes(\'0\')', 'word.includes(\'0\')') } }],
  ['retry without lower() (an upper-case name is lost)', { lib: { phoneSearchGuard: replaceOnce('replace(lower(${rawHaystack}),\'o\',\'0\')', 'replace(${rawHaystack},\'o\',\'0\')') } }],
  ['sales: the retry reads the phone column and the folded copy', { sales: replaceOnce('restrictedWordHaystacks(word, RESTRICTED_HAYSTACK)', '[RESTRICTED_HAYSTACK, ...restrictedWordHaystacks(word, flatHaystack).slice(1)]') }],
  ['returns: the retry reads the folded copy', { returns: replaceOnce('restrictedWordHaystacks(word, RESTRICTED_HAYSTACK)', '[RESTRICTED_HAYSTACK, ...restrictedWordHaystacks(word, flatHaystack).slice(1)]') }],
  ['sales: a word with letters escapes the restriction', { sales: replaceOnce('const restricted = !access.fullPhone && hasDigit(word)', 'const restricted = !access.fullPhone && hasDigit(word) && !/\\p{L}/u.test(word)') }],
  ['returns: a word with letters escapes the restriction', { returns: replaceOnce('const restricted = guardDigitWords && hasDigit(word)', 'const restricted = guardDigitWords && hasDigit(word) && !/\\p{L}/u.test(word)') }],
]

const failures = run(build())
if (failures.length) {
  for (const failure of failures) console.error(`RED ${failure}`)
  console.error(`FAIL ${failures.length} check(s)`)
  process.exit(1)
}
let survivors = 0
let killed = 0
for (const [name, options] of MUTANTS) {
  const outcome = run(build(options))
  if (outcome.length) { killed += 1; console.log(`killed   ${name} (${outcome.length} red)`) } else { survivors += 1; console.error(`SURVIVED ${name}`) }
}
if (survivors) { console.error(`FAIL ${survivors} mutant(s) survived`); process.exit(1) }
console.log(`PASS phone search mixed words: all checks green, ${killed} mutants killed`)
