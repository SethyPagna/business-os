#!/usr/bin/env node
// PREPARED, NOT APPLIED. A rehearsal for merging the live leading-zero twin
// pairs (N15) that reads a LOCAL COPY of the database and writes nothing --
// no D1 binding, no wrangler, no network, no writes, no remote flags at all.
// Its whole output is a plan: which pairs exist, which row survives each pair,
// how many rows every merge would move table by table, what it would do to the
// cost, which pairs it REFUSES, and how to undo the run afterwards.
//
// Why a script rather than "just press Merge in Conflicts": the twins are
// production rows with sales, returns, movements and lots hanging off them, and
// the Conflicts tab merges one pair per confirmation. The owner's ruling on
// this item is explicit -- prepared and rehearsed only, never applied without
// the gate -- so this exists to make the rehearsal exact and repeatable, and to
// produce the numbers the gate is given.
//
// It shares the app's own rules rather than restating them:
//   * identityBarcodeKey / resolveMergedCostDetail come from the SHIPPED
//     cloudflare/src/lib/productDetailRule.ts (transpiled here, not copied), so
//     this plan cannot fold a pair the app would not fold, or average a cost
//     the app would refuse;
//   * the tables a merge relinks come from MERGE_REPARENT_TABLES in
//     cloudflare/src/lib/undoAppliers.ts -- the ONE list the forward fold and
//     the undo applier both walk -- so a table added there is counted here
//     without a second edit;
//   * the survivor ordering mirrors chooseAutomaticKeeper / the sweep: shed
//     fewer zeros, then more stock, then the lower id.
//
// Usage (from the repository root):
//   node ops/scripts/migration/plan-leading-zero-twin-merges.mjs --db <local-copy.sqlite>
//   node ops/scripts/migration/plan-leading-zero-twin-merges.mjs --db <copy> --json plan.json
//
// Getting the local copy is a read-only export the OWNER performs; this script
// never fetches one. The plan it prints is what the owner reviews before
// deciding whether the merges happen at all.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.join(here, '..', '..', '..')

// --------------------------------------------------------------------------
// The shipped rules, loaded from source. `typescript` and `better-sqlite3` are
// resolved out of cloudflare/node_modules, which is where this repository keeps
// them; nothing is installed and nothing is vendored.
// --------------------------------------------------------------------------
const cloudflareRequire = createRequire(path.join(repoRoot, 'cloudflare', 'package.json'))

export function loadProductDetailRule() {
  const ts = cloudflareRequire('typescript')
  const source = path.join(repoRoot, 'cloudflare', 'src', 'lib', 'productDetailRule.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: source,
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, cloudflareRequire)
  for (const name of ['identityBarcodeKey', 'normalizeProductGroupName', 'resolveMergedCostDetail']) {
    if (typeof mod.exports[name] !== 'function') {
      throw new Error(`productDetailRule.ts no longer exports ${name} -- this plan would use a rule the app does not`)
    }
  }
  // Positive control: an instrument that reports every pair the same way is
  // indistinguishable from a broken one, so prove the fold both folds and
  // refuses before trusting a single line of its output.
  const { identityBarcodeKey } = mod.exports
  if (identityBarcodeKey('03614274226546') !== identityBarcodeKey('3614274226546')) {
    throw new Error('the loaded fold does not fold a leading zero -- refusing to plan')
  }
  if (identityBarcodeKey('0012') === identityBarcodeKey('12') || identityBarcodeKey('0') !== '0') {
    throw new Error('the loaded fold folds too much -- refusing to plan')
  }
  return mod.exports
}

/** The ONE list the fold and the undo applier walk, read from its source. */
export function loadReparentTables() {
  const source = fs.readFileSync(path.join(repoRoot, 'cloudflare', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
  const start = source.indexOf('export const MERGE_REPARENT_TABLES')
  if (start < 0) throw new Error('MERGE_REPARENT_TABLES not found -- has it been renamed?')
  const block = source.slice(start, source.indexOf(']', start))
  const tables = [...block.matchAll(/\{\s*table:\s*'([a-z_]+)',\s*column:\s*'([a-z_]+)'\s*\}/g)]
    .map(([, table, column]) => ({ table, column }))
  if (tables.length < 5) throw new Error(`only parsed ${tables.length} reparent tables -- the parser has stopped matching`)
  return tables
}

// --------------------------------------------------------------------------
// The plan. `query(sql, params) => rows` is the only database access, and it is
// only ever a SELECT: the caller supplies it, so this function cannot write
// even by accident.
// --------------------------------------------------------------------------
export function planLeadingZeroTwinMerges(query, rule, reparentTables) {
  const { identityBarcodeKey, normalizeProductGroupName, resolveMergedCostDetail } = rule

  const products = query(`
    SELECT id, name, barcode, cost_price_usd, cost_price_khr,
           COALESCE(stock_quantity, 0) AS stock_quantity
    FROM products
    WHERE is_active = 1 AND COALESCE(is_group, 0) = 0 AND barcode IS NOT NULL AND TRIM(barcode) != ''
  `, {})

  // Bucket by (name, folded barcode). A pair is a leading-zero twin only when
  // the two RAW spellings differ -- two rows sharing an identical barcode are
  // an ordinary exact duplicate and are not this item's business.
  const buckets = new Map()
  for (const row of products) {
    const nameKey = normalizeProductGroupName(row.name)
    if (!nameKey) continue
    const key = `${nameKey}${identityBarcodeKey(row.barcode)}`
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(row)
  }

  const zerosShed = (row) => {
    const raw = String(row.barcode || '').trim().toLowerCase()
    return raw.length - identityBarcodeKey(raw).length
  }

  const pairs = []
  for (const [key, rows] of buckets) {
    if (rows.length < 2) continue
    const rawSpellings = new Set(rows.map((r) => String(r.barcode || '').trim().toLowerCase()))
    if (rawSpellings.size < 2) continue
    // Same survivor ordering as the app: shed fewer zeros, then hold more
    // stock, then the lower id. Keeping the clean spelling is the point -- a
    // run that kept the zero-padded row would put the defect back.
    const ordered = [...rows].sort((a, b) =>
      (zerosShed(a) - zerosShed(b))
      || ((Number(b.stock_quantity) || 0) - (Number(a.stock_quantity) || 0))
      || (a.id - b.id))
    const keeper = ordered[0]
    for (const discarded of ordered.slice(1)) {
      const { merged, outliers } = resolveMergedCostDetail([keeper, discarded])
      const moves = []
      let movedRows = 0
      for (const { table, column } of reparentTables) {
        const [row] = query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = @id`, { id: discarded.id })
        const n = Number(row?.n) || 0
        if (n) { moves.push({ table, column, rows: n }); movedRows += n }
      }
      for (const [table, column] of [['branch_stock', 'product_id'], ['product_batches', 'variant_product_id'], ['product_images', 'product_id']]) {
        const [row] = query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = @id`, { id: discarded.id })
        const n = Number(row?.n) || 0
        if (n) { moves.push({ table, column, rows: n, foldedNotRepointed: true }); movedRows += n }
      }
      const [stock] = query('SELECT COALESCE(SUM(quantity), 0) AS qty FROM branch_stock WHERE product_id = @id', { id: discarded.id })
      pairs.push({
        key,
        keeper: { id: keeper.id, name: keeper.name, barcode: keeper.barcode, cost_price_usd: Number(keeper.cost_price_usd) || 0 },
        discarded: { id: discarded.id, name: discarded.name, barcode: discarded.barcode, cost_price_usd: Number(discarded.cost_price_usd) || 0 },
        stockToDecide: Number(stock?.qty) || 0,
        costBefore: Number(keeper.cost_price_usd) || 0,
        costAfter: Number(merged.cost_price_usd ?? keeper.cost_price_usd) || 0,
        // The app refuses these outright (409 cost_outlier_review), so the plan
        // must list them as work for a person, never as a merge to run.
        refused: outliers.length
          ? { code: 'cost_outlier_review', field: String(outliers[0].field), min: outliers[0].min, max: outliers[0].max }
          : null,
        moves,
        movedRows,
      })
    }
  }

  pairs.sort((a, b) => a.keeper.id - b.keeper.id || a.discarded.id - b.discarded.id)
  const runnable = pairs.filter((p) => !p.refused)
  return {
    generatedAtUtc: new Date().toISOString(),
    pairCount: pairs.length,
    runnablePairCount: runnable.length,
    refusedPairCount: pairs.length - runnable.length,
    movedRowTotal: runnable.reduce((sum, p) => sum + p.movedRows, 0),
    stockToDecideTotal: runnable.reduce((sum, p) => sum + p.stockToDecide, 0),
    pairs,
  }
}

export const RECOVERY_STEPS = Object.freeze([
  'Every merge is recorded as one undoable action: POST /api/products/possible-duplicates/merge writes a merge_duplicate audit entry and an undo_snapshots reversal that names each moved row.',
  'To reverse ONE pair: open Action history, find the merge_duplicate entry for the keeper/discarded ids, and press Undo. It restores branch_stock per branch, re-points every relinked FK back, brings written-off lots back, and reactivates the discarded product.',
  'To reverse a WHOLE bulk run: undo the single composite entry POST /api/products/merge-duplicates records (recordBulkMergeUndoSnapshot) -- not the individual pairs.',
  'Undo asserts the rows still look the way the merge left them. Do the reversal BEFORE any further stock movement on either product, or it will refuse rather than silently half-restore.',
  'A merge is refused while either product still belongs to a stock-in session that can be undone (409 stock_session_reversible). If the run reports that, settle or undo that session first -- do not work around it.',
  'Take a fresh database copy before the run. Undo is exact but it is a forward operation, not a substitute for a backup.',
])

// --------------------------------------------------------------------------
// CLI: read-only, local file, prints the plan
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { db: '', json: '' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[i + 1] || ''
    if (argv[i] === '--json') args.json = argv[i + 1] || ''
  }
  return args
}

function money(value) {
  const n = Number(value) || 0
  return `$${n % 1 === 0 ? n : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`
}

export function formatPlan(plan) {
  const lines = []
  lines.push(`Leading-zero twin merge plan -- DRY RUN, nothing was written (${plan.generatedAtUtc})`)
  lines.push('')
  lines.push(`  pairs found        ${plan.pairCount}`)
  lines.push(`  would merge        ${plan.runnablePairCount}`)
  lines.push(`  refused (review)   ${plan.refusedPairCount}`)
  lines.push(`  rows moved         ${plan.movedRowTotal}`)
  lines.push(`  stock to decide    ${plan.stockToDecideTotal}`)
  lines.push('')
  for (const pair of plan.pairs) {
    lines.push(`  #${pair.keeper.id} "${pair.keeper.name}" [${pair.keeper.barcode}]`)
    lines.push(`    <- #${pair.discarded.id} [${pair.discarded.barcode}]${pair.refused ? '   REFUSED' : ''}`)
    if (pair.refused) {
      lines.push(`       ${pair.refused.field}: ${money(pair.refused.min)} vs ${money(pair.refused.max)} -- too far apart to be one cost. Correct the wrong figure first.`)
      continue
    }
    if (pair.costBefore !== pair.costAfter) {
      lines.push(`       cost ${money(pair.costBefore)} -> ${money(pair.costAfter)} (mean of the distinct costs)`)
    }
    if (pair.stockToDecide) {
      lines.push(`       ${pair.stockToDecide} in stock on the discarded row -- the merge must be told: move it, or write it off`)
    }
    for (const move of pair.moves) {
      lines.push(`       ${move.rows} ${move.table}.${move.column}${move.foldedNotRepointed ? ' (folded per branch/lot, not blindly re-pointed)' : ''}`)
    }
  }
  lines.push('')
  lines.push('Recovery:')
  for (const step of RECOVERY_STEPS) lines.push(`  - ${step}`)
  lines.push('')
  lines.push('This script applied NOTHING. Applying these merges is an owner decision and')
  lines.push('runs through the app\'s own reviewed merge endpoints, never from here.')
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.db) {
    console.error('usage: node ops/scripts/migration/plan-leading-zero-twin-merges.mjs --db <local-copy.sqlite> [--json out.json]')
    process.exitCode = 2
    return
  }
  if (!fs.existsSync(args.db)) {
    console.error(`no such local copy: ${args.db}`)
    process.exitCode = 2
    return
  }
  const Database = cloudflareRequire('better-sqlite3')
  // readonly is the guarantee, not the intention: even a mistaken UPDATE typed
  // into this file could not reach the file it was pointed at.
  const db = new Database(args.db, { readonly: true, fileMustExist: true })
  const query = (sql, params) => db.prepare(sql).all(params || {})
  const plan = planLeadingZeroTwinMerges(query, loadProductDetailRule(), loadReparentTables())
  db.close()
  console.log(formatPlan(plan))
  if (args.json) {
    fs.writeFileSync(args.json, `${JSON.stringify({ ...plan, recoverySteps: RECOVERY_STEPS }, null, 2)}\n`)
    console.log(`\nplan written to ${args.json}`)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main()
