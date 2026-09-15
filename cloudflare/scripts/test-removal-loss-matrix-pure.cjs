// p5/losses -- the LOSS RULE MATRIX, one place, one test.
//
// Owner, Sep 15 2026: "there is issue with the product loss (removed
// stock)...if it is removed not restock it is loss. if it is removed but
// restock as damage or other tags it does not... all should be accounted
// for, returns etc... be consistent."
//
// This test is the enumeration of EVERY stock-outflow movement type this
// codebase knows -- lib/stockLedgerQuery.ts's LEDGER_OUT_TYPES plus the two
// outflow types that list deliberately leaves out (see its own comment) --
// classified against the owner's rule, and pinned to lib/removalLosses.ts's
// REMOVAL_LOSS_MOVEMENT_TYPES so the two can never drift apart silently. A
// new outflow type landing in LEDGER_OUT_TYPES without an entry here fails
// this test loudly instead of silently going unclassified.
//
// Run (from cloudflare/): node scripts/test-removal-loss-matrix-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.join(__dirname, '..')

function load(file) {
  const filePath = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)(require, m, m.exports)
  return m.exports
}

function source(relPath) {
  return fs.readFileSync(path.join(root, 'src', relPath), 'utf8')
}

const removalLosses = load(path.join('lib', 'removalLosses.ts'))

// stockLedgerQuery.ts pulls in businessDateWindow.ts and other relative
// imports this pure harness has no reason to stub -- removalLosses.ts is
// deliberately import-free for exactly this kind of standalone load, but
// LEDGER_OUT_TYPES is not, so it is read off the source text with the same
// regex shape test-removal-losses-pure.cjs already uses for
// DATED_STOCK_COUNT_REASON, rather than pulling in a second module loader.
function readLedgerOutTypes() {
  const text = source(path.join('lib', 'stockLedgerQuery.ts'))
  const match = text.match(/export const LEDGER_OUT_TYPES = \[([\s\S]*?)\] as const/)
  assert.ok(match, 'stockLedgerQuery.ts still declares LEDGER_OUT_TYPES as a bracketed const array')
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
}
const LEDGER_OUT_TYPES = readLedgerOutTypes()

let checks = 0
function ok(label) { checks += 1; console.log(`PASS ${label}`) }

// ---------------------------------------------------------------------------
// The matrix. Every LEDGER_OUT_TYPES entry, plus 'delete' and 'adjustment'
// (real outflow-shaped movements the ledger's 2-column In/Out split
// classifies as "In" for reasons unrelated to loss accounting -- see
// stockLedgerQuery.ts's own comment above LEDGER_OUT_TYPES -- but which
// removalLosses.ts still has to take a position on).
//
//   verdict: 'loss' | 'not-loss' | 'excluded-by-reason'
//   writer:  file:function the row actually comes from
//   costed:  'write-time' (the writer itself stamps unit_cost_usd/
//            total_cost_usd), 'read-time' (relies on removalLosses.ts's
//            fallback chain -- lot / product / product's other lot / a
//            same-name twin's lot), or 'n/a' (not a loss, cost irrelevant)
// ---------------------------------------------------------------------------
const MATRIX = {
  remove: {
    verdict: 'loss',
    writer: 'routes/inventory.ts (stock-change remove action)',
    costed: 'write-time',
    note: 'resolveMovementCostSnapshot stamps unit/total cost at write time; ' +
      'the read-time chain is the safety net for legacy/unmarked rows.',
  },
  write_off: {
    verdict: 'loss',
    writer: 'damagedLotActions.ts planDisposeTagged (DISPOSE); productDelete.ts (product delete draining held/sellable stock)',
    costed: 'write-time+read-time',
    note: 'DISPOSE stamps its own lot cost via resolveMovementCostSnapshot; ' +
      'productDelete stamps the lot\'s own unit_cost_usd where the lot has ' +
      'one and otherwise leaves it at the column default, relying on the ' +
      'read-time chain (product cost, then the same-name-twin fallback).',
  },
  delete: {
    verdict: 'loss',
    writer: 'bulkDeleteEngine.ts (bulk product delete)',
    costed: 'write-time',
    note: 'p5/losses (Sep 15 2026): folded into the loss set -- draining ' +
      'stock via a bulk delete destroys it exactly as finally as a single ' +
      'delete\'s write_off. Its own SQL already computes a cost (product ' +
      'cost_price_usd, else a weighted average of the branch\'s costed ' +
      'lots) at write time; the read-time chain still covers a product ' +
      'that has neither.',
  },
  sale: {
    verdict: 'not-loss',
    writer: 'routes/sales.ts',
    costed: 'n/a',
    note: 'revenue was recognized for it.',
  },
  supplier_return: {
    verdict: 'not-loss',
    writer: 'routes/returns.ts (supplier return)',
    costed: 'n/a',
    note: 'goes back to the supplier, against the supplier balance -- not destroyed.',
  },
  return_reversal: {
    verdict: 'not-loss',
    writer: 'routes/returns.ts (return reversal)',
    costed: 'n/a',
    note: 'tied to a return record and reversed from there.',
  },
  transfer_out: {
    verdict: 'not-loss',
    writer: 'routes/branches.ts / transferOperation.ts',
    costed: 'n/a',
    note: 'the stock is still ours, at another branch.',
  },
  row_move_out: {
    verdict: 'not-loss',
    writer: '(legacy row-move type; no current writer, kept in LEDGER_OUT_TYPES for historical rows)',
    costed: 'n/a',
    note: 'the stock is still ours, moved between rows of the same catalog entry.',
  },
  move_out: {
    verdict: 'not-loss',
    writer: 'routes/inventory.ts (row-move quantities action)',
    costed: 'n/a',
    note: 'the stock is still ours, at another row/branch.',
  },
  damage_out: {
    verdict: 'not-loss',
    writer: 'stockCondition.ts TAGGED_HOLD_MOVEMENT_TYPE (tag as damaged/other -- a HOLD, not destroyed); routes/sales.ts (POS drawing from a damaged lot -- a SALE)',
    costed: 'n/a',
    note: 'a tagged hold keeps the units owned; a POS draw recognizes revenue. ' +
      'Neither destroys value -- this is the owner\'s "restock as damaged ' +
      'or other tags... does not [count]" half of the ruling.',
  },
  replacement_out: {
    verdict: 'not-loss',
    writer: 'returnsStock.ts REPLACEMENT_OUT_MOVEMENT',
    costed: 'n/a',
    note: 'tied to a return\'s replacement item, reversed from there.',
  },
  out: {
    verdict: 'not-loss',
    writer: 'importEngine.ts classifyInventory (inventory CSV import remove)',
    costed: 'n/a',
    note: 'a data correction to the recorded quantity, not a business event.',
  },
  adjustment: {
    verdict: 'excluded-by-type',
    writer: 'routes/products.ts writeOffStock (duplicate-product merge cleanup)',
    costed: 'n/a',
    note: 'a NEGATIVE-quantity row folding a phantom duplicate catalog row ' +
      'into its survivor, not destroyed goods. Excluded twice over: wrong ' +
      'type, and removalLossMovementWhere\'s `quantity > 0` guard.',
  },
}

// The reason-based exclusion (orthogonal to the type-based matrix above):
// a 'remove' movement whose reason is the dated stock count import's marker
// is a reconciliation to a physical count, not a destroyed-goods event.
const RECONCILIATION_REMOVE = {
  writer: 'datedStockCountApply.ts (via datedStockCountImport.ts DATED_STOCK_COUNT_REASON)',
  reason: 'Dated stock count import',
}

// ---------------------------------------------------------------------------
// 1. Every LEDGER_OUT_TYPES entry has a matrix verdict -- fails loudly if a
//    new outflow type lands without a ruling.
// ---------------------------------------------------------------------------
{
  for (const type of LEDGER_OUT_TYPES) {
    assert.ok(MATRIX[type], `LEDGER_OUT_TYPES type "${type}" has no matrix entry -- classify it before shipping`)
  }
  ok('every ledger OUT type is classified in the matrix')
}

// ---------------------------------------------------------------------------
// 2. removalLosses.ts's REMOVAL_LOSS_MOVEMENT_TYPES is EXACTLY the matrix's
//    'loss' subset -- not a superset, not a subset.
// ---------------------------------------------------------------------------
{
  const lossTypesInMatrix = Object.entries(MATRIX)
    .filter(([, entry]) => entry.verdict === 'loss')
    .map(([type]) => type)
    .sort()
  const actual = [...removalLosses.REMOVAL_LOSS_MOVEMENT_TYPES].sort()
  assert.deepEqual(actual, lossTypesInMatrix,
    `REMOVAL_LOSS_MOVEMENT_TYPES ${JSON.stringify(actual)} must equal the matrix's loss set ${JSON.stringify(lossTypesInMatrix)}`)
  ok('REMOVAL_LOSS_MOVEMENT_TYPES matches the matrix\'s loss verdicts exactly')
}

// ---------------------------------------------------------------------------
// 3. Every 'not-loss' and 'excluded-by-type' type is NOT in the loss set.
// ---------------------------------------------------------------------------
{
  for (const [type, entry] of Object.entries(MATRIX)) {
    if (entry.verdict === 'loss') continue
    assert.equal(removalLosses.REMOVAL_LOSS_MOVEMENT_TYPES.includes(type), false,
      `"${type}" is classified "${entry.verdict}" and must not be a removal loss`)
  }
  ok('every non-loss verdict is honored by REMOVAL_LOSS_MOVEMENT_TYPES')
}

// ---------------------------------------------------------------------------
// 4. The reconciliation-remove reason exclusion is wired and byte-identical
//    to its source constant (same assertion shape as
//    test-removal-losses-pure.cjs section 7, repeated here so the matrix
//    test is a complete, standalone statement of the rule).
// ---------------------------------------------------------------------------
{
  const datedSource = source(path.join('lib', 'datedStockCountImport.ts'))
  const match = datedSource.match(/DATED_STOCK_COUNT_REASON\s*=\s*'([^']+)'/)
  assert.ok(match, 'datedStockCountImport.ts still declares DATED_STOCK_COUNT_REASON')
  assert.equal(match[1], RECONCILIATION_REMOVE.reason)
  assert.ok(removalLosses.REMOVAL_LOSS_EXCLUDED_REASONS.includes(match[1]),
    'the excluded-reason set carries the dated stock count import marker')
  ok('a dated stock count "remove" is excluded by reason, not by type -- pinned against its source')
}

// ---------------------------------------------------------------------------
// 5. Every loss-bearing writer's own source stamps unit_cost_usd/
//    total_cost_usd in the same INSERT it writes the movement row from (or
//    is explicitly documented here as relying on the read-time chain because
//    its own lot may legitimately be uncosted) -- so a change that quietly
//    drops the cost columns from a loss-bearing writer's INSERT is caught
//    even though test-removal-losses-pure.cjs only exercises the SQL chain
//    reading rows that already exist.
// ---------------------------------------------------------------------------
{
  const writerChecks = [
    { type: 'remove', file: path.join('routes', 'inventory.ts'), pattern: /removeMovementCost\s*=\s*resolveMovementCostSnapshot/ },
    { type: 'write_off (DISPOSE)', file: path.join('lib', 'damagedLotActions.ts'), pattern: /resolveMovementCostSnapshot/ },
    { type: 'write_off (productDelete)', file: path.join('lib', 'productDelete.ts'), pattern: /unit_cost_usd[\s\S]{0,400}total_cost_usd/ },
    { type: 'delete (bulkDeleteEngine)', file: path.join('lib', 'bulkDeleteEngine.ts'), pattern: /unit_cost_usd,\s*unit_cost_khr,\s*total_cost_usd,\s*total_cost_khr/ },
  ]
  for (const check of writerChecks) {
    const text = source(check.file)
    assert.ok(check.pattern.test(text), `${check.file} no longer appears to stamp a cost snapshot for "${check.type}" -- if this is intentional, the read-time fallback chain must cover it and this test's writerChecks entry must be updated deliberately`)
  }
  ok('every loss-bearing writer\'s own source still stamps (or documents deferring to) a cost snapshot')
}

console.log(`\nOK - ${checks} checks passed`)
