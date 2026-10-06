#!/usr/bin/env node
// HELD production write (G37 phase 2): fills products.search_doc / search_doc_version
// (migration 0233) for the active products that have no document yet. This script
// only PLANS: it reads a local JSON file and writes SQL files. It never contacts
// D1; the deploy lead runs the files, after the owner-approved window.
//
//   node ops/scripts/backfill-search-doc.mjs --input rows.json --out-dir <dir> [--chunk 150]
//
// rows.json is the output of this SELECT (read-only, one pass over the missing rows):
//
//   node scripts/with-wrangler-auth.cjs wrangler d1 execute business-os --remote --json \
//     --command "SELECT id, name, brand FROM products INDEXED BY idx_products_search_doc_missing WHERE search_doc IS NULL AND is_active = 1 ORDER BY id"
//
// (a plain array of {id,name,brand}, {rows:[...]} or wrangler's [{results:[...]}] all read).
//
// Output (LF-only):
//   backfill-001.sql ...  at most --chunk guarded UPDATEs each, one `wrangler d1 execute
//                         --remote --file` run per file. Every UPDATE is guarded on the
//                         exact name and brand it was computed from AND on search_doc
//                         still being NULL, so a row edited since the SELECT (or a second
//                         run) is skipped, never overwritten with a document of old text.
//   plan.json             counts, the files, the rows skipped and why, the sampled
//                         expected documents, and the assertions below.
//
// The document is lib/searchCore.ts docTerms, the SAME function the browser and the
// Worker run (parity-tested), so this cannot drift from what writers produce.
//
// PRE-ASSERT (plan.assertions.pre; run each with --command, never --file, which
// returns no rows): the missing-row count equals plan.rows, and the FTS index holds
// one entry per product (the migration put every existing row in it).
// POST-ASSERT (plan.assertions.post): the missing-row count is the rows skipped by the
// guard or by this script (plan.skipped) -- not necessarily 0 -- and each sampled row
// carries EXACTLY its expected document (content, not a count); the FTS index and the
// documents agree on an exact token (the index's answer vs a string test on the table),
// and the app answers: GET /api/products/search?query=<sample name> returns the sample.
// A leftover count above the Worker's cap of 50 keeps every search on the legacy
// clause, so re-run this script until it is below it (the scheduled repair also
// finishes any remainder, 60 per tick on Free and 500 on Paid).
//
// COST. Each UPDATE writes the product row, its FTS entry (delete + insert) and two
// stock_session_revisions upserts (trigger stock_revision_products_update): about 10
// rows written. 6,200 products is about 62,000 rows -- inside Paid; on Free (100,000
// rows/day) run it on a day with little else, or use --chunk with only a few files per day.
// RUN WHEN NO STOCK SESSION IS OPEN (after closing): the revision bump makes an open
// draft look changed.
//
// RECOVERY: nothing is lost by stopping part-way (every file is independent). To undo:
//   UPDATE products SET search_doc = NULL, search_doc_version = NULL WHERE search_doc_version = 1
// in chunks (the same triggers keep the index in step); with more than 50 rows missing
// the Worker is back on the legacy search clause by itself.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { docTerms, SEARCH_DOC_VERSION } from '../../cloudflare/src/lib/searchCore.ts'

export const DEFAULT_CHUNK = 150
export const SAMPLE_SIZE = 12
// A string literal that D1's file splitter or a CRLF checkout could alter.
const UNSAFE_TEXT = new RegExp(`[\r\n\0${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`)

export function sqlText(value) {
  return value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`
}

// `IS` compares NULL to NULL the way the Worker's guarded UPDATE does.
function guardedUpdate(row, doc) {
  return `UPDATE products SET search_doc = ${sqlText(doc)}, search_doc_version = ${SEARCH_DOC_VERSION} WHERE id = ${row.id} AND search_doc IS NULL AND name IS ${sqlText(row.name)} AND brand IS ${sqlText(row.brand)};`
}

export function readRows(parsed) {
  const list = Array.isArray(parsed)
    ? (parsed.length && parsed[0] && Array.isArray(parsed[0].results) ? parsed.flatMap((entry) => entry.results) : parsed)
    : parsed?.rows
  if (!Array.isArray(list)) throw new Error('input: expected an array of rows, {rows:[...]} or wrangler --json output')
  return list.map((row, index) => {
    const id = Number(row?.id)
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`input row ${index}: id is not a positive integer`)
    return { id, name: row.name ?? null, brand: row.brand ?? null }
  })
}

export function planBackfill(rows, { chunk = DEFAULT_CHUNK } = {}) {
  if (!Number.isInteger(chunk) || chunk < 1 || chunk > 500) throw new Error('--chunk must be 1..500')
  const seen = new Set()
  const statements = []
  const skipped = []
  const samples = []
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error(`input: duplicate id ${row.id}`)
    seen.add(row.id)
    if (UNSAFE_TEXT.test(String(row.name ?? '')) || UNSAFE_TEXT.test(String(row.brand ?? ''))) {
      skipped.push({ id: row.id, reason: 'control character in name or brand; left to the scheduled repair' })
      continue
    }
    const doc = docTerms({ id: row.id, name: row.name, brand: row.brand })
    statements.push(guardedUpdate(row, doc))
    if (samples.length < SAMPLE_SIZE && (statements.length - 1) % Math.max(1, Math.floor(rows.length / SAMPLE_SIZE)) === 0) {
      samples.push({ id: row.id, name: row.name, expected: doc })
    }
  }
  const files = []
  for (let offset = 0; offset < statements.length; offset += chunk) {
    files.push({ name: `backfill-${String(files.length + 1).padStart(3, '0')}.sql`, statements: statements.slice(offset, offset + chunk) })
  }
  return { files, skipped, samples, rows: rows.length }
}

export function assertions(plan) {
  const ids = plan.samples.map((sample) => sample.id).join(', ')
  const token = plan.samples.flatMap((sample) => sample.expected.split(' ')).find((term) => /^[a-z]{4,}$/.test(term)) ?? null
  const missing = 'SELECT COUNT(*) AS missing FROM products INDEXED BY idx_products_search_doc_missing WHERE search_doc IS NULL AND is_active = 1'
  return {
    pre: [
      { name: 'missing documents equal the rows planned', sql: missing, expect: { missing: plan.rows } },
      { name: 'the FTS index holds one entry per product', sql: 'SELECT (SELECT COUNT(*) FROM products_search_fts) - (SELECT COUNT(*) FROM products) AS difference', expect: { difference: 0 } },
    ],
    post: [
      { name: 'missing documents are only the rows skipped (then re-run, or leave to the scheduled repair)', sql: missing, expect: { missing: `<= ${plan.skipped.length} + rows edited since the SELECT` } },
      { name: 'each sampled row carries exactly its expected document', sql: `SELECT id, search_doc, search_doc_version FROM products WHERE id IN (${ids}) ORDER BY id`, expect: plan.samples.map((sample) => ({ id: sample.id, search_doc: sample.expected, search_doc_version: SEARCH_DOC_VERSION })) },
      ...(token ? [{
        name: 'the index and the documents agree on one exact token',
        sql: `SELECT (SELECT COUNT(*) FROM products_search_fts WHERE products_search_fts MATCH '"${token}"') AS indexed, (SELECT COUNT(*) FROM products WHERE instr(' ' || search_doc || ' ', ' ${token} ') > 0) AS stored`,
        expect: 'indexed = stored',
      }] : []),
      { name: 'the FTS index holds one entry per product', sql: 'SELECT (SELECT COUNT(*) FROM products_search_fts) - (SELECT COUNT(*) FROM products) AS difference', expect: { difference: 0 } },
    ],
    app: 'GET /api/products/search?query=<a sampled name> returns that product (the app\'s own computation, not a SQL re-derivation).',
  }
}

export function writePlan(rows, outDir, options = {}) {
  const plan = planBackfill(rows, options)
  fs.mkdirSync(outDir, { recursive: true })
  for (const file of plan.files) fs.writeFileSync(path.join(outDir, file.name), `${file.statements.join('\n')}\n`)
  const summary = {
    task: 'backfill-search-doc',
    searchDocVersion: SEARCH_DOC_VERSION,
    rows: plan.rows,
    updates: plan.files.reduce((sum, file) => sum + file.statements.length, 0),
    estimatedRowsWritten: plan.files.reduce((sum, file) => sum + file.statements.length, 0) * 10,
    files: plan.files.map((file) => ({ name: file.name, statements: file.statements.length })),
    skipped: plan.skipped,
    samples: plan.samples,
    assertions: assertions(plan),
  }
  fs.writeFileSync(path.join(outDir, 'plan.json'), `${JSON.stringify(summary, null, 2)}\n`)
  return summary
}

function main(argv) {
  const args = new Map()
  for (let i = 0; i < argv.length; i += 2) args.set(argv[i], argv[i + 1])
  const input = args.get('--input')
  const outDir = args.get('--out-dir')
  if (!input || !outDir) {
    console.error('usage: node ops/scripts/backfill-search-doc.mjs --input rows.json --out-dir <dir> [--chunk 150]')
    return 2
  }
  const rows = readRows(JSON.parse(fs.readFileSync(input, 'utf8')))
  const summary = writePlan(rows, outDir, { chunk: args.has('--chunk') ? Number(args.get('--chunk')) : DEFAULT_CHUNK })
  console.log(`rows=${summary.rows} updates=${summary.updates} files=${summary.files.length} skipped=${summary.skipped.length} estimatedRowsWritten=${summary.estimatedRowsWritten}`)
  console.log(`wrote ${summary.files.length} sql file(s) and plan.json to ${outDir}; nothing was sent to D1`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)))
