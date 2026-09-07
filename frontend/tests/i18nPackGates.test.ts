import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { duplicateTopLevelKeys, fallbackSlotRegressions } from '../../ops/scripts/frontend/i18nPackChecks.ts'

// Two whole classes of pack defect that every gate on this repo was blind to,
// both found live in en.json/km.json on 2026-09-06.
//
// 1. DUPLICATE TOP-LEVEL KEYS. Two lanes add the same key at different places
//    in the file and git auto-merges both without a conflict -- the shapes
//    never touch. JSON.parse then silently keeps the LAST one, so the earlier
//    definition is dead and no reader can tell. verify:i18n parsed the packs
//    before looking at them, so it could not see this by construction; it must
//    read the raw text.
//
// 2. A PACK VALUE THAT DROPS A PLACEHOLDER ITS CALL SITE SUBSTITUTES. The
//    existing slot check compares en against km, so it passes when BOTH packs
//    lost the same slot. That is exactly what happened to
//    confirm_complete_stock_session_mixed: the source substitutes {lines},
//    {adds}, {removes}, {sets} and {branch}, both packs shipped a value with
//    none of them, and a mutating stock confirmation silently lost its line
//    count, its add/remove/set breakdown and its branch name in both languages.
//
// The two checks live in ops/scripts/frontend/i18nPackChecks.ts so they can be
// run on crafted input here, not only on whatever the packs happen to hold.

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8')

runTest('a duplicated top-level key is reported, with both line numbers', () => {
  const pack = [
    '{',
    '  "add_payment_method": "Add Payment Method",',
    '  "cost_price": "Cost Price",',
    '  "add_payment_method": "Add payment method"',
    '}',
    '',
  ].join('\n')
  const found = duplicateTopLevelKeys(pack)
  assert.equal(found.length, 1)
  assert.match(found[0], /add_payment_method/)
  assert.match(found[0], /line 2/)
  assert.match(found[0], /line 4/)
})

runTest('a pack with no duplicates reports nothing', () => {
  const pack = '{\n  "a": "1",\n  "b": "2"\n}\n'
  assert.deepEqual(duplicateTopLevelKeys(pack), [])
})

runTest('nested keys that repeat an outer name are not duplicates', () => {
  // Only TOP-LEVEL keys collide under JSON.parse; a same-named key one level
  // deeper is a different key and must not be reported.
  const pack = '{\n  "a": "1",\n  "group": {\n    "a": "2"\n  }\n}\n'
  assert.deepEqual(duplicateTopLevelKeys(pack), [])
})

runTest('the shipped packs carry no duplicate top-level key', () => {
  for (const name of ['en.json', 'km.json']) {
    assert.deepEqual(duplicateTopLevelKeys(read(`../src/lang/${name}`)), [], name)
  }
})

runTest('a pack value that drops a slot its call site substitutes is reported', () => {
  const sources = [{
    file: 'FastStockInModal.tsx',
    text: "tr('confirm_mixed', 'Post {lines} line(s) for {branch}?')",
  }]
  const problems = fallbackSlotRegressions(sources, {
    en: { confirm_mixed: 'Post the stock lines?' },
    km: { confirm_mixed: 'Post {lines} line(s) for {branch}?' },
  })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /confirm_mixed/)
  assert.match(problems[0], /en\.json/)
  assert.match(problems[0], /\{lines\}/)
  assert.match(problems[0], /\{branch\}/)
})

runTest('BOTH packs dropping the same slot is still caught -- the en/km check is not', () => {
  const sources = [{ file: 'x.tsx', text: "tr('k', 'a {n} b')" }]
  const problems = fallbackSlotRegressions(sources, { en: { k: 'a b' }, km: { k: 'a b' } })
  assert.equal(problems.length, 2, 'one per pack')
})

runTest('a pack that adds a slot the fallback does not have is fine', () => {
  // Khmer word order legitimately needs a slot English states inline; only a
  // DROPPED slot loses data.
  const sources = [{ file: 'x.tsx', text: "tr('k', 'Branch {branch}')" }]
  assert.deepEqual(fallbackSlotRegressions(sources, {
    en: { k: 'Branch {branch}' },
    km: { k: '{branch} {extra}' },
  }), [])
})

runTest('the three-argument tr(t, key, fallback) shape is read too', () => {
  const sources = [{ file: 'x.tsx', text: "tr(t, 'k', 'Total {n}')" }]
  assert.equal(fallbackSlotRegressions(sources, { en: { k: 'Total' }, km: { k: 'Total {n}' } }).length, 1)
})

runTest('a key with no pack entry is left to the unresolved-key check', () => {
  const sources = [{ file: 'x.tsx', text: "tr('nowhere', 'Total {n}')" }]
  assert.deepEqual(fallbackSlotRegressions(sources, { en: {}, km: {} }), [])
})

runTest('the live confirm_complete_stock_session_mixed keeps all five slots', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const [pack, value] of [['en', en], ['km', km]] as const) {
    const text = String(value.confirm_complete_stock_session_mixed)
    for (const slot of ['{lines}', '{adds}', '{removes}', '{sets}', '{branch}']) {
      assert.ok(text.includes(slot), `${pack}.confirm_complete_stock_session_mixed lost ${slot}`)
    }
  }
})

if (failed > 0) {
  process.exitCode = 1
}
