// D1b: the Stock-In Invoice report -- proven against the REAL migrations
// (0070 applies on top of the full chain) and the REAL writers
// (productBatches.receiveBatchStock, stockActionCommit.applyUnifiedStockAdd
// transpiled from source, never re-written here):
//
//   - both receive paths stamp received_branch_id; first attribution
//     sticks on top-ups, and a lot that predates 0070 (NULL) is filled by
//     its next receipt, never overwritten
//   - the report's derived table (extracted verbatim from
//     routes/contacts.ts) merges id-attributed and name-only lots of the
//     same supplier into ONE group, buckets unattributed lots under
//     'none', and groups by received day
//   - cost totals only count lines where BOTH received qty and unit cost
//     are known (lines_without_cost says what the total cannot see)
//   - the branch filter hides-and-COUNTS invoices with no recorded branch
//     (invoices_without_branch), never silently drops them
//   - a date bound excludes the no-date group; that group stays reachable
//     unfiltered and its lines travel under day='none'
//
// Run: node scripts/test-stock-in-invoice-report-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function compile(file, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const batchCode = compile('batchCode.ts')
const sqlBinding = compile('sqlBinding.ts')
const productBatches = compile('productBatches.ts', { './db': {}, './batchCode': batchCode, './sqlBinding': sqlBinding })
const stockActionCommit = compile('stockActionCommit.ts', { './db': {}, './batchCode': batchCode })

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

function freshDb() {
  const sqlite = new Database(':memory:')
  for (const file of migrationFiles) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'))
  }
  const db = {
    prepare(sql) {
      return {
        get(params) { return Promise.resolve(sqlite.prepare(sql).get(params ?? {})) },
        all(params) { return Promise.resolve(sqlite.prepare(sql).all(params ?? {})) },
        run(params) { const info = sqlite.prepare(sql).run(params ?? {}); return Promise.resolve({ changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }) },
      }
    },
    batch(statements) {
      const run = sqlite.transaction(() => statements.map(({ sql, params }) => sqlite.prepare(sql).run(params ?? {})))
      return Promise.resolve(run())
    },
  }
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1), (2, 'Warehouse', 1)`).run()
  return { sqlite, db }
}

// The route's derived table, extracted from the shipped source so this
// test exercises what actually runs -- if the route's SQL drifts, this
// fails loudly instead of testing a stale copy.
// Normalized first: this checkout's autocrlf rewrites files to CRLF as git
// touches them, and a `\n`-anchored extraction regex then reads a template
// literal that IS there as "missing" (bit us on Part 411's sweep).
const contactsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8').replace(/\r\n/g, '\n')
const sourceMatch = contactsSource.match(/const STOCK_IN_REPORT_SOURCE = `\n([\s\S]*?)`/)
assert.ok(sourceMatch, 'contacts.ts defines STOCK_IN_REPORT_SOURCE')
const REPORT_SOURCE = sourceMatch[1]

const GROUPS_SQL = (where) => `
  SELECT t.supplier_key, MAX(t.supplier_display) AS supplier_name, t.received_day,
         COUNT(*) AS line_count,
         SUM(CASE WHEN t.received_quantity IS NOT NULL THEN t.received_quantity ELSE 0 END) AS units_received,
         SUM(CASE WHEN t.received_quantity IS NOT NULL AND t.unit_cost_usd IS NOT NULL THEN t.received_quantity * t.unit_cost_usd ELSE 0 END) AS cost_usd,
         SUM(CASE WHEN t.received_quantity IS NULL OR t.unit_cost_usd IS NULL THEN 1 ELSE 0 END) AS lines_without_cost,
         SUM(CASE WHEN t.payment_status = 'credit' THEN 1 ELSE 0 END) AS credit_lines
  FROM (${REPORT_SOURCE}) t
  ${where}
  GROUP BY t.supplier_key, t.received_day
  ORDER BY t.received_day DESC, supplier_name COLLATE NOCASE ASC
`

;(async () => {
  // --- 1. migration 0070 lands on the real chain ---------------------------
  {
    const { sqlite } = freshDb()
    const columns = sqlite.prepare('PRAGMA table_info(product_batches)').all().map((c) => c.name)
    assert.ok(columns.includes('received_branch_id'), '0070 adds product_batches.received_branch_id')
    const index = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_product_batches_received_at'`).get()
    assert.ok(index, '0070 adds the received_at index')
    console.log(`PASS migration 0070 applies on the full chain (${migrationFiles.length} migrations)`)
  }

  // --- 2. receiveBatchStock stamps the receiving branch --------------------
  {
    const { sqlite, db } = freshDb()
    sqlite.prepare(`INSERT INTO products (id, name, is_active) VALUES (101, 'Serum', 1)`).run()
    await productBatches.receiveBatchStock(db, { productId: 101, branchId: 1, quantity: 10, receivedDate: '2026-08-20' })
    let row = sqlite.prepare('SELECT received_branch_id, received_quantity FROM product_batches').get()
    assert.strictEqual(row.received_branch_id, 1, 'a new lot records the branch it arrived at')
    // Same received date = same lot (date-derived batch key); receiving the
    // top-up at ANOTHER branch must not rewrite where the lot first landed.
    await productBatches.receiveBatchStock(db, { productId: 101, branchId: 2, quantity: 5, receivedDate: '2026-08-20' })
    row = sqlite.prepare('SELECT received_branch_id, received_quantity FROM product_batches').get()
    assert.strictEqual(sqlite.prepare('SELECT COUNT(*) AS n FROM product_batches').get().n, 1, 'same date tops up, never a second lot')
    assert.strictEqual(row.received_branch_id, 1, 'first branch attribution sticks on top-ups')
    assert.strictEqual(row.received_quantity, 15, 'received_quantity still accumulates (0067 unchanged)')
    // A lot that predates 0070 (NULL branch) is FILLED by its next receipt.
    sqlite.prepare('UPDATE product_batches SET received_branch_id = NULL').run()
    await productBatches.receiveBatchStock(db, { productId: 101, branchId: 2, quantity: 1, receivedDate: '2026-08-20' })
    row = sqlite.prepare('SELECT received_branch_id FROM product_batches').get()
    assert.strictEqual(row.received_branch_id, 2, 'a NULL branch (pre-0070 lot) is filled, not left unknown forever')
    console.log('PASS receiveBatchStock stamps the branch; first attribution sticks; NULL fills')
  }

  // --- 3. the import add writer stamps it too ------------------------------
  {
    const { sqlite, db } = freshDb()
    sqlite.prepare(`INSERT INTO products (id, name, is_active) VALUES (10, 'Serum', 1)`).run()
    const input = {
      jobId: 'job-1', rowNumber: 2, productId: 10, productName: 'Serum',
      branchId: 2, branchName: 'Warehouse', quantity: 3, date: '08/19/2026', batchLabel: '',
    }
    await stockActionCommit.applyUnifiedStockAdd(db, input)
    let row = sqlite.prepare('SELECT received_branch_id FROM product_batches').get()
    assert.strictEqual(row.received_branch_id, 2, 'the §12 import add records the receiving branch')
    // Redelivery is guarded -- nothing changes, including the branch.
    const retry = await stockActionCommit.applyUnifiedStockAdd(db, input)
    assert.strictEqual(retry.alreadyApplied, true)
    // A later add landing on the SAME lot from another branch fills only
    // where NULL -- simulate a pre-0070 lot, then top it up from branch 1.
    sqlite.prepare('UPDATE product_batches SET received_branch_id = NULL').run()
    await stockActionCommit.applyUnifiedStockAdd(db, { ...input, rowNumber: 3, branchId: 1, branchName: 'Shop' })
    row = sqlite.prepare('SELECT received_branch_id FROM product_batches').get()
    assert.strictEqual(row.received_branch_id, 1, 'NULL branch adopts the next add; a recorded one would have stuck')
    console.log('PASS applyUnifiedStockAdd stamps the branch; redelivery guard holds')
  }

  // --- 4. the report itself -------------------------------------------------
  {
    const { sqlite } = freshDb()
    sqlite.prepare(`INSERT INTO products (id, name, barcode, is_active) VALUES (101, 'Serum', 'S1', 1), (102, 'Toner', 'T1', 1)`).run()
    sqlite.prepare(`INSERT INTO suppliers (id, name) VALUES (7, 'Srey Now'), (9, 'Bong Long')`).run()
    const insert = sqlite.prepare(`
      INSERT INTO product_batches (id, variant_product_id, batch_key, received_at, is_active, supplier_id, supplier_name, unit_cost_usd, payment_status, received_quantity, received_branch_id)
      VALUES (@id, @productId, @batchKey, @receivedAt, 1, @supplierId, @supplierName, @unitCostUsd, @paymentStatus, @receivedQuantity, @receivedBranchId)
    `)
    // Same supplier twice on one day: once by id, once by free-typed name
    // (different case) -- the report must read them as ONE invoice.
    insert.run({ id: 1, productId: 101, batchKey: 'K1', receivedAt: '2026-08-20', supplierId: 7, supplierName: 'Srey Now', unitCostUsd: 2.5, paymentStatus: 'paid', receivedQuantity: 10, receivedBranchId: 1 })
    insert.run({ id: 2, productId: 102, batchKey: 'K2', receivedAt: '2026-08-20', supplierId: null, supplierName: 'srey now', unitCostUsd: 1, paymentStatus: null, receivedQuantity: 4, receivedBranchId: 1 })
    // Credit purchase with no recorded cost.
    insert.run({ id: 3, productId: 101, batchKey: 'K3', receivedAt: '2026-08-21', supplierId: 9, supplierName: 'Bong Long', unitCostUsd: null, paymentStatus: 'credit', receivedQuantity: 5, receivedBranchId: 2 })
    // No supplier, no qty/cost, no branch (a catalog-import style lot).
    insert.run({ id: 4, productId: 102, batchKey: 'K4', receivedAt: '2026-08-22', supplierId: null, supplierName: null, unitCostUsd: null, paymentStatus: null, receivedQuantity: null, receivedBranchId: null })
    // Attributed lot with NO received date (the no-date group).
    insert.run({ id: 5, productId: 101, batchKey: 'K5', receivedAt: null, supplierId: 7, supplierName: 'Srey Now', unitCostUsd: null, paymentStatus: null, receivedQuantity: null, receivedBranchId: null })
    // Remaining stock for line 1: split across branches, sums to 7.
    sqlite.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (1, 1, 6), (1, 2, 1)`).run()

    const groups = sqlite.prepare(GROUPS_SQL('')).all()
    assert.strictEqual(groups.length, 4, 'four invoice groups: merged supplier day, credit day, none day, no-date')
    assert.deepStrictEqual(groups.map((g) => [g.supplier_key, g.received_day]), [
      ['none', '2026-08-22'], ['id:9', '2026-08-21'], ['id:7', '2026-08-20'], ['id:7', ''],
    ], 'ordered by received day DESC with the no-date group last')
    const merged = groups.find((g) => g.supplier_key === 'id:7' && g.received_day === '2026-08-20')
    assert.strictEqual(merged.line_count, 2, 'id-attributed and name-only lots of one supplier merge into one invoice')
    assert.strictEqual(merged.supplier_name, 'Srey Now', 'the suppliers-table spelling wins the display name')
    assert.strictEqual(merged.units_received, 14)
    assert.strictEqual(Math.round(merged.cost_usd * 100) / 100, 29, 'cost = 10×2.50 + 4×1.00')
    const credit = groups.find((g) => g.supplier_key === 'id:9')
    assert.strictEqual(credit.credit_lines, 1)
    assert.strictEqual(credit.lines_without_cost, 1, 'a qty-without-cost line is counted, not silently 0')
    assert.strictEqual(credit.cost_usd, 0, 'no fabricated cost for it')

    // Branch filter: only branch-1 lots -- and the two invoices whose lots
    // carry NO branch are counted as hidden, never silently dropped.
    const branchGroups = sqlite.prepare(GROUPS_SQL('WHERE t.received_branch_id = @branchId')).all({ branchId: 1 })
    assert.deepStrictEqual(branchGroups.map((g) => [g.supplier_key, g.received_day]), [['id:7', '2026-08-20']])
    const withoutBranch = sqlite.prepare(`
      SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM (${REPORT_SOURCE}) t WHERE t.received_branch_id IS NULL GROUP BY t.supplier_key, t.received_day
      )
    `).get()
    assert.strictEqual(withoutBranch.total, 2, 'the branch filter can name how many invoices it cannot see')

    // Supplier filter matches the merged identity; 'none' is its own bucket.
    const supplier7 = sqlite.prepare(GROUPS_SQL(`WHERE t.supplier_key = @key`)).all({ key: 'id:7' })
    assert.strictEqual(supplier7.length, 2, 'supplier filter sees both their dated and no-date invoices')
    const none = sqlite.prepare(GROUPS_SQL(`WHERE t.supplier_key = 'none'`)).all()
    assert.strictEqual(none.length, 1)

    // A date bound excludes the no-date group instead of mis-matching it.
    const fromFiltered = sqlite.prepare(GROUPS_SQL(`WHERE t.received_day <> '' AND t.received_day >= @from`)).all({ from: '2026-08-21' })
    assert.deepStrictEqual(fromFiltered.map((g) => g.received_day), ['2026-08-22', '2026-08-21'])

    // Lines for the merged invoice: product identity, line totals, branch
    // name, remaining stock summed across branches.
    const lines = sqlite.prepare(`
      SELECT t.id, p.name AS product_name, p.barcode, t.received_quantity, t.unit_cost_usd,
             b.name AS received_branch_name,
             COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = t.id), 0) AS remaining_quantity
      FROM (${REPORT_SOURCE}) t
      JOIN products p ON p.id = t.variant_product_id
      LEFT JOIN branches b ON b.id = t.received_branch_id
      WHERE t.supplier_key = @key AND t.received_day = @day
      ORDER BY p.name COLLATE NOCASE ASC, t.id ASC
    `).all({ key: 'id:7', day: '2026-08-20' })
    assert.deepStrictEqual(lines.map((l) => [l.product_name, l.barcode, l.received_quantity * l.unit_cost_usd]), [
      ['Serum', 'S1', 25], ['Toner', 'T1', 4],
    ])
    assert.strictEqual(lines[0].received_branch_name, 'Shop')
    assert.strictEqual(lines[0].remaining_quantity, 7, 'remaining sums the lot across branches')
    const noDateLines = sqlite.prepare(`SELECT t.id FROM (${REPORT_SOURCE}) t WHERE t.supplier_key = @key AND t.received_day = ''`).all({ key: 'id:7' })
    assert.deepStrictEqual(noDateLines.map((l) => l.id), [5], "the no-date group's lines are reachable (day travels as 'none')")
    console.log('PASS report grouping, supplier merge, honest-count filters, lines')
  }

  // --- 5. source locks -------------------------------------------------------
  {
    assert.ok(contactsSource.includes(`app.get('/suppliers/reports/stock-in-invoices'`), 'the groups endpoint exists under /suppliers/* (requireSupplierAccess gates it)')
    assert.ok(contactsSource.includes(`app.get('/suppliers/reports/stock-in-invoice-lines'`), 'the lines endpoint exists under /suppliers/*')
    assert.ok(/GROUP BY t\.supplier_key, t\.received_day/.test(contactsSource), 'the route groups by supplier + received day')
    assert.ok(/invoices_without_branch/.test(contactsSource), 'the branch filter reports what it cannot see')
    assert.ok(/received_day <> '' AND t\.received_day >=/.test(contactsSource.replace(/t\.received_day <> ''/g, "received_day <> ''")) || /received_day <> ''/.test(contactsSource), 'date bounds exclude the no-date group')
    const receiveSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'productBatches.ts'), 'utf8')
    assert.ok(/received_branch_id = COALESCE\(received_branch_id, @receivedBranchId\)/.test(receiveSource), 'receiveBatchStock top-ups fill-if-NULL')
    const commitSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'stockActionCommit.ts'), 'utf8')
    assert.ok(/received_branch_id = COALESCE\(received_branch_id, @branchId\)/.test(commitSource), 'the import add writer fills-if-NULL too')
    console.log('PASS source locks on the route + both writers')
  }

  console.log('ALL PASS test-stock-in-invoice-report-pure')
})().catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
