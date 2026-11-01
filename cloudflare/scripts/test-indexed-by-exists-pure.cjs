#!/usr/bin/env node
// A pinned plan (`INDEXED BY idx_x`) fails at run time with "no such index" if the index was never created or a later
// migration dropped it, and a query that fails on a pin is a production outage, not a slow page. Every INDEXED BY name
// in the Worker and in the ops queries must be created by a migration and not dropped by a later one.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')

const stripSql = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--.*$/gm, ' ')
const stripCode = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1 ')

function liveIndexes(dirs) {
  const alive = new Map()
  for (const dir of dirs) {
    for (const file of fs.readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith('.sql')).sort()) {
      const sql = stripSql(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'))
      const events = []
      for (const m of sql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?["`[]?(\w+)/gi)) events.push([m.index, m[1], true])
      for (const m of sql.matchAll(/\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?["`[]?(\w+)/gi)) events.push([m.index, m[1], false])
      for (const [, name, created] of events.sort((a, b) => a[0] - b[0])) alive.set(name.toLowerCase(), created)
    }
  }
  return new Set([...alive].filter(([, up]) => up).map(([name]) => name))
}

const pins = (text) => [...text.matchAll(/\bINDEXED\s+BY\s+["`[]?(\w+)/gi)].map((m) => m[1])

function* sources(dir, ext) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) yield* sources(path.join(dir, entry.name), ext)
    else if (ext.test(entry.name)) yield path.join(dir, entry.name)
  }
}

let checks = 0
function check(name, fn) {
  try { fn(); checks += 1 } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 }
}

const indexes = liveIndexes(['cloudflare/migrations'])

check('the migration scan sees created and dropped indexes (positive control)', () => {
  assert.ok(indexes.size > 200, `only ${indexes.size} live indexes found`)
  assert.deepStrictEqual(pins('FROM a INDEXED BY idx_a WHERE x; SELECT 1 FROM b indexed by "idx_b"'), ['idx_a', 'idx_b'])
  assert.deepStrictEqual(pins('-- no pin here'), [])
})

check('every INDEXED BY in src/ and ops/queries/ names an index a migration creates and none drops', () => {
  const used = []
  for (const file of sources(path.join(ROOT, 'cloudflare', 'src'), /\.ts$/)) {
    for (const name of pins(stripCode(fs.readFileSync(file, 'utf8')))) used.push([path.relative(ROOT, file).replace(/\\/g, '/'), name])
  }
  for (const file of sources(path.join(ROOT, 'ops', 'queries'), /\.sql$/)) {
    for (const name of pins(stripSql(fs.readFileSync(file, 'utf8')))) used.push([path.relative(ROOT, file).replace(/\\/g, '/'), name])
  }
  const missing = used.filter(([, name]) => !indexes.has(name.toLowerCase())).map(([file, name]) => `${file}: INDEXED BY ${name}`)
  assert.deepStrictEqual(missing, [], `pinned indexes that no migration creates (or a later one drops):\n  ${missing.join('\n  ')}`)
  assert.ok(used.length > 0, 'no pin found at all: the scanner is broken')
})

if (process.exitCode) console.error(`test-indexed-by-exists-pure: FAILED (${checks} passed)`)
else console.log(`test-indexed-by-exists-pure: ${checks} checks passed`)
