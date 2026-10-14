// Owner rule (offline mode cancelled, 26 Sep 2026): no connection = a global banner + blocked saving, and every blocking state
// needs a way through. The banner and every saving gate read ONE signal, the app context's canWriteToServer, which is
// `!syncServerUnreachable` plus the link and the session. This pins how that flag is driven:
//   - a plain connection drop (the browser's offline event, a failed /health probe, a page that loaded offline) blocks at once;
//   - when navigator.onLine is wrong but the server answers, the flag clears: on a good /health probe, on the online event,
//     and on the Check connection action; a flag set by a websocket failure or a blocked write does not stick when HTTP is fine;
//   - a reachable server whose build does not match this app stays blocked;
//   - the sale write asks the server itself when the browser says offline, instead of trusting the flag.
// The real http.ts probe feeds the real connectionWatch here; only the browser (an EventTarget) and fetch are modelled.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

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
type Probe = () => Promise<{ online: boolean; cloudflareAccessRequired?: boolean; runtimeMismatch?: boolean }>

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const realFetch = globalThis.fetch
function serverReturns(response: () => Promise<Response>): void { globalThis.fetch = (async () => response()) as typeof fetch }
const flags: boolean[] = []
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
function watch(probe: Probe, browserOnline = true, now: () => number = Date.now) {
  flags.length = 0
  return watchConnection(win as unknown as Parameters<typeof watchConnection>[0], (unreachable) => { flags.push(unreachable) }, () => browserOnline, probe, now)
}
const serverUp: Probe = async () => ({ online: true })
const serverDown: Probe = async () => ({ online: false })

try {
  setSyncServerUrl('https://till.example.test')

  await check('the browser offline event blocks saving at once, before any write is tried', () => {
    const w = watch(serverUp)
    assert.deepEqual(flags, [], 'online at start: nothing is flagged')
    win.dispatchEvent(new Event('offline'))
    assert.deepEqual(flags, [true], 'offline flags the server unreachable synchronously')
    w.dispose()
    win.dispatchEvent(new Event('offline'))
    assert.deepEqual(flags, [true], 'after the watch is disposed, events no longer reach it')
  })

  await check('a failed /health probe blocks saving even though navigator still says online', async () => {
    __resetApiHealthForTests()
    const w = watch((() => pingServerHealth(true)) as Probe)
    serverReturns(async () => { throw new TypeError('Failed to fetch') })
    const result = await pingServerHealth(true)
    assert.equal(result.online, false)
    assert.deepEqual(flags, [true], 'the probe failure reached the flag')
    w.dispose()
  })

  await check('a browser that loaded offline starts blocked', async () => {
    const w = watch(serverDown, false)
    assert.deepEqual(flags, [true])
    await settle()
    assert.deepEqual(flags, [true, true], 'and it asks the server straight away (still unreachable here)')
    w.dispose()
  })

  await check('navigator.onLine stuck false while /health answers: the flag clears by itself', async () => {
    const w = watch(serverUp, false)
    await settle()
    assert.deepEqual(flags, [true, false], 'blocked at first sight, cleared by the first good probe')
    w.dispose()
  })

  await check('a good /health probe clears a flag a websocket failure or a blocked write left set', async () => {
    __resetApiHealthForTests()
    const w = watch((() => pingServerHealth(true)) as Probe)
    serverReturns(async () => { throw new TypeError('Failed to fetch') })
    await pingServerHealth(true)
    assert.deepEqual(flags, [true])
    serverReturns(async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    await pingServerHealth(true)
    assert.deepEqual(flags, [true, false], 'the next good probe cleared it')
    w.dispose()
  })

  await check('the online event re-probes and clears; a synthetic online event does not clear while the server is down', async () => {
    let up = false
    const w = watch(async () => ({ online: up }))
    win.dispatchEvent(new Event('offline'))
    win.dispatchEvent(new Event('online'))
    await settle()
    assert.deepEqual(flags, [true, true], 'online with the server still down stays blocked')
    up = true
    win.dispatchEvent(new Event('online'))
    await settle()
    assert.deepEqual(flags, [true, true, false], 'online with the server answering clears')
    w.dispose()
  })

  await check('a blocked write sets the flag and a verifying probe clears it when HTTP is fine, at most one probe per 4 s', async () => {
    let probes = 0
    let clock = 10_000
    const w = watch(async () => { probes += 1; return { online: true } }, true, () => clock)
    win.dispatchEvent(new Event('sync:write-blocked'))
    win.dispatchEvent(new Event('sync:write-blocked'))
    await settle()
    assert.equal(probes, 1, 'two blocked writes in the same second probe once')
    assert.deepEqual(flags.slice(0, 2), [true, true])
    assert.equal(flags.at(-1), false, 'the flag did not stick')
    clock += 4_001
    win.dispatchEvent(new Event('sync:write-blocked'))
    await settle()
    assert.equal(probes, 2)
    w.dispose()
  })

  await check('a reachable server on a different build stays blocked, and so does a Cloudflare Access redirect', async () => {
    const mismatch = watch(async () => ({ online: true, runtimeMismatch: true }))
    win.dispatchEvent(new Event('offline'))
    win.dispatchEvent(new CustomEvent('server:probe', { detail: { online: true, runtimeMismatch: true } }))
    win.dispatchEvent(new CustomEvent('server:probe', { detail: { online: true, cloudflareAccessRequired: true } }))
    assert.deepEqual(flags, [true], 'neither probe cleared the flag')
    mismatch.dispose()
  })

  await check('Check connection (recheck) asks once at a time, returns what the server said, and a throwing probe counts as down', async () => {
    let probes = 0
    let release: (value: { online: boolean }) => void = () => {}
    const w = watch(() => { probes += 1; return new Promise((resolve) => { release = resolve }) })
    const first = w.recheck()
    const second = w.recheck()
    assert.equal(probes, 1, 'a second tap while a probe is in flight reuses it')
    release({ online: true })
    assert.equal(await first, true)
    assert.equal(await second, true)
    assert.deepEqual(flags, [false])
    w.dispose()
    const broken = watch(async () => { throw new Error('boom') })
    assert.equal(await broken.recheck(), false)
    assert.deepEqual(flags, [true])
    broken.dispose()
  })

  await check('the sale write asks the server when navigator says offline, and refuses only if it does not answer', async () => {
    const calls: string[] = []
    let reachable = false
    const noop = () => {}
    const owner = await import('../src/api/offlineQueueOwnership.ts')
    const deps: Record<string, unknown> = {
      '../utils/deviceInfo.ts': { getClientDeviceInfo: () => ({}) },
      './http.ts': {
        apiFetch: async (method: string) => { calls.push(method); return { id: 1 } }, confirmServerReachable: async () => { calls.push('probe'); return reachable },
        isNetErr: () => false, isTransientGatewayError: () => false, isWriteBlockedError: () => false, isWriteConflictError: () => false, route: (_channel: string, run: () => unknown) => run(),
      },
      './lazyLocalDb.ts': { getLocalDb: async () => ({}) },
      './actorReadScope.ts': { captureActorReadScope: () => 1, isActorReadScopeCurrent: () => true },
      './offlineQueueOwnership.ts': owner,
      './syncRuntime.ts': { OFFLINE_SALE_SYNC_UPDATE_CHANNELS: [], dispatchSyncUpdates: noop, emitSyncQueueChanged: noop },
    }
    const output = ts.transpileModule(read('../src/api/saleWriteTransport.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    const module = { exports: {} as Record<string, (payload: Record<string, unknown>) => Promise<unknown>> }
    new Function('require', 'module', 'exports', output)((key: string) => { assert.ok(key in deps, key); return deps[key] }, module, module.exports)
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true })
    const signedIn = { getItem: () => JSON.stringify({ id: 71, organization_id: null }) } as unknown as Storage
    const { sessionStorage, localStorage } = win
    Object.assign(win, { sessionStorage: signedIn, localStorage: signedIn })
    try {
      await assert.rejects(module.exports.createSale({ items: [] }), (error: { code?: string }) => error.code === 'online_required')
      assert.deepEqual(calls, ['probe'], 'down: the probe ran and no sale was sent')
      calls.length = 0
      reachable = true
      await module.exports.createSale({ items: [] })
      assert.deepEqual(calls.slice(0, 2), ['probe', 'POST'], 'server answered: the sale goes out although navigator.onLine is false')
    } finally {
      Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true })
      Object.assign(win, { sessionStorage, localStorage })
    }
  })

  await check('wiring: AppContext runs the watch with a forced /health probe, offers recheckConnection, and keeps canWriteToServer as the one flag', () => {
    const context = read('../src/AppContext.tsx')
    assert.match(context, /watchConnection\(window, setSyncServerUnreachable, \(\) => navigator\.onLine !== false, \(\) => pingServerHealth\(true\)\)/)
    assert.match(context, /const recheckConnection = useCallback\(\(\) => connectionWatchRef\.current\?\.recheck\(\) \?\? Promise\.resolve\(false\), \[\]\)/)
    assert.match(context, /const canWriteToServer = !!syncUrl && !syncServerUnreachable && !isActorSessionQuarantined\(\)/)
    assert.match(read('../src/App.tsx'), /\{offline \? <CheckConnectionButton \/> : null\}/, 'the global banner offers the retry')
    const pos = read('../src/components/pos/POS.tsx')
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
