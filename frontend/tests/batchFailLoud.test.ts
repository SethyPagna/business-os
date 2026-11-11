// Regression test: a FAILED batch/lot lookup must never be presented as a
// successful "there are no lots".
//
// The bug: batchesTransport.ts passed `() => ({ productIds: [] })` and
// `() => ({ batches: [] })` as route()'s local fallback. http.ts's
// hasUsableLocalData counts ANY non-empty object as usable data (it only
// special-cases `items`/`rows`), so a 403/500/timeout resolved as a
// SUCCESSFUL empty result and was written into the read cache for up to 45s.
//
// Consequences, both silent:
//   * POS: every batch-tracked product looked untracked, so the lot picker
//     never appeared and batch-tracked stock was sold with NO lot chosen --
//     bypassing FIFO/expiry with nothing on screen to say so.
//   * The detail sheet: the definitive-sounding "No lots available at this
//     branch" was shown for a request that had never actually succeeded.
//
// "We don't know" and "there is nothing" are opposite conclusions. These are
// source-level assertions because the behaviour lives in wiring (which
// fallback is passed, which catch handler runs) rather than in a pure
// function that could be called directly.
//
// Run: node tests/batchFailLoud.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Comments are stripped before matching. These files deliberately DESCRIBE
// the removed fallbacks in prose so the next reader understands why they are
// gone -- without this, the explanation would itself trip the assertion that
// the code is absent.
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const src = (...parts: string[]) => stripComments(fs.readFileSync(path.join(here, '..', 'src', ...parts), 'utf8'))

let passed = 0
function check(name: string, fn: () => void): void {
  fn()
  console.log('PASS', name)
  passed++
}

const transport = src('api', 'batchesTransport.ts')

check('getTrackedBatchProductIds no longer resolves a failure as an empty tracked list', () => {
  assert.ok(
    !/\(\)\s*=>\s*\(\{\s*productIds:\s*\[\]\s*\}\)/.test(transport),
    'the { productIds: [] } local fallback is back -- a failed lookup would again read as "nothing is batch-tracked"',
  )
})

check('getProductBatches no longer resolves a failure as an empty lot list', () => {
  assert.ok(
    !/\(\)\s*=>\s*\(\{\s*batches:\s*\[\]\s*\}\)/.test(transport),
    'the { batches: [] } local fallback is back -- a failed lookup would again read as "no lots at this branch"',
  )
})

check('both batch reads still pass an explicit undefined fallback, so the intent stays visible', () => {
  const undefinedFallbacks = transport.match(/^\s*undefined,\s*$/gm) || []
  assert.ok(
    undefinedFallbacks.length >= 2,
    `expected both batch reads to pass an explicit undefined local fallback, found ${undefinedFallbacks.length}`,
  )
})

// ---- the detail sheet must separate "no lots" from "couldn't load lots" ----
const sheet = src('components', 'pos', 'ProductDetailSheet.tsx')

check('the lot picker distinguishes a load failure from an empty result', () => {
  assert.ok(/setBatchesError\(/.test(sheet), 'a failed lot fetch should record an error, not just an empty array')
  assert.ok(
    /\) : batchesError \? \(/.test(sheet),
    'the picker should render the error branch before the "No lots available" branch',
  )
  // Count render SITES via the empty state's pack key. This counted the
  // posCopy English literal until that bilingual pair became a pack key --
  // the sheet now mounts outside the POS too, where posCopy was stubbed to
  // an English identity, so the string had to come from the packs. One
  // occurrence per site either way.
  const noLots = (sheet.match(/t\('received_dates_none'\)/g) || []).length
  assert.ok(noLots > 0, 'the empty state must still be rendered somewhere')
  const errorBranches = (sheet.match(/\) : batchesError \? \(/g) || []).length
  assert.equal(
    errorBranches, noLots,
    'every "No lots available" render site needs its own preceding error branch',
  )
})

// ---- no call site may leave a rejection unhandled ----
for (const [label, file] of [
  ['Inventory stock modal', ['components', 'inventory', 'InventoryStockModals.tsx']],
] as const) {
  check(`${label} handles a rejected getProductBatches (it no longer falls back internally)`, () => {
    const text = src(...file)
    const callIndex = text.indexOf('getProductBatches(')
    assert.ok(callIndex >= 0, 'expected a getProductBatches call site')
    const chain = text.slice(callIndex, callIndex + 900)
    assert.ok(/\.catch\(/.test(chain), 'the promise chain needs a .catch -- otherwise a 403/500 becomes an unhandled rejection')
  })
}

const transferModal = src('components', 'branches', 'TransferModal.tsx')
check('TransferModal does not collapse a failed lookup into "nothing is tracked"', () => {
  assert.ok(
    !/if \(!cancelled\) setTrackedBatchProductIds\(new Set\(\)\)/.test(transferModal),
    'a failed lookup would drop the lot picker from transfers that need one, moving stock without recording the lot',
  )
})

console.log(`\n${passed} check(s) passed.`)
