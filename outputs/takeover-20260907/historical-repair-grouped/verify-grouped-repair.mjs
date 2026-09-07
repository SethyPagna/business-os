#!/usr/bin/env node

import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  APPLY_ACTION,
  COMPLETE_ACTION,
  EXPECTED_ACCOUNT_ID,
  RECOVERY_ACTION,
  applyAllPending,
  applyGroup,
  assert,
  buildApplyStatements,
  buildCompletionStatements,
  completePlan,
  fingerprint,
  inspectGroup,
  recoverGroup,
  validateManifest,
  without,
} from './grouped-repair-core.mjs'
import { buildFromFiles, schemaColumnsFromSql } from './build-grouped-repair-bundle.mjs'
import { redactErrorMessage, runOperator } from './run-grouped-historical-repair.mjs'

const require = createRequire(resolve('cloudflare/package.json'))
const Database = require('better-sqlite3')
const work = mkdtempSync(join(tmpdir(), 'bos-grouped-repair-'))

const columns = {
  fees: ['id', 'fee_type', 'label', 'amount_usd', 'amount_khr', 'fee_date', 'sale_id', 'branch_id', 'notes', 'created_by', 'created_by_name', 'created_at', 'updated_at', 'delivery_contact_id'],
  sales: ['id', 'receipt_number', 'cashier_id', 'cashier_name', 'branch_id', 'branch_name', 'customer_name', 'customer_phone', 'customer_address', 'payment_method', 'payment_currency', 'exchange_rate', 'subtotal_usd', 'subtotal_khr', 'discount_usd', 'discount_khr', 'tax_usd', 'tax_khr', 'total_usd', 'total_khr', 'amount_paid_usd', 'amount_paid_khr', 'change_usd', 'change_khr', 'is_delivery', 'delivery_contact_id', 'delivery_contact_name', 'delivery_contact_phone', 'delivery_contact_address', 'delivery_fee_usd', 'delivery_fee_khr', 'delivery_fee_paid_by', 'sale_status', 'notes', 'items', 'device_name', 'device_tz', 'created_at', 'customer_id', 'membership_discount_usd', 'membership_discount_khr', 'membership_points_redeemed', 'updated_at', 'client_request_id', 'payment_details', 'loyalty_accrual', 'cancel_reason', 'cancel_note', 'cancelled_at', 'cancelled_by_name', 'status_before_cancel', 'cancel_fee_id', 'delivery_actual_cost_usd', 'delivery_actual_cost_khr', 'search_normalized', 'credit_due_date', 'source_return_id', 'legacy_receipt_number', 'stock_skipped', 'stock_skipped_at', 'stock_skipped_by_name', 'status_before_return', 'change_is_actual', 'change_exchange_rate', 'creation_snapshot_json'],
  sale_items: ['id', 'sale_id', 'product_id', 'product_name', 'sku', 'quantity', 'unit', 'applied_price_usd', 'applied_price_khr', 'cost_price_usd', 'cost_price_khr', 'total_usd', 'total_khr', 'branch_id', 'price_mode', 'product_discount_type', 'product_discount_label', 'product_discount_usd', 'product_discount_khr', 'base_price_usd', 'base_price_khr', 'manual_discount_type', 'manual_discount_value', 'manual_discount_usd', 'manual_discount_khr', 'batch_id', 'batch_label', 'batch_expiry_date', 'returned_quantity', 'damaged_lot_id'],
}

const integerColumns = /(^id$|_id$|^is_|^stock_skipped$|^change_is_actual$|^loyalty_accrual$)/
const realColumns = /(amount|price|total|discount|tax|rate|quantity|points|cost|change_)/
const columnType = (name) => integerColumns.test(name) ? 'INTEGER' : realColumns.test(name) ? 'REAL' : 'TEXT'
const tableSql = (table) => `CREATE TABLE ${table} (${columns[table].map((name) => `"${name}" ${name === 'id' ? 'INTEGER PRIMARY KEY' : columnType(name)}`).join(',')}${table === 'sales' ? ', CHECK (creation_snapshot_json IS NULL OR json_valid(creation_snapshot_json))' : ''})`

function baseRow(table, id) {
  const row = Object.fromEntries(columns[table].map((name) => [name, null]))
  row.id = id
  if (table === 'fees') Object.assign(row, { fee_type: 'expense', label: `fee-${id}`, amount_usd: 0, amount_khr: id, fee_date: '2026-01-01', created_by_name: 'Old system', created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' })
  if (table === 'sales') Object.assign(row, { receipt_number: `R-${id}`, payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, sale_status: 'completed', items: '[]', created_at: '2026-01-01 00:00:00', loyalty_accrual: 1, stock_skipped: 0, change_is_actual: 0 })
  if (table === 'sale_items') Object.assign(row, { sale_id: 16842 + ((id - 40134) % 22), product_id: 100 + (id % 5), product_name: `product-${id % 5}`, sku: `SKU-${id}`, quantity: 1, unit: 'pcs', price_mode: 'selling', returned_quantity: 0 })
  return row
}

function insertRows(sqlite, table, rows) {
  const names = columns[table]
  const statement = sqlite.prepare(`INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`)
  sqlite.transaction(() => { for (const row of rows) statement.run(...names.map((name) => row[name])) })()
}

function createFixture(path) {
  const sqlite = new Database(path)
  sqlite.exec(`${tableSql('fees')};${tableSql('sales')};${tableSql('sale_items')};
    CREATE TABLE branches (id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER,is_default INTEGER);
    INSERT INTO branches VALUES (2,'Shop',1,1);
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,user_name TEXT,action TEXT,entity TEXT,entity_id TEXT,details TEXT,table_name TEXT,record_id TEXT,old_value TEXT,new_value TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TRIGGER sale_creation_snapshot_immutable BEFORE UPDATE OF creation_snapshot_json ON sales WHEN OLD.creation_snapshot_json IS NOT NEW.creation_snapshot_json BEGIN SELECT RAISE(ABORT,'creation snapshot is immutable'); END;`)
  insertRows(sqlite, 'fees', Array.from({ length: 4255 }, (_, index) => baseRow('fees', index + 1)))
  insertRows(sqlite, 'sales', Array.from({ length: 22 }, (_, index) => baseRow('sales', 16842 + index)))
  insertRows(sqlite, 'sale_items', Array.from({ length: 56 }, (_, index) => baseRow('sale_items', 40134 + index)))
  return sqlite
}

function rowsFromDb(sqlite) {
  return Object.fromEntries(Object.keys(columns).map((table) => [table, sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all()]))
}

function makeD1(sqlite, options = {}) {
  const state = { batchCalls: 0, statementCounts: [], disposed: false }
  return {
    state,
    d1: {
      prepare(sql) {
        return {
          sql,
          params: [],
          bind(...params) { this.params = params; return this },
          async all() { return { results: sqlite.prepare(this.sql).all(...this.params) } },
        }
      },
      async batch(statements) {
        const batchCall = ++state.batchCalls
        state.statementCounts.push(statements.length)
        const result = sqlite.transaction(() => statements.map((statement, statementIndex) => {
          if (options.fail?.({ batchCall, statementIndex, statement })) throw new Error('injected atomic failure')
          const prepared = sqlite.prepare(statement.sql)
          if (prepared.reader) return { success: true, meta: { changes: 0 }, results: prepared.all(...statement.params) }
          const info = prepared.run(...statement.params)
          return { success: true, meta: { changes: info.changes }, results: [] }
        }))()
        if (options.ambiguous?.({ batchCall, statements })) throw new Error('injected ambiguous response after commit')
        return result
      },
    },
  }
}

function writeBuilderInputs(sqlite) {
  const schemaPath = join(work, 'schema.json')
  const inputPath = join(work, 'input.json')
  const schemaRows = Object.keys(columns).map((table) => ({ name: table, sql: tableSql(table) }))
  writeFileSync(schemaPath, JSON.stringify({ result: [{ results: schemaRows }] }))
  writeFileSync(inputPath, JSON.stringify({
    run_id: 'grouped-repair-test-run-0001',
    time_travel_bookmark: 'test-bookmark-0001',
    source_lineage_commit: 'a'.repeat(40),
    cloudflare_operator: { account_id: EXPECTED_ACCOUNT_ID, api_token_id: 'test-token-identity' },
  }))
  const rows = rowsFromDb(sqlite)
  const args = { input: inputPath, schema: schemaPath, out: join(work, 'unused') }
  for (const [table, key] of [['fees', 'fees'], ['sales', 'sales'], ['sale_items', 'sale-items']]) for (const read of [1, 2]) {
    const path = join(work, `${table}-${read}.json`)
    writeFileSync(path, JSON.stringify(rows[table]))
    args[`${key}-read-${read}`] = path
  }
  return args
}

function count(sqlite, sql, ...params) { return Number(sqlite.prepare(sql).get(...params).count) }
async function expectReject(run, pattern, label) {
  let error
  try { await run() } catch (caught) { error = caught }
  assert(error && pattern.test(String(error.message)), label)
}

let pristine
try {
  const pristinePath = join(work, 'pristine.sqlite')
  pristine = createFixture(pristinePath)
  const builderArgs = writeBuilderInputs(pristine)
  assert(schemaColumnsFromSql(tableSql('sales')).length === 65, 'schema parser did not preserve all 65 Sales columns')
  const manifest = buildFromFiles(builderArgs)
  validateManifest(manifest)
  assert(manifest.groups.length === 44 && manifest.groups.filter((group) => group.kind === 'fees').length === 43, 'builder did not create 43 fee groups plus one related group')
  assert(manifest.schema_columns.sales.at(-1) === 'creation_snapshot_json', 'manifest did not pin Sales column 65')
  assert(!JSON.stringify(manifest).includes('fee-1'), 'manifest leaked full source row text instead of hashes and IDs')
  const manifestPath = join(work, 'grouped-execution-manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  const tampered = structuredClone(manifest)
  tampered.execution.run_id = 'grouped-repair-tampered-0001'
  tampered.content_sha256 = fingerprint(without(tampered, 'content_sha256'))
  await expectReject(() => Promise.resolve(validateManifest(tampered, { reviewedManifestSha256: manifest.content_sha256, reviewedLineageCommit: manifest.source.source_lineage_commit })), /reviewed operator pin/, 'self-consistent manifest tamper bypassed the reviewed pin')

  let reviewOpenedRemote = false
  const review = await runOperator({ manifest: manifestPath }, { getPlatformProxy: async () => { reviewOpenedRemote = true; throw new Error('must not open') } })
  assert(review.status === 'review_only' && !reviewOpenedRemote && review.production_write === false, 'review mode opened a remote binding')
  let unpinnedOpenedRemote = false
  await expectReject(() => runOperator({
    manifest: manifestPath,
    'apply-all': true,
    'confirm-reviewed-execution': true,
    'confirm-run-id': manifest.execution.run_id,
    'confirm-manifest-sha256': manifest.content_sha256,
    'confirm-bookmark': manifest.execution.time_travel_bookmark,
  }, { getPlatformProxy: async () => { unpinnedOpenedRemote = true; throw new Error('must not open') } }), /no reviewed manifest pin/, 'unreviewed manifest did not fail closed')
  assert(!unpinnedOpenedRemote, 'unreviewed apply opened a binding')

  pristine.close()
  pristine = null
  const fullPath = join(work, 'full.sqlite')
  const fullSqlite = createFixture(fullPath)
  const fullBinding = makeD1(fullSqlite)
  let disposed = false
  const applied = await runOperator({
    manifest: manifestPath,
    'apply-all': true,
    'confirm-reviewed-execution': true,
    'confirm-run-id': manifest.execution.run_id,
    'confirm-manifest-sha256': manifest.content_sha256,
    'confirm-bookmark': manifest.execution.time_travel_bookmark,
  }, {
    reviewedManifestSha256: manifest.content_sha256,
    reviewedLineageCommit: manifest.source.source_lineage_commit,
    verifyOperator: async () => manifest.execution.cloudflare_operator,
    getPlatformProxy: async () => ({ env: { DB: fullBinding.d1 }, dispose: async () => { disposed = true } }),
  })
  assert(applied.status === 'all_groups_applied_and_verified' && disposed, 'operator did not apply and dispose cleanly')
  assert(fullBinding.state.batchCalls === 45, 'operator did not use 44 bounded group batches plus one completion batch')
  assert(JSON.stringify(fullBinding.state.statementCounts) === JSON.stringify([4, ...Array(42).fill(3), 5, 46]), 'operator atomic statement shapes changed')
  assert(count(fullSqlite, 'SELECT COUNT(*) AS count FROM fees WHERE branch_id=2') === 4255, 'fee groups did not all apply')
  assert(count(fullSqlite, 'SELECT COUNT(*) AS count FROM sales WHERE branch_id=2 AND branch_name=\'Shop\'') === 22, 'related Sales group did not apply')
  assert(count(fullSqlite, 'SELECT COUNT(*) AS count FROM sale_items WHERE branch_id=2') === 56, 'related sale-item group did not apply')
  assert(count(fullSqlite, 'SELECT COUNT(*) AS count FROM sales WHERE creation_snapshot_json IS NOT NULL') === 0, 'branch repair changed immutable creation snapshots')
  assert(count(fullSqlite, 'SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', APPLY_ACTION) === 44, 'group apply audits are incomplete')
  assert(count(fullSqlite, 'SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', COMPLETE_ACTION) === 1, 'plan completion audit is missing')
  const callsBeforeReplay = fullBinding.state.batchCalls
  const replay = await runOperator({
    manifest: manifestPath,
    'apply-all': true,
    'confirm-reviewed-execution': true,
    'confirm-run-id': manifest.execution.run_id,
    'confirm-manifest-sha256': manifest.content_sha256,
    'confirm-bookmark': manifest.execution.time_travel_bookmark,
  }, {
    reviewedManifestSha256: manifest.content_sha256,
    reviewedLineageCommit: manifest.source.source_lineage_commit,
    verifyOperator: async () => manifest.execution.cloudflare_operator,
    getPlatformProxy: async () => ({ env: { DB: fullBinding.d1 }, dispose: async () => {} }),
  })
  assert(replay.groups.every((group) => group.status === 'already_applied') && replay.completion.status === 'already_completed' && fullBinding.state.batchCalls === callsBeforeReplay, 'resume rewrote already completed groups')

  const rollbackSqlite = createFixture(join(work, 'rollback.sqlite'))
  const rollbackBinding = makeD1(rollbackSqlite, { fail: ({ statementIndex }) => statementIndex === 3 })
  await expectReject(() => applyGroup(rollbackBinding.d1, manifest, manifest.groups[0]), /explicit resume/, 'fee group failure did not stop safely')
  assert(count(rollbackSqlite, 'SELECT COUNT(*) AS count FROM fees WHERE branch_id=2') === 0 && count(rollbackSqlite, 'SELECT COUNT(*) AS count FROM audit_logs') === 0, 'failed fee group was not atomic')
  rollbackSqlite.close()

  const ambiguousSqlite = createFixture(join(work, 'ambiguous.sqlite'))
  const ambiguousBinding = makeD1(ambiguousSqlite, { ambiguous: ({ batchCall }) => batchCall === 1 })
  const ambiguous = await applyGroup(ambiguousBinding.d1, manifest, manifest.groups[1])
  assert(ambiguous.status === 'applied_after_ambiguous_response' && (await inspectGroup(ambiguousBinding.d1, manifest, manifest.groups[1])).state === 'applied', 'ambiguous committed group was not reconciled from audit and hash')
  ambiguousSqlite.close()

  const pausedSqlite = createFixture(join(work, 'ambiguous-pause.sqlite'))
  const pausedBinding = makeD1(pausedSqlite, { ambiguous: ({ batchCall }) => batchCall === 1 })
  const paused = await applyAllPending(pausedBinding.d1, manifest)
  assert(paused.status === 'paused_after_reconciled_ambiguous_response' && paused.groups.length === 1 && pausedBinding.state.batchCalls === 1, 'operator advanced after an ambiguous group response')
  assert(count(pausedSqlite, 'SELECT COUNT(*) AS count FROM fees WHERE branch_id=2') === 99 && count(pausedSqlite, 'SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', COMPLETE_ACTION) === 0, 'ambiguous pause changed a later group or completed the plan')
  pausedSqlite.close()

  const driftSqlite = createFixture(join(work, 'drift.sqlite'))
  const driftBinding = makeD1(driftSqlite)
  await expectReject(() => applyGroup(driftBinding.d1, manifest, manifest.groups[0], { afterPreRead: async () => driftSqlite.prepare('UPDATE fees SET label=? WHERE id=1').run('concurrent') }), /manual inspection/, 'target-row drift did not fail closed')
  assert(count(driftSqlite, 'SELECT COUNT(*) AS count FROM audit_logs') === 0 && count(driftSqlite, 'SELECT COUNT(*) AS count FROM fees WHERE branch_id=2') === 0, 'drift guard allowed audit or branch mutation')
  driftSqlite.close()

  const unrelatedSqlite = createFixture(join(work, 'unrelated.sqlite'))
  const unrelatedBinding = makeD1(unrelatedSqlite)
  const unrelated = await applyGroup(unrelatedBinding.d1, manifest, manifest.groups[0], { afterPreRead: async () => unrelatedSqlite.prepare('UPDATE fees SET label=? WHERE id=1000').run('unrelated') })
  assert(unrelated.status === 'applied_and_verified' && unrelatedSqlite.prepare('SELECT label FROM fees WHERE id=1000').get().label === 'unrelated', 'unrelated row concurrency was overblocked or overwritten')
  unrelatedSqlite.close()

  const duplicateSqlite = createFixture(join(work, 'duplicate.sqlite'))
  duplicateSqlite.prepare("INSERT INTO audit_logs(action,entity,entity_id,record_id) VALUES (?,'historical_metadata_repair',?,?)").run(APPLY_ACTION, manifest.execution.run_id, manifest.groups[2].id)
  const duplicateBinding = makeD1(duplicateSqlite)
  await expectReject(() => applyGroup(duplicateBinding.d1, manifest, manifest.groups[2]), /inconsistent/, 'duplicate/stale audit did not block apply')
  assert(duplicateBinding.state.batchCalls === 0, 'duplicate audit reached a mutation batch')
  duplicateSqlite.close()

  const recoverySqlite = createFixture(join(work, 'recovery.sqlite'))
  const recoveryBinding = makeD1(recoverySqlite)
  await applyGroup(recoveryBinding.d1, manifest, manifest.groups[1])
  const recovered = await recoverGroup(recoveryBinding.d1, manifest, manifest.groups[1])
  assert(recovered.status === 'recovered_and_verified' && (await inspectGroup(recoveryBinding.d1, manifest, manifest.groups[1])).state === 'recovered', 'group recovery did not restore exact pre-state')
  assert(count(recoverySqlite, 'SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', APPLY_ACTION) === 1 && count(recoverySqlite, 'SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', RECOVERY_ACTION) === 1, 'recovery deleted or failed to append audit history')
  recoverySqlite.close()

  const relatedSqlite = createFixture(join(work, 'related-rollback.sqlite'))
  const relatedBinding = makeD1(relatedSqlite, { fail: ({ statementIndex }) => statementIndex === 4 })
  await expectReject(() => applyGroup(relatedBinding.d1, manifest, manifest.groups.at(-1)), /explicit resume/, 'related group failure did not stop safely')
  assert(count(relatedSqlite, 'SELECT COUNT(*) AS count FROM sales WHERE branch_id IS NOT NULL') === 0 && count(relatedSqlite, 'SELECT COUNT(*) AS count FROM sale_items WHERE branch_id IS NOT NULL') === 0 && count(relatedSqlite, 'SELECT COUNT(*) AS count FROM audit_logs') === 0, 'Sales and sale-items did not roll back together')
  relatedSqlite.close()

  const completionDriftSqlite = createFixture(join(work, 'completion-drift.sqlite'))
  const completionDriftBinding = makeD1(completionDriftSqlite)
  for (const group of manifest.groups) await applyGroup(completionDriftBinding.d1, manifest, group)
  completionDriftSqlite.prepare('UPDATE fees SET notes=? WHERE id=1').run('late drift')
  await expectReject(() => completePlan(completionDriftBinding.d1, manifest), /cannot complete plan/, 'completion ignored full-row drift')
  assert(count(completionDriftSqlite, 'SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', COMPLETE_ACTION) === 0, 'completion audit persisted despite drift')
  completionDriftSqlite.close()

  const groupOneRows = { fees: fullSqlite.prepare(`SELECT * FROM fees WHERE id IN (${manifest.groups[0].tables.fees.ids.join(',')}) ORDER BY id`).all() }
  const representative = [
    ...buildApplyStatements(manifest, manifest.groups[0], groupOneRows),
    ...buildCompletionStatements(manifest, Object.fromEntries(manifest.groups.map((group) => [group.id, Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, fullSqlite.prepare(`SELECT * FROM ${table} WHERE id IN (${descriptor.ids.join(',')}) ORDER BY id`).all()]))]))),
  ]
  assert(representative.every((statement) => Buffer.byteLength(statement.sql) < 100_000 && (statement.params || []).length <= 1), 'a grouped statement exceeds D1 SQL/parameter limits')
  const statementPath = join(work, 'depth-statements.json')
  writeFileSync(statementPath, JSON.stringify(representative))
  fullSqlite.close()
  const pythonSource = `import json,sqlite3,sys\ndb,source=sys.argv[1:3]\nc=sqlite3.connect(db)\nc.setlimit(sqlite3.SQLITE_LIMIT_EXPR_DEPTH,100)\nitems=json.load(open(source,encoding='utf-8'))\nfor item in items:c.execute('EXPLAIN '+item['sql'],item.get('params',[])).fetchall()\nc.close()\nprint('PASS depth100')\n`
  const python = process.platform === 'win32' ? ['py', '-c', pythonSource, fullPath, statementPath] : ['python3', '-c', pythonSource, fullPath, statementPath]
  const depth = spawnSync(python[0], python.slice(1), { encoding: 'utf8' })
  assert(depth.status === 0 && depth.stdout.includes('PASS depth100'), `SQLite depth-100 compile failed: ${depth.stderr}`)

  const secret = 'never-print-this-token'
  assert(!redactErrorMessage(new Error(`failure ${secret}`), { CLOUDFLARE_API_TOKEN: secret }).includes(secret), 'error redaction leaked the token')
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    manifest_sha256: manifest.content_sha256,
    groups: manifest.groups.length,
    full_apply_batches: fullBinding.state.batchCalls,
    atomic_shapes: { first_fee: 4, remaining_fee: 3, related: 5, completion: 46 },
    checks: ['builder_double_read_and_65_columns', 'review_and_unpinned_fail_closed', 'all_groups_and_idempotent_resume', 'fee_atomic_rollback', 'ambiguous_commit_reconciliation_and_pause', 'target_drift_refusal', 'unrelated_row_concurrency', 'duplicate_audit_refusal', 'group_recovery', 'related_sales_items_atomicity', 'completion_full_row_drift', 'sqlite_expression_depth_100', 'token_redaction'],
    remote_binding_opened: false,
    production_write: false,
  }, null, 2)}\n`)
} finally {
  try { pristine?.close() } catch {}
  rmSync(work, { recursive: true, force: true })
}
