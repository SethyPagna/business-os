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

// Several of importEngine.ts's siblings are genuinely pure -- no D1/Env
// dependency, only type-only imports that transpilation erases -- so they are
// loaded for REAL rather than stubbed, exactly as test-import-engine-pure.cjs
// does. Stubbing them would hand back `undefined` for the actual validation,
// statement-building and batch-code logic instead of exercising it.
//
// Extracted into one loader because this used to be the same eight-line
// block copy-pasted per module, and every time importEngine.ts gained a new
// pure sibling the harness died with a bare "Cannot find module" until
// somebody pasted a sixth copy. Adding one now means adding one line below.
function loadPureLib(name) {
  const libPath = path.join(LIB_DIR, `${name}.ts`)
  const { outputText: libOutput } = ts.transpileModule(fs.readFileSync(libPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: `${name}.ts`,
  })
  const libModule = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', libOutput)(
    libModule.exports, require, libModule, libPath, path.dirname(libPath),
  )
  return libModule.exports
}

// Specifiers that resolve to a real, pure sibling module. Resolved LAZILY
// and memoized: these modules require each other (productBatches imports
// batchCode), so they have to be loaded while the Module._load patch below
// is already installed -- building them eagerly, before the patch, made the
// nested require fall through to the real filesystem and fail on a .ts path.
const PURE_LIB_SPECIFIERS = ['./salesStatus', './productBatches', './batchCode', './searchMatch']
const pureLibCache = new Map()
function getPureLib(specifier) {
  if (!pureLibCache.has(specifier)) pureLibCache.set(specifier, loadPureLib(specifier.replace('./', '')))
  return pureLibCache.get(specifier)
}

const stubbable = new Set(['../index', './db', './importCsv', './contactOptions', './cache', '../durable-objects/broadcastHub'])
const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === './importImageMatch') return imageMatchModuleObj.exports
  if (request === './importNumbers') return importNumbersModuleObj.exports
  if (PURE_LIB_SPECIFIERS.includes(request)) return getPureLib(request)
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
