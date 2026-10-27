'use strict'
// The REAL lib/saleStatusResolution.ts (with its financialPrecision import), bundled once, for the tests that load
// lib/salesAnalytics.ts with a hand-wired module map. salesAnalytics asks this module's coverage answer for what a
// Not Paid sale still owes (lane 6.0.982: a riel tender short by under 100 riel is paid), so every such map wires it here.
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'src', 'lib', 'saleStatusResolution.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, loaded, loaded.exports)
module.exports = loaded.exports
