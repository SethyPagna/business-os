// Bootstrap a FRESH local D1 state from the checked-in migrations.
//
// WHY THIS EXISTS
//
// `wrangler d1 migrations apply business-os --local` cannot get past
// migrations/0098_user_aliases.sql on an EMPTY local state. It dies with:
//
//     X [ERROR] too many terms in compound SELECT: SQLITE_ERROR
//
// leaving the database stuck at 0097 with no way forward. That is NOT a
// defect in the migration: it is a limit workerd (the runtime behind
// `wrangler dev --local` and local D1) imposes on the SQLite connection it
// opens. workerd calls
//
//     sqlite3_limit(db, SQLITE_LIMIT_COMPOUND_SELECT, 5);
//
// in src/workerd/util/sqlite.c++ (the value was 3 until cloudflare/workerd
// PR #796 raised it to 5 in June 2023, after issue #795 reported the
// original 3 as too restrictive). Stock SQLite defaults this limit to 500
// (https://www.sqlite.org/limits.html#max_compound_select); workerd lowers
// it deliberately, following SQLite's own "defense against dark arts"
// hardening recommendations. Verified empirically against this repo's
// pinned wrangler (4.116.0 / @cloudflare/workerd-windows-64 1.20260828.1):
// a `SELECT 1 UNION ALL ... ` with FIVE terms succeeds and with SIX terms
// fails with exactly the error above.
//
// 0098's seed block is one compound SELECT with SEVEN terms (six
// `UNION ALL`s), so it is two terms over the local ceiling. Production D1
// already has 0098 applied (it is a row in `d1_migrations` there), so the
// migration's recorded content MUST NOT change -- rewriting an applied
// migration would either be a no-op that lies about history or, worse,
// re-run differently somewhere that has not applied it yet.
//
// WHAT THIS SCRIPT DOES INSTEAD
//
// It drives `wrangler d1 migrations apply` in a loop and, whenever that
// stops with the compound-SELECT error, applies that ONE migration itself
// with the oversized compound SELECT split into several statements that
// insert exactly the same rows, then records it in `d1_migrations` and
// resumes the loop. Nothing under migrations/ is ever written to.
//
// The split is only ever applied AT APPLY TIME, only to the local state,
// and only for the one statement shape where splitting is provably
// row-for-row equivalent (see splitOversizedCompoundSelect's guards). Any
// other shape is refused loudly rather than rewritten on a guess.
//
// USAGE
//
//   node scripts/bootstrap-local-d1.cjs --persist-to <dir> [--database business-os]
//                                       [--migrations-dir migrations]
//                                       [--config wrangler.toml] [--dry-run]
//
// With no --database, BOTH configured databases are bootstrapped in order:
// business-os (migrations/) then business-os-import (migrations-import/).
//
// The pure splitter is exported for scripts/test-plan-local-bootstrap-pure.cjs,
// which proves the split is row-for-row equivalent against real SQLite.
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// workerd's ceiling, cited above. Not configurable from wrangler/miniflare:
// there is no flag, env var or wrangler.toml key that lifts it -- the value
// is compiled into the runtime's own sqlite3_limit() call.
const MAX_COMPOUND_SELECT_TERMS = 5

const COMPOUND_SELECT_ERROR = 'too many terms in compound SELECT'

const DEFAULT_DATABASES = [
  { database: 'business-os', migrationsDir: 'migrations' },
  { database: 'business-os-import', migrationsDir: 'migrations-import' },
]

// ---------------------------------------------------------------------------
// SQL scanning (pure -- exported and unit-tested)
// ---------------------------------------------------------------------------

/**
 * Splits a .sql file into top-level statements on `;`, ignoring semicolons
 * inside string literals, quoted identifiers and comments. Returns the raw
 * text of each statement WITHOUT its terminating semicolon, plus whatever
 * trailing whitespace/comments followed it, so the file can be rebuilt
 * verbatim when nothing needs changing.
 */
function splitStatements(sql) {
  const out = []
  let start = 0
  let i = 0
  while (i < sql.length) {
    const ch = sql[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i += 1
      while (i < sql.length) {
        if (sql[i] === quote) {
          // '' inside a '...' literal is an escaped quote, not the end.
          if (sql[i + 1] === quote) { i += 2; continue }
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '[') { // SQLite also accepts [identifier]
      while (i < sql.length && sql[i] !== ']') i += 1
      i += 1
      continue
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && sql[i + 1] === '*') {
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === ';') {
      out.push(sql.slice(start, i))
      start = i + 1
      i += 1
      continue
    }
    i += 1
  }
  const tail = sql.slice(start)
  if (tail.trim()) out.push(tail)
  return out
}

/**
 * Every `UNION ALL` token in `stmt` that is real SQL (not inside a string,
 * identifier or comment), with the parenthesis depth it sits at.
 */
function findUnionAllTokens(stmt) {
  const tokens = []
  let depth = 0
  let i = 0
  while (i < stmt.length) {
    const ch = stmt[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i += 1
      while (i < stmt.length) {
        if (stmt[i] === quote) {
          if (stmt[i + 1] === quote) { i += 2; continue }
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '[') { while (i < stmt.length && stmt[i] !== ']') i += 1; i += 1; continue }
    if (ch === '-' && stmt[i + 1] === '-') { while (i < stmt.length && stmt[i] !== '\n') i += 1; continue }
    if (ch === '/' && stmt[i + 1] === '*') {
      i += 2
      while (i < stmt.length && !(stmt[i] === '*' && stmt[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    if (ch === '(') { depth += 1; i += 1; continue }
    if (ch === ')') { depth -= 1; i += 1; continue }
    const rest = stmt.slice(i)
    const match = /^union[ \t\r\n]+all\b/i.exec(rest)
    if (match && (i === 0 || !/[A-Za-z0-9_$]/.test(stmt[i - 1]))) {
      tokens.push({ start: i, end: i + match[0].length, depth })
      i += match[0].length
      continue
    }
    // Any other compound operator is a set operation whose terms CANNOT be
    // split into separate INSERTs without changing the result. Record it so
    // the caller can refuse rather than mangle.
    const other = /^(union|intersect|except)\b/i.exec(rest)
    if (other && (i === 0 || !/[A-Za-z0-9_$]/.test(stmt[i - 1]))) {
      tokens.push({ start: i, end: i + other[0].length, depth, unsplittable: true })
      i += other[0].length
      continue
    }
    i += 1
  }
  return tokens
}

/**
 * The statement's first real SQL keyword, skipping leading whitespace and
 * `--` / block comments. A migration statement is routinely preceded by a
 * paragraph of comment (0098's seed INSERT is), so testing `/^\s*insert/`
 * against the raw text would misclassify it.
 */
function leadingKeyword(stmt) {
  let i = 0
  while (i < stmt.length) {
    const ch = stmt[i]
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { i += 1; continue }
    if (ch === '-' && stmt[i + 1] === '-') { while (i < stmt.length && stmt[i] !== '\n') i += 1; continue }
    if (ch === '/' && stmt[i + 1] === '*') {
      i += 2
      while (i < stmt.length && !(stmt[i] === '*' && stmt[i + 1] === '/')) i += 1
      i += 2
      continue
    }
    break
  }
  const match = /^[A-Za-z_]+/.exec(stmt.slice(i))
  return match ? match[0].toLowerCase() : ''
}

/** Index of the '(' that opens the group containing `index` at `depth`. */
function findEnclosingParens(stmt, index, depth) {
  let open = -1
  let current = 0
  for (let i = 0; i < stmt.length; i += 1) {
    const ch = stmt[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i += 1
      while (i < stmt.length) {
        if (stmt[i] === quote) { if (stmt[i + 1] === quote) { i += 1; continue } break }
        i += 1
      }
      continue
    }
    if (ch === '(') {
      current += 1
      if (current === depth && i < index) open = i
      continue
    }
    if (ch === ')') {
      if (current === depth && i > index && open >= 0) return { open, close: i }
      current -= 1
      continue
    }
  }
  return null
}

/**
 * Rewrites ONE statement whose parenthesised inline row-list uses more than
 * `maxTerms` `UNION ALL` terms into several statements that write exactly the
 * same rows.
 *
 * Only the shape this codebase actually has is accepted:
 *
 *     INSERT [OR IGNORE|OR REPLACE] INTO t (...)
 *     SELECT ... FROM ( SELECT ... UNION ALL SELECT ... ) AS alias
 *     JOIN/WHERE ...
 *
 * i.e. an INSERT whose source SELECT reads a parenthesised UNION ALL list.
 * Splitting the list into chunks and repeating the whole INSERT once per
 * chunk is row-for-row equivalent because UNION ALL is plain concatenation
 * (no de-duplication) and the outer SELECT is evaluated per source row.
 *
 * Refused (throws) for every other shape: a bare compound SELECT, a compound
 * carrying ORDER BY / LIMIT / GROUP BY / HAVING / DISTINCT / a window or
 * aggregate that spans terms, a CTE, or any UNION / INTERSECT / EXCEPT
 * (set operations, where concatenation is NOT equivalent).
 */
function splitOversizedCompoundSelect(stmt, maxTerms = MAX_COMPOUND_SELECT_TERMS) {
  const tokens = findUnionAllTokens(stmt)
  if (!tokens.length) return null
  if (tokens.some((token) => token.unsplittable)) {
    throw new Error('compound SELECT uses UNION/INTERSECT/EXCEPT -- splitting would change the result set; refusing')
  }
  // Terms = UNION ALL count + 1, so a chain of `maxTerms - 1` operators is
  // already at the ceiling and needs no split.
  if (tokens.length + 1 <= maxTerms) return null

  const depths = new Set(tokens.map((token) => token.depth))
  if (depths.size !== 1) {
    throw new Error('nested compound SELECTs at different depths -- refusing to split')
  }
  const depth = tokens[0].depth
  if (depth < 1) {
    throw new Error('compound SELECT is not inside a parenthesised sub-select -- refusing to split')
  }
  if (leadingKeyword(stmt) !== 'insert') {
    throw new Error('statement is not an INSERT -- refusing to split')
  }

  const span = findEnclosingParens(stmt, tokens[0].start, depth)
  if (!span) throw new Error('could not locate the parenthesised sub-select -- refusing to split')
  if (tokens.some((token) => token.start < span.open || token.end > span.close)) {
    throw new Error('UNION ALL terms straddle the sub-select boundary -- refusing to split')
  }

  const outside = stmt.slice(0, span.open) + ' ' + stmt.slice(span.close + 1)
  const forbidden = /\b(order[ \t\r\n]+by|limit|group[ \t\r\n]+by|having|distinct|with|over[ \t\r\n]*\()\b/i
  if (forbidden.test(outside)) {
    throw new Error('the surrounding statement has ORDER BY/LIMIT/GROUP BY/HAVING/DISTINCT/CTE/window -- refusing to split')
  }

  const inner = stmt.slice(span.open + 1, span.close)
  const offset = span.open + 1
  const terms = []
  let cursor = 0
  for (const token of tokens) {
    terms.push(inner.slice(cursor, token.start - offset))
    cursor = token.end - offset
  }
  terms.push(inner.slice(cursor))

  const statements = []
  for (let i = 0; i < terms.length; i += maxTerms) {
    const chunk = terms.slice(i, i + maxTerms).map((term) => term.trim()).join('\n  UNION ALL ')
    statements.push(stmt.slice(0, span.open + 1) + '\n  ' + chunk + '\n' + stmt.slice(span.close))
  }
  return statements
}

/**
 * Whole-file transform. Returns the rewritten SQL plus a note per statement
 * that was split. `changed === false` means the file is already inside the
 * local ceiling and can be applied verbatim.
 */
function transformSqlForLocalSqlite(sql, maxTerms = MAX_COMPOUND_SELECT_TERMS) {
  const statements = splitStatements(sql)
  const notes = []
  let changed = false
  const rewritten = statements.map((stmt, index) => {
    let split = null
    try {
      split = splitOversizedCompoundSelect(stmt, maxTerms)
    } catch (error) {
      throw new Error(`statement #${index + 1}: ${error.message}`)
    }
    if (!split) return stmt
    changed = true
    notes.push(`statement #${index + 1}: compound SELECT split into ${split.length} statements (<= ${maxTerms} terms each)`)
    return split.join(';\n')
  })
  return { sql: rewritten.join(';\n') + ';\n', changed, notes }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { persistTo: '', database: '', migrationsDir: '', config: '', dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--persist-to') { args.persistTo = argv[++i]; continue }
    if (arg === '--database') { args.database = argv[++i]; continue }
    if (arg === '--migrations-dir') { args.migrationsDir = argv[++i]; continue }
    if (arg === '--config') { args.config = argv[++i]; continue }
    if (arg === '--dry-run') { args.dryRun = true; continue }
    throw new Error(`unknown argument: ${arg}`)
  }
  if (!args.persistTo) throw new Error('--persist-to <dir> is required (never bootstrap the shared .wrangler/state)')
  return args
}

function runWrangler(cloudflareRoot, wranglerArgs) {
  const result = spawnSync(
    process.execPath,
    [path.join(cloudflareRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), ...wranglerArgs],
    { cwd: cloudflareRoot, encoding: 'utf8', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } },
  )
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  return { status: result.status === null ? 1 : result.status, stdout, stderr, output: `${stdout}\n${stderr}` }
}

function appliedMigrationNames(cloudflareRoot, args, database) {
  const run = runWrangler(cloudflareRoot, [
    'd1', 'execute', database, '--local', '--persist-to', args.persistTo, '--json',
    ...(args.config ? ['--config', args.config] : []),
    '--command', 'SELECT name FROM d1_migrations ORDER BY id',
  ])
  if (run.status !== 0) return []
  const start = run.stdout.indexOf('[')
  if (start < 0) return []
  try {
    const parsed = JSON.parse(run.stdout.slice(start))
    const results = (parsed[0] && parsed[0].results) || []
    return results.map((row) => String(row.name))
  } catch {
    return []
  }
}

function bootstrapDatabase(cloudflareRoot, args, database, migrationsDir) {
  const dir = path.join(cloudflareRoot, migrationsDir)
  if (!fs.existsSync(dir)) throw new Error(`migrations dir not found: ${dir}`)
  const all = fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()
  const configArgs = args.config ? ['--config', args.config] : []

  // At most one manual step per migration file, plus one final clean pass.
  for (let attempt = 0; attempt <= all.length; attempt += 1) {
    const apply = runWrangler(cloudflareRoot, [
      'd1', 'migrations', 'apply', database, '--local', '--persist-to', args.persistTo, ...configArgs,
    ])
    if (apply.status === 0) {
      console.log(`[bootstrap] ${database}: all migrations applied`)
      return
    }
    if (!apply.output.includes(COMPOUND_SELECT_ERROR)) {
      console.error(apply.output)
      throw new Error(`${database}: wrangler d1 migrations apply failed for a reason this script does not handle`)
    }
    const applied = new Set(appliedMigrationNames(cloudflareRoot, args, database))
    const pending = all.find((name) => !applied.has(name))
    if (!pending) throw new Error(`${database}: compound-SELECT error reported but no migration is pending`)

    const source = fs.readFileSync(path.join(dir, pending), 'utf8')
    const transformed = transformSqlForLocalSqlite(source)
    if (!transformed.changed) {
      throw new Error(`${database}: ${pending} hit the compound-SELECT ceiling but has no splittable compound SELECT`)
    }
    console.log(`[bootstrap] ${database}: ${pending} exceeds workerd's SQLITE_LIMIT_COMPOUND_SELECT=${MAX_COMPOUND_SELECT_TERMS}`)
    for (const note of transformed.notes) console.log(`[bootstrap]   ${note}`)
    if (args.dryRun) {
      console.log(`[bootstrap] --dry-run: would apply the split form of ${pending} and record it in d1_migrations`)
      return
    }

    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-bootstrap-'))
    const tempFile = path.join(temp, pending)
    fs.writeFileSync(tempFile, transformed.sql, 'utf8')
    try {
      const exec = runWrangler(cloudflareRoot, [
        'd1', 'execute', database, '--local', '--persist-to', args.persistTo, ...configArgs, '--file', tempFile,
      ])
      if (exec.status !== 0) {
        console.error(exec.output)
        throw new Error(`${database}: applying the split form of ${pending} failed`)
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true })
    }
    const record = runWrangler(cloudflareRoot, [
      'd1', 'execute', database, '--local', '--persist-to', args.persistTo, ...configArgs,
      '--command', `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${pending.replace(/'/g, "''")}')`,
    ])
    if (record.status !== 0) {
      console.error(record.output)
      throw new Error(`${database}: could not record ${pending} in d1_migrations`)
    }
    console.log(`[bootstrap] ${database}: ${pending} applied in split form and recorded`)
  }
  throw new Error(`${database}: gave up after ${all.length} manual steps`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const cloudflareRoot = path.join(__dirname, '..')
  const targets = args.database
    ? [{ database: args.database, migrationsDir: args.migrationsDir || 'migrations' }]
    : DEFAULT_DATABASES
  for (const target of targets) {
    console.log(`[bootstrap] ${target.database} <- ${target.migrationsDir}/ (persist-to ${args.persistTo})`)
    bootstrapDatabase(cloudflareRoot, args, target.database, target.migrationsDir)
  }
  console.log('[bootstrap] done')
}

module.exports = {
  MAX_COMPOUND_SELECT_TERMS,
  COMPOUND_SELECT_ERROR,
  splitStatements,
  leadingKeyword,
  findUnionAllTokens,
  splitOversizedCompoundSelect,
  transformSqlForLocalSqlite,
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(`[bootstrap] ${error && error.message ? error.message : error}`)
    process.exitCode = 1
  }
}
