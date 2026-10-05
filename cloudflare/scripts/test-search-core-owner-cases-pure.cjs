// The owner's product-search examples, on real catalog rows
// (fixtures/search-core-catalog-sample.json, from the 2026-09-26 export).
//
// Every expected set comes from an oracle written against the raw rows
// (a regex over name/brand), never from the matcher under test.
//
// Discrimination: the same cases run against the legacy server builder and
// the legacy client re-filter, and the cases listed in LEGACY_MUST_FAIL must
// fail there -- proof the fixture separates the new core from the old code.
//
// Run: node scripts/test-search-core-owner-cases-pure.cjs
//      SEARCH_IMPL=legacy-server node scripts/test-search-core-owner-cases-pure.cjs   (expected RED)
//      SEARCH_IMPL=legacy-client node scripts/test-search-core-owner-cases-pure.cjs   (expected RED)
'use strict'
const assert = require('node:assert')
const path = require('node:path')
const { makeImpl } = require('./harness/search_impls.cjs')

const rows = require(path.join(__dirname, 'fixtures', 'search-core-catalog-sample.json')).rows
const byId = new Map(rows.map((row) => [row.id, row]))
const nameOf = (id) => byId.get(id).name
const oracle = (predicate) => new Set(rows.filter(predicate).map((row) => row.id))
const text = (row) => [row.name, row.brand].filter(Boolean).join(' ')

const BLUSH_PALETTES = oracle((row) => /blush/i.test(row.name) && /palette/i.test(row.name))
const SK_II = oracle((row) => /\bsk-?\s?ii\b/i.test(row.name) || /\bsk-?ii\b/i.test(row.brand || ''))
const SERUM_KM = oracle((row) => text(row).includes('សេរ៉ូម'))
const LOTION_KM = oracle((row) => text(row).includes('ឡេ'))
const EVIL_EYE = rows.find((row) => /hourglass blush palette evil eye/i.test(row.name)).id
const SKIN_TINT_2 = rows.find((row) => /skin tint 2$/i.test(row.name)).id
const DIOR_PALLETTE = rows.find((row) => /pallette/i.test(row.name)).id
const ALL_SKIN = oracle((row) => /clarins.*all skin/i.test(row.name))
const SELF = oracle((row) => /\b(self|shelf)\b/i.test(row.name))
const MORPHE_KM = oracle((row) => /morphe gel liner/i.test(row.name) && /[ក-៿]/.test(row.name))
const LIP_OIL_ONLY = oracle((row) => /lip oil/i.test(row.name) && !/lipstick/i.test(`${row.name} ${row.brand || ''}`))
const LOVE = rows.find((row) => /^blush palette love$/i.test(row.name)).id
const BARCODE_ROWS = oracle((row) => String(row.barcode || '').replace(/^0+/, '') === '85715166012')

assert.ok(BLUSH_PALETTES.size >= 10 && SK_II.size >= 50 && SERUM_KM.size >= 3 && LOTION_KM.size >= 1 && MORPHE_KM.size >= 1 && LIP_OIL_ONLY.size >= 1 && BARCODE_ROWS.size >= 1,
  'fixture must carry every owner case and decoy')

const setOf = (ids) => new Set(ids)
const sameSet = (a, b) => a.size === b.size && [...a].every((id) => b.has(id))
const describe = (ids) => [...ids].slice(0, 5).map(nameOf).join(' | ')

// Each case: [label, (impl) => throws on failure].
const CASES = [
  ['Blush Palette finds every blush palette, Evil Eye inside the first 30', (impl) => {
    const { ids } = impl.search('Blush Palette')
    assert.ok(sameSet(setOf(ids), BLUSH_PALETTES), `got ${ids.length}, want ${BLUSH_PALETTES.size}: ${describe(ids)}`)
    assert.ok(ids.indexOf(EVIL_EYE) >= 0 && ids.indexOf(EVIL_EYE) < 30, `Evil Eye at ${ids.indexOf(EVIL_EYE)}`)
  }],
  ['palette blush (word order) finds the same set', (impl) => {
    assert.ok(sameSet(setOf(impl.search('palette blush').ids), BLUSH_PALETTES))
  }],
  ['Hourglass Blush pa (partial last word) keeps Evil Eye', (impl) => {
    assert.ok(impl.search('Hourglass Blush pa').ids.includes(EVIL_EYE))
  }],
  ['blush pallet (typo) reaches every blush palette', (impl) => {
    const got = setOf(impl.search('blush pallet').ids)
    const missing = [...BLUSH_PALETTES].filter((id) => !got.has(id))
    assert.strictEqual(missing.length, 0, `missing ${missing.length}: ${describe(missing)}`)
  }],
  ['pallet: the Dior "Pallette" first, the palettes too, never "Clarins All Skin"', (impl) => {
    const { ids } = impl.search('pallet')
    assert.strictEqual(ids[0], DIOR_PALLETTE, `first is ${ids[0] && nameOf(ids[0])}`)
    assert.ok([...BLUSH_PALETTES].every((id) => ids.includes(id)), 'palettes reached')
    assert.ok(![...ALL_SKIN].some((id) => ids.includes(id)), 'reverse containment ("all") must not match')
  }],
  ['pelette reaches the palettes', (impl) => {
    const got = setOf(impl.search('pelette').ids)
    assert.ok([...BLUSH_PALETTES].every((id) => got.has(id)))
  }],
  ...['SK-II', 'skii', 'sk2', 'sk ii', 'sk-2', 'sk 2', 'Sk-Ii'].map((query) => [`${query} returns exactly the SK-II rows`, (impl) => {
    const got = setOf(impl.search(query).ids)
    const extra = [...got].filter((id) => !SK_II.has(id))
    const missing = [...SK_II].filter((id) => !got.has(id))
    assert.ok(!extra.length && !missing.length, `extra ${extra.length} (${describe(extra)}), missing ${missing.length}`)
  }]),
  ['sk-2 never returns "Skin Tint 2"', (impl) => {
    assert.ok(!impl.search('sk-2').ids.includes(SKIN_TINT_2))
  }],
  ['hourglass love reaches "Blush Palette Love" through the brand', (impl) => {
    assert.ok(impl.search('hourglass love').ids.includes(LOVE))
  }],
  ['Khmer សេរ៉ូម returns exactly its rows', (impl) => {
    assert.ok(sameSet(setOf(impl.search('សេរ៉ូម').ids), SERUM_KM), describe(impl.search('សេរ៉ូម').ids))
  }],
  ['Khmer ឡេ returns exactly its rows, never the Morphe liner', (impl) => {
    const got = setOf(impl.search('ឡេ').ids)
    assert.ok(![...MORPHE_KM].some((id) => got.has(id)), 'Morphe ក្រឡ must not match ឡេ')
    assert.ok(sameSet(got, LOTION_KM), describe(got))
  }],
  ['an exact barcode (leading zero folded) is tier 0', (impl) => {
    const { ids, tierOf } = impl.search('85715166012')
    for (const id of BARCODE_ROWS) assert.strictEqual(tierOf.get(id), 0, nameOf(id))
    assert.ok(ids.slice(0, BARCODE_ROWS.size).every((id) => BARCODE_ROWS.has(id)))
  }],
  ['nonsense returns nothing', (impl) => {
    for (const query of ['zzzz', 'qwerty', 'xqzv', 'blorpt']) assert.strictEqual(impl.search(query).ids.length, 0, query)
  }],
  ['short tokens stay exact: spf/oil get no fuzzy tier, oli never reaches oil', (impl) => {
    for (const query of ['spf', 'oil']) {
      const { ids, tierOf } = impl.search(query)
      assert.ok(ids.length > 0 && ids.every((id) => tierOf.get(id) <= 3), query)
    }
    const oil = setOf(impl.search('oil').ids)
    const oli = impl.search('oli').ids
    assert.ok(oli.every((id) => !oil.has(id) || /\boli/i.test(text(byId.get(id)))), 'oli is not a typo of oil')
  }],
  ['elf never returns Self/Shelf', (impl) => {
    const got = setOf(impl.search('elf').ids)
    assert.ok(![...SELF].some((id) => got.has(id)))
  }],
  ['lipstik never returns a Lip Oil', (impl) => {
    const got = setOf(impl.search('lipstik').ids)
    const bad = [...LIP_OIL_ONLY].filter((id) => got.has(id))
    assert.strictEqual(bad.length, 0, describe(bad))
    assert.ok(got.size > 0, 'lipstik still reaches lipsticks')
  }],
]

// The cases each legacy implementation must FAIL (design G37 section 5, tests 1).
const LEGACY_MUST_FAIL = {
  'legacy-server': ['skii returns exactly the SK-II rows', 'sk2 returns exactly the SK-II rows', 'blush pallet (typo) reaches every blush palette', 'sk-2 never returns "Skin Tint 2"'],
  'legacy-client': ['sk2 returns exactly the SK-II rows', 'blush pallet (typo) reaches every blush palette'],
}

function runCases(impl) {
  const failed = []
  for (const [label, fn] of CASES) {
    try { fn(impl) } catch (error) { failed.push([label, error.message.split('\n')[0]]) }
  }
  return failed
}

const target = process.env.SEARCH_IMPL || 'core'
const impl = makeImpl(target, rows)
const failed = runCases(impl)
console.log(`${target}: ${CASES.length - failed.length}/${CASES.length} owner cases pass`)
for (const [label, message] of failed) console.log(`  RED ${label} -- ${message}`)

if (target !== 'core') process.exit(failed.length ? 1 : 0)

let red = failed.length
for (const legacy of Object.keys(LEGACY_MUST_FAIL)) {
  const legacyFailed = new Set(runCases(makeImpl(legacy, rows)).map(([label]) => label))
  for (const label of LEGACY_MUST_FAIL[legacy]) {
    if (legacyFailed.has(label)) console.log(`  ok  ${legacy} fails "${label}" (fixture discriminates)`)
    else { red += 1; console.log(`  RED ${legacy} passes "${label}": the fixture no longer separates old and new`) }
  }
}
if (red) { console.log(`${red} failure(s)`); process.exit(1) }
console.log('PASS test-search-core-owner-cases-pure')
