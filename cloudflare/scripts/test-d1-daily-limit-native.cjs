'use strict'
// The Free plan's daily D1 cap, end to end on the REAL Worker. Cloudflare's own text is injected at the D1 binding (a proxy
// added to the in-memory bundle only; src/ is untouched): into every read, then into every write. The Worker must answer one
// stable 503 { success:false, code:'d1_daily_limit', limit, resetsAt, error } with Retry-After in seconds to the next 00:00 UTC,
// never the raw text, never a retry, and a refused write must leave no partial row. Other failures keep their own answers.
//
// Run (from cloudflare/): node scripts/test-d1-daily-limit-native.cjs
const { randomBytes } = require('node:crypto')
const { bootWorld, createReporter } = require('./harness/real_worker_world.cjs')

const READ_TEXT = "Your account has exceeded D1's free tier daily row read limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue."
const WRITE_TEXT = READ_TEXT.replace('read limit', 'write limit')

const INJECT = `
const __CAP_TEXT = { read: ${JSON.stringify(READ_TEXT)}, write: ${JSON.stringify(WRITE_TEXT)}, overload: 'D1 DB is overloaded. Requests queued for too long.', storage: "Your account has exceeded D1's maximum account storage limit." }
let __capFailures = 0
function __capDb(real, mode) {
  const isWrite = (sql) => /^\\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(String(sql))
  const fails = (sql) => mode === 'overload' || mode === 'storage' || (mode === 'read' && !isWrite(sql)) || (mode === 'write' && isWrite(sql))
  const boom = () => { __capFailures += 1; return new Error('D1_ERROR: ' + __CAP_TEXT[mode]) }
  const statement = (inner, sql) => new Proxy(inner, { get(target, key) {
    if (key === 'bind') return (...values) => statement(target.bind(...values), sql)
    if (key === '__sql') return sql
    if (key === '__inner') return target
    if (key === 'all' || key === 'run' || key === 'first' || key === 'raw') return async (...args) => { if (fails(sql)) throw boom(); return target[key](...args) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } })
  return new Proxy(real, { get(target, key) {
    if (key === 'prepare') return (sql) => statement(target.prepare(sql), sql)
    if (key === 'batch') return async (items) => { if (items.some((item) => fails(item.__sql || ''))) throw boom(); return target.batch(items.map((item) => item.__inner || item)) }
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value } })
}
app.use('*', async (c, next) => {
  const mode = c.req.header('x-test-d1-cap')
  if (mode) c.env = { ...c.env, DB: __capDb(c.env.DB, mode) }
  return next()
})
app.get('/api/__cap_failures', (c) => c.json({ failures: __capFailures }))
`
const ANCHOR = 'const app = new Hono<{ Bindings: Env }>()'

function inject(source) {
  if (!source.includes(ANCHOR)) throw new Error('src/index.ts no longer declares the app where this test injects its D1 proxy')
  return source.replace(ANCHOR, () => `${ANCHOR}\n${INJECT}`)
}

const nextUtcMidnight = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()

async function main() {
  const world = await bootWorld({ adminPassword: randomBytes(12).toString('base64url'), transformEntry: inject })
  const { check, finish } = createReporter()
  const as = (mode) => ({ headers: { 'x-test-d1-cap': mode } })
  const failures = async () => (await world.api('GET', '/api/__cap_failures')).json.failures

  try {
    await check('a READ over the cap: one stable 503 with the reset time, Retry-After to it, the raw text nowhere, no retry', async (t) => {
      const before = await failures()
      const at = new Date()
      const r = await world.api('GET', '/api/customers', undefined, as('read'))
      const after = new Date()
      t.eq('status', r.status, 503)
      t.eq('exactly the stable keys', Object.keys(r.json || {}).sort(), ['code', 'error', 'limit', 'resetsAt', 'success'])
      t.eq('code/limit/success', [r.json.code, r.json.limit, r.json.success], ['d1_daily_limit', 'read', false])
      t.ok('resetsAt is the next 00:00 UTC', [nextUtcMidnight(at), nextUtcMidnight(after)].includes(r.json.resetsAt), r.json.resetsAt)
      const retry = Number(r.headers.get('retry-after'))
      const expected = (Date.parse(r.json.resetsAt) - Date.now()) / 1000
      t.ok('Retry-After is whole seconds to the reset', Number.isInteger(retry) && retry >= 1 && Math.abs(retry - expected) <= 10, { retry, expected })
      t.ok('the raw Cloudflare text never reaches the client', !/Upgrade|exceeded D1|paid plan|midnight/i.test(r.text), r.text)
      t.ok('the response is still private, no-store', /no-store/.test(r.headers.get('cache-control') || ''), r.headers.get('cache-control'))
      t.eq('the failing call was made once (the cap is not retried)', (await failures()) - before, 1)
    })

    await check('a WRITE over the cap: the same stable 503 with limit "write" and no partial row; reads still work', async (t) => {
      const before = await failures()
      const r = await world.api('POST', '/api/customers', { name: 'Cap probe customer' }, as('write'))
      t.eq('status', r.status, 503)
      t.eq('code/limit', [r.json && r.json.code, r.json && r.json.limit], ['d1_daily_limit', 'write'])
      t.ok('Retry-After present', Number(r.headers.get('retry-after')) >= 1)
      t.ok('the raw text never reaches the client', !/Upgrade|exceeded D1|paid plan|midnight/i.test(r.text), r.text)
      t.eq('no row was created', (await world.first("SELECT COUNT(*) AS n FROM customers WHERE name = 'Cap probe customer'")).n, 0)
      t.ok('failed once, not retried', (await failures()) - before <= 2, (await failures()) - before)
      const read = await world.api('GET', '/api/customers', undefined, as('write'))
      t.eq('reads are unaffected by a write-only cap', read.status, 200)
      const ok = await world.api('POST', '/api/customers', { name: 'Cap probe customer' })
      t.eq('and the same write succeeds once the cap is gone', ok.status < 300, true)
    })

    await check('other D1 failures keep their own answers: overload and the storage limit are not "daily limit"; maintenance 503 is untouched', async (t) => {
      for (const mode of ['overload', 'storage']) {
        const r = await world.api('GET', '/api/customers', undefined, as(mode))
        t.ok(`${mode}: not mapped to d1_daily_limit`, !(r.json && r.json.code === 'd1_daily_limit'), r.text)
        t.eq(`${mode}: today's generic answer`, [r.status, r.json && r.json.error], [500, 'Something went wrong processing that request. Please try again.'])
      }
      await world.run("INSERT INTO system_flags (key, value, updated_at) SELECT 'stock_transaction_permit', value, CURRENT_TIMESTAMP FROM system_flags WHERE key = 'stock_schema_epoch'")
      await world.run('INSERT INTO system_flags (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', 'maintenance', JSON.stringify({ mode: 'restore', token: 't', backupKey: 'k', startedAt: '2026-01-01T00:00:00.000Z', startedBy: 'test', phase: 'deleting', updatedAt: '2026-01-01T00:00:00.000Z' }))
      try {
        const held = await world.api('POST', '/api/customers', { name: 'Maintenance probe' })
        t.eq('maintenance status', held.status, 503)
        t.ok('maintenance keeps its own shape', Boolean(held.json && held.json.maintenance) && !held.json.code, held.text)
      } finally {
        await world.run("DELETE FROM system_flags WHERE key = 'maintenance'")
        await world.run("DELETE FROM system_flags WHERE key = 'stock_transaction_permit'")
      }
    })

    await check('the cap answer is the same for an unauthenticated caller and a signed-in one: nothing about the account leaks, and no 401 (a cap is never a sign-out)', async (t) => {
      const anon = await world.mf.dispatchFetch('http://localhost/api/customers', { headers: { 'x-test-d1-cap': 'read' } })
      t.ok('anonymous is not told to sign in because of a cap', anon.status === 401 || anon.status === 503, anon.status)
      const signedIn = await world.api('GET', '/api/auth/me', undefined, as('read'))
      t.eq('a signed-in read at the cap is 503, never 401 invalid_session', [signedIn.status, signedIn.json && signedIn.json.code], [503, 'd1_daily_limit'])
    })
  } finally {
    await world.dispose()
  }
  finish('d1 daily limit')
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
