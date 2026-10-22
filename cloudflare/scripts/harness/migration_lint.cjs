'use strict'
// The client-neutral migration lint. One function, no I/O:
//
//   lintMigration({ name, sql, cls, exemptions, denylist }) -> [{ rule, line, detail }]
//
// A shared migration runs on every client's database. These rules refuse the
// shapes by which a migration carries ONE client's data or policy into the
// shared chain (see docs/setup/migrations-multi-client.md):
//
//   literal-id            an integer literal >= 1000 in a WHERE / ON / HAVING / WHEN,
//                         an IN (...) list, a BETWEEN, or a VALUES list of a data
//                         statement: a pinned row identity.
//   pinned-id             an id column (id, *_id) compared with = or IN to a literal
//                         id of any size: 0164 and 0183 pin ids below 1000.
//   literal-rows          an INSERT whose rows are literals (VALUES, or a FROM-less
//                         SELECT), or another write that carries two or more literal
//                         rows (also inside a CTE or a UNION ALL): embedded client data.
//                         Stricter than "multi-row": 0030 seeds ONE row, an organization.
//   unconditional-write   UPDATE / DELETE with no WHERE (or a tautology), REPLACE INTO,
//                         INSERT OR REPLACE, or ON CONFLICT DO UPDATE with no WHERE:
//                         a blanket overwrite of whatever the client already holds.
//   check-literal-id      a CHECK (...) that names a literal id (col = N, col IN (...)).
//   denylist              a literal from the client deny-list anywhere in the file,
//                         comments included (supplied at run time, never committed).
//   class-understated     the file is declared SCHEMA but contains INSERT / UPDATE /
//                         DELETE / REPLACE.
//
// The rules are tripwires, not proof: a policy rewrite with an honest-looking
// WHERE (0110, 0178) passes them. The manifest class and the review of every
// GENERIC-DATA reason are the other half. Tables that are infrastructure rather
// than client records are exempt where noted.

const { sha256, migrationNumber, splitStatements, dmlShape, createdTableName, predicateIntegerLiterals, pinnedIdComparisons } = require('./migration_sql.cjs')

const RULES = ['literal-id', 'pinned-id', 'literal-rows', 'unconditional-write', 'check-literal-id', 'denylist', 'class-understated']

// Never client records. FTS indexes, the migration ledger, rowid counters and
// the system_flags fence are written by migrations on every client alike.
function isInfrastructureTable(table) {
  if (!table) return false
  return table === 'system_flags' || table === 'd1_migrations' || table === 'sqlite_sequence' || /_fts(?:_[a-z_]+)?$/.test(table)
}

// Key/value stores: seeding defaults is legitimate (several keys, one statement),
// overwriting is not (unconditional-write still applies).
function isKeyValueTable(table) { return table === 'settings' || table === 'system_flags' }

function isWord(tok, ...names) { return tok && tok.t === 'word' && names.includes(tok.u) }
function isPunct(tok, ch) { return tok && tok.t === 'p' && tok.v === ch }

function matchClose(tokens, open) {
  let depth = 0
  for (let k = open; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], '(')) depth += 1
    else if (isPunct(tokens[k], ')')) { depth -= 1; if (depth === 0) return k }
  }
  return tokens.length - 1
}

/**
 * Literal rows a statement carries: VALUES tuples at any depth, plus FROM-less
 * SELECT members of a compound (UNION) at any depth, plus -- for an INSERT --
 * its own FROM-less SELECT row source.
 */
function literalRowCount(tokens, { insert = false } = {}) {
  let tuples = 0
  let members = 0
  let depthNow = 0
  for (let k = 0; k < tokens.length; k += 1) {
    const here = tokens[k]
    if (isPunct(here, '(')) depthNow += 1
    else if (isPunct(here, ')')) depthNow -= 1
    if (isWord(here, 'VALUES')) {
      let p = k + 1
      while (isPunct(tokens[p], '(')) {
        tuples += 1
        p = matchClose(tokens, p) + 1
        if (isPunct(tokens[p], ',')) p += 1
        else break
      }
    }
    if (!isWord(here, 'SELECT')) continue
    let depth = 0
    let hasFrom = false
    let inCompound = isWord(tokens[k - 1], 'ALL', 'UNION')
    for (let m = k + 1; m < tokens.length; m += 1) {
      const t = tokens[m]
      if (isPunct(t, '(')) depth += 1
      else if (isPunct(t, ')')) { if (depth === 0) break; depth -= 1 }
      else if (depth === 0 && isWord(t, 'FROM')) hasFrom = true
      else if (depth === 0 && isWord(t, 'UNION', 'EXCEPT', 'INTERSECT')) { inCompound = true; break }
    }
    if (!hasFrom && (inCompound || (insert && depthNow === 0))) members += 1
  }
  return tuples + members
}

/** CHECK (...) integer literals >= min that are an equality or IN-list operand, not a bound. */
function checkLiteralIds(tokens, min = 1000n) {
  const found = []
  for (let k = 0; k < tokens.length; k += 1) {
    if (!isWord(tokens[k], 'CHECK') || !isPunct(tokens[k + 1], '(')) continue
    const close = matchClose(tokens, k + 1)
    const inList = []
    for (let m = k + 2; m < close; m += 1) {
      if (isWord(tokens[m], 'IN') && isPunct(tokens[m + 1], '(')) {
        const end = matchClose(tokens, m + 1)
        inList.push([m + 1, end])
      }
    }
    for (let m = k + 2; m < close; m += 1) {
      const t = tokens[m]
      if (t.t !== 'num' || !/^[0-9]+$/.test(t.v) || BigInt(t.v) < min) continue
      const insideIn = inList.some(([a, b]) => m > a && m < b)
      const prev = tokens[m - 1]
      const before = tokens[m - 2]
      const equality = isPunct(prev, '=') && !(isPunct(before, '<') || isPunct(before, '>'))
      if (insideIn || equality) found.push({ value: t.v, line: t.line })
    }
  }
  return found
}

const WRITE_KINDS = new Set(['insert', 'update', 'delete'])
const LITERAL_KINDS = new Set(['insert', 'update', 'delete', 'select', 'with'])

function lintMigration({ name, sql, cls = null, exemptions = [], denylist = [] }) {
  const violations = []
  const add = (rule, line, detail) => violations.push({ rule, line, detail })
  const statements = splitStatements(sql)
  const localTables = new Set()
  let hasWrite = false

  for (const st of statements) {
    if (st.kind === 'create_table' || st.kind === 'create_vtable') {
      const created = createdTableName(st)
      if (created) localTables.add(created)
    }
    if (st.kind === 'create_table' || st.kind === 'alter') {
      for (const hit of checkLiteralIds(st.tokens)) add('check-literal-id', hit.line, `CHECK names the literal id ${hit.value}`)
    }
    // A trigger, view or partial index that names one row is pinned data too. Bounds like
    // `> 100000000000` in triggers are legitimate, so only the id comparison is checked here.
    if (st.kind === 'create_trigger' || st.kind === 'create_view' || st.kind === 'create_index') {
      for (const hit of pinnedIdComparisons(st.tokens)) add('pinned-id', hit.line, `${hit.column} is pinned to the literal id ${hit.value} in ${st.kind.replace('create_', '')} DDL`)
    }
    const shape = dmlShape(st)
    if (shape) hasWrite = true
    if (shape && !WRITE_KINDS.has(shape.verb)) continue
    const table = shape ? shape.table : null
    const infra = isInfrastructureTable(table)

    if (LITERAL_KINDS.has(st.kind) && !infra) {
      for (const hit of pinnedIdComparisons(st.tokens)) add('pinned-id', hit.line, `${hit.column} is pinned to the literal id ${hit.value}`)
      for (const hit of predicateIntegerLiterals(st.tokens)) add('literal-id', hit.line, `integer literal ${hit.value} in a predicate or value list${table ? ` of ${shape.verb} ${table}` : ''}`)
    }
    if (shape && !infra && !isKeyValueTable(table)) {
      // A table this file created may take one FROM-less guard row (the repo's
      // assertion-table pattern); two or more literal rows are embedded data anywhere.
      const single = shape.verb === 'insert' && !localTables.has(table)
      const rows = literalRowCount(st.tokens, { insert: single })
      if (rows >= (single ? 1 : 2)) add('literal-rows', st.line, `${shape.verb} ${table} carries ${rows} literal row(s)`)
    }
    // A table this very file created holds nothing a client wrote; FTS indexes and
    // rowid counters are rebuilt by every client alike. system_flags is checked.
    const ownsNoClientRows = localTables.has(table) || (infra && table !== 'system_flags')
    if (shape && !ownsNoClientRows) {
      if (shape.verb === 'insert') {
        if (shape.orFlavor === 'REPLACE') add('unconditional-write', st.line, `REPLACE into ${table} overwrites existing rows`)
        for (const up of shape.upserts) if (up.action === 'update' && !up.hasWhere) add('unconditional-write', st.line, `ON CONFLICT DO UPDATE on ${table} with no WHERE overwrites existing rows`)
      } else if (!shape.hasWhere || shape.whereTautology) {
        add('unconditional-write', st.line, `${shape.verb} ${table} has no rule predicate`)
      }
    }
  }

  if (cls === 'SCHEMA' && hasWrite) add('class-understated', 1, 'declared SCHEMA but the file contains INSERT / UPDATE / DELETE; classify it GENERIC-DATA')

  const lower = sql.toLowerCase()
  for (const term of denylist) {
    const needle = String(term).trim().toLowerCase()
    if (needle.length < 3) continue
    const at = lower.indexOf(needle)
    if (at >= 0) add('denylist', lower.slice(0, at).split('\n').length, 'a literal from the client deny-list appears in the file')
  }

  const exempt = new Set(exemptions.map((e) => e.rule))
  return violations.filter((v) => !exempt.has(v.rule)).map((v) => ({ ...v, file: name }))
}

/**
 * The client deny-list: terms that must never appear in a shared migration.
 * Read from BOS_CLIENT_DENYLIST (comma or newline separated) or from the
 * gitignored file named by BOS_CLIENT_DENYLIST_FILE, default
 * cloudflare/scripts/.client-denylist.local. Never committed; empty in CI.
 */
function loadDenylist(env = process.env, fs = require('node:fs'), path = require('node:path')) {
  const terms = []
  if (env.BOS_CLIENT_DENYLIST) terms.push(...env.BOS_CLIENT_DENYLIST.split(/[,\n]/))
  const file = env.BOS_CLIENT_DENYLIST_FILE || path.join(__dirname, '..', '.client-denylist.local')
  try { terms.push(...fs.readFileSync(file, 'utf8').split(/\r?\n/)) } catch { /* no file: empty list */ }
  return terms.map((t) => t.trim()).filter((t) => t && !t.startsWith('#'))
}


const CLASSES = ['SCHEMA', 'GENERIC-DATA', 'CLIENT-SPECIFIC-DATA']

/**
 * The manifest against the files it describes. `files` is a Map of file name to
 * Buffer. Returns a list of problems (empty = fine). Nothing here reads the disk.
 *   - every file is listed, every entry has its file, entries are in file-name order
 *   - the sha256 of every file equals its entry: a migration is never edited
 *   - class and reason are present; class SCHEMA means no INSERT/UPDATE/DELETE and
 *     any other class means there is one
 *   - from lintFrom on: SCHEMA or GENERIC-DATA only, and the lint rules hold
 */
function verifyManifest(manifest, files, { denylist = [] } = {}) {
  const problems = []
  const entries = manifest.migrations || []
  const byName = new Map()
  for (const e of entries) {
    if (byName.has(e.name)) problems.push(`${e.name}: listed twice`)
    byName.set(e.name, e)
  }
  const names = [...files.keys()].sort()
  for (const name of names) if (!byName.has(name)) problems.push(`${name}: not in migrations-manifest.json. Add: ${JSON.stringify({ name, sha256: sha256(files.get(name)), class: 'SCHEMA|GENERIC-DATA', reason: 'one line: what it does and why it is safe on any client' })}`)
  for (const e of entries) if (!files.has(e.name)) problems.push(`${e.name}: in the manifest but the file is gone. Migrations are append-only; never delete one`)
  const listed = entries.map((e) => e.name)
  if (JSON.stringify(listed) !== JSON.stringify([...listed].sort())) problems.push('manifest entries are not in file-name order')
  for (const e of entries) {
    const bytes = files.get(e.name)
    if (!bytes) continue
    if (sha256(bytes) !== e.sha256) problems.push(`${e.name}: bytes differ from the manifest sha256. A migration is append-only: add a new migration instead of editing this one`)
    if (!CLASSES.includes(e.class)) problems.push(`${e.name}: class must be one of ${CLASSES.join(', ')}`)
    if (typeof e.reason !== 'string' || !e.reason.trim() || /[\r\n]/.test(e.reason) || e.reason.length > 400) problems.push(`${e.name}: reason must be one non-empty line of at most 400 characters`)
    const sql = bytes.toString('utf8')
    const writes = splitStatements(sql).some((st) => dmlShape(st))
    if (e.class === 'SCHEMA' && writes) problems.push(`${e.name}: class SCHEMA but the file writes rows`)
    if ((e.class === 'GENERIC-DATA' || e.class === 'CLIENT-SPECIFIC-DATA') && !writes) problems.push(`${e.name}: class ${e.class} but the file writes no rows; classify it SCHEMA`)
    const number = migrationNumber(e.name)
    const exemptions = e.exemptions || []
    if (number < manifest.lintFrom) {
      if (exemptions.length) problems.push(`${e.name}: exemptions are only for files numbered ${manifest.lintFrom} or later`)
      continue
    }
    if (e.class === 'CLIENT-SPECIFIC-DATA') problems.push(`${e.name}: shared migrations numbered ${manifest.lintFrom}+ must be SCHEMA or GENERIC-DATA; client data runs per account, outside this repo`)
    for (const x of exemptions) {
      if (!RULES.includes(x.rule) || x.rule === 'denylist' || x.rule === 'class-understated') problems.push(`${e.name}: exemption for unknown or non-exemptable rule "${x.rule}"`)
      if (typeof x.reason !== 'string' || x.reason.trim().length < 20) problems.push(`${e.name}: exemption for ${x.rule} needs a reason of at least 20 characters`)
    }
    for (const v of lintMigration({ name: e.name, sql, cls: e.class, exemptions: exemptions.filter((x) => x.rule !== 'denylist' && x.rule !== 'class-understated'), denylist })) {
      problems.push(`${e.name}:${v.line} [${v.rule}] ${v.detail}`)
    }
  }
  return problems
}

module.exports = { RULES, CLASSES, verifyManifest, lintMigration, loadDenylist, isInfrastructureTable, literalRowCount, checkLiteralIds }
