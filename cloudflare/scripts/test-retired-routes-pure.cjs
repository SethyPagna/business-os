// Routes retired with zero callers (debloat audit 20 Oct 2026) must not be in the route
// tables, so a request for them is a 404. Each route file is loaded for real (only its
// non-Hono imports are inert stand-ins) and its Hono route table is read; the positive
// controls prove the loader sees live routes, so an empty table cannot pass this test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function inert() {
  const fn = function () { return proxy }
  const proxy = new Proxy(fn, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => '' : key === 'then' ? undefined : proxy),
    apply: () => proxy,
    construct: () => proxy,
  })
  return proxy
}

function routeTable(relativePath) {
  const filePath = path.join(__dirname, '..', 'src', relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  })
  const stubRequire = (request) => (request === 'hono' || request.startsWith('node:') ? require(request) : inert())
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, stubRequire, moduleObj, filePath, path.dirname(filePath))
  const created = moduleObj.exports.default || moduleObj.exports.createSyncRoute()
  return created.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)
}

function check(label, fn) {
  fn()
  console.log(`PASS ${label}`)
}

const compat = routeTable('routes/compat.ts')
const runtime = routeTable('routes/runtime.ts')
const sync = routeTable('routes/sync.ts')

check('controls: live compat, runtime and sync routes are in the tables', () => {
  assert.ok(compat.includes('GET /system/jobs/:id'), compat.join('\n'))
  assert.ok(compat.includes('GET /system/data-path'))
  assert.ok(runtime.includes('GET /version'))
  assert.ok(runtime.includes('GET /catalog-integrity'))
})

check('compat.ts no longer routes object-storage doctor/test-write, backup versions/job status or storage-mode', () => {
  const retired = [
    'GET /system/object-storage/doctor',
    'POST /system/object-storage/test-write',
    'GET /system/backups/versions',
    'GET /system/backups/versions/list',
    'GET /system/backups/:id',
    'GET /system/storage-mode',
  ]
  assert.deepEqual(retired.filter((route) => compat.includes(route)), [])
  assert.deepEqual(compat.filter((route) => /\/system\/(object-storage|backups|storage-mode)/.test(route)), [])
})

check('runtime.ts no longer routes /queues/status', () => {
  assert.deepEqual(runtime.filter((route) => route.includes('/queues')), [])
})

check('sync.ts routes only GET /owner (outbox replay and chunk upload are retired)', () => {
  assert.deepEqual(sync, ['GET /owner'])
})

console.log('retired routes: PASS')
