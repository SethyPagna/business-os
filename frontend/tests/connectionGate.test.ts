// Owner rule (offline mode cancelled, 26 Sep 2026): no connection = a global banner + blocked saving. The banner and every
// saving gate read ONE signal, the app context's canWriteToServer, which is `!syncServerUnreachable` plus the link and the
// session. This pins how that flag is driven by a plain connection drop:
//   - the browser's `offline` event blocks saving at once, with no write attempted first;
//   - a /health probe that fails (captive portal, server down, navigator still true) blocks it too;
//   - a browser that already loaded offline starts blocked.
// The real http.ts probe feeds the real connectionWatch here; only the browser (an EventTarget) and fetch are modelled.
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
const { watchConnection } = await import('../src/utils/connectionWatch.ts')

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const realFetch = globalThis.fetch
function serverReturns(response: () => Promise<Response>): void { globalThis.fetch = (async () => response()) as typeof fetch }
const flags: boolean[] = []
const unwatch = (browserOnline = true) => watchConnection(win as unknown as EventTarget & { addEventListener: never }, (unreachable) => { flags.push(unreachable) }, () => browserOnline)

try {
  setSyncServerUrl('https://till.example.test')

  await check('the browser offline event blocks saving at once, before any write is tried', () => {
    flags.length = 0
    const stop = unwatch()
    assert.deepEqual(flags, [], 'online at start: nothing is flagged')
    win.dispatchEvent(new Event('offline'))
    assert.deepEqual(flags, [true], 'offline flags the server unreachable synchronously')
    stop()
    win.dispatchEvent(new Event('offline'))
    assert.deepEqual(flags, [true], 'after the watch is disposed, events no longer reach it')
  })

  await check('a browser that loaded offline starts blocked', () => {
    flags.length = 0
    const stop = unwatch(false)
    assert.deepEqual(flags, [true])
    stop()
  })

  await check('a failed /health probe blocks saving even though navigator still says online', async () => {
    flags.length = 0
    __resetApiHealthForTests()
    const stop = unwatch()
    serverReturns(async () => { throw new TypeError('Failed to fetch') })
    const result = await pingServerHealth(true)
    assert.equal(result.online, false)
    assert.deepEqual(flags, [true], 'the probe failure reached the flag')
    stop()
  })

  await check('control: a healthy /health probe does not block saving', async () => {
    flags.length = 0
    __resetApiHealthForTests()
    const stop = unwatch()
    serverReturns(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    const result = await pingServerHealth(true)
    assert.equal(result.online, true)
    assert.ok(!flags.includes(true), 'a reachable server never flags unreachable')
    stop()
  })

  await check('wiring: AppContext runs the watch for the whole signed-in life and keeps canWriteToServer as the one flag', () => {
    const context = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(context, /return watchConnection\(window, setSyncServerUnreachable, \(\) => navigator\.onLine !== false\)/)
    assert.match(context, /const canWriteToServer = !!syncUrl && !syncServerUnreachable && !isActorSessionQuarantined\(\)/)
    const pos = readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
    assert.doesNotMatch(pos, /navigator\.onLine|useBrowserOnline/, 'the till does not keep a second connection flag of its own')
  })
} finally {
  globalThis.fetch = realFetch
}

if (failed) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nconnectionGate: all checks passed')
