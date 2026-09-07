#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const manifestPath = join(evidenceDir, 'repair-manifest.json')
const previewRepairPath = join(evidenceDir, 'historical-branch-repair.sql')
const previewRecoveryPath = join(evidenceDir, 'historical-branch-recovery.sql')
const integrityPath = join(evidenceDir, 'integrity.json')
const productionSchemaPath = join(evidenceDir, '..', 'production-schema.json')
const maxIdsPerStatement = 99
const serviceActors = Object.freeze({
  'codex-maintenance-owner-authorized': Object.freeze({
    kind: 'service',
    user_id: null,
    user_name: 'Codex maintenance (owner-authorized)',
    origin: 'private_historical_repair_operator',
    task: 'historical-shop-branch-metadata-20260907',
    cloudflare_account_id: '743e5b727d139e85ed11679097f6f99e',
  }),
})

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const fileSha256 = (path) => sha256(readFileSync(path))
const fail = (message) => { throw new Error(message) }
const assert = (condition, message) => { if (!condition) fail(message) }
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
  }
  return value
}
const stableJson = (value) => JSON.stringify(stable(value))
const fingerprint = (value) => sha256(stableJson(value))
const chunk = (values, size) => Array.from(
  { length: Math.ceil(values.length / size) },
  (_, index) => values.slice(index * size, (index + 1) * size),
)
const rowsFromD1 = (value, label) => {
  if (Array.isArray(value)) return value
  const rows = value?.result?.[0]?.results
  assert(Array.isArray(rows), `${label} must be a D1 query response or a JSON row array`)
  return rows
}
const positiveInteger = (value, label) => {
  assert(Number.isSafeInteger(value) && value > 0, `${label} must be a positive safe integer`)
  return value
}
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`
const idLiterals = (ids) => ids.map((id) => String(positiveInteger(id, 'ID literal'))).join(',')
const parseArgs = () => {
  const result = {}
  for (let index = 2; index < process.argv.length; index += 1) {
    const token = process.argv[index]
    assert(token.startsWith('--'), `Unexpected argument: ${token}`)
    const key = token.slice(2)
    const value = process.argv[index + 1]
    assert(value && !value.startsWith('--'), `Missing value for --${key}`)
    result[key] = value
    index += 1
  }
  return result
}

function schemaColumns(tableName) {
  const schemaRows = rowsFromD1(readJson(productionSchemaPath), 'production schema')
  const sql = schemaRows.find((row) => row.name === tableName)?.sql
  assert(typeof sql === 'string', `production schema is missing ${tableName}`)
  const body = sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')'))
  const definitions = []
  let current = ''
  let depth = 0
  let quote = null
  for (const character of body) {
    if (quote) {
      current += character
      if (character === quote) quote = null
    } else if (character === "'" || character === '"' || character === '`') {
      quote = character
      current += character
    } else if (character === '(') {
      depth += 1
      current += character
    } else if (character === ')') {
      depth -= 1
      current += character
    } else if (character === ',' && depth === 0) {
      definitions.push(current)
      current = ''
    } else {
      current += character
    }
  }
  definitions.push(current)
  return definitions.flatMap((definition) => {
    const normalized = definition.trim().replace(/^,\s*/, '')
    const name = normalized.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/)?.slice(1).find(Boolean)
    if (!name || /^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN)$/i.test(name)) return []
    return [name]
  })
}

function loadSealedEvidence() {
  const integrity = readJson(integrityPath)
  const feeRows = []
  for (const page of integrity.fees.page_files) {
    const path = join(evidenceDir, page.file)
    assert(fileSha256(path) === page.sha256, `${page.file} raw SHA-256 mismatch`)
    const rows = rowsFromD1(readJson(path), page.file)
    assert(rows.length === page.row_count, `${page.file} row count mismatch`)
    feeRows.push(...rows)
  }
  feeRows.sort((left, right) => left.id - right.id)
  feeRows.forEach((row, index) => {
    positiveInteger(row.id, `fees[${index}].id`)
    assert(row.fee_type === 'delivery' || row.fee_type === 'expense', `fees[${index}].fee_type is unexpected`)
    if (index) assert(feeRows[index - 1].id < row.id, `fee IDs are duplicated or unordered at ${row.id}`)
  })
  const feeIdentity = feeRows.map((row) => `${row.id}:${row.fee_type}`).join('\n') + '\n'
  const feeIdsText = feeRows.map((row) => row.id).join(',') + '\n'
  assert(feeRows.length === integrity.fees.row_count, 'combined fee row count mismatch')
  assert(sha256(feeIdentity) === integrity.fees.identity_sha256, 'combined fee identity SHA-256 mismatch')
  assert(sha256(feeIdsText) === integrity.fees.ids_sha256, 'combined fee ID SHA-256 mismatch')

  const headersFile = join(evidenceDir, 'sales-16842-16863-headers.json')
  const linesFile = join(evidenceDir, 'sales-16842-16863-lines.json')
  const headers = rowsFromD1(readJson(headersFile), 'sales headers')
  const lines = rowsFromD1(readJson(linesFile), 'sale lines')
  assert(sha256(JSON.stringify(headers)) === integrity.sales_16842_16863.header_rows_sha256, 'sale header SHA-256 mismatch')
  assert(sha256(JSON.stringify(lines)) === integrity.sales_16842_16863.line_rows_sha256, 'sale line SHA-256 mismatch')
  assert(headers.length === integrity.sales_16842_16863.header_count, 'sale header count mismatch')
  assert(lines.length === integrity.sales_16842_16863.line_count, 'sale line count mismatch')

  const saleIds = integrity.sales_16842_16863.sale_ids.map((id, index) => positiveInteger(id, `sale_ids[${index}]`))
  assert(new Set(saleIds).size === saleIds.length, 'sale IDs are not unique')
  assert(headers.every((row, index) => row.id === saleIds[index] && row.branch_id === null && row.branch_name === null), 'sealed sale headers do not match the null-branch contract')
  const lineIds = lines.map((row, index) => positiveInteger(row.id, `sale_lines[${index}].id`))
  assert(new Set(lineIds).size === lineIds.length, 'sale line IDs are not unique')
  assert(lines.every((row) => saleIds.includes(row.sale_id) && row.branch_id === null), 'sealed sale lines do not match the null-branch contract')

  return { integrity, feeRows, headers, lines, feeIds: feeRows.map((row) => row.id), saleIds, lineIds }
}

function buildManifest(sealed) {
  const feeChunks = chunk(sealed.feeIds, maxIdsPerStatement)
  const manifest = {
    schema_version: 1,
    plan_id: 'historical-shop-branch-metadata-20260907',
    status: 'prepared; production apply remains gated; no remote write executed',
    authorization: {
      basis: 'The user explicitly requested correction of past branch metadata.',
      remaining_gates: [
        'release candidate is deployed and verified',
        'a quiet write window is active',
        'a fresh D1 Time Travel bookmark is recorded',
        'two fresh full-row reads match byte-for-byte canonical SHA-256 preconditions',
        'the allowlisted maintenance service actor and verified Cloudflare API-token identity are recorded for the audit row',
      ],
    },
    target: {
      branch_id: 2,
      branch_name: 'Shop',
      rows: { fees: sealed.feeIds.length, sales: sealed.saleIds.length, sale_items: sealed.lineIds.length, total: sealed.feeIds.length + sealed.saleIds.length + sealed.lineIds.length },
      columns: { fees: ['branch_id'], sales: ['branch_id', 'branch_name'], sale_items: ['branch_id'] },
    },
    source_evidence: {
      integrity_file_sha256: fileSha256(integrityPath),
      production_schema_file_sha256: fileSha256(productionSchemaPath),
      fee_identity_sha256: sealed.integrity.fees.identity_sha256,
      fee_ids_sha256: sealed.integrity.fees.ids_sha256,
      sale_header_projection_sha256: sealed.integrity.sales_16842_16863.header_rows_sha256,
      sale_line_projection_sha256: sealed.integrity.sales_16842_16863.line_rows_sha256,
    },
    batching: {
      maximum_ids_per_update_statement: maxIdsPerStatement,
      fee_statement_count: feeChunks.length,
      total_update_statement_count: feeChunks.length + 2,
      id_encoding: 'validated positive safe-integer SQL literals; no ID binds',
      fee_chunks: feeChunks.map((ids, index) => ({ index: index + 1, expected_changes: ids.length, ids })),
      sale_chunk: { expected_changes: sealed.saleIds.length, ids: sealed.saleIds },
      sale_item_chunk: { expected_changes: sealed.lineIds.length, ids: sealed.lineIds },
    },
    full_row_precondition: {
      canonicalization: 'Sort rows by numeric id; recursively sort every object key; preserve JSON scalar types and null; SHA-256 the UTF-8 JSON.stringify output with no trailing LF.',
      queries: {
        fees: 'SELECT * FROM fees WHERE id IN (<validated manifest fee IDs>) ORDER BY id',
        sales: 'SELECT * FROM sales WHERE id IN (<validated manifest sale IDs>) ORDER BY id',
        sale_items: 'SELECT * FROM sale_items WHERE id IN (<validated manifest sale-item IDs>) ORDER BY id',
      },
      required_reads: 2,
      rule: 'Build the execution bundle from read 1, repeat all three SELECT * reads immediately before apply, and require each canonical full-row SHA-256 to equal read 1. The builder rejects missing IDs, extra IDs, altered sealed projection fields, or any non-null target branch field.',
      hash_fields_at_execution: ['fees_full_rows_sha256', 'sales_full_rows_sha256', 'sale_items_full_rows_sha256'],
      expected_columns_from_sealed_production_schema: {
        fees: schemaColumns('fees'),
        sales: schemaColumns('sales'),
        sale_items: schemaColumns('sale_items'),
      },
    },
    transaction: {
      production_transport: 'one D1Database.batch() call; D1 batch is the transaction boundary',
      statement_order: ['precondition/audit guard', '43 fee updates', 'one sales update', 'one sale_items update'],
      guard: 'The first statement raises a SQLite JSON error unless the exact manifest IDs still have the expected before-state branch values and branches.id=2 is active/default Shop. Any later SQL error rolls back the whole D1 batch, including the audit row.',
      expected_statement_changes: { audit_rows: 1, fee_updates: feeChunks.map((ids) => ids.length), sales: sealed.saleIds.length, sale_items: sealed.lineIds.length },
      audit_action: 'historical_branch_metadata_repair',
      audit_attribution: serviceActors['codex-maintenance-owner-authorized'],
    },
    recovery: {
      application_undo: false,
      preferred: 'During the quiet window, use the recorded Time Travel bookmark if the atomic batch fails ambiguously or a postcondition detects an unrelated change.',
      logical: 'Use the generated exact-ID recovery batch only after two post-state full-row reads match and rebasing the three corrected branch fields to null reproduces the recorded before full-row hashes. Insert a recovery audit row; do not delete the original audit row.',
      stop_conditions: ['any target has a later branch edit', 'post-state full-row hashes drift', 'quiet window ended', 'audit run ID or manifest hash is absent'],
    },
    exclusions: ['sale 16894', 'sale 16896', 'all sale_id values', 'driver IDs', 'stock', 'allocations', 'inventory movements', 'returns', 'transfers', 'zero-line sales'],
  }
  manifest.content_sha256 = sha256(stableJson(manifest))
  return manifest
}

function validateServiceExecutionIdentity(input) {
  const actorKey = String(input.service_actor || '')
  const actor = serviceActors[actorKey]
  assert(actor, `execution input service_actor must be one of: ${Object.keys(serviceActors).join(', ')}`)
  const operator = input.cloudflare_operator
  assert(operator && typeof operator === 'object' && !Array.isArray(operator), 'execution input cloudflare_operator is required')
  assert(operator.account_id === actor.cloudflare_account_id, 'execution input cloudflare_operator.account_id does not match the allowlisted service actor')
  assert(/^[A-Za-z0-9_-]{8,128}$/.test(operator.api_token_id || ''), 'execution input cloudflare_operator.api_token_id is invalid')
  return {
    actor_key: actorKey,
    actor: { ...actor },
    cloudflare_operator: {
      account_id: operator.account_id,
      api_token_id: operator.api_token_id,
    },
  }
}

function batchArtifact(kind, manifest, execution, statements) {
  const payload = {
    schema_version: 1,
    kind,
    plan_id: manifest.plan_id,
    run_id: execution.run_id,
    manifest_sha256: manifest.content_sha256,
    statement_count: statements.length,
    statements_sha256: fingerprint(statements),
    statements,
  }
  return { ...payload, content_sha256: fingerprint(payload) }
}

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

function updateStatements(manifest) {
  const feeStatements = manifest.batching.fee_chunks.map((item) => `UPDATE fees\nSET branch_id = 2\nWHERE branch_id IS NULL AND id IN (${idLiterals(item.ids)}); -- expect ${item.expected_changes}`)
  const sales = manifest.batching.sale_chunk
  const items = manifest.batching.sale_item_chunk
  return [
    ...feeStatements,
    `UPDATE sales\nSET branch_id = 2, branch_name = 'Shop'\nWHERE branch_id IS NULL AND branch_name IS NULL AND id IN (${idLiterals(sales.ids)}); -- expect ${sales.expected_changes}`,
    `UPDATE sale_items\nSET branch_id = 2\nWHERE branch_id IS NULL AND id IN (${idLiterals(items.ids)}); -- expect ${items.expected_changes}`,
  ]
}

function recoveryStatements(manifest) {
  const feeStatements = manifest.batching.fee_chunks.map((item) => `UPDATE fees\nSET branch_id = NULL\nWHERE branch_id = 2 AND id IN (${idLiterals(item.ids)}); -- expect ${item.expected_changes}`)
  const sales = manifest.batching.sale_chunk
  const items = manifest.batching.sale_item_chunk
  return [
    ...feeStatements,
    `UPDATE sales\nSET branch_id = NULL, branch_name = NULL\nWHERE branch_id = 2 AND branch_name = 'Shop' AND id IN (${idLiterals(sales.ids)}); -- expect ${sales.expected_changes}`,
    `UPDATE sale_items\nSET branch_id = NULL\nWHERE branch_id = 2 AND id IN (${idLiterals(items.ids)}); -- expect ${items.expected_changes}`,
  ]
}

function previewSql(manifest, recovery = false) {
  const statements = recovery ? recoveryStatements(manifest) : updateStatements(manifest)
  const label = recovery ? 'recovery' : 'repair'
  const inputFlag = recovery ? '--recovery-input' : '--execution-input'
  return `-- REVIEW TEMPLATE ONLY. No remote command was run.\n-- Generate a runnable bundle with:\n-- node build-repair-bundle.mjs ${inputFlag} <local-json> --output-dir <local-dir>\n-- This template aborts deliberately because required current-state evidence is absent.\nSELECT json('execution input required before ${label}');\n\n-- Validated statement layout (${manifest.batching.maximum_ids_per_update_statement} IDs maximum per update):\n${statements.join('\n\n')}\n`
}

function validateFreshRows(rows, sealedRows, idField, targetNullFields, expectedColumns, label) {
  const sorted = [...rows].sort((left, right) => left.id - right.id)
  const sealedById = new Map(sealedRows.map((row) => [row.id, row]))
  assert(sorted.length === sealedRows.length, `${label} full export count mismatch`)
  assert(new Set(sorted.map((row) => row.id)).size === sorted.length, `${label} full export contains duplicate IDs`)
  for (const [index, row] of sorted.entries()) {
    positiveInteger(row.id, `${label}[${index}].id`)
    const sealed = sealedById.get(row.id)
    assert(sealed, `${label} contains unexpected ID ${row.id}`)
    for (const [key, expected] of Object.entries(sealed)) assert(Object.is(row[key], expected), `${label} ID ${row.id} sealed field ${key} drifted`)
    for (const field of targetNullFields) assert(row[field] === null, `${label} ID ${row.id} ${field} is not null`)
    if (idField) positiveInteger(row[idField], `${label} ID ${row.id} ${idField}`)
  }
  const keySet = Object.keys(sorted[0] || {}).sort().join('\n')
  assert(sorted.every((row) => Object.keys(row).sort().join('\n') === keySet), `${label} rows do not share one complete column set`)
  assert(keySet === [...expectedColumns].sort().join('\n'), `${label} is not SELECT * against the sealed production schema column set`)
  return { rows: sorted, sha256: sha256(stableJson(sorted)), columns: keySet ? keySet.split('\n') : [] }
}

function validatePostRows(rows, sealedRows, targetValues, expectedColumns, beforeHash, label) {
  const sorted = [...rows].sort((left, right) => left.id - right.id)
  const sealedById = new Map(sealedRows.map((row) => [row.id, row]))
  assert(sorted.length === sealedRows.length, `${label} post export count mismatch`)
  assert(new Set(sorted.map((row) => row.id)).size === sorted.length, `${label} post export contains duplicate IDs`)
  for (const [index, row] of sorted.entries()) {
    positiveInteger(row.id, `${label}[${index}].id`)
    const sealed = sealedById.get(row.id)
    assert(sealed, `${label} contains unexpected ID ${row.id}`)
    for (const [field, expected] of Object.entries(targetValues)) assert(Object.is(row[field], expected), `${label} ID ${row.id} ${field} is not the repaired value`)
    const normalized = { ...row }
    for (const field of Object.keys(targetValues)) normalized[field] = null
    for (const [key, expected] of Object.entries(sealed)) assert(Object.is(normalized[key], expected), `${label} ID ${row.id} sealed field ${key} drifted`)
  }
  const keySet = Object.keys(sorted[0] || {}).sort().join('\n')
  assert(sorted.every((row) => Object.keys(row).sort().join('\n') === keySet), `${label} rows do not share one complete column set`)
  assert(keySet === [...expectedColumns].sort().join('\n'), `${label} is not SELECT * against the sealed production schema column set`)
  const normalizedRows = sorted.map((row) => {
    const normalized = { ...row }
    for (const field of Object.keys(targetValues)) normalized[field] = null
    return normalized
  })
  const normalizedSha256 = sha256(stableJson(normalizedRows))
  assert(normalizedSha256 === beforeHash, `${label} does not normalize to the recorded before full-row hash`)
  return { rows: sorted, sha256: sha256(stableJson(sorted)), normalizedSha256, columns: keySet.split('\n') }
}

function buildRunnableBundle(manifest, sealed, inputPath, outputDir) {
  const input = readJson(resolve(inputPath))
  assert(/^[A-Za-z0-9._:-]{8,120}$/.test(input.run_id || ''), 'execution input run_id is invalid')
  assert(input.actor === undefined, 'execution input actor is not accepted; use the allowlisted service_actor contract')
  const identity = validateServiceExecutionIdentity(input)
  assert(typeof input.time_travel_bookmark === 'string' && input.time_travel_bookmark.trim(), 'execution input time_travel_bookmark is required')
  for (const readName of ['read_1', 'read_2']) {
    assert(input.full_row_exports?.[readName], `execution input full_row_exports.${readName} is required`)
    for (const table of ['fees', 'sales', 'sale_items']) {
      const path = input.full_row_exports[readName][table]
      assert(typeof path === 'string' && existsSync(resolve(dirname(resolve(inputPath)), path)), `${readName}.${table} export file is missing`)
    }
  }
  const loadRead = (readName) => {
    const base = dirname(resolve(inputPath))
    const load = (table) => rowsFromD1(readJson(resolve(base, input.full_row_exports[readName][table])), `${readName}.${table}`)
    return {
      fees: validateFreshRows(load('fees'), sealed.feeRows, null, ['branch_id'], manifest.full_row_precondition.expected_columns_from_sealed_production_schema.fees, `${readName}.fees`),
      sales: validateFreshRows(load('sales'), sealed.headers, null, ['branch_id', 'branch_name'], manifest.full_row_precondition.expected_columns_from_sealed_production_schema.sales, `${readName}.sales`),
      sale_items: validateFreshRows(load('sale_items'), sealed.lines, 'sale_id', ['branch_id'], manifest.full_row_precondition.expected_columns_from_sealed_production_schema.sale_items, `${readName}.sale_items`),
    }
  }
  const first = loadRead('read_1')
  const second = loadRead('read_2')
  for (const table of ['fees', 'sales', 'sale_items']) {
    assert(first[table].sha256 === second[table].sha256, `${table} full-row hash changed between read 1 and read 2`)
    assert(stableJson(first[table].columns) === stableJson(second[table].columns), `${table} column set changed between reads`)
  }
  const beforeHashes = Object.fromEntries(['fees', 'sales', 'sale_items'].map((table) => [table, first[table].sha256]))
  const auditDetails = {
    run_id: input.run_id,
    manifest_sha256: manifest.content_sha256,
    time_travel_bookmark: input.time_travel_bookmark,
    before_full_row_sha256: beforeHashes,
    row_counts: manifest.target.rows,
    columns_changed: manifest.target.columns,
    attribution: {
      actor: identity.actor,
      cloudflare_operator: identity.cloudflare_operator,
      authorization: 'owner-authorized branch-only historical metadata correction',
    },
  }
  const guard = guardCondition(manifest)
  const auditSql = `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)\nSELECT NULL,${sqlString(identity.actor.user_name)},\n  CASE WHEN ${guard} THEN 'historical_branch_metadata_repair' ELSE json('historical branch repair precondition failed') END,\n  'historical_metadata_repair',${sqlString(input.run_id)},${sqlString(JSON.stringify(auditDetails))},\n  'historical_metadata_repair',${sqlString(input.run_id)},${sqlString(JSON.stringify({ before_full_row_sha256: beforeHashes }))},${sqlString(JSON.stringify({ fees: { branch_id: 2 }, sales: { branch_id: 2, branch_name: 'Shop' }, sale_items: { branch_id: 2 } }))}; -- expect 1`
  const statements = [auditSql, ...updateStatements(manifest)].map((sql, index) => ({
    index,
    label: index === 0 ? 'audit_and_precondition_guard' : index <= manifest.batching.fee_statement_count ? `fees_${index}` : index === manifest.batching.fee_statement_count + 1 ? 'sales' : 'sale_items',
    expected_changes: index === 0 ? 1 : index <= manifest.batching.fee_statement_count ? manifest.batching.fee_chunks[index - 1].expected_changes : index === manifest.batching.fee_statement_count + 1 ? manifest.batching.sale_chunk.expected_changes : manifest.batching.sale_item_chunk.expected_changes,
    sql,
  }))
  const repairSql = `-- Local rehearsal form. Production execution must use the hash-bound d1-batch.json\n-- through one D1Database.batch() call; do not submit this wrapper or BEGIN/COMMIT to D1.\nBEGIN IMMEDIATE;\n-- D1_BATCH_START\n${statements.map((statement) => statement.sql).join('\n\n')}\n-- D1_BATCH_END\nCOMMIT;\n`
  mkdirSync(resolve(outputDir), { recursive: true })
  const executionManifest = { ...manifest, execution: { run_id: input.run_id, ...identity, time_travel_bookmark: input.time_travel_bookmark, before_full_row_sha256: beforeHashes, full_row_columns: Object.fromEntries(['fees', 'sales', 'sale_items'].map((table) => [table, first[table].columns])) } }
  const d1Batch = batchArtifact('repair', manifest, executionManifest.execution, statements)
  executionManifest.execution.d1_batch_sha256 = d1Batch.content_sha256
  executionManifest.execution.d1_statements_sha256 = d1Batch.statements_sha256
  executionManifest.execution_bundle_sha256 = fingerprint({ ...executionManifest, execution_bundle_sha256: undefined })
  writeFileSync(join(resolve(outputDir), 'execution-manifest.json'), `${JSON.stringify(executionManifest, null, 2)}\n`)
  writeFileSync(join(resolve(outputDir), 'd1-batch.json'), `${JSON.stringify(d1Batch, null, 2)}\n`)
  writeFileSync(join(resolve(outputDir), 'historical-branch-repair.sql'), repairSql)
  writeFileSync(join(resolve(outputDir), 'historical-branch-recovery.sql'), `-- Recovery is not executable until two post-state SELECT * reads normalize to the recorded before hashes.\nSELECT json('recovery input required; run build-repair-bundle.mjs --recovery-input <local-json> --output-dir <local-dir>');\n`)
  return { outputDir: resolve(outputDir), hashes: beforeHashes, statementCount: statements.length, d1BatchSha256: d1Batch.content_sha256 }
}

function buildRecoveryBundle(manifest, sealed, inputPath, outputDir) {
  const input = readJson(resolve(inputPath))
  const base = dirname(resolve(inputPath))
  assert(typeof input.execution_manifest === 'string', 'recovery input execution_manifest is required')
  const executionManifest = readJson(resolve(base, input.execution_manifest))
  const fingerprinted = { ...executionManifest }
  delete fingerprinted.execution_bundle_sha256
  assert(sha256(stableJson(fingerprinted)) === executionManifest.execution_bundle_sha256, 'execution manifest SHA-256 mismatch')
  assert(executionManifest.content_sha256 === manifest.content_sha256, 'execution manifest does not match the sealed repair manifest')
  const execution = executionManifest.execution
  assert(execution?.before_full_row_sha256, 'execution manifest lacks before full-row hashes')
  const identity = validateServiceExecutionIdentity({
    service_actor: execution.actor_key,
    cloudflare_operator: execution.cloudflare_operator,
  })
  assert(stableJson(identity.actor) === stableJson(execution.actor), 'execution manifest service actor does not match the allowlist')
  for (const readName of ['read_1', 'read_2']) {
    assert(input.full_row_exports?.[readName], `recovery input full_row_exports.${readName} is required`)
    for (const table of ['fees', 'sales', 'sale_items']) {
      const path = input.full_row_exports[readName][table]
      assert(typeof path === 'string' && existsSync(resolve(base, path)), `${readName}.${table} post export file is missing`)
    }
  }
  const loadRead = (readName) => {
    const load = (table) => rowsFromD1(readJson(resolve(base, input.full_row_exports[readName][table])), `${readName}.${table}`)
    return {
      fees: validatePostRows(load('fees'), sealed.feeRows, { branch_id: 2 }, manifest.full_row_precondition.expected_columns_from_sealed_production_schema.fees, execution.before_full_row_sha256.fees, `${readName}.fees`),
      sales: validatePostRows(load('sales'), sealed.headers, { branch_id: 2, branch_name: 'Shop' }, manifest.full_row_precondition.expected_columns_from_sealed_production_schema.sales, execution.before_full_row_sha256.sales, `${readName}.sales`),
      sale_items: validatePostRows(load('sale_items'), sealed.lines, { branch_id: 2 }, manifest.full_row_precondition.expected_columns_from_sealed_production_schema.sale_items, execution.before_full_row_sha256.sale_items, `${readName}.sale_items`),
    }
  }
  const first = loadRead('read_1')
  const second = loadRead('read_2')
  for (const table of ['fees', 'sales', 'sale_items']) assert(first[table].sha256 === second[table].sha256, `${table} post full-row hash changed between recovery reads`)
  const auditDetails = {
    run_id: execution.run_id,
    manifest_sha256: manifest.content_sha256,
    time_travel_bookmark: execution.time_travel_bookmark,
    before_full_row_sha256: execution.before_full_row_sha256,
    row_counts: manifest.target.rows,
    columns_changed: manifest.target.columns,
    attribution: {
      actor: identity.actor,
      cloudflare_operator: identity.cloudflare_operator,
      authorization: 'owner-authorized branch-only historical metadata correction',
    },
  }
  const recoveryAudit = `INSERT INTO audit_logs (user_id,user_name,action,entity,entity_id,details,table_name,record_id,old_value,new_value)\nSELECT NULL,${sqlString(identity.actor.user_name)},\n  CASE WHEN (SELECT COUNT(*) FROM audit_logs WHERE action='historical_branch_metadata_repair' AND entity_id=${sqlString(execution.run_id)} AND details=${sqlString(JSON.stringify(auditDetails))})=1 THEN 'historical_branch_metadata_repair_recovery' ELSE json('repair audit precondition failed') END,\n  'historical_metadata_repair',${sqlString(execution.run_id)},${sqlString(JSON.stringify({ run_id: execution.run_id, manifest_sha256: manifest.content_sha256, reverts_action: 'historical_branch_metadata_repair', before_full_row_sha256: execution.before_full_row_sha256, verified_post_full_row_sha256: Object.fromEntries(['fees', 'sales', 'sale_items'].map((table) => [table, first[table].sha256])), attribution: { actor: identity.actor, cloudflare_operator: identity.cloudflare_operator, authorization: 'owner-authorized branch-only historical metadata correction' } }))},\n  'historical_metadata_repair',${sqlString(execution.run_id)},${sqlString(JSON.stringify({ fees: { branch_id: 2 }, sales: { branch_id: 2, branch_name: 'Shop' }, sale_items: { branch_id: 2 } }))},${sqlString(JSON.stringify({ restored_before_full_row_sha256: execution.before_full_row_sha256 }))}; -- expect 1`
  const recoveryStatementsList = [recoveryAudit, ...recoveryStatements(manifest)].map((sql, index) => ({
    index,
    label: index === 0 ? 'recovery_audit_guard' : index <= manifest.batching.fee_statement_count ? `fees_${index}` : index === manifest.batching.fee_statement_count + 1 ? 'sales' : 'sale_items',
    expected_changes: index === 0 ? 1 : index <= manifest.batching.fee_statement_count ? manifest.batching.fee_chunks[index - 1].expected_changes : index === manifest.batching.fee_statement_count + 1 ? manifest.batching.sale_chunk.expected_changes : manifest.batching.sale_item_chunk.expected_changes,
    sql,
  }))
  const recoverySql = `-- Local rehearsal form. Production recovery must use the hash-bound d1-recovery-batch.json\n-- through one D1Database.batch() call; do not submit this wrapper or BEGIN/COMMIT to D1.\nBEGIN IMMEDIATE;\n-- D1_BATCH_START\n${recoveryStatementsList.map((statement) => statement.sql).join('\n\n')}\n-- D1_BATCH_END\nCOMMIT;\n`
  const recoveryBatch = batchArtifact('recovery', manifest, execution, recoveryStatementsList)
  recoveryBatch.verified_post_full_row_sha256 = Object.fromEntries(['fees', 'sales', 'sale_items'].map((table) => [table, first[table].sha256]))
  recoveryBatch.source_execution_bundle_sha256 = executionManifest.execution_bundle_sha256
  recoveryBatch.content_sha256 = fingerprint(Object.fromEntries(Object.entries(recoveryBatch).filter(([key]) => key !== 'content_sha256')))
  mkdirSync(resolve(outputDir), { recursive: true })
  writeFileSync(join(resolve(outputDir), 'execution-manifest.json'), `${JSON.stringify(executionManifest, null, 2)}\n`)
  writeFileSync(join(resolve(outputDir), 'historical-branch-recovery.sql'), recoverySql)
  writeFileSync(join(resolve(outputDir), 'd1-recovery-batch.json'), `${JSON.stringify(recoveryBatch, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ recovery: 'verified and generated', outputDir: resolve(outputDir), d1RecoveryBatchSha256: recoveryBatch.content_sha256, post_full_row_sha256: Object.fromEntries(['fees', 'sales', 'sale_items'].map((table) => [table, first[table].sha256])) }, null, 2)}\n`)
}

const args = parseArgs()
const sealed = loadSealedEvidence()
const manifest = buildManifest(sealed)
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(previewRepairPath, previewSql(manifest, false))
writeFileSync(previewRecoveryPath, previewSql(manifest, true))

if (args['execution-input']) {
  assert(args['output-dir'], '--output-dir is required with --execution-input')
  const result = buildRunnableBundle(manifest, sealed, args['execution-input'], args['output-dir'])
  process.stdout.write(`${JSON.stringify({ sealed_evidence: 'verified', manifest_sha256: manifest.content_sha256, ...result }, null, 2)}\n`)
} else if (args['recovery-input']) {
  assert(args['output-dir'], '--output-dir is required with --recovery-input')
  buildRecoveryBundle(manifest, sealed, args['recovery-input'], args['output-dir'])
} else {
  process.stdout.write(`${JSON.stringify({ sealed_evidence: 'verified', manifest_sha256: manifest.content_sha256, fee_chunks: manifest.batching.fee_statement_count, max_ids_per_statement: maxIdsPerStatement, preview_only: true }, null, 2)}\n`)
}
