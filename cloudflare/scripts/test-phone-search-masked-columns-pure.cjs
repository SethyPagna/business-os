'use strict'
// P2.8-F S1 (3 Nov 2026): an account WITHOUT "See full phone numbers" must not read a number through a column the response masks.
//
// The hole: the masking rule (lib/phoneAccess.ts) hides any phone-shaped value under a key that names a person or a label (notes, cashier_name,
// branch_name, supplier_name, customer_name ...), and a note that is only a phone shows "093 *** 789". The Sales and Returns searches read those
// same columns raw, so a digit fragment typed into the search box found the row ("456" found it, "457" did not): a number readable by bisection.
// Only customer_name had been wrapped. The searches now ask the masking rule itself (keyMaskOf / restrictedColumnSql), so a column the response
// masks reads as empty to a digit word, whatever the column is called.
//
// The REAL Sales and Returns search code runs on real SQLite (harness/phone_route_slices.cjs). Part 1: the cases that were red (a sale whose note
// is a number, a return whose note is a number, a supplier return saved under a number, a cashier or branch that is a number, a quoted number in a
// reason) stay unfound, in every spelling, and a holder of the grant still finds all of them; text notes and 7-digit notes are still found.
// Part 2: the masker and the SQL agree value by value (every spelling of a separator and every digit script). Part 3: the patterns fit D1's
// 50-byte ceiling. Part 4: MUTANTS: each defect must turn this test red.
//
// Evidence of "red before": P28_S1_BEFORE=f347ff798 node scripts/test-phone-search-masked-columns-pure.cjs  (prints the checks that fail there)
// Run (from cloudflare/): node scripts/test-phone-search-masked-columns-pure.cjs
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { disguises } = require('./harness/phone_disguises.cjs')
const { replaceOnce, build, OPEN, CLOSED, freshDb: freshWorld, finders } = require('./harness/phone_route_slices.cjs')

const BEFORE = process.env.P28_S1_BEFORE || ''
const khmer = (text) => text.replace(/[0-9]/g, (digit) => String.fromCodePoint(0x17e0 + Number(digit)))

// Every row is invented. A "hidden" row holds a number in a column the response masks; the fragment is what a searcher types.
const SALES_HIDDEN = [
  ['note that is a number', 'P28-0108', '456', { notes: '093 456 789' }],
  ['cashier that is a number', 'P28-0109', '555', { cashier: '094 555 818' }],
  ['note in Khmer digits', 'P28-0112', khmer('321'), { notes: khmer('096 321 987') }],
  ['note spaced with em spaces', 'P28-0113', '642', { notes: '097 642 813' }],
  ['note spaced with no-break spaces', 'P28-0114', '246', { notes: '098 246 135' }],
  ['note with a country code', 'P28-0117', '864', { notes: '+855 12 864 209' }],
  ['note with brackets and a dash', 'P28-0118', '357', { notes: '(099) 111-357' }],
  ['note spaced with narrow no-break spaces', 'P28-0119', '927', { notes: '010 927 468' }],
  ['note spaced with ideographic spaces', 'P28-0120', '583', { notes: '011　583　106' }],
  ['customer name that is a number', 'P28-0121', '389', { name: '012 389 666' }],
]
const SALES_VISIBLE = [
  ['deliver at 12 Street 271', 'P28-0111', { notes: 'deliver at 12 Street 271' }],
  ['a number inside a sentence (the note shows as typed)', 'P28-0115', { notes: 'Tel 088 713 904' }],
  ['a 7-digit note (too short to be a phone)', 'P28-0116', { notes: '4412345' }],
  // Review B2: a branch is not a person. One named by a number is shown to everybody as stored, so the search reads it as stored.
  ['a branch named by a number', 'P28-0110', { branch: '095 777 626' }],
]
const RETURNS_HIDDEN = [
  ['return note that is a number', 'P28-RET-EA', '456', 'customer', { notes: '093 456 789' }],
  ['supplier return saved under a number', 'P28-RET-EB', '555', 'supplier', { supplier: '094 555 818', scope: 'supplier' }],
  ['return cashier that is a number', 'P28-RET-EC', '222', 'customer', { cashier: '011 222 345' }],
  ['reason quoting a number', 'P28-RET-ED', '424', 'customer', { reason: 'refund to "093 111 424" requested' }],
  ['return customer that is a number', 'P28-RET-EF', '333', 'customer', { name: '012 333 787' }],
  ['return note spaced with em spaces', 'P28-RET-EH', '642', 'customer', { notes: '097 642 813' }],
]

function freshDb(normalize) {
  return freshWorld(normalize, ({ addSale, addReturn }) => {
    let id = 0
    for (const [, receipt, , opts] of SALES_HIDDEN) addSale(id += 1, receipt, opts)
    for (const [, receipt, opts] of SALES_VISIBLE) addSale(id += 1, receipt, opts)
    id = 0
    for (const [, number, , , opts] of RETURNS_HIDDEN) addReturn(id += 1, number, opts)
    addReturn(id += 1, 'P28-RET-EE', { reason: 'broken seal batch 4471' })
    addReturn(id += 1, 'P28-RET-EG', { supplier: 'Lux Supply 2024', scope: 'supplier' })
  })
}

// ---- Part 2 data: what the masker does to a value, and what the SQL must therefore do ---------------------------------------------------
// [label, value, masked by the response projection]. `stricter`: the SQL may blank a value the masker leaves (never the reverse).
const SPACES = ['\u0009', '\u000a', '\u000b', '\u000c', '\u000d', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿']
const NAME_VALUES = [
  ['plain', '093 456 789', true], ['no separators', '093456789', true], ['country code', '+855 93 456 789', true], ['brackets and dash', '(093) 456-789', true],
  ['dots', '093.456.789', true], ['padded', '  093 456 789  ', true], ['eight digits', '20261103', true],
  ...SPACES.map((space) => [`separated by U+${space.codePointAt(0).toString(16).padStart(4, '0')}`, `093${space}456${space}789`, true]),
  ['Khmer digits', khmer('093 456 789'), true], ['Arabic-Indic digits', '٠٩٣ ٤٥٦ ٧٨٩', true],
  ['Persian digits', '۰۹۳ ۴۵۶ ۷۸۹', true], ['Devanagari digits', '०९३ ४५६ ७८९', true],
  ['Thai digits', '๐๙๓ ๔๕๖ ๗๘๙', true], ['Myanmar digits', '၀၉၃ ၄၅၆ ၇၈၉', true],
  ['full-width digits', '０９３４５６７８９', true], ['mathematical digits', '\u{1d7ce}\u{1d7d7}\u{1d7d1} \u{1d7d2}\u{1d7d3}\u{1d7d4} \u{1d7d5}\u{1d7d6}\u{1d7d7}', true],
  ['ASCII and Khmer mixed', `093 ${khmer('456')} ${khmer('789')}`, true],
  ['26 digits', '12345678901234567890123456', false, true],
  ['sentence with a number', 'Tel 093 456 789', false], ['street note', 'deliver at 12 Street 271', false], ['3 digits', '271', false], ['7 digits', '4412345', false],
  ['7 digits spaced', '12 34 56 7', false], ['name with a digit', 'No1', false], ['date and time', '2026-11-03 15:20', false], ['letters and 8 digits', 'abc 12345678', false],
  ['only separators', '+++++++++', false], ['empty', '', false],
]
const QUOTED_VALUES = [
  ['quoted number', 'refund to "093 111 424" requested', true], ['single quotes', "ref '093 111 424'", true], ['curly quotes', 'refund to “093 111 424”', true],
  ['quoted seven digits', 'refund "0931114"', true], ['plain reason', 'broken seal batch 4471', false], ['quoted amount', 'amount "12.50" refunded', false],
  ['number outside quotes', 'refund to 093 111 424 requested', false], ['empty', '', false],
  // The Khmer residue (review E1): a number quoted in Khmer digits was found by a Khmer fragment while the screen showed it masked.
  ['quoted Khmer number', `refund to "${khmer('093 111 424')}" requested`, true], ['quoted Khmer number, curly quotes', `refund to “${khmer('093 111 424')}”`, true],
  ['quoted Khmer figure (shown, blanked for the search)', `amount "${khmer('12')}" refunded`, false, true],
]
const ALWAYS_KEYS = ['phone', 'customer_phone', 'driver_phone', 'search_normalized', 'details', 'old_value', 'payload', 'undo_payload']
// Review B3 added the people the app names under keys that do not end in "name": contact_person, username, cashier, created_by, actor ...
const NAME_KEYS = ['notes', 'cashier_name', 'supplier_name', 'customer_name', 'label', 'description', 'memo', 'recipient_name', 'contact_person', 'username', 'cashier', 'created_by', 'actor', 'owner', 'staff', 'user_name']
const QUOTED_KEYS = ['reason', 'message', 'warning']
// Review B2: what is named by what it is, not by a person, is shown as stored.
const CATALOG_KEYS = ['branch_name', 'product_name', 'source_product_name', 'item_name', 'brand_name', 'category_name', 'unit_name', 'from_branch_name', 'product_description']
const PLAIN_KEYS = [...CATALOG_KEYS, 'receipt_number', 'legacy_receipt_number', 'payment_method', 'membership_number', 'return_number', 'return_type', 'supplier_settlement', 'id']

function run(world) {
  const failures = []
  const check = (name, fn) => { try { fn() } catch (error) { failures.push(`${name}: ${String(error && error.message || error).split('\n')[0]}`) } }
  const { guard, match } = world
  const db = freshDb(match.normalizeSearchText)
  const { sales, returns } = finders(db, world)

  // ---- 1. the cases that were red -------------------------------------------------------------------------------------------------------
  check('no grant: a sale whose note is a number is not found by a fragment of it, in any spelling; the holder finds it', () => {
    for (const [label, receipt, fragment] of SALES_HIDDEN.filter(([label]) => label.startsWith('note'))) {
      assert.deepEqual(sales(fragment, CLOSED), [], `${label}: ${fragment}`)
      assert.ok(sales(fragment, OPEN).includes(receipt), `positive control, the holder finds ${label}`)
    }
  })
  check('no grant: a sale whose cashier or customer is a number is not found by a fragment of it; the holder finds it', () => {
    for (const [label, receipt, fragment] of SALES_HIDDEN.filter(([label]) => label.startsWith('cashier') || label.startsWith('customer'))) {
      assert.deepEqual(sales(fragment, CLOSED), [], `${label}: ${fragment}`)
      assert.ok(sales(fragment, OPEN).includes(receipt), `positive control, the holder finds ${label}`)
    }
  })
  check('no grant: the reviewer\'s 42 spellings of a fragment of a hidden note, cashier or branch find no sale', () => {
    // A spelling that splits the fragment into two words ("9" and "27") may find another sale that holds both words in plain sight; what it
    // must never find is the hidden row itself.
    for (const [label, receipt, fragment] of SALES_HIDDEN.filter(([, , fragment]) => /^[0-9]+$/.test(fragment))) {
      const spellings = disguises(fragment)
      assert.ok(spellings.length >= 30, `the reviewer's spellings of ${fragment} (${spellings.length})`)
      for (const [spelling, q] of spellings) assert.ok(!sales(q, CLOSED).includes(receipt), `${label} ${fragment} ${spelling}`)
    }
  })
  check('no grant: a branch named by a number is shown as stored (review B2), so the search finds it by a fragment, as the holder does', () => {
    assert.ok(sales('777', CLOSED).includes('P28-0110'))
    assert.ok(sales('777', OPEN).includes('P28-0110'))
  })
  check('no grant: the digits are not read two or three at a time either (a longer fragment, two words, a whole number)', () => {
    for (const q of ['0934', '4567', '456 789', '093 456', '093456789', '094555818', '555 818', '777626']) assert.deepEqual(sales(q, CLOSED), [], q)
  })
  check('no grant: a sale whose note, cashier or branch is ordinary text is still found, with or without digits in it', () => {
    assert.deepEqual(sales('street', CLOSED), ['P28-0111'])
    assert.deepEqual(sales('271', CLOSED), ['P28-0111'], 'a digit word inside a text note')
    assert.deepEqual(sales('12 street 271', CLOSED), ['P28-0111'])
    assert.deepEqual(sales('713', CLOSED), ['P28-0115'], 'a number typed inside a sentence is shown as typed, so it is searchable')
    assert.deepEqual(sales('4412345', CLOSED), ['P28-0116'], 'seven digits are not a phone')
    assert.deepEqual(sales('admin', CLOSED).length > 0, true, 'the default cashier')
  })
  check('the holder finds every sale by its note, cashier, branch or text, exactly as before', () => {
    for (const [, receipt, fragment] of SALES_HIDDEN) assert.ok(sales(fragment, OPEN).includes(receipt), `${receipt} ${fragment}`)
    assert.deepEqual(sales('713', OPEN), ['P28-0115'])
    assert.deepEqual(sales('street', OPEN), ['P28-0111'])
  })

  check('no grant: a return whose note, cashier, customer or quoted reason is a number is not found by a fragment of it; the holder finds it', () => {
    for (const [label, number, fragment, scope] of RETURNS_HIDDEN.filter(([, , , scope]) => scope === 'customer')) {
      assert.deepEqual(returns(fragment, CLOSED, scope), [], `${label}: ${fragment}`)
      assert.ok(returns(fragment, OPEN, scope).includes(number), `positive control, the holder finds ${label}`)
    }
  })
  check('no grant: a supplier return saved under a number is not found by a fragment of it; the holder finds it', () => {
    for (const q of ['555', '094 555', '555 818', '0945', '818']) assert.deepEqual(returns(q, CLOSED, 'supplier'), [], q)
    assert.ok(returns('555', OPEN, 'supplier').includes('P28-RET-EB'), 'positive control, the holder finds the supplier return')
    assert.ok(returns('818', OPEN, 'supplier').includes('P28-RET-EB'), 'positive control, the holder finds the supplier return by the last digits')
  })
  check('no grant: the reviewer\'s 42 spellings of a fragment of a hidden return note, cashier, supplier or reason find no return', () => {
    for (const [label, number, fragment, scope] of RETURNS_HIDDEN.filter(([, , fragment]) => /^[0-9]+$/.test(fragment))) {
      for (const [spelling, q] of disguises(fragment)) assert.ok(!returns(q, CLOSED, scope).includes(number), `${label} ${fragment} ${spelling}`)
    }
  })
  check('no grant: a return with an ordinary reason or supplier is still found, digits included', () => {
    assert.deepEqual(returns('4471', CLOSED), ['P28-RET-EE'], 'a reason that quotes no number')
    assert.deepEqual(returns('seal', CLOSED), ['P28-RET-EE'])
    assert.deepEqual(returns('2024', CLOSED, 'supplier'), ['P28-RET-EG'])
    assert.deepEqual(returns('lux supply', CLOSED, 'supplier'), ['P28-RET-EG'])
  })

  // ---- 2. the masker and the SQL are one rule --------------------------------------------------------------------------------------------
  const access = typeof world.load === 'function' && !BEFORE ? world.load('phoneAccess') : null
  if (access) {
    const d1 = new DatabaseSync(':memory:', { limits: { exprDepth: 100, sqlLength: 100000, likePatternLength: 50 } })
    const sqlText = (key, value) => {
      const statement = d1.prepare(`SELECT ${guard.restrictedColumnSql({ sql: '@v', key })} AS t`)
      return (statement.sourceSQL.includes('@v') ? statement.get({ v: value }) : statement.get()).t
    }
    const masked = (key, value) => access.projectPhones({ [key]: value }, null)[key] !== value
    const parity = (keys, values) => {
      for (const key of keys) {
        for (const [label, value, expectMasked, stricter] of values) {
          const isMasked = masked(key, value)
          assert.equal(isMasked, expectMasked, `the response projection ${expectMasked ? 'masks' : 'shows'} ${key} = ${label}`)
          const sql = sqlText(key, value)
          if (!stricter) assert.equal(sql, guard.restrictedTextOf(key, value), `${key} = ${label}: the SQL and the row filter read the same text`)
          if (isMasked || stricter) assert.equal(sql, '', `${key} = ${label}: the response masks it, so a search must read it as empty`)
          else assert.equal(sql, value, `${key} = ${label}: the response shows it, so a search reads it as stored`)
        }
      }
    }
    check('the key rule: the columns the projection hides are the columns the searches blank', () => {
      for (const key of ALWAYS_KEYS) assert.equal(access.keyMaskOf(key), 'always', key)
      for (const key of NAME_KEYS) assert.equal(access.keyMaskOf(key), 'name', key)
      for (const key of QUOTED_KEYS) assert.equal(access.keyMaskOf(key), 'quoted', key)
      for (const key of PLAIN_KEYS) assert.equal(access.keyMaskOf(key), 'none', key)
    })
    check('name columns: a value the projection masks reads as empty in SQL, in every separator and every digit script', () => parity(NAME_KEYS, NAME_VALUES))
    check('sentence columns: a quoted number reads as empty, an ordinary reason as stored', () => parity(QUOTED_KEYS, QUOTED_VALUES))
    check('columns that always mask (phone, folded copy, serialized JSON) read as empty whatever they hold', () => {
      for (const key of ALWAYS_KEYS) for (const value of ['', 'plain text', '093 456 789', '{"phone":"093456789"}', null]) assert.equal(sqlText(key, value), '', `${key} = ${value}`)
    })
    check('columns the projection leaves alone are read as stored', () => {
      for (const key of PLAIN_KEYS) for (const value of ['P28-0108', '093 456 789', '4412345', '']) { assert.equal(masked(key, value), false, `${key} = ${value}`); assert.equal(sqlText(key, value), value, `${key} = ${value}`) }
      assert.equal(sqlText('notes', null), '', 'a null note reads as empty')
    })
  }

  // ---- 3. D1 refuses a LIKE or GLOB pattern over 50 bytes -------------------------------------------------------------------------------
  if (!BEFORE) check('every GLOB and LIKE pattern the restricted columns write fits D1\'s 50-byte ceiling', () => {
    const sql = ['s.notes', 's.cashier_name', 'r.reason', 'r.search_normalized', 'c.membership_number'].map((column) => guard.restrictedColumnSql(column)).join('\n')
    const patterns = [...sql.matchAll(/(?:GLOB|LIKE)\s+'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"))
    assert.ok(patterns.length >= 6, `patterns found (${patterns.length})`)
    for (const pattern of patterns) assert.ok(Buffer.byteLength(pattern, 'utf8') <= 50, `${Buffer.byteLength(pattern, 'utf8')} bytes: ${pattern}`)
  })
  return failures
}

// ---- 4. mutants -----------------------------------------------------------------------------------------------------------------------
const RAW = (column, key = 'raw') => `{ sql: "COALESCE(${column},'')", key: '${key}' }`
const MUTANTS = [
  ['sales: the note is read raw', { sales: replaceOnce("'s.payment_method', 's.notes', 'c.membership_number',", `'s.payment_method', ${RAW('s.notes')}, 'c.membership_number',`) }],
  ['sales: the cashier is read raw', { sales: replaceOnce("'s.legacy_receipt_number', 's.cashier_name', 's.customer_name',", `'s.legacy_receipt_number', ${RAW('s.cashier_name')}, 's.customer_name',`) }],
  ['sales: the customer name is read raw', { sales: replaceOnce("'s.cashier_name', 's.customer_name',\n", `'s.cashier_name', ${RAW('s.customer_name')},\n`) }],
  ['returns: the note is read raw', { returns: replaceOnce("'r.supplier_name', 'r.reason', 'r.notes', 'r.return_type'", `'r.supplier_name', 'r.reason', ${RAW('r.notes')}, 'r.return_type'`) }],
  ['returns: the supplier is read raw', { returns: replaceOnce("'r.supplier_name', 'r.reason', 'r.notes', 'r.return_type'", `${RAW('r.supplier_name')}, 'r.reason', 'r.notes', 'r.return_type'`) }],
  ['returns: the cashier is read raw', { returns: replaceOnce("'r.receipt_number', 'r.cashier_name', 'r.customer_name',", `'r.receipt_number', ${RAW('r.cashier_name')}, 'r.customer_name',`) }],
  ['returns: the reason is read raw', { returns: replaceOnce("'r.supplier_name', 'r.reason', 'r.notes', 'r.return_type'", `'r.supplier_name', ${RAW('r.reason')}, 'r.notes', 'r.return_type'`) }],
  ['returns: the customer name is read raw', { returns: replaceOnce("'r.cashier_name', 'r.customer_name',\n", `'r.cashier_name', ${RAW('r.customer_name')},\n`) }],
  ['rule: a name or note that is a number is not masked in search (name class treated as plain)', { lib: { phoneAccess: replaceOnce("if (kind & NAME) return 'name'", "if (kind & NAME) return 'none'") } }],
  ['rule: the people named under keys that do not end in name are not names', { lib: { phoneAccess: replaceOnce('summary|person|cashier', 'summary|xperson|xcashier') } }],
  ['rule: a product, branch or category name is masked like a person', { lib: { phoneAccess: replaceOnce('if (NAME_KEY.test(normalized)) kind |= CATALOG_KEY.test(normalized) ? CATALOG : NAME', 'if (NAME_KEY.test(normalized)) kind |= NAME') } }],
  ['quoted: the Khmer quote-then-digit pattern is dropped', { lib: { phoneSearchGuard: replaceOnce('][\\u17e0-\\u17e9]*\' THEN', '][\\u17e0-\\u17e9]*xx\' THEN') } }],
  ['rule: a quoted number in a sentence is not masked in search', { lib: { phoneAccess: replaceOnce("if (kind & MESSAGE) return 'quoted'", "if (kind & MESSAGE) return 'none'") } }],
  ['rule: the columns that always mask are read', { lib: { phoneAccess: replaceOnce("if (kind & (PHONE | SEARCH_TEXT | ENVELOPE)) return 'always'", "if (kind & (PHONE | SEARCH_TEXT | ENVELOPE)) return 'none'") } }],
  ['shape: only the old separators (space, tab, line breaks, no-break) are stripped', { lib: { phoneSearchGuard: replaceOnce('for (const code of SHAPE_SPACE_CODES) text', 'for (const code of [9, 10, 13, 0xa0]) text') } }],
  ['shape: the Khmer digit family is dropped', { lib: { phoneSearchGuard: replaceOnce('\\u17e0-\\u17e9', '') } }],
  ['shape: only the first digit family pattern is tested', { lib: { phoneSearchGuard: replaceOnce('NON_DIGIT_GLOBS.map(', 'NON_DIGIT_GLOBS.slice(0, 1).map(') } }],
  ['shape: a 3-digit value counts as a phone (a short number is hidden from search)', { lib: { phoneSearchGuard: replaceOnce('length(ds)>=8', 'length(ds)>=3') } }],
]

const world = BEFORE ? build({ base: true, baseLib: true, commit: BEFORE }) : build()
const failures = run(world)
if (BEFORE) {
  for (const failure of failures) console.log(`RED ${failure}`)
  console.log(`BEFORE ${BEFORE}: ${failures.length} failing check(s)`)
  process.exit(0)
}
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
console.log(`PASS phone search masked columns: all checks green, ${killed} mutants killed`)
