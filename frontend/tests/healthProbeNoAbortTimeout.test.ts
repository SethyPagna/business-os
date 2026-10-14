// Safari/iOS 15.4 to 15.8 have no AbortSignal.timeout. An unguarded call threw inside the /health probe, so every connection check
// failed, saving stayed blocked and Check connection could not clear it. With the function missing the probe must still succeed
// against a good /health and still time out against a hanging one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const storage = (): Storage => {
  const values = new Map<string, string>()
  return {
    get length() { return values.size }, clear: () => values.clear(), key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, String(v)) }, removeItem: (k: string) => { values.delete(k) },
  }
}
const win = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage(), location: { origin: 'https://till.example.test', hostname: 'till.example.test', port: '' } })
Object.assign(globalThis, { window: win })

const { pingServerHealth, setSyncServerUrl, __resetApiHealthForTests } = await import('../src/api/http.ts')
const { timeoutSignal } = await import('../src/utils/abortTimeout.ts')

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const realFetch = globalThis.fetch
const realTimeout = AbortSignal.timeout
Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true })

function hangingUntilAborted(): void {
  globalThis.fetch = ((_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
  })) as typeof fetch
}

try {
  setSyncServerUrl('https://till.example.test')
  assert.equal(typeof AbortSignal.timeout, 'undefined', 'the stub models a browser without AbortSignal.timeout')

  await check('a good /health answers online when AbortSignal.timeout is missing', async () => {
    __resetApiHealthForTests()
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as typeof fetch
    const result = await pingServerHealth(true)
    assert.equal(result.online, true)
    assert.equal(result.status, 200)
  })

  await check('a hanging /health still times out as offline when AbortSignal.timeout is missing', async () => {
    __resetApiHealthForTests()
    hangingUntilAborted()
    const startedAt = Date.now()
    const result = await pingServerHealth(true)
    const elapsed = Date.now() - startedAt
    assert.equal(result.online, false)
    assert.ok(elapsed >= 3_500 && elapsed < 6_000, `timed out after the probe limit, not at once and not never (${elapsed} ms)`)
  })

  await check('the fallback timer is cleared once the probe settles', async () => {
    __resetApiHealthForTests()
    const timers = new Set<unknown>()
    const realSet = globalThis.setTimeout
    const realClear = globalThis.clearTimeout
    globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
      const id = realSet(fn, ms, ...rest)
      if (ms === 4_000) timers.add(id)
      return id
    }) as typeof setTimeout
    globalThis.clearTimeout = ((id: Parameters<typeof clearTimeout>[0]) => { timers.delete(id); realClear(id) }) as typeof clearTimeout
    try {
      globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch
      await pingServerHealth(true)
      assert.equal(timers.size, 0, 'no 4 s timer left running after a fast answer')
    } finally {
      globalThis.setTimeout = realSet
      globalThis.clearTimeout = realClear
    }
  })

  await check('timeoutSignal uses the native signal when it exists and works without one', () => {
    Object.defineProperty(AbortSignal, 'timeout', { value: realTimeout, configurable: true, writable: true })
    const native = timeoutSignal(50)
    assert.ok(native.signal instanceof AbortSignal)
    native.clear()
    Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true, writable: true })
    const fallback = timeoutSignal(50)
    assert.ok(fallback.signal instanceof AbortSignal)
    assert.equal(fallback.signal?.aborted, false)
    fallback.clear()
  })

  await check('no source file calls AbortSignal.timeout without a guard', () => {
    const files = ['../src/api/http.ts', '../src/components/server/ServerPage.tsx']
    for (const file of files) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      assert.doesNotMatch(source, /AbortSignal\.timeout/, `${file} goes through timeoutSignal`)
    }
  })
} finally {
  globalThis.fetch = realFetch
  Object.defineProperty(AbortSignal, 'timeout', { value: realTimeout, configurable: true, writable: true })
}

if (failed > 0) process.exit(1)
console.log('healthProbeNoAbortTimeout: all passed')
