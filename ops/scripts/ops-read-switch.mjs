#!/usr/bin/env node
// read-switch job of .github/workflows/ops.yml: turns one read optimization ON, OFF or into shadow sampling by writing the
// system_flags row `read_switches` in production D1, the same row and the same audit record the Worker's own admin route
// writes (cloudflare/src/routes/runtime.ts). It works when nobody can sign in.
//
//   GITHUB_EVENT_PATH  the run's event payload; the `switch` input is read from it (name=state, state off | on | shadow:<rate>)
//   OPS_APPLY          'true' or 'false' (the workflow's boolean apply input); anything but 'true' is a dry run
//   OPS_OUT_DIR        where read-switch-<dry-run|apply>-<run>.enc.json goes
//
// The names allowed are KNOWN_READ_SWITCHES, parsed from cloudflare/src/lib/readSwitches.ts at run time. A dry run reads the row
// and records the plan. With apply, ONE `wrangler d1 execute --remote --command` sends ONE LF-only batch (one transaction):
// a compare-and-swap of the row on its exact stored text, its audit row (only when the swap changed one row), and a guard that
// aborts the batch when the swap matched nothing. Afterwards the row and the audit row are read back.
//
// Public log: the switch name, the old and new state, the epochs, PASS/FAIL, problem codes. Never a row's raw text.

import fs from 'node:fs'
import path from 'node:path'
import {
  CLOUDFLARE_DIR, OpsError, cloudflareErrorCodes, commitId, errorRecord, isMain, publicToken,
  requireEnv, runId, runMain, runWrangler, say, summary, truncate, writeEncryptedReport,
} from './ops-common.mjs'
import { DATABASE, interpretD1Output, wranglerArgs } from './ops-d1-export.mjs'
import { guardSql } from './ops-sql-guard.mjs'

export { DATABASE }

export const TASK = 'read-switch'
export const ACTOR = 'ops:read-switch'
export const SWITCHES_TS = path.join(CLOUDFLARE_DIR, 'src', 'lib', 'readSwitches.ts')
export const MAX_SHADOW_RATE = 0.1
export const MAX_INPUT_CHARS = 128
const DECLARATION = 'export const KNOWN_READ_SWITCHES = ['
const ROW_KEY = 'read_switches'
export const ONLINE_ORDERS_SWITCH = 'online_orders'
export const ONLINE_METHOD_KEY = 'online_order_payment_method'
export const METHOD_READ_SQL = `SELECT value FROM settings WHERE key = '${ONLINE_METHOD_KEY}'`
// The Worker's route refuses online_orders ON while no online payment method is stored; the ops write holds the same rule inside its own statement, so it cannot race a settings save.
export const METHOD_STORED_GUARD = `EXISTS (SELECT 1 FROM settings WHERE key = '${ONLINE_METHOD_KEY}' AND TRIM(COALESCE(value, '')) <> '')`

// Pure: readSwitches.ts text -> KNOWN_READ_SWITCHES. Any other shape of the declaration is refused whole.
export function switchNamesFromSource(source) {
  const text = String(source).replace(/\r\n/g, '\n')
  const start = text.indexOf(DECLARATION)
  if (start === -1 || text.indexOf(DECLARATION, start + DECLARATION.length) !== -1) throw new OpsError('allow-list-unreadable', 'readSwitches.ts must declare KNOWN_READ_SWITCHES exactly once.')
  const open = start + DECLARATION.length
  const close = text.indexOf(']', open)
  const body = close === -1 ? '' : text.slice(open, close)
  if (close === -1 || !text.startsWith('] as const', close) || !/^\s*'[a-z][a-z0-9_]{0,39}'(?:\s*,\s*'[a-z][a-z0-9_]{0,39}')*\s*,?\s*$/.test(body)) {
    throw new OpsError('allow-list-unreadable', 'KNOWN_READ_SWITCHES is not a closed list of quoted names.')
  }
  const names = [...body.matchAll(/'([a-z][a-z0-9_]*)'/g)].map((m) => m[1])
  if (new Set(names).size !== names.length) throw new OpsError('allow-list-unreadable', 'KNOWN_READ_SWITCHES holds a duplicate name.')
  return Object.freeze(names)
}

export function loadSwitchNames(file = SWITCHES_TS) {
  try {
    return switchNamesFromSource(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    if (err instanceof OpsError) throw err
    throw new OpsError('allow-list-unreadable', 'cloudflare/src/lib/readSwitches.ts could not be read.')
  }
}

// Pure: 'off' | 'on' | 'shadow:<rate>' -> the stored token (shadow clamped to the limit); null for any other spelling.
export function tokenOf(state) {
  if (state === 'off' || state === 'on') return state
  const m = typeof state === 'string' ? /^shadow:(\d{1,3}(?:\.\d{1,6})?)$/.exec(state) : null
  if (!m || !(Number(m[1]) > 0)) return null
  return `shadow:${Math.min(Number(m[1]), MAX_SHADOW_RATE)}`
}

// Pure: the input -> { name, token }. The error detail names no text of the input.
export function parseSwitchInput(raw, allowList) {
  if (typeof raw !== 'string') throw new OpsError('switch-input-missing', 'The switch input was not given.')
  if (raw.length > MAX_INPUT_CHARS) throw new OpsError('switch-input-too-long', 'The switch input is too long.')
  const m = /^([a-z][a-z0-9_]{0,39})=([a-z0-9:.]{1,24})$/.exec(raw.replace(/^[ \t]+|[ \t]+$/g, ''))
  if (!m) throw new OpsError('switch-input-malformed', 'The switch input is not name=state.')
  if (!allowList.includes(m[1])) throw new OpsError('switch-name-not-allowed', 'The name is not one of KNOWN_READ_SWITCHES.')
  const token = tokenOf(m[2])
  if (!token) throw new OpsError('switch-state-invalid', 'The state is not off, on or shadow:<rate>.')
  return { name: m[1], token }
}

// Pure mirror of lib/readSwitches.ts parseReadSwitches + serializeReadSwitches (held equal by test-ops-read-switch.mjs).
function parsedRow(raw) {
  let stored = null
  try { const v = typeof raw === 'string' ? JSON.parse(raw) : null; stored = v && typeof v === 'object' && !Array.isArray(v) ? v : null } catch { stored = null }
  return stored
}
export function epochOf(raw) {
  const e = parsedRow(raw)?.epoch
  return typeof e === 'number' && Number.isSafeInteger(e) && e > 0 ? e : 0
}
export function tokenIn(raw, name) {
  const switches = parsedRow(raw)?.switches
  const token = switches && typeof switches === 'object' && !Array.isArray(switches) ? switches[name] : undefined
  return tokenOf(token) ?? 'off'
}
export function nextValue(raw, allowList, change, at) {
  const stored = parsedRow(raw)
  const kept = {}
  const old = stored?.switches
  if (old && typeof old === 'object' && !Array.isArray(old)) {
    for (const [name, token] of Object.entries(old)) {
      if (!allowList.includes(name) && /^[a-z][a-z0-9_]{0,39}$/.test(name) && typeof token === 'string' && token.length <= 24 && Object.keys(kept).length < 32) kept[name] = token
    }
  }
  const switches = { ...kept }
  for (const name of allowList) switches[name] = tokenIn(raw, name)
  switches[change.name] = change.token
  return JSON.stringify({ epoch: epochOf(raw) + 1, set_at: at, set_by: 0, switches })
}

// Names come from the allow-list and states are fixed tokens; ':' is not a public-log character, so shadow:0.1 prints as shadow-0.1.
const word = (value) => publicToken(String(value).replace(':', '-'))
const sqlText = (value) => `'${String(value).replace(/'/g, "''")}'`

export const READ_SQL = `SELECT value FROM system_flags WHERE key = '${ROW_KEY}'`
function canonicalRead(sql) {
  if (guardSql(sql).sql !== sql) throw new OpsError('read-sql-not-canonical', 'A read is not in the guard canonical form.')
  return sql
}

// Pure: the one write. set_by 0 is "the ops task" (the Worker's own route writes the administrator's id).
export function buildBatch({ stored, value, name, from, to, epochBefore, epochAfter, context }) {
  if (!/^(\d{1,20}|local)$/.test(String(context.runId)) || !/^([0-9a-f]{7,40}|unknown)$/.test(String(context.commit))) throw new OpsError('context-invalid', 'The run id or commit is not in its expected shape.')
  const details = JSON.stringify({ name, from, to, epochBefore, epochAfter, source: 'ops', task: TASK, run_id: context.runId, commit: context.commit })
  const change = JSON.stringify({ state: from, epoch: epochBefore })
  const changed = JSON.stringify({ state: to, epoch: epochAfter })
  const off = to === 'off'
  const maintenance = "NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance')"
  const needsMethod = name === ONLINE_ORDERS_SWITCH && to === 'on'
  const guardMaintenance = off ? '1' : needsMethod ? `${maintenance} AND ${METHOD_STORED_GUARD}` : maintenance
  const statements = [
    `INSERT INTO system_flags (key, value, updated_at) SELECT '${ROW_KEY}', ${sqlText(value)}, CURRENT_TIMESTAMP WHERE ${guardMaintenance} ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP WHERE system_flags.value = ${stored === null ? 'NULL' : sqlText(stored)} AND ${guardMaintenance}`,
    `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details, table_name, record_id, old_value, new_value, device_name, device_tz) SELECT NULL, ${sqlText(ACTOR)}, 'read_switch_set', 'read_switch', ${sqlText(name)}, ${sqlText(details)}, 'read_switch', ${sqlText(name)}, ${sqlText(change)}, ${sqlText(changed)}, NULL, NULL WHERE changes() = 1`,
    "SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('[1]', '$[read_switch_conflict]') END",
  ]
  return { sql: statements.map((s) => `${s};`).join('\n'), statements, details }
}

function wranglerRecord(r) {
  return { exitCode: r.code, timedOut: r.timedOut, stdout: truncate(r.stdout, 20000), stderr: truncate(r.stderr, 20000) }
}

export function reportName({ apply, context }) { return `${TASK}-${apply === true ? 'apply' : 'dry-run'}-${context.runId}` }
export function reportMeta({ apply, context, createdAt }) { return { kind: TASK, name: apply === true ? 'apply' : 'dry-run', commit: context.commit, runId: context.runId, createdAt } }

export function parseApplyFlag(raw) {
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new OpsError('apply-input-invalid', 'OPS_APPLY must be exactly true or false.')
}

export function readSwitchInput(eventPath) {
  if (typeof eventPath !== 'string' || !eventPath) throw new OpsError('switch-input-missing', 'No event payload path.')
  let event
  try { event = JSON.parse(fs.readFileSync(eventPath, 'utf8')) } catch { throw new OpsError('switch-input-missing', 'The event payload is unreadable.') }
  const value = event && typeof event === 'object' && event.inputs && typeof event.inputs === 'object' ? event.inputs.switch : undefined
  if (typeof value !== 'string') throw new OpsError('switch-input-missing', 'The event payload carries no switch input.')
  return value
}

async function readMethod(d1) {
  const r = await d1(canonicalRead(METHOD_READ_SQL))
  if (r.code !== 0 || r.timedOut) return { ok: false, problems: [r.timedOut ? 'd1-read-timed-out' : 'd1-read-exit-nonzero'], stored: false, errorCodes: cloudflareErrorCodes(`${r.stdout}
${r.stderr}`) }
  const v = interpretD1Output(r.stdout, { minRows: 0, maxRows: 1, expectZero: null })
  if (!v.ok) return { ok: false, problems: v.problems, stored: false, errorCodes: v.errorCodes || [] }
  return { ok: true, problems: [], stored: String(v.rows[0]?.value ?? '').trim() !== '', errorCodes: [] }
}

async function readRow(d1) {
  const r = await d1(canonicalRead(READ_SQL))
  if (r.code !== 0 || r.timedOut) return { ok: false, problems: [r.timedOut ? 'd1-read-timed-out' : 'd1-read-exit-nonzero'], stored: null, errorCodes: cloudflareErrorCodes(`${r.stdout}\n${r.stderr}`) }
  const v = interpretD1Output(r.stdout, { minRows: 0, maxRows: 1, expectZero: null })
  if (!v.ok) return { ok: false, problems: v.problems, stored: null, errorCodes: v.errorCodes || [] }
  const row = v.rows[0]
  if (row && typeof row.value !== 'string') return { ok: false, problems: ['state-row-malformed'], stored: null, errorCodes: [] }
  return { ok: true, problems: [], stored: row ? row.value : null, errorCodes: [] }
}

// The whole job, with D1 behind d1(sql) -> { code, stdout, stderr, timedOut } (runWrangler in production, a SQLite-backed fake in
// the tests). Returns { ok, report, lines }: report for the encrypted file, lines for the public log.
export async function runTask({ apply, rawInput, allowList, d1, context, now = () => new Date().toISOString() }) {
  const lines = []
  const problems = []
  const errorCodes = []
  const report = { kind: TASK, database: DATABASE, apply: apply === true, action: null, commit: context.commit, runId: context.runId, requested: null, before: null, plan: null, plannedSql: null, write: null, after: null, problems }
  const finish = () => {
    const codes = [...new Set(problems)]
    for (const problem of codes) lines.push(['problem: {code}', { code: new OpsError(problem) }])
    for (const code of [...new Set(errorCodes)].slice(0, 5)) lines.push(['cloudflare error code: {code}', { code }])
    report.problems = codes
    return { ok: codes.length === 0, report, lines }
  }
  lines.push(['apply: {apply}', { apply: apply === true }])

  let request
  try {
    request = parseSwitchInput(rawInput, allowList)
  } catch (err) {
    if (!(err instanceof OpsError)) throw err
    problems.push(err instanceof OpsError ? err.code : 'internal-error')
    report.inputError = errorRecord(err)
    lines.push(['switch input: {result}', { result: 'FAIL' }])
    return finish()
  }
  report.requested = request
  lines.push(['switch input: PASS ({name} -> {state})', { name: word(request.name), state: word(request.token) }])

  const before = await readRow(d1)
  if (!before.ok) {
    const v = before
    problems.push(...v.problems)
    errorCodes.push(...before.errorCodes)
    lines.push(['state read: {result}', { result: 'FAIL' }])
    return finish()
  }
  const from = tokenIn(before.stored, request.name)
  const epochBefore = epochOf(before.stored)
  report.before = { stored: before.stored, state: from, epoch: epochBefore }
  lines.push(['state: {name} is {state} at epoch {epoch}', { name: word(request.name), state: word(from), epoch: epochBefore }])
  const changes = from !== request.token
  if (changes && request.name === ONLINE_ORDERS_SWITCH && request.token === 'on') {
    const method = await readMethod(d1)
    if (!method.ok) { const v = method; problems.push(...v.problems); errorCodes.push(...method.errorCodes); lines.push(['method read: {result}', { result: 'FAIL' }]); return finish() }
    if (!method.stored) { problems.push('online-method-not-stored'); lines.push(['online payment method: {result}', { result: 'FAIL' }]); return finish() }
  }
  report.action = !changes ? 'nothing-to-change' : apply === true ? 'write' : 'dry-run'
  if (!changes || apply !== true) {
    if (changes) {
      lines.push(['write: SKIPPED (dry run); {name} would go {from} -> {to}', { name: word(request.name), from: word(from), to: word(request.token) }])
      report.plan = { from, to: request.token, epochAfter: epochBefore + 1 }
    } else {
      lines.push(['write: SKIPPED (already {state})', { state: word(from) }])
    }
    return finish()
  }

  const value = nextValue(before.stored, allowList, request, now())
  const build = buildBatch({ stored: before.stored, value, name: request.name, from, to: request.token, epochBefore, epochAfter: epochBefore + 1, context })
  report.plannedSql = build.sql
  const w = await d1(build.sql)
  if (w.code !== 0 || w.timedOut) {
    if (w.timedOut) problems.push('write-wrangler-timed-out')
    else problems.push('write-wrangler-exit-nonzero')
    errorCodes.push(...cloudflareErrorCodes(`${w.stdout}\n${w.stderr}`))
    report.write = { ok: false, wrangler: wranglerRecord(w) }
  } else {
    report.write = { ok: true }
  }
  lines.push(['write: {result}', { result: report.write.ok ? 'PASS' : 'FAIL' }])

  const after = await readRow(d1)
  if (!after.ok) {
    const v = after
    problems.push(...v.problems)
    errorCodes.push(...after.errorCodes)
  } else {
    report.after = { stored: after.stored, state: tokenIn(after.stored, request.name), epoch: epochOf(after.stored) }
    if (report.write.ok && (after.stored !== value || report.after.state !== request.token || report.after.epoch !== epochBefore + 1)) problems.push('readback-value-mismatch')
    if (!report.write.ok && after.stored === value) problems.push('readback-unexpected-write')
    lines.push(['read-back: {name} is {state} at epoch {epoch}', { name: word(request.name), state: word(report.after.state), epoch: report.after.epoch }])
  }
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
  const allowList = loadSwitchNames()
  let rawInput
  try { rawInput = readSwitchInput(process.env.GITHUB_EVENT_PATH) } catch (err) { if (!(err instanceof OpsError)) throw err; rawInput = undefined }
  const result = await runTask({ apply, rawInput, allowList, d1: runD1, context })
  const finishedAt = new Date().toISOString()
  const written = writeEncryptedReport(outDir, reportName({ apply, context }), { ...result.report, stage: 'final', ok: result.ok, startedAt, finishedAt }, reportMeta({ apply, context, createdAt: finishedAt }))
  result.lines.push(['encrypted file: {bytes} bytes', { bytes: written.bytes }])
  result.lines.push(['read-switch verdict: {verdict}', { verdict: result.ok ? 'PASS' : 'FAIL' }])
  for (const [template, values] of result.lines) {
    say(template, values)
    summary(template, values)
  }
  return result.ok ? 0 : 1
}

if (isMain(import.meta.url)) runMain(main)
