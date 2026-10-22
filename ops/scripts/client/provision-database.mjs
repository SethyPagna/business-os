#!/usr/bin/env node
// Provision a NEW client database from the schema baseline instead of the chain.
//
//   node ops/scripts/client/provision-database.mjs --local <file.sqlite>
//       Applies cloudflare/baseline/schema-0269.sql to an EMPTY local SQLite file,
//       writes the d1_migrations stamp (every migration file through 0269), and
//       asserts the sqlite_master fingerprint equals a schema-only replay of the
//       chain and that no row exists beyond the seed allowlist. All or nothing.
//       Refuses any database that is not empty.
//
//   node ops/scripts/client/provision-database.mjs --remote --database <name> [--config <wrangler.toml>]
//       PRINTS the exact commands. Executes nothing: this file imports no
//       process-spawning or network module (a test pins that). Steps marked WRITE
//       change the named database and need the owner's explicit approval; steps
//       marked READ are SELECT-only.
//
//   --emit-stamp-sql                   print the d1_migrations stamp as SQL (for the remote plan)
//   --verify-schema-json <file>        compare a saved `d1 execute --json` run of the schema query with the baseline fingerprint
//
// Why baseline + stamp: docs/setup/migrations-multi-client.md.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..', '..')
const base = require(path.join(root, 'cloudflare', 'scripts', 'harness', 'client_baseline.cjs'))
const Database = require(path.join(root, 'cloudflare', 'node_modules', 'better-sqlite3'))

function arg(name) {
  const at = process.argv.indexOf(name)
  return at < 0 ? null : process.argv[at + 1]
}
const has = (name) => process.argv.includes(name)

function die(message) {
  console.error(message)
  process.exit(1)
}

const through = Number(arg('--through') || base.DEFAULT_THROUGH)
const baselineFile = arg('--baseline') || base.baselinePath(through)

/** Current chain build; the baseline on disk must equal it byte for byte. */
function loadBuilt() {
  if (!fs.existsSync(baselineFile)) die(`baseline missing: ${baselineFile}\nbuild it: node ops/scripts/client/build-baseline.mjs`)
  const baselineSql = fs.readFileSync(baselineFile, 'utf8')
  const built = base.buildBaseline({ through })
  if (baselineSql !== built.text) die(`baseline is stale against the migration chain: ${baselineFile}\nrebuild it: node ops/scripts/client/build-baseline.mjs`)
  return { baselineSql, built }
}

function stampSql(names) {
  return [base.D1_MIGRATIONS_DDL + ';', ...names.map((n) => `INSERT INTO d1_migrations (name) VALUES ('${n}');`), ''].join('\n')
}

function localMode(file) {
  const { baselineSql, built } = loadBuilt()
  const existed = fs.existsSync(file)
  const db = new Database(file)
  try {
    base.provision(db, { baselineSql, stampNames: built.stampNames, expectedFingerprint: built.fingerprint })
  } catch (error) {
    db.close()
    if (!existed) fs.rmSync(file, { force: true })
    die(`provisioning failed, nothing was written: ${error.message}`)
  }
  const census = base.rowCensus(db)
  db.close()
  console.log(`provisioned ${file}`)
  console.log(`schema fingerprint ${built.fingerprint} equals a schema-only replay of the chain through ${String(through).padStart(4, '0')}`)
  console.log(`stamped ${built.stampNames.length} migrations (${built.stampNames[0]} .. ${built.stampNames[built.stampNames.length - 1]})`)
  console.log(`rows: ${JSON.stringify(census)}`)
  console.log('next: the normal chain applies 0270 and later; client settings come from the client config, not from a migration.')
}

function remotePlan(database, config) {
  const w = `wrangler d1 execute ${database} --remote${config ? ` --config ${config}` : ''}`
  const rel = path.relative(path.join(root, 'cloudflare'), baselineFile).replace(/\\/g, '/')
  const names = base.chainFiles({ through })
  console.log(`PLAN ONLY. Nothing below has been run.
Steps marked WRITE change the database and need the owner's explicit approval; READ steps are SELECT-only.
Run wrangler through the approved ops path from the cloudflare/ directory (the wrapper adds the credentials);
run the node commands from the repo root.
Target database: ${database}${config ? `   config: ${config}` : '   (pass --config for the client\'s own account)'}

0. READ   the database must be empty (expect zero rows):
   ${w} --json --command "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'"

1. WRITE  apply the schema baseline and the ${base.SEED_ROWS.length} seed rows (${rel}):
   ${w} --file ${rel}

2. WRITE  stamp the ledger with ${names.length} migration names (${names[0]} .. ${names[names.length - 1]}):
   node ops/scripts/client/provision-database.mjs --emit-stamp-sql > <tmp>/stamp-${String(through).padStart(4, '0')}.sql
   ${w} --file <tmp>/stamp-${String(through).padStart(4, '0')}.sql

3. READ   the schema fingerprint must match the baseline (expect MATCH):
   ${w} --json --command "${base.SCHEMA_SELECT_SQL.replace(/"/g, '\\"')}" > <tmp>/schema.json
   node ops/scripts/client/provision-database.mjs --verify-schema-json <tmp>/schema.json

4. READ   rows (expect ${names.length}, then exactly the seed keys, then all zero):
   ${w} --json --command "SELECT COUNT(*) AS stamped FROM d1_migrations"
   ${w} --json --command "SELECT key, value FROM system_flags ORDER BY key"
   ${w} --json --command "SELECT (SELECT COUNT(*) FROM fees) fees, (SELECT COUNT(*) FROM organizations) organizations, (SELECT COUNT(*) FROM user_aliases) user_aliases, (SELECT COUNT(*) FROM customers) customers, (SELECT COUNT(*) FROM products) products, (SELECT COUNT(*) FROM sales) sales, (SELECT COUNT(*) FROM settings) settings"

Then \`wrangler d1 migrations apply ${database} --remote\` applies 0270 and later only.`)
}

function verifySchemaJson(file) {
  const { built } = loadBuilt()
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  const rows = (Array.isArray(parsed) ? parsed : [parsed]).flatMap((entry) => entry.results || [])
  if (!rows.length) die('no rows in the saved result: was the schema query run with --json against the right database?')
  const remote = rows.map((r) => ({ type: r.type, name: r.name, tbl_name: r.tbl_name, sql: r.sql }))
  const actual = base.fingerprint(remote)
  if (actual === built.fingerprint) {
    console.log(`MATCH ${actual} (${remote.length} objects)`)
    return
  }
  const want = new Map(built.objects.map((o) => [`${o.type} ${o.name}`, o.sql]))
  const got = new Map(remote.map((o) => [`${o.type} ${o.name}`, o.sql]))
  const missing = [...want.keys()].filter((k) => !got.has(k))
  const extra = [...got.keys()].filter((k) => !want.has(k))
  const differing = [...want.keys()].filter((k) => got.has(k) && got.get(k) !== want.get(k))
  console.error(`MISMATCH expected ${built.fingerprint}, found ${actual}`)
  console.error(`missing ${missing.length}: ${missing.slice(0, 10).join(', ')}`)
  console.error(`extra ${extra.length}: ${extra.slice(0, 10).join(', ')}`)
  console.error(`differing ${differing.length}: ${differing.slice(0, 10).join(', ')}`)
  process.exit(1)
}

if (has('--emit-stamp-sql')) process.stdout.write(stampSql(base.chainFiles({ through })))
else if (arg('--verify-schema-json')) verifySchemaJson(arg('--verify-schema-json'))
else if (has('--remote')) {
  const database = arg('--database')
  if (!database) die('--remote needs --database <name>')
  remotePlan(database, arg('--config'))
} else if (arg('--local')) localMode(path.resolve(arg('--local')))
else die('usage: provision-database.mjs --local <file.sqlite> | --remote --database <name> [--config <toml>] | --emit-stamp-sql | --verify-schema-json <file>')
