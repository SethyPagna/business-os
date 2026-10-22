'use strict'
// Boots the REAL Worker (cloudflare/src/index.ts: every middleware, route and lib, bundled with esbuild) under
// Miniflare on a D1 migrated with every file in cloudflare/migrations, with real KV, R2 and Durable Objects.
// Nothing in src/ is changed. Only credential entry is shortcut: a session row is inserted directly with the same
// SHA-256 token hash a real sign-in stores, so a test can hold an account with an exact role and permission set.
// The built-in admin is seeded by the Worker itself from BUSINESS_OS_ADMIN_PASSWORD, so that account has a real
// password hash a step-up check can verify.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..', '..')
const sha256 = (text) => createHash('sha256').update(text).digest('hex')

async function bundleWorker() {
  const { build } = require('esbuild')
  const result = await build({
    entryPoints: [path.join(root, 'src', 'index.ts')],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'], external: ['node:*', 'cloudflare:*'], logLevel: 'error',
  })
  return result.outputFiles[0].text
}

async function migrate(db) {
  const { unstable_splitSqlQuery: split } = require('wrangler')
  const dir = path.join(root, 'migrations')
  const statements = []
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    for (const statement of split(fs.readFileSync(path.join(dir, name), 'utf8')).filter((s) => s.trim())) {
      statements.push({ name, statement })
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    try { await db.batch(chunk.map((x) => db.prepare(x.statement))) } catch (error) { error.message = `${chunk[0].name}+: ${error.message}`; throw error }
  }
}

async function bootWorld({ adminPassword }) {
  assert.ok(adminPassword, 'adminPassword seeds the built-in admin account')
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const script = await bundleWorker()
  console.log('world: Worker bundled')
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    bindings: {
      PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com', BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
      BUSINESS_OS_ADMIN_PASSWORD: adminPassword, BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty',
    },
    log: new Log(LogLevel.ERROR),
  })
  const db = await mf.getD1Database('DB')
  await migrate(db)
  console.log('world: migrations applied')
  // The Worker seeds its organization, branches, roles and built-in admin on the first request it handles.
  await mf.dispatchFetch('http://localhost/api/settings')

  const world = { mf, db, tokens: {} }
  world.query = async (sql, ...bind) => (await db.prepare(sql).bind(...bind).all()).results
  world.first = async (sql, ...bind) => db.prepare(sql).bind(...bind).first()
  world.run = async (sql, ...bind) => db.prepare(sql).bind(...bind).run()

  const organization = await world.first('SELECT id FROM organizations ORDER BY id LIMIT 1')
  const admin = await world.first("SELECT id, password FROM users WHERE username = 'admin'")
  assert.ok(admin, 'the Worker seeded the built-in admin from BUSINESS_OS_ADMIN_PASSWORD')
  world.adminId = admin.id
  world.adminPasswordHash = admin.password

  world.session = async (name, userId) => {
    const token = `tok-${name}-${sha256(`${name}:${userId}`).slice(0, 8)}`
    world.tokens[name] = token
    await world.run(
      "INSERT INTO user_sessions (user_id, token_hash, device_name, device_tz, expires_at, last_seen_at) VALUES (?, ?, 'Test Device', 'Asia/Phnom_Penh', '2099-01-01T00:00:00.000Z', datetime('now'))",
      userId, sha256(token),
    )
  }

  world.role = async (code, permissions) => {
    await world.run('INSERT INTO roles (name, code, permissions) VALUES (?, ?, ?)', code, code, JSON.stringify(permissions))
    return (await world.first('SELECT id FROM roles WHERE code = ?', code)).id
  }

  // `roleCode` names an existing role (the seeded 'employee' preset) or, with `permissions`, creates one. A shared
  // `password` hash lets the test sign the step-up in as that account.
  world.account = async (username, { roleCode, permissions, passwordHash = 'x' }) => {
    let role = await world.first('SELECT id FROM roles WHERE code = ?', roleCode)
    if (!role && permissions) role = { id: await world.role(roleCode, permissions) }
    assert.ok(role, `role ${roleCode} exists`)
    await world.run(
      "INSERT INTO users (username, name, password, role_id, permissions, is_active, organization_id) VALUES (?, ?, ?, ?, '{}', 1, ?)",
      username, username, passwordHash, role.id, organization.id,
    )
    const id = (await world.first('SELECT id FROM users WHERE username = ?', username)).id
    await world.session(username, id)
    return { id, username }
  }

  await world.session('admin', admin.id)

  world.api = async (method, route, body, { as = 'admin', headers = {} } = {}) => {
    const response = await mf.dispatchFetch(`http://localhost${route}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: `bos_session=${world.tokens[as]}`, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    return { status: response.status, json, text }
  }

  world.dispose = () => mf.dispose()
  console.log('world: ready')
  return world
}

// A named case collects every violated expectation instead of stopping at the first, so one run on the base commit
// lists everything that is wrong there.
function createReporter() {
  const results = []
  async function check(name, fn) {
    const misses = []
    const t = {
      eq(label, actual, expected) {
        const a = JSON.stringify(actual)
        const e = JSON.stringify(expected)
        if (a !== e) misses.push(`${label}: expected ${e} but got ${a}`)
      },
      ok(label, condition, detail) { if (!condition) misses.push(detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`) },
    }
    try { await fn(t) } catch (error) { misses.push(`THREW ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error)}`) }
    results.push({ name, misses })
    console.log(`${misses.length ? 'RED  ' : 'GREEN'} ${name}`)
    for (const miss of misses) console.log(`        - ${miss}`)
  }
  function finish(title) {
    const red = results.filter((r) => r.misses.length)
    console.log(`\nSUMMARY ${title}: ${results.length - red.length} GREEN, ${red.length} RED`)
    if (red.length) process.exitCode = 1
  }
  return { check, finish }
}

module.exports = { bootWorld, bundleWorker, createReporter }
