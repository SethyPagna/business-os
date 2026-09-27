// F2 (Release 1 auth audit). An AI provider's stored API key goes wherever
// its effective endpoint points. PUT /api/ai/providers/:id kept the stored
// key when endpoint_override changed without a new key, so a `settings`
// holder could aim the owner's key at a host they control and press Test.
// Google also carried the key in the URL (?key=) and accepted any host.
//
// Now: a destination change without a new key is refused with 400 (the key
// is not silently cleared -- see routes/ai.ts), Google endpoints are pinned
// to googleapis.com, the Google key travels in the x-goog-api-key header,
// and endpoint changes are audit-logged.
//
// Drives the REAL routes/ai.ts, lib/aiGateway.ts, lib/netSecurity.ts and
// lib/secretCrypto.ts against the migrated schema with a capturing fetch.
// Fails on a04da325.
//
// Run: node scripts/test-ai-endpoint-key-guard-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

const raw = openDb(loadAll())
// lib/db.ts's D1Compat answers run() with { changes, lastInsertRowid }.
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return {
      get: async (p) => stmt.get(p),
      all: async (p) => stmt.all(p),
      run: async (p) => { const info = stmt.run(p); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
}

const audits = []
const overrides = {
  '../lib/db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 7, username: 'manager', name: 'Manager', permissions: JSON.stringify({ settings: true }), role_code: null, role_permissions: null }); return next() } },
  '../lib/audit': { audit: async (_env, userId, userName, action, entity, entityId, details) => { audits.push({ action, entityId, details }) } },
  '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '203.0.113.9' },
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const calls = []
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), headers: { ...(init.headers || {}) } })
  const google = String(url).includes('generateContent')
  const body = google
    ? { candidates: [{ content: { parts: [{ text: 'OK' }] } }] }
    : { choices: [{ message: { content: 'OK' } }] }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const env = { DB: raw, APP_ENCRYPTION_KEY: 'a'.repeat(64) }
const app = load('routes/ai.ts').default
const OWNER_KEY = 'gsk_owner_secret_key_0001'

async function call(method, pathname, body) {
  const init = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) init.body = JSON.stringify(body)
  const res = await app.request(pathname, init, env, { waitUntil() {}, passThroughOnException() {} })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, body: json }
}
const row = (id) => raw.prepare('SELECT * FROM ai_provider_configs WHERE id = @id').get({ id })
const edit = (existing, changes) => ({
  name: existing.name,
  provider: existing.provider,
  provider_type: existing.provider_type,
  default_model: existing.default_model,
  endpoint_override: existing.endpoint_override || '',
  enabled: true,
  ...changes,
})
const keyCallsTo = (host) => calls.filter((c) => new URL(c.url).hostname === host)

async function main() {
  const created = await call('POST', '/providers', { name: 'Groq main', provider: 'groq', api_key: OWNER_KEY, default_model: 'llama3' })
  assert.equal(created.status, 200, JSON.stringify(created.body))
  const groqId = created.body.item.id

  await check('changing endpoint_override without a new key is refused and Test never reaches the new host', async () => {
    const before = row(groqId)
    const res = await call('PUT', `/providers/${groqId}`, edit(before, { endpoint_override: 'https://collector.attacker.example/v1/chat/completions' }))
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.code, 'ai_endpoint_change_requires_key')
    const after = row(groqId)
    assert.equal(after.endpoint_override, before.endpoint_override, 'the endpoint is unchanged')
    assert.equal(after.api_key_encrypted, before.api_key_encrypted, 'the stored key is kept, not cleared')
    calls.length = 0
    await call('POST', `/providers/${groqId}/test`)
    assert.equal(keyCallsTo('collector.attacker.example').length, 0, 'no request carried the stored key to the attacker host')
  })

  await check('switching provider (a different default host) without a key is refused too', async () => {
    const before = row(groqId)
    const res = await call('PUT', `/providers/${groqId}`, edit(before, { provider: 'mistral' }))
    assert.equal(res.status, 400)
    assert.equal(row(groqId).provider, 'groq')
  })

  await check('an unchanged endpoint (the form resending it) still saves without re-entering the key', async () => {
    const before = row(groqId)
    const res = await call('PUT', `/providers/${groqId}`, edit(before, { name: 'Groq renamed' }))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(row(groqId).name, 'Groq renamed')
    assert.equal(row(groqId).api_key_encrypted, before.api_key_encrypted)
  })

  await check('an endpoint change WITH a new key is allowed and audit-logged with before/after', async () => {
    audits.length = 0
    const before = row(groqId)
    const res = await call('PUT', `/providers/${groqId}`, edit(before, { endpoint_override: 'https://proxy.example.com/openai/v1/chat/completions?tenant=1', api_key: 'gsk_new_key_for_proxy' }))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const entry = audits.find((a) => a.action === 'update')
    assert.ok(entry, 'an update audit row was written')
    assert.equal(entry.details.endpoint_changed, true)
    assert.equal(entry.details.endpoint_before, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(entry.details.endpoint_after, 'https://proxy.example.com/openai/v1/chat/completions', 'query string kept out of the log')
  })

  await check('Google endpoints are pinned to googleapis.com on create, on update and at call time', async () => {
    const bad = await call('POST', '/providers', { name: 'Gemini', provider: 'google', api_key: 'AIza-owner', default_model: 'gemini-flash-latest', endpoint_override: 'https://gemini.attacker.example/v1beta/models' })
    assert.equal(bad.status, 400, 'create with a foreign Google host is refused')
    const good = await call('POST', '/providers', { name: 'Gemini', provider: 'google', api_key: 'AIza-owner', default_model: 'gemini-flash-latest' })
    assert.equal(good.status, 200)
    const gid = good.body.item.id
    const moved = await call('PUT', `/providers/${gid}`, edit(row(gid), { endpoint_override: 'https://googleapis.com.attacker.example/v1beta/models', api_key: 'AIza-new' }))
    assert.equal(moved.status, 400, 'a look-alike suffix is not googleapis.com')
    // A row that already holds a foreign host (written before this fix) fails at call time.
    raw.prepare('UPDATE ai_provider_configs SET endpoint_override = @e WHERE id = @id').run({ id: gid, e: 'https://gemini.attacker.example/v1beta/models' })
    calls.length = 0
    await call('POST', `/providers/${gid}/test`)
    assert.equal(keyCallsTo('gemini.attacker.example').length, 0, 'the key never left for the foreign host')
  })

  await check('Google sends its key in x-goog-api-key, never in the URL', async () => {
    const good = await call('POST', '/providers', { name: 'Gemini 2', provider: 'google', api_key: 'AIza-header-key', default_model: 'gemini-flash-latest' })
    assert.equal(good.status, 200)
    calls.length = 0
    const res = await call('POST', `/providers/${good.body.item.id}/test`)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(calls.length, 1)
    const [sent] = calls
    assert.equal(new URL(sent.url).hostname, 'generativelanguage.googleapis.com')
    assert.equal(new URL(sent.url).search, '', 'no ?key= in the URL')
    assert.ok(!sent.url.includes('AIza-header-key'), 'the key is nowhere in the URL')
    assert.equal(sent.headers['x-goog-api-key'], 'AIza-header-key')
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-ai-endpoint-key-guard-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-ai-endpoint-key-guard-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
