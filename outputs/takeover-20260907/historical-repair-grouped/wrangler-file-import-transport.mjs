#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  APPLY_ACTION,
  COMPLETE_ACTION,
  EXPECTED_ACCOUNT_ID,
  EXPECTED_DATABASE_ID,
  RECOVERY_ACTION,
  START_ACTION,
  assert,
  buildApplyStatements,
  buildCompletionStatements,
  buildRecoveryStatements,
  classifyGroup,
  validateManifest,
} from './grouped-repair-core.mjs'
import {
  REVIEWED_MANIFEST_SHA256,
  REVIEWED_SOURCE_LINEAGE_COMMIT,
  verifyCloudflareOperator,
} from './run-grouped-historical-repair.mjs'

const operatorDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(operatorDir, '../../..')
const operatorConfigPath = join(operatorDir, 'operator-wrangler.toml')
const wranglerPackagePath = join(root, 'cloudflare/node_modules/wrangler/package.json')
const wranglerBinPath = join(root, 'cloudflare/node_modules/wrangler/bin/wrangler.js')
const EXPECTED_WRANGLER_VERSION = '4.116.0'
const EXPECTED_WRANGLER_BANNER_TEXT = ` ⛅️ wrangler ${EXPECTED_WRANGLER_VERSION}`
const EXPECTED_WRANGLER_BANNER = `\n${EXPECTED_WRANGLER_BANNER_TEXT}\n${'─'.repeat(EXPECTED_WRANGLER_BANNER_TEXT.length)}\n`
const EXPECTED_WRANGLER_IMPORT_CHECK = '├ Checking if file needs uploading\n│\n'
const EXPECTED_WRANGLER_UPLOAD_FILE = new RegExp(`^├ 🌀 Uploading ${EXPECTED_DATABASE_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[0-9a-f]{16}\\.sql\\n│ 🌀 Uploading complete\\.\\n│\\n`)
const MAX_IMPORT_FILE_BYTES = 1_000_000
const MAX_STATEMENT_BYTES = 100_000
const IMPORT_TIMEOUT_MS = 5 * 60_000
const IMPORT_TEMP_PREFIX = 'bos-historical-d1-import-'
const AUDIT_COLUMNS = ['user_id', 'user_name', 'action', 'entity', 'entity_id', 'details', 'table_name', 'record_id', 'old_value', 'new_value']
const EXPECTED_ACTIONS = new Set([START_ACTION, APPLY_ACTION, RECOVERY_ACTION, COMPLETE_ACTION])
const QUERY_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${EXPECTED_ACCOUNT_ID}/d1/database/${EXPECTED_DATABASE_ID}/query`
const expectedOperatorConfig = `name = "business-os-grouped-historical-repair-operator"\nmain = "run-grouped-historical-repair.mjs"\ncompatibility_date = "2026-09-07"\naccount_id = "${EXPECTED_ACCOUNT_ID}"\n\n# Execution-only remote binding. Review mode never opens this binding.\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "business-os"\ndatabase_id = "${EXPECTED_DATABASE_ID}"\nremote = true\n`

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`
const redact = (value, secret = process.env.CLOUDFLARE_API_TOKEN) => {
  let text = String(value || '')
  if (secret) text = text.replaceAll(String(secret), '[redacted]')
  return text.slice(0, 1_000)
}

function parseArgs(tokens = process.argv.slice(2)) {
  const flags = new Set(['apply-all', 'confirm-reviewed-execution', 'confirm-file-import-unavailability', 'confirm-recovery'])
  const values = new Set(['manifest', 'recover-group', 'confirm-run-id', 'confirm-manifest-sha256', 'confirm-bookmark'])
  const result = {}
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    assert(token?.startsWith('--'), `Unexpected argument: ${token || ''}`)
    const key = token.slice(2)
    assert(flags.has(key) || values.has(key), `Unknown option: --${key}`)
    assert(result[key] === undefined, `Duplicate option: --${key}`)
    if (flags.has(key)) result[key] = true
    else {
      const value = tokens[++index]
      assert(value && !value.startsWith('--'), `Missing value for --${key}`)
      result[key] = value
    }
  }
  return result
}

function unquotedOffsets(sql, target) {
  const offsets = []
  let quote = null
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    if (quote) {
      if (quote === ']' && character === ']') quote = null
      else if (character === quote) {
        if (sql[index + 1] === quote && quote !== ']') index += 1
        else quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') quote = character
    else if (character === '[') quote = ']'
    else if (character === '-' && sql[index + 1] === '-') {
      const newline = sql.indexOf('\n', index + 2)
      if (newline < 0) break
      index = newline
    } else if (character === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2)
      assert(end >= 0, 'SQL contains an unterminated block comment')
      index = end + 1
    } else if (character === target) offsets.push(index)
  }
  assert(quote === null, 'SQL contains an unterminated quoted value')
  return offsets
}

export function materializeStatement(statement) {
  assert(statement && typeof statement.sql === 'string' && statement.sql.trim(), 'import statement SQL is missing')
  assert(!statement.sql.includes('\r'), 'import statement contains CR bytes; LF-only SQL is required')
  assert(!/;\s*$/.test(statement.sql), 'compiled statement must not contain a trailing semicolon')
  assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|ATTACH|DETACH)\b/i.test(statement.sql), 'explicit transaction or attachment SQL is forbidden')
  const params = statement.params || []
  assert(Array.isArray(params) && params.length <= 1, 'file import statements support at most the one reviewed JSON guard parameter')
  assert(unquotedOffsets(statement.sql, ';').length === 0, 'compiled statement contains an unquoted statement delimiter')
  const offsets = unquotedOffsets(statement.sql, '?')
  if (params.length === 0) {
    assert(offsets.length === 0, 'unbound SQL placeholder would reach D1 import')
    return statement.sql
  }
  assert(offsets.length === 1 && typeof params[0] === 'string', 'reviewed guard must contain exactly one string parameter')
  const offset = offsets[0]
  const sql = `${statement.sql.slice(0, offset)}${sqlString(params[0])}${statement.sql.slice(offset + 1)}`
  assert(unquotedOffsets(sql, '?').length === 0, 'SQL placeholder remained after literalization')
  return sql
}

function validateStatementShape(statement) {
  const sql = statement.sql.trim()
  if (/:.*guard:|^complete:/i.test(statement.label)) assert(/^SELECT CASE WHEN\b/i.test(sql), `guard ${statement.label} is not a conditional SELECT`)
  else if (/:.*audit$/i.test(statement.label)) assert(/^INSERT INTO audit_logs\b/i.test(sql), `audit ${statement.label} does not target audit_logs`)
  else if (/:(?:apply|recover):(?:fees|sales|sale_items)$/i.test(statement.label)) assert(/^UPDATE\s+"?(?:fees|sales|sale_items)"?\s+SET\b/i.test(sql), `update ${statement.label} does not target a repair table`)
  else throw new Error(`unrecognized reviewed statement label ${statement.label}`)
}

function validateUnitShape(unitId, phase, statements) {
  assert(['apply', 'recovery', 'completion'].includes(phase), 'invalid import phase')
  if (phase === 'completion') {
    assert(unitId === 'plan-completion' && statements.length === 46, 'completion import must contain 45 guards and one audit')
    assert(statements.slice(0, 45).every((statement) => statement.label.startsWith('complete:')) && statements[45].label === 'plan:complete-audit', 'completion statement order changed')
    return
  }
  assert(unitId !== 'plan-completion', 'data-group phase cannot use the completion unit')
  assert(statements.every((statement) => statement.label === 'plan:start-audit' || statement.label.startsWith(`${unitId}:`)), 'data-group statement label does not match its unit')
  const related = unitId === 'sales-related'
  const rowGuardCount = related ? 2 : 1
  const guardCount = rowGuardCount + (phase === 'recovery' ? 1 : 0)
  if (phase === 'recovery') assert(statements[0].label === `${unitId}:completion-guard:plan`, 'recovery lacks the terminal-completion guard')
  assert(statements.slice(phase === 'recovery' ? 1 : 0, guardCount).every((statement) => statement.label.includes(`:${phase === 'apply' ? 'pre' : 'post'}-guard:`)), 'data-group row guards are missing or out of order')
  const auditCount = phase === 'apply' && unitId === 'fees-001' ? 2 : 1
  const auditSlice = statements.slice(guardCount, guardCount + auditCount)
  assert(auditSlice.every((statement) => statement.label.endsWith('audit')), 'data-group audits are missing or out of order')
  if (phase === 'apply' && unitId === 'fees-001') assert(auditSlice[0].label === 'plan:start-audit', 'first group lacks the plan-start audit')
  const updates = statements.slice(guardCount + auditCount)
  assert(updates.length === (related ? 2 : 1) && updates.every((statement) => statement.label.includes(`:${phase === 'apply' ? 'apply' : 'recover'}:`)), 'data-group updates are missing or out of order')
  assert(statements.length === guardCount + auditCount + updates.length, 'data-group statement count changed')
}

export function buildCompletionAbsenceGuard(manifest, group) {
  assert(manifest?.execution?.run_id && group?.id, 'completion-absence guard inputs are missing')
  return {
    label: `${group.id}:completion-guard:plan`,
    expected_changes: 0,
    sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM audit_logs WHERE entity='historical_metadata_repair' AND entity_id=${sqlString(manifest.execution.run_id)} AND record_id='plan' AND action=${sqlString(COMPLETE_ACTION)})=0 THEN 0 ELSE json('guard failed') END`,
    params: [],
  }
}

export function buildRecoveryImportStatements(manifest, group, rows) {
  return [buildCompletionAbsenceGuard(manifest, group), ...buildRecoveryStatements(manifest, group, rows)]
}

export function buildImportArtifact(unitId, statements, phase = 'apply') {
  assert(/^(?:fees-\d{3}|sales-related|plan-completion)$/.test(unitId), 'invalid import unit ID')
  assert(Array.isArray(statements) && statements.length > 0 && statements.length <= 46, 'invalid import statement count')
  validateUnitShape(unitId, phase, statements)
  const materialized = statements.map((statement) => ({
    label: statement.label,
    expected_changes: statement.expected_changes,
    sql: materializeStatement(statement),
  }))
  for (const statement of materialized) {
    assert(typeof statement.label === 'string' && statement.label, 'import statement label is missing')
    assert(Number.isSafeInteger(statement.expected_changes) && statement.expected_changes >= 0, 'import expected_changes is invalid')
    validateStatementShape(statement)
    assert(Buffer.byteLength(statement.sql) < MAX_STATEMENT_BYTES, `import statement ${statement.label} exceeds the D1 statement limit`)
  }
  const sql = `${materialized.map((statement) => statement.sql).join(';\n\n')};\n`
  assert(!sql.includes('\r'), 'generated import file is not LF-only')
  assert(Buffer.byteLength(sql) <= MAX_IMPORT_FILE_BYTES, 'generated import file exceeds the private operator limit')
  return {
    unit_id: unitId,
    phase,
    statement_count: materialized.length,
    statements_sha256: sha256(JSON.stringify(materialized)),
    sql_sha256: sha256(sql),
    bytes: Buffer.byteLength(sql),
    sql,
  }
}

function parseWranglerJsonStdout(stdout) {
  const raw = String(stdout || '')
  const rawWithoutBom = raw.startsWith('\ufeff') ? raw.slice(1) : raw
  const bom = rawWithoutBom !== raw
  const withoutCrlf = rawWithoutBom.replaceAll('\r\n', '')
  const windowsCrlf = rawWithoutBom.includes('\r\n') && !withoutCrlf.includes('\r') && !withoutCrlf.includes('\n')
  const normalized = windowsCrlf ? rawWithoutBom.replaceAll('\r\n', '\n') : rawWithoutBom
  const basePrefix = `${bom ? 'utf8_bom_' : ''}${windowsCrlf ? 'windows_crlf_' : ''}`
  const attempts = [{ framing: `${basePrefix}json`, text: normalized }]
  const addProgressAttempts = (text, framingPrefix) => {
    if (!text.startsWith(EXPECTED_WRANGLER_IMPORT_CHECK)) return
    const afterCheck = text.slice(EXPECTED_WRANGLER_IMPORT_CHECK.length)
    attempts.push({ framing: `${framingPrefix}cached_import_json`, text: afterCheck })
    const upload = afterCheck.match(EXPECTED_WRANGLER_UPLOAD_FILE)
    if (upload) attempts.push({ framing: `${framingPrefix}upload_progress_json`, text: afterCheck.slice(upload[0].length) })
  }
  addProgressAttempts(normalized, `${basePrefix}wrangler_4_116_`)
  if (normalized.startsWith(EXPECTED_WRANGLER_BANNER)) {
    const afterBanner = normalized.slice(EXPECTED_WRANGLER_BANNER.length)
    const framingPrefix = `${basePrefix}wrangler_4_116_banner_`
    attempts.push({ framing: `${basePrefix}wrangler_4_116_banner_json`, text: afterBanner })
    addProgressAttempts(afterBanner, framingPrefix)
  }
  for (const attempt of attempts) {
    try { return { payload: JSON.parse(attempt.text), framing: attempt.framing } } catch { /* refuse below */ }
  }
  const afterKnownBanner = normalized.startsWith(EXPECTED_WRANGLER_BANNER)
    ? normalized.slice(EXPECTED_WRANGLER_BANNER.length)
    : normalized
  return {
    payload: null,
    framing: afterKnownBanner.startsWith(EXPECTED_WRANGLER_IMPORT_CHECK)
      ? 'invalid_after_wrangler_4_116_import_progress'
      : normalized.startsWith(EXPECTED_WRANGLER_BANNER)
        ? 'invalid_after_wrangler_4_116_banner'
        : bom ? 'invalid_after_utf8_bom' : 'unrecognized',
    diagnostic: {
      stdout_bytes: Buffer.byteLength(raw),
      stdout_sha256: sha256(raw),
    },
  }
}

export function parseWranglerImportResult(execution, expectedStatementCount) {
  assert(execution && Number.isInteger(execution.exitCode), 'Wrangler execution did not return an exit code')
  if (execution.timedOut || execution.outputOverflow || execution.exitCode !== 0) return {
    confirmed_complete: false,
    exit_code: execution.exitCode,
    timed_out: Boolean(execution.timedOut),
    output_overflow: Boolean(execution.outputOverflow),
    error_code: execution.timedOut
      ? 'wrangler_import_timeout'
      : execution.outputOverflow
        ? 'wrangler_import_output_overflow'
        : 'wrangler_import_process_failed',
  }
  const parsedStdout = parseWranglerJsonStdout(execution.stdout)
  if (!parsedStdout.payload) return {
    confirmed_complete: false,
    exit_code: execution.exitCode,
    error_code: 'wrangler_import_unrecognized_stdout_framing',
    stdout_framing: parsedStdout.framing,
    ...parsedStdout.diagnostic,
  }
  const payload = parsedStdout.payload
  const item = Array.isArray(payload) && payload.length === 1 ? payload[0] : null
  const aggregate = item?.results?.[0]
  const numQueries = Number(aggregate?.['Total queries executed'])
  const finalBookmark = String(item?.finalBookmark || '')
  if (item?.success !== true || numQueries !== expectedStatementCount || !finalBookmark || !item?.meta || typeof item.meta !== 'object') return {
    confirmed_complete: false,
    exit_code: execution.exitCode,
    error: 'Wrangler import completion aggregate did not match the exact unit',
    num_queries: Number.isFinite(numQueries) ? numQueries : null,
    final_bookmark: finalBookmark || null,
  }
  return {
    confirmed_complete: true,
    exit_code: execution.exitCode,
    stdout_framing: parsedStdout.framing,
    num_queries: numQueries,
    final_bookmark: finalBookmark,
    aggregate: {
      rows_read: aggregate['Rows read'] ?? null,
      rows_written: aggregate['Rows written'] ?? null,
      meta: item.meta,
    },
  }
}

export function cleanupImportWorkDirectory(work, filePath) {
  const tempRoot = resolve(tmpdir())
  const resolvedWork = resolve(work)
  const resolvedFile = resolve(filePath)
  const fromTempRoot = relative(tempRoot, resolvedWork)
  assert(
    fromTempRoot && !isAbsolute(fromTempRoot) && !fromTempRoot.startsWith('..') && dirname(resolvedWork) === tempRoot && basename(resolvedWork).startsWith(IMPORT_TEMP_PREFIX),
    'refusing to remove an unverified import temporary directory',
  )
  assert(dirname(resolvedFile) === resolvedWork && resolvedFile.toLowerCase().endsWith('.sql'), 'refusing to remove an import directory with an unexpected artifact path')
  rmSync(resolvedWork, { recursive: true, force: true })
}

function validateLocalRuntime() {
  assert(existsSync(operatorConfigPath) && readFileSync(operatorConfigPath, 'utf8').replaceAll('\r\n', '\n') === expectedOperatorConfig, 'operator Wrangler config changed')
  assert(existsSync(wranglerPackagePath) && existsSync(wranglerBinPath), 'pinned Wrangler installation is missing')
  assert(readJson(wranglerPackagePath).version === EXPECTED_WRANGLER_VERSION, `Wrangler ${EXPECTED_WRANGLER_VERSION} is required`)
}

export async function executeWranglerFileImport(artifact, dependencies = {}) {
  validateLocalRuntime()
  const work = mkdtempSync(join(resolve(tmpdir()), IMPORT_TEMP_PREFIX))
  const filePath = join(work, `${artifact.unit_id}-${artifact.sql_sha256.slice(0, 16)}.sql`)
  writeFileSync(filePath, artifact.sql, { flag: 'wx', mode: 0o600 })
  try {
    const runProcess = dependencies.runProcess || runWranglerProcess
    const execution = await runProcess({
      command: process.execPath,
      args: [
        wranglerBinPath,
        'd1',
        'execute',
        'business-os',
        '--remote',
        `--file=${filePath}`,
        '--yes',
        '--json',
        `--config=${operatorConfigPath}`,
      ],
      cwd: root,
      env: {
        ...process.env,
        NO_COLOR: '1',
        WRANGLER_LOG: 'log',
        WRANGLER_WRITE_LOGS: 'false',
      },
      timeoutMs: IMPORT_TIMEOUT_MS,
    })
    return parseWranglerImportResult(execution, artifact.statement_count)
  } finally {
    cleanupImportWorkDirectory(work, filePath)
  }
}

async function runWranglerProcess({ command, args, cwd, env, timeoutMs }) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let outputOverflow = false
    let timedOut = false
    const append = (current, chunk) => {
      if (Buffer.byteLength(current) + chunk.length > 1_000_000) {
        outputOverflow = true
        child.kill()
        return current
      }
      return current + chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk) })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ exitCode: -1, stdout, stderr: `${stderr}\n${error.message}`, timedOut, outputOverflow })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolvePromise({ exitCode: Number.isInteger(exitCode) ? exitCode : -1, stdout, stderr, timedOut, outputOverflow })
    })
  })
}

async function restSelect(fetchImpl, token, label, sql, params = []) {
  assert(/^\s*SELECT\b/i.test(sql) && !sql.includes(';'), `${label}: only one SELECT is allowed`)
  let response
  try {
    response = await fetchImpl(QUERY_ENDPOINT, {
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

function validateAuditScope(manifest, rows) {
  const validRecordIds = new Set(['plan', ...manifest.groups.map((group) => group.id)])
  for (const row of rows) {
    assert(EXPECTED_ACTIONS.has(row.action), `unexpected repair audit action ${row.action}`)
    assert(validRecordIds.has(row.record_id), `unexpected repair audit record ${row.record_id}`)
    assert(!((row.action === START_ACTION || row.action === COMPLETE_ACTION) && row.record_id !== 'plan'), 'plan audit uses a group record')
    assert(!((row.action === APPLY_ACTION || row.action === RECOVERY_ACTION) && row.record_id === 'plan'), 'group audit uses the plan record')
  }
}

async function fetchAuditRows(fetchImpl, token, manifest, label) {
  const rows = await restSelect(fetchImpl, token, label, `SELECT ${AUDIT_COLUMNS.join(',')} FROM audit_logs WHERE entity=? AND entity_id=? ORDER BY id`, ['historical_metadata_repair', manifest.execution.run_id])
  validateAuditScope(manifest, rows)
  return rows
}

async function fetchGroupRows(fetchImpl, token, group) {
  const rows = {}
  for (const [table, descriptor] of Object.entries(group.tables)) {
    const placeholders = descriptor.ids.map(() => '?').join(',')
    rows[table] = await restSelect(fetchImpl, token, `${group.id}:${table}`, `SELECT * FROM ${table} WHERE id IN (${placeholders}) ORDER BY id`, descriptor.ids)
  }
  return rows
}

export function createRestInspector(manifest, token, fetchImpl = fetch) {
  return async function inspect(group) {
    const rows = await fetchGroupRows(fetchImpl, token, group)
    const audits = await fetchAuditRows(fetchImpl, token, manifest, `${group.id}:audits`)
    const groupAuditRows = audits.filter((row) => row.record_id === group.id)
    const planAuditRows = audits.filter((row) => row.record_id === 'plan')
    const classified = classifyGroup(manifest, group, rows, groupAuditRows, planAuditRows)
    const hasCompletion = planAuditRows.some((row) => row.action === COMPLETE_ACTION)
    const state = classified === 'recovered' && hasCompletion ? 'inconsistent' : classified
    return { rows, groupAuditRows, planAuditRows, state }
  }
}

async function inspectAll(manifest, inspect) {
  const results = []
  for (const group of manifest.groups) results.push({ group, inspected: await inspect(group) })
  return results
}

export async function executeAndReconcile({ artifact, expectedState, pendingState, inspect, executeImport }) {
  let execution
  try { execution = await executeImport(artifact) }
  catch { execution = { confirmed_complete: false, error_code: 'wrangler_import_execution_exception' } }
  let after
  try { after = await inspect() }
  catch (error) {
    return { status: 'paused_unclassified_ambiguous_response', execution, inspection_error: redact(error?.message || error), artifact: artifactSummary(artifact) }
  }
  if (after.state === expectedState) return {
    status: execution.confirmed_complete ? `${expectedState}_and_verified` : `${expectedState}_after_ambiguous_response`,
    execution,
    state: after.state,
    artifact: artifactSummary(artifact),
  }
  if (after.state === pendingState) return {
    status: execution.confirmed_complete ? 'paused_after_unconfirmed_success' : 'paused_without_observed_commit',
    execution,
    state: after.state,
    artifact: artifactSummary(artifact),
  }
  return { status: 'paused_inconsistent_post_state', execution, state: after.state, artifact: artifactSummary(artifact) }
}

const artifactSummary = (artifact) => ({
  unit_id: artifact.unit_id,
  phase: artifact.phase,
  statement_count: artifact.statement_count,
  statements_sha256: artifact.statements_sha256,
  sql_sha256: artifact.sql_sha256,
  bytes: artifact.bytes,
})

function assertConfirmations(manifest, args, recovery = false) {
  assert(args['confirm-reviewed-execution'] === true, 'write mode requires --confirm-reviewed-execution')
  assert(args['confirm-file-import-unavailability'] === true, 'write mode requires --confirm-file-import-unavailability')
  assert(args['confirm-run-id'] === manifest.execution.run_id, '--confirm-run-id mismatch')
  assert(args['confirm-manifest-sha256'] === manifest.content_sha256, '--confirm-manifest-sha256 mismatch')
  assert(args['confirm-bookmark'] === manifest.execution.time_travel_bookmark, '--confirm-bookmark mismatch')
  if (recovery) assert(args['confirm-recovery'] === true, 'recovery requires --confirm-recovery')
}

export async function runFileImportTransport(args, dependencies = {}) {
  assert(args.manifest && existsSync(resolve(args.manifest)), '--manifest must name an existing grouped execution manifest')
  const manifest = readJson(args.manifest)
  validateManifest(manifest, { reviewedManifestSha256: REVIEWED_MANIFEST_SHA256, reviewedLineageCommit: REVIEWED_SOURCE_LINEAGE_COMMIT })
  const writeMode = Boolean(args['apply-all'] || args['recover-group'])
  assert(!(args['apply-all'] && args['recover-group']), '--apply-all and --recover-group are mutually exclusive')
  if (!writeMode) return {
    status: 'review_only',
    manifest_sha256: manifest.content_sha256,
    source_lineage_commit: manifest.source.source_lineage_commit,
    groups: manifest.groups.length,
    transport: 'wrangler-d1-remote-file-import',
    wrangler_version: EXPECTED_WRANGLER_VERSION,
    production_write: false,
  }
  assertConfirmations(manifest, args, Boolean(args['recover-group']))
  const verifyOperator = dependencies.verifyOperator || verifyCloudflareOperator
  const operator = await verifyOperator()
  assert(JSON.stringify(operator) === JSON.stringify(manifest.execution.cloudflare_operator), 'active Cloudflare token identity differs from the manifest')
  const token = String(dependencies.token ?? process.env.CLOUDFLARE_API_TOKEN ?? '')
  assert(token.length >= 20, 'CLOUDFLARE_API_TOKEN is required')
  const inspect = dependencies.inspect || createRestInspector(manifest, token, dependencies.fetchImpl || fetch)
  const executeImport = dependencies.executeImport || ((artifact) => executeWranglerFileImport(artifact, dependencies.importDependencies || {}))

  if (args['recover-group']) {
    const group = manifest.groups.find((item) => item.id === args['recover-group'])
    assert(group, '--recover-group does not name a manifest group')
    const before = await inspect(group)
    assert(before.state === 'applied', `group ${group.id} is ${before.state}; refusing recovery`)
    assert(!before.planAuditRows.some((row) => row.action === COMPLETE_ACTION), 'completed plan is terminal; refusing group recovery')
    const artifact = buildImportArtifact(group.id, buildRecoveryImportStatements(manifest, group, before.rows), 'recovery')
    return executeAndReconcile({ artifact, expectedState: 'recovered', pendingState: 'applied', inspect: () => inspect(group), executeImport })
  }

  const groups = []
  const groupRows = {}
  for (const group of manifest.groups) {
    const before = await inspect(group)
    if (before.state === 'applied') {
      groups.push({ group_id: group.id, status: 'already_applied' })
      groupRows[group.id] = before.rows
      continue
    }
    assert(before.state === 'pending', `group ${group.id} is ${before.state}; refusing apply`)
    const artifact = buildImportArtifact(group.id, buildApplyStatements(manifest, group, before.rows))
    const outcome = await executeAndReconcile({ artifact, expectedState: 'applied', pendingState: 'pending', inspect: () => inspect(group), executeImport })
    groups.push({ group_id: group.id, ...outcome })
    if (outcome.status !== 'applied_and_verified') return { status: 'paused', groups, production_write: true }
    groupRows[group.id] = (await inspect(group)).rows
  }

  const finalInspection = await inspectAll(manifest, inspect)
  assert(finalInspection.every(({ inspected }) => inspected.state === 'applied'), 'all groups must be exactly applied before completion')
  for (const { group, inspected } of finalInspection) groupRows[group.id] = inspected.rows
  const completionRows = finalInspection[0].inspected.planAuditRows.filter((row) => row.action === COMPLETE_ACTION)
  if (completionRows.length === 1) return { status: 'already_completed', groups, production_write: false }
  assert(completionRows.length === 0, 'completion audit content or count is invalid')
  const artifact = buildImportArtifact('plan-completion', buildCompletionStatements(manifest, groupRows), 'completion')
  const inspectCompletion = async () => {
    const all = await inspectAll(manifest, inspect)
    const complete = all[0].inspected.planAuditRows.filter((row) => row.action === COMPLETE_ACTION)
    const applied = all.every(({ inspected }) => inspected.state === 'applied')
    return { state: applied && complete.length === 1 ? 'completed' : applied && complete.length === 0 ? 'unfinalized' : 'inconsistent' }
  }
  const completion = await executeAndReconcile({ artifact, expectedState: 'completed', pendingState: 'unfinalized', inspect: inspectCompletion, executeImport })
  return { status: completion.status === 'completed_and_verified' ? 'completed' : 'paused', groups, completion, production_write: true }
}

async function main() {
  const result = await runFileImportTransport(parseArgs())
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (result.status === 'paused') process.exitCode = 2
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ status: 'refused_or_failed', error: redact(error?.message || error) })}\n`)
  process.exitCode = 1
})
