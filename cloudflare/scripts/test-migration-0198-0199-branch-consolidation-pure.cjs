// U-branch: migration 0198 (branch successor/role schema, in the chain) and
// the HELD 0199 Shop -> Store consolidation with its recovery
// (ops/scripts/migration/held/0199_branch_consolidation_shop_into_store*.sql),
// run as SQL on the real migration chain (in-memory SQLite).
//
// Production ids: Warehouse id 1 survives as Store; Shop id 2 is retired with
// successor 1. Each file is applied inside one transaction, the way D1
// applies a migration, so a failed preflight/postflight CHECK rolls it back.
//
// Discriminating cases:
//   * the same lot at both branches must SUM on Store (3 + 5 = 8), not be
//     replaced by Shop's row or duplicated as a second lot row;
//   * a pre-existing ledger mismatch at Shop (branch_stock 10, lots 6) must
//     arrive as 10 + 6 with 4 untracked on the transfer member, not be
//     "repaired" to 6 or inflated to 16;
//   * an unreleased hold at Shop, or lots above branch_stock, must abort the
//     whole file with nothing written (dump identical);
//   * a second forward run must abort, not move Shop's zeros again;
//   * after the move a queued sale/return addressed to Shop lands on Store
//     with its origin recorded, and a raw write at Shop is refused by the DB;
//   * recovery must return every touched row byte-identical, and refuse (not
//     go negative) once Store has sold what Shop brought.
//
// Run (from cloudflare/): node scripts/test-migration-0198-0199-branch-consolidation-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const HELD = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'held')
const MIGRATIONS = path.join(__dirname, '..', 'migrations')
const SCHEMA_FILE = '0198_branch_successor_role.sql'
const SCHEMA_SQL = fs.readFileSync(path.join(MIGRATIONS, SCHEMA_FILE), 'utf8')
const FORWARD_SQL = fs.readFileSync(path.join(HELD, '0199_branch_consolidation_shop_into_store.sql'), 'utf8')
const RECOVERY_SQL = fs.readFileSync(path.join(HELD, '0199_branch_consolidation_shop_into_store_recovery.sql'), 'utf8')
// The chain split around 0198, so a fixture can seed branch rows first and
// then meet 0198 exactly as production will (its UPDATE seeds role and
// canonical_key from the names; the fixture writes no role by hand).
const chainFiles = (keep) => fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql') && keep(f)).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
const chainBefore0198 = () => chainFiles((f) => f < SCHEMA_FILE)
const chainAfter0198 = () => chainFiles((f) => f > SCHEMA_FILE)
// 0198 is in the applied chain; 0199 stays OUT of it until the owner's
// cutover (see its header), or the next release would perform the move.
assert.ok(loadAll().includes(SCHEMA_SQL), '0198 is in cloudflare/migrations')
assert.ok(!fs.readdirSync(MIGRATIONS).some((f) => f.startsWith('0199_')), '0199 is held, not in cloudflare/migrations')
for (const [name, sql] of [['0198', SCHEMA_SQL], ['0199', FORWARD_SQL], ['0199 recovery', RECOVERY_SQL]]) {
  assert.ok(!sql.includes('\r'), `${name} must be LF-only (trigger SQL)`)
}

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const mod = { exports: {} }
  const localRequire = (id) => (id in overrides ? overrides[id] : require(id))
  new Function('exports', 'require', 'module', outputText)(mod.exports, localRequire, mod)
  return mod.exports
}
const succession = loadReal('lib/branchSuccession.ts', { './branchRoles': loadReal('lib/branchRoles.ts') })
const { readConsolidationPreview } = loadReal('lib/branchConsolidationPreview.ts')
const branchesRouteSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'branches.ts'), 'utf8').replace(/\r\n/g, '\n')

const TABLES = [
  'branches', 'branch_stock', 'branch_batch_stock', 'products', 'product_batches', 'damaged_stock_lots', 'rfid_tags',
  'action_history', 'inventory_movements', 'stock_transfers', 'transfer_operation_receipts', 'transfer_operation_members',
  'branch_redirects', 'system_flags', 'sales', 'legacy_inventory_effects',
]

function fixture({ hold = false, invertedMismatch = false } = {}) {
  const d1 = openDb(chainBefore0198())
  const raw = d1.db
  raw.exec(`INSERT INTO branches (id, name, is_default, is_active) VALUES (1, 'Warehouse', 0, 1), (2, 'Shop', 1, 1);`)
  raw.exec(SCHEMA_SQL.replace(/\r\n/g, '\n'))
  for (const sql of chainAfter0198()) raw.exec(sql.replace(/\r\n/g, '\n'))
  raw.exec(`
    INSERT INTO products (id, name, barcode, is_active, stock_quantity, cost_price_usd, cost_price_khr) VALUES
      (10, 'Serum', 'S-10', 1, 8, 2.5, 10000),
      (20, 'Cream', 'C-20', 1, 10, 4, NULL),
      (30, 'Toner', 'T-30', 1, 7, 1, NULL),
      (40, 'Mask', 'M-40', 1, 2, 3, 12000);
    INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd) VALUES
      (101, 10, 'L-101', 'L-101', '2026-09-01', 1, 2.4),
      (201, 20, 'L-201', NULL, '2026-09-02', 1, NULL),
      (301, 30, 'L-301', NULL, '2026-09-03', 1, 1);
    -- Serum: the same lot at both branches.
    INSERT INTO branch_stock (id, product_id, branch_id, quantity, rfid_confirmed_qty) VALUES
      (1, 10, 1, 5, 1), (2, 10, 2, 3, 2),
    -- Cream: Shop only, ledger mismatch (branch 10, lots 6).
      (3, 20, 2, 10, 0),
    -- Toner: Warehouse only.
      (4, 30, 1, 7, 0),
    -- Mask: Shop, no lots at all.
      (5, 40, 2, 2, 0);
    INSERT INTO branch_batch_stock (id, batch_id, branch_id, quantity, updated_at) VALUES
      (1, 101, 1, 5, '2026-09-10 00:00:00'), (2, 101, 2, 3, '2026-09-10 00:00:00'),
      (3, 201, 2, 6, '2026-09-10 00:00:00'), (4, 301, 1, 7, '2026-09-10 00:00:00');
    INSERT INTO damaged_stock_lots (id, product_id, branch_id, batch_id, quantity, quantity_remaining, updated_at) VALUES
      (1, 10, 2, 101, 1, 1, '2026-09-11 00:00:00'), (2, 10, 2, 101, 1, 0, '2026-09-11 00:00:00');
    INSERT INTO rfid_tags (id, epc_id, product_id, branch_id, updated_at) VALUES (1, 'EPC-1', 10, 2, '2026-09-12 00:00:00');
    INSERT INTO action_history (id, scope, entity, entity_id, label, reversible, status, undo_payload, updated_at) VALUES
      (1, 'inventory', 'stock_adjust', '10', 'Adjust Serum', 1, 'undoable', '{"branch_id":2}', '2026-09-13 00:00:00'),
      (2, 'inventory', 'stock_adjust', '20', 'Adjust Cream', 0, 'recorded', '{}', '2026-09-13 00:00:00');
    INSERT INTO sales (id, receipt_number, branch_id, branch_name, sale_status) VALUES (1, 'R-1', 2, 'Shop', 'completed');
  `)
  if (hold) raw.exec(`INSERT INTO sales (id, receipt_number, branch_id, branch_name, sale_status) VALUES (2, 'R-2', 2, 'Shop', 'awaiting_delivery');`)
  if (invertedMismatch) raw.exec(`UPDATE branch_stock SET quantity = 5 WHERE id = 3;`)
  return { d1, raw }
}

function applyAtomically(raw, sql) {
  raw.exec('BEGIN')
  try {
    raw.exec(sql.replace(/\r\n/g, '\n'))
    raw.exec('COMMIT')
  } catch (error) {
    raw.exec('ROLLBACK')
    throw error
  }
}

function dump(raw) {
  const out = {}
  for (const table of TABLES) out[table] = raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  out.schema = raw.prepare(`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all()
  return JSON.stringify(out)
}
const one = (raw, sql, ...params) => raw.prepare(sql).get(...params)
const all = (raw, sql, ...params) => raw.prepare(sql).all(...params)
const qty = (raw, productId, branchId) => one(raw, 'SELECT quantity FROM branch_stock WHERE product_id = ? AND branch_id = ?', productId, branchId)?.quantity ?? null
const lotQty = (raw, batchId, branchId) => one(raw, 'SELECT quantity FROM branch_batch_stock WHERE batch_id = ? AND branch_id = ?', batchId, branchId)?.quantity ?? null

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('an unreleased hold at Shop aborts the preflight with nothing written; the preview names it', async () => {
    const { d1, raw } = fixture({ hold: true })
    const preview = await readConsolidationPreview(d1)
    assert.equal(preview.ready, false)
    assert.equal(preview.blockers.unreleased_holds, 1)
    const before = dump(raw)
    assert.throws(() => applyAtomically(raw, FORWARD_SQL), /awaiting_payment\/awaiting_delivery sales holding stock/)
    assert.equal(dump(raw), before)
  })

  await check('lots above branch_stock at Shop abort the preflight with nothing written; the preview names the product', async () => {
    const { d1, raw } = fixture({ invertedMismatch: true })
    const preview = await readConsolidationPreview(d1)
    assert.equal(preview.ready, false)
    assert.deepEqual(preview.lots_exceed_branch_stock_products, [{ product_id: 20, branch_quantity: 5, lot_quantity: 6 }])
    const before = dump(raw)
    assert.throws(() => applyAtomically(raw, FORWARD_SQL), /more in its lots than in branch_stock/)
    assert.equal(dump(raw), before)
  })

  await check('preview: ready on a clean fixture with the exact move the file makes; admin-only; says so without 0198', async () => {
    const { d1 } = fixture()
    const preview = await readConsolidationPreview(d1)
    assert.equal(preview.ready, true, JSON.stringify(preview.blockers))
    assert.deepEqual(preview.move, {
      products: 3, quantity: 15, lots: 2, lot_quantity: 9, untracked_quantity: 6, same_lot_at_both: 1,
      rfid_confirmed_quantity: 2, open_damaged_lots: 1, rfid_tags: 1, undo_entries_retired: 1,
    })
    assert.match(branchesRouteSource, /app\.get\('\/consolidation-preview', async \(c\) => \{\n  if \(!isAdminControlUser\(c\.get\('user'\)\)\) \{\n    return c\.json\(\{ success: false, error: 'Administrator only', code: 'forbidden' \}, 403\)/)
    const bare = openDb(chainBefore0198())
    bare.db.exec(`INSERT INTO branches (id, name, is_default, is_active) VALUES (1, 'Warehouse', 0, 1), (2, 'Shop', 1, 1);`)
    const bareView = await readConsolidationPreview(bare)
    assert.equal(bareView.ready, false)
    assert.equal(bareView.blockers.held_schema_missing, 1)
  })

  await check('0198 seeds role and canonical_key from the names of existing rows; a branch added later keeps the name rule', () => {
    const { raw: r } = fixture()
    assert.deepEqual(all(r, 'SELECT id, role, canonical_key, successor_branch_id FROM branches ORDER BY id'), [
      { id: 1, role: 'warehouse', canonical_key: 'warehouse', successor_branch_id: null },
      { id: 2, role: 'shop', canonical_key: 'shop', successor_branch_id: null },
    ])
    assert.equal(one(r, 'SELECT COUNT(*) AS n FROM branch_redirects').n, 0)
    r.exec(`INSERT INTO branches (id, name, is_default, is_active) VALUES (3, 'Pop-up', 0, 1)`)
    assert.deepEqual(one(r, 'SELECT role, canonical_key FROM branches WHERE id = 3'), { role: null, canonical_key: null })
    assert.throws(() => r.exec(`UPDATE branches SET successor_branch_id = 3 WHERE id = 3`), /cannot be its own successor/)
    assert.throws(() => r.exec(`UPDATE branches SET role = 'store' WHERE id = 1`), /CHECK constraint failed/)
  })

  // Mutation controls: the postflight is only worth something if a plausible
  // wrong move trips it. Each variant is the real file with one line changed.
  const SUM_LOTS = 'ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity'
  const ZERO_SHOP = 'UPDATE branch_stock SET quantity = 0, rfid_confirmed_qty = 0\nWHERE branch_id = 2'
  assert.ok(FORWARD_SQL.includes(SUM_LOTS) && FORWARD_SQL.includes(ZERO_SHOP), 'mutation anchors present in 0199')
  for (const [label, wrong, reason] of [
    ['replaces Store\'s shared lot row with Shop\'s instead of summing', FORWARD_SQL.replace(SUM_LOTS, 'ON CONFLICT(batch_id, branch_id) DO UPDATE SET quantity = excluded.quantity'), /a lot's stock over Store\+Shop changed/],
    ['copies Shop\'s stock to Store but leaves it at Shop too', FORWARD_SQL.replace(ZERO_SHOP, 'UPDATE branch_stock SET quantity = quantity\nWHERE branch_id = 2 AND 0'), /stock over Store\+Shop changed|Shop still holds stock/],
  ]) {
    await check(`mutation control: a forward file that ${label} is refused by its own postflight, nothing written`, () => {
      const { raw: r } = fixture()
      const before = dump(r)
      assert.throws(() => applyAtomically(r, wrong), reason)
      assert.equal(dump(r), before)
    })
  }

  const { d1, raw } = fixture()
  const pristine = dump(raw)
  const totalBefore = one(raw, 'SELECT SUM(quantity) AS q FROM branch_stock').q

  await check('forward: an official transfer folds both ledgers into Store and conserves every total', () => {
    applyAtomically(raw, FORWARD_SQL)
    // Same lot at both branches: summed on the one Store row.
    assert.equal(qty(raw, 10, 1), 8)
    assert.equal(lotQty(raw, 101, 1), 8)
    assert.equal(all(raw, 'SELECT id FROM branch_batch_stock WHERE batch_id = 101 AND branch_id = 1').length, 1)
    // Ledger mismatch carried exactly: branch 10, lots 6.
    assert.equal(qty(raw, 20, 1), 10)
    assert.equal(lotQty(raw, 201, 1), 6)
    assert.equal(qty(raw, 30, 1), 7)
    assert.equal(qty(raw, 40, 1), 2)
    assert.equal(one(raw, 'SELECT rfid_confirmed_qty AS r FROM branch_stock WHERE product_id = 10 AND branch_id = 1').r, 3)
    for (const [p, b] of [[10, 2], [20, 2], [40, 2]]) assert.equal(qty(raw, p, b), 0)
    assert.equal(lotQty(raw, 101, 2), 0)
    assert.equal(lotQty(raw, 201, 2), 0)
    assert.equal(one(raw, 'SELECT SUM(quantity) AS q FROM branch_stock').q, totalBefore)
    // products.stock_quantity is the sum over branches and is not touched.
    assert.deepEqual(all(raw, 'SELECT id, stock_quantity FROM products ORDER BY id').map((r) => r.stock_quantity), [8, 10, 7, 2])
  })

  await check('forward: the transfer record, members and movements balance', () => {
    const receipt = one(raw, `SELECT * FROM transfer_operation_receipts WHERE operation_id = 'branch-consolidation-v1'`)
    assert.equal(receipt.status, 'committed')
    assert.equal(receipt.provenance_version, 1)
    assert.equal(receipt.action_history_id, null, 'not an in-app undo')
    const members = all(raw, 'SELECT * FROM transfer_operation_members WHERE receipt_id = ? ORDER BY ordinal', receipt.id)
    assert.deepEqual(members.map((m) => [m.ordinal, m.source_product_id, m.quantity, m.untracked_quantity, m.source_branch_id, m.destination_branch_id]),
      [[0, 10, 3, 0, 2, 1], [1, 20, 10, 4, 2, 1], [2, 40, 2, 2, 2, 1]])
    const serumTakes = JSON.parse(members[0].allocations_json)
    assert.deepEqual(serumTakes.map((a) => [a.source_batch_id, a.destination_batch_id, a.quantity]), [[101, 101, 3]])
    assert.equal(serumTakes[0].cost_snapshot.unitCostUsd, 2.4)
    assert.equal(JSON.parse(members[2].source_snapshot).untracked_cost_snapshot.unitCostKhr, 12000)
    const moves = all(raw, `SELECT branch_id, branch_name, movement_type, SUM(quantity) AS q, COUNT(*) AS n FROM inventory_movements
      WHERE reason = 'Branch consolidation: Shop moved into Store' GROUP BY branch_id, branch_name, movement_type ORDER BY movement_type`)
    // Same convention as an ordinary transfer (lib/transferOperation.ts): no reference_id.
    assert.equal(one(raw, `SELECT COUNT(*) AS n FROM inventory_movements WHERE reason = 'Branch consolidation: Shop moved into Store' AND reference_id IS NOT NULL`).n, 0)
    assert.deepEqual(moves.map((m) => [m.branch_id, m.branch_name, m.movement_type, m.q, m.n]),
      [[1, 'Store', 'transfer_in', 15, 4], [2, 'Shop', 'transfer_out', 15, 4]])
    assert.equal(all(raw, 'SELECT id FROM stock_transfers WHERE receipt_id = ?', receipt.id).length, 3)
  })

  await check('forward: branches as decided, current-state rows follow the goods, history stays at Shop', () => {
    assert.deepEqual(one(raw, 'SELECT name, role, canonical_key, is_default, is_active, successor_branch_id FROM branches WHERE id = 1'),
      { name: 'Store', role: 'shop', canonical_key: 'warehouse', is_default: 1, is_active: 1, successor_branch_id: null })
    assert.deepEqual(one(raw, 'SELECT name, is_default, is_active, successor_branch_id FROM branches WHERE id = 2'),
      { name: 'Shop', is_default: 0, is_active: 0, successor_branch_id: 1 })
    assert.equal(one(raw, 'SELECT branch_id FROM damaged_stock_lots WHERE id = 1').branch_id, 1, 'open quarantine follows the goods')
    assert.equal(one(raw, 'SELECT branch_id FROM damaged_stock_lots WHERE id = 2').branch_id, 2, 'a resolved lot is history')
    assert.equal(one(raw, 'SELECT branch_id FROM rfid_tags WHERE id = 1').branch_id, 1)
    assert.deepEqual(all(raw, `SELECT entity_type, entity_key FROM branch_redirects WHERE context = 'branch-consolidation' ORDER BY id`),
      [{ entity_type: 'damaged_stock_lot', entity_key: '1' }, { entity_type: 'rfid_tag', entity_key: '1' }])
    assert.deepEqual(one(raw, 'SELECT branch_id, branch_name FROM sales WHERE id = 1'), { branch_id: 2, branch_name: 'Shop' })
    assert.deepEqual(one(raw, 'SELECT reversible, status FROM action_history WHERE id = 1'), { reversible: 0, status: 'recorded' })
  })

  await check('double apply: a second forward run aborts and moves nothing; the preview reports it done', async () => {
    const view = await readConsolidationPreview(d1)
    assert.equal(view.ready, false)
    assert.equal(view.blockers.already_consolidated, 1)
    const after = dump(raw)
    assert.throws(() => applyAtomically(raw, FORWARD_SQL), /already exists/)
    assert.equal(dump(raw), after)
  })

  await check('after the move: a queued sale and return addressed to Shop land on Store with the origin recorded; raw Shop writes are refused', async () => {
    const directory = await succession.readBranchDirectory(d1)
    const sale = succession.resolveStockBranch(directory, 2, 'additive')
    assert.deepEqual([sale.branchId, sale.originBranchId], [1, 2])
    assert.throws(() => succession.resolveStockBranch(directory, 2, 'replacing'), (e) => e.code === 'branch_retired_set_refused')
    assert.throws(() => succession.resolveStockBranch(directory, 2, 'interactive'), (e) => e.code === 'branch_inactive')
    const statements = succession.branchRedirectStatements([
      { entityType: 'sale', entityKey: 'offline-7', resolution: sale },
      { entityType: 'return', entityKey: 'offline-8', resolution: succession.resolveStockBranch(directory, 2, 'additive') },
      { entityType: 'sale', entityKey: 'store-9', resolution: succession.resolveStockBranch(directory, 1, 'additive') },
    ])
    assert.equal(statements.length, 2, 'only redirected writes leave provenance')
    await d1.batch(statements)
    const probe = dump(raw)
    // The Worker would never address Shop now; the database refuses it too.
    assert.throws(() => raw.exec(`UPDATE branch_stock SET quantity = 1 WHERE product_id = 10 AND branch_id = 2`), /branch_inactive/)
    assert.throws(() => raw.exec(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (30, 2, 1)`), /branch_inactive/)
    assert.throws(() => raw.exec(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (301, 2, 1)`), /branch_inactive/)
    assert.throws(() => raw.exec(`INSERT INTO legacy_inventory_effects (source_key, product_id, branch_id, quantity_delta, movement_quantity, movement_type, occurred_at)
      VALUES ('x', 10, 2, 1, 1, 'add', '2026-09-26')`), /branch_inactive/)
    assert.equal(dump(raw), probe)
    // A zero row at Shop may still be written (restore/backfill shape).
    raw.exec(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (30, 2, 0); DELETE FROM branch_stock WHERE product_id = 30 AND branch_id = 2;`)
  })

  await check('recovery: every row returns byte-identical once the post-move redirects are the only foreign rows', () => {
    // The two redirects the Worker wrote after the move belong to real Store
    // records and survive recovery by design; drop them for the comparison.
    applyAtomically(raw, RECOVERY_SQL)
    raw.exec(`DELETE FROM branch_redirects WHERE context IS NULL AND entity_key IN ('offline-7', 'offline-8')`)
    raw.exec(`DELETE FROM sqlite_sequence WHERE 0`)
    const now = JSON.parse(dump(raw))
    const then = JSON.parse(pristine)
    for (const table of Object.keys(then)) assert.deepEqual(now[table], then[table], `${table} differs after recovery`)
  })

  await check('recovery is repeatable: forward -> recover -> forward -> recover ends where it began', () => {
    applyAtomically(raw, FORWARD_SQL)
    assert.equal(qty(raw, 10, 1), 8)
    applyAtomically(raw, RECOVERY_SQL)
    const now = JSON.parse(dump(raw))
    const then = JSON.parse(pristine)
    for (const table of Object.keys(then)) assert.deepEqual(now[table], then[table], `${table} differs after the second recovery`)
    assert.throws(() => applyAtomically(raw, RECOVERY_SQL), /no such table: _branch_consolidation_run|no consolidation run/, 'a second recovery has nothing to recover')
  })

  await check('recovery refuses (never goes negative) once Store has sold what Shop brought', () => {
    const { raw: r } = fixture()
    applyAtomically(r, FORWARD_SQL)
    // Store sells 9 Cream of the 10 it holds (all 10 came from Shop).
    r.exec(`UPDATE branch_stock SET quantity = 1 WHERE product_id = 20 AND branch_id = 1;
      UPDATE branch_batch_stock SET quantity = 0 WHERE batch_id = 201 AND branch_id = 1;`)
    const before = dump(r)
    assert.throws(() => applyAtomically(r, RECOVERY_SQL), /CHECK constraint failed/)
    assert.equal(dump(r), before)
  })

  console.log(`\n${passed} branch consolidation checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
