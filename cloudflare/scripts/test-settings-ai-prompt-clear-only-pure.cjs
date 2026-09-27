// The website assistant's prompt and provider are never blanked by accident
// (FX-sec2, refuter R-sec F2, 27 Sep 2026).
//
// The storefront's public config stopped carrying the merchant's AI prompt
// and provider id (routes/portal.ts buildPublicPortalConfig). An editor that
// saved before the staff settings reached it -- or one holding only this
// device's local keys -- still sent both keys, blank, and POST /api/settings
// stored the blanks: the refuter's probe ended with {"prompt":"","provider":""}.
//
// The Worker now leaves a blank value for either key as stored unless the
// request names that key in `clearKeys`, its explicit clear list. A real
// value, and an explicit clear, still save.
//
// Drives the REAL routes/settings.ts with the real permission module against
// the migrated schema. Fails on 94f4c7d6a.
//
// Run: node scripts/test-settings-ai-prompt-clear-only-pure.cjs

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

const db = openDb(loadAll())
let sessionUser = null
const audited = []
const overrides = {
  '../lib/db': { getDb: (env) => env.DB },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
  '../lib/audit': {
    changedFields: () => null,
    auditChangeColumns: () => ({ old_value: null, new_value: null }),
    isSecretShapedAuditKey: () => false,
    audit: async (...args) => { audited.push(args) },
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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

const app = load('routes/settings.ts').default
// The Website Editor's own grant: portal config, nothing else.
const PORTAL_EDITOR = { id: 21, username: 'web', permissions: JSON.stringify({ customer_portal: true }), role_code: null, role_permissions: null }
// Posts only: may not touch the assistant settings at all.
const POSTS_ONLY = { id: 22, username: 'posts', permissions: JSON.stringify({ portal_posts: true }), role_code: null, role_permissions: null }

async function save(user, body) {
  sessionUser = user
  const res = await app.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, body: await res.json() }
}
const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
function seed(key, value) { db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value }) }

const PROMPT = 'You are the Leang Cosmetics assistant. Never quote cost prices.'
const PROMPT_KEY = 'customer_portal_ai_prompt'
const PROVIDER_KEY = 'customer_portal_ai_provider_id'
function seedAssistant() {
  seed(PROMPT_KEY, PROMPT)
  seed(PROVIDER_KEY, '3')
}

async function main() {
  await check('the refuter\'s save: blank prompt and provider beside a real edit leave both as stored', async () => {
    seedAssistant()
    const res = await save(PORTAL_EDITOR, { [PROMPT_KEY]: '', [PROVIDER_KEY]: '', customer_portal_business_tagline: 'edited' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), PROMPT, 'the prompt survives')
    assert.equal(stored(PROVIDER_KEY), '3', 'the provider survives')
    assert.equal(stored('customer_portal_business_tagline'), 'edited', 'the real edit still lands')
    assert.deepEqual(res.body.keys, ['customer_portal_business_tagline'], 'the answer names only what was written')
  })

  await check('whitespace and null are blank too, and never store the text "null"', async () => {
    seedAssistant()
    const res = await save(PORTAL_EDITOR, { [PROMPT_KEY]: '  \n ', [PROVIDER_KEY]: null, customer_portal_business_tagline: 'edited again' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), PROMPT)
    assert.equal(stored(PROVIDER_KEY), '3')
  })

  await check('a save carrying nothing but blank assistant values is a no-op, not an error', async () => {
    seedAssistant()
    const res = await save(PORTAL_EDITOR, { [PROMPT_KEY]: '', [PROVIDER_KEY]: '' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(res.body.keys, [])
    assert.equal(stored(PROMPT_KEY), PROMPT)
    assert.equal(stored(PROVIDER_KEY), '3')
  })

  await check('control: a changed prompt and provider still save', async () => {
    seedAssistant()
    const res = await save(PORTAL_EDITOR, { [PROMPT_KEY]: 'Answer in Khmer first.', [PROVIDER_KEY]: '5' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), 'Answer in Khmer first.')
    assert.equal(stored(PROVIDER_KEY), '5')
  })

  await check('control: an explicit clear still clears, and clearKeys is never stored as a setting', async () => {
    seedAssistant()
    audited.length = 0
    const res = await save(PORTAL_EDITOR, { [PROMPT_KEY]: '', [PROVIDER_KEY]: '', clearKeys: [PROMPT_KEY, PROVIDER_KEY] })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), '', 'the prompt is cleared on request')
    assert.equal(stored(PROVIDER_KEY), '', 'the provider is cleared on request (Automatic)')
    assert.deepEqual([...res.body.keys].sort(), [PROVIDER_KEY, PROMPT_KEY].sort())
    assert.equal(stored('clearKeys'), null, 'the clear list is request metadata')
    assert.deepEqual([...audited[0][6].keys].sort(), [PROVIDER_KEY, PROMPT_KEY].sort(), 'the audit row names the cleared keys, not clearKeys')
  })

  await check('control: an explicit clear sent as null stores an empty value, not "null"', async () => {
    seedAssistant()
    const res = await save(PORTAL_EDITOR, { [PROMPT_KEY]: null, clearKeys: [PROMPT_KEY] })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), '')
    assert.equal(stored(PROVIDER_KEY), '3', 'a key the request did not clear is untouched')
  })

  await check('clearKeys only authorises a blank the request actually sends; it clears nothing by itself', async () => {
    seedAssistant()
    const res = await save(PORTAL_EDITOR, { customer_portal_business_tagline: 'tag', clearKeys: [PROMPT_KEY, PROVIDER_KEY] })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), PROMPT)
    assert.equal(stored(PROVIDER_KEY), '3')
  })

  await check('control: every other key keeps blank-means-blank', async () => {
    seed('customer_portal_business_tagline', 'Beauty for everyone')
    const res = await save(PORTAL_EDITOR, { customer_portal_business_tagline: '' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored('customer_portal_business_tagline'), '')
  })

  await check('control: an explicit clear still needs the portal-config grant', async () => {
    seedAssistant()
    const res = await save(POSTS_ONLY, { [PROMPT_KEY]: '', clearKeys: [PROMPT_KEY] })
    assert.equal(res.status, 403, JSON.stringify(res.body))
    assert.equal(stored(PROMPT_KEY), PROMPT)
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-settings-ai-prompt-clear-only-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-settings-ai-prompt-clear-only-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
