'use strict'
// The REAL lib/saleStatusResolution.ts (with its financialPrecision import), bundled once, for the tests that load a route or
// lib with a hand-wired module map. Two asks of it: the riel cash rule (fees, shifts, sales, exchange... refuse cash riel that is
// not whole 100-riel notes, owner 27 Oct 2026) and the coverage answer salesAnalytics uses for what a Not Paid sale still owes
// (a riel tender short by under 100 riel is paid). Every such map wires this one file.
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'src', 'lib', 'saleStatusResolution.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, loaded, loaded.exports)
module.exports = loaded.exports
