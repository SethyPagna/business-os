#!/usr/bin/env node

/*
 * N21 -- sales.customer_address: rewrite the Contact Options JSON that older
 * writers snapshotted into that column as the DISPLAY address a person reads.
 *
 * PREPARED, NOT APPLIED. This script has no network, no Wrangler, no D1 and no
 * remote capability whatsoever: it opens ONE local SQLite file with
 * node:sqlite and, unless it is given --apply, it opens that file read-only and
 * writes nothing. Running it against production is not something it can do; a
 * production run would be an owner decision going through the repository's
 * normal D1 path, against a local copy first.
 *
 * WHY
 * ---
 * customers.address holds the Contact Options JSON that
 * cloudflare/src/lib/contactOptions.ts serializes -- an array of
 * {label,name,phone,email,address,area}. Every writer that snapshotted it into
 * sales.customer_address copied the column RAW (POS checkout,
 * PATCH /sales/:id/customer, the contact edit cascade, the duplicate merge and
 * the bulk customer update), so the stored snapshot is machine text: '[]',
 * '[{"label":"Default",...}]', or a truncated '[{'. That is what the owner saw
 * on the sale detail and the receipt.
 *
 * The code fix landed with this script: the writers now snapshot the display
 * address, and every reader renders through the same kernel, so the screens are
 * already correct without this repair -- a stored '[]' resolves to nothing at
 * read time. This script exists to clean the data AT REST, so that exports,
 * ad-hoc SQL and any future reader that forgets the kernel see an address
 * instead of JSON.
 *
 * WHAT IT DOES
 * ------------
 * For every sales row whose customer_address LOOKS like stored JSON (it starts
 * with '[' or '{' -- exactly the values a human never typed), it computes
 * contactDisplayAddress(value) and rewrites the column to that string, or to
 * NULL when the options carry no address at all. Rows holding a plain typed
 * address are NOT touched, including a numeric one like "271" that happens to
 * parse as JSON. Rows that differ from their display value only by surrounding
 * whitespace are counted and reported but NOT rewritten: a cosmetic trim is not
 * worth an UPDATE against every historical sale.
 *
 * The kernel is duplicated here as plain JS (this script must not import
 * TypeScript) and verified character by character against BOTH copies in the
 * repository at startup, so it cannot silently classify rows by a different
 * rule than the app does.
 *
 * USAGE
 * -----
 *   node ops/scripts/migration/repair-sales-customer-address-json.mjs --db <file>
 *       Dry run (default). Opens read-only. Prints the pre-counts, the split
 *       between rows that resolve to an address and rows that resolve to
 *       nothing, and a sample of before/after values. --out <file> writes the
 *       full plan, including the recovery table.
 *
 *   ... --db <file> --apply --i-have-a-backup
 *       Applies the rewrite to that LOCAL file inside one transaction. Both
 *       flags are required; either one alone refuses.
 *
 * RECOVERY
 * --------
 * 1. Run the dry run with --out FIRST and keep the plan file. Its `recovery`
 *    table carries {id, rowid, receipt_number, before, after} for every row,
 *    and restoring one row is
 *      UPDATE sales SET customer_address = <before> WHERE rowid = <rowid>;
 * 2. --apply runs inside BEGIN/COMMIT on a single file, so a failure part-way
 *    rolls the whole thing back and the file is never half-converted.
 * 3. Even with no plan file, nothing is unrecoverable: the value being
 *    overwritten is a stale COPY of customers.address, and for any row with a
 *    customer_id the original is still
 *      (SELECT address FROM customers WHERE id = sales.customer_id).
 *    The only rows without that fallback are ones whose customer was deleted,
 *    and their snapshot was unreadable machine text to begin with.
 * 4. The change is idempotent: a second run finds zero rows, and the
 *    post-assertion in --apply proves it on the spot.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

// The two repository copies this must agree with. They are byte-identical to
// each other (frontend/tests/contactDisplayAddress.test.ts pins that); this
// script checks them both anyway, because it is the one caller that cannot
// import either.
const KERNEL_SOURCES = [
  path.join(REPO_ROOT, 'cloudflare', 'src', 'lib', 'contactOptions.ts'),
  path.join(REPO_ROOT, 'frontend', 'src', 'components', 'contacts', 'contactOptionUtils.ts'),
]

// ---------------------------------------------------------------------------
// The kernel, verbatim from those files with the TypeScript annotations
// removed. assertKernelMatchesRepo() below performs exactly that removal on the
// real sources and compares the result to this text, so a change there that is
// not mirrored here stops the script rather than silently repairing rows by an
// out-of-date rule.
const KERNEL_TEXT = `export function contactDisplayAddress(raw, mode = 'address') {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const key = mode === 'area' ? 'area' : 'address'
  const looksStructured = text.startsWith('[') || text.startsWith('{')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_) {
    return looksStructured ? '' : text
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const value = entry && typeof entry === 'object'
        ? String(entry[key] ?? '').trim()
        : String(entry ?? '').trim()
      if (value) return value
    }
    return ''
  }
  // A bare scalar round-trips to itself (a house number like "271" parses as
  // a number and is still an address); anything object-shaped is machine text.
  if (parsed === null || typeof parsed === 'object') return ''
  return text
}`

export function contactDisplayAddress(raw, mode = 'address') {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const key = mode === 'area' ? 'area' : 'address'
  const looksStructured = text.startsWith('[') || text.startsWith('{')
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (_) {
    return looksStructured ? '' : text
  }
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      const value = entry && typeof entry === 'object'
        ? String(entry[key] ?? '').trim()
        : String(entry ?? '').trim()
      if (value) return value
    }
    return ''
  }
  // A bare scalar round-trips to itself (a house number like "271" parses as
  // a number and is still an address); anything object-shaped is machine text.
  if (parsed === null || typeof parsed === 'object') return ''
  return text
}

// The literal above must BE the repository's function. Strip the four
// TypeScript-only fragments and compare what is left, character for character.
function stripTypeScript(source) {
  return source
    .replace(/\(raw: unknown, mode: 'address' \| 'area' = 'address'\): string \{/, "(raw, mode = 'address') {")
    .replace(/let parsed: unknown/, 'let parsed')
    .replace(/\(entry as Record<string, unknown>\)\[key\]/, 'entry[key]')
}

export function assertKernelMatchesRepo() {
  const checked = []
  for (const file of KERNEL_SOURCES) {
    if (!fs.existsSync(file)) throw new Error(`kernel source missing: ${file}`)
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    const start = text.indexOf('export function contactDisplayAddress(')
    if (start < 0) throw new Error(`contactDisplayAddress not found in ${file}`)
    const end = text.indexOf('\n}', start)
    if (end < start) throw new Error(`contactDisplayAddress does not close in ${file}`)
    const extracted = stripTypeScript(text.slice(start, end + 2))
    if (extracted !== KERNEL_TEXT) {
      throw new Error(
        `the kernel in ${path.relative(REPO_ROOT, file)} has drifted from the copy in this script.\n` +
        'Update KERNEL_TEXT and contactDisplayAddress() here to match, or this repair would\n' +
        'rewrite rows by a rule the app no longer uses.',
      )
    }
    checked.push(path.relative(REPO_ROOT, file))
  }
  return checked
}

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { db: '', out: '', apply: false, backup: false, help: false }
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

// A value a human never typed: stored JSON, whole or truncated. This is the
// repair set, and it is deliberately narrower than "stored !== display" so a
// cosmetic whitespace difference does not rewrite every historical sale.
function looksLikeMachineText(raw) {
  const text = String(raw ?? '').trim()
  return text.startsWith('[') || text.startsWith('{')
}

export function plan(db) {
  const totals = {
    sales_rows: Number(db.prepare('SELECT COUNT(*) AS n FROM sales').get().n || 0),
    with_address: 0,
    machine_text: 0,
    resolves_to_address: 0,
    resolves_to_null: 0,
    whitespace_only_difference: 0,
  }
  const entries = []
  const rows = db.prepare(
    `SELECT rowid AS rowid, id, receipt_number, customer_id, customer_address
     FROM sales
     WHERE TRIM(COALESCE(customer_address, '')) <> ''
     ORDER BY rowid`,
  ).all()
  for (const row of rows) {
    totals.with_address += 1
    const before = row.customer_address
    if (!looksLikeMachineText(before)) {
      if (String(before).trim() !== String(before)) totals.whitespace_only_difference += 1
      continue
    }
    totals.machine_text += 1
    const after = contactDisplayAddress(before) || null
    if (after === null) totals.resolves_to_null += 1
    else totals.resolves_to_address += 1
    entries.push({
      rowid: row.rowid,
      id: row.id,
      receipt_number: row.receipt_number ?? null,
      customer_id: row.customer_id ?? null,
      before,
      after,
    })
  }
  return { totals, entries }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || !args.db) {
    console.log('usage: node ops/scripts/migration/repair-sales-customer-address-json.mjs --db <local.sqlite> [--out plan.json] [--apply --i-have-a-backup]')
    console.log('Dry run by default. NEVER run this against a remote database; it has no way to reach one.')
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

  const checked = assertKernelMatchesRepo()
  console.log(`kernel: matches ${checked.join(' and ')}`)

  const db = new DatabaseSync(dbPath, { readOnly: !args.apply })
  console.log(`db: ${dbPath} (${args.apply ? 'READ-WRITE' : 'read-only'})`)

  const { totals, entries } = plan(db)
  console.log('pre-counts:')
  console.log(`  sales rows                      ${String(totals.sales_rows).padStart(8)}`)
  console.log(`  with a non-empty address        ${String(totals.with_address).padStart(8)}`)
  console.log(`  holding machine text (to fix)   ${String(totals.machine_text).padStart(8)}`)
  console.log(`    -> resolve to an address      ${String(totals.resolves_to_address).padStart(8)}`)
  console.log(`    -> resolve to nothing (NULL)  ${String(totals.resolves_to_null).padStart(8)}`)
  console.log(`  whitespace-only diff (left as is) ${String(totals.whitespace_only_difference).padStart(6)}`)

  for (const entry of entries.slice(0, 10)) {
    console.log(`  sale ${entry.id} (${entry.receipt_number || 'no receipt no.'}): ${JSON.stringify(entry.before)} -> ${JSON.stringify(entry.after)}`)
  }

  if (args.out) {
    const planFile = path.resolve(args.out)
    fs.writeFileSync(planFile, JSON.stringify({
      generated_at_utc: new Date().toISOString(),
      db: dbPath,
      applied: args.apply,
      totals,
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

  if (!args.out) {
    console.error('refusing: --apply requires --out <plan.json> so the recovery table survives the run')
    db.close()
    process.exit(2)
  }

  db.exec('BEGIN')
  let changed = 0
  try {
    const update = db.prepare('UPDATE sales SET customer_address = ? WHERE rowid = ?')
    for (const entry of entries) {
      const result = update.run(entry.after, entry.rowid)
      changed += Number(result.changes || 0)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    db.close()
    throw error
  }
  console.log(`applied: ${changed} row(s) updated`)

  // Post-assertions, on the same open file:
  //   1. every planned row was written,
  //   2. no sales row holds machine text any more,
  //   3. the rows that resolved to an address hold exactly that address.
  if (changed !== entries.length) {
    console.error(`POST-ASSERTION FAILED: planned ${entries.length} row(s), wrote ${changed}`)
    db.close()
    process.exit(1)
  }
  const after = plan(db)
  if (after.entries.length !== 0) {
    console.error(`POST-ASSERTION FAILED: ${after.entries.length} row(s) still hold machine text`)
    db.close()
    process.exit(1)
  }
  const check = db.prepare('SELECT customer_address AS value FROM sales WHERE rowid = ?')
  for (const entry of entries) {
    const stored = check.get(entry.rowid)?.value ?? null
    if (stored !== entry.after) {
      console.error(`POST-ASSERTION FAILED: sale ${entry.id} holds ${JSON.stringify(stored)}, expected ${JSON.stringify(entry.after)}`)
      db.close()
      process.exit(1)
    }
  }
  console.log(`post-assertion: 0 rows hold machine text; ${entries.length} row(s) match the plan`)
  db.close()
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(String((error && error.message) || error))
    process.exit(1)
  }
}
