// A failed /health probe blocks saving (the unreachable flag). One slow answer or a 502 blip must not keep a working till blocked
// until the next 5-minute scheduled probe: while blocked and visible the watch re-probes after 5 s, 15 s, then every 30 s, one probe
// at a time, and the first good answer clears the flag. An unblocked page, a hidden page and a disposed watch never probe from here.
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
type Probe = () => Promise<{ online: boolean; cloudflareAccessRequired?: boolean; runtimeMismatch?: boolean }>

let failed = 0
async function check(name: string, run: () => Promise<void> | void): Promise<void> {
  try { await run(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
interface Timer { run: () => void; delay: number; cancelled: boolean }
function fakeClock() {
  const timers: Timer[] = []
  const pending = () => timers.filter((timer) => !timer.cancelled)
  return {
    timers,
    schedule: (run: () => void, delay: number) => {
      const timer: Timer = { run, delay, cancelled: false }
      timers.push(timer)
      return () => { timer.cancelled = true }
    },
    pending,
    async fire(): Promise<number> {
      const timer = pending()[0]
      assert.ok(timer, 'a re-probe is scheduled')
      timer.cancelled = true
      timer.run()
      await settle()
      return timer.delay
    },
  }
}
function setup(probe: Probe, browserOnline = true, visible: () => boolean = () => true) {
  const flags: boolean[] = []
  const clock = fakeClock()
  const watch = watchConnection(win as unknown as Parameters<typeof watchConnection>[0], (unreachable) => { flags.push(unreachable) }, () => browserOnline, probe, Date.now, { pageVisible: visible, schedule: clock.schedule })
  return { flags, clock, watch }
}

try {
  setSyncServerUrl('https://till.example.test')

  await check('a blocked page re-probes after 5 s, 15 s, then every 30 s, and the first good probe clears the flag and stops', async () => {
    let up = false
    let probes = 0
    const { flags, clock, watch } = setup(async () => { probes += 1; return { online: up } })
    win.dispatchEvent(new Event('offline'))
    assert.deepEqual(flags, [true])
    assert.deepEqual(clock.pending().map((timer) => timer.delay), [5_000])
    const delays = [await clock.fire(), await clock.fire(), await clock.fire(), await clock.fire()]
    assert.deepEqual(delays, [5_000, 15_000, 30_000, 30_000], 'short backoff that settles at 30 s')
    assert.equal(probes, 4)
    assert.equal(flags.at(-1), true, 'still blocked while the server keeps failing')
    up = true
    await clock.fire()
    assert.equal(probes, 5)
    assert.equal(flags.at(-1), false, 'the first good probe cleared the block')
    assert.equal(clock.pending().length, 0, 'and the re-probing stopped')
    watch.dispose()
  })

  await check('the backoff restarts at 5 s the next time saving is blocked', async () => {
    let up = false
    const { clock, watch } = setup(async () => ({ online: up }))
    win.dispatchEvent(new Event('offline'))
    await clock.fire()
    await clock.fire()
    up = true
    await clock.fire()
    assert.equal(clock.pending().length, 0)
    up = false
    win.dispatchEvent(new Event('offline'))
    assert.deepEqual(clock.pending().map((timer) => timer.delay), [5_000])
    watch.dispose()
  })

  await check('an unblocked page never schedules or sends a probe', async () => {
    let probes = 0
    const { flags, clock, watch } = setup(async () => { probes += 1; return { online: true } })
    win.dispatchEvent(new CustomEvent('server:probe', { detail: { online: true } }))
    await settle()
    assert.equal(probes, 0)
    assert.equal(clock.timers.length, 0, 'no timer exists while online and unblocked')
    assert.deepEqual(flags, [false])
    watch.dispose()
  })

  await check('a hidden page sends no probe and probes again once visible', async () => {
    let visible = false
    let probes = 0
    const { flags, clock, watch } = setup(async () => { probes += 1; return { online: true } }, true, () => visible)
    win.dispatchEvent(new Event('offline'))
    await clock.fire()
    await clock.fire()
    assert.equal(probes, 0, 'two timer ticks while hidden, no network')
    assert.equal(flags.at(-1), true)
    visible = true
    await clock.fire()
    assert.equal(probes, 1)
    assert.equal(flags.at(-1), false)
    watch.dispose()
  })

  await check('one probe in flight at a time: a blocked write joins a slow probe, the next re-probe waits for it', async () => {
    let probes = 0
    let release: (online: boolean) => void = () => {}
    const { flags, clock, watch } = setup(() => { probes += 1; return new Promise((resolve) => { release = (online) => resolve({ online }) }) })
    win.dispatchEvent(new Event('offline'))
    await clock.fire()
    assert.equal(probes, 1)
    assert.equal(clock.pending().length, 0, 'no next timer while the probe is still out')
    win.dispatchEvent(new Event('sync:write-blocked'))
    await settle()
    assert.equal(probes, 1, 'a blocked write joins the probe in flight')
    release(false)
    await settle()
    assert.deepEqual(clock.pending().map((timer) => timer.delay), [15_000], 'the next step is armed after the slow probe settles')
    assert.equal(flags.at(-1), true)
    watch.dispose()
  })

  await check('dispose cancels a pending re-probe', async () => {
    let probes = 0
    const { clock, watch } = setup(async () => { probes += 1; return { online: false } })
    win.dispatchEvent(new Event('offline'))
    assert.equal(clock.pending().length, 1)
    watch.dispose()
    assert.equal(clock.pending().length, 0)
    assert.equal(probes, 0)
  })

  await check('the real /health probe: one failed answer blocks, the 5 s re-probe finds the server fine and clears it', async () => {
    __resetApiHealthForTests()
    const realFetch = globalThis.fetch
    let fetches = 0
    let serverOk = false
    globalThis.fetch = (async () => {
      fetches += 1
      if (!serverOk) return new Response('bad gateway', { status: 502 })
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
    }) as typeof fetch
    try {
      const { flags, clock, watch } = setup((() => pingServerHealth(true)) as Probe)
      await pingServerHealth(true)
      assert.equal(flags.at(-1), true, 'the 502 blocked saving')
      assert.deepEqual(clock.pending().map((timer) => timer.delay), [5_000])
      serverOk = true
      await clock.fire()
      assert.equal(flags.at(-1), false, 'no wait for the 5 minute scheduled probe')
      assert.equal(fetches, 2)
      assert.equal(clock.pending().length, 0)
      watch.dispose()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  await check('the app context uses the watch with its defaults (no extra probe loop elsewhere)', () => {
    const context = readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
    assert.match(context, /watchConnection\(window, setSyncServerUnreachable, \(\) => navigator\.onLine !== false, \(\) => pingServerHealth\(true\)\)/)
  })
} finally {
  win.dispatchEvent(new Event('online'))
}

if (failed > 0) process.exit(1)
console.log('connectionReprobe: all passed')
