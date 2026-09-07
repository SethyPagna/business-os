#!/usr/bin/env node
// PREPARED, NOT APPLIED. The whole-catalog sibling of
// plan-leading-zero-twin-merges.mjs, for the owner's N34 ruling:
//
//   "also, go into all groups product check child if the only reasons stopping
//    them from merge is leading zero for barcode, remove the leading zero...
//    only keep for genuine difference of barcode... make sure previous remove
//    barcode, also linkover the sales of them. same goes for supplier, received
//    date, categories, brand, barcode, units, etc..."
//
// The existing plan script answers one question -- which leading-zero twin
// pairs exist -- and it answers it well. It does NOT walk every group's
// children and say what each child pair IS, which is what that ruling asks
// for, and it says nothing about the pairs it silently skips. A plan that
// lists only the class it can merge tells the owner nothing about the classes
// it cannot, and "how many did you look at and decide to leave alone?" is the
// question that separates a sweep from a filter.
//
// So this walks EVERY name group with more than one active child row and
// classifies every child PAIR into exactly one of three classes:
//
//   (a) leading_zero    -- the barcodes differ ONLY by leading zeros. One
//                          article, two spellings. The plan keeps the
//                          no-leading-zero spelling and moves every link of the
//                          removed twin onto it. This is the class the sibling
//                          script plans in detail; counted here so the totals
//                          reconcile, and cross-checked against it.
//   (b) genuine_barcode -- the barcodes are genuinely different codes. KEEP
//                          SEPARATE. This is the child-row model working as
//                          designed ("only a DIFFERENT barcode makes a new
//                          child row"), and merging these would destroy real
//                          distinctions.
//   (c) detail_only     -- the barcodes fold to the SAME identity key (or both
//                          rows are barcodeless) and what differs is supplier,
//                          received date, category, brand or unit. None of
//                          those is identity. The pair is one article; the
//                          differing details are not a reason to keep two rows,
//                          and they are not lost by merging either -- the
//                          survivor carries the union of the batches, each
//                          keeping its own received date and supplier, because
//                          that is where those facts actually live.
//
// It also lists the RESIDUE the owner named separately -- "make sure previous
// remove barcode, also linkover the sales of them": rows whose barcode was
// cleared, and rows that were deactivated by an earlier merge (migration 0109
// merged 22 duplicates in production and deliberately left their batches
// behind), that still have sale items, returns or movements pointing at them.
// Those links are not reachable from the app's own repair path once the row is
// inactive, so they need naming before anything can be proposed about them.
//
// SAFETY, in the order it matters:
//   * THIS SCRIPT NEVER WRITES. It has no apply mode at all -- not to
//     production, not to a local copy. It had a flag called --apply that
//     printed a refusal and changed nothing, which is worse than having no
//     flag: a CLI that advertises an apply it does not perform invites
//     somebody to believe a run applied something. The flag is now
//     --rehearse, it does what its name says (count, plan, count again, check
//     the counts did not move) and --apply is rejected loudly like --remote.
//   * the file it is handed is opened READONLY in every mode, so even a
//     mistaken UPDATE typed into this file could not reach it.
//   * pre/post assertions bracket the rehearsal: products, sale_items linked,
//     movements linked, batches -- counted before, counted after, and any
//     movement at all is an assertion failure, because a rehearsal that moved
//     something has already broken its own promise.
//   * the rules come from the SHIPPED source (identityBarcodeKey,
//     normalizeProductGroupName, resolveMergedCostDetail from
//     cloudflare/src/lib/productDetailRule.ts; MERGE_REPARENT_TABLES from
//     cloudflare/src/lib/undoAppliers.ts), transpiled, never copied, so this
//     cannot classify a pair the app would classify differently.
//   * a POSITIVE CONTROL runs before any output: the loaded fold must both fold
//     a real leading zero AND refuse to fold '0012'/'12'. A sweep that reports
//     every pair the same way is indistinguishable from a broken instrument.
//
// Usage (from the repository root):
//   node ops/scripts/migration/plan-group-child-identity.mjs --db <local-copy.sqlite>
//   node ops/scripts/migration/plan-group-child-identity.mjs --db <local-copy.sqlite> --json plan.json
//   node ops/scripts/migration/plan-group-child-identity.mjs --db <local-copy.sqlite> --class detail_only
//   node ops/scripts/migration/plan-group-child-identity.mjs --db <local-copy.sqlite> --rehearse
//
// RECOVERY: see RECOVERY_STEPS at the bottom. In short -- take a fresh copy
// before any run that is meant to lead to a change; --rehearse writes nothing
// and says so with counts on both sides; and nothing here can reach
// production, because nothing here can reach anything but the local file it
// was handed, and it opens that readonly.

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const repoRoot = path.join(here, '..', '..', '..')
const cloudflareRequire = createRequire(path.join(repoRoot, 'cloudflare', 'package.json'))

// The detail fields the owner listed, as they actually exist on a product ROW.
// NONE of these is identity -- that is the whole point of class (c). They are
// listed so the plan can say WHICH of them differ on a pair it is calling "one
// article", instead of asserting it.
//
// RECEIVED DATE IS NOT HERE, and its absence is the strongest evidence for the
// class. There is no products.received_date column: a received date is a
// property of a BATCH (product_batches.received_at), alongside that batch's own
// supplier (product_batches.supplier_name). So "these two rows were received on
// different dates" is not a fact about the two rows at all -- it is a fact
// about their batches, and a merge that carries the union of the batches keeps
// every one of those dates and suppliers exactly where it already was. The
// batch spread is reported per pair (batchReceivedDates / batchSuppliers) so
// that claim can be checked rather than believed.
export const DETAIL_FIELDS = Object.freeze([
  'supplier', 'category', 'brand', 'unit',
])

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
  // POSITIVE CONTROL. An instrument that answers every question the same way
  // cannot be told apart from a broken one, so prove the fold both folds and
  // REFUSES before a single line of output is trusted.
  const { identityBarcodeKey } = mod.exports
  if (identityBarcodeKey('03614274226546') !== identityBarcodeKey('3614274226546')) {
    throw new Error('the loaded fold does not fold a leading zero -- refusing to plan')
  }
  if (identityBarcodeKey('0012') === identityBarcodeKey('12') || identityBarcodeKey('0') !== '0') {
    throw new Error('the loaded fold folds too much -- refusing to plan')
  }
  return mod.exports
}

/** The ONE list the forward fold and the undo applier both walk. */
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

const norm = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Classify one child pair. Pure, so it is testable without a database.
 *
 * The order of the tests is the argument. The barcode question is asked FIRST
 * and settles the pair on its own whenever the two codes are genuinely
 * different, because that is the child-row model: only a different barcode
 * mints a child row. Detail differences are consulted only once identity has
 * already said "these are one article" -- asking them first would let a
 * supplier difference override a real barcode difference, which is exactly the
 * inversion the owner's ruling is correcting.
 */
export function classifyChildPair(a, b, identityBarcodeKey) {
  const rawA = String(a.barcode || '').trim().toLowerCase()
  const rawB = String(b.barcode || '').trim().toLowerCase()
  const keyA = identityBarcodeKey(a.barcode)
  const keyB = identityBarcodeKey(b.barcode)
  const detailsDiffer = DETAIL_FIELDS.filter((field) => norm(a[field]) !== norm(b[field]))

  if (keyA !== keyB) {
    return { klass: 'genuine_barcode', detailsDiffer, reason: `${rawA || '(none)'} vs ${rawB || '(none)'}` }
  }
  if (rawA !== rawB) {
    // Same identity, different SPELLING -- the leading-zero class. The survivor
    // is the spelling that sheds fewer zeros; keeping the padded one would put
    // the defect back.
    return { klass: 'leading_zero', detailsDiffer, reason: `${rawA} vs ${rawB} (same code, extra leading zero)` }
  }
  return {
    klass: 'detail_only',
    detailsDiffer,
    reason: detailsDiffer.length
      ? `identical barcode; differs on ${detailsDiffer.join(', ')}`
      : 'identical barcode and identical details',
  }
}

const zerosShed = (row, identityBarcodeKey) => {
  const raw = String(row.barcode || '').trim().toLowerCase()
  return raw.length - identityBarcodeKey(raw).length
}

/**
 * The survivor, mirroring chooseAutomaticKeeper and the sweep: shed fewer
 * zeros, then hold more stock, then the lower id.
 */
export function chooseSurvivor(rows, identityBarcodeKey) {
  return [...rows].sort((a, b) =>
    (zerosShed(a, identityBarcodeKey) - zerosShed(b, identityBarcodeKey))
    || ((Number(b.stock_quantity) || 0) - (Number(a.stock_quantity) || 0))
    || (a.id - b.id))[0]
}

function promotionRuleIdLists(query) {
  const rows = query('SELECT id, product_ids FROM promotion_rules', {})
  return rows.map((row) => {
    let parsed = []
    try { parsed = JSON.parse(String(row.product_ids || '[]')) } catch { parsed = [] }
    return { id: Number(row.id), productIds: (Array.isArray(parsed) ? parsed : []).map(Number).filter(Number.isFinite) }
  })
}

/**
 * The received dates and suppliers the pair's batches carry, which is where
 * those two facts actually live (there is no products.received_date, and a
 * batch carries its own supplier_name). Reported so class (c)'s claim -- "the
 * survivor carries the union of the batches with their received dates and
 * suppliers intact" -- can be CHECKED against the rows rather than believed:
 * the union listed here is exactly what a merge re-points, one batch row at a
 * time, with received_at and supplier_name untouched on each.
 */
function batchSpread(query, productIds) {
  const dates = new Set()
  const suppliers = new Set()
  for (const id of productIds) {
    for (const row of query('SELECT received_at, supplier_name FROM product_batches WHERE variant_product_id = @id', { id })) {
      if (row.received_at) dates.add(String(row.received_at).slice(0, 10))
      if (row.supplier_name) suppliers.add(String(row.supplier_name))
    }
  }
  return { batchReceivedDates: [...dates].sort(), batchSuppliers: [...suppliers].sort() }
}

function countLinks(query, productId, reparentTables, rules) {
  const moves = []
  let movedRows = 0
  for (const { table, column } of reparentTables) {
    const [row] = query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = @id`, { id: productId })
    const n = Number(row?.n) || 0
    if (n) { moves.push({ table, column, rows: n }); movedRows += n }
  }
  // The links MERGE_REPARENT_TABLES structurally cannot hold: a JSON id array
  // in a TEXT column, and a product FK not named *product_id. The fold moves
  // both; a plan that did not count them would under-report every pair with one.
  const rescoped = rules.filter((rule) => rule.productIds.includes(productId))
  if (rescoped.length) { moves.push({ table: 'promotion_rules', column: 'product_ids', rows: rescoped.length, jsonIdList: true }); movedRows += rescoped.length }
  const [children] = query('SELECT COUNT(*) AS n FROM products WHERE parent_id = @id', { id: productId })
  const childRows = Number(children?.n) || 0
  if (childRows) { moves.push({ table: 'products', column: 'parent_id', rows: childRows }); movedRows += childRows }
  for (const [table, column] of [['branch_stock', 'product_id'], ['product_batches', 'variant_product_id'], ['product_images', 'product_id']]) {
    const [row] = query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = @id`, { id: productId })
    const n = Number(row?.n) || 0
    if (n) { moves.push({ table, column, rows: n, foldedNotRepointed: true }); movedRows += n }
  }
  return { moves, movedRows }
}

// --------------------------------------------------------------------------
// The plan. `query` is the ONLY database access and is only ever a SELECT.
// --------------------------------------------------------------------------
export function planGroupChildIdentity(query, rule, reparentTables) {
  const { identityBarcodeKey, normalizeProductGroupName, resolveMergedCostDetail } = rule

  const products = query(`
    SELECT id, name, barcode, supplier, category, brand, unit,
           cost_price_usd, cost_price_khr, COALESCE(stock_quantity, 0) AS stock_quantity
    FROM products
    WHERE is_active = 1 AND COALESCE(is_group, 0) = 0
  `, {})

  const rules = promotionRuleIdLists(query)

  // Every name group -- the app's grouping is virtual and name-based, so this
  // IS the group definition, not an approximation of it.
  const groups = new Map()
  for (const row of products) {
    const nameKey = normalizeProductGroupName(row.name)
    if (!nameKey) continue
    if (!groups.has(nameKey)) groups.set(nameKey, [])
    groups.get(nameKey).push(row)
  }

  const pairs = []
  let groupsWithChildren = 0
  for (const [nameKey, rows] of groups) {
    if (rows.length < 2) continue
    groupsWithChildren++
    // Every unordered child pair in the group. A group of n children has
    // n*(n-1)/2 of them, and every one is a decision somebody has to make.
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const verdict = classifyChildPair(rows[i], rows[j], identityBarcodeKey)
        const survivor = verdict.klass === 'genuine_barcode' ? null : chooseSurvivor([rows[i], rows[j]], identityBarcodeKey)
        const discarded = survivor ? (survivor.id === rows[i].id ? rows[j] : rows[i]) : null
        const cost = survivor ? resolveMergedCostDetail([survivor, discarded]) : null
        const links = discarded ? countLinks(query, discarded.id, reparentTables, rules) : { moves: [], movedRows: 0 }
        const spread = batchSpread(query, [rows[i].id, rows[j].id])
        const [stock] = discarded
          ? query('SELECT COALESCE(SUM(quantity), 0) AS qty FROM branch_stock WHERE product_id = @id', { id: discarded.id })
          : [{ qty: 0 }]
        pairs.push({
          nameKey,
          klass: verdict.klass,
          reason: verdict.reason,
          detailsDiffer: verdict.detailsDiffer,
          batchReceivedDates: spread.batchReceivedDates,
          batchSuppliers: spread.batchSuppliers,
          a: { id: rows[i].id, name: rows[i].name, barcode: rows[i].barcode },
          b: { id: rows[j].id, name: rows[j].name, barcode: rows[j].barcode },
          survivorId: survivor?.id ?? null,
          discardedId: discarded?.id ?? null,
          stockToDecide: Number(stock?.qty) || 0,
          costBefore: survivor ? Number(survivor.cost_price_usd) || 0 : 0,
          costAfter: cost ? Number(cost.merged.cost_price_usd ?? survivor.cost_price_usd) || 0 : 0,
          // The app refuses these outright (409 cost_outlier_review), so the
          // plan lists them as work for a person, never as a merge to run.
          refused: cost?.outliers?.length
            ? { code: 'cost_outlier_review', field: String(cost.outliers[0].field), min: cost.outliers[0].min, max: cost.outliers[0].max }
            : null,
          moves: links.moves,
          movedRows: links.movedRows,
        })
      }
    }
  }

  pairs.sort((a, b) => a.a.id - b.a.id || a.b.id - b.b.id)
  const byClass = (klass) => pairs.filter((pair) => pair.klass === klass)
  const runnable = pairs.filter((pair) => pair.klass !== 'genuine_barcode' && !pair.refused)

  return {
    generatedAtUtc: new Date().toISOString(),
    productsScanned: products.length,
    groupsWithChildren,
    pairCount: pairs.length,
    leadingZeroCount: byClass('leading_zero').length,
    genuineBarcodeCount: byClass('genuine_barcode').length,
    detailOnlyCount: byClass('detail_only').length,
    refusedCount: pairs.filter((pair) => pair.refused).length,
    runnablePairCount: runnable.length,
    movedRowTotal: runnable.reduce((sum, pair) => sum + pair.movedRows, 0),
    stockToDecideTotal: runnable.reduce((sum, pair) => sum + pair.stockToDecide, 0),
    residue: planOrphanedLinkResidue(query),
    pairs,
  }
}

/**
 * "make sure previous remove barcode, also linkover the sales of them."
 *
 * Rows that are no longer reachable from the app's own repair path but still
 * have records pointing at them:
 *   * INACTIVE rows with live links -- migration 0109 merged 22 duplicates in
 *     production and deliberately left their batches behind; deactivating a row
 *     puts that residue permanently out of the Conflicts sweep's reach, because
 *     the sweep reads active rows only.
 *   * ACTIVE rows whose barcode was CLEARED. These still appear in the catalog,
 *     but they can no longer be found by the barcode their historical sale rows
 *     were rung under, so a barcode search for an old receipt finds nothing.
 *
 * Listed, never touched. What to do about them is the owner's decision, and it
 * is a production decision -- this script exists so the proposal can be made
 * with real numbers instead of an estimate.
 */
export function planOrphanedLinkResidue(query) {
  const inactive = query(`
    SELECT p.id, p.name, p.barcode,
      (SELECT COUNT(*) FROM sale_items si WHERE si.product_id = p.id) AS saleItems,
      (SELECT COUNT(*) FROM inventory_movements im WHERE im.product_id = p.id) AS movements,
      (SELECT COUNT(*) FROM product_batches pb WHERE pb.variant_product_id = p.id) AS batches
    FROM products p
    WHERE p.is_active = 0
  `, {}).filter((row) => (Number(row.saleItems) || 0) + (Number(row.movements) || 0) + (Number(row.batches) || 0) > 0)

  const clearedBarcode = query(`
    SELECT p.id, p.name,
      (SELECT COUNT(*) FROM sale_items si WHERE si.product_id = p.id) AS saleItems,
      (SELECT COUNT(*) FROM inventory_movements im WHERE im.product_id = p.id) AS movements
    FROM products p
    WHERE p.is_active = 1 AND (p.barcode IS NULL OR TRIM(p.barcode) = '')
  `, {}).filter((row) => (Number(row.saleItems) || 0) + (Number(row.movements) || 0) > 0)

  return {
    inactiveWithLinks: inactive.map((row) => ({
      id: Number(row.id), name: row.name, barcode: row.barcode,
      saleItems: Number(row.saleItems) || 0,
      movements: Number(row.movements) || 0,
      batches: Number(row.batches) || 0,
    })),
    activeWithClearedBarcode: clearedBarcode.map((row) => ({
      id: Number(row.id), name: row.name,
      saleItems: Number(row.saleItems) || 0,
      movements: Number(row.movements) || 0,
    })),
  }
}

// --------------------------------------------------------------------------
// PRE / POST ASSERTIONS. The four counts that must move by exactly the planned
// amount, or nothing is written at all.
// --------------------------------------------------------------------------
export function readAssertionCounts(query) {
  const one = (sql) => Number(query(sql, {})[0]?.n) || 0
  return {
    activeProducts: one('SELECT COUNT(*) AS n FROM products WHERE is_active = 1'),
    saleItemsLinked: one('SELECT COUNT(*) AS n FROM sale_items WHERE product_id IS NOT NULL'),
    movementsLinked: one('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id IS NOT NULL'),
    batches: one('SELECT COUNT(*) AS n FROM product_batches'),
  }
}

/**
 * What the counts must look like AFTER a run of `mergeCount` pairs.
 *
 * Deliberately strict on the three link counts: a merge RE-POINTS links, it
 * never creates or destroys them, so every one of them must be UNCHANGED. A
 * run that moved a sale item into nowhere, or duplicated a batch, shows up here
 * and rolls the whole transaction back. Only the active-product count is
 * allowed to move, and only downward, by exactly the number of rows retired.
 */
export function expectedCountsAfter(before, mergeCount) {
  return {
    activeProducts: before.activeProducts - mergeCount,
    saleItemsLinked: before.saleItemsLinked,
    movementsLinked: before.movementsLinked,
    batches: before.batches,
  }
}

export function assertCounts(expected, actual) {
  const problems = []
  for (const key of Object.keys(expected)) {
    if (expected[key] !== actual[key]) problems.push(`${key}: expected ${expected[key]}, found ${actual[key]}`)
  }
  return problems
}

export const RECOVERY_STEPS = Object.freeze([
  'Take a fresh copy of the database file BEFORE any run that is meant to lead to a change. The copy is the recovery plan; everything below is a convenience on top of it.',
  'There is nothing to roll back: this script has NO apply mode. --rehearse counts the four totals, builds the plan and counts them again, and any movement at all is an assertion failure -- a rehearsal that wrote something has already broken its promise. The merge that must actually run is the app\'s own carry-all kernel.',
  'This script cannot reach production, and cannot write to the local copy either. It has no D1 binding, no wrangler import, no network call and no --remote flag; it opens the one local file it is handed, and opens it readonly in every mode.',
  'Applying any of this to production is an OWNER decision and runs through the app\'s own reviewed merge endpoints (POST /api/products/possible-duplicates/merge), which record an undoable action per pair -- never from this script, which has no apply mode at all.',
  'A merge is refused while either product still belongs to a stock-in session that can be undone. Settle or undo that session first rather than working around it.',
  'The residue list (inactive rows with live links, active rows whose barcode was cleared) is REPORTED ONLY. Nothing in this script touches those rows in any mode.',
])

// --------------------------------------------------------------------------
// CLI
// --------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { db: '', json: '', rehearse: false, klass: '', limit: 40 }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[i + 1] || ''
    if (argv[i] === '--json') args.json = argv[i + 1] || ''
    if (argv[i] === '--class') args.klass = argv[i + 1] || ''
    if (argv[i] === '--limit') args.limit = Number(argv[i + 1]) || 40
    if (argv[i] === '--rehearse') args.rehearse = true
    if (argv[i] === '--apply') {
      // Rejected, not ignored, and not quietly aliased to --rehearse. This
      // flag existed and printed a refusal, so an operator could run it,
      // see "PRE/POST assertions OK" and reasonably conclude something was
      // applied. There is no apply here to alias it to.
      throw new Error('--apply is not a flag this script has. It never writes: use --rehearse for the counted dry run, and the app\'s own merge endpoint to actually merge.')
    }
    if (argv[i] === '--remote') {
      throw new Error('--remote is not a flag this script has, and never will be. It reads a LOCAL COPY only.')
    }
  }
  return args
}

export function formatPlan(plan, klass = '', limit = 40) {
  const lines = []
  lines.push(`Group child identity sweep -- DRY RUN, nothing was written (${plan.generatedAtUtc})`)
  lines.push('')
  lines.push(`  active child rows scanned   ${plan.productsScanned}`)
  lines.push(`  groups with >1 child        ${plan.groupsWithChildren}`)
  lines.push(`  child pairs classified      ${plan.pairCount}`)
  lines.push('')
  lines.push(`  (a) leading zero only       ${plan.leadingZeroCount}   -> merge, keep the unpadded spelling`)
  lines.push(`  (b) genuine barcode diff    ${plan.genuineBarcodeCount}   -> KEEP SEPARATE (the child-row model working)`)
  lines.push(`  (c) detail-only difference  ${plan.detailOnlyCount}   -> one article; supplier/date/category/brand/unit are not identity`)
  lines.push(`      refused (cost outlier)  ${plan.refusedCount}   -> a person must correct a figure first`)
  lines.push('')
  lines.push(`  would merge                 ${plan.runnablePairCount}`)
  lines.push(`  rows moved                  ${plan.movedRowTotal}`)
  lines.push(`  stock to decide             ${plan.stockToDecideTotal}`)
  lines.push('')

  const shown = plan.pairs.filter((pair) => !klass || pair.klass === klass)
  lines.push(klass ? `Pairs in class ${klass} (${shown.length}):` : `Pairs (${shown.length}):`)
  for (const pair of shown.slice(0, limit)) {
    lines.push(`  [${pair.klass}] #${pair.a.id} "${pair.a.name}" [${pair.a.barcode || '-'}]  <>  #${pair.b.id} [${pair.b.barcode || '-'}]`)
    lines.push(`       ${pair.reason}`)
    if (pair.detailsDiffer.length) {
      lines.push(`       details differing: ${pair.detailsDiffer.join(', ')} -- NOT identity`)
    }
    if (pair.batchReceivedDates.length || pair.batchSuppliers.length) {
      lines.push(`       batches carry received dates [${pair.batchReceivedDates.join(', ') || '-'}] and suppliers [${pair.batchSuppliers.join(', ') || '-'}] -- the survivor carries this union, each batch keeping its own`)
    }
    if (pair.refused) {
      lines.push(`       REFUSED ${pair.refused.field}: ${pair.refused.min} vs ${pair.refused.max} -- too far apart to be one cost`)
      continue
    }
    if (pair.klass === 'genuine_barcode') continue
    lines.push(`       keep #${pair.survivorId}, retire #${pair.discardedId}${pair.stockToDecide ? ` (${pair.stockToDecide} in stock -- the merge must be told: move it, or write it off)` : ''}`)
    for (const move of pair.moves) {
      const note = move.foldedNotRepointed ? ' (folded per branch/lot, not blindly re-pointed)'
        : (move.jsonIdList ? ' (the retired id rewritten inside the rule\'s JSON scope list)' : '')
      lines.push(`       ${move.rows} ${move.table}.${move.column}${note}`)
    }
  }
  if (shown.length > limit) lines.push(`  ... ${shown.length - limit} more (raise --limit, or use --json)`)

  lines.push('')
  lines.push('Residue -- rows the app\'s own repair path can no longer reach:')
  lines.push(`  inactive rows still carrying links   ${plan.residue.inactiveWithLinks.length}`)
  for (const row of plan.residue.inactiveWithLinks.slice(0, limit)) {
    lines.push(`    #${row.id} "${row.name}" [${row.barcode || '-'}] -- ${row.saleItems} sale items, ${row.movements} movements, ${row.batches} batches`)
  }
  if (plan.residue.inactiveWithLinks.length > limit) lines.push(`    ... ${plan.residue.inactiveWithLinks.length - limit} more`)
  lines.push(`  active rows with a CLEARED barcode   ${plan.residue.activeWithClearedBarcode.length}`)
  for (const row of plan.residue.activeWithClearedBarcode.slice(0, limit)) {
    lines.push(`    #${row.id} "${row.name}" -- ${row.saleItems} sale items, ${row.movements} movements`)
  }
  if (plan.residue.activeWithClearedBarcode.length > limit) lines.push(`    ... ${plan.residue.activeWithClearedBarcode.length - limit} more`)

  lines.push('')
  lines.push('Recovery:')
  for (const step of RECOVERY_STEPS) lines.push(`  - ${step}`)
  lines.push('')
  lines.push('This run applied NOTHING. Applying any of it to production is an owner')
  lines.push('decision and goes through the app\'s own reviewed merge endpoints.')
  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.db) {
    console.error('usage: node ops/scripts/migration/plan-group-child-identity.mjs --db <local-copy.sqlite> [--json out.json] [--class leading_zero|genuine_barcode|detail_only] [--limit N] [--rehearse]')
    process.exitCode = 2
    return
  }
  if (!fs.existsSync(args.db)) {
    console.error(`no such local copy: ${args.db}`)
    process.exitCode = 2
    return
  }
  const Database = cloudflareRequire('better-sqlite3')
  // readonly is the GUARANTEE, not the intention, and it is unconditional:
  // there is no mode of this script that writes, so even a mistaken UPDATE
  // typed into this file could not reach the copy it was pointed at.
  const db = new Database(args.db, { readonly: true, fileMustExist: true })
  const query = (sql, params) => db.prepare(sql).all(params || {})
  const plan = planGroupChildIdentity(query, loadProductDetailRule(), loadReparentTables())

  if (!args.rehearse) {
    db.close()
    console.log(formatPlan(plan, args.klass, args.limit))
    if (args.json) {
      fs.writeFileSync(args.json, `${JSON.stringify({ ...plan, recoverySteps: RECOVERY_STEPS }, null, 2)}\n`)
      console.log(`\nplan written to ${args.json}`)
    }
    return
  }

  // --rehearse: the counted dry run. It says exactly what it is, which is the
  // whole reason the flag was renamed -- it counts the four totals, builds the
  // plan against them, counts again, and asserts NOTHING moved. It is the
  // instrument that proves this script writes nothing, not a merge with the
  // merging left out.
  const before = readAssertionCounts(query)
  console.log('PRE :', JSON.stringify(before))
  console.log(`plan: ${plan.runnablePairCount} pairs would merge, moving ${plan.movedRowTotal} linked rows`)
  console.log('This script does not merge them. The merge that must run is the app\'s own')
  console.log('carry-all kernel (POST /api/products/possible-duplicates/merge), which records')
  console.log('an undoable action per pair; re-implementing it here would be a second copy of')
  console.log('the one rule this plan exists to respect. Drive that endpoint from the plan')
  console.log('against a LOCAL Worker, then re-run this rehearsal to check the deltas.')
  const after = readAssertionCounts(query)
  const problems = assertCounts(expectedCountsAfter(before, 0), after)
  console.log('POST:', JSON.stringify(after))
  console.log(problems.length ? `ASSERTION FAILURES:\n  ${problems.join('\n  ')}` : 'assertions OK -- PRE == POST, nothing was written')
  db.close()
  process.exitCode = problems.length ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main()
