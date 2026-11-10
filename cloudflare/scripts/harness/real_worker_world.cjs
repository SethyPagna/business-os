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

// `transformEntry(source)` rewrites src/index.ts in the in-memory bundle only (a test-only route, say); src/ is untouched.
// `transformSources(file, source)` (path relative to src/, source text) may rewrite any other source file the same way, for a mutant.
async function bundleWorker(transformEntry, transformSources) {
  const { build } = require('esbuild')
  const entry = path.join(root, 'src', 'index.ts')
  const srcDir = path.join(root, 'src') + path.sep
  const plugins = (transformEntry || transformSources) ? [{
    name: 'transform-sources',
    setup: (b) => b.onLoad({ filter: /src[\\/].*\.ts$/ }, (args) => {
      if (!args.path.startsWith(srcDir)) return undefined
      const original = fs.readFileSync(args.path, 'utf8')
      let source = original
      if (transformEntry && args.path === entry) source = transformEntry(source)
      if (transformSources) source = transformSources(path.relative(srcDir, args.path).split(path.sep).join('/'), source) ?? source
      return source === original ? undefined : { contents: source, loader: 'ts', resolveDir: path.dirname(args.path) }
    }),
  }] : []
  const result = await build({
    entryPoints: [entry], plugins,
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
      // Miniflare's test D1 caps compound SELECT terms lower than the deployed runner; this one seed statement is a
      // no-op on an empty users table.
      if (name === '0098_user_aliases.sql' && /^INSERT OR IGNORE INTO user_aliases/i.test(statement.trim())) continue
      statements.push({ name, statement })
    }
  }
  for (let i = 0; i < statements.length; i += 100) {
    const chunk = statements.slice(i, i + 100)
    try { await db.batch(chunk.map((x) => db.prepare(x.statement))) } catch (error) { error.message = `${chunk[0].name}+: ${error.message}`; throw error }
  }
}

// `staticAssets: true` binds STATIC_ASSETS to a stub that serves only the build manifest the Worker reads for X-BOS-Build (lib/readSwitches.ts);
// every other path is a 404. Off by default: a world without the binding answers 503 on a document route, as it always did.
const WORLD_BUILD_HASH = 'worldbuild-1'
const staticAssetsStub = async (request) => (new URL(request.url).pathname === '/business-os-build.json'
  ? Response.json({ revision: 'world', hash: WORLD_BUILD_HASH, builtAt: '2026-11-02T00:00:00.000Z' })
  : new Response('not found', { status: 404 }))

// `bindings` adds to the Worker's bindings. EPOCH_SETTLE_MS is 0 here: a rotation that precedes the end of a maintenance hold waits one memo
// period in production (lib/dataEpoch.ts), which no test other than the one that measures it should pay.
async function bootWorld({ adminPassword, transformEntry, transformSources, staticAssets = false, bindings: extraBindings = {} }) {
  assert.ok(adminPassword, 'adminPassword seeds the built-in admin account')
  const { Miniflare, Log, LogLevel } = require('miniflare')
  const script = await bundleWorker(transformEntry, transformSources)
  console.log('world: Worker bundled')
  const mf = new Miniflare({
    modules: true, script, compatibilityDate: '2026-07-01', compatibilityFlags: ['nodejs_compat', 'no_handle_cross_request_promise_resolution'],
    d1Databases: ['DB'], kvNamespaces: ['CACHE'], r2Buckets: ['ASSETS'],
    durableObjects: { BROADCAST_HUB: 'BroadcastHub', SYNC_UPLOADS: 'SyncUploadSession' },
    ...(staticAssets ? { serviceBindings: { STATIC_ASSETS: staticAssetsStub } } : {}),
    bindings: {
      PLAN_TIER: 'paid', BUSINESS_OS_PUBLIC_URL: 'https://leangbeauty.com', BUSINESS_OS_ADMIN_URL: 'https://admin.leangbeauty.com',
      BUSINESS_OS_ADMIN_PASSWORD: adminPassword, BUSINESS_OS_ORGANIZATION_SLUG: 'leangbeauty', EPOCH_SETTLE_MS: '0', ...extraBindings,
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
    return { status: response.status, json, text, headers: response.headers }
  }

  world.dispose = () => mf.dispose()
  console.log('world: ready')
  return world
}

// A named case collects every violated expectation instead of stopping at the first, so one run on the base commit
// lists everything that is wrong there.
const STOP_AT_FIRST_MISS = Symbol('stop at first miss')
function createReporter({ stopAtFirstMiss = false } = {}) {
  const results = []
  let stopped = false
  async function check(name, fn) {
    if (stopped) return
    const misses = []
    const miss = (text) => { misses.push(text); if (stopAtFirstMiss) throw STOP_AT_FIRST_MISS }
    const t = {
      eq(label, actual, expected) {
        const a = JSON.stringify(actual)
        const e = JSON.stringify(expected)
        if (a !== e) miss(`${label}: expected ${e} but got ${a}`)
      },
      ok(label, condition, detail) { if (!condition) miss(detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`) },
    }
    try { await fn(t) } catch (error) { if (error !== STOP_AT_FIRST_MISS) misses.push(`THREW ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : String(error)}`) }
    results.push({ name, misses })
    if (stopAtFirstMiss && misses.length) stopped = true
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

module.exports = { bootWorld, createReporter, WORLD_BUILD_HASH }
