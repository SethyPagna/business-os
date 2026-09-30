// The Website Editor's language settings are enforced when saved, not only when published (R-AB-W5 F2).
// Drives the real routes/settings.ts and lib/portalText.ts against the migrated schema.
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
    changedFields: (before, after) => ({ before, after }),
    auditChangeColumns: () => ({ old_value: null, new_value: null }),
    isSecretShapedAuditKey: () => false,
    audit: async (...args) => { audited.push(args) },
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {} },
}
function createLoader(moduleOverrides) {
  const cache = new Map()
  return function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: sourcePath,
    }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (Object.prototype.hasOwnProperty.call(moduleOverrides, request)) return moduleOverrides[request]
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
}

const load = createLoader(overrides)
const app = load('routes/settings.ts').default
const portalText = load('lib/portalText.ts')
const PORTAL_EDITOR = { id: 31, username: 'web', permissions: JSON.stringify({ customer_portal: true }), role_code: null, role_permissions: null }
const POSTS_ONLY = { id: 32, username: 'posts', permissions: JSON.stringify({ portal_posts: true }), role_code: null, role_permissions: null }

const LANGUAGE_KEY = 'customer_portal_language'
const TRANSLATIONS_KEY = 'customer_portal_translations'
const TAGLINE_KEY = 'customer_portal_business_tagline'
const REFUSAL_CODE = 'invalid_portal_language'

async function save(user, body, route = app) {
  sessionUser = user
  const res = await route.request('/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: db }, { waitUntil() {}, passThroughOnException() {} })
  return { status: res.status, body: await res.json() }
}
const stored = (key) => db.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
const seed = (key, value) => db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value })
const lastAuditAfter = () => audited[audited.length - 1][7].after

const KHMER_BLOCK = { aboutTitle: 'អំពីយើង', faqItems: [{ question: 'សំណួរ', answer: 'ចម្លើយ' }] }
const ENGLISH_BLOCK = { promotionsIntro: 'Featured' }

async function main() {
  await check('a language outside English and Khmer is refused with invalid_portal_language, and nothing in that save lands', async () => {
    for (const refused of ['fr', 'lo', 'vi-vn', 'zh-CN', 'en-US', 'khmer', 'xx', 'autox', '<script>', 7, true, {}, ['km']]) {
      seed(LANGUAGE_KEY, 'km')
      seed(TAGLINE_KEY, 'before')
      const res = await save(PORTAL_EDITOR, { [LANGUAGE_KEY]: refused, [TAGLINE_KEY]: 'after' })
      assert.equal(res.status, 400, `${JSON.stringify(refused)}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.code, REFUSAL_CODE, JSON.stringify(refused))
      assert.match(res.body.error, /English or Khmer/)
      assert.equal(stored(LANGUAGE_KEY), 'km', JSON.stringify(refused))
      assert.equal(stored(TAGLINE_KEY), 'before', `${JSON.stringify(refused)}: the rest of the save is refused with it`)
    }
  })

  await check('the save decides the language through lib/portalText, the rule the storefront publishes with', async () => {
    const probe = 'zz-probe'
    const probedPortalText = { ...portalText, portalLanguageSetting: (value) => (value === probe ? probe : portalText.portalLanguageSetting(value)) }
    const probedApp = createLoader({ ...overrides, '../lib/portalText': probedPortalText })('routes/settings.ts').default
    seed(LANGUAGE_KEY, 'km')
    const res = await save(PORTAL_EDITOR, { [LANGUAGE_KEY]: probe }, probedApp)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(LANGUAGE_KEY), probe)
  })

  await check('English, Khmer and Automatic save in their one spelling; blank and null mean Automatic', async () => {
    const cases = [['en', 'en'], ['EN', 'en'], [' KM ', 'km'], ['km', 'km'], ['auto', 'auto'], [' AUTO ', 'auto'], ['', 'auto'], ['   ', 'auto'], [null, 'auto']]
    for (const [sent, kept] of cases) {
      seed(LANGUAGE_KEY, 'fr')
      const res = await save(PORTAL_EDITOR, { [LANGUAGE_KEY]: sent })
      assert.equal(res.status, 200, `${JSON.stringify(sent)}: ${JSON.stringify(res.body)}`)
      assert.equal(stored(LANGUAGE_KEY), kept, JSON.stringify(sent))
    }
  })

  await check('the editor re-sending a retired language stored before the English/Khmer decision saves, as Automatic', async () => {
    seed(LANGUAGE_KEY, 'fr')
    seed(TAGLINE_KEY, 'before')
    const res = await save(PORTAL_EDITOR, { [LANGUAGE_KEY]: 'fr', [TAGLINE_KEY]: 'after' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(LANGUAGE_KEY), 'auto', 'stored as what the storefront already publishes for it')
    assert.equal(stored(TAGLINE_KEY), 'after')
    assert.equal(lastAuditAfter()[LANGUAGE_KEY], 'auto', 'the audit row records the value actually stored')
  })

  await check('a retired language other than the stored one is still refused', async () => {
    seed(LANGUAGE_KEY, 'fr')
    const res = await save(PORTAL_EDITOR, { [LANGUAGE_KEY]: 'de' })
    assert.equal(res.status, 400, JSON.stringify(res.body))
    assert.equal(res.body.code, REFUSAL_CODE)
    assert.equal(stored(LANGUAGE_KEY), 'fr')
  })

  await check('without the portal-config grant the answer is the permission refusal, not the language rule', async () => {
    seed(LANGUAGE_KEY, 'km')
    const res = await save(POSTS_ONLY, { [LANGUAGE_KEY]: 'fr' })
    assert.equal(res.status, 403, JSON.stringify(res.body))
    assert.equal(stored(LANGUAGE_KEY), 'km')
  })

  await check('translation blocks for other languages are dropped on write, English and Khmer blocks kept as sent', async () => {
    seed(TRANSLATIONS_KEY, '{}')
    const sent = { km: { ...KHMER_BLOCK, aiPrompt: 'kept as sent; publish drops it' }, fr: { aboutTitle: 'À propos' }, 'zh-CN': { promotionsIntro: '精选' }, En: ENGLISH_BLOCK, xx: {} }
    const res = await save(PORTAL_EDITOR, { [TRANSLATIONS_KEY]: JSON.stringify(sent, null, 2) })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(JSON.parse(stored(TRANSLATIONS_KEY)), { km: sent.km, En: ENGLISH_BLOCK })
    assert.deepEqual(Object.keys(JSON.parse(lastAuditAfter()[TRANSLATIONS_KEY])), ['km', 'En'], 'the audit row records the value actually stored')
  })

  await check('re-saving a stored blob that already holds a fr entry saves, without the fr entry', async () => {
    const legacy = JSON.stringify({ km: KHMER_BLOCK, fr: { aboutTitle: 'À propos' }, en: ENGLISH_BLOCK }, null, 2)
    seed(TRANSLATIONS_KEY, legacy)
    const res = await save(PORTAL_EDITOR, { [TRANSLATIONS_KEY]: legacy, [TAGLINE_KEY]: 're-saved' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.deepEqual(JSON.parse(stored(TRANSLATIONS_KEY)), { km: KHMER_BLOCK, en: ENGLISH_BLOCK })
    assert.equal(stored(TAGLINE_KEY), 're-saved')
    const cleaned = stored(TRANSLATIONS_KEY)
    const again = await save(PORTAL_EDITOR, { [TRANSLATIONS_KEY]: cleaned })
    assert.equal(again.status, 200, JSON.stringify(again.body))
    assert.equal(stored(TRANSLATIONS_KEY), cleaned, 'saving the cleaned blob again changes nothing')
  })

  await check('a blob with only English and Khmer blocks is stored byte for byte as sent', async () => {
    const sent = JSON.stringify({ km: KHMER_BLOCK, EN: ENGLISH_BLOCK }, null, 2)
    const res = await save(PORTAL_EDITOR, { [TRANSLATIONS_KEY]: sent })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(TRANSLATIONS_KEY), sent)
  })

  await check('a "__proto__" block is dropped like any other non-language block', async () => {
    const res = await save(PORTAL_EDITOR, { [TRANSLATIONS_KEY]: '{"__proto__":{"aboutTitle":"p"},"km":{"aboutTitle":"k"}}' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(stored(TRANSLATIONS_KEY), '{"km":{"aboutTitle":"k"}}')
  })

  await check('a translations value that is not a JSON object is left to the publish filter, stored as sent', async () => {
    for (const sent of ['{not json', '[{"fr":{"aboutTitle":"x"}}]', '"fr"', '']) {
      const res = await save(PORTAL_EDITOR, { [TRANSLATIONS_KEY]: sent })
      assert.equal(res.status, 200, `${JSON.stringify(sent)}: ${JSON.stringify(res.body)}`)
      assert.equal(stored(TRANSLATIONS_KEY), sent)
    }
  })

  console.log(`\ntest-settings-portal-language-write-pure.cjs: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log(`FAILED: ${failures.join(' | ')}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
