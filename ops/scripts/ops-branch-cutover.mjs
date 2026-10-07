#!/usr/bin/env node
// branch-cutover job of .github/workflows/ops.yml: the production operator for the Shop -> LC Store consolidation.
// It drives the Worker's token-gated endpoint (cloudflare/src/routes/branchCutoverOperator.ts) with the shared loop in
// ops/scripts/branch-cutover-loop.mjs, one durable step per request, and never touches D1 directly. Only `bookmark`
// (and `start`, which captures one first) call wrangler: `wrangler d1 time-travel info`, which reads and changes nothing.
//
//   OPS_CUTOVER_MODE  inspect | bookmark | repair-sk2-check | repair-sk2 | start | resume-until-ready | status | abort | finalize
//                     repair-sk2-check / repair-sk2 (SK2-REPAIR, owner 7 Oct 2026): the one-off product 5357 repair
//                     (cloudflare/src/lib/sk2CleanserRepair.ts), read-only check then apply, just before start. Acts as
//                     OPS_ACTOR_USER_ID, which must be 5. Idempotent: a re-run answers done and writes nothing.
//   OPS_OPERATION_ID  the operation to continue (blank: the one unfinished operation, found by `status`)
//   OPS_APPROVED_FOLDS    owner-approved folds of inactive stocked products (dup:keeper,...), used by inspect and start
//   OPS_ACTOR_USER_ID the administrator the run acts as (inspect, start); every later step uses the journal's actor
//   OPS_OUT_DIR       where branch-cutover-<mode>-<run>.enc.json is written
//   BRANCH_CUTOVER_OPERATOR_TOKEN  the shared secret the Worker also holds
//   OPS_CUTOVER_BUDGET_MINUTES     resume-until-ready stops cleanly after this long (default 300); re-run to resume
//   CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID  (wrangler, bookmark and start only)
//
// Public log: the mode, the operation id, phase names, revision numbers, step counts, PASS/FAIL and fixed refusal codes.
// Everything the Worker returned (inspect's preimages and digests, refusal details) is only in the encrypted report.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  CLOUDFLARE_DIR, OpsError, cloudflareErrorCodes, commitId, errorRecord, isMain, publicToken, requireEnv, runId, runMain, runWrangler,
  say, summary, truncate, writeEncryptedReport,
} from './ops-common.mjs'
import {
  CAPABILITY_CODES, NEXT_STATES, OPERATION_PHASES, abortCutover, createClient, finalizeCutover, inspectCutover, parseApprovedFoldsText, readStatus, resumeUntilReady, startCutover,
} from './branch-cutover-loop.mjs'

export const MODES = Object.freeze(['inspect', 'bookmark', 'repair-sk2-check', 'repair-sk2', 'start', 'resume-until-ready', 'status', 'abort', 'finalize'])
// The repair's states (lib/sk2CleanserRepair.ts): pre and ab can be applied, done is the end state, stale refuses.
export const SK2_STATES = Object.freeze(['pre', 'ab', 'done', 'stale'])
export const DEFAULT_BASE_URL = 'https://admin.leangbeauty.com'
export const ALLOWED_HOSTS = Object.freeze(['admin.leangbeauty.com', 'leangbeauty.com'])
export const DATABASE = 'business-os'
const REQUEST_TIMEOUT_MS = 60000
const BOOKMARK = /\b[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}\b/

export function baseUrl(raw) {
  const text = String(raw || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  let url
  try { url = new URL(text) } catch { throw new OpsError('bad-base-url', 'The base URL is not a URL.') }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname) || url.port || url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new OpsError('bad-base-url', 'The base URL must be the plain https origin of a production host.')
  }
  return url.origin
}

// The deterministic begin request id: one per workflow run, shared by its retries and by a re-run of the same run.
export const beginRequestId = (run) => `cutover_begin_${/^\d{1,20}$/.test(String(run)) ? run : 'local'}`

export function makeSend({ origin, token, fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return async (action, text) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${origin}/api/internal/branch-cutover/${action}`, {
        method: 'POST', redirect: 'error', signal: controller.signal, body: text,
        headers: { 'content-type': 'application/json', 'x-cutover-operator-token': token, 'user-agent': 'business-os-ops' },
      })
      let json = null
      try { json = JSON.parse(await response.text()) } catch { /* a proxy page: the status decides */ }
      return { status: response.status, json }
    } finally { clearTimeout(timer) }
  }
}

// wrangler prints {"bookmark": "...", ...} with --json; older output is prose naming the bookmark. Either way it must look like one.
export function parseBookmark(stdout) {
  const text = String(stdout || '')
  try {
    const parsed = JSON.parse(text)
    const found = parsed && typeof parsed.bookmark === 'string' ? BOOKMARK.exec(parsed.bookmark) : null
    if (found) return found[0]
  } catch { /* prose */ }
  const match = BOOKMARK.exec(text)
  return match ? match[0] : null
}

export async function captureBookmark() {
  const result = await runWrangler(['d1', 'time-travel', 'info', DATABASE, '--json'], {
    cwd: CLOUDFLARE_DIR, timeoutMs: 3 * 60 * 1000,
    env: { WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_PATH: path.join(os.tmpdir(), `ops-cutover-wrangler-${process.pid}`) },
  })
  fs.rmSync(path.join(os.tmpdir(), `ops-cutover-wrangler-${process.pid}`), { recursive: true, force: true })
  const errorCodes = cloudflareErrorCodes(`${result.stdout}\n${result.stderr}`)
  const bookmark = result.code === 0 && !result.timedOut ? parseBookmark(result.stdout) : null
  if (!bookmark) throw new OpsError('bookmark-not-captured', 'Time Travel returned no bookmark.', { exitCode: result.code, timedOut: result.timedOut, errorCodes, stdout: truncate(result.stdout, 4000), stderr: truncate(result.stderr, 4000) })
  return { bookmark, capturedAt: new Date().toISOString(), info: truncate(result.stdout, 4000) }
}

// The one place a value of this script becomes a public-log word: a mode, a journal phase, a next state, a capability code or an operation id.
const PUBLIC_VALUES = new Set([...MODES, ...SK2_STATES, ...OPERATION_PHASES, ...NEXT_STATES, ...CAPABILITY_CODES.map((code) => code.replaceAll('_', '-')), 'other'])
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export function vetted(value) {
  const text = String(value)
  if (!PUBLIC_VALUES.has(text) && !OPERATION_ID.test(text)) throw new OpsError('unsafe-public-value', 'A value outside the fixed vocabulary was about to be printed.')
  return publicToken(text)
}
const phaseToken = (state) => vetted(state.phase)

function progressPrinter() {
  let lastPhase = null
  return ({ steps, state }) => {
    if (state.phase !== lastPhase || steps % 500 === 0) {
      say('step {steps}: phase {phase}, revision {revision}', { steps, phase: phaseToken(state), revision: state.revision })
      lastPhase = state.phase
    }
  }
}

export async function executeMode(mode, { client, env, now = Date.now, bookmark = captureBookmark, run = runId() }) {
  const operationId = String(env.OPS_OPERATION_ID || '').trim()
  const actorUserId = Number(env.OPS_ACTOR_USER_ID)
  const approvedFolds = parseApprovedFoldsText(env.OPS_APPROVED_FOLDS)
  const needActor = () => {
    if (!Number.isSafeInteger(actorUserId) || actorUserId < 1) throw new OpsError('actor-user-missing', 'OPS_ACTOR_USER_ID must be a user id.')
  }
  const out = { mode }
  if (mode === 'inspect') {
    needActor()
    const { inspect, verdict } = await inspectCutover(client, { actorUserId, approvedFolds })
    out.inspect = inspect
    out.ready = verdict.ready
    say('inspect: {result}', { result: verdict.ready ? 'PASS' : 'FAIL' })
    for (const code of verdict.capabilityCodes) say('blocking capability: {code}', { code: vetted(code.replaceAll('_', '-')) })
    if (!verdict.ready) throw Object.assign(new OpsError('inspect-not-ready', 'Inspect reports capabilities that block a cutover.'), { detail: { capabilities: inspect.capabilities }, partial: out })
  } else if (mode === 'bookmark') {
    out.bookmark = await bookmark()
    say('time travel bookmark: {result} (in the encrypted file)', { result: 'PASS' })
  } else if (mode === 'repair-sk2-check' || mode === 'repair-sk2') {
    needActor()
    const response = await client.call('repair-sk2', { actorUserId, dryRun: mode === 'repair-sk2-check' })
    const state = SK2_STATES.includes(response.state) ? response.state : 'other'
    out.repair = response
    say('repair-sk2: state {state}, applied {applied}', { state: vetted(state), applied: response.applied === true })
    if (mode === 'repair-sk2-check' && !['pre', 'ab', 'done'].includes(state)) throw Object.assign(new OpsError('repair-sk2-stale', 'The rows are not in a state the repair can apply.'), { partial: out })
    if (mode === 'repair-sk2' && state !== 'done') throw Object.assign(new OpsError('repair-sk2-not-done', 'The repair did not reach its end state.'), { partial: out })
  } else if (mode === 'start') {
    needActor()
    out.bookmark = await bookmark()
    say('time travel bookmark: {result} (in the encrypted file)', { result: 'PASS' })
    const started = await startCutover(client, { actorUserId, requestId: beginRequestId(run), approvedFolds })
    out.inspect = started.inspect
    out.state = started.state
    say('operation {operation}: phase {phase}, revision {revision}, replayed {replayed}', { operation: vetted(started.state.operationId), phase: phaseToken(started.state), revision: started.state.revision, replayed: started.state.replayed === true })
  } else if (mode === 'resume-until-ready') {
    const minutes = Number(env.OPS_CUTOVER_BUDGET_MINUTES || 300)
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 330) throw new OpsError('bad-time-budget', 'The time budget is 1 to 330 minutes.')
    const begun = now()
    const result = await resumeUntilReady(client, { operationId, now, deadline: begun + minutes * 60000, onStep: progressPrinter() })
    out.state = result.state
    out.steps = result.steps
    say('operation {operation}: phase {phase}, revision {revision}, steps this run {steps}', { operation: vetted(result.state.operationId), phase: phaseToken(result.state), revision: result.state.revision, steps: result.steps })
  } else if (mode === 'status') {
    out.state = await readStatus(client, operationId || undefined)
    say('operation {operation}: phase {phase}, revision {revision}, next {next}', { operation: vetted(out.state.operationId), phase: phaseToken(out.state), revision: out.state.revision, next: vetted(out.state.next) })
  } else if (mode === 'finalize') {
    const done = await finalizeCutover(client, { operationId })
    out.state = done.state
    say('operation {operation}: phase {phase}, revision {revision}, replayed {replayed}', { operation: vetted(done.state.operationId), phase: phaseToken(done.state), revision: done.state.revision, replayed: done.replayed })
  } else if (mode === 'abort') {
    const done = await abortCutover(client, { operationId })
    out.state = done.state
    say('operation {operation}: phase {phase}, revision {revision}, replayed {replayed}', { operation: vetted(done.state.operationId), phase: phaseToken(done.state), revision: done.state.revision, replayed: done.replayed })
  } else {
    throw new OpsError('unknown-mode', 'Unknown mode.')
  }
  return out
}

async function main() {
  if (process.env.GITHUB_REF !== 'refs/heads/main') throw new OpsError('not-main', 'Runs only from refs/heads/main.')
  const mode = requireEnv('OPS_CUTOVER_MODE').trim()
  if (!MODES.includes(mode)) throw new OpsError('unknown-mode', 'Unknown mode.')
  const outDir = requireEnv('OPS_OUT_DIR')
  if (mode === 'bookmark' || mode === 'start') { requireEnv('CLOUDFLARE_API_TOKEN'); requireEnv('CLOUDFLARE_ACCOUNT_ID') }
  const operatorToken = mode === 'bookmark' ? null : requireEnv('BRANCH_CUTOVER_OPERATOR_TOKEN')
  const origin = mode === 'bookmark' ? null : baseUrl(process.env.OPS_CUTOVER_BASE_URL)
  const startedAt = new Date().toISOString()
  const run = runId()
  const client = createClient({ send: origin ? makeSend({ origin, token: operatorToken }) : async () => { throw new Error('no endpoint in this mode') } })
  let result = null
  let failure = null
  try {
    result = await executeMode(mode, { client, env: process.env })
  } catch (err) {
    failure = err
    result = err && err.partial ? err.partial : { mode }
  }
  const payload = { kind: 'branch-cutover', mode, commit: commitId(), runId: run, startedAt, finishedAt: new Date().toISOString(), ok: !failure,
    stop: failure ? errorRecord(failure) : null, stats: client.stats, result }
  const report = writeEncryptedReport(outDir, `branch-cutover-${mode}-${run}`, payload, { kind: 'branch-cutover', name: mode, commit: commitId(), runId: run, createdAt: payload.finishedAt })
  const lines = [['calls {calls}, attempts {attempts}, retries {retries}, replayed {replayed}', client.stats]]
  if (failure) lines.push(['stopped: {code}', { code: failure instanceof OpsError ? failure : new OpsError('internal-error') }])
  lines.push(['encrypted file: {bytes} bytes', { bytes: report.bytes }], ['branch-cutover {mode} verdict: {verdict}', { mode: vetted(mode), verdict: failure ? 'FAIL' : 'PASS' }])
  for (const [template, values] of lines) { say(template, values); summary(template, values) }
  return failure ? 1 : 0
}

if (isMain(import.meta.url)) runMain(main)
