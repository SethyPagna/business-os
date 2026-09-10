import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createLatestReturnDetailRestoreRunner, getReturn } from '../src/api/returnsReadTransport.ts'
import { __resetApiHealthForTests, cacheClearAll, setSyncServerUrl, setSyncToken } from '../src/api/http.ts'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const originalFetch = globalThis.fetch
let freshFetchCount = 0
cacheClearAll()
__resetApiHealthForTests()
setSyncServerUrl('https://returns-restore.example.test')
setSyncToken('')
globalThis.fetch = (() => {
  freshFetchCount += 1
  return Promise.resolve(new Response(JSON.stringify({ id: 88, revision: freshFetchCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }))
}) as typeof fetch
try {
  const firstFresh = await getReturn(88, { fresh: true }) as { revision: number }
  const secondFresh = await getReturn(88, { fresh: true }) as { revision: number }
  assert.deepEqual([firstFresh.revision, secondFresh.revision], [1, 2], 'fresh restore reads must never reuse the 20-second detail cache')
  assert.equal(freshFetchCount, 2, 'each explicit restore read should reach the server')
} finally {
  globalThis.fetch = originalFetch
  cacheClearAll()
  __resetApiHealthForTests()
  setSyncServerUrl('')
  setSyncToken('')
}

const opened: number[] = []
const invalidated: string[] = []
const failures: number[] = []
const runner = createLatestReturnDetailRestoreRunner()

const first = deferred<{ id: number } | null>()
const second = deferred<{ id: number } | null>()
const firstRestore = runner.restore({
  readFresh: () => first.promise,
  isAllowed: () => true,
  commit: (row) => opened.push(row.id),
  onDenied: () => assert.fail('the first restore was not permission-denied'),
  onFailure: () => failures.push(1),
  onInvalidate: (reason) => invalidated.push(`${reason}:1`),
})
const secondRestore = runner.restore({
  readFresh: () => second.promise,
  isAllowed: () => true,
  commit: (row) => opened.push(row.id),
  onDenied: () => assert.fail('the second restore was not permission-denied'),
  onFailure: () => failures.push(2),
  onInvalidate: (reason) => invalidated.push(`${reason}:2`),
})

assert.deepEqual(invalidated, ['superseded:1'], 'starting a newer restore must invalidate and repark the preceding intent without consuming the new pending restore')
second.resolve({ id: 202 })
assert.equal(await secondRestore, 'opened')
first.resolve({ id: 101 })
assert.equal(await firstRestore, 'stale')
assert.deepEqual(opened, [202], 'a late response from the first restore must never replace the latest detail')
assert.equal(failures.length, 0, 'superseding an intent is not a visible load failure')

let permissionAllowed = true
let denied = 0
const revokedRead = deferred<{ id: number } | null>()
const revokedRestore = runner.restore({
  readFresh: () => revokedRead.promise,
  isAllowed: () => permissionAllowed,
  commit: (row) => opened.push(row.id),
  onDenied: () => { denied += 1 },
  onFailure: () => failures.push(303),
})
permissionAllowed = false
revokedRead.resolve({ id: 303 })
assert.equal(await revokedRestore, 'denied')
assert.equal(denied, 1, 'permission must be checked again after the fresh read resolves')
assert.deepEqual(opened, [202], 'mid-fetch permission revocation must prevent the detail from opening')

const closeRead = deferred<{ id: number } | null>()
const closeRestore = runner.restore({
  readFresh: () => closeRead.promise,
  isAllowed: () => true,
  commit: (row) => opened.push(row.id),
  onDenied: () => assert.fail('the close-invalidated restore was not denied'),
  onFailure: () => failures.push(404),
  onInvalidate: (reason) => invalidated.push(`${reason}:404`),
})
runner.invalidate()
closeRead.resolve({ id: 404 })
assert.equal(await closeRestore, 'stale')
assert.deepEqual(invalidated, ['superseded:1', 'invalidated:404'], 'close/minimize/unmount invalidation should preserve the dispatched chip once')
assert.deepEqual(opened, [202], 'an invalidated response must not reopen a closed detail')

const returnsSource = readFileSync(new URL('../src/components/returns/Returns.tsx', import.meta.url), 'utf8')
const transportSource = readFileSync(new URL('../src/api/returnsReadTransport.ts', import.meta.url), 'utf8')
assert.match(transportSource, /if \(options\.fresh\) \{[\s\S]*?return apiFetch\('GET', path,[\s\S]*?signal: options\.signal/, 'fresh detail reads must bypass route cache/dedupe and remain abortable')
assert.match(returnsSource, /fetchReturnDetail\(returnId, \{ fresh: true, signal \}\)/, 'the restore host must opt into a fresh server read')
assert.match(returnsSource, /useEffect\(\(\) => \(\) => \{[\s\S]*?returnDetailRestoreRunnerRef\.current\?\.invalidate\(\)/, 'unmount must invalidate an unfinished restore')
assert.match(returnsSource, /onClose=\{closeReturnDetail\}/, 'the detail X/backdrop close path must invalidate restore intent')
assert.match(returnsSource, /const minimizeReturnDetail = useCallback[\s\S]*?returnDetailRestoreRunnerRef\.current\?\.invalidate\(\)/, 'minimize must invalidate restore intent before parking the visible detail')

console.log('PASS return-detail restore is fresh, latest-intent-wins, permission-race-safe and invalidated on close/minimize/unmount')
