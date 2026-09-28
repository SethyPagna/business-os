#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const RETENTION_SOURCES = ['audit.ts', 'importRetention.ts', 'ephemeralRetention.ts']
  .map((file) => path.join(ROOT, 'cloudflare', 'src', 'lib', file))

const SINGLE_ROW_QUERIES = ['r2-image-audit-summary', 'retention-health', 'd1-growth-candidates', 'd1-table-rows']
const TABLE_ROWS_QUERY = 'd1-table-rows'
const DBSTAT_PROBE = 'd1-dbstat-probe'
const SINGLE_ROW_RULES = { minRows: 1, maxRows: 1, expectZero: null }
const AT_LEAST_ONE_ROW_RULES = { minRows: 1, maxRows: null, expectZero: null }
// Cloudflare's limits page says 32, but workerd's D1 refuses json_object only at 128 arguments;
// node:sqlite accepts 1000, so running the query here cannot catch it.
const D1_MAX_FUNCTION_ARGS = 127
const COUNTED_TABLE = /'([a-z0-9_]+)', \(SELECT COUNT\(\*\) FROM ([a-z0-9_]+)\)/g

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

function migratedDatabase() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  return db
}

function migratedBaseTables(db) {
  return db.prepare(`SELECT name FROM pragma_table_list
    WHERE schema = 'main' AND type = 'table' AND substr(name, 1, 7) <> 'sqlite_' ORDER BY name`).all().map((row) => row.name)
}

function argumentCounts(sql, functionName) {
  const opener = `${functionName}(`
  const counts = []
  for (let start = sql.indexOf(opener); start !== -1; start = sql.indexOf(opener, start + 1)) {
    let depth = 0
    let args = 1
    let quoted = false
    for (let i = start + opener.length - 1; i < sql.length; i += 1) {
      const c = sql[i]
      if (c === "'") quoted = !quoted
      if (quoted) continue
      if (c === '(') depth += 1
      else if (c === ')' && --depth === 0) break
      else if (c === ',' && depth === 1) args += 1
    }
    counts.push(args)
  }
  return counts
}

function countedTables(sql) {
  return [...sql.matchAll(COUNTED_TABLE)].map(([, key, table]) => ({ key, table }))
}

async function main() {
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops', 'scripts', 'ops-sql-guard.mjs')).href)
  const db = migratedDatabase()
  const baseTables = migratedBaseTables(db)
  const load = (name) => guard.loadQuery(name)

  await check('the migrated schema has base tables to compare against', () => {
    assert.ok(baseTables.length > 100, `only ${baseTables.length} base tables after every migration`)
    assert.ok(!baseTables.some((name) => name.endsWith('_fts') || name.endsWith('_fts_data')), 'FTS virtual or shadow tables counted as base tables')
  })

  for (const name of SINGLE_ROW_QUERIES) {
    await check(`${name} passes the guard and returns exactly one row on the migrated schema`, () => {
      const query = load(name)
      assert.deepEqual(query.rules, SINGLE_ROW_RULES)
      const rows = db.prepare(query.sql).all()
      assert.equal(rows.length, 1)
      assert.ok(Object.keys(rows[0]).length > 0)
    })
  }

  await check(`${DBSTAT_PROBE} passes the guard and, where dbstat exists, measures every base table`, () => {
    const query = load(DBSTAT_PROBE)
    assert.deepEqual(query.rules, AT_LEAST_ONE_ROW_RULES)
    let rows
    try {
      rows = db.prepare(query.sql).all()
    } catch (err) {
      assert.match(err.message, /no such table: dbstat/)
      return
    }
    const measured = new Set(rows.map((row) => row.object))
    assert.deepEqual(baseTables.filter((table) => !measured.has(table)), [])
  })

  await check(`${TABLE_ROWS_QUERY} counts every migrated base table, each under its own name`, () => {
    const { sql } = load(TABLE_ROWS_QUERY)
    const entries = countedTables(sql)
    assert.equal(entries.length, (sql.match(/SELECT COUNT\(\*\)/g) || []).length, 'a counted sub-query is not in the \'<table>\', (SELECT COUNT(*) FROM <table>) form')
    assert.deepEqual(entries.filter(({ key, table }) => key !== table), [])
    const listed = entries.map(({ table }) => table)
    assert.deepEqual(listed.filter((table, i) => listed.indexOf(table) !== i), [], 'a table is listed twice')
    const missing = baseTables.filter((table) => !listed.includes(table))
    assert.deepEqual(missing, [], missing.map((table) => `add ${table} to ops/queries/${TABLE_ROWS_QUERY}.sql`).join('\n  '))
    const unknown = listed.filter((table) => !baseTables.includes(table))
    assert.deepEqual(unknown, [], unknown.map((table) => `remove ${table} from ops/queries/${TABLE_ROWS_QUERY}.sql: no migration creates it`).join('\n  '))
  })

  await check(`${TABLE_ROWS_QUERY} reports the same count as a direct COUNT(*) for every table`, () => {
    const { sql } = load(TABLE_ROWS_QUERY)
    const [row] = db.prepare(sql).all()
    const reported = Object.assign({}, ...Object.values(row).map((group) => JSON.parse(group)))
    assert.deepEqual(Object.keys(reported).sort(), baseTables)
    const actual = Object.fromEntries(baseTables.map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n]))
    assert.deepEqual(reported, actual)
    assert.ok(Object.values(actual).some((n) => n > 0), 'every table is empty, so the comparison cannot tell tables apart')
  })

  await check(`${TABLE_ROWS_QUERY} keeps every json_object call within workerd D1's ${D1_MAX_FUNCTION_ARGS}-argument limit`, () => {
    const counts = argumentCounts(load(TABLE_ROWS_QUERY).sql, 'json_object')
    assert.ok(counts.length > 0)
    assert.deepEqual(counts.filter((n) => n > D1_MAX_FUNCTION_ARGS), [], `json_object argument counts ${counts.join(', ')}: move tables to a new json_object group`)
  })

  await check('retention-health reads the settings keys the retention sweeps write', () => {
    const { sql } = load('retention-health')
    const keys = [...sql.matchAll(/FROM settings WHERE key = '([a-z0-9_]+)'/g)].map((m) => m[1])
    assert.ok(keys.length >= 5, `only ${keys.length} settings keys read`)
    const source = RETENTION_SOURCES.map((file) => fs.readFileSync(file, 'utf8')).join('\n')
    assert.deepEqual(keys.filter((key) => !source.includes(`'${key}'`)), [], 'no retention sweep writes these settings keys')
  })

  if (process.exitCode) console.error(`test-storage-queries-native: FAILED (${passed} passed)`)
  else console.log(`test-storage-queries-native: ${passed} checks passed`)
}

main().catch((err) => {
  console.error(`test-storage-queries-native: crashed: ${err && err.stack}`)
  process.exitCode = 1
})
