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

console.log(`PASS all ${files.length} migrations are LF; ${triggerFiles} contain triggers, ${terminators} bodies wrangler can close`)
