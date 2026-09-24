// The platform-free modules routes/portal.ts imports, loaded for REAL and
// keyed by the specifier portal.ts uses. Every strict-map test loader of
// portal.ts spreads this map into its overrides:
//
//   const portalRoute = loadReal('routes/portal.ts', {
//     ...require('./harness/portal_route_pure_deps.cjs'),
//     '../lib/db': { getDb: () => db },
//     ...
//   })
//
// so a new pure import in portal.ts is one entry here instead of an edit to
// every loader. Imports that need a platform (D1, KV, R2, the Durable Object
// hub, the AI provider) do NOT belong here: each test decides how those
// behave, and a strict loader failing on an unknown one is the point.
//
// The modules below are transpiled with their own relative imports resolved
// the same way, so a pure module that imports another pure module needs no
// extra entry.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')

const SRC = path.join(__dirname, '..', '..', 'src')
const loaded = new Map()

function resolveTs(base) {
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  throw new Error(`portal_route_pure_deps: cannot resolve ${base}`)
}

function loadPure(absPath) {
  const key = path.normalize(absPath)
  if (loaded.has(key)) return loaded.get(key)
  const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: key,
  })
  const moduleObj = { exports: {} }
  loaded.set(key, moduleObj.exports)
  const packageRequire = Module.createRequire(key)
  const scopedRequire = (request) => (request.startsWith('.')
    ? loadPure(resolveTs(path.resolve(path.dirname(key), request)))
    : packageRequire(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    moduleObj.exports, scopedRequire, moduleObj, key, path.dirname(key),
  )
  loaded.set(key, moduleObj.exports)
  return moduleObj.exports
}

const fromRoutes = (specifier) => loadPure(resolveTs(path.resolve(SRC, 'routes', specifier)))

module.exports = {
  '../lib/businessDateWindow': fromRoutes('../lib/businessDateWindow'),
}
