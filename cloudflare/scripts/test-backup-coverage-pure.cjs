// Locks the Part-77 CRITICAL fix (x3 audits) on lib/backup.ts, slices A+B:
//
//  A. BACKUP_TABLES covers the data a restore must bring back -- the lot
//     ledger above all (product_batches / branch_batch_stock /
//     *_batch_allocations), plus the money/loyalty/config tables b9's
//     follow-up sweep found equally absent (fees, loyalty_point_adjustments,
//     damaged_stock_lots, return_replacement_items, promotion_rules, ...) --
//     and keeps FK dependency order (parents before children), which the
//     restore relies on for its reverse-order deletes.
//  B. Backups stamp the schema (summary.schemaMigration) and the restore
//     refuses a backup taken on a NEWER schema BEFORE deleting anything --
//     the column-intersection insert would silently drop the newer columns'
//     data -- and reports (not hides) old backups that lack tables this
//     deployment backs up.
//
// Run: node scripts/test-backup-coverage-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function transpile(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', relPath), 'utf8')
  return ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  }).outputText
}

function loadModule(relPath, requireShim) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', transpile(relPath))(module.exports, requireShim, module)
  return module.exports
}

// backup.ts pulls in the R2 stream writer and restore stream; only the
// exported constants/helpers are exercised here, so stub the heavy imports.
const backup = loadModule('lib/backup.ts', (id) => {
  if (id === './backupRestoreStream') return { streamBackupEvents: async function* () {} }
  if (id === './r2') return {}
  if (id === './db') return {}
  return require(id)
})
const { BACKUP_TABLES, migrationNumber } = backup

let passed = 0
function check(name, fn) {
  fn()
  passed += 1
  console.log(`PASS ${name}`)
}

check('the lot ledger is in BACKUP_TABLES -- every table of it', () => {
  for (const table of ['product_batches', 'branch_batch_stock', 'sale_item_batch_allocations', 'return_item_batch_allocations', 'damaged_stock_lots']) {
    assert.ok(BACKUP_TABLES.includes(table), `${table} must be backed up`)
  }
})

check('the other silently-dropped business tables are covered too', () => {
  for (const table of [
    'fees', 'loyalty_point_adjustments', 'return_replacement_items', 'promotion_rules',
    'user_notes', 'pending_actions', 'customer_share_submissions',
    'product_duplicate_dismissals', 'contact_duplicate_dismissals',
    'dated_stock_count_batch_actions', 'rfid_tags', 'ai_provider_configs',
    'import_auto_merges', 'import_sales_commits', 'import_stock_action_commits',
    'import_stock_action_groups', 'import_stock_action_guards',
  ]) {
    assert.ok(BACKUP_TABLES.includes(table), `${table} must be backed up`)
  }
})

check('FK dependency order holds: every child sits after every parent it references', () => {
  const at = (t) => BACKUP_TABLES.indexOf(t)
  const before = (parent, child) => assert.ok(
    at(parent) > -1 && at(child) > at(parent),
    `${child} must come after ${parent} (restore deletes in reverse)`,
  )
  before('products', 'product_batches')
  before('product_batches', 'branch_batch_stock')
  before('branches', 'branch_batch_stock')
  before('product_batches', 'sale_item_batch_allocations')
  before('sale_items', 'sale_item_batch_allocations')
  before('product_batches', 'return_item_batch_allocations')
  before('return_items', 'return_item_batch_allocations')
  before('return_items', 'return_replacement_items')
  before('sales', 'sale_items')
  before('returns', 'return_items')
  before('products', 'product_images')
  before('promotions', 'promotion_rules')
  // promotion_product_links / portal_faqs / portal_business_profile were
  // removed from BACKUP_TABLES: no migration ever created them, so their
  // entries backed up nothing (7a sweep, Aug 31).
  before('users', 'user_notes')
  before('customers', 'customer_share_submissions')
})

check('auth/session ephemera stay deliberately excluded (a restore must not resurrect sessions)', () => {
  for (const table of ['user_sessions', 'trusted_devices', 'verification_codes', 'login_lockouts', 'rate_limit_events', 'cache_versions']) {
    assert.ok(!BACKUP_TABLES.includes(table), `${table} must NOT be backed up`)
  }
})

check('migrationNumber orders migration names by their leading number', () => {
  assert.strictEqual(migrationNumber('0085_import_retention.sql'), 85)
  assert.strictEqual(migrationNumber('0084_movements_batch_id'), 84)
  assert.strictEqual(migrationNumber('no-number'), null)
  assert.strictEqual(migrationNumber(null), null)
  assert.strictEqual(migrationNumber(''), null)
})

check('source lock: backups stamp summary.schemaMigration', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'backup.ts'), 'utf8')
  assert.ok(/schemaMigration: await latestAppliedMigration\(env\)/.test(src), 'the writer must stamp the schema into the summary')
})

check('source lock: the restore refuses a newer-schema backup BEFORE any delete, and reports absent tables', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'backup.ts'), 'utf8')
  const restoreAt = src.indexOf('export async function restoreCloudflareBackup')
  assert.ok(restoreAt > -1)
  const body = src.slice(restoreAt)
  const refusalAt = body.indexOf('backupMigrationNumber > liveMigrationNumber')
  const deleteAt = body.indexOf('DELETE FROM ${qid(table)}')
  assert.ok(refusalAt > -1, 'the newer-schema refusal must exist')
  assert.ok(deleteAt > -1, 'expected the table delete loop')
  assert.ok(refusalAt < deleteAt, 'the refusal must run before the first delete')
  assert.ok(/tablesNotInBackup/.test(body), 'the restore result must report tables the document lacks')
  assert.ok(/schemaMismatch/.test(body), 'the restore result must report a live/backup schema difference')
})

console.log(`\n${passed} check(s) passed.`)
