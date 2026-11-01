#!/usr/bin/env node
// The read-budget governor (P0.5) counts D1 rows and calls from the metered wrapper in lib/db.ts. A raw
// env.DB.prepare( / .batch( / .exec( bypasses that counter, so every raw site is listed here by file. Adding a site, in a
// listed file or a new one, fails this test: route it through getDb(), or list it with the reason it cannot be counted.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'cloudflare', 'src')

// file (under cloudflare/src) -> number of raw sites at 6.0.1039
const ALLOWED = {
  'lib/backup.ts': 12, // backup and restore run against the binding directly, outside any request budget
  'lib/maintenance.ts': 7, // the maintenance fence is read before the metered wrapper exists
  'lib/productWrites.ts': 7, // product write batches built on the binding
  'routes/backups.ts': 1,
  'routes/compat.ts': 1, // the health probe
  'routes/importJobs.ts': 1,
}

const stripCode = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1 ')
const RAW = /\b(?:IMPORT_)?DB\s*\.\s*(?:prepare|batch|exec)\s*(?:<[^()]*>)?\s*\(/g
const sites = (text) => (stripCode(text).match(RAW) || []).length

function* sources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) yield* sources(path.join(dir, entry.name))
    else if (entry.name.endsWith('.ts')) yield path.join(dir, entry.name)
  }
}

let checks = 0
function check(name, fn) {
  try { fn(); checks += 1 } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 }
}

check('the scanner counts raw sites and skips comments (positive control)', () => {
  assert.strictEqual(sites('await env.DB.prepare(`SELECT 1`).first()'), 1)
  assert.strictEqual(sites('c.env.DB.prepare("x"); env.DB.batch<{ a: number }>([]); env.DB.exec("y")'), 3)
  assert.strictEqual(sites('// env.DB.prepare(x)\n/* env.DB.batch(y) */ const db = getDb(env)'), 0)
})

check('raw env.DB sites exist only in the allowlisted files, in the listed number', () => {
  const found = {}
  for (const file of sources(SRC)) {
    const n = sites(fs.readFileSync(file, 'utf8'))
    if (n) found[path.relative(SRC, file).replace(/\\/g, '/')] = n
  }
  assert.deepStrictEqual(found, ALLOWED, 'raw D1 sites changed: route the new site through getDb(), or list it in ALLOWED with the reason')
})

if (process.exitCode) console.error(`test-raw-d1-sites-pure: FAILED (${checks} passed)`)
else console.log(`test-raw-d1-sites-pure: ${checks} checks passed`)
