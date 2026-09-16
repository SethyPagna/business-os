import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// N27 merge guard.
//
// The stock-change vocabulary this lane added landed a second time when the
// integration tip was merged in: the same ten keys appeared twice in each
// pack, the LATER copy being a placeholder-free paraphrase. JSON.parse keeps
// the last definition, so the app silently loaded the paraphrase and the
// completion confirmation lost every value it was supposed to name --
// "Complete this stock session with mixed results?" instead of
// "Post 3 stock line(s) - 1 add . 1 remove . 1 set - for Shop?".
//
// Discriminating by construction: a JSON.parse round-trip cannot see this at
// all (both packs parse fine, and every key resolves), and verify:i18n only
// compares the two packs' key SETS -- which stayed identical. Only counting
// the raw definition lines catches it. The placeholder assertion is the second
// half: it fails on the surviving paraphrase even if the duplicate were
// deduplicated the wrong way round.

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

const packs = {
  en: readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8'),
  km: readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8'),
}

// The ten keys the N27 mode switch introduced.
const N27_KEYS = [
  'complete_stock_session_changes',
  'confirm_complete_stock_session_mixed',
  'fast_stock_auto_lot',
  'fast_stock_mode_hint',
  'fast_stock_set_hint',
  'set_to',
  'stock_action',
  'stock_change_session_reason',
  'stock_line_removed',
  'stock_line_set',
]

function countDefinitions(source: string, key: string): number {
  return source.split(/\r?\n/).filter((line) => line.startsWith(`  "${key}":`)).length
}

runTest('N27: each stock-change key is defined exactly once per pack', () => {
  for (const [name, source] of Object.entries(packs)) {
    for (const key of N27_KEYS) {
      assert.equal(countDefinitions(source, key), 1, `${name}.json should define "${key}" exactly once`)
    }
  }
})

runTest('N27: the mixed-session confirmation names its values in both packs', () => {
  for (const [name, source] of Object.entries(packs)) {
    const pack = JSON.parse(source) as Record<string, string>
    const value = String(pack.confirm_complete_stock_session_mixed || '')
    for (const token of ['{lines}', '{adds}', '{removes}', '{sets}', '{branch}']) {
      assert.ok(value.includes(token), `${name}.json confirm_complete_stock_session_mixed should carry ${token}, got: ${value}`)
    }
  }
})

if (failed) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
console.log('\nAll stock-in session i18n key tests passed')
