'use strict'
// The REAL lib/saleStatusResolution.ts (with its financialPrecision import), bundled once, for the tests that load a route or
// lib with a hand-wired module map. The routes that write a riel cash amount (fees, shifts, sales, exchange...) ask this module's
// riel cash rule (owner, 27 Oct 2026: riel cash is whole 100-riel notes, any riel by a bank method), so every such map wires it here.
const path = require('node:path')
const { buildSync } = require('esbuild')

const out = buildSync({
  entryPoints: [path.join(__dirname, '..', '..', 'src', 'lib', 'saleStatusResolution.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs', target: 'es2020', logLevel: 'silent',
})
const loaded = { exports: {} }
new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, loaded, loaded.exports)
module.exports = loaded.exports
