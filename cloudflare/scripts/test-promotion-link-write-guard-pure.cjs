// The announcement strip editor refuses an unsafe link (ManagePromotionsModal.tsx isSafeLinkUrl);
// the Worker that stores it must refuse the same values, or a direct POST skips the rule.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error && error.message).split(/\r?\n/)[0]}`)
  }
}

const db = openDb(loadAll())
// lib/db.ts answers run() with lastInsertRowid; the shared harness answers D1's raw meta.
const routeDb = {
  prepare(sql) {
    const stmt = db.prepare(sql)
    return {
      get: async (params) => stmt.get(params),
      all: async (params) => stmt.all(params),
      run: async (params) => {
        const info = stmt.run(params)
        return { changes: info.meta.changes, lastInsertRowid: Number(info.meta.last_row_id) }
      },
    }
  },
  // N13: promotions writes commit the write and its audit receipt in one batch.
  async batch(items) { return db.batch(items) },
}
const overrides = {
  '../lib/db': { getDb: () => routeDb },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', { id: 7, username: 'staff' }); return next() } },
  '../lib/permissions': { hasPermission: () => true, getPermissionTier: () => 'full', getActionTier: () => 'full' },
  '../lib/audit': { audit: async () => {}, changedFields: () => null },
  '../lib/cache': { bumpVersion: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../index': {},
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
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

const app = load('routes/promotions.ts').default
const ctx = { waitUntil() {}, passThroughOnException() {} }
// N13: promotions writes carry a request id and, for one row, the version they read.
let requestSeq = 0
async function send(method, url, body) {
  const payload = { client_request_id: `link_probe_${++requestSeq}_abcdefgh`, ...body }
  const card = /^\/(\d+)$/.exec(url)
  if (method === 'PUT' && card) payload.expected_updated_at = db.prepare('SELECT updated_at FROM promotions WHERE id = ?').get([Number(card[1])]).updated_at
  const res = await app.request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, { DB: db }, ctx)
  return { status: res.status, body: await res.json() }
}
const stripCount = () => db.prepare('SELECT COUNT(*) AS n FROM promotions').get().n
const storedLink = (id) => db.prepare('SELECT link_url FROM promotions WHERE id = @id').get({ id }).link_url

const UNSAFE_LINKS = [
  'javascript:alert(1)',
  'data:text/html,<b>x</b>',
  '//evil.example/p',
  '/\\evil.example/p',
  '/%2fevil.example/p',
  '/%5Cevil.example/p',
  'https://example.com\\@evil.example/p',
  'java\tscript:alert(1)',
  '/\t/evil.example/p',
  '/.//evil.example/p',
  `https://example.com/${'a'.repeat(600)}`,
]
const SAFE_LINKS = ['https://example.com/promo', '/promotions', '/?legal=terms']

async function main() {
  await check('create: an unsafe link is refused with invalid_link_url and nothing is stored', async () => {
    const before = stripCount()
    for (const link of UNSAFE_LINKS) {
      const res = await send('POST', '/', { title: 'Sale', link_type: 'url', link_url: link })
      assert.equal(res.status, 400, `${JSON.stringify(link)} -> ${res.status} ${JSON.stringify(res.body)}`)
      assert.equal(res.body.code, 'invalid_link_url', JSON.stringify(link))
    }
    assert.equal(stripCount(), before)
  })

  let id = null
  await check('create: a safe https or site link is stored as sent', async () => {
    for (const link of SAFE_LINKS) {
      const res = await send('POST', '/', { title: 'Sale', link_type: 'url', link_url: link })
      assert.equal(res.status, 200, JSON.stringify(res.body))
      assert.equal(res.body.link_url, link)
      id = res.body.id
    }
  })

  await check('edit: an unsafe link is refused and the stored link is kept', async () => {
    for (const link of UNSAFE_LINKS) {
      const res = await send('PUT', `/${id}`, { title: 'Sale', link_type: 'url', link_url: link })
      assert.equal(res.status, 400, `${JSON.stringify(link)} -> ${res.status}`)
      assert.equal(res.body.code, 'invalid_link_url')
      assert.equal(storedLink(id), SAFE_LINKS[SAFE_LINKS.length - 1])
    }
  })

  await check('a strip that links to nothing or to a product ignores the link field', async () => {
    const res = await send('POST', '/', { title: 'Plain', link_type: 'none', link_url: 'javascript:alert(1)' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.link_url, null)
  })

  console.log(`\ntest-promotion-link-write-guard-pure.cjs: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    console.log(`FAILED: ${failures.join(' | ')}`)
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
