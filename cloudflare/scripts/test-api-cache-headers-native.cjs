'use strict'
// Authenticated /api bodies (customer lists with phone and address, the notification bell, the auth bootstrap) left no
// Cache-Control, so a till browser could keep them on disk after sign-out, and Workers Caching (if ever switched on)
// would serve one account's answer to another. lib/apiCacheHygiene.ts now gives every /api/* response `private,
// no-store` unless the route named a policy itself, and adds Cookie to Vary; POST /api/auth/logout adds
// `Clear-Site-Data: "cache"`.
//
// Drives the REAL Worker under Miniflare. Every GET route the Worker registers (read from Hono's route table through
// a test-only probe route injected into the in-memory bundle; src/ is untouched) is requested three ways: as the
// built-in admin (cold, then warm), as an account with no permission (403s) and with no session (401s). The status
// cases a crawl cannot reach are driven by hand: 400, 404, 409, 413, a forced onError 500, the maintenance 503, a
// Response.redirect() and a raw `new Response()`. Portal routes on the public host keep their own public header.
//
// Must be RED on 05ef61b73 (no default Cache-Control, no Clear-Site-Data) and GREEN with the slice.
//
// Run (from cloudflare/): node scripts/test-api-cache-headers-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter, WORLD_BUILD_HASH } = require('./harness/real_worker_world.cjs')

const PROBES = [
  "app.get('/api/__routes', (c) => c.json(app.routes.map((route) => ({ method: route.method, path: route.path }))))",
  "app.get('/api/__boom', () => { throw new Error('forced onError') })",
  "app.get('/api/__raw', () => new Response('raw'))",
  "app.get('/api/__redirect', () => Response.redirect('https://example.test/next', 302))",
].join('\n')
const PROBE_ANCHOR = "app.route('/api/internal/branch-cutover'"

function addProbeRoutes(source) {
  if (!source.includes(PROBE_ANCHOR)) throw new Error('src/index.ts no longer mounts the branch-cutover route where this test injects its probes')
  return source.replace(PROBE_ANCHOR, () => `${PROBES}\n${PROBE_ANCHOR}`)
}

const concrete = (route) => route.replace(/:[A-Za-z0-9_]+(\{[^}]*\})?\??/g, '1')
const hasNoStoreOrPrivate = (cacheControl) => /(^|[\s,])no-store\b/i.test(cacheControl || '') || /^\s*private\b/i.test(cacheControl || '')
const hasCookieVary = (vary) => String(vary || '').split(',').some((token) => token.trim().toLowerCase() === 'cookie')
const REQUEST_TIMEOUT_MS = 20000
const MAINTENANCE_STATE = JSON.stringify({
  mode: 'restore', token: 'test-token', backupKey: 'test-key', startedAt: '2026-01-01T00:00:00.000Z',
  startedBy: 'test', phase: 'deleting', updatedAt: '2026-01-01T00:00:00.000Z',
})

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url'), transformEntry: addProbeRoutes, staticAssets: true })
  const { check, finish } = createReporter()

  async function send(method, route, { as = 'admin', headers = {}, body, origin = 'http://localhost' } = {}) {
    const cookie = as ? { cookie: `bos_session=${world.tokens[as]}` } : {}
    const request = world.mf.dispatchFetch(`${origin}${route}`, {
      method, redirect: 'manual', headers: { 'content-type': 'application/json', ...cookie, ...headers }, body,
    }).then(async (response) => { await response.arrayBuffer(); return response })
    let timer
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), REQUEST_TIMEOUT_MS) })
    const response = await Promise.race([request, timeout])
    clearTimeout(timer)
    if (!response) return { method, route, as, status: 0, cacheControl: null, vary: null, clearSiteData: null, build: null, epoch: null }
    return {
      method, route, as, status: response.status, cacheControl: response.headers.get('cache-control'),
      vary: response.headers.get('vary'), clearSiteData: response.headers.get('clear-site-data'),
      build: response.headers.get('x-bos-build'), epoch: response.headers.get('x-bos-epoch'),
    }
  }
  const describe = (r) => `${r.as || 'anonymous'} ${r.method} ${r.route} -> ${r.status} cache-control=${r.cacheControl ?? '(none)'} vary=${r.vary ?? '(none)'}`
  const offenders = (responses) => responses.filter((r) => !hasNoStoreOrPrivate(r.cacheControl) || !hasCookieVary(r.vary)).map(describe)

  try {
    await world.account('nobody', { roleCode: 'sv_nobody', permissions: {} })
    await world.account('cashier', { roleCode: 'employee' })

    const table = (await world.api('GET', '/api/__routes')).json || []
    const getRoutes = [...new Set(table.filter((r) => r.method === 'GET' && r.path.startsWith('/api/') && !r.path.startsWith('/api/__') && !r.path.includes('*')).map((r) => concrete(r.path)))].sort()
    console.log(`crawl: ${getRoutes.length} GET routes from the Worker's own route table`)

    await check('the route table was read (a crawl of nothing proves nothing)', async (t) => {
      t.ok(`at least 150 GET routes (got ${getRoutes.length})`, getRoutes.length >= 150)
      for (const known of ['/api/customers', '/api/notifications/summary', '/api/auth/bootstrap', '/api/settings', '/api/runtime/version']) {
        t.ok(`${known} is in the table`, getRoutes.includes(known))
      }
    })

    const adminCold = []
    for (const route of getRoutes) adminCold.push(await send('GET', route))
    const adminWarm = []
    for (const route of getRoutes) adminWarm.push(await send('GET', route))
    const forbidden = []
    for (const route of getRoutes) forbidden.push(await send('GET', route, { as: 'nobody' }))
    const anonymous = []
    for (const route of getRoutes) anonymous.push(await send('GET', route, { as: null }))
    const histogram = (responses) => Object.entries(responses.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})).map(([status, n]) => `${status}x${n}`).join(' ')
    console.log(`statuses: admin ${histogram(adminCold)} | no permission ${histogram(forbidden)} | no session ${histogram(anonymous)}`)

    const report = (label, responses) => check(`every GET /api route answers ${label} with no-store (or the route's own private value) and Vary: Cookie`, async (t) => {
      const bad = offenders(responses)
      t.eq(`${bad.length} of ${responses.length} responses lack the headers; first ones`, bad.slice(0, 12), [])
      t.ok('no request timed out', responses.every((r) => r.status !== 0), responses.filter((r) => r.status === 0).map(describe))
    })
    await report('as the admin (cold)', adminCold)
    await report('as the admin (warm: Cache API hits)', adminWarm)
    await report('as an account with no permission', forbidden)
    await report('with no session', anonymous)

    await check('the crawl reached every status family it claims to cover (200, 401, 403)', async (t) => {
      t.ok('admin got 200s', adminCold.some((r) => r.status === 200))
      t.ok('anonymous got 401s', anonymous.some((r) => r.status === 401))
      t.ok('the no-permission account got 403s', forbidden.some((r) => r.status === 403))
    })

    await check('SEC T4 named routes: /api/customers, /api/notifications/summary and the auth bootstrap, admin and Employee', async (t) => {
      for (const as of ['admin', 'cashier']) {
        for (const route of ['/api/customers', '/api/notifications/summary', '/api/auth/bootstrap', '/api/settings']) {
          const r = await send('GET', route, { as })
          t.eq(`${as} ${route} status`, r.status, 200)
          t.ok(`${as} ${route} no-store + Vary: Cookie`, hasNoStoreOrPrivate(r.cacheControl) && hasCookieVary(r.vary), describe(r))
        }
      }
    })

    // CACHE-LIFECYCLE T-CL8: the build and epoch signals ride on every /api response and on nothing else. X-BOS-Build names the frontend build
    // bound to the Worker version (a constant per isolate); X-BOS-Epoch is the memo as it stands, so it is present once a request has loaded it
    // (a cached read does) and is 8 lower-case hex characters, never the epoch itself.
    await check('X-BOS-Build and X-BOS-Epoch: on every /api response (200, 4xx, 5xx, 503, 302, raw), hex only, and on no other path', async (t) => {
      const warmUp = await send('GET', '/api/customers')
      t.eq('the warm-up read answered', warmUp.status, 200)
      const epochRow = await world.first("SELECT value FROM system_flags WHERE key = 'data_epoch'")
      t.ok('migration 0288 gave the database a 32-hex epoch', /^[0-9a-f]{32}$/.test(epochRow && epochRow.value), epochRow)
      const cases = [
        ['200 list', await send('GET', '/api/customers')],
        ['200 admin settings', await send('GET', '/api/settings')],
        ['401 no session', await send('GET', '/api/customers', { as: null })],
        ['403 no permission', await send('GET', '/api/customers', { as: 'nobody' })],
        ['404 unknown route', await send('GET', '/api/definitely-not-a-route')],
        ['404 unknown route, no session', await send('GET', '/api/definitely-not-a-route', { as: null })],
        ['413 body too large', await send('POST', '/api/auth/login', { as: null, body: JSON.stringify({ username: 'x', password: 'y'.repeat(70000) }) })],
        ['500 forced onError', await send('GET', '/api/__boom')],
        ['302 redirect', await send('GET', '/api/__redirect')],
        ['200 raw Response', await send('GET', '/api/__raw')],
      ]
      for (const [label, r] of cases) {
        t.eq(`${label}: X-BOS-Build is the bound build`, r.build, WORLD_BUILD_HASH)
        t.ok(`${label}: X-BOS-Epoch is 8 hex characters`, /^[0-9a-f]{8}$/.test(r.epoch || ''), `got ${r.epoch}`)
        t.ok(`${label}: the header is not the epoch itself`, !epochRow || r.epoch !== epochRow.value.slice(0, 8), r.epoch)
      }
      const statuses = new Set(cases.map(([, r]) => r.status))
      t.ok('the cases cover 2xx, 3xx, 4xx and 5xx', [200, 302, 401, 403, 404, 413, 500].every((s) => statuses.has(s)), [...statuses])
      await world.run("INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'")
      await world.run('INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', 'maintenance', MAINTENANCE_STATE)
      try {
        const maintenance = await send('POST', '/api/customers', { body: JSON.stringify({ name: 'Maintenance signal probe' }) })
        t.eq('maintenance status', maintenance.status, 503)
        t.eq('the maintenance 503 carries X-BOS-Build', maintenance.build, WORLD_BUILD_HASH)
      } finally {
        await world.run("DELETE FROM system_flags WHERE key = 'maintenance'")
        await world.run("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'")
      }
      for (const route of ['/health', '/robots.txt', '/definitely-not-a-page']) {
        const r = await send('GET', route, { as: null })
        t.eq(`${route}: no X-BOS-Build`, r.build, null)
        t.eq(`${route}: no X-BOS-Epoch`, r.epoch, null)
      }
    })

    await check('a rotated epoch changes X-BOS-Epoch for the next response; the build header stays', async (t) => {
      const before = await send('GET', '/api/customers')
      await world.run("UPDATE system_flags SET value = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE key = 'data_epoch'")
      // The isolate's memo is 15 s old at most; a rotation made in this isolate resets it at once (lib/dataEpoch.ts), one made behind its back
      // (Time Travel, another isolate) is picked up when the memo expires. Wait it out so this case needs no private hook.
      await new Promise((resolve) => setTimeout(resolve, 15500))
      await send('GET', '/api/customers')
      const after = await send('GET', '/api/customers')
      t.ok('before is hex', /^[0-9a-f]{8}$/.test(before.epoch || ''), before.epoch)
      t.ok('after is hex', /^[0-9a-f]{8}$/.test(after.epoch || ''), after.epoch)
      t.ok('the epoch tag changed with the epoch', before.epoch !== after.epoch, [before.epoch, after.epoch])
      t.eq('the build did not', after.build, before.build)
    })

    await check("request headers cannot change the response's Cache-Control", async (t) => {
      const r = await send('GET', '/api/customers', { headers: { 'cache-control': 'public, max-age=999', pragma: 'cache', vary: 'cookie', 'x-forwarded-proto': 'https' } })
      t.eq('status', r.status, 200)
      t.ok('still private/no-store', hasNoStoreOrPrivate(r.cacheControl) && !/public/i.test(r.cacheControl || ''), describe(r))
    })

    await check('status cases a crawl cannot reach carry the headers: 400, 404, 409, 413, 500, 503, 302 and a raw Response', async (t) => {
      const cases = [
        [400, await send('POST', '/api/auth/logout', { as: 'cashier', body: JSON.stringify({ expected_actor_id: 'x' }) })],
        [404, await send('GET', '/api/definitely-not-a-route')],
        [404, await send('GET', '/api/definitely-not-a-route', { as: null })],
        [409, await send('POST', '/api/auth/logout', { as: 'cashier', body: JSON.stringify({ expected_actor_id: 999999, expected_organization_id: null }) })],
        [413, await send('POST', '/api/auth/login', { as: null, body: JSON.stringify({ username: 'x', password: 'y'.repeat(70000) }) })],
        [500, await send('GET', '/api/__boom')],
        [500, await send('GET', '/api/__boom', { as: null })],
        [302, await send('GET', '/api/__redirect')],
        [200, await send('GET', '/api/__raw')],
      ]
      for (const [expected, r] of cases) {
        t.eq(`${r.route} status`, r.status, expected)
        t.ok(`${r.route} (${expected}) no-store + Vary: Cookie`, hasNoStoreOrPrivate(r.cacheControl) && hasCookieVary(r.vary), describe(r))
      }
      // Migration 0243 admits a maintenance row only under a stock-transaction permit that matches the epoch.
      await world.run("INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'")
      await world.run('INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', 'maintenance', MAINTENANCE_STATE)
      try {
        const maintenance = await send('POST', '/api/customers', { body: JSON.stringify({ name: 'Maintenance probe' }) })
        t.eq('maintenance status', maintenance.status, 503)
        t.ok('maintenance 503 no-store + Vary: Cookie', hasNoStoreOrPrivate(maintenance.cacheControl) && hasCookieVary(maintenance.vary), describe(maintenance))
      } finally {
        await world.run("DELETE FROM system_flags WHERE key = 'maintenance'")
        await world.run("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'")
      }
    })

    await check('portal routes on the public host keep their own public header (and still gain Vary: Cookie)', async (t) => {
      const publicRoutes = ['/api/portal/config', '/api/portal/bootstrap', '/api/portal/catalog/meta', '/api/portal/catalog/products', '/api/portal/promotions']
      for (const route of publicRoutes) {
        const r = await send('GET', route, { as: null, origin: 'https://leangbeauty.com' })
        t.eq(`${route} status`, r.status, 200)
        t.eq(`${route} cache-control`, r.cacheControl, 'public, no-cache')
        t.ok(`${route} Vary: Cookie`, hasCookieVary(r.vary), r.vary)
      }
      const onAdminHost = await send('GET', '/api/portal/config', { as: null })
      t.eq('the same route on the admin host stays private, no-store', onAdminHost.cacheControl, 'private, no-store')
      const signin = await send('POST', '/api/portal/auth/signin', { as: null, origin: 'https://leangbeauty.com', body: JSON.stringify({}) })
      t.ok('portal sign-in is never stored', hasNoStoreOrPrivate(signin.cacheControl) && !/public/i.test(signin.cacheControl || ''), describe(signin))
    })

    await check("a route's own no-store (not private) is not rewritten", async (t) => {
      const own = [...adminCold, ...adminWarm].filter((r) => /^no-store$/i.test(r.cacheControl || ''))
      t.ok('at least one route answers a bare no-store and keeps it', own.length > 0, 'none of the crawled routes sets a bare no-store')
    })

    await check('POST /api/auth/logout: Clear-Site-Data "cache" on a completed sign-out and the guarded 401, never on 400 and 409', async (t) => {
      await world.account('leaver', { roleCode: 'employee' })
      await world.account('leaver2', { roleCode: 'employee' })
      const me = await world.first("SELECT id, organization_id FROM users WHERE username = 'leaver'")
      const guarded = JSON.stringify({ expected_actor_id: me.id, expected_organization_id: me.organization_id ?? null })

      const bad = await send('POST', '/api/auth/logout', { as: 'leaver', body: JSON.stringify({ expected_actor_id: 'x' }) })
      t.eq('400 status', bad.status, 400)
      t.eq('400 has no Clear-Site-Data', bad.clearSiteData, null)
      const changed = await send('POST', '/api/auth/logout', { as: 'leaver2', body: guarded })
      t.eq('409 status', changed.status, 409)
      t.eq('409 has no Clear-Site-Data', changed.clearSiteData, null)
      const done = await send('POST', '/api/auth/logout', { as: 'leaver', body: guarded })
      t.eq('200 status', done.status, 200)
      t.eq('200 Clear-Site-Data is exactly "cache"', done.clearSiteData, '"cache"')
      const again = await send('POST', '/api/auth/logout', { as: 'leaver', body: guarded })
      t.eq('401 (session already revoked) status', again.status, 401)
      t.eq('401 Clear-Site-Data is exactly "cache"', again.clearSiteData, '"cache"')
      const legacy = await send('POST', '/api/auth/logout', { as: 'leaver2', body: JSON.stringify({}) })
      t.eq('legacy sign-out status', legacy.status, 200)
      t.eq('legacy sign-out Clear-Site-Data', legacy.clearSiteData, '"cache"')
      t.ok('the logout response itself is no-store', hasNoStoreOrPrivate(done.cacheControl), describe(done))
    })
  } finally {
    finish('api cache headers')
    await world.dispose()
  }
}

main().catch((error) => { console.error(error); process.exit(1) })
