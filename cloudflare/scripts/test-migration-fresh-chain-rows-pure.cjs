// What the shared migration chain leaves in a database that started EMPTY.
//
// This is the known-bad baseline. Replaying all 215 migrations on an empty SQLite
// does not give a clean database: it gives the first client's organization, 4,240 of
// its expense rows, its loyalty shutdown and a few other rows. That is why a new
// client is provisioned from cloudflare/baseline/schema-0269.sql + the ledger
// stamp (ops/scripts/client/provision-database.mjs) and never from the chain.
//
// Part 1 asserts, exactly, every row the chain leaves and which migration put it
// there. Part 2 asserts the baseline route leaves none of the business ones.
// If a new migration (0270+) starts leaving rows, part 1 goes red: the answer is
// to remove the rows from the migration, not to add them to the list.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const base = require('./harness/client_baseline.cjs')
const { MIGRATIONS_DIR } = require('./harness/migration_sql.cjs')

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

// Every table that holds a row after the full chain, with its count and its source.
// FTS shadow tables and sqlite_sequence are excluded by rowCensus.
const CHAIN_LEAVES = {
  fees: { rows: 4240, from: '0064', note: 'the first client\'s expense history: USD 129,696.60 / KHR 82,419,900, all created_by_name = Old system (0072 retypes 3,130 as delivery)' },
  organizations: { rows: 1, from: '0030', note: 'the first client\'s organization; the runtime adds the configured org as a SECOND row because PREVIOUS_IDENTITIES omits this slug' },
  organization_groups: { rows: 1, from: '0030', note: 'Main group of that org' },
  settings: { rows: 3, from: '0118 + 0179 + 0251', note: 'shift_scope_mode, shift_admin_exempt (generic), loyalty_points_enabled = false (the first client\'s loyalty shutdown)' },
  system_flags: { rows: 4, from: '0243 + 0250 + 0251', note: 'stock_schema_epoch, stock_schema_receipt_boundary, multilot_revert_watermark (generic), loyalty_points_reset (the first client\'s)' },
  audit_logs: { rows: 1, from: '0251', note: 'reset_data / loyalty checkpoint audit row' },
  loyalty_points_reset_log: { rows: 2, from: '0117 + 0179', note: 'two loyalty reset log rows, zero counts' },
  imported_sale_stock_skip_guard_0235: { rows: 2, from: '0235', note: 'the migration\'s own assertion rows' },
}

const BUSINESS_TABLES_THAT_MUST_BE_EMPTY = ['fees', 'organizations', 'organization_groups', 'user_aliases', 'customers', 'products', 'sales', 'sale_items', 'suppliers', 'branches', 'users', 'product_batches', 'inventory_movements', 'loyalty_point_adjustments', 'customer_receivables', 'supplier_invoices']

check('part 1 (known-bad): the full chain on an empty database leaves exactly these rows', () => {
  const db = base.replayChain()
  try {
    const census = base.rowCensus(db)
    const want = Object.fromEntries(Object.entries(CHAIN_LEAVES).map(([t, v]) => [t, v.rows]))
    assert.deepEqual(census, want, 'the chain leaves different rows than documented; if a migration 0270+ now writes rows, fix the migration')
    const fees = db.prepare("SELECT COUNT(*) n, ROUND(SUM(amount_usd), 2) usd, SUM(amount_khr) khr, SUM(created_by_name = 'Old system') marker, SUM(fee_type = 'delivery') delivery FROM fees").get()
    assert.deepEqual({ ...fees }, { n: 4240, usd: 129696.6, khr: 82419900, marker: 4240, delivery: 3130 })
    // The organization row is exactly the literal row migration 0030 selects.
    const seed = /SELECT '([^']+)', '([^']+)', '([^']+)', 1, 0\s+WHERE NOT EXISTS/.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, '0030_default_organization_seed.sql'), 'utf8'))
    assert.ok(seed, '0030 no longer seeds an organization in the expected shape')
    assert.deepEqual({ ...db.prepare('SELECT name, slug, public_id FROM organizations').get() }, { name: seed[1], slug: seed[2], public_id: seed[3] })
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'loyalty_points_enabled'").get().value, 'false')
    assert.deepEqual(db.prepare('SELECT key FROM settings ORDER BY key').all().map((r) => r.key), ['loyalty_points_enabled', 'shift_admin_exempt', 'shift_scope_mode'])
    assert.deepEqual(db.prepare('SELECT key FROM system_flags ORDER BY key').all().map((r) => r.key), ['loyalty_points_reset', 'multilot_revert_watermark', 'stock_schema_epoch', 'stock_schema_receipt_boundary'])
    for (const t of ['user_aliases', 'customers', 'products', 'sales']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, 0, `${t} is empty after the chain (0098 and 0103 seed aliases only for users that already exist)`)
  } finally { db.close() }
})

check('part 2: provisioning from the baseline leaves none of those rows, only the seed constants and the ledger stamp', () => {
  const built = base.buildBaseline()
  const db = new (require('better-sqlite3'))(':memory:')
  try {
    base.provision(db, { baselineSql: built.text, stampNames: built.stampNames, expectedFingerprint: built.fingerprint })
    const census = base.rowCensus(db)
    assert.deepEqual(census, { d1_migrations: built.stampNames.length, system_flags: base.SEED_ROWS.length })
    for (const t of [...BUSINESS_TABLES_THAT_MUST_BE_EMPTY, 'settings', 'audit_logs', 'loyalty_points_reset_log']) assert.equal(census[t] || 0, 0, `${t} must be empty on a provisioned client`)
    assert.deepEqual(db.prepare('SELECT key, value FROM system_flags ORDER BY key').all().map((r) => [r.key, r.value]), [
      ['multilot_revert_watermark', '0'], ['stock_schema_epoch', 'legacy-separate-pool-v1'], ['stock_schema_receipt_boundary', '0'],
    ])
    assert.equal(db.prepare("SELECT COUNT(*) n FROM settings WHERE key LIKE 'loyalty%'").get().n, 0, 'no loyalty setting is written: absent reads as off in the triggers and in loyaltyPointsEnabled()')
  } finally { db.close() }
})

check('part 2: the seed constants are the ones the chain itself installs on an empty database', () => {
  const db = base.replayChain()
  try {
    const chain = Object.fromEntries(db.prepare('SELECT key, value FROM system_flags').all().map((r) => [r.key, r.value]))
    for (const row of base.SEED_ROWS) assert.equal(chain[row.key], row.value, `${row.key}: baseline seed differs from what ${row.from} installs`)
  } finally { db.close() }
})

console.log(`\n${passed} checks passed`)
