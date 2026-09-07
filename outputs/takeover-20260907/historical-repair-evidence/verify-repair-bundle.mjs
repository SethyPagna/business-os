#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  fingerprint,
  redactErrorMessage,
  runApply,
  validateBundle,
  verifyCloudflareOperator,
} from './run-historical-repair.mjs'

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(evidenceDir, '../../..')
const builder = join(evidenceDir, 'build-repair-bundle.mjs')
const require = createRequire(join(root, 'cloudflare/package.json'))
const Database = require('better-sqlite3')
const work = mkdtempSync(join(tmpdir(), 'bos-historical-repair-'))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const d1Rows = (file) => readJson(join(evidenceDir, file)).result[0].results

try {
  const schemaRows = readJson(join(root, 'outputs/takeover-20260907/production-schema.json')).result[0].results
  const ddl = (name) => schemaRows.find((row) => row.name === name).sql
  const auditDdl = `CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, user_name TEXT,
    action TEXT, entity TEXT, entity_id TEXT, details TEXT, table_name TEXT,
    record_id TEXT, old_value TEXT, new_value TEXT, device_name TEXT,
    device_tz TEXT, client_time TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`
  const feeRows = Array.from({ length: 18 }, (_, index) => d1Rows(`fee-null-branch-page-${String(index + 1).padStart(2, '0')}.json`)).flat()
  const saleRows = d1Rows('sales-16842-16863-headers.json')
  const itemRows = d1Rows('sales-16842-16863-lines.json')

  const seed = (file) => {
    const db = new Database(file)
    for (const table of ['branches', 'fees', 'sales', 'sale_items', 'sale_item_batch_allocations']) db.exec(ddl(table))
    db.exec(auditDdl)
    db.prepare("INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Shop',1,1)").run()
    const fee = db.prepare('INSERT INTO fees(id,fee_type,fee_date,branch_id) VALUES(?,?,?,NULL)')
    const sale = db.prepare(`INSERT INTO sales(
      id,receipt_number,sale_status,branch_id,branch_name,is_delivery,
      delivery_contact_id,stock_skipped,source_return_id,created_at,updated_at,client_request_id
    ) VALUES(@id,@receipt_number,@sale_status,NULL,NULL,@is_delivery,
      @delivery_contact_id,@stock_skipped,@source_return_id,@created_at,@updated_at,@client_request_id)`)
    const item = db.prepare('INSERT INTO sale_items(id,sale_id,branch_id) VALUES(?,?,NULL)')
    db.transaction(() => {
      feeRows.forEach((row) => fee.run(row.id, row.fee_type, '2026-09-07'))
      saleRows.forEach((row) => sale.run(row))
      itemRows.forEach((row) => item.run(row.id, row.sale_id))
    })()
    return db
  }

  const databasePath = join(work, 'rehearsal.sqlite')
  const db = seed(databasePath)
  for (const table of ['fees', 'sales', 'sale_items']) {
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    for (const read of [1, 2]) writeFileSync(join(work, `${table}-${read}.json`), JSON.stringify(rows))
  }
  db.close()
  const pristineDatabasePath = join(work, 'pristine.sqlite')
  copyFileSync(databasePath, pristineDatabasePath)

  const executionInput = {
    run_id: 'historical-branch-repair-local-verifier',
    service_actor: 'codex-maintenance-owner-authorized',
    cloudflare_operator: {
      account_id: '743e5b727d139e85ed11679097f6f99e',
      api_token_id: 'local-verifier-token-id',
    },
    time_travel_bookmark: 'local-verifier-bookmark',
    full_row_exports: {
      read_1: { fees: 'fees-1.json', sales: 'sales-1.json', sale_items: 'sale_items-1.json' },
      read_2: { fees: 'fees-2.json', sales: 'sales-2.json', sale_items: 'sale_items-2.json' },
    },
  }
  const inputPath = join(work, 'execution-input.json')
  const bundleDir = join(work, 'execution-bundle')
  writeFileSync(inputPath, JSON.stringify(executionInput, null, 2))
  execFileSync(process.execPath, [builder, '--execution-input', inputPath, '--output-dir', bundleDir], { cwd: root, stdio: 'pipe' })
  const generatedManifest = readJson(join(bundleDir, 'execution-manifest.json'))
  const generatedBatch = readJson(join(bundleDir, 'd1-batch.json'))
  assert(generatedBatch.statement_count === 46 && generatedBatch.statements.length === 46, 'direct D1 batch artifact does not contain 46 statements')
  assert(generatedBatch.statements_sha256 === fingerprint(generatedBatch.statements), 'direct 46-statement array is not independently hash-bound')
  assert(generatedBatch.statements_sha256 === generatedManifest.execution.d1_statements_sha256, 'direct statement-array hash is not bound to the execution manifest')
  assert(generatedBatch.content_sha256 === generatedManifest.execution.d1_batch_sha256, 'direct D1 batch hash is not bound to the execution manifest')
  assert(generatedBatch.statements[0].sql.includes("SELECT NULL,'Codex maintenance (owner-authorized)'"), 'maintenance audit actor is not fixed and nullable')
  assert(!generatedBatch.statements.some((statement) => /\b(?:BEGIN|COMMIT)\b/i.test(statement.sql)), 'direct D1 batch includes a transaction wrapper')
  const reviewed = JSON.parse(execFileSync(process.execPath, [join(evidenceDir, 'run-historical-repair.mjs'), '--bundle', bundleDir], { cwd: root, encoding: 'utf8' }))
  assert(reviewed.status === 'review_only' && reviewed.remote_binding_opened === false && reviewed.production_write === false, 'default operator mode is not read-only')

  const repaired = new Database(databasePath)
  repaired.exec(readFileSync(join(bundleDir, 'historical-branch-repair.sql'), 'utf8'))
  const repairedCounts = {
    fees: repaired.prepare('SELECT COUNT(*) AS count FROM fees WHERE branch_id=2').get().count,
    sales: repaired.prepare("SELECT COUNT(*) AS count FROM sales WHERE branch_id=2 AND branch_name='Shop'").get().count,
    sale_items: repaired.prepare('SELECT COUNT(*) AS count FROM sale_items WHERE branch_id=2').get().count,
    audit: repaired.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='historical_branch_metadata_repair'").get().count,
  }
  for (const table of ['fees', 'sales', 'sale_items']) {
    const rows = repaired.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    for (const read of [1, 2]) writeFileSync(join(work, `post-${table}-${read}.json`), JSON.stringify(rows))
  }
  repaired.close()
  assert(JSON.stringify(repairedCounts) === JSON.stringify({ fees: 4255, sales: 22, sale_items: 56, audit: 1 }), 'repair counts mismatch')
  const auditReadDb = new Database(databasePath, { readonly: true })
  const repairedAudit = auditReadDb.prepare("SELECT user_id,user_name,details FROM audit_logs WHERE action='historical_branch_metadata_repair'").get()
  auditReadDb.close()
  assert(repairedAudit.user_id === null && repairedAudit.user_name === 'Codex maintenance (owner-authorized)', 'repair audit did not preserve truthful maintenance attribution')
  const repairedDetails = JSON.parse(repairedAudit.details)
  assert(repairedDetails.attribution?.actor?.origin === 'private_historical_repair_operator', 'repair audit origin is missing')
  assert(repairedDetails.attribution?.cloudflare_operator?.api_token_id === 'local-verifier-token-id', 'repair audit Cloudflare operator identity is missing')

  const recoveryInput = {
    execution_manifest: 'execution-bundle/execution-manifest.json',
    full_row_exports: {
      read_1: { fees: 'post-fees-1.json', sales: 'post-sales-1.json', sale_items: 'post-sale_items-1.json' },
      read_2: { fees: 'post-fees-2.json', sales: 'post-sales-2.json', sale_items: 'post-sale_items-2.json' },
    },
  }
  const recoveryInputPath = join(work, 'recovery-input.json')
  const recoveryDir = join(work, 'recovery-bundle')
  writeFileSync(recoveryInputPath, JSON.stringify(recoveryInput, null, 2))
  execFileSync(process.execPath, [builder, '--recovery-input', recoveryInputPath, '--output-dir', recoveryDir], { cwd: root, stdio: 'pipe' })
  const generatedRecoveryBatch = readJson(join(recoveryDir, 'd1-recovery-batch.json'))
  assert(generatedRecoveryBatch.statement_count === 46 && generatedRecoveryBatch.statements.length === 46, 'direct recovery D1 batch artifact does not contain 46 statements')
  validateBundle(recoveryDir, 'recovery')
  const recovered = new Database(databasePath)
  recovered.exec(readFileSync(join(recoveryDir, 'historical-branch-recovery.sql'), 'utf8'))
  const recoveredCounts = {
    fees: recovered.prepare('SELECT COUNT(*) AS count FROM fees WHERE branch_id IS NULL').get().count,
    sales: recovered.prepare('SELECT COUNT(*) AS count FROM sales WHERE branch_id IS NULL AND branch_name IS NULL').get().count,
    sale_items: recovered.prepare('SELECT COUNT(*) AS count FROM sale_items WHERE branch_id IS NULL').get().count,
    recovery_audit: recovered.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action='historical_branch_metadata_repair_recovery'").get().count,
  }
  recovered.close()
  assert(JSON.stringify(recoveredCounts) === JSON.stringify({ fees: 4255, sales: 22, sale_items: 56, recovery_audit: 1 }), 'recovery counts mismatch')

  const driftPath = join(work, 'drift.sqlite')
  const driftDb = seed(driftPath)
  driftDb.prepare('UPDATE fees SET branch_id=3 WHERE id=1').run()
  let guardFailed = false
  try { driftDb.exec(readFileSync(join(bundleDir, 'historical-branch-repair.sql'), 'utf8')) }
  catch (error) { guardFailed = /malformed JSON/.test(String(error.message)) }
  const driftCounts = {
    shop_fees: driftDb.prepare('SELECT COUNT(*) AS count FROM fees WHERE branch_id=2').get().count,
    audit: driftDb.prepare('SELECT COUNT(*) AS count FROM audit_logs').get().count,
  }
  driftDb.close()
  assert(guardFailed && driftCounts.shop_fees === 0 && driftCounts.audit === 0, 'transaction guard did not fail atomically')

  const alteredRead = readJson(join(work, 'fees-2.json'))
  alteredRead[0].amount_usd = 1
  writeFileSync(join(work, 'fees-2-drift.json'), JSON.stringify(alteredRead))
  const mismatchInput = { ...executionInput, full_row_exports: { ...executionInput.full_row_exports, read_2: { ...executionInput.full_row_exports.read_2, fees: 'fees-2-drift.json' } } }
  const mismatchInputPath = join(work, 'mismatch-input.json')
  writeFileSync(mismatchInputPath, JSON.stringify(mismatchInput, null, 2))
  let mismatchRejected = false
  try { execFileSync(process.execPath, [builder, '--execution-input', mismatchInputPath, '--output-dir', join(work, 'must-not-build')], { cwd: root, stdio: 'pipe' }) }
  catch (error) { mismatchRejected = String(error.stderr).includes('full-row hash changed between read 1 and read 2') }
  assert(mismatchRejected, 'two-read full-row drift was not rejected')

  const arbitraryActorInput = { ...executionInput, actor: { id: 7, name: 'Invented actor' } }
  const arbitraryActorInputPath = join(work, 'arbitrary-actor-input.json')
  writeFileSync(arbitraryActorInputPath, JSON.stringify(arbitraryActorInput, null, 2))
  let arbitraryActorRejected = false
  try { execFileSync(process.execPath, [builder, '--execution-input', arbitraryActorInputPath, '--output-dir', join(work, 'must-not-build-actor')], { cwd: root, stdio: 'pipe' }) }
  catch (error) { arbitraryActorRejected = String(error.stderr).includes('execution input actor is not accepted') }
  assert(arbitraryActorRejected, 'arbitrary application actor was accepted')

  const tamperedDir = join(work, 'tampered-bundle')
  cpSync(bundleDir, tamperedDir, { recursive: true })
  const tamperedBatch = readJson(join(tamperedDir, 'd1-batch.json'))
  tamperedBatch.statements[1].sql = tamperedBatch.statements[1].sql.replace('SET branch_id = 2', 'SET branch_id = 3')
  tamperedBatch.statements_sha256 = fingerprint(tamperedBatch.statements)
  tamperedBatch.content_sha256 = fingerprint(Object.fromEntries(Object.entries(tamperedBatch).filter(([key]) => key !== 'content_sha256')))
  writeFileSync(join(tamperedDir, 'd1-batch.json'), JSON.stringify(tamperedBatch, null, 2))
  const tamperedExecutionManifest = readJson(join(tamperedDir, 'execution-manifest.json'))
  tamperedExecutionManifest.execution.d1_batch_sha256 = tamperedBatch.content_sha256
  tamperedExecutionManifest.execution.d1_statements_sha256 = tamperedBatch.statements_sha256
  tamperedExecutionManifest.execution_bundle_sha256 = fingerprint(Object.fromEntries(Object.entries(tamperedExecutionManifest).filter(([key]) => key !== 'execution_bundle_sha256')))
  writeFileSync(join(tamperedDir, 'execution-manifest.json'), JSON.stringify(tamperedExecutionManifest, null, 2))
  let tamperRejected = false
  try { validateBundle(tamperedDir, 'repair') } catch (error) { tamperRejected = /compiled historical repair plan/.test(String(error.message)) }
  assert(tamperRejected, 'self-consistent rehashed D1 batch that changed an update was accepted')

  const manifestTamperedDir = join(work, 'manifest-tampered-bundle')
  cpSync(bundleDir, manifestTamperedDir, { recursive: true })
  const manifestTamperedFrozenPath = join(work, 'manifest-tampered-frozen.json')
  const manifestTamperedFrozen = readJson(join(evidenceDir, 'repair-manifest.json'))
  const originalFeeIds = [...manifestTamperedFrozen.batching.fee_chunks[0].ids]
  const changedFeeIds = [5000, ...originalFeeIds.slice(1)]
  manifestTamperedFrozen.batching.fee_chunks[0].ids = changedFeeIds
  manifestTamperedFrozen.content_sha256 = fingerprint(Object.fromEntries(Object.entries(manifestTamperedFrozen).filter(([key]) => key !== 'content_sha256')))
  writeFileSync(manifestTamperedFrozenPath, JSON.stringify(manifestTamperedFrozen, null, 2))
  const manifestTamperedExecution = readJson(join(manifestTamperedDir, 'execution-manifest.json'))
  const originalManifestSha256 = manifestTamperedExecution.content_sha256
  const preservedExecution = manifestTamperedExecution.execution
  const rebuiltExecution = { ...manifestTamperedFrozen, execution: preservedExecution }
  const manifestTamperedBatch = readJson(join(manifestTamperedDir, 'd1-batch.json'))
  const originalIdsSql = originalFeeIds.join(',')
  const changedIdsSql = changedFeeIds.join(',')
  manifestTamperedBatch.manifest_sha256 = manifestTamperedFrozen.content_sha256
  manifestTamperedBatch.statements = manifestTamperedBatch.statements.map((statement) => ({
    ...statement,
    sql: statement.sql
      .replaceAll(originalIdsSql, changedIdsSql)
      .replaceAll(originalManifestSha256, manifestTamperedFrozen.content_sha256),
  }))
  manifestTamperedBatch.statements_sha256 = fingerprint(manifestTamperedBatch.statements)
  manifestTamperedBatch.content_sha256 = fingerprint(Object.fromEntries(Object.entries(manifestTamperedBatch).filter(([key]) => key !== 'content_sha256')))
  rebuiltExecution.execution = {
    ...preservedExecution,
    d1_batch_sha256: manifestTamperedBatch.content_sha256,
    d1_statements_sha256: manifestTamperedBatch.statements_sha256,
  }
  rebuiltExecution.execution_bundle_sha256 = fingerprint(rebuiltExecution)
  writeFileSync(join(manifestTamperedDir, 'execution-manifest.json'), JSON.stringify(rebuiltExecution, null, 2))
  writeFileSync(join(manifestTamperedDir, 'd1-batch.json'), JSON.stringify(manifestTamperedBatch, null, 2))
  let frozenManifestTamperRejected = false
  try { validateBundle(manifestTamperedDir, 'repair', { frozenManifestPath: manifestTamperedFrozenPath }) }
  catch (error) { frozenManifestTamperRejected = /pinned reviewed SHA-256|pinned reviewed plan/.test(String(error.message)) }
  assert(frozenManifestTamperRejected, 'self-consistent changed-ID frozen manifest and rehashed execution bundle were accepted')

  const secretSentinel = 'must-never-appear-in-errors'
  let tokenFailureSafe = false
  try {
    await verifyCloudflareOperator(
      { CLOUDFLARE_API_TOKEN: secretSentinel, CLOUDFLARE_ACCOUNT_ID: executionInput.cloudflare_operator.account_id },
      async () => ({ ok: false, json: async () => ({ errors: [{ message: secretSentinel }] }) }),
    )
  } catch (error) {
    tokenFailureSafe = !String(error.message).includes(secretSentinel)
  }
  assert(tokenFailureSafe, 'Cloudflare token verification leaked the token or upstream error')
  assert(!redactErrorMessage(new Error(`remote failure ${secretSentinel}`), { CLOUDFLARE_API_TOKEN: secretSentinel }).includes(secretSentinel), 'top-level operator error redaction leaked the token')

  const applyDatabasePath = join(work, 'operator-apply.sqlite')
  copyFileSync(pristineDatabasePath, applyDatabasePath)
  const applySqlite = new Database(applyDatabasePath)
  let batchCalls = 0
  let disposed = false
  const localD1 = {
    prepare(sql) {
      return {
        sql,
        async all() { return { results: applySqlite.prepare(sql).all() } },
      }
    },
    async batch(statements) {
      batchCalls += 1
      return applySqlite.transaction(() => statements.map((statement) => {
        const result = applySqlite.prepare(statement.sql).run()
        return { success: true, meta: { changes: result.changes }, results: [] }
      }))()
    },
  }
  const confirmations = {
    'confirm-quiet-window': true,
    'confirm-run-id': generatedManifest.execution.run_id,
    'confirm-manifest-sha256': generatedManifest.content_sha256,
    'confirm-batch-sha256': generatedBatch.content_sha256,
    'confirm-bookmark': generatedManifest.execution.time_travel_bookmark,
  }
  let confirmationRejectedBeforeBinding = false
  try {
    await runApply(validateBundle(bundleDir, 'repair'), { ...confirmations, 'confirm-batch-sha256': 'wrong' }, {
      verifyOperator: async () => { throw new Error('should not authenticate') },
      getPlatformProxy: async () => { throw new Error('should not open binding') },
    })
  } catch (error) { confirmationRejectedBeforeBinding = /confirm-batch-sha256 mismatch/.test(String(error.message)) }
  assert(confirmationRejectedBeforeBinding, 'incorrect confirmation did not fail before authentication/binding')
  let operatorResult
  try {
    operatorResult = await runApply(validateBundle(bundleDir, 'repair'), confirmations, {
      verifyOperator: async () => executionInput.cloudflare_operator,
      getPlatformProxy: async () => ({ env: { DB: localD1 }, dispose: async () => { disposed = true } }),
    })
  } finally {
    applySqlite.close()
  }
  assert(operatorResult.status === 'applied_and_verified' && batchCalls === 1 && disposed, 'operator did not execute exactly one batch and dispose its binding')

  const manifest = readJson(join(evidenceDir, 'repair-manifest.json'))
  const feeIds = manifest.batching.fee_chunks.flatMap((item) => item.ids)
  assert(manifest.batching.fee_chunks.length === 43, 'fee chunk count is not 43')
  assert(manifest.batching.fee_chunks.every((item) => item.ids.length <= 99), 'a fee chunk exceeds 99 IDs')
  assert(feeIds.length === 4255 && new Set(feeIds).size === 4255, 'fee chunk IDs are incomplete or duplicated')

  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    repaired: repairedCounts,
    recovered: recoveredCounts,
    drift_guard: { failed_atomically: guardFailed, ...driftCounts },
    two_read_hash_mismatch_rejected: mismatchRejected,
    arbitrary_actor_rejected: arbitraryActorRejected,
    batch_tamper_rejected: tamperRejected,
    frozen_manifest_tamper_rejected: frozenManifestTamperRejected,
    bad_confirmation_rejected_before_binding: confirmationRejectedBeforeBinding,
    token_error_redacted: tokenFailureSafe,
    operator: { status: operatorResult.status, batch_calls: batchCalls, disposed },
    fee_chunks: manifest.batching.fee_chunks.length,
    max_ids_per_chunk: Math.max(...manifest.batching.fee_chunks.map((item) => item.ids.length)),
  }, null, 2)}\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
