#!/usr/bin/env node
// settings-upsert job of .github/workflows/ops.yml: sets the owner's Telegram
// forum-topic ids (the telegram_topic_* settings) in production D1, and no
// other setting. The deployment is single-tenant, so this is an ops run,
// never a migration.
//
//   GITHUB_EVENT_PATH  the run's event payload. The `settings` input is read
//                      from it (inputs.settings), never from a step env, so
//                      no topic id is echoed in the public log.
//   OPS_APPLY          'true' or 'false' (the workflow's boolean apply input)
//   OPS_OUT_DIR        where settings-upsert-<dry-run|apply>-<run>*.enc.json go
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  (wrangler reads them)
//
// The input is key=value pairs, separated by spaces, tabs or commas:
//   telegram_topic_sales=12 telegram_topic_stock=34
// Keys must be in the Worker's own TELEGRAM_TOPIC_KEYS -- the keys
// getTelegramConfig reads -- which is parsed from cloudflare/src/lib/telegram.ts
// at run time, not restated here. Values are Telegram message_thread_ids:
// canonical digits, 1 to 2147483647. Anything else is refused before D1 is
// touched. Clearing a topic (back to General) is done in Settings, not here.
//
// A dry run (the default) reads every allow-listed key once and writes the
// plan, the exact batch and the previous values to the encrypted file. With
// apply=true, ONE `wrangler d1 execute --remote --command` sends ONE LF-only
// batch, which D1 runs as one transaction:
//   1. for each requested key, the upsert routes/settings.ts POST / runs;
//   2. the audit_logs row audit() + changedFields() store for that save,
//      actor ops:settings-upsert, details.reason saying why;
//   3. the D1 half of bumpVersion(env, 'settings') (cache_versions). A D1
//      batch cannot reach the KV key; the only reader of that version is the
//      portal cache, which never serves a Telegram setting.
// The previous values are written to an encrypted file BEFORE the write.
// Afterwards every allow-listed key and the audit row are read back; any
// mismatch fails the run. The report's restore.settingsInput is an input this
// same task accepts, so a run is undone by running it again with that.
//
// Public log: counts, yes/no, PASS/FAIL/SKIPPED, problem codes, Cloudflare
// error-code numbers and the encrypted file sizes. Never a key, value or row.

import fs from 'node:fs'
import path from 'node:path'
import {
  CLOUDFLARE_DIR, OpsError, cloudflareErrorCodes, commitId, errorRecord, isMain,
  requireEnv, runId, runMain, runWrangler, say, summary, truncate, writeEncryptedReport,
} from './ops-common.mjs'
import { DATABASE, interpretD1Output, parseJsonOutput, wranglerArgs } from './ops-d1-export.mjs'
import { guardSql, scanSql } from './ops-sql-guard.mjs'

export { DATABASE }

export const TASK = 'settings-upsert'
export const ACTOR = 'ops:settings-upsert'
export const REASON = 'Telegram forum topic ids set by the Ops workflow settings-upsert task, after the production environment approval.'
export const TELEGRAM_TS = path.join(CLOUDFLARE_DIR, 'src', 'lib', 'telegram.ts')

// The telegram_topic_* family; lower-case words joined by single underscores.
export const TOPIC_KEY = /^telegram_topic_[a-z]{1,24}(?:_[a-z]{1,24}){0,2}$/
export const MAX_ALLOW_LIST = 32
export const MAX_INPUT_CHARS = 1024
// A Telegram message_thread_id: a positive 32-bit integer.
export const MAX_TOPIC_ID_DIGITS = 10
export const MAX_TOPIC_ID = 2147483647
// The job runs on Windows, where one command line holds at most 32767
// characters and quoting can double the SQL: refuse a batch past this.
export const MAX_BATCH_CHARS = 12000
// SQLite's CURRENT_TIMESTAMP, the route's updated_at.
export const TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
// lib/audit.ts AUDIT_LARGE_VALUE_CHARS.
export const AUDIT_LARGE_VALUE_CHARS = 2048

// routes/settings.ts POST / (whitespace collapsed); the pure test holds this
// to the route's text, and to every other writer of these keys.
export const UPSERT_TEMPLATE = 'INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP'
// lib/audit.ts audit(): the columns it writes.
export const AUDIT_COLUMNS = 'user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, device_tz'
// lib/cache.ts bumpVersionsInD1 for an existing row: MAX(version + 1, current + 1).
export const SETTINGS_VERSION_BUMP = "UPDATE cache_versions SET version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE namespace = 'settings'"

const DECLARATION = 'export const TELEGRAM_TOPIC_KEYS = ['

// ------------------------------------------------------------ allow-list

// Pure: telegram.ts text -> its TELEGRAM_TOPIC_KEYS, frozen. Any other shape
// of that declaration (a spread, a comment, a computed or out-of-family key)
// is refused whole rather than guessed at.
export function topicKeysFromSource(source) {
  const text = String(source).replace(/\r\n/g, '\n')
  const start = text.indexOf(DECLARATION)
  if (start === -1 || text.indexOf(DECLARATION, start + DECLARATION.length) !== -1) {
    throw new OpsError('allow-list-unreadable', 'telegram.ts must declare TELEGRAM_TOPIC_KEYS exactly once.')
  }
  const open = start + DECLARATION.length
  const close = text.indexOf(']', open)
  if (close === -1 || !text.startsWith('] as const', close)) {
    throw new OpsError('allow-list-unreadable', 'TELEGRAM_TOPIC_KEYS is not a closed [...] as const list.')
  }
  const body = text.slice(open, close)
  if (!/^\s*'[a-z_]+'(?:\s*,\s*'[a-z_]+')*\s*,?\s*$/.test(body)) {
    throw new OpsError('allow-list-unreadable', 'TELEGRAM_TOPIC_KEYS holds something other than quoted key literals.')
  }
  const keys = [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  if (!keys.length || keys.length > MAX_ALLOW_LIST || keys.some((key) => !TOPIC_KEY.test(key)) || new Set(keys).size !== keys.length) {
    throw new OpsError('allow-list-unreadable', 'TELEGRAM_TOPIC_KEYS holds an empty, oversized, duplicate or out-of-family key.')
  }
  return Object.freeze(keys)
}

export function loadTopicKeyAllowList(file = TELEGRAM_TS) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    throw new OpsError('allow-list-unreadable', 'cloudflare/src/lib/telegram.ts could not be read.')
  }
  return topicKeysFromSource(text)
}

function assertAllowList(allowList) {
  if (!Array.isArray(allowList) || !allowList.length || allowList.length > MAX_ALLOW_LIST
    || allowList.some((key) => typeof key !== 'string' || !TOPIC_KEY.test(key)) || new Set(allowList).size !== allowList.length) {
    throw new OpsError('allow-list-unreadable', 'The allow-list is not a list of distinct telegram_topic_* keys.')
  }
}

// ---------------------------------------------------------------- input

// Pure: the problem code for one topic id, or null when it is one.
export function topicIdProblem(value) {
  if (typeof value !== 'string' || value === '') return 'settings-value-empty'
  if (!/^[0-9]+$/.test(value)) return 'settings-value-not-digits'
  if (/^0+$/.test(value)) return 'settings-value-zero'
  if (value.startsWith('0')) return 'settings-value-leading-zero'
  if (value.length > MAX_TOPIC_ID_DIGITS) return 'settings-value-too-long'
  if (Number(value) > MAX_TOPIC_ID) return 'settings-value-too-large'
  return null
}

// Pure: the settings input -> [{ key, value }] in the order typed, or an
// OpsError whose detail names only the pair NUMBER (never its text).
export function parseSettingsInput(raw, allowList) {
  assertAllowList(allowList)
  if (typeof raw !== 'string') throw new OpsError('settings-input-missing', 'The settings input was not given.')
  if (raw.length > MAX_INPUT_CHARS) throw new OpsError('settings-input-too-long', 'The settings input is too long.')
  // ASCII blanks only: String.trim() would also drop a no-break space.
  const text = raw.replace(/^[ \t]+|[ \t]+$/g, '')
  if (text === '') throw new OpsError('settings-input-empty', 'The settings input is empty.')
  if (!/^[a-z0-9_=, \t]+$/.test(text)) {
    throw new OpsError('settings-input-invalid-character', 'Only lower-case keys, =, ASCII digits, spaces, tabs and commas are allowed.')
  }
  const pairs = text.split(/[ \t,]+/).filter(Boolean)
  if (!pairs.length) throw new OpsError('settings-input-empty', 'The settings input holds no pair.')
  const allowed = new Set(allowList)
  const seen = new Set()
  const out = []
  pairs.forEach((pair, index) => {
    const detail = { pair: index + 1 }
    const m = /^([^=]+)=(.*)$/.exec(pair)
    if (!m) throw new OpsError('settings-pair-malformed', 'A pair is not key=value.', detail)
    const [, key, value] = m
    if (!allowed.has(key)) throw new OpsError('settings-key-not-allowed', 'A key is not one of the Worker TELEGRAM_TOPIC_KEYS.', detail)
    if (seen.has(key)) throw new OpsError('settings-key-duplicate', 'A key appears twice.', detail)
    seen.add(key)
    const problem = topicIdProblem(value)
    if (problem) throw new OpsError(problem, 'A value is not a Telegram topic id.', detail)
    out.push({ key, value })
  })
  return out
}

export function parseApplyFlag(raw) {
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new OpsError('apply-input-invalid', 'OPS_APPLY must be exactly true or false.')
}

// The `settings` input, from the run's event payload (a string, maybe '').
export function readSettingsInput(eventPath) {
  if (typeof eventPath !== 'string' || !eventPath) throw new OpsError('settings-input-missing', 'No event payload path.')
  let event
  try {
    event = JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  } catch {
    throw new OpsError('settings-input-missing', 'The event payload is unreadable.')
  }
  const inputs = event && typeof event === 'object' ? event.inputs : undefined
  const value = inputs && typeof inputs === 'object' ? inputs.settings : undefined
  if (typeof value !== 'string') throw new OpsError('settings-input-missing', 'The event payload carries no settings input.')
  return value
}

// ---------------------------------------------------------------- reads

// Every read is sent exactly as the read-only guard would send it.
function canonicalRead(sql) {
  if (guardSql(sql).sql !== sql) throw new OpsError('read-sql-not-canonical', 'A read is not in the guard canonical form.')
  return sql
}

// One row per allow-listed key, in list order: present, value, updated_at,
// and the D1 settings version (NULL while that version lives in KV).
export function buildStateSql(allowList) {
  assertAllowList(allowList)
  return canonicalRead(`SELECT j.value AS key, s.key IS NOT NULL AS present, s.value AS value, s.updated_at AS updated_at, (SELECT c.version FROM cache_versions AS c WHERE c.namespace = 'settings') AS settings_version FROM json_each('${JSON.stringify([...allowList])}') AS j LEFT JOIN settings AS s ON s.key = j.value ORDER BY j.key`)
}

export function buildAuditReadSql(auditId) {
  if (!Number.isSafeInteger(auditId) || auditId <= 0) throw new OpsError('audit-id-invalid', 'The audit row id is not a positive integer.')
  return canonicalRead(`SELECT id, ${AUDIT_COLUMNS} FROM audit_logs WHERE id = ${auditId}`)
}

// Pure: wrangler --json stdout of buildStateSql -> { ok, problems, rows, settingsVersion }.
export function interpretState(stdout, allowList) {
  const v = interpretD1Output(stdout, { minRows: allowList.length, maxRows: allowList.length, expectZero: null })
  const problems = []
  problems.push(...v.problems)
  const rows = []
  let settingsVersion = null
  if (v.ok) {
    const versions = new Set()
    let malformed = false
    v.rows.forEach((row, index) => {
      const present = row.present
      const shaped = row.key === allowList[index]
        && (present === 0 || present === 1)
        && (row.value === null || typeof row.value === 'string')
        && (row.updated_at === null || typeof row.updated_at === 'string')
        && (present === 1 || (row.value === null && row.updated_at === null))
        && (row.settings_version === null || Number.isSafeInteger(row.settings_version))
      if (!shaped) {
        malformed = true
        return
      }
      versions.add(row.settings_version)
      rows.push({ key: row.key, present: present === 1, value: row.value, updatedAt: row.updated_at })
    })
    if (malformed) problems.push('state-row-malformed')
    if (versions.size > 1) problems.push('state-version-inconsistent')
    if (versions.size === 1) settingsVersion = [...versions][0]
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)], rows, settingsVersion, errorCodes: v.errorCodes || [] }
}

// ----------------------------------------------------------------- plan

// changedFields' comparison text for a stored value: '' and NULL are "unset".
function auditText(value) {
  return value === null || value === undefined || value === '' ? null : String(value)
}

// Pure: what each requested key is now and will be.
export function planChanges(requested, state) {
  const byKey = new Map(state.rows.map((row) => [row.key, row]))
  return requested.map(({ key, value }) => {
    const row = byKey.get(key)
    if (!row) throw new OpsError('state-key-missing', 'A requested key is not in the state read.')
    const before = row.present ? row.value : null
    return { key, present: row.present, before, after: value, changed: auditText(before) !== value, updatedAt: row.updatedAt }
  })
}

export function decideAction({ apply, plan }) {
  if (apply !== true) return 'dry-run'
  return plan.some((entry) => entry.changed) ? 'write' : 'nothing-to-change'
}

// lib/audit.ts summarizeLargeAuditValue (FNV-1a 32-bit), byte for byte.
function summarizeLargeValue(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `(${text.length} chars, #${hash.toString(16).padStart(8, '0')})`
}

function recordedValue(value) {
  const text = auditText(value)
  if (text !== null && text.length > AUDIT_LARGE_VALUE_CHARS) return summarizeLargeValue(text)
  return value === undefined ? null : value
}

// Pure: old_value/new_value exactly as audit(..., changedFields(before,
// after, { keys })) stores them for the route's save of these keys; null
// when nothing changes (the route then stores NULL in both).
export function auditChange(plan) {
  const before = {}
  const after = {}
  let changed = 0
  for (const entry of plan) {
    if (!entry.changed) continue
    changed += 1
    before[entry.key] = recordedValue(entry.before)
    after[entry.key] = recordedValue(entry.after)
  }
  if (!changed) return null
  return { oldValue: JSON.stringify(before), newValue: JSON.stringify(after) }
}

// Pure: how to put the previous values back.
export function restoreInstructions(plan) {
  const pairs = []
  const clearInSettings = []
  const notRestorableByThisTask = []
  for (const entry of plan) {
    if (!entry.changed) continue
    if (entry.before === null || entry.before === '') clearInSettings.push(entry.key)
    else if (topicIdProblem(entry.before) === null) pairs.push(`${entry.key}=${entry.before}`)
    else notRestorableByThisTask.push({ key: entry.key, value: entry.before })
  }
  return { settingsInput: pairs.join(' '), clearInSettings, notRestorableByThisTask }
}

// ---------------------------------------------------------------- batch

function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export function upsertStatement(key, value) {
  if (typeof key !== 'string' || !TOPIC_KEY.test(key)) throw new OpsError('batch-key-invalid', 'Not a telegram_topic_* key.')
  const problem = topicIdProblem(value)
  if (problem) throw new OpsError(problem, 'Not a Telegram topic id.')
  return UPSERT_TEMPLATE.replace('@key', () => sqlText(key)).replace('@value', () => sqlText(value))
}

// Pure: the one write, in the route's order -- upserts, audit row, version.
export function buildBatch(plan, context) {
  if (!/^(\d{1,20}|local)$/.test(String(context.runId)) || !/^([0-9a-f]{7,40}|unknown)$/.test(String(context.commit))) {
    throw new OpsError('context-invalid', 'The run id or commit is not in its expected shape.')
  }
  const change = auditChange(plan)
  if (!change) throw new OpsError('batch-nothing-to-change', 'No requested key changes; there is nothing to write.')
  const keys = plan.map((entry) => entry.key)
  const details = JSON.stringify({ keys, source: 'ops', task: TASK, reason: REASON, run_id: context.runId, commit: context.commit })
  const statements = plan.map((entry) => upsertStatement(entry.key, entry.after))
  const auditIndex = statements.length
  statements.push(`INSERT INTO audit_logs (${AUDIT_COLUMNS}) VALUES (NULL, ${sqlText(ACTOR)}, 'update', 'settings', NULL, ${sqlText(details)}, 'settings', NULL, ${sqlText(change.oldValue)}, ${sqlText(change.newValue)}, NULL, NULL) RETURNING id`)
  statements.push(SETTINGS_VERSION_BUMP)
  return {
    sql: statements.map((statement) => `${statement};`).join('\n'),
    statements,
    auditIndex,
    audit: { details, oldValue: change.oldValue, newValue: change.newValue },
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const LITERAL = "'(?:[^']|'')*'"
const UPSERT_LINE = new RegExp(`^${escapeRegExp(UPSERT_TEMPLATE).replace('@key', () => "'([a-z_]+)'").replace('@value', () => "'([0-9]+)'")};$`)
const AUDIT_LINE = new RegExp(`^INSERT INTO audit_logs \\(${escapeRegExp(AUDIT_COLUMNS)}\\) VALUES \\(NULL, 'ops:settings-upsert', 'update', 'settings', NULL, (${LITERAL}), 'settings', NULL, (${LITERAL}), (${LITERAL}), NULL, NULL\\) RETURNING id;$`)

function literalText(literal) {
  return literal.slice(1, -1).replace(/''/g, "'")
}

function jsonObject(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// Pure: re-reads the batch text before it is sent, independently of the
// builder: one statement per line, upserts of distinct allow-listed keys to
// topic ids, then exactly the audit row for those keys, then exactly the
// version bump. [] when it is that; problem codes otherwise.
export function batchShapeProblems(sql, allowList) {
  const problems = []
  if (typeof sql !== 'string' || !sql) return ['batch-empty']
  if (sql.length > MAX_BATCH_CHARS) problems.push('batch-too-long')
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(sql)) problems.push('batch-control-character')
  if (!sql.endsWith(';')) problems.push('batch-unterminated')
  const lines = sql.split('\n')
  let parts = []
  try {
    parts = scanSql(sql)
  } catch {
    problems.push('batch-unscannable')
  }
  if (parts.some((part) => part.type === 'line-comment' || part.type === 'block-comment')) problems.push('batch-comment')
  const semicolons = parts.filter((part) => part.type === 'code').reduce((n, part) => n + (part.text.match(/;/g) || []).length, 0)
  if (semicolons !== lines.length) problems.push('batch-statement-count')
  if (lines.length < 3) {
    problems.push('batch-statement-count')
    return [...new Set(problems)]
  }
  const allowed = new Set(allowList)
  const upserts = []
  for (const line of lines.slice(0, -2)) {
    const m = UPSERT_LINE.exec(line)
    if (!m || !allowed.has(m[1]) || topicIdProblem(m[2]) !== null || upserts.some((u) => u.key === m[1])) {
      problems.push('batch-upsert-invalid')
      continue
    }
    upserts.push({ key: m[1], value: m[2] })
  }
  const audit = AUDIT_LINE.exec(lines[lines.length - 2])
  if (!audit) {
    problems.push('batch-audit-invalid')
  } else {
    const details = jsonObject(literalText(audit[1]))
    const keys = upserts.map((u) => u.key)
    if (!details || !Array.isArray(details.keys) || JSON.stringify(details.keys) !== JSON.stringify(keys)
      || details.source !== 'ops' || details.task !== TASK || details.reason !== REASON) {
      problems.push('batch-audit-details-invalid')
    }
    const before = jsonObject(literalText(audit[2]))
    const after = jsonObject(literalText(audit[3]))
    const diffKeys = after ? Object.keys(after) : []
    const inOrder = keys.filter((key) => diffKeys.includes(key))
    if (!before || !after || !diffKeys.length || JSON.stringify(Object.keys(before)) !== JSON.stringify(diffKeys)
      || JSON.stringify(inOrder) !== JSON.stringify(diffKeys)
      || diffKeys.some((key) => after[key] !== upserts.find((u) => u.key === key).value || (before[key] !== null && typeof before[key] !== 'string'))) {
      problems.push('batch-audit-diff-invalid')
    }
  }
  if (lines[lines.length - 1] !== `${SETTINGS_VERSION_BUMP};`) problems.push('batch-bump-invalid')
  return [...new Set(problems)]
}

// Pure: wrangler --json stdout of the batch -> { ok, problems, auditId, meta }.
export function interpretApplyOutput(stdout, build) {
  const problems = []
  const parsed = parseJsonOutput(stdout)
  if (parsed === undefined) return { ok: false, problems: ['write-output-not-json'], auditId: null, meta: null, errorCodes: [] }
  if (!Array.isArray(parsed)) {
    return { ok: false, problems: [parsed && parsed.error ? 'write-d1-error' : 'write-output-not-an-array'], auditId: null, meta: null, errorCodes: cloudflareErrorCodes(JSON.stringify(parsed)) }
  }
  if (parsed.length !== build.statements.length) problems.push('write-result-count')
  if (parsed.some((set) => !set || typeof set !== 'object' || set.success === false)) problems.push('write-success-false')
  const auditSet = parsed[build.auditIndex]
  const auditRows = auditSet && Array.isArray(auditSet.results) ? auditSet.results : []
  const auditId = auditRows.length === 1 && auditRows[0] && Number.isSafeInteger(auditRows[0].id) && auditRows[0].id > 0 ? auditRows[0].id : null
  if (auditId === null) problems.push('write-audit-id-missing')
  return { ok: problems.length === 0, problems, auditId, meta: parsed.map((set) => (set && set.meta) || null), errorCodes: [] }
}

// ------------------------------------------------------------- read-back

// Pure: the state after the write against the plan and the state before.
export function readBackProblems({ plan, before, after }) {
  const problems = []
  const requested = new Map(plan.map((entry) => [entry.key, entry.after]))
  const earlier = new Map(before.rows.map((row) => [row.key, row]))
  for (const row of after.rows) {
    if (requested.has(row.key)) {
      if (!row.present || row.value !== requested.get(row.key)) problems.push('readback-value-mismatch')
      else if (typeof row.updatedAt !== 'string' || !TIMESTAMP.test(row.updatedAt)) problems.push('readback-updated-at-shape')
      continue
    }
    const was = earlier.get(row.key)
    if (!was || was.present !== row.present || was.value !== row.value || was.updatedAt !== row.updatedAt) problems.push('readback-other-key-changed')
  }
  if (Number.isSafeInteger(before.settingsVersion) && !(Number.isSafeInteger(after.settingsVersion) && after.settingsVersion >= before.settingsVersion + 1)) {
    problems.push('readback-settings-version')
  }
  return [...new Set(problems)]
}

// Pure: wrangler --json stdout of buildAuditReadSql -> problem codes.
export function auditReadBackProblems(stdout, build, auditId) {
  const v = interpretD1Output(stdout, { minRows: 0, maxRows: 1, expectZero: null })
  const problems = []
  problems.push(...v.problems)
  if (!v.ok) return problems
  if (!v.rows.length) {
    problems.push('readback-audit-missing')
    return problems
  }
  const row = v.rows[0]
  const want = {
    id: auditId, user_id: null, user_name: ACTOR, action: 'update', entity: 'settings', entity_id: null,
    details: build.audit.details, table_name: 'settings', record_id: null,
    old_value: build.audit.oldValue, new_value: build.audit.newValue, device_name: null, device_tz: null,
  }
  if (Object.keys(want).some((column) => row[column] !== want[column])) problems.push('readback-audit-mismatch')
  return problems
}

// ------------------------------------------------------------------ run

function wranglerRecord(r) {
  return { exitCode: r.code, timedOut: r.timedOut, stdout: truncate(r.stdout, 20000), stderr: truncate(r.stderr, 20000) }
}

async function readState(d1, sql, allowList) {
  const r = await d1(sql)
  if (r.code !== 0 || r.timedOut) {
    return {
      ok: false, problems: [r.timedOut ? 'd1-read-timed-out' : 'd1-read-exit-nonzero'], rows: [], settingsVersion: null,
      errorCodes: cloudflareErrorCodes(`${r.stdout}\n${r.stderr}`), wrangler: wranglerRecord(r),
    }
  }
  const state = interpretState(r.stdout, allowList)
  return state.ok ? state : { ...state, wrangler: wranglerRecord(r) }
}

export function reportName({ apply, context }) {
  return `${TASK}-${apply === true ? 'apply' : 'dry-run'}-${context.runId}`
}

// The envelope header is cleartext: only these public fields go in it.
export function reportMeta({ apply, context, createdAt }) {
  return { kind: TASK, name: apply === true ? 'apply' : 'dry-run', commit: context.commit, runId: context.runId, createdAt }
}

export const RESTORE_HELP = 'To undo: run settings-upsert again with restore.settingsInput as the settings input; clear each key in restore.clearInSettings in Settings > Telegram (empty means General).'

// The whole job, with D1 behind d1(sql) -> { code, stdout, stderr, timedOut }
// (runWrangler in production, a SQLite-backed fake in the tests), and the
// pre-write file behind checkpoint(report) -> bytes. Returns
// { ok, report, lines }: report for the encrypted file, lines for the log.
export async function runTask({ apply, rawInput, allowList, d1, context, checkpoint }) {
  const lines = []
  const problems = []
  const errorCodes = []
  const report = {
    kind: TASK, database: DATABASE, apply: apply === true, action: null, commit: context.commit, runId: context.runId,
    allowList: [...allowList], rawInput: typeof rawInput === 'string' ? truncate(rawInput, 2000) : null, requested: null,
    before: null, settingsVersionBefore: null, plan: null, restore: null, restoreHelp: RESTORE_HELP, audit: null,
    plannedSql: null, batchCheck: null, write: null, after: null, settingsVersionAfter: null, readBack: null, problems,
  }
  const finish = () => {
    const codes = [...new Set(problems)]
    for (const problem of codes) lines.push(['problem: {code}', { code: new OpsError(problem) }])
    for (const code of [...new Set(errorCodes)].slice(0, 5)) lines.push(['cloudflare error code: {code}', { code }])
    report.problems = codes
    return { ok: codes.length === 0, report, lines }
  }
  lines.push(['apply: {apply}', { apply: apply === true }])
  lines.push(['allow-list: {count} keys', { count: allowList.length }])

  let requested
  try {
    requested = parseSettingsInput(rawInput, allowList)
  } catch (err) {
    if (!(err instanceof OpsError)) throw err
    problems.push(err instanceof OpsError ? err.code : 'internal-error')
    report.inputError = errorRecord(err)
    if (err.detail && Number.isSafeInteger(err.detail.pair)) lines.push(['settings input: FAIL at pair {pair}', { pair: err.detail.pair }])
    else lines.push(['settings input: {result}', { result: 'FAIL' }])
    return finish()
  }
  report.requested = requested
  lines.push(['settings input: PASS ({count} pairs)', { count: requested.length }])

  // 1. Every allow-listed key, once.
  const stateSql = buildStateSql(allowList)
  const before = await readState(d1, stateSql, allowList)
  if (!before.ok) {
    const v = before
    problems.push(...v.problems)
    errorCodes.push(...before.errorCodes)
    report.stateRead = before.wrangler || null
    lines.push(['state read: {result}', { result: 'FAIL' }])
    return finish()
  }
  lines.push(['state read: {result}', { result: 'PASS' }])
  report.before = before.rows
  report.settingsVersionBefore = before.settingsVersion
  const plan = planChanges(requested, before)
  report.plan = plan
  report.restore = restoreInstructions(plan)
  const changed = plan.filter((entry) => entry.changed).length
  lines.push(['to change: {changed}; already equal: {unchanged}', { changed, unchanged: plan.length - changed }])
  const action = decideAction({ apply, plan })
  report.action = action

  let build = null
  if (changed) {
    build = buildBatch(plan, context)
    report.plannedSql = build.sql
    report.audit = build.audit
    report.batchCheck = batchShapeProblems(build.sql, allowList)
    if (report.batchCheck.length) {
      problems.push('batch-shape-invalid')
      lines.push(['batch check: {result}', { result: 'FAIL' }])
      return finish()
    }
    lines.push(['batch check: {result}', { result: 'PASS' }])
  } else {
    lines.push(['batch check: {result}', { result: 'SKIPPED' }])
  }

  if (action !== 'write') {
    lines.push(['write: {result}', { result: 'SKIPPED' }])
    lines.push(['read-back: {readBack}', { readBack: 'SKIPPED' }])
    return finish()
  }

  // 2. The previous values reach an encrypted file before anything changes.
  if (typeof checkpoint === 'function') {
    const bytes = await checkpoint(report)
    lines.push(['encrypted pre-write file: {bytes} bytes', { bytes }])
  }

  // 3. The one write.
  const w = await d1(build.sql)
  if (w.code !== 0 || w.timedOut) {
    if (w.timedOut) problems.push('write-wrangler-timed-out')
    else problems.push('write-wrangler-exit-nonzero')
    errorCodes.push(...cloudflareErrorCodes(`${w.stdout}\n${w.stderr}`))
    report.write = { ok: false, auditId: null, wrangler: wranglerRecord(w) }
  } else {
    const v = interpretApplyOutput(w.stdout, build)
    problems.push(...v.problems)
    report.write = { ok: v.ok, auditId: v.auditId, meta: v.meta }
    if (!v.ok) report.write.wrangler = wranglerRecord(w)
  }
  lines.push(['write: {result}', { result: report.write.ok ? 'PASS' : 'FAIL' }])

  // 4. Read everything back, whatever the write reported.
  const problemsBeforeReadBack = problems.length
  const after = await readState(d1, stateSql, allowList)
  if (!after.ok) {
    const v = after
    problems.push(...v.problems)
    errorCodes.push(...after.errorCodes)
    report.readBackState = after.wrangler || null
  } else {
    report.after = after.rows
    report.settingsVersionAfter = after.settingsVersion
    const v = { problems: readBackProblems({ plan, before, after }) }
    problems.push(...v.problems)
  }
  if (report.write.auditId !== null) {
    const r = await d1(buildAuditReadSql(report.write.auditId))
    if (r.code !== 0 || r.timedOut) {
      problems.push('readback-audit-unreadable')
      errorCodes.push(...cloudflareErrorCodes(`${r.stdout}\n${r.stderr}`))
    } else {
      const v = { problems: auditReadBackProblems(r.stdout, build, report.write.auditId) }
      problems.push(...v.problems)
    }
  }
  report.readBack = { ok: problems.length === problemsBeforeReadBack, problems: problems.slice(problemsBeforeReadBack) }
  lines.push(['read-back: {readBack}', { readBack: report.readBack.ok ? 'PASS' : 'FAIL' }])
  return finish()
}

function runD1(sql) {
  return runWrangler(wranglerArgs(sql), { cwd: CLOUDFLARE_DIR, timeoutMs: 5 * 60 * 1000 })
}

async function main() {
  const outDir = requireEnv('OPS_OUT_DIR')
  requireEnv('CLOUDFLARE_API_TOKEN')
  requireEnv('CLOUDFLARE_ACCOUNT_ID')
  const apply = parseApplyFlag(requireEnv('OPS_APPLY'))
  const context = { runId: runId(), commit: commitId() }
  const startedAt = new Date().toISOString()
  const allowList = loadTopicKeyAllowList()
  let rawInput
  try {
    rawInput = readSettingsInput(process.env.GITHUB_EVENT_PATH)
  } catch (err) {
    if (!(err instanceof OpsError)) throw err
    rawInput = undefined
  }
  const name = reportName({ apply, context })
  const checkpoint = (report) => writeEncryptedReport(outDir, `${name}-before-write`, { ...report, stage: 'before-write', startedAt }, reportMeta({ apply, context, createdAt: new Date().toISOString() })).bytes
  const result = await runTask({ apply, rawInput, allowList, d1: runD1, context, checkpoint })
  const finishedAt = new Date().toISOString()
  const written = writeEncryptedReport(outDir, name, { ...result.report, stage: 'final', ok: result.ok, startedAt, finishedAt }, reportMeta({ apply, context, createdAt: finishedAt }))
  result.lines.push(['encrypted file: {bytes} bytes', { bytes: written.bytes }])
  result.lines.push(['settings-upsert verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  for (const [template, values] of result.lines) {
    say(template, values)
    summary(template, values)
  }
  return result.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
