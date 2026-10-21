// Lane 6.0.911: security P3 fixes + Cambodia business-day defaults.
//  - files.ts: force-delete of a product-referenced file needs product-image
//    authority; rewire only repoints avatars for an admin.
//  - compat.ts: GET integration-doctor never writes R2 (the probe is POST) and
//    no route echoes raw error text; users/actionHistory/reviewQueue 500s too.
//  - provider-disconnect / contact-verification stubs are gone.
//  - Worker "today" defaults are the UTC+7 business day (00:30 Cambodia).

const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const srcRoot = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(srcRoot, rel), 'utf8')

const tsCache = new Map()
function loadFile(sourcePath, overrides = {}) {
  const plain = !Object.keys(overrides).length
  if (plain && tsCache.has(sourcePath)) return tsCache.get(sourcePath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath,
  }).outputText
  const nodeRequire = Module.createRequire(sourcePath)
  const localRequire = (request) => {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(sourcePath), request) + '.ts'
      if (fs.existsSync(candidate)) return loadFile(candidate, {})
    }
    return nodeRequire(request)
  }
  const moduleObj = { exports: {} }
  if (plain) tsCache.set(sourcePath, moduleObj.exports)
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    moduleObj.exports, localRequire, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  if (plain) tsCache.set(sourcePath, moduleObj.exports)
  return moduleObj.exports
}
const load = (rel, overrides) => loadFile(path.join(srcRoot, rel), overrides)
const permissions = load('lib/permissions.ts')

const failures = []
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.error(`FAIL ${name}`); console.error(error) }
}

function filesApp(state) {
  const assets = new Map([
    [1, { id: 1, stored_name: 'from.png', public_path: '/uploads/from.png', original_name: 'from.png', media_type: 'image' }],
    [2, { id: 2, stored_name: 'to.png', public_path: '/uploads/to.png', original_name: 'to.png', media_type: 'image' }],
  ])
  const db = {
    prepare(sql) {
      return {
        async get(params) {
          if (/FROM file_assets WHERE id = \?/i.test(sql)) return assets.get(Number(params?.[0]))
          if (/EXISTS\(SELECT 1 FROM products/i.test(sql)) return { has_cover: state.cover ? 1 : 0, has_gallery: 0 }
          return undefined
        },
        async all() { return [] },
        async run() { state.deleted = true },
      }
    },
    async batch(statements) {
      state.batchSql = statements.map((s) => s.sql)
      return statements.map(() => ({ changes: 1 }))
    },
  }
  const route = load('routes/files.ts', {
    hono: { Hono },
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', c.env.TEST_USER); await next() } },
    '../lib/db': { getDb: () => db },
    '../lib/permissions': permissions,
    '../lib/uploadReferences': { findUploadReferences: async () => ({ total: 1, products: state.cover ? 1 : 0, gallery: 0, avatars: state.cover ? 0 : 1 }) },
    '../lib/imageVariantStore': { deleteImageVariants: async () => {} },
    '../lib/audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    '../lib/cache': { bumpVersion: async () => {} },
    '../lib/imageAudit': {}, '../lib/imagePipeline': {}, '../lib/rateLimit': {}, '../lib/fileAssets': {},
    '../lib/libraryLogicalAssets': {}, '../lib/media': {}, '../lib/r2': {}, '../lib/sqlBinding': {},
    '../lib/uploadSecurity': {}, '../lib/actorSnapshot': {}, '../index': {},
  })
  return route.default
}
const staff = (grants) => ({ id: 7, username: 'librarian', role_code: 'staff', permissions: JSON.stringify(grants), role_permissions: null })
const admin = { id: 1, username: 'owner', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
const call = (app, method, url, body, user) => app.request(`http://local${url}`, {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}, { TEST_USER: user, ASSETS: { delete: async () => {} } }, { waitUntil() {}, passThroughOnException() {} })

const FORCE = { force: true, confirmText: 'CONFIRM DELETE' }

async function main() {
  await check('force-delete of a product-referenced file needs products:image', async () => {
    const state = { cover: true }
    const denied = await call(filesApp(state), 'DELETE', '/1', FORCE, staff({ library: true, products: true, 'products:image': false }))
    assert.equal(denied.status, 403)
    assert.equal(state.deleted, undefined)
    const allowed = await call(filesApp(state), 'DELETE', '/1', FORCE, staff({ library: true, products: true }))
    assert.equal(allowed.status, 200)
    assert.equal(state.deleted, true)
  })

  await check('force-delete of a file that is a user avatar needs an administrator (the rewire rule)', async () => {
    const state = { cover: false }
    const res = await call(filesApp(state), 'DELETE', '/1', FORCE, staff({ library: true, products: true, 'products:image': false }))
    assert.equal(res.status, 403)
    assert.equal(state.deleted, undefined, 'nothing was deleted')
    const adm = { cover: false }
    assert.equal((await call(filesApp(adm), 'DELETE', '/1', FORCE, admin)).status, 200)
    assert.equal(adm.deleted, true)
  })

  await check('rewire repoints other users avatars for an admin only', async () => {
    const lib = { cover: false }
    await call(filesApp(lib), 'POST', '/1/rewire', { to_file_id: 2 }, staff({ library: true }))
    assert.equal((lib.batchSql || []).some((sql) => /UPDATE users/i.test(sql)), false, 'a librarian must not touch avatars')
    const adm = { cover: false }
    await call(filesApp(adm), 'POST', '/1/rewire', { to_file_id: 2 }, admin)
    assert.equal(adm.batchSql.some((sql) => /UPDATE users/i.test(sql)), true)
  })

  const secretCrypto = load('lib/secretCrypto.ts')
  const compat = load('routes/compat.ts', {
    '../lib/auth': { requireAuth: async (c, next) => { c.set('user', admin); await next() } },
    '../lib/backup': { listCloudflareBackups: async () => { throw new Error('r2 secret path leak') }, getSystemJob: async () => null, listSystemJobs: async () => [], storeSystemJob: async () => {} },
    '../lib/googleDrive': {
      driveSyncStatus: async () => ({ item: { connected: false, configured: false } }),
      buildDriveOauthStartUrl: async () => ({}), completeDriveOauth: async () => ({}),
      consumeDriveOauthState: async () => ({}), disconnectDrive: async () => ({}), updateDrivePreferences: async () => ({}),
    },
    '../lib/driveSyncQueue': { enqueueDriveRestoreStageJob: async () => ({}), enqueueDriveSyncJob: async () => ({}) },
    '../lib/quotaGuard': { readAllQuotas: async () => ({}) },
    './reports': { gateTotals: (x) => x },
    '../lib/secretCrypto': secretCrypto,
  }).default

  await check('GET integration-doctor never writes R2; POST runs the write probe; messages are generic', async () => {
    const origError = console.error
    console.error = () => {}
    try {
      const puts = []
      const env = {
        DB: { prepare: () => ({ first: async () => { throw new Error('D1 secret detail') } }) },
        IMPORT_QUEUE: {}, MEDIA_QUEUE: {}, CACHE: {},
        ASSETS: { put: async (key) => { puts.push(key) }, delete: async () => {} },
      }
      const get = await compat.request('/system/integration-doctor?deep=1', { method: 'GET' }, env, { waitUntil() {} })
      const getJson = await get.json()
      assert.equal(puts.length, 0, 'GET must not write to R2')
      assert.equal(getJson.checks.objectStorage.writeReadDelete, undefined)
      const post = await compat.request('/system/integration-doctor', { method: 'POST' }, env, { waitUntil() {} })
      assert.equal(post.status, 200)
      assert.equal(puts.length, 1, 'POST runs the write probe')
      const text = JSON.stringify(getJson) + JSON.stringify(await post.json())
      assert.ok(!/secret detail|secret path leak/.test(text), 'raw error text must not reach the client')
    } finally { console.error = origError }
  })

  await check('dead user stubs and raw 500 messages are gone', () => {
    const users = read('routes/users.ts')
    assert.doesNotMatch(users, /provider-disconnect'|contact-verification/)
    assert.doesNotMatch(users, /mapIdentityErrorMessage\(message\) \|\| message/)
    assert.doesNotMatch(read('routes/actionHistory.ts'), /success: false, error: (?:status === 500 \? [^:]+: )?\(error as Error\)\?\.message \|\|[^\n]*\}, 500\)/)
    assert.doesNotMatch(read('routes/reviewQueue.ts'), /error: \(err as Error\)\.message \|\| 'Failed to apply/)
    const compatSrc = read('routes/compat.ts')
    assert.doesNotMatch(compatSrc, /error instanceof Error \? error\.message : '(Failed to load|D1 query|R2 )/)
    assert.doesNotMatch(compatSrc, /c\.req\.query\('deep'\)/)
  })

  await check('receiving preview default date is the Cambodia day at 00:30 (17:30Z the day before)', () => {
    const RealDate = Date
    const fixed = RealDate.parse('2026-10-20T17:30:00Z')
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [fixed])) }
      static now() { return fixed }
    }
    try {
      const { parseReceivingCostPreview } = load('lib/receivingCostPreview.ts')
      const lines = parseReceivingCostPreview({ lines: [{ key: 'a', body: { product_id: 1, quantity: 1 } }] })
      assert.equal(lines[0].receivedAt, '2026-10-21')
    } finally { global.Date = RealDate }
  })

  await check('no Worker batch path defaults received date to the UTC day', () => {
    for (const rel of ['lib/productBatches.ts', 'lib/receivingCostPreview.ts', 'routes/batches.ts']) {
      assert.doesNotMatch(read(rel), /new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/, rel)
    }
  })

  if (failures.length) { console.error(`${failures.length} failed`); process.exitCode = 1 }
}
main()
