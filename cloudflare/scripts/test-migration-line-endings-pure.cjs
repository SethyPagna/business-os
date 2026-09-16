/**
 * Every migration file must use LF line endings.
 *
 * This is not style. `wrangler d1 migrations apply --remote` splits the file
 * into statements before sending them, and it decides a `CREATE TRIGGER`
 * body has closed with this regex:
 *
 *     /\sEND[;\s]$/
 *
 * On a CRLF file the accumulated chunk ends `END;\r`, so the `$` anchor sits
 * after the `\r` and the match fails. The splitter never sees the trigger
 * close, sends a truncated statement, and D1 answers:
 *
 *     incomplete input: SQLITE_ERROR [code: 7500]
 *
 * That is exactly how 0115_sale_amendments.sql failed against production on
 * Sep 4 2026, mid-deploy, after the six migrations before it had already
 * applied. It passes `wrangler d1 execute --local --file` because the local
 * path hands the whole file to SQLite, which parses multi-statement input
 * natively and never splits. So a migration can be green locally and still be
 * unshippable -- which is why this check exists rather than a local run.
 *
 * `.gitattributes` pins `cloudflare/migrations/*.sql` to `eol=lf` so the files
 * are born correct on this autocrlf checkout. This test is the backstop for
 * when that rule is edited, a file is added under a path the rule misses, or
 * an editor rewrites one.
 */
const fs = require('fs')
const path = require('path')

const dir = path.join(__dirname, '..', 'migrations')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()

if (files.length < 50) {
  throw new Error(`expected the migration chain, found only ${files.length} files`)
}

const offenders = []
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8')
  if (text.includes('\r\n')) {
    offenders.push({ file: f, hasTrigger: /CREATE\s+TRIGGER/i.test(text) })
  }
}

if (offenders.length) {
  const lines = offenders.map((o) => `  ${o.file}${o.hasTrigger ? '   <-- CONTAINS A TRIGGER: this one WILL fail --remote' : ''}`)
  throw new Error(
    'These migration files have CRLF line endings and must be converted to LF:\n'
    + lines.join('\n')
    + '\n\nA file with a CREATE TRIGGER body cannot be applied to remote D1 with CRLF.'
    + '\nCheck that .gitattributes still pins cloudflare/migrations/*.sql to eol=lf.',
  )
}

// Now prove the property this is really about, directly: for every trigger
// terminator, the chunk wrangler accumulates must satisfy its own regex. Tested
// against each `END;` rather than by splitting on CREATE TRIGGER, because these
// files discuss triggers in their comments too and a heuristic split trips on
// the prose.
const WRANGLER_TRIGGER_END = /\sEND[;\s]$/
let triggerFiles = 0
let terminators = 0
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8')
  if (!/CREATE\s+TRIGGER/i.test(text)) continue
  triggerFiles++

  for (let i = text.indexOf('END;'); i >= 0; i = text.indexOf('END;', i + 1)) {
    terminators++
    const chunk = text.slice(0, i + 'END;'.length)
    if (!WRANGLER_TRIGGER_END.test(chunk)) {
      throw new Error(
        `${f}: wrangler's splitter would not recognise the trigger terminator at offset ${i}, `
        + 'so the statement is sent truncated and D1 answers "incomplete input".',
      )
    }
  }

  // The sibling of the CRLF bug, documented in 0010's own header after it bit
  // that migration: workers-sdk #10998 -- a LOWERCASE `begin` opening a trigger
  // body makes the same splitter mis-parse, with the same error, and likewise
  // only against --remote. Uppercase BEGIN avoids it.
  const lower = text.match(/^[ \t]*begin[ \t]*$/m)
  if (lower) {
    throw new Error(
      `${f}: a trigger body opens with lowercase \`begin\`. wrangler's remote splitter `
      + 'mis-parses that (workers-sdk #10998) and fails with "incomplete input". Use BEGIN.',
    )
  }
}

// ---------------------------------------------------------------------------
// A migration must not open its own transaction.
//
// wrangler already refuses this -- badly. `src/d1/trimmer.ts`
// (node_modules/wrangler/wrangler-dist/cli.js :283352-283370 at the pinned
// 4.116.0) runs `trimSqlQuery` over every statement it is about to apply:
//
//     mayContainTransaction(sql) => sql.includes("BEGIN TRANSACTION")
//     trimmed = sql.replace("BEGIN TRANSACTION;", "").replace("COMMIT;", "")
//     if (mayContainTransaction(trimmed)) throw UserError(
//       "...it contains several transactions.\nD1 runs your SQL in a
//        transaction for you...")
//
// Two things follow, and they are the reason for this assertion rather than
// for trusting wrangler:
//
//   1. wrangler's own error text states the rule: D1 runs the migration in a
//      transaction for you, so the file must not open one.
//   2. Its detector matches the literal string "BEGIN TRANSACTION" ONLY. A
//      bare `BEGIN;` -- SQLite's other spelling of exactly the same statement
//      -- is neither detected nor stripped. It travels through untouched.
//
// From there the two apply paths diverge, and neither is
// `wrangler d1 execute --local --file` (which hands the whole text to SQLite
// and runs `BEGIN; ... COMMIT;` happily, so a local run cannot reveal this):
//
//   * local `migrations apply` -> `executeLocally` :283576 splits with
//     `splitSqlQuery` and runs `db.batch(...)` :283611 against miniflare's D1.
//     `BEGIN;` becomes its own statement inside a batch D1 has already wrapped
//     in a transaction.
//   * `--remote` -> `executeRemotely` :283642 with `file: undefined`
//     (`migrations apply` always passes the SQL as `command`, :286026), so the
//     raw string is POSTed to D1's `query` endpoint and the SERVER parses it.
//     What that parser does with a nested BEGIN is not readable from here --
//     which is the point: it is discovered at deploy time, against production.
//
// A third, fully local consequence needs no server: `buildMigrationQuery`
// :285764 appends `INSERT INTO d1_migrations (name) values ('<file>');` AFTER
// the file's own text. A migration ending in `COMMIT;` therefore records
// itself as applied OUTSIDE its own transaction.
//
// 0129_sale_actual_delivery_cost_amendment shipped with `BEGIN;`/`COMMIT;` on
// Sep 6 2026 and was the only migration in the chain ever to carry them; this
// assertion is why the next one cannot be.
//
// Only statement-level transaction control is rejected. A trigger body's
// `BEGIN` (no semicolon) and its `END;` terminator are untouched, as are the
// words wherever they appear inside `--` comments or string literals.
const TRANSACTION_STATEMENT = [
  // BEGIN; BEGIN TRANSACTION; BEGIN IMMEDIATE; COMMIT; END TRANSACTION;
  // ROLLBACK; ROLLBACK TO sp;   -- but NOT a bare `END;`, see below.
  /^(BEGIN|COMMIT|END|ROLLBACK)(\s+(TRANSACTION|WORK|DEFERRED|IMMEDIATE|EXCLUSIVE|TO)\b.*)?;$/i,
  /^(SAVEPOINT|RELEASE)\s+\S.*;$/i,
]
const transactional = []
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8')
  text.split('\n').forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('--')) return
    // A bare `END;` closes a trigger body and is legitimate -- 120 of them in
    // this chain. `END TRANSACTION;` is not, and the pattern above still
    // catches that.
    if (/^END;$/i.test(line)) return
    if (TRANSACTION_STATEMENT.some((re) => re.test(line))) transactional.push(`  ${f}:${index + 1}  ${line}`)
  })
}
if (transactional.length) {
  throw new Error(
    'These migrations contain statement-level transaction control:\n'
    + transactional.join('\n')
    + '\n\nRemove it. In wrangler\'s own words (src/d1/trimmer.ts): "D1 runs your'
    + '\nSQL in a transaction for you." Its guard only recognises the literal'
    + '\n"BEGIN TRANSACTION", so a bare BEGIN; slips past it and is discovered at'
    + '\ndeploy time; and buildMigrationQuery appends the d1_migrations marker'
    + '\nINSERT after the file, so a trailing COMMIT; records the migration as'
    + '\napplied outside its own transaction. `wrangler d1 execute --local --file`'
    + '\nwill not reveal any of this -- that path never splits the statements.',
  )
}

console.log(`PASS all ${files.length} migrations are LF; ${triggerFiles} contain triggers, ${terminators} bodies wrangler can close; none opens its own transaction`)
