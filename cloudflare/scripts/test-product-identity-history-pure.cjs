// N34 / lane "linkover", item 2 -- "a merge can be inspected".
//
// The owner's ruling has two halves. Conflicts must let a pair kept separate be
// merged LATER, and a merge that already happened must stay inspectable. The
// first half was reachable; the second had nothing behind it. Once two rows are
// folded, Conflicts shows nothing about them -- it lists what is still
// outstanding -- so "was this row merged, and from what?" had no answer on any
// screen.
//
// THE CHOICE THIS TEST EXISTS TO PIN is where that answer is read from. A merge
// writes three records: an audit_logs row, an action_history row, and an
// undo_snapshots row. audit_logs is PURGED on a retention window (21 days by
// default, settable lower from Settings), so a history backed by it would show
// a fold for three weeks and then quietly stop -- worse than not offering it,
// because "no merges" and "the merge aged out" would look identical. Nothing in
// the Worker purges undo_snapshots: it is the record kept for as long as the
// undo it describes.
//
// Every check below is DISCRIMINATING. On 6e3abfea readProductIdentityHistory
// does not exist, so the first check cannot pass at all; and each of the others
// names a specific wrong implementation:
//   * one backed by the audit log (check: a fold with NO audit row is still
//     found),
//   * one reading only 'product.merge' (check: a fold recorded by the BULK
//     path is found too -- and bulk is the path that folds the most rows),
//   * one matching the product id against either end of the fold (check:
//     mergedFrom and mergedInto are opposite answers for the two ids),
//   * one that hides an undone merge (check: it is reported, flagged reversed,
//     because "undone" and "never happened" are different facts).
//
// Run (from cloudflare/): node scripts/test-product-identity-history-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`  PASS ${name}`) } catch (e) { failed += 1; console.error(`  FAIL ${name}`); console.error(e && e.message ? e.message : e) }
}

function loadTs(relPath, stubs) {
  const abs = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(abs),
  })
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      mod.exports, require, mod, abs, path.dirname(abs),
    )
  } finally {
    Module._load = original
  }
  return mod.exports
}

function dbAdapter(d1) {
  return {
    prepare(sql) {
      const st = d1.prepare(sql)
      return {
        get: (p) => st.get(p == null ? {} : p),
        all: (p) => st.all(p == null ? {} : p),
        run: (p) => {
          const r = st.run(p == null ? {} : p)
          return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (stmts) => d1.batch(stmts),
  }
}

// The reversal shape recordMergeUndoSnapshot actually stores, trimmed to the
// four fields this reader looks at. Written as a helper so a drift in those
// names shows up once, here, rather than in five string literals.
const reversal = (keeperId, keeperName, dupId, dupName) => ({
  keeperId, keeperName, dupId, dupName,
  // The rest of a real reversal, present so the parse is exercised against a
  // payload of realistic size rather than a four-key object.
  branchStock: [], reparentedSaleItemIds: [1, 2, 3], batches: [], mergedStateFingerprint: 'x',
})

function seed() {
  const d1 = openDb(loadAll())
  const run = (sql, params) => d1.db.prepare(sql).run(params || {})
  run("INSERT INTO branches (id, name) VALUES (1, 'shop')")
  run(`INSERT INTO products (id, name, barcode, is_active, is_group, cost_price_usd, stock_quantity) VALUES
    (10, 'Survivor', '5555555555555', 1, 0, 4, 3),
    (11, 'Folded Twin', '05555555555555', 0, 0, 4, 0),
    (12, 'Bulk Folded Twin', '005555555555555', 0, 0, 4, 0),
    (13, 'Undone Twin', '0005555555555555', 1, 0, 4, 0),
    (20, 'Unrelated Row', '7777777777777', 1, 0, 1, 0)`)

  const snap = (kind, status, payload, name) => run(
    `INSERT INTO undo_snapshots (kind, status, payload_json, created_by_id, created_by_name)
     VALUES (@kind, @status, @payload, 1, @name)`,
    { kind, status, payload: JSON.stringify(payload), name },
  )

  // 1. A single fold, with NO audit_logs row anywhere. This is the retention
  //    case: an audit-backed reader finds nothing here.
  snap('product.merge', 'applied', reversal(10, 'Survivor', 11, 'Folded Twin'), 'sethy')
  // 2. A fold recorded by the WHOLE-CATALOG path, whose payload is an ARRAY.
  //    A reader that queried only 'product.merge' misses every one of these.
  snap('product.merge.bulk', 'applied', {
    reversals: [
      reversal(10, 'Survivor', 12, 'Bulk Folded Twin'),
      // ...alongside a fold onto a DIFFERENT keeper in the same run, which
      // must not leak into this row's history.
      reversal(20, 'Unrelated Row', 99, 'Someone Else'),
    ],
    mergedStateFingerprint: 'y',
  }, 'lin')
  // 3. A fold that was UNDONE. Reported, flagged, not hidden.
  snap('product.merge', 'reversed', reversal(10, 'Survivor', 13, 'Undone Twin'), 'sethy')
  // 4. NEGATIVE CONTROL: another snapshot kind entirely, carrying ids that
  //    would match if the reader filtered on the payload rather than the kind.
  snap('supplier.backfill', 'applied', { keeperId: 10, dupId: 11, lots: [{ id: 1 }] }, 'sethy')
  // 5. NEGATIVE CONTROL: an unparseable payload must be skipped, not thrown on.
  run(
    `INSERT INTO undo_snapshots (kind, status, payload_json, created_by_name) VALUES ('product.merge', 'applied', @p, 'sethy')`,
    { p: '{not json' },
  )

  // The keep-separate decisions the guard records, on the survivor row.
  run(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
     VALUES (1, 'sethy', 'identity_keep_separate', 'product', 10, @details)`,
    { details: JSON.stringify({ keptSeparateFrom: [20], path: 'edit', dismissalsRetired: 2 }) },
  )
  // NEGATIVE CONTROL: a decision on another row, and another action on this one.
  run(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
     VALUES (1, 'sethy', 'identity_keep_separate', 'product', 20, @details)`,
    { details: JSON.stringify({ keptSeparateFrom: [10], path: 'create' }) },
  )
  run(
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
     VALUES (1, 'sethy', 'update', 'product', 10, '{}')`,
  )
  return d1
}

async function main() {
  console.log('test-product-identity-history-pure')
  // The real rule modules, transpiled -- never stubbed. A history reader that
  // was handed a fake fold would prove nothing about the shipped one.
  const identity = loadTs(path.join('lib', 'productIdentity.ts'), {
    './db': {},
    './sqlBinding': loadTs(path.join('lib', 'sqlBinding.ts'), {}),
    './productDetailRule': loadTs(path.join('lib', 'productDetailRule.ts'), {}),
  })

  await check('the reader exists and is exported from the identity module', () => {
    assert.equal(
      typeof identity.readProductIdentityHistory, 'function',
      'without this there is no answer anywhere to "was this row merged, and from what?"',
    )
  })

  const db = dbAdapter(seed())
  const history = await identity.readProductIdentityHistory(db, 10)

  await check('DISCRIMINATING: a fold with no audit row is still found -- the history outlives retention', () => {
    const single = history.mergedFrom.find((fold) => fold.fromId === 11)
    assert.ok(single, 'an audit-backed reader finds nothing here, and would show "never merged" three weeks after every fold')
    assert.equal(single.fromName, 'Folded Twin')
    assert.equal(single.intoId, 10)
    assert.equal(single.source, 'merge')
    assert.equal(single.reversed, false)
    assert.equal(single.by, 'sethy')
  })

  await check('DISCRIMINATING: a fold recorded by the BULK path is found too', () => {
    const bulk = history.mergedFrom.find((fold) => fold.fromId === 12)
    assert.ok(bulk, 'a reader querying only kind = product.merge misses every whole-catalog fold -- the path that folds the most rows')
    assert.equal(bulk.source, 'bulk_merge')
    assert.equal(bulk.fromName, 'Bulk Folded Twin')
    // ...and the OTHER fold in that same run, onto a different keeper, does not
    // leak in. A reader that took the whole array once it matched the snapshot
    // would report a row that was never folded into this one.
    assert.ok(!history.mergedFrom.some((fold) => fold.fromId === 99), 'a fold onto another keeper in the same bulk run is not this row\'s history')
  })

  await check('DISCRIMINATING: an undone merge is reported AND flagged, never hidden', () => {
    const undone = history.mergedFrom.find((fold) => fold.fromId === 13)
    assert.ok(undone, '"undone" and "never happened" are different facts and must not render the same')
    assert.equal(undone.reversed, true)
  })

  await check('NEGATIVE CONTROLS: another snapshot kind, and an unparseable payload, contribute nothing', () => {
    // supplier.backfill carries keeperId 10 / dupId 11 in its payload, so a
    // reader that filtered on the payload instead of the kind would double-count
    // the first fold.
    assert.equal(
      history.mergedFrom.filter((fold) => fold.fromId === 11).length, 1,
      'a non-merge snapshot must never be read as a merge',
    )
    assert.equal(history.mergedFrom.length, 3, 'exactly the three real folds; the broken payload is skipped, not thrown on')
  })

  await check('DISCRIMINATING: mergedFrom and mergedInto are opposite answers, not the same match', () => {
    assert.equal(history.mergedInto, null, 'the survivor was not itself folded away')
    // The retired row must see the mirror image. A reader that matched the id
    // against either end of the fold would report the SAME fold in both lists
    // for both rows, which reads as "this row was merged into the row that was
    // merged into it".
    return identity.readProductIdentityHistory(db, 11).then((retired) => {
      assert.deepEqual(retired.mergedFrom, [], 'nothing was folded into the retired row')
      assert.ok(retired.mergedInto, 'the retired row must be able to say where it went')
      assert.equal(retired.mergedInto.intoId, 10)
      assert.equal(retired.mergedInto.intoName, 'Survivor')
    })
  })

  await check('the keep-separate decisions are this row\'s only, and are kept in their own list', () => {
    // TWO failures land on this one number, and they look identical from the
    // outside. audit_logs.entity_id is TEXT while audit() binds a NUMBER into
    // it, so a plain `entity_id = @id` with a numeric bind matches nothing at
    // all -- an empty list that reads exactly like "no decision was ever
    // taken". And a reader that dropped the action/entity filters would pick up
    // another row's decision and an unrelated update on this one. Both are
    // caught here, and both were live: this check failed on the first run.
    assert.equal(
      history.keptSeparate.length, 1,
      'either the TEXT/INTEGER compare on entity_id matched nothing, or another row\'s decision leaked in',
    )
    assert.deepEqual(history.keptSeparate[0].keptSeparateFrom, [20])
    assert.equal(history.keptSeparate[0].path, 'edit')
    // Separate from mergedFrom on purpose: these come from audit_logs and are
    // retention-bound, so an empty list here does NOT mean no decision was
    // taken. Folding them into one list would let an aged-out decision read as
    // a decision never made.
    assert.ok(Array.isArray(history.mergedFrom) && Array.isArray(history.keptSeparate))
    assert.notEqual(history.mergedFrom, history.keptSeparate)
  })

  await check('an id that is not a product id answers empty rather than throwing', async () => {
    for (const bad of [0, -1, 'abc', null, undefined, 1.5]) {
      const out = await identity.readProductIdentityHistory(db, bad)
      assert.deepEqual(out.mergedFrom, [])
      assert.equal(out.mergedInto, null)
      assert.deepEqual(out.keptSeparate, [])
    }
  })

  await check('the route is gated like its sibling, and reads through this one function', () => {
    const route = fs.readFileSync(path.join(SRC, 'routes', 'products.ts'), 'utf8')
    const start = route.indexOf("app.get('/:id/identity-history'")
    assert.ok(start > 0, 'the endpoint must exist')
    const body = route.slice(start, route.indexOf('\n})', start))
    assert.match(
      body, /getPermissionTier\(user, 'products'\) === 'none' && getPermissionTier\(user, 'inventory'\) === 'none'/,
      'the fold names the retired row and who did it -- internal catalog history, gated like /auto-merges',
    )
    assert.match(body, /readProductIdentityHistory\(getDb\(c\.env\), productId\)/, 'the route must not re-derive the history itself')
    assert.match(body, /Invalid product id/, 'a non-id must be refused before any query runs')
  })

  console.log(failed ? `test-product-identity-history-pure: ${failed} FAILED` : 'test-product-identity-history-pure: all checks passed')
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error(e); process.exitCode = 1 })
