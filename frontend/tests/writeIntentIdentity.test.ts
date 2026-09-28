import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// SCAN1 F2/F5 (28 Sep 2026): a write modal raced its POST against a 12-15 s
// UI timer (withLoaderTimeout) while the fetch itself stays alive for 45 s
// (api/http.ts WRITE_REQUEST_TIMEOUT_MS). The timer rejected with "... Please
// try again.", the POST committed a few seconds later, and the retry minted a
// FRESH client_request_id -- so the Worker's dedupe saw a new request and
// applied it twice (a second refund + restock, a second supplier return,
// double loyalty points, a second stock adjust).
//
// This file pins the two helpers the fix is built on, by behaviour:
//   * identityForIntent: ONE identity per operator intent. The same intent
//     re-sent (the retry) reuses it; a changed intent mints a new one (reusing
//     it would be a fingerprint conflict, or -- for supplier returns, whose
//     Worker dedupe has no digest -- a silent replay of the OLD return).
//   * retryableRequestId: an undo/redo closure's id, stable across retries of
//     that closure until it succeeds, then rotated so the NEXT undo is a new
//     request rather than a replay of the last one.
//   * withWriteTimeout: the timeout says the outcome is UNKNOWN and to check
//     before retrying, in both language packs, and carries the machine fields
//     presentWriteError keys on.

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const translate = (pack: Record<string, string>) => (key: string) => pack[key]

type IdentityRef<T> = { current: { intent: string; identity: T } | null }
type WriteIntentModule = {
  identityForIntent?: <T>(ref: IdentityRef<T>, intent: unknown, mint: () => T) => T
  retryableRequestId?: (prefix: string) => { current(): string; settle(): void }
  withWriteTimeout?: <T>(loader: () => T | Promise<T>, label: string, timeoutMs: number, t?: (key: string) => string | undefined) => Promise<T>
}
type LoadersModule = {
  withLoaderTimeout: <T>(loader: () => T | Promise<T>, label: string, timeoutMs: number) => Promise<T>
}

const sourceOf = (relative: string): string => {
  try {
    return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8')
  } catch {
    return ''
  }
}
// The helpers are admin-only (write modals), so they live in their own module.
const writeIntent = (sourceOf('utils/writeIntent.ts') ? await import('../src/utils/writeIntent.ts') : {}) as WriteIntentModule
const loaders = await import('../src/utils/loaders.ts') as unknown as LoadersModule
const { presentWriteError } = await import('../src/utils/writeErrorPresentation.ts')

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

await runTest('identityForIntent reuses one identity for the same intent and mints for a changed one', () => {
  const { identityForIntent } = writeIntent
  assert.equal(typeof identityForIntent, 'function', 'utils/writeIntent.ts must export identityForIntent')
  let minted = 0
  const mint = () => ({ client_request_id: `ret_${++minted}`, return_number: `RET-${minted}` })
  const ref: IdentityRef<ReturnType<typeof mint>> = { current: null }
  const intent = { sale_id: 7, items: [{ sale_item_id: 1, quantity: 1 }], reason: 'Damaged' }
  const first = identityForIntent!(ref, intent, mint)
  // The retry after "outcome unknown": a NEW object with the same content.
  const retry = identityForIntent!(ref, { sale_id: 7, items: [{ sale_item_id: 1, quantity: 1 }], reason: 'Damaged' }, mint)
  assert.deepEqual(retry, first, 'the retry must resend the SAME id and return number, so the Worker replays instead of applying twice')
  assert.equal(minted, 1)
  const changed = identityForIntent!(ref, { ...intent, items: [{ sale_item_id: 1, quantity: 2 }] }, mint)
  assert.notEqual(changed.client_request_id, first.client_request_id, 'a different return is a different request')
  assert.equal(minted, 2)
  ref.current = null
  const afterSuccess = identityForIntent!(ref, { ...intent, items: [{ sale_item_id: 1, quantity: 2 }] }, mint)
  assert.notEqual(afterSuccess.client_request_id, changed.client_request_id, 'after a committed write the next identical return is a NEW request')
})

await runTest('retryableRequestId stays put across failed attempts and rotates only after success', () => {
  const { retryableRequestId } = writeIntent
  assert.equal(typeof retryableRequestId, 'function', 'utils/writeIntent.ts must export retryableRequestId')
  const undoId = retryableRequestId!('stockadjust-undo')
  const attempt1 = undoId.current()
  assert.match(attempt1, /^stockadjust-undo_/)
  assert.equal(undoId.current(), attempt1, 'a retried undo after a lost answer must replay the same request')
  undoId.settle()
  const nextUndo = undoId.current()
  assert.notEqual(nextUndo, attempt1, 'the next undo (after a redo) is a new request, not a replay of the last one')
  assert.equal(undoId.current(), nextUndo)
})

await runTest('withWriteTimeout reports an unknown outcome in English and Khmer, never "try again"', async () => {
  const { withWriteTimeout } = writeIntent
  assert.equal(typeof withWriteTimeout, 'function', 'utils/writeIntent.ts must export withWriteTimeout')
  const never = () => new Promise<never>(() => {})
  for (const [pack, label] of [[en, 'en'], [km, 'km']] as const) {
    const error = await withWriteTimeout!(never, 'Create return', 20, translate(pack)).then(
      () => { throw new Error('expected a timeout') },
      (reason: unknown) => reason as Error & { code?: string; outcome?: string; timeoutMs?: number },
    )
    assert.equal(error.code, 'loader_timeout', `${label}: keeps the code directMutationOutcomeIsUnknown and POS already read`)
    assert.equal(error.outcome, 'unknown', `${label}: the outcome is unknown, not failed`)
    assert.equal(error.timeoutMs, 20)
    assert.equal(error.message, pack.write_outcome_unknown_timeout.replace('{seconds}', '1'), `${label}: the pack sentence`)
    assert.doesNotMatch(error.message, /try again\.?$/i)
    assert.equal(presentWriteError(error, translate(pack)).unknownOutcome, true, `${label}: the shared presenter recognises it`)
  }
  assert.match(km.write_outcome_unknown_timeout, /[ក-៿]/, 'the Khmer sentence is really Khmer')
  const untranslated = await withWriteTimeout!(never, 'Award points', 20).catch((reason: Error) => reason)
  assert.match(untranslated.message, /may have been processed\. Check the record before trying again/)
})

await runTest('withWriteTimeout passes a result or a real refusal through untouched', async () => {
  const { withWriteTimeout } = writeIntent
  assert.equal(typeof withWriteTimeout, 'function')
  assert.equal(await withWriteTimeout!(async () => 42, 'Adjust', 1_000), 42)
  const refusal = Object.assign(new Error('Only 2 available'), { code: 'insufficient_stock' })
  const passed = await withWriteTimeout!(async () => { throw refusal }, 'Adjust', 1_000).catch((reason: unknown) => reason)
  assert.equal(passed, refusal, 'a refusal is a KNOWN outcome and must not be reworded as unknown')
})

await runTest('reads keep their own timeout wording (withLoaderTimeout is unchanged)', async () => {
  const error = await loaders.withLoaderTimeout(() => new Promise<never>(() => {}), 'Load returns', 20).catch((reason: Error) => reason)
  assert.match(error.message, /^Load returns took longer than 0s\. Please try again\.$/)
})

// The storefront loads loaders.ts and requestIds.ts (vite.config.ts routes
// them to the shared 'route-sync-utils' and 'request-ids' chunks), so what
// they import ships to every catalog visitor. Putting the write helpers there
// pulled writeErrorPresentation.ts into the catalog-products closure and
// pushed it past its +10% budget (tests/performanceBudgets.test.ts, which
// needs a build); this pins the same boundary on the source.
await runTest('the admin-only write helpers stay off the storefront chunks', () => {
  const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/utils\/loaders\.ts'\)\) return 'route-sync-utils'/)
  assert.match(viteConfig, /normalized\.endsWith\('\/src\/api\/requestIds\.ts'\)\) return 'request-ids'/)
  assert.doesNotMatch(viteConfig, /writeIntent/, 'writeIntent.ts must not be routed into a shared (storefront) chunk')
  const loadersSource = sourceOf('utils/loaders.ts')
  assert.doesNotMatch(loadersSource, /writeErrorPresentation|withWriteTimeout|createWriteTimeoutError/, 'loaders.ts ships to the storefront: no write-outcome helpers or their presenter')
  assert.doesNotMatch(sourceOf('api/requestIds.ts'), /identityForIntent|retryableRequestId/, 'requestIds.ts ships to the storefront: no per-intent helpers')
  const helpers = sourceOf('utils/writeIntent.ts')
  for (const name of ['identityForIntent', 'retryableRequestId', 'withWriteTimeout', 'createWriteTimeoutError']) {
    assert.match(helpers, new RegExp(`export (?:async )?function ${name}\\b`), `utils/writeIntent.ts exports ${name}`)
  }
})

if (failed) {
  console.error(`${failed} write intent identity test(s) failed`)
  process.exit(1)
}
console.log('write intent identity: all cases pass')
