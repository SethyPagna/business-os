'use strict'
// Loads a cloudflare/src TypeScript module for a plain-node test: ts.transpileModule plus a tiny CommonJS resolver, with optional module overrides.
// Shared by the sales-daily pure tests so each one does not carry its own copy of the loader.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', '..', 'src')
function createLoader(overrides = new Map()) {
  const cache = new Map()
  const resolveTs = (base) => { for (const c of [base, `${base}.ts`, path.join(base, 'index.ts')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return base }
  function load(file) {
    const key = path.normalize(file)
    if (overrides.has(key)) return overrides.get(key)
    if (cache.has(key)) return cache.get(key)
    const { outputText } = ts.transpileModule(fs.readFileSync(key, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: key })
    const mod = { exports: {} }
    cache.set(key, mod.exports)
    const req = Module.createRequire(key)
    new Function('exports', 'require', 'module', outputText)(mod.exports, (r) => (r.startsWith('.') ? load(resolveTs(path.resolve(path.dirname(key), r))) : req(r)), mod)
    cache.set(key, mod.exports)
    return mod.exports
  }
  return { load, src: (rel) => load(path.join(SRC, rel)) }
}
module.exports = { createLoader, SRC }
