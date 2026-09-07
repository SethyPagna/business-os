#!/usr/bin/env node

import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildImportArtifact,
  buildCompletionAbsenceGuard,
  cleanupImportWorkDirectory,
  executeAndReconcile,
  executeWranglerFileImport,
  materializeStatement,
  parseWranglerImportResult,
} from './wrangler-file-import-transport.mjs'

const require = createRequire(resolve('cloudflare/package.json'))
const Database = require('better-sqlite3')
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const expectReject = async (run, pattern, message) => {
  let error
  try { await run() } catch (caught) { error = caught }
  assert(error && pattern.test(String(error.message)), message)
}

const hostile = {
  apostrophe: "O'Brien",
  khmer: 'សាកល្បងទិន្នន័យ',
  injection: "'); UPDATE victim SET value='pwned' WHERE id=1; --",
  placeholder: '?',
  nested: { newline: 'line 1\nline 2', null_value: null, number: 7.5 },
}
const encoded = JSON.stringify([hostile])
const guard = {
  label: 'fees-001:pre-guard:fees',
  expected_changes: 0,
  sql: "SELECT CASE WHEN json_extract(?, '$[0].apostrophe')='O''Brien' AND json_extract(?, '$[0].khmer')='សាកល្បងទិន្នន័យ' THEN 0 ELSE json('guard failed') END",
  params: [encoded],
}

await expectReject(() => Promise.resolve(materializeStatement(guard)), /exactly one string parameter/, 'multiple placeholders were not rejected')
const singleGuard = {
  ...guard,
  label: 'fees-002:pre-guard:fees',
  sql: "SELECT CASE WHEN json_extract(?, '$[0].apostrophe')='O''Brien' THEN 0 ELSE json('guard failed') END",
}
const materializedGuard = materializeStatement(singleGuard)
assert(!materializedGuard.includes('\r'), 'materialized guard contains CR bytes')
assert(materializedGuard.includes("O''Brien") && materializedGuard.includes('សាកល្បងទិន្នន័យ'), 'literalization lost quoted or Unicode input')
assert(materializedGuard.includes("UPDATE victim SET value=''pwned''"), 'injection sentinel was not kept inside an escaped SQL literal')
assert(materializeStatement({ label: 'quoted', expected_changes: 0, sql: "SELECT '?' AS literal /* ? */ -- ?\n", params: [] }).includes("'?'"), 'quoted/comment question marks were treated as bind placeholders')
await expectReject(() => Promise.resolve(materializeStatement({ label: 'unbound', expected_changes: 0, sql: 'SELECT ?', params: [] })), /unbound SQL placeholder/, 'unbound placeholder reached an import')
await expectReject(() => Promise.resolve(materializeStatement({ label: 'transaction', expected_changes: 0, sql: 'BEGIN TRANSACTION', params: [] })), /forbidden/, 'explicit transaction wrapper was accepted')
await expectReject(() => Promise.resolve(materializeStatement({ label: 'crlf', expected_changes: 0, sql: 'SELECT 1\r\n', params: [] })), /LF-only/, 'CRLF SQL was accepted')

const sqlite = new Database(':memory:')
sqlite.exec("CREATE TABLE fees(id INTEGER PRIMARY KEY,value TEXT CHECK(value <> 'forbidden')); INSERT INTO fees VALUES(1,'before'),(2,'before'); CREATE TABLE victim(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO victim VALUES(1,'safe'); CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,label TEXT,entity TEXT,entity_id TEXT,record_id TEXT,action TEXT)")
const runImportTransaction = (artifact) => {
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    sqlite.exec(artifact.sql)
    sqlite.exec('COMMIT')
  } catch (error) {
    sqlite.exec('ROLLBACK')
    throw error
  }
}

const firstArtifact = buildImportArtifact('fees-002', [
  singleGuard,
  { label: 'fees-002:apply-audit', expected_changes: 1, sql: "INSERT INTO audit_logs(id,label) VALUES (1,'first')", params: [] },
  { label: 'fees-002:apply:fees', expected_changes: 1, sql: "UPDATE fees SET value='applied-one' WHERE id=1 AND value='before'", params: [] },
])
assert(firstArtifact.statement_count === 3 && firstArtifact.bytes === Buffer.byteLength(firstArtifact.sql), 'artifact shape or byte count is wrong')
assert(!firstArtifact.sql.includes('\r') && !firstArtifact.sql.includes('BEGIN') && !firstArtifact.sql.includes('COMMIT'), 'artifact contains forbidden transaction text or CR bytes')
runImportTransaction(firstArtifact)
assert(sqlite.prepare('SELECT value FROM fees WHERE id=1').get().value === 'applied-one', 'successful first group did not commit')
assert(sqlite.prepare('SELECT value FROM victim WHERE id=1').get().value === 'safe', 'hostile JSON escaped its SQL literal')

const secondArtifact = buildImportArtifact('fees-003', [
  { label: 'fees-003:pre-guard:fees', expected_changes: 0, sql: "SELECT CASE WHEN (SELECT value FROM fees WHERE id=2)='before' THEN 0 ELSE json('guard failed') END", params: [] },
  { label: 'fees-003:apply-audit', expected_changes: 1, sql: "INSERT INTO audit_logs(id,label) VALUES (2,'second')", params: [] },
  { label: 'fees-003:apply:fees', expected_changes: 1, sql: "UPDATE fees SET value='forbidden' WHERE id=2 AND value='before'", params: [] },
])
await expectReject(() => Promise.resolve(runImportTransaction(secondArtifact)), /CHECK constraint failed/, 'later statement failure did not abort the local import transaction')
assert(sqlite.prepare('SELECT value FROM fees WHERE id=1').get().value === 'applied-one', 'second group rollback crossed the committed first-group boundary')
assert(sqlite.prepare('SELECT value FROM fees WHERE id=2').get().value === 'before', 'failed second group left a target update')
assert(sqlite.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE id=2').get().count === 0, 'failed second group left its audit insert')

const driftArtifact = buildImportArtifact('fees-004', [
  { label: 'fees-004:pre-guard:fees', expected_changes: 0, sql: "SELECT CASE WHEN (SELECT value FROM fees WHERE id=2)='different' THEN 0 ELSE json('guard failed') END", params: [] },
  { label: 'fees-004:apply-audit', expected_changes: 1, sql: "INSERT INTO audit_logs(id,label) VALUES (3,'third')", params: [] },
  { label: 'fees-004:apply:fees', expected_changes: 1, sql: "UPDATE fees SET value='applied-three' WHERE id=2", params: [] },
])
await expectReject(() => Promise.resolve(runImportTransaction(driftArtifact)), /malformed JSON/, 'false precondition did not raise an SQL error')
assert(sqlite.prepare('SELECT value FROM fees WHERE id=2').get().value === 'before' && sqlite.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE id=3').get().count === 0, 'guard failure did not roll back atomically')

const terminalManifest = { execution: { run_id: 'terminal-run' } }
const terminalGroup = { id: 'fees-005' }
sqlite.prepare("INSERT INTO audit_logs(id,label,entity,entity_id,record_id,action) VALUES (4,'completion','historical_metadata_repair',?,'plan','historical_branch_metadata_repair_completed')").run(terminalManifest.execution.run_id)
const terminalRecoveryArtifact = buildImportArtifact('fees-005', [
  buildCompletionAbsenceGuard(terminalManifest, terminalGroup),
  { label: 'fees-005:post-guard:fees', expected_changes: 0, sql: "SELECT CASE WHEN (SELECT value FROM fees WHERE id=2)='before' THEN 0 ELSE json('guard failed') END", params: [] },
  { label: 'fees-005:recovery-audit', expected_changes: 1, sql: "INSERT INTO audit_logs(id,label) VALUES (5,'recovery')", params: [] },
  { label: 'fees-005:recover:fees', expected_changes: 1, sql: "UPDATE fees SET value='recovered' WHERE id=2", params: [] },
], 'recovery')
await expectReject(() => Promise.resolve(runImportTransaction(terminalRecoveryArtifact)), /malformed JSON/, 'terminal completion did not abort recovery')
assert(sqlite.prepare('SELECT value FROM fees WHERE id=2').get().value === 'before' && sqlite.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE id=5').get().count === 0, 'terminal completion allowed a recovery mutation or audit')
sqlite.close()

const successStdout = JSON.stringify([{
  results: [{ 'Total queries executed': firstArtifact.statement_count, 'Rows read': 4, 'Rows written': 2, 'Database size (MB)': '1.00' }],
  success: true,
  finalBookmark: '00000001-00000001',
  meta: { rows_read: 4, rows_written: 2, changes: 2 },
}])
const parsed = parseWranglerImportResult({ exitCode: 0, stdout: successStdout, stderr: '', timedOut: false }, firstArtifact.statement_count)
assert(parsed.confirmed_complete && parsed.num_queries === 3 && parsed.aggregate.rows_written === 2, 'valid Wrangler aggregate was rejected')
assert(parsed.stdout_framing === 'json', 'plain Wrangler JSON framing was not classified exactly')
const wranglerBannerText = ' ⛅️ wrangler 4.116.0'
const exactWranglerBanner = `\n${wranglerBannerText}\n${'─'.repeat(wranglerBannerText.length)}\n`
const bannerParsed = parseWranglerImportResult({ exitCode: 0, stdout: `${exactWranglerBanner}${successStdout}`, stderr: '', timedOut: false }, firstArtifact.statement_count)
assert(bannerParsed.confirmed_complete && bannerParsed.stdout_framing === 'wrangler_4_116_banner_json', 'exact Wrangler 4.116 banner framing was rejected')
const bomParsed = parseWranglerImportResult({ exitCode: 0, stdout: `\ufeff${successStdout}`, stderr: '', timedOut: false }, firstArtifact.statement_count)
assert(bomParsed.confirmed_complete && bomParsed.stdout_framing === 'utf8_bom_json', 'UTF-8 BOM JSON framing was rejected')
for (const invalidStdout of [
  '',
  `arbitrary banner\n${successStdout}`,
  `${exactWranglerBanner}${successStdout}\n${successStdout}`,
  `${successStdout}\ntrailing output`,
  `\n ⛅️ wrangler 4.116.0 (update available 5.0.0)\n${'─'.repeat(44)}\n${successStdout}`,
]) {
  const rejected = parseWranglerImportResult({ exitCode: 0, stdout: invalidStdout, stderr: '', timedOut: false }, firstArtifact.statement_count)
  assert(!rejected.confirmed_complete && rejected.error_code === 'wrangler_import_unrecognized_stdout_framing', 'unreviewed or multiple stdout framing was accepted')
  assert(Number.isInteger(rejected.stdout_bytes) && /^[a-f0-9]{64}$/.test(rejected.stdout_sha256), 'rejected framing lacks content-free structural diagnostics')
  if (invalidStdout) assert(!JSON.stringify(rejected).includes(invalidStdout), 'rejected framing exposed raw stdout')
}
assert(!Object.hasOwn(parsed, 'statement_changes'), 'transport synthesized unavailable per-statement changes')
assert(!parseWranglerImportResult({ exitCode: 0, stdout: successStdout, stderr: '' }, 4).confirmed_complete, 'wrong aggregate query count was accepted')
assert(!parseWranglerImportResult({ exitCode: 1, stdout: '', stderr: 'remote error', timedOut: false }, 3).confirmed_complete, 'nonzero Wrangler exit was accepted')
assert(!parseWranglerImportResult({ exitCode: -1, stdout: '', stderr: '', timedOut: true }, 3).confirmed_complete, 'Wrangler timeout was accepted')
const privateFailureSentinel = `${firstArtifact.sql}\nC:\\private\\guarded-customer-row.sql\n${hostile.apostrophe}\n${hostile.khmer}\n${hostile.injection}`
const privateFailure = parseWranglerImportResult({ exitCode: 1, stdout: privateFailureSentinel, stderr: privateFailureSentinel, timedOut: false }, 3)
const serializedPrivateFailure = JSON.stringify(privateFailure)
for (const privateValue of [firstArtifact.sql, 'guarded-customer-row.sql', hostile.apostrophe, hostile.khmer, hostile.injection]) {
  assert(!serializedPrivateFailure.includes(privateValue), 'Wrangler failure result exposed private SQL, row data, or a temporary path')
}
assert(privateFailure.error_code === 'wrangler_import_process_failed', 'Wrangler failure did not return the fixed safe classification')

let temporaryFilePath
let invocation
const fileExecution = await executeWranglerFileImport(firstArtifact, {
  runProcess: async (request) => {
    invocation = request
    temporaryFilePath = request.args.find((arg) => arg.startsWith('--file=')).slice('--file='.length)
    assert(existsSync(temporaryFilePath), 'temporary SQL file was not present during Wrangler invocation')
    assert(readFileSync(temporaryFilePath, 'utf8') === firstArtifact.sql, 'temporary SQL bytes differ from the hashed artifact')
    return { exitCode: 0, stdout: successStdout, stderr: '', timedOut: false, outputOverflow: false }
  },
})
assert(fileExecution.confirmed_complete, 'mocked file import did not confirm')
assert(invocation.command === process.execPath && invocation.args.includes('--remote') && invocation.args.includes('--yes') && invocation.args.includes('--json'), 'Wrangler invocation flags are incomplete')
assert(invocation.args.some((arg) => /wrangler\.js$/i.test(arg)) && invocation.args.some((arg) => /operator-wrangler\.toml$/i.test(arg)), 'pinned Wrangler binary/config were not used')
assert(invocation.env.WRANGLER_LOG === 'log' && invocation.env.WRANGLER_WRITE_LOGS === 'false' && invocation.env.NO_COLOR === '1', 'Wrangler child output/log framing environment is not pinned')
assert(!existsSync(temporaryFilePath), 'temporary SQL file was retained after execution')
await expectReject(
  () => Promise.resolve(cleanupImportWorkDirectory(resolve('.'), resolve('unexpected.sql'))),
  /unverified import temporary directory/,
  'recursive cleanup accepted an unverified path',
)

const appliedInspect = async () => ({ state: 'applied' })
const pendingInspect = async () => ({ state: 'pending' })
const confirmedOutcome = await executeAndReconcile({ artifact: firstArtifact, expectedState: 'applied', pendingState: 'pending', inspect: appliedInspect, executeImport: async () => parsed })
assert(confirmedOutcome.status === 'applied_and_verified', 'confirmed import plus applied state was not accepted')
const ambiguousApplied = await executeAndReconcile({ artifact: firstArtifact, expectedState: 'applied', pendingState: 'pending', inspect: appliedInspect, executeImport: async () => { throw new Error('connection reset') } })
assert(ambiguousApplied.status === 'applied_after_ambiguous_response', 'ambiguous committed import was not reconciled')
const ambiguousPending = await executeAndReconcile({ artifact: firstArtifact, expectedState: 'applied', pendingState: 'pending', inspect: pendingInspect, executeImport: async () => { throw new Error('connection reset') } })
assert(ambiguousPending.status === 'paused_without_observed_commit', 'ambiguous no-commit import did not pause')
const unclassified = await executeAndReconcile({ artifact: firstArtifact, expectedState: 'applied', pendingState: 'pending', inspect: async () => { throw new Error('read unavailable') }, executeImport: async () => { throw new Error('connection reset') } })
assert(unclassified.status === 'paused_unclassified_ambiguous_response', 'failed post-read did not pause as unclassified')

const source = readFileSync(new URL('./wrangler-file-import-transport.mjs', import.meta.url), 'utf8')
assert(!source.includes('getPlatformProxy('), 'new transport still invokes getPlatformProxy')
assert(source.includes("'d1',\n        'execute'") && source.includes("'--remote'") && source.includes('createRestInspector'), 'transport does not separate REST inspection from Wrangler file import')
assert(source.includes('REVIEWED_MANIFEST_SHA256') && source.includes('REVIEWED_SOURCE_LINEAGE_COMMIT'), 'reviewed manifest/source pins are absent')

process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  checks: [
    'apostrophe_unicode_json_injection_literalization',
    'placeholder_and_transaction_refusal',
    'lf_only_hashed_artifact',
    'guard_and_late_error_atomic_rollback',
    'independent_group_commit_boundary',
    'terminal_completion_atomic_recovery_refusal',
    'aggregate_only_wrangler_result',
    'strict_wrangler_json_framing',
    'pinned_wrangler_child_output_environment',
    'private_failure_output_suppression',
    'pinned_cli_config_and_ephemeral_sql',
    'recursive_cleanup_path_guard',
    'exact_post_state_reconciliation',
    'ambiguous_response_pause',
    'no_platform_proxy_transport',
  ],
  representative_artifact: {
    statements: firstArtifact.statement_count,
    bytes: firstArtifact.bytes,
    sql_sha256: firstArtifact.sql_sha256,
  },
  remote_binding_opened: false,
  wrangler_remote_executed: false,
  production_write: false,
}, null, 2)}\n`)
