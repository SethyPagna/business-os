// Loads the REAL identityBarcodeKey out of src/lib/productDetailRule.ts, for
// the route tests whose require-shim stubs lib/productIdentity.
//
// It exists so those shims cannot quietly stub the one comparison the route is
// being tested on. A stubbed fold makes a test agree with itself: the add-stock
// path's whole point is that "the same barcode means the SOURCE row", and a
// stub that returns the raw string would pass whatever the rule actually says.
//
// Exports the function itself (module.exports = fn) so a shim entry reads
// `identityBarcodeKey: require('./harness/identity_barcode_key.cjs')`.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', '..', 'src', 'lib', 'productDetailRule.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
})
const mod = { exports: {} }
new Function('module', 'exports', 'require', outputText)(mod, mod.exports, require)
if (typeof mod.exports.identityBarcodeKey !== 'function') {
  throw new Error('productDetailRule.ts no longer exports identityBarcodeKey')
}
module.exports = mod.exports.identityBarcodeKey
