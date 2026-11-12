'use strict'
// The REAL lib/schemaObjectProbe.ts, bundled once, for the tests that load a route or lib with a hand-wired module map.
// Every such map that loads a module with a schema probe (telegram, stock receipts, fees, branches, inventory, sales, contacts,
// the import fence) wires this one file under './schemaObjectProbe' or '../lib/schemaObjectProbe'.
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'src', 'lib', 'schemaObjectProbe.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, loaded, loaded.exports)
module.exports = loaded.exports
