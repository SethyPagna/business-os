'use strict'
// HANG-2 (3 Nov 2026), the same hazard as the 6.0.1048 review B1, in more places. workerd ties a promise to the request that created
// it: a request that starts work, keeps the pending promise where later requests can find it, and answers (or is cancelled) before the work
// settles leaves every later request that awaits that promise waiting for good. Isolate-wide holders that did exactly that:
//   S1  routes/portal.ts            portalBuildsInFlight: the storefront build, one entry per cache key
//   S2  lib/dashboardStockOverview  the overview memo kept the pending computation
//   S3  lib/lowStockSettings        lowStockInflight, keyed by env (shared by every request of the isolate); read FIRST by S2
//   S4  lib/coreDataInvariants      coreInvariantsPromise: the once-per-isolate check (unstamped builds)
//   S5  lib/coreDataInvariants      buildGateEntry.promise: the once-per-build gate, awaited by EVERY /api request of a stamped build
//
// Probe C3, as in test-read-switches-cross-request-native.cjs, on the REAL Worker: request A starts the work and answers while it is still
// pending (its D1 statements are slowed to 3 s, the work is never awaited); request B then asks for the same thing and must answer promptly.
// The slow statements of A only: B, the controls and the next callers read the real database at full speed.
//
// Probe routes are added to the in-memory bundle only (src/ is untouched). Each case starts from a key nobody has computed (the Dashboard
// case bumps the stock version for one: a finished memo would answer both A and B and hide the hang; the core-invariants cases reset the
// isolate's memo, which is what a cold isolate looks like), so neither a finished nor a stranded entry hides the next case. The controls
// and the within-request guard run first, and the core-invariants cases last, for the same reason: on the old code a stranded core check
// stops every later request of the isolate.
//
// Run (from cloudflare/): node scripts/test-shared-promises-cross-request-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const IMPORT = `import { AsyncLocalStorage as __hgALS } from 'node:async_hooks'
import { loadDashboardStockOverview as __hgOverview } from './lib/dashboardStockOverview'
import { loadLowStockConfig as __hgLowStock } from './lib/lowStockSettings'
import { bumpVersion as __hgBump } from './lib/cache'
import * as __hgCore from './lib/coreDataInvariants'
`
const ANCHOR = 'installReviewAlerts()\n'
const ROUTES = `
const __hgSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const __hgInA = new __hgALS<boolean>()
const __hgSeen: string[] = []
let __hgStarted: (() => void) | null = null
const __hgArm = () => new Promise<void>((resolve) => { __hgStarted = resolve })
type HgCounter = { statements: number; products: number; rows: number }
// A copy of the D1 binding. \`delayMs(sql)\` is how long that statement waits (0 = none); the first statement that waits fires the "started"
// signal request A answers on. \`counter\` counts the statements, the ones that name products, and the rows D1 says it read.
function __hgDb(real: any, delayMs: (sql: string) => number, counter?: HgCounter) {
  const wrap = (st: any, sql: string): any => ({
    bind: (...v: unknown[]) => wrap(st.bind(...v), sql),
    all: async (...a: unknown[]) => {
      __hgSeen.push(sql)
      if (counter) { counter.statements += 1; if (/products/.test(sql)) counter.products += 1 }
      const ms = delayMs(sql)
      if (ms) { const started = __hgStarted; __hgStarted = null; started?.(); await __hgSleep(ms) }
      const result = await st.all(...a)
      if (counter) counter.rows += Number(result?.meta?.rows_read ?? 0)
      return result
    },
    first: (...a: unknown[]) => st.first(...a), run: (...a: unknown[]) => st.run(...a), raw: (...a: unknown[]) => st.raw(...a),
  })
  return { prepare: (sql: string) => wrap(real.prepare(sql), sql), batch: (s: unknown[]) => real.batch(s), exec: (s: string) => real.exec(s) }
}
const __hgSlowProducts = (env: any) => ({ ...env, DB: __hgDb(env.DB, (sql) => (/products/.test(sql) ? 3000 : 0)) })
// ONE env object for every request: lowStockSettings keys its memo on env, and a real isolate hands every request the same one.
let __hgShared: any = null
const __hgSharedEnv = (env: any) => __hgShared ??= { ...env, DB: __hgDb(env.DB, (sql) => (__hgInA.getStore() === true && /FROM settings/.test(sql) ? 3000 : 0)) }
const __hgSettingsReads = () => __hgSeen.filter((sql) => /FROM settings/.test(sql)).length
// A counting env whose first statement matching \`pattern\` waits \`slowMs\` once (an alive, slow request A); slowMs 0 is a plain counting env.
function __hgCounted(env: any, slowMs: number, pattern: RegExp) {
  const counter: HgCounter = { statements: 0, products: 0, rows: 0 }
  let pending = slowMs
  return { counter, env: { ...env, DB: __hgDb(env.DB, (sql) => { if (pending && pattern.test(sql)) { const ms = pending; pending = 0; return ms } return 0 }, counter) } }
}
const __hgParam = (c: any, name: string) => new URL(c.req.url).searchParams.get(name)

app.get('/api/__hg/portal-fire', async (c) => {
  const started = __hgArm()
  void app.fetch(new Request(new URL('/api/portal/catalog/products/search?query=' + __hgParam(c, 'query'), c.req.url)), __hgSlowProducts(c.env), c.executionCtx).catch(() => {})
  await Promise.race([started, __hgSleep(5000)])
  return c.json({ fired: true })
})
// A new 'stock' version is a new overview key: the control Dashboard above already memoised today's.
app.get('/api/__hg/new-overview-key', async (c) => { await __hgBump(c.env, 'stock'); return c.json({ bumped: true }) })
app.get('/api/__hg/dashboard-fire', async (c) => {
  const started = __hgArm()
  void __hgOverview(__hgSlowProducts(c.env), { requestUrl: c.req.url, waitUntil: (work: Promise<unknown>) => c.executionCtx.waitUntil(work) }).catch(() => {})
  await Promise.race([started, __hgSleep(5000)])
  return c.json({ fired: true })
})
app.get('/api/__hg/lowstock-fire', async (c) => {
  const started = __hgArm()
  void __hgInA.run(true, () => __hgLowStock(__hgSharedEnv(c.env))).catch(() => {})
  await Promise.race([started, __hgSleep(5000)])
  return c.json({ fired: true })
})
app.get('/api/__hg/lowstock', async (c) => c.json({ config: await __hgLowStock(__hgSharedEnv(c.env)) }))
app.get('/api/__hg/lowstock-three', async (c) => {
  const env = __hgSharedEnv(c.env)
  __hgSeen.length = 0
  const configs = await Promise.all([__hgLowStock(env), __hgLowStock(env), __hgLowStock(env)])
  return c.json({ settingsReads: __hgSettingsReads(), same: configs.every((config) => JSON.stringify(config) === JSON.stringify(configs[0])) })
})

// The core-data checks. mode=once is the unstamped path (ensureCoreDataInvariantsOnce), mode=gate the stamped one; build= names the build so
// every scenario gets a gate nobody has verified. A fresh isolate is what the reset stands for.
const __hgGateOptions = (c: any) => ({ buildKey: 'hang2:' + __hgParam(c, 'build'), reverifyAfterMs: 3_600_000 })
const __hgCoreCheck = (c: any, env: any) => (__hgParam(c, 'mode') === 'gate' ? __hgCore.ensureCoreDataInvariantsForBuildOnce(env, __hgGateOptions(c)) : __hgCore.ensureCoreDataInvariantsOnce(env))
app.get('/api/__hg/core-reset', (c) => { (__hgCore as any).resetCoreDataInvariantsMemo?.(); return c.json({ reset: typeof (__hgCore as any).resetCoreDataInvariantsMemo }) })
app.get('/api/__hg/core-fire', async (c) => {
  const started = __hgArm()
  void __hgCoreCheck(c, { ...c.env, DB: __hgDb(c.env.DB, () => 3000) }).catch(() => {})
  await Promise.race([started, __hgSleep(5000)])
  return c.json({ fired: true })
})
app.get('/api/__hg/core-run', async (c) => {
  const counted = __hgCounted(c.env, Number(__hgParam(c, 'slow') || 0), /./)
  const result = await __hgCoreCheck(c, counted.env)
  return c.json({ answered: Boolean(result), ...counted.counter })
})
`

function inject(source) {
  const text = source.split('\r\n').join('\n')
  if (!text.includes(ANCHOR)) throw new Error('src/index.ts no longer has the installReviewAlerts() line where this test injects its probe routes')
  return IMPORT + text.replace(ANCHOR, () => ANCHOR + ROUTES)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url'), transformEntry: inject })
  const { check, finish } = createReporter()
  const get = async (route, { as, limitMs = 8000 } = {}) => {
    const started = Date.now()
    const headers = as ? { cookie: `bos_session=${world.tokens[as]}` } : {}
    const call = world.mf.dispatchFetch(`http://localhost${route}`, { headers })
      .then(async (r) => ({ status: r.status, body: await r.text() })).catch((e) => ({ error: String((e && e.name) || e) }))
    const result = await Promise.race([call, wait(limitMs).then(() => ({ timeout: true }))])
    return { ms: Date.now() - started, ...result }
  }
  const json = (r) => { try { return JSON.parse(r.body) } catch { return null } }
  const search = (word) => `/api/portal/catalog/products/search?query=${word}`
  const portalAnswers = (r) => r.status === 200 && Array.isArray(json(r)?.items)
  // product_count and expiring_count come from the shared overview (compat.ts dashboardSummary), so a 200 without them did not use it.
  const dashboardAnswers = (r) => r.status === 200 && typeof json(r)?.product_count === 'number' && typeof json(r)?.expiring_count === 'number'
  const lowStockAnswers = (r) => r.status === 200 && typeof json(r)?.config?.threshold === 'number'
  const coreAnswers = (r) => r.status === 200 && json(r)?.answered === true

  try {
    // ---- controls: the probes see a healthy answer when nothing is stranded
    await check('control: a lone storefront search answers', async (t) => {
      const r = await get(search('control'))
      t.ok('answers', portalAnswers(r), r)
      t.ok('quickly', r.ms < 4000, r.ms)
    })
    await check('control: a lone Dashboard answers', async (t) => {
      const r = await get('/api/dashboard', { as: 'admin' })
      t.ok('answers', dashboardAnswers(r), r)
      t.ok('quickly', r.ms < 4000, r.ms)
    })
    await check('control: a lone low-stock read answers', async (t) => {
      const r = await get('/api/__hg/lowstock')
      t.ok('answers', lowStockAnswers(r), r)
    })

    // ---- guard: inside ONE request the callers still share a pending read (through the real request scope of the Worker)
    await check('S3 guard: three concurrent low-stock reads inside one request are one statement', async (t) => {
      const r = await get('/api/__hg/lowstock-three')
      t.eq('status', r.status, 200)
      t.eq('one settings read, every caller got the config', { reads: json(r)?.settingsReads, same: json(r)?.same }, { reads: 1, same: true })
    })

    // ---- C3: request A starts the work and answers; request B asks for the same thing
    await check('S1 C3: request A starts a storefront build and answers; request B for the same search answers promptly', async (t) => {
      const a = await get('/api/__hg/portal-fire?query=strand')
      t.eq('A answered', a.status, 200)
      const b = await get(search('strand'))
      t.ok('B answers the search', portalAnswers(b), b)
      t.ok('B is not held by A\'s 3 s build', b.ms < 2500, b.ms)
      const next = await get(search('strand'), { limitMs: 5000 })
      t.ok('the next visitor answers', portalAnswers(next), next)
    })

    await check('S2 C3: request A starts the Dashboard overview and answers; request B\'s Dashboard answers promptly', async (t) => {
      t.eq('a key nobody computed yet', (await get('/api/__hg/new-overview-key')).status, 200)
      const a = await get('/api/__hg/dashboard-fire')
      t.eq('A answered', a.status, 200)
      const b = await get('/api/dashboard', { as: 'admin' })
      t.ok('B answers the Dashboard', dashboardAnswers(b), b)
      t.ok('B is not held by A\'s 3 s computation', b.ms < 2500, b.ms)
      const next = await get('/api/dashboard', { as: 'admin', limitMs: 5000 })
      t.ok('the next Dashboard answers', dashboardAnswers(next), next)
    })

    await check('S3 C3: request A starts the low-stock read and answers; request B and the next caller answer promptly', async (t) => {
      const a = await get('/api/__hg/lowstock-fire')
      t.eq('A answered', a.status, 200)
      const b = await get('/api/__hg/lowstock')
      t.ok('B answers the config', lowStockAnswers(b), b)
      t.ok('B is not held by A\'s 3 s read', b.ms < 2500, b.ms)
      const next = await get('/api/__hg/lowstock', { limitMs: 5000 })
      t.ok('the next caller answers', lowStockAnswers(next), next)
      await wait(3200)
    })

    // ---- the core-data checks, last: on the old code a stranded check stops every later request of the isolate
    for (const [site, mode, label] of [['S4', 'once', 'once-per-isolate core-data check'], ['S5', 'gate', 'once-per-build core-data gate']]) {
      await check(`${site} guard: while request A runs the ${label} (slow, still alive), request B takes its finished result and reads nothing`, async (t) => {
        await get('/api/__hg/core-reset')
        const q = `mode=${mode}&build=${site}-guard`
        const a = get(`/api/__hg/core-run?${q}&slow=400`)
        await wait(150)
        const b = await get(`/api/__hg/core-run?${q}`)
        const ra = await a
        t.ok('A answers', coreAnswers(ra), ra)
        t.ok('B answers', coreAnswers(b), b)
        t.ok('A did the check', json(ra)?.statements > 0, json(ra))
        t.eq('B issued no statement', json(b)?.statements, 0)
      })
      await check(`${site} C3: request A starts the ${label} and answers; request B answers within the wait plus its own check, never hangs`, async (t) => {
        await get('/api/__hg/core-reset')
        const q = `mode=${mode}&build=${site}-c3`
        const a = await get(`/api/__hg/core-fire?${q}`)
        t.eq('A answered', a.status, 200)
        const b = await get(`/api/__hg/core-run?${q}`)
        t.ok('B answers', coreAnswers(b), b)
        t.ok('B gave A the wait first (the marker is fresh)', b.ms >= 800, b.ms)
        t.ok('B is not held by A\'s 3 s read', b.ms < 4500, b.ms)
        t.ok('B did the check itself', json(b)?.statements > 0, json(b))
        const next = await get(`/api/__hg/core-run?${q}`, { limitMs: 5000 })
        t.ok('the next caller answers from the finished result', coreAnswers(next) && next.ms < 1500 && json(next)?.statements === 0, next)
      })
    }
  } finally {
    await world.dispose()
  }
  finish('no pending work is shared across requests (portal build, Dashboard overview, low-stock config, core-data checks)')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
