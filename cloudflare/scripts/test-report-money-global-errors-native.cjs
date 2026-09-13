const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const root = path.resolve(__dirname, '..')
const originalLoad = Module._load

require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8')
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename)
}

const emptyRoute = () => new Hono()
const routeNames = new Set([
  './routes/settings','./routes/products','./routes/portal','./routes/auth','./routes/files','./routes/branches',
  './routes/promotions','./routes/backups','./routes/lookups','./routes/contacts','./routes/inventory','./routes/compat',
  './routes/ai','./routes/importJobs','./routes/returns','./routes/system','./routes/notifications','./routes/organizations',
  './routes/actionHistory','./routes/runtime','./routes/users','./routes/devices','./routes/notes','./routes/batches',
  './routes/fees','./routes/telegram','./routes/reviewQueue','./routes/shifts','./routes/reports','./routes/pos',
])

const harmless = new Proxy(() => undefined, { get: () => harmless, apply: () => undefined })
Module._load = function(request, parent, isMain) {
  if (request === './routes/sales' && parent?.filename === path.join(root, 'src', 'index.ts')) {
    const { ReportMoneyPrecisionError } = originalLoad.call(this, path.join(root, 'src', 'lib', 'reportMoneyPrecision.ts'), parent, isMain)
    const route = new Hono()
    route.get('/probe/:code', (c) => { throw new ReportMoneyPrecisionError(c.req.param('code')) })
    route.get('/ordinary', () => { throw new Error('ordinary failure') })
    return { __esModule: true, default: route }
  }
  if (routeNames.has(request) && parent?.filename === path.join(root, 'src', 'index.ts')) {
    return { __esModule: true, default: emptyRoute() }
  }
  if (request === './routes/sync') return { createSyncRoute: emptyRoute }
  if (request === './lib/coreDataInvariants') return { ensureCoreDataInvariantsOnce: async () => {} }
  if (request === './lib/maintenance') return { getMaintenance: async () => null, isMaintenanceGatedRequest: () => false }
  if (request === './lib/errorReporting') return { reportError: async () => {} }
  if (request.startsWith('./queue')) return new Proxy({}, { get: () => harmless })
  if (request.startsWith('./lib/') || request.startsWith('./routes/')) {
    if (request === './lib/reportMoneyPrecision' || request === './lib/moneyPrecision') {
      return originalLoad.call(this, request, parent, isMain)
    }
    return new Proxy({ __esModule: true, default: harmless }, { get: () => harmless })
  }
  return originalLoad.call(this, request, parent, isMain)
}

async function main() {
  const worker = require(path.join(root, 'src', 'index.ts')).default
  const cases = [
    ['snapshot_changed', 409], ['maintenance_restore', 409], ['too_many_rows', 413],
    ['invalid_saved_money4', 422], ['invalid_recorded_decimal', 422],
  ]
  for (const [code, status] of cases) {
    const response = await worker.fetch(new Request(`http://local/api/sales/probe/${code}`), {}, {
      waitUntil() {}, passThroughOnException() {}, props: {},
    })
    assert.equal(response.status, status, code)
    assert.match(response.headers.get('content-type') || '', /application\/json/)
    const body = await response.json()
    assert.equal(body.success, false)
    assert.equal(body.code, code)
    assert.equal(JSON.stringify(body).includes('cost'), false, 'typed refusal must not leak report values')
  }

  const ordinary = await worker.fetch(new Request('http://local/api/sales/ordinary'), {}, {
    waitUntil() {}, passThroughOnException() {}, props: {},
  })
  assert.equal(ordinary.status, 500)
  assert.deepEqual(await ordinary.json(), {
    success: false,
    error: 'Something went wrong processing that request. Please try again.',
  })
  console.log('PASS global worker routing maps report precision refusals to 409/413/422 and preserves ordinary 500')
}

main().finally(() => { Module._load = originalLoad }).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
