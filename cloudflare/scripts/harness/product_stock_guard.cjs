const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const file = path.join(__dirname, '..', '..', 'src', 'lib', 'productStockGuard.ts')
const source = fs.readFileSync(file, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
})
const mod = { exports: {} }
new Function('module', 'exports', 'require', outputText)(mod, mod.exports, id => {
  throw new Error(`Unmapped productStockGuard dependency: ${id}`)
})
module.exports = mod.exports

function withProductStockGuard(nextRequire) {
  return request => request === './productStockGuard' || request === '../lib/productStockGuard'
    ? mod.exports
    : nextRequire(request)
}
module.exports.withProductStockGuard = withProductStockGuard
