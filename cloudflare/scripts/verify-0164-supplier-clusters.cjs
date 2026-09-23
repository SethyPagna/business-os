// Verifies migrations/0164_supplier_duplicate_clusters.sql against a fresh
// local better-sqlite3 database built from the REAL migration chain. Never
// touches remote D1.
//
// This is the CORRECTED shape: the migration's first draft used a wrong id
// range ("lang" 23-37") that would have deleted nine unrelated suppliers
// (ids 24-32) and repointed their batches/products/invoices onto "Lang".
// The coordinator caught this with a fresh --remote SELECT (2026-09-15) and
// gave the real cluster membership. This script's job now includes proving
// that bug cannot recur: ids 24-32 are seeded as nine real, distinct
// suppliers and asserted byte-for-byte untouched after the migration runs.
//
// Proves, per cluster:
//   1. the migration's result on suppliers/product_batches/products/returns/
//      supplier_invoices equals lib/contactMerge.ts buildContactMergePlan
//      (the writer the real Contacts -> Conflicts "/suppliers/merge" route
//      uses) applied pairwise, keeper-vs-each-loser in ascending id order,
//      on an identically seeded twin;
//   2. a keeper's blank column is backfilled from a loser, and a keeper's
//      already-filled column is left alone (positive control both ways);
//   3. products/product_batches rows attributed to a loser BY NAME (no
//      supplier_id) are repointed too, same as the writer;
//   4. a same-shaped supplier that is not one of the pinned ids is untouched;
//   5. THE NINE UNRELATED SUPPLIERS AT IDS 24-32 (and everything that
//      references them) are byte-for-byte untouched -- this is the specific
//      positive control that would have caught the first draft's bug;
//   6. a loser id that exists but whose name does NOT match its keeper is a
//      no-op (the NAME GUARD), even though the id itself is "in range";
//   7. one audit_logs row per merged id, carrying the loser's pre-image;
//   8. re-running the file changes nothing (idempotent), and the full chain
//      applies on an empty database (ids absent -> every statement no-op).
//
// Run: node scripts/verify-0164-supplier-clusters.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

const MIGRATION = '0164_supplier_duplicate_clusters.sql'

function compile(file, dir, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', dir, file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(stubs, request) ? stubs[request] : require(request)
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}
const { contactDisplayAddress } = { contactDisplayAddress: (a) => (typeof a === 'string' ? a : '') }
const { buildContactMergePlan } = compile('contactMerge.ts', 'lib', {
  './contactOptions': { contactDisplayAddress },
  './phone': compile('phone.ts', 'lib'),
})

const migrationsDir = path.join(__dirname, '..', 'migrations')
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
assert.deepStrictEqual(migrationFiles.filter((f) => f.startsWith('0164_')), [MIGRATION], 'exactly one 0164 migration')
const migrationSql = fs.readFileSync(path.join(migrationsDir, MIGRATION), 'utf8')
assert.ok(!migrationSql.includes('\r'), 'migration is LF-only')

function chainBefore(file) {
  const sqlite = new Database(':memory:')
  for (const f of migrationFiles) {
    if (f === file) break
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  }
  return sqlite
}
const applyMigration = (sqlite) => sqlite.exec(migrationSql)

const SUPPLIER_COLUMNS = ['name', 'phone', 'email', 'address', 'company', 'contact_person', 'notes', 'gender']
const AUDIT_USER = 'migration:0164_supplier_duplicate_clusters'

// The two production clusters, CORRECTED (coordinator, --remote SELECT-only,
// 2026-09-15): "j secrat" keeper 20, losers 38-46 (9, unchanged from the
// first draft); "lang"/"Lang" keeper 23, losers 33-37 ONLY (5). Ids 24-32
// are NOT part of either cluster -- see UNRELATED_SUPPLIERS below.
const CLUSTERS = [
  {
    label: 'j_secrat',
    keep: { id: 20, name: 'j secrat', phone: '012345678', email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
    losers: [
      { id: 38, name: 'J Secrat', phone: null, email: 'jsecrat@example.com', address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 39, name: 'j secrat ', phone: null, email: null, address: 'Phnom Penh', company: null, contact_person: null, notes: null, gender: null },
      { id: 40, name: 'j secrat', phone: null, email: null, address: null, company: 'J Secrat Co', contact_person: 'Sok', notes: null, gender: null },
      { id: 41, name: 'j secrat', phone: null, email: null, address: null, company: null, contact_person: null, notes: 'reliable', gender: null },
      { id: 42, name: 'J SECRAT', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: 'male' },
      { id: 43, name: 'j secrat', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 44, name: 'j secrat', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 45, name: 'j secrat', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 46, name: 'j secrat', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
    ],
  },
  {
    label: 'lang',
    keep: { id: 23, name: 'Lang', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
    losers: [
      { id: 33, name: 'lang', phone: '011222333', email: null, address: null, company: null, contact_person: null, notes: null, gender: null }, // backfill positive control
      { id: 34, name: 'Lang', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 35, name: 'lang', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 36, name: 'Lang', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
      { id: 37, name: 'lang', phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null },
    ],
  },
]
// The nine REAL, DISTINCT suppliers the coordinator found sitting inside the
// first draft's wrong "23-37" range (real names, per the coordinator).
// These must come out of the migration completely untouched: still present,
// same name, same linked rows. This is the exact positive control that
// would have caught the first draft's bug -- it did not exist before.
const UNRELATED_SUPPLIERS = [
  { id: 24, name: 'japen' },
  { id: 25, name: 'kaka' },
  { id: 26, name: 'UTB' },
  { id: 27, name: 'Malaysia' },
  { id: 28, name: 'naomi' },
  { id: 29, name: 'autralia' },
  { id: 30, name: 'france' },
  { id: 31, name: 'srun' },
  { id: 32, name: 'piset' },
].map((s) => ({ ...s, phone: null, email: null, address: null, company: null, contact_person: null, notes: null, gender: null }))
// Same-shaped supplier, not a pinned id: must come out untouched.
const CONTROL = { id: 999, name: 'srey now', phone: '099888777', email: null, address: null, company: null, contact_person: null, notes: null, gender: null }

function seed(sqlite) {
  sqlite.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Shop', 1)`).run()
  const insSupplier = sqlite.prepare(`INSERT INTO suppliers (id, ${SUPPLIER_COLUMNS.join(', ')}) VALUES (@id, ${SUPPLIER_COLUMNS.map((c) => '@' + c).join(', ')})`)
  const insProduct = sqlite.prepare(`INSERT INTO products (id, name, supplier) VALUES (@id, @name, @supplier)`)
  const insBatch = sqlite.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, supplier_id, supplier_name) VALUES (@id, @productId, @batchKey, @supplierId, @supplierName)`)
  const insReturn = sqlite.prepare(`INSERT INTO returns (id, supplier_id, supplier_name) VALUES (@id, @supplierId, @supplierName)`)
  const insInvoice = sqlite.prepare(`INSERT INTO supplier_invoices (id, source_branch, legacy_id, supplier_id, supplier_name, invoice_date, term_days, status, source_file, source_row) VALUES (@id, 'main', @id, @supplierId, @supplierName, '2026-01-01', 0, 'open', 'seed', 1)`)

  insSupplier.run(CONTROL)
  let productId = 90000
  let batchId = 91000
  let returnId = 92000
  let invoiceId = 93000
  // control's own linked rows, must stay untouched
  insProduct.run({ id: ++productId, name: 'Control product', supplier: CONTROL.name })
  insBatch.run({ id: ++batchId, productId, batchKey: '01012026', supplierId: CONTROL.id, supplierName: CONTROL.name })
  insReturn.run({ id: ++returnId, supplierId: CONTROL.id, supplierName: CONTROL.name })
  insInvoice.run({ id: ++invoiceId, supplierId: CONTROL.id, supplierName: CONTROL.name })

  // the nine real, distinct suppliers the first draft's wrong id range would
  // have wrongly merged into "Lang" -- each with its own linked rows, id-
  // attributed and orphaned (name-only), so a wrong repoint of ANY kind
  // (id, name, invoice, product) would be caught.
  for (const s of UNRELATED_SUPPLIERS) {
    insSupplier.run(s)
    const pid = ++productId
    insProduct.run({ id: pid, name: `${s.name} product`, supplier: s.name })
    insBatch.run({ id: ++batchId, productId: pid, batchKey: '01012026', supplierId: s.id, supplierName: s.name })
    insReturn.run({ id: ++returnId, supplierId: s.id, supplierName: s.name })
    insInvoice.run({ id: ++invoiceId, supplierId: s.id, supplierName: s.name })
    // an orphaned (supplier_id NULL) row naming this supplier -- must never
    // be picked up by any cluster's name-based repoint.
    const orphanPid = ++productId
    insProduct.run({ id: orphanPid, name: `${s.name} orphan product`, supplier: s.name })
    insBatch.run({ id: ++batchId, productId: orphanPid, batchKey: '01012026', supplierId: null, supplierName: s.name })
  }

  const orphans = [] // { loserId, batchId, productId, invoiceId } -- named-only rows carrying a loser's name text
  for (const cluster of CLUSTERS) {
    insSupplier.run(cluster.keep)
    for (const loser of cluster.losers) {
      insSupplier.run(loser)
      // one row attributed by id
      const pidById = ++productId
      insBatch.run({ id: ++batchId, productId: pidById, batchKey: '01012026', supplierId: loser.id, supplierName: loser.name })
      insReturn.run({ id: ++returnId, supplierId: loser.id, supplierName: loser.name })
      insInvoice.run({ id: ++invoiceId, supplierId: loser.id, supplierName: loser.name })
      // one orphaned row attributed by name only (supplier_id NULL) -- tracked
      // by id rather than re-matched by name text, since several losers in
      // "j secrat" deliberately share the keeper's own name text.
      const pidByName = ++productId
      insProduct.run({ id: pidByName, name: `Orphan product ${loser.id}`, supplier: loser.name })
      const orphanBatchId = ++batchId
      insBatch.run({ id: orphanBatchId, productId: pidByName, batchKey: '01012026', supplierId: null, supplierName: loser.name })
      const orphanInvoiceId = ++invoiceId
      insInvoice.run({ id: orphanInvoiceId, supplierId: null, supplierName: loser.name })
      orphans.push({ loserId: loser.id, productId: pidByName, batchId: orphanBatchId, invoiceId: orphanInvoiceId })
    }
  }
  return orphans
}

const SUP = (sqlite, id) => sqlite.prepare(`SELECT id, ${SUPPLIER_COLUMNS.join(', ')} FROM suppliers WHERE id = @id`).get({ id })
const auditCount = (sqlite) => sqlite.prepare(`SELECT COUNT(*) AS n FROM audit_logs WHERE user_name = @u`).get({ u: AUDIT_USER }).n
const batchesFor = (sqlite, supplierId) => sqlite.prepare(`SELECT id, supplier_id, supplier_name FROM product_batches WHERE supplier_id = @id ORDER BY id`).all({ id: supplierId })
const invoicesFor = (sqlite, supplierId) => sqlite.prepare(`SELECT id, supplier_id, supplier_name FROM supplier_invoices WHERE supplier_id = @id ORDER BY id`).all({ id: supplierId })
const returnsFor = (sqlite, supplierId) => sqlite.prepare(`SELECT id, supplier_id, supplier_name FROM returns WHERE supplier_id = @id ORDER BY id`).all({ id: supplierId })

// The twin: buildContactMergePlan, keeper vs each loser in ascending id
// order -- exactly what an admin clicking "merge" repeatedly (or the bulk
// merge route) does for the same cluster.
function applyHelper(sqlite) {
  sqlite.transaction(() => {
    for (const cluster of CLUSTERS) {
      for (const loser of cluster.losers) {
        const keeper = sqlite.prepare(`SELECT * FROM suppliers WHERE id = @id`).get({ id: cluster.keep.id })
        const merged = sqlite.prepare(`SELECT * FROM suppliers WHERE id = @id`).get({ id: loser.id })
        const plan = buildContactMergePlan({
          table: 'suppliers',
          entity: 'supplier',
          editableColumns: SUPPLIER_COLUMNS,
          keeper,
          merged,
          hasCustomerReceivables: false,
          hasSupplierInvoices: true,
          audit: { operationId: `test-${loser.id}`, userId: null, userName: 'test', deviceName: null, deviceTz: null },
        })
        for (const s of plan.statements) sqlite.prepare(s.sql).run(s.params || {})
      }
    }
  })()
}

function run() {
  const a = chainBefore(MIGRATION)
  const orphansA = seed(a)
  const twin = chainBefore(MIGRATION)
  seed(twin)
  const controlBefore = SUP(a, CONTROL.id)
  const controlBatchesBefore = batchesFor(a, CONTROL.id)
  // the exact snapshot the first draft's bug would have destroyed.
  const unrelatedBefore = UNRELATED_SUPPLIERS.map((s) => ({
    supplier: SUP(a, s.id),
    batches: a.prepare(`SELECT id, supplier_id, supplier_name FROM product_batches WHERE supplier_id = @id OR (supplier_id IS NULL AND lower(trim(supplier_name)) = lower(trim(@name))) ORDER BY id`).all({ id: s.id, name: s.name }),
    returns: returnsFor(a, s.id),
    invoices: a.prepare(`SELECT id, supplier_id, supplier_name FROM supplier_invoices WHERE supplier_id = @id OR (supplier_id IS NULL AND lower(trim(supplier_name)) = lower(trim(@name))) ORDER BY id`).all({ id: s.id, name: s.name }),
    products: a.prepare(`SELECT id, supplier FROM products WHERE lower(trim(COALESCE(supplier,''))) = lower(trim(@name)) ORDER BY id`).all({ name: s.name }),
  }))

  applyMigration(a)
  applyHelper(twin)

  // 1. keeper/loser end state matches the real writer for every cluster.
  for (const cluster of CLUSTERS) {
    assert.deepStrictEqual(SUP(a, cluster.keep.id), SUP(twin, cluster.keep.id), `${cluster.label}: keeper ${cluster.keep.id} matches buildContactMergePlan`)
    const keeperNameNow = SUP(a, cluster.keep.id).name
    for (const loser of cluster.losers) {
      assert.strictEqual(SUP(a, loser.id), undefined, `${cluster.label}: loser ${loser.id} deleted (migration)`)
      assert.strictEqual(SUP(twin, loser.id), undefined, `${cluster.label}: loser ${loser.id} deleted (writer)`)
      assert.deepStrictEqual(batchesFor(a, loser.id), [], `${cluster.label}: no batch still points at loser ${loser.id} by id`)
      assert.deepStrictEqual(returnsFor(a, loser.id), [], `${cluster.label}: no return still points at loser ${loser.id}`)
      assert.deepStrictEqual(invoicesFor(a, loser.id), [], `${cluster.label}: no invoice still points at loser ${loser.id} by id`)
    }
    // orphaned (supplier_id NULL) rows named after a loser: repointed to the
    // keeper's current name text, same as the writer's name-based repoint.
    for (const orphan of orphansA.filter((o) => cluster.losers.some((l) => l.id === o.loserId))) {
      const batchRow = a.prepare(`SELECT supplier_id, supplier_name FROM product_batches WHERE id = @id`).get({ id: orphan.batchId })
      assert.strictEqual(batchRow.supplier_id, null, `${cluster.label}: orphan batch ${orphan.batchId} stays supplier_id NULL`)
      assert.strictEqual(batchRow.supplier_name, keeperNameNow, `${cluster.label}: orphan batch ${orphan.batchId} repointed to keeper's name`)
      const productRow = a.prepare(`SELECT supplier FROM products WHERE id = @id`).get({ id: orphan.productId })
      assert.strictEqual(productRow.supplier, keeperNameNow, `${cluster.label}: orphan product ${orphan.productId} repointed to keeper's name`)
      const invoiceRow = a.prepare(`SELECT supplier_id, supplier_name FROM supplier_invoices WHERE id = @id`).get({ id: orphan.invoiceId })
      assert.strictEqual(invoiceRow.supplier_id, null, `${cluster.label}: orphan invoice ${orphan.invoiceId} stays supplier_id NULL`)
      assert.strictEqual(invoiceRow.supplier_name, keeperNameNow, `${cluster.label}: orphan invoice ${orphan.invoiceId} repointed to keeper's name`)
    }
    const keeperBatches = batchesFor(a, cluster.keep.id)
    const twinKeeperBatches = batchesFor(twin, cluster.keep.id)
    assert.strictEqual(keeperBatches.length, cluster.losers.length, `${cluster.label}: every id-attributed batch repointed to the keeper`)
    assert.deepStrictEqual(keeperBatches.map((b) => b.supplier_name), twinKeeperBatches.map((b) => b.supplier_name), `${cluster.label}: repointed batch names match the writer`)
    assert.strictEqual(returnsFor(a, cluster.keep.id).length, cluster.losers.length, `${cluster.label}: every return repointed to the keeper`)
    assert.strictEqual(invoicesFor(a, cluster.keep.id).length, cluster.losers.length, `${cluster.label}: every id-attributed invoice repointed to the keeper`)
  }
  console.log('PASS migration result equals buildContactMergePlan applied pairwise, for both clusters')
  console.log('PASS orphaned (supplier_id NULL) name-only rows are repointed to the keeper too')

  // 2. backfill positive control: j_secrat keeper gained email/address/company/
  //    contact_person/notes/gender from its losers (all were NULL on the
  //    keeper); its phone (already set) was NOT overwritten.
  const jSecrat = SUP(a, 20)
  assert.strictEqual(jSecrat.phone, '012345678', 'j_secrat keeper phone untouched (already filled, not overwritten)')
  assert.strictEqual(jSecrat.email, 'jsecrat@example.com', 'j_secrat keeper email backfilled from loser 38')
  assert.strictEqual(jSecrat.address, 'Phnom Penh', 'j_secrat keeper address backfilled from loser 39')
  assert.strictEqual(jSecrat.company, 'J Secrat Co', 'j_secrat keeper company backfilled from loser 40')
  assert.strictEqual(jSecrat.contact_person, 'Sok', 'j_secrat keeper contact_person backfilled from loser 40')
  assert.strictEqual(jSecrat.notes, 'reliable', 'j_secrat keeper notes backfilled from loser 41')
  assert.strictEqual(jSecrat.gender, 'male', 'j_secrat keeper gender backfilled from loser 42')
  assert.strictEqual(jSecrat.name, 'j secrat', 'j_secrat keeper name never overwritten by a loser')
  console.log('PASS blank keeper columns backfilled from losers; an already-filled column is left alone')

  const lang = SUP(a, 23)
  assert.strictEqual(lang.phone, '011222333', 'lang keeper phone backfilled from its first loser (33)')
  console.log('PASS lang cluster backfill matches (single-column positive control)')

  // 3. unpinned control supplier is fully untouched.
  assert.deepStrictEqual(SUP(a, CONTROL.id), controlBefore, 'unpinned control supplier untouched')
  assert.deepStrictEqual(batchesFor(a, CONTROL.id), controlBatchesBefore, "unpinned control's batches untouched")
  console.log('PASS unpinned control supplier and its rows are untouched')

  // 4. THE POSITIVE CONTROL FOR THE ACTUAL BUG: the nine real, distinct
  //    suppliers the first draft's wrong id range would have wrongly merged
  //    into "Lang" are byte-for-byte untouched -- still present, same name,
  //    same id-attributed AND orphaned linked rows, same product text.
  for (let i = 0; i < UNRELATED_SUPPLIERS.length; i++) {
    const s = UNRELATED_SUPPLIERS[i]
    const before = unrelatedBefore[i]
    assert.deepStrictEqual(SUP(a, s.id), before.supplier, `unrelated supplier ${s.id} (${s.name}) untouched`)
    const afterBatches = a.prepare(`SELECT id, supplier_id, supplier_name FROM product_batches WHERE supplier_id = @id OR (supplier_id IS NULL AND lower(trim(supplier_name)) = lower(trim(@name))) ORDER BY id`).all({ id: s.id, name: s.name })
    assert.deepStrictEqual(afterBatches, before.batches, `unrelated supplier ${s.id} (${s.name}): batches untouched`)
    assert.deepStrictEqual(returnsFor(a, s.id), before.returns, `unrelated supplier ${s.id} (${s.name}): returns untouched`)
    const afterInvoices = a.prepare(`SELECT id, supplier_id, supplier_name FROM supplier_invoices WHERE supplier_id = @id OR (supplier_id IS NULL AND lower(trim(supplier_name)) = lower(trim(@name))) ORDER BY id`).all({ id: s.id, name: s.name })
    assert.deepStrictEqual(afterInvoices, before.invoices, `unrelated supplier ${s.id} (${s.name}): invoices untouched`)
    const afterProducts = a.prepare(`SELECT id, supplier FROM products WHERE lower(trim(COALESCE(supplier,''))) = lower(trim(@name)) ORDER BY id`).all({ name: s.name })
    assert.deepStrictEqual(afterProducts, before.products, `unrelated supplier ${s.id} (${s.name}): products untouched`)
  }
  console.log('PASS all nine unrelated suppliers (ids 24-32) and everything referencing them are byte-for-byte untouched (the actual bug this migration had)')

  // 5. one audit row per merged id, carrying the pre-image. Exactly 14 --
  //    9 "j secrat" + 5 "lang", not the first draft's 23.
  assert.strictEqual(auditCount(a), 14, 'one audit_logs row per merged id (9 + 5 = 14, not the first draft\'s 23)')
  for (const s of UNRELATED_SUPPLIERS) {
    assert.strictEqual(a.prepare(`SELECT 1 FROM audit_logs WHERE user_name = @u AND record_id = @id`).get({ u: AUDIT_USER, id: String(s.id) }), undefined, `no audit row for untouched supplier ${s.id}`)
  }
  const auditRow = a.prepare(`SELECT old_value, details FROM audit_logs WHERE user_name = @u AND record_id = '38'`).get({ u: AUDIT_USER })
  const old = JSON.parse(auditRow.old_value)
  assert.strictEqual(old.name, 'J Secrat', 'audit old_value is loser 38\'s own pre-image, not the keeper\'s')
  assert.strictEqual(old.email, 'jsecrat@example.com')
  assert.strictEqual(JSON.parse(auditRow.details).keeper_id, 20)
  console.log('PASS exactly 14 audit_logs rows, one per merged id, carrying that loser\'s pre-image; none for the nine unrelated suppliers')

  // 6. NAME GUARD positive control: a loser id that exists but whose name
  //    does NOT match its keeper (a hand-edit mistake, or exactly the class
  //    of bug the first draft had) is a no-op -- proven on a THIRD, fresh
  //    database so it cannot be masked by the main scenario's own state.
  {
    const g = chainBefore(MIGRATION)
    g.prepare(`INSERT INTO suppliers (id, name) VALUES (20, 'j secrat')`).run()
    // id 38 is in "j secrat"'s real loser range, but seeded with an
    // unrelated name -- the guard must refuse to touch it even though the
    // bare id match would have fired under the first draft.
    g.prepare(`INSERT INTO suppliers (id, name) VALUES (38, 'totally different supplier')`).run()
    g.prepare(`INSERT INTO products (id, name, supplier) VALUES (1, 'p', 'totally different supplier')`).run()
    g.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, supplier_id, supplier_name) VALUES (1, 1, '01012026', 38, 'totally different supplier')`).run()
    const before38 = g.prepare(`SELECT * FROM suppliers WHERE id = 38`).get()
    const beforeBatch = g.prepare(`SELECT * FROM product_batches WHERE id = 1`).get()
    const beforeProduct = g.prepare(`SELECT * FROM products WHERE id = 1`).get()
    applyMigration(g)
    assert.deepStrictEqual(g.prepare(`SELECT * FROM suppliers WHERE id = 38`).get(), before38, 'name-mismatched loser 38 is untouched (NAME GUARD no-op)')
    assert.deepStrictEqual(g.prepare(`SELECT * FROM product_batches WHERE id = 1`).get(), beforeBatch, 'its batch is untouched (never repointed to keeper 20)')
    assert.deepStrictEqual(g.prepare(`SELECT * FROM products WHERE id = 1`).get(), beforeProduct, 'its product is untouched')
    assert.strictEqual(auditCount(g), 0, 'no audit row is written for a name-mismatched id')
    assert.strictEqual(g.prepare(`SELECT COUNT(*) AS n FROM suppliers`).get().n, 2, 'both rows (keeper and the mismatched id) still present')
  }
  console.log('PASS a loser id that exists but whose name does not match its keeper is a no-op (NAME GUARD)')

  // 7. idempotent: a second run changes nothing.
  const supplierSnapshot = a.prepare(`SELECT * FROM suppliers ORDER BY id`).all()
  const batchSnapshot = a.prepare(`SELECT * FROM product_batches ORDER BY id`).all()
  const auditCountBefore = auditCount(a)
  applyMigration(a)
  assert.deepStrictEqual(a.prepare(`SELECT * FROM suppliers ORDER BY id`).all(), supplierSnapshot, 're-run: suppliers unchanged')
  assert.deepStrictEqual(a.prepare(`SELECT * FROM product_batches ORDER BY id`).all(), batchSnapshot, 're-run: product_batches unchanged')
  assert.strictEqual(auditCount(a), auditCountBefore, 're-run: no new audit rows')
  console.log('PASS re-running the file is a no-op (idempotent)')

  // 6. fresh chain: ids absent -> the file is inert, full chain still applies.
  const fresh = new Database(':memory:')
  for (const f of migrationFiles) fresh.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  assert.strictEqual(auditCount(fresh), 0, 'fresh chain: no audit rows')
  assert.strictEqual(fresh.prepare(`SELECT COUNT(*) AS n FROM suppliers`).get().n, 0)
  console.log(`PASS full chain applies on an empty database (${migrationFiles.length} migrations, 0164 inert)`)
}

run()
console.log('verify-0164-supplier-clusters: all checks passed')
