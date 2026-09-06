// The DRY RUN itself, exercised: ops/scripts/migration/plan-leading-zero-twin-merges.mjs
// run against the REAL schema (full migration chain) with the production twin
// shapes seeded into it.
//
// A prepared production script nobody ever runs is a document, not a rehearsal.
// This runs its planner for real -- the same shipped fold, the same
// MERGE_REPARENT_TABLES walk the merge itself uses -- so the plan the owner
// would be shown is the plan this test reads.
//
// It also pins the two properties that make the plan safe to look at:
//   * it can only SELECT (the planner takes a query function, never a handle);
//   * it REFUSES a cost pair the app would refuse, instead of quietly listing
//     it as a merge to run.
//
// Run (from cloudflare/): node scripts/test-leading-zero-twin-plan-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`  PASS ${name}`) } catch (e) { failed += 1; console.error(`  FAIL ${name}`); console.error(e && e.message ? e.message : e) }
}

const SCRIPT = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'plan-leading-zero-twin-merges.mjs')

function seed() {
  const d1 = openDb(loadAll())
  const run = (sql) => d1.db.prepare(sql).run()
  run("INSERT INTO branches (id, name) VALUES (1, 'shop'), (2, 'warehouse')")
  run(`INSERT INTO products (id, name, barcode, cost_price_usd, stock_quantity, is_active, is_group) VALUES
    -- The owner's pair: one name, one code, one row carrying the extra zero.
    (100, 'Zero Twin', '3614274226546', 5, 4, 1, 0),
    (101, 'Zero Twin', '03614274226546', 7.9, 3, 1, 0),
    -- NEGATIVE CONTROL: same name, two genuinely different codes. Never a twin.
    (102, 'Real Two Skus', '1111111111111', 4, 0, 1, 0),
    (103, 'Real Two Skus', '2222222222222', 4, 0, 1, 0),
    -- NEGATIVE CONTROL: the same barcode twice is an exact duplicate, not this.
    (104, 'Exact Dup', '5555555555555', 4, 0, 1, 0),
    (105, 'Exact Dup', '5555555555555', 4, 0, 1, 0),
    -- NEGATIVE CONTROL: placeholder barcodes must never cluster.
    (106, 'Placeholder', '0', 1, 0, 1, 0),
    (107, 'Placeholder', '00', 1, 0, 1, 0),
    -- REFUSAL: a twin whose two costs cannot both be one product's cost.
    (108, 'Typo Twin', '7777777777777', 2, 0, 1, 0),
    (109, 'Typo Twin', '07777777777777', 200, 0, 1, 0),
    -- An inactive row is already merged away and must not be planned again.
    (110, 'Zero Twin', '003614274226546', 5, 0, 0, 0)`)
  // The links a merge has to carry, hung off the row that would be discarded.
  run("INSERT INTO sales (id, receipt_number, total_usd) VALUES (900, '20260906-000001', 10)")
  run('INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (900, 900, 101, 2)')
  run("INSERT INTO inventory_movements (id, product_id, branch_id, movement_type, quantity) VALUES (900, 101, 1, 'in', 3)")
  run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (101, 1, 3)')
  // The two links MERGE_REPARENT_TABLES structurally cannot hold, and which the
  // plan therefore used to leave out of its row count: a promotion rule whose
  // scope is a JSON id ARRAY in a TEXT column, and a child variant pointing at
  // the row that would be discarded.
  run(`INSERT INTO promotion_rules (id, title, rule_type, percent_off, scope_type, product_ids, is_active)
       VALUES (10, 'Twin 10%', 'percent_off', 10, 'products', '[101]', 1)`)
  // NEGATIVE CONTROL: a rule naming a different product must not be counted.
  run(`INSERT INTO promotion_rules (id, title, rule_type, percent_off, scope_type, product_ids, is_active)
       VALUES (11, 'Someone else', 'percent_off', 5, 'products', '[102]', 1)`)
  run(`INSERT INTO products (id, name, barcode, parent_id, is_active, is_group)
       VALUES (111, 'Zero Twin Small', '4444444444444', 101, 1, 0)`)
  return d1
}

// The REFUSAL that matters most: the planner is handed a function, so there is
// no handle it could write through even if a future edit tried to.
function readOnlyQuery(d1) {
  return (sql, params) => {
    assert.ok(/^\s*SELECT\b/i.test(sql.trim()), `the plan may only SELECT, got: ${sql.trim().slice(0, 60)}`)
    return d1.db.prepare(sql.replace(/@(\w+)/g, ':$1')).all(params || {})
  }
}

async function main() {
  console.log('test-leading-zero-twin-plan-pure')
  const mod = await import(`file://${SCRIPT.replace(/\\/g, '/')}`)

  check('the script exposes its planner and its recovery steps', () => {
    assert.equal(typeof mod.planLeadingZeroTwinMerges, 'function')
    assert.ok(Array.isArray(mod.RECOVERY_STEPS) && mod.RECOVERY_STEPS.length >= 4)
    assert.ok(mod.RECOVERY_STEPS.some((s) => /undo/i.test(s)), 'recovery must say how to reverse a run')
    assert.ok(mod.RECOVERY_STEPS.some((s) => /copy|backup/i.test(s)), 'and that a fresh copy is taken first')
  })

  check('it loads the SHIPPED rule, and proves the fold before using it', () => {
    const rule = mod.loadProductDetailRule()
    assert.equal(rule.identityBarcodeKey('03614274226546'), '3614274226546')
    assert.equal(rule.identityBarcodeKey('0'), '0')
    assert.notEqual(rule.identityBarcodeKey('0012'), rule.identityBarcodeKey('12'))
  })

  check('it walks the SAME reparent list the merge itself walks', () => {
    const tables = mod.loadReparentTables().map((t) => `${t.table}.${t.column}`)
    for (const key of ['sale_items.product_id', 'return_items.product_id', 'inventory_movements.product_id']) {
      assert.ok(tables.includes(key), `${key} must be counted by the plan`)
    }
    const appliers = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
    const listed = (appliers.slice(appliers.indexOf('export const MERGE_REPARENT_TABLES')).match(/table: '/g) || []).length
    assert.equal(tables.length, listed, 'the plan must count every table on the list, not a stale subset')
  })

  const d1 = seed()
  const plan = mod.planLeadingZeroTwinMerges(readOnlyQuery(d1), mod.loadProductDetailRule(), mod.loadReparentTables())

  check('DISCRIMINATING: the leading-zero twin is found, keeping the CLEAN spelling', () => {
    const pair = plan.pairs.find((p) => p.discarded.id === 101)
    assert.ok(pair, 'the twin pair must be planned')
    assert.equal(pair.keeper.id, 100, 'the row that sheds no zeros survives -- keeping the padded one puts the defect back')
    assert.equal(pair.keeper.barcode, '3614274226546')
  })

  check('the pair reports the rows it would move, table by table', () => {
    const pair = plan.pairs.find((p) => p.discarded.id === 101)
    const byTable = Object.fromEntries(pair.moves.map((m) => [m.table, m.rows]))
    assert.equal(byTable.sale_items, 1)
    assert.equal(byTable.inventory_movements, 1)
    assert.equal(byTable.branch_stock, 1)
    assert.ok(pair.moves.find((m) => m.table === 'branch_stock').foldedNotRepointed,
      'branch_stock is summed per branch by the fold, not re-pointed -- the plan must not imply otherwise')
    // DISCRIMINATING: pre-fix the plan walked MERGE_REPARENT_TABLES and the
    // three fold-handled tables and nothing else, so these two moves were
    // invisible and movedRows was 3 -- the owner was shown a smaller merge than
    // the one that would actually run.
    assert.equal(byTable.promotion_rules, 1, 'a discount scoped to the discarded row moves too, and must be counted')
    assert.ok(pair.moves.find((m) => m.table === 'promotion_rules').jsonIdList,
      'the plan must say this one is a JSON scope list, not a re-pointed FK')
    assert.equal(byTable.products, 1, 'a child variant rooted on the discarded row moves too')
    assert.equal(pair.movedRows, 5)
    assert.equal(pair.stockToDecide, 3, 'a stocked discard needs an answer before the merge can run')
  })

  check('NEGATIVE CONTROL: a promotion rule naming another product is not counted as a move', () => {
    const other = plan.pairs.find((p) => p.discarded.id === 109)
    assert.ok(!other.moves.some((m) => m.table === 'promotion_rules'),
      'rule 11 names product 102, so no pair may claim it would move')
  })

  check('the cost it would write is the mean of the distinct costs', () => {
    const pair = plan.pairs.find((p) => p.discarded.id === 101)
    assert.equal(pair.costBefore, 5)
    assert.equal(pair.costAfter, 6.45, '(5 + 7.9) / 2')
  })

  check('DISCRIMINATING: a cost pair too far apart is REFUSED, not listed as a merge', () => {
    const pair = plan.pairs.find((p) => p.discarded.id === 109)
    assert.ok(pair, 'the typo twin is still a pair the reviewer must see')
    assert.ok(pair.refused, '$2 and $200 cannot both be one product\'s cost')
    assert.equal(pair.refused.code, 'cost_outlier_review')
    assert.equal(plan.refusedPairCount, 1)
    assert.ok(!plan.pairs.filter((p) => !p.refused).some((p) => p.discarded.id === 109))
  })

  check('NEGATIVE CONTROLS: nothing but a leading-zero twin is planned', () => {
    const discarded = plan.pairs.map((p) => p.discarded.id).sort((a, b) => a - b)
    assert.deepEqual(discarded, [101, 109],
      `two genuinely different SKUs, an exact-barcode duplicate, the placeholder rows and the inactive row must all be left alone -- got ${discarded.join(',')}`)
  })

  check('the printed plan says plainly that nothing was applied', () => {
    const text = mod.formatPlan(plan)
    assert.ok(/DRY RUN, nothing was written/.test(text))
    assert.ok(/applied NOTHING/.test(text))
    assert.ok(/REFUSED/.test(text), 'a refused pair must be visible in the printed plan, not only in the JSON')
    assert.ok(/Recovery:/.test(text))
  })

  check('the script itself carries no apply path', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8')
    // Prose may NAME wrangler and the remote flag (the header explains what
    // this script deliberately is not); what it may not contain is a way to
    // reach either -- no writes, no process launcher, no network.
    for (const forbidden of [
      /\bUPDATE\s+products\b/i, /\bDELETE\s+FROM\b/i, /\bINSERT\s+INTO\b/i,
      /child_process/, /execSync|spawnSync|\bspawn\(/, /\bfetch\(/,
    ]) {
      assert.ok(!forbidden.test(source), `a prepared plan must not contain ${forbidden}`)
    }
    assert.ok(/readonly: true/.test(source), 'the local copy must be opened read-only')
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main()
