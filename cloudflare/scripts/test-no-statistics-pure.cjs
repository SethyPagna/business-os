#!/usr/bin/env node
// D1 has no planner statistics in production, and every pinned plan and read budget assumes it. A single ANALYZE,
// PRAGMA optimize or sqlite_stat write anywhere the Worker, a migration or an ops query can run it makes the Inventory
// Check name page read ~220M rows per call (measured, read-budget analyze test). Comments may mention the words.
'use strict'

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SCAN = ['cloudflare/src', 'cloudflare/migrations', 'cloudflare/migrations-import', 'ops']
const SKIP_DIRS = new Set(['node_modules', 'runtime', 'secrets', 'fixtures', 'keys'])
// These two files hold the word only to forbid it.
const FORBIDDING = new Set(['ops/scripts/ops-sql-guard.mjs', 'ops/scripts/latest-data/load-d1-physical-export.mjs'])
// Reading sqlite_stat1 is fine (ops/queries/d1-planner-stats.sql checks it is empty); writing it is not.
const STATEMENT = [/\bANALYZE\b/, /\bPRAGMA\s+optimize\b/i, /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM|DROP\s+TABLE|REPLACE\s+INTO)\s+["`]?sqlite_stat/i]

function stripComments(text, file) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, ' ')
  return file.endsWith('.sql') ? noBlock.replace(/--.*$/gm, ' ') : noBlock.replace(/(^|[^:\\])\/\/.*$/gm, '$1 ')
}

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) yield* files(path.join(dir, entry.name)) }
    else if (/\.(ts|sql|mjs|cjs|js)$/.test(entry.name)) yield path.join(dir, entry.name)
  }
}

const hits = (text, file) => STATEMENT.filter((rx) => rx.test(stripComments(text, file)))

let checks = 0
function check(name, fn) {
  try { fn(); checks += 1 } catch (e) { console.error(`FAIL ${name}\n  ${e.message}`); process.exitCode = 1 }
}

check('the scanner finds a statement and ignores a comment (positive control)', () => {
  assert.ok(hits('ANALYZE;', 'x.sql').length, 'bare ANALYZE')
  assert.ok(hits('db.prepare(`ANALYZE`)', 'x.ts').length, 'ANALYZE in a template string')
  assert.ok(hits('PRAGMA optimize;', 'x.sql').length, 'PRAGMA optimize')
  assert.ok(hits('DELETE FROM sqlite_stat1;', 'x.sql').length, 'sqlite_stat1 write')
  assert.ok(hits('INSERT INTO sqlite_stat1 VALUES (1)', 'x.sql').length, 'sqlite_stat1 insert')
  assert.strictEqual(hits('SELECT COUNT(*) FROM sqlite_stat1', 'x.sql').length, 0, 'a read of sqlite_stat1 is allowed')
  assert.strictEqual(hits('-- ANALYZE would help\nSELECT 1', 'x.sql').length, 0)
  assert.strictEqual(hits('// ANALYZE: preview only\n/* PRAGMA optimize */ const a = 1', 'x.ts').length, 0)
})

check('no ANALYZE, PRAGMA optimize or sqlite_stat write in cloudflare/src, cloudflare/migrations or ops', () => {
  const bad = []
  let scanned = 0
  for (const dir of SCAN) {
    for (const file of files(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/')
      scanned += 1
      if (FORBIDDING.has(rel)) continue
      const found = hits(fs.readFileSync(file, 'utf8'), file)
      if (found.length) bad.push(`${rel}: ${found.map(String).join(' ')}`)
    }
  }
  assert.ok(scanned > 500, `scanned only ${scanned} files`)
  assert.deepStrictEqual(bad, [], `planner statistics must never be written:\n  ${bad.join('\n  ')}`)
})

check('the two forbidding files still forbid it', () => {
  for (const rel of FORBIDDING) assert.ok(/ANALYZE/.test(fs.readFileSync(path.join(ROOT, rel), 'utf8')), `${rel} no longer lists ANALYZE`)
})

if (process.exitCode) console.error(`test-no-statistics-pure: FAILED (${checks} passed)`)
else console.log(`test-no-statistics-pure: ${checks} checks passed`)
