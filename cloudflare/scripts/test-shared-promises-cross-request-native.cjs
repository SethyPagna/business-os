'use strict'
// HANG-2 (3 Nov 2026), the same hazard as the 6.0.1048 review B1, in three more places. workerd ties a promise to the request that created
// it: a request that starts work, keeps the pending promise where later requests can find it, and answers (or is cancelled) before the work
// settles leaves every later request that awaits that promise waiting for good. Three isolate-wide holders did exactly that:
//   S1  routes/portal.ts            portalBuildsInFlight: the storefront build, one entry per cache key
//   S2  lib/dashboardStockOverview  the overview memo kept the pending computation
//   S3  lib/lowStockSettings        lowStockInflight, keyed by env (shared by every request of the isolate); read FIRST by S2
//
// Probe C3, as in test-read-switches-cross-request-native.cjs, on the REAL Worker: request A starts the work and answers while it is still
// pending (its D1 statements are slowed to 3 s, the work is never awaited); request B then asks for the same thing and must answer promptly.
// The slow statements of A only: B, the controls and the next callers read the real database at full speed.
//
// Probe routes are added to the in-memory bundle only (src/ is untouched). Each case starts from a key nobody has computed (the Dashboard
// case bumps the stock version for one: a finished memo would answer both A and B and hide the hang), so neither a finished nor a stranded
// entry hides the next case; the controls and the within-request guard run first for the same reason.
//
// Run (from cloudflare/): node scripts/test-shared-promises-cross-request-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const IMPORT = `import { AsyncLocalStorage as __hgALS } from 'node:async_hooks'
import { loadDashboardStockOverview as __hgOverview } from './lib/dashboardStockOverview'
import { loadLowStockConfig as __hgLowStock } from './lib/lowStockSettings'
import { bumpVersion as __hgBump } from './lib/cache'
`
const ANCHOR = 'installReviewAlerts()\n'
const ROUTES = `
const __hgSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const __hgInA = new __hgALS<boolean>()
const __hgSeen: string[] = []
let __hgStarted: (() => void) | null = null
const __hgArm = () => new Promise<void>((resolve) => { __hgStarted = resolve })
// A copy of the D1 binding whose statements matching \`slow\` wait 3 s; every statement is recorded.
function __hgDb(real: any, slow: (sql: string) => boolean) {
  const wrap = (st: any, sql: string): any => ({
    bind: (...v: unknown[]) => wrap(st.bind(...v), sql),
    all: async (...a: unknown[]) => {
      __hgSeen.push(sql)
      if (slow(sql)) { const started = __hgStarted; __hgStarted = null; started?.(); await __hgSleep(3000) }
      return st.all(...a)
    },
    first: (...a: unknown[]) => st.first(...a), run: (...a: unknown[]) => st.run(...a), raw: (...a: unknown[]) => st.raw(...a),
  })
  return { prepare: (sql: string) => wrap(real.prepare(sql), sql), batch: (s: unknown[]) => real.batch(s), exec: (s: string) => real.exec(s) }
}
const __hgSlowProducts = (env: any) => ({ ...env, DB: __hgDb(env.DB, (sql) => /products/.test(sql)) })
// ONE env object for every request: lowStockSettings keys its memo on env, and a real isolate hands every request the same one.
let __hgShared: any = null
const __hgSharedEnv = (env: any) => __hgShared ??= { ...env, DB: __hgDb(env.DB, (sql) => __hgInA.getStore() === true && /FROM settings/.test(sql)) }
const __hgSettingsReads = () => __hgSeen.filter((sql) => /FROM settings/.test(sql)).length

app.get('/api/__hg/portal-fire', async (c) => {
  const started = __hgArm()
  void app.fetch(new Request(new URL('/api/portal/catalog/products/search?query=' + new URL(c.req.url).searchParams.get('query'), c.req.url)), __hgSlowProducts(c.env), c.executionCtx).catch(() => {})
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
  } finally {
    await world.dispose()
  }
  finish('no pending work is shared across requests (portal build, Dashboard overview, low-stock config)')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
