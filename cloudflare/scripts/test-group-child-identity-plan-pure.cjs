// The group-child identity sweep, exercised against the REAL schema:
// ops/scripts/migration/plan-group-child-identity.mjs run over the full
// migration chain with all three child-pair classes seeded into it.
//
// WHY THIS TEST IS SHAPED THE WAY IT IS.
//
// Run against the rig's local D1 copy, the sweep classifies 74 of 74 child
// pairs into ONE class (genuine_barcode). That may well be the truth about that
// catalog -- and it is also exactly what a broken classifier looks like. A
// sweep that answers every question the same way cannot be distinguished from
// an instrument stuck on one reading, and the distinguishing evidence must live
// in the sweep's OWN test, not in the write-up next to its output.
//
// So the fixture below is a POSITIVE CONTROL for all three classes at once: it
// seeds a pair that must come back leading_zero, a pair that must come back
// genuine_barcode, and a pair that must come back detail_only, and asserts all
// three. If the classifier collapses to a single answer -- which is the failure
// the 74/74 reading would otherwise hide -- two of those three assertions go
// red immediately.
//
// Every check is DISCRIMINATING. In particular:
//   * an implementation that consulted the DETAIL fields before the barcode
//     would call the genuine-barcode pair detail_only, and the ordering
//     assertion below names that inversion;
//   * an implementation comparing raw barcodes instead of the shipped fold
//     would call the leading-zero pair genuine_barcode;
//   * an implementation that folded '0'/'00' would merge the placeholder rows
//     238 production rows carry.
//
// Run (from cloudflare/): node scripts/test-group-child-identity-plan-pure.cjs
const assert = require('node:assert/strict')
const path = require('node:path')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let failed = 0
function check(name, fn) {
  try { fn(); console.log(`  PASS ${name}`) } catch (e) { failed += 1; console.error(`  FAIL ${name}`); console.error(e && e.message ? e.message : e) }
}

const SCRIPT = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'plan-group-child-identity.mjs')

function seed() {
  const d1 = openDb(loadAll())
  const run = (sql) => d1.db.prepare(sql).run()
  run("INSERT INTO branches (id, name) VALUES (1, 'shop'), (2, 'warehouse')")
  run(`INSERT INTO products (id, name, barcode, supplier, category, brand, unit, cost_price_usd, stock_quantity, is_active, is_group) VALUES
    -- (a) leading_zero: one article, two spellings of one code.
    (200, 'Zero Twin', '3614274226546', 'srey', 'lips', 'MAC', 'pcs', 5, 4, 1, 0),
    (201, 'Zero Twin', '03614274226546', 'srey', 'lips', 'MAC', 'pcs', 5.5, 3, 1, 0),
    -- (b) genuine_barcode: two real codes under one display name. KEEP SEPARATE.
    -- Their DETAILS also differ, which is the point: a classifier that asked
    -- the detail question first would call this pair detail_only and propose
    -- merging two genuinely different articles.
    (202, 'Real Two Skus', '1111111111111', 'kaka', 'face', 'CT', 'pcs', 4, 0, 1, 0),
    (203, 'Real Two Skus', '2222222222222', 'bong long', 'eyes', 'Dior', 'box', 4, 0, 1, 0),
    -- (c) detail_only: identical barcode, differing supplier/category/brand/unit.
    -- None of those is identity, so this is one article written down twice.
    (204, 'Detail Fork', '5555555555555', 'kaka', 'face', 'CT', 'pcs', 4, 2, 1, 0),
    (205, 'Detail Fork', '5555555555555', 'j secrat', 'skin', 'Charlotte', 'box', 4.4, 1, 1, 0),
    -- NEGATIVE CONTROL: the placeholder barcodes must stay two rows. '0' and
    -- '00' are NOT folded to blank or to each other.
    (206, 'Placeholder', '0', 'x', 'y', 'z', 'pcs', 1, 0, 1, 0),
    (207, 'Placeholder', '00', 'x', 'y', 'z', 'pcs', 1, 0, 1, 0),
    -- NEGATIVE CONTROL: a lone row in its own group is not a pair at all.
    (208, 'Only Child', '9999999999999', 'x', 'y', 'z', 'pcs', 1, 0, 1, 0),
    -- NEGATIVE CONTROL: an inactive row is already merged away and must not be
    -- paired again -- but it IS residue if it still carries links.
    (209, 'Zero Twin', '003614274226546', 'srey', 'lips', 'MAC', 'pcs', 5, 0, 0, 0)`)

  // Links hung off the rows a merge would have to carry.
  run("INSERT INTO sales (id, receipt_number, total_usd) VALUES (900, '20260906-000001', 10)")
  run('INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (900, 900, 201, 2)')
  run("INSERT INTO inventory_movements (id, product_id, branch_id, movement_type, quantity) VALUES (900, 201, 1, 'in', 3)")
  run('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (201, 1, 3)')

  // The residue the owner named: an INACTIVE row that still has a sale pointing
  // at it. Once deactivated it is out of the Conflicts sweep's reach (the sweep
  // reads active rows only), so it can never be repaired from the app.
  run('INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (901, 900, 209, 1)')
  // ...and an ACTIVE row whose barcode was cleared, still carrying sales.
  run(`INSERT INTO products (id, name, barcode, is_active, is_group, cost_price_usd, stock_quantity)
       VALUES (210, 'Cleared Barcode', '', 1, 0, 1, 0)`)
  run('INSERT INTO sale_items (id, sale_id, product_id, quantity) VALUES (902, 900, 210, 4)')

  // Batches on the detail-fork pair, each with its OWN received date and
  // supplier -- the facts class (c) claims a merge preserves.
  run(`INSERT INTO product_batches (id, variant_product_id, batch_key, received_at, supplier_name, is_active)
       VALUES (700, 204, 'b-204', '2025-03-04T00:00:00Z', 'kaka', 1),
              (701, 205, 'b-205', '2026-01-09T00:00:00Z', 'j secrat', 1)`)
  return d1
}

// The planner is handed a FUNCTION, never a handle, so there is no path through
// which it could write even if a future edit tried to.
function readOnlyQuery(d1) {
  return (sql, params) => {
    assert.ok(/^\s*SELECT\b/i.test(sql.trim()), `the sweep may only SELECT, got: ${sql.trim().slice(0, 60)}`)
    return d1.db.prepare(sql.replace(/@(\w+)/g, ':$1')).all(params || {})
  }
}

async function main() {
  console.log('test-group-child-identity-plan-pure')
  const mod = await import(`file://${SCRIPT.replace(/\\/g, '/')}`)

  check('the script exposes its planner, its classifier and its recovery steps', () => {
    assert.equal(typeof mod.planGroupChildIdentity, 'function')
    assert.equal(typeof mod.classifyChildPair, 'function')
    assert.equal(typeof mod.planOrphanedLinkResidue, 'function')
    assert.ok(Array.isArray(mod.RECOVERY_STEPS) && mod.RECOVERY_STEPS.length >= 4)
    assert.ok(mod.RECOVERY_STEPS.some((s) => /copy|backup/i.test(s)), 'recovery must say a fresh copy is taken first')
    assert.ok(mod.RECOVERY_STEPS.some((s) => /roll|transaction/i.test(s)), 'and that a failed apply rolls back')
    assert.ok(mod.RECOVERY_STEPS.some((s) => /production|owner/i.test(s)), 'and that production is an owner decision')
  })

  check('received_date is NOT a product-row detail field -- it lives on the batch', () => {
    // Not pedantry: there is no products.received_date column, so a sweep that
    // listed it would not run at all, and the reason it is absent is the reason
    // class (c) is safe -- a received date is a batch fact that a merge carries
    // intact rather than a row fact a merge would have to choose between.
    assert.ok(!mod.DETAIL_FIELDS.includes('received_date'))
    for (const field of ['supplier', 'category', 'brand', 'unit']) {
      assert.ok(mod.DETAIL_FIELDS.includes(field), `${field} must be listed as a non-identity detail`)
    }
  })

  const rule = mod.loadProductDetailRule()

  // ---- THE POSITIVE CONTROL: all three classes, from the pure classifier ----
  check('POSITIVE CONTROL: the classifier produces all three classes, not one', () => {
    const leading = mod.classifyChildPair(
      { barcode: '3614274226546', supplier: 'a' }, { barcode: '03614274226546', supplier: 'a' }, rule.identityBarcodeKey)
    const genuine = mod.classifyChildPair(
      { barcode: '1111111111111', supplier: 'a' }, { barcode: '2222222222222', supplier: 'a' }, rule.identityBarcodeKey)
    const detail = mod.classifyChildPair(
      { barcode: '5555555555555', supplier: 'a' }, { barcode: '5555555555555', supplier: 'b' }, rule.identityBarcodeKey)
    assert.equal(leading.klass, 'leading_zero')
    assert.equal(genuine.klass, 'genuine_barcode')
    assert.equal(detail.klass, 'detail_only')
    // Three distinct answers from three inputs -- the property that makes a
    // 74-of-74 reading on a real catalog believable rather than suspicious.
    assert.equal(new Set([leading.klass, genuine.klass, detail.klass]).size, 3)
  })

  check('DISCRIMINATING: the barcode question is asked BEFORE the detail question', () => {
    // A genuinely different barcode settles the pair on its own, however far
    // apart the details are. Reversing the order proposes merging two real
    // articles because their suppliers happened to match, or refuses to merge a
    // true twin because its category was typed differently.
    const differentEverything = mod.classifyChildPair(
      { barcode: '1111111111111', supplier: 'a', category: 'a', brand: 'a', unit: 'a' },
      { barcode: '2222222222222', supplier: 'b', category: 'b', brand: 'b', unit: 'b' },
      rule.identityBarcodeKey,
    )
    assert.equal(differentEverything.klass, 'genuine_barcode', 'a real barcode difference is never overridden by details')
    const sameBarcodeDifferentEverything = mod.classifyChildPair(
      { barcode: '5555555555555', supplier: 'a', category: 'a', brand: 'a', unit: 'a' },
      { barcode: '5555555555555', supplier: 'b', category: 'b', brand: 'b', unit: 'b' },
      rule.identityBarcodeKey,
    )
    assert.equal(sameBarcodeDifferentEverything.klass, 'detail_only')
    assert.deepEqual(sameBarcodeDifferentEverything.detailsDiffer, ['supplier', 'category', 'brand', 'unit'])
  })

  check('DISCRIMINATING: the placeholder barcodes are a genuine difference, never a twin', () => {
    // 238 production rows carry '0'. Folding it would propose merging every one
    // of them into a single row.
    assert.equal(mod.classifyChildPair({ barcode: '0' }, { barcode: '00' }, rule.identityBarcodeKey).klass, 'genuine_barcode')
    assert.equal(mod.classifyChildPair({ barcode: '0' }, { barcode: '' }, rule.identityBarcodeKey).klass, 'genuine_barcode')
    // ...and an alphanumeric SKU keeps its zeros: a leading zero there is not a
    // GTIN artefact.
    assert.equal(mod.classifyChildPair({ barcode: '0ab12' }, { barcode: 'ab12' }, rule.identityBarcodeKey).klass, 'genuine_barcode')
  })

  const d1 = seed()
  const plan = mod.planGroupChildIdentity(readOnlyQuery(d1), rule, mod.loadReparentTables())

  check('the sweep walks every group and every child PAIR in it', () => {
    assert.equal(plan.groupsWithChildren, 4, 'Zero Twin, Real Two Skus, Detail Fork, Placeholder')
    assert.equal(plan.pairCount, 4, 'one pair per two-child group; the lone child is not a pair')
    assert.equal(plan.leadingZeroCount, 1)
    assert.equal(plan.genuineBarcodeCount, 2, 'the two-SKU pair AND the placeholder pair')
    assert.equal(plan.detailOnlyCount, 1)
    // The inactive row must not be paired with its live twin.
    assert.ok(!plan.pairs.some((p) => p.a.id === 209 || p.b.id === 209), 'an inactive row is already merged away')
  })

  check('DISCRIMINATING: the leading-zero pair keeps the CLEAN spelling and counts its links', () => {
    const pair = plan.pairs.find((p) => p.klass === 'leading_zero')
    assert.equal(pair.survivorId, 200, 'the row shedding no zeros survives -- keeping the padded one puts the defect back')
    assert.equal(pair.discardedId, 201)
    const byTable = Object.fromEntries(pair.moves.map((m) => [m.table, m.rows]))
    assert.equal(byTable.sale_items, 1, 'the discarded row\'s sale must be counted as work the merge does')
    assert.equal(byTable.inventory_movements, 1)
    assert.equal(pair.stockToDecide, 3, 'stock on the discarded row is a decision, never a default')
  })

  check('a genuine-barcode pair proposes NOTHING -- no survivor, no moves', () => {
    for (const pair of plan.pairs.filter((p) => p.klass === 'genuine_barcode')) {
      assert.equal(pair.survivorId, null, 'keep separate means keep separate -- no keeper is chosen')
      assert.equal(pair.discardedId, null)
      assert.equal(pair.movedRows, 0)
    }
    assert.equal(plan.runnablePairCount, 2, 'only the leading-zero and detail-only pairs are merges')
  })

  check('the detail-only pair reports the batch dates and suppliers it would carry', () => {
    const pair = plan.pairs.find((p) => p.klass === 'detail_only')
    assert.deepEqual(pair.detailsDiffer, ['supplier', 'category', 'brand', 'unit'])
    // The claim "the survivor carries the union of the batches, each keeping
    // its own received date and supplier", stated as data rather than prose.
    assert.deepEqual(pair.batchReceivedDates, ['2025-03-04', '2026-01-09'])
    assert.deepEqual(pair.batchSuppliers, ['j secrat', 'kaka'])
  })

  check('DISCRIMINATING: the residue nobody can reach from the app is named', () => {
    const inactive = plan.residue.inactiveWithLinks.find((row) => row.id === 209)
    assert.ok(inactive, 'an INACTIVE row still carrying a sale is exactly the migration 0109 residue')
    assert.equal(inactive.saleItems, 1)
    const cleared = plan.residue.activeWithClearedBarcode.find((row) => row.id === 210)
    assert.ok(cleared, 'an active row whose barcode was CLEARED still has sales rung under the old code')
    assert.equal(cleared.saleItems, 1)
    // NEGATIVE CONTROL: a healthy row with no links is not residue.
    assert.ok(!plan.residue.activeWithClearedBarcode.some((row) => row.id === 208))
    assert.ok(!plan.residue.inactiveWithLinks.some((row) => row.id === 200))
  })

  check('the pre/post assertions refuse a run that moved a link anywhere', () => {
    const before = { activeProducts: 100, saleItemsLinked: 50, movementsLinked: 20, batches: 10 }
    // A clean two-pair run: two rows retired, every LINK count unchanged --
    // a merge re-points links, it never creates or destroys them.
    assert.deepEqual(
      mod.assertCounts(mod.expectedCountsAfter(before, 2), { activeProducts: 98, saleItemsLinked: 50, movementsLinked: 20, batches: 10 }),
      [],
    )
    // A run that lost a sale item must abort, not report success.
    assert.equal(
      mod.assertCounts(mod.expectedCountsAfter(before, 2), { activeProducts: 98, saleItemsLinked: 49, movementsLinked: 20, batches: 10 }).length,
      1,
      'a dropped sale link must fail the post-assertion',
    )
    // ...and so must a run that retired the wrong number of rows.
    assert.equal(
      mod.assertCounts(mod.expectedCountsAfter(before, 2), { activeProducts: 97, saleItemsLinked: 50, movementsLinked: 20, batches: 10 }).length,
      1,
    )
  })

  // The reachability check has to look for CODE, not for the word. Scanning
  // the source text for /wrangler/ fails on this very script, whose recovery
  // note SAYS "no wrangler import" -- an instrument that cannot tell prose from
  // a call reports a path to production that does not exist, and would equally
  // miss one spelled require('wran' + 'gler'). So the patterns below are
  // executable constructs, and a POSITIVE CONTROL runs each of them against a
  // synthetic line that really does contain one: a check that never fires is
  // indistinguishable from a check that cannot fire.
  const PRODUCTION_REACH = [
    { name: 'a wrangler import', re: /(?:require|import)\s*\(\s*['"][^'"]*wrangler/, control: "const w = require('wrangler')" },
    { name: 'a shelled-out command', re: /child_process|execSync|spawnSync/, control: "require('child_process').execSync('x')" },
    { name: 'a network call', re: /\bfetch\s*\(|node:https?\b|new WebSocket/, control: "await fetch('https://api.cloudflare.com')" },
    { name: 'a d1 execute', re: /d1\s+execute/, control: "wrangler d1 execute DB --remote --command 'x'" },
    { name: 'a --remote argument being passed on', re: /push\(\s*'--remote'|args\.remote\s*=\s*true/, control: "argv.push('--remote')" },
  ]

  check('POSITIVE CONTROL: every production-reach pattern fires on a real one', () => {
    for (const probe of PRODUCTION_REACH) {
      assert.match(
        probe.control, probe.re,
        `the pattern for ${probe.name} does not match its own control -- it could never have caught anything`,
      )
    }
  })

  check('the sweep has no executable path to production, and refuses --remote loudly', () => {
    const source = require('node:fs').readFileSync(SCRIPT, 'utf8')
    for (const probe of PRODUCTION_REACH) {
      assert.doesNotMatch(source, probe.re, `the sweep must not contain ${probe.name}`)
    }
    assert.match(source, /--remote is not a flag this script has/, 'a --remote argument must be rejected, not ignored')
    assert.match(source, /readonly: !args\.apply/, 'list mode must open the file readonly')
    // The only modules it may pull in, named rather than implied -- so a future
    // edit that reaches for a client library is a red test, not a discovery.
    const required = [...source.matchAll(/cloudflareRequire\('([^']+)'\)/g)].map(([, name]) => name)
    assert.deepEqual(
      [...new Set(required)].sort(), ['better-sqlite3', 'typescript'],
      'the sweep may load only the sqlite driver and the transpiler it reads the shipped rule with',
    )
  })

  console.log(failed ? `test-group-child-identity-plan-pure: ${failed} FAILED` : 'test-group-child-identity-plan-pure: all checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
