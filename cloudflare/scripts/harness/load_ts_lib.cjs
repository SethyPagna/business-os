// Loads a cloudflare/src/lib module with its RELATIVE runtime imports transpiled from source (type imports erase). For pure kernels
// whose whole import chain is dependency-free: any import that is neither relative nor a node builtin throws.
const fs = require('node:fs')
const path = require('node:path')
const ts = require(path.join(__dirname, '..', '..', 'node_modules', 'typescript'))
const srcRoot = path.join(__dirname, '..', '..', 'src')

function loadTsLibGraph(entries, overrides = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    const mod = { exports: {} }
    cache.set(file, mod)
    const source = fs.readFileSync(file, 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file })
    const req = (name) => {
      const key = path.posix.basename(name)
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key]
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`))
      if (name.startsWith('node:')) return require(name)
      throw new Error(`${path.basename(file)} requires non-relative module ${name}`)
    }
    new Function('exports', 'require', 'module', outputText)(mod.exports, req, mod)
    return mod.exports
  }
  return Object.fromEntries(entries.map((entry) => [entry, load(path.join(srcRoot, 'lib', `${entry}.ts`))]))
}
/** One entry, one module graph. Use loadTsLibGraph when a test also needs a sibling of the same graph (planTier's cache reset). */
const loadTsLib = (entry, overrides = {}) => loadTsLibGraph([entry], overrides)[entry]
module.exports = { loadTsLib, loadTsLibGraph }
