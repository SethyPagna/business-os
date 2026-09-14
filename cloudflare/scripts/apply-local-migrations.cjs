#!/usr/bin/env node
/**
 * Apply cloudflare/migrations to a LOCAL miniflare D1 file, in order.
 *
 * Why this exists instead of `npm run migrate:local`
 * --------------------------------------------------
 * `wrangler d1 migrations apply business-os --local` cannot apply this
 * project's migration set at all on wrangler 4.116.0. It concatenates every
 * pending file into one local query and dies in its own result aggregation:
 *
 *     X [ERROR] too many terms in compound SELECT: SQLITE_ERROR
 *       at executeLocally (wrangler-dist/cli.js:283614)
 *
 * Measured: the first run applied the schema through 0097 and recorded 97 rows
 * in d1_migrations before erroring; re-running with 64 files still pending
 * failed the same way and applied NOTHING, so it does not converge by
 * repetition. SQLITE_MAX_COMPOUND_SELECT is a compile-time limit in workerd,
 * not something a flag can raise.
 *
 * This applier is deliberately boring: same files, same order, one transaction
 * per file, recorded in the same d1_migrations table wrangler uses, so a later
 * `wrangler d1 migrations list --local` agrees with it. It writes ONLY to a
 * local file under --persist-to. It has no remote mode and cannot acquire one:
 * there is no network code here at all.
 *
 * Usage:
 *   node scripts/apply-local-migrations.cjs --persist-to <dir>
 */
'use strict'

const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

function parseArgs(argv) {
  const out = { persistTo: path.join(__dirname, '..', '.wrangler', 'state') }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--persist-to') { out.persistTo = argv[i + 1]; i += 1 }
  }
  return out
}

/** miniflare stores each D1 database as one sqlite file under
 *  <persist>/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite. The hash is
 *  derived from the binding, so rather than recompute it, take the single
 *  non-metadata file -- and fail loudly if there is more than one. */
function resolveDatabaseFile(persistTo) {
  const dir = path.join(persistTo, 'v3', 'd1', 'miniflare-D1DatabaseObject')
  if (!fs.existsSync(dir)) {
    throw new Error(`No local D1 state at ${dir}. Start it once with:\n  npx wrangler d1 execute business-os --local --persist-to "${persistTo}" --command "SELECT 1"`)
  }
  const candidates = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one D1 file in ${dir}, found ${candidates.length}: ${candidates.join(', ')}`)
  }
  return path.join(dir, candidates[0])
}

function main() {
  const { persistTo } = parseArgs(process.argv.slice(2))
  const file = resolveDatabaseFile(persistTo)
  const db = new Database(file)
  db.pragma('foreign_keys = OFF')
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)')

  const applied = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((row) => row.name))
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort()
  const pending = files.filter((name) => !applied.has(name))
  console.log(`[migrate-local] ${file}`)
  console.log(`[migrate-local] ${applied.size} applied, ${pending.length} pending`)

  const record = db.prepare('INSERT INTO d1_migrations (name) VALUES (?)')
  let done = 0
  for (const name of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
    try {
      db.exec('BEGIN')
      db.exec(sql)
      record.run(name)
      db.exec('COMMIT')
      done += 1
    } catch (error) {
      db.exec('ROLLBACK')
      console.error(`[migrate-local] FAILED at ${name}: ${error.message}`)
      process.exit(1)
    }
  }
  console.log(`[migrate-local] applied ${done} migration(s); now at ${db.prepare('SELECT MAX(name) AS last FROM d1_migrations').get().last}`)
}

main()
