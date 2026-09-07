#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(evidenceDir, '../../..')
const operatorConfigPath = join(evidenceDir, 'operator-wrangler.toml')
const frozenManifestPath = join(evidenceDir, 'repair-manifest.json')
const expectedAccountId = '743e5b727d139e85ed11679097f6f99e'
const expectedDatabaseId = '49795be9-eabe-43f1-8e16-b86faed60cb1'
const expectedPlanId = 'historical-shop-branch-metadata-20260907'
const expectedManifestSha256 = '315b0a7bd1c8255613bc7259596c3720118c4dfc6757a1500422263b68528d5e'
const expectedActor = Object.freeze({
  kind: 'service',
  user_id: null,
  user_name: 'Codex maintenance (owner-authorized)',
  origin: 'private_historical_repair_operator',
  task: expectedPlanId,
  cloudflare_account_id: expectedAccountId,
})
const expectedOperatorConfig = `name = "business-os-historical-repair-operator"
main = "run-historical-repair.mjs"
compatibility_date = "2026-09-07"
account_id = "${expectedAccountId}"

# Execution-only remote binding. This file is never used by normal app development.
[[d1_databases]]
binding = "DB"
database_name = "business-os"
database_id = "${expectedDatabaseId}"
remote = true
`

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  return value
}
const stableJson = (value) => JSON.stringify(stable(value))
const fingerprint = (value) => sha256(stableJson(value))
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([entryKey]) => entryKey !== key))
const redactErrorMessage = (error, env = process.env) => {
  let message = String(error?.message || 'Historical repair operator failed')
  const token = String(env.CLOUDFLARE_API_TOKEN || '')
  if (token) message = message.replaceAll(token, '[redacted]')
  return message
}

function parseArgs(tokens = process.argv.slice(2)) {
  const allowedFlags = new Set(['apply', 'identify', 'confirm-quiet-window'])
  const allowedValues = new Set(['bundle', 'kind', 'confirm-run-id', 'confirm-manifest-sha256', 'confirm-batch-sha256', 'confirm-bookmark'])
  const parsed = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    assert(token.startsWith('--'), `Unexpected argument: ${token}`)
    const key = token.slice(2)
    assert(allowedFlags.has(key) || allowedValues.has(key), `Unknown option: --${key}`)
    assert(parsed[key] === undefined, `Duplicate option: --${key}`)
    if (allowedFlags.has(key)) parsed[key] = true
    else {
      const value = tokens[index + 1]
      assert(value && !value.startsWith('--'), `Missing value for --${key}`)
      parsed[key] = value
      index += 1
    }
  }
  return parsed
}

function validateOperatorConfig() {
  const text = readFileSync(operatorConfigPath, 'utf8').replaceAll('\r\n', '\n')
  assert(text === expectedOperatorConfig, 'operator config differs from the exact execution-only remote D1 configuration')
}

const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`
const idLiterals = (ids) => ids.map((id) => String(id)).join(',')

function guardCondition(manifest) {
  const feeIds = manifest.batching.fee_chunks.flatMap((item) => item.ids)
  const saleIds = manifest.batching.sale_chunk.ids
  const lineIds = manifest.batching.sale_item_chunk.ids
  return [
    `(SELECT COUNT(*) FROM branches WHERE id=2 AND name='Shop' AND is_active=1 AND is_default=1)=1`,
    `(SELECT COUNT(*) FROM fees WHERE id IN (${idLiterals(feeIds)}) AND branch_id IS NULL)=${feeIds.length}`,
    `(SELECT COUNT(*) FROM sales WHERE id IN (${idLiterals(saleIds)}) AND branch_id IS NULL AND branch_name IS NULL)=${saleIds.length}`,
    `(SELECT COUNT(*) FROM sale_items WHERE id IN (${idLiterals(lineIds)}) AND branch_id IS NULL)=${lineIds.length}`,
  ].join('\n  AND ')
}

function updateSql(manifest, kind) {
  const recovery = kind === 'recovery'
  const fees = manifest.batching.fee_chunks.map((item) => recovery
    ? `UPDATE fees\nSET branch_id = NULL\nWHERE branch_id = 2 AND id IN (${idLiterals(item.ids)}); -- expect ${item.expected_changes}`
    : `UPDATE fees\nSET branch_id = 2\nWHERE branch_id IS NULL AND id IN (${idLiterals(item.ids)}); -- expect ${item.expected_changes}`)
  const sales = manifest.batching.sale_chunk
  const items = manifest.batching.sale_item_chunk
  return [
    ...fees,
    recovery
      ? `UPDATE sales\nSET branch_id = NULL, branch_name = NULL\nWHERE branch_id = 2 AND branch_name = 'Shop' AND id IN (${idLiterals(sales.ids)}); -- expect ${sales.expected_changes}`
      : `UPDATE sales\nSET branch_id = 2, branch_name = 'Shop'\nWHERE branch_id IS NULL AND branch_name IS NULL AND id IN (${idLiterals(sales.ids)}); -- expect ${sales.expected_changes}`,
    recovery
      ? `UPDATE sale_items\nSET branch_id = NULL\nWHERE branch_id = 2 AND id IN (${idLiterals(items.ids)}); -- expect ${items.expected_changes}`
      : `UPDATE sale_items\nSET branch_id = 2\nWHERE branch_id IS NULL AND id IN (${idLiterals(items.ids)}); -- expect ${items.expected_changes}`,
  ]
}

function repairAuditSql(manifest) {
  const execution = manifest.execution
  const details = {
    run_id: execution.run_id,
    manifest_sha256: manifest.content_sha256,
    time_travel_bookmark: execution.time_travel_bookmark,
    before_full_row_sha256: execution.before_full_row_sha256,
    row_counts: manifest.target.rows,
    columns_changed: manifest.target.columns,
    attribution: {
      actor: execution.actor,
      cloudflare_operator: execution.cloudflare_operator,
      authorization: 'owner-authorized branch-only historical metadata correction',
    },
  }
  return `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)\nSELECT NULL,${sqlString(expectedActor.user_name)},\n  CASE WHEN ${guardCondition(manifest)} THEN 'historical_branch_metadata_repair' ELSE json('historical branch repair precondition failed') END,\n  'historical_metadata_repair',${sqlString(execution.run_id)},${sqlString(JSON.stringify(details))},\n  'historical_metadata_repair',${sqlString(execution.run_id)},${sqlString(JSON.stringify({ before_full_row_sha256: execution.before_full_row_sha256 }))},${sqlString(JSON.stringify({ fees: { branch_id: 2 }, sales: { branch_id: 2, branch_name: 'Shop' }, sale_items: { branch_id: 2 } }))}; -- expect 1`
}

function recoveryAuditSql(manifest, batch) {
  const execution = manifest.execution
  const originalDetails = {
    run_id: execution.run_id,
    manifest_sha256: manifest.content_sha256,
    time_travel_bookmark: execution.time_travel_bookmark,
    before_full_row_sha256: execution.before_full_row_sha256,
    row_counts: manifest.target.rows,
    columns_changed: manifest.target.columns,
    attribution: {
      actor: execution.actor,
      cloudflare_operator: execution.cloudflare_operator,
      authorization: 'owner-authorized branch-only historical metadata correction',
    },
  }
  const details = {
    run_id: execution.run_id,
    manifest_sha256: manifest.content_sha256,
    reverts_action: 'historical_branch_metadata_repair',
    before_full_row_sha256: execution.before_full_row_sha256,
    verified_post_full_row_sha256: batch.verified_post_full_row_sha256,
    attribution: {
      actor: execution.actor,
      cloudflare_operator: execution.cloudflare_operator,
      authorization: 'owner-authorized branch-only historical metadata correction',
    },
  }
  return `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)\nSELECT NULL,${sqlString(expectedActor.user_name)},\n  CASE WHEN (SELECT COUNT(*) FROM audit_logs WHERE action='historical_branch_metadata_repair' AND entity_id=${sqlString(execution.run_id)} AND details=${sqlString(JSON.stringify(originalDetails))})=1 THEN 'historical_branch_metadata_repair_recovery' ELSE json('repair audit precondition failed') END,\n  'historical_metadata_repair',${sqlString(execution.run_id)},${sqlString(JSON.stringify(details))},\n  'historical_metadata_repair',${sqlString(execution.run_id)},${sqlString(JSON.stringify({ fees: { branch_id: 2 }, sales: { branch_id: 2, branch_name: 'Shop' }, sale_items: { branch_id: 2 } }))},${sqlString(JSON.stringify({ restored_before_full_row_sha256: execution.before_full_row_sha256 }))}; -- expect 1`
}

function expectedStatements(manifest, batch) {
  const sql = [batch.kind === 'repair' ? repairAuditSql(manifest) : recoveryAuditSql(manifest, batch), ...updateSql(manifest, batch.kind)]
  return sql.map((statementSql, index) => ({
    index,
    label: index === 0 ? (batch.kind === 'repair' ? 'audit_and_precondition_guard' : 'recovery_audit_guard') : index <= manifest.batching.fee_statement_count ? `fees_${index}` : index === manifest.batching.fee_statement_count + 1 ? 'sales' : 'sale_items',
    expected_changes: index === 0 ? 1 : index <= manifest.batching.fee_statement_count ? manifest.batching.fee_chunks[index - 1].expected_changes : index === manifest.batching.fee_statement_count + 1 ? manifest.batching.sale_chunk.expected_changes : manifest.batching.sale_item_chunk.expected_changes,
    sql: statementSql,
  }))
}

function validateBundle(bundleDir, kind = 'repair', dependencies = {}) {
  assert(kind === 'repair' || kind === 'recovery', '--kind must be repair or recovery')
  const directory = resolve(bundleDir || '')
  assert(bundleDir && existsSync(directory), '--bundle must name an existing generated bundle directory')
  const executionManifest = readJson(join(directory, 'execution-manifest.json'))
  const frozenManifest = readJson(dependencies.frozenManifestPath || frozenManifestPath)
  assert(frozenManifest.content_sha256 === expectedManifestSha256, 'frozen manifest does not carry the pinned reviewed SHA-256')
  assert(fingerprint(without(frozenManifest, 'content_sha256')) === expectedManifestSha256, 'frozen manifest content differs from the pinned reviewed plan')
  assert(executionManifest.plan_id === expectedPlanId, 'execution manifest plan ID mismatch')
  const executionFrozenManifest = without(without(executionManifest, 'execution'), 'execution_bundle_sha256')
  assert(stableJson(executionFrozenManifest) === stableJson(frozenManifest), 'execution manifest static plan does not match the pinned reviewed manifest')
  assert(fingerprint(without(executionManifest, 'execution_bundle_sha256')) === executionManifest.execution_bundle_sha256, 'execution manifest fingerprint mismatch')
  const execution = executionManifest.execution
  assert(execution?.actor_key === 'codex-maintenance-owner-authorized', 'execution manifest service actor key is not allowlisted')
  assert(stableJson(execution.actor) === stableJson(expectedActor), 'execution manifest service actor does not match the fixed maintenance identity')
  assert(execution.cloudflare_operator?.account_id === expectedAccountId, 'execution manifest Cloudflare account mismatch')
  assert(/^[A-Za-z0-9_-]{8,128}$/.test(execution.cloudflare_operator?.api_token_id || ''), 'execution manifest Cloudflare API token ID is invalid')
  assert(typeof execution.time_travel_bookmark === 'string' && execution.time_travel_bookmark.trim(), 'execution manifest Time Travel bookmark is missing')
  const batchName = kind === 'repair' ? 'd1-batch.json' : 'd1-recovery-batch.json'
  const batch = readJson(join(directory, batchName))
  assert(fingerprint(without(batch, 'content_sha256')) === batch.content_sha256, `${batchName} fingerprint mismatch`)
  assert(fingerprint(batch.statements) === batch.statements_sha256, `${batchName} direct statement-array fingerprint mismatch`)
  assert(batch.kind === kind && batch.plan_id === expectedPlanId, `${batchName} identity mismatch`)
  assert(batch.run_id === execution.run_id && batch.manifest_sha256 === executionManifest.content_sha256, `${batchName} manifest linkage mismatch`)
  if (kind === 'repair') {
    assert(batch.content_sha256 === execution.d1_batch_sha256, 'repair batch hash does not match execution manifest')
    assert(batch.statements_sha256 === execution.d1_statements_sha256, 'repair statement-array hash does not match execution manifest')
  }
  else assert(batch.source_execution_bundle_sha256 === executionManifest.execution_bundle_sha256, 'recovery batch does not match execution manifest')
  assert(batch.statement_count === 46 && batch.statements?.length === 46, 'D1 batch must contain exactly 46 statements')
  batch.statements.forEach((statement, index) => {
    assert(statement.index === index, `statement ${index} index mismatch`)
    assert(typeof statement.label === 'string' && statement.label, `statement ${index} label is missing`)
    assert(Number.isSafeInteger(statement.expected_changes) && statement.expected_changes > 0, `statement ${index} expected change count is invalid`)
    assert(typeof statement.sql === 'string' && statement.sql.trim(), `statement ${index} SQL is missing`)
    assert(!/\b(?:BEGIN|COMMIT|ROLLBACK|ATTACH|DETACH|PRAGMA|CREATE|DROP|ALTER)\b/i.test(statement.sql), `statement ${index} contains a forbidden transaction or schema command`)
    if (index === 0) assert(/^INSERT INTO audit_logs\b/i.test(statement.sql.trim()), 'first statement must be the audit/precondition guard')
    else assert(/^UPDATE (?:fees|sales|sale_items)\b/i.test(statement.sql.trim()), `statement ${index} is outside the exact repair table allowlist`)
  })
  assert(stableJson(batch.statements) === stableJson(expectedStatements(executionManifest, batch)), `${batchName} statements differ from the compiled historical repair plan`)
  return { directory, executionManifest, batch }
}

async function verifyCloudflareOperator(env = process.env, fetchImpl = fetch) {
  const token = String(env.CLOUDFLARE_API_TOKEN || '')
  const accountId = String(env.CLOUDFLARE_ACCOUNT_ID || '')
  assert(token, 'CLOUDFLARE_API_TOKEN is missing; run through cloudflare/scripts/with-wrangler-auth.cjs')
  assert(accountId === expectedAccountId, 'CLOUDFLARE_ACCOUNT_ID does not match the reviewed account')
  let response
  try {
    response = await fetchImpl('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch (_) {
    throw new Error('Cloudflare API token identity verification could not be reached')
  }
  const payload = await response.json().catch(() => null)
  assert(response.ok && payload?.success === true && payload?.result?.status === 'active', 'Cloudflare API token identity verification failed')
  const apiTokenId = String(payload.result.id || '')
  assert(/^[A-Za-z0-9_-]{8,128}$/.test(apiTokenId), 'Cloudflare API token identity response is invalid')
  return { account_id: accountId, api_token_id: apiTokenId }
}

const sqlIds = (ids) => ids.map((id) => {
  assert(Number.isSafeInteger(id) && id > 0, 'manifest contains an invalid row ID')
  return String(id)
}).join(',')

async function allRows(db, sql) {
  const result = await db.prepare(sql).all()
  assert(Array.isArray(result?.results), 'D1 read did not return rows')
  return result.results
}

async function readTargetRows(db, manifest) {
  const feeRows = []
  for (const item of manifest.batching.fee_chunks) feeRows.push(...await allRows(db, `SELECT * FROM fees WHERE id IN (${sqlIds(item.ids)}) ORDER BY id`))
  const sales = await allRows(db, `SELECT * FROM sales WHERE id IN (${sqlIds(manifest.batching.sale_chunk.ids)}) ORDER BY id`)
  const saleItems = await allRows(db, `SELECT * FROM sale_items WHERE id IN (${sqlIds(manifest.batching.sale_item_chunk.ids)}) ORDER BY id`)
  return {
    fees: feeRows.sort((left, right) => Number(left.id) - Number(right.id)),
    sales: sales.sort((left, right) => Number(left.id) - Number(right.id)),
    sale_items: saleItems.sort((left, right) => Number(left.id) - Number(right.id)),
  }
}

function validateRows(executionManifest, rows, phase, kind) {
  const expectedCounts = executionManifest.target.rows
  const expectedColumns = executionManifest.execution.full_row_columns
  const beforeHashes = executionManifest.execution.before_full_row_sha256
  const targetValues = {
    fees: { branch_id: 2 },
    sales: { branch_id: 2, branch_name: 'Shop' },
    sale_items: { branch_id: 2 },
  }
  const hashes = {}
  for (const table of ['fees', 'sales', 'sale_items']) {
    assert(rows[table].length === expectedCounts[table], `${phase} ${table} row count mismatch`)
    const keySet = [...expectedColumns[table]].sort().join('\n')
    assert(rows[table].every((row) => Object.keys(row).sort().join('\n') === keySet), `${phase} ${table} column set mismatch`)
    const wantRepaired = kind === 'repair' ? phase === 'post' : phase === 'pre'
    for (const row of rows[table]) {
      for (const [field, repairedValue] of Object.entries(targetValues[table])) {
        assert(Object.is(row[field], wantRepaired ? repairedValue : null), `${phase} ${table} target field mismatch`)
      }
    }
    const normalized = rows[table].map((row) => {
      const copy = { ...row }
      for (const field of Object.keys(targetValues[table])) copy[field] = null
      return copy
    })
    hashes[table] = fingerprint(normalized)
    assert(hashes[table] === beforeHashes[table], `${phase} ${table} full-row hash mismatch (${hashes[table]} != ${beforeHashes[table]})`)
  }
  return hashes
}

async function verifyAuditAndAllocations(db, executionManifest, kind) {
  const action = kind === 'repair' ? 'historical_branch_metadata_repair' : 'historical_branch_metadata_repair_recovery'
  const auditRows = await allRows(db, `SELECT user_id,user_name,details FROM audit_logs WHERE action='${action}' AND entity_id='${String(executionManifest.execution.run_id).replaceAll("'", "''")}'`)
  assert(auditRows.length === 1, `expected exactly one ${action} audit row`)
  assert(auditRows[0].user_id === null && auditRows[0].user_name === expectedActor.user_name, 'audit service attribution mismatch')
  const details = JSON.parse(auditRows[0].details)
  const attribution = details.attribution
  assert(attribution?.actor?.user_id === null && attribution?.actor?.user_name === expectedActor.user_name, 'audit details service actor mismatch')
  assert(stableJson(attribution?.cloudflare_operator) === stableJson(executionManifest.execution.cloudflare_operator), 'audit details Cloudflare operator mismatch')
  const allocations = await allRows(db, `SELECT COUNT(*) AS count FROM sale_item_batch_allocations WHERE sale_item_id IN (${sqlIds(executionManifest.batching.sale_item_chunk.ids)})`)
  assert(Number(allocations[0]?.count || 0) === 0, 'sale-item allocation postcondition changed')
  return { action, rows: auditRows.length, sale_item_batch_allocations: Number(allocations[0]?.count || 0) }
}

async function executePreparedBatch(db, batch) {
  const prepared = batch.statements.map((statement) => db.prepare(statement.sql))
  const results = await db.batch(prepared)
  assert(Array.isArray(results) && results.length === batch.statements.length, 'D1 batch result count mismatch')
  const changes = results.map((result) => Number(result?.meta?.changes))
  const mismatches = batch.statements.flatMap((statement, index) => changes[index] === statement.expected_changes ? [] : [{ index, label: statement.label, expected: statement.expected_changes, observed: changes[index] }])
  return { changes, mismatches }
}

async function runApply(validated, confirmations, dependencies = {}) {
  const { executionManifest, batch } = validated
  assert(confirmations['confirm-quiet-window'] === true, '--apply requires --confirm-quiet-window')
  assert(confirmations['confirm-run-id'] === executionManifest.execution.run_id, '--confirm-run-id mismatch')
  assert(confirmations['confirm-manifest-sha256'] === executionManifest.content_sha256, '--confirm-manifest-sha256 mismatch')
  assert(confirmations['confirm-batch-sha256'] === batch.content_sha256, '--confirm-batch-sha256 mismatch')
  assert(confirmations['confirm-bookmark'] === executionManifest.execution.time_travel_bookmark, '--confirm-bookmark mismatch')
  const operator = await (dependencies.verifyOperator || verifyCloudflareOperator)()
  assert(stableJson(operator) === stableJson(executionManifest.execution.cloudflare_operator), 'active Cloudflare API token does not match the execution manifest')
  validateOperatorConfig()
  const getProxy = dependencies.getPlatformProxy || (() => {
    const require = createRequire(join(root, 'cloudflare/package.json'))
    return require('wrangler').getPlatformProxy({ configPath: operatorConfigPath, remoteBindings: true })
  })
  const platform = await getProxy()
  try {
    const db = platform?.env?.DB
    assert(db?.prepare && db?.batch, 'remote D1 binding is unavailable')
    const preRows = await readTargetRows(db, executionManifest)
    const preHashes = validateRows(executionManifest, preRows, 'pre', batch.kind)
    let batchResult
    try {
      batchResult = await executePreparedBatch(db, batch)
    } catch (_) {
      throw new Error('D1 batch failed or returned an ambiguous transport result; do not retry until the audit row and exact post-state are read')
    }
    const postRows = await readTargetRows(db, executionManifest)
    const postHashes = validateRows(executionManifest, postRows, 'post', batch.kind)
    const audit = await verifyAuditAndAllocations(db, executionManifest, batch.kind)
    assert(batchResult.mismatches.length === 0, `D1 batch committed but statement change counts mismatched at indexes: ${batchResult.mismatches.map((item) => item.index).join(',')}`)
    return {
      status: 'applied_and_verified',
      kind: batch.kind,
      run_id: executionManifest.execution.run_id,
      manifest_sha256: executionManifest.content_sha256,
      batch_sha256: batch.content_sha256,
      statement_changes: batchResult.changes,
      pre_full_row_sha256: preHashes,
      post_normalized_full_row_sha256: postHashes,
      audit,
    }
  } finally {
    await platform?.dispose?.()
  }
}

async function main() {
  const args = parseArgs()
  if (args.identify) {
    assert(!args.apply && !args.bundle, '--identify cannot be combined with --apply or --bundle')
    const identity = await verifyCloudflareOperator()
    process.stdout.write(`${JSON.stringify({ status: 'verified_read_only', cloudflare_operator: identity }, null, 2)}\n`)
    return
  }
  const validated = validateBundle(args.bundle, args.kind || 'repair')
  if (!args.apply) {
    process.stdout.write(`${JSON.stringify({
      status: 'review_only',
      kind: validated.batch.kind,
      run_id: validated.executionManifest.execution.run_id,
      manifest_sha256: validated.executionManifest.content_sha256,
      batch_sha256: validated.batch.content_sha256,
      statement_count: validated.batch.statement_count,
      remote_binding_opened: false,
      production_write: false,
    }, null, 2)}\n`)
    return
  }
  const result = await runApply(validated, args)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'refused_or_failed', error: redactErrorMessage(error) })}\n`)
  process.exitCode = 1
})

export {
  expectedActor,
  executePreparedBatch,
  fingerprint,
  parseArgs,
  redactErrorMessage,
  runApply,
  validateBundle,
  validateOperatorConfig,
  validateRows,
  verifyCloudflareOperator,
}
