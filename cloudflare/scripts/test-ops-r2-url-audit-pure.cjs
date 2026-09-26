#!/usr/bin/env node
// Fixture checks for ops/queries/r2-url-audit.sql: the audit runs (after the
// read-only guard canonicalises it) against the REAL migration chain in an
// in-memory SQLite, seeded with url fixtures in every audited column.
//
// The audit must separate:
//   move      R2 public/dev hosts, and absolute '/uploads/' urls on the app's
//             own hosts -- the bucket move breaks these, so they fail the job;
//   external  Google avatars and every other third-party absolute url --
//             counted, never failing;
//   neither   the relative '/uploads/<name>' paths the app stores.
// No network, no wrangler.
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

let passed = 0
async function check(name, fn) {
  try {
    await fn()
    passed += 1
  } catch (err) {
    console.error(`FAIL ${name}\n  ${err && err.message}`)
    process.exitCode = 1
  }
}

// [table, column, json] -- json: the column holds a JSON array of urls.
const AUDITED = [
  ['products', 'image_path', false],
  ['product_images', 'image_path', false],
  ['promotions', 'image_path', false],
  ['users', 'avatar_path', false],
  ['file_assets', 'public_path', false],
  ['customer_share_submissions', 'screenshots_json', true],
  ['import_job_files', 'stored_path', false],
  ['import_job_image_matches', 'image_path', false],
  ['settings', 'value', false],
]

const MOVE = [
  'https://pub-0123456789abcdef.r2.dev/uploads/a.jpg',
  'https://acct.r2.cloudflarestorage.com/business-os-assets/uploads/a.jpg',
  'https://leangbeauty.com/uploads/a.jpg',
  'https://admin.leangbeauty.com/uploads/a.jpg',
  'HTTPS://WWW.LEANGBEAUTY.COM/uploads/a.jpg',
  '//leangbeauty.com/uploads/a.jpg',
  'https://leangcosmetics.dpdns.org/uploads/a.jpg',
  'http://admin.leangcosmetics.dpdns.org/uploads/a.jpg',
]
const EXTERNAL = [
  'https://lh3.googleusercontent.com/a/ACg8ocK-avatar=s96-c',
  'https://cdn.example.com/uploads/a.jpg',
  'https://notleangbeauty.com/uploads/a.jpg',
  '//cdn.example.com/a.png',
  'https://leangbeauty.com/catalog',
]
const NEITHER = ['/uploads/a.jpg', 'uploads/a.jpg', '', null]

function openSchema() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  return db
}

// Inserts one row with `column` = value, filling every other NOT NULL column
// that has no default with a unique placeholder of its declared type.
let seq = 0
function insert(db, table, column, value) {
  seq += 1
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  const target = cols.find((c) => c.name === column)
  assert.ok(target, `${table}.${column} is not in the real schema`)
  if (value === null && target.notnull) return null
  const names = [column]
  const values = [value]
  // A lone INTEGER PRIMARY KEY is the rowid and fills itself; a composite
  // key's parts do not.
  const pks = cols.filter((c) => c.pk)
  const rowidKey = pks.length === 1 && String(pks[0].type).toUpperCase() === 'INTEGER' ? pks[0].name : null
  for (const c of cols) {
    if (c.name === column || c.name === rowidKey) continue
    if (!c.pk && (!c.notnull || c.dflt_value !== null)) continue
    names.push(c.name)
    const type = String(c.type).toUpperCase()
    values.push(type.includes('INT') || type.includes('REAL') || type.includes('NUM') ? seq : `fixture-${seq}`)
  }
  return db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values).lastInsertRowid
}

function seed(db, urls) {
  for (const [table, column, json] of AUDITED) {
    for (const url of urls) insert(db, table, column, json && url !== null ? JSON.stringify([url]) : url)
  }
}

async function main() {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const d1 = await load('ops/scripts/ops-d1-export.mjs')
  const q = guard.loadQuery('r2-url-audit')
  const out = (rows) => JSON.stringify([{ results: rows, success: true, meta: { rows_written: 0, changes: 0, changed_db: false } }])

  const moveCols = AUDITED.map(([t]) => `${t}_move`)
  const externalCols = AUDITED.map(([t]) => `${t}_external`)

  await check('expect-zero names exactly the _move columns; _external never fails', () => {
    assert.deepStrictEqual(q.rules, { minRows: 1, maxRows: 1, expectZero: moveCols })
    const aliases = [...q.sql.matchAll(/\bAS (\w+)/g)].map((m) => m[1])
    assert.deepStrictEqual(aliases.sort(), [...moveCols, ...externalCols].sort())
  })

  await check('every fixture lands in its class, in every audited column, on the real schema', () => {
    const db = openSchema()
    seed(db, [...MOVE, ...EXTERNAL, ...NEITHER])
    const row = db.prepare(q.sql).get()
    for (const [t] of AUDITED) {
      assert.strictEqual(row[`${t}_move`], MOVE.length, `${t}_move`)
      assert.strictEqual(row[`${t}_external`], EXTERNAL.length, `${t}_external`)
    }
    const v = d1.interpretD1Output(out([{ ...row }]), q.rules)
    assert.strictEqual(v.zeroCheck, 'FAIL')
    assert.strictEqual(v.ok, false)
  })

  await check('Google avatars and third-party hosts alone pass the check (the old audit failed here)', () => {
    const db = openSchema()
    seed(db, [...EXTERNAL, ...NEITHER])
    const row = db.prepare(q.sql).get()
    for (const [t] of AUDITED) {
      assert.strictEqual(row[`${t}_move`], 0, `${t}_move`)
      assert.strictEqual(row[`${t}_external`], EXTERNAL.length, `${t}_external`)
    }
    const v = d1.interpretD1Output(out([{ ...row }]), q.rules)
    assert.strictEqual(v.zeroCheck, 'PASS')
    assert.strictEqual(v.ok, true, JSON.stringify(v.problems))
  })

  await check('each move fixture alone, in each column alone, fails the check', () => {
    const db = openSchema()
    seed(db, [...EXTERNAL, ...NEITHER])
    for (const [table, column, json] of AUDITED) {
      for (const url of MOVE) {
        const rowid = insert(db, table, column, json ? JSON.stringify([url]) : url)
        const row = db.prepare(q.sql).get()
        db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(rowid)
        assert.strictEqual(row[`${table}_move`], 1, `${table}.${column} missed ${url}`)
        assert.strictEqual(d1.interpretD1Output(out([{ ...row }]), q.rules).zeroCheck, 'FAIL', `${table} ${url}`)
        assert.strictEqual(d1.interpretD1Output(out([{ ...db.prepare(q.sql).get() }]), q.rules).zeroCheck, 'PASS', `${table} cleanup`)
      }
    }
  })

  await check('relative upload paths are neither', () => {
    const db = openSchema()
    seed(db, NEITHER)
    const row = db.prepare(q.sql).get()
    for (const key of Object.keys(row)) assert.strictEqual(row[key], 0, key)
  })

  if (process.exitCode) console.error(`test-ops-r2-url-audit-pure: FAILED (${passed} passed)`)
  else console.log(`test-ops-r2-url-audit-pure: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
