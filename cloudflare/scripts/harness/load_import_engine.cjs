// Loads the REAL, merged src/lib/importEngine.ts (transpiled, not
// reimplemented) and exposes classifyProducts + productImportRowSignature
// for the harness. Mirrors cloudflare/scripts/test-import-engine-pure.cjs's
// own stubbing approach exactly, since that script is part of this repo and
// already proven to load this file successfully.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const Module = require('module')

const LIB_DIR = path.join(__dirname, '..', '..', 'src', 'lib')
const sourcePath = path.join(LIB_DIR, 'importEngine.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importEngine.ts',
})

const imageMatchSourcePath = path.join(LIB_DIR, 'importImageMatch.ts')
const imageMatchSource = fs.readFileSync(imageMatchSourcePath, 'utf8')
const { outputText: imageMatchOutputText } = ts.transpileModule(imageMatchSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importImageMatch.ts',
})
const imageMatchModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', imageMatchOutputText)(
  imageMatchModuleObj.exports, require, imageMatchModuleObj, imageMatchSourcePath, path.dirname(imageMatchSourcePath),
)

// classifyProducts genuinely calls normalizeImportMoney/parseImportNumericValue
// (row price/stock parsing) -- these are pure, dependency-free ports (no D1/Env),
// so load the REAL module rather than stubbing it out, or every row's prices
// and stock quantities would come back undefined.
const importNumbersSourcePath = path.join(LIB_DIR, 'importNumbers.ts')
const importNumbersSource = fs.readFileSync(importNumbersSourcePath, 'utf8')
const { outputText: importNumbersOutputText } = ts.transpileModule(importNumbersSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importNumbers.ts',
})
const importNumbersModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', importNumbersOutputText)(
  importNumbersModuleObj.exports, require, importNumbersModuleObj, importNumbersSourcePath, path.dirname(importNumbersSourcePath),
)

// salesStatus.ts is pure (no D1/Env dependency, per its own file comment)
// and productBatches.ts's statement-builder exports are pure too (its only
// import is a type-only `D1Compat`, erased by transpilation) -- load both
// for real rather than stubbing them out, same as test-import-engine-pure.cjs
// already does, or classifySales/incrementBatchStockStatement would come
// back undefined instead of the actual validation/statement logic.
const salesStatusSourcePath = path.join(LIB_DIR, 'salesStatus.ts')
const salesStatusSource = fs.readFileSync(salesStatusSourcePath, 'utf8')
const { outputText: salesStatusOutputText } = ts.transpileModule(salesStatusSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'salesStatus.ts',
})
const salesStatusModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', salesStatusOutputText)(
  salesStatusModuleObj.exports, require, salesStatusModuleObj, salesStatusSourcePath, path.dirname(salesStatusSourcePath),
)

const productBatchesSourcePath = path.join(LIB_DIR, 'productBatches.ts')
const productBatchesSource = fs.readFileSync(productBatchesSourcePath, 'utf8')
const { outputText: productBatchesOutputText } = ts.transpileModule(productBatchesSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'productBatches.ts',
})
const productBatchesModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', productBatchesOutputText)(
  productBatchesModuleObj.exports, require, productBatchesModuleObj, productBatchesSourcePath, path.dirname(productBatchesSourcePath),
)

const stubbable = new Set(['../index', './db', './importCsv', './contactOptions', './cache', '../durable-objects/broadcastHub'])
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './importImageMatch') return imageMatchModuleObj.exports
  if (request === './importNumbers') return importNumbersModuleObj.exports
  if (request === './salesStatus') return salesStatusModuleObj.exports
  if (request === './productBatches') return productBatchesModuleObj.exports
  if (stubbable.has(request)) return {}
  return originalLoad.call(this, request, parent, isMain)
}

const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
  moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
)
Module._load = originalLoad

module.exports = {
  classifyProducts: moduleObj.exports.classifyProducts,
  productImportRowSignature: moduleObj.exports.productImportRowSignature,
  summarizeImportWarnings: moduleObj.exports.summarizeImportWarnings,
}
