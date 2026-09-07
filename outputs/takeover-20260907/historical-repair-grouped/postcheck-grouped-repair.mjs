#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPLY_ACTION,
  COMPLETE_ACTION,
  EXPECTED_ACCOUNT_ID,
  EXPECTED_DATABASE_ID,
  RECOVERY_ACTION,
  START_ACTION,
  classifyGroup,
  rowsHash,
  stableJson,
  validateManifest,
} from './grouped-repair-core.mjs'
import {
  REVIEWED_MANIFEST_SHA256,
  REVIEWED_SOURCE_LINEAGE_COMMIT,
} from './run-grouped-historical-repair.mjs'

const AUDIT_COLUMNS = ['user_id', 'user_name', 'action', 'entity', 'entity_id', 'details', 'table_name', 'record_id', 'old_value', 'new_value']
const EXPECTED_ACTIONS = new Set([START_ACTION, APPLY_ACTION, RECOVERY_ACTION, COMPLETE_ACTION])
const TARGET_VALUES = {
  fees: { branch_id: 2 },
  sales: { branch_id: 2, branch_name: 'Shop' },
  sale_items: { branch_id: 2 },
}
const ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${EXPECTED_ACCOUNT_ID}/d1/database/${EXPECTED_DATABASE_ID}/query`

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'))
const auditComparable = (row) => Object.fromEntries(AUDIT_COLUMNS.map((column) => [column, row[column] ?? null]))
const exactAudit = (rows, expected) => {
  const keyed = rows.filter((row) => row.action === expected.action && row.entity === expected.entity && row.entity_id === expected.entity_id && row.record_id === expected.record_id)
  return keyed.length === 1 && stableJson(auditComparable(keyed[0])) === stableJson(expected)
}

function parseArgs(argv) {
  const names = new Set(['manifest', 'fees-pre', 'sales-pre', 'sale-items-pre', 'out'])
  const result = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    assert(flag?.startsWith('--') && names.has(flag.slice(2)), `unknown argument ${flag || ''}`)
    assert(argv[index + 1] && !argv[index + 1].startsWith('--'), `${flag} requires a value`)
    assert(result[flag.slice(2)] === undefined, `duplicate argument ${flag}`)
    result[flag.slice(2)] = argv[index + 1]
  }
  for (const name of names) assert(result[name], `--${name} is required`)
  return result
}

function expectedAuditRow(manifest, action, recordId, details, oldValue, newValue) {
  return {
    user_id: null,
    user_name: manifest.execution.actor.user_name,
    action,
    entity: 'historical_metadata_repair',
    entity_id: manifest.execution.run_id,
    details: JSON.stringify(details),
    table_name: 'historical_metadata_repair',
    record_id: recordId,
    old_value: JSON.stringify(oldValue),
    new_value: JSON.stringify(newValue),
  }
}

function auditDetails(manifest, group, phase) {
  return {
    plan_id: manifest.plan_id,
    run_id: manifest.execution.run_id,
    manifest_sha256: manifest.content_sha256,
    group_id: group?.id || 'plan',
    group_sha256: group?.content_sha256 || null,
    phase,
    tables: group?.tables || null,
    attribution: {
      actor: manifest.execution.actor,
      cloudflare_operator: manifest.execution.cloudflare_operator,
      authorization: 'owner-authorized historical branch metadata correction',
    },
  }
}

function expectedGroupAudit(manifest, group, recovery = false) {
  const hashes = (field) => Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, { full_row_sha256: descriptor[field] }]))
  return expectedAuditRow(
    manifest,
    recovery ? RECOVERY_ACTION : APPLY_ACTION,
    group.id,
    auditDetails(manifest, group, recovery ? 'recovery' : 'apply'),
    hashes(recovery ? 'post_full_row_sha256' : 'pre_full_row_sha256'),
    hashes(recovery ? 'pre_full_row_sha256' : 'post_full_row_sha256'),
  )
}

const expectedStartAudit = (manifest) => expectedAuditRow(manifest, START_ACTION, 'plan', auditDetails(manifest, null, 'started'), { status: 'prepared' }, { status: 'started', group_count: 44 })
const expectedCompleteAudit = (manifest) => expectedAuditRow(manifest, COMPLETE_ACTION, 'plan', auditDetails(manifest, null, 'completed'), { status: 'started', group_count: 44 }, { status: 'completed', group_count: 44 })

function validatePreRows(manifest, preRows) {
  const violations = []
  for (const [table, rows] of Object.entries(preRows)) {
    const expectedIds = manifest.groups.flatMap((group) => group.tables[table]?.ids || []).sort((left, right) => left - right)
    const observedIds = rows.map((row) => row.id).sort((left, right) => left - right)
    if (stableJson(observedIds) !== stableJson(expectedIds)) violations.push(`${table}: pre-export IDs do not match manifest`)
    if (new Set(observedIds).size !== observedIds.length) violations.push(`${table}: duplicate pre-export IDs`)
  }
  for (const group of manifest.groups) for (const [table, descriptor] of Object.entries(group.tables)) {
    const ids = new Set(descriptor.ids)
    const rows = preRows[table].filter((row) => ids.has(row.id))
    if (rows.length !== descriptor.count || rowsHash(rows) !== descriptor.pre_full_row_sha256) violations.push(`${group.id}:${table}: pre-export hash mismatch`)
  }
  assert(violations.length === 0, violations.join('; '))
}

function compareOnlyExpectedBranchDiffs(manifest, preRows, observedRows) {
  const violations = []
  for (const [table, rows] of Object.entries(observedRows)) {
    const before = new Map(preRows[table].map((row) => [row.id, row]))
    const columns = manifest.schema_columns[table]
    if (rows.length !== before.size) violations.push(`${table}: target count ${rows.length}, expected ${before.size}`)
    for (const row of rows) {
      const pre = before.get(row.id)
      if (!pre) { violations.push(`${table}:${row.id}: unexpected target row`); continue }
      if (stableJson(Object.keys(row).sort()) !== stableJson([...columns].sort())) violations.push(`${table}:${row.id}: observed column set changed`)
      for (const column of columns) {
        if (Object.hasOwn(TARGET_VALUES[table], column)) {
          const allowed = [pre[column], TARGET_VALUES[table][column]]
          if (!allowed.some((value) => Object.is(value, row[column]))) violations.push(`${table}:${row.id}:${column}: unexpected branch value`)
        } else if (!Object.is(pre[column], row[column])) violations.push(`${table}:${row.id}:${column}: non-branch field changed`)
      }
      before.delete(row.id)
    }
    for (const id of before.keys()) violations.push(`${table}:${id}: target row missing`)
  }
  return violations
}

async function restQuery(fetchImpl, token, label, sql, params = []) {
  assert(/^\s*SELECT\b/i.test(sql) && !sql.includes(';'), `${label}: only one SELECT is allowed`)
  let response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch {
    throw new Error(`${label}: read-only REST request failed`)
  }
  let payload
  try { payload = await response.json() } catch { throw new Error(`${label}: REST response was not JSON`) }
  const result = payload?.result?.[0]
  assert(response.ok && payload?.success === true && payload.result?.length === 1 && result?.success !== false && Array.isArray(result?.results), `${label}: read-only REST query failed with HTTP ${response.status}`)
  return result.results
}

async function fetchAuditRows(fetchImpl, token, manifest, label) {
  return restQuery(fetchImpl, token, label, `SELECT id,${AUDIT_COLUMNS.join(',')},created_at FROM audit_logs WHERE entity=? AND entity_id=? ORDER BY id`, ['historical_metadata_repair', manifest.execution.run_id])
}

async function fetchTargetRows(fetchImpl, token, manifest) {
  const observed = { fees: [], sales: [], sale_items: [] }
  for (const group of manifest.groups) for (const [table, descriptor] of Object.entries(group.tables)) {
    const marks = descriptor.ids.map(() => '?').join(',')
    const rows = await restQuery(fetchImpl, token, `${group.id}:${table}`, `SELECT * FROM ${table} WHERE id IN (${marks}) ORDER BY id`, descriptor.ids)
    observed[table].push(...rows)
  }
  for (const rows of Object.values(observed)) rows.sort((left, right) => Number(left.id) - Number(right.id))
  return observed
}

export async function runPostcheck(args, dependencies = {}) {
  const manifest = readJson(args.manifest)
  validateManifest(manifest, { reviewedManifestSha256: REVIEWED_MANIFEST_SHA256, reviewedLineageCommit: REVIEWED_SOURCE_LINEAGE_COMMIT })
  const outPath = resolve(args.out)
  assert(!existsSync(outPath), 'proof output already exists')
  const preRows = {
    fees: readJson(args['fees-pre']),
    sales: readJson(args['sales-pre']),
    sale_items: readJson(args['sale-items-pre']),
  }
  assert(Object.values(preRows).every(Array.isArray), 'pre-export files must contain row arrays')
  validatePreRows(manifest, preRows)
  const token = String(dependencies.token ?? process.env.CLOUDFLARE_API_TOKEN ?? '')
  assert(token.length >= 20, 'CLOUDFLARE_API_TOKEN is required')
  const fetchImpl = dependencies.fetchImpl || fetch

  const auditsBefore = await fetchAuditRows(fetchImpl, token, manifest, 'audit-before')
  const observedRows = await fetchTargetRows(fetchImpl, token, manifest)
  const auditsAfter = await fetchAuditRows(fetchImpl, token, manifest, 'audit-after')
  const comparableAudits = auditsAfter.map(auditComparable)
  const noRepairAudits = comparableAudits.length === 0
  const planAudits = comparableAudits.filter((row) => row.record_id === 'plan')
  const groupResults = manifest.groups.map((group) => {
    const rows = Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => {
      const ids = new Set(descriptor.ids)
      return [table, observedRows[table].filter((row) => ids.has(row.id))]
    }))
    const groupAudits = comparableAudits.filter((row) => row.record_id === group.id)
    const coreState = classifyGroup(manifest, group, rows, groupAudits, planAudits)
    const exactPreState = Object.entries(group.tables).every(([table, descriptor]) => rows[table].length === descriptor.count && rowsHash(rows[table]) === descriptor.pre_full_row_sha256)
    return {
      group_id: group.id,
      state: noRepairAudits && exactPreState ? 'pending' : coreState,
      core_state: coreState,
      tables: Object.fromEntries(Object.entries(group.tables).map(([table, descriptor]) => [table, {
        count: rows[table].length,
        observed_full_row_sha256: rowsHash(rows[table]),
        expected_pre_full_row_sha256: descriptor.pre_full_row_sha256,
        expected_post_full_row_sha256: descriptor.post_full_row_sha256,
      }])),
      apply_audit_exact: exactAudit(comparableAudits, expectedGroupAudit(manifest, group, false)),
      recovery_audit_exact: groupAudits.some((row) => row.action === RECOVERY_ACTION) ? exactAudit(comparableAudits, expectedGroupAudit(manifest, group, true)) : null,
    }
  })

  const violations = compareOnlyExpectedBranchDiffs(manifest, preRows, observedRows)
  if (stableJson(auditsBefore) !== stableJson(auditsAfter)) violations.push('audit rows changed during postcheck; result is not a stable observation')
  const validRecordIds = new Set(['plan', ...manifest.groups.map((group) => group.id)])
  for (const row of comparableAudits) {
    if (!EXPECTED_ACTIONS.has(row.action)) violations.push(`unexpected audit action ${row.action}`)
    if (!validRecordIds.has(row.record_id)) violations.push(`unexpected audit record_id ${row.record_id}`)
    if ((row.action === START_ACTION || row.action === COMPLETE_ACTION) && row.record_id !== 'plan') violations.push(`plan audit action has group record_id ${row.record_id}`)
    if ((row.action === APPLY_ACTION || row.action === RECOVERY_ACTION) && row.record_id === 'plan') violations.push(`group audit action has plan record_id`)
  }
  const startExact = exactAudit(comparableAudits, expectedStartAudit(manifest))
  const completeRows = comparableAudits.filter((row) => row.action === COMPLETE_ACTION && row.record_id === 'plan')
  const completionExact = exactAudit(comparableAudits, expectedCompleteAudit(manifest))
  if (completeRows.length > 0 && !completionExact) violations.push('completion audit is absent from the exact reviewed payload or duplicated')
  if (groupResults.some((group) => group.state === 'inconsistent')) violations.push('one or more groups are inconsistent')

  const states = Object.fromEntries(['pending', 'applied', 'recovered', 'inconsistent'].map((state) => [state, groupResults.filter((group) => group.state === state).length]))
  const appliedOrdinals = groupResults.flatMap((group, index) => group.state === 'applied' ? [index] : [])
  const prefixApplied = appliedOrdinals.every((ordinal, index) => ordinal === index)
  if (states.applied > 0 && !startExact) violations.push('applied group exists without exact plan-start audit')
  if (states.pending > 0 && states.applied > 0 && !prefixApplied) violations.push('applied groups are not a contiguous prefix')
  let status = 'inconsistent'
  if (violations.length === 0 && states.applied === 44 && completionExact) status = 'completed'
  else if (violations.length === 0 && states.applied === 44 && completeRows.length === 0) status = 'fully_applied_unfinalized'
  else if (violations.length === 0 && states.applied > 0 && states.pending === 44 - states.applied && states.recovered === 0 && completeRows.length === 0) status = 'partial'
  else if (violations.length === 0 && states.pending === 44 && !startExact && completeRows.length === 0) status = 'not_started'
  else if (violations.length === 0 && states.recovered > 0) status = 'recovery_state'

  const proof = {
    schema_version: 1,
    kind: 'historical_grouped_repair_postcheck',
    captured_at: new Date().toISOString(),
    status,
    manifest: {
      plan_id: manifest.plan_id,
      run_id: manifest.execution.run_id,
      content_sha256: manifest.content_sha256,
      source_lineage_commit: manifest.source.source_lineage_commit,
      production_schema_sha256: manifest.source.production_schema_sha256,
    },
    summary: { groups: states, start_audit_exact: startExact, completion_audit_exact: completionExact, audit_rows: auditsAfter.length, violations },
    groups: groupResults,
    full_proof: { pre_rows: preRows, observed_rows: observedRows, audit_rows_before: auditsBefore, audit_rows_after: auditsAfter },
  }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ status, groups: states, rows: Object.fromEntries(Object.entries(observedRows).map(([table, rows]) => [table, rows.length])), audit_rows: auditsAfter.length, start_audit_exact: startExact, completion_audit_exact: completionExact, violations: violations.length, proof: outPath })}\n`)
  return proof
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  runPostcheck(parseArgs(process.argv.slice(2))).then((proof) => {
    if (proof.status === 'inconsistent') process.exitCode = 2
  }).catch((error) => {
    const secret = String(process.env.CLOUDFLARE_API_TOKEN || '')
    let message = String(error?.message || 'Postcheck failed')
    if (secret) message = message.replaceAll(secret, '[redacted]')
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
