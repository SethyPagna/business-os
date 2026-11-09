// Loads lib/payway.ts alone. It must have no runtime imports (only `import type`).
const fs = require('node:fs')
const path = require('node:path')
const ts = require(path.join(__dirname, '..', '..', 'node_modules', 'typescript'))
const file = path.join(__dirname, '..', '..', 'src', 'lib', 'payway.ts')
function loadPayway() {
  const source = fs.readFileSync(file, 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: 'payway.ts' })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, (name) => { throw new Error(`payway.ts must stay dependency-free, required ${name}`) }, mod)
  return mod.exports
}
module.exports = { loadPayway, source: () => fs.readFileSync(file, 'utf8') }
