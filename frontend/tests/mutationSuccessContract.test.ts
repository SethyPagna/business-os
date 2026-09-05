// A whole class of "the UI showed an error but the write actually went through"
// bugs comes from one mistake: gating a mutation's success branch on a bare
// `result.success` when the endpoint returns the entity itself with NO `success`
// flag (a real failure is thrown by apiFetch instead). The POS checkout had it;
// so did the single stock transfer ("Transfer failed" while the stock moved) and
// branch delete ("Cannot delete branch" while it was deleted).
//
// The safe, codebase-wide pattern is to treat a returned result as success
// UNLESS the server explicitly said otherwise: `result?.success === false` for
// the error case, `result?.success !== false` for the success case. That works
// whether or not the endpoint sends a flag. These files were fixed to it; this
// test keeps them there by forbidding the bare `if (!x.success)` / `if (x.success)`
// form (which treats an ABSENT flag as failure).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

// Matches a bare require-success test: `if (x.success)`, `if (!x.success)`,
// `if (x?.success)`, `if (!x?.success)` -- but NOT `=== false` / `!== false`
// (those have more after `.success`, so the closing paren doesn't follow).
const BARE_SUCCESS_CHECK = /if \(!?[A-Za-z_$][\w$]*\??\.success\)/g

// Files whose write handlers hit endpoints that return the entity WITHOUT a
// success flag, so they MUST use the ===false / !==false form.
const GUARDED_FILES = [
  'src/components/branches/TransferModal.tsx',
  'src/components/branches/Branches.tsx',
  'src/components/pos/POS.tsx',
]

for (const rel of GUARDED_FILES) {
  runTest(`${rel} uses the explicit success===false contract, not a bare success check`, () => {
    const source = readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    const matches = source.match(BARE_SUCCESS_CHECK) || []
    assert.deepEqual(
      matches,
      [],
      `bare require-success check(s) found (${matches.join(', ')}) -- a mutation whose endpoint omits a success flag would read this as failure. Use \`?.success === false\` / \`?.success !== false\`.`,
    )
  })
}

runTest('the transfer + branch-delete fixes are present (positive assertion)', () => {
  const transfer = readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
  assert.match(transfer, /res\?\.success !== false/, 'the transfer handlers must accept a flag-less success')
  const branches = readFileSync(new URL('../src/components/branches/Branches.tsx', import.meta.url), 'utf8')
  assert.match(branches, /res\?\.success === false/, 'branch delete must only fail on an explicit success:false')
})

runTest('sale status mutations preserve normal notes and omit settlement notes', () => {
  const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
  assert.match(
    sales,
    /const isSettlementRequest = Array\.isArray\([\s\S]*?runSaleStatusMutation\(saleId, newStatus, isSettlementRequest \? undefined : notes, extra\)/,
    'the shared status guard must pass notes for ordinary transitions and omit them only for a tender settlement',
  )
  assert.doesNotMatch(
    sales,
    /await runSaleStatusMutation\(saleId, newStatus, notes, extra\)/,
    'settlement must not regress to always sending the notes field rejected by its route contract',
  )
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} mutation-success-contract test(s) failed`)
} else {
  console.log('\nAll mutation-success-contract tests passed')
}
