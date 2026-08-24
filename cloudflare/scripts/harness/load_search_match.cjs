// Loads the REAL, merged src/lib/searchMatch.ts (transpiled, not
// reimplemented) so run_search.cjs's ~107,000-query harness exercises the
// actual shipped matching logic instead of a hand-copied snapshot that
// would silently drift out of sync the next time searchMatch.ts changes.
// Mirrors load_import_engine.cjs's own transpile-on-load approach exactly.
// searchMatch.ts has no internal imports of its own (see its header
// comment -- it's deliberately a standalone module), so unlike
// load_import_engine.cjs this needs no module-stubbing/patched require.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const sourcePath = path.join(__dirname, '..', '..', 'src', 'lib', 'searchMatch.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'searchMatch.ts',
})

const moduleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
  moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
)

module.exports = moduleObj.exports
