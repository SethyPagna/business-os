'use strict'
// 6.0.1048 review B1, end to end on the REAL Worker. A pending flag read that one request starts and never awaits must not hold any
// other request of the isolate: workerd ties a promise to the request that created it, so awaiting it from another request can hang for
// good once the first request has answered (the bootstrap's 401 path started the epoch read and returned; a Promise.all that rejected
// early; a cancelled request). Every cached read, the bootstrap and the portal wait on that read, so one such request froze the isolate.
//
// Probe routes are added to the in-memory bundle only (src/ is untouched). The control case proves the probe can see a healthy answer.
// Calls of ONE request still share a read (the notification bell's three sections cost one statement).
//
// Run (from cloudflare/): node scripts/test-read-switches-cross-request-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const IMPORT = "import { readDataEpoch as __rsEpoch, resetReadSwitchMemo as __rsReset } from './lib/readSwitches'\n"
const ANCHOR = "app.use('/api/*', readSwitchHeader)\n"
const ROUTES = `
const __rsSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let __rsStatements = 0
function __rsDb(real: any, ms: number) {
  const wrap = (st: any): any => ({ bind: (...v: unknown[]) => wrap(st.bind(...v)), all: async (...a: unknown[]) => { __rsStatements += 1; if (ms) await __rsSleep(ms); return st.all(...a) },
    first: (...a: unknown[]) => st.first(...a), run: (...a: unknown[]) => st.run(...a), raw: (...a: unknown[]) => st.raw(...a) })
  return { prepare: (sql: string) => wrap(real.prepare(sql)), batch: (s: unknown[]) => real.batch(s), exec: (s: string) => real.exec(s) }
}
app.get('/api/__rs/reset', (c) => { __rsReset(); return c.json({ ok: true }) })
app.get('/api/__rs/slow', async (c) => c.json({ epoch: await __rsEpoch({ ...(c.env as any), DB: __rsDb((c.env as any).DB, 3000) }) }))
app.get('/api/__rs/fire', (c) => { void __rsEpoch({ ...(c.env as any), DB: __rsDb((c.env as any).DB, 3000) }); return c.json({ fired: true }) })
app.get('/api/__rs/epoch', async (c) => c.json({ epoch: await __rsEpoch(c.env) }))
app.get('/api/__rs/three', async (c) => {
  __rsStatements = 0
  const env = { ...(c.env as any), DB: __rsDb((c.env as any).DB, 50) }
  const epochs = await Promise.all([__rsEpoch(env), __rsEpoch(env), __rsEpoch(env)])
  return c.json({ epochs, statements: __rsStatements })
})
`

function inject(source) {
  const text = source.split('\r\n').join('\n')
  if (!text.includes(ANCHOR)) throw new Error('src/index.ts no longer mounts readSwitchHeader where this test injects its probe routes')
  return IMPORT + text.replace(ANCHOR, () => ANCHOR + ROUTES)
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url'), transformEntry: inject })
  const { check, finish } = createReporter()
  const epochInDb = (await world.first("SELECT value FROM system_flags WHERE key = 'data_epoch'")).value
  const get = async (route, { signal, limitMs = 8000 } = {}) => {
    const started = Date.now()
    const call = world.mf.dispatchFetch(`http://localhost${route}`, { signal })
      .then(async (r) => ({ status: r.status, body: await r.text() })).catch((e) => ({ error: String((e && e.name) || e) }))
    const result = await Promise.race([call, wait(limitMs).then(() => ({ timeout: true }))])
    return { ms: Date.now() - started, ...result }
  }
  const answers = (r) => r.status === 200 && JSON.parse(r.body).epoch === epochInDb

  try {
    await check('control: a lone caller after a reset answers the stored epoch at once', async (t) => {
      await get('/api/__rs/reset')
      const r = await get('/api/__rs/epoch')
      t.ok('answers the epoch', answers(r), r)
      t.ok('quickly', r.ms < 3000, r.ms)
    })

    await check('C3: request A starts the read and answers without waiting; request B and the next caller still answer', async (t) => {
      await get('/api/__rs/reset')
      const a = await get('/api/__rs/fire')
      t.eq('A answered', a.status, 200)
      const b = await get('/api/__rs/epoch')
      t.ok('B answers the epoch', answers(b), b)
      t.ok('B is not held by A\'s 3 s read', b.ms < 2500, b.ms)
      const next = await get('/api/__rs/epoch', { limitMs: 5000 })
      t.ok('the next caller answers', answers(next), next)
      await wait(3200)
    })

    await check('C2: request B reads while request A is cancelled mid-read; B and the next caller answer', async (t) => {
      await get('/api/__rs/reset')
      const controller = new AbortController()
      const a = get('/api/__rs/slow', { signal: controller.signal, limitMs: 6000 })
      await wait(300)
      const b = get('/api/__rs/epoch')
      await wait(300)
      controller.abort()
      const [rb] = await Promise.all([b, a])
      t.ok('B answers the epoch', answers(rb), rb)
      const next = await get('/api/__rs/epoch', { limitMs: 5000 })
      t.ok('the next caller answers', answers(next), next)
    })

    await check('inside one request the callers still share a read: three concurrent epoch reads are one statement', async (t) => {
      await get('/api/__rs/reset')
      const r = await get('/api/__rs/three')
      t.eq('status', r.status, 200)
      const body = r.body ? JSON.parse(r.body) : {}
      t.eq('one statement', body.statements, 1)
      t.eq('every caller got the epoch', body.epochs, [epochInDb, epochInDb, epochInDb])
    })
  } finally {
    await world.dispose()
  }
  finish('read switches never share a pending read across requests')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
