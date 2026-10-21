// /ai/status tells the storefront which AI providers can receive a shopper's question, so the privacy
// policy and the consent line can name them. Real routes/portal.ts + lib/portalAi.ts + lib/aiGateway.ts
// run against in-memory SQLite carrying every migration. Run (from cloudflare/): node scripts/test-portal-ai-status-disclosure-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const SRC = path.join(__dirname, '..', 'src')

function wrap(rawDb) {
  return {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
}

const moduleCache = new Map()
const overrides = new Map()

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return base
}

function loadFile(sourcePath) {
  const key = path.normalize(sourcePath)
  if (overrides.has(key)) return overrides.get(key)
  if (moduleCache.has(key)) return moduleCache.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: key,
  })
  const moduleObj = { exports: {} }
  moduleCache.set(key, moduleObj.exports)
  const packageRequire = Module.createRequire(key)
  const scopedRequire = (request) => (
    request.startsWith('.') ? loadFile(resolveTs(path.resolve(path.dirname(key), request))) : packageRequire(request)
  )
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, scopedRequire, moduleObj, key, path.dirname(key),
  )
  moduleCache.set(key, moduleObj.exports)
  return moduleObj.exports
}

function override(relPath, exportsObject) {
  overrides.set(path.normalize(path.join(SRC, relPath)), exportsObject)
}
function loadReal(relPath) {
  return loadFile(resolveTs(path.join(SRC, relPath)))
}

const rawDb = openDb(fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
const db = wrap(rawDb)


override('lib/db.ts', { getDb: () => db })
override('durable-objects/broadcastHub.ts', { broadcast: async () => {} })
override('lib/imageAudit.ts', { enqueueImageNormalization: async () => {} })
override('lib/auth.ts', { requireAuth: async (c) => c.json({ error: 'Unauthorized' }, 401) })

const app = loadReal('routes/portal.ts').default
const env = { PORTAL_ABUSE_HMAC_SECRET: 'portal-test-secret-is-at-least-thirty-two-characters', APP_ENCRYPTION_KEY: 'k' }
const ctx = { waitUntil() {}, passThroughOnException() {} }

function setSetting(key, value) {
  rawDb.prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run({ key, value: String(value) })
}
function addProvider(row) {
  rawDb.prepare(`INSERT INTO ai_provider_configs (name, provider, provider_type, account_email, project_name, api_key_encrypted, default_model, endpoint_override, enabled, priority)
    VALUES (@name, @provider, @type, @email, @project, @key, @model, @endpoint, @enabled, @priority)`).run({
    name: 'Internal account label', type: 'chat', email: 'owner-secret@example.com', project: 'secret-project', key: 'ENCRYPTED-SECRET-KEY',
    model: 'secret-model-id', endpoint: 'https://secret.example/v1', enabled: 1, ...row,
  })
  return Number(rawDb.prepare('SELECT max(id) AS id FROM ai_provider_configs').get().id)
}
async function status() {
  const res = await app.request('/ai/status', {}, env, ctx)
  const text = await res.text()
  assert.strictEqual(res.status, 200, `status must answer: ${res.status} ${text}`)
  return { payload: JSON.parse(text), text }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('no provider configured: the list is empty (the page then says no AI provider is in use)', async () => {
    const { payload } = await status()
    assert.deepStrictEqual(payload.providers, [])
    assert.strictEqual(payload.enabled, false)
  })

  await check('every enabled chat provider is named by id and display name, in the order the chat tries them', async () => {
    addProvider({ provider: 'google', priority: 20 })
    addProvider({ provider: 'groq', priority: 10 })
    addProvider({ provider: 'mistral', priority: 30, enabled: 0 })
    addProvider({ provider: 'cohere', type: 'embed', priority: 5 })
    const { payload } = await status()
    assert.deepStrictEqual(payload.providers, [{ id: 'groq', name: 'Groq' }, { id: 'google', name: 'Google AI' }])
    assert.strictEqual(payload.enabled, true)
  })

  await check('the configured provider row is tried first, as the chat does', async () => {
    const cerebras = addProvider({ provider: 'cerebras', priority: 40 })
    setSetting('customer_portal_ai_provider_id', cerebras)
    const { payload } = await status()
    assert.deepStrictEqual(payload.providers.map((p) => p.id), ['cerebras', 'groq', 'google'])
  })

  await check('an unknown provider is reported as other with no name', async () => {
    addProvider({ provider: 'Weird-Vendor', priority: 60, name: 'Weird internal label' })
    const { payload, text } = await status()
    assert.deepStrictEqual(payload.providers.at(-1), { id: 'other', name: '' })
    assert.ok(!text.includes('Weird'), 'the raw provider string never leaves the Worker')
  })

  await check('no secret, account, model or row name reaches the public payload', async () => {
    const { text } = await status()
    for (const secret of ['ENCRYPTED-SECRET-KEY', 'owner-secret@example.com', 'secret-project', 'secret-model-id', 'secret.example', 'Internal account label', 'api_key']) {
      assert.ok(!text.includes(secret), `the public AI status leaks ${secret}`)
    }
  })

  await check('assistant switched off: no provider is listed', async () => {
    setSetting('customer_portal_ai_enabled', 'false')
    const { payload } = await status()
    assert.deepStrictEqual(payload.providers, [])
    assert.strictEqual(payload.enabled, false)
  })

  console.log(`\n${passed} check(s) passed.`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
