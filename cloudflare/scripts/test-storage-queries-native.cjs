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
// Cloudflare's D1 limits page: 32 arguments per SQL function. workerd refuses only at 128 and
// node:sqlite at 1000, so running a query here cannot catch it.
const D1_MAX_FUNCTION_ARGS = 32
const COUNTED_TABLE = /'([a-z0-9_]+)', \(SELECT COUNT\(\*\) FROM ([a-z0-9_]+)\)/g
const NOT_A_FUNCTION = new Set([
  'ALL', 'AND', 'AS', 'BETWEEN', 'BY', 'CASE', 'COLLATE', 'DISTINCT', 'ELSE', 'ESCAPE', 'EXCEPT', 'EXISTS', 'FILTER',
  'FROM', 'GLOB', 'HAVING', 'IN', 'INTERSECT', 'IS', 'JOIN', 'LIKE', 'LIMIT', 'MATCH', 'MATERIALIZED', 'NOT', 'OFFSET',
  'ON', 'OR', 'OVER', 'RECURSIVE', 'REGEXP', 'SELECT', 'THEN', 'UNION', 'USING', 'VALUES', 'WHEN', 'WHERE', 'WINDOW', 'WITH',
])
const CTE_BODY_PREFIX = new Set(['NOT', 'MATERIALIZED'])

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

function sqlTokens(sql, scanSql) {
  const tokens = []
  for (const part of scanSql(sql)) {
    if (part.type === 'string' || part.type === 'ident') tokens.push({ word: false, text: part.text })
    if (part.type !== 'code') continue
    for (const [text] of part.text.matchAll(/[A-Za-z_][A-Za-z0-9_$]*|[0-9][A-Za-z0-9_.]*|\S/g)) {
      tokens.push({ word: /^[A-Za-z_]/.test(text), text })
    }
  }
  return tokens
}

function isCteColumnList(tokens, closeIndex) {
  if (tokens[closeIndex + 1]?.text.toUpperCase() !== 'AS') return false
  let next = closeIndex + 2
  while (CTE_BODY_PREFIX.has(tokens[next]?.text.toUpperCase())) next += 1
  return tokens[next]?.text === '('
}

// Every function call in `sql` as [name, argument count], innermost first.
function functionCalls(sql, scanSql) {
  const tokens = sqlTokens(sql, scanSql)
  const calls = []
  const open = []
  tokens.forEach((token, index) => {
    const previous = tokens[index - 1]
    if (token.text === '(') {
      const name = previous?.word && !NOT_A_FUNCTION.has(previous.text.toUpperCase()) ? previous.text : null
      open.push({ name, commas: 0, empty: tokens[index + 1]?.text === ')' })
    } else if (token.text === ',' && open.length) {
      open[open.length - 1].commas += 1
    } else if (token.text === ')') {
      const frame = open.pop()
      if (frame?.name && !isCteColumnList(tokens, index)) calls.push([frame.name, frame.empty ? 0 : frame.commas + 1])
    }
  })
  return calls
}

const columnList = (count) => Array.from({ length: count }, (_, i) => `c${i}`).join(', ')
const FUNCTION_CALL_CASES = [
  ['SELECT f(1, 2, 3), g()', [['f', 3], ['g', 0]]],
  ['SELECT COUNT(*) FROM t', [['COUNT', 1]]],
  ["SELECT f('a, b)', \"c,(d\", [e,f], `g,h`, 'it''s, (x')", [['f', 5]]],
  ['SELECT f(1 /* , , ( */, 2) -- , ) ,\n', [['f', 2]]],
  ['SELECT f(g(1, 2), (SELECT h(3, 4, 5) FROM t WHERE x IN (1, 2, 3, 4)), 6)', [['g', 2], ['h', 3], ['f', 3]]],
  [`WITH c(${columnList(40)}) AS NOT MATERIALIZED (SELECT 1) SELECT * FROM c WHERE c0 NOT IN (${columnList(40)}) AND EXISTS (SELECT 1)`, []],
  ["SELECT CAST(x AS BLOB), json_object('k', (SELECT COUNT(*) FROM t)) AS rows_1 FROM t", [['CAST', 1], ['COUNT', 1], ['json_object', 2]]],
  [`SELECT json_object(${Array.from({ length: 17 }, (_, i) => `'k${i}', ${i}`).join(', ')})`, [['json_object', 34]]],
]

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

  await check('the function-call counter counts arguments the way SQLite parses them', () => {
    for (const [sql, expected] of FUNCTION_CALL_CASES) assert.deepEqual(functionCalls(sql, guard.scanSql), expected, sql)
    const overLimit = functionCalls(FUNCTION_CALL_CASES[FUNCTION_CALL_CASES.length - 1][0], guard.scanSql).filter(([, args]) => args > D1_MAX_FUNCTION_ARGS)
    assert.deepEqual(overLimit, [['json_object', 34]], 'a json_object of 17 key/value pairs is over the limit')
  })

  await check(`no SQL function call in ops/queries passes more than ${D1_MAX_FUNCTION_ARGS} arguments (D1's limit)`, () => {
    const names = guard.listQueries()
    assert.ok(names.includes(TABLE_ROWS_QUERY))
    const tableRowsSql = load(TABLE_ROWS_QUERY).sql
    const jsonObjectArgs = functionCalls(tableRowsSql, guard.scanSql).filter(([name]) => name === 'json_object').map(([, args]) => args)
    assert.equal(jsonObjectArgs.reduce((sum, args) => sum + args, 0), 2 * countedTables(tableRowsSql).length, `${TABLE_ROWS_QUERY}: the counter missed arguments`)
    const over = names.flatMap((name) => functionCalls(load(name).sql, guard.scanSql)
      .filter(([, args]) => args > D1_MAX_FUNCTION_ARGS)
      .map(([fn, args]) => `ops/queries/${name}.sql: ${fn}() takes ${args} arguments`))
    assert.deepEqual(over, [], 'split the call (json_object: groups of at most 16 key/value pairs)')
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
