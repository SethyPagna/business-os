// Shared local-workerd world for D1 read-cost tests (rows_read per statement, from D1's own meta).
// Bundles the REAL Hono route modules with a metered D1 wrapper and a Miniflare KV for the version cache,
// seeds a production-shaped catalog (name families, two branches, lots, galleries, customers, sales) and lets a
// test call routes as a signed-in admin. Used by test-products-search-read-cost-native.cjs.
const fs = require('node:fs')
const path = require('node:path')
const { build } = require('esbuild')
const { Miniflare, Log, LogLevel } = require('miniflare')
const { unstable_splitSqlQuery: split } = require('wrangler')
const root = path.resolve(__dirname, '..', '..')

const WORKER = `
  import { Hono } from 'hono'
  import products from './src/routes/products'
  import contacts from './src/routes/contacts'
  const ADMIN = { id: 910001, username: 'cost-admin', name: 'Cost admin', role_code: 'admin', organization_id: null,
    permissions: JSON.stringify({ all: true }), role_permissions: JSON.stringify({ all: true }) }
  export default { async fetch(request, env, ctx) {
    const { method = 'GET', path, sql: probe, raw: rawSql } = await request.json(), log = [], raw = env.DB
    if (probe) { const r = await raw.prepare(probe).all(); return Response.json({ results: r.results, rows: r.meta?.rows_read }) }
    const record = (sql, result) => { log.push({ ms: result.meta?.duration || 0, rows: result.meta?.rows_read || 0, sql: sql.replace(/\\s+/g, ' ').slice(0, 8000) }); return result }
    const statement = sql => { const prepared = raw.prepare(sql); return { bind(...values) { const bound = prepared.bind(...values)
      return { inner: bound, sql, async all() { return record(sql, await bound.all()) }, async run() { return record(sql, await bound.run()) },
        async raw() { return (await bound.raw()) }, async first() { const result = record(sql, await bound.all()); return result.results[0] ?? null } } } } }
    const metered = { prepare: statement, async batch(items) { const results = await raw.batch(items.map(item => item.inner)); results.forEach((result, index) => record(items[index].sql, result)); return results } }
    const app = new Hono()
    app.use('*', async (c, next) => { c.set('user', ADMIN); return next() })
    app.route('/api/products', products)
    app.route('/api', contacts)
    const waits = []
    const response = await app.fetch(new Request('http://local.test' + path, { method }), { ...env, DB: metered, ENVIRONMENT: 'test' },
      { waitUntil: p => waits.push(p), passThroughOnException() {} })
    const text = await response.text()
    await Promise.all(waits)
    return Response.json({ status: response.status, text, log })
  } }`

async function openWorld(fixtureSql) {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: WORKER }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error' })
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-08-01', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], log: new Log(LogLevel.ERROR) })
  const db = await mf.getD1Database('DB')
  const migrationDir = path.join(root, 'migrations'), statements = []
  for (const name of fs.readdirSync(migrationDir).filter(n => n.endsWith('.sql')).sort()) {
    for (const sql of split(fs.readFileSync(path.join(migrationDir, name), 'utf8')).filter(sql => sql.trim())) {
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(sql.trim())) continue
      statements.push(sql)
    }
  }
  for (let i = 0; i < statements.length; i += 100) await db.batch(statements.slice(i, i + 100).map(sql => db.prepare(sql)))
  for (const sql of fixtureSql) try { await db.prepare(sql).run() } catch (error) { throw new Error(sql.slice(0, 100) + ': ' + error.message) }
  const call = async (route, method = 'GET') => {
    const response = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify({ method, path: route }) })
    const body = await response.json()
    if (body.status === undefined) throw new Error('worker failure: ' + JSON.stringify(body).slice(0, 400))
    return { status: body.status, text: body.text, rows: body.log.reduce((sum, entry) => sum + entry.rows, 0), log: body.log }
  }
  const probeSql = async sql => { const res = await mf.dispatchFetch('http://local.test/', { method: 'POST', body: JSON.stringify({ sql }) }); const text = await res.text(); try { return JSON.parse(text) } catch { throw new Error(text.slice(0, 300)) } }
  return { mf, db, call, probeSql, dispose: () => mf.dispose() }
}

module.exports = { openWorld }
