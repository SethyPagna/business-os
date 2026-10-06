// The REAL lib/branchRedirectWrite.ts (CUTOVER-LR) for the hand-wired route harnesses: one require gives the module
// with its own lib dependencies (branchEffect, branchRoles, sqlBinding, branchCutoverHistory) transpiled and wired.
// Its only database access is through the db a caller passes in, so it needs no stubs.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const libRoot = path.join(__dirname, '..', '..', 'src', 'lib')
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name).exports
  const file = path.join(libRoot, `${name}.ts`)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  }).outputText
  const mod = { exports: {} }
  cache.set(name, mod)
  new Function('exports', 'require', 'module', output)(mod.exports, (request) => {
    if (request.startsWith('./')) return load(request.slice(2))
    return require(request)
  }, mod)
  return mod.exports
}

module.exports = load('branchRedirectWrite')
