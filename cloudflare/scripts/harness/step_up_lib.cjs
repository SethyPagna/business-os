'use strict'
// Loads the real lib/destructiveStepUp.ts for a pure test that loads routes/system.ts with a map of module
// overrides. The step-up lib reaches db, audit, actorSnapshot and currentPasswordGuard through the same stubs the
// route test already declares, looked up when they are used, so one stub serves both.
//
//   const app = withStepUp(loadReal, 'routes/system.ts', { '../lib/db': ..., '../lib/audit': ..., ... })
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const LIB_REQUESTS = {
  './db': '../lib/db',
  './audit': '../lib/audit',
  './actorSnapshot': '../lib/actorSnapshot',
  './currentPasswordGuard': '../lib/currentPasswordGuard',
}

function loadStepUp(resolveStub) {
  const file = path.join(__dirname, '..', '..', 'src', 'lib', 'destructiveStepUp.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: file,
  })
  const moduleObj = { exports: {} }
  const localRequire = (request) => (request in LIB_REQUESTS ? resolveStub(LIB_REQUESTS[request]) : require(request))
  new Function('exports', 'require', 'module', outputText)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

function withStepUp(loader, relPath, overrides) {
  const map = { ...overrides }
  map['../lib/destructiveStepUp'] = loadStepUp((name) => map[name])
  return loader(relPath, map)
}

module.exports = { loadStepUp, withStepUp }
