#!/usr/bin/env node
// Read-only production D1 snapshot tool (P2-3b, step 0).
//
// Dumps every non-FTS table in the `business-os` D1 database to
// <table>.jsonl files under an output directory, plus a manifest.json,
// a rebuilt snapshot.sqlite, and a SHA256SUMS file. Every remote
// statement it issues MUST start with `SELECT` -- assertSelect() throws
// before any non-SELECT string ever reaches wrangler. No PRAGMA, no
// --file, no migrations, no --local writes to shared state.
//
// Usage (from cloudflare/):
//   node ../ops/scripts/latest-data/snapshot-d1-readonly.mjs <output-dir>
//
// See README.md in this folder for details.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const CLOUDFLARE_DIR = path.join(REPO_ROOT, 'cloudflare')
const DATABASE_NAME = 'business-os'
const PAGE_SIZE = 1000
const MIN_DELAY_MS = 260 // keeps us well under the "<=4 requests/second" gentleness rule

function sleep(ms) {
  // Synchronous sleep (Node allows Atomics.wait on the main thread; browsers do not).
  const sab = new SharedArrayBuffer(4)
  const ia = new Int32Array(sab)
  Atomics.wait(ia, 0, 0, ms)
}

function assertSelect(sql) {
  const trimmed = String(sql).trim()
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error(`Refused non-SELECT statement: ${trimmed.slice(0, 120)}`)
  }
  // Defense in depth: reject statement-separator smuggling and obvious write keywords.
  if (/;\s*\S/.test(trimmed)) {
    throw new Error(`Refused multi-statement SQL (contains ';' followed by more content): ${trimmed.slice(0, 120)}`)
  }
  if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i.test(trimmed)) {
    throw new Error(`Refused statement containing a write/DDL keyword: ${trimmed.slice(0, 120)}`)
  }
  return trimmed
}

let requestCount = 0
function d1(sql) {
  assertSelect(sql)
  requestCount += 1
  const result = spawnSync(
    process.execPath,
    ['scripts/with-wrangler-auth.cjs', 'wrangler', 'd1', 'execute', DATABASE_NAME, '--remote', '--json', '--command', sql],
    { cwd: CLOUDFLARE_DIR, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  )
  sleep(MIN_DELAY_MS)
  if (result.status !== 0) {
    throw new Error(`D1 query failed (${result.status}): ${(result.stderr || result.stdout || '').slice(0, 2000)}`)
  }
  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (err) {
    throw new Error(`Failed to parse wrangler JSON output: ${err.message}\n${result.stdout.slice(0, 2000)}`)
  }
  return parsed.flatMap((entry) => entry.results || [])
}

function fetchAllPaged(table, orderBy) {
  const rows = []
  let offset = 0
  while (true) {
    const page = d1(`SELECT * FROM "${table}" ORDER BY ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${offset}`)
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

function countTable(table) {
  const rows = d1(`SELECT COUNT(*) AS c FROM "${table}"`)
  return Number(rows[0]?.c ?? 0)
}

// Best-effort column-name extraction from a `CREATE TABLE ...` DDL string,
// used only as a fallback label in the manifest (never used to build SQL).
function columnsFromDdl(ddl) {
  const open = ddl.indexOf('(')
  const close = ddl.lastIndexOf(')')
  if (open === -1 || close === -1 || close <= open) return []
  const body = ddl.slice(open + 1, close)
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of body) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  const cols = []
  for (const raw of parts) {
    const t = raw.trim()
    if (!t) continue
    const upper = t.toUpperCase()
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/.test(upper)) continue
    const nameMatch = t.match(/^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)/)
    if (!nameMatch) continue
    const name = nameMatch[1].replace(/^["`[]|["`\]]$/g, '')
    cols.push(name)
  }
  return cols
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function main() {
  const outDirArg = process.argv[2]
  if (!outDirArg) {
    console.error('Usage: node snapshot-d1-readonly.mjs <output-dir>')
    process.exit(1)
  }
  const outDir = path.resolve(outDirArg)
  fs.mkdirSync(outDir, { recursive: true })

  console.log(`[snapshot] database=${DATABASE_NAME} outDir=${outDir}`)
  console.log('[snapshot] harmless probe: SELECT 1')
  const probe = d1('SELECT 1 AS ok')
  if (probe[0]?.ok !== 1) throw new Error('Probe query did not return expected result')

  console.log('[snapshot] enumerating tables from sqlite_master')
  const allTables = d1(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  )

  const ftsFamily = allTables.filter((t) => t.name.includes('_fts'))
  const dumpTables = allTables.filter((t) => !t.name.includes('_fts'))

  const wranglerVersionResult = spawnSync(
    process.execPath,
    ['scripts/with-wrangler-auth.cjs', 'wrangler', '--version'],
    { cwd: CLOUDFLARE_DIR, encoding: 'utf8' },
  )
  const wranglerVersion = (wranglerVersionResult.stdout || '').trim() || 'unknown'

  const manifest = {
    captured_at_utc: new Date().toISOString(),
    wrangler_version: wranglerVersion,
    database_name: DATABASE_NAME,
    tables: [],
    fts_family_tables: [],
    totals: { rows_dumped: 0, tables_dumped: 0, tables_drifted: 0 },
    drift: [],
  }

  // Record FTS-family tables: name + row count only, never dumped.
  for (const t of ftsFamily) {
    let count = null
    let error = null
    try {
      count = countTable(t.name)
    } catch (err) {
      error = err.message
    }
    manifest.fts_family_tables.push({ name: t.name, row_count: count, error })
    console.log(`[snapshot] fts-family (not dumped): ${t.name} rows=${count ?? 'ERROR: ' + error}`)
  }

  for (const t of dumpTables) {
    const countBefore = countTable(t.name)
    let orderBy = 'rowid'
    let rows
    try {
      rows = fetchAllPaged(t.name, orderBy)
    } catch (err) {
      // WITHOUT ROWID tables (or any other reason rowid ordering fails):
      // fall back to no explicit order (still a plain unqualified SELECT *).
      console.warn(`[snapshot] rowid ordering failed for ${t.name}, retrying without ORDER BY: ${err.message}`)
      orderBy = null
      rows = []
      let offset = 0
      while (true) {
        const page = d1(`SELECT * FROM "${t.name}" LIMIT ${PAGE_SIZE} OFFSET ${offset}`)
        rows.push(...page)
        if (page.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }
    }
    const countAfter = countTable(t.name)

    const fileName = `${t.name}.jsonl`
    const filePath = path.join(outDir, fileName)
    const lines = rows.map((r) => JSON.stringify(r)).join('\n')
    fs.writeFileSync(filePath, rows.length ? `${lines}\n` : '')
    const sha256 = sha256File(filePath)

    const columns = rows.length ? Object.keys(rows[0]) : columnsFromDdl(t.sql || '')

    const drifted = countBefore !== countAfter
    manifest.tables.push({
      name: t.name,
      columns,
      count_before: countBefore,
      count_after: countAfter,
      rows_dumped: rows.length,
      file: fileName,
      sha256,
      order_by: orderBy,
    })
    manifest.totals.rows_dumped += rows.length
    manifest.totals.tables_dumped += 1
    if (drifted) {
      manifest.totals.tables_drifted += 1
      manifest.drift.push({
        table: t.name,
        count_before: countBefore,
        count_after: countAfter,
        rows_dumped: rows.length,
        note: 'row count changed between the pre-dump and post-dump COUNT(*); table was still fully paged, but may include a torn read',
      })
    }
    console.log(
      `[snapshot] ${t.name}: before=${countBefore} after=${countAfter} dumped=${rows.length}${drifted ? ' DRIFT' : ''}`,
    )
  }

  manifest.request_count = requestCount
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log('[snapshot] building snapshot.sqlite from captured DDL + jsonl rows')
  buildSqlite(outDir, dumpTables, manifest)

  console.log('[snapshot] writing SHA256SUMS')
  writeShaSums(outDir)

  console.log('[snapshot] done')
  console.log(
    JSON.stringify(
      {
        outDir,
        capturedAt: manifest.captured_at_utc,
        tablesDumped: manifest.totals.tables_dumped,
        rowsDumped: manifest.totals.rows_dumped,
        ftsFamilyCount: manifest.fts_family_tables.length,
        driftCount: manifest.drift.length,
        requestCount,
      },
      null,
      2,
    ),
  )
}

function buildSqlite(outDir, dumpTables, manifest) {
  // better-sqlite3 is available via the cloudflare/node_modules junction
  // into the main checkout. Read-only use of the module (we only use it to
  // build our own local output file, never to touch any shared DB file).
  const requireFromCloudflare = createRequire(path.join(CLOUDFLARE_DIR, 'package.json'))
  const Database = requireFromCloudflare('better-sqlite3')
  const sqlitePath = path.join(outDir, 'snapshot.sqlite')
  if (fs.existsSync(sqlitePath)) fs.rmSync(sqlitePath)
  const db = new Database(sqlitePath)
  db.pragma('journal_mode = WAL')

  for (const t of dumpTables) {
    if (!t.sql) continue
    db.exec(t.sql)
  }

  const manifestByName = new Map(manifest.tables.map((m) => [m.name, m]))
  for (const t of dumpTables) {
    const m = manifestByName.get(t.name)
    if (!m || !t.sql) continue
    const filePath = path.join(outDir, m.file)
    const content = fs.readFileSync(filePath, 'utf8')
    const lines = content.split('\n').filter((l) => l.trim())
    if (lines.length === 0) continue
    const firstRow = JSON.parse(lines[0])
    const cols = Object.keys(firstRow)
    const placeholders = cols.map(() => '?').join(', ')
    const colList = cols.map((c) => `"${c}"`).join(', ')
    const insert = db.prepare(`INSERT INTO "${t.name}" (${colList}) VALUES (${placeholders})`)
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insert.run(cols.map((c) => normalizeForSqlite(row[c])))
      }
    })
    const rows = lines.map((l) => JSON.parse(l))
    insertMany(rows)
    const dbCount = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c
    if (dbCount !== m.rows_dumped) {
      throw new Error(`snapshot.sqlite row count mismatch for ${t.name}: db=${dbCount} manifest=${m.rows_dumped}`)
    }
  }
  db.close()

  if (process.platform === 'win32') {
    const attrib = spawnSync('attrib', ['+R', sqlitePath], { encoding: 'utf8' })
    if (attrib.status !== 0) {
      console.warn(`[snapshot] warning: failed to set snapshot.sqlite read-only via attrib: ${attrib.stderr}`)
    }
  } else {
    fs.chmodSync(sqlitePath, 0o444)
  }
}

function normalizeForSqlite(value) {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

main()
