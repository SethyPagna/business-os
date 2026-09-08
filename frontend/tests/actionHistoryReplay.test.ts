import assert from 'node:assert/strict'
import fs from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { resolveReplayAction } from '../src/utils/actionReplay.ts'

// Locks the K1 double-apply guard (resolveReplayAction): when the Worker has
// already replayed a reversal server-side (applied:true), the mutating closure
// must be skipped in favor of the refresh-only callback, so the client never
// writes the same reversal a second time (which under optimistic concurrency
// would also conflict). In every other case the original closure runs, exactly
// as before server appliers existed.

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const refresh = () => 'refreshed'
const action = () => 'mutated'

const actionHistorySource = fs.readFileSync(new URL('../src/utils/actionHistory.ts', import.meta.url), 'utf8')
const replayRequestHelperSource = actionHistorySource.match(/export function buildServerReplayRequest[\s\S]*?\n}\n/)?.[0]
assert.ok(replayRequestHelperSource, 'the server replay request helper is present')
const buildServerReplayRequest = new Function(
  `${stripTypeScriptTypes(replayRequestHelperSource.replace('export ', ''))}; return buildServerReplayRequest`,
)() as (payload: Record<string, unknown> | undefined) => Record<string, unknown>

await runTest('generation-guarded server appliers send their exact expected generation', () => {
  for (const applier of ['product.merge.group', 'product.merge.bulk', 'sale.settlement']) {
    assert.deepEqual(
      buildServerReplayRequest({ applier, generation: 0 }),
      { require_applied: true, expected_generation: 0 },
      `${applier} keeps generation zero rather than dropping it`,
    )
  }
  assert.match(actionHistorySource, /const replayRequest = buildServerReplayRequest\(payload\)/, 'Undo and Redo share the guarded request builder')
})

await runTest('unguarded and generation-less server appliers retain the existing request shape', () => {
  assert.deepEqual(buildServerReplayRequest({ applier: 'product.merge', generation: 7 }), { require_applied: true })
  assert.deepEqual(buildServerReplayRequest({ applier: 'product.merge.group' }), { require_applied: true })
})

await runTest('server applied + a refresh callback -> the refresh runs, not the mutating closure', () => {
  const chosen = resolveReplayAction({ serverApplied: true, refresh, action })
  assert.strictEqual(chosen, refresh)
  assert.strictEqual(chosen?.(), 'refreshed')
})

await runTest('server applied but NO refresh callback -> falls back to the closure (never a no-op)', () => {
  const chosen = resolveReplayAction({ serverApplied: true, refresh: undefined, action })
  assert.strictEqual(chosen, action)
})

await runTest('server did NOT apply -> the closure runs even when a refresh callback exists (client-replay path unchanged)', () => {
  const chosen = resolveReplayAction({ serverApplied: false, refresh, action })
  assert.strictEqual(chosen, action)
})

await runTest('server did NOT apply and there is no closure -> undefined (nothing to run)', () => {
  const chosen = resolveReplayAction({ serverApplied: false, refresh: undefined, action: undefined })
  assert.strictEqual(chosen, undefined)
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll resolveReplayAction checks passed.')
