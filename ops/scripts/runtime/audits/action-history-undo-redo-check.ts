/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

type FetchSession = {
  cookieHeader: string
}

type ActionHistoryItem = {
  id?: number | string
  status?: string
}

type ActionHistoryResponse = {
  id?: number | string
  item?: ActionHistoryItem
  items?: ActionHistoryItem[]
  payload?: Record<string, unknown>
  error?: string
}

type CleanupCommandResult = {
  ok: boolean
  status: number | string | null
  stdoutTail: string
  stderrTail: string
}

type CleanupResult = {
  skipped: boolean
  ok?: boolean
  apply?: CleanupCommandResult & { outputPath: string }
  postcheck?: CleanupCommandResult & { outputPath: string }
}

type ActionHistoryReport = {
  generatedAt: string
  baseUrl: string
  prefix: string
  actionId: number | null
  checks: Record<string, boolean>
  cleanup: CleanupResult | null
}

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const BASE_URL = process.env.BOS_BASE_URL || 'http://127.0.0.1:4000'
const USERNAME = process.env.BOS_USERNAME || 'admin'
const PASSWORD = process.env.BOS_PASSWORD || 'Admin123456!'
const REPORT_PATH = process.env.BOS_ACTION_HISTORY_REPORT
  ? path.resolve(process.env.BOS_ACTION_HISTORY_REPORT)
  : path.join(ROOT_DIR, 'ops/runtime/reports/action-history-undo-redo-latest.json')
const CLEANUP_REPORT_PATH = process.env.BOS_ACTION_HISTORY_CLEANUP_REPORT
  ? path.resolve(process.env.BOS_ACTION_HISTORY_CLEANUP_REPORT)
  : path.join(ROOT_DIR, 'ops/runtime/reports/action-history-undo-redo-cleanup-latest.json')
const CLEANUP_POSTCHECK_REPORT_PATH = process.env.BOS_ACTION_HISTORY_CLEANUP_POSTCHECK_REPORT
  ? path.resolve(process.env.BOS_ACTION_HISTORY_CLEANUP_POSTCHECK_REPORT)
  : path.join(ROOT_DIR, 'ops/runtime/reports/action-history-undo-redo-cleanup-postcheck-latest.json')
const CLEANUP_TEST_DATA = String(process.env.BOS_ACTION_HISTORY_CLEANUP || '1').trim() !== '0'
const PREFIX = process.env.BOS_ACTION_HISTORY_PREFIX || `QA Action History ${Date.now()}`

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function request(
  session: FetchSession,
  method: string,
  pathname: string,
  body: Record<string, unknown> | null = null,
): Promise<ActionHistoryResponse> {
  const response = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: {
      cookie: session.cookieHeader,
      ...(body == null ? {} : { 'content-type': 'application/json' }),
    },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '')
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${typeof payload === 'string' ? payload : payload?.error || 'unknown error'}`)
  }
  return typeof payload === 'string' ? { error: payload } : payload
}

function runCleanupCommand(args: string[]): CleanupCommandResult {
  const result = spawnSync(process.execPath, [
    path.join(ROOT_DIR, 'ops/scripts/runtime/storage/cleanup-test-data.ts'),
    ...args,
  ], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdoutTail: String(result.stdout || '').slice(-1000),
    stderrTail: String(result.stderr || '').slice(-1000),
  }
}

function cleanupActionHistoryData(prefix: string): CleanupResult {
  if (!CLEANUP_TEST_DATA || !prefix) return { skipped: true }
  const apply = runCleanupCommand([
    '--prefix',
    prefix,
    '--apply',
    '--output',
    CLEANUP_REPORT_PATH,
  ])
  const postcheck = apply.ok
    ? runCleanupCommand([
      '--prefix',
      prefix,
      '--dry-run',
      '--fail-on-match',
      '--output',
      CLEANUP_POSTCHECK_REPORT_PATH,
    ])
    : { ok: false, status: 'skipped-after-apply-failure', stdoutTail: '', stderrTail: '' }
  return {
    skipped: false,
    ok: apply.ok && postcheck.ok,
    apply: {
      ...apply,
      outputPath: CLEANUP_REPORT_PATH,
    },
    postcheck: {
      ...postcheck,
      outputPath: CLEANUP_POSTCHECK_REPORT_PATH,
    },
  }
}

async function main(): Promise<void> {
  let actionId = null
  let cleanup: CleanupResult = { skipped: true }
  const report: ActionHistoryReport = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    prefix: PREFIX,
    actionId: null,
    checks: {},
    cleanup: null,
  }
  try {
    const { loginWithFetch } = await import('./audit-auth.ts')
    const session = await loginWithFetch({ baseUrl: BASE_URL, username: USERNAME, password: PASSWORD })
    const created = await request(session, 'POST', '/api/action-history', {
      scope: 'global',
      entity: 'action_history',
      entity_id: PREFIX,
      label: `${PREFIX} reversible verification`,
      undo_label: `${PREFIX} undo`,
      redo_label: `${PREFIX} redo`,
      reversible: true,
      undo_payload: { verification: PREFIX, direction: 'undo' },
      redo_payload: { verification: PREFIX, direction: 'redo' },
    })
    actionId = Number(created?.id || 0)
    assert(actionId > 0, 'Action history create did not return an id')
    report.actionId = actionId

    const undo = await request(session, 'POST', `/api/action-history/${actionId}/undo`, { verification: PREFIX })
    assert(undo?.item?.status === 'redoable', `Undo did not transition to redoable: ${undo?.item?.status || 'missing'}`)
    assert(undo?.payload?.verification === PREFIX, 'Undo payload did not round-trip')

    const redo = await request(session, 'POST', `/api/action-history/${actionId}/redo`, { verification: PREFIX })
    assert(redo?.item?.status === 'undoable', `Redo did not transition to undoable: ${redo?.item?.status || 'missing'}`)
    assert(redo?.payload?.verification === PREFIX, 'Redo payload did not round-trip')

    const history = await request(session, 'GET', '/api/action-history?scope=global&limit=10&all=1')
    const item = (history?.items || []).find((entry) => Number(entry.id || 0) === actionId)
    assert(item?.status === 'undoable', 'Final action history row was not visible with undoable status')

    report.checks = {
      createReturnedId: true,
      undoTransitionedToRedoable: true,
      redoTransitionedToUndoable: true,
      payloadRoundTrip: true,
      finalHistoryVisible: true,
    }
  } finally {
    cleanup = cleanupActionHistoryData(PREFIX)
    report.cleanup = cleanup
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  }
  assert(
    cleanup.skipped || cleanup.ok,
    `Action-history cleanup failed: ${cleanup.apply?.stderrTail || cleanup.postcheck?.stderrTail || cleanup.apply?.stdoutTail || cleanup.postcheck?.stdoutTail || cleanup.apply?.status || cleanup.postcheck?.status}`,
  )
  console.log(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
})
