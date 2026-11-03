'use strict'
// P2.8 (6.0.1046): the phone modules (lib/phoneMask.ts, phoneAccess.ts, phoneWriteGuard.ts, phoneSearchGuard.ts) as REAL
// transpiled code, for the hand-built route and lib loaders that load one source file at a time and stub the rest.
// A loader asks `phoneModule('./phoneMask')` (the specifier exactly as the importing file writes it, with `./` or `../lib/`)
// and gets the real module, or undefined when the specifier is not one of these. Their own relative imports resolve here.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const LIB = path.join(__dirname, '..', '..', 'src', 'lib')
const NAMES = new Set(['phoneMask', 'phoneAccess', 'phoneWriteGuard', 'phoneSearchGuard', 'contactOptions', 'phone', 'permissions', 'searchMatch'])
const cache = new Map()

function load(name) {
  if (cache.has(name)) return cache.get(name).exports
  const module = { exports: {} }
  cache.set(name, module)
  const source = fs.readFileSync(path.join(LIB, `${name}.ts`), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  new Function('require', 'module', 'exports', output)((id) => {
    const base = id.replace(/^\.\.?\/(lib\/)?/, '')
    if (NAMES.has(base)) return load(base)
    return require(id)
  }, module, module.exports)
  return module.exports
}

function phoneModule(specifier) {
  const base = String(specifier).replace(/^\.\.?\/(lib\/)?/, '').replace(/\.ts$/, '')
  return /^(phoneMask|phoneAccess|phoneWriteGuard|phoneSearchGuard)$/.test(base) ? load(base) : undefined
}

// The overrides a route loader needs for the modules a route now imports (contacts, sales, returns, import jobs): the real phone
// modules, and a cache helper that runs the producer (the loaders already stub the cache the same way).
function routePhoneDeps() {
  return {
    '../lib/phoneMask': phoneModule('../lib/phoneMask'),
    '../lib/phoneAccess': phoneModule('../lib/phoneAccess'),
    '../lib/phoneWriteGuard': phoneModule('../lib/phoneWriteGuard'),
    '../lib/phoneSearchGuard': phoneModule('../lib/phoneSearchGuard'),
    '../lib/phoneCache': { cachedPhoneJson: async (_request, _ctx, _user, _version, _ttl, run) => run() },
  }
}

module.exports = { phoneModule, routePhoneDeps }
