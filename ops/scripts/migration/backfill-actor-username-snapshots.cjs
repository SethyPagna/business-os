#!/usr/bin/env node
'use strict'

/*
 * N13 -- historical actor snapshots: bring every denormalized `*_name` actor
 * column into line with the account USERNAME.
 *
 * PREPARED, NOT APPLIED. This script has no network, no Wrangler and no remote
 * capability whatsoever: it opens ONE local SQLite file with node:sqlite and,
 * unless it is given --apply, it opens that file read-only and writes nothing.
 * Running it against production is not something it can do; a production run is
 * an owner decision that would go through the repository's normal D1 path.
 *
 * WHY
 * ---
 * From this change forward the Worker resolves the actor snapshot to the
 * account username server-side (cloudflare/src/lib/actorSnapshot.ts, and
 * audit() resolving from users.id). Rows written BEFORE that still hold
 * whatever the old writers stored -- almost always the account's full NAME
 * ("Za Sethy"), and on sales whatever the client sent. So a ledger reads
 * "Za Sethy" above the fold and "za" below it, for the same person.
 *
 * WHAT IT DOES
 * ------------
 * Nothing new. It replays the EXISTING rename cascade
 * (cloudflare/src/lib/userIdentity.ts -> USER_NAME_SNAPSHOTS /
 * buildUserRenameStatements) once per account, with each account's CURRENT
 * username. That cascade is already the system's definition of "propagate the
 * username to every snapshot", it already runs on every rename, and it already
 * skips rows that are correct. Reusing it means this backfill cannot invent a
 * different rule, and cannot touch a table the cascade deliberately leaves
 * alone -- `audit_logs` is excluded there as a point-in-time record and is
 * excluded here for the same reason.
 *
 * Rows whose id column is NULL (no linked account: imports, legacy rows,
 * system actions) are NOT touched. There is no account to resolve them to, and
 * guessing one would fabricate an actor.
 *
 * USAGE
 * -----
 *   node ops/scripts/migration/backfill-actor-username-snapshots.cjs --db <file>
 *       Dry run (default). Opens read-only. Prints, per table and per account,
 *       how many rows disagree with the username, plus a sample of the
 *       before/after values, and writes a plan JSON next to the db when asked
 *       with --out <file>.
 *
 *   ... --db <file> --apply --i-have-a-backup
 *       Applies the same statements to that LOCAL file inside one transaction.
 *       Both flags are required; either one alone refuses.
 *
 * RECOVERY
 * --------
 * 1. The dry run writes a recovery table into its plan JSON: for every row it
 *    would change, {table, id_column, id, name_column, before, after}. Restoring
 *    is `UPDATE <table> SET <name_column> = <before> WHERE rowid = <rowid>`, and
 *    the plan carries the rowid. Keep the plan file.
 * 2. --apply runs inside BEGIN/COMMIT on a single file: a failure part-way rolls
 *    the whole thing back, so the file is never half-converted.
 * 3. The change is idempotent and self-healing. Re-running produces zero
 *    changes, and any row this misses is repaired the next time that account is
 *    renamed, because it is the same statements the rename already runs.
 * 4. Nothing here is destructive in the "data is gone" sense: it overwrites a
 *    denormalized copy of a value that is still derivable from the id column
 *    beside it. Even with no plan file, the correct value is
 *    (SELECT username FROM users WHERE id = <the row's id column>).
 */

const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

// Mirrors cloudflare/src/lib/userIdentity.ts's USER_NAME_SNAPSHOTS. Kept as a
// literal here (this script must not import TypeScript), and verified against
// that file at startup so the two cannot drift.
const SNAPSHOTS = [
  { table: 'sales', idColumn: 'cashier_id', nameColumn: 'cashier_name' },
  { table: 'returns', idColumn: 'cashier_id', nameColumn: 'cashier_name' },
  { table: 'inventory_movements', idColumn: 'user_id', nameColumn: 'user_name' },
  { table: 'stock_row_moves', idColumn: 'user_id', nameColumn: 'user_name' },
  { table: 'stock_transfers', idColumn: 'user_id', nameColumn: 'user_name' },
  { table: 'damaged_stock_lots', idColumn: 'created_by_user_id', nameColumn: 'created_by_user_name' },
  { table: 'action_history', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'ai_provider_configs', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'ai_response_logs', idColumn: 'actor_user_id', nameColumn: 'actor_user_name' },
  { table: 'bulk_delete_jobs', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'file_assets', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'import_jobs', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'loyalty_point_adjustments', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
  { table: 'undo_snapshots', idColumn: 'created_by_id', nameColumn: 'created_by_name' },
]

function parseArgs(argv) {
  const args = { db: '', out: '', apply: false, backup: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--db') { args.db = argv[i + 1] || ''; i += 1 }
    else if (arg === '--out') { args.out = argv[i + 1] || ''; i += 1 }
    else if (arg === '--apply') args.apply = true
    else if (arg === '--i-have-a-backup') args.backup = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return args
}

// The list above must match the Worker's. A snapshot table added there and not
// here would be silently skipped by the backfill.
function assertSnapshotListMatchesWorker(repoRoot) {
  const source = path.join(repoRoot, 'cloudflare', 'src', 'lib', 'userIdentity.ts')
  if (!fs.existsSync(source)) return { checked: false, reason: 'userIdentity.ts not found' }
  const text = fs.readFileSync(source, 'utf8')
  const block = text.slice(text.indexOf('USER_NAME_SNAPSHOTS'), text.indexOf(']', text.indexOf('USER_NAME_SNAPSHOTS')))
  const found = [...block.matchAll(/table:\s*'([^']+)',\s*idColumn:\s*'([^']+)',\s*nameColumn:\s*'([^']+)'/g)]
    .map((match) => `${match[1]}.${match[3]}<-${match[2]}`)
  const mine = SNAPSHOTS.map((s) => `${s.table}.${s.nameColumn}<-${s.idColumn}`)
  const missing = found.filter((key) => !mine.includes(key))
  const extra = mine.filter((key) => !found.includes(key))
  if (missing.length || extra.length) {
    throw new Error(
      'snapshot list has drifted from cloudflare/src/lib/userIdentity.ts\n' +
      (missing.length ? `  present in the Worker, missing here: ${missing.join(', ')}\n` : '') +
      (extra.length ? `  present here, missing in the Worker: ${extra.join(', ')}\n` : ''),
    )
  }
  return { checked: true, count: found.length }
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)
  return Boolean(row)
}

function plan(db) {
  const users = db.prepare("SELECT id, username, name FROM users WHERE TRIM(COALESCE(username, '')) <> ''").all()
  const entries = []
  const perTable = []
  for (const snapshot of SNAPSHOTS) {
    if (!tableExists(db, snapshot.table)) {
      perTable.push({ table: snapshot.table, present: false, rows: 0 })
      continue
    }
    let rows = 0
    const select = db.prepare(
      `SELECT rowid AS rowid, ${snapshot.idColumn} AS actor_id, ${snapshot.nameColumn} AS stored
       FROM ${snapshot.table}
       WHERE ${snapshot.idColumn} = ?
         AND (${snapshot.nameColumn} IS NULL OR ${snapshot.nameColumn} != ?)`,
    )
    for (const user of users) {
      for (const row of select.all(user.id, user.username)) {
        rows += 1
        entries.push({
          table: snapshot.table,
          rowid: row.rowid,
          id_column: snapshot.idColumn,
          id: user.id,
          name_column: snapshot.nameColumn,
          before: row.stored,
          after: user.username,
        })
      }
    }
    perTable.push({ table: snapshot.table, present: true, rows })
  }
  return { users, entries, perTable }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.db) {
    console.log('usage: node backfill-actor-username-snapshots.cjs --db <local.sqlite> [--out plan.json] [--apply --i-have-a-backup]')
    process.exit(args.help ? 0 : 2)
  }
  if (args.apply !== args.backup) {
    console.error('refusing: --apply requires --i-have-a-backup (and vice versa)')
    process.exit(2)
  }
  const dbPath = path.resolve(args.db)
  if (!fs.existsSync(dbPath)) {
    console.error(`refusing: no such file: ${dbPath}`)
    process.exit(2)
  }

  const repoRoot = path.resolve(__dirname, '..', '..', '..')
  const drift = assertSnapshotListMatchesWorker(repoRoot)
  console.log(`snapshot list: ${drift.checked ? `${drift.count} tables, matches userIdentity.ts` : `NOT verified (${drift.reason})`}`)

  const db = new DatabaseSync(dbPath, { readOnly: !args.apply })
  console.log(`db: ${dbPath} (${args.apply ? 'READ-WRITE' : 'read-only'})`)

  const { users, entries, perTable } = plan(db)
  console.log(`accounts with a username: ${users.length}`)
  for (const row of perTable) {
    if (!row.present) { console.log(`  ${row.table.padEnd(28)} table absent`); continue }
    console.log(`  ${row.table.padEnd(28)} ${String(row.rows).padStart(7)} row(s) to correct`)
  }
  console.log(`total rows to correct: ${entries.length}`)

  const samples = entries.slice(0, 10)
  if (samples.length) {
    console.log('sample:')
    for (const entry of samples) {
      console.log(`  ${entry.table}.${entry.name_column} rowid=${entry.rowid}: ${JSON.stringify(entry.before)} -> ${JSON.stringify(entry.after)}`)
    }
  }

  if (args.out) {
    const planFile = path.resolve(args.out)
    fs.writeFileSync(planFile, JSON.stringify({
      generated_at_utc: new Date().toISOString(),
      db: dbPath,
      applied: args.apply,
      totals: perTable,
      // The recovery table: every row this would change, with the value it had.
      recovery: entries,
    }, null, 2))
    console.log(`plan written: ${planFile}`)
  }

  if (!args.apply) {
    console.log('\nDRY RUN -- nothing was written. Re-run with --apply --i-have-a-backup to change this LOCAL file.')
    db.close()
    return
  }

  // One transaction over one local file: a failure rolls the whole thing back.
  db.exec('BEGIN')
  let changed = 0
  try {
    for (const snapshot of SNAPSHOTS) {
      if (!tableExists(db, snapshot.table)) continue
      const update = db.prepare(
        `UPDATE ${snapshot.table} SET ${snapshot.nameColumn} = ?
         WHERE ${snapshot.idColumn} = ?
           AND (${snapshot.nameColumn} IS NULL OR ${snapshot.nameColumn} != ?)`,
      )
      for (const user of users) {
        const result = update.run(user.username, user.id, user.username)
        changed += Number(result.changes || 0)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  console.log(`applied: ${changed} row(s) updated`)

  // Post-assertion: a second plan over the same file must be empty.
  const after = plan(db)
  if (after.entries.length !== 0) {
    console.error(`POST-ASSERTION FAILED: ${after.entries.length} row(s) still disagree after the apply`)
    db.close()
    process.exit(1)
  }
  console.log('post-assertion: 0 rows disagree with their account username')
  db.close()
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(String((error && error.message) || error))
    process.exit(1)
  }
}

module.exports = { SNAPSHOTS, plan, assertSnapshotListMatchesWorker }
