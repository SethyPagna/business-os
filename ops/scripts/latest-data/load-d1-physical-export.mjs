#!/usr/bin/env node
// Rebuilds a local SQLite database from the encrypted artifact of the Ops task `d1-physical-export`
// (.github/workflows/ops.yml) and proves it identical to what was exported.
//
//   gh run download <run-id> -n ops-d1-physical-export -D <input-folder>
//   node ops/scripts/latest-data/load-d1-physical-export.mjs --input <input-folder> --private-key <private-key-file> --out <database.sqlite>
//        [--schema export|migrations] [--migrations <folder>] [--force] [--allow-incomplete] [--strict-fk]
//
// The private key never enters the repository; a passphrase-protected key reads its passphrase from
// OPS_KEY_PASSPHRASE. The database holds the PRODUCTION DATA, personal data included, so it is refused inside
// this repository: write it to Records/Backups or a scratch folder.
//
// --schema export (default): the tables, indexes and views are created from the production DDL stored in the
//   manifest, the rows are loaded, then triggers and FTS tables are created and the FTS indexes rebuilt. The result
//   is production's schema as of the export. `wrangler d1 migrations apply --local` against it then applies only the
//   migrations production has not seen (d1_migrations is loaded), which is exactly what the cutover will do.
// --schema migrations --migrations <cloudflare/migrations>: an empty database is built by running every migration
//   file, then the rows are loaded into those tables (a table or column the export has and the schema lacks is a
//   problem). The migration names production applied are compared with the folder's files.
//
// Checks, every one against the manifest: each chunk file decrypts (AES-GCM authenticates it), belongs to this run
// and sequence, and matches its sha256 and row count; each table's chunks chain to the table's sha256; after the
// load each table's COUNT(*) equals the manifest's row count and re-reading the table in rowid order with the same
// quote() projection reproduces the table's sha256 byte for byte. PRAGMA foreign_key_check is reported (--strict-fk
// makes a violation fatal). Exit 0 only when every check passed.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { decryptEnvelope, loadPrivateKey } from '../ops-crypto.mjs'
import {
  CHUNK_KIND, EMPTY_SHA256, FORMAT, LIMITS, MANIFEST_KIND, decodeLines, encodeLine, pageSql, parseQuoted, quoteIdent, sha256Hex,
} from '../ops-d1-physical-lib.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const MANIFEST_FILE = /^d1phys-([a-z0-9]+)-manifest\.enc\.json$/
const CHUNK_FILE = /^d1phys-[a-z0-9]+-f\d{4,}\.enc\.json$/

class LoadError extends Error {}

function insideRepo(file) {
  const rel = path.relative(REPO_ROOT, path.resolve(file))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function readEnvelope(file) {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new LoadError(`${path.basename(file)} is not an ops envelope`)
  }
  return parsed
}

export function readManifest(inputDir, privateKey) {
  const found = fs.readdirSync(inputDir).filter((name) => MANIFEST_FILE.test(name))
  if (found.length !== 1) throw new LoadError(`expected exactly one d1phys-<run>-manifest.enc.json in the input folder, found ${found.length}`)
  const { plaintext, header } = decryptEnvelope(readEnvelope(path.join(inputDir, found[0])), privateKey)
  const manifest = JSON.parse(plaintext.toString('utf8'))
  if (manifest.format !== FORMAT || manifest.kind !== MANIFEST_KIND) throw new LoadError('the manifest has the wrong format')
  if (!header.meta || header.meta.kind !== MANIFEST_KIND || String(header.meta.run) !== String(manifest.runId)) throw new LoadError('the manifest header does not match its content')
  if (found[0] !== `d1phys-${manifest.runId}-manifest.enc.json`) throw new LoadError('the manifest file name does not match its run')
  return manifest
}

// One chunk: decrypted, authenticated, tied to this run and sequence, checked against the manifest's entry.
export function readChunk(inputDir, privateKey, manifest, table, chunk) {
  if (!CHUNK_FILE.test(chunk.file) || chunk.file !== path.basename(chunk.file)) throw new LoadError('the manifest names an unsafe chunk file')
  const file = path.join(inputDir, chunk.file)
  if (!fs.existsSync(file)) throw new LoadError(`chunk ${chunk.seq} (${table.name}) is missing from the input folder`)
  const { plaintext, header } = decryptEnvelope(readEnvelope(file), privateKey)
  const meta = header.meta || {}
  if (meta.kind !== CHUNK_KIND || String(meta.run) !== String(manifest.runId) || Number(meta.seq) !== chunk.seq) {
    throw new LoadError(`chunk ${chunk.seq} (${table.name}) belongs to another run or position`)
  }
  const text = plaintext.toString('utf8')
  if (sha256Hex(text) !== chunk.sha256) throw new LoadError(`chunk ${chunk.seq} (${table.name}) does not match its manifest sha256`)
  const rows = decodeLines(text, table.columns.length)
  if (rows.length !== chunk.rows) throw new LoadError(`chunk ${chunk.seq} (${table.name}) has ${rows.length} rows, the manifest says ${chunk.rows}`)
  return { text, rows }
}

// Every chunk of every table, checked, before anything is built: a truncated or mixed artifact fails here.
export function verifyArtifact(inputDir, privateKey, manifest) {
  const problems = []
  for (const table of manifest.tables) {
    const hash = crypto.createHash('sha256')
    let rows = 0
    for (const chunk of table.chunks) {
      try {
        const { text, rows: decoded } = readChunk(inputDir, privateKey, manifest, table, chunk)
        hash.update(text)
        rows += decoded.length
      } catch (err) {
        problems.push(`${table.name}: ${err.message}`)
        break
      }
    }
    if (problems.some((p) => p.startsWith(`${table.name}:`))) continue
    if (rows !== table.rows) problems.push(`${table.name}: chunks hold ${rows} rows, the manifest says ${table.rows}`)
    if (hash.digest('hex') !== (table.chunks.length ? table.sha256 : EMPTY_SHA256)) problems.push(`${table.name}: the chunks do not chain to the table sha256`)
  }
  return problems
}

function tableInfo(db, name) {
  return db.prepare('SELECT name, type, pk FROM pragma_table_info(?)').all(name)
}

// True when the table's rowid is its INTEGER PRIMARY KEY column (inserting both would name one column twice).
function rowidIsAlias(db, name) {
  const pk = tableInfo(db, name).filter((c) => c.pk > 0)
  return pk.length === 1 && /^integer$/i.test(String(pk[0].type).trim())
}

function insertTable(db, inputDir, privateKey, manifest, table, problems, clearFirst) {
  if (!table.columns.length) return
  const existing = new Set(tableInfo(db, table.name).map((c) => c.name))
  if (!existing.size) { problems.push(`${table.name}: the target database has no such table`); return }
  const missing = table.columns.filter((c) => !existing.has(c))
  if (missing.length) { problems.push(`${table.name}: the target lacks column(s) ${missing.join(', ')}`); return }
  const alias = rowidIsAlias(db, table.name)
  const names = [...(alias ? [] : [table.ridColumn]), ...table.columns].map(quoteIdent)
  const insert = db.prepare(`INSERT INTO ${quoteIdent(table.name)} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
  db.exec('BEGIN')
  try {
    // Seed rows the migrations inserted are production rows too (or were changed since): production's copy wins.
    if (clearFirst) db.exec(`DELETE FROM ${quoteIdent(table.name)}`)
    for (const chunk of table.chunks) {
      const { rows } = readChunk(inputDir, privateKey, manifest, table, chunk)
      for (const row of rows) {
        const values = row.values.map(parseQuoted)
        insert.run(...(alias ? values : [BigInt(row.rid), ...values]))
      }
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

// The same projection and order the exporter used, over the rebuilt table: count and sha256.
export function tableDigest(db, table) {
  if (!table.columns.length) return { rows: db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table.name)}`).get().n, sha256: EMPTY_SHA256 }
  const hash = crypto.createHash('sha256')
  let rows = 0
  let afterRid = null
  for (;;) {
    const page = db.prepare(pageSql({ table: table.name, columns: table.columns, rid: table.ridColumn, afterRid, limit: LIMITS.pageRowsMax })).all()
    for (const row of page) hash.update(`${encodeLine(row, table.columns.length)}\n`)
    rows += page.length
    if (page.length < LIMITS.pageRowsMax) break
    afterRid = page[page.length - 1].r
  }
  return { rows, sha256: rows ? hash.digest('hex') : EMPTY_SHA256 }
}

function localObjects(db, type) {
  return db.prepare('SELECT name, sql FROM sqlite_master WHERE type = ? AND sql IS NOT NULL ORDER BY rowid').all(type)
}

function isVirtual(entry) {
  return /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(entry.sql)
}

export function buildDatabase({ manifest, inputDir, privateKey, outPath, schemaMode = 'export', migrationsDir = null, force = false, log = () => {} }) {
  const problems = []
  if (insideRepo(outPath)) throw new LoadError('refusing to write production data inside this repository; choose a folder outside it')
  if (fs.existsSync(outPath)) {
    if (!force) throw new LoadError(`${outPath} already exists; pass --force to replace it`)
    fs.rmSync(outPath)
  }
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true })
  const db = new DatabaseSync(outPath)
  db.exec('PRAGMA foreign_keys = OFF; PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF;')
  const schemaTables = manifest.schema.filter((e) => e.type === 'table' && !isVirtual(e))
  const deferred = { triggers: [], virtual: [], indexes: [], views: [] }

  if (schemaMode === 'migrations') {
    if (!migrationsDir) throw new LoadError('--schema migrations needs --migrations <folder>')
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    if (!files.length) throw new LoadError('the migrations folder has no .sql files')
    for (const f of files) db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
    log(`applied ${files.length} migration files`)
    const hasMigrationsTable = db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").get()
    const ddl = schemaTables.find((e) => e.name === 'd1_migrations')
    if (!hasMigrationsTable && ddl) db.exec(ddl.sql)
    for (const t of localObjects(db, 'trigger')) { deferred.triggers.push(t); db.exec(`DROP TRIGGER ${quoteIdent(t.name)}`) }
  } else {
    for (const e of schemaTables) db.exec(e.sql)
    for (const e of manifest.schema) {
      if (e.type === 'index') deferred.indexes.push(e)
      else if (e.type === 'view') deferred.views.push(e)
      else if (e.type === 'trigger') deferred.triggers.push(e)
      else if (e.type === 'table' && isVirtual(e)) deferred.virtual.push(e)
    }
  }

  for (const table of manifest.tables) {
    if (table.failed) { problems.push(`${table.name}: the export of this table is incomplete`); continue }
    insertTable(db, inputDir, privateKey, manifest, table, problems, schemaMode === 'migrations')
  }

  if (manifest.sequence) {
    const update = db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?')
    const insert = db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)')
    for (const [name, seq] of manifest.sequence) {
      if (update.run(BigInt(seq), name).changes === 0) insert.run(name, BigInt(seq))
    }
  }

  const warnings = []
  for (const e of deferred.indexes) {
    try { db.exec(e.sql) } catch (err) { problems.push(`index ${e.name}: ${err.message}`) }
  }
  for (const e of deferred.views) {
    try { db.exec(e.sql) } catch (err) { problems.push(`view ${e.name}: ${err.message}`) }
  }
  let fts = 0
  for (const e of deferred.virtual) {
    try { db.exec(e.sql) } catch (err) { warnings.push(`virtual table ${e.name} was not created (${err.message})`) }
  }
  for (const e of deferred.triggers) {
    try { db.exec(e.sql) } catch (err) { warnings.push(`trigger ${e.name} was not created (${err.message})`) }
  }
  for (const e of localObjects(db, 'table').filter(isVirtual)) {
    if (!/USING\s+fts5/i.test(e.sql)) continue
    if (!/\bcontent\s*=\s*'[^']+'/i.test(e.sql)) { warnings.push(`FTS table ${e.name} keeps its own content, which the export does not carry; it stays empty`); continue }
    try { db.exec(`INSERT INTO ${quoteIdent(e.name)}(${quoteIdent(e.name)}) VALUES('rebuild')`); fts += 1 } catch (err) { warnings.push(`FTS rebuild of ${e.name} failed (${err.message})`) }
  }
  log(`rebuilt ${fts} FTS indexes`)

  const checks = { tables: [], foreignKeyViolations: 0, integrity: null, migrations: null }
  for (const table of manifest.tables) {
    if (table.failed) continue
    let digest
    try {
      digest = tableDigest(db, table)
    } catch (err) {
      problems.push(`${table.name}: cannot be re-read (${err.message})`)
      continue
    }
    const ok = digest.rows === table.rows && digest.sha256 === table.sha256
    checks.tables.push({ name: table.name, rows: digest.rows, expected: table.rows, ok })
    if (!ok) problems.push(`${table.name}: rebuilt table has ${digest.rows} rows / ${digest.sha256.slice(0, 12)}, the manifest says ${table.rows} / ${table.sha256.slice(0, 12)}`)
  }
  checks.foreignKeyViolations = db.prepare('PRAGMA foreign_key_check').all().length
  checks.integrity = db.prepare('PRAGMA quick_check').all().map((r) => Object.values(r)[0]).join(',')
  if (checks.integrity !== 'ok') problems.push(`quick_check: ${checks.integrity}`)

  if (manifest.tables.some((t) => t.name === 'd1_migrations')) {
    const applied = db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map((r) => r.name)
    const folder = migrationsDir ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort() : null
    checks.migrations = {
      applied: applied.length,
      appliedButNotInFolder: folder ? applied.filter((n) => !folder.includes(n)) : null,
      inFolderNotApplied: folder ? folder.filter((n) => !applied.includes(n)) : null,
    }
  }
  db.close()
  return { problems, warnings, checks }
}

function parseArgs(argv) {
  const flags = new Set(['--force', '--allow-incomplete', '--strict-fk'])
  const valued = new Set(['--input', '--private-key', '--out', '--schema', '--migrations'])
  const out = { values: {}, flags: new Set() }
  for (let i = 0; i < argv.length; i += 1) {
    if (flags.has(argv[i])) out.flags.add(argv[i])
    else if (valued.has(argv[i]) && i + 1 < argv.length) { out.values[argv[i]] = argv[i + 1]; i += 1 } else throw new LoadError(`unknown or incomplete argument ${argv[i]}`)
  }
  return out
}

export function main(argv) {
  const { values, flags } = parseArgs(argv)
  const usage = 'Usage: node ops/scripts/latest-data/load-d1-physical-export.mjs --input <folder> --private-key <private-key-file> --out <database.sqlite> [--schema export|migrations] [--migrations <folder>] [--force] [--allow-incomplete] [--strict-fk]'
  if (!values['--input'] || !values['--private-key'] || !values['--out']) throw new LoadError(usage)
  const schemaMode = values['--schema'] || 'export'
  if (!['export', 'migrations'].includes(schemaMode)) throw new LoadError('--schema is export or migrations')
  const privateKey = loadPrivateKey(fs.readFileSync(values['--private-key'], 'utf8'), process.env.OPS_KEY_PASSPHRASE || undefined)
  const manifest = readManifest(values['--input'], privateKey)
  const say = (line) => process.stdout.write(`${line}\n`)
  say(`run ${manifest.runId} commit ${manifest.commit}: ${manifest.tables.length} tables, ${manifest.totals.rows} rows, ${manifest.totals.files} chunk files`)
  for (const skipped of manifest.skipped || []) say(`not exported: ${skipped.name} (${skipped.reason}); AUTOINCREMENT counters restart at each table's max id`)
  const issues = manifest.issues.map((i) => `${i.table || 'run'}: ${i.code}`)
  if (issues.length) say(`export issues: ${issues.join('; ')}`)
  if (issues.length && !flags.has('--allow-incomplete')) throw new LoadError('the export reported problems; fix them or pass --allow-incomplete')
  const artifact = verifyArtifact(values['--input'], privateKey, manifest)
  if (artifact.length && !flags.has('--allow-incomplete')) throw new LoadError(`the artifact does not match its manifest:\n  ${artifact.join('\n  ')}`)
  say(`artifact verified: every chunk decrypts, matches its sha256 and chains to its table sha256`)
  if (manifest.changedDuringExport.length) say(`note: ${manifest.changedDuringExport.length} table(s) gained rows while the export ran (trading was not quiet)`)
  const { problems, warnings, checks } = buildDatabase({
    manifest, inputDir: values['--input'], privateKey, outPath: values['--out'], schemaMode,
    migrationsDir: values['--migrations'] || null, force: flags.has('--force'), log: say,
  })
  for (const w of warnings) say(`warning: ${w}`)
  say(`tables re-read and compared: ${checks.tables.length}, matching: ${checks.tables.filter((t) => t.ok).length}`)
  say(`foreign_key_check violations: ${checks.foreignKeyViolations}`)
  if (checks.migrations) {
    say(`d1_migrations rows: ${checks.migrations.applied}`)
    if (checks.migrations.appliedButNotInFolder) say(`applied in production but not in the folder: ${checks.migrations.appliedButNotInFolder.length}; in the folder, not applied: ${checks.migrations.inFolderNotApplied.length}`)
  }
  if (flags.has('--strict-fk') && checks.foreignKeyViolations) problems.push(`foreign_key_check reported ${checks.foreignKeyViolations} violation(s)`)
  if (checks.migrations && checks.migrations.appliedButNotInFolder && checks.migrations.appliedButNotInFolder.length) problems.push('production applied migrations the folder does not have')
  for (const p of problems) say(`PROBLEM: ${p}`)
  say(problems.length ? `LOAD FAILED (${problems.length} problem(s))` : `LOAD OK -> ${values['--out']}`)
  return problems.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (err) {
    process.stderr.write(`load-d1-physical-export: ${err.message}\n`)
    process.exitCode = err instanceof LoadError ? 2 : 1
  }
}
